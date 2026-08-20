# Color

**Deliverable**: A role-based palette (surface / primary / muted / accent) matched to the brief’s emotion.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns how color is used.

## When to use

Load when choosing or defending a palette, recoloring a plate, or the brief names a mood (Halloween, luxury, clinical, festive).

## Process overview

1. Name **roles**, then pick hex. Do not sprinkle one-off hex per node.
2. Lock ≤1 accent family. Accent is a job (CTA, one mark), not a wash.
3. Check contrast on body/support text vs surface.
4. Re-read `anti_ai_slop` before a purple-blue or rainbow gradient.

## Roles

```text
surface     frame / poster ground
primary     main ink, large type, main mark
muted       dates, venue, captions, rules
accent      one job: CTA or a single highlight
```

Solid fills only in this turn: `#RRGGBB` or `rgba(r,g,b,a)`. Never CSS `linear-gradient(...)`.
Host gradients (when needed): `fillType=linear|radial|angular|diffuse` + `fill` + `fillEnd` + `gradientAngle`. Prefer a quiet vignette over a decorative rainbow.

## Palette strategies

| Strategy | Use when |
|----------|----------|
| Monochrome | One hue, vary lightness; elegant / severe |
| Analogous | Neighbors on the wheel (orange–red–gold); seasonal, warm |
| Complementary | Opposite hues (orange vs teal); keep one dominant |
| Split-complementary | Safer than full complement |
| Triadic | Only if the brief is playful and you still pick a dominant |

Default: **one dominant + one accent + neutrals**. Do not invent a second palette mid-run.

## Emotion → hue (starting points, not mandates)

| Mood | Lean |
|------|------|
| Playful / harvest / Halloween | Orange `#E85D04`–`#F48C06`, cream `#F4E1C1`, charcoal `#1A1A1A` — not purple nebula |
| Calm / trust | Slate, off-white, one teal or navy accent |
| Luxury | Near-black, warm gold, restrained cream |
| Nature | Olive, moss, paper; avoid neon green wash |
| Urgent / sale | Strong red or orange accent on a dark or paper ground; still one CTA |
| Clinical / tech | Cool gray + one precise accent (cyan/teal). **Not** default purple-blue mesh |

## Contrast

- Body vs surface: aim for readable contrast (dark ink on light, or cream on charcoal).
- Do not use light gray (`#BBBBBB`) on white as primary copy.
- CTA fill vs ground: high contrast; CTA text vs CTA fill also high contrast.

## Hard rules

1. Roles first, hex second.
2. ≤1 accent family; accent area is small.
3. Unjustified purple–blue gradient / glass mesh is slop unless the brief asks for it.
4. Do not name CSS colors (`red`, `orange`) in tools — convert to hex.
5. Halloween / autumn: orange–black–cream is on-thesis; cosmic purple is off-thesis unless requested.

## Done when

- [ ] Roles written into the brief palette
- [ ] Accent is local, not a wash
- [ ] No decorative rainbow / unjustified purple-blue gradient
- [ ] Support text reads on the surface

## Related skills

`design_brief` · `anti_ai_slop` · `poster_craft`

关键词：色彩 / 主色 / 点缀色 / 中性底 / 对比 / 禁止紫蓝渐变
