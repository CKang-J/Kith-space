# Icon / mark set

**Deliverable**: 图标 / icon set / favicon / UI glyph — one system. Default to vector for simple marks; use bitmap only when texture/brand detail cannot stay crisp as geometry.

## When to use

Icon / 图标 / icon set / 图标组 / app icon / favicon / UI glyph / symbol mark — static vector marks (not Lottie, not illustrated poster hero).

## Design thinking

| Ask | Aim |
|-----|-----|
| **Deliverable** | App icon / UI glyph set / favicon |
| **System** | Shared optical size, stroke, corner, filled vs outline |
| **Grid** | Same cell (e.g. 64 / 96 / 128); columns × rows |
| **Bitmap vs vector** | Simple silhouettes / outline-filled glyphs → vector. Textured or complex brand marks the user asked for → bitmap. Soft-avoid emoji-as-icon |
| **Scale** | Still readable ~32px for UI glyphs |

Quality bar: **intentional design** — one language across the set, even optical weight. Soft-avoid rainbow-per-mark.

## Composition

- Lock cell size and sheet grid (e.g. 4×2).
- State the system in one line (stroke / corner / mono ink).
- Optical balance: rounds slightly large, squares slightly tight.
- Optional small labels under marks — labels never replace glyphs.

## Vector vs image

| Ask | Prefer |
|-----|--------|
| App icon / UI set / favicon | Vector silhouette that survives small sizes |
| Textured brand mark (user asked) | Bitmap via `canvas.create_image(genPrompt)` |
| Static mark | Vector |

Budget: one solid/outline glyph per mark — not stroke piles. Soft-avoid pictograph characters or lone text characters as the icon.

## Kith build

Draw each simple mark as real geometry: `canvas.create_shape` primitives + `canvas.boolean_op` (moon = circle subtract circle; magnifier = circle union rect). A shared `create_frame` plate, one mark per cell. Labels via `canvas.create_text` under marks.

## Honesty

Unless the user provides them, avoid inventing brand logos or trademark marks.

## Hard rules

1. One system language across the set.
2. Simple marks are real geometry, not emoji / pictograph text.
3. One stroke/fill language; optical balance over exact equality.

## Done when

N marks ≈ N real glyphs (or intentional bitmap marks); one system language; labels readable.

## Related skills

`dashboard_ui` · `mobile_app_ui` · `shadcn_ui` · `image_gen`

关键词：图标 / 符号组 / 矢量 / 布尔运算 / 网格
