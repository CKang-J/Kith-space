import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { spaceIdHeader, spaceRoom } from "../src/server/util.ts";

const requestWith = (headers: Record<string, string>): IncomingMessage => ({ headers }) as IncomingMessage;

test("spaceIdHeader prefers the canonical x-space-id contract", () => {
  assert.equal(spaceIdHeader(requestWith({ "x-space-id": "space-a" })), "space-a");
});

test("spaceIdHeader ignores the retired x-server-id header", () => {
  assert.equal(spaceIdHeader(requestWith({ "x-server-id": "space-a" })), null);
});

test("spaceIdHeader trims the canonical value and ignores unrelated headers", () => {
  assert.equal(spaceIdHeader(requestWith({ "x-space-id": " space-a ", "x-server-id": "space-b" })), "space-a");
});

test("Space realtime fan-out uses the canonical Space room", () => {
  assert.equal(spaceRoom("space-a"), "space:space-a");
});

test("the server exposes no retired Server transport compatibility seam", () => {
  const socketSource = readFileSync(new URL("../src/server/socketio.ts", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../src/server/routes-api/index.ts", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(socketSource, /\bserverId\b/);
  assert.doesNotMatch(apiSource, /\bServerCtx\b|x-server-id|\/api\/servers/);
  assert.doesNotMatch(serverSource, /x-server-id/);
  assert.equal(existsSync(new URL("../src/server/routes-api/servers.ts", import.meta.url)), false);
});
