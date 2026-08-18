import type { CanvasAccessGrantRow } from "./canvasAccessGrant.js";

export const CANVAS_CAPABILITY_DISCOVERY = `If capability.describe lists canvas.read/write/export, this turn has a server-owned CanvasAccessGrant derived from a frozen Selection Snapshot. Discover tools with capability.describe. Use canvas.snapshot_get for the authorized immutable snapshot, canvas.elements_get for live authorized objects, and canvas.elements_apply to map Recombyn ToolOps onto Canvas Core. Ordinary body @name text does not grant Canvas write. Do not invent or expand canvasId, snapshotId, elementId, action, or grant scope. Destructive ops require confirmDestructive. Viewport suggestions are ephemeral; export is a file side effect; image_process and outline_text are deferred jobs. Commit mutations with turn.reply outputRefs of kind canvas_mutation; never treat sourceRefs as output artifacts.`;

export function canvasSkillPackText(grants: CanvasAccessGrantRow[]): string {
  if (!grants.length) return "";
  const lines = [
    "## Canvas skill pack",
    CANVAS_CAPABILITY_DISCOVERY,
    "Authorized grants:",
    ...grants.map((grant) => {
      const scope = grant.objectScope;
      return `- grant ${grant.id} snapshot=${grant.snapshotId} canvas=${grant.canvasId} actions=${grant.actions.join(",")} empty=${scope.emptySelection ? "yes" : "no"} elements=${scope.elementIds.join(",") || "—"} frames=${scope.frameIds.join(",") || "—"} createParents=${scope.createParents.join(",") || "—"} expiresAt=${grant.expiresAt.toISOString()}`;
    }),
    "ToolOps durable subset: update_node, create_shape, create_text, create_image(assetId), create_svg, create_lottie(assetId), create_icon(assetId), create_frame, update_frame, delete_frame, delete_nodes, align_nodes, distribute_nodes, reorder_nodes, group_nodes, ungroup_nodes, duplicate_nodes, flip_nodes, boolean_op, set_canvas_background.",
    "Not scene-batch: set_viewport (suggestion), export_canvas (canvas.export), image_process (deferred), outline_text (deferred).",
  ];
  return lines.join("\n");
}
