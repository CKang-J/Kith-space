import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { preflightEgress, prepareEgressLease } from "../../../advisor-provider/egressPreflight.js";
import { advisorProviderDescriptor } from "../../../advisor-provider/providerRegistry.js";
import { resolveExecutable, sha256File } from "../../../advisor-provider/providerArtifact.js";
import type { CompiledAdvisorModelConfig, ProviderExecutionSnapshot, ResolvedEgressPlan } from "../../../advisor-provider/contracts.js";
import type { MaintenanceJsonResult } from "../../contract/maintenanceRuntimePort.js";
import type { ActivatedAdvisorCredential } from "../../contract/advisorProviderRuntimePort.js";
import { completeClaudeMaintenanceJson } from "./claudeMaintenanceRuntime.js";
import { completePiAdvisor, resolvePiAdvisorHelper } from "./piSdkAdvisorProvider.js";

type Prepared = {
  runId: string;
  snapshotDigest: string;
  snapshot: ProviderExecutionSnapshot;
  config: CompiledAdvisorModelConfig;
  preflight: ResolvedEgressPlan;
  pinnedAddresses: string[];
  expiresAt: number;
  verifiedArtifactPath?: string;
  verifiedArtifactRoot?: string;
};

type ActiveRun = { abort: AbortController; done: Promise<unknown> };

export class AdvisorRunController {
  private readonly prepared = new Map<string, Prepared>();
  private readonly active = new Map<string, ActiveRun>();
  private preparing = false;
  private lifecycleGeneration = 0;
  private preparationDone: Promise<void> | null = null;
  private settlePreparation: (() => void) | null = null;

  constructor(private readonly dependencies: {
    prepareEgressLease?: typeof prepareEgressLease;
    resolvePiAdvisorHelper?: typeof resolvePiAdvisorHelper;
  } = {}) {}

  async prepare(input: { runId: string; snapshot: ProviderExecutionSnapshot; config: CompiledAdvisorModelConfig }): Promise<{ localHandle: string; preflight: ResolvedEgressPlan }> {
    if (this.preparing || this.active.size + this.prepared.size >= 1) throw new Error("provider_busy");
    this.preparing = true;
    const lifecycleGeneration = this.lifecycleGeneration;
    this.preparationDone = new Promise<void>((resolve) => { this.settlePreparation = resolve; });
    let verifiedArtifactRoot: string | undefined;
    try {
    if (input.config.backendId !== input.snapshot.backendId || input.config.modelId !== input.snapshot.modelId
      || input.config.apiKind !== input.snapshot.apiKind || input.config.thinkingLevel !== input.snapshot.thinkingLevel
      || input.config.canonicalOrigin !== input.snapshot.canonicalOrigin || input.config.networkClass !== input.snapshot.networkClass
      || input.config.providerSchemaVersion !== input.snapshot.providerSchemaVersion
      || input.config.credentialSlot !== input.snapshot.sanitizedConfig.credentialSourceKind
      || JSON.stringify([...input.config.allowedEgress].sort()) !== JSON.stringify([...input.snapshot.allowedEgress].sort())) {
      throw new Error("provider_revision_changed");
    }
    const descriptor = advisorProviderDescriptor(input.snapshot.adapterId);
    if (descriptor.adapterVersion !== input.snapshot.adapterVersion) throw new Error("provider_revision_changed");
    let verifiedArtifactPath: string | undefined;
    if (input.snapshot.adapterId === "pi_sdk") {
      const helper = (this.dependencies.resolvePiAdvisorHelper ?? resolvePiAdvisorHelper)();
      let fd: number | undefined;
      try {
        fd = openSync(helper, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const before = fstatSync(fd);
        if (!before.isFile() || (typeof process.getuid === "function" && before.uid !== process.getuid()) || (before.mode & 0o022) !== 0) throw new Error("provider_unavailable");
        const bytes = readFileSync(fd);
        const after = fstatSync(fd);
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
          || createHash("sha256").update(bytes).digest("hex") !== input.snapshot.executableOrPackageDigest) throw new Error("provider_revision_changed");
        verifiedArtifactRoot = mkdtempSync(path.join(os.tmpdir(), "kith-advisor-artifact-"));
        verifiedArtifactPath = path.join(verifiedArtifactRoot, "pi-advisor-helper.mjs");
        writeFileSync(verifiedArtifactPath, bytes, { flag: "wx", mode: 0o700 });
      } finally { if (fd !== undefined) closeSync(fd); }
    } else {
      const executable = resolveExecutable("claude");
      if (!executable || sha256File(executable) !== input.snapshot.executableOrPackageDigest) throw new Error("provider_revision_changed");
      verifiedArtifactPath = executable;
    }
    const lease = await (this.dependencies.prepareEgressLease ?? prepareEgressLease)({
        canonicalOrigin: input.config.canonicalOrigin,
        networkClass: input.config.networkClass,
        allowedEgress: input.config.allowedEgress,
      });
    if (lifecycleGeneration !== this.lifecycleGeneration) throw new Error("provider_cancelled");
    const localHandle = randomUUID();
    this.prepared.set(localHandle, {
      runId: input.runId,
      snapshotDigest: input.snapshot.executionSnapshotDigest,
      snapshot: input.snapshot,
      config: input.config,
      preflight: lease.plan,
      pinnedAddresses: lease.pinnedAddresses,
      expiresAt: Date.now() + 30_000,
      ...(verifiedArtifactPath ? { verifiedArtifactPath, verifiedArtifactRoot } : {}),
    });
    verifiedArtifactRoot = undefined;
    return { localHandle, preflight: lease.plan };
    } finally {
      this.preparing = false;
      this.settlePreparation?.();
      this.settlePreparation = null;
      this.preparationDone = null;
      if (verifiedArtifactRoot) rmSync(verifiedArtifactRoot, { recursive: true, force: true });
    }
  }

  async complete(input: { localHandle: string; runId: string; snapshotDigest: string; prompt: string; credential: ActivatedAdvisorCredential }): Promise<MaintenanceJsonResult & { postflight: ResolvedEgressPlan }> {
    const prepared = this.prepared.get(input.localHandle);
    this.prepared.delete(input.localHandle);
    if (!prepared) throw new Error("provider_revision_changed");
    if (prepared.expiresAt <= Date.now() || prepared.runId !== input.runId || prepared.snapshotDigest !== input.snapshotDigest) {
      if (prepared.verifiedArtifactRoot) rmSync(prepared.verifiedArtifactRoot, { recursive: true, force: true });
      throw new Error("provider_revision_changed");
    }
    if (this.active.size >= 1) {
      if (prepared.verifiedArtifactRoot) rmSync(prepared.verifiedArtifactRoot, { recursive: true, force: true });
      throw new Error("provider_busy");
    }
    const abort = new AbortController();
    let settle!: () => void;
    const done = new Promise<void>((resolve) => { settle = resolve; });
    this.active.set(input.runId, { abort, done });
    try {
      const result = prepared.snapshot.adapterId === "pi_sdk"
        ? await completePiAdvisor({ config: prepared.config, credential: input.credential, prompt: input.prompt,
          helperPath: prepared.verifiedArtifactPath,
          pinnedAddresses: prepared.pinnedAddresses, signal: abort.signal })
        : await completeClaudeMaintenanceJson({ prompt: input.prompt, model: prepared.config.modelId, credential: input.credential,
          canonicalOrigin: prepared.config.canonicalOrigin, pinnedAddresses: prepared.pinnedAddresses,
          executablePath: prepared.verifiedArtifactPath, executableDigest: prepared.snapshot.executableOrPackageDigest, signal: abort.signal });
      const postflight = await preflightEgress({
        canonicalOrigin: prepared.config.canonicalOrigin,
        networkClass: prepared.config.networkClass,
        allowedEgress: prepared.config.allowedEgress,
      });
      if (JSON.stringify(postflight) !== JSON.stringify(prepared.preflight)) throw new Error("provider_postflight_destination_mismatch");
      return { ...result, postflight };
    } finally {
      this.active.delete(input.runId);
      if (prepared.verifiedArtifactRoot) rmSync(prepared.verifiedArtifactRoot, { recursive: true, force: true });
      settle();
    }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.active.get(runId);
    active?.abort.abort();
    for (const [handle, item] of this.prepared) if (item.runId === runId) {
      this.prepared.delete(handle);
      if (item.verifiedArtifactRoot) rmSync(item.verifiedArtifactRoot, { recursive: true, force: true });
    }
    if (active) await active.done;
  }

  async shutdown(): Promise<void> {
    this.lifecycleGeneration += 1;
    const active = [...this.active.values()];
    for (const run of active) run.abort.abort();
    await Promise.allSettled([...(this.preparationDone ? [this.preparationDone] : []), ...active.map((run) => run.done)]);
    for (const item of this.prepared.values()) if (item.verifiedArtifactRoot) rmSync(item.verifiedArtifactRoot, { recursive: true, force: true });
    this.prepared.clear();
  }
}
