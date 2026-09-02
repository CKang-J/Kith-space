# Dashboard / admin UI

**Deliverable**: 后台 / dashboard / console / 数据看板 — task-first IA, not a marketing landing and not a poster.
**Core process**: Still Decide → Paint → Observe → Review. This skill owns **task-first IA**.

## When to use

Dashboard / 后台 / 控制台 / admin / console / analytics board / KPI / 数据看板 / 仪表盘 — multi-panel product UI (not marketing landing, not poster).

## Process (mandatory order)

```text
INPUT → PRIMARY TASK → BRIEF → ART DIRECTION → INFO PLAN → DESIGN SYSTEM → EXECUTION → OBSERVE → REVIEW → CORRECTION → FINAL
```

## 0. Primary task first

Write **one** operator job into `design_brief.purpose` before any chrome:

| Job | Main surface |
|-----|----------------|
| Monitor | One status / health canvas, then exceptions |
| Analyze | One primary chart or table, then breakdown |
| Work queue | Filters + table (or list); row action is the CTA |
| Master-detail | List + inspector; inspector is primary once a row is selected |
| Configure | Form / settings; save is the action |

If the prompt is vague ("做一个 dashboard"), still pick a task (default: **work queue** or **monitor** from the nouns they used). Do not fill the vacuum with KPI wallpaper.

## 1. Information order (do not skip)

```text
Primary Information → Secondary Information → Context → Action
```

- **Primary** occupies the largest region and answers the task (table, chart, canvas, inspector).
- **Secondary** supports comparison or filters — smaller, not a second hero.
- **Context** is nav, title, breadcrumbs, quiet meta.
- **Action** is one primary control per region (Apply / Save / Acknowledge).

Sidebar + top bar are **context**, not the design.

## 2. Forbidden default

Never start from four equal KPI cards. They are an `anti_ai_slop` hit unless the brief names four metrics the user actually supplied **and** they serve the primary task. A KPI is allowed only as **secondary** (or a single hero metric) when it changes what the operator does next.

## 3. Composition / density

- Desktop board ~1440×900. Phone consoles → `mobile_app_ui`; tablet via `responsive`.
- One token system: muted labels, bold values, quiet chrome.
- Alignment and scan paths matter more than decoration.
- States: loading skeleton / empty + one action / error + next step.

## 4. Execution stack

1. `create_frame` (desktop console size)
2. Context chrome (sidebar / top bar) — quiet
3. Primary information region (largest)
4. Secondary + action
5. **Second pass = subtract equal cards / align — not add another KPI row**

Charts: simple bar/line as vector structure. Complex media widgets → `canvas.create_image(genPrompt)`. Dense controls → `shadcn_ui`. Many marks → `icon_set`.

## 5. Honesty

Unless the user provides them, do not invent KPI numbers, chart series, logos, or revenue samples. Prefer `—` or empty structure.

## Review dimensions (folded)

- **Hierarchy**: primary information dominates; context chrome quiet. Fail when KPI cards, nav, and the main table share equal weight.
- **IA**: order must be primary → secondary → context → action. Fail if chrome is designed first and the task is leftover.
- **Visual**: largest region serves the primary task. Fail if four (or three) equal KPI cards are the default, or the board reads as a marketing landing / poster.

## Anti-patterns (folded)

- KPI Card × 4 (or × 3) with no primary task
- Glassmorphism metric cards / purple-blue charts without brief justification
- Invented revenue, MAU, conversion %, or chart series
- Painting a marketing landing or festive poster as a "console"
- Five equal primary buttons; hiding the only action the operator needs

## Hard rules

1. Primary task before chrome. Brief P0 before paint.
2. One main surface. Equal four-KPI walls are a fail.
3. Anti-slop: no glassmorphism KPI cards, no festive poster hero.
4. Subtraction pass when review score 70–89.

## Done when

- An operator can name the task and the next click in ~2s
- Primary region dominates; KPIs (if any) are subordinate
- Review passes with no blocker / slop hits

## Related skills

`shadcn_ui` · `icon_set` · `mobile_app_ui` · `image_gen`

关键词：后台 / dashboard / 主任务 / 禁止四张 KPI 卡
