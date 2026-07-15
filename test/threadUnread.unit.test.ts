import test from "node:test";
import assert from "node:assert/strict";
import { messageUnreadDelta, nextThreadMeta, threadUnreadDelta } from "../web/src/threadUnread.ts";

test("own thread update does not increase unread count", () => {
  const next = nextThreadMeta(
    { threadChannelId: "th1", replyCount: 4, unreadCount: 0 },
    { threadChannelId: "th1", replyCount: 5, senderId: "me" },
    "me",
  );

  assert.equal(next.replyCount, 5);
  assert.equal(next.unreadCount, 0);
});

test("other member thread update increases unread by reply-count delta", () => {
  const next = nextThreadMeta(
    { threadChannelId: "th1", replyCount: 4, unreadCount: 1 },
    { threadChannelId: "th1", replyCount: 6, senderId: "other" },
    "me",
  );

  assert.equal(next.replyCount, 6);
  assert.equal(next.unreadCount, 3);
});

test("live count updates preserve fetched topic preview metadata until it refreshes", () => {
  const previews = [{
    id: "r1",
    senderType: "agent",
    senderId: "a1",
    senderName: "Agent One",
    content: "preview",
    createdAt: "2026-07-15T01:00:00.000Z",
  }];
  const next = nextThreadMeta(
    { threadChannelId: "th1", replyCount: 1, unreadCount: 0, followed: true, lastReplyAt: previews[0]!.createdAt, previews },
    { threadChannelId: "th1", replyCount: 2, senderId: "other" },
    "me",
  );

  assert.equal(next.followed, true);
  assert.equal(next.lastReplyAt, previews[0]!.createdAt);
  assert.deepEqual(next.previews, previews);
});

test("parent channel badge delta uses the same self-filter rule", () => {
  assert.equal(threadUnreadDelta(1, "me", "me"), 0);
  assert.equal(threadUnreadDelta(2, "other", "me"), 2);
  assert.equal(threadUnreadDelta(1, null, "me"), 1);
});

test("message unread delta ignores thread-channel messages", () => {
  assert.equal(messageUnreadDelta("other", "me", "thread"), 0);
  assert.equal(messageUnreadDelta("other", "me", "channel"), 1);
  assert.equal(messageUnreadDelta("me", "me", "channel"), 0);
});
