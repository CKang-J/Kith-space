# Imagery

What the picture is for. `visual_direction` owns thesis/DNA; `image_gen` (`canvas.create_image(genPrompt)`) executes bitmaps. This skill owns **placement and bans**.

## When to use

Craft after visual_direction DNA — decide photo / illustration / vector and keep type off the pixels.

## Hard rules

1. One visual hero. Coverage on visual-first posters: **60–85%**. Do not run three equal photos.
2. Complex atmosphere / material / lighting → bitmap via `canvas.create_image(genPrompt)`. Simple marks → vector (`canvas.create_shape` / `canvas.boolean_op`).
3. **No baked titles** (name, slogan, price, HUD, watermark, fake logo) unless the user asked for in-image lettering.
4. Leave a quiet band for overlay type. Do not fill every edge.
5. Prompt material + lighting, not empty adjectives (cinematic / 8k / masterpiece).

## Choose

```text
vector     marks, symbols, UI chrome, simple geometry
bitmap     hero object, space, product plate, atmosphere
none       type-led boards — do not invent a stock photo
```

## Checklist

- [ ] Hero is one subject
- [ ] Type is overlay (unless asked)
- [ ] Quiet zone reserved for copy

## Done when

- One hero; bitmap vs vector matches complexity
- Overlay type has a quiet band; no baked copy in the pixels
- No three-equal-photos stacking

## Related skills

`visual_direction` · `image_gen`

关键词：图像 / 位图 vs 矢量 / 主视觉占比 / 禁止烘焙标题
