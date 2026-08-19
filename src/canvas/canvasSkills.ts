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

Ordinary body @name text does not grant Canvas write. Do not invent or expand canvasId, snapshotId, elementId, action, or grant scope. Destructive ops require confirmDestructive. Viewport suggestions are ephemeral; export is a file side effect; image_process and outline_text are deferred jobs.

## Canvas Operation Protocol

### Step-by-step workflow
1. **Read the scene first**: Always call canvas.scene_summary before any edit. Read FOCUS_FRAME_ID, SCENE_FRAMES, SCENE_NODES, ALLOWED_CREATE_PARENTS from the returned contextText.
2. **Plan your operations**: Decide which elements to create, where to place them, and which styles to apply. Prefer one typed tool call per clear action.
3. **Execute operations**: Call typed tools (prefer canvas.create_* / canvas.update_node over canvas.elements_apply).
4. **Verify the result**: Re-read canvas.scene_summary if placement or style is uncertain.
5. **Fix errors if any**: If a tool call failed, read LAST_CANVAS_ERROR (code/fix/detail) and retry with corrected parameters. Do not repeat the same invalid fill or missing args.

### Frame-first principle (画框优先)
- Poster / banner / H5 / mobile / deliverable plates → ALWAYS canvas.create_frame first at the deliverable size.
- Never replace an artboard with a full-bleed background rect.
- Exception: only if the user explicitly refuses frames (不要画框 / 自由画布 / 不要 create_frame).
- Multi-artboard: create one frame per board, populate it, then the next frame. Do not merge multiple posters into one tall/wide frame.
- If FOCUS_FRAME_ID is already set: place ALL new content inside that frame; do not emit another create_frame for it.
- New design while SCENE_FRAMES already has other boards: paint the new FOCUS plate only. Do not update_node / delete ambient SCENE ids unless the user asked.

### Size inference (do not ask)
- 竖版海报 / poster / KV → ~1080×1920
- 手机 UI / phone → ~390×844
- 横幅 / banner → wide short (e.g. 1920×600 or 1080×360)
- desktop dashboard / landing → ~1440×900 only when clearly a web layout
- Do not always default to 1440×900.

## Fill & Stroke Rules

### Solid fills
- Format: fill="#RRGGBB" or fill="rgba(r,g,b,a)" (also #RGB / #RRGGBBAA).
- Example: fill="#FF5733", fill="rgba(255,87,51,0.8)"
- ❌ NEVER use CSS: fill="linear-gradient(red,blue)" → REJECTED (code=invalid_fill)
- ❌ NEVER use named CSS colors such as "red" / "blue" — convert to hex.

### Gradient fills
- Set fillType=linear|radial|angular|diffuse
- Provide both fill (start color) and fillEnd (end color)
- Optional: gradientAngle in degrees
- Example vignette: fillType="radial", fill="rgba(0,0,0,0)", fillEnd="rgba(0,0,0,0.5)"
- Missing fillEnd → code=missing_gradient_end

### Strokes
- stroke="#RRGGBB" or "rgba(...)" — same solid-color rule as fill; CSS gradient → code=invalid_stroke
- borderWidth (number, px)
- strokeAlign: center (default) | inside | outside
  - center: stroke midline on shape edge, selection chrome sits on it
  - inside/outside: shift the stroke band
- strokeStyle: solid | dashed | dotted
- strokeLinecap: butt | round | square
- strokeLinejoin: miter | round | bevel
- strokeOpacity: 0–100

## Placement Rules

### Coordinate system
- Origin: top-left of canvas (or of the frame if the node has frameId)
- x increases rightward, y increases downward
- Units: CSS pixels, not physical mm/pt

### Parenting
- frameId: which frame this element belongs to (visual grouping / artboard)
- parentId: which group/container this element is a child of (hierarchy)
- Root elements: parentId="ROOT" or omit
- Frame id passed as parentId → server remaps to ROOT (frames cannot parent nodes)
- allowedCreateParents from scene_summary lists valid parent options

### Creating inside frames
- Use frameId from scene_summary FOCUS_FRAME_ID or SCENE_FRAMES
- Coordinates are relative to the frame origin when frameId is set
- Same-batch create_frame + content: set frameId on every create_* to that new frame id

### Multi-artboard workflow
1. canvas.create_frame({x:0, y:0, width:1080, height:1920, name:"Poster 1"})
2. Populate that frame (all nodes have frameId from step 1)
3. canvas.create_frame({x:1200, y:0, width:1080, height:1920, name:"Poster 2"})
4. Populate the second frame

## Typography Rules

### Font families
- Prefer faces listed in scene_summary AVAILABLE_FONTS when present
- Default safe faces: "Alibaba PuHuiTi", "Inter"
- Only use a named font when similarity ≥90% to the needed look
- Do NOT invent font names (e.g. do not make up "Playfair" if it is not in the list)
- Do NOT default-map 书法感 → Zhi Mang Xing

### When font doesn't match
- Hero / main titles below 90% match → keep create_text with a listed face, or place an imported asset via canvas.asset_import + canvas.create_image
- Image generation jobs are not available in this turn
- Do not force a "close enough" calligraphy font

### Text styling
- fontSize: number (px)
- fontWeight: "normal"|"bold"|"100"-"900" or number 100-900
- fill: solid color only (no gradients in text yet)
- Prefer update_node to change copy, size, color, or weight of an existing text node

## Tool selection

Prefer typed tools. canvas.elements_apply is a low-level batch compatibility path, not the default.

| Need | Tool |
|---|---|
| Read authorized scene | canvas.scene_summary |
| New deliverable plate | canvas.create_frame |
| Rectangle / circle / polygon / path / pencil | canvas.create_shape |
| Title / body copy | canvas.create_text |
| Place imported bitmap | canvas.asset_import then canvas.create_image(assetId) |
| Recolor / rewrite / resize / morph / cornerRadius | canvas.update_node |
| Artboard name / size / background / lock | canvas.update_frame |
| Align / distribute / reorder / group / flip / duplicate | canvas.align_nodes, canvas.distribute_nodes, canvas.reorder_nodes, canvas.group_nodes, canvas.ungroup_nodes, canvas.flip_nodes, canvas.duplicate_nodes |
| Cutout / combine shapes | canvas.boolean_op |
| Infinite-canvas background | canvas.set_canvas_background (only if GRANT actions include it) |
| Export a file | canvas.export |

Do not inspect project source to discover extra tools.

## Background & artboard rules

- Empty FOCUS frame background → canvas.update_frame({ frameId: FOCUS_FRAME_ID, backgroundColor: "#RRGGBB" })
- Do not update_node fills on other boards to "change the background"
- Do not create_shape a full-bleed underlay that pretends to be the artboard
- CLIENT / composer locked WxH (if present in the user message) wins over guessed sizes
- Names may collide (multiple "New board") — always use ids from SCENE_FRAMES / FOCUS_FRAME_ID, never retarget by name

## Destructive ops

- canvas.delete_nodes and frame deletion require confirmDestructive=true
- Never delete_nodes a frame id; that is a frame operation
- Never delete ambient SCENE ids on another board unless the user asked to change that board
- Cap ~8 new frames per step; finish populating one board before the next

## What scene_summary returns

Read the contextText block first. It is partitioned like this:

=== CANVAS_SCENE ===
canvasId, snapshotId, revision, FOCUS_FRAME_ID, CANVAS_SIZE

=== SCENE_FRAMES ===
- <frameId>: name x y width height backgroundColor? locked?

=== SCENE_NODES ===
- <nodeId>: key name x y w h parent frame style fill/stroke/shapeType text_preview?

=== GRANT ===
actions, createParents, selectedElements, selectedFrames

=== AVAILABLE_FONTS ===
listed faces you may pass as fontFamily

If FOCUS_FRAME_ID is "(none)", either the grant has multiple frames or none; do not invent a frame id. Use SCENE_FRAMES ids only.

## Icon Construction

### Prefer boolean_op over dumping SVG
- Simple icons → build from primitives (rect/circle/polygon) + canvas.boolean_op
- Examples:
  - Moon: large circle subtract small circle (mode=subtract)
  - Magnifier: circle union handle rect (mode=union)
  - Ring: outer circle subtract inner circle (mode=subtract)
- Only use create_svg for complex single-path marks
- Never use emoji or pictograph Unicode (🏠🔍❤️) inside create_text as an icon stand-in — labels are plain words only

### Path-based icons
- shapeType="pen" + path="M... L... Z" (closed path for filled silhouettes)
- Keep paths simple (under 2KB)

## Pencil Drawing (板绘)

### For Q-illustration / pencil sketch
- DO NOT collage with circles/ellipses
- Use multiple pencil strokes with pressure

### Pencil parameters
- shapeType="pencil"
- path: "M x1,y1 L x2,y2 L..." (only M and L commands)
- pathPressure: "0.5,0.8,1.0,0.6,..." (CSV, 0.05-1.0, same count as path points)
- brushStyle: solid|pencil-hb|soft|fountain|calligraphy|brushpen|marker|highlighter|chalk|charcoal|bristle|airbrush|watercolor|needle|bold
- brushHardness: 0-100 (default ~80, soft→hard tip)
- pressureEnabled: true (default when pathPressure set)
- stroke: color (required, no fill for pencil strokes)

## Edit protocol

- Prefer canvas.update_node on the same id; do not delete+create for type/recolor/rewrite/cornerRadius.
- Type morph: canvas.update_node({ nodeId, shapeType:"circle" }) — never delete then recreate the same id.
- Clear a board → canvas.delete_nodes / delete via frame tools with confirmDestructive; never fake-clear with a full-bleed cover rect.
- DELETE SAFETY: never canvas.delete_nodes an artboard/frame id (use the frame delete path). Use update_frame for artboard background/size/name/lock.
- Frame background: canvas.update_frame({ frameId, backgroundColor:"#FFF" })
- Infinite-canvas background (only when grant includes set_canvas_background): canvas.set_canvas_background({ fill:"#FFF" })

## Common Mistakes & Fixes

### ❌ Mistake: Using CSS gradients
canvas.create_shape({ fill: "linear-gradient(red, blue)", ... })
✅ Fix:
canvas.create_shape({ fillType: "linear", fill: "#FF0000", fillEnd: "#0000FF", gradientAngle: 90, ... })

### ❌ Mistake: Changing shape type or style by delete+create
canvas.delete_nodes({ ids: ["rect1"] })
canvas.create_shape({ shapeType: "circle", id: "rect1", ... })
✅ Fix:
canvas.update_node({ nodeId: "rect1", shapeType: "circle" })

### ❌ Mistake: Using frame id as parentId
canvas.create_text({ parentId: "frame1", ... })
✅ Fix:
canvas.create_text({ frameId: "frame1", parentId: "ROOT", ... })

### ❌ Mistake: Creating background with full-bleed rect
canvas.create_shape({ shapeType: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: "#FFF" })
✅ Fix:
canvas.update_frame({ frameId: "...", backgroundColor: "#FFF" })
or (only with the set_canvas_background grant action)
canvas.set_canvas_background({ fill: "#FFF" })

### ❌ Mistake: Named CSS color or missing fill on a "red circle"
canvas.create_shape({ shapeType: "circle", fill: "red" })
✅ Fix:
canvas.create_shape({ shapeType: "circle", fill: "#FF0000", fillType: "solid", x, y, width, height, frameId })
`;

export function canvasSkillPackText(grants: CanvasAccessGrantRow[], lastError?: string | null): string {
  if (!grants.length) return "";
  const lines = [
    "## Canvas skill pack",
    ...(lastError ? [canvasLastErrorContextLine(lastError)] : []),
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

const LAST_CANVAS_ERROR_RETRY = "The previous canvas operation failed. Review the fix suggestion and retry with corrected parameters.";

export function canvasLastErrorContextLine(errorLine: string): string {
  const parsed = parseCanvasOpError(errorLine);
  const header = parsed
    ? `LAST_CANVAS_ERROR: code=${parsed.code}${parsed.fix ? `; fix=${parsed.fix}` : ""}${parsed.detail ? `; detail=${parsed.detail}` : ""}`
    : `LAST_CANVAS_ERROR: ${errorLine}`;
  return `${header}\n${LAST_CANVAS_ERROR_RETRY}`;
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
