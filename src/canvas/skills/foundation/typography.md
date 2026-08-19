# Typography

**Deliverable**: A visible type ladder and pairing, using only catalog fonts from scene_summary.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns how type behaves.

## When to use

Load when setting titles, decks, dates, or CTAs; when hierarchy feels flat; or when choosing `fontFamily` / `fontSize` / `fontWeight`.

## Process overview

1. Lock one type mood for the board.
2. Assign roles: hero / title / subtitle / body / caption — jumps must be visible at 50% zoom.
3. Overlay `create_text` on a quiet band. Do not bake headlines into a bitmap unless the user asked for lettering art.
4. Language matches the user. Do not mix a second display face mid-run.

## Type ladder (poster / KV defaults)

Sizes assume a ~1080×1920 plate; scale ~0.55× on a 390-wide phone frame, ~0.7× on a 1920×600 banner.

```text
hero / display     72–96px   weight 700–900   ≤2 lines
title              48–64px   weight 700       ≤2 lines
subtitle / deck    24–32px   weight 500–600   ≤3 lines
body               16–20px   weight 400–500   line-height ~1.4–1.6
caption / meta     12–14px   weight 400       dates, venue, fine print
CTA label          16–22px   weight 700       1 line of action
```

Landing / UI: H1 : body ≈ 1.6–2.2 : 1 (less extreme than a poster).

## Pairing

- One display + one text face, **or** one family with weight contrast.
- `fontFamily` only from `AVAILABLE_FONTS` in `canvas.scene_summary`. Do not invent names.
- Default safe faces when unsure: `"Alibaba PuHuiTi"`, `"Inter"`.
- Do not default-map 书法感 → Zhi Mang Xing.

## Hierarchy levers (use more than size)

1. Size jump (title ≫ support)
2. Weight jump (800 vs 400)
3. Color jump (primary ink vs muted)
4. Tracking: display slightly tighter; all-caps meta with modest letter-spacing, never as the hero unless asked

## Readability

- Body line length ~50–75 characters (or wrap width ≈ 60–70% of the frame on a poster).
- Line-height 1.4–1.6× fontSize for body; tighter (~1.05–1.2) for display.
- Paragraph / block gap ≥ 0.6× body size.
- Title on a busy hero: put type on a quiet band, scrim (`fillType=linear` transparent → dark), or solid bar — do not hope contrast appears.

## Hard rules

1. One type mood. Roles H1 > H2 > body > caption with visible jumps.
2. CTA / meta ≤ 1 line of action copy. Do not invent slogans.
3. No emoji as icons in titles.
4. Prefer `canvas.update_node` to restyle existing text; do not delete+recreate to change size/color.
5. Hero titles below ~90% font match: keep a catalog face, or import a lettering asset — do not fake calligraphy.

## Done when

- [ ] Ladder readable at 50% zoom
- [ ] Title is a text node (unless lettering was requested)
- [ ] Catalog fonts only
- [ ] Dates / venue / CTA are quieter than the title

## Related skills

`design_brief` · `composition` · `poster_craft`

关键词：排版阶梯 / 字号 / 字重 / 行长 / 层次 / 不要编字体
