import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createConversationApi } from "../web/src/features/conversation/data/conversationApi.ts";
import { createTaskApi } from "../web/src/features/conversation/data/taskApi.ts";

const chatSource = fs.readFileSync(new URL("../web/src/views/Chat.tsx", import.meta.url), "utf8");
const messagesSource = fs.readFileSync(new URL("../web/src/features/conversation/model/useConversationMessages.ts", import.meta.url), "utf8");
const viewportSource = fs.readFileSync(new URL("../web/src/features/conversation/model/useConversationViewport.ts", import.meta.url), "utf8");
const threadsSource = fs.readFileSync(new URL("../web/src/features/conversation/model/useConversationThreads.ts", import.meta.url), "utf8");

test("Chat composes public conversation models without generic network or socket ownership", () => {
  assert.match(chatSource, /useConversationMessages/);
  assert.match(chatSource, /useConversationViewport/);
  assert.match(chatSource, /useConversationThreads/);
  assert.match(chatSource, /useThreadPanelModel/);
  assert.doesNotMatch(chatSource, /\bapi\s*\(/);
  assert.doesNotMatch(chatSource, /\bonEvent\b/);
  assert.doesNotMatch(chatSource, /\bsubscribeChannel\b/);
  assert.match(messagesSource, /subscribeChannelRef\.current\(channelId\)/);
  assert.match(messagesSource, /onEventRef\.current/);
});

test("message, viewport, and thread models keep their responsibilities behind separate interfaces", () => {
  assert.match(messagesSource, /export interface ConversationMessageModel/);
  assert.match(messagesSource, /listMessages\(requestedChannelId/);
  assert.match(viewportSource, /export interface ConversationViewportModel/);
  assert.match(viewportSource, /prependRestoreHeightRef/);
  assert.match(viewportSource, /scrollIntoView/);
  assert.match(threadsSource, /export interface ConversationThreadModel/);
  assert.match(threadsSource, /getThreadMetadata/);
  assert.match(threadsSource, /openUnreadThread/);
});

test("conversation and task adapters expose semantic requests", async () => {
  const calls: Array<[string, string, unknown]> = [];
  const request = async (method: string, path: string, body?: unknown) => {
    calls.push([method, path, body]);
    if (path.startsWith("/api/messages/channel/")) return { messages: [{ id: "m1" }], hasMore: true };
    if (path === "/api/tasks/space") return { tasks: [{ id: "task-1", channelId: "channel-1", taskNumber: 7 }] };
    return {};
  };

  const conversationApi = createConversationApi(request);
  const taskApi = createTaskApi(request);
  const page = await conversationApi.listMessages("channel/1", 40, 12);
  const task = await taskApi.findTaskByNumber(7);
  await taskApi.convertMessage("message/1");

  assert.equal(page.hasMore, true);
  assert.equal(page.messages[0]?.id, "m1");
  assert.equal(task?.id, "task-1");
  assert.deepEqual(calls[0], ["GET", "/api/messages/channel/channel%2F1?limit=40&before=12", undefined]);
  assert.deepEqual(calls.at(-1), ["POST", "/api/tasks/convert-message", { messageId: "message/1" }]);
});
