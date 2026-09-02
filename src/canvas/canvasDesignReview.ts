import type { SpaceTransaction } from "../counters.js";
import type { SpaceDb } from "../db/index.js";
import type { TurnCapabilityClaims } from "../capabilities/contracts.js";
import { CanvasToolError } from "./canvasToolOps.js";
import { assembleCanvasSceneSummaryInTransaction } from "./canvasSceneSummary.js";
import type { CanvasSceneFacts } from "./canvasSceneFacts.js";
import { loadSkill } from "./skills/skillLoader.js";

/** 维度表 + 阈值两节（design_review.md 的 "## Dimensions & caps" 至 "## What you judge" 之前）。 */
export function extractDesignReviewRubric(content: string): string {
  const start = content.indexOf("## Dimensions & caps");
  const end = content.indexOf("## What you judge");
  if (start === -1) return content.trim();
  return content.slice(start, end === -1 ? undefined : end).trim();
}

export const CANVAS_DESIGN_REVIEW_SCORING_CONTRACT = [
  "Self-score every dimension within its cap; the total must be honest (caps sum to 100).",
  "- total < 70: rework (must_fix) — do not settle this turn",
  "- total 70-89: fix majors with subtraction / polish, then re-review",
  "- total >= 90: pass only if no blocker / major / slop hits remain",
  "Every must_fix item must be fixed before turn.reply settles the turn.",
  "Prioritize DESIGN_BRIEF fidelity, then SKILL_CRAFT. Never invent geometry facts — read them from SCENE_FACTS.",
].join("\n");

export type CanvasDesignReviewResult = {
  canvasId: string;
  snapshotId: string;
  grantId: string;
  revision: number;
  focusFrameId: string | null;
  sceneFacts: CanvasSceneFacts | null;
  rubric: string;
  scoringContract: string;
  contextText: string;
  nextSuggestedAction: string;
};

/** In-turn design review dossier: scene summary + facts + rubric + scoring contract, grant-scoped. */
export function executeCanvasDesignReview(
  db: SpaceDb,
  tx: SpaceTransaction,
  spaceId: string,
  claims: TurnCapabilityClaims,
  now: number,
): CanvasDesignReviewResult {
  const { summary, sceneFacts } = assembleCanvasSceneSummaryInTransaction(db, tx, spaceId, claims, {}, now);
  const skill = loadSkill("design_review");
  if (!skill) {
    throw new CanvasToolError(
      "skill_not_found",
      "design_review skill pack is required for canvas.design_review",
      "design_review skill is missing from the packaged skill set",
    );
  }
  const rubric = extractDesignReviewRubric(skill.content);
  const contextText = [
    summary.contextText,
    "",
    "=== DESIGN_REVIEW_RUBRIC ===",
    rubric,
    "",
    "=== SCORING_CONTRACT ===",
    CANVAS_DESIGN_REVIEW_SCORING_CONTRACT,
  ].join("\n");
  return {
    canvasId: summary.canvasId,
    snapshotId: summary.snapshotId,
    grantId: summary.grantId,
    revision: summary.revision,
    focusFrameId: summary.focusFrameId,
    sceneFacts,
    rubric,
    scoringContract: CANVAS_DESIGN_REVIEW_SCORING_CONTRACT,
    contextText,
    nextSuggestedAction: "Score each dimension within its cap and list must_fix items. Fix every must_fix, re-run canvas.design_review if the scene changed, then turn.reply.",
  };
}
