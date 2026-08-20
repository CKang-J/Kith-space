import assert from "node:assert/strict";
import test from "node:test";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { connectRecombynCoreProjection, diffRecombynDocuments } from "./recombynCoreProjection.ts";

test("a real native node edit becomes a node-granular Core operation", async () => {
  const before = { deltaSetLike: { ROOT: { children: ["text-1"] }, "text-1": { id: "text-1", key: "text", x: 10 } }, frames: [] };
  const after = { deltaSetLike: { ROOT: { children: ["text-1"] }, "text-1": { id: "text-1", key: "text", x: 42 } }, frames: [] };
  assert.deepEqual(diffRecombynDocuments(before, after), [
    { op: "set", path: ["deltaSetLike", "text-1", "x"], value: 42 },
  ]);

  const slice = createSlice({
    name: "editor",
    initialState: { document: before },
    reducers: { project: (state, action: { payload: typeof before }) => { state.document = action.payload; } },
  });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  const calls: unknown[] = [];
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas-1", title: "Canvas", document: before, revisions: { revision: 0, document: 0 }, sequence: 0,
  }, {
    apply: async (input) => {
      calls.push(input);
      return { id: "canvas-1", title: "Canvas", document: after, revisions: { revision: 1, document: 1 }, sequence: 1 };
    },
    reload: async () => ({ id: "canvas-1", title: "Canvas", document: before, revisions: { revision: 0, document: 0 }, sequence: 0 }),
    history: async () => ({ id: "canvas-1", title: "Canvas", document: before, revisions: { revision: 2, document: 2 }, sequence: 2 }),
    project: () => undefined,
    reportError: () => undefined,
  });
  store.dispatch(slice.actions.project(after));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { operation: { patches: unknown } }).operation.patches, diffRecombynDocuments(before, after));
  assert.equal(connection.currentRevision(), 1);
  connection.replaceFromCore({ id: "canvas-1", title: "Canvas", document: before, revisions: { revision: 3, document: 3 }, sequence: 3 });
  assert.equal(connection.currentRevision(), 3);
  connection.disconnect();
});

test("object key reordering is not a durable Canvas mutation", () => {
  assert.deepEqual(diffRecombynDocuments(
    { deltaSetLike: { ROOT: { children: [] }, node: { id: "node", key: "shape", x: 1, attrs: {} } } },
    { deltaSetLike: { node: { attrs: {}, x: 1, key: "shape", id: "node" }, ROOT: { children: [] } } },
  ), []);
});

test("native Frame property edits use stable Frame ids instead of replacing the frames array", () => {
  const before = {
    deltaSetLike: { ROOT: { children: [] } },
    frames: [
      { id: "frame-a", x: 0, y: 0, width: 100, height: 100 },
      { id: "frame-b", x: 200, y: 0, width: 100, height: 100 },
    ],
    stackOrder: ["frame:frame-a", "frame:frame-b"],
  };
  const after = {
    ...before,
    frames: [before.frames[0], { ...before.frames[1], x: 240 }],
  };

  assert.deepEqual(diffRecombynDocuments(before, after), [
    { op: "set", path: ["frames", "frame:frame-b", "x"], value: 240 },
  ]);
});

test("rapid pointer-frame document changes coalesce into one durable Core mutation", async () => {
  const before = { deltaSetLike: { ROOT: { children: ["node"] }, node: { id: "node", key: "shape", x: 0 } } };
  const final = { deltaSetLike: { ROOT: { children: ["node"] }, node: { id: "node", key: "shape", x: 39 } } };
  const slice = createSlice({ name: "editor", initialState: { document: before }, reducers: {
    project: (state, action: { payload: typeof before }) => { state.document = action.payload; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  const calls: Array<{ operation: { type: string; patches?: unknown[] } }> = [];
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas", title: "Canvas", document: before, revisions: { revision: 0, document: 0 }, sequence: 0,
  }, {
    apply: async (input) => {
      calls.push(input);
      return { id: "canvas", title: "Canvas", document: final, revisions: { revision: 1, document: 1 }, sequence: 1 };
    },
    reload: async () => { throw new Error("unused"); },
    history: async () => { throw new Error("unused"); },
    project: () => undefined,
    reportError: () => undefined,
  }, { settleDelayMs: 25 });
  for (let x = 1; x <= 39; x += 1) {
    store.dispatch(slice.actions.project({ deltaSetLike: { ...before.deltaSetLike, node: { ...before.deltaSetLike.node, x } } }));
  }
  assert.equal(calls.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.operation.patches, [{ op: "set", path: ["deltaSetLike", "node", "x"], value: 39 }]);
  connection.disconnect();
});

test("an active pointer interaction never persists on a debounce pause and flushes exactly on pointer end", async () => {
  const before = { deltaSetLike: { ROOT: { children: ["node"] }, node: { id: "node", key: "shape", x: 0 } } };
  const after = { deltaSetLike: { ROOT: { children: ["node"] }, node: { id: "node", key: "shape", x: 10 } } };
  const slice = createSlice({ name: "editor", initialState: { document: before }, reducers: {
    project: (state) => { state.document = after; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  let active = true;
  let calls = 0;
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas", title: "Canvas", document: before, revisions: { revision: 0, document: 0 }, sequence: 0,
  }, {
    apply: async () => { calls += 1; return { id: "canvas", title: "Canvas", document: after, revisions: { revision: 1, document: 1 }, sequence: 1 }; },
    reload: async () => { throw new Error("unused"); }, history: async () => { throw new Error("unused"); },
    project: () => undefined, reportError: () => undefined,
  }, { settleDelayMs: 10, interactionActive: () => active });
  store.dispatch(slice.actions.project());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 0);
  active = false;
  connection.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  connection.disconnect();
});

test("rapid title commits serialize through metadata.rename and project the durable title", async () => {
  const document = { deltaSetLike: { ROOT: { children: [] } } };
  const slice = createSlice({ name: "editor", initialState: { document }, reducers: {
    project: (state, action: { payload: typeof document }) => { state.document = action.payload; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  const calls: Array<{ expectedRevision: number; operation: { type: string; title?: string } }> = [];
  let title = "Before";
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas", title, document, revisions: { revision: 0, document: 0 }, sequence: 0,
  }, {
    apply: async (input) => {
      calls.push(input as any);
      title = (input.operation as { title: string }).title;
      const revision = calls.length;
      return { id: "canvas", title, document, revisions: { revision, document: 0 }, sequence: revision };
    },
    reload: async () => ({ id: "canvas", title, document, revisions: { revision: calls.length, document: 0 }, sequence: calls.length }),
    history: async () => { throw new Error("unused"); },
    project: (snapshot) => { title = snapshot.title; },
    reportError: () => undefined,
  });
  const first = connection.rename("First");
  const second = connection.rename("Final");
  await Promise.all([first, second]);
  assert.deepEqual(calls.map((call) => [call.expectedRevision, call.operation.type, call.operation.title]), [
    [0, "metadata.rename", "First"],
    [1, "metadata.rename", "Final"],
  ]);
  assert.equal(title, "Final");
  connection.disconnect();
});

test("a failed optimistic mutation cancels later queued patches", async () => {
  const before = { deltaSetLike: { ROOT: { children: [] } }, width: 100 };
  const slice = createSlice({ name: "editor", initialState: { document: before }, reducers: {
    project: (state, action: { payload: typeof before }) => { state.document = action.payload; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  let applies = 0;
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas", title: "Canvas", document: before, revisions: { revision: 0, document: 0 }, sequence: 0,
  }, {
    apply: async () => { applies += 1; throw new Error("conflict"); },
    reload: async () => ({ id: "canvas", title: "Canvas", document: before, revisions: { revision: 4, document: 4 }, sequence: 4 }),
    history: async () => { throw new Error("unused"); },
    project: (snapshot) => store.dispatch(slice.actions.project(snapshot.document as typeof before)),
    reportError: () => undefined,
  });
  store.dispatch(slice.actions.project({ ...before, width: 101 }));
  store.dispatch(slice.actions.project({ ...before, width: 102 }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(applies, 1);
  assert.equal(connection.currentRevision(), 4);
  connection.disconnect();
});

test("a failed reload does not poison later local edits", async () => {
  const before = { deltaSetLike: { ROOT: { children: [] } }, width: 100 };
  const after = { ...before, width: 103 };
  const slice = createSlice({ name: "editor", initialState: { document: before }, reducers: {
    project: (state, action: { payload: typeof before }) => { state.document = action.payload; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  let applies = 0;
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas", title: "Canvas", document: before, revisions: { revision: 0, document: 0 }, sequence: 0,
  }, {
    apply: async () => {
      applies += 1;
      if (applies === 1) throw new Error("conflict");
      return { id: "canvas", title: "Canvas", document: after, revisions: { revision: 1, document: 1 }, sequence: 1 };
    },
    reload: async () => { throw new Error("offline"); },
    history: async () => { throw new Error("unused"); },
    project: (snapshot) => store.dispatch(slice.actions.project(snapshot.document as typeof before)),
    reportError: () => undefined,
  });
  store.dispatch(slice.actions.project({ ...before, width: 101 }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  store.dispatch(slice.actions.project(after));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(applies, 2);
  assert.equal(connection.currentRevision(), 1);
  connection.disconnect();
});

test("a late conflict reload cannot overwrite a newer realtime replacement", async () => {
  const before = { deltaSetLike: { ROOT: { children: [] } }, width: 100 };
  const stale = { ...before, width: 90 };
  const fresh = { ...before, width: 107 };
  const slice = createSlice({ name: "editor", initialState: { document: before }, reducers: {
    project: (state, action: { payload: typeof before }) => { state.document = action.payload; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  let releaseReload!: (snapshot: any) => void;
  const reload = new Promise<any>((resolve) => { releaseReload = resolve; });
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas", title: "Canvas", document: before, revisions: { revision: 0, document: 0 }, sequence: 0,
  }, {
    apply: async () => { throw new Error("conflict"); },
    reload: async () => reload,
    history: async () => { throw new Error("unused"); },
    project: (snapshot) => store.dispatch(slice.actions.project(snapshot.document as typeof before)),
    reportError: () => undefined,
  });
  store.dispatch(slice.actions.project({ ...before, width: 101 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  connection.replaceFromCore({ id: "canvas", title: "Canvas", document: fresh, revisions: { revision: 7, document: 7 }, sequence: 7 });
  releaseReload({ id: "canvas", title: "Canvas", document: stale, revisions: { revision: 4, document: 4 }, sequence: 4 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(connection.currentRevision(), 7);
  assert.equal(store.getState().editor.document.width, 107);
  connection.disconnect();
});

test("an own realtime publish does not cancel the next queued local edit", async () => {
  const before = { deltaSetLike: { ROOT: { children: [] } }, width: 100 };
  const first = { ...before, width: 101 };
  const second = { ...before, width: 102 };
  const slice = createSlice({ name: "editor", initialState: { document: before }, reducers: {
    project: (state, action: { payload: typeof before }) => { state.document = action.payload; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  let releaseFirst!: () => void;
  const firstBarrier = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const calls: Array<{ expectedRevision: number }> = [];
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas", title: "Canvas", document: before, revisions: { revision: 0, document: 0 }, sequence: 0,
  }, {
    apply: async (input) => {
      calls.push(input);
      if (calls.length === 1) {
        await firstBarrier;
        return { id: "canvas", title: "Canvas", document: first, revisions: { revision: 1, document: 1 }, sequence: 1 };
      }
      return { id: "canvas", title: "Canvas", document: second, revisions: { revision: 2, document: 2 }, sequence: 2 };
    },
    reload: async () => { throw new Error("unused"); },
    history: async () => { throw new Error("unused"); },
    project: (snapshot) => store.dispatch(slice.actions.project(snapshot.document as typeof before)),
    reportError: () => undefined,
  });
  store.dispatch(slice.actions.project(first));
  await new Promise((resolve) => setTimeout(resolve, 0));
  store.dispatch(slice.actions.project(second));
  connection.replaceFromCore({ id: "canvas", title: "Canvas", document: first, revisions: { revision: 1, document: 1 }, sequence: 1 });
  releaseFirst();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.map((call) => call.expectedRevision), [0, 1]);
  assert.equal(connection.currentRevision(), 2);
  assert.deepEqual(store.getState().editor.document, second);
  connection.disconnect();
});

test("an edit made while undo is in flight reserves the following Core revision", async () => {
  const before = { deltaSetLike: { ROOT: { children: ["node"] }, node: { id: "node", key: "shape", x: 1, y: 0 } } };
  const undone = { deltaSetLike: { ROOT: { children: ["node"] }, node: { id: "node", key: "shape", x: 0, y: 0 } } };
  const edited = { deltaSetLike: { ROOT: { children: ["node"] }, node: { id: "node", key: "shape", x: 1, y: 2 } } };
  const final = { deltaSetLike: { ROOT: { children: ["node"] }, node: { id: "node", key: "shape", x: 0, y: 2 } } };
  const slice = createSlice({ name: "editor", initialState: { document: before }, reducers: {
    project: (state, action: { payload: typeof before }) => { state.document = action.payload; },
  } });
  const store = configureStore({ reducer: { editor: slice.reducer } });
  let releaseHistory!: () => void;
  const historyBarrier = new Promise<void>((resolve) => { releaseHistory = resolve; });
  const applyCalls: Array<{ expectedRevision: number; operation: unknown }> = [];
  const connection = connectRecombynCoreProjection(store, {
    id: "canvas", title: "Canvas", document: before, revisions: { revision: 1, document: 1 }, sequence: 1,
  }, {
    history: async (_kind, _operationId, expectedRevision) => {
      assert.equal(expectedRevision, 1);
      await historyBarrier;
      return { id: "canvas", title: "Canvas", document: undone, revisions: { revision: 2, document: 2 }, sequence: 2 };
    },
    apply: async (input) => {
      applyCalls.push(input);
      return { id: "canvas", title: "Canvas", document: final, revisions: { revision: 3, document: 3 }, sequence: 3 };
    },
    reload: async () => { throw new Error("unused"); },
    project: (snapshot) => store.dispatch(slice.actions.project(snapshot.document as typeof before)),
    reportError: () => undefined,
  });
  const history = connection.history("undo");
  store.dispatch(slice.actions.project(edited));
  releaseHistory();
  await history;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0]!.expectedRevision, 2);
  assert.deepEqual((applyCalls[0]!.operation as { patches: unknown }).patches, [
    { op: "set", path: ["deltaSetLike", "node", "y"], value: 2 },
  ]);
  assert.deepEqual(store.getState().editor.document, final);
  connection.disconnect();
});
