# Resume / CV

**Deliverable**: 简历 / resume / CV — scannable professional document, not a festive poster. Structure is mostly simple vector + type; photo only when asked.

## When to use

Resume / CV / 简历 / 履历 / curriculum vitae — structured personal/professional document on canvas.

## Design thinking

| Ask | Aim |
|-----|-----|
| **Scan path** | Name → contact → latest role → skills in seconds |
| **Tone** | Professional document; one restrained accent |
| **Layout** | ≤2 columns — single / left rail / top name band |
| **Bitmap vs vector** | Hairlines, columns, section marks → vector. Photo / complex portrait → bitmap when requested. Soft-avoid decorative shape spam |
| **Facts** | Only what the user gave |
| **Size** | A4-ish (e.g. 794×1123) or user WxH |

Quality bar: **intentional design** — clear scan path and even margins. Soft-avoid festive heroes and emoji section icons.

## Structure & composition

| Pattern | When |
|---------|------|
| Single column | Dense, ATS-like clarity |
| Left sidebar | Skills / contact rail |
| Top header band | Strong name block |

Default order: name / title → contacts → summary (optional) → experience → education → skills → extras.

## Type & hierarchy

| Role | Feel |
|------|------|
| Name | Largest; one accent allowed |
| Section title | Consistent; optional hairline |
| Body | Comfortable measure |
| Meta | Dates / locations — smaller, muted |

Experience: role + employer + dates + short bullets (2–4 unless user gave more).

## Vector vs image

Hairline rules, column guides, subtle section marks → vector. Photo only when requested — small, never dominant; soft-avoid stock headshots and clip-art piles.

## Honesty

Unless the user provides them, avoid inventing board facts such as employers, dates, GPAs, phone numbers, titles, etc. Omit optional sections rather than fabricating them. Ask once for critical gaps.

## Place on board

Typeset the document grid first (`create_frame` → `create_text` → `create_shape` hairlines). `canvas.create_image(genPrompt)` only if a real photo plate is needed. `shadcn_ui` only if the brief is a resume **builder UI**.

## Hard rules

1. Scan path works; margins even; no overflow.
2. Facts only from the user; omit rather than fabricate.
3. Not a poster: no festive heroes, no emoji section icons.

## Done when

Scan path works; margins even; no overflow; language matches the user.

## Related skills

`shadcn_ui` · `image_gen`

关键词：简历 / CV / 扫描路径 / 栏结构 / 不编经历
