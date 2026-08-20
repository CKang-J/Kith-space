# Banner Ad

**Deliverable**: A single-claim strip — 横幅 / 通栏 / 顶通 / social ad — not a landing page and not a poster novel.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns crop-aware, glanceable ads.

## When to use

User asks for a banner, leaderboard, social ad, 横幅, or a wide short KV. If they want a full event poster, use `poster_craft`. If they want a scrolling site, use `landing_page`.

## Process overview

```text
INPUT → BRIEF (one claim + one CTA) → SPLIT (subject vs type) → SIZE → EXECUTION → CROP CHECK → REVIEW
```

## Job

One claim + one CTA a glance can catch. One tone (clean promo, bold retail, quiet luxury). Do not tell a five-section story.

## Size (do not always use 1440×900)

| Kind | Typical |
|------|---------|
| Wide web leaderboard | 1920×400 / 1920×600 |
| Social landscape | 1200×628 |
| Square social | 1080×1080 / 1080×540 |
| Mobile strip | 750×300 / 1080×360 |
| User WxH | Honor it |

## Layout recipes

| Format | Split |
|--------|-------|
| Wide web | Subject \| copy+CTA, or full bleed + quiet type band |
| Tall mobile | Subject → claim → CTA |
| Square social | Center claim; subject as atmosphere |

Keep the claim in the **mid-band**. Assume ~5–8% edge crop.

## Type & CTA

- One primary claim; ≤1 supporting line, clearly smaller.
- One primary CTA — high contrast, not flush to the edge (inset ≥ 24px).
- CTA label is a verb phrase the user supplied (or a generic “Learn more” only if they gave no copy — prefer asking via `turn.cede` if the action is the point).
- Catalog fonts only.

## Color & impact

High contrast, few hues, thesis-aligned (see `color`). A banner can be louder than a landing; it still must not default to purple-blue mesh + particles.

## Execution stack

1. `create_frame` at the banner size (FOCUS none) or use FOCUS_FRAME_ID.
2. `update_frame.backgroundColor` (solid thesis color).
3. Subject mark (shape / boolean_op / existing `assetId` image) on one side or as atmosphere.
4. Claim `create_text`.
5. Optional one support line.
6. CTA plate + label.
7. `scene_summary` — check mid-band, margins, contrast.

## Honesty

Do not invent logos, prices, phone numbers, or legal lines the user did not provide.

## Hard rules

1. One claim, one CTA, one focal.
2. Not a mini landing: no 3-card row, no testimonials, no nav.
3. No emoji spam. No CSS gradients in `fill`.
4. Title/claim stays inside a safe inset; do not kiss the frame edge.
5. Anti-slop still applies.

## Done when

- Far: claim + CTA clear in ~1s
- Near: mid-band safe; language matches the user
- Crop would not remove the CTA or the claim

## Related skills

`design_brief` · `color` · `typography` · `anti_ai_slop`

关键词：横幅 / 广告条 / 一句话卖点 / CTA / 出血安全
