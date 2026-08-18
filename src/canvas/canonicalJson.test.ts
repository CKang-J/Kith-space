import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson, compareUnicodeCodePoints } from "./canonicalJson.js";

test("canonical JSON sorts object keys by Unicode code point, not localeCompare", () => {
  const previous = String.prototype.localeCompare;
  String.prototype.localeCompare = function localeCompareTrap(this: string, other?: string) {
    return this.toLocaleLowerCase("sv").localeCompare(String(other), "sv");
  };
  try {
    assert.equal(compareUnicodeCodePoints("a", "z"), -1);
    assert.equal(compareUnicodeCodePoints("z", "ä"), -1);
    assert.equal(canonicalJson({ z: 1, ä: 2, a: 3 }), '{"a":3,"z":1,"ä":2}');
    assert.equal(
      canonicalJson({ "\uD83D\uDE00": true, A: 1, a: 2 }),
      '{"A":1,"a":2,"\uD83D\uDE00":true}',
    );
  } finally {
    String.prototype.localeCompare = previous;
  }
});

test("canvas Core request hashes use the shared Unicode code-point canonical JSON", () => {
  const source = readFileSync(new URL("./canvasCore.ts", import.meta.url), "utf8");
  assert.match(source, /from "\.\/canonicalJson\.js"/);
  assert.doesNotMatch(source, /localeCompare/);
});
