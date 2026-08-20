# Composition

**Deliverable**: One named layout archetype with hard ratios before placing nodes.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns the LAYOUT PLAN.

## When to use

Load when choosing how a poster, landing, or banner occupies the frame: hero vs type, margins, focal count. Pair with `design_brief` on new work.

## Process overview

```text
… → ART DIRECTION → LAYOUT PLAN (this skill) → DESIGN SYSTEM → EXECUTION → …
```

Choose **one** archetype. Do not mix center-hero with a three-card grid “just in case”.

## Poster / KV archetypes

| Id | Use when |
|----|----------|
| `center_hero` | One object/product/mascot owns the board |
| `rule_of_thirds` | Editorial / photo with asymmetric title |
| `bottom_weighted` | Title + info + CTA in a bottom band; hero above |
| `diagonal` | Energy, motion, festival |
| `full_bleed` | Image-led (or large constructed mark); type in quiet zones |
| `minimalist` | Extreme negative space; one word + one mark |
| `editorial` | Magazine stack: kicker / headline / deck / meta |
| `dense_info` | Only if the user asked for a dense poster |

### Default hard rules (center_hero / full_bleed / bottom_weighted)

```text
hero_coverage: 60–85% of the frame
text_area: ≤ 20%
primary_focal: 1
secondary_focal: ≤ 2
empty_space: ≥ 15%
cta: ≤ 1
```

Tall / roll-up rhythm: top kicker or empty sky → mid hero → bottom title/info/CTA. Side margins ≥ 6–8% of width.

Wide: subject vs copy left/right; keep the primary claim in the mid-band (edges crop).

## Landing archetypes

`left_text_right_visual` · `centered_hero` · `editorial_split` · `asymmetric_grid` · `product_showcase` · `type_led` · `image_led`

Landing is a **section sequence**, not a poster. Do not start from three equal cards.

## Banner archetypes

`split_subject_copy` · `full_bleed_quiet_band` · `center_claim` (square social)

Mid-band is safer; assume ~5–8% edge crop.

## Principles

1. **Balance**: weight of hero vs type; do not center *everything*.
2. **Focal point**: one primary. Secondary marks stay quieter (smaller, lower contrast).
3. **Rhythm**: repeat a spacing unit (8 / 16 / 24 / 32 / 48). Random 13px gaps look unfinished.
4. **White space**: empty is a design element. If deleting a node loses no information, plan to delete it.
5. **Flow**: top-left → hero → title → support → CTA (locale LTR). Do not scatter meta in four corners.

## Common mistakes

- Full-bleed background rect instead of `create_frame` + `update_frame.backgroundColor`
- Title, mascot, and CTA all at the same visual volume
- Grid of isometric “feature cards” on a poster
- Dumping new nodes onto ROOT when `FOCUS_FRAME_ID` is set (x/y are frame-local)

## Hard rules

1. Name one archetype in the brief before create_*.
2. Write coverage / margin / focal counts as numbers, not vibes.
3. Primary focal = 1. Secondary ≤ 2.
4. If two elements fight for attention, fix layout before adding decoration.

## Done when

- [ ] Archetype named
- [ ] Hard ratios written
- [ ] Nodes will follow the plan — not the reverse

## Related skills

`design_brief` · `typography` · `poster_craft` · `landing_page` · `banner_ad`

关键词：构图 / 视觉焦点 / 留白 / 节奏 / 原型 / 英雄区
