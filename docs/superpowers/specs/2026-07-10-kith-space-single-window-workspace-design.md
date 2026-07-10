# Kith-space 单窗口工作区前端架构设计

- 日期：2026-07-10
- 状态：设计与线框已确认，生产壳第一版联调中
- 阶段：P4 前端信息架构纠偏与桌面线框原型
- 依据：用户提供的 Kith-space 截图、OpenLoaf 界面截图与手绘交互图

## 1. 决策摘要

Kith-space 不再继续当前“空间总览壳 + 空间内部壳”的双壳方案。新的目标是一个桌面优先的单窗口工作区：应用启动后自动进入上次使用的 Space，Chat 是默认主页与基础工作面，底部 Dock 常驻；点击 Dock 模块后，Chat 与模块按状态机在 Chat 全宽、Chat + 模块分屏、模块全宽三种形态之间切换。

本设计借鉴 OpenLoaf 的布局关系、Dock 迁移感和界面状态自动感知思想，但不复制 OpenLoaf 的 AGPL 源码或具体实现。

本设计取代当前 P4 双壳方向中的以下内容：

- 移除空间总览页及其 bento 驾驶舱定位。
- 不再使用空间内部左侧 `IconRail` 作为主要导航。
- 不再把功能模块限定为当前 `RightDock` 的窄右栏形态。
- 不再让 Members、Computers、Inbox、Search 临时替换 Chat 中间主视图。

保留并强化以下产品原则：

- Chat 是人和 agent 协作的核心工作面。
- 模块通过 MCP 和统一上下文与 Chat 联动。
- 当前阶段所有界面与模块默认服从当前 Space。
- 未来可增加跨 Space 聚合，但不在本阶段实现。

## 2. 目标与非目标

### 2.1 目标

- 建立一个稳定、可解释的单窗口页面层级。
- 让 Chat 和功能模块可以同时工作，也可以各自全宽。
- 让 Dock 在不同布局状态下保持一致的控制语义。
- 复用旧版 Chat、会话列表、Composer、实时轨迹和现有模块行为。
- 为任务、文件、画布等界面状态自动进入消息上下文建立统一契约。
- 先用桌面线框原型验证布局和交互，再进入前端实现。

### 2.2 非目标

- 本阶段不实现真正的跨 Space Inbox、Tasks 或其他聚合。
- 本阶段不实现 OpenLoaf 的“全局主窗口 + 项目窗口”双窗口能力。
- 本阶段不实现任意数量、任意停靠的通用窗口管理器。
- 本阶段不完成 Calendar、Canvas 等尚未具备真实业务能力的模块。
- 本阶段不确定最终高保真颜色、动效和视觉细节。
- 本阶段不修改 runtime 契约或 MCP 服务端实现。

## 3. 顶层窗口骨架

应用只有一个 `WorkspaceFrame`：

```text
┌──────────────────────────────────────────────────────────────┐
│ 顶部栏：当前 Space / 快捷搜索 / 全局工具                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ Chat Pane        │ 可拖拽分隔线 │ Module Pane                │
│                  │              │                            │
│                  │              │                            │
│                  │              │                 Dock       │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 顶部栏

- 左侧展示当前 Space 名称。
- 点击 Space 名称打开切换、新建和管理菜单。
- 应用启动时自动进入上次使用的 Space。
- Search 不占 Dock，通过顶部入口和 `Cmd/Ctrl + K` 提供。
- 没有 Space 时，主体区域显示创建或连接 Space 的轻量引导，不恢复独立总览页。

### 3.2 主体区域

- 同一时刻最多展示一个 Chat Pane 和一个 Module Pane。
- 分屏默认让 Chat 占可用工作区的 25%、Module 占其余空间；Chat 下限为 `max(360px, 25%)`。
- 两个 Pane 之间可拖拽；Split 内切换模块保留比例，关闭重开模块或从 ModuleOnly 恢复 Chat 时重置为默认比例。
- Tasks / Search 的 Module 下限为 560px，其余现有模块为 640px；Module 最大宽度由 Chat 下限动态决定，不设固定像素上限。
- 窗口不足以容纳两者时，进入单 Pane 响应式规则，Chat 与 Module 通过 Dock 互相切换，不强行压缩成不可用的双栏。

### 3.3 分区卡片设计语言

- 整个工作窗口使用 `#f5f5f5` 浅灰画布背景，工作面板使用纯白 `#ffffff`。
- 顶部全局栏高 40px，位于画布层，不与下方工作区连成一整块白色平面。
- 顶部栏右侧的搜索、提醒和更多操作收纳在一个整体白色圆角工具组中；工具组使用 1px `#e0e0e0` 边框、12px 圆角和轻工具层阴影。
- ChatOnly 中的会话列表、消息区和实时轨迹分别是独立的纯白圆角工作卡片。
- Split 中的紧凑 Chat 与 Module 分别是独立的纯白圆角工作卡片。
- ModuleOnly 中的模块仍保持为带外边距的单张白色圆角工作卡片，不直接铺满窗口底色。
- 主工作卡片统一使用 12px 圆角，不使用边框和阴影；层级完全由白色面板、浅灰画布和圆角建立。
- 卡片之间保留 10px 有色间隙，卡片与窗口边缘保留 8px 外边距。
- 两个 Pane 之间的完整 10px 间隙都是拖拽热区；中央仅在悬停或拖动时显现 4px × 24px 的短握柄，不显示贯穿分隔线。
- 1px `#e0e0e0` 边框只用于 Dock、顶部工具组、抽屉、菜单和输入区等浮层或内部控件。
- 浮层阴影分为工具层 `0 4px 16px rgba(0,0,0,.08)` 与普通浮层 `0 8px 24px rgba(0,0,0,.10)`，主工作卡片始终无阴影。
- Dock 位于当前主要工作卡片内部，不跨越卡片间隙。

## 4. 面板状态机

### 4.1 状态

```text
ChatOnly   = Chat 可见，Module 不存在
Split      = Chat 可见，Module 可见
ModuleOnly = Chat 隐藏，Module 可见
```

系统不允许 Chat 与 Module 同时不可见。

当窗口宽度不足以满足两个 Pane 的最小宽度时，`Split` 暂时不可用：从 ChatOnly 点击模块直接进入 ModuleOnly；从 ModuleOnly 点击 Chat 直接进入 ChatOnly。窗口重新变宽后，若用户之前选择过模块，则恢复进入 Split。该响应式替代规则不改变桌面宽度下的状态机。

### 4.2 Dock 转移规则

| 当前状态 | 点击 Chat | 点击当前模块 | 点击其他模块 |
|---|---|---|---|
| ChatOnly | 无操作 | 打开 Split | 打开对应模块的 Split |
| Split | 进入 ModuleOnly | 关闭模块并进入 ChatOnly | 保持 Split 并替换模块 |
| ModuleOnly | 恢复 Split | 关闭模块并进入 ChatOnly | 保持 ModuleOnly 并替换模块 |

### 4.3 Dock 所属区域

- ChatOnly：Dock 位于整个 Chat 工作区底部居中。
- Split：Dock 位于 Module Pane 底部居中。
- ModuleOnly：Dock 位于整个模块工作区底部居中。
- Dock 所在 Pane 必须预留底部空间，不能覆盖 Composer 或模块内容。

## 5. Space 作用域与切换

### 5.1 当前阶段

- Chat、Inbox、Tasks、Members、Computers、Settings 默认只显示当前 Space 数据。
- 当前模块的上下文必须携带明确的 Space ID。
- 切换 Space 时，整个 Chat 和模块数据源一起切换。

### 5.2 切换行为

- 保留当前布局模式、当前模块和分隔比例。
- 恢复目标 Space 上次使用的频道或 DM。
- 清除上一个 Space 的 focused item、打开资源和草稿级 `msg-context` 排除项。
- 根据目标 Space 当前界面重新建立 Context Stack。
- 关闭所有临时会话抽屉、轨迹抽屉、Thread 和 Profile 浮层。

例如，从 Space A 的 Tasks Split 切换到 Space B 后，界面仍为 Tasks Split，但展示的是 Space B 的任务，且不携带 Space A 的任务或文件上下文。

### 5.3 未来扩展

模块契约预留 `scope = current | all`，未来可在模块标题区显示作用域选择器。本阶段不展示无功能的空入口，也不实现 `all`。

## 6. Chat Pane

### 6.1 Chat 全宽形态

```text
会话列表 | 当前会话与 Composer | 实时轨迹
```

- 会话列表包含 Channels 与 Direct Messages。
- 保留未读、置顶、新建频道、频道切换等现有行为。
- 实时轨迹继续显示 agent 的思考、工具调用与执行过程。
- 会话列表和实时轨迹可独立收起并调整宽度。
- 用户手动显隐和宽度偏好需要持久化。

### 6.2 Chat 紧凑形态

打开模块进入 Split 时，会话列表与实时轨迹进入“强制紧凑”状态，但不覆盖用户的手动偏好：

```text
[会话抽屉按钮] 当前频道或 DM [轨迹抽屉按钮]
------------------------------------------------
消息流
Composer + msg-context
```

- 会话抽屉从 Chat Pane 左侧覆盖打开。
- 实时轨迹抽屉从 Chat Pane 右侧覆盖打开。
- 抽屉只覆盖 Chat Pane，不挤压或遮挡 Module Pane。
- 两个抽屉互斥。
- 选择频道或 DM 后，会话抽屉自动关闭。
- Thread、成员详情和 agent profile 都属于 Chat 内部临时层，不占用 Module Pane。
- Chat 被隐藏时，所有 Chat 临时层一并关闭。
- 关闭模块回到 ChatOnly 后，恢复打开模块前的会话列表与轨迹显隐偏好。

## 7. Dock 与模块系统

### 7.1 第一阶段 Dock

```text
Chat | Inbox | Tasks | Members | Computers | Settings
```

- Chat 可见时 Chat 按钮激活。
- Split 时 Chat 与当前模块同时激活。
- ModuleOnly 时仅当前模块激活。
- Dock 默认仅显示图标；当前打开的功能模块横向展开并显示模块名称。
- Chat 按钮始终保持纯图标，用激活底色表达 Chat 是否可见，不因激活而展开。
- Dock 外壳使用白底、1px `#e0e0e0` 边框、12px 圆角和轻阴影，距主卡片底部 14px。
- Dock 图标项高 39px；未激活项宽 41px，激活模块宽 122px；图标 18px，展开标签 13px，图标与标签间距 8px。
- 未激活项使用近白 `#fafafa`，激活项使用浅灰 `#f5f5f5`，不使用高饱和强调色。
- Inbox、Tasks 等可展示克制的数字角标。
- Calendar、Canvas 后续插入模块区；Settings 始终位于末尾。

### 7.2 Module Pane

- 标题区展示模块名称、当前 Space 和模块自身操作。
- 一次只打开一个模块。
- 点击其他 Dock 项直接替换当前模块。
- 模块加载失败只影响 Module Pane，Chat 保持可用。
- 模块空状态在自身内容区处理。

### 7.3 模块边界

每个模块只需提供：

- 模块身份、标题、图标与渲染入口。
- 当前打开资源的 Context Descriptors。
- “在 Chat 中讨论”等标准上下文动作。
- 接收服务端或 MCP 事件后的数据刷新能力。

模块不得直接控制 Chat 内部组件。Chat 也不得依赖 Tasks、Inbox 等模块的内部数据结构。

## 8. Chat 与模块联动

### 8.1 两层上下文

- 模块级上下文自动感知：打开 Tasks 后，Chat 自动知道当前界面处于当前 Space 的 Tasks。
- 对象级上下文显式聚焦：任务、文件、成员等只有点击“在 Chat 中讨论”后才成为 focused item。

### 8.2 “在 Chat 中讨论”

- 把目标对象设置为 focused item。
- Chat 隐藏时自动恢复 Split。
- 保持当前 Module Pane 打开。
- 聚焦当前频道或 DM 的 Composer。
- 不自动创建新频道、DM 或独立会话。

## 9. Message Context Snapshot

### 9.1 语义

每条消息在发送时固化发送瞬间的界面状态。历史消息不依赖当前界面，也不随着文件关闭、模块切换或 Space 切换而改变。

概念结构如下：

```ts
interface MessageContextSnapshot {
  version: 1;
  space: { id: string; name: string };
  conversation: { id: string; kind: "channel" | "dm"; title: string };
  activeModule: string | null;
  stack: ContextDescriptor[];
  focusedItem: ContextDescriptor | null;
  capturedAt: string;
}

interface ContextDescriptor {
  provider: string;
  kind: string;
  id: string;
  title: string;
  uri?: string;
  revision?: string;
  state?: Record<string, unknown>;
}
```

这只是设计契约，不锁定最终 TypeScript 文件名或服务端存储形式。

### 9.2 内容边界

- 自动 Context 以 ID、URI、标题、类型和必要状态为主。
- 不默认把完整文件正文或大型对象内容重复写入消息。
- Agent 需要正文时，通过 MCP 或本地文件工具读取。
- 特殊的未保存内容只有在用户显式附加时才进入消息载荷。

### 9.3 Composer 表达

Composer 上方展示紧凑标签，例如：

```text
当前界面  Tasks / Task #42 / README.md  +2
```

- 标签默认自动生成。
- 用户可展开查看完整 Stack。
- 用户可在发送前逐项移除本次不想携带的条目。
- 移除 Context 不会关闭界面中的资源。
- 发送后的 Snapshot 不可修改。
- 已发送消息旁显示可展开的 `msg-context` 标签。
- 资源失效时，历史名称保留并标注“当前不可用”。

### 9.4 Runtime 适配

前端与服务端保存 Kith-space 自己的结构化 Snapshot。不同 runtime 的适配器再按需要编码为 XML、JSON 或 prompt 文本。不得把 OpenLoaf 的 `<stack>` XML 格式硬编码进 UI 或核心数据模型。

## 10. 路由与持久化边界

### 10.1 建议 URL 语义

- 当前 Space 和频道/DM 继续由路径表达，例如 `/s/:space/channel/:channelId`。
- ChatOnly：无模块查询参数。
- Split：`?module=tasks`。
- ModuleOnly：`?module=tasks&chat=0`。
- 抽屉、Thread、Profile、Context 展开和草稿排除项不进入 URL。

加载时若 URL 明确携带模块或布局参数，以 URL 为准；URL 未指定时才恢复本地保存的工作姿态。遇到未知或当前不可用的模块 ID 时，忽略该参数并安全回到 ChatOnly。

具体参数名可在实现计划中调整，但“实体导航进入 URL、短暂界面状态留在本地状态”的边界应保持。

### 10.2 本地持久化

- 上次使用的 Space。
- 每个 Space 上次使用的频道或 DM。
- Chat 会话列表和实时轨迹的手动显隐与宽度。
- Chat/Module 分隔比例。
- 当前布局姿态和模块选择。

## 11. 空状态与错误处理

- 无 Space：在主区域显示创建或连接 Space 的引导，Dock 暂时不可用。
- 当前 Space 被删除或失联：切到其他可用 Space；没有可用项则显示上述引导。
- 模块加载失败：Module Pane 内显示重试，Chat 不受影响。
- Context 资源失效：Snapshot 保留，标记为当前不可用。
- MCP 操作失败：模块保留原数据，Chat 显示明确失败结果，不伪造成功。
- 窗口过窄：启用单 Pane 响应式规则；Chat 与 Module 通过 Dock 切换，不显示不可用的窄分屏。

## 12. 现有代码迁移方向

### 12.1 复用基础

- `web/src/Layout.tsx` 中成熟的窗口和尺寸行为。
- `web/src/views/Chat.tsx` 的频道、DM、Thread、附件、@mention 和 Composer 行为。
- `web/src/views/ChatSidebar.tsx` 的会话列表能力。
- `web/src/views/LiveTrace.tsx` 的实时轨迹能力。
- `web/src/TaskBoard.tsx`、Members、Computers、Inbox、Settings 的现有业务能力。

### 12.2 被取代的 P4 壳

- `OverviewShell` 不再作为产品入口。
- `IconRail` 不再作为主要导航。
- 当前 `RightDock` 的窄栏定位被可伸缩的 Module Pane 取代。
- 当前 `shellStore` 的 `overview | space` 双壳状态被 Pane 状态机取代。

### 12.3 修改原则

- 不整块重写 `Chat.tsx` 或 `Layout.tsx`。
- 新增壳、状态机、模块注册和 Context Stack 时按职责拆分。
- 通过薄适配复用现有视图。
- 保留现有界面回退入口，待新壳完整验收后再单独清理。

## 13. 桌面线框原型

### 13.1 输出

- 文件：`docs/prototypes/kith-space-single-window-flow.html`
- 单文件 HTML。
- 桌面逻辑尺寸：1280 × 800。
- 黑白灰低保真线框，不提前确定最终视觉皮肤。
- 保留 easy-wireframe 的缩放、拖拽布局、连线、标注和整页截图工具。
- 原样保留模板的既有脚本与样式主体；桌面尺寸适配通过 `.flow` 内的局部覆盖完成，不修改技能安装目录。

### 13.2 八个状态帧

1. Chat 全宽。
2. Space 切换菜单。
3. Chat + Tasks 分屏。
4. 分屏 + 会话抽屉。
5. 分屏 + 实时轨迹抽屉。
6. Tasks 全宽。
7. 任务进入 Chat 上下文。
8. 已发送消息的 `msg-context` 展开。

### 13.3 主流程

```text
Chat 全宽
  → 点击 Tasks
Chat + Tasks 分屏
  → 点击 Chat
Tasks 全宽
  → 点击 Chat
恢复分屏
  → 在 Chat 中讨论
附加 Context 并聚焦 Composer
  → 发送
消息保存不可变 msg-context
```

Space 菜单、会话抽屉和实时轨迹抽屉作为主流程分支状态。

## 14. 验收标准

### 14.1 状态机

- 三个主状态均可到达。
- Dock 转移表中的每条路径均有验证。
- 不会出现 Chat 与 Module 同时隐藏。
- 切换其他模块时保持当前 Chat 可见性。

### 14.2 上下文

- Space 切换不会残留上一个 Space 的 Context。
- 发送前可移除单个 Context Descriptor。
- 发送后的 Snapshot 不可变。
- “在 Chat 中讨论”可从 ModuleOnly 恢复 Split 并附加对象。
- 窄窗口下“在 Chat 中讨论”切到 ChatOnly 并附加对象，同时保留原模块选择，待窗口变宽后可恢复 Split。
- 失效资源不会破坏历史消息渲染。

### 14.3 布局与回归

- 会话和轨迹抽屉只覆盖 Chat Pane。
- Dock 不覆盖 Composer 或模块底部内容。
- 至少验证 1440 × 900、1280 × 800、1024 × 768 和不足双栏宽度的状态。
- 频道、DM、@mention、附件、Thread、Profile 和实时轨迹能力不得退化。
- Inbox、Tasks、Members、Computers、Settings 可通过统一模块入口接入。

## 15. 后续但不阻塞本原型的事项

- 最终视觉 token、动效曲线和高保真细节。
- `scope = all` 的跨 Space 聚合实现。
- Calendar、Canvas 和完整文件模块。
- Electron 原生窗口栏与桌面系统集成。
- Runtime 契约 v2 对 Message Context Snapshot 的正式承载方式。

以上事项均不得在本轮线框原型中提前实现。
