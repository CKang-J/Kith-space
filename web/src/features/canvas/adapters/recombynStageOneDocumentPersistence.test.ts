import assert from "node:assert/strict";
import test from "node:test";
import {
  loadStageOneDocument,
  persistStageOneDocument,
} from "./recombynStageOneDocumentPersistence.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

test("Stage 1 document persistence restores canonical generator interactions after reload", () => {
  const storage = memoryStorage();
  const fallback = { nodes: [] };
  assert.deepEqual(loadStageOneDocument(storage, fallback), fallback);
  persistStageOneDocument(storage, { nodes: [{ id: "video", aspect: "9:16" }] });
  assert.deepEqual(loadStageOneDocument(storage, fallback), {
    nodes: [{ id: "video", aspect: "9:16" }],
  });
});

test("Stage 1 document persistence fails open to the fixture", () => {
  const fallback = { nodes: [{ id: "fixture" }] };
  assert.deepEqual(
    loadStageOneDocument({ getItem: () => "not-json", setItem: () => undefined }, fallback),
    fallback,
  );
});
