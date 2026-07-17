# 聊天消息 UI 设计验收记录

- final result: blocked
- 状态：待用户手动视觉验收
- 日期：2026-07-15
- 参考：用户提供的消息 UI 图一、图二，以及 Kith-space 改造前截图

## 已完成

- 统一主消息、话题、action card 与临时回复预览的消息骨架。
- 落地规格中的消息尺寸、颜色、行高、标题、滚动留白、话题摘要和工具焦点规则。
- 手动反馈增量已实现：15px 消息间距、名称加粗、头像状态点替代状态文字、气泡级 hover 工具栏、表情入口上移，以及工具栏右侧/上方自适应位置。
- 类型检查、610 项单测、集成测试与 Web 生产构建通过。
- 本次手动反馈增量通过类型检查与 25/25 条相关消息 UI 契约测试；按用户要求未重复浏览器视觉测试。

## 待手动检查

- `1423×912`、`1280×800`、`1024×768`、360px Chat Pane、话题分栏和 200% 缩放。
- 短消息高度、长 Markdown 行宽、Human/Agent/System/action/preview、附件、reaction、任务、话题和归档。
- ChatOnly 中心 Chat 卡片、圆角和画布间隙保持不变；常驻会话导航取消卡片底板并直接使用画布背景，新模块入口和 Split 会话抽屉不出现贯穿式横线或竖线。
- Chat 标题栏在宽 ChatOnly 与窄 Split 下都相对 Chat 卡片保持左右 14px，与 24px 私聊头像在 52px 标题栏中的上下留白一致；日期分隔、消息与 Composer 共用 1040px 居中轨道，Composer 左边对齐头像槽、右边对齐消息内容列最大边界，并相对 Chat 卡片保持左右视觉留白相等，滚动条出现/消失时不横向跳动；消息流只允许纵向滚动，窄 Split 中按既有 gutter 自适应收缩且不会被隐藏工具栏撑出横向滚动条。
- 悬浮工具、键盘焦点、无 hover 更多入口、Composer 尾部可见性、控制台与请求数量。
- 短气泡右侧空间充足时工具栏处于右侧；长气泡或窄 Pane 空间不足时工具栏切换到气泡上方。
- 工具栏仅在气泡 hover/focus 时出现，外显顺序为“加表情、话题、复制、更多”，气泡下方不再有空 reaction 加号。

浏览器最终对比验收依用户要求暂停，因此 `final result` 保持 `blocked`；本文件不把未执行的视觉矩阵标记为通过。

---

# Design QA — panel surface contour

## Scope

Transfer the panel-outline material from the supplied enlarged reference into the existing Kith-space shell. This is a surface-treatment match, not a full-screen clone: Kith-space information architecture, typography, icons, content, and interaction layout remain intentionally unchanged.

## Visual truth and implementation evidence

- Reference: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-f80cdb02-6885-45c3-8e28-b09472a717dc.png`
- Pre-refinement implementation capture: `C:\Users\Administrator\.codex\visualizations\2026\07\17\019f6f72-e1a9-7620-bd27-b048c9ee9d37\kith-panel-after.png`
- User-reported coarse-outline capture: `C:\Users\Administrator\AppData\Local\Temp\codex-clipboard-80feb0cb-5c1b-458d-ac53-b3381ad897cb.png`
- Full-view comparison: `C:\Users\Administrator\.codex\visualizations\2026\07\17\019f6f72-e1a9-7620-bd27-b048c9ee9d37\panel-surface-full-comparison.png`
- Focused contour comparison: `C:\Users\Administrator\.codex\visualizations\2026\07\17\019f6f72-e1a9-7620-bd27-b048c9ee9d37\panel-surface-focused-comparison.png`
- Compact three-panel capture: `C:\Users\Administrator\.codex\visualizations\2026\07\17\019f6f72-e1a9-7620-bd27-b048c9ee9d37\kith-panel-compact.png`
- Desktop viewport: 1426 × 893, Electron Desktop.

The reference and implementation were placed in the same full-view comparison input. Because the source is a different product and an enlarged crop, the focused pass normalizes the visible panel corners rather than claiming a false one-to-one viewport match.

## Required fidelity surfaces

- Shape and surfaces: the revised treatment has no explicit panel border. It uses the near-white panel against the micro-gray canvas, a shallow edge-hugging shadow, an inner top highlight, and a native desktop radius.
- Layout and spacing: preserved the existing Kith-space shell geometry. Verified both the normal Chat-only layout and the compact Chat + aggregate + module layout.
- Nested surfaces: the unframed conversation navigation and compact inner Chat card explicitly opt out of the shared contour, preventing doubled borders or nested shadows.
- Colors and tokens: centralized the treatment in shell-level tokens so main Chat, aggregate, and module panels share one material.
- Typography, icons, imagery, and copy: intentionally unchanged; the request concerned the panel contour and no new image asset was required.
- States and interactions: module opening/closing and compact split behavior remain functional in the running Electron app.
- Accessibility: no semantic controls, focus behavior, text contrast, motion, or keyboard paths were changed. The new outline improves boundary perception without becoming a high-contrast box.
- Responsive scope: Kith-space is Desktop-first. The wide Desktop state and its compact multi-panel state were checked; a mobile viewport is not a product target for this shell.

## Findings and iteration history

### Iteration 1

- P0: none.
- P1: none.
- P2: the explicit 1 px neutral outline becomes a visibly thick solid band under the user's extreme zoom, unlike the reference's graduated edge shadow.
- Intentional deviation: the reference's zoomed radius is not copied literally. It is translated to a 16 px native desktop radius so the current Kith-space layout keeps its density and component hierarchy.

### Iteration 2

- Removed the explicit outline token and the panel border.
- Rebuilt the contour with a short 10% contact shadow, a wider 4% ambient shadow, and a reduced inner highlight.
- Post-fix browser and computer capture intentionally not run at the user's request; manual visual acceptance is pending.

### Iteration 3

- P2: the 4% ambient layer still spreads too far from the panel and remains noticeable at normal viewing distance.
- Removed the ambient layer entirely. The contour now uses only the short contact shadow and the reduced inner highlight.
- Browser and computer capture remain intentionally skipped; manual visual acceptance is pending.

### Iteration 4

- P3: the remaining contact shadow still reads slightly too thick against the reference.
- Reduced the contact shadow from a 2 px / 10% treatment to 1 px / 8%, without changing the panel fill, radius, or inner highlight.
- Browser and computer capture remain intentionally skipped; manual visual acceptance is pending.

### Iteration 5

- Centralized the application canvas as `--ui-canvas-bg: #eeeeee` and the shared muted fill as `--ui-muted-bg: #ececec`.
- AI message bubbles, selected navigation/buttons, and segmented-control tracks now consume the shared muted-fill token instead of separate hard-coded grays.
- Browser and computer capture remain intentionally skipped; manual visual acceptance is pending.

### Iteration 6

- Removed the full-width 40 px workspace context bar and moved the Space switcher, Space name, and current conversation into the first row of the ChatOnly conversation list.
- Reused `--shell-gap: 10px` for all four workspace-canvas edges, giving the panels the requested 10 px top and bottom clearance without introducing a second spacing value.
- Updated the loading skeleton and static shell contracts to the same structure. Browser and computer capture remain intentionally skipped at the user's request; manual visual acceptance is pending.

### Iteration 7

- Found that the full Chat layout wrapper still used `overflow: hidden`, which clipped the child panels' 1 px contact shadow at the wrapper boundary and made the bottom edge look shaved.
- Changed only the full multi-panel layout wrapper to `overflow: visible`; each actual panel keeps `overflow: hidden`, so message scrolling and rounded-corner content clipping are unchanged.
- Browser and computer capture remain intentionally skipped at the user's request; manual visual acceptance is pending.

### Iteration 8

- Measured the supplied enlarged corner crop at roughly 33–35 image pixels. The 2 px divider and approximately 4 px icon strokes indicate about 2× display scaling, yielding a native CSS radius near 17–18 px.
- Increased the shared panel radius from 16 px to 18 px. The panel shadow, fills, internal controls, and layout dimensions remain unchanged.
- Browser and computer capture remain intentionally skipped at the user's request; manual visual acceptance is pending.

## Final result

blocked
