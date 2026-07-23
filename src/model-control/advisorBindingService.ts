import { appDataConnection } from "../app-data/appDatabase.js";
import { AdvisorProviderSettingsService } from "../advisor-provider/advisorProviderSettingsService.js";
import { piSdkCatalogDigest } from "../advisor-provider/piSdkCatalog.js";
import { ModelConfigurationService } from "./modelConfigurationService.js";
import { ModelProviderConnectionService } from "./modelProviderConnectionService.js";
import { ModelControlError } from "./contracts.js";

export class AdvisorBindingService {
  constructor(
    private readonly advisor = new AdvisorProviderSettingsService(),
    private readonly providers = new ModelProviderConnectionService(),
    private readonly configurations = new ModelConfigurationService(this.providers),
  ) {}

  summary() {
    const internal = this.advisor.summary();
    const latestRun = this.advisor.listRuns(1)[0] ?? null;
    const row = appDataConnection().prepare(`
      SELECT model_configuration_id, model_configuration_revision
      FROM advisor_provider_settings WHERE singleton_id = 1
    `).get() as { model_configuration_id: string | null; model_configuration_revision: number | null };
    const model = row.model_configuration_id && row.model_configuration_revision
      ? this.configurations.getRevision(row.model_configuration_id, row.model_configuration_revision)
      : null;
    const provider = model ? this.providers.getRevision(
      model.revision.providerConnectionId,
      model.revision.providerRevision,
    ) : null;
    return {
      enabled: internal.settings.enabled,
      state: internal.settings.state,
      executor: internal.provider ? {
        id: internal.provider.adapterId,
        label: internal.provider.adapterId === "pi_sdk" ? "内置 Pi SDK" : "Claude Code",
      } : null,
      modelConfiguration: model && provider ? {
        id: model.configuration.id, revision: row.model_configuration_revision,
        displayName: model.configuration.displayName, modelId: model.revision.modelId,
        providerDisplayName: provider.connection.displayName,
        destinationHost: new URL(provider.revision.canonicalOrigin).host,
      } : null,
      requiresAuthorization: internal.settings.state === "probing" || internal.settings.state === "setup_required",
      latestRun: latestRun ? {
        status: latestRun.status,
        createdAt: latestRun.createdAt.toISOString(),
        completedAt: latestRun.completedAt?.toISOString() ?? null,
        latencyMs: latestRun.latencyMs,
        errorCode: latestRun.errorCode,
        spaceName: latestRun.spaceName,
      } : null,
    };
  }

  async bindModelConfiguration(configurationId: string, revision?: number) {
    if (!this.advisor.summary().provider) {
      await this.advisor.selectProvider("pi_sdk");
    }
    const model = this.configurations.get(configurationId);
    if (model.configuration.status !== "active") {
      throw new ModelControlError("model_configuration_not_found");
    }
    const selectedRevision = revision ?? model.configuration.currentRevision;
    if (selectedRevision !== model.configuration.currentRevision) throw new Error("historical Advisor binding is not selectable");
    const provider = this.providers.getRevision(model.revision.providerConnectionId, model.revision.providerRevision);
    if (provider.connection.status !== "active") {
      throw new ModelControlError("model_provider_not_found");
    }
    const vendorVerified = provider.revision.dataPolicyProvenance === "vendor_verified";
    await this.advisor.createModelProfile({
      sourceKind: vendorVerified ? "bundled_catalog" : "manual",
      sourceSnapshotDigest: vendorVerified
        ? piSdkCatalogDigest()
        : `model-configuration:${configurationId}:${selectedRevision}`,
      descriptorTrust: vendorVerified ? "bundled_verified" : "manual",
      backendId: provider.revision.backendId, modelId: model.revision.modelId,
      apiKind: provider.revision.apiKind, thinkingLevel: (model.revision.reasoning as any) ?? "off",
      canonicalOrigin: provider.revision.canonicalOrigin,
      credentialSourceKind: provider.revision.credentialSourceKind,
      credentialIdentityDigest: provider.revision.credentialIdentityDigest,
      credentialRef: provider.revision.credentialRef, providerSchemaVersion: 1,
      dataPolicyRevision: provider.revision.dataPolicyRevision,
      dataPolicyProvenance: provider.revision.dataPolicyProvenance,
      networkClass: provider.revision.networkClass, allowedEgress: provider.revision.allowedEgress,
      modelMetadata: {
        contextWindow: model.revision.contextWindow, maxOutputTokens: model.revision.maxOutputTokens,
        inputCapabilities: model.revision.inputCapabilities, options: model.revision.options,
      },
      sourceModelConfigurationId: configurationId, sourceModelConfigurationRevision: selectedRevision,
    });
    appDataConnection().prepare(`
      UPDATE advisor_provider_settings
      SET model_configuration_id = ?, model_configuration_revision = ?, updated_at = ?
      WHERE singleton_id = 1
    `).run(configurationId, selectedRevision, Date.now());
    return this.summary();
  }

  async setExecutor(adapterId: "pi_sdk" | "claude_cli") {
    await this.advisor.selectProvider(adapterId);
    return this.summary();
  }

  async setEnabled(enabled: boolean) {
    await this.advisor.setEnabled(enabled);
    return this.summary();
  }
}
