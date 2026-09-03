# shadcn/ui composition

<!-- MIT: adapted from shadcn-ui/ui (skills/shadcn), Copyright (c) 2023 shadcn. Retain this notice in copies. -->

**Deliverable**: Map product UI onto the canvas with shadcn-like grammar — roles, tokens, and patterns (not React trees).

## When to use

Compose product UI on canvas (settings, forms, dialogs, nav, feedback) using semantic roles and shadcn-like composition — not ad-hoc chrome.

## Principles

1. **Roles, not one-off skins** — primary / secondary / ghost / destructive mean the same everywhere.
2. **Semantic color** — background / foreground / primary / muted / danger — not random hex.
3. **One radius + spacing rhythm** across the board.
4. **Labeled states** — never color alone for active/error/disabled.
5. **Compose from patterns** — invent chrome only if nothing fits.

## Workflow

1. Name the screen job (settings, dashboard, form, dialog, marketing section …).
2. Pull tokens from `awesome_design_md` if available.
3. Compose from the pattern table; keep heights aligned within a control family.
4. Verify labels, errors, and primary action.

## Patterns

| Need | Compose |
|------|---------|
| Button primary | Filled primary + centered label; loading = visible state |
| Button secondary/ghost | Stroke or muted fill + label; same height as primary |
| Destructive | Danger fill/stroke + clear label |
| Input | Label above; field; optional placeholder; error adjacent |
| Form group | Related fields stacked with shared left edge |
| Card | Surface + title + body + optional action row |
| Table | Header row + aligned columns; no clipped cells |
| Nav | Top or side; active = weight **and** color |
| Tabs | Label row; active underline; panel below |
| Dialog / drawer | Panel with **title** + body + actions |
| Toast / alert | Compact surface + short message |
| Badge / avatar | Small pill or circle + short text/initials |
| Skeleton | Muted bars matching content layout |
| Switch / checkbox | Affordances labeled by adjacent text |

## Density notes

| Context | Lean |
|---------|------|
| Settings | Comfortable field spacing; clear section titles |
| Dashboard | Tighter tables OK; keep header distinct |
| Marketing embed | Fewer controls; one primary CTA |

## Hard rules

1. No fields with only spacing and no labels.
2. No dialog/drawer without a title.
3. No color alone for state; no mixing Material festive icons into product chrome.
4. Do not emit React/JSX — draw with `create_frame` / `create_shape` / `create_text` / `update_node`.

## Done when

Hierarchy reads in one glance; interactive states are labeled; spacing rhythm is consistent; primary action is obvious.

## Related skills

`dashboard_ui` · `mobile_app_ui` · `landing_page` · `awesome_design_md`

关键词：组件组合 / 语义色 / 表单结构 / 叠层 / 状态标注
