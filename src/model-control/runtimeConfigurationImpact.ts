import { and, eq, inArray, isNull } from "drizzle-orm";
import { appDataConnection } from "../app-data/appDatabase.js";
import { allSpaceDbs, availableSpaceDbs } from "../db/index.js";
import * as schema from "../db/schema.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";
import { AgentModelBindingService } from "./agentModelBindingService.js";
import { ModelControlError } from "./contracts.js";

function runtimesUsingConfigurations(configurationIds: readonly string[]): RuntimeId[] {
  if (configurationIds.length === 0) return [];
  const placeholders = configurationIds.map(() => "?").join(", ");
  return (appDataConnection().prepare(`
    SELECT runtime_id FROM runtime_profiles
    WHERE default_binding_mode = 'kith_model_configuration'
      AND default_model_configuration_id IN (${placeholders})
  `).all(...configurationIds) as Array<{ runtime_id: RuntimeId }>).map((row) => row.runtime_id);
}

export type ModelConfigurationUsage =
  | {
    configurationId: string;
    kind: "runtime_default";
    runtimeId: RuntimeId;
    runtimeEnabled: boolean;
  }
  | {
    configurationId: string;
    kind: "memory_advisor";
    advisorEnabled: boolean;
  }
  | {
    configurationId: string;
    kind: "agent";
    agentId: string;
    agentName: string;
    spaceId: string;
    spaceName: string;
  };

export function modelConfigurationUsage(configurationIds: readonly string[]): ModelConfigurationUsage[] {
  const ids = [...new Set(configurationIds)];
  const usage: ModelConfigurationUsage[] = [];
  if (ids.length === 0) return usage;
  const placeholders = ids.map(() => "?").join(", ");
  const sqlite = appDataConnection();
  for (const row of sqlite.prepare(`
    SELECT runtime_id, enabled, default_model_configuration_id AS configuration_id
    FROM runtime_profiles
    WHERE default_binding_mode = 'kith_model_configuration'
      AND default_model_configuration_id IN (${placeholders})
  `).all(...ids) as Array<{
    runtime_id: RuntimeId;
    enabled: number;
    configuration_id: string;
  }>) {
    usage.push({
      configurationId: row.configuration_id,
      kind: "runtime_default",
      runtimeId: row.runtime_id,
      runtimeEnabled: row.enabled === 1,
    });
  }
  for (const row of sqlite.prepare(`
    SELECT enabled, model_configuration_id AS configuration_id
    FROM advisor_provider_settings
    WHERE singleton_id = 1 AND model_configuration_id IN (${placeholders})
  `).all(...ids) as Array<{ enabled: number; configuration_id: string }>) {
    usage.push({
      configurationId: row.configuration_id,
      kind: "memory_advisor",
      advisorEnabled: row.enabled === 1,
    });
  }
  let spaces: ReturnType<typeof allSpaceDbs>;
  try {
    // Destructive model-control operations must account for every registered
    // Space. A background scan may skip an offline Space; deletion may not.
    spaces = allSpaceDbs();
  } catch {
    throw new ModelControlError(
      "space_unavailable",
      "A registered Space is unavailable, so model usage cannot be verified safely",
    );
  }
  for (const { space, db } of spaces) {
    const rows = db.select({
      configurationId: schema.agents.modelConfigurationId,
      agentId: schema.agents.id,
      agentName: schema.agents.displayName,
    })
      .from(schema.agents)
      .where(and(
        isNull(schema.agents.deletedAt),
        eq(schema.agents.modelBindingMode, "pinned"),
        inArray(schema.agents.modelConfigurationId, ids),
      ))
      .all();
    for (const row of rows) {
      if (!row.configurationId) continue;
      usage.push({
        configurationId: row.configurationId,
        kind: "agent",
        agentId: row.agentId,
        agentName: row.agentName,
        spaceId: space.id,
        spaceName: space.name,
      });
    }
  }
  return usage;
}

export function modelConfigurationIdsInUse(configurationIds: readonly string[]): Set<string> {
  return new Set(modelConfigurationUsage(configurationIds).map((item) => item.configurationId));
}

type RuntimeDefaultAgent = {
  id: string;
  runtime: string;
  modelBindingMode: "runtime_default" | "pinned" | null;
  modelBindingFingerprint: string | null;
};

function applyResolvedRuntimeDefault(
  db: ReturnType<typeof availableSpaceDbs>[number]["db"],
  agentId: string,
  resolved: ReturnType<AgentModelBindingService["resolve"]>,
): void {
  db.update(schema.agents).set({
    modelBindingMode: "runtime_default",
    modelConfigurationId: null,
    modelConfigurationRevision: null,
    modelBindingLabelSnapshot: resolved.modelBindingLabelSnapshot,
    modelBindingFingerprint: resolved.modelBindingFingerprint,
    confirmedEffectiveProviderSnapshot: resolved.confirmedEffectiveProviderSnapshot,
    confirmedInstallationIdentityDigest: resolved.confirmedInstallationIdentityDigest,
    modelBindingState: resolved.modelBindingState,
    runtimeRestartRequired: resolved.runtimeRestartRequired,
    model: resolved.model,
  }).where(eq(schema.agents.id, agentId)).run();
}

/**
 * Follow-default Agents that never confirmed a destination pick up a newly configured
 * runtime default. Agents that already confirmed a different destination stay
 * `restart_required` until Human reconfirms.
 */
export function syncRuntimeDefaultAgentBinding(
  db: ReturnType<typeof availableSpaceDbs>[number]["db"],
  agent: RuntimeDefaultAgent,
): ReturnType<AgentModelBindingService["resolve"]> | null {
  if (agent.modelBindingMode !== "runtime_default") return null;
  let resolved: ReturnType<AgentModelBindingService["resolve"]>;
  try {
    resolved = new AgentModelBindingService().resolve(agent.runtime as RuntimeId, { mode: "runtime_default" });
  } catch {
    db.update(schema.agents).set({
      modelBindingState: "setup_required",
      runtimeRestartRequired: false,
    }).where(eq(schema.agents.id, agent.id)).run();
    return null;
  }
  if (resolved.modelBindingState !== "ready") {
    applyResolvedRuntimeDefault(db, agent.id, resolved);
    return resolved;
  }
  if (agent.modelBindingFingerprint && agent.modelBindingFingerprint !== resolved.modelBindingFingerprint) {
    db.update(schema.agents).set({
      modelBindingState: "restart_required",
      runtimeRestartRequired: true,
    }).where(eq(schema.agents.id, agent.id)).run();
    return null;
  }
  applyResolvedRuntimeDefault(db, agent.id, resolved);
  return resolved;
}

function applyRuntimeDefaultBindings(runtimeIds: readonly RuntimeId[]): void {
  if (runtimeIds.length === 0) return;
  for (const { db } of availableSpaceDbs()) {
    const agents = db.select({
      id: schema.agents.id,
      runtime: schema.agents.runtime,
      modelBindingMode: schema.agents.modelBindingMode,
      modelBindingFingerprint: schema.agents.modelBindingFingerprint,
    }).from(schema.agents).where(and(
      isNull(schema.agents.deletedAt),
      eq(schema.agents.modelBindingMode, "runtime_default"),
      inArray(schema.agents.runtime, runtimeIds),
    )).all();
    for (const agent of agents) syncRuntimeDefaultAgentBinding(db, agent);
  }
}

/**
 * A configuration revision never mutates an Agent's confirmed destination silently.
 * Follow-default Agents that never confirmed a destination can take the new default;
 * pinned Agents and already-confirmed follow-default Agents require reconfirmation.
 * The epoch gate independently prevents any already-admitted session from dispatching
 * another turn.
 */
export function markAgentsForRuntimeConfigurationChange(input: {
  runtimeIds?: readonly RuntimeId[];
  configurationIds?: readonly string[];
}): void {
  const configurationIds = [...new Set(input.configurationIds ?? [])];
  const runtimeIds = [...new Set([
    ...(input.runtimeIds ?? []),
    ...runtimesUsingConfigurations(configurationIds),
  ])];
  if (runtimeIds.length === 0 && configurationIds.length === 0) return;

  applyRuntimeDefaultBindings(runtimeIds);
  if (configurationIds.length === 0) return;
  for (const { db } of availableSpaceDbs()) {
    db.update(schema.agents).set({
      modelBindingState: "restart_required",
      runtimeRestartRequired: true,
    }).where(and(
      isNull(schema.agents.deletedAt),
      eq(schema.agents.modelBindingMode, "pinned"),
      inArray(schema.agents.modelConfigurationId, configurationIds),
    )).run();
  }
}
