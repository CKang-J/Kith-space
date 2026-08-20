import assert from "node:assert/strict";
import test from "node:test";
import {
  CANVAS_AVAILABLE_FONTS,
  CANVAS_FONT_CATALOG,
  canvasAvailableFontLabels,
} from "./fontsCatalog.js";

test("Canvas font catalog ports Recombyn families for Agent and the editor", () => {
  assert.ok(CANVAS_FONT_CATALOG.length >= 40);
  assert.equal(CANVAS_AVAILABLE_FONTS.length, CANVAS_FONT_CATALOG.length);
  for (const name of ["Zhi Mang Xing", "Ma Shan Zheng", "Bebas Neue", "Playfair Display", "Alibaba PuHuiTi", "Inter"]) {
    assert.ok(CANVAS_AVAILABLE_FONTS.includes(name), `missing family ${name}`);
  }
  for (const font of CANVAS_FONT_CATALOG) {
    assert.ok(font.family);
    assert.ok(font.children.length >= 1, `${font.family} needs a face file`);
    assert.ok(font.children.every((child) => /^https:\/\/cdn\.jsdelivr\.net\//.test(child.url ?? "")), `${font.family} must use jsDelivr`);
  }
  const labels = canvasAvailableFontLabels().join(", ");
  assert.match(labels, /Zhi Mang Xing \(志莽行书\)/);
  assert.match(labels, /Ma Shan Zheng \(马善政楷书\)/);
  assert.equal(canvasAvailableFontLabels(["Inter", "Zhi Mang Xing"]).join(", "), "Inter, Zhi Mang Xing (志莽行书)");
});
