import { appDataConnection } from "../app-data/appDatabase.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";
import { assertRuntimeDefaultBinding, ModelControlError, type RuntimeDefaultBinding } from "./contracts.js";
import { ModelConfigurationService } from "./modelConfigurationService.js";
import { withRuntimeConfigurationChange } from "./runtimeConfigurationChange.js";
import { markAgentsForRuntimeConfigurationChange } from "./runtimeConfigurationImpact.js";

export interface RuntimeProfileUpdate {
  enabled: boolean;
  defaultBinding: RuntimeDefaultBinding;
  executablePreference?: string | null;
  runtimeOptions?: Readonly<Record<string, unknown>>;
}

export class RuntimeProfileService {
  constructor(private readonly configurations = new ModelConfigurationService()) {}

  list() {
    return (appDataConnection().prepare("SELECT runtime_id FROM runtime_profiles ORDER BY runtime_id").all() as Array<{ runtime_id: RuntimeId }>)
      .map(({ runtime_id }) => this.get(runtime_id));
  }

  get(runtimeId: RuntimeId) {
    const sqlite = appDataConnection();
    const row = sqlite.prepare("SELECT * FROM runtime_profiles WHERE runtime_id = ?").get(runtimeId) as any;
    if (!row) throw new ModelControlError("runtime_profile_not_found");
    const revision = sqlite.prepare(`
      SELECT * FROM runtime_profile_revisions WHERE runtime_id = ? AND revision = ?
    `).get(runtimeId, row.current_revision) as any;
    const probe = sqlite.prepare("SELECT * FROM runtime_probe_cache WHERE runtime_id = ?").get(runtimeId) as any;
    return {
      runtimeId,
      enabled: Boolean(row.enabled),
      defaultBinding: {
        mode: row.default_binding_mode,
        modelConfigurationId: row.default_model_configuration_id,
        modelConfigurationRevision: row.default_model_configuration_revision,
      } as RuntimeDefaultBinding,
      currentRevision: row.current_revision,
      executablePreference: revision.executable_preference,
      runtimeOptions: JSON.parse(revision.runtime_options_json),
      updatedAt: row.updated_at,
      probe: probe ? {
        status: probe.status, observedVersion: probe.observed_version,
        diagnostics: JSON.parse(probe.diagnostics_json), probedAt: probe.probed_at, expiresAt: probe.expires_at,
      } : null,
    };
  }

  async update(runtimeId: RuntimeId, input: RuntimeProfileUpdate) {
    const binding = assertRuntimeDefaultBinding(input.defaultBinding);
    if (binding.mode === "kith_model_configuration") {
      const configuration = this.configurations.getRevision(
        binding.modelConfigurationId!,
        binding.modelConfigurationRevision!,
      );
      if (configuration.configuration.status !== "active") {
        throw new ModelControlError("model_configuration_not_found");
      }
      const compatibility = configuration.revision.runtimeCompatibilitySnapshot[runtimeId];
      if (!compatibility?.supported) {
        throw new ModelControlError("model_configuration_incompatible", compatibility?.reason);
      }
    }
    const sqlite = appDataConnection();
    const result = await withRuntimeConfigurationChange(() => sqlite.transaction(() => {
      const row = sqlite.prepare("SELECT current_revision FROM runtime_profiles WHERE runtime_id = ?").get(runtimeId) as any;
      if (!row) throw new ModelControlError("runtime_profile_not_found");
      const revision = row.current_revision + 1;
      const now = Date.now();
      sqlite.prepare(`
        INSERT INTO runtime_profile_revisions (
          runtime_id, revision, executable_preference, runtime_options_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(runtimeId, revision, input.executablePreference ?? null, JSON.stringify(input.runtimeOptions ?? {}),
        now);
      sqlite.prepare(`
        UPDATE runtime_profiles SET enabled = ?, default_binding_mode = ?,
          default_model_configuration_id = ?, default_model_configuration_revision = ?,
          current_revision = ?, updated_at = ? WHERE runtime_id = ?
      `).run(input.enabled ? 1 : 0, binding.mode, binding.modelConfigurationId,
        binding.modelConfigurationRevision, revision, now, runtimeId);
      sqlite.prepare(`
        UPDATE installation_state SET runtime_configuration_epoch = runtime_configuration_epoch + 1
        WHERE singleton_key = 1
      `).run();
      return this.get(runtimeId);
    }).immediate());
    markAgentsForRuntimeConfigurationChange({ runtimeIds: [runtimeId] });
    return result;
  }

  runtimeConfigurationEpoch(): number {
    return Number(appDataConnection().prepare(`
      SELECT runtime_configuration_epoch FROM installation_state WHERE singleton_key = 1
    `).pluck().get());
  }
}
