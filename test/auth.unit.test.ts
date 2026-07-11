import test from "node:test";
import assert from "node:assert/strict";
import { hashToken, newKey, safeEqual } from "../src/server/auth.ts";

test("safeEqual compares agent secrets without accepting unequal values", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});

test("agent keys remain random and hash to a stable lookup value", () => {
  const first = newKey("sk_agent_");
  const second = newKey("sk_agent_");
  assert.match(first, /^sk_agent_[a-f0-9]{48}$/);
  assert.notEqual(first, second);
  assert.equal(hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
