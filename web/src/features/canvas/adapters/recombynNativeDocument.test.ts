import assert from "node:assert/strict";
import test from "node:test";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { createRecombynNativeDocumentAdapter } from "./recombynNativeDocument.ts";

test("native document adapter owns canonical bytes while Redux is only a projection", () => {
  const slice = createSlice({ name: "editor", initialState: { document: { revision: 1 } }, reducers: {
    project: (state, action: { payload: unknown }) => { state.document = action.payload as { revision: number }; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  const changes: unknown[] = [];
  const adapter = createRecombynNativeDocumentAdapter(
    { revision: 0 },
    { onDocumentChange: (document) => changes.push(document) },
  );
  const disconnect = adapter.connectProjection(store);
  const projected = { revision: 2 };
  store.dispatch(slice.actions.project(projected));
  assert.notStrictEqual(adapter.read(), projected);
  assert.deepEqual(adapter.read(), { revision: 2 });
  assert.deepEqual(changes, [{ revision: 2 }]);
  const canonicalCopy = adapter.read() as { revision: number };
  canonicalCopy.revision = 100;
  assert.deepEqual(adapter.read(), { revision: 2 });
  disconnect();
});
