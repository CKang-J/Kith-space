import assert from "node:assert/strict";
import test from "node:test";
import { computeCanvasSceneFacts, formatCanvasSceneFacts } from "./canvasSceneFacts.js";
import type { CanvasJson } from "./canvasTypes.js";

const document: CanvasJson = {
  width: 800,
  height: 600,
  deltaSetLike: {
    ROOT: { children: ["a", "b", "c", "d", "t1", "t2", "g1", "w1", "r1", "e1"] },
    a: { id: "a", key: "shape", x: 10, y: 20, width: 150, height: 200, frameId: "frame-1", attrs: {}, children: [] },
    b: { id: "b", key: "shape", x: 110, y: 20, width: 100, height: 80, frameId: "frame-1", attrs: {}, children: [] },
    c: { id: "c", key: "shape", x: 450, y: 0, width: 50, height: 40, frameId: "frame-1", attrs: {}, children: [] },
    d: { id: "d", key: "shape", x: 900, y: 500, width: 50, height: 50, attrs: {}, children: [] },
    t1: { id: "t1", key: "text", x: 320, y: 180, width: 300, height: 60, text: "Headline", attrs: { fontSize: 48 }, children: [] },
    t2: { id: "t2", key: "text", x: 320, y: 250, width: 300, height: 40, text: "Support", attrs: { fontSize: 24 }, children: [] },
    g1: {
      id: "g1", key: "shape", x: 100, y: 250, width: 120, height: 40,
      attrs: { shapeType: "rect", fillType: "linear", fill: "#9333EA", fillEnd: "#3B82F6" }, children: [],
    },
    w1: { id: "w1", key: "shape", x: 320, y: 100, width: 60, height: 60, attrs: { fill: "rgba(255,255,255,0.3)" }, children: [] },
    r1: { id: "r1", key: "shape", x: 700, y: 500, width: 40, height: 40, attrs: { shapeType: "rect", radiusTL: 30 }, children: [] },
    e1: { id: "e1", key: "text", x: 600, y: 400, width: 80, height: 40, text: "🏠 Home", attrs: { fontSize: 16 }, children: [] },
  },
  frames: [{ id: "frame-1", name: "Board", x: 0, y: 0, width: 400, height: 300 }],
  stackOrder: ["a", "b", "c", "d", "t1", "t2", "g1", "w1", "r1", "e1"],
};

test("computeCanvasSceneFacts derives hero coverage, whitespace, h1/h2 and geometry facts", () => {
  const facts = computeCanvasSceneFacts(document, { focusFrameId: "frame-1" });
  // 可视区 = frame-1 (400×300 = 120000px²)。hero = 最大非文本节点 a (150×200 = 30000px²) → 0.25。
  assert.deepEqual(facts.viewport, { kind: "frame", id: "frame-1", width: 400, height: 300 });
  assert.equal(facts.heroNodeId, "a");
  assert.equal(facts.heroCoverage, 0.25);
  // occupied = 30000+8000+2000+2500+18000+12000+4800+3600+1600+3200 = 85700 → whitespace = 1-85700/120000 = 0.2858
  assert.equal(facts.whitespaceRatio, 0.2858);
  // h1=48 h2=24 → 2.0，不弱。
  assert.equal(facts.h1Size, 48);
  assert.equal(facts.h2Size, 24);
  assert.equal(facts.h1H2Ratio, 2);
  assert.equal(facts.hierarchyWeak, false);
  // c 完全在 frame-1 之外（450 > 400）。
  assert.deepEqual(facts.outOfFrame, [{ id: "c", over: 0 }]);
  // d 完全在画布之外（900 > 800）。
  assert.deepEqual(facts.outOfCanvas, ["d"]);
  // 唯一重叠对：a∩b = 50×80 = 4000px²（≥64 阈值）。
  assert.deepEqual(facts.overlapPairs, [{ a: "a", b: "b", area: 4000 }]);
});

test("computeCanvasSceneFacts reports anti-slop hits deterministically", () => {
  const facts = computeCanvasSceneFacts(document, { focusFrameId: "frame-1" });
  assert.equal(facts.antiSlop.gradientFillCount, 1);
  assert.equal(facts.antiSlop.purpleBlueGradient, true);
  assert.deepEqual(facts.antiSlop.emojiNodeIds, ["e1"]);
  assert.deepEqual(facts.antiSlop.translucentWhiteNodeIds, ["w1"]);
  assert.deepEqual(facts.antiSlop.excessiveRoundingNodeIds, ["r1"]);
});

test("h1_h2_ratio is null when only one distinct text size exists", () => {
  const single: CanvasJson = {
    width: 400,
    height: 300,
    deltaSetLike: {
      ROOT: { children: ["t1", "t2"] },
      t1: { id: "t1", key: "text", x: 10, y: 10, width: 100, height: 40, text: "A", attrs: { fontSize: 24 }, children: [] },
      t2: { id: "t2", key: "text", x: 10, y: 60, width: 100, height: 40, text: "B", attrs: { fontSize: 24.02 }, children: [] },
    },
    frames: [],
    stackOrder: ["t1", "t2"],
  };
  const facts = computeCanvasSceneFacts(single);
  assert.equal(facts.h1Size, 24);
  assert.equal(facts.h2Size, null);
  assert.equal(facts.h1H2Ratio, null);
  assert.equal(facts.hierarchyWeak, null);
  assert.equal(facts.heroCoverage, null);
  // 无 frame → 画布尺寸即视区。
  assert.deepEqual(facts.viewport, { kind: "canvas", id: null, width: 400, height: 300 });
});

test("optional grant scope filters which nodes feed the facts", () => {
  const facts = computeCanvasSceneFacts(document, {
    scope: { elementIds: ["b", "t1"], frameIds: [], emptySelection: false },
    focusFrameId: "frame-1",
  });
  assert.equal(facts.heroNodeId, "b");
  assert.equal(facts.heroCoverage, 0.0667);
  assert.deepEqual(facts.overlapPairs, []);
  assert.deepEqual(facts.outOfCanvas, []);
  assert.equal(facts.h1Size, 48);
  assert.equal(facts.h1H2Ratio, null);
  assert.equal(facts.antiSlop.gradientFillCount, 0);
  assert.equal(facts.antiSlop.emojiNodeIds.length, 0);
});

test("frame scope pulls in unselected members by geometry and skips unrelated nodes", () => {
  const facts = computeCanvasSceneFacts(document, {
    scope: { elementIds: [], frameIds: ["frame-1"], emptySelection: false },
    focusFrameId: "frame-1",
  });
  assert.equal(facts.heroNodeId, "a");
  assert.deepEqual(facts.outOfFrame, [{ id: "c", over: 0 }]);
  // d（无 frameId、在画布外）不在 frame 范围内 → 不进 outOfCanvas 也不进 hero。
  assert.deepEqual(facts.outOfCanvas, []);
  assert.equal(facts.antiSlop.gradientFillCount, 1);
});

test("formatCanvasSceneFacts renders one compact key/value line per fact", () => {
  const facts = computeCanvasSceneFacts(document, { focusFrameId: "frame-1" });
  const text = formatCanvasSceneFacts(facts);
  assert.match(text, /^Computed facts for design_review self-scoring/);
  assert.match(text, /hero_coverage: 25\.0% of frame-1 \(composition skill target 60-85%\)/);
  assert.match(text, /whitespace: 28\.6% of frame-1/);
  assert.match(text, /h1_h2_ratio: 2\.00 \(h1=48 h2=24\)/);
  assert.match(text, /out_of_frame: c/);
  assert.match(text, /out_of_canvas: d/);
  assert.match(text, /overlap: a∩b\(4000px²\)/);
  assert.match(text, /anti_slop: gradient_fill_count=1, purple_blue_gradient=true, emoji=e1, translucent_white=w1, excessive_rounding=r1/);
});

test("formatCanvasSceneFacts renders (none) and n/a markers when facts are empty", () => {
  const empty: CanvasJson = {
    width: 400,
    height: 300,
    deltaSetLike: { ROOT: { children: [] } },
    frames: [],
    stackOrder: [],
  };
  const text = formatCanvasSceneFacts(computeCanvasSceneFacts(empty));
  assert.match(text, /hero_coverage: n\/a/);
  assert.match(text, /h1_h2_ratio: n\/a \(no text nodes\)/);
  assert.match(text, /out_of_frame: \(none\)/);
  assert.match(text, /out_of_canvas: \(none\)/);
  assert.match(text, /overlap: \(none\)/);
  assert.match(text, /emoji=\(none\)/);
});
