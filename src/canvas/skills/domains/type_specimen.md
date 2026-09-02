# Typography / font specimen

**Deliverable**: 字体展示 / type specimen / font pairing — catalog faces only; type is the hero. Simple rules stay vector; complex lettering art uses image only when asked.

## When to use

字体 / typography / font specimen / 字体展示 / type specimen / 字样 / font pairing board — show catalog type craft (not festive poster hero, not SaaS UI chrome).

## Design thinking

| Ask | Aim |
|-----|-----|
| **Job** | Single face / pairing / weight ladder |
| **Tone** | Calm plate — Swiss / editorial / quiet study |
| **Faces** | 1–2 from Available fonts; caption names on board |
| **Bitmap vs vector** | Type + thin rules → vector/text. Illustrated lettering / complex glyph art → bitmap only if the user asks (`canvas.create_image(genPrompt)`) |
| **Size** | e.g. 1080×1350 / 1920×1080 / A4-ish or user WxH |

Quality bar: **intentional design** — hierarchy and measure do the work. Soft-avoid invented font names and festive poster chrome.

## Composition recipes

| Ask | Structure |
|-----|-----------|
| Single face | Giant sample → metrics → short paragraph |
| Pairing | Display \| text; shared baseline |
| Weight ladder | Same face, several weights labeled |

## Type

- Large display sample + optional alphabet / CJK demo.
- Body block (2–4 lines) for measure and leading.
- Meta row: name, weight, suggested use — small muted type.
- Prefer **add text** (`canvas.create_text`) over lettering bitmaps unless the user asks for illustrated lettering.

## Vector vs image

Optional thin rules and baseline guides → vector. Soft-avoid decorative shape piles and photo collage that steals the specimen job.

## Honesty

Prefer catalog font names only. Soft-avoid inventing face names.

## Place on board

Lock board (`create_frame`) → place display → body → meta → optional rules.

## Hard rules

1. Catalog fontFamily only; no invented face names.
2. Editable text specimens, not lettering images, unless asked.
3. A calm specimen plate, not a busy poster collage.

## Done when

Faces named correctly; hierarchy clear; plate stays calm; language matches the user.

## Related skills

`image_gen` · `garden_style`

关键词：字体 / 字样展示 / 目录字体 / 字重阶梯
