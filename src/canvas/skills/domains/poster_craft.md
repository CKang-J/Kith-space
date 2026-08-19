# Poster Craft

**Deliverable**: Poster / roll-up / KV / 易拉宝 on one `create_frame` plate with hero, title, support, and optional CTA.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns the poster playbook.

## When to use

User asks for a poster, KV, concert key visual, event flyer, roll-up, or “一张海报”. Load `design_brief` with this skill. Keep `anti_ai_slop` in mind (or load it). Image generation is **not** available this turn — construct marks with shapes / `boolean_op`, or place an existing Canvas `assetId`.

## Process overview

```text
INPUT
 → BRIEF          (P0 design_brief fields)
 → ART DIRECTION  (visual_thesis + palette roles + type ladder)
 → LAYOUT PLAN    (one composition archetype + hard ratios)
 → DESIGN SYSTEM  (tokens)
 → EXECUTION      (frame → ground → hero → title → support → CTA → sparse marks)
 → OBSERVE        (canvas.scene_summary facts only)
 → REVIEW         (hierarchy, color, slop, honesty)
 → CORRECTION     (subtract / restyle — not more decoration)
 → FINAL
```

Do **not** jump to glass cards / particles / equal decorations.

## 1. Brief (P0)

Fill before paint (see `design_brief`):

| Field | Poster focus |
|-------|----------------|
| purpose | What sticks in ~1s? |
| audience | Who |
| emotion | 2–4 words |
| visual_thesis | Materials + focus + what it is not |
| visual_hero | Single primary subject |
| composition | archetype + rules |
| avoid | ≥3 bans (purple gradient / particles / HUD / emoji icons) |

Example — Trick or Treat night, 31 Oct 19:00, community center:

```text
purpose: Fill a neighborhood Halloween night
audience: Families on this block
emotion: Playful, spooky-lite, local
visual_thesis: Cut-paper orange and cream on charcoal; one pumpkin mark; carnival, not a SaaS nebula
visual_hero: Pumpkin / moon silhouette built from ellipses + boolean_op
composition: bottom_weighted; hero 65%; text band ≤20%; one CTA
avoid: purple-blue gradient, glass cards, particles, emoji, three feature cards
```

## 2. Art direction

- Palette from emotion (Halloween → orange/charcoal/cream). See `color`.
- One constructed hero mark. Prefer `create_shape` + `boolean_op` (moon, pumpkin, bat wing) over emoji.
- Quiet bands for type if the hero is busy.

### Visual thesis examples

❌ **Bad** (抽象、无法执行):
- "仙侠高级感"
- "现代简约风格"
- "科技未来感"

✅ **Good** (具体、可执行):
- Halloween poster: "Cut-paper orange (#FF6B35) and cream (#FFF4E6) on charcoal (#1A1A1A); one pumpkin mark built from ellipses + boolean_op; carnival atmosphere, not a SaaS nebula"
- Concert KV: "把这把剑当作博物馆神兵：冷银 (#C0C0C0)、旧玉 (#D4E2D4)、暗金浮雕 (#8B7355)；克制东方神性，不是游戏装备海报"
- Tech event: "Neon cyan (#00D9FF) monoline paths on near-black (#0A0F1C); brutalist grid, not gradient wash"

### Icon construction examples

When the design needs decorative marks or hero elements:

✅ **Use boolean_op**:
- Moon: `create_shape circle (200×200)` + `create_shape circle (160×160 offset)` → `boolean_op mode=subtract`
- Star burst: `create_shape star sides=8` + `create_shape circle` → `boolean_op mode=subtract`
- Ring badge: `create_shape circle (outer)` + `create_shape circle (inner)` → `boolean_op mode=subtract`

❌ **Don't use emoji**:
- ~~`create_text text="🎃" fontSize=120`~~ → Use boolean_op to build a pumpkin from shapes
- ~~`create_text text="🌙" fontSize=80`~~ → Use circle subtract circle for a crescent moon

✅ **Use pen path for organic shapes**:
- Heart: `create_shape shapeType=pen path="M150,50 C125,25 75,50 150,150 C225,50 175,25 150,50 Z" closed=true fill="#FF0000"`

## 3. Layout archetypes (pick one)

`center_hero` · `bottom_weighted` · `rule_of_thirds` · `editorial` · `typographic` (type is the hero) · `split-hero` · `full_bleed`

Default ratios:

```text
hero_coverage: 60–85%
text_area: ≤ 20%
primary_focal: 1
secondary_focal: ≤ 2
empty_space: ≥ 15%
cta: ≤ 1
```

Tall 1080×1920: sky / kicker → hero → title → date/venue → CTA.
Do not merge multiple posters into one tall frame.

## 4. Hierarchy

| Level | What | Typical size on 1080×1920 |
|-------|------|---------------------------|
| Primary | Event title | 72–96px, ≤2 lines |
| Secondary | Subtitle / hook | 24–32px |
| Tertiary | Date, time, place | 16–20px muted |
| CTA | One action | High-contrast rect + 16–22px label |

## 5. Execution stack (Kith tools)

1. `canvas.scene_summary` — read FOCUS_FRAME_ID. If `(none)`, `canvas.create_frame` at deliverable size (竖版海报 ~1080×1920).
2. `canvas.update_frame` `{ backgroundColor }` for the plate ground — **not** a full-bleed bg rect, **not** CSS gradients.
3. Hero marks inside `frameId` (x/y **frame-local**): shapes, `boolean_op` for cutouts. Optional `create_image` only with an existing Canvas `assetId`.
4. Title `create_text` — catalog `fontFamily` only.
5. Support: date / venue / one deck line.
6. CTA: one button-like rect + label, or a single strong line of action type.
7. Sparse decoration only if it serves the thesis.
8. `scene_summary` again. Then `polish` mindset: subtract, align, contrast.

## 6. Honesty

Unless the user provides them, do not invent logos, prices, phones, QR, review counts, or extra slogans.

## Hard rules

1. Brief P0 before paint.
2. One thesis, one hero, one primary focal.
3. If two elements fight → fix before settle.
4. No emoji as icons. No CSS `linear-gradient()` in fill.
5. Title ≤ 2 lines. CTA ≤ 1 (or omit if the user gave no action).
6. Anti-slop bans apply (`anti_ai_slop`).
7. Second pass = refine / subtract — not add decoration.
8. `turn.reply` with `outputRefs.kind=canvas_mutation` only after a committed mutation.

## Done when

- Far: tone + title readable in ~1s; matches thesis
- Near: hierarchy title > support > meta; contrast holds
- No unjustified slop (purple-blue wash, glass, particles, emoji icons)
- Composition is a poster, not a pile of unrelated nodes

## Related skills

`design_brief` · `composition` · `color` · `typography` · `anti_ai_slop` · `polish`

关键词：海报 / 主视觉 / 画框优先 / 标题层次 / CTA / 不要紫蓝渐变
