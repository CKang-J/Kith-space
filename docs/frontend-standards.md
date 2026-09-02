# 前端开发规范

本文件是 Kith-space 前端（共享 UI）的开发规范，由 `AGENTS.md` 的"前端开发规范"一节独立而来，作为单一入口被其 `@docs/frontend-standards.md` 引用。新增或修改前端代码时遵循本文件。

## 技术栈约束（必须遵守）

- 前端使用 React 19 + TypeScript，构建工具使用 Vite；共享 UI 使用 Tailwind CSS v4 + shadcn/ui。
- 基础 UI 组件优先从 `@/components/ui/*` 导入 shadcn/ui；先检查已有组件或用 shadcn CLI 添加，不重复手写已有的复杂交互组件。缺少时从仓库根目录运行 `pnpm --dir web exec shadcn add <component>`，不要手工复制 registry 源码。
- 存量 CSS 按触达范围渐进迁移，不做一次性全量重写；对已有页面做结构性 UI 修改时，在范围可控的前提下迁移被修改组件，纯缺陷修复可最小修改原样式。

## 代码约定（优先遵循，判断空间留给 Agent）

- 界面、交互逻辑、请求、工具和类型保持清晰边界；组件 Props 定义明确的 TypeScript 类型。
- 动态或条件类名优先使用 `@/lib/utils` 的 `cn()`；导入优先使用 `@/*` 路径别名（指向 `web/src/*`），避免新增深层相对路径。
- 新写布局、间距、颜色、排版与 hover/focus/disabled 等状态**优先**用 Tailwind 原子类与语义 Token（`bg-background`、`text-foreground`、`bg-muted` 等）表达，并适配亮暗主题；避免无必要的内联 `style` 与原始颜色值散落。无法预先枚举的运行时数值（鼠标实时坐标、测量结果、Canvas 偏移等）允许例外并附简短说明。
- 间距优先使用 `flex/grid + gap-*`；宽高相同可使用 `size-*`；shadcn 组件优先使用既有 variant 和 size。
- 字体与字号：全局 UI 与消息正文默认 14px，页面标题 16px（外观设置可在 12–16px 间同步调整，标题始终为正文 +2px，辅助信息为 `max(12px, 正文字号 - 2px)`）。非消息 UI 使用 400 常规字重，消息 Markdown 的标题与粗体使用 600。默认字体为界面 Sora Variable、消息与文档跟随界面、代码使用系统等宽字体，中文回退系统 `PingFang SC` / `Microsoft YaHei`。

> 以上是偏好而非铁律：当 Tailwind 表达明显繁琐、或修改存量代码会扩大改动面时，允许偏离并说明理由。

## 前端代码质量检查

生成或重构 React 前端代码时，至少确认：

1. 组件职责单一、拆分适度，没有把界面、请求和复杂状态继续堆入大型组件。
2. 已优先复用 shadcn/ui；Dialog/Sheet/Drawer 具备可访问标题，表单、菜单、Tabs 等遵循组件组合约束。
3. Props 与状态类型明确；键盘/焦点状态可用。
4. `pnpm run typecheck` 与 `pnpm run web:build` 通过；涉及行为时补充并运行相应测试。

## 相关文档

- `docs/kith-space/ui-direction.md` — 界面信息架构、视觉语言与语义 Token 约束。
- `docs/archive/specs/2026-07-15-chat-message-ui-density-design.md` — 聊天消息流密度与交互基准。
- `docs/archive/specs/2026-07-23-chat-icon-rail-message-pane-design.md` — 最新图标导航栏、消息中栏与消息气泡规格。
- `docs/archive/cross-platform-compatibility.md` — 三端工程基线（前端同样适用）。
