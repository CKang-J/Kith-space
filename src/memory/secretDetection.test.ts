import assert from "node:assert/strict";
import test from "node:test";
import { containsSecretShapedText } from "./secretDetection.js";

test("credential-shaped memory is rejected without classifying ordinary security preferences as secrets", () => {
  assert.equal(containsSecretShapedText(["api_key = sk-proj-abcdefghijklmnop1234"]), true);
  assert.equal(containsSecretShapedText(["password: correct-horse-battery-staple"]), true);
  assert.equal(containsSecretShapedText(["Never include passwords or API keys in public replies."]), false);
});
