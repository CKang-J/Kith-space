# Image generation

**Deliverable**: A bitmap plate that executes the brief — not a "pretty picture" button. Overlay type stays on the board (`create_text`).
**Core process**: Still Decide → Paint → Observe → Review. This skill owns **how the bitmap is specified**.

## When to use

Hero / atmosphere bitmaps, product plates, vector accents, or stylized lettering. Helper: may load **with** a surface (`poster_craft` / `landing_page` / …); it does not replace them.

## Process (mandatory order)

```text
DESIGN BRIEF → VISUAL THESIS → COMPOSITION → MATERIAL → LIGHTING → IMAGE
```

Do not jump to a prompt until thesis, crop, material, and light are named.

## 1. Brief → thesis

Reuse P0 `design_brief`. The image must argue `visual_thesis` and show `visual_hero`. Style DNA (`material` / `lighting` / `imagery`) is the prompt spine — not "cinematic, 8k, masterpiece".

## 2. Composition (in the plate)

Pick crop and focal **before** generating:

- What is in frame vs left to overlay type / vector chrome
- One primary subject; quiet bands where titles will sit
- Camera: distance, angle, what is cut off

If the board composition is `center_hero`, the plate should not also scream a second hero in the corner.

## 3. Material → lighting → image

Name both in the prompt (from Style DNA):

| Slot | Ask |
|------|-----|
| Material | jade / aged steel / paper / cloth / skin / glass / … |
| Lighting | direction, hardness, color of light, what it reveals |
| Medium | photo / illustration / grain print / quiet 3D — **one** |

Then emit `canvas.create_image(genPrompt)` — or `canvas.video_generate` for a short motion clip. Simple geometry that stays crisp may stay vector instead — crude shape piles are not atmosphere.

## 4. Kith generation seam

`canvas.create_image` accepts an existing Canvas `assetId` **or** `genPrompt` for a queued generation job. Generation is async: the tool returns a `jobId` immediately, and the image node lands on the canvas when the worker finishes (about 10–60s). Do not claim the image exists until `canvas.scene_summary` shows it. For cutouts use `removeBg=true`; for in-image lettering pass `letteringText`.

## 5. Forbidden: baked title

**Do not** render titles, slogans, watermarks, or UI chrome **inside** the bitmap unless the user **explicitly** asks for text in the picture (lettering-as-image, packaging, neon sign, 书法字形). Default: overlay catalog type on a quiet band.

## 6. Honesty

Unless the user asks, do not invent logos, prices, phones, or readable fake copy in the pixels.

## 7. Cutout vs full-bleed

- Full-bleed atmosphere: keep the plate; type sits on quiet zones.
- Product / lettering on a colored board: **cutout** (`removeBg=true`) so no leftover white box.

## Anti-patterns (folded)

- A pretty picture with no thesis / material / light
- Baked titles, slogans, watermarks, or UI chrome in the pixels
- Purple-blue glass postcard heroes
- Invented logos, prices, or readable fake copy
- Shape-pile "atmosphere" that should have been a bitmap — or a bitmap when a flat vector field was enough

## Review (folded)

- One focal; overlay type still wins as editable text.
- Fail if the plate is a generic pretty picture that does not match `visual_thesis`.
- Fail if titles/slogans are baked in unless the user asked for in-image text.

## Hard rules

1. Brief + thesis before generate.
2. Composition + material + lighting in the prompt — not style-spam adjectives.
3. No baked titles unless explicitly requested.
4. Anti-slop: unjustified purple-blue glass postcard heroes fail review.

## Done when

- Plate matches thesis at a glance (subject + material + light)
- Room for overlay type (or user-requested in-image lettering only)
- No invented on-image copy

## Related skills

`poster_craft` · `landing_page` · `banner_ad` · `icon_set`

关键词：图像生成 / genPrompt / 材质与光 / 禁止烘焙标题 / 异步 job
