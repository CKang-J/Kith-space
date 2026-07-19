import assert from "node:assert/strict";
import test from "node:test";
import { requiredSpaceForeignKeys, requiredSpaceIndexes, requiredSpaceSchema } from "./spaceDatabaseSchemaHistory.js";

test("workspace compatibility manifest is selected by the database version", () => {
  const v2 = requiredSpaceSchema(2);
  const v3 = requiredSpaceSchema(3);
  const v4 = requiredSpaceSchema(4);
  const v5 = requiredSpaceSchema(5);
  const v6 = requiredSpaceSchema(6);

  assert.equal(v2.size, 19);
  assert.ok(!v2.get("agents")?.includes("introduced_at"));
  assert.ok(v3.get("agents")?.includes("introduced_at"));
  assert.ok(!v3.get("human_channel_states")?.includes("notification_level"));
  assert.ok(v4.get("human_channel_states")?.includes("notification_level"));
  assert.ok(!v4.get("agents")?.includes("default_response_mode"));
  assert.ok(v5.get("agents")?.includes("default_response_mode"));
  assert.ok(v5.get("channel_agent_members")?.includes("response_mode_override"));
  assert.equal(requiredSpaceSchema(6, 5).size, 21, "P-A10.1 v6 prefix remains migratable");
  assert.equal(v6.size, 34);
  assert.ok(v6.has("agent_harness_state"));
  assert.ok(v6.has("runtime_sessions"));
  assert.ok(v6.has("agent_delivery_items"));
  assert.ok(v6.has("turn_operations"));
  assert.deepEqual(requiredSpaceIndexes(5), []);
  assert.ok(requiredSpaceIndexes(6).includes("runtime_sessions_current_uniq"));
  assert.equal(requiredSpaceForeignKeys(6, 5).length, 3, "P-A10.1 prefix keeps only session foreign keys");
  assert.ok(requiredSpaceForeignKeys(6).some((foreignKey) => foreignKey.table === "agent_turn_attempts" && foreignKey.targetTable === "agent_turns"));
  assert.ok(requiredSpaceForeignKeys(6).some((foreignKey) => foreignKey.table === "agent_delivery_items" && foreignKey.from === "target_runtime_session_id" && foreignKey.onDelete === "SET NULL"));
});
