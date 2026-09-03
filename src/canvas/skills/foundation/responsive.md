# Responsive

Same information architecture across breakpoints. Not a second aesthetic, not a cropped poster.

## When to use

Craft foundation for multi-section web / app surfaces — lock breakpoints before painting a second device.

## Hard rules

1. Pick a primary board first (desktop ~1440 or mobile ~390). Do not invent a second art direction for the other size.
2. Sections **stack** on narrow widths; columns may collapse. Do not hide the primary CTA.
3. Type ladder keeps the same roles (H1 / H2 / body); only size / line-length change.
4. Touch: primary CTA in a thumb-reachable band on mobile (full-width is OK).
5. Hero may split (copy above, visual below) — do not shrink a desktop collage until type is unreadable.

## Breakpoints (defaults)

```text
desktop  ~1440 × 900+
tablet   ~768
mobile   ~390 × 844+
```

Long landing pages grow height; do not force one poster-tall frame for a whole site. Use a separate `create_frame` per device, not one stacked board.

## Checklist

- [ ] One IA, two (or three) layouts
- [ ] Primary CTA visible without hunting
- [ ] No poster-crop "responsive"

## Done when

- One IA across breakpoints; sections stack cleanly
- Primary CTA never below the fold on mobile
- Type roles consistent, only size changes

## Related skills

`layout` · `design_system`

关键词：响应式 / 断点 / 堆叠 / 同一信息架构
