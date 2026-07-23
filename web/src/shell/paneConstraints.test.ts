import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGGREGATE_PANE_WIDTH,
  aggregatePaneConstraints,
  chatPaneMin,
} from "./paneConstraints.ts";

test("Chat minimum follows 25 percent with a 360px floor", () => {
  assert.equal(chatPaneMin(1024), 360);
  assert.equal(chatPaneMin(1493), 373);
  assert.equal(chatPaneMin(2048), 512);
});

test("aggregate panel preserves the Chat minimum and one canvas gap", () => {
  assert.deepEqual(aggregatePaneConstraints(670), {
    width: AGGREGATE_PANE_WIDTH,
    canShow: true,
  });
  assert.deepEqual(aggregatePaneConstraints(669), {
    width: AGGREGATE_PANE_WIDTH,
    canShow: false,
  });
});
