# Layout

Spacing, grid, alignment, whitespace. `composition` owns the **archetype**; this skill owns **execution**.

## When to use

Craft after composition — execute margins / grid / alignment. Do not invent a second archetype.

## Hard rules

1. Spacing from one base step (4 or 8). No random 13/16/15 margins.
2. Keep empty space. Posters: ≥15% unless the user asked dense. UI: consistent inset, not edge-hugging chrome.
3. Align to a grid or a shared edge. Prefer `canvas.align_nodes` / `canvas.distribute_nodes` over eyeballing.
4. Do not default to three equal columns / four equal KPI tiles. Unequal columns are allowed when the archetype says so.
5. One primary band (hero or main task). Secondary blocks recede.

## Rhythm

```text
XS SM MD LG XL XXL   ← from design_system tokens
inset ≥ MD on posters
UI gutter from the same scale
```

## Checklist

- [ ] Same scale on all sides of a group
- [ ] Not every edge crowded
- [ ] Alignment is intentional, not centered-everything

## Done when

- One spacing rhythm across the board; empty space preserved
- Grid / shared edges read as intentional
- No default three-equal-columns filler

## Related skills

`composition` · `design_system`

关键词：版式 / 间距 / 网格 / 对齐 / 留白
