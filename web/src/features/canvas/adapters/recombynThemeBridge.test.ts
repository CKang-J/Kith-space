import assert from "node:assert/strict";
import test from "node:test";
import { resolveKithCanvasTheme } from "./recombynThemeBridge.ts";

test("Canvas follows Kith's resolved dark class instead of a stale URL parameter", () => {
  assert.equal(resolveKithCanvasTheme({ contains: (name) => name === "dark" }), "dark");
  assert.equal(resolveKithCanvasTheme({ contains: () => false }), "light");
});
