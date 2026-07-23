import { randomUUID } from "node:crypto";
import { appDataConnection } from "../app-data/appDatabase.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";
import { ModelControlError, type ModelConfigurationRevision, type RuntimeCompatibility } from "./contracts.js";
import { ModelProviderConnectionService } from "./modelProviderConnectionService.js";
import { withRuntimeConfigurationChange } from "./runtimeConfigurationChange.js";
import { markAgentsForRuntimeConfigurationChange } from "./runtimeConfigurationImpact.js";

export interface SaveModelConfigurationInput {
  displayName: string;
  providerConnectionId: string;
  providerRevision?: number;
  modelId: string;
  reasoning?: string | null;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  inputCapabilities?: readonly string[];
  options?: Readonly<Record<string, unknown>>;
}

const SUPPORTED: Record<string, readonly RuntimeId[]> = {
  "anthropic-messages": ["claude", "opencode", "pi"],
  "openai-responses": ["codex", "opencode", "pi"],
  "openai-completions": ["opencode", "pi"],
  "google-generative-ai": ["opencode", "pi"],
  "google-vertex": ["claude", "opencode", "pi"],
  "bedrock-converse-stream": ["claude", "pi"],
};

export function computeRuntimeCompatibility(apiKind: string): Partial<Record<RuntimeId | "pi_sdk", RuntimeCompatibility>> {
  const supported = new Set(SUPPORTED[apiKind] ?? ["pi"]);
  return Object.fromEntries((["claude", "codex", "opencode", "pi"] as RuntimeId[]).map((runtimeId) => [
    runtimeId,
    supported.has(runtimeId)
      ? { supported: true }
      : { supported: false, reason: runtimeId === "codex" ? "requires_responses_api" : "wire_api_not_supported" },
  ]));
}

export class ModelConfigurationService {
  constructor(private readonly providers = new ModelProviderConnectionService()) {}

  list() {
    const sqlite = appDataConnection();
    return (sqlite.prepare("SELECT id FROM model_configurations ORDER BY display_name, id").all() as Array<{ id: string }>)
      .map(({ id }) => this.get(id));
  }

  get(id: string) {
    const sqlite = appDataConnection();
    const row = sqlite.prepare("SELECT * FROM model_configurations WHERE id = ?").get(id) as any;
    if (!row) throw new ModelControlError("model_configuration_not_found");
    return this.getRevision(id, row.current_revision);
  }

  getRevision(id: string, revisionNumber: number) {
    const sqlite = appDataConnection();
    const row = sqlite.prepare("SELECT * FROM model_configurations WHERE id = ?").get(id) as any;
    if (!row) throw new ModelControlError("model_configuration_not_found");
    const revision = sqlite.prepare(`
      SELECT * FROM model_configuration_revisions WHERE configuration_id = ? AND revision = ?
    `).get(id, revisionNumber) as any;
    if (!revision) throw new ModelControlError("model_configuration_not_found");
    return {
      configuration: {
        id: row.id, displayName: row.display_name, status: row.status, currentRevision: row.current_revision,
        createdAt: row.created_at, updatedAt: row.updated_at,
      },
      revision: {
        configurationId: revision.configuration_id, revision: revision.revision,
        providerConnectionId: revision.provider_connection_id, providerRevision: revision.provider_revision,
        modelId: revision.model_id, reasoning: revision.reasoning, contextWindow: revision.context_window,
        maxOutputTokens: revision.max_output_tokens, inputCapabilities: JSON.parse(revision.input_capabilities_json),
        runtimeCompatibilitySnapshot: JSON.parse(revision.runtime_compatibility_snapshot_json),
        options: JSON.parse(revision.options_json), createdAt: revision.created_at,
      } satisfies ModelConfigurationRevision,
    };
  }

  async create(input: SaveModelConfigurationInput) {
    return withRuntimeConfigurationChange(() => this.save(randomUUID(), input, true));
  }
  async update(id: string, input: SaveModelConfigurationInput) {
    this.get(id);
    return withRuntimeConfigurationChange(() => this.save(id, input, false));
  }

  setStatus(id: string, status: "active" | "disabled") {
    const sqlite = appDataConnection();
    this.get(id);
    if (status === "disabled") {
      const runtimeUses = Number(sqlite.prepare(`
        SELECT count(*) FROM runtime_profiles
        WHERE default_binding_mode = 'kith_model_configuration' AND default_model_configuration_id = ?
      `).pluck().get(id));
      const advisorUses = Number(sqlite.prepare(`
        SELECT count(*) FROM advisor_provider_settings WHERE singleton_id = 1 AND model_configuration_id = ?
      `).pluck().get(id));
      if (runtimeUses + advisorUses > 0) throw new ModelControlError("model_configuration_in_use");
    }
    sqlite.prepare("UPDATE model_configurations SET status = ?, updated_at = ? WHERE id = ?").run(status, Date.now(), id);
    return this.get(id);
  }

  private save(id: string, input: SaveModelConfigurationInput, create: boolean) {
    const currentProvider = this.providers.get(input.providerConnectionId);
    const providerRevision = input.providerRevision ?? currentProvider.connection.currentRevision;
    const provider = this.providers.getRevision(input.providerConnectionId, providerRevision);
    const displayName = input.displayName.trim();
    const modelId = input.modelId.trim();
    if (!displayName || !modelId) throw new ModelControlError("model_configuration_not_found", "model fields are required");
    const compatibility = computeRuntimeCompatibility(provider.revision.apiKind);
    const sqlite = appDataConnection();
    const result = sqlite.transaction(() => {
      const now = Date.now();
      const previous = create ? undefined : sqlite.prepare(
        "SELECT current_revision FROM model_configurations WHERE id = ?",
      ).get(id) as { current_revision: number } | undefined;
      const revision = (previous?.current_revision ?? 0) + 1;
      if (create) sqlite.prepare(`
        INSERT INTO model_configurations (id, display_name, status, current_revision, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, ?)
      `).run(id, displayName, revision, now, now);
      sqlite.prepare(`
        INSERT INTO model_configuration_revisions (
          configuration_id, revision, provider_connection_id, provider_revision, model_id, reasoning,
          context_window, max_output_tokens, input_capabilities_json, runtime_compatibility_snapshot_json,
          options_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, revision, input.providerConnectionId, providerRevision, modelId, input.reasoning ?? null,
        input.contextWindow ?? null, input.maxOutputTokens ?? null, JSON.stringify(input.inputCapabilities ?? ["text"]),
        JSON.stringify(compatibility), JSON.stringify(input.options ?? {}), now);
      if (!create) sqlite.prepare(`
        UPDATE model_configurations SET display_name = ?, current_revision = ?, updated_at = ? WHERE id = ?
      `).run(displayName, revision, now, id);
      sqlite.prepare(`
        UPDATE installation_state SET runtime_configuration_epoch = runtime_configuration_epoch + 1
        WHERE singleton_key = 1
      `).run();
      return this.get(id);
    }).immediate();
    if (!create) markAgentsForRuntimeConfigurationChange({ configurationIds: [id] });
    return result;
  }
}
