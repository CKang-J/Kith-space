import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { spaceIdHeader, spaceRoom } from "../src/server/util.ts";

const requestWith = (headers: Record<string, string>): IncomingMessage => ({ headers }) as IncomingMessage;

test("spaceIdHeader prefers the canonical x-space-id contract", () => {
  assert.deepEqual(spaceIdHeader(requestWith({ "x-space-id": "space-a" })), {
    spaceId: "space-a",
    conflict: false,
  });
});

test("spaceIdHeader temporarily accepts a legacy x-server-id header", () => {
  assert.deepEqual(spaceIdHeader(requestWith({ "x-server-id": "space-a" })), {
    spaceId: "space-a",
    conflict: false,
  });
});

test("spaceIdHeader accepts matching dual headers and rejects ambiguous values", () => {
  assert.deepEqual(spaceIdHeader(requestWith({ "x-space-id": "space-a", "x-server-id": "space-a" })), {
    spaceId: "space-a",
    conflict: false,
  });
  assert.deepEqual(spaceIdHeader(requestWith({ "x-space-id": "space-a", "x-server-id": "space-b" })), {
    spaceId: "space-a",
    conflict: true,
  });
});

test("Space realtime fan-out uses the canonical Space room", () => {
  assert.equal(spaceRoom("space-a"), "space:space-a");
});
