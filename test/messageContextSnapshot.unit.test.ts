import test from "node:test";
import assert from "node:assert/strict";
import { messageContextSnapshot } from "../web/src/messageContextSnapshot.ts";

test("renderer MessageContextSnapshot contains only canonical product references", () => {
  assert.deepEqual(messageContextSnapshot("space", "thread", true, 123), {
    spaceId: "space",
    module: "chat",
    routeId: "chat.thread",
    openObjectRefs: [{ type: "thread", id: "thread" }],
    focusedRef: { type: "thread", id: "thread", field: "composer" },
    capturedAt: 123,
  });
});
