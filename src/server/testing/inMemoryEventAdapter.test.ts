import assert from "node:assert/strict";
import test from "node:test";
import { publish } from "../realtime.js";
import { createInMemoryEventAdapter } from "./inMemoryEventAdapter.js";

test("in-memory event adapter records metadata without message content", async () => {
  const events = createInMemoryEventAdapter();
  try {
    await publish("space-1", { type: "message", content: "must not be copied" });
    assert.deepEqual(events.events().map(({ observedAt: _observedAt, ...event }) => event), [{
      spaceId: "space-1",
      type: "message",
    }]);
    assert.equal(events.events()[0]!.observedAt > 0, true);
  } finally {
    events.disconnect();
  }
});
