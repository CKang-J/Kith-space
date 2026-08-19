import { desc, eq, inArray } from "drizzle-orm";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import type { CanvasAccessGrantRow } from "./canvasAccessGrant.js";
import { parseCanvasOpError } from "./canvasToolOps.js";

export const CANVAS_LAST_ERROR_TOOL = "canvas.last_error";
export const CANVAS_LAST_ERROR_KEY = "canvas:last_error";

export const CANVAS_CAPABILITY_DISCOVERY = `This turn has a server-owned CanvasAccessGrant derived from a frozen Selection Snapshot. Discover tools with capability.describe.

Do not inspect project source code, repository files, or Canvas implementation to learn how to operate the canvas.

You decide whether this turn is edit, question, read, or export. The server does not classify that from the user's wording, and it will not inject a heuristic mutation requirement. Chinese questions such as “怎么添加文字” or “如何修改 Frame” are questions unless you judge the user asked you to actually change the canvas.

If you judge this is an edit (draw, add text/images, modify Frames, layout, or otherwise change the authorized selection):
1. Call canvas.scene_summary (canvas.snapshot_get only when you need the immutable historical snapshot).
2. Inspect existing objects with canvas.elements_get when needed. Create inside allowedCreateParents from scene_summary. Frame ids belong in frameId; node parentId is ROOT or a group (a Frame id passed as parentId is remapped).
3. Call typed tools: canvas.create_frame, canvas.create_text, canvas.create_shape, canvas.create_image, canvas.update_node, canvas.delete_nodes, canvas.update_frame, canvas.align_nodes, canvas.distribute_nodes, canvas.reorder_nodes, canvas.group_nodes, canvas.ungroup_nodes, canvas.duplicate_nodes, canvas.flip_nodes, canvas.boolean_op, canvas.set_canvas_background. canvas.elements_apply remains a low-level batch compatibility tool, not the default. If LAST_CANVAS_ERROR is present, fix that code first — do not repeat the same invalid fill/args.
4. After a write, read mutationId, revision, createdIds, updatedIds, deletedIds, and nextSuggestedAction. Re-run canvas.scene_summary if you need to verify placement.
5. Only after a mutation is committed, call turn.reply and include outputRefs of kind canvas_mutation with that mutationId. Never treat sourceRefs as canvas output.
6. Do not claim the canvas was drawn or edited unless a Canvas mutation actually committed.

If you judge this is a question, capability explanation, selection read, or export, do not mutate. Answer from scene_summary / snapshot_get / elements_get, or call canvas.export. turn.reply without a mutation is allowed.

The server does not hard-refuse turn.reply from natural-language intent (there is no Agent finish/intent tool yet). It only checks Grant/action, whether a mutation committed, and that outputRefs bind this turn's mutations. Use turn.cede if you must ask a blocking question instead of claiming an edit is done.

canvas.create_image accepts an existing assetId that already belongs to this Canvas. Import a turn-bound local attachment with canvas.asset_import first. Remote URLs, data URLs, and genPrompt are rejected. Cross-canvas or missing assets are rejected. Image generation jobs are not available in this turn.

Ordinary body @name text does not grant Canvas write. Do not invent or expand canvasId, snapshotId, elementId, action, or grant scope. Destructive ops require confirmDestructive. Viewport suggestions are ephemeral; export is a file side effect; image_process and outline_text are deferred jobs.`;

export function canvasSkillPackText(grants: CanvasAccessGrantRow[]): string {
  if (!grants.length) return "";
  const lines = [
    "## Canvas skill pack",
    CANVAS_CAPABILITY_DISCOVERY,
    "Authorized grants:",
    ...grants.map((grant) => {
      const scope = grant.objectScope;
      return `- grant ${grant.id} snapshot=${grant.snapshotId} canvas=${grant.canvasId} actions=${grant.actions.join(",")} empty=${scope.emptySelection ? "yes" : "no"} elements=${scope.elementIds.join(",") || "—"} frames=${scope.frameIds.join(",") || "—"} createParents=${scope.createParents.join(",") || "—"} expiresAt=${grant.expiresAt instanceof Date ? grant.expiresAt.toISOString() : "—"}`;
    }),
    "Preferred tools: canvas.scene_summary, canvas.create_frame, canvas.create_text, canvas.create_shape, canvas.create_image(assetId), canvas.update_node, canvas.delete_nodes, canvas.update_frame, canvas.align_nodes, canvas.distribute_nodes, canvas.reorder_nodes, canvas.group_nodes, canvas.ungroup_nodes, canvas.duplicate_nodes, canvas.flip_nodes, canvas.boolean_op, canvas.set_canvas_background.",
    "Compatibility: canvas.elements_apply still maps a ToolOps list onto Canvas Core. Prefer typed tools.",
    "Also available: canvas.snapshot_get, canvas.elements_get, canvas.export, canvas.context_bundle_create, canvas.asset_import.",
    "ToolOps durable subset if using elements_apply: update_node, create_shape, create_text, create_image(assetId), create_svg, create_lottie(assetId), create_icon(assetId), create_frame, update_frame, delete_frame, delete_nodes, align_nodes, distribute_nodes, reorder_nodes, group_nodes, ungroup_nodes, duplicate_nodes, flip_nodes, boolean_op, set_canvas_background.",
    "Not scene-batch: set_viewport (suggestion), export_canvas (canvas.export), image_process (deferred), outline_text (deferred).",
  ];
  return lines.join("\n");
}

export function canvasLastErrorContextLine(errorLine: string): string {
  const parsed = parseCanvasOpError(errorLine);
  if (parsed) {
    return `LAST_CANVAS_ERROR: code=${parsed.code}${parsed.fix ? `; fix=${parsed.fix}` : ""}${parsed.detail ? `; detail=${parsed.detail}` : ""}`;
  }
  return `LAST_CANVAS_ERROR: ${errorLine}`;
}

/** Latest failed canvas tool in this runtime session. A later success clears injection. */
export function latestCanvasErrorForTurn(
  db: SpaceDb,
  turnId: string,
): string | null {
  const turn = db.select({ runtimeSessionId: schema.agentTurns.runtimeSessionId })
    .from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get();
  if (!turn) return null;
  const turns = db.select({ id: schema.agentTurns.id }).from(schema.agentTurns)
    .where(eq(schema.agentTurns.runtimeSessionId, turn.runtimeSessionId)).all();
  if (!turns.length) return null;
  const ops = db.select({
    toolName: schema.turnOperations.toolName,
    status: schema.turnOperations.status,
    errorCode: schema.turnOperations.errorCode,
    updatedAt: schema.turnOperations.updatedAt,
  }).from(schema.turnOperations)
    .where(inArray(schema.turnOperations.turnId, turns.map((turn) => turn.id)))
    .orderBy(desc(schema.turnOperations.updatedAt))
    .all()
    .filter((op) => op.toolName.startsWith("canvas."));
  const latest = ops[0];
  if (!latest) return null;
  if (latest.toolName === CANVAS_LAST_ERROR_TOOL) {
    return latest.status === "failed" && latest.errorCode ? latest.errorCode : null;
  }
  if (latest.status === "failed" && latest.errorCode) return latest.errorCode;
  return null;
}
