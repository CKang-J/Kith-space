import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const menu = fs.readFileSync(
  new URL("../web/src/views/agent-memory/MemoryFilterMenu.tsx", import.meta.url),
  "utf8",
);
const structuredMemory = fs.readFileSync(
  new URL("../web/src/views/agent-memory/StructuredMemoryView.tsx", import.meta.url),
  "utf8",
);
const css = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("memory filters use a viewport-aware portal instead of a fixed bottom sheet", () => {
  assert.match(structuredMemory, /<MemoryFilterMenu label=/);
  assert.match(menu, /createPortal\(/);
  assert.match(menu, /availableBelow/);
  assert.match(menu, /availableAbove/);
  assert.match(menu, /Math\.min\(triggerRect\.left, maxLeft\)/);
  assert.match(menu, /window\.addEventListener\("resize", place\)/);
  assert.match(menu, /window\.addEventListener\("scroll", place, true\)/);
  assert.match(css, /\.memory-filter-popover\{position:fixed;/);
  assert.match(css, /\.memory-filter-popover\{[^}]*background:var\(--surface\)/);
  assert.doesNotMatch(css, /\.memory-filter-popover\{[^}]*background:var\(--panel\)/);
  assert.doesNotMatch(css, /\.memory-filter-menu>div\{position:fixed;/);
  assert.doesNotMatch(css, /\.memory-filter-menu>div\{[^}]*bottom:16px/);
});
