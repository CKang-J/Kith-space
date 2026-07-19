import assert from "node:assert/strict";
import test from "node:test";
import { requiredSpaceSchema } from "./spaceDatabaseSchemaHistory.js";

test("workspace compatibility manifest is selected by the database version", () => {
  const v2 = requiredSpaceSchema(2);
  const v3 = requiredSpaceSchema(3);
  const v4 = requiredSpaceSchema(4);
  const v5 = requiredSpaceSchema(5);

  assert.equal(v2.size, 19);
  assert.ok(!v2.get("agents")?.includes("introduced_at"));
  assert.ok(v3.get("agents")?.includes("introduced_at"));
  assert.ok(!v3.get("human_channel_states")?.includes("notification_level"));
  assert.ok(v4.get("human_channel_states")?.includes("notification_level"));
  assert.ok(!v4.get("agents")?.includes("default_response_mode"));
  assert.ok(v5.get("agents")?.includes("default_response_mode"));
  assert.ok(v5.get("channel_agent_members")?.includes("response_mode_override"));
});
