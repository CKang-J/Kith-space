# Kith-space UI 方向

本文是 Kith-space 当前 UI 信息架构与视觉语言的权威说明。单窗口交互契约见 `docs/superpowers/specs/2026-07-10-kith-space-single-window-workspace-design.md`，个人 AgentOS 宿主与产品边界见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`，Home/Space root 补充设计见 `docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md`；最新图标导航栏、消息中栏和消息气泡规格见 `docs/superpowers/specs/2026-07-23-chat-icon-rail-message-pane-design.md`，其覆盖 `docs/superpowers/specs/2026-07-15-chat-shell-sidebar-module-navigation-design.md` 的左侧栏视觉结构；模型与供应商、运行器、Memory Advisor和Agent记忆页的实现覆盖见`docs/superpowers/specs/2026-07-23-model-provider-runtime-memory-settings-design.md`。现有可交互线框 `docs/prototypes/kith-space-single-window-flow.html` 只覆盖早期三态壳，不代表最新导航目标。

结论前置：Kith-space 采用**单窗口工作区**。首次启动先初始化唯一 Human，普通冷启动随后进入 `Home` Chat；Home 是真实总控 Space，并比普通 Space 多 Spaces 模块。左侧使用 sidebar-10 风格的可折叠常驻侧栏，统一承载 Space、Search、Spaces、Inbox、Tasks、Agents、消息分组与 Settings。Chat 是始终保留的基础工作面；打开 Spaces / Inbox / Tasks / Agents 后，它们在 Chat 右侧工作区以可关闭标签页呈现，同一资源重复打开只聚焦已有标签。Settings 以覆盖工作区的模态层呈现。底部 Dock、ModuleOnly 替换态和案例展示均已退出当前信息架构。

---

## 1. 视觉语言

全局 UI 与消息正文默认使用14px，页面标题与其他标题均使用16px；外观设置可将 UI 与消息正文在12–16px间同步调整，标题始终为当前正文 `+2px`，时间、状态、路径、数量与说明等辅助信息为 `max(12px, 正文字号 - 2px)`。非消息 UI 使用400常规字重，消息 Markdown 的标题与粗体使用600；通过字号、颜色和留白表达层级，不在其他 UI 位置依赖粗体。默认组合为界面 Sora Variable、消息与文档跟随界面、代码使用系统等宽字体，中文字符继续回退到系统 `PingFang SC` / `Microsoft YaHei`。Settings 的“外观”分区可独立调整 UI 字号、界面、消息与文档、代码四项：界面菜单按无衬线与等宽分组提供 Sora / System UI / Inter / Geist 和 System Monospace / JetBrains Mono / Fira Code / Geist Mono，消息与文档提供跟随界面及无衬线组，代码提供等宽组；所有非系统字体随应用打包，不依赖网络。

Chat 顶栏的频道名称、消息中栏标题及其中的“已保存”、频道名称和 Agent 名称、聚合面板标题统一使用400常规字重；这些位置通过字号、位置和留白表达层级，不再依赖粗体。

借鉴参考产品的布局关系与空间层次，不复制其源码、品牌或具体实现。Kith-space 保留自身已有组件与业务视觉，只统一工作窗口的骨架：

- 工作区通过 `background / card / sidebar / foreground / muted / border / ring` 等语义 Token 同时支持亮色、暗色与跟随系统。侧栏、Chat、标签栏和模块面板只用必要细分隔线建立层级，禁止在暗色主题残留固定白色面板。
- 全局 40px 顶部栏已退役；Space 快速切换入口位于常驻侧栏顶部，模块入口在侧栏可见时显示图标与名称。Space 切换使用 shadcn `DropdownMenu` 的 Portal、Group、Item、Separator 组合，以 `popover / popover-foreground / accent / muted / border` 语义 Token 同时适配亮暗主题；不再使用侧栏内部手写浮层，避免收起后的预览抽屉与菜单产生裁切或层级冲突。菜单打开态是边缘预览的显式保活锁：菜单关闭后仅在指针已离开侧栏时才开始收回，不能依赖 Portal 菜单的零散 enter/leave 事件。侧栏持久收起时内容完全离开画布，通过固定开关或窗口左侧热区的覆盖抽屉重新访问，因此不挂载无效的菜单 tooltip。标题、导航、正文和元信息默认使用 Sora Variable 无衬线字体栈，中文使用系统字体回退；用户可在“外观”中按界面、消息与文档、代码三个作用域调整字体。
- 侧栏的消息分组只承载已保存、频道和私信；频道与私信有明确分组，不放搜索框。
- 模块入口、会话列表和归档频道入口不绘制独立卡片阴影，只用留白、分组标题、hover/active 行底色与必要的栏间分隔线组织层级。
- 活跃会话行使用低饱和选中表面，“已保存”与普通会话保持相同层级，不使用额外阴影或强调底块；Human 消息使用 `--chat-human-bg / --chat-human-foreground` 并右对齐，Agent 消息使用 `muted / foreground` 派生表面并左对齐。亮色 Human 气泡保持浅蓝归属感，暗色 Human 气泡使用低亮度蓝黑表面和柔和浅色正文，hover 由独立语义 Token 提亮，不能沿用浅色气泡值。气泡使用16px 18px内距，聊天正文使用当前 UI 字号/1.5，日期、时间与话题最新回复使用 `max(12px, 正文字号 - 2px)` 的低对比元数据层。Markdown 标题限制在气泡阅读尺度，正文段距和列表间距分别收敛到`.25em`，列表项间距为`.1em`；粗体使用600字重并继承正文颜色，避免额外加深造成视觉上过重。代码块使用带复制入口的深色独立表面，表格只在气泡内部横向滚动，链接仅在hover时显示下划线。
- Chat 标题栏相对 Chat 卡片左右固定 14px，不跟随消息宽度变化；频道标题以 18px 线性 Hash 图标替代文本 `#`，与左侧频道栏使用同一图标体系。Agent 私聊标题不显示头像，使用“16px/400 昵称 + 12px/400 状态”，也不显示 `@` 前缀或 AI 标签；状态文字复用 Agents 页面同一套本地化映射。休眠状态统一使用低对比暖灰色状态点，在线、工作和错误状态继续保留各自语义色。主消息区与话题区均使用 16px 可见安全边距；日期分隔、消息流、system 任务事件和各自 Composer 使用同一条 1040px 居中内容轨道；system 事件内部 Markdown 同样居中。层级固定为“面板边缘 → 原生滚动条槽 → 16px消息轨道 → 头像/气泡”，滚动区拥有原生滚动条，Composer 是它的绝对定位兄弟节点。每个面板通过 `ResizeObserver` 独立测量 `offsetWidth - clientWidth`：覆盖式滚动条按0px处理，经典滚动条按实际占位处理；滚动区与Composer使用同一个实测值抵消右侧槽位，不允许再写死10px等滚动条宽度。由此主会话和话题的 Agent 头像左缘、Human 头像右缘及输入框左右缘都落在同一条16px轨道；话题 Agent 长气泡可扩展到 Human 头像右侧安全线，Human 长气泡可向左扩展到 Agent 头像安全线。只允许纵向滚动，宽屏左右留白对称，窄屏不会被隐藏工具栏撑出横向滚动条。
- 不把现有业务视图一比一重画成原型；原型负责布局与交互，现有 Kith-space UI 负责内容呈现。

品牌标志采用“三层本地 Space”概念：暖白、鼠尾草绿与近黑三张错位平面表达 Home 和多个本地 Space，前景平面形成 `K`。用户确认的生成设计稿及其原始像素裁切是唯一母版；应用图标按母版 120/558 的标准圆角比例精确裁出透明四角，浏览器使用同源 RGBA PNG，Windows/Electron 使用同源多尺寸 ICO，不重新描摹 SVG。完整资产与回归约束见 `docs/brand.md`。

这套“统一主卡片 + 画布会话导航 + 留白分组 + 克制浮层”的语言同时用于 Chat、业务模块和 Settings，避免不同页面像几套产品。

### 1.1 前端样式实现基线

自 2026-07-24 起，新增 UI 采用 Tailwind CSS v4 与 shadcn/ui。基础组件从 `@/components/ui/*` 复用，条件类名通过 `@/lib/utils` 的 `cn()` 合并，颜色使用 `background`、`foreground`、`muted`、`border`、`ring` 等语义设计 Token。新增样式不再写入全局 CSS、局部 CSS、CSS Modules 或内联 `style`；只有 Tailwind/shadcn 主题基础层和无法枚举的运行时几何值例外。

当前 `styles.css` 与各 feature CSS 仍承载已验收的存量界面，不进行一次性重写。后续结构性修改某个组件时，在改动范围可控的前提下迁移该组件；纯缺陷修复允许外科式维护原 CSS。该渐进边界避免仅为换样式技术而改变现有信息架构、视觉验收结果或交互契约。

---

## 2. 顶层骨架

应用只有一个 `WorkspaceFrame`：

```text
┌────────────────────────────────────────────────────────────┐
│ 可折叠常驻侧栏 │ Chat 基础工作面 │ 工作区标签页 + 当前模块 │
│ 模块/频道/私信 │ 可附带聚合面板  │ 可关闭、聚焦、按 Space 恢复 │
└────────────────────────────────────────────────────────────┘
```

- 未初始化时进入本地 Human 资料页；普通冷启动进入自动创建的 Home Chat，显式 Space 深链接直达目标，托盘恢复保留现有窗口现场。
- Space 图标保留快速切换、失联重连和“管理空间”跳转；H4 已把默认创建、已有文件夹接入和完整目录管理移入 Home 的 Spaces 模块。
- Search 位于图标栏，通过图标按钮和 `Cmd/Ctrl + K` 进入；消息中栏不重复放置搜索框。
- Chat 始终保留在中心工作面，并可附带当前会话聚合面板；业务模块在右侧标签工作区显示，不卸载 Chat。
- Chat 与右侧模块工作区使用连续边界和语义背景。模块内部已有对象侧栏可以保留，但不能再创建底部导航或另一套顶层壳。
- Settings 不占用主卡片路由槽位，而是在 Chat 上方打开最大宽度960px、最大高度790px的模态层；小视口继续保留20px安全边距。右侧页标题与内容根节点复用同一个居中内容列和左基线：Human/空间资料使用520px列，外观与图像/视频生成使用3xl列，其余复杂设置保持可用全宽。关闭、遮罩点击和 Esc 都返回原 Chat，设置分区切换使用 replace history，避免关闭后浏览器返回立即重开弹窗。

当前 Space 的频道或 Human-Agent DM 由规范会话 pathname 表达；聚焦业务标签时在同一 URL 上增加 `?module=<id>`，Settings 使用 `?module=settings&settings=<section>`。Tasks 使用 `taskScope`，Agents 使用 `agent` 与 `agentTab` 表达自己的资源；不属于当前模块的资源参数会被清除。URL 表达当前聚焦标签，完整标签集合与激活项按 Space 使用版本化本地状态恢复。

浏览器刷新、前进和后退都以 URL 为准恢复 Chat、业务模块或 Settings 模态层；会话列表、聚合面板、聚合 Tab 与文件筛选等短暂界面状态不进入 URL。`/tasks`、`/agent`、`/settings` 等旧模块实体路径不再作为兼容深链，未知 Space 子路径会规范化到 `/s/:slug/channel` 并保留有效 query/hash。`?legacy=1` 与旧 `Layout` 已删除。

---

## 3. Chat + 标签工作区布局与模块导航

### 3.1 呈现状态

```text
Chat       = 常驻侧栏 + Chat
Module     = 常驻侧栏 + Chat + 右侧标签工作区
Settings   = Chat 保持挂载 + Settings 模态层
```

| 当前状态 | 模块入口位置 | 点击当前模块 | 点击其他业务模块 | 点击 Settings |
|---|---|---|---|---|
| Chat | 左侧常驻栏 | 不适用 | 在右侧打开并聚焦标签 | 在工作区上打开模态层 |
| Module | 左侧常驻栏 | 聚焦已有标签，不创建重复项 | 新增或聚焦对应标签 | 保留标签状态并打开模态层 |
| Settings | 左侧底层保持但不可交互 | 关闭弹窗返回 Chat | 先关闭弹窗后由左侧选择 | 保持弹窗并切换设置分区 |

### 3.2 常驻可折叠侧栏

左侧 sidebar-10 风格侧栏按 Space 类型显示模块入口：

- Home：`Messages | Search | Spaces | Inbox | Tasks | Agents | Settings`。
- 普通 Space：`Messages | Search | Inbox | Tasks | Agents | Settings`。

- 所有入口提供可访问名称；折叠态提供 hover/focus tooltip；Search 继续支持 `Ctrl/Command + K`。
- 侧栏展开态直接包含消息分组，折叠态保留 Chat/模块入口；顶部或 rail 按钮负责折叠与展开。
- 点击业务模块入口写入规范 `module` query，并打开或聚焦右侧标签；重复点击不会产生重复标签。
- 关闭当前标签后优先聚焦右侧相邻标签，其次左侧相邻标签；关闭最后一个标签后回到仅 Chat。
- 工作区不挂载底部 Dock，也不为 Dock 预留空间。

### 3.3 Settings 模态层

- Settings 复用既有 Human、外观、图像与视频生成、Space、模型与供应商、运行器、自动整理记忆和 Desktop 内容，不复制第二套设置表单。
- Settings 模态层以单张浮动面板呈现：外层使用较大的统一圆角、浅边界、柔和阴影与半透明遮罩；左侧为带图标的设置导航，当前项以低对比圆角胶囊标识。右侧只显示当前分区名称，不绘制标题栏底线；内容按留白和少量圆角分组组织，避免把每一层都画成方框。
- “外观”是跨 Space 的安装级分区。第一版管理 UI字号及字体：UI字号、界面、消息与文档、代码均使用 shadcn Select；变更即时预览并持久化，保存失败回滚到此前值，提供恢复默认组合。任意本机字体名称和上传字体不在第一版范围，避免 Desktop 与可选浏览器入口出现不可复现的字体差异。
- “图像与视频”是跨 Space 的安装级分区，用于配置火山方舟共用 API Key 与端点（图像 Seedream 与视频 Seedance 同一密钥）。GET 返回合并后的 `ark` 视图（`hasApiKey` 与 hint，不回明文）；PATCH `name=ark` 同时写入 `doubao`/`seedream` 两行。写 Key 要求 Desktop trust 或本机 loopback。
- 模态层有明确标题、关闭按钮、遮罩关闭、Esc、焦点圈定和底层 `inert`；二级供应商弹窗打开时，Esc 只关闭最上层。
- 桌面宽度使用左侧设置分区导航和右侧内容；小于 640px 时分区导航改为顶部横向滚动列表，内容保持可读。
- 设置分区切换替换当前 history entry；关闭弹窗同样替换为 Chat URL，浏览器返回不会重新打开刚关闭的设置。

Spaces 只在 Home 出现；Agents 只显示当前 Space 的 agent 队伍；唯一 Human 的资料位于全局 Settings。Canvas 已作为真实能力进入同一模块注册表；Calendar 等未实现能力不展示空入口。

创建 Agent 时，Runtime 选择器读取 Local Runtime Worker 的实际 availability，而不是使用前端硬编码的可用状态。完整 runtime 目录始终展示：已安装项排序在前并标注“已安装”，未安装项排序在后、标注“未安装”且不可选择；默认选中第一个已安装项。OpenCode 模型选择器只展示 `opencode models` 返回并去重后的真实 `provider/model`；探测失败时显示错误、提供重试并禁止创建，不回退到虚假的 `Default`。

创建成功后，agent 只向唯一 Human 的 `dm:@you` 发送一次 2-3 句自我介绍，内容包含身份、职责/擅长能力和如何派活；不扫描频道历史、不汇报“没有消息”，也不向公共频道广播。只有创建/重试 introduction turn 的介绍私信成功进入对应 Human-Agent DM 后才视为完成；若真实消息先到，agent 先按 wake 语义回复原目标，该普通回复不算自我介绍。后续手动启动、重启和恢复只检查真实待处理消息，空收件箱保持静默；由频道、DM、任务或 backlog 触发的唤醒必须在每个原会话目标处理和回复。普通 reset 只清 session/runtime state 并保留入职状态；完整 reset 额外清当前 Agent Memory 和入职状态后重新介绍。两种 reset 都保留共享 Space 文件树，UI 不提供把“删除项目文件”伪装成 Agent 重置的入口。

---

## 4. Chat 工作面

### 4.1 Chat 全宽

ChatOnly 由当前会话工作面和可独立收起的辅助面板组成：

- **Desktop 窗口边界**：macOS Desktop 使用系统 `hiddenInset` 窗口样式，隐藏标题栏内容，同时保留原生红黄绿窗口控制器；当前原生控制器通过 Desktop 窗口配置固定在 `{ x: 16, y: 16 }`，使其与壳层顶栏保持一致的内边距。不再叠加独立的顶部拖拽条或透明遮罩；侧栏标题、会话顶栏、聚合面板顶栏和工作区标签栏本身组成连续拖拽面，其中按钮、标签、链接和表单控件必须显式保持 `no-drag`。侧栏开关在展开与收起状态下固定于窗口 `left: 88px`，并分别使用收起与展开图标；顶栏可见操作图标统一为14px。侧栏展开时标题为原生控制器预留安全边界；侧栏收起时，会话标题为按钮让出内容空间，并在按钮覆盖范围建立独立 `no-drag` 命中区，确保窗口拖拽不会吞掉点击。浏览器入口的会话标题同样为开关预留独立空间，避免开关与频道图标重叠。不在 Web UI 中自绘窗口控制器。点击开关触发的持久展开/收起与聚合面板使用同一种布局动画：Sidebar 外层只过渡 `width + flex-basis`，时长均为420ms并使用同一条 `cubic-bezier(.25,.8,.25,1)`；内部260px侧栏锚定在外层运动边缘，不再运行独立的 `transform`，因此侧栏边缘与 Chat 左缘由同一个布局值驱动。ChatOnly 下聊天面板始终使用 Flex 填满 Sidebar 和300px聚合面板以外的可用宽度，Chat 自身右边界以与顶栏一致的1px边线和聚合面板相接，聚合面板不再重复绘制第二根边线或保留额外画布间隙；可用宽度不足以同时容纳最小 Chat 与聚合面板时，已打开的聚合面板以同一组件从 Chat 右侧作为抽屉呈现，并由原开关或面板关闭按钮收起。布局运动期间关闭 Chat/模块自身的二次宽度过渡，因此不会露出底层画布或把聚合面板推出视口。侧栏持久收起时，桌面宽度下把鼠标移入窗口最左侧8px热区会临时显示覆盖式侧栏抽屉；抽屉右缘额外保留24px容错走廊，离开整个区域260ms后才开始退场；在退场中重新进入热区、侧栏或容错走廊会从当前呈现位置直接反转回展开，不等待收回完成。悬浮抽屉使用GPU友好的 `transform` 位移，并在内部内容层协同 `opacity`：展开以210ms位移建立空间关系、140ms淡入减轻视觉重量；收回以更快的150ms位移和100ms淡出退回窗口边缘，并以真实 `transitionend` 清理覆盖层。持久布局与边缘预览是互斥状态机：只有左侧热区能启动预览，Sidebar 本体只能维持已经打开的预览；按钮布局运动期间禁用热区与预览，并由 CSS 再次阻止预览规则覆盖420ms主时间轴。`Escape` 可关闭，且该预览不改写用户保存的展开/收起状态。打开或切换右侧工作区标签时自动收起侧栏一次，用户随后仍可手动展开。Windows、Linux与浏览器入口继续使用各自默认窗口边界。布局动画的性能边界同样适用于 Desktop 与 Web：消息行和系统消息使用 `content-visibility:auto` 跳过离屏布局与绘制，`ChatWorkspace` 与 `WorkspaceNavigationRail` 以稳定 props 隔离侧栏状态更新，工作区宽度观察值在连续 resize 停止80ms后一次提交；macOS 会话标题的窗口控制器安全间距与侧栏共用420ms曲线，避免瞬时跳变。

```text
图标导航栏 | 消息中栏 | 当前会话与 Composer | 聚合面板（轨迹 / 话题 / 文件）
```

- 图标导航栏组合 SpaceSwitcher 与全局模块入口；Messages 激活时显示独立消息中栏。消息中栏从上到下只包含“消息”标题、已保存、频道和私信，不包含搜索框或全局 Agent 运行状态。Search 图标与 `Ctrl/Command + K` 打开同一个白色圆角命令面板：空查询按“推荐 / 频道 / 私信 / Agent”分组，输入后同时匹配频道、私信、Agent 以及当前 Space 可读的频道消息、话题消息和私信消息；点击消息直接定位原消息或打开所属话题。DM 内部复合 ID 和 thread 内部名称不得进入 UI；单 Human 私信使用对端 Agent 头像与展示名，Agent-Agent 私信使用参与者展示名组合。频道保留未读、置顶、新建和切换行为，并以线性 Hash 图标替代文本 `#`；不提供 Human-Human DM。归档频道不混入活跃频道，而是进入仅在有数据时显示、默认收起并按归档时间倒序排列的“已归档”子分组。案例展示不再属于目标信息架构。
- 中间复用现有 `Chat`、Composer、Thread、附件和 @mention 能力；用户界面统一称“话题”，内部数据、API 与 query 继续使用 `thread`。Agent 私聊标题区保留直达当前 Agent 详情页的入口；话题打开时默认与当前会话各占一半宽度，并可通过中间分割线继续拖拽调整。展开话题不压缩当前会话标题栏：标题和右侧操作按钮继续占据完整 Chat 宽度，底部分割线连续。话题分栏从该标题栏下方开始，话题工具栏为44px高、16px标题和28px操作按钮。父消息外层不再增加第二层背景；Agent 头像左边距、Human 头像右边距与 Agent 气泡右边距使用同一安全边距。话题标题栏以普通铃铛表示“已关注”、划线铃铛表示“未关注”，关注切换不关闭面板，关闭仍由独立的 × 按钮负责。
- 删除 Agent 时，所有包含它的私聊、私聊下的话题、消息、附件记录及本地附件对象一并永久删除，私信列表、Inbox 与命令面板不再显示该 Agent。公共频道及其话题中的历史消息继续保留，以消息发送时保存的名称展示，并在主消息与话题回复预览中实时标记“已删除”；已删除身份不可再打开 Agent 卡片或被命令面板检索。
- 删除旧“会话 / Chat / 轨迹”顶栏。会话列表纯图标开关迁入当前会话标题最左侧；标题右侧依次提供当前会话 Tasks、聚合面板和频道设置等纯图标入口。频道成员不再提供独立标题栏入口或抽屉，统一从频道设置的“成员”页管理。Tasks 始终导航到 `module=tasks&taskScope=<当前会话ID>`，点击已打开的同一 Tasks 不解释为关闭。
- 聚合面板顶部使用与 Chat 标题栏同高的52px标题栏，显示“聚合面板”和右侧圆形hover关闭按钮，底部分割线与 Chat 标题栏对齐。标题栏下方固定承载“轨迹 / 话题 / 文件”三个等宽滑动 Tab，控制器容器不再绘制额外下边线；`#f5f5f5` 轨道内的 `#ffffff` 选中底板使用克制的多层低透明阴影，并只做 `transform` 横移，内容不淡入淡出。该滑块与 Agent 卡片、Agent 默认响应模式共用 `components/SlidingTabs.tsx`，由公共组件统一提供40px常规高度、2px内缩、12px轨道圆角、10px选中圆角、常规500字重、tab/radio语义、紧凑高度和 reduced-motion 降级；各调用点不再覆盖自己的选中视觉。三个内容区通过 `hidden` 切换而不卸载，因此文件分类、关键词和搜索展开状态跨 Tab 保留，只在会话切换时重置。话题列表来自独立 thread summaries 查询，新建空话题与后续回复都会实时刷新，点击后仍在原 Chat 话题位置展开正文；文件页支持“全部 / 图片 / 视频 / 文件”和文件名/来源消息搜索，并与 Composer、消息附件复用同一套文件类型判定及无描边类型图标。文件筛选的未选中项和文件搜索框统一使用 `#f5f5f5` 中性表面；文件页与 Agents 列表复用 `components/SearchField.tsx` 的胶囊搜索框，只显示产品自己的清除按钮，输入框焦点使用浅色内描边而不是黑框。
- 频道设置是聚合面板内的临时管理场景，不是第四个 Tab。进入后以同一面板承载设置首页及“常规 / 成员 / 通知”三个钻取页，并保持原聚合 Tab、文件筛选和搜索状态挂载；返回内容场景时恢复原状态。常规页显式保存名称、描述和公开/私密可见性；成员页以实际 Human 名称加“你”标识固定展示唯一 Human，agent 通过带搜索的单选弹窗添加，移除前要求二次确认；通知页即时持久化“所有消息 / 仅提及 / 不通知”。未保存常规修改在返回、关闭、切换频道、隐藏 Chat、刷新或浏览器历史后退前要求确认放弃；取消后保留当前 URL 和表单草稿。
- **消息流表现（代码、自动化与真实浏览器测量已完成）**：主会话、话题、action card 与加载 Skeleton 继续复用同一消息骨架；外层消息行不绘制整行卡片。Human 使用右对齐 `#e7f0fe` 浅蓝气泡、头像置于右侧并隐藏重复的自己昵称/时间标题；Agent 使用左对齐 `#f7f8fa` 浅灰气泡，昵称为常规字重。头像统一为 `36px`，气泡统一为 `16px` 圆角和 `16px 18px` 内距；频道 Agent 通过 `18px` 紧凑昵称行让气泡顶部落在头像圆心，私聊隐藏重复昵称并让气泡与头像顶部平齐。正文使用 `14px / 1.5`，日期、气泡下时间、系统提示、任务生命周期事件和消息内任务状态胶囊统一使用辅助字号。Agent 时间默认隐藏并在消息 hover/focus 时出现；hover 工具栏和“更多”菜单共用白色表面、`#f0f0f0` 边线、`12px` 圆角与轻量投影。Agent 工具栏优先位于气泡右侧，Human 优先位于气泡左侧，各自空间不足时移到气泡上方。Markdown 使用气泡内标题尺度，段落和列表间距按紧凑阅读节奏收敛；粗体使用600字重并继承正文颜色。行内代码为轻灰底，代码块为带复制按钮的深色表面，引用为3px柔和竖线和浅底，表格只在气泡内部横向滚动。话题回复预览从消息气泡分离成独立白色描边卡片，预览昵称使用辅助字号和正文黑色，其余回复摘要、“回复话题”、回复数及相对最新时间均使用辅助字号和浅灰色；hover 不把这些元数据重新变黑。普通消息链尾间距为 26px；同一天相邻且同发送者的普通消息继续形成连续组，日期、发送者变化、系统消息和 action card 会打断分组。日期分隔使用居中灰色胶囊，不再画贯穿消息区的水平线。Agent mention 插入、身份卡片、状态点、reaction、归档只读限制、附件、任务与深链契约保持不变。Chat 标题栏、消息流与 Composer 继续共用既有可读内容轨道。基础消息尺寸见 `../superpowers/specs/2026-07-15-chat-message-ui-density-design.md`，最新方向与覆盖约定见 `../superpowers/specs/2026-07-23-chat-icon-rail-message-pane-design.md`。
- **Agent 响应模式（已实现）**：Agent Profile 的基本信息后、Skills 前保留独立“响应模式”卡片，用三段式控件设置当前 Space 的主动/被动/静音默认值；私聊和明确指派的任务不受该默认值限制。消息昵称后的模式徽标与 hover 菜单已移除；点击 Agent 消息头像打开紧凑 Agent 卡片，显示头像、名称、运行状态、模型与“发消息”动作，“发消息”按钮固定使用 `#f7f7f7` 底色与 `#f0f0f0` hover。顶层频道及其话题中的当前成员 Agent 卡片额外显示“本频道响应模式”三段式控件，选择只写当前频道覆盖，并以弱提示显示 Agent 默认值；显式覆盖时可“恢复默认”。响应模式与聚合面板复用同一滑块分段组件，紧凑卡片使用 38px 规格和 240ms 平滑横移动画。这里不允许修改 Agent 默认值，默认值仍只在 Agent 页面管理。话题继承父频道；DM、已移除 Agent 不显示频道模式；归档频道只读。头像卡片仅由点击/键盘激活，点击外部、滚动、调整窗口或 `Escape` 关闭。完整交互见 `../superpowers/specs/2026-07-14-agent-channel-response-mode-design.md`。
- **Composer 输入与动作（已实现）**：空输入和未接近右侧控制安全区的单行短文本保持 `48px` 高的胶囊输入框；只有实测文本宽度用尽当前剩余安全区、出现显式换行或存在待发送附件时才展开为多行面板，删除内容后可重新收紧。左下角 `32×32` 圆形“+”与右下角 `32×32` 圆形上箭头发送按钮对齐；“+”图标为 `18px`、较粗描边，在 hover、键盘聚焦和菜单打开时仍使用同尺寸圆形底，焦点反馈不额外外扩黑色轮廓。菜单合并“添加照片和文件”，并包含“画布”与“指派任务”。打开右侧 Canvas 后，“画布”项可用；点击后才在“+”右侧显示轻量授权胶囊（Canvas 图标 +「画布: 标题」+ hover 移除），不渲染实时缩略图，也不把整板授权放进附件区；多个打开的画布在菜单中列出供选择。用户圈选“发送到 Chat”的选区才出现在附件区并带冻结缩略图，可与整板授权并存。关闭 Canvas 标签不自动移除授权胶囊。启用任务后，任务胶囊同样出现在“+”右侧并与正文共享单行空间，不会自行增高输入框，但会按实际占位缩短正文可用安全宽度。任务/画布文字与正文始终复用同一字号变量（桌面 `14px`，小屏防输入缩放时同步为 `16px`）；hover/聚焦时使用图标库的 X 图标和更小的 `14px` 圆底替换胶囊图标，外层占位不变，点击即可取消。图片缩略图与文件卡片显示在输入框内部正文上方，带独立移除按钮；不提供参考图中的速度和麦克风动作。
  “+”菜单以整个 Composer 外框为锚点，左边界和宽度与输入框对齐；只有输入框本身超过视口安全范围时，才按左右 `8px` 视口边距收缩。菜单使用上下 `4px`、左右 `5px` 内边距和 `16px` 外圆角；每个菜单项为 `30px` 高、`10px` 圆角和 `4px 10px` 内边距。菜单只靠浅色边框和圆角分层，不显示阴影。每次打开时首个可用项默认显示高亮；鼠标或键盘进入其他项后，高亮停留在最后经过的项，离开菜单项不回退。任务开关状态不使用常驻高亮或勾号表达，而是在“指派任务”后以淡色文案显示“开启指派任务 / 关闭指派任务”；实际 hover/键盘高亮仍与其他菜单项一致。`@` 候选菜单复用同一外框宽度、`16px` 外圆角、无阴影表面和 `30px`/`10px` 候选行；名称、`@handle`、范围说明与类型在一行内截断，首项及鼠标/键盘最后经过项沿用相同浅色高亮。
  展开态只增加上半部分正文/附件空间；下方控制区继续沿用紧凑态的 `48px` 视觉高度、左右 `10px` 控制内距、底部 `8px` 控制内距和 `24px` 底角，因此“+”和发送按钮在高低状态间不横向或纵向跳动。
  展开态附件与正文统一使用距输入框上、左边界各 `10px` 的内容基线；Composer 与主消息/话题消息复用 `components/AttachmentCard.tsx`，附件列表按可用宽度自动换行并以 `max-width: 100%` 防止溢出。输入框外侧底色在单行时从 Composer 高度中点开始不透明；多行或有附件的展开态则从输入框顶部圆角过渡为垂直边的位置（24px）开始不透明，防止消息内容透到输入框两侧。附件卡片使用 `13px` 圆角，hover/focus-within 以短过渡切换至 `#f7f7f7`，移除按钮为居中的 `16px` 圆形。非图片附件按 Markdown、PDF、文档、表格、演示、压缩包、代码/数据、音视频和文本显示缩写式文件图标及克制的无描边纯色底，不绘制折页线；聚合面板文件页复用同一类型图标。消息只有一个图片附件时使用保持原始比例、最大 `320px` 的大预览；多图或图片与文件混排时继续使用紧凑卡片。Composer 和消息中的图片点击后进入共享查看器：100% 状态完整适配视口安全区，放大后可在整个视口舞台拖动，不受内层卡片裁切；支持按钮、滚轮及 `+`/`-`/`0` 快捷键缩放/复位，`Escape`、关闭按钮或点击图片外区域关闭。消息图片还按当前私聊/频道已加载消息的顺序组成独立序列，话题按父消息加当前话题回复组成序列；查看器提供上一张/下一张按钮、左右方向键和当前位置，序列不会跨会话。主 Chat 使用 `ResizeObserver` 把 Composer 实际高度加 `12px` 消息间距写入滚动区底部预留；在用户原本位于底部时同步维持贴底，避免附件或多行正文展开后遮挡最后一条消息。
- **当前会话活动摘要（已实现）**：主会话与话题 Composer 上方只显示该精确频道、私聊或话题 surface 的当前 Agent 活动，空闲时完全隐藏。前端把高频 runtime 状态和轨迹压缩为准备、思考、搜索网络、执行操作、查看资料、处理文件、更新任务、组织回复、等待确认、重试、完成或兜底工具名称；原始命令、参数、thinking 文本和历史继续留在 Agent 活动页。摘要使用辅助字号和单行截断，约300ms后稳定切换；短暂的 `offline/online` 不立刻闪烁，完成保留约1.2秒、错误保留约4秒。点击摘要进入对应 Agent 活动页。多个 Agent 同时工作时显示最高优先级的一个，并提示额外数量。
- **频道全体提及（已实现）**：Human 在可写频道及其话题的 Composer 输入 `@` 时，候选首项可出现带群组图标的本地化标签“所有人 / Everyone”和规范 token `@all`，副文案说明当前界面语言下的频道范围；消息正文始终渲染为一个不可导航的 `@all` mention token，不展开成员名单。DM 与归档频道不提供候选；启用“指派任务”后隐藏候选，手工输入 token 发送时也保留草稿并提示改为单一 `@Agent` 或未指派任务。Agent 发出的同名文本只按普通文字显示，不触发群体唤醒。Showcase 已在壳层切片中完整退役。
- **正文身份提及**：消息正文中的 Agent/Human `@昵称` 使用无底块的蓝色链接样式，hover 或键盘聚焦时显示细下划线；点击后以该 token 为锚点打开与消息头像一致的 Agent/Human 身份卡片，不再跳转 Agent 模块或 Human 设置。频道、话题和任务引用继续保持各自既有样式与导航行为，`@all` 仍不可点击。
- **回复预览与话题边界**：required 唤醒可以在原会话显示 Agent 临时回复预览；若 Agent 直接在该会话发送正式消息，预览平滑收敛为持久化消息；若 Agent 按要求改在触发消息的话题中回复，则在首条正式回复持久化后移除对应 Agent 的父会话预览，单纯创建空话题不提前清理。工具调用后的“已回复”“没有待处理消息”等 runtime 尾部文本只留在轨迹，不显示为刷新即消失的主会话消息。
- 聚合面板轨迹展示当前 base conversation 最近300条持久历史，并在其后合并当前WebSocket实时增量；刷新、切换会话、收起再展开或重连后都会从workspace数据库恢复，不依赖本次前端会话缓冲。普通话题和P-A10 v2 required turn使用的server-owned thread都在Core归一到父会话，因此父会话可恢复其中的Agent轨迹；无作用域或跨会话 ambiguous 事件不进入任何会话聚合面板。历史请求与实时事件重叠时按Agent、turn、事件类型和内容进行多重集去重，避免同一步骤显示两次。
- 聚合面板“轨迹”和 Agents 详情“活动”使用同一套辅助信息时间线：Agent/turn 形成清楚分组，聚合面板中的Agent昵称保留正文号（默认14px），时间、思考摘要、正文片段和工具调用统一使用 `max(12px, 正文字号 - 2px)` 的辅助字号，不再混成连续纯文本。聚合面板定位为可读的协作摘要，不展示`turn_started / activity / usage / turn_completed / online`等runtime生命周期遥测；失败、取消、等待、重试和授权类异常仍保留。完整原始状态仅在Agent详情“活动”页呈现，底层持久记录不删除。聚合面板天然只属于当前会话，因此只显示Agent身份；Agent详情活动页跨频道、私信和话题汇总历史，因此每个turn头部显示可点击来源：频道为`# 名称`，私信为“与某人的私信”，话题为`# 父频道 · 父消息摘要`。点击来源在保留Agents模块上下文的同时打开对应会话或话题；来源被删除时显示“渠道不可用”，升级前没有归属字段的旧历史显示“未记录渠道”，不按名称猜测。活动页的正文步骤限制为72字符可读列，时间固定在行尾独立列；超过320字符或5个换行的正文默认显示最多四行，并提供“展开正文 / 收起正文”，短正文不显示额外控件。思考使用 assistant-ui Ghost `Reasoning`，运行时展开、结束后自动收起；单个工具使用 assistant-ui `ToolFallback` 的原生“状态图标—已调用工具—工具名—箭头”触发器，连续工具调用由 Ghost `ToolGroup` 合并。折叠标题不混入时间或命令摘要，点击后再显示完整输入、输出或错误，Shell 类步骤使用 AI Elements `Terminal`。三类 assistant-ui 触发器统一透明、无原生按钮边框，并继续遵守现有字体、语义颜色和键盘焦点规范。
- 会话列表保持常驻；聚合面板沿物理边界把宽度变为 `0`，内容随边界裁切，不使用淡入淡出或贯穿全高的收起长条。
- Chat 中的频道设置优先占用聚合面板位置；空间不足时复用同一个设置组件，在 Chat 内从右侧以裁切宽度动画打开临时抽屉，不复制第二套表单。
- 归档频道保留历史消息、话题、文件、成员和设置阅读入口，但以顶部只读提示替代 Composer，并关闭回复、附件、reaction、任务状态/创建、action card 和成员修改等写入口。顶部提示直接提供“恢复频道”，设置首页同时提供恢复与永久删除；恢复后留在当前频道并回到活跃列表，永久删除必须准确输入频道名称。每个 Space 的 `# all` 是必需频道：名称和可见性锁定，归档入口隐藏；删除动作保留为置灰入口并明确说明系统必需频道不能删除，服务端仍执行最终保护。

### 4.2 Chat 与模块切换

- 业务模块打开时 Chat 保持挂载，右侧标签工作区按可用宽度与 Chat 并排；工作区以中间分割线作为唯一空间锚点，从 `0` 让出真实布局宽度，模块内容仅受工作区自身的物理边界裁切，不额外叠加内容裁切层、全局淡入淡出、独立平移或回弹，避免出现独立色块或空白画布。按钮打开采用 `400ms` 的稳定 ease-out 曲线（`cubic-bezier(.22,.61,.36,1)`），关闭采用第一帧立即起步的 `200ms` 退场曲线（`cubic-bezier(.2,.8,.3,1)`）；中间拖拽条与布局运动同步。连续开关由 CSS transition 从当前进度重新定向；直接拖拽分割线时停用所有布局过渡，保持 1:1 跟随，不加入缓动。内容在退场结束后卸载，避免 Chat 瞬时跳变或迟钝的收回感。
- 话题、agent profile 和频道设置属于 Chat 内部临时层，不占用业务模块主卡片。
- 从 Chat 打开指定会话 Tasks 时，把会话 id 固化为该 Tasks 标签的 `taskScope`；其他标签不会继承不属于自己的 resource query。
- 业务模块不提供第二套会话抽屉、Chat 显隐按钮或 Dock；标签栏是唯一顶层模块切换面。

---

## 5. 模块工作面与作用域

- 当前已实现业务模块包括 Inbox、Tasks、Agents、Canvas；Home 另有 Spaces；Search 由左侧入口或快捷键打开；Settings 是模态层。Canvas Library 与实际 Canvas resource tab 已进入正式壳。Computers/Machines 不再是产品模块。
- 可同时打开多个业务模块标签，但一次只激活并显示一个右侧模块；切换左侧入口会新增或聚焦对应标签。
- Inbox、Tasks、Agents 和 Settings 只读取当前 Space 数据；Spaces 只读取 app.db registry 和真实摘要。切换 Space 时 Chat 与普通模块数据源一起切换。
- Web Store 与路由状态只使用 `SpaceInfo/spaceId/spaces` 和 `/s/:slug`；请求只发送 `x-space-id`，不得在前端保留旧 Server 双命名。
- Tasks 保留范围侧栏，可在当前 Space 的全部任务与指定频道任务之间切换；切换范围不得改变当前主卡片模块。
- 模块加载失败或空状态只在自身面板处理；左侧导航仍可返回 Chat。
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

### 5.2 Canvas Workspace（阶段 3 Chat 上下文联动已实现）

阶段 1 的固定 Recombyn `EditorPage`/RCB/nodes/chrome/panels 与原生观感保持不变。阶段2已从正式左侧 Canvas 入口打开 Canvas Library；新建/受限 JSON 导入后形成独立 resource tab，同一 Canvas 去重，不同 Canvas 可多开并按 Space 隔离恢复。实际 Canvas 继续使用原生工具栏、节点、Frame、选择/变换、结构和导出 UI；嵌入宿主时 editor island 高度严格跟随 workspace surface，不再按 browser viewport 溢出并裁掉底部工具栏。媒体按钮在相同原生位置经可复现 host materializer 恢复，先写入 Canvas-local durable asset，再把受控 resolver URL 提交 Core；AssetPanel 显示同 Canvas 本地资产。上游产品壳的 Home 与账户按钮在正式 Kith Canvas 中移除，标题、导出与分享保留。`⌘/Ctrl+Z`、`⌘⇧Z`/`Ctrl+Y` 由宿主捕获后调用 Core undo/redo。工具栏「图像生成器 (A)」「视频生成器 (Shift+A)」与媒体快速编辑走 Kith `canvas_generation_jobs`（Doubao 图像 / Seedance 视频），结果就地替换生成板；选中图片工具条的放大/去背景/多角度走同一 Job 的图生图，橡皮为本地擦除上传，标记为按住拖拽框选后飞入**左侧** Chat Composer（裁切附件 + 图片节点 Canvas 选区；框选说明只进 Agent 上下文，不进输入框/聊天气泡；开启后图上不叠说明，十字光标旁跟「按住拖选」；拖选坐标按 overlay 屏幕矩形换算，避免左侧 Chat 把画布推离原点后点不到图），去背景模式菜单留在选区工具条内，图片分层仍明确 unavailable。OCR 与 image-to-scene 仍延后。没有 AgentDock、第二套画布 UI 或 Page。阶段3在原生选区浮动工具栏最右侧提供描边胶囊“发送到 Chat”动作（单选、多选和 Frame；右键 Add to Chat 仍保留），点击后走已有 `kith:canvas-selection-to-chat` seam；事件必须携带来源 `canvasId`，bridge 按事件来源写入对应 Canvas 的 pending，飞入反馈由 Kith 自有 `canvasFlyToChat` 适配模块完成，不再 import Recombyn AgentDock/`flyToChat`。发送目标跟随当前 DM/频道/话题 surface，也不新增第二套 Chat 面板。打开右侧 Canvas 不会自动授权；用户从 Composer“+”菜单选择“画布”后，才在“+”旁挂一条轻量整板授权胶囊（图标+「画布: 标题」，无实时缩略图）。用户圈选发送进入附件区并带冻结缩略图，可与整板授权并存；关闭 Canvas 标签不自动移除授权胶囊。

- 规范 module id 为 `canvas`；实际 Canvas 使用当前会话 pathname 上的 `?module=canvas&canvas=<canvasId>`。`canvasId` 同时是 `WorkspaceTab.resourceId`，同一 Canvas 只聚焦一个 tab，不同 Canvas 可多开。
- `resourceId = null` 是 Canvas Library，用于新建、导入、打开和软删除当前 Space Canvas；它不是 Canvas Page。Library 使用中文缩略图网格：首卡始终是“新建画布”，其余卡片从 Core canonical document 只读绘制轻量 SVG 预览，并显示中文标题与更新时间；网格按 Workspace 实际可用宽度自动从一列扩展到四列。标题在原生编辑器内修改后经 `metadata.rename` 持久化，并同步 Workspace tab、URL 与 SQLite；删除会关闭对应 tab，活动项退回 Library，重启后仍保持删除态。每个实际 Canvas 永远是一个独立无限平面，产品不增加 Page 导航或层级。
- Canvas tab 与 Chat 并排，继续服从现有 split、相邻关闭、URL 活动项、按 Space 标签恢复和侧栏自动收起规则；不新增 Dock、第二套标签栏或全局壳。
- 实际编辑器直接移植 Recombyn RCB 的画布、节点、工具栏、属性/图层/资产/导出面板视觉结构和交互，不为统一 Kith 视觉而重设计。资产面板改接 Kith Canvas-local asset library；上游 JSON 导出按钮经宿主 port 读取 Core canonical scene，等待实际下载结果后再报告成功。Library 的受限 JSON 导入会校验格式、重映射全部外部 ID、归一隐藏 root，并拒绝未重绑定资产和悬空结构；正式 URL/tab/DB 不暴露 Page。上游“Export All Pages/导出全部页面”等产品文案与动作必须替换为“导出全部画布内容/画板”等无 Page 语义，并登记为批准的 visual golden 例外。Kith 另提供标签宿主、Canvas Library、冲突/错误提示、导入导出窄桥，以及 Composer Canvas Context Chip 与频道/话题 executor 选择。
- 嵌入态底部原生工具栏以当前可见编辑舞台（排除已展开的资产/图层侧栏，不按浏览器 viewport）为水平居中基准，并随 Workspace split 或内部侧栏 resize 重算。Core snapshot 回投只替换 canonical document；当前节点仍存在时保留 Recombyn renderer 的临时选中态，避免创建后选框闪退。
- Recombyn floating UI portal 位于 Canvas island 内、React editor mount 外，既继承 Canvas scoped 样式又不被 React 首次提交清除；缩放菜单由按钮单独拥有开关事件，避免 focus 与 wrapper click 双重切换。
- 正式 Canvas 不读取 Recombyn 自有主题偏好；Kith `<html>.dark` 是解析 light/dark/system 后的唯一事实源，Canvas root 实时同步 `data-theme`，继续复用 Recombyn 原生深浅色 token。
- Recombyn Home/Auth/Billing/Share/Cloud/Tauri 与 AgentDock 产品壳不出现。阶段1保留的 selection-to-chat 窄 host event seam 在阶段3接到现有 Composer；Canvas Access Grant、Agent 写回和“让 Agent 处理”留给阶段4。
- 圈选后的不可变 Canvas Selection Snapshot、Composer/消息 Canvas Context Chip（画布名、元素/Frame 摘要、缩略图、冻结 revision、en/zh、图标预览/查看选区）、选区预览/移除、打开并聚焦该条 snapshot 选区，以及 Turn Inspector 结构化 Canvas source 卡已在阶段3落地（卡片显示冻结 snapshot 投影出的来源会话/surface，不依赖 live Canvas）；Canvas 删除后历史 snapshot 仍可查看，live link fail-closed。pending 选区是按 Chat surface 隔离的可追加列表，同一 Canvas+同一选区去重，切换 DM/频道/话题时保留其他 surface 的 pending，切回后恢复卡片。发送成功后消息 chip 不可移除，也不随原画布后续修改而变。MVP 不做原生跨栏拖放。
- Recombyn Tailwind 3 必须独立构建并加 Canvas 作用域，Preflight/`html/body/:root` 不得进入 Kith 全局；Kith 全局选择器显式排除 Canvas root，并给 Canvas 建立 scoped reset 和独立 portal root。合法离线字体集先于 Kith golden 确定，替代字体是显式视觉例外；截图、交互和 computed-style 断言共同验收 UI 保护。

完整边界、MVP 和后续能力见 `../superpowers/specs/2026-08-15-recombyn-canvas-workspace-design.md`。

---

## 6. Chat 与模块联动

- 业务模块与 Chat 可以并排显示，但模块标签不会暗中改变下一条聊天消息的上下文。
- 任务、文件、agent 等对象只有通过明确的“在 Chat 中讨论”动作，才会成为 Chat 的 focused item。
- 每条消息发送时固化结构化 `MessageContextSnapshot`，包含 Space、会话、可见 UI context 和 focused item；UI 与服务端保存 Kith-space 自己的结构，不把特定 runtime 提示格式硬编码进核心模型。
- Canvas 联动：用户从 Composer“+”菜单选择“画布”后，才在当前 Chat surface 挂整板授权 pending，Composer 在“+”旁显示轻量画布胶囊（无实时缩略图）；用户也可“发送到 Chat”圈选 Frame/元素以附加局部选区，这些选区才进入附件区并带缩略图，两种授权可并存。发送时 Core 冻结当时全部 pending snapshot。关闭 Canvas 标签不丢掉整板 chip 或已圈选发送的卡片；用户点 X、发送成功或清空草稿才移除。
- Canvas 请求在 DM 中绑定对端 Agent，在频道/话题中绑定明确的一个 Agent；消息可见性与实际执行者继续分离，不因 Canvas context 默认唤醒全体。
- Agent 的 Canvas mutation 与 server-owned Chat reply 分开建模。UI 可在回执中展示 mutation 链接，但不能把画布已变更误当作 Chat turn 已结算。

---

## 7. 当前实现边界

当前生产壳已完成 A5 入口收口与 P-A7 H4：`App` 只渲染 `WorkspaceFrame`；Agents、Human Settings、Desktop Settings 与 Home-only Spaces 已落地，登录/注册/邀请、Computers、Landing、Features、PWA、SSR/prerender、旧 `Layout` 与 `?legacy=1` 均已退出活跃代码。Agent 详情的“记忆”标签与概览路径通过兼容的 workspace-files API 展示并读取当前 Space 的 `<space>/.kith/agents/<agentId>`；`agentTab=workspace` 只作为既有深链兼容值保留，不再表示共享 Space 工作区。普通冷启动进入 stable Home，显式 ready 深链接仍优先；普通 Space 不显示也不能激活 Spaces。

当前 Chat 壳层已按 sidebar-10 方向收敛为单个可折叠常驻侧栏：`WorkspaceNavigationRail` 组合 Space、模块入口与既有会话分组；`ConversationListContent` 继续复用既有会话数据。Spaces、Inbox、Tasks、Agents、Canvas 通过 `WorkspaceTabs` 在 Chat 右侧以按 Space 持久化的标签集合呈现；Canvas Library 使用无 resourceId 的模块 tab，实际 Canvas 使用稳定 resourceId。`WorkspaceDock` 已删除，Settings 使用独立模态层并复用原设置内容。案例展示继续保持退役。状态以 `docs/progress.md` 为准。

单窗口壳按职责拆在 `web/src/shell/`：

- `WorkspaceFrame.tsx`：路由同步、Chat 与标签工作区编排、Settings 模态层、聚合内容和频道设置短暂场景编排。
- `useChannelSettingsScene.ts`：频道设置场景、脏状态退出确认、焦点恢复以及刷新/历史后退保护。
- `workspaceLayout.ts`：无 React 依赖的 Chat/模块并排状态；Settings 选择映射为模态呈现。
- `paneConstraints.ts`：集中计算 Chat 与会话聚合面板的响应式下限和目标宽度。
- `shellStore.ts`：按 Space 持久化最近 Chat 位置；模块呈现由 URL 表达，避免双重状态源。
- `workspaceRoute.ts`：解析规范会话 pathname，把业务模块规范为 `module=<id>`、Settings 规范为覆盖工作区的 `module=settings`，并保留当前模块拥有的 `taskScope/agent/agentTab/settings` resource query。
- `workspaceTabs.ts`：管理稳定标签 ID、去重聚焦、相邻关闭策略、状态净化和按 Space 的版本化持久化。
- `WorkspaceTabs.tsx`：使用 shadcn Tabs/Popover 呈现标签栏、关闭动作和打开标签菜单。
- `WorkspaceNavigationRail.tsx`：组合 SpaceSwitcher、模块入口与会话分组，负责侧栏折叠和模块标签打开。
- `ChatWorkspace.tsx`：只负责 Chat 工作面；业务模块通过同级标签工作区与其并排。
- `SettingsDialog.tsx`：承载 Settings 模态层、顶层 Esc、焦点圈定/恢复和遮罩关闭；二级设置弹窗打开时不越级关闭。
- `conversation-aggregate/`：轨迹、话题、文件三个会话级子视图；`components/SlidingTabs.tsx` 统一承载 tab/radio 两类滑动分段控件，聚合 Tab 与响应模式不再维护两套选中底板。
- `channel-settings/`：设置场景壳、常规/成员/通知钻取页与永久删除确认；宽窄布局复用同一组件。`ArchivedChannelGroup.tsx` 单独负责默认收起的归档频道入口。
- `ModuleWorkspace.tsx`：现有业务视图薄适配。
- `SidebarModuleNavigation.tsx`：纯图标入口、激活态与 hover/focus tooltip；全局 `WorkspaceTopBar`、`WorkspaceContextRow` 和 `WorkspaceDock` 均已退役。
- `workspaceModules.tsx`：模块注册、路由和图标元数据。

复用 `Chat.tsx`、`LiveTrace.tsx`、`TaskBoard.tsx`、Inbox、Settings 与现有 agent 列表能力；Chat 不再内嵌 Tasks/Files Tab，文件筛选与话题索引也不继续堆入大文件。新切片新增职责单一的 `WorkspaceNavigationRail`，把 `ChatSidebar` 收敛为只含消息标题、共享会话分组和运行状态的消息中栏；它不是恢复已经删除的旧 `IconRail` 组件或旧双工作面状态机。产品模块已从 Members 收敛为 Agents（内部文件名 `Members.tsx` 暂留）；Computers 与旧 `Layout` 已删除。旧 `OverviewShell`、`SpaceShell`、`IconRail`、`RightDock` 和 `ChatSlot` 继续保持删除。

P-A8 的前端边界保持独立：`agent-response-mode/` feature 承担 Agent 默认卡片、模式模型和每频道一次装载/实时失效 hook；`chat-message/AgentMessageCard.tsx` 承担 Agent 身份内容及本频道覆盖控件，`HumanMessageCard.tsx` 只承担 Human 的最小身份内容，两者复用 `MessageIdentityCardFrame.tsx` 的锚定、焦点、外部点击和视口关闭机制。`Chat.tsx` 只保留卡片状态、频道模式数据、锚点、DM 导航与回调编排，卡片不读取 Router，也不直接发 API。消息内点击提及由 `chat-message/AgentMentionName.tsx` 负责表现和可访问交互，Composer 通过窄化的 `ComposerHandle.mentionAgent()` 接收插入请求，不由消息行查询或修改 DOM；插入文本与光标位置计算收口在 `composerMention.ts`。Composer 的多 Agent 任务校验收口在 `composerTaskMentions.ts`，频道全体 token 识别与候选匹配收口在 `composerChannelAllMention.ts`；`composer/ComposerActions.tsx`、`ComposerAttachments.tsx` 和 `useComposerExpansion.ts` 分别承担动作菜单、附件预览和宽度驱动的紧凑/展开判断，没有把交互状态继续堆进视图组件。

## 8. 初始化与 Settings 边界

- 首次启动页只收集 Human 名称、可选邮箱和描述，文案不得使用“注册”“账户”或“加入团队”。默认 Home 在用户可见的 `~/Kith-space/Home` 由应用创建，首次初始化不要求用户选择；普通 Space 之后从 Spaces 模块选择路径。
- 首次初始化只在检测到完整 Electron preload bridge 时运行，并先于 `StoreProvider`/Space bootstrap。若上次写入 Human 后中断，页面用 status 返回的 partial Human 预填恢复；重复提交保持幂等。初始化完成后挂载正常产品树并自动进入 `Home`；Human 资料在全局 Settings 以 `settings=human` 表达，并通过 `GET/PATCH /api/human/profile` 修改，不使用账户页或 `/api/auth/me`。
- 普通本机/LAN 浏览器从不探测 setup API，也不显示首次启动页；未授权时只显示 Access Token Gate，已授权后进入共享工作区。
- Desktop Settings 已包含 Web 模式、端口、访问 Token、撤销浏览器会话、托盘关闭行为和系统自启动；系统自启动在开发态明确显示 unsupported，在 Windows packaged Desktop 中启用。
- 设置现已新增“模型与供应商”和“运行器”。模型页采用单列“来源”总览，只展示已经添加的供应商、接口类型、目的地和模型摘要；添加与编辑复用同一个弹窗，并在弹窗内直接新增、改名或移除模型。一次保存要么供应商与全部模型一起成功，要么全部不变；空白模型行会就地提示，不会被静默忽略。Desktop与本机同源loopback浏览器提供完整表单；LAN浏览器可管理非敏感字段，但API Key输入禁用。改变已配密钥供应商的执行身份或API地址时必须重新输入Key。删除采用二次确认；被运行器、Agent或自动整理记忆引用的来源由服务端拒绝删除，弹窗必须指出具体占用位置（例如“OpenCode 的默认模型”“Space「Home」中的 Agent「研究助手」”或“自动整理记忆”），而不是只显示泛化的“正在使用”，更不能假装保存成功。CLI只读导入默认收起且只允许Desktop。运行器页继续使用宽屏左侧对象列表、右侧当前对象设置的主从布局，窄屏纵向折叠，分别呈现安装、版本、CLI账号和Agent默认模型，不再用单个`available`混淆；Desktop可以把锁版CLI安装为Kith-owned副本，Web对这些本机动作只读并给出Desktop恢复路径。Kith不写任何CLI全局配置，而在子进程启动时编译注入。Agent详情由独立模型绑定编辑器呈现`ready / confirmation_required / setup_required / restart_required`，disabled模型不会重新出现在选择器，未恢复`ready`前服务端拒绝启动。
- 导航和页面统一使用“自动整理记忆”。该页只保留启用状态、由谁整理、使用哪个模型、何时触发和测试当前设置；revision/epoch/digest、隔离细节和最近Provider Run改称“运行记录与故障排查”并默认收起。Advisor Model Profile降为内部不可变执行快照，不再让普通用户直接编辑。
- 普通浏览器可在 Human Settings 撤销当前浏览器授权；该动作调用 `DELETE /api/browser-auth/session` 并返回 Access Token Gate，不是 Human 账户 logout。
- Desktop 设置区只在检测到 `window.kithDesktop` 窄 preload bridge 时显示；普通浏览器直接进入该路由会回落到 Human 设置，并且服务端对管理 API 返回 404。隐藏入口不是唯一安全边界。
- LAN 模式首次开启会先展示确认面板，明确说明 HTTP 未加密、只限受信任私网、禁止端口转发/公网暴露；用户确认后才改变监听。自动生成/轮换的访问 Token 保持一次性显示，直到用户主动确认已保存。

一句话：**Chat 是基础工作面；左侧常驻侧栏把业务模块打开为右侧可关闭标签，Settings 以模态层打开。**

## 9. P-A10 Agent Harness v2 的分阶段 UI 增量

P-A10 不改变 WorkspaceFrame 的单窗口边界、中心 Chat 卡片或 Chat/Agents 信息架构：

- Human 在顶层频道明确 `@Agent` 后，root 消息下创建/复用话题，required reply placeholder 和持久 Agent 回复都归入该话题；父频道不显示引用式伪回复。`@all` 继续是频道广播，不自动建立高 fan-out 话题。
- 消息“展开步骤”从单一轨迹扩展为“上下文 / 步骤 / 用量 / 结果”：区分 turn 前自动注入、Agent 后续主动查询、因隐私只给 projection/ref 和因预算/故障省略的来源；步骤按 attempt 展示安全 thinking summary 与工具事件；结果显示逐 delivery obligation、operation/output、replied/ceded/failed/cancelled 和重试/lease。
- optional turn 的 `cede` 不产生 Chat 气泡；required turn 的 text delta 只更新 ephemeral placeholder，只有 Message Module 成功提交后才收敛成持久消息。失败/cancelled 必须结束 placeholder。
- Agents 详情“记忆”页形成“结构化记忆 / 文件记忆”两个一级视图。结构化记忆按 Active/Proposals/Archived、服务端搜索、kind/scope/source/tag/source-revoked/suppressed 过滤，并展示 canonical ID、revision、typed evidence、disclosure projection、correction relation、continuity bundle状态；常用动作是归档，破坏性动作分为删除item和forget+suppress。筛选菜单使用锚定按钮的实色顶层浮层，根据视口上下空间自动翻转并限制最大高度，窄 Agent 面板下也不得退化为横跨 Chat 或覆盖底部 Dock 的整宽面板。文件记忆继续读取当前 `agentMemoryDir`。
- 系统级Advisor当前已在“设置 → Memory Advisor”落地安装级控制页；Provider隔离、Pi SDK/Claude选择、逐Agent精确consent、目的地预检和Run审计继续以`../superpowers/specs/2026-07-22-system-memory-advisor-provider-design.md`为安全事实。2026-07-23 后续规格把模型与CLI导入迁出该页，改由“模型与供应商”提供共享配置，Advisor页只选择执行器和模型配置；Agent记忆页也从完整控制卡改为摘要条与管理抽屉。完整覆盖见`../superpowers/specs/2026-07-23-model-provider-runtime-memory-settings-design.md`。
- Pi 已作为第四个正式runtime进入P-A10 v2强路径，用户可见名为“Pi Agent（本机CLI）”，与“Pi SDK（内置记忆执行器）”严格分开；聊天执行使用本机外部Pi CLI RPC模式，按surface隔离session并接入durable turn、Context Envelope、Kith CLI Gateway、usage、cancel、snapshot和compaction telemetry；Pi没有内置MCP时显示CLI Gateway而不伪报MCP。
- Agents 开发诊断区可查看 per-surface session generation 的 cold/idle/running/evicted/resume_failed、runtime/config fingerprint、来源 delivery frontier、logical turn/attempt lease、snapshot、recall/advisor/compaction 状态；普通用户默认不展示内部 JSON。
- 频道设置继续使用公开/私有可见性，但提案建议把公开频道解释为“所有 Space Agent 可发现，加入后读写”，私有频道解释为“仅选择的 Agent 可发现/读取”；改变可见性时确认现有 membership，不自动批量增删 Agent。
- `silent` Agent 被 Human direct mention 时仍可加入话题但不出现回复 placeholder；在 OS sandbox 前，私有设置使用“产品内私有”准确文案，不承诺同一系统用户下的 runtime 进程无法访问或修改本机路径。
- MessageContextSnapshot 只保存产品对象引用与 revision，不采集 DOM、截图、剪贴板或未提交表单；它在 turn 的“上下文”中显示为独立来源。

P-A10.3已经让Human顶层direct mention的root直接带唯一话题，required持久回复只能进入该话题；Agent消息hover工具栏的工作轮次入口以“Context / Steps / Usage / Outcome”展示冻结manifest、source状态/HMAC tombstone、attempt event/normalized usage、逐input obligation与operation/output。MessageContextSnapshot只保存规范route和对象ref。P-A10.4新增runtime侧MCP/CLI Gateway、临时附件绑定、checklist/short wake和body-free manual inbox summary；P-A10.5新增workspace/app.db记忆后端、Human控制API、Context recall与Agent `memory.recall/get`；P-A10.6已把Agents详情“记忆”实现为Structured/Files双视图，支持active/proposals/archived、服务端过滤/分页、revision/evidence/relation/disclosure/source revoke、accept/reject、edit/correct、archive/restore、delete、forget+suppress、private/shared suppression及advisor freshness/validation/pause。来源撤权、不可用或删除的active item额外显示“确认保留为独立知识”，由Human创建manual revision并明确说明不会恢复旧频道权限。P-A10.7的snapshot/checklist revision/compaction状态进入同一诊断事实，unsupported provider不显示伪造summary。成功reply的附件继续复用既有Chat附件卡片，P-A10.2既有scoped activity/trajectory和ephemeral placeholder保持不变。完整机制、默认值和实施切片见 `../superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md`。
