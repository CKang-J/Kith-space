import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../../../..");

test("canvas context menu re-enables pointer events on the island portal root", () => {
  const menu = readFileSync(
    path.join(
      repoRoot,
      "web/src/features/canvas/upstream/apps/web/src/components/rcb/selection/chrome/CanvasContextMenu.tsx",
    ),
    "utf8",
  );
  const floating = readFileSync(
    path.join(repoRoot, "web/src/features/canvas/adapters/recombynFloatingUi.tsx"),
    "utf8",
  );
  const reactDom = readFileSync(
    path.join(repoRoot, "web/src/features/canvas/adapters/recombynReactDom.ts"),
    "utf8",
  );
  assert.match(floating, /pointerEvents:\s*"none"/);
  assert.match(reactDom, /container === document\.body \? getRecombynPortalRoot\(\)/);
  assert.match(menu, /className="pointer-events-auto absolute inset-0 z-\[60\]"/);
  assert.match(menu, /className="pointer-events-auto absolute z-\[70\] min-w-\[200px\]/);
  assert.match(menu, /className="pointer-events-auto absolute z-\[80\] min-w-\[11rem\]/);
  assert.match(menu, /className="pointer-events-auto absolute z-\[80\] min-w-\[8rem\]/);
  assert.match(menu, /placeMenuInPortal\(/);
  assert.match(menu, /viewportToPortalPoint/);
  assert.doesNotMatch(menu, /pos\?\.left \?\? menu\.clientX/);
  assert.match(menu, /<kbd className="shrink-0 font-\[system-ui\] text-\[10px\] text-\[var\(--muted\)\]">/);
});
