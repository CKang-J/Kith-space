import { createHash } from "node:crypto";
import { appDataConnection } from "../app-data/appDatabase.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";
import { ModelControlError } from "./contracts.js";
import { ModelConfigurationService } from "./modelConfigurationService.js";
import { ModelProviderConnectionService } from "./modelProviderConnectionService.js";
import { RuntimeProfileService } from "./runtimeProfileService.js";

export type AgentModelBindingInput =
  | { mode: "runtime_default" }
  | { mode: "pinned"; modelConfigurationId: string; modelConfigurationRevision: number };

export class AgentModelBindingService {
  constructor(
    private readonly providers = new ModelProviderConnectionService(),
    private readonly configurations = new ModelConfigurationService(this.providers),
    private readonly runtimes = new RuntimeProfileService(this.configurations),
  ) {}

  resolve(runtimeId: RuntimeId, binding: AgentModelBindingInput) {
    const requestedMode = binding.mode;
    const installationIdentityDigest = String(appDataConnection().prepare(`
      SELECT installation_identity_digest FROM advisor_provider_settings WHERE singleton_id = 1
    `).pluck().get());
    if (binding.mode === "runtime_default") {
      const profile = this.runtimes.get(runtimeId);
      if (profile.defaultBinding.mode === "unset") return {
        modelBindingMode: "runtime_default" as const, modelConfigurationId: null, modelConfigurationRevision: null,
        modelBindingLabelSnapshot: "未配置", modelBindingFingerprint: null, confirmedEffectiveProviderSnapshot: null,
        confirmedInstallationIdentityDigest: installationIdentityDigest, modelBindingState: "setup_required" as const,
        runtimeRestartRequired: false, model: null,
      };
      if (profile.defaultBinding.mode === "unmanaged_cli_native") {
        const fingerprint = createHash("sha256").update(JSON.stringify({
          runtimeId, mode: "unmanaged_cli_native", runtimeProfileRevision: profile.currentRevision,
        })).digest("hex");
        return {
          modelBindingMode: "runtime_default" as const, modelConfigurationId: null, modelConfigurationRevision: null,
          modelBindingLabelSnapshot: "CLI 自有账户/默认供应商", modelBindingFingerprint: fingerprint,
          confirmedEffectiveProviderSnapshot: { mode: "unmanaged_cli_native", auditability: "limited" },
          confirmedInstallationIdentityDigest: installationIdentityDigest, modelBindingState: "ready" as const,
          runtimeRestartRequired: false, model: null,
        };
      }
      binding = {
        mode: "pinned",
        modelConfigurationId: profile.defaultBinding.modelConfigurationId!,
        modelConfigurationRevision: profile.defaultBinding.modelConfigurationRevision!,
      };
    }
    const model = this.configurations.get(binding.modelConfigurationId);
    const revision = binding.modelConfigurationRevision === model.configuration.currentRevision
      ? model.revision
      : this.historicalRevision(binding.modelConfigurationId, binding.modelConfigurationRevision);
    const compatibility = revision.runtimeCompatibilitySnapshot[runtimeId];
    if (!compatibility?.supported) throw new ModelControlError("model_configuration_incompatible", compatibility?.reason);
    const provider = this.providers.getRevision(revision.providerConnectionId, revision.providerRevision);
    const fingerprint = createHash("sha256").update(JSON.stringify({
      runtimeId, configurationId: binding.modelConfigurationId, configurationRevision: binding.modelConfigurationRevision,
      providerId: revision.providerConnectionId, providerRevision: revision.providerRevision,
      modelId: revision.modelId, credentialIdentityDigest: provider.revision.credentialIdentityDigest,
    })).digest("hex");
    return {
      modelBindingMode: requestedMode === "pinned" ? "pinned" as const : "runtime_default" as const,
      modelConfigurationId: requestedMode === "pinned" ? binding.modelConfigurationId : null,
      modelConfigurationRevision: requestedMode === "pinned" ? binding.modelConfigurationRevision : null,
      modelBindingLabelSnapshot: model.configuration.displayName, modelBindingFingerprint: fingerprint,
      confirmedEffectiveProviderSnapshot: {
        providerConnectionId: provider.connection.id, providerDisplayName: provider.connection.displayName,
        modelConfigurationId: model.configuration.id, modelDisplayName: model.configuration.displayName,
        modelId: revision.modelId, destinationHost: new URL(provider.revision.canonicalOrigin).host,
        networkClass: provider.revision.networkClass,
      },
      confirmedInstallationIdentityDigest: installationIdentityDigest, modelBindingState: "ready" as const,
      runtimeRestartRequired: false, model: revision.modelId,
    };
  }

  private historicalRevision(configurationId: string, revision: number) {
    const row = appDataConnection().prepare(`
      SELECT * FROM model_configuration_revisions WHERE configuration_id = ? AND revision = ?
    `).get(configurationId, revision) as any;
    if (!row) throw new ModelControlError("model_configuration_not_found");
    return {
      configurationId, revision, providerConnectionId: row.provider_connection_id, providerRevision: row.provider_revision,
      modelId: row.model_id, reasoning: row.reasoning, contextWindow: row.context_window,
      maxOutputTokens: row.max_output_tokens, inputCapabilities: JSON.parse(row.input_capabilities_json),
      runtimeCompatibilitySnapshot: JSON.parse(row.runtime_compatibility_snapshot_json),
      options: JSON.parse(row.options_json), createdAt: row.created_at,
    };
  }
}
