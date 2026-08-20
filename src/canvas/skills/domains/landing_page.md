# Landing Page

**Deliverable**: A marketing homepage / landing / 落地页 as one (or desktop+mobile) frame sequence — not a poster and not a 3-card template.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns family + section IA.

## When to use

User asks for a landing page, homepage hero, marketing site, SaaS splash, or 落地页. Load `design_brief`. Do not use this for a single event poster (`poster_craft`) or a one-claim strip (`banner_ad`).

Atmosphere photos and product stills may use `canvas.create_image(genPrompt)`. Keep UI chrome, type, and layout in frames/shapes/text. Existing Canvas `assetId` images remain valid.

## Process overview

```text
INPUT → FAMILY → BRIEF → ART DIRECTION → SECTION PLAN → DESIGN SYSTEM → EXECUTION (hero first) → OBSERVE → REVIEW → CORRECTION → FINAL
```

## 0. Classify family first

Pick **one**. Do not mix SaaS pricing chrome onto an editorial magazine.

| Family | Default job |
|--------|-------------|
| SaaS | Proof, then a path to subscribe |
| AI | Show input → output; demo before features |
| Consumer | Desire + product truth; photos over icon grids |
| Editorial | Story lead |
| Portfolio | 1–2 featured works, not six equal thumbnails |
| Commerce | Product + offer honesty; price only if the user gave it |

Write the family into `design_brief.purpose`.

## 1. Brief extras

Same P0 as `design_brief`. Landing extras:

- `visual_hero` = first-screen subject (product UI chrome, wordmark+claim, or one photo plate)
- `composition.archetype` = `left_text_right_visual` · `centered_hero` · `editorial` · `split` · `bottom_cta`
- `avoid` must include the generic landing template if not requested

## 2. Section flows (do not skip)

### SaaS
```text
Hero → Product Proof → Problem → Solution → Workflow → Trust → Pricing → CTA
```
Proof before a feature grid. Pricing only with user-supplied tiers.

### AI
```text
Hero → Demo → Input → Output → Use cases → Trust → CTA
```
The demo is the product. Do not replace it with three capability cards.

### Consumer
```text
Hero (desire) → Product truth → How it feels → Social proof → Offer → CTA
```

### Editorial
```text
Masthead → Lead story → Supporting pieces → Quote → Subscribe CTA
```

### Portfolio
```text
Identity → Featured work (1–2) → Supporting work → Process → Contact
```

### Commerce
```text
Hero product → Proof → Uneven benefits → Offer → Trust → CTA
```

## 3. Hero structure

Headline + optional subhead + one primary CTA (+ quieter secondary). Visual on one side or full-bleed with a quiet type band. Nav is a mark + few links — not a second hero.

## 4. Forbidden default

Never start from:

```text
Hero
3 cards
3 cards
Logo row
CTA
```

That template is an `anti_ai_slop` hit (`three_card_layout` / `generic_hero`) unless the brief asks for three equal benefits.

## 5. Size & execution

- Desktop board ~1440×900+ (grow height with sections). Phone ~390×844+ as a **separate** `create_frame` if you need mobile — do not stack both as one tall poster unless asked.
- One primary CTA; secondaries quieter.
- Empty space between sections ≥ one body line.
- Stack: `create_frame` → `update_frame.backgroundColor` → hero type/visual → sections → CTA band → subtract/align.

## 6. Honesty

Do not invent logos, testimonials, prices, review counts, or fake company names.

## Hard rules

1. Family before sections. Brief P0 before paint.
2. One thesis, one primary CTA, one first-screen focal.
3. Anti-slop: no unjustified 3-card / glass / purple-blue hero.
4. Value props, if any, must be uneven (size/weight/content) — not three identical rounded cards.
5. Second pass = subtract / align — not another card row.

## Done when

- Family flow is recognizable (not a generic card stack)
- Hero job obvious in ~2s; CTA unique
- Type ladder holds; no emoji-as-icon
- No invented social proof

## Related skills

`design_brief` · `composition` · `typography` · `anti_ai_slop` · `polish`

关键词：落地页 / 首屏 / 价值主张 / 主 CTA / 禁止三卡片模板
