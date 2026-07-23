import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { providerCredentialPort } from "../advisor-provider/credentialPort.js";
import { preflightEgress } from "../advisor-provider/egressPreflight.js";
import { dbForSpace } from "../db/index.js";
import * as schema from "../db/schema.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";
import { configurationFingerprint, type RuntimeConfigurationInput } from "../runtime/config/runtimeConfigCompiler.js";
import { ModelConfigurationService } from "./modelConfigurationService.js";
import { ModelControlError } from "./contracts.js";
import { ModelProviderConnectionService } from "./modelProviderConnectionService.js";
import { RuntimeProfileService } from "./runtimeProfileService.js";
import { appDataConnection } from "../app-data/appDatabase.js";

export interface RuntimeCredentialBinding {
  activationId: string;
  runtimeSessionId: string;
  sessionGeneration: number;
  workerGeneration: number;
  runtimeId: RuntimeId;
  providerRevision: number;
  modelConfigurationRevision: number;
  runtimeProfileRevision: number;
  runtimeConfigurationEpoch: number;
  effectiveConfigDigest: string;
  expiresAt: string;
}

export interface ManagedRuntimeConfigurationActivation {
  input: Omit<RuntimeConfigurationInput, "runtimeStateDir">;
  credentialHandle: string;
  binding: RuntimeCredentialBinding;
}

const COMPILER_POLICY_VERSION = 1;
const COMPILER_POLICY_DIGEST = createHash("sha256")
  .update("kith-runtime-config-compiler-policy-v1")
  .digest("hex");

export class RuntimeConfigurationActivationService {
  revoke(credentialHandle: string): boolean {
    return providerCredentialPort.revoke(credentialHandle);
  }

  async issue(input: {
    spaceId: string;
    agentId: string;
    runtimeSessionId: string;
    sessionGeneration: number;
    workerGeneration: number;
    runtimeConfigurationEpoch: number;
  }): Promise<ManagedRuntimeConfigurationActivation | null> {
    const agent = dbForSpace(input.spaceId).select().from(schema.agents)
      .where(eq(schema.agents.id, input.agentId)).get();
    if (!agent || agent.modelBindingState !== "ready" || !agent.modelBindingMode) return null;
    const installationIdentityDigest = String(appDataConnection().prepare(`
      SELECT installation_identity_digest FROM advisor_provider_settings WHERE singleton_id = 1
    `).pluck().get());
    if (agent.confirmedInstallationIdentityDigest !== installationIdentityDigest) {
      throw new ModelControlError("runtime_configuration_stale", "installation confirmation changed");
    }
    const runtimeId = agent.runtime as RuntimeId;
    const profiles = new RuntimeProfileService();
    const profile = profiles.get(runtimeId);
    if (profile.defaultBinding.mode === "unmanaged_cli_native" && agent.modelBindingMode === "runtime_default") return null;

    const configurationId = agent.modelBindingMode === "pinned"
      ? agent.modelConfigurationId
      : profile.defaultBinding.modelConfigurationId;
    const expectedRevision = agent.modelBindingMode === "pinned"
      ? agent.modelConfigurationRevision
      : profile.defaultBinding.modelConfigurationRevision;
    if (!configurationId || !expectedRevision) throw new ModelControlError("invalid_runtime_default_binding");
    const configuration = new ModelConfigurationService().getRevision(configurationId, expectedRevision);
    const provider = new ModelProviderConnectionService().getRevision(
      configuration.revision.providerConnectionId,
      configuration.revision.providerRevision,
    );
    await preflightEgress({
      canonicalOrigin: provider.revision.canonicalOrigin,
      networkClass: provider.revision.networkClass,
      allowedEgress: [...provider.revision.allowedEgress],
    });
    const runtimeInput: Omit<RuntimeConfigurationInput, "runtimeStateDir"> = {
      runtimeId,
      runtimeVersion: null,
      modelId: configuration.revision.modelId,
      reasoning: configuration.revision.reasoning,
      apiKind: provider.revision.apiKind,
      canonicalOrigin: provider.revision.canonicalOrigin,
      networkClass: provider.revision.networkClass,
      backendId: provider.revision.backendId,
      providerOptions: configuration.revision.options,
      compilerPolicyVersion: COMPILER_POLICY_VERSION,
      compilerPolicyDigest: COMPILER_POLICY_DIGEST,
    };
    const effectiveConfigDigest = configurationFingerprint(
      { ...runtimeInput, runtimeStateDir: "" },
      provider.revision.credentialIdentityDigest,
    );
    const expiresAtMs = Date.now() + 120_000;
    const activationId = providerCredentialPort.issue({
      audience: "chat_runtime",
      credentialRef: provider.revision.credentialRef,
      credentialSourceKind: provider.revision.credentialSourceKind,
      runId: input.runtimeSessionId,
      providerEpoch: input.runtimeConfigurationEpoch,
      workerGeneration: input.workerGeneration,
      executionSnapshotDigest: effectiveConfigDigest,
      expiresAt: expiresAtMs,
      backendId: provider.revision.backendId,
      apiKind: provider.revision.apiKind,
      expectedCredentialIdentityDigest: provider.revision.credentialIdentityDigest,
    });
    return {
      input: runtimeInput,
      credentialHandle: activationId,
      binding: {
        activationId,
        runtimeSessionId: input.runtimeSessionId,
        sessionGeneration: input.sessionGeneration,
        workerGeneration: input.workerGeneration,
        runtimeId,
        providerRevision: provider.revision.revision,
        modelConfigurationRevision: configuration.revision.revision,
        runtimeProfileRevision: profile.currentRevision,
        runtimeConfigurationEpoch: input.runtimeConfigurationEpoch,
        effectiveConfigDigest,
        expiresAt: new Date(expiresAtMs).toISOString(),
      },
    };
  }
}
