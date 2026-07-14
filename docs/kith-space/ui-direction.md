# Kith-space UI 方向

本文是 Kith-space 当前 UI 信息架构与视觉语言的权威说明。单窗口交互契约见 `docs/superpowers/specs/2026-07-10-kith-space-single-window-workspace-design.md`，个人 AgentOS 宿主与产品边界见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`，Home/Space root 补充设计见 `docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md`。现有可交互线框 `docs/prototypes/kith-space-single-window-flow.html` 只覆盖基础三态壳，尚未补 Home Spaces 页面。

结论前置：Kith-space 采用**单窗口工作区**。首次启动先初始化唯一 Human，普通冷启动随后进入 `Home` Chat；Home 是真实总控 Space，并在同一个 Dock 增加 Spaces 模块。Chat 是默认主页与基础工作面，功能模块打开后，界面只在 Chat 全宽、Chat + 模块分屏、模块全宽三种形态间切换。此前的“空间总览壳 + 空间内部壳”、旧 `Layout` 回退、Landing 与 PWA 入口均保持删除。

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

品牌标志采用“三层本地 Space”概念：暖白、鼠尾草绿与近黑三张错位平面表达 Home 和多个本地 Space，前景平面形成 `K`。用户确认的生成设计稿及其原始像素裁切是唯一母版；应用图标按母版 120/558 的标准圆角比例精确裁出透明四角，浏览器使用同源 RGBA PNG，Windows/Electron 使用同源多尺寸 ICO，不重新描摹 SVG。完整资产与回归约束见 `docs/brand.md`。

这套“有色画布 + 独立白色面板 + 克制浮层”的语言同时用于 ChatOnly、Split 和 ModuleOnly，避免不同状态像三套产品。

---

## 2. 顶层骨架

应用只有一个 `WorkspaceFrame`：

```text
顶部栏：当前 Space / 当前会话与模块 / 搜索与工具
┌────────────────────────────────────────────────────────────┐
│ Chat Pane       │ 聚合面板（可选） │ 10px 可拖拽区 │ Module Pane │
│                 │ 轨迹/话题/文件   │                 │ Dock        │
└────────────────────────────────────────────────────────────┘
```

- 未初始化时进入本地 Human 资料页；普通冷启动进入自动创建的 Home Chat，显式 Space 深链接直达目标，托盘恢复保留现有窗口现场。
- Space 名称保留快速切换入口；H4 已把默认创建、已有文件夹接入和完整目录管理移入 Home 的 Spaces 模块。顶部入口只保留快速切换、失联重连和“管理空间”跳转。
- Search 位于顶部工具组，通过按钮和 `Cmd/Ctrl + K` 进入，不占 Dock 槽位。
- 同时最多显示一个 Chat Pane、一个当前会话聚合面板和一个 Module Pane；聚合面板只依附可见 Chat，不是第二个 Module。
- Split 默认让 Chat 占可用工作区的 25%、Module 占其余空间；Chat 下限为 `max(360px, 25%)`。Tasks / Search 的模块下限为 560px，其余现有模块为 640px；模块不再使用固定 960px 上限。
- 分区间完整 10px 间隙都是拖拽热区，悬停或拖动时才显示短握柄，不显示贯穿全高的分隔线。
- 宽度不足以容纳双栏时不强行压缩，临时退化为单 Pane；窗口变宽后恢复此前的双栏意图。
- 三栏宽度优先级为当前主要工作面、Module、聚合面板、固定会话列表；不能同时满足最小宽度时先临时把聚合面板收至 `0` 并保留打开意图，ModuleOnly 不单独显示聚合面板。
- 拖拽偏好保存为工作区宽度比例而非像素。Split 内切换模块保留该比例；从 ChatOnly 打开模块、关闭模块后重新打开，或从 ModuleOnly 恢复 Chat 时，均回到 Chat 25% 的默认下限。

当前 Space 的频道或 Human-Agent DM 由规范会话 pathname 表达；打开模块时在同一 URL 上增加 `?module=<id>`，ModuleOnly 再增加 `chat=0`。Tasks 使用 `taskScope`，Agents 使用 `agent` 与 `agentTab`，Settings 使用 `settings` 表达自己的模块资源；不属于当前模块的资源参数会被清除。切换频道或 DM 时保留 active module、Chat 显隐和该模块的资源 query，并替换旧会话的 `msg`/`thread` 等临时焦点。因此一个 URL 可以同时表达“频道 A + Tasks + Split”，在紧凑会话抽屉切频道不会关闭模块，也不会把旧消息焦点带到新会话。

浏览器刷新、前进和后退都以 URL 为准恢复三态；会话列表、聚合面板、聚合 Tab 与文件筛选等短暂界面状态不进入 URL。`/tasks`、`/agent`、`/settings` 等旧模块实体路径不再作为兼容深链，未知 Space 子路径会规范化到 `/s/:slug/channel` 并保留有效 query/hash。`?legacy=1` 与旧 `Layout` 已删除。

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

Dock 按 Space 类型固定：

- Home：`Chat | Spaces | Inbox | Tasks | Agents | Settings`。
- 普通 Space：`Chat | Inbox | Tasks | Agents | Settings`。

- Dock 始终属于当前主要工作面板：ChatOnly 在 Chat 底部，Split 和 ModuleOnly 在模块底部。
- Chat 按钮始终只显示图标，用激活底色表达 Chat 是否可见，不因激活而展开。
- 其他模块默认只显示图标；当前模块横向展开并显示名称。
- Dock 白底、1px `#e0e0e0` 边框、12px 圆角和轻工具层阴影，距面板底部 14px。
- Dock 项高 39px；未激活宽 41px，激活模块宽 122px；图标 18px、标签 13px。
- 未激活项用 `#fafafa`，激活项用 `#f5f5f5`，不使用高饱和强调色。
- Dock 所在面板预留底部空间，不覆盖 Composer 或模块内容。

Spaces 只在 Home 出现；Agents 只显示当前 Space 的 agent 队伍；唯一 Human 的资料位于全局 Settings。Calendar、Canvas 等真实能力成熟后插入模块区；当前不展示无功能的空入口。

创建 Agent 时，Runtime 选择器读取 Local Runtime Worker 的实际 availability，而不是使用前端硬编码的可用状态。完整 runtime 目录始终展示：已安装项排序在前并标注“已安装”，未安装项排序在后、标注“未安装”且不可选择；默认选中第一个已安装项。OpenCode 模型选择器只展示 `opencode models` 返回并去重后的真实 `provider/model`；探测失败时显示错误、提供重试并禁止创建，不回退到虚假的 `Default`。

创建成功后，agent 只向唯一 Human 的 `dm:@you` 发送一次 2-3 句自我介绍，内容包含身份、职责/擅长能力和如何派活；不扫描频道历史、不汇报“没有消息”，也不向公共频道广播。只有创建/重试 introduction turn 的介绍私信成功进入对应 Human-Agent DM 后才视为完成；若真实消息先到，agent 先按 wake 语义回复原目标，该普通回复不算自我介绍。后续手动启动、重启和恢复只检查真实待处理消息，空收件箱保持静默；由频道、DM、任务或 backlog 触发的唤醒必须在每个原会话目标处理和回复。普通 reset 只清 session/runtime state 并保留入职状态；完整 reset 额外清当前 Agent Memory 和入职状态后重新介绍。两种 reset 都保留共享 Space 文件树，UI 不提供把“删除项目文件”伪装成 Agent 重置的入口。

---

## 4. Chat 工作面

### 4.1 Chat 全宽

ChatOnly 由当前会话工作面和可独立收起的辅助面板组成：

```text
会话列表 | 当前会话与 Composer | 聚合面板（轨迹 / 话题 / 文件）
```

- 会话列表包含 Channels 与 Human-Agent Direct Messages，保留未读、置顶、新建和切换行为；不提供 Human-Human DM。会话抽屉、Agents 模块侧栏及 Agent 选择器中的相邻 Agent 行使用一致的轻量间距，保持列表层级清晰。
- 中间复用现有 `Chat`、Composer、Thread、附件和 @mention 能力；用户界面统一称“话题”，内部数据、API 与 query 继续使用 `thread`。Agent 私聊标题区保留直达当前 Agent 详情页的入口；话题打开时默认与当前会话各占一半宽度，并可通过中间分割线继续拖拽调整。话题标题栏以普通铃铛表示“已关注”、划线铃铛表示“未关注”，关注切换不关闭面板，关闭仍由独立的 × 按钮负责。
- 删除旧“会话 / Chat / 轨迹”顶栏。会话列表纯图标开关迁入当前会话标题最左侧；标题右侧依次提供当前会话 Tasks、频道成员、聚合面板和既有更多操作的纯图标入口。Tasks 始终导航到 `module=tasks&taskScope=<当前会话ID>`，点击已打开的同一 Tasks 不解释为关闭。
- 聚合面板固定承载“轨迹 / 话题 / 文件”三个等宽滑动 Tab；白色选中底板只做 `transform` 横移，内容不淡入淡出。三个内容区通过 `hidden` 切换而不卸载，因此文件分类、关键词和搜索展开状态跨 Tab 保留，只在会话切换时重置。话题列表来自独立 thread summaries 查询，新建空话题与后续回复都会实时刷新，点击后仍在原 Chat 话题位置展开正文；文件页支持“全部 / 图片 / 视频 / 文件”和文件名/来源消息搜索。文件页与 Agents 列表复用 `components/SearchField.tsx` 的胶囊搜索框，只显示产品自己的清除按钮，输入框焦点使用浅色内描边而不是黑框。
- 实时轨迹只展示当前 base conversation 的本次前端会话缓冲；话题轨迹归一到父会话，无作用域或跨会话 ambiguous 事件不进入任何会话聚合面板。
- 会话列表与聚合面板都沿物理边界把宽度变为 `0`，内容随边界裁切，不使用淡入淡出或贯穿全高的收起长条；两者使用 Chat 侧栏曲线，Module 保持自己的切换曲线。

### 4.2 Chat 紧凑

打开模块进入 Split 时，会话列表不再占固定栏位，Chat 收成一张紧凑面板；聚合面板在宽度允许时作为 Chat 与 Module 的同级面板留在两者之间：

```text
[会话抽屉] 当前会话 | 聚合面板 | Module
消息流
Composer
```

- 会话抽屉从 Chat 左侧覆盖打开，只覆盖 Chat Pane，不挤压或遮挡聚合面板与 Module。
- 话题和 agent profile 属于 Chat 内部临时层，不占用 Module Pane；模块打开且话题存在时，紧凑 Chat 只显示话题，不再并排保留父会话消息流；聚合面板仍由自己的标题图标控制。
- Chat 被隐藏时，Chat 的临时层随之卸载；恢复后回到当前会话。

---

## 5. 模块工作面与作用域

- 当前模块包括 Inbox、Tasks、Agents、Settings；Home 另有 Spaces；Search 由顶部入口打开。Computers/Machines 不再是产品模块。
- 一次只显示一个 Module Pane，切换 Dock 项直接替换模块。
- Inbox、Tasks、Agents、Settings 只读取当前 Space 数据；Spaces 只读取 app.db registry 和真实摘要。切换 Space 时 Chat 与普通模块数据源一起切换。
- Web Store 与路由状态只使用 `SpaceInfo/spaceId/spaces` 和 `/s/:slug`；请求只发送 `x-space-id`，不得在前端保留旧 Server 双命名。
- Tasks 保留旧布局的范围侧栏，可在当前 Space 的全部任务与指定频道任务之间切换；切换范围不得改变当前 Split / ModuleOnly 姿态。
- 模块加载失败或空状态只在自身面板处理，Chat 保持可用。
- 模块不得直接控制 Chat 内部组件；Chat 也不得依赖具体模块的数据结构。
- 普通模块契约为未来的 `scope = current | all` 预留语义，但当前不显示尚不可用的跨 Space 开关。

### 5.1 Home Spaces 模块

- 规范 module id 为 `spaces`，URL 是 Home 当前会话 pathname 上的 `?module=spaces`。
- 顶部提供搜索、刷新和“新建空间”；主体使用与现有面板语言一致的 Space 卡片网格。
- 卡片至少显示名称、宿主路径和最近打开信息；Home 自身不在列表中重复展示。
- 点击卡片在当前窗口进入目标 Space 的默认 Chat，不打开新窗口。
- “新建空间”菜单提供“新建空白空间”和“使用现有文件夹”；两种表单都使用居中紧凑弹窗。Desktop 使用原生目录选择器，授权浏览器在弹窗内使用受限的主机目录浏览器，最终路径由 Core 校验。
- 普通 Space 的 `module=spaces` 是无效状态并被规范化；从顶部全局空间入口打开时导航到 Home Spaces。

H4 已复用 H3 领域/API 能力交付本节：Home Spaces 提供卡片网格、搜索、刷新、两种创建路径、失联 Space 的“重新定位文件夹”和同窗导航；Desktop 调用原生目录选择器，授权浏览器通过 Core 浏览主机文件夹。卡片与顶部列表区分 `ready | missing | error`，不可用 Space 不会被当作可打开项目；路径或数据库错误留在弹窗中供用户修正。失联深链会进入可用 Space，全部 Space 失联则展示同一视觉语言的恢复页并保持 relocate 可达。页面不承载路径或数据库校验，也没有 H5 伪聚合。

未来可在 Home 增加真正的跨 Space Inbox/Tasks/Calendar 聚合，但它们是后续真实能力，不恢复已移除的薄总览页。

---

## 6. Chat 与模块联动

布局先建立两层上下文语义，数据契约将在 Runtime 契约 v2 阶段正式落地：

- **模块级自动感知**：打开 Tasks 后，Chat 知道当前 Space 正在展示 Tasks。
- **对象级显式聚焦**：任务、文件、agent 等只有通过“在 Chat 中讨论”才成为 focused item。

每条消息发送时应固化一个结构化 `MessageContextSnapshot`，包含 Space、会话、当前模块、Context Stack 和 focused item。UI 与服务端保存 Kith-space 自己的结构，不把 OpenLoaf 的 `<stack>` XML 硬编码进核心模型；不同 runtime 适配器再按需要编码为 XML、JSON 或提示文本。

A5 已完成工作区入口与规范 URL 收口，但 `MessageContextSnapshot`、Composer Context 标签及服务端持久化仍属于后续工作，不得误标为已实现。

---

## 7. 当前实现边界

当前生产壳已完成 A5 入口收口与 P-A7 H4：`App` 只渲染 `WorkspaceFrame`；Agents、Human Settings、Desktop Settings 与 Home-only Spaces 已落地，登录/注册/邀请、Computers、Landing、Features、PWA、SSR/prerender、旧 `Layout` 与 `?legacy=1` 均已退出活跃代码。Agent 详情的“记忆”标签与概览路径通过兼容的 workspace-files API 展示并读取当前 Space 的 `<space>/.kith/agents/<agentId>`；`agentTab=workspace` 只作为既有深链兼容值保留，不再表示共享 Space 工作区。普通冷启动进入 stable Home，显式 ready 深链接仍优先；普通 Space 不显示也不能激活 Spaces。最终视觉与实际交互仍由用户在 H1-H4 验收中确认。

单窗口壳按职责拆在 `web/src/shell/`：

- `WorkspaceFrame.tsx`：路由同步、Chat / 聚合面板 / Module 响应式编排、聚合面板短暂状态与拖拽边界。
- `workspaceLayout.ts`：无 React 依赖的三态状态机。
- `paneConstraints.ts`：集中计算 Chat 响应式下限、聚合面板目标宽度、三栏可见阈值、各模块下限、单 Pane 阈值和比例到像素的夹取结果。
- `shellStore.ts`：`useSyncExternalStore` 保存版本化模块宽度比例，并按 Space 持久化最近 Chat 位置；模块与 Chat 显隐由 URL 表达，避免双重状态源。
- `workspaceRoute.ts`：解析规范会话 pathname，把 `module/chat` 与模块拥有的 `taskScope/agent/agentTab/settings` query 映射回三态，并在会话导航时只保留持久布局/模块资源；Human profile、机器旧路由和旧模块实体路径均不再映射模块。
- `ChatWorkspace.tsx`：固定/抽屉会话列表和 Chat 工作面；不再拥有轨迹数据或旧顶部工具条。
- `conversation-aggregate/`：轨迹、话题、文件三个会话级子视图；通用滑动 Tab 独立位于 `components/SlidingTabs.tsx`。
- `ModuleWorkspace.tsx`：现有业务视图薄适配。
- `WorkspaceDock.tsx` / `WorkspaceTopBar.tsx`：Dock 与顶部工具组。
- `workspaceModules.tsx`：模块注册、路由和图标元数据。

复用 `Chat.tsx`、`ChatSidebar.tsx`、`LiveTrace.tsx`、`TaskBoard.tsx`、Inbox、Settings 与现有 agent 列表能力；Chat 不再内嵌 Tasks/Files Tab，文件筛选与话题索引也不继续堆入大文件。产品模块已从 Members 收敛为 Agents（内部文件名 `Members.tsx` 暂留）；Computers 与旧 `Layout` 已删除。旧 `OverviewShell`、`SpaceShell`、`IconRail`、`RightDock` 和 `ChatSlot` 已被新壳取代。

## 8. 初始化与 Settings 边界

- 首次启动页只收集 Human 名称、可选邮箱和描述，文案不得使用“注册”“账户”或“加入团队”。默认 Home 在用户可见的 `~/Kith-space/Home` 由应用创建，首次初始化不要求用户选择；普通 Space 之后从 Spaces 模块选择路径。
- 首次初始化只在检测到完整 Electron preload bridge 时运行，并先于 `StoreProvider`/Space bootstrap。若上次写入 Human 后中断，页面用 status 返回的 partial Human 预填恢复；重复提交保持幂等。初始化完成后挂载正常产品树并自动进入 `Home`；Human 资料在全局 Settings 以 `settings=human` 表达，并通过 `GET/PATCH /api/human/profile` 修改，不使用账户页或 `/api/auth/me`。
- 普通本机/LAN 浏览器从不探测 setup API，也不显示首次启动页；未授权时只显示 Access Token Gate，已授权后进入共享工作区。
- Desktop Settings 已包含 Web 模式、端口、访问 Token、撤销浏览器会话、托盘关闭行为和系统自启动；系统自启动在开发态明确显示 unsupported，在 Windows packaged Desktop 中启用。
- 普通浏览器可在 Human Settings 撤销当前浏览器授权；该动作调用 `DELETE /api/browser-auth/session` 并返回 Access Token Gate，不是 Human 账户 logout。
- Desktop 设置区只在检测到 `window.kithDesktop` 窄 preload bridge 时显示；普通浏览器直接进入该路由会回落到 Human 设置，并且服务端对管理 API 返回 404。隐藏入口不是唯一安全边界。
- LAN 模式首次开启会先展示确认面板，明确说明 HTTP 未加密、只限受信任私网、禁止端口转发/公网暴露；用户确认后才改变监听。自动生成/轮换的访问 Token 保持一次性显示，直到用户主动确认已保存。

一句话：**Chat 是基础工作面，模块是可并行、可独占的第二工作面，Dock 是两者之间唯一稳定的布局控制器。**
