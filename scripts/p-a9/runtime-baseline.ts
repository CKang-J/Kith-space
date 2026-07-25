import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const agentCounts = [1, 5, 10, 20] as const;
const rounds = integerOption("--rounds", 5);
const profileRoot = mkdtempSync(path.join(tmpdir(), "kith-space-p-a9-runtime-"));

process.env.NODE_ENV = "test";
process.env.KITH_SPACE_HOME = path.join(profileRoot, "app-data");
process.env.KITH_SPACE_SPACES_DIR = path.join(profileRoot, "spaces");
process.env.KITH_SPACE_LOG_LEVEL = "error";

const [{ AgentManager }, { createFakeRuntimeHarness }, { RuntimeAdmissionController }] = await Promise.all([
  import("../../src/daemon/agentManager.js"),
  import("../../src/daemon/testing/fakeRuntimeHarness.js"),
  import("../../src/runtime/worker/runtimeAdmissionController.js"),
]);

interface BurstRound {
  totalStarts: number;
  peakActiveSessions: number;
  activeAfterStop: number;
  totalStops: number;
  totalExits: number;
  managerEvents: number;
  admitted: number;
  queued: number;
  rejected: number;
  admissionAckP95Ms: number;
  capacity: number;
  queuedAtPeak: number;
}

const results: Record<string, BurstRound[]> = {};

try {
  for (const agentCount of agentCounts) {
    results[String(agentCount)] = [];
    for (let round = 0; round < rounds; round += 1) {
      const workspaceRoot = path.join(profileRoot, "spaces", `agents-${agentCount}-round-${round + 1}`);
      const runtimeStateRoot = path.join(profileRoot, "runtime", `agents-${agentCount}-round-${round + 1}`);
      const harness = createFakeRuntimeHarness();
      const managerEvents: unknown[] = [];
      let controller: InstanceType<typeof RuntimeAdmissionController>;
      const manager = new AgentManager((event) => managerEvents.push(event), {
        runtimeStateRoot,
        binDir: path.join(profileRoot, "bin"),
        runtimeResolver: (runtime) => runtime === "fake" ? harness.runtime : null,
        onSessionEnded(agentId) { controller.sessionEnded(agentId); },
      });
      controller = new RuntimeAdmissionController({
        isRunning(agentId) { return manager.running().includes(agentId); },
        async start(command) { await manager.start(command.agentId, command.config as any, command.reason); return manager.running().includes(command.agentId); },
        deliver(command) { manager.deliver(command.agentId, command.from, command.target, command.mentioned, command); },
        stop(agentId) { return manager.stop(agentId); },
        sleep(agentId) { return manager.sleep(agentId); },
        reset(agentId, command) { return manager.reset({ agentId, spaceId: command.spaceId, workspaceRoot: command.workspaceRoot }, { clearAgentMemory: command.clearAgentMemory }); },
        stopAllAndWait() { return manager.stopAllAndWait(); },
      }, { capacity: 4, maxQueue: 128 });
      const admissionDurations: number[] = [];
      const admissions = await Promise.all(Array.from({ length: agentCount }, async (_, index) => {
        const agentId = `agent-${index + 1}`;
        const startedAt = performance.now();
        const result = await controller.admit({
          type: "agent:start" as const,
          source: "wake" as const,
          generation: 1,
          deliveryId: `delivery-${index + 1}`,
          spaceId: `space-${agentCount}-${round + 1}`,
          agentId,
          config: {
            agentId,
            spaceId: `space-${agentCount}-${round + 1}`,
            workspaceRoot,
            name: agentId,
            displayName: `Agent ${index + 1}`,
            runtime: "fake",
            serverUrl: "http://127.0.0.1:7777",
            agentToken: `fake-token-${index + 1}`,
            introduced: true,
          },
          reason: "wake" as const,
          delivery: {
            seq: index + 1,
            from: "benchmark",
            target: "channel-1",
            targetName: "#benchmark",
            msgShort: `message-${index + 1}`,
            isTask: false,
            mentioned: true,
            responseDirective: "required" as const,
            responseReason: "benchmark",
          },
        });
        admissionDurations.push(performance.now() - startedAt);
        return result;
      }));
      await controller.settled();
      const peak = harness.snapshot();
      const queuePeak = controller.snapshot();

      await controller.shutdown();
      const stopped = harness.snapshot();

      results[String(agentCount)]!.push({
        totalStarts: peak.totalStarts,
        peakActiveSessions: peak.peakActiveSessions,
        activeAfterStop: stopped.activeSessions,
        totalStops: stopped.totalStops,
        totalExits: stopped.totalExits,
        managerEvents: managerEvents.length,
        admitted: admissions.filter((result) => result.status === "admitted").length,
        queued: admissions.filter((result) => result.status === "queued").length,
        rejected: admissions.filter((result) => result.status === "rejected").length,
        admissionAckP95Ms: percentile(admissionDurations, 0.95),
        capacity: queuePeak.capacity,
        queuedAtPeak: queuePeak.queued,
      });
    }
  }

  process.stdout.write(`${JSON.stringify({
    benchmark: "P-A9.4 Worker admission and fake Runtime capacity baseline",
    generatedAt: new Date().toISOString(),
    configuration: { agentCounts, rounds },
    scope: {
      statement: "This harness measures synchronous admission decisions and the bounded AgentManager/Runtime seam.",
      exclusions: [
        "It uses a deterministic fake Runtime; external CLI startup, model, and tool latency are excluded.",
        "Admission timing ends at admitted/queued/rejected and does not claim end-to-end completion.",
      ],
      admissionSlo: { p95Ms: 25, capacity: 4 },
    },
    summaries: Object.fromEntries(agentCounts.map((count) => {
      const countRounds = results[String(count)]!;
      return [String(count), {
        totalStarts: countRounds.map((round) => round.totalStarts),
        peakActiveSessions: countRounds.map((round) => round.peakActiveSessions),
        activeAfterStop: countRounds.map((round) => round.activeAfterStop),
        totalStops: countRounds.map((round) => round.totalStops),
        totalExits: countRounds.map((round) => round.totalExits),
        admissionAckP95Ms: countRounds.map((round) => round.admissionAckP95Ms),
        admitted: countRounds.map((round) => round.admitted),
        queued: countRounds.map((round) => round.queued),
        rejected: countRounds.map((round) => round.rejected),
      }];
    })),
    rounds: results,
  }, null, 2)}\n`);
} finally {
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

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]!;
}
