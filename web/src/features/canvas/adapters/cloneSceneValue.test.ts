import assert from "node:assert/strict";
import test from "node:test";
import { createSlice } from "@reduxjs/toolkit";
import { produce } from "immer";
import { cloneSceneValue } from "../upstream/apps/web/src/components/rcb/scene/document/sceneDocument.ts";

const imageNode = {
  id: "img-1",
  key: "image",
  x: 40,
  y: 80,
  width: 320,
  height: 240,
  attrs: {
    src: "/api/canvas-assets/space-1/canvas-1/asset-1",
    name: "海报",
  },
  children: [] as string[],
};

test("cloneSceneValue copies an Immer draft image node (eraser confirm path)", () => {
  let cloned: typeof imageNode | undefined;
  produce({ node: imageNode }, (draft) => {
    // startImageProcess → spawnImageProcessNode → cloneSceneValue(src)
    // used to throw: Failed to execute 'structuredClone' on 'Window'
    cloned = cloneSceneValue(draft.node);
  });
  assert.ok(cloned);
  assert.equal(cloned.id, "img-1");
  assert.equal(cloned.attrs.src, imageNode.attrs.src);
  assert.notEqual(cloned, imageNode);
  cloned.attrs.name = "擦除";
  assert.equal(imageNode.attrs.name, "海报");
});

test("cloneSceneValue inside a Redux Toolkit reducer does not throw", () => {
  const slice = createSlice({
    name: "editor",
    // Canvas node bags are open-ended (arbitrary attrs); keep the test document
    // loosely typed so the reducer can simulate writing eraser-process attrs.
    initialState: { document: { deltaSetLike: { "img-1": imageNode } as Record<string, any> } },
    reducers: {
      spawnProcessClone(state) {
        const src = state.document.deltaSetLike["img-1"];
        const node = cloneSceneValue(src);
        node.id = "clone-1";
        node.x = (Number(src.x) || 0) + (Number(src.width) || 0) + 16;
        node.attrs = { ...node.attrs, processKind: "eraser", processStatus: "running" };
        state.document.deltaSetLike["clone-1"] = node;
      },
    },
  });
  const next = slice.reducer(undefined, slice.actions.spawnProcessClone());
  assert.equal(next.document.deltaSetLike["clone-1"]?.attrs.processKind, "eraser");
  assert.equal(next.document.deltaSetLike["img-1"]?.id, "img-1");
  assert.equal(next.document.deltaSetLike["clone-1"]?.x, 376);
});
