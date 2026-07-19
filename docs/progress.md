# 开发进度与续接指南 - Kith-space

本文件是当前进度的权威来源。新会话先读本文件和 `AGENTS.md`，再按文档地图进入专项资料。

最后更新：2026-07-19。

- **P-A9.0-P-A9.7 已完整完成并提交，真实数据回归已修复**：Message/Task 深 Module、同库原子事务、Agent Transport 分组、领域依赖收口、Worker admission/session 容量、Chat data/model 组合层、基线可归因优化与兼容清理均已落地。P-A9 收口提交为 `d5261c1`；其后用现有本机数据复现并根治了常驻空闲会话占满容量造成的 admission 队列饥饿，同时修复 queued 手动启动误报“工作中”和失败 wake 不结束回复占位。Electron/Core/Worker 拓扑、TypeScript 主栈、公开 URL、Agent CLI、workspace schema 和现有 UI/交互保持不变；Runtime 契约 v2、H5、Rust 重写与 UI 重做未开始。
- **P-A10 Agent Harness v2 提案已完成对抗性补全，代码尚未开始**：基于 Helio 本机实测及两路独立只读审查，方案现包含 per-surface session generation、消息事务内 durable delivery、logical turn/attempt lease、operation/output/逐输入 obligation、Context Envelope、server-owned thread reply、session-bound capability broker、revisioned episodic memory、disclosure/suppression、continuity+中文 FTS recall、版本化 v6/v7/app.db 迁移、P-A10.0–P-A10.7 与独立 P-A11/P-A12/P-S1 边界。提案位于 `docs/superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md`；产品默认值已在第 27 节给出可实施建议但仍可由用户在编码前推翻。当前 schema v5、`agents.session_id`、单 Agent RuntimeSession、现有 Agent CLI 与 UI 均未改变。

## 一、现在在哪

- 主干：`main`。临时工作分支不作为阶段进度记录。
- 已完成：P0-P3 后端；P4 单窗口 ChatOnly / Split / ModuleOnly 生产壳；任务模块“全部任务/频道任务”范围侧栏。
- 当前阶段：**A1-A6、P-A7 H1-H4、P4/P-A8、本轮聊天/壳层 UI 与 P-A9.0-P-A9.7 均已完成；P-A9 已提交，真实数据下的 Runtime admission 回归也已完成修复和验证；P-A10 只有已补全提案、没有实现**。P-A9 事实见 `docs/superpowers/specs/2026-07-18-desktop-modular-monolith-architecture-design.md`，P-A10 目标态见 `docs/superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md`。
- **P-A9 最终模块事实**：`src/messages/messagePostingModule.ts` 与 `src/tasks/taskLifecycleModule.ts` 封装消息/任务写入和生命周期，同库事务原子提交 seq、消息、dispatch、follow、附件、membership、mentions、任务与 system audit；实时发布和 wake 作为明确 post-commit effect。`src/server/routes-agent.ts` 只分派 `src/server/agent-http/` 的七组 Transport Adapter；频道、Agent、文件与 task 领域不再依赖 server/desktop，依赖护栏没有 allowlist。`src/runtime/` 提供 generation-aware admission ack、持久 get-or-reserve 重放和容量 4/队列 128/TTL 120 秒的 Worker admission；AgentManager 按实际消息合并批次与既有 `online/error` activity 终态提供本地 idle hint，排队出现时由真正空闲且没有未完成批次的会话立即让出容量，不新增 Runtime v2 的跨边界 turn-complete 协议。queued 手动启动只有在实际 admitted 后才进入工作态，失败/cancelled/expired wake 会携带会话终态并关闭可见回复占位。旧 raw 生命周期命令被拒绝。`web/src/features/conversation/` 拥有 Chat 请求、消息/话题模型与视口语义，`Chat.tsx` 保持组合层和局部交互状态。P-A9.7 已删除旧 facade、旧 Implementation、兼容 ack 和临时 allowlist。
- **P-A9 性能事实**：最终 1/5/10/20 Agent Core 总 p95 为 3.489/9.632/14.661/50.481 ms，SQL 为 18/46/81/151，20 Agent 低于 120 ms SLO；Runtime admission 三轮中位数为 0.213/0.496/0.574/0.342 ms，均低于 25 ms SLO。P-A9.1b 统一事务让 20 Agent durable-prefix 相对 P-A9.0 增加但绝对值仍低于 10 ms，作为原子一致性权衡单独记录。Chat 首次可见 100/500/1000 档 median p95 为 62.8/65.2/62.4 ms，全量滚动为 70.6/311.5/621.9 ms，实时追加为 231 ms，均通过绝对 SLO 且对应 median p95 未相对冻结值退化超过 10%；没有虚拟化或视觉调整。完整统计、波动与口径见 `docs/performance/p-a9-baseline.md`，契约与删除证据见 `docs/architecture/p-a9-contract-matrices.md`。
- 聊天消息流已从全宽描边卡片迁入统一 `ChatMessageItem` 表现层，主会话、话题、action card 与加载 Skeleton 共用 32px 头像、紧凑发送者行和 Human/Agent 语义气泡；1040px 居中流宽、14.5px/1.55 正文、52px 标题、14px 顶部留白、88px Composer 预留和气泡内话题摘要已落地。普通链尾间距为 20px；同一天相邻且同发送者的 Human/Agent 普通消息隐藏重复头像/昵称并以 6px 组内间距连续展示，hover/focus 在头像槽显示时分，系统消息、action card、日期和发送者变化会打断分组。Human 消息昵称使用真实的 `14.5px / 700 / 20px`，Agent 昵称始终保持 500 字重、hover/focus 只转为深色；时间为 `11px / 400 / 16px`，二者按基线对齐且消息头无额外字距；侧栏 Agent 名称继续使用 600。发送者行状态文字移除并只保留头像状态点；Agent 私聊标题改为头像加昵称并移除 `@` 前缀，状态文字复用 Agents 页面中文映射。父消息话题摘要新增参与者头像、总数、最新时间、最近三条 Human/Agent 单行回复和“在话题中回复”，system 任务事件不进入预览行且正文与摘要之间无分隔线；主消息流中的 system 任务事件与内部 Markdown 已纳入 1040px 中心轨道并居中。摘要复用批量 thread metadata 接口并实时刷新变更父消息，不产生逐话题请求。主消息工具外显“加表情、话题、复制、更多”，收藏保留在更多菜单，工具栏只由气泡 hover/focus 触发并按右侧空间自动切换到气泡右侧或上方；隐藏状态初始置于气泡上方，消息流只允许纵向滚动，不再出现底部横向滚动条。归档频道隐藏写入口并保留复制和打开已有话题；Showcase 已由后续壳层切片完整退役。真实页面的 Split、ChatOnly、滚动场景和用户手动视觉验收均已完成。
- **Chat 壳层与侧栏模块导航已完成并通过本轮用户验收**：ChatOnly 在左侧常驻 Chat 导航栏顶部纵向展示“图标 + 文字”的 Spaces（Home only）、Inbox、Tasks、Agents、Settings，不显示 Chat、顶部“对话”总标题或底部 Dock；模块图标与“频道 / 私信”分组标题共用左侧基线。点击模块后固定侧栏隐藏，继续进入现有 Split/ModuleOnly，并在 Module Pane 底部显示含 Chat 图标的横向 Dock。Split 的会话抽屉复用 `ConversationListContent`，只组合已保存、频道、私信，不含模块入口与 `LiveAgentBar`，并保留抽屉自身标题。中心 Chat 保持原有圆角卡片、画布间隙与配色；常驻会话导航取消独立卡片底板并直接使用画布背景，新增模块入口与会话抽屉不绘制贯穿式横线或竖线。功能文字统一无衬线字体；Chat 标题栏固定左右 14px，与标题内容上下留白一致；ChatOnly 与 Split 使用同一 10px 消息 gutter，ChatOnly 主卡片沿用 360px Chat 绝对下限，日期分隔/消息/Composer 使用 1040px 居中共轨；消息流只允许纵向滚动，隐藏工具栏不会撑出横向滚动条。案例展示入口、产品路由、视图、演示数据/资产和专属分支均已删除。旧 `/showcase` 只保留 SPA fallback，由 `WorkspaceFrame` 规范化到当前 Space 默认频道并保留合法模块 query。完整规格见 `docs/superpowers/specs/2026-07-15-chat-shell-sidebar-module-navigation-design.md`。
- 最新轨道校准已把 Composer 的左边界对齐消息头像槽、右边界对齐消息内容列最大边界；消息滚动区使用 `stable both-edges`，Composer 随消息区保留 10px gutter，标题栏独立使用 14px 左右内距并与标题内容上下留白一致。两者分别保持自身视觉对称，并避免 `scrollbar-width: thin` 与 WebKit 尺寸不一致、滚动条出现/消失或重复预留造成水平偏移。
- Agent 卡片、Agent 默认响应模式与聚合面板已统一复用公共滑块式分段控件：轨道使用 `#f5f5f5`，白色滑块使用多层低透明阴影和 240ms 横移动画，并保留 tabs/radio 各自正确的键盘与读屏语义；Agent 卡片采用 38px 紧凑规格，“发消息”按钮使用 `#f7f7f7` 与 `#f0f0f0` hover。频道卡片仍只写当前频道覆盖，不改变 Agent 默认值。
- Agent 消息昵称已改为点击提及入口：默认使用 500 字重，hover 或键盘聚焦时显现前置 `@`、名称右移 14px 并转为深色，字重不变；点击主消息、action card 或话题消息昵称会把 Agent 规范 handle 插入对应 Composer 当前光标位置并恢复输入焦点。Human 昵称已移除点击和下划线，Human 头像点击打开只含头像与“昵称（我）”的身份卡片；Agent/Human 卡片复用同一锚定、焦点和关闭外壳。归档只读会话不暴露 Agent 写交互。该增量已通过类型检查、627/627 单测和 Web build（2626 modules）；未执行浏览器视觉自测。
- ChatOnly 会话导航的频道行已与私信行统一为 4px 相邻间距；hover 改用 `#ececeb`，选中态改用 `#ffffff`，且不引入分割线、边框或卡片阴影，以便在 `#f5f5f5` 画布上清楚区分状态并保持轻量层级。频道名前的文本 `#` 已替换为 14px 线性 Hash 图标；Chat 标题栏的会话列表开关选中态、聚合文件的未选中筛选项与搜索框、Spaces 搜索框统一使用 `#f5f5f5`，Spaces 搜索输入聚焦时不改变底色。该增量通过类型检查、637/637 单测和 Web build（2631 modules）；按用户约定未执行浏览器视觉自测。
- 消息正文中的 Agent/Human `@昵称` 已改为无底块蓝色身份链接，hover/focus 显示细下划线；点击复用消息头像对应的 Agent/Human 身份卡片并以 token 自身定位，不再跳转详情模块。频道、话题、任务引用与不可点击的 `@all` 行为不变。
- Composer 展开态已把附件和正文收口到距上/左边界统一的 10px 基线，附件移除圆钮缩至 16px 并保证 X 居中；非图片附件新增 MD/PDF/DOC/XLS/PPT/ZIP/代码/数据/音视频等类型化缩写图标。主 Chat 的消息底部预留改为由 `ResizeObserver` 跟随 Composer 实际高度并额外保留 12px 间距，原本贴底时会在输入框增高后继续贴底，不再遮挡最后一条消息。该增量已通过类型检查、628/628 单测和 Web build（2628 modules）；未执行浏览器视觉自测。
- 附件视觉验收增量已把类型图标改为无描边、无折页线的纯色底，并把附件卡片外圆角从 11px 提高到 13px、图标圆角提高到 10px。Composer、主消息与话题消息现复用同一个 `AttachmentCard`，附件按消息宽度自动换行且不溢出；聚合面板文件页同步复用相同文件类型图标。Composer 和消息图片统一进入共享查看器，支持按钮、滚轮和 `+`/`-`/`0` 快捷键缩放/复位、拖动、关闭按钮、`Escape` 与点击图片外区域关闭。查看器 100% 状态完整适配安全视口，放大后的图片使用全视口舞台，不再出现半透明内层卡片或被内层容器裁切。当前私聊/频道已加载消息会组成各自图片序列，话题以父消息加当前回复组成独立序列；可通过上一张/下一张按钮或左右方向键切换并显示当前位置，不跨会话；快速切换话题时会丢弃旧话题的过期加载结果。只有一个图片附件的消息使用保持原比例、最大 320px 的大预览，多附件继续使用紧凑布局。该增量通过类型检查、633/633 单测和 Web build（2631 modules）；按用户要求未执行浏览器视觉自测。
- 壳层切片验证：`pnpm run typecheck`、610/610 单测、完整 integration 与 Web build（2622 modules）通过；当时按用户要求未启动浏览器，视觉与真实三态交互随后已由用户完成本轮手动验收。
- 频道设置已进入聚合面板临时场景并提供常规/成员/通知钻取页；成员页显示真实 Human 名称与“你”标识，agent 使用搜索单选弹窗添加并在移除前二次确认。归档频道进入默认收起分组并全链路只读，支持恢复与精确名称确认后的永久删除。`# all` 的归档、删除、名称和可见性由 UI 与服务端双重保护，删除入口显式置灰解释限制，历史误归档/软删除会在 Space 数据库打开时自动恢复。
- 底座为 open-tag 衍生开发副本；`reference/` 只读。OpenLoaf 只作设计参考，禁止复制 AGPL 源码。

## 二、2026-07-11 路线转向

产品已正式收敛为 Desktop-first、单 Human、本机 agent 的个人 AgentOS：

- 一个安装实例只有一个 Human，可管理多个本地 Space。
- 所有 agent 只在本机唯一 Local Runtime Worker 上执行。
- Desktop 是唯一正式宿主和发行物；浏览器入口依附 Desktop，可关闭、仅本机或 LAN。
- LAN 浏览器拥有完整产品能力，v1 使用 HTTP + 访问 Token，只限受信任私网。
- 删除多真人、邀请/RBAC、Machines/Computers、远程 daemon、服务器部署、云同步、S3、Docker、PWA 和独立 Web 发行路线。
- 中央 registry 已扩展并更名为 `app.db`；每个 Space 继续使用 `<space>/.kith/workspace.db`。app data 默认 `~/.kith-space`，默认 Space 容器独立为 `~/Kith-space`，Home 默认根为 `~/Kith-space/Home`。
- 普通 Space 的业务模块集合为 `Inbox | Tasks | Agents | Settings`，Home 额外包含 `Spaces`；ChatOnly 通过左侧模块列表进入，模块打开态使用含 Chat 的 Dock。旧 `Layout` 回退、Landing 与 PWA 保持删除，Spaces 是同一 WorkspaceFrame 中的真实模块，不是旧 OverviewShell。
- 允许破坏性重置当前开发数据，不做旧 `.kith` schema 迁移。

本机化边界见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`；Home/Space root 补充见 `docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md`。决策推理见 `docs/decisions.md` 决策 21/23，工程顺序见 `docs/roadmap.md` P-A7。

## 三、已完成提交

| 提交 | 内容 |
|---|---|
| P-A7 H4 提交 | 普通冷启动进入稳定 Home、Home-only Spaces 模块、同窗切换与最近打开记录 |
| `556bcca` | Space 默认创建、已有目录接入、失联状态、重新定位与 Desktop 目录选择 |
| `70bd018` | Agent Space root cwd、Agent Memory 与 runtime state 三路径归位 |
| `d9d7488` | app data/默认 Space 容器分离与稳定 Home 身份 |
| 本阶段提交 | A6 继承部署/发布资产清理、Human Settings/API 收口、Windows production bundle/NSIS 安装器与总审计 |
| `1393970` | Desktop-only 首次 Human/Home 初始化、Landing/PWA/旧 Layout 清理、canonical 模块 query 与浏览器会话撤销语义 |
| `20ba921` | Electron 43.1.0 Desktop 宿主、进程监督、托盘生命周期、Desktop Settings 与内部凭据隔离 |
| `3cde80e` | 浏览器 off/local/lan 模式、访问 Token、持久 Cookie 会话、CSRF/Origin 与 Desktop 管理边界 |
| `274e6de` | 压平 19 表 Personal AgentOS workspace.db baseline、canonical Space transport/CLI/task 契约与 Human 状态表 |
| `c0d5a9c` | 收敛安装级唯一 Local Runtime Worker 与跨 Space agent 事件定位 |
| `b55de90` | 收敛唯一 Human authority/identity、agent-only 频道成员、Human-agent DM 与 Agents/Settings 产品表面 |
| `d6a0ad2` | 收敛 `/api/spaces`、`x-space-id`、Socket `spaceId` 与前端 Space 契约 |
| `365bc2a` | 建立 app.db、唯一 Human/Home、本地-only 附件存储，并移除 S3 SDK |
| `d7cafc4` | 固化个人 AgentOS 本机化规格，重写 vision/decisions/roadmap/架构/MVP/迁移与相关 UI 文档 |
| `ec6b735` | 恢复 Tasks 全部/频道范围侧栏；更新 CodeGraph 与相关进度资料 |
| `0a8eb89` | P4-3 单窗口工作区生产壳、25/75 响应式分栏和路由状态机 |
| `7cc026e` | 单窗口原型、交互规格、面板视觉语言与 Context Snapshot 契约 |
| P3 提交 | 任务事务、并发保护、状态图、report/delivery 和 `src/server/tasks/` 模块化 |
| P2 提交 | 三层记忆、角色模板和记忆结构约定 |
| P1 提交 | 分派深度、唤醒预算、急停和 plan-first 软闸 |
| P0 提交 | SQLite、每 Space workspace.db、中央 registry、改名与许可证基线 |

Runtime 对接调研已完成，位于 `docs/kith-space/notes/_runtime-research/`。这些文档中的多设备参考只作技术背景，不代表新产品路线。

## 四、当前代码事实与过渡债

- **H1 已完成**：`src/paths.ts` 已把 `KITH_SPACE_HOME` 收窄为 app data 覆盖，并新增独立 `KITH_SPACE_SPACES_DIR` 开发/测试覆盖；全新安装的默认 Space 容器为 `~/Kith-space`，Home 为 `~/Kith-space/Home`。`app.db` 的 `installation_state.home_space_id` 保存稳定 Home 身份，旧开发库只在首次升级时由既有 `slug=home` 回填且不会自动搬动其已有 rootPath；Home 不能取消注册，并发首次初始化会原子复用同一个 Home。
- H1 验证：`pnpm run typecheck`、478/478 单测与完整集成测试通过；单路轻量独立复核未发现代码阻塞，指出的规格状态/切片测试口径已修正。
- **H2 已完成**：中立领域模块 `src/agents/agentWorkspacePaths.ts` 统一解析 `workspaceRoot = Space root`、`agentMemoryDir = <space>/.kith/agents/<agentId>` 和 `runtimeStateDir = <appData>/runtime/<spaceId>/<agentId>`，并拒绝可逃逸容器的 Space/Agent ID。Claude Code、Codex、opencode 以真实 Space root 为 cwd；Claude prompt、Hermes turn 文件等 adapter 临时产物写入 runtime state。OpenCode 通过 child-only `OPENCODE_CONFIG_CONTENT` 注入固定内部 execution agent，不写或覆盖用户 `AGENTS.md`，同 Space 多 agent 的 prompt 也保持进程隔离。项目 skills 继续使用 Core 从 registry 解析的 Space root；profile 同步、reset 与 Agents 详情的“记忆”文件浏览器使用同一三路径契约，其中记忆浏览器只读取当前 `agentMemoryDir`。普通 reset 只清 session/runtime state，完整 reset 额外清当前 Agent Memory，两者都不删除共享 Space 文件；同 agent 的 reset/start 在 Worker 中串行，避免 Reset & Restart 的清理竞态。Copilot/Kimi/Cursor 仍是 experimental adapter，因为其实现会在 cwd 写 `AGENTS.md`，暂时使用 runtimeStateDir，避免覆盖用户项目文件。
- H2 验证：`pnpm run typecheck`、486/486 单测、完整集成测试和 Web build 通过；三路径/容器逃逸、三家主要 runtime cwd、OpenCode prompt 隔离、Agent Memory/profile、文件树/skills 和 reset 串行/安全边界均有回归测试。一次轻量只读复核发现的 OpenCode 文件覆盖、Reset & Restart 竞态和删除路径逃逸均已修复。
- **H3 已完成**：`src/spaces/spaceRootService.ts` 集中规范化和校验宿主绝对路径；支持默认位置新建、普通文件夹接入、兼容 `.kith/workspace.db` 的稳定 Space ID 复用，以及文件夹移动后的 relocate。重复规范 root/Space ID、损坏或不兼容数据库、`.kith`/workspace.db symlink 和身份不匹配都会被拒绝且不会自动删除；未显式指定的冲突 slug 会生成本机唯一别名。`src/db/spaceDatabaseCompatibility.ts` 让接入探测与正式打开共用 SQLite `quick_check`、版本及全产品表/列校验。Space 列表返回 `ready | missing | error` 与可操作错误；注册后的普通 `dbForSpace` 访问不再隐式重建缺失 root 或数据库；relocate 打开失败会回滚 app.db registry。
- H3 的 Desktop preload 窄桥调用 Electron 原生目录选择器；授权浏览器通过 Core 的受限主机目录浏览器选择宿主路径，不使用浏览器本机文件选择器冒充宿主路径，也不读取文件内容。失联深链会转到可用 Space，全部 Space 失联时由独立恢复页保持 relocate 可达。H4 后 `SpaceSwitcher` 收敛为快速切换、失联重连和进入 Home Spaces 的入口；默认创建与已有文件夹接入统一位于 Home Spaces 模块，并使用紧凑模态弹窗。
- H3 验证：`pnpm run typecheck`、497/497 单测、完整集成测试、Web build（2569 modules）和 Desktop build 通过；创建/接入/稳定 ID/slug 冲突/重复 root/损坏与不兼容数据库/symlink/失联深链与全失联恢复/无隐式重建/relocate 回滚，以及 Desktop bridge 与浏览器主机路径 UI 均有回归覆盖。
- H3 测试遗留透明记录：一次已修正的子代理测试隔离失误在 `C:\Users\Administrator\.kith-space\workspace-baseline-test\<随机 UUID>` 下留下 3 个未登记目录；registry 记录已移除，当前未枚举也未删除这些目录。只有用户明确授权后才能单独清理，后续任务不得把该路径当作产品数据或擅自递归操作。
- **H4 已完成**：`GET /api/spaces` 以 app.db 的稳定 `homeSpaceId` 返回 `isHome`，`POST /api/spaces/:id/open` 只为可用 Space 更新 `lastOpenedAt`；普通冷启动优先进入 ready Home，显式 ready Space 深链接仍优先。Home Dock 注册 `spaces`，模块展示真实 registry 中除 Home 外的普通 Space，支持通用搜索、刷新、默认创建、已有文件夹接入、失联重连和同窗进入；卡片显示名称、宿主路径、状态与最近打开时间，并提供打开、Desktop 文件管理器定位、复制路径、重命名、本地收藏排序和只注销 registry 的移除菜单。普通 Space 隐藏 Spaces Dock，并会移除无效 `module=spaces` query；ChatOnly 左侧列表顶部的 SpaceSwitcher 保留快速切换和应急重连，通过“管理空间”同窗跳转 Home Spaces。未加入 H5 的跨 Space Inbox/Tasks/dispatch 或伪摘要。
- H4 验证：`pnpm run typecheck`、502/502 单测、完整集成测试、Web build（2571 modules）和 Desktop build 通过；针对 Home 选择/显式深链、Home/普通 Dock、URL 规范化、registry Home 标记、ready-only 最近打开、创建/重连与 Spaces 页面契约均有覆盖。单轮轻量复核发现并补齐刷新操作，之后未发现其余 High/Medium 问题。当时未启动本地产品服务做 H4 交互 smoke；用户已于 2026-07-18 完成本轮实际 UI 验收。
- 数据层是 SQLite：中央 `app.db` 保存唯一 Human 与 `spaces` registry；每 Space 使用 `<rootPath>/.kith/workspace.db`。canonical 连接入口为 `dbForSpace(spaceId)` / `listSpaces()`；`dbFor`、`listWorkspaces`、`registerWorkspace` 等 workspace facade 已删除。
- `src/app-data/appDatabase.ts` 是 app.db 事实源：除唯一 Human/Space registry 外，A3 增加单例 `browser_access_settings` 与 `browser_sessions`。REST、附件读取和 Socket 的 Human authority 只来自 Desktop 私有信任或已验证的浏览器 Cookie 会话，不再查询 `server_members`，也不存在 Human JWT/Bearer/dev-login。`src/human/humanIdentity.ts` 继续提供稳定 `@you` handle 与 app.db 展示名。
- A2.2b 已把 workspace.db 压成单一 19 表 baseline：`spaces/space_id` 是唯一领域命名；`users/server_members/machines/join_links` 与 `agents.machine_id` 已删除。`channel_agent_members` 只表达 agent membership；唯一 Human 的 read/DM/thread、收藏与 Space 偏好分别落在 `human_channel_states`、`human_saved_messages`、`human_space_preferences`。持久 actor discriminator 使用 `human`，runtime 协议自身的 `role: "user"` 不受影响。
- A2.4 已建立 `src/local-runtime/workerHub.ts` 安装级唯一 Worker 控制面：同一时刻只认一个连接，新连接以专用关闭码替换旧连接，旧进程停止自动重连，generation lease 阻止 stale ready/event/disconnect/catch-up 覆盖当前状态；ready snapshot 报告 runtimes/runningAgents 等运行信息，不再携带 Machine 身份。Worker 入口只连接 `127.0.0.1:$PORT`，不再接受远程 `--server-url`。`src/local-runtime/agentLocator.ts` 与 Worker reconnect/reconcile 会遍历本机 Space registry，让状态、轨迹、session、回复和补唤醒正确回到 agent 所属 Space。
- Machine/Computer 活跃路径和物理 schema 均已删除：没有 Machines API、machine 注册/密钥/心跳/调度、agent machine 选择、Computers Dock/路由、`machines` 表或 `agents.machine_id`。不能据此恢复 Machine 产品概念。
- canonical 契约为 `/api/spaces`、`x-space-id`、Socket `spaceId` 与 `SpaceCtx`；旧 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 和 DB workspace facade 已删除。Agent CLI 使用 `space info` 与 `space:read`。
- 附件存储已删除 S3 driver/SDK/config，只走本地磁盘并校验平面 storage key。`src/files/localObjectStorage.ts` 以 `spaceId` 查询 app.db registry 后固定读写 `<spaceRoot>/.kith/uploads`；公开下载使用附件记录的 Space，agent plane 使用认证 Space，调用方不能传入任意根路径。P-A9.7 已删除旧 `src/server/storage.ts` facade；旧 `KITH_SPACE_UPLOAD_DIR` 配置与两份不兼容的一次性维护脚本也已移除。
- A2.4 验证：`pnpm run typecheck` 通过，`pnpm run web:build` 通过（2563 modules），`pnpm test --integration` 全量通过；`pnpm test --unit` 361 项中 360 项通过，唯一失败仍是既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。Worker 单例/替换与 stale generation、产品 API 不再接受 Machine、跨 Space 路由和旧 Computers 路由降级均有契约或行为测试覆盖。
- A2.2b 验证：`pnpm run typecheck` 通过，`pnpm run web:build` 通过（2563 modules），`pnpm test --integration` 全量通过；`pnpm test --unit` 364 项中 363 项通过，唯一失败仍是既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。fresh baseline、legacy schema 拒绝、canonical Space transport、唯一 Human channel state 与 agent-only membership 均有行为或契约测试覆盖。
- A2 最终验收：`pnpm run typecheck` 通过，`pnpm run web:build` 通过（2563 modules），`pnpm test --integration` 全量通过；`pnpm test --unit` 367 项中 366 项通过，唯一失败仍是同一个既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。Space 隔离附件、未知 Space/路径穿越拒绝、旧 app 级上传配置不生效、Worker loopback-only 与旧 `serverId` 发送参数消失均有回归覆盖。
- A3 最终验收：`pnpm run typecheck` 通过，`pnpm run web:build` 通过（2559 modules），`pnpm test --integration` 全量通过；`pnpm test --unit` 391 项中 390 项通过，唯一失败仍是同一个既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。Web 三模式、Token/会话轮换、Cookie/CSRF/Origin/限速、Desktop 管理不可从浏览器达到、Worker 私有 header 握手、前端 Token Gate 与旧 JWT/URL token 退役均有行为或契约覆盖。
- A4 最终验收：`pnpm run typecheck`、`pnpm run desktop:build`、`pnpm run web:build`（2561 modules）和 `pnpm test --integration` 全量通过；`pnpm test --unit` 426 项中 425 项通过，唯一失败仍是既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。使用隔离 `KITH_SPACE_HOME` 的实际 Desktop smoke 已验证 Core ready 后才启动 Worker/Vite，Electron 成功加载共享 UI，退出后测试端口无残留监听。
- A5 首次初始化由 `src/personal-setup/personalSetupService.ts` 和 `/api/setup/status`、`/api/setup/initialize` 提供。setup 路由只接受 loopback 上的 Desktop 私有信任，普通浏览器、Worker、错误凭据和远程来源统一不可达；初始化只接受 Human 名称、可选邮箱与描述，幂等创建唯一 Human 与 `Home`，已有资料不会被覆盖，部分 Human 状态可恢复到表单。
- 前端 `DesktopSetupBoundary` 位于正式 Store 外层，只有 Electron preload bridge 会探测 setup；普通浏览器不会探测该 API，仍从 Access Token Gate/已有授权会话进入。初始化成功后才新挂载 ProductRoot/StoreProvider，因此不需要刷新或 seed 就能进入 `Home`。
- A5 已删除 Landing、Features、PWA/公开营销元数据、SSR/prerender、旧 `Layout`、`?legacy=1` 与登录/注册/邀请 locale/CSS 残留。静态产品入口只保留根路径和 canonical `/s/:slug` 工作区路径，WorkspaceSkeleton 已与当前卡片面板、顶部工具区和五项 Dock 对齐。
- 模块 URL 统一为当前频道、DM 或收藏 pathname 上的 query：`module` 选择 Inbox/Tasks/Agents/Settings，资源参数分别使用 `taskScope`、`agent`/`agentTab` 与 `settings`。切换模块会删除不属于新模块的资源参数，切换会话则保留 active module 及其合法 resource；UI 不再生成 `/tasks`、`/agent`、`/settings` 等旧模块 pathname。
- 浏览器当前授权撤销使用 `DELETE /api/browser-auth/session`；前端状态和文案统一为 `clearBrowserAccess`/“撤销访问”，不再借用账户 logout 语义。Desktop Settings 可继续全量撤销浏览器会话，普通浏览器只可撤销自身授权且看不到 Desktop Settings。
- A5 最终验收：`pnpm run typecheck`、`pnpm run desktop:build`、`pnpm run web:build`（2564 modules）和 `pnpm test --integration` 全量通过；`pnpm test --unit` 439/439 全绿。旧 public landing 与 `publicNavContract` 测试随取消的产品路线删除，因此 A2-A4 记录中的单一既有失败只属于历史检查点，当前不再存在。
- A5 浏览器 smoke 验证 canonical 会话导航：从 `/s/home/channel?module=tasks&taskScope=space` 切到 `/s/home/saved?module=tasks&taskScope=space` 后，右侧 Tasks 模块及 Space 范围资源保持不变。
- A5 fresh Desktop smoke 使用全新隔离 `KITH_SPACE_HOME` 且未执行 seed：`pnpm run desktop:dev` 完成构建并启动 Core `127.0.0.1:7777`（browserMode off）、Vite `127.0.0.1:5273`、唯一 Worker（connected/ready，`runtimes=[]`）和 Electron；渲染器连续两次请求 `/api/setup/status` 均返回 200。退出后同一目录的 setup 状态仍为 `{initialized:false}`，证明首次初始化页被真实探测且未被 seed 绕过；定时 smoke 结束后 5273/7777 均无监听残留。PowerShell wrapper 未提供 ExitCode，因此验收不声称 ExitCode 0。
- A6 已删除 Dockerfile/compose/entrypoint、Railway、`.env` 样例、prod 脚本、公共 daemon package 与构建脚本、npm/OIDC 发布 workflow、docs-site workflow/路由/脚本；pnpm workspace 现在只有根目录和 `web/`。仓库仍保留 `server`、`daemon`、`web`、`browser-access:dev`、`dev:e2e:up` 等分进程开发入口以及代码对可选本地 `.env` 的加载，这些仅用于源码调试，不构成正式 Web/server/daemon 发行路线。
- Human 资料的唯一活跃接口是 `GET/PATCH /api/human/profile`，Settings 的规范 resource 是 `settings=human`；旧 `/api/auth/me` 显式返回 404，前端不再生成 `settings=account`。A6 同时退役了旧 `initialHumans` 产品入口/契约；测试 fixture 中同名字面量不构成产品能力。
- Windows 发行链固定使用 Electron 43.1.0、electron-builder 26.15.3 与 `@electron/rebuild` 4.2.0：`desktop:build` 只生成 Electron main/preload；`desktop:bundle` 构建 `web/dist`、Core CJS、Worker/agent CLI ESM；`desktop:pack` 生成 `dist/desktop/win-unpacked`；`desktop:dist` 生成 x64、per-user、assisted NSIS 安装器。`package.json` 固定 `npmRebuild=false`，`scripts/package-desktop.mjs` 在打包前对 pnpm store 中的 `better-sqlite3` 执行显式、强制的 Electron x64 rebuild，打包完成或失败后都在 `finally` 恢复本地 Node ABI。最终核对为本地 Node ABI 137、packaged Electron ABI 148。
- 打包态 Desktop 使用 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 启动内置 Core/Worker，并通过 `KITH_SPACE_WEB_DIST` 与 `KITH_SPACE_MIGRATIONS_DIR` 指向 `resources` 中的 Web 和 Drizzle 资产；agent CLI 同样内置为 ESM bundle。Windows 手动 workflow 只上传保留 14 天的未签名 installer artifact，不创建 Release，也不自动发布。
- A6 最终验证：`pnpm run typecheck` 通过；`pnpm test --unit` 449/449；`pnpm test --integration` 全绿；`pnpm run web:build` 通过（2564 modules）；`desktop:bundle`、`desktop:pack`、`desktop:dist` 均成功；`pnpm audit --prod --audit-level=high` 报告无已知高危生产依赖漏洞。
- 最终 unpacked Desktop fresh smoke 以全新隔离数据目录运行并 Exit 0：Core/Worker ready，内置 Web/Drizzle/setup status 可用，`app.db` 成功创建，`kith-space.cmd --help` 可运行；退出后残留受管进程为 0，7777/5273 监听为 0。另一次 packaged Core 真实初始化创建唯一 Human 与 `Home`；当时生成的 workspace.db 为 19 张产品表 + `__drizzle_migrations` 共 20 张物理表、`PRAGMA user_version=2`，并完成优雅退出；当前连接时会依次升级为 schema v5。
- 最终安装器为 `D:/Projects/multi-agent/dist/desktop/Kith-space-Setup-0.1.0-x64.exe`，大小 113625983 bytes，SHA-256 `D314DAE15A8E9AB598901D2E3DF8B90DE1C7B46E79824CC8575BD4C742B89646`，Authenticode 状态 `NotSigned`。这是可复现的本地/CI 未签名安装器，不代表已签名或已发布；公开分发前仍需 Windows 代码签名证书，且本阶段没有实际执行 NSIS 安装/卸载流程。
- P4 壳位于 `web/src/shell/`。URL 以频道/DM 路径、`?module=<id>` 和 `chat=0` 表达三态；Split 默认 Chat 25%。
- **会话聚合面板切片已实现**：旧“会话 / Chat / 轨迹”顶栏与固定全 Space 轨迹栏已移除；频道/DM 标题右侧提供纯图标任务、成员/Agent 资料与聚合面板入口。聚合面板作为 Chat 与 Module 的同级面板，在 ChatOnly 位于 Chat 右侧、Split 位于 Chat 与 Module 之间，ModuleOnly 和空间不足时暂时收起并保留打开意图；会话列表和聚合面板都按边界横向改宽，不保留收起长条，也不做淡入淡出。任务入口使用 `module=tasks&taskScope=<conversationId>`，重复点击保持幂等；聚合面板的轨迹/话题/文件使用通用 `SlidingTabs` 滑块组件，话题正文继续在既有 `ThreadPanel` 位置打开，中文 UI 统一称“话题”而内部 `thread` 代号不变。文件页支持全部/图片/视频/文件分类、文件名或来源消息搜索与无黑框的浅色焦点反馈。
- **轨迹会话隔离已实现**：Worker 将目标解析为 `scoped | unscoped | ambiguous`，Core 把 thread channel 归一到父频道/DM 后再向 Socket 广播；无明确单一会话归属的轨迹不进入任何会话聚合面板。前端按 `conversationId` 保存各自最多 300 条实时缓冲，并在切换 Space 时清空。新增 `/api/channels/:channelId/thread-summaries` 提供当前会话全量话题摘要；`/files` 补充来源消息文本，继续复用当前 Space、会话与成员权限边界。
- 聚合面板切片验证：`pnpm run typecheck`、549/549 单测、完整集成测试和 Web build（2588 modules）通过；真实浏览器 smoke 已覆盖 ChatOnly/Split/ModuleOnly、任务会话作用域、话题外置打开、文件分类/来源消息搜索及其跨 Tab 状态保留、成员入口、会话列表/聚合面板横向动画、1024px 响应式隐藏与状态恢复，控制台无 warning/error。按用户约定只执行了一次完整只读 review；发现的失败投递作用域残留、Worker 消息异步乱序、文件筛选卸载重置和空话题不实时刷新四项问题均已由主线修复并补针对性验证，未再发起第二轮 review。
- **频道设置与归档切片已实现并完成本轮用户验收**：设置不是第四个聚合 Tab，而是保留原聚合内容挂载状态的临时场景；ChatOnly/Split 优先占用聚合面板，空间不足时复用同一组件进入 Chat 右侧抽屉。常规页、agent 成员页与三档通知偏好已落地；通知值持久化在 `human_channel_states.notification_level`，该切片当时把 workspace.db 升级为 schema v4，当前 P-A8 之后为 v5。会话列表分别加载活跃/归档频道，默认收起归档分组；归档详情保留历史读取并禁用 Human/agent 消息、话题、附件、reaction、action card、成员与任务写入。恢复保留当前频道，永久删除要求精确输入名称；`# all` 由集中 helper、API 冲突错误和数据库打开时的幂等修复共同保护。后续 UI 验收修正已补真实 Human 名称、“你”标识、添加 agent 弹窗、移除二次确认、`# all` 置灰删除解释，以及 Space 卡片项目菜单和通用搜索框。该切片验证时 `pnpm run typecheck`、562/562 单测、完整集成测试、Web build（2605 modules）与 Desktop build 通过；真实浏览器覆盖频道成员弹窗/确认、必需频道禁用动作、Space 搜索焦点、卡片菜单和重命名弹窗，控制台无 warning/error。按用户约定未对当轮 UI 修正派发子代理 review；用户已于 2026-07-18 完成本轮验收。
- **P-A8 Agent 频道响应模式已实现**：workspace.db 升级为 schema v5，当前 Space 的 Agent 默认值加顶层频道 membership 可空覆盖，三档为 `active | mention_only | silent`；独立 ambient/mention wake watermark 保证模式重新开放时不补唤醒旧事件，也不推进 read cursor。实时 wake、Worker reconnect、`/agent-api/message/check` 和 prompt 共用 `required | optional | observe` 响应指令；DM 与明确任务指派始终 required，话题继承父频道。Human“指派任务 + 单一 @Agent”会形成真实 assignee，无 `@` 保持未指派，多个 Agent mention 在持久化与 membership 变化前拒绝。前端独立 `agent-response-mode/` feature 保留 Agent 默认卡片和每频道一次装载/窄实时失效；消息昵称后的模式徽标与 hover 菜单已退役，点击 Agent 消息头像改为打开 `chat-message/AgentMessageCard`。卡片只提供“发消息”和“本频道响应模式”：三段式选择仅写当前频道覆盖，可恢复跟随 Agent 默认，但不能在此修改当前 Space 的 Agent 默认值。话题复用父频道设置，归档只读，DM 卡片不显示频道模式。完整规格见 `docs/superpowers/specs/2026-07-14-agent-channel-response-mode-design.md`。
- **频道全体提及已实现**：Human 在可写频道或其话题发送语言无关的规范 token `@all` 时，服务端按父频道当时全部 Agent membership 固化接收者快照，同时保存一个 `channel_all` 展示标记和普通 Agent mention 行；主动/被动目标按明确 mention 得到 required 投递，静音目标不自动唤醒。话题会以当前消息可处理的边界补齐快照 Agent membership，后续新增成员不追溯旧消息。Agent-authored、DM、Showcase 与归档场景不展开；“指派任务 + @all”在任何消息、membership 或任务副作用前拒绝。Composer 候选标签通过 i18n 显示“所有人 / Everyone”并插入 `@all`，消息正文不展开名单。
- **Composer 输入框重设计已实现**：照片与文件上传合并为左下角圆形“+”菜单中的“添加照片和文件”，“指派任务”也迁入该菜单；启用任务后在“+”右侧显示可 hover/聚焦切换为 × 的胶囊，并与正文共享同一行，不自行触发增高。图片缩略图和文件卡片位于输入框内部；短单行草稿保持 `48px` 胶囊，只有任务胶囊与文字的实际合计占位接近右侧安全区、换行或附件存在时才展开。左侧“+”与右侧上箭头发送按钮都固定为 `32×32` 圆形，hover/菜单打开态不改变轮廓。
  “+”菜单通过 portal 与整个输入框左边界、宽度对齐，窄视口才按左右 `8px` 安全边距收缩；外框使用 `16px` 圆角，菜单项固定为 `30px` 高和 `10px` 圆角，长文案保持单行省略，仅保留浅色边框，不显示阴影。菜单每次打开默认高亮首个可用项，随后保留鼠标或键盘最后经过的项；任务项不再使用常驻选中底色和勾号，而以淡色“开启指派任务 / 关闭指派任务”说明当前点击动作。`@` 候选菜单同步复用输入框宽度、`16px` 圆角、无阴影表面、`30px` 候选行和同一浅色高亮，名称、handle、范围说明与类型保持单行截断。
  展开态只增加上方内容空间，下方控制区继续使用紧凑态的左右 `10px`、底部 `8px` 内距与 `24px` 底角，按钮不会随高度切换改变位置。
- Composer 重设计验证：`pnpm run typecheck`、`pnpm test --unit` 599/599、完整 `pnpm test --integration` 与 Web build（2616 modules）通过。真实应用内浏览器已验证空/短草稿保持 `48px`，任务胶囊与正文共享宽度且单独启用不增高，同一中等草稿在有任务胶囊时展开、移除后收紧；展开态控制区保持左右 `10px`、底部 `8px` 与 `24px` 底角；“+”/发送按钮均为 `32×32`，菜单宽度与输入框完全相等、菜单项实际 `30px`、无阴影。任务 hover 使用 `14px` SVG X 圆标；“+”菜单打开时默认高亮首项、离开菜单后保留末次经过项，任务项以“开启/关闭指派任务”说明代替勾选态；`@` 候选菜单与输入框同宽，采用 `16px` 圆角、无阴影和 `30px` 单行候选项，指针与键盘选择均正常。最终草稿、任务状态和菜单均已清空，控制台无 warning/error。
- **全局命令搜索与 Agent 删除语义已实现**：顶部栏搜索入口退役；Chat 导航侧栏在模块列表上方新增搜索入口，并与 `Ctrl/Command + K` 共用一个按推荐、频道、私信、Agent 及三类消息结果分组的紧凑圆角命令面板。消息搜索复用当前 Space/Human 可读边界，频道消息定位原消息，话题消息定位并高亮具体回复，私信消息定位原私聊。第一阶段结果展示已把消息行改为独立双行结构：首行使用可读的频道、私信对象或话题父消息摘要与回复数，并补充来源和相对时间；次行显示发送者与正文上下文，对查询词做蓝色强调，不再暴露 `dm:*` / `thread:*` 内部标识。删除 Agent 会在同一 workspace 事务内物理删除所有包含它的私聊、直接话题、消息、关联状态和本地附件元数据，再清理本地附件对象；公共频道/话题历史保留发送者快照并实时在消息及话题预览标记“已删除”，删除对象不再进入私信列表、Inbox、Agent 列表或命令面板。该增量已通过类型检查、640/640 单测、完整集成测试和 Web build（2635 modules）；按用户约定未执行浏览器视觉自测。
- P-A8 验证：频道全体提及及话题回复预览修正完成后，`pnpm test --unit` 592/592、完整 `pnpm test --integration`、`pnpm run typecheck` 与 Web build（2613 modules）通过。自动化覆盖规范 token/跨层一致性、接收者去重快照、主动/被动/静音投递、话题 membership、Agent-authored/DM 非展开、频道与 DM 任务无副作用拒绝、正文 token 渲染、同名 Agent 冲突优先级，以及 Agent 在触发消息的话题正式回复后移除父频道临时预览、空话题创建不提前清理、其他 Agent/父消息不误删和迟到 runtime 尾部文本不复活预览。真实应用内浏览器已覆盖“所有人 `@all`”候选及范围说明、任务模式隐藏和页面无 warning/error，测试草稿已清空；后续真实群体消息验证发现并复现了话题回复后的父频道幽灵预览，现已按非空 `thread:updated` 的 `parentMessageId + senderId` 精确修正。此前默认值、频道覆盖、恢复继承、双窗口实时同步和多 Agent 任务拦截也已验证，最终响应模式菜单由用户实测通过。本次按约定只执行一次 Standards + Spec 子代理 review：发现的空话题事件过早清理、DM 手工 `@all` 任务放行和架构行号失真均已修复，未发起第二轮 review。组件挂载级响应模式菜单钻取、键盘和焦点自动化仍是透明测试债。
- 产品登录/注册、成员/RBAC/邀请 API、Web Human roster、Human-Human DM、Machines API 和 Computers UI 已删除；Dock/模块使用 Agents，频道成员只增删 agent，Human 资料入口位于 Settings。A3 进一步删除了 Human JWT、dev-login、`?as=`、localStorage/Bearer 会话和附件/Socket URL token；A5 删除 Landing、旧 Layout/PWA 与剩余账户入口，A6 删除 Docker、公共 server/daemon/npm/docs-site 发布与远程部署资产。未授权浏览器只看到 Access Token Gate。
- Core Service 启动时从 app.db 读取 Web 模式：off（默认）与 local 均绑定 `127.0.0.1`，lan 绑定 `0.0.0.0`。off 只留 Desktop/Worker 私有传输，普通浏览器壳被拒绝；LAN 只允许匹配 Host 的 Origin。`/health` 只对 loopback/Desktop 可见并暴露 `workerConnected`。
- 访问 Token 可自定义 16-256 字符，留空自动生成 32 字节；app.db 只存 scrypt 哈希和 revision。原始 browser session token 只进 HttpOnly、SameSite=Strict Cookie，DB 只存 SHA-256 哈希；写请求同时校验 Origin 和 CSRF。Token 轮换或 Desktop 全量撤销会使旧会话失效。
- `src/desktop/processSupervisor.ts` 先启动 Core，并等待其通过 IPC 报告 app.db 中的实际端口；收到 ready 后才启动唯一 Worker 和可选 Vite。Core 报端口占用、ready 超时或任一关键子进程异常时会给出明确诊断并收掉进程组；显式退出按 Vite、Worker、Core 顺序停止，Worker 等待全部 runtime 报告退出，超时后使用 Windows process tree 或 Unix process group 强制收尾。终止失败会保留句柄和托盘重试入口，不会假装退出成功。
- Desktop 每次启动或重启进程组都会轮换独立的 Desktop/Worker 32 字节凭据。Core 仅同时持有两者，Worker 只持有 Worker 凭据，Vite 子进程环境不包含两者；`KITH_SPACE_DESKTOP_MANAGED=1` 阻止受管子进程从 `.env` 回灌凭据。agent runtime 环境会大小写无关剥离全部宿主 `KITH_SPACE_*`/IPC/端口变量，只重加当前 agent 的 server URL、id 和 token。渲染器 JavaScript 不接触 Desktop 私有凭据，Electron session 只在允许的 loopback Core/API/socket 请求上附加信任 header，并排除 `/api/desktop/*` 管理路径。
- `src/desktop/main.ts` 使用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 的 BrowserWindow，拒绝新窗口、外部导航、webview 与全部权限请求；`src/desktop/preload.ts` 只暴露读取/修改 Desktop Settings 和撤销浏览器会话的窄桥，IPC 同时校验发送者。
- app.db 现保存 `desktop_settings` 单例（关闭到托盘/关闭即退出、系统自启动）以及既有浏览器访问设置。Desktop Settings 管理 off/local/lan、端口、访问 Token、会话撤销和生命周期；进入 LAN 前先确认明文 HTTP 风险，自动生成的 Token 保持显示到用户主动确认已保存。普通浏览器没有 preload bridge，Desktop 管理 HTTP 路由继续统一返回 404。Windows 打包态使用 Electron 系统自启动接口，开发态明确显示 unsupported。
- `pnpm run desktop:dev` 是完整开发宿主入口；fresh Desktop 不再要求 seed，首次窗口通过 Desktop-only setup 完成 Human/Home 初始化。`desktop:build`、`desktop:bundle`、`desktop:pack`、`desktop:dist` 分别承担开发构建、生产 bundle、unpacked 包和 NSIS 安装器。`seed`、`server`、`daemon`、`web`、`browser-access:dev` 与 `dev:e2e:up` 继续保留给 fixture 或分进程调试，手动模式仍需独立环境凭据。
- A1-A6 验收期修复了 Windows runtime 启动链：旧 `detectRuntimes` 使用 Unix 专用 `command -v`，导致已安装 Claude/Codex/opencode 时 Worker 仍上报空列表，Core 因 `runtime unavailable` 拒绝 agent start；Codex/opencode 的 npm shim 还会被原生 `child_process.spawn` 以 `EPERM`/`ENOENT` 拒绝。`src/daemon/runtimeProcess.ts` 现在以直接依赖 `cross-spawn` 统一探测和启动全部 adapter。真实机器反馈环检测到 `claude/codex/kimi/opencode`，Codex shim 启动 Exit 0；typecheck、451/451 单测、全量集成和 `desktop:bundle` 均通过。隔离数据目录的 `desktop:dev` smoke 同样由 Worker/Core 上报这四个 runtime 并 Exit 0，退出后 Electron 残留与 7777/5273 监听均为 0。
- OpenCode 模型发现也已接入统一进程边界：本机 `opencode models` 与 Worker 探测现在一致返回 17 个真实 `provider/model`，创建 Agent 不再回退到 `Default`。Core 新增完整 runtime availability，已安装项前置，未安装项保留展示但禁用；OpenCode 改用官方 `--auto` 并强制显式模型，模型列表去重且失败可直接重试，JSON provider error 与进程退出不会再形成第二条空白错误，旧版 error+exit 0 也不会被覆盖为 online。针对性 18/18、全量单测 463/463、全量集成、typecheck、Web build 与 `desktop:bundle` 已通过；浏览器渲染交互验收因当前页面要求 Access Token 未执行，未读取或代填用户 Token。
- Windows agent 命令/编码链已按宿主收口：`ensureKithSpaceBin` 在 Windows 开发态与打包态只保留可执行 `kith-space.cmd` 并清理会触发“选择打开方式”的旧 POSIX 文件，Linux/macOS 继续生成可执行 `#!/bin/sh` wrapper；system prompt 在 Windows 明确 `.cmd` 与 UTF-8 `$OutputEncoding`，优先给出 PowerShell 写法但允许 runtime 明确提供的 POSIX shell，在 Linux/macOS 使用 POSIX sh/heredoc。`spawnRuntimeProcess` 对全部 runtime stdout/stderr 启用有状态 UTF-8 解码，CLI 的 message/thread/action stdin 也经独立 `readUtf8Stdin` 模块解码。真实 Windows PowerShell 5.1 探针从默认 `????` 恢复为 UTF-8 字节，生成的 `.cmd` 也已从 Git Bash smoke 成功执行；针对性 26/26、typecheck、全量单测 470/470、全量集成、Web build（2566 modules）与 `desktop:bundle` 均通过。
- Agent 首轮生命周期已拆成三种显式场景：`create` 只向 `dm:@you` 做一次简短自我介绍，`manual` 启动/恢复在空收件箱时静默，`wake` 处理真实持久化投递并在每个原目标回复。Core 会把创建、消息/任务和 reconnect backlog 的原因传给唯一 Worker；启动准备期的投递被合并为单个 wake turn。候选 introduction turn 使用一次性 token，只有 Worker 实际选择 introduction prompt 才注入进程，CLI 也只在 `message send --introduction` 时附带；普通 wake 回复不携带 token。真实 wake 会撤销 active token 并拒绝迟到问候，completed token 的重复问候同样拒绝。Human DM 在异步校验后、事务前同步消费，因此被忽略的重复 start 和普通回复都不会误记为介绍。介绍消息与 `agents.introduced_at` 原子提交，普通重启保留，清 Agent Memory 的完整 reset 会清除介绍状态；schema v3 会安全升级 v2 并将已有 agent 回填为已介绍。定向 TDD、typecheck、476/476 全量单测、全量集成和 Web build 均通过。
- LAN 浏览器具有完整产品能力，v1 仅支持桌面浏览器和 HTTP；只限受信任私网，禁止端口转发或公网暴露。
- Message Context Snapshot 已纳入 P-A10 Context Envelope 提案，仍未持久化。
- token 预算目前以唤醒次数为代理；P-A10 提案要求由 Runtime Contract v2 的 normalized usage 结算，但尚未实现。
- 外接 runtime 仍使用高权限模式。邮箱/浏览器等不可信内容模块上线前必须补 HTTPS 与审批/沙箱权限升级。

## 五、下一步顺序

1. P-A9 与本次 Runtime admission 真实数据回归修复完成后停止本阶段；不自动推送、不合并、不发布，也不做仓库外数据清理。
2. P-A10 已完成对抗性补全；获得代码实现授权后只能从 P-A10.0 的 compatibility/app.db migration前置、契约冻结和真实adapter/中文recall基线开始，不直接跳到自动记忆或UI。用户若要推翻第27节默认值，先同步ADR/验收。H5、Rust试验、生产力模块和P-S1安全升级继续按各自前置关系推进。

## 六、验证与工作约定

- 包管理使用 pnpm；脚本参数直接跟在后面，例如 `pnpm test --unit`。
- 常规验证：`pnpm run typecheck`、`pnpm test --unit`、`pnpm test --integration`、`pnpm --dir web run build`。
- 测试 runner 同时把 `KITH_SPACE_HOME` 与 `KITH_SPACE_SPACES_DIR` 指向同一个随机临时 profile 的不同子目录；手写测试若绕过 runner，必须显式覆盖默认 Space 容器或直接传 rootPath，绝不在真实 `~/Kith-space` 生成 fixture。
- 当前全量 unit 为 689/689；typecheck、完整 integration、Web build（2641 modules）、Desktop build、无 allowlist 依赖护栏、契约矩阵、Core/Runtime/UI SLO 与最新 `desktop:pack` 均通过。全新仓库内隔离 profile 的 unpacked Desktop smoke Exit 0、创建 app.db、Core ready，退出后受管进程和 5273/7777 监听均为 0。真实授权 Browser 除既有频道/话题、历史和性能回归外，还用现有 Home 数据验证休眠 Codex 在约 11 秒内唤醒并出现实时轨迹、约 21 秒内回复，随后无残留“正在思考”，页面控制台无错误或警告。旧 `publicNavContract` 随 public landing 路线一起删除，不再接受把它列为可忽略失败。A2-A6、H1-H4 与聚合面板/频道设置小节里的旧数字只描述当时检查点，不是当前基线。
- 新功能优先拆到职责清楚的模块；不整块重写 `src/server/core.ts` 或大型 React 组件。
- 代码、命令、架构、UI、术语或阶段变化时，同一提交同步相应文档。
- 用户未要求时不修改或提交 `.agents/`、`.claude/`、`.codegraph/daemon.pid`、`skills-lock.json` 等外部/个人工具文件。

## 七、文档地图

- `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`：本次转向完整规格。
- `docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md`：Home 总控 Space、路径/cwd/记忆和跨 Space 委派补充规格。
- `docs/superpowers/specs/2026-07-14-chat-aggregate-panel-design.md`：会话聚合面板、话题/文件索引、会话任务入口与轨迹作用域规格。
- `docs/superpowers/specs/2026-07-14-channel-settings-and-archive-design.md`：频道设置钻取场景、归档分组、删除语义、通知偏好与 `# all` 必需频道保护规格。
- `docs/superpowers/specs/2026-07-14-agent-channel-response-mode-design.md`：Agent 默认/频道覆盖、唤醒矩阵、任务指派、Runtime 指令与响应模式 UI 规格。
- `docs/superpowers/specs/2026-07-15-chat-message-ui-density-design.md`：聊天消息流密度、气泡层级、消息工具、表现层组件边界、实施切片与量化验收规格；代码、自动化验证与用户手动视觉验收均已完成。
- `docs/superpowers/specs/2026-07-18-desktop-modular-monolith-architecture-design.md`：P-A9 进程拓扑、深 Module、窄 Interface、实施切片、性能/Rust 决策门与验收规格。
- `docs/vision.md`：长期北极星与永久边界。
- `docs/decisions.md`：锁定决策、推理和被推翻路线。
- `docs/roadmap.md`：阶段与后续能力顺序。
- `docs/kith-space/product-brief.md`：产品定位。
- `docs/kith-space/mvp-spec.md`：v1 验收。
- `docs/kith-space/architecture-proposal.md`：目标模块与信任边界。
- `docs/kith-space/ui-direction.md`：单窗口 UI 与 Desktop/Web 设置边界。
- `docs/kith-space/migration-plan.md`：A1-A6 工程实施顺序。
- `docs/dev-commands.md`：日常启动、测试与打包命令；`docs/dev-debugging.md`：低频环境、Web、数据库与 E2E 调试。
- `docs/glossary.md`：术语正典。
