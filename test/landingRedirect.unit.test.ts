// Regression: HttpOnly browser sessions cannot be discovered synchronously, so every first render
// waits for the session bootstrap. Once the server answers, anonymous visitors get the Access Token
// gate and authenticated visitors enter their Space without flashing either the gate or Landing.
// Run: npx tsx --test --test-force-exit test/landingRedirect.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialAuthState, homeRoute } from "../web/src/routing.ts";

test("initialAuthState always waits for the HttpOnly Cookie session bootstrap", () => {
  assert.equal(initialAuthState(), "loading");
});

test("homeRoute: anonymous visitor gets the Access Token gate", () => {
  assert.equal(homeRoute({ authState: "anon", ready: false }), "gate");
  assert.equal(homeRoute({ authState: "anon", ready: true }), "gate");
});

test("homeRoute: while a session is still bootstrapping, show the skeleton", () => {
  assert.equal(homeRoute({ authState: "loading", ready: false }), "skeleton");
});

test("homeRoute: authed-but-not-yet-activated window also shows the skeleton", () => {
  assert.equal(homeRoute({ authState: "authed", ready: false }), "skeleton");
});

test("homeRoute: a fully bootstrapped session redirects to its Space", () => {
  assert.equal(homeRoute({ authState: "authed", ready: true }), "redirect");
});

test("homeRoute: an absent or expired browser session falls back to the Access Token gate", () => {
  assert.equal(homeRoute({ authState: "anon", ready: true }), "gate");
});

test("homeRoute: a defensively handled ready+loading state remains on the skeleton", () => {
  assert.equal(homeRoute({ authState: "loading", ready: true }), "skeleton");
});

test("the build-time first paint is the session bootstrap shell, not Landing", () => {
  const entry = readFileSync(new URL("../web/src/entry-server.tsx", import.meta.url), "utf8");
  assert.match(entry, /<WorkspaceSkeleton chat \/>/);
  assert.doesNotMatch(entry, /views\/Landing|<Landing/);
});
