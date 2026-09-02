# Mobile / H5 app UI

**Deliverable**: 手机 / H5 / App screens — single column, thumb-first, honest chrome. Medium follows complexity.

## When to use

Mobile app / H5 / 手机页 / App 界面 / iOS Android screen / 小程序页 / 390x844 — single-column product UI with mobile chrome (not desktop dashboard, not poster).

## Design thinking

| Ask | Aim |
|-----|-----|
| **Job** | Login / list / detail / empty / tabs |
| **Tone** | One product UI language across screens |
| **Thumb** | Primary action in the lower third when possible |
| **Bitmap vs vector** | Simple icons, lists, chrome → vector. Rich header/hero scenes → bitmap. If vectors look crude, use image |
| **Chrome honesty** | Prefer not inventing OS status glyphs unless asked |
| **Size** | ~390×844 or user WxH |

Quality bar: **intentional design** — readable at phone scale, clear hierarchy. Soft-avoid desktop sidebars and festive poster chrome on product UI.

## Patterns & composition

| Pattern | Compose |
|---------|---------|
| Login / form | Labels above fields; full-width primary |
| Feed / list | Avatar + title + meta; generous row height |
| Detail | Optional top image + title + body + bottom CTA |
| Empty | Short line + one action |
| Tabs | 3–5 items; mark + label; active cue |

Safe area: side inset ~16–24; top title/back; bottom nav or sticky CTA; tap targets feel ~≥44px.

## Type

One token set across the flow. Short labels; plain words beside marks.

## Vector vs image

Tab / list / KPI marks as real geometry when simple (`icon_set` when many). Soft-avoid emoji as icons. Dense controls → `shadcn_ui`. Complex photo headers → `canvas.create_image(genPrompt)`.

## Honesty

Unless the user provides them, avoid inventing board facts such as account balances, phone numbers, brand logos, etc.

## Place on board

Optional detail header → `canvas.create_image(genPrompt)` when the plate needs bitmap/cutout; keep the title clear. Typical stack: optional header → vector chrome / icons → type → primary CTA.

## Hard rules

1. Single-column; primary CTA in the thumb zone.
2. Real glyphs + plain labels, not emoji/pictograph as tab/list icons.
3. No desktop sidebars; no festive poster chrome on product UI.

## Done when

Readable at phone scale; primary action easy to reach; medium matches complexity; language matches the user.

## Related skills

`image_gen` · `shadcn_ui` · `icon_set`

关键词：移动 / H5 / 单列 / 拇指区 CTA / 安全区
