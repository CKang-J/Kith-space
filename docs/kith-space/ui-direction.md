# Kith-space UI 方向

本文是 Kith-space 当前 UI 信息架构与视觉语言的权威说明。单窗口交互契约见 `docs/superpowers/specs/2026-07-10-kith-space-single-window-workspace-design.md`，个人 AgentOS 宿主与产品边界见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`，可交互线框见 `docs/prototypes/kith-space-single-window-flow.html`。

结论前置：Kith-space 采用**单窗口工作区**。首次启动先初始化唯一 Human，随后直接进入 `Home` 或最近 Space；Chat 是默认主页与基础工作面，底部 Dock 常驻；功能模块打开后，界面只在 Chat 全宽、Chat + 模块分屏、模块全宽三种形态间切换。此前的“空间总览壳 + 空间内部壳”与旧 `Layout` 回退已经被本设计取代，后续实现将彻底删除。

---

## 1. 视觉语言

借鉴 OpenLoaf 的布局关系与空间层次，不复制其 AGPL 源码或具体实现。Kith-space 保留自身已有组件与业务视觉，只统一工作窗口的骨架：

- 窗口画布为浅灰 `#f5f5f5`，工作面板为纯白 `#ffffff`。
- 顶部栏高 40px，位于画布层；右侧工具组单独使用白底，与窗口底色形成层次。
- 主工作面板圆角 12px，无边框、无阴影；层级由白色面板、浅灰画布和间隙建立。
- 面板间隙 10px，画布外边距 8px。
- Dock、顶部工具组、抽屉、菜单和输入区可使用 1px `#e0e0e0` 边框。
- 工具层阴影为 `0 4px 16px rgba(0,0,0,.08)`；普通浮层可用 `0 8px 24px rgba(0,0,0,.10)`，主面板始终不加阴影。
- 不把现有业务视图一比一重画成原型；原型负责布局与交互，现有 Kith-space UI 负责内容呈现。

这套“有色画布 + 独立白色面板 + 克制浮层”的语言同时用于 ChatOnly、Split 和 ModuleOnly，避免不同状态像三套产品。

---

## 2. 顶层骨架

应用只有一个 `WorkspaceFrame`：

```text
顶部栏：当前 Space / 当前会话与模块 / 搜索与工具
┌────────────────────────────────────────────────────────────┐
│ Chat Pane       │ 10px 可拖拽热区 │ Module Pane           │
│                 │                  │                       │
│                 │                  │             Dock      │
└────────────────────────────────────────────────────────────┘
```

- 未初始化时进入本地 Human 资料页；初始化后进入上次使用的 Space，没有记录时进入自动创建的 `Home`，不经过独立总览页。
- Space 名称承担切换与管理入口。
- Search 位于顶部工具组，通过按钮和 `Cmd/Ctrl + K` 进入，不占 Dock 槽位。
- 同时最多显示一个 Chat Pane 和一个 Module Pane。
- Split 默认让 Chat 占可用工作区的 25%、Module 占其余空间；Chat 下限为 `max(360px, 25%)`。Tasks / Search 的模块下限为 560px，其余现有模块为 640px；模块不再使用固定 960px 上限。
- 分区间完整 10px 间隙都是拖拽热区，悬停或拖动时才显示短握柄，不显示贯穿全高的分隔线。
- 宽度不足以容纳双栏时不强行压缩，临时退化为单 Pane；窗口变宽后恢复此前的双栏意图。
- 拖拽偏好保存为工作区宽度比例而非像素。Split 内切换模块保留该比例；从 ChatOnly 打开模块、关闭模块后重新打开，或从 ModuleOnly 恢复 Chat 时，均回到 Chat 25% 的默认下限。

当前 Space 的频道或 Human-Agent DM 继续由路径表达；打开模块时在同一会话 URL 上增加 `?module=<id>`，ModuleOnly 再增加 `chat=0`。因此一个 URL 可以同时表达“频道 A + Tasks + Split”，在紧凑会话抽屉切频道不会关闭模块。迁移期旧模块实体路径可作为兼容深链入口，A5 完成后只保留规范 Space 路由。浏览器刷新、前进和后退都以 URL 为准恢复三态；会话/轨迹抽屉等短暂界面状态不进入 URL。`?legacy=1` 与旧 `Layout` 不再属于目标态，必须删除。

---

## 3. 三态布局与 Dock

### 3.1 状态机

```text
ChatOnly   = Chat 可见，Module 不存在
Split      = Chat 可见，Module 可见
ModuleOnly = Chat 隐藏，Module 可见
```

系统不允许 Chat 与 Module 同时隐藏。

| 当前状态 | 点击 Chat | 点击当前模块 | 点击其他模块 |
|---|---|---|---|
| ChatOnly | 无操作 | 打开 Split | 打开对应模块的 Split |
| Split | 进入 ModuleOnly | 关闭模块，回到 ChatOnly | 保持 Split 并替换模块 |
| ModuleOnly | 恢复 Split | 关闭模块，回到 ChatOnly | 保持 ModuleOnly 并替换模块 |

这意味着 Chat 按钮只有在模块已打开时才允许隐藏 Chat；当 Chat 是唯一工作面时，点击 Chat 必须无操作。

### 3.2 Dock

Dock 固定为：`Chat | Inbox | Tasks | Agents | Settings`。

- Dock 始终属于当前主要工作面板：ChatOnly 在 Chat 底部，Split 和 ModuleOnly 在模块底部。
- Chat 按钮始终只显示图标，用激活底色表达 Chat 是否可见，不因激活而展开。
- 其他模块默认只显示图标；当前模块横向展开并显示名称。
- Dock 白底、1px `#e0e0e0` 边框、12px 圆角和轻工具层阴影，距面板底部 14px。
- Dock 项高 39px；未激活宽 41px，激活模块宽 122px；图标 18px、标签 13px。
- 未激活项用 `#fafafa`，激活项用 `#f5f5f5`，不使用高饱和强调色。
- Dock 所在面板预留底部空间，不覆盖 Composer 或模块内容。

Agents 只显示当前 Space 的 agent 队伍；唯一 Human 的资料位于全局 Settings。Calendar、Canvas 等真实能力成熟后插入模块区；当前不展示无功能的空入口。

---

## 4. Chat 工作面

### 4.1 Chat 全宽

ChatOnly 由三张独立白色工作面板组成：

```text
会话列表 | 当前会话与 Composer | 实时轨迹
```

- 会话列表包含 Channels 与 Human-Agent Direct Messages，保留未读、置顶、新建和切换行为；不提供 Human-Human DM。
- 中间复用现有 `Chat`、Composer、Thread、附件和 @mention 能力。
- 实时轨迹继续展示 agent 的执行过程。
- 三区之间使用与整个工作区一致的有色间隙与圆角面板语言。

### 4.2 Chat 紧凑

打开模块进入 Split 时，会话列表与实时轨迹不再占固定栏位，Chat 收成一张紧凑面板：

```text
[会话抽屉] 当前会话 [轨迹抽屉]
消息流
Composer
```

- 会话抽屉从 Chat 左侧覆盖打开，轨迹抽屉从 Chat 右侧覆盖打开。
- 抽屉只覆盖 Chat Pane，不挤压或遮挡 Module Pane，并且两者互斥。
- Thread 和 agent profile 属于 Chat 内部临时层，不占用 Module Pane。
- Chat 被隐藏时，Chat 的临时层随之卸载；恢复后回到当前会话。

---

## 5. 模块工作面与作用域

- 当前模块包括 Inbox、Tasks、Agents、Settings；Search 由顶部入口打开。Computers/Machines 不再是产品模块。
- 一次只显示一个 Module Pane，切换 Dock 项直接替换模块。
- 当前阶段所有模块只读取当前 Space 数据；切换 Space 时 Chat 与模块数据源一起切换。
- Web Store 与路由状态只使用 `SpaceInfo/spaceId/spaces` 和 `/s/:slug`；请求只发送 `x-space-id`，不得在前端保留旧 Server 双命名。
- Tasks 保留旧布局的范围侧栏，可在当前 Space 的全部任务与指定频道任务之间切换；切换范围不得改变当前 Split / ModuleOnly 姿态。
- 模块加载失败或空状态只在自身面板处理，Chat 保持可用。
- 模块不得直接控制 Chat 内部组件；Chat 也不得依赖具体模块的数据结构。
- 模块契约为未来的 `scope = current | all` 预留语义，但当前不显示尚不可用的跨 Space 开关。

未来可增加真正的跨 Space 主窗口或聚合视图，但它是后续能力，不恢复当前已移除的薄总览页。

---

## 6. Chat 与模块联动

布局先建立两层上下文语义，数据契约将在 Runtime 契约 v2 阶段正式落地：

- **模块级自动感知**：打开 Tasks 后，Chat 知道当前 Space 正在展示 Tasks。
- **对象级显式聚焦**：任务、文件、agent 等只有通过“在 Chat 中讨论”才成为 focused item。

每条消息发送时应固化一个结构化 `MessageContextSnapshot`，包含 Space、会话、当前模块、Context Stack 和 focused item。UI 与服务端保存 Kith-space 自己的结构，不把 OpenLoaf 的 `<stack>` XML 硬编码进核心模型；不同 runtime 适配器再按需要编码为 XML、JSON 或提示文本。

本轮 P4 只落地工作区壳、Dock 和布局状态机，`MessageContextSnapshot`、Composer Context 标签及服务端持久化仍属于后续工作，不得误标为已实现。

---

## 7. 当前实现边界

当前生产壳仍处于本机化转向的过渡期：Agents 模块与 Human Settings 资料入口已落地，登录/注册和 Computers 入口已删除；旧 `/computer/*` 深链与 `?module=computers` 不再打开模块，而是回到 ChatOnly。Landing、其他旧深链与 `?legacy=1` 仍待 A4/A5 删除，不是可继续扩展的兼容承诺。

单窗口壳按职责拆在 `web/src/shell/`：

- `WorkspaceFrame.tsx`：路由同步、响应式 Pane 编排与拖拽边界。
- `workspaceLayout.ts`：无 React 依赖的三态状态机。
- `paneConstraints.ts`：集中计算 Chat 响应式下限、各模块下限、单 Pane 阈值和比例到像素的夹取结果。
- `shellStore.ts`：`useSyncExternalStore` 保存版本化模块宽度比例，并按 Space 持久化最近 Chat 位置；模块与 Chat 显隐由 URL 表达，避免双重状态源。
- `workspaceRoute.ts`：解析父壳拿不到的频道/agent/设置子路由参数，并把 URL 映射回三态；Human profile 与机器旧路由均不再映射模块。
- `ChatWorkspace.tsx`：全宽三区与紧凑抽屉形态。
- `ModuleWorkspace.tsx`：现有业务视图薄适配。
- `WorkspaceDock.tsx` / `WorkspaceTopBar.tsx`：Dock 与顶部工具组。
- `workspaceModules.tsx`：模块注册、路由和图标元数据。

复用 `Chat.tsx`、`ChatSidebar.tsx`、`LiveTrace.tsx`、`TaskBoard.tsx`、Inbox、Settings 与现有 agent 列表能力，不整块重写大文件。产品模块已从 Members 收敛为 Agents（内部文件名 `Members.tsx` 暂留）；Computers 已删除，旧 `Layout` 仍待删除。旧 `OverviewShell`、`SpaceShell`、`IconRail`、`RightDock` 和 `ChatSlot` 已被新壳取代。

## 8. 初始化与 Settings 边界

- 首次启动页只收集 Human 名称、可选邮箱和描述，文案不得使用“注册”“账户”或“加入团队”。
- 初始化完成后自动进入 `Home`；Human 资料可以在全局 Settings 修改。
- Desktop Settings 额外包含 Web 模式、端口、访问 Token、撤销浏览器会话、托盘关闭行为和系统自启动。
- 普通浏览器不显示也不能调用上述 Desktop 专属设置；浏览器只显示可安全远程操作的产品设置。
- LAN 模式首次开启必须展示 HTTP 未加密、只限受信任私网、禁止端口转发/公网暴露的明确提示。

一句话：**Chat 是基础工作面，模块是可并行、可独占的第二工作面，Dock 是两者之间唯一稳定的布局控制器。**
