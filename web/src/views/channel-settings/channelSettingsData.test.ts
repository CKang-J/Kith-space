import assert from "node:assert/strict";
import { test } from "node:test";
import {
  channelVisibility,
  filterAgents,
  generalFormForChannel,
  isGeneralFormDirty,
  isRequiredChannel,
  matchesDeleteConfirmation,
  normalizeNotificationLevel,
} from "./channelSettingsData.ts";

test("required channel detection accepts the explicit flag and the canonical all name", () => {
  assert.equal(isRequiredChannel({ id: "1", name: "all", type: "channel" }), true);
  assert.equal(isRequiredChannel({ id: "2", name: "#ALL", type: "channel" }), true);
  assert.equal(isRequiredChannel({ id: "3", name: "general", type: "channel", isRequired: true }), true);
  assert.equal(isRequiredChannel({ id: "4", name: "general", type: "channel" }), false);
});

test("general form derives visibility and reports only real edits as dirty", () => {
  const channel = { id: "1", name: "design", type: "private", description: null };
  const saved = generalFormForChannel(channel);
  assert.equal(channelVisibility(channel), "private");
  assert.deepEqual(saved, { name: "design", description: "", visibility: "private" });
  assert.equal(isGeneralFormDirty({ ...saved }, saved), false);
  assert.equal(isGeneralFormDirty({ ...saved, description: "UI" }, saved), true);
});

test("notification values fall back to the product default", () => {
  assert.equal(normalizeNotificationLevel("mentions"), "mentions");
  assert.equal(normalizeNotificationLevel("none"), "none");
  assert.equal(normalizeNotificationLevel("unexpected"), "all");
});

test("agent search matches handles and display names without mutating the source", () => {
  const agents = [
    { id: "1", name: "claude-code", displayName: "Claude" },
    { id: "2", name: "reviewer", displayName: "Code Reviewer" },
  ];
  assert.deepEqual(filterAgents(agents, " reviewer ").map((agent) => agent.id), ["2"]);
  assert.deepEqual(filterAgents(agents, "CLAUDE").map((agent) => agent.id), ["1"]);
  assert.deepEqual(agents.map((agent) => agent.id), ["1", "2"]);
});

test("delete confirmation requires the complete case-sensitive channel name", () => {
  assert.equal(matchesDeleteConfirmation("design", "design"), true);
  assert.equal(matchesDeleteConfirmation(" design ", "design"), true);
  assert.equal(matchesDeleteConfirmation("#design", "design"), false);
  assert.equal(matchesDeleteConfirmation("Design", "design"), false);
});
