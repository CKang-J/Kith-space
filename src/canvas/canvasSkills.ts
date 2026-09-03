import { desc, eq, inArray } from "drizzle-orm";
import type { SpaceDb } from "../db/index.js";
import { schema } from "../db/index.js";
import type { CanvasAccessGrantRow } from "./canvasAccessGrant.js";
import { parseCanvasOpError } from "./canvasToolOps.js";
import { loadSkill } from "./skills/skillLoader.js";
import { listSkills } from "./skills/skillRegistry.js";
import { matchedSkillKeys } from "./skills/skillTriggers.js";

export const CANVAS_LAST_ERROR_TOOL = "canvas.last_error";
export const CANVAS_LAST_ERROR_KEY = "canvas:last_error";

export const CANVAS_DESIGN_PRINCIPLES = `
## Design Decision Framework

### Medium Selection (何时用 shape vs image)
- Simple geometry (icons, buttons, basic shapes) → create_shape + boolean_op
- Typography with catalog fonts (≥90% match) → create_text + fontFamily
- Hero lettering (calligraphy, decorative titles) → create_image with genPrompt + letteringText
- Atmosphere / materials / photo-realistic elements → create_image with genPrompt
- **Never use emoji (🏠🔍❤️🧘👋) in create_text as icons or decorations**

### Icon Construction Hierarchy (如何构建复杂图标)
1. **Primitives + boolean_op** (moon = large circle subtract small circle)
2. **create_shape with pen path** (closed path for filled silhouettes)
3. **canvas.create_svg / canvas.create_icon** (only for complex single-path marks that can't be built from primitives)

Examples:
- Moon: create_shape circle (large) + create_shape circle (small) → boolean_op mode=subtract
- Magnifier: create_shape circle (lens) + create_shape rect (handle) → boolean_op mode=union
- Ring: create_shape circle (outer) + create_shape circle (inner) → boolean_op mode=subtract
- Heart: create_shape pen with path="M150,50 C125,25 75,50 150,150 C225,50 175,25 150,50 Z"

### Composition Hard Rules (量化指标)
When creating posters / banners / KV:
- hero_coverage: 60-85% of the artboard
- text_area: ≤20% of the artboard
- primary_focal: exactly 1 (one hero element)
- secondary_focal: ≤2 (optional supporting elements)
- empty_space: ≥15% (breathing room, not filled)
- cta: ≤1 (one call-to-action, or omit if none provided)

### Anti AI Slop (禁止 AI 陈词滥调)
**Never** use these unless the user explicitly requests them or the design brief justifies them:
- Purple-blue gradients (fillType=linear fill="#9333EA" fillEnd="#3B82F6")
- Glassmorphism (semi-transparent cards with blur)
- Random particle effects (decorative dots/circles)
- Emoji as icons (🏠🔍❤️) inside create_text
- Three equal-sized feature cards layout
- Excessive corner rounding (cornerRadius > width/4)
- Generic "floating 3D objects" without design rationale

### Execution Order (Brief → Paint → Review)
1. **BRIEF**: Define purpose, audience, emotion, visual_thesis, composition archetype
2. **ART DIRECTION**: Choose palette roles (primary/accent/ground), type ladder (title/support/meta)
3. **LAYOUT PLAN**: Pick one composition archetype (center_hero / bottom_weighted / rule_of_thirds / editorial / typographic)
4. **EXECUTION**: create_frame → ground (update_frame backgroundColor) → hero marks (shapes/boolean_op) → title (create_text) → support → CTA → sparse decoration
5. **OBSERVE**: Re-read canvas.scene_summary to verify placement and hierarchy
6. **REVIEW**: Self-check against the design_review dimensions — hierarchy (title > support > meta), color contrast, slop hits
7. **SUBTRACT**: Second pass removes unnecessary decoration, not adds more

### Honesty Rule
Unless the user provides them, **do not invent**:
- Logos, brand marks, QR codes
- Prices, phone numbers, review counts
- Extra slogans or marketing copy
- Product images or photos

### Settle gate (before turn.reply)
After the final canvas mutation and before turn.reply, call canvas.design_review (no args) to load the review dossier: grant-scoped scene summary + SCENE_FACTS + rubric caps + scoring contract. Self-score every dimension within its cap (0-100 total; <70 rework, 70-89 fix majors, >=90 pass), fix every must_fix item, then settle. Prioritize DESIGN_BRIEF fidelity, then SKILL_CRAFT.
`;

export const CANVAS_CAPABILITY_DISCOVERY = `This turn has a server-owned CanvasAccessGrant derived from a frozen Selection Snapshot. Discover tools with capability.describe.

Do not inspect project source code, repository files, or Canvas implementation to learn how to operate the canvas.

You decide whether this turn is edit, question, read, or export. The server does not classify that from the user's wording, and it will not inject a heuristic mutation requirement. Chinese questions such as “怎么添加文字” or “如何修改 Frame” are questions unless you judge the user asked you to actually change the canvas.

If you judge this is an edit (draw, add text/images, modify Frames, layout, or otherwise change the authorized selection):
1. Call canvas.scene_summary (canvas.snapshot_get only when you need the immutable historical snapshot).
2. Inspect existing objects with canvas.elements_get when needed. Create inside allowedCreateParents from scene_summary. Frame ids belong in frameId; node parentId is ROOT or a group (a Frame id passed as parentId is remapped).
3. Call typed tools: canvas.create_frame, canvas.create_text, canvas.create_shape, canvas.create_image, canvas.create_svg, canvas.create_icon, canvas.update_node, canvas.delete_nodes, canvas.update_frame, canvas.align_nodes, canvas.distribute_nodes, canvas.reorder_nodes, canvas.group_nodes, canvas.ungroup_nodes, canvas.duplicate_nodes, canvas.flip_nodes, canvas.boolean_op, canvas.set_canvas_background. canvas.elements_apply remains a low-level batch compatibility tool, not the default. If LAST_CANVAS_ERROR is present, fix that code first — do not repeat the same invalid fill/args.
4. After a write, read mutationId, revision, createdIds, updatedIds, deletedIds, and nextSuggestedAction. Re-run canvas.scene_summary if you need to verify placement.
5. Only after a mutation is committed, call turn.reply and include outputRefs of kind canvas_mutation with that mutationId. Never treat sourceRefs as canvas output.
6. Do not claim the canvas was drawn or edited unless a Canvas mutation actually committed.

If you judge this is a question, capability explanation, selection read, or export, do not mutate. Answer from scene_summary / snapshot_get / elements_get, or call canvas.export. turn.reply without a mutation is allowed.

The server does not hard-refuse turn.reply from natural-language intent (there is no Agent finish/intent tool yet). It only checks Grant/action, whether a mutation committed, and that outputRefs bind this turn's mutations. Use turn.cede if you must ask a blocking question instead of claiming an edit is done.

canvas.create_image accepts either an existing Canvas assetId or genPrompt for a queued Doubao image job. Import a turn-bound local attachment with canvas.asset_import first when you already have a file. Remote URLs and data URLs are rejected. Cross-canvas or missing assets are rejected. Generation returns jobId immediately; poll canvas.generation_status with that jobId until status=completed, then confirm the node with canvas.scene_summary (image about 10–60s, video 1–5 minutes). Do not claim the image exists until scene_summary shows it. Use canvas.video_generate for short video clips.

Ordinary body @name text does not grant Canvas write. Do not invent or expand canvasId, snapshotId, elementId, action, or grant scope. Destructive ops require confirmDestructive. Viewport suggestions are ephemeral; export is a file side effect; image_process and outline_text are deferred jobs.

If the frozen canvas_selection_snapshot payload includes markedRegions, the Human boxed those image-local rects on the named node (nx,ny,nw,nh are 0–1 of node width/height). A cropped PNG attachment is the same area. Edit that area; do not paste markedRegions, node_id, or this instruction into the visible chat reply.

## Canvas Operation Protocol

### Step-by-step workflow
1. **New poster / landing / banner**: Call canvas.skill_list, then canvas.skill_get for ONE primary surface skill (poster_craft / landing_page / banner_ad) plus design_brief. Recolor or rearrange existing nodes: skip skills and use typed tools.
2. **Read the scene first**: Always call canvas.scene_summary before any edit. Read FOCUS_FRAME_ID, SCENE_FRAMES, SCENE_NODES, ALLOWED_CREATE_PARENTS from the returned contextText.
3. **Plan your operations**: Decide which elements to create, where to place them, and which styles to apply. Prefer one typed tool call per clear action.
4. **Execute operations**: Call typed tools (prefer canvas.create_* / canvas.update_node over canvas.elements_apply).
5. **Verify the result**: Re-read canvas.scene_summary if placement or style is uncertain.
6. **Fix errors if any**: If a tool call failed, read LAST_CANVAS_ERROR (code/fix/detail) and retry with corrected parameters. Do not repeat the same invalid fill or missing args.

### Frame-first principle (画框优先)
- Poster / banner / H5 / mobile / deliverable plates → ALWAYS canvas.create_frame first at the deliverable size.
- Never replace an artboard with a full-bleed background rect.
- Exception: only if the user explicitly refuses frames (不要画框 / 自由画布 / 不要 create_frame).
- Multi-artboard: create one frame per board, populate it, then the next frame. Do not merge multiple posters into one tall/wide frame.
- If FOCUS_FRAME_ID is already set to a real frame id (not "(none)"):
  1. Use that Frame. Do NOT call canvas.create_frame.
  2. Every create_text / create_shape / create_image MUST pass frameId=FOCUS_FRAME_ID.
  3. x/y are **frame-local**: 0,0 is the top-left of that Frame, not the infinite canvas.
  4. Do not place content on ROOT / the empty canvas around the Frame.
- If FOCUS_FRAME_ID is "(none)" (empty selection / whole-canvas grant) and you are creating a new design (poster/banner):
  1. Create a new frame first with canvas.create_frame at the deliverable size. Do NOT treat an existing SCENE_FRAMES id as the target unless the user named it.
  2. Then place all content inside it (frameId of that new frame; x/y frame-local).
  3. ROOT is allowed as a parent so you can create that new Frame; do not dump titles/shapes onto the empty canvas around existing boards.
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
- Stored scene coordinates are canvas-absolute. **create_*/update_node x/y when frameId is set are frame-local** (0,0 = that Frame's top-left). The host converts to canvas-absolute.
- x increases rightward, y increases downward. Units: CSS pixels, not physical mm/pt.
- SCENE_NODES lists canvas-absolute x/y. When a node is inside FOCUS_FRAME_ID it also lists local_x/local_y — use those for placement inside the Frame.
- Example: FOCUS frame at canvas x=1200 y=0, 1080×1920. A title 80px from the top of the poster is create_text({ frameId: FOCUS_FRAME_ID, x: 40, y: 80, ... }) — not x=1240.

### Parenting
- frameId: which frame this element belongs to (visual grouping / artboard)
- parentId: which group/container this element is a child of (hierarchy)
- Root elements: parentId="ROOT" or omit
- Frame id passed as parentId → server remaps to ROOT (frames cannot parent nodes)
- allowedCreateParents from scene_summary lists valid parent options. When FOCUS_FRAME_ID is set, ROOT is not a place to dump new artwork.

### Creating inside frames
- If FOCUS_FRAME_ID has a value, ALL new elements must set frameId=FOCUS_FRAME_ID.
- Coordinates are frame-local when frameId is set.
- Same-batch create_frame + content: set frameId on every create_* to that new frame id; x/y are local to that new frame.

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
- Hero / main titles below 90% match → create_image with genPrompt + letteringText, or keep create_text with a listed face
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
| List design skills | canvas.skill_list |
| Load a design playbook | canvas.skill_get (skillKey from skill_list) |
| New deliverable plate | canvas.create_frame |
| Rectangle / circle / polygon / path / pencil | canvas.create_shape |
| Title / body copy | canvas.create_text |
| Place imported bitmap | canvas.asset_import then canvas.create_image(assetId) |
| Generate atmosphere / lettering / product still | canvas.create_image(genPrompt) |
| Generate a short video | canvas.video_generate |
| Raw SVG mark / compact icon | canvas.create_svg / canvas.create_icon |
| Recolor / rewrite / resize / morph / cornerRadius | canvas.update_node |
| Artboard name / size / background / lock | canvas.update_frame |
| Align / distribute / reorder / group / flip / duplicate | canvas.align_nodes, canvas.distribute_nodes, canvas.reorder_nodes, canvas.group_nodes, canvas.ungroup_nodes, canvas.flip_nodes, canvas.duplicate_nodes |
| Cutout / combine shapes | canvas.boolean_op |
| Infinite-canvas background | canvas.set_canvas_background (only if GRANT actions include it) |
| Delete an artboard | canvas.delete_frame (confirmDestructive) |
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

=== SCENE_FACTS ===
Computed layout facts for design_review self-scoring (informational, not error alerts):
hero_coverage, whitespace, h1_h2_ratio, out_of_frame, out_of_canvas, overlap, anti_slop

=== GRANT ===
actions, createParents, selectedElements, selectedFrames

=== AVAILABLE_FONTS ===
listed faces you may pass as fontFamily

If FOCUS_FRAME_ID is a real id, every create_* MUST set frameId to that id. Do not create another frame. x/y are frame-local.
If FOCUS_FRAME_ID is "(none)", the grant is either multi-frame, element-only, or whole-canvas. Do not invent a frame id and do not assume the only existing Frame is the target. For a new design, create_frame first.

## Icon Construction

### Prefer boolean_op over dumping SVG
- Simple icons → build from primitives (rect/circle/polygon) + canvas.boolean_op
- Examples:
  - Moon: large circle subtract small circle (mode=subtract)
  - Magnifier: circle union handle rect (mode=union)
  - Ring: outer circle subtract inner circle (mode=subtract)
- Only use canvas.create_svg / canvas.create_icon for complex single-path marks (sanitized inline markup, viewBox required)
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

const MAX_TRIGGERED_SKILLS_CHARS = 6000;

function canvasSkillsCatalogText(preloaded: ReadonlySet<string>): string {
  const catalog = listSkills();
  const foundation = [...catalog.foundation].sort((a, b) => a.skillKey.localeCompare(b.skillKey));
  const domains = [...catalog.domains].sort((a, b) => a.skillKey.localeCompare(b.skillKey));
  const line = (skill: { skillKey: string; description: string }) =>
    `- ${skill.skillKey}: ${skill.description}${preloaded.has(skill.skillKey) ? " [preloaded]" : ""}`;
  return [
    "=== CANVAS_SKILLS_CATALOG ===",
    "Available design skills (use canvas.skill_get to load full content):",
    "",
    "Foundation:",
    ...foundation.map(line),
    "",
    "Domains:",
    ...domains.map(line),
    "",
    "How to choose:",
    "- New design from scratch → load ONE primary surface skill (poster_craft / landing_page / banner_ad) + design_brief",
    "- Just recolor / rearrange → no skill needed, use typed tools directly",
    "- Style/color decisions → load color + composition",
    "- Always keep anti_ai_slop in mind (or load it explicitly)",
    "- A skill marked [preloaded] is already injected below — do not canvas.skill_get it again",
  ].join("\n");
}

function triggeredSkillBlocks(skillKeys: readonly string[]): { text: string; preloaded: ReadonlySet<string> } {
  const preloaded = new Set<string>();
  const blocks: string[] = [];
  let remaining = MAX_TRIGGERED_SKILLS_CHARS;
  for (const key of skillKeys) {
    if (remaining <= 0) break;
    const skill = loadSkill(key);
    if (!skill) continue;
    const content = skill.content.trim();
    if (!content) continue;
    const header = `### ${key}`;
    const overhead = header.length + 2;
    if (content.length <= remaining - overhead) {
      blocks.push(`${header}\n\n${content}`);
      preloaded.add(key);
      remaining -= overhead + content.length;
    } else {
      const cut = content.slice(0, Math.max(0, remaining - overhead));
      if (cut.trim()) {
        blocks.push(`${header} [truncated]\n\n${cut}`);
        preloaded.add(key);
      }
      remaining = 0;
    }
  }
  return { text: blocks.join("\n\n"), preloaded };
}

export function canvasSkillPackText(grants: CanvasAccessGrantRow[], lastError?: string | null, userText?: string | null): string {
  if (!grants.length) return "";
  const catalog = listSkills();
  const triggered = matchedSkillKeys(userText, [...catalog.foundation, ...catalog.domains]);
  const { text: preloadedText, preloaded } = triggeredSkillBlocks(triggered);
  const lines = [
    "## Canvas skill pack",
    ...(lastError ? [canvasLastErrorContextLine(lastError)] : []),
    CANVAS_DESIGN_PRINCIPLES,
    CANVAS_CAPABILITY_DISCOVERY,
    canvasSkillsCatalogText(preloaded),
    ...(preloadedText ? ["", "### Triggered skills (preloaded by request)", preloadedText] : []),
    "Authorized grants:",
    ...grants.map((grant) => {
      const scope = grant.objectScope;
      return `- grant ${grant.id} snapshot=${grant.snapshotId} canvas=${grant.canvasId} actions=${grant.actions.join(",")} empty=${scope.emptySelection ? "yes" : "no"} elements=${scope.elementIds.join(",") || "—"} frames=${scope.frameIds.join(",") || "—"} createParents=${scope.createParents.join(",") || "—"} expiresAt=${grant.expiresAt instanceof Date ? grant.expiresAt.toISOString() : "—"}`;
    }),
    "Preferred tools: canvas.scene_summary, canvas.skill_list, canvas.skill_get, canvas.design_review, canvas.create_frame, canvas.create_text, canvas.create_shape, canvas.create_image(assetId|genPrompt), canvas.create_svg, canvas.create_icon, canvas.video_generate, canvas.generation_status, canvas.update_node, canvas.delete_nodes, canvas.delete_frame, canvas.update_frame, canvas.align_nodes, canvas.distribute_nodes, canvas.reorder_nodes, canvas.group_nodes, canvas.ungroup_nodes, canvas.duplicate_nodes, canvas.flip_nodes, canvas.boolean_op, canvas.set_canvas_background.",
    "Compatibility: canvas.elements_apply still maps a ToolOps list onto Canvas Core. Prefer typed tools.",
    "Also available: canvas.snapshot_get, canvas.elements_get, canvas.export, canvas.context_bundle_create, canvas.asset_import.",
    "ToolOps durable subset if using elements_apply: update_node, create_shape, create_text, create_image(assetId), create_video(assetId), create_lottie(assetId), create_frame, update_frame, delete_nodes, align_nodes, distribute_nodes, reorder_nodes, group_nodes, ungroup_nodes, duplicate_nodes, flip_nodes, boolean_op, set_canvas_background.",
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
