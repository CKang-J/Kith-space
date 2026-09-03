import type { CanvasJson } from "./canvasTypes.js";
import { computeCanvasSceneFacts, type CanvasSceneFacts } from "./canvasSceneFacts.js";

/**
 * 确定性 eval 检查项，字符串 DSL 语法 `name` 或 `name[arg1,arg2]`：
 * - hero_coverage_between[min,max]      主视觉面积占可视区比例（含端点）
 * - no_out_of_bounds                    无越界节点（frame 内与画布内均不越出）
 * - h1_h2_ratio_between[min,max]        最大/次大字号比（需 ≥2 个不同字号）
 * - anti_slop_hits_eq[n]                anti-slop 命中总数等于 n
 * - node_count_at_least[n]              节点总数 ≥ n
 * - text_nodes_at_least[n]              文本节点数 ≥ n
 */
export type CanvasEvalCheck = string;

export type CanvasEvalCheckResult = {
  check: CanvasEvalCheck;
  pass: boolean;
  actual: number | string | null;
  detail: string;
};

export type CanvasEvalReport = {
  checks: CanvasEvalCheckResult[];
  passed: boolean;
  passedCount: number;
  totalCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sceneNodes(document: CanvasJson): Array<Record<string, unknown>> {
  const root = asRecord(document) ?? {};
  const nodes = asRecord(root.deltaSetLike) ?? {};
  return Object.entries(nodes).flatMap(([id, value]) => {
    const record = asRecord(value);
    return record && id !== "ROOT" ? [record] : [];
  });
}

function isTextNodeLike(node: Record<string, unknown>): boolean {
  if (node.key === "text") return true;
  if (typeof node.text === "string" && node.text.trim()) return true;
  const fontSize = node.fontSize;
  if (typeof fontSize === "number" && fontSize > 0) return true;
  const attrs = asRecord(node.attrs) ?? {};
  if (typeof attrs.text === "string" && attrs.text.trim()) return true;
  return typeof attrs.fontSize === "number" && attrs.fontSize > 0;
}

function antiSlopHitCount(facts: CanvasSceneFacts): number {
  return facts.antiSlop.gradientFillCount
    + (facts.antiSlop.purpleBlueGradient ? 1 : 0)
    + facts.antiSlop.emojiNodeIds.length
    + facts.antiSlop.translucentWhiteNodeIds.length
    + facts.antiSlop.excessiveRoundingNodeIds.length;
}

function parseRange(raw: string): [number, number] {
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(`invalid range args in eval check: expected [min,max]`);
  }
  return [parts[0]!, parts[1]!];
}

function parseCount(raw: string): number {
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) throw new Error(`invalid count arg in eval check: expected a number`);
  return value;
}

function betweenInclusive(value: number | null, min: number, max: number): boolean {
  return value != null && value >= min && value <= max;
}

/** 逐项求值；未知检查项直接抛错（eval 套件必须写对检查名，fail loudly）。 */
export function evaluateCanvasChecks(document: CanvasJson, checks: readonly CanvasEvalCheck[]): CanvasEvalReport {
  const facts = computeCanvasSceneFacts(document);
  const nodes = sceneNodes(document);
  const textNodes = nodes.filter(isTextNodeLike);
  const results = checks.map((check): CanvasEvalCheckResult => {
    const match = /^([a-z0-9_]+)(?:\[(.+)\])?$/.exec(check.trim());
    if (!match) throw new Error(`unparseable eval check: ${check}`);
    const [, name, argsRaw] = match;
    const args = argsRaw ?? "";
    switch (name) {
      case "hero_coverage_between": {
        const [min, max] = parseRange(args);
        const pass = betweenInclusive(facts.heroCoverage, min, max);
        return {
          check,
          pass,
          actual: facts.heroCoverage,
          detail: facts.heroCoverage == null
            ? "hero_coverage unavailable (no frame and no canvas size)"
            : `hero_coverage ${facts.heroCoverage} vs [${min}, ${max}]`,
        };
      }
      case "no_out_of_bounds": {
        const count = facts.outOfFrame.length + facts.outOfCanvas.length;
        return {
          check,
          pass: count === 0,
          actual: count,
          detail: count === 0 ? "no out-of-bounds nodes" : `${count} out-of-bounds nodes: ${[...facts.outOfFrame.map((item) => item.id), ...facts.outOfCanvas].join(", ")}`,
        };
      }
      case "h1_h2_ratio_between": {
        const [min, max] = parseRange(args);
        const pass = betweenInclusive(facts.h1H2Ratio, min, max);
        return {
          check,
          pass,
          actual: facts.h1H2Ratio,
          detail: facts.h1H2Ratio == null
            ? `h1_h2_ratio unavailable (h1=${facts.h1Size}, h2=${facts.h2Size}; needs two distinct text sizes)`
            : `h1_h2_ratio ${facts.h1H2Ratio} vs [${min}, ${max}]`,
        };
      }
      case "anti_slop_hits_eq": {
        const expected = parseCount(args);
        const hits = antiSlopHitCount(facts);
        return {
          check,
          pass: hits === expected,
          actual: hits,
          detail: `anti-slop hits ${hits} (gradient=${facts.antiSlop.gradientFillCount}, purple_blue=${facts.antiSlop.purpleBlueGradient}, emoji=${facts.antiSlop.emojiNodeIds.length}, translucent_white=${facts.antiSlop.translucentWhiteNodeIds.length}, excessive_rounding=${facts.antiSlop.excessiveRoundingNodeIds.length})`,
        };
      }
      case "node_count_at_least": {
        const min = parseCount(args);
        return {
          check,
          pass: nodes.length >= min,
          actual: nodes.length,
          detail: `${nodes.length} nodes vs at least ${min}`,
        };
      }
      case "text_nodes_at_least": {
        const min = parseCount(args);
        return {
          check,
          pass: textNodes.length >= min,
          actual: textNodes.length,
          detail: `${textNodes.length} text nodes vs at least ${min}`,
        };
      }
      default:
        throw new Error(`unknown eval check type: ${name}`);
    }
  });
  return {
    checks: results,
    passed: results.every((result) => result.pass),
    passedCount: results.filter((result) => result.pass).length,
    totalCount: results.length,
  };
}
