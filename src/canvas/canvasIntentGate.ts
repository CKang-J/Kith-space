import type { CanvasAccessGrantRow } from "./canvasAccessGrant.js";

export type CanvasTurnIntent = "edit" | "question" | "read" | "export" | "unknown";

export type CanvasEditCompletion = {
  intent: CanvasTurnIntent;
  mutationRequired: boolean;
  mutationPresent: boolean;
  canClaimComplete: boolean;
  reason: string;
  nextSuggestedAction: string;
  /** Reply is never hard-rejected from intent. There is no Agent finish/intent tool yet. */
  enforcedOnReply: false;
};

/**
 * Post-hoc policy/telemetry only. Natural-language regex classification is retired:
 * the Canvas skill tells the Agent to decide edit/question/read/export.
 * Without an explicit Agent-declared intent, this is always unknown.
 */
export function classifyCanvasTurnIntent(explicitIntent?: CanvasTurnIntent | null): CanvasTurnIntent {
  if (
    explicitIntent === "edit"
    || explicitIntent === "question"
    || explicitIntent === "read"
    || explicitIntent === "export"
  ) {
    return explicitIntent;
  }
  return "unknown";
}

export function grantAllowsCanvasWrite(grants: CanvasAccessGrantRow[]): boolean {
  return grants.some((grant) => (
    grant.actions.includes("create")
    || grant.actions.includes("write_existing")
    || grant.actions.includes("delete_existing")
  ));
}

export function evaluateCanvasEditCompletion(input: {
  intent: CanvasTurnIntent;
  grants: CanvasAccessGrantRow[];
  committedMutationCount: number;
}): CanvasEditCompletion {
  const write = grantAllowsCanvasWrite(input.grants);
  const mutationPresent = input.committedMutationCount > 0;
  // Only an explicit Agent-declared "edit" may mark mutationRequired for telemetry.
  // Unknown/question/read/export never force a mutation from wording.
  const mutationRequired = write && input.intent === "edit";
  const canClaimComplete = !mutationRequired || mutationPresent;
  if (!write) {
    return {
      intent: input.intent,
      mutationRequired: false,
      mutationPresent,
      canClaimComplete: true,
      reason: "no Canvas write grant; question/read/export replies are allowed",
      nextSuggestedAction: "Answer from canvas.scene_summary or canvas.snapshot_get. Do not mutate.",
      enforcedOnReply: false,
    };
  }
  if (input.intent === "question" || input.intent === "read" || input.intent === "export") {
    return {
      intent: input.intent,
      mutationRequired: false,
      mutationPresent,
      canClaimComplete: true,
      reason: "explicit intent is question/read/export; mutation is optional",
      nextSuggestedAction: input.intent === "export"
        ? "Use canvas.export. Do not claim a scene edit."
        : "Use canvas.scene_summary / snapshot_get / elements_get. Mutate only if you judged this turn to be an edit.",
      enforcedOnReply: false,
    };
  }
  if (mutationRequired && !mutationPresent) {
    return {
      intent: input.intent,
      mutationRequired: true,
      mutationPresent: false,
      canClaimComplete: false,
      reason: "explicit edit intent with a write grant expects a committed mutation before claiming complete",
      nextSuggestedAction: "Call canvas.scene_summary, then a typed create/update/delete tool. After mutation feedback, turn.reply with outputRefs.kind=canvas_mutation. Use turn.cede to ask a blocking question.",
      enforcedOnReply: false,
    };
  }
  return {
    intent: input.intent,
    mutationRequired,
    mutationPresent,
    canClaimComplete: true,
    reason: mutationPresent
      ? "at least one Canvas mutation is committed"
      : "intent is unknown; the server does not force a mutation from natural language",
    nextSuggestedAction: mutationPresent
      ? "Verify with canvas.scene_summary if needed, then turn.reply with outputRefs.kind=canvas_mutation."
      : "If you judged this an edit, call typed Canvas tools before claiming complete. Pure Q&A may turn.reply without a mutation.",
    enforcedOnReply: false,
  };
}

/**
 * Reply-time seam. Completing a hard finish/reply reject here would false-positive
 * clarifying questions, and there is no reliable Agent-declared finish/intent input.
 * Callers may record the evaluation; they must not pretend turn.reply currently
 * refuses completion without a mutation.
 */
export function inspectCanvasReplyCompletion(input: {
  intent: CanvasTurnIntent;
  grants: CanvasAccessGrantRow[];
  committedMutationCount: number;
}): CanvasEditCompletion {
  return evaluateCanvasEditCompletion(input);
}
