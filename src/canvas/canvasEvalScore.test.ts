import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCanvasChecks } from "./canvasEvalScore.js";
import type { CanvasJson } from "./canvasTypes.js";

function node(id: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { id, children: [], ...extra };
}

function scene(nodes: Record<string, unknown>, frames: unknown[], canvasSize?: { width: number; height: number }): CanvasJson {
  return {
    ...(canvasSize ?? { width: 800, height: 600 }),
    deltaSetLike: { ROOT: { children: Object.keys(nodes) }, ...nodes },
    frames,
    stackOrder: Object.keys(nodes),
  } as CanvasJson;
}

// frame-1 为 800x600 可视区：hero 600x520 = 65% 覆盖率；h1=72 / h2=32 → 比值 2.25。
const cleanScene = scene(
  {
    "hero-1": node("hero-1", { key: "shape", x: 100, y: 40, width: 600, height: 520 }),
    "title-1": node("title-1", { key: "text", text: "主标题", x: 120, y: 80, width: 400, height: 80, fontSize: 72 }),
    "sub-1": node("sub-1", { key: "text", text: "副标题", x: 120, y: 480, width: 300, height: 40, fontSize: 32 }),
  },
  [{ id: "frame-1", x: 0, y: 0, width: 800, height: 600 }],
);

test("clean scene passes coverage, hierarchy, bounds, anti-slop and count checks", () => {
  const report = evaluateCanvasChecks(cleanScene, [
    "hero_coverage_between[0.6,0.85]",
    "no_out_of_bounds",
    "h1_h2_ratio_between[1.25,4]",
    "anti_slop_hits_eq[0]",
    "node_count_at_least[3]",
    "text_nodes_at_least[2]",
  ]);
  assert.equal(report.passed, true);
  assert.equal(report.totalCount, 6);
  const heroCoverage = report.checks[0]!;
  assert.equal(heroCoverage.pass, true);
  assert.ok(typeof heroCoverage.actual === "number" && heroCoverage.actual >= 0.6 && heroCoverage.actual <= 0.85);
});

test("each check type has a failing counterpart on adversarial scenes", () => {
  const weak = scene(
    {
      "hero-1": node("hero-1", { key: "shape", x: 40, y: 40, width: 160, height: 160 }),
      "title-1": node("title-1", { key: "text", text: "只有一档字号", x: 40, y: 260, width: 300, height: 50, fontSize: 48 }),
      "sub-1": node("sub-1", { key: "text", text: "次级", x: 40, y: 320, width: 300, height: 40, fontSize: 44 }),
      "escape-1": node("escape-1", { key: "shape", x: 760, y: 560, width: 120, height: 100, frameId: "frame-1" }),
      "slop-1": node("slop-1", {
        key: "shape", x: 40, y: 380, width: 200, height: 120,
        fillType: "linear", fill: "#9333EA", fillEnd: "#3B82F6", opacity: 0.4,
        attrs: { fill: "#9333EA", "fill-color": "rgba(255,255,255,0.4)" },
      }),
      "emoji-1": node("emoji-1", { key: "text", text: "🚀 加速", x: 40, y: 520, width: 120, height: 40, fontSize: 24 }),
    },
    [{ id: "frame-1", x: 0, y: 0, width: 800, height: 600 }],
  );
  const report = evaluateCanvasChecks(weak, [
    "hero_coverage_between[0.6,0.85]",
    "h1_h2_ratio_between[1.25,4]",
    "no_out_of_bounds",
    "anti_slop_hits_eq[0]",
    "node_count_at_least[10]",
    "text_nodes_at_least[5]",
  ]);
  assert.equal(report.passed, false);
  assert.equal(report.passedCount, 0);
  const [coverage, ratio, bounds, slop, nodeCount, textCount] = report.checks;
  assert.equal(coverage!.pass, false);
  assert.equal(ratio!.pass, false);
  assert.equal(bounds!.pass, false);
  assert.match(bounds!.detail, /escape-1/);
  assert.equal(slop!.pass, false);
  assert.ok(typeof slop!.actual === "number" && slop!.actual > 0);
  assert.equal(nodeCount!.pass, false);
  assert.equal(textCount!.pass, false);
});

test("hero coverage fails closed when the viewport is unknown", () => {
  const sizeless = scene(
    { "hero-1": node("hero-1", { key: "shape", x: 0, y: 0, width: 100, height: 100 }) },
    [],
    { width: 0, height: 0 },
  );
  const report = evaluateCanvasChecks(sizeless, ["hero_coverage_between[0.6,0.85]"]);
  assert.equal(report.passed, false);
  assert.match(report.checks[0]!.detail, /unavailable/);
});

test("unknown or unparseable check types throw", () => {
  assert.throws(() => evaluateCanvasChecks(cleanScene, ["bogus_check_eq[1]"]), /unknown eval check type/);
  assert.throws(() => evaluateCanvasChecks(cleanScene, ["hero_coverage_between[oops]"]), /invalid range args/);
  assert.throws(() => evaluateCanvasChecks(cleanScene, ["not even a check"]), /unparseable eval check/);
});
