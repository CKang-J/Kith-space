import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { ALL_AGENT_SCOPE_KEYS } from "../agents/agentScopes.js";
import { closeSpaceDb, dbForSpace, registerSpace, schema, unregisterSpace } from "../db/index.js";
import { kithSpaceHome } from "../paths.js";
import { listEligibleCanvasExecutors } from "./canvasChatExecutors.js";

function fixture() {
  const spaceId = randomUUID();
  registerSpace({
    id: spaceId,
    name: "Canvas executors",
    slug: `canvas-exec-${spaceId.slice(0, 8)}`,
    rootPath: path.join(kithSpaceHome(), "canvas-executors", spaceId),
  });
  const db = dbForSpace(spaceId);
  const addAgent = (name: string, options: { harness?: "v2" | "legacy"; deleted?: boolean; scopes?: string[] } = {}) => {
    const agent = db.insert(schema.agents).values({
      spaceId,
      name,
      displayName: name,
      runtime: "claude",
      status: "active",
      defaultResponseMode: "active",
      deletedAt: options.deleted ? new Date() : null,
      scopes: options.scopes
        ? { granted: options.scopes, mode: "custom", revision: 1, updatedAt: new Date().toISOString() }
        : null,
    }).returning().get()!;
    db.insert(schema.agentHarnessState).values({
      agentId: agent.id,
      mode: options.harness === "legacy" ? "legacy" : "v2",
    }).run();
    return agent;
  };
  return {
    spaceId,
    db,
    addAgent,
    addChannel(type: "channel" | "dm" | "thread", name: string) {
      return db.insert(schema.channels).values({ spaceId, name, type }).returning().get()!;
    },
    addMember(channelId: string, agentId: string) {
      db.insert(schema.channelAgentMembers).values({ channelId, agentId, lastReadSeq: 0 }).run();
    },
    cleanup() {
      closeSpaceDb(spaceId);
      unregisterSpace(spaceId);
    },
  };
}

test("channel canvas executors only list eligible v2 members with message:send", () => {
  const f = fixture();
  try {
    const live = f.addAgent("live");
    const legacy = f.addAgent("legacy", { harness: "legacy" });
    const deleted = f.addAgent("deleted", { deleted: true });
    const muted = f.addAgent("muted", {
      scopes: ALL_AGENT_SCOPE_KEYS.filter((scope) => scope !== "message:send"),
    });
    const outsider = f.addAgent("outsider");
    const channel = f.addChannel("channel", "studio");
    f.addMember(channel.id, live.id);
    f.addMember(channel.id, legacy.id);
    f.addMember(channel.id, deleted.id);
    f.addMember(channel.id, muted.id);
    const listed = listEligibleCanvasExecutors(f.db, f.spaceId, channel.id);
    assert.deepEqual(listed.map((agent) => agent.id), [live.id]);
    assert.equal(listed.some((agent) => agent.id === outsider.id), false);
  } finally {
    f.cleanup();
  }
});

test("DM canvas executors derive the peer only", () => {
  const f = fixture();
  try {
    const peer = f.addAgent("peer");
    const other = f.addAgent("other");
    const dm = f.addChannel("dm", `dm:${peer.id}`);
    f.addMember(dm.id, peer.id);
    f.addMember(dm.id, other.id);
    f.db.insert(schema.humanChannelStates).values({
      channelId: dm.id,
      dmAgentId: peer.id,
      updatedAt: new Date(),
    }).run();
    assert.deepEqual(listEligibleCanvasExecutors(f.db, f.spaceId, dm.id).map((agent) => agent.id), [peer.id]);
  } finally {
    f.cleanup();
  }
});
