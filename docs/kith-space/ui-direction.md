# Kith-space UI 方向

本文是 Kith-space 当前 UI 信息架构与视觉语言的权威说明。单窗口交互契约见 `docs/superpowers/specs/2026-07-10-kith-space-single-window-workspace-design.md`，个人 AgentOS 宿主与产品边界见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`，Home/Space root 补充设计见 `docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md`；Chat 壳层、侧栏模块入口、会话抽屉和案例展示退役的最新覆盖规格见 `docs/superpowers/specs/2026-07-15-chat-shell-sidebar-module-navigation-design.md`。现有可交互线框 `docs/prototypes/kith-space-single-window-flow.html` 只覆盖早期三态壳，不代表最新 ChatOnly 导航目标。

结论前置：Kith-space 采用**单窗口工作区**。首次启动先初始化唯一 Human，普通冷启动随后进入 `Home` Chat；Home 是真实总控 Space，并比普通 Space 多 Spaces 模块。Chat 是默认主页与基础工作面，功能模块打开后，界面只在 Chat 全宽、Chat + 模块分屏、模块全宽三种形态间切换。ChatOnly 的模块入口位于左侧常驻栏，模块打开后切换为 Module Pane 底部 Dock；案例展示退出目标信息架构。此前的“空间总览壳 + 空间内部壳”、旧 `Layout` 回退、Landing 与 PWA 入口均保持删除。

---

## 1. 视觉语言

借鉴参考产品的布局关系与空间层次，不复制其源码、品牌或具体实现。Kith-space 保留自身已有组件与业务视觉，只统一工作窗口的骨架：

- 窗口沿用原有浅灰画布；中心 Chat 保持独立白色圆角卡片，会话导航取消卡片底板并直接使用画布背景，两者以既有间隙分开。
- 全局 40px 顶部栏已退役；工作区画布四周统一保留 10px，共用面板采用 18px 圆角；Space、当前会话上下文和快速切换入口位于 ChatOnly 左侧会话列表顶部。标题、导航、正文和元信息统一使用系统无衬线字体，不为功能标题单独使用衬线字体。
- 原有中心 Chat 卡片式 UI、圆角、间隙和表面层级不得因壳层导航改造被拉平或移除；常驻会话导航不再使用独立卡片表面。
- 新增纵向模块入口、会话列表和 Split 会话抽屉不使用贯穿式横线或竖线分割；归档频道入口与常驻 agent 状态区同样只用留白、分组标题与行底色组织层级。
- ChatOnly 常驻会话导航不显示“对话”总标题；上方模块图标与下方“频道 / 私信”分组标题共用左侧基线。Split 临时抽屉仍保留自身标题。
- 活跃行使用克制的浅表面色，Human 消息保持 `#eff4fb`，Agent 消息使用中性浅灰，不建立互相竞争的多套强调色。
- Chat 标题栏相对 Chat 卡片左右固定 14px，与 24px 私聊头像在 52px 标题栏中的上下留白一致，不跟随消息宽度变化；频道标题以 18px 线性 Hash 图标替代文本 `#`，与左侧频道栏使用同一图标体系。Agent 私聊标题使用“头像 + 16px/700 昵称 + 12px/400 状态”，不显示 `@` 前缀或 AI 标签，状态文字复用 Agents 页面同一套本地化映射。休眠状态统一使用低对比暖灰色状态点，在线、工作和错误状态继续保留各自语义色。ChatOnly 与 Split 的消息区统一使用 10px 水平内边距，日期分隔、消息流、system 任务事件与 Composer 使用同一条 1040px 居中内容轨道；system 事件内部 Markdown 同样居中。Composer 左边界对齐头像槽、右边界对齐消息内容列的最大右边界，滚动区使用左右对称的稳定槽位消除滚动条造成的偏移和单侧空白，并只允许纵向滚动；宽屏左右留白对称，窄屏不会被隐藏工具栏撑出横向滚动条。
- 不把现有业务视图一比一重画成原型；原型负责布局与交互，现有 Kith-space UI 负责内容呈现。

品牌标志采用“三层本地 Space”概念：暖白、鼠尾草绿与近黑三张错位平面表达 Home 和多个本地 Space，前景平面形成 `K`。用户确认的生成设计稿及其原始像素裁切是唯一母版；应用图标按母版 120/558 的标准圆角比例精确裁出透明四角，浏览器使用同源 RGBA PNG，Windows/Electron 使用同源多尺寸 ICO，不重新描摹 SVG。完整资产与回归约束见 `docs/brand.md`。

这套“中心 Chat 卡片 + 画布会话导航 + 留白分组 + 克制浮层”的语言用于三态切换，避免不同状态像三套产品。

---

## 2. 顶层骨架

应用只有一个 `WorkspaceFrame`：

```text
ChatOnly 左侧列表首行：当前 Space / 当前会话 / Space 快速切换；全局搜索由其下方入口或 `Ctrl/Command + K` 唤出
┌────────────────────────────────────────────────────────────┐
│ Chat Pane       │ 聚合面板（可选） │ 10px 可拖拽区 │ Module Pane │
│                 │ 轨迹/话题/文件   │                 │ Dock        │
└────────────────────────────────────────────────────────────┘
```

- 未初始化时进入本地 Human 资料页；普通冷启动进入自动创建的 Home Chat，显式 Space 深链接直达目标，托盘恢复保留现有窗口现场。
- Space 名称保留快速切换入口；H4 已把默认创建、已有文件夹接入和完整目录管理移入 Home 的 Spaces 模块。ChatOnly 左侧列表首行只保留快速切换、失联重连和“管理空间”跳转。
- Search 位于 ChatOnly 左侧列表的 Space/会话上下文下方，通过按钮和 `Cmd/Ctrl + K` 进入，不占 Dock 槽位。
- 同时最多显示一个 Chat Pane、一个当前会话聚合面板和一个 Module Pane；聚合面板只依附可见 Chat，不是第二个 Module。
- Split 默认让 Chat 占可用工作区的 25%、Module 占其余空间；Chat 下限为 `max(360px, 25%)`。ChatOnly 的主 Chat 卡片沿用同一 360px 绝对下限。Tasks / Search 的模块下限为 560px，其余现有模块为 640px；模块不再使用固定 960px 上限。
- 分区间完整 10px 间隙都是拖拽热区，悬停或拖动时才显示短握柄，不显示贯穿全高的分隔线。
- 宽度不足以容纳双栏时不强行压缩，临时退化为单 Pane；窗口变宽后恢复此前的双栏意图。
- 三栏宽度优先级为当前主要工作面、Module、聚合面板、固定会话列表；不能同时满足最小宽度时先临时把聚合面板收至 `0` 并保留打开意图，ModuleOnly 不单独显示聚合面板。从 ChatOnly 打开任一模块时主动关闭聚合面板且返回 ChatOnly 后不自动恢复；进入 Split 后仍可由标题栏按钮手动重新展开。
- 拖拽偏好保存为工作区宽度比例而非像素。Split 内切换模块保留该比例；从 ChatOnly 打开模块、关闭模块后重新打开，或从 ModuleOnly 恢复 Chat 时，均回到 Chat 25% 的默认下限。

当前 Space 的频道或 Human-Agent DM 由规范会话 pathname 表达；打开模块时在同一 URL 上增加 `?module=<id>`，ModuleOnly 再增加 `chat=0`。Tasks 使用 `taskScope`，Agents 使用 `agent` 与 `agentTab`，Settings 使用 `settings` 表达自己的模块资源；不属于当前模块的资源参数会被清除。切换频道或 DM 时保留 active module、Chat 显隐和该模块的资源 query，并替换旧会话的 `msg`/`thread` 等临时焦点。因此一个 URL 可以同时表达“频道 A + Tasks + Split”，在紧凑会话抽屉切频道不会关闭模块，也不会把旧消息焦点带到新会话。

浏览器刷新、前进和后退都以 URL 为准恢复三态；会话列表、聚合面板、聚合 Tab 与文件筛选等短暂界面状态不进入 URL。`/tasks`、`/agent`、`/settings` 等旧模块实体路径不再作为兼容深链，未知 Space 子路径会规范化到 `/s/:slug/channel` 并保留有效 query/hash。`?legacy=1` 与旧 `Layout` 已删除。

---

## 3. 三态布局与模块导航

### 3.1 状态机

```text
ChatOnly   = Chat 可见，Module 不存在
Split      = Chat 可见，Module 可见
ModuleOnly = Chat 隐藏，Module 可见
```

系统不允许 Chat 与 Module 同时隐藏。

| 当前状态 | 模块入口位置 | 点击 Chat | 点击当前模块 | 点击其他模块 |
|---|---|---|---|---|
| ChatOnly | 左侧纵向模块列表 | 无 Chat 入口 | 不适用 | 点击任一模块后打开 Split；空间不足时打开 ModuleOnly |
| Split | Module Pane 底部 Dock | 进入 ModuleOnly | 关闭模块，回到 ChatOnly | 保持 Split 并替换模块 |
| ModuleOnly | Module Pane 底部 Dock | 恢复 Split | 关闭模块，回到 ChatOnly | 保持 ModuleOnly 并替换模块 |

这意味着 Chat 控制只在模块已打开时出现并负责 Chat 显隐；ChatOnly 已经明确处于 Chat，不渲染重复的 Chat 项。

### 3.2 ChatOnly 侧栏模块导航

ChatOnly 的左侧常驻栏按 Space 类型显示纵向“图标 + 文字”模块入口：

- Home：`Spaces | Inbox | Tasks | Agents | Settings`。
- 普通 Space：`Inbox | Tasks | Agents | Settings`。

- Chat 不进入列表；Search 位于 Space/会话上下文下方，并继续支持 `Ctrl/Command + K`。
- 入口复用同一模块注册表，行高 36–40px、图标 18px、标签 14px，使用轻量 hover/active 表面，不绘制行边框或阴影。
- 点击入口写入现有 `module` query；固定左侧栏随后隐藏，工作区进入 Split 或响应式 ModuleOnly。
- ChatOnly 不挂载底部 Dock，也不再为 Dock 预留 Composer 下方空间。

### 3.3 模块打开态 Dock

- Split 和 ModuleOnly 的 Dock 位于 Module Pane 底部。
- Chat 按钮只显示图标，用激活底色表达 Chat 是否可见，不因激活而展开。
- 业务模块默认只显示图标；当前模块横向展开并显示名称。
- 点击当前模块关闭 Module Pane 并回到 ChatOnly；此时 Dock 卸载，左侧常驻栏恢复。
- Dock 白底、1px `#e0e0e0` 边框、12px 圆角和轻工具层阴影，距面板底部 14px；其所在面板预留空间，不覆盖模块内容。
- Dock 项高 39px；未激活宽 41px，激活模块宽 122px；图标 18px、标签 13px。
- 未激活项用 `#fafafa`，激活项用 `#f5f5f5`，不使用高饱和强调色。

Spaces 只在 Home 出现；Agents 只显示当前 Space 的 agent 队伍；唯一 Human 的资料位于全局 Settings。Calendar、Canvas 等真实能力成熟后插入同一模块注册表；当前不展示无功能的空入口。

创建 Agent 时，Runtime 选择器读取 Local Runtime Worker 的实际 availability，而不是使用前端硬编码的可用状态。完整 runtime 目录始终展示：已安装项排序在前并标注“已安装”，未安装项排序在后、标注“未安装”且不可选择；默认选中第一个已安装项。OpenCode 模型选择器只展示 `opencode models` 返回并去重后的真实 `provider/model`；探测失败时显示错误、提供重试并禁止创建，不回退到虚假的 `Default`。

创建成功后，agent 只向唯一 Human 的 `dm:@you` 发送一次 2-3 句自我介绍，内容包含身份、职责/擅长能力和如何派活；不扫描频道历史、不汇报“没有消息”，也不向公共频道广播。只有创建/重试 introduction turn 的介绍私信成功进入对应 Human-Agent DM 后才视为完成；若真实消息先到，agent 先按 wake 语义回复原目标，该普通回复不算自我介绍。后续手动启动、重启和恢复只检查真实待处理消息，空收件箱保持静默；由频道、DM、任务或 backlog 触发的唤醒必须在每个原会话目标处理和回复。普通 reset 只清 session/runtime state 并保留入职状态；完整 reset 额外清当前 Agent Memory 和入职状态后重新介绍。两种 reset 都保留共享 Space 文件树，UI 不提供把“删除项目文件”伪装成 Agent 重置的入口。

---

## 4. Chat 工作面

### 4.1 Chat 全宽

ChatOnly 由当前会话工作面和可独立收起的辅助面板组成：

```text
Chat 导航侧栏 | 当前会话与 Composer | 聚合面板（轨迹 / 话题 / 文件）
```

- Chat 导航侧栏从上到下包含 Space/当前会话上下文、全局搜索入口、纵向模块入口、已保存、频道、私信和底部 agent 运行状态。全局搜索入口与 `Ctrl/Command + K` 打开同一个白色圆角命令面板：空查询按“推荐 / 频道 / 私信 / Agent”分组，输入后同时匹配频道、私信、Agent 以及当前 Space 可读的频道消息、话题消息和私信消息；点击消息直接定位原消息或打开所属话题。普通命令保持 34px 紧凑单行，消息命中改用独立双行结果：第一行展示可读的频道名、私信对象或“父消息摘要 + 回复数”，右侧显示来源频道和相对时间；第二行展示发送者与命中上下文，并以蓝色语义 `mark` 高亮查询词。DM 内部复合 ID 和 thread 内部名称不得进入 UI；单 Human 私信使用对端 Agent 头像与展示名，Agent-Agent 私信使用参与者展示名组合。面板使用灰色小标题，不显示快捷键胶囊。全局顶栏不再挂载，消息搜索也不导向单独模块。频道保留未读、置顶、新建和切换行为，并以 14px 线性 Hash 图标替代文本 `#`；不提供 Human-Human DM。归档频道不混入活跃频道，而是进入仅在有数据时显示、默认收起并按归档时间倒序排列的“已归档”子分组。案例展示不再属于目标信息架构。频道行与私信行的相邻项统一保留 4px 轻量间距；画布式会话导航使用 `#ececeb` hover 和纯白选中底色增强状态辨识，不增加分割线、边框或卡片阴影。会话抽屉、Agents 模块侧栏及 Agent 选择器中的相邻 Agent 行同样保持一致的轻量间距。
- 中间复用现有 `Chat`、Composer、Thread、附件和 @mention 能力；用户界面统一称“话题”，内部数据、API 与 query 继续使用 `thread`。Agent 私聊标题区保留直达当前 Agent 详情页的入口；话题打开时默认与当前会话各占一半宽度，并可通过中间分割线继续拖拽调整。话题标题栏以普通铃铛表示“已关注”、划线铃铛表示“未关注”，关注切换不关闭面板，关闭仍由独立的 × 按钮负责。
- 删除 Agent 时，所有包含它的私聊、私聊下的话题、消息、附件记录及本地附件对象一并永久删除，私信列表、Inbox 与命令面板不再显示该 Agent。公共频道及其话题中的历史消息继续保留，以消息发送时保存的名称展示，并在主消息与话题回复预览中实时标记“已删除”；已删除身份不可再打开 Agent 卡片或被命令面板检索。
- 删除旧“会话 / Chat / 轨迹”顶栏。会话列表纯图标开关迁入当前会话标题最左侧；标题右侧依次提供当前会话 Tasks、聚合面板和频道设置等纯图标入口。频道成员不再提供独立标题栏入口或抽屉，统一从频道设置的“成员”页管理。Tasks 始终导航到 `module=tasks&taskScope=<当前会话ID>`，点击已打开的同一 Tasks 不解释为关闭。
- 聚合面板固定承载“轨迹 / 话题 / 文件”三个等宽滑动 Tab；`#f5f5f5` 轨道内的白色选中底板使用多层低透明阴影，并只做 `transform` 横移，内容不淡入淡出。该滑块与 Agent 卡片/Agent 默认响应模式共用 `components/SlidingTabs.tsx`，由同一组件分别提供 tab 与 radio 语义、规则/紧凑两档比例和 reduced-motion 降级。三个内容区通过 `hidden` 切换而不卸载，因此文件分类、关键词和搜索展开状态跨 Tab 保留，只在会话切换时重置。话题列表来自独立 thread summaries 查询，新建空话题与后续回复都会实时刷新，点击后仍在原 Chat 话题位置展开正文；文件页支持“全部 / 图片 / 视频 / 文件”和文件名/来源消息搜索，并与 Composer、消息附件复用同一套文件类型判定及无描边类型图标。文件筛选的未选中项和文件搜索框统一使用 `#f5f5f5` 中性表面；文件页与 Agents 列表复用 `components/SearchField.tsx` 的胶囊搜索框，只显示产品自己的清除按钮，输入框焦点使用浅色内描边而不是黑框。
- 频道设置是聚合面板内的临时管理场景，不是第四个 Tab。进入后以同一面板承载设置首页及“常规 / 成员 / 通知”三个钻取页，并保持原聚合 Tab、文件筛选和搜索状态挂载；返回内容场景时恢复原状态。常规页显式保存名称、描述和公开/私密可见性；成员页以实际 Human 名称加“你”标识固定展示唯一 Human，agent 通过带搜索的单选弹窗添加，移除前要求二次确认；通知页即时持久化“所有消息 / 仅提及 / 不通知”。未保存常规修改在返回、关闭、切换频道、隐藏 Chat、刷新或浏览器历史后退前要求确认放弃；取消后保留当前 URL 和表单草稿。
- **消息流密度重构（代码、自动化验证与用户手动视觉验收均已完成）**：主会话、话题、action card 与加载 Skeleton 复用同一消息骨架；外层消息行不绘制卡片，改为“32px 头像 + 紧凑发送者行 + 随内容收缩的气泡”，普通消息链尾间距为 20px。同一天相邻且发送者相同的 Human/Agent 普通消息形成连续消息组：后续消息隐藏重复头像和发送者行，组内间距收紧为 6px，hover/focus 时在头像槽显示时分；日期分隔、发送者变化、系统消息和 action card 会打断分组。Human 使用 `#eff4fb` 浅蓝色表面、Agent 使用中性浅灰表面，正文为 `14.5px / 1.55`。Human 消息昵称使用 `14.5px / 700 / 20px` 且保持纯文本；点击 Human 头像打开只展示“头像 + 昵称（我）”的轻量身份卡片。Agent 昵称默认保持 `500` 字重，hover 或键盘聚焦时在左侧显现 `@`、名称向右让出 14px 间距并变为深色，但不改变字重；点击后把规范 Agent handle 插入当前主会话或话题 Composer 并聚焦输入框。时间使用 `11px / 400 / 16px`，与昵称按基线对齐、间距 6px，消息头不继承全局额外字距。侧栏 Agent 名称使用 600；Agent 在线/工作/休眠状态只由头像右下角状态点表达，不在发送者行重复显示文字。消息时间默认隐藏，hover 整条消息或消息内控件获得焦点时显示；当天消息只显示时分，历史消息保留完整日期和时分，无 hover 设备常驻显示。消息正文不再额外减去 `64px`，Agent 职责不在每条消息重复。存在回复的父消息在气泡底部展示话题摘要：参与者头像、总回复数、最新活跃时间、最近三条 Human/Agent 单行回复和“在话题中回复”入口随气泡宽度收缩并统一打开既有话题；任务流转等 system 事件不进入预览行，正文与摘要之间不绘制分隔线。52px Chat 标题栏、14px 消息区上留白和 88px Composer 预留已落地。主消息悬浮工具外显“加表情、话题、复制、更多”，收藏保留在更多菜单；工具栏仅由气泡 hover/focus 触发，右侧空间足够时位于气泡右侧，不足时切换到气泡上方；隐藏状态初始置于气泡上方，不再撑宽消息流，首次 reaction 不再在气泡下方单独占位。归档频道不显示收藏、reaction、转任务、action 执行或新建话题等写入口，但复制和打开已有话题仍可用；response mode、任务状态、附件、深链和临时回复预览契约不变。最新壳层实施把 Chat 标题栏固定在卡片左右 14px，与标题内容上下留白一致；ChatOnly 与 Split 统一使用 10px 消息 gutter 和 360px Chat 绝对下限，同时把日期分隔、消息流、Composer、提及菜单与校验提示统一到 1040px 居中内容轨道，并删除仍复用该表现层的 Showcase。完整消息尺寸与验收阈值见 `../superpowers/specs/2026-07-15-chat-message-ui-density-design.md`，壳层覆盖约定见 `../superpowers/specs/2026-07-15-chat-shell-sidebar-module-navigation-design.md`。
- **Agent 响应模式（已实现）**：Agent Profile 的基本信息后、Skills 前保留独立“响应模式”卡片，用三段式控件设置当前 Space 的主动/被动/静音默认值；私聊和明确指派的任务不受该默认值限制。消息昵称后的模式徽标与 hover 菜单已移除；点击 Agent 消息头像打开紧凑 Agent 卡片，显示头像、名称、运行状态、模型与“发消息”动作，“发消息”按钮固定使用 `#f7f7f7` 底色与 `#f0f0f0` hover。顶层频道及其话题中的当前成员 Agent 卡片额外显示“本频道响应模式”三段式控件，选择只写当前频道覆盖，并以弱提示显示 Agent 默认值；显式覆盖时可“恢复默认”。响应模式与聚合面板复用同一滑块分段组件，紧凑卡片使用 38px 规格和 240ms 平滑横移动画。这里不允许修改 Agent 默认值，默认值仍只在 Agent 页面管理。话题继承父频道；DM、已移除 Agent 不显示频道模式；归档频道只读。头像卡片仅由点击/键盘激活，点击外部、滚动、调整窗口或 `Escape` 关闭。完整交互见 `../superpowers/specs/2026-07-14-agent-channel-response-mode-design.md`。
- **Composer 输入与动作（已实现）**：空输入和未接近右侧控制安全区的单行短文本保持 `48px` 高的胶囊输入框；只有实测文本宽度用尽当前剩余安全区、出现显式换行或存在待发送附件时才展开为多行面板，删除内容后可重新收紧。左下角 `32×32` 圆形“+”与右下角 `32×32` 圆形上箭头发送按钮对齐；“+”图标为 `18px`、较粗描边，在 hover、键盘聚焦和菜单打开时仍使用同尺寸圆形底，焦点反馈不额外外扩黑色轮廓。菜单合并“添加照片和文件”并包含“指派任务”；启用后，任务胶囊出现在“+”右侧并与正文共享单行空间，不会自行增高输入框，但会按实际占位缩短正文可用安全宽度。任务文字与正文始终复用同一字号变量（桌面 `14px`，小屏防输入缩放时同步为 `16px`）；hover/聚焦时使用图标库的 X 图标和更小的 `14px` 圆底替换任务图标，外层占位不变，点击即可取消。图片缩略图与文件卡片显示在输入框内部正文上方，带独立移除按钮；不提供参考图中的速度和麦克风动作。
  “+”菜单以整个 Composer 外框为锚点，左边界和宽度与输入框对齐；只有输入框本身超过视口安全范围时，才按左右 `8px` 视口边距收缩。菜单使用上下 `4px`、左右 `5px` 内边距和 `16px` 外圆角；每个菜单项为 `30px` 高、`10px` 圆角和 `4px 10px` 内边距。菜单只靠浅色边框和圆角分层，不显示阴影。每次打开时首个可用项默认显示高亮；鼠标或键盘进入其他项后，高亮停留在最后经过的项，离开菜单项不回退。任务开关状态不使用常驻高亮或勾号表达，而是在“指派任务”后以淡色文案显示“开启指派任务 / 关闭指派任务”；实际 hover/键盘高亮仍与其他菜单项一致。`@` 候选菜单复用同一外框宽度、`16px` 外圆角、无阴影表面和 `30px`/`10px` 候选行；名称、`@handle`、范围说明与类型在一行内截断，首项及鼠标/键盘最后经过项沿用相同浅色高亮。
  展开态只增加上半部分正文/附件空间；下方控制区继续沿用紧凑态的 `48px` 视觉高度、左右 `10px` 控制内距、底部 `8px` 控制内距和 `24px` 底角，因此“+”和发送按钮在高低状态间不横向或纵向跳动。
  展开态附件与正文统一使用距输入框上、左边界各 `10px` 的内容基线；Composer 与主消息/话题消息复用 `components/AttachmentCard.tsx`，附件列表按可用宽度自动换行并以 `max-width: 100%` 防止溢出。附件卡片使用 `13px` 圆角，hover/focus-within 以短过渡切换至 `#f7f7f7`，移除按钮为居中的 `16px` 圆形。非图片附件按 Markdown、PDF、文档、表格、演示、压缩包、代码/数据、音视频和文本显示缩写式文件图标及克制的无描边纯色底，不绘制折页线；聚合面板文件页复用同一类型图标。消息只有一个图片附件时使用保持原始比例、最大 `320px` 的大预览；多图或图片与文件混排时继续使用紧凑卡片。Composer 和消息中的图片点击后进入共享查看器：100% 状态完整适配视口安全区，放大后可在整个视口舞台拖动，不受内层卡片裁切；支持按钮、滚轮及 `+`/`-`/`0` 快捷键缩放/复位，`Escape`、关闭按钮或点击图片外区域关闭。消息图片还按当前私聊/频道已加载消息的顺序组成独立序列，话题按父消息加当前话题回复组成序列；查看器提供上一张/下一张按钮、左右方向键和当前位置，序列不会跨会话。主 Chat 使用 `ResizeObserver` 把 Composer 实际高度加 `12px` 消息间距写入滚动区底部预留；在用户原本位于底部时同步维持贴底，避免附件或多行正文展开后遮挡最后一条消息。
- **频道全体提及（已实现）**：Human 在可写频道及其话题的 Composer 输入 `@` 时，候选首项可出现带群组图标的本地化标签“所有人 / Everyone”和规范 token `@all`，副文案说明当前界面语言下的频道范围；消息正文始终渲染为一个不可导航的 `@all` mention token，不展开成员名单。DM 与归档频道不提供候选；启用“指派任务”后隐藏候选，手工输入 token 发送时也保留草稿并提示改为单一 `@Agent` 或未指派任务。Agent 发出的同名文本只按普通文字显示，不触发群体唤醒。Showcase 已在壳层切片中完整退役。
- **正文身份提及**：消息正文中的 Agent/Human `@昵称` 使用无底块的蓝色链接样式，hover 或键盘聚焦时显示细下划线；点击后以该 token 为锚点打开与消息头像一致的 Agent/Human 身份卡片，不再跳转 Agent 模块或 Human 设置。频道、话题和任务引用继续保持各自既有样式与导航行为，`@all` 仍不可点击。
- **回复预览与话题边界**：required 唤醒可以在原会话显示 Agent 临时回复预览；若 Agent 直接在该会话发送正式消息，预览平滑收敛为持久化消息；若 Agent 按要求改在触发消息的话题中回复，则在首条正式回复持久化后移除对应 Agent 的父会话预览，单纯创建空话题不提前清理。工具调用后的“已回复”“没有待处理消息”等 runtime 尾部文本只留在轨迹，不显示为刷新即消失的主会话消息。
- 实时轨迹只展示当前 base conversation 的本次前端会话缓冲；话题轨迹归一到父会话，无作用域或跨会话 ambiguous 事件不进入任何会话聚合面板。
- 会话列表与聚合面板都沿物理边界把宽度变为 `0`，内容随边界裁切，不使用淡入淡出或贯穿全高的收起长条；两者使用 Chat 侧栏曲线，Module 保持自己的切换曲线。
- ChatOnly 与空间足够的 Split 中，频道设置占用聚合面板位置；Split 下仍位于 Chat 与 Module 之间。空间不足时复用同一个设置组件，在 Chat 内从右侧以裁切宽度动画打开临时抽屉，不覆盖 Module，也不复制第二套表单。
- 归档频道保留历史消息、话题、文件、成员和设置阅读入口，但以顶部只读提示替代 Composer，并关闭回复、附件、reaction、任务状态/创建、action card 和成员修改等写入口。顶部提示直接提供“恢复频道”，设置首页同时提供恢复与永久删除；恢复后留在当前频道并回到活跃列表，永久删除必须准确输入频道名称。每个 Space 的 `# all` 是必需频道：名称和可见性锁定，归档入口隐藏；删除动作保留为置灰入口并明确说明系统必需频道不能删除，服务端仍执行最终保护。

### 4.2 Chat 紧凑

打开模块进入 Split 时，会话列表不再占固定栏位，Chat 收成一张紧凑面板；本次状态迁移会先关闭聚合面板，用户在宽度允许时手动重新展开后，聚合面板作为 Chat 与 Module 的同级面板留在两者之间：

```text
[会话抽屉] 当前会话 | 聚合面板 | Module
消息流
Composer
```

- 会话抽屉从 Chat 左侧覆盖打开，只覆盖 Chat Pane，不挤压或遮挡聚合面板与 Module。
- 会话抽屉只组合“已保存、频道、私信”三个产品导航分组；置顶与已归档仍是频道内部结构。它不显示纵向模块入口、Chat、案例展示或固定侧栏底部的 agent 运行状态。
- 抽屉切换会话后继续保留 active module、Chat 显隐和合法 module resource query；Escape、遮罩关闭与焦点返回沿用现有行为。
- 话题和 agent profile 属于 Chat 内部临时层，不占用 Module Pane；模块打开且话题存在时，紧凑 Chat 只显示话题，不再并排保留父会话消息流；聚合面板仍由自己的标题图标控制。
- Chat 被隐藏时，Chat 的临时层随之卸载；恢复后回到当前会话。

---

## 5. 模块工作面与作用域

- 当前模块包括 Inbox、Tasks、Agents、Settings；Home 另有 Spaces；Search 由 ChatOnly 左侧入口打开。Computers/Machines 不再是产品模块。
- 一次只显示一个 Module Pane，切换 Dock 项直接替换模块。
- Inbox、Tasks、Agents、Settings 只读取当前 Space 数据；Spaces 只读取 app.db registry 和真实摘要。切换 Space 时 Chat 与普通模块数据源一起切换。
- Web Store 与路由状态只使用 `SpaceInfo/spaceId/spaces` 和 `/s/:slug`；请求只发送 `x-space-id`，不得在前端保留旧 Server 双命名。
- Tasks 保留旧布局的范围侧栏，可在当前 Space 的全部任务与指定频道任务之间切换；切换范围不得改变当前 Split / ModuleOnly 姿态。
- 模块加载失败或空状态只在自身面板处理，Chat 保持可用。
- 模块不得直接控制 Chat 内部组件；Chat 也不得依赖具体模块的数据结构。
- 普通模块契约为未来的 `scope = current | all` 预留语义，但当前不显示尚不可用的跨 Space 开关。

### 5.1 Home Spaces 模块

- 规范 module id 为 `spaces`，URL 是 Home 当前会话 pathname 上的 `?module=spaces`。
- 顶部提供复用 `SearchField` 的搜索、刷新和“新建空间”；主体使用与现有面板语言一致的 Space 卡片网格。搜索框在默认和输入聚焦状态均保持 `#f5f5f5` 中性表面，仅保留克制的内描边反馈，不显示浏览器原生黑框或清除按钮。批量管理入口与刷新统一为无边框图标按钮，进入管理态后切换为取消图标；批量模式只允许选择普通 Space，卡片使用单层边框复选框并禁用打开和单卡操作。确认后按顺序从 registry 移除所选项，保留本机目录和数据，失败项继续保留为选中状态以便重试。
- 卡片至少显示名称、宿主路径和最近打开信息；Home 自身不在列表中重复展示。
- 点击卡片在当前窗口进入目标 Space 的默认 Chat，不打开新窗口。
- “新建空间”菜单提供“新建空白空间”和“使用现有文件夹”；两种表单都使用居中紧凑弹窗。Desktop 使用原生目录选择器，授权浏览器在弹窗内使用受限的主机目录浏览器，最终路径由 Core 校验。
- 普通 Space 的 `module=spaces` 是无效状态并被规范化；从顶部全局空间入口打开时导航到 Home Spaces。

H4 已复用 H3 领域/API 能力交付本节：Home Spaces 提供卡片网格、搜索、刷新、两种创建路径、失联 Space 的“重新定位文件夹”和同窗导航；Desktop 调用原生目录选择器，授权浏览器通过 Core 浏览主机文件夹。每张普通 Space 卡片右上角提供“打开 / 在文件管理器中打开 / 复制项目地址 / 重命名 / 收藏 / 移除”菜单；收藏是当前客户端的轻量排序偏好，单项和批量移除都只注销 app.db registry 并明确保留本机目录，文件管理器动作只在受信 Desktop preload 桥可用时启用。卡片与顶部列表区分 `ready | missing | error`，不可用 Space 不会被当作可打开项目；路径或数据库错误留在弹窗中供用户修正。失联深链会进入可用 Space，全部 Space 失联则展示同一视觉语言的恢复页并保持 relocate 可达。页面不承载路径或数据库校验，也没有 H5 伪聚合。

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

当前生产壳已完成 A5 入口收口与 P-A7 H4：`App` 只渲染 `WorkspaceFrame`；Agents、Human Settings、Desktop Settings 与 Home-only Spaces 已落地，登录/注册/邀请、Computers、Landing、Features、PWA、SSR/prerender、旧 `Layout` 与 `?legacy=1` 均已退出活跃代码。Agent 详情的“记忆”标签与概览路径通过兼容的 workspace-files API 展示并读取当前 Space 的 `<space>/.kith/agents/<agentId>`；`agentTab=workspace` 只作为既有深链兼容值保留，不再表示共享 Space 工作区。普通冷启动进入 stable Home，显式 ready 深链接仍优先；普通 Space 不显示也不能激活 Spaces。

决策 28 的 Chat 壳层切片**已完成代码、自动化验证与用户手动视觉验收**：`SidebarModuleNavigation` 提供 ChatOnly 纵向模块入口，`ConversationListContent` 由固定侧栏和 Split 窄抽屉共享；ChatOnly 不挂载 Dock，模块打开态仍使用含 Chat 控制的 `WorkspaceDock`。案例展示的入口、产品路由、视图、数据、资产与专属表现分支已删除，旧 URL 仅作 SPA 兼容并规范化到当前 Space 默认频道。状态以 `docs/progress.md` 为准。

单窗口壳按职责拆在 `web/src/shell/`：

- `WorkspaceFrame.tsx`：路由同步、Chat / 聚合面板 / Module 响应式编排、聚合内容/频道设置短暂场景与拖拽边界。
- `useChannelSettingsScene.ts`：频道设置场景、脏状态退出确认、焦点恢复以及刷新/历史后退保护。
- `workspaceLayout.ts`：无 React 依赖的三态状态机。
- `paneConstraints.ts`：集中计算 Chat 响应式下限、聚合面板目标宽度、三栏可见阈值、各模块下限、单 Pane 阈值和比例到像素的夹取结果。
- `shellStore.ts`：`useSyncExternalStore` 保存版本化模块宽度比例，并按 Space 持久化最近 Chat 位置；模块与 Chat 显隐由 URL 表达，避免双重状态源。
- `workspaceRoute.ts`：解析规范会话 pathname，把 `module/chat` 与模块拥有的 `taskScope/agent/agentTab/settings` query 映射回三态，并在会话导航时只保留持久布局/模块资源；Human profile、机器旧路由和旧模块实体路径均不再映射模块。
- `ChatWorkspace.tsx`：当前负责固定/抽屉会话列表和 Chat 工作面；新切片继续由它编排侧栏/抽屉挂载，但共享会话内容不再通过完整 `ChatSidebar` 在两处复用。
- `conversation-aggregate/`：轨迹、话题、文件三个会话级子视图；`components/SlidingTabs.tsx` 统一承载 tab/radio 两类滑动分段控件，聚合 Tab 与响应模式不再维护两套选中底板。
- `channel-settings/`：设置场景壳、常规/成员/通知钻取页与永久删除确认；宽窄布局复用同一组件。`ArchivedChannelGroup.tsx` 单独负责默认收起的归档频道入口。
- `ModuleWorkspace.tsx`：现有业务视图薄适配。
- `WorkspaceDock.tsx` / `WorkspaceContextRow.tsx`：模块打开态 Dock 与 ChatOnly 左侧列表中的 Space/会话上下文；`WorkspaceDock` 不在 ChatOnly 挂载，全局 `WorkspaceTopBar` 已退役。
- `workspaceModules.tsx`：模块注册、路由和图标元数据。

复用 `Chat.tsx`、`LiveTrace.tsx`、`TaskBoard.tsx`、Inbox、Settings 与现有 agent 列表能力；Chat 不再内嵌 Tasks/Files Tab，文件筛选与话题索引也不继续堆入大文件。新切片把 `ChatSidebar.tsx` 收敛为常驻侧栏组合，并新增独立纵向模块导航与共享会话分组；这不是恢复旧的全局 `IconRail`。产品模块已从 Members 收敛为 Agents（内部文件名 `Members.tsx` 暂留）；Computers 与旧 `Layout` 已删除。旧 `OverviewShell`、`SpaceShell`、`IconRail`、`RightDock` 和 `ChatSlot` 继续保持删除。

P-A8 的前端边界保持独立：`agent-response-mode/` feature 承担 Agent 默认卡片、模式模型和每频道一次装载/实时失效 hook；`chat-message/AgentMessageCard.tsx` 承担 Agent 身份内容及本频道覆盖控件，`HumanMessageCard.tsx` 只承担 Human 的最小身份内容，两者复用 `MessageIdentityCardFrame.tsx` 的锚定、焦点、外部点击和视口关闭机制。`Chat.tsx` 只保留卡片状态、频道模式数据、锚点、DM 导航与回调编排，卡片不读取 Router，也不直接发 API。消息内点击提及由 `chat-message/AgentMentionName.tsx` 负责表现和可访问交互，Composer 通过窄化的 `ComposerHandle.mentionAgent()` 接收插入请求，不由消息行查询或修改 DOM；插入文本与光标位置计算收口在 `composerMention.ts`。Composer 的多 Agent 任务校验收口在 `composerTaskMentions.ts`，频道全体 token 识别与候选匹配收口在 `composerChannelAllMention.ts`；`composer/ComposerActions.tsx`、`ComposerAttachments.tsx` 和 `useComposerExpansion.ts` 分别承担动作菜单、附件预览和宽度驱动的紧凑/展开判断，没有把交互状态继续堆进视图组件。

## 8. 初始化与 Settings 边界

- 首次启动页只收集 Human 名称、可选邮箱和描述，文案不得使用“注册”“账户”或“加入团队”。默认 Home 在用户可见的 `~/Kith-space/Home` 由应用创建，首次初始化不要求用户选择；普通 Space 之后从 Spaces 模块选择路径。
- 首次初始化只在检测到完整 Electron preload bridge 时运行，并先于 `StoreProvider`/Space bootstrap。若上次写入 Human 后中断，页面用 status 返回的 partial Human 预填恢复；重复提交保持幂等。初始化完成后挂载正常产品树并自动进入 `Home`；Human 资料在全局 Settings 以 `settings=human` 表达，并通过 `GET/PATCH /api/human/profile` 修改，不使用账户页或 `/api/auth/me`。
- 普通本机/LAN 浏览器从不探测 setup API，也不显示首次启动页；未授权时只显示 Access Token Gate，已授权后进入共享工作区。
- Desktop Settings 已包含 Web 模式、端口、访问 Token、撤销浏览器会话、托盘关闭行为和系统自启动；系统自启动在开发态明确显示 unsupported，在 Windows packaged Desktop 中启用。
- 普通浏览器可在 Human Settings 撤销当前浏览器授权；该动作调用 `DELETE /api/browser-auth/session` 并返回 Access Token Gate，不是 Human 账户 logout。
- Desktop 设置区只在检测到 `window.kithDesktop` 窄 preload bridge 时显示；普通浏览器直接进入该路由会回落到 Human 设置，并且服务端对管理 API 返回 404。隐藏入口不是唯一安全边界。
- LAN 模式首次开启会先展示确认面板，明确说明 HTTP 未加密、只限受信任私网、禁止端口转发/公网暴露；用户确认后才改变监听。自动生成/轮换的访问 Token 保持一次性显示，直到用户主动确认已保存。

一句话：**Chat 是基础工作面；ChatOnly 用左侧纵向入口打开模块，模块打开后由 Dock 统一切换模块和控制 Chat 显隐。**

## 9. P-A10 Agent Harness v2 的分阶段 UI 增量

P-A10 不改变 WorkspaceFrame、ChatOnly/Split/ModuleOnly、中心 Chat 卡片或 Module Dock，只扩展现有 Chat/Agents 信息架构：

- Human 在顶层频道明确 `@Agent` 后，root 消息下创建/复用话题，required reply placeholder 和持久 Agent 回复都归入该话题；父频道不显示引用式伪回复。`@all` 继续是频道广播，不自动建立高 fan-out 话题。
- 消息“展开步骤”从单一轨迹扩展为“上下文 / 步骤 / 用量 / 结果”：区分 turn 前自动注入、Agent 后续主动查询、因隐私只给 projection/ref 和因预算/故障省略的来源；步骤按 attempt 展示安全 thinking summary 与工具事件；结果显示逐 delivery obligation、operation/output、replied/ceded/failed/cancelled 和重试/lease。
- optional turn 的 `cede` 不产生 Chat 气泡；required turn 的 text delta 只更新 ephemeral placeholder，只有 Message Module 成功提交后才收敛成持久消息。失败/cancelled 必须结束 placeholder。
- Agents 详情“记忆”页形成“结构化记忆 / 文件记忆”两个一级视图。结构化记忆按 Active/Proposals/Archived、服务端搜索、kind/scope/source/tag/source-revoked/suppressed 过滤，并展示 canonical ID、revision、typed evidence、disclosure projection、correction relation、continuity bundle状态；常用动作是归档，破坏性动作分为删除item和forget+suppress。文件记忆继续读取当前 `agentMemoryDir`。
- Agents 开发诊断区可查看 per-surface session generation 的 cold/idle/running/evicted/resume_failed、runtime/config fingerprint、来源 delivery frontier、logical turn/attempt lease、snapshot、recall/advisor/compaction 状态；普通用户默认不展示内部 JSON。
- 频道设置继续使用公开/私有可见性，但提案建议把公开频道解释为“所有 Space Agent 可发现，加入后读写”，私有频道解释为“仅选择的 Agent 可发现/读取”；改变可见性时确认现有 membership，不自动批量增删 Agent。
- `silent` Agent 被 Human direct mention 时仍可加入话题但不出现回复 placeholder；在 OS sandbox 前，私有设置使用“产品内私有”准确文案，不承诺同一系统用户下的 runtime 进程无法访问或修改本机路径。
- MessageContextSnapshot 只保存产品对象引用与 revision，不采集 DOM、截图、剪贴板或未提交表单；它在 turn 的“上下文”中显示为独立来源。

P-A10.2已经复用现有Chat表现层投影scoped activity/trajectory和required turn ephemeral placeholder：text delta只作草稿，`turn.reply`提交的持久消息会替换它，失败会结束占位；该切片没有新增布局或管理入口。上列server-owned顶层mention话题、Context/Steps/Usage/Outcome详情、session诊断与结构化记忆面板仍分别属于P-A10.3、P-A10.5–P-A10.7，不能写成当前行为。完整机制、默认值和实施切片见 `../superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md`。
