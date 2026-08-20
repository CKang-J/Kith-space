import assert from "node:assert/strict";
import test from "node:test";
import { markLocalFromClientRect } from "./recombynMarkOverlay.ts";

test("mark drag maps viewport clicks through the overlay screen rect", () => {
  const overlay = { left: 480, top: 160, width: 200, height: 160 };
  const hit = markLocalFromClientRect(580, 240, overlay, 1000, 800);
  assert.equal(hit.inside, true);
  assert.equal(hit.x, 500);
  assert.equal(hit.y, 400);
});

test("legacy stage-origin minus clientX misses the overlay when Chat offsets the canvas", () => {
  const overlay = { left: 480, top: 160, width: 96, height: 128 };
  const origin = { x: 80, y: 40 };
  const zoom = 0.05;
  const clientX = 528;
  const clientY = 224;
  const cw = 1914;
  const ch = 2551;
  const hit = markLocalFromClientRect(clientX, clientY, overlay, cw, ch);
  assert.equal(hit.inside, true);
  const legacyX = (clientX - origin.x) / zoom;
  const legacyY = (clientY - origin.y) / zoom;
  const legacyInside =
    legacyX >= 0 && legacyX <= cw && legacyY >= 0 && legacyY <= ch;
  assert.equal(legacyInside, false);
});
