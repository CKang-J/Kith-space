# Design Review (QA rubric)

Dimensional craft gate for self-review before settle. Recombyn's runtime sums a 0–100 total; Kith has no runtime scorer, so **self-score against these dimensions** and treat must_fix items as blocking.

## When to use

Reviewing completed canvas work before settle (turn.reply) — after canvas.scene_summary, before claiming done. Paint keeps the compact checklist from `polish`.

## Dimensions & caps

| Dimension | Cap |
|-----------|-----|
| composition | 20 |
| hierarchy | 20 |
| typography | 15 |
| color | 15 |
| consistency | 15 |
| content | 10 |
| originality | 5 |
| **sum** | **100** |

Caps sum to exactly 100. Self-score each dimension within its cap.

## Pass thresholds

| Total (0–100) | Action |
|------:|--------|
| < 70 | Rework (must_fix) |
| 70–89 | Fix majors + subtraction / polish |
| ≥ 90 | Pass only if no blocker / major / slop hits |

## What you judge

- Focal clarity vs the brief's visual_thesis and visual_hero
- Hierarchy (H1 ≫ H2 ≫ body ≫ caption; no two elements share "primary" weight)
- Type / color / consistency / content honesty / originality
- Anti-slop hits + subtraction actions
- The preview / SCENE against the DESIGN_BRIEF thesis and composition archetype

## What you do NOT invent

- Geometry overflow / overlap / stacked creates — read those from canvas.scene_summary facts, don't imagine them
- A fake total that disagrees with the individual scores
- Aesthetic praise for accidental layout facts

## Hierarchy review (folded)

- Require visible H1 ≫ H2 ≫ body ≫ caption.
- Fail when two elements share the same visual weight as "primary".

## Visual review (folded)

- Judge the scene against DESIGN_BRIEF thesis + composition archetype.
- Fail when the focal point fights the title, or hero coverage ignores brief ratios.

## Hard rules

1. Score each dimension within its cap; caps sum to 100.
2. must_fix when the score gate (<70) or majors / slop remain.
3. Fix imperative always points back to the DESIGN_BRIEF.

## Checklist

- [ ] Scores filled within caps
- [ ] No invented total that disagrees with the scores
- [ ] must_fix listed when the gate or majors remain
- [ ] Fixes are imperative toward DESIGN_BRIEF fidelity

## Done when

- Every dimension scored, and the total is honest
- must_fix items are fixed (or the turn settles only when the gate passes)
- Hierarchy and visual checks pass against the brief

## Related skills

`design_brief` · `polish` · `anti_ai_slop`

关键词：设计评审 / 自检 / 评分维度 / must_fix / 总分
