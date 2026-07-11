// Unit tests for human-auth primitives (no DB / no network).
// Run: npx tsx --test --test-force-exit test/auth.unit.test.ts
// JWT_SECRET is pinned before importing auth.ts so signed/forged tokens are deterministic.
import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

// Both required vars must be set before importing auth.ts — the module throws at load time if either is missing.
process.env.JWT_SECRET = "test-secret";
process.env.DAEMON_BOOTSTRAP_KEY = "test-bootstrap-key";
const auth = await import("../src/server/auth.ts");

test("signUser / verifyUser round-trip returns the uid", () => {
  const token = auth.signUser("user-123");
  assert.equal(auth.verifyUser(token), "user-123");
});

test("verifyUser rejects null, garbage, tampered, and wrong-secret tokens", () => {
  assert.equal(auth.verifyUser(null), null);
  assert.equal(auth.verifyUser(""), null);
  assert.equal(auth.verifyUser("not.a.jwt"), null);
  const tampered = auth.signUser("user-123").slice(0, -2) + "xx";
  assert.equal(auth.verifyUser(tampered), null);
  const wrongSecret = jwt.sign({ uid: "user-123" }, "other-secret", { expiresIn: "30d" });
  assert.equal(auth.verifyUser(wrongSecret), null);
});

test("verifyUser rejects an expired token", () => {
  const expired = jwt.sign({ uid: "user-123" }, "test-secret", { expiresIn: "-1s" });
  assert.equal(auth.verifyUser(expired), null);
});

test("safeEqual", () => {
  assert.equal(auth.safeEqual("abc", "abc"), true);
  assert.equal(auth.safeEqual("abc", "abd"), false);
  assert.equal(auth.safeEqual("abc", "abcd"), false);
  assert.equal(auth.safeEqual("", ""), true);
});

test("devLoginEnabled reads env at call-time, default off", () => {
  delete process.env.ALLOW_DEV_LOGIN;
  assert.equal(auth.devLoginEnabled(), false);
  process.env.ALLOW_DEV_LOGIN = "false";
  assert.equal(auth.devLoginEnabled(), false);
  process.env.ALLOW_DEV_LOGIN = "1";
  assert.equal(auth.devLoginEnabled(), false, "only the exact string 'true' enables it");
  process.env.ALLOW_DEV_LOGIN = "true";
  assert.equal(auth.devLoginEnabled(), true);
  delete process.env.ALLOW_DEV_LOGIN;
});
