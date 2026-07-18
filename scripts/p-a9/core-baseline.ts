import { mkdtempSync, rmSync } from "node:fs";
import { cpus, freemem, homedir, platform, release, tmpdir, totalmem } from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { summarizeRounds } from "./statistics.mjs";

const agentCounts = [1, 5, 10, 20] as const;
const rounds = integerOption("--rounds", 5);
const operations = integerOption("--operations", 100);
const warmupOperations = integerOption("--warmup", 100);
const profileRoot = mkdtempSync(path.join(tmpdir(), "kith-space-p-a9-core-"));

process.env.NODE_ENV = "test";
process.env.KITH_SPACE_HOME = path.join(profileRoot, "app-data");
process.env.KITH_SPACE_SPACES_DIR = path.join(profileRoot, "spaces");
process.env.KITH_SPACE_LOG_LEVEL = "error";

const [{ eq }, database, appDatabase, core, eventTesting, workerTesting] = await Promise.all([
  import("drizzle-orm"),
  import("../../src/db/index.js"),
  import("../../src/app-data/appDatabase.js"),
  import("../../src/server/core.js"),
  import("../../src/server/testing/inMemoryEventAdapter.js"),
  import("../../src/local-runtime/testing/inMemoryWorkerAdapter.js"),
]);

interface RoundResult {
  totalLatencyMs: number[];
  durablePrefixLatencyMs: number[];
  sqlStatements: number[];
  fanout: number[];
  socketSendEnqueueDiagnosticMs: number[];
  eventLoopDelayMs: { mean: number; p95: number; max: number };
  heap: { beforeBytes: number; afterBytes: number; peakBytes: number; deltaBytes: number };
}

const results: Record<string, RoundResult[]> = {};

try {
  const human = appDatabase.getHumanProfile() ?? appDatabase.initializeHumanProfile({ name: "P-A9 Baseline Human" });

  for (const agentCount of agentCounts) {
    results[String(agentCount)] = [];
    for (let round = 0; round < rounds; round += 1) {
      const spaceId = randomUUID();
      const rootPath = path.join(profileRoot, "spaces", `agents-${agentCount}-round-${round + 1}`);
      database.registerSpace({
        id: spaceId,
        name: `P-A9 ${agentCount} Agents Round ${round + 1}`,
        slug: `p-a9-${agentCount}-${round + 1}-${spaceId.slice(0, 8)}`,
        rootPath,
      });
      const db = database.dbForSpace(spaceId);
      const [channel] = await db.insert(database.schema.channels).values({
        spaceId,
        name: `baseline-${agentCount}-${round + 1}`,
        type: "channel",
      }).returning();
      if (!channel) throw new Error("Failed to create baseline channel");
      const channelId = channel.id;

      const agents = await db.insert(database.schema.agents).values(
        Array.from({ length: agentCount }, (_, index) => ({
          spaceId,
          name: `agent-${index + 1}`,
          displayName: `Agent ${index + 1}`,
          runtime: "fake",
        })),
      ).returning();
      await core.addChannelMembers(spaceId, channelId, agents.map((agent) => ({ type: "agent", id: agent.id })));

      const events = eventTesting.createInMemoryEventAdapter();
      const worker = workerTesting.createInMemoryWorkerAdapter({
        runtimes: ["fake"],
        runningAgents: agents.map((agent) => agent.id),
      });
      try {
        for (let index = 0; index < warmupOperations; index += 1) {
          await createBaselineMessage(index, "warmup");
        }
        (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
        await waitForImmediate();
        events.clear();
        worker.clear();

        const sqlite = (db as unknown as { $client: {
          prepare: (...args: unknown[]) => unknown;
        } }).$client;
        const originalPrepare = sqlite.prepare.bind(sqlite);
        let statementCount = 0;
        sqlite.prepare = ((...args: unknown[]) => {
          statementCount += 1;
          return originalPrepare(...args as Parameters<typeof originalPrepare>);
        }) as typeof sqlite.prepare;

        const delay = monitorEventLoopDelay({ resolution: 1 });
        const totalLatencyMs: number[] = [];
        const durablePrefixLatencyMs: number[] = [];
        const sqlStatements: number[] = [];
        const fanout: number[] = [];
        const heapBefore = process.memoryUsage().heapUsed;
        let heapPeak = heapBefore;
        delay.enable();
        await waitForImmediate();

        try {
          for (let index = 0; index < operations; index += 1) {
            const eventOffset = events.events().length;
            const workerOffset = worker.messages().length;
            const sqlBefore = statementCount;
            const startedAt = performance.now();
            await createBaselineMessage(index, "measured");
            const completedAt = performance.now();
            const messageEvent = events.events().slice(eventOffset).find((event) => event.type === "message");
            if (!messageEvent) throw new Error("createMessage did not publish its message event");

            totalLatencyMs.push(completedAt - startedAt);
            durablePrefixLatencyMs.push(messageEvent.observedAt - startedAt);
            sqlStatements.push(statementCount - sqlBefore);
            fanout.push(worker.messages().slice(workerOffset).filter((message) => message.type === "agent:deliver").length);
            heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
            // Let the histogram's timer observe the synchronous SQLite/wake-routing block.
            // The yield is outside both latency measurements above.
            await waitForImmediate();
          }
        } finally {
          delay.disable();
          sqlite.prepare = originalPrepare as typeof sqlite.prepare;
        }

        const heapAfter = process.memoryUsage().heapUsed;
        results[String(agentCount)]!.push({
          totalLatencyMs,
          durablePrefixLatencyMs,
          sqlStatements,
          fanout,
          socketSendEnqueueDiagnosticMs: worker.socketSendDurationsMs(),
          eventLoopDelayMs: {
            mean: nanosecondsToMilliseconds(delay.mean),
            p95: nanosecondsToMilliseconds(delay.percentile(95)),
            max: nanosecondsToMilliseconds(delay.max),
          },
          heap: {
            beforeBytes: heapBefore,
            afterBytes: heapAfter,
            peakBytes: heapPeak,
            deltaBytes: heapAfter - heapBefore,
          },
        });
      } finally {
        worker.disconnect();
        events.disconnect();
      }

      async function createBaselineMessage(index: number, phase: string): Promise<void> {
        await core.createMessage({
          spaceId,
          channelId,
          senderType: "human",
          senderId: human.id,
          senderName: human.name,
          content: `P-A9 ${phase} ${agentCount}/${round + 1}/${index + 1}`,
        });
      }
    }
  }

  process.stdout.write(`${JSON.stringify({
    benchmark: "P-A9.0 Core current-behavior baseline",
    generatedAt: new Date().toISOString(),
    configuration: { agentCounts, rounds, operations, warmupOperations },
    machine: machineFacts(),
    definitions: {
      durablePrefixLatencyMs: "createMessage entry to first message realtime publication, after the current durable-write prefix",
      totalLatencyMs: "createMessage entry to resolution, including current wake routing and synchronous socket enqueue",
      socketSendEnqueueDiagnosticMs: "JSON parse/capture time inside the fake socket send call; this is not Worker admission and is not an admission SLO",
    },
    summaries: Object.fromEntries(agentCounts.map((count) => {
      const countRounds = results[String(count)]!;
      return [String(count), {
        totalLatencyMs: summarizeRounds(countRounds.map((round) => round.totalLatencyMs)),
        durablePrefixLatencyMs: summarizeRounds(countRounds.map((round) => round.durablePrefixLatencyMs)),
        sqlStatements: summarizeRounds(countRounds.map((round) => round.sqlStatements)),
        fanout: summarizeRounds(countRounds.map((round) => round.fanout)),
        socketSendEnqueueDiagnosticMs: summarizeRounds(countRounds.map((round) => round.socketSendEnqueueDiagnosticMs)),
        eventLoopDelayMs: countRounds.map((round) => round.eventLoopDelayMs),
        heap: countRounds.map((round) => round.heap),
      }];
    })),
    rounds: results,
  }, null, 2)}\n`);
} finally {
  database.closeAllDatabases();
  const resolvedProfile = path.resolve(profileRoot);
  const resolvedTemp = path.resolve(tmpdir());
  if (!resolvedProfile.startsWith(`${resolvedTemp}${path.sep}`) || resolvedProfile === resolvedTemp || resolvedProfile === homedir()) {
    throw new Error(`Refusing to clean unexpected baseline directory: ${resolvedProfile}`);
  }
  rmSync(resolvedProfile, { recursive: true, force: true });
}

function integerOption(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nanosecondsToMilliseconds(value: number): number {
  return Number.isFinite(value) ? value / 1_000_000 : 0;
}

function machineFacts() {
  const processors = cpus();
  return {
    platform: platform(),
    release: release(),
    architecture: process.arch,
    node: process.version,
    gcExposed: typeof (globalThis as typeof globalThis & { gc?: () => void }).gc === "function",
    cpuModel: processors[0]?.model ?? "unknown",
    logicalCpuCount: processors.length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtStart: freemem(),
  };
}
