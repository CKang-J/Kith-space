import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Channel } from "../store.tsx";
import { orderArchivedChannels } from "./archivedChannels.ts";

test("archived channels are shown newest archive first without mutating Store state", () => {
  const older: Channel = { id: "older", name: "older", type: "channel", archivedAt: "2026-07-10T10:00:00.000Z" };
  const newer: Channel = { id: "newer", name: "newer", type: "channel", archivedAt: "2026-07-12T10:00:00.000Z" };
  const input = [older, newer];

  assert.deepEqual(orderArchivedChannels(input).map((channel) => channel.id), ["newer", "older"]);
  assert.deepEqual(input.map((channel) => channel.id), ["older", "newer"]);
});

test("the Store and Chat keep archived channels discoverable but read-only", () => {
  const store = readFileSync(new URL("../store.tsx", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("./ConversationListContent.tsx", import.meta.url), "utf8");
  const chat = readFileSync(new URL("./Chat.tsx", import.meta.url), "utf8");
  const threadModel = readFileSync(new URL("../features/conversation/model/useConversationThreads.ts", import.meta.url), "utf8");

  assert.match(store, /archivedChannels: Channel\[\]/);
  assert.match(store, /Promise\.all\(\[[\s\S]*\/api\/channels\?archived=only/);
  assert.match(store, /sock\.on\("channel:updated"[\s\S]*sock\.on\("channel:deleted"/);
  assert.match(sidebar, /<ArchivedChannelGroup[\s\S]*archivedChannels\.filter/);
  assert.match(chat, /onOpenChannelSettings\?\(channelId: string, trigger\?: HTMLButtonElement\)/);
  assert.match(chat, /restoreArchivedChannel/);
  assert.match(chat, /channelSettings\.restoreChannel/);
  assert.doesNotMatch(chat, /function EditChannelModal/);
  assert.match(chat, /const conversationReadOnly = isArchived/);
  assert.match(threadModel, /isArchived && !metadata\?\.threadChannelId/);
  assert.match(chat, /<ThreadPanel[\s\S]*readOnly=\{conversationReadOnly\}/);
  assert.match(chat, /<Reactions[^>]+readOnly=\{conversationReadOnly\}/);
  assert.match(chat, /!readOnly \? <div className="ctx-rx"/);
  assert.match(chat, /!readOnly && onConvertTask/);
});
