import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_CONVERSATION_WIDTH,
  MIN_THREAD_WIDTH,
  THREAD_DIVIDER_WIDTH,
  defaultThreadPaneWidth,
  threadPaneConstraints,
} from "./chatPaneLayout.ts";

test("thread opens with an equal conversation and thread split", () => {
  const defaultWidth = defaultThreadPaneWidth(1000);
  const constraints = threadPaneConstraints(1000, defaultWidth);
  assert.deepEqual(constraints, {
    min: MIN_THREAD_WIDTH,
    max: 1000 - MIN_CONVERSATION_WIDTH - THREAD_DIVIDER_WIDTH,
    width: 495,
  });
  assert.equal(1000 - THREAD_DIVIDER_WIDTH - constraints.width, constraints.width);
});

test("thread width clamps at both drag boundaries", () => {
  assert.equal(threadPaneConstraints(1000, 100).width, MIN_THREAD_WIDTH);
  assert.equal(threadPaneConstraints(1000, 900).width, 1000 - MIN_CONVERSATION_WIDTH - THREAD_DIVIDER_WIDTH);
});

test("narrow surfaces shrink the thread minimum instead of overflowing", () => {
  assert.deepEqual(threadPaneConstraints(500, defaultThreadPaneWidth(500)), {
    min: 130,
    max: 130,
    width: 130,
  });
});
