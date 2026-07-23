import { and, eq, inArray, or } from "drizzle-orm";
import { appDataConnection } from "../app-data/appDatabase.js";
import { availableSpaceDbs } from "../db/index.js";
import * as schema from "../db/schema.js";
import type { RuntimeId } from "../local-runtime/runtimeCatalog.js";

function runtimesUsingConfigurations(configurationIds: readonly string[]): RuntimeId[] {
  if (configurationIds.length === 0) return [];
  const placeholders = configurationIds.map(() => "?").join(", ");
  return (appDataConnection().prepare(`
    SELECT runtime_id FROM runtime_profiles
    WHERE default_binding_mode = 'kith_model_configuration'
      AND default_model_configuration_id IN (${placeholders})
  `).all(...configurationIds) as Array<{ runtime_id: RuntimeId }>).map((row) => row.runtime_id);
}

/**
 * A configuration revision never mutates an Agent's confirmed destination silently.
 * Mark affected Agents as requiring an explicit restart/reconfirmation; the epoch gate
 * independently prevents any already-admitted session from dispatching another turn.
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

  for (const { db } of availableSpaceDbs()) {
    const affected = [];
    if (runtimeIds.length > 0) {
      affected.push(and(
        eq(schema.agents.modelBindingMode, "runtime_default"),
        inArray(schema.agents.runtime, runtimeIds),
      ));
    }
    if (configurationIds.length > 0) {
      affected.push(and(
        eq(schema.agents.modelBindingMode, "pinned"),
        inArray(schema.agents.modelConfigurationId, configurationIds),
      ));
    }
    db.update(schema.agents).set({
      modelBindingState: "restart_required",
      runtimeRestartRequired: true,
    }).where(and(
      eq(schema.agents.runtimeRestartRequired, false),
      affected.length === 1 ? affected[0] : or(...affected),
    )).run();
  }
}
