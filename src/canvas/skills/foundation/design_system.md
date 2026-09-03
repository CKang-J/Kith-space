# Design System

Tokens + ratios. Paint against the sheet — not random per-node numbers.

Type **behavior** lives in `typography`; color **roles** live in `color` (this skill `extends` both). This skill owns the **numbers**.

## When to use

Foundation when creating a coherent board — lock type / spacing / radius / color roles before painting. Do not invent a second type mood mid-run.

## Process

```text
… → LAYOUT PLAN → DESIGN SYSTEM (this skill) → EXECUTION → …
```

## Hard rules

1. Emit a minimal token sheet (typography / spacing / radius / colors) when the brief's P1 fields are known.
2. Prefer **roles** (primary / surface / muted / accent) over scattered hex.
3. Hierarchy must jump — H1:body ≈ 3–4:1 on posters; clear H1 > H2 > body > caption.
4. Spacing from one base step (4 or 8). No 13/16/15 random margins.
5. One radius scale (sm/md/lg). One type mood for the board.
6. If `awesome_design_md` / a brand sheet is loaded, that sheet is law for this run.

## Minimal token sheet

```text
Typography: H1 / H2 / H3 / Body / Caption
Spacing: XS SM MD LG XL XXL
Radius: SM MD LG
Colors: Primary Secondary Surface Muted Accent
Grid: columns + max width (UI surfaces)
```

## Ratios matter more than absolute sizes

```text
Hero title : body  ≈ 3.5 : 1
Primary : secondary area ≈ 1.0 : 0.6
Hero : supporting ≈ 70 : 30
```

## Checklist

- [ ] No random per-node sizes
- [ ] Visible type ladder
- [ ] ≤1 accent family; accent area restrained

## Done when

- One coherent token sheet is visible across the board
- No competing second type mood or accent family
- Spacing and radius come from the shared scale

## Related skills

`typography` · `color` · `awesome_design_md`

关键词：设计系统 / Token / 比例 / 字阶 / 间距节奏
