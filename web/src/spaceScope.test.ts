import assert from "node:assert/strict";
import { test } from "node:test";
import { applySpaceScopeHeaders, spaceScopeHeaders } from "./spaceScope.ts";
import { SPACE_ROUTE_PATTERN } from "./shell/workspaceRoute.ts";

test("safe Space requests use Cookie auth and only x-space-id", () => {
  const headers = spaceScopeHeaders("space-1", { method: "GET", json: true });

  assert.deepEqual(headers, {
    "content-type": "application/json",
    "x-space-id": "space-1",
  });
  assert.equal("authorization" in headers, false);
  assert.equal("x-server-id" in headers, false);
});

test("unsafe Space requests include the in-memory browser-session CSRF token", () => {
  const headers = spaceScopeHeaders("space-2", { method: "POST", csrfToken: "csrf-2" });

  assert.deepEqual(headers, {
    "x-kith-csrf": "csrf-2",
    "x-space-id": "space-2",
  });
});

test("unsafe Space requests reject a missing CSRF token", () => {
  assert.throws(() => spaceScopeHeaders("space-2", { method: "DELETE" }), /CSRF/);
});

test("space-scoped XHR requests receive the same Cookie and CSRF headers", () => {
  const headers = new Map<string, string>();
  applySpaceScopeHeaders(
    { setRequestHeader: (name, value) => headers.set(name, value) },
    "space-2",
    { method: "POST", csrfToken: "csrf-2" },
  );

  assert.deepEqual(Object.fromEntries(headers), {
    "x-kith-csrf": "csrf-2",
    "x-space-id": "space-2",
  });
  assert.equal(headers.has("x-server-id"), false);
});

test("Space URLs keep the /s/:slug contract", () => {
  assert.equal(SPACE_ROUTE_PATTERN, "/s/:slug/*");
});
