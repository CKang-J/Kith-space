# Garden Style

<!-- MIT: adapted from ConardLi/garden-skills (MIT). Copyright (c) 2026. Retain this notice in copies. -->

**Deliverable**: Canvas work that looks **intentional and memorable** — not a safe AI draft.

## When to use

User explicitly asks for bold aesthetic direction / 调性 / 氛围感 / festive illustration mood — NOT default for product UI, landing pages, or dashboards.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Purpose** | Who sees this and what job it does |
| **Tone** | One direction from the catalog — do not mix casually |
| **Memory point** | Hero image **or** hero title — not both fighting |
| **Bitmap vs vector** | Simple geometry / flat language that stays crisp → vector. Complex atmosphere, materials, faces, busy illustration → bitmap. If vectors look crude, use image |

Quality bar: **intentional design** — alignments, contrast, and type mood fit this brief. Soft-avoid generic AI postcard defaults.

## Direction catalog (pick one)

| Direction | Cues |
|-----------|------|
| Minimal | Few elements, precise gaps, quiet palette, one accent |
| Editorial | Strong display type, asymmetric crop, magazine margins |
| Industrial | Utility type, hard edges, restrained metal/ink palette |
| Organic | Soft forms, natural textures, muted earth/plant tones |
| Luxury | High contrast, generous empty, refined metals/ink |
| Festive hand | Expressive lettering + illustrated or rich atmosphere when complexity needs it; simple flat festive language may stay vector |
| Playful geometric | Bold primitives, flat color blocks, friendly type — vector-friendly |
| Retro-futurist | Period cues + modern restraint; soft-avoid costume-party clutter |

## Anti-defaults (unless brief demands)

Purple→indigo gradients on white; Inter/Roboto/Arial as "design"; warm cream `#F4F1EA` + terracotta serif cliché; dense broadsheet hairlines; glow stacks; rounded-full pill spam; emoji-as-icon; Space Grotesk convergence.

## Build rules

- Atmosphere that needs depth/light/material → `canvas.create_image(genPrompt)`; soft-avoid crude shape spam as a fake scene.
- Simple intentional geometry is fine when that is the language (e.g. playful geometric).
- Type: distinctive display + restrained body; soft-avoid forcing generic UI sans onto illustration posters.
- Color: one dominant + sharp accent; copy clears the background.
- Space: generous whitespace **or** controlled density — soft-avoid "everything centered, nothing focal."
- Decoration only when they serve the theme.

## Far / near check

- Far (~1s): theme + main title readable; medium matches complexity.
- Near: soft-avoid clipped glyphs, low contrast, emoji tofu, unrelated icons.
- Tone: type mood matches the picture.

## Honesty

Unless the user provides them, avoid inventing board facts such as logos, slogans, trademark marks, etc.

## Hard rules

1. One nameable direction; one memory point.
2. Anti-defaults cleared.
3. No copied Logo/QR/price from references; no emoji/pictograph as icons.
4. No festive decoration on product UI unless asked.

## Done when

Direction is nameable in one phrase; one memory point; anti-defaults cleared; far/near pass.

## Related skills

`poster_craft` · `landing_page` · `image_gen` · `awesome_design_md`

关键词：调性 / 氛围感 / 风格配方 / 记忆点 / 反默认
