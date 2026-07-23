import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { CompiledAdvisorModelConfig, ProviderExecutionSnapshot } from "../../../advisor-provider/contracts.js";
import { AdvisorRunController } from "./advisorRunController.js";

function fixture(t: test.TestContext) {
  const root = path.join(os.tmpdir(), `kith-advisor-controller-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  const helper = path.join(root, "helper.mjs");
  const bytes = Buffer.from("process.exit(0)\n");
  writeFileSync(helper, bytes, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { backendId: "deepseek", modelId: "model", apiKind: "openai-completions", thinkingLevel: "off",
    canonicalOrigin: "https://api.deepseek.com", networkClass: "public_cloud", allowedEgress: ["https://api.deepseek.com"],
    credentialSlot: "kith_secret", providerFactoryId: "deepseek", providerSchemaVersion: 1, options: {} } as CompiledAdvisorModelConfig;
  const snapshot = { adapterId: "pi_sdk", adapterVersion: "0.81.1", backendId: config.backendId, modelId: config.modelId,
    apiKind: config.apiKind, thinkingLevel: config.thinkingLevel, canonicalOrigin: config.canonicalOrigin,
    networkClass: config.networkClass, providerSchemaVersion: 1, allowedEgress: config.allowedEgress,
    sanitizedConfig: { credentialSourceKind: "kith_secret" }, executionSnapshotDigest: "snapshot",
    executableOrPackageDigest: createHash("sha256").update(bytes).digest("hex") } as unknown as ProviderExecutionSnapshot;
  const plan = { canonicalOrigin: config.canonicalOrigin, proxy: "none" as const, networkClass: "public_cloud" as const,
    resolvedAddressDigest: "a".repeat(64), redirectPolicy: "reject" as const, allEgress: [config.canonicalOrigin] };
  return { helper, config, snapshot, plan };
}

test("Advisor Worker reserves its only slot before asynchronous preflight", async (t) => {
  const f = fixture(t);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const controller = new AdvisorRunController({ resolvePiAdvisorHelper: () => f.helper,
    prepareEgressLease: async () => { await barrier; return { plan: f.plan, pinnedAddresses: ["203.0.113.7"] }; } });
  const first = controller.prepare({ runId: "run-1", snapshot: f.snapshot, config: f.config });
  await assert.rejects(controller.prepare({ runId: "run-2", snapshot: f.snapshot, config: f.config }), /provider_busy/);
  release();
  const prepared = await first;
  await controller.cancel("run-1");
  assert.equal((controller as any).prepared.size, 0);
  assert.equal(typeof prepared.localHandle, "string");
});

test("Advisor Worker removes verified artifacts when a prepared handle expires", async (t) => {
  const f = fixture(t);
  const controller = new AdvisorRunController({ resolvePiAdvisorHelper: () => f.helper,
    prepareEgressLease: async () => ({ plan: f.plan, pinnedAddresses: ["203.0.113.7"] }) });
  const prepared = await controller.prepare({ runId: "run-1", snapshot: f.snapshot, config: f.config });
  const stored = (controller as any).prepared.get(prepared.localHandle);
  const artifactRoot = stored.verifiedArtifactRoot as string;
  stored.expiresAt = 0;
  await assert.rejects(controller.complete({ localHandle: prepared.localHandle, runId: "run-1", snapshotDigest: "snapshot",
    prompt: "safe", credential: { type: "none", value: null } }), /provider_revision_changed/);
  assert.equal(existsSync(artifactRoot), false);
});

test("Worker shutdown fences an in-flight prepare before a new Core generation", async (t) => {
  const f = fixture(t);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const controller = new AdvisorRunController({ resolvePiAdvisorHelper: () => f.helper,
    prepareEgressLease: async () => { await barrier; return { plan: f.plan, pinnedAddresses: ["203.0.113.7"] }; } });
  const preparing = controller.prepare({ runId: "stale-run", snapshot: f.snapshot, config: f.config });
  const shutdown = controller.shutdown();
  release();
  await assert.rejects(preparing, /provider_cancelled/);
  await shutdown;
  assert.equal((controller as any).prepared.size, 0);
  assert.equal((controller as any).active.size, 0);
});
