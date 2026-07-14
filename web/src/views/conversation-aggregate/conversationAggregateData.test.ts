import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyConversationFile,
  filterConversationFiles,
  sortConversationTopics,
} from "./conversationAggregateData.ts";
import type { ConversationFile, ThreadSummary } from "./types.ts";

const file = (input: Partial<ConversationFile> & Pick<ConversationFile, "id" | "filename">): ConversationFile => ({
  createdAt: "2026-07-14T00:00:00.000Z",
  ...input,
});

const topic = (input: Partial<ThreadSummary> & Pick<ThreadSummary, "threadChannelId" | "parentMessageId">): ThreadSummary => ({
  parentChannelId: "channel-1",
  parentMessageText: "父消息",
  parentSender: { type: "human", id: "human-1", name: "Human" },
  replyCount: 0,
  unreadCount: 0,
  followed: false,
  createdAt: "2026-07-14T00:00:00.000Z",
  ...input,
});

test("conversation files classify image, video, and every remaining MIME as file", () => {
  assert.equal(classifyConversationFile("image/png"), "image");
  assert.equal(classifyConversationFile("VIDEO/mp4"), "video");
  assert.equal(classifyConversationFile("application/pdf"), "file");
  assert.equal(classifyConversationFile(null), "file");
});

test("conversation file filters intersect category with trimmed filename or source-message search", () => {
  const files: ConversationFile[] = [
    file({ id: "image", filename: "架构图.PNG", mimeType: "image/png", sourceMessageText: "界面方案" }),
    file({ id: "video", filename: "demo.mp4", mimeType: "video/mp4", sourceMessageText: "产品演示" }),
    file({ id: "doc", filename: "RELEASE-NOTES.md", mimeType: "text/markdown", sourceMessageText: "发布总结" }),
  ];

  assert.deepEqual(filterConversationFiles(files, "image", "  界面  ").map((item) => item.id), ["image"]);
  assert.deepEqual(filterConversationFiles(files, "file", "release-notes").map((item) => item.id), ["doc"]);
  assert.deepEqual(filterConversationFiles(files, "all", "产品演示").map((item) => item.id), ["video"]);
  assert.deepEqual(filterConversationFiles(files, "video", "架构图"), []);
});

test("conversation topics sort by latest reply, falling back to creation time without mutating input", () => {
  const topics: ThreadSummary[] = [
    topic({ threadChannelId: "older", parentMessageId: "m1", createdAt: "2026-07-14T01:00:00.000Z" }),
    topic({ threadChannelId: "latest-reply", parentMessageId: "m2", createdAt: "2026-07-14T00:00:00.000Z", lastReplyAt: "2026-07-14T03:00:00.000Z" }),
    topic({ threadChannelId: "newer-created", parentMessageId: "m3", createdAt: "2026-07-14T02:00:00.000Z" }),
  ];

  const sorted = sortConversationTopics(topics);

  assert.deepEqual(sorted.map((item) => item.threadChannelId), ["latest-reply", "newer-created", "older"]);
  assert.deepEqual(topics.map((item) => item.threadChannelId), ["older", "latest-reply", "newer-created"]);
});
