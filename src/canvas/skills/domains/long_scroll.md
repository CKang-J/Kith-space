# Long image / scroll story

**Deliverable**: 长图 / long image / 长截图 / scroll story — one tall continuous board with chapter rhythm.

## When to use

长图 / long image / 长截图 / scroll story / 条漫式长图 / H5 long page visual — single tall continuous board (not multi-artboard website, not short poster).

## Design thinking

| Ask | Aim |
|-----|-----|
| **Job** | A scroll story, not a short square poster |
| **Beats** | Hook → a few chapters → close/CTA |
| **Tone** | One visual language top to bottom |
| **Bitmap vs vector** | Simple separators / marks → vector. Rich hook/chapter scenes → bitmap. If vectors look crude, use image |
| **Width** | Mobile-first (~750–1080) |
| **Height** | Real scroll when asked 长图 (often tall, e.g. ≥~2800) |

Quality bar: **intentional design** — clear pauses between beats, coverage down the board. Soft-avoid empty bottoms and shape-pile fillers.

## Rhythm & composition

| Zone | Role |
|------|------|
| Hook (~top 15%) | Visual + one-line thesis |
| Body | Alternating image/type density; clear pauses |
| Close | Summary + one CTA |

- Side inset often ≥~6% width.
- Prefer appending chapters below over rebuilding an empty top.

## Type

- One theme line per chapter; thesis repeats lightly, not a wall of text at the top.
- Catalog text; lettering plates via `canvas.create_image(genPrompt)` when display needs it.

## Vector vs image

Separators, chapter markers, thin rules → vector. Complex chapter heroes → `canvas.create_image(genPrompt)`. Soft-avoid filling empty scroll with crude geometry spam.

## Honesty

Unless the user provides them, avoid inventing board facts such as logos, prices, phone numbers, etc.

## Review cue

On very tall boards (e.g. ≥~1400px or aspect ≳2.2), large empty bottoms usually mean unfinished chapters — keep appending.

## Hard rules

1. One tall scroll board, not a poster or multi-artboard site.
2. Chapter rhythm with breathing room; coverage reaches well down the board.
3. No crude geometry spam to fill empty scroll.

## Done when

Scroll rhythm reads; coverage reaches well down the board; type and imagery share one tone; language matches the user.

## Related skills

`image_gen` · `garden_style`

关键词：长图 / 滚动叙事 / 章节节奏 / 移动宽度
