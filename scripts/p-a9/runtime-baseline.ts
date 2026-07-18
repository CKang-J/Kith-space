import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const agentCounts = [1, 5, 10, 20] as const;
const rounds = integerOption("--rounds", 5);
const profileRoot = mkdtempSync(path.join(tmpdir(), "kith-space-p-a9-runtime-"));

process.env.NODE_ENV = "test";
process.env.KITH_SPACE_HOME = path.join(profileRoot, "app-data");
process.env.KITH_SPACE_SPACES_DIR = path.join(profileRoot, "spaces");
process.env.KITH_SPACE_LOG_LEVEL = "error";

const [{ AgentManager }, { createFakeRuntimeHarness }] = await Promise.all([
  import("../../src/daemon/agentManager.js"),
  import("../../src/daemon/testing/fakeRuntimeHarness.js"),
]);

interface BurstRound {
  totalStarts: number;
  peakActiveSessions: number;
  activeAfterStop: number;
  totalStops: number;
  totalExits: number;
  managerEvents: number;
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
      const manager = new AgentManager((event) => managerEvents.push(event), {
        runtimeStateRoot,
        binDir: path.join(profileRoot, "bin"),
        runtimeResolver: (runtime) => runtime === "fake" ? harness.runtime : null,
      });
      await Promise.all(Array.from({ length: agentCount }, (_, index) => {
        const agentId = `agent-${index + 1}`;
        return manager.start(agentId, {
          agentId,
          spaceId: `space-${agentCount}-${round + 1}`,
          workspaceRoot,
          name: agentId,
          displayName: `Agent ${index + 1}`,
          runtime: "fake",
          serverUrl: "http://127.0.0.1:7777",
          agentToken: `fake-token-${index + 1}`,
        });
      }));
      const peak = harness.snapshot();

      await manager.stopAllAndWait();
      const stopped = harness.snapshot();

      results[String(agentCount)]!.push({
        totalStarts: peak.totalStarts,
        peakActiveSessions: peak.peakActiveSessions,
        activeAfterStop: stopped.activeSessions,
        totalStops: stopped.totalStops,
        totalExits: stopped.totalExits,
        managerEvents: managerEvents.length,
      });
    }
  }

  process.stdout.write(`${JSON.stringify({
    benchmark: "P-A9.0 fake Runtime current-session fact smoke",
    generatedAt: new Date().toISOString(),
    configuration: { agentCounts, rounds },
    scope: {
      statement: "This harness records the current AgentManager/Runtime seam and burst trajectory only.",
      exclusions: [
        "It is a deterministic fact smoke, not a latency benchmark or SLO.",
        "It does not model a real CLI process or Worker admission.",
        "It does not assert a capacity limit, queue fairness, or overload behavior.",
      ],
    },
    summaries: Object.fromEntries(agentCounts.map((count) => {
      const countRounds = results[String(count)]!;
      return [String(count), {
        totalStarts: countRounds.map((round) => round.totalStarts),
        peakActiveSessions: countRounds.map((round) => round.peakActiveSessions),
        activeAfterStop: countRounds.map((round) => round.activeAfterStop),
        totalStops: countRounds.map((round) => round.totalStops),
        totalExits: countRounds.map((round) => round.totalExits),
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
