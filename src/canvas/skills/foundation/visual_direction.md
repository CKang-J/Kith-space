# Visual Direction

One sentence for **why** this board must look this way — then lock Style DNA.

How photos/bitmaps are placed lives in `imagery` (this skill `extends` it). This skill owns the **thesis + DNA slots**.

## When to use

Foundation after design_brief — lock thesis and material / geometry / lighting DNA before paint.

## Process

```text
BRIEF → ART DIRECTION (this skill) → LAYOUT → SYSTEM → EXECUTION
```

## Hard rules

### Visual thesis

Must be one falsifiable sentence:

Bad: `科技感` / `高级仙侠`

Good: `像精密工业实验室做出的 AI 产品：大面积冷白、极少深黑字、一个高密度产品视觉作为唯一焦点。`

Write into `design_brief.visual_thesis`.

### Style DNA → `design_brief.style_dna`

| Slot | Capture |
|------|---------|
| material | jade / metal / paper / glass / stone / silk / … |
| geometry | vertical / grid / asymmetric / restrained / … |
| lighting | directional / soft / atmospheric / … |
| texture | subtle / tactile / flat / … |
| density | low / medium / high |
| palette | roles + mood (not random hex spam) |
| typography | large/restrained / precise / editorial / … |
| imagery | product-led / illustration / photo / type-led |

### Reference lock

When the user gives a style ref (e.g. Apple):

```text
extract features → reference_lock
allow: content / images / brand details
forbid: changing core visual language
```

## Checklist

- [ ] Thesis is specific and checkable by review
- [ ] Style DNA filled or intentionally sparse
- [ ] Avoid list names what this DNA is *not*

## Done when

- One falsifiable thesis; Style DNA locked
- No vague 科技感/高级 wording; no second DNA mid-run

## Related skills

`imagery` · `design_brief`

关键词：视觉方向 / 视觉论点 / Style DNA / 材质与光
