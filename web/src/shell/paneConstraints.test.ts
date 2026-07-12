import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MODULE_RATIO,
  chatPaneMin,
  modulePaneMin,
  moduleRatioFromWidth,
  paneConstraints,
} from "./paneConstraints.ts";

test("Chat minimum follows 25 percent with a 360px floor", () => {
  assert.equal(chatPaneMin(1024), 360);
  assert.equal(chatPaneMin(1493), 373);
  assert.equal(chatPaneMin(2048), 512);
});

test("modules expose content-specific minimum widths", () => {
  assert.equal(modulePaneMin("inbox"), 640);
  assert.equal(modulePaneMin("spaces"), 640);
  assert.equal(modulePaneMin("agents"), 640);
  assert.equal(modulePaneMin("tasks"), 560);
  assert.equal(modulePaneMin("search"), 560);
});

test("default Split puts Chat at its responsive minimum", () => {
  assert.deepEqual(paneConstraints(1493, "tasks", DEFAULT_MODULE_RATIO), {
    chatMin: 373,
    moduleMin: 560,
    moduleMax: 1110,
    moduleWidth: 1110,
    canSplit: true,
  });
  assert.equal(paneConstraints(2048, "inbox", DEFAULT_MODULE_RATIO).moduleWidth, 1526);
});

test("module width is no longer capped at 960px", () => {
  const layout = paneConstraints(2048, "inbox", DEFAULT_MODULE_RATIO);
  assert.equal(layout.moduleMax, 1526);
  assert.equal(layout.moduleWidth, 1526);
});

test("the same stored ratio survives viewport changes", () => {
  const ratio = moduleRatioFromWidth(746.5, 1493);
  assert.equal(ratio, 0.5);
  assert.equal(paneConstraints(1493, "inbox", ratio).moduleWidth, 747);
  assert.equal(paneConstraints(2048, "inbox", ratio).moduleWidth, 1024);
});

test("module-specific limits choose Split or single Pane independently", () => {
  assert.equal(paneConstraints(960, "tasks", DEFAULT_MODULE_RATIO).canSplit, true);
  assert.equal(paneConstraints(960, "inbox", DEFAULT_MODULE_RATIO).canSplit, false);
});

test("dragging cannot shrink Chat below its responsive minimum", () => {
  const layout = paneConstraints(2048, "tasks", 0.9);
  assert.equal(layout.moduleWidth, 1526);
  assert.equal(2048 - layout.moduleWidth - 10, layout.chatMin);
});
