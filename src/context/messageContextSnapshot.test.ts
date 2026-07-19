import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMessageContextSnapshot } from "./messageContextSnapshot.js";

test("normalizes MessageContextSnapshot without accepting URL or transient UI data", () => {
  const snapshot = normalizeMessageContextSnapshot({
    spaceId: "forged",
    module: "chat",
    routeId: "chat.thread",
    openObjectRefs: [
      { type: "channel", id: "ch-1", revision: 3, query: "secret" },
      { type: "file", id: "/Users/me/private.txt" },
    ],
    focusedRef: { type: "message", id: "msg-1", field: "content", selection: "draft" },
    capturedAt: 100,
    url: "http://localhost:7777/?token=secret#fragment",
    clipboard: "secret",
  }, "space-authority", 200);
  assert.deepEqual(snapshot, {
    spaceId: "space-authority",
    module: "chat",
    routeId: "chat.thread",
    openObjectRefs: [{ type: "channel", id: "ch-1", revision: 3 }],
    focusedRef: { type: "message", id: "msg-1", field: "content" },
    capturedAt: 100,
  });
});

test("rejects unknown modules and URL-shaped identifiers", () => {
  assert.equal(normalizeMessageContextSnapshot({ module: "chat", routeId: "https://host/?q=x", openObjectRefs: [] }, "s"), null);
  assert.equal(normalizeMessageContextSnapshot({ module: "untrusted", routeId: "x", openObjectRefs: [] }, "s"), null);
});
