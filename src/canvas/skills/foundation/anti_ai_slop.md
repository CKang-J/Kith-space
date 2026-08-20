# Anti-AI Slop

**Deliverable**: A concrete ban list for this run, plus a pass/fail check before claiming the board is done.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns the cliché detector.

## When to use

Always keep this in mind. Load it explicitly on posters, landings, banners, and any “make it look premium/tech” request. Unjustified hits block done.

## Process overview

1. Copy the cliché list into `design_brief.avoid` (plus any brief-specific bans).
2. While painting, prefer meaning over decoration.
3. Before finish: list `anti_slop_hits` (or empty). Unjustified hits → subtract or rebuild.

Treat each hit as a **risk** unless the brief / user explicitly asked for it (e.g. “glass cards are the brand”).

## Cliché list (default bans)

- Purple–blue mesh / nebula / cosmic **gradient** background (`purple_blue_gradient`)
- Glassmorphism cards, frosted panels, generic blur pills (`glassmorphism`)
- Isometric “feature” card grid, 3 equal rounded rectangles with icons (`three_card_layout`)
- Random particles, floating dots, star fields, decorative noise (`random_particles` / `decorative_noise`)
- Floating 3D abstract shapes with no thesis (`floating_3d_objects`)
- Excessive rounding on every rect (`excessive_rounding`)
- Soft infinite shadows / neon glow on everything (`excessive_shadows`)
- Pill-shaped everything (`pill_overuse`)
- Center-everything with no hierarchy (`center_everything`)
- Generic SaaS hero: gradient + 3 cards + fake logos (`generic_hero`)
- Emoji used as icons or as the only illustration
- Stack of identical rounded-rect cards as “layout”

## Why this matters

Viewers are fatigued. These defaults signal “template,” not a brief. They also fight Halloween / editorial / luxury theses (orange-black carnival is not a purple dashboard).

## Substitutes

| Instead of | Do |
|------------|----|
| Purple-blue gradient ground | Solid surface from the thesis (charcoal, paper, orange field) or a quiet two-stop vignette in thesis hues |
| Glass cards | One quiet band or no card at all; type on the ground |
| Isometric feature grid | One hero mark + hierarchy of type |
| Particles | Constructed shapes / `boolean_op` silhouettes that mean something (moon, pumpkin, mark) |
| Emoji icons | `create_shape` + `boolean_op` (moon = large circle subtract small) |

## Gate

```text
hit AND no brief justification → must_fix; do not claim done
hit AND user/brief asked for it → note only
```

## Hard rules

1. Unjustified hits on the cliché list block pass even if the layout is “full”.
2. Prefer remove/merge over adding more decoration when a hit appears.
3. Do not “fix” slop by adding a second gradient.
4. CSS `linear-gradient()` in `fill` is invalid on this host — not a style choice.

## Done when

- [ ] `anti_slop_hits` listed (or explicitly empty)
- [ ] Unjustified hits removed
- [ ] Thesis still holds after subtraction

## Related skills

`design_brief` · `color` · `polish` · `poster_craft`

关键词：反 AI 俗套 / 紫蓝渐变 / 玻璃拟态 / 等距卡片 / 粒子 / emoji 图标
