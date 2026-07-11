import assert from "node:assert/strict";
import { test } from "node:test";
import { applySpaceScopeHeaders, spaceScopeHeaders } from "./spaceScope.ts";
import { SPACE_ROUTE_PATTERN } from "./shell/workspaceRoute.ts";

test("space-scoped fetch requests use only x-space-id", () => {
  const headers = spaceScopeHeaders("token-1", "space-1", { json: true });

  assert.deepEqual(headers, {
    "content-type": "application/json",
    authorization: "Bearer token-1",
    "x-space-id": "space-1",
  });
  assert.equal("x-server-id" in headers, false);
});

test("space-scoped XHR requests use only x-space-id", () => {
  const headers = new Map<string, string>();
  applySpaceScopeHeaders(
    { setRequestHeader: (name, value) => headers.set(name, value) },
    "token-2",
    "space-2",
  );

  assert.deepEqual(Object.fromEntries(headers), {
    authorization: "Bearer token-2",
    "x-space-id": "space-2",
  });
  assert.equal(headers.has("x-server-id"), false);
});

test("Space URLs keep the /s/:slug contract", () => {
  assert.equal(SPACE_ROUTE_PATTERN, "/s/:slug");
});
