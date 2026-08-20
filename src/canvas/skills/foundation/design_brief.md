# Design Brief

**Deliverable**: A written execution contract before any create_* call on a new design.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns the Decide contract.

## When to use

Load this skill when starting a poster, landing page, banner, or any new composition from scratch. Skip it for a one-shot recolor, move, or copy tweak on an existing node.

## Process overview

```text
INPUT → BRIEF (this skill) → ART DIRECTION → LAYOUT PLAN → DESIGN SYSTEM → EXECUTION → OBSERVE → REVIEW
```

Do not jump to `canvas.create_shape` / `canvas.create_text` until P0 fields below are filled.

## P0 fields (required)

Write these as a short block in your reasoning (or a checklist) before painting:

| Field | Must answer |
|-------|-------------|
| `purpose` | What job does this piece do in ~1 second? |
| `audience` | Who sees it? |
| `emotion` | 2–4 tone words (not “高级 / 科技感”) |
| `visual_thesis` | One concrete sentence: materials + focus + what it is *not* |
| `visual_hero` | The single primary subject |
| `composition` | One archetype + hard ratios (hero coverage, margins, focal count) |
| `avoid` | ≥3 concrete bans for this run |

## P1 fields (optional; fill only when known)

`visual_focus` (e.g. hero 70 / support 20 / env 10) · `palette` (surface / primary / muted / accent) · `typography` (H1/H2/body sizes) · `style_dna`

Do not invent junk to fill P1. Poster ≠ landing ≠ banner.

## Thesis quality

Bad: `科技感` / `高级` / `好看` / “modern tech poster”

Good: `Orange gourd-cut paper on near-black; one jack-o’-lantern silhouette; carnival, not a purple nebula SaaS splash.`

The thesis must be falsifiable in review (you can point at the board and say yes/no).

## Example brief (Halloween community poster)

```text
purpose: Get families to a Trick-or-Treat night
audience: Neighborhood parents and kids
emotion: Playful, slightly spooky, local
visual_thesis: Hand-cut orange and cream shapes on charcoal; one pumpkin hero; not a cosmic purple gradient
visual_hero: Pumpkin / bat cluster as a single constructed mark
composition: { archetype: "bottom_weighted", rules: { hero_coverage: "65%", text_area: "18%", empty_space: "20%", cta: 1 } }
avoid: purple-blue gradient, glass cards, random particles, emoji-as-icon, three equal feature cards
```

## Hard rules

1. P0 complete before the first create_* on a new plate.
2. `avoid` names at least 3 concrete bans (often include purple-blue gradient / particles / glass).
3. One visual_hero. If two subjects fight, the brief is not done.
4. `subtraction_intent: true` unless the user asked for a dense collage.
5. Do not invent logos, prices, phones, QR codes, or testimonials the user did not provide.

## Done when

- [ ] P0 fields written
- [ ] Thesis is one concrete sentence
- [ ] Archetype named
- [ ] avoid[] has ≥3 bans
- [ ] Ready to load the surface skill (`poster_craft` / `landing_page` / `banner_ad`) and paint

## Related skills

`composition` · `color` · `typography` · `anti_ai_slop` · domain skills for the surface

关键词：设计简报 / 目的 / 受众 / 情绪 / 视觉论点 / 构图原型 / 禁止项
