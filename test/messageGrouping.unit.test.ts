import test from "node:test";
import assert from "node:assert/strict";
import { shouldGroupMessage } from "../web/src/views/chat-message/messageGrouping.ts";

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "m1",
  seq: 1,
  channelId: "c1",
  senderType: "agent",
  senderId: "a1",
  senderName: "Agent One",
  messageType: "chat",
  content: "hello",
  createdAt: "2026-07-15T01:00:00.000Z",
  ...overrides,
});

test("adjacent messages from the same Human or Agent group on the same local day", () => {
  assert.equal(shouldGroupMessage(message(), message({ id: "m2", seq: 2 })), true);
  assert.equal(shouldGroupMessage(
    message({ senderType: "human", senderId: "h1" }),
    message({ id: "m2", seq: 2, senderType: "human", senderId: "h1" }),
  ), true);
});

test("different senders, calendar days, system messages, and action cards break a group", () => {
  assert.equal(shouldGroupMessage(message(), message({ senderId: "a2" })), false);
  assert.equal(shouldGroupMessage(message(), message({ createdAt: "2026-07-16T01:00:00.000Z" })), false);
  assert.equal(shouldGroupMessage(message(), message({ senderType: "system", senderId: null })), false);
  assert.equal(shouldGroupMessage(message(), message({ messageType: "action" })), false);
});

test("missing stable ids only group when sender type and fallback name both match", () => {
  assert.equal(shouldGroupMessage(
    message({ senderId: null, senderName: "Local Human" }),
    message({ senderId: null, senderName: "Local Human" }),
  ), true);
  assert.equal(shouldGroupMessage(
    message({ senderId: null, senderName: "Local Human" }),
    message({ senderId: null, senderName: "Another Human" }),
  ), false);
});
