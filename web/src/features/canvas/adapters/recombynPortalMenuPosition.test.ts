import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPortalMenuPos,
  portalFlyoutFromAnchor,
  viewportToPortalPoint,
} from "./recombynPortalMenuPosition.ts";

test("viewport clicks map into the island portal, not the window", () => {
  const origin = viewportToPortalPoint(820, 260, { left: 420, top: 56, width: 900, height: 720 });
  assert.equal(origin.left, 400);
  assert.equal(origin.top, 204);
  assert.equal(origin.viewW, 900);
  assert.equal(origin.viewH, 720);
});

test("portal menu clamp stays inside the island, not the browser window", () => {
  const placed = clampPortalMenuPos({
    left: 820,
    top: 680,
    menuW: 200,
    menuH: 420,
    viewW: 900,
    viewH: 720,
  });
  assert.equal(placed.left, 692);
  assert.equal(placed.top, 292);
});

test("flyouts are placed relative to the portal origin", () => {
  const pos = portalFlyoutFromAnchor({
    anchor: { left: 500, right: 700, top: 180, bottom: 208 },
    portal: { left: 420, top: 56, width: 900, height: 720 },
    flyoutW: 176,
    flyoutH: 152,
  });
  assert.equal(pos.left, 284);
  assert.equal(pos.top, 124);
});
