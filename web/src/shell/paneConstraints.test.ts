import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGGREGATE_PANE_WIDTH,
  aggregatePaneConstraints,
  chatPaneMin,
} from "./paneConstraints.ts";

test("Chat minimum preserves the message pane and the main conversation", () => {
  assert.equal(chatPaneMin(1024), 568);
  assert.equal(chatPaneMin(1493), 568);
  assert.equal(chatPaneMin(2048), 568);
  assert.equal(chatPaneMin(2400), 600);
});

test("aggregate panel preserves the Chat minimum and one canvas gap", () => {
  assert.deepEqual(aggregatePaneConstraints(878), {
    width: AGGREGATE_PANE_WIDTH,
    canShow: true,
  });
  assert.deepEqual(aggregatePaneConstraints(877), {
    width: AGGREGATE_PANE_WIDTH,
    canShow: false,
  });
});
