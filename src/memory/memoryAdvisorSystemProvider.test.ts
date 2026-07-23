import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { AdvisorProviderSettingsService } from "../advisor-provider/advisorProviderSettingsService.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import type { AdvisorProviderRuntimePort, PreparedAdvisorRun } from "../runtime/contract/advisorProviderRuntimePort.js";
import type { MaintenanceJsonInput, MaintenanceJsonResult, MaintenanceRuntimePort } from "../runtime/contract/maintenanceRuntimePort.js";
import { enqueueMemoryAdvisorJobInTransaction, MemoryAdvisorService } from "./memoryAdvisorService.js";
import { appDataConnection } from "../app-data/appDatabase.js";

class NoLegacyRuntime implements MaintenanceRuntimePort {
  support() { return { toolIsolation: "unsupported" as const }; }
  async completeJson(_input: MaintenanceJsonInput): Promise<never> { throw new Error("legacy runtime must not be called"); }
}

class FakeSystemProvider implements AdvisorProviderRuntimePort {
  readonly prepared: PreparedAdvisorRun[] = [];
  readonly prompts: string[] = [];
  private deferred: { entered: () => void; released: Promise<void> } | null = null;
  deferNext() {
    let entered!: () => void; let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.deferred = { entered, released };
    return { entered: enteredPromise, release };
  }
  async prepare(snapshot: PreparedAdvisorRun["snapshot"], config: PreparedAdvisorRun["config"]): Promise<PreparedAdvisorRun> {
    const item: PreparedAdvisorRun = {
      runId: randomUUID(), localHandle: randomUUID(), workerGeneration: 7, snapshot, config,
      preflight: { canonicalOrigin: config.canonicalOrigin, proxy: "none", networkClass: config.networkClass,
        resolvedAddressDigest: "a".repeat(64), redirectPolicy: "reject", allEgress: [...config.allowedEgress].sort() },
    };
    this.prepared.push(item);
    return item;
  }
  async complete(input: PreparedAdvisorRun, prompt: string, credentialHandle: string): Promise<MaintenanceJsonResult> {
    assert.match(credentialHandle, /^[0-9a-f-]{36}$/);
    this.prompts.push(prompt);
    const deferred = this.deferred; this.deferred = null;
    if (deferred) { deferred.entered(); await deferred.released; }
    const messageId = /"sourceId":"([^"]+)"/.exec(prompt)?.[1];
    assert.ok(messageId);
    return { output: { schemaVersion: 1, candidates: [{
      scope: "agent_private" as const, kind: "preference" as const, subjectRef: { kind: "human" as const, id: "human-1" },
      subjectKey: "human", predicateKey: "report_style", canonicalText: "Human prefers concise weekly reports",
      internalSummary: "Concise reports", shareableSummary: "Prefers concise reports", sensitivity: "normal" as const,
      disclosure: "shareable_summary" as const, confidence: 0.9, importance: 0.8, tags: ["reports"], evidenceSourceIds: [messageId],
    }] }, usage: { inputTokens: 4, outputTokens: 3, source: "final" as const } };
  }
  async cancel(): Promise<void> {}
}

test("Claude, Codex, and opencode chat Agents share one consented system Provider without their chat runtime invoking Advisor", async () => {
  const spaceId = randomUUID();
  const channelId = randomUUID();
  const humanId = randomUUID();
  registerSpace({ id: spaceId, name: "System Advisor", slug: `system-advisor-${spaceId}`,
    rootPath: path.join(kithSpaceHome(), "system-advisor", spaceId) });
  const db = dbForSpace(spaceId);
  appDataConnection().prepare(`UPDATE advisor_provider_settings SET execution_mode = 'provider_v1', provider_state = 'setup_required',
    current_provider_revision = 1, current_model_profile_revision = NULL, updated_at = ? WHERE singleton_id = 1`).run(Date.now());
  const provider = new AdvisorProviderSettingsService();
  try {
    assert.equal(provider.summary().settings.executionMode, "provider_v1");
    await provider.createModelProfile({
      sourceKind: "manual", sourceSnapshotDigest: "anthropic-v1", descriptorTrust: "manual", backendId: "anthropic",
      modelId: "claude-haiku-4-5", apiKind: "anthropic-messages", thinkingLevel: "off",
      canonicalOrigin: "https://api.anthropic.com", credentialSourceKind: "kith_secret", credentialValue: "test-only-not-real", providerSchemaVersion: 1,
      dataPolicyRevision: "human-reviewed-v1", dataPolicyProvenance: "human_asserted", networkClass: "public_cloud",
      allowedEgress: ["https://api.anthropic.com"], modelMetadata: { supportedThinking: ["off"] },
    });
    provider.recordProbe(true);
    db.insert(schema.channels).values({ id: channelId, spaceId, name: "shared", type: "public" }).run();
    let seq = 0;
    const fake = new FakeSystemProvider();
    const agents: Array<{ agentId: string; sessionId: string }> = [];
    for (const runtime of ["claude", "codex", "opencode"] as const) {
      const agentId = randomUUID(); const sessionId = randomUUID(); const messageId = randomUUID(); const turnId = randomUUID();
      db.insert(schema.agents).values({ id: agentId, spaceId, name: `${runtime}-${agentId.slice(0, 6)}`, displayName: runtime, runtime, status: "active" }).run();
      db.insert(schema.channelAgentMembers).values({ channelId, agentId }).run();
      db.insert(schema.runtimeSessions).values({ id: sessionId, spaceId, agentId, surfaceKind: "channel", surfaceId: channelId,
        sessionGeneration: 1, runtime, runtimeConfigFingerprint: runtime, adapterVersion: "test", workspaceRootFingerprint: "root", status: "idle" }).run();
      db.insert(schema.messages).values({ id: messageId, seq: ++seq, spaceId, channelId, senderType: "human", senderId: humanId,
        senderName: "Human", content: `请记住 ${runtime} 对应的周报偏好`, memoryPolicy: "eligible" }).run();
      db.insert(schema.agentTurns).values({ id: turnId, runtimeSessionId: sessionId, sessionGeneration: 1, spaceId, agentId,
        status: "completed", outcome: "ceded", effectiveDirective: "optional", completedAt: new Date() }).run();
      db.insert(schema.agentDeliveryItems).values({ id: randomUUID(), spaceId, agentId, messageId, sourceChannelId: channelId,
        sourceSeq: seq, cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId,
        targetRuntimeSessionId: sessionId, directive: "optional", reason: "test", policySnapshot: {}, disposition: "ceded", turnId, settledAt: new Date() }).run();
      provider.consentAgent(spaceId, agentId, humanId, { public: true, private: false, dm: false });
      agents.push({ agentId, sessionId });
      assert.equal(db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, spaceId, turnId)), true);
      assert.deepEqual(await new MemoryAdvisorService(spaceId, db, new NoLegacyRuntime(), Date.now, fake, provider).processDue(), { processed: 1, created: 1 });
      const outbound = fake.prompts.at(-1)!;
      for (const localId of [spaceId, channelId, agentId, messageId, humanId]) assert.equal(outbound.includes(localId), false);
    }
    assert.equal(fake.prepared.length, 3);
    assert.ok(fake.prepared.every((item) => item.snapshot.adapterId === "pi_sdk"));
    assert.equal(db.select().from(schema.advisorProviderRuns).all().length, 3);
    assert.equal(db.select().from(schema.episodicMemories).all().length, 3);

    const target = agents[0]!; const lateMessageId = randomUUID(); const lateTurnId = randomUUID();
    db.insert(schema.messages).values({ id: lateMessageId, seq: ++seq, spaceId, channelId, senderType: "human", senderId: humanId,
      senderName: "Human", content: "这条偏好在外发后撤回授权", memoryPolicy: "eligible" }).run();
    db.insert(schema.agentTurns).values({ id: lateTurnId, runtimeSessionId: target.sessionId, sessionGeneration: 1, spaceId,
      agentId: target.agentId, status: "completed", outcome: "ceded", effectiveDirective: "optional", completedAt: new Date() }).run();
    db.insert(schema.agentDeliveryItems).values({ id: randomUUID(), spaceId, agentId: target.agentId, messageId: lateMessageId,
      sourceChannelId: channelId, sourceSeq: seq, cursorOwnerChannelId: channelId, targetSurfaceKind: "channel", targetSurfaceId: channelId,
      targetRuntimeSessionId: target.sessionId, directive: "optional", reason: "test", policySnapshot: {}, disposition: "ceded",
      turnId: lateTurnId, settledAt: new Date() }).run();
    assert.equal(db.transaction((tx) => enqueueMemoryAdvisorJobInTransaction(tx, spaceId, lateTurnId)), true);
    const gate = fake.deferNext();
    const late = new MemoryAdvisorService(spaceId, db, new NoLegacyRuntime(), Date.now, fake, provider).processDue();
    await gate.entered;
    await provider.revokeAgent(spaceId, target.agentId);
    gate.release();
    assert.deepEqual(await late, { processed: 1, created: 0 });
    assert.equal(db.select().from(schema.episodicMemories).all().length, 3, "late result cannot commit after consent revocation");
    const lateJob = db.select().from(schema.memoryAdvisorJobs).where(eq(schema.memoryAdvisorJobs.sourceTurnId, lateTurnId)).get()!;
    assert.equal(lateJob.status, "cancelled");
    assert.equal(db.select().from(schema.advisorProviderRuns).where(eq(schema.advisorProviderRuns.id, lateJob.providerRunId!)).get()!.status, "cancelled");
  } finally {
    appDataConnection().prepare(`UPDATE advisor_provider_settings SET execution_mode = 'legacy_runtime', provider_state = 'setup_required',
      current_provider_revision = NULL, current_model_profile_revision = NULL, updated_at = ? WHERE singleton_id = 1`).run(Date.now());
    closeSpaceDb(spaceId); unregisterSpace(spaceId);
  }
});
