// Pure unit coverage for the one-Human, local-agent mention auto-join contract.
import test from "node:test";
import assert from "node:assert/strict";

process.env.KITH_SPACE_DESKTOP_TOKEN ??= "test-desktop-token";
process.env.KITH_SPACE_WORKER_TOKEN ??= "test-worker-token";

const { parseMentions, membersToAutoJoin } = await import("../src/server/core.ts");

type Member = { type: "human" | "agent"; id: string; name: string; displayName: string };

const agent = (name: string): Member => ({ type: "agent", id: "a-" + name, name, displayName: name });
const human: Member = { type: "human", id: "human-local", name: "you", displayName: "You" };
const ghost = agent("ghost");
const helper = agent("helper");
const space = [human, ghost, helper];

const names = (members: Member[]) => members.map((member) => member.name).sort();

test("auto-joins referenced Space agents who are not channel members yet", () => {
  const toAdd = membersToAutoJoin("@ghost please help, @helper you too", space, [human]);
  assert.deepEqual(names(toAdd), ["ghost", "helper"]);
});

test("never re-adds the implicit Human or an existing agent member", () => {
  const toAdd = membersToAutoJoin("hey @you, @ghost, and @helper", space, [human, ghost]);
  assert.deepEqual(names(toAdd), ["helper"]);
});

test("ignores names that do not resolve to a Space member", () => {
  const toAdd = membersToAutoJoin("@nobody @ghost", space, [human]);
  assert.deepEqual(names(toAdd), ["ghost"]);
});

test("returns nothing when there are no mentions", () => {
  assert.deepEqual(membersToAutoJoin("just a plain message", space, [human]), []);
});

test("matching is case-insensitive and de-duplicated", () => {
  const toAdd = membersToAutoJoin("@GHOST @ghost @Ghost", space, [human]);
  assert.deepEqual(names(toAdd), ["ghost"]);
});

test("agent auto-join stays consistent with parsed mentions", () => {
  const content = "@ghost @helper @you";
  const recordedAgents = parseMentions(content, space).filter((member) => member.type === "agent");
  const toAdd = membersToAutoJoin(content, space, [human]);
  assert.deepEqual(names(toAdd), names(recordedAgents));
});

test("a public channel or public thread can auto-join an addressed agent", () => {
  const toAdd = membersToAutoJoin("@ghost can you take this thread?", space, [human]);
  assert.deepEqual(names(toAdd), ["ghost"]);
});

test("a private channel, DM, or their thread never pulls in an outsider", () => {
  const membersOnly = [human, helper];
  const toAdd = membersToAutoJoin("@ghost get in here, @helper you too", membersOnly, membersOnly);
  assert.deepEqual(names(toAdd), []);
});
