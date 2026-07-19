# Kith-space 产品路线图

> 路线基线：2026-07-11 个人 AgentOS 本机化转向，2026-07-12 补充 Home/Space root 设计；2026-07-14 锁定 Agent 频道响应模式；2026-07-15 锁定 ChatOnly 侧栏模块导航与模块打开态 Dock；2026-07-18 完成 P-A9 桌面模块化单体架构收敛；2026-07-19 P-A10 Agent Harness v2 开始实施，P-A10.0–P-A10.5 已完成，P-A10.6–P-A10.7 按依赖顺序推进。完整边界见对应 `docs/superpowers/specs/` 规格，当前工程状态见 `docs/progress.md`。

## 1. 产品终点与永久边界

Kith-space 的终点是桌面优先、单人使用的个人 AgentOS：一个 Human 和本机 agent 在多个本地 Space 中协作。正式产品只有 Desktop 安装包；浏览器入口依附 Desktop 生命周期，可选择关闭、仅本机或受信任局域网访问。

以下方向已经取消，不再作为“以后再做”：

- 多真人、邀请、团队账号、Human membership 和 RBAC。
- 多 agent 主机、远程 daemon、机器加入和跨电脑运行。
- 公网部署、SaaS、云同步、云数据库和独立 Web 发行。
- 移动 Web、PWA、push、Docker 部署和公共 server/daemon 包。

当前必须补齐的本机地基是 Home 总控 Space、用户可见 Space root、文件夹接入、Space root cwd 和 Agent Memory 可移植性。长期路线还包括跨 Space 聚合/委派成熟化、邮箱、日历、画布、记忆增强、编排成熟化、HTTPS 与 runtime 权限升级、macOS/Linux 发行。

## 2. 已完成基础

- P0：SQLite 与每 Space `<root>/.kith/workspace.db`，中央 registry。
- P1：派发深度、唤醒预算与急停护栏。
- P2：三层记忆与通用角色模板。
- P3：任务领域与 HTTP 接口。
- P4：单窗口 ChatOnly / Split / ModuleOnly 工作区、可拖拽面板、模块切换与任务范围侧栏；ChatOnly 使用侧栏模块入口，模块打开态使用 Module Pane 底部 Dock。
- Runtime 调研：Claude Code、Codex、opencode 适配边界与 Runtime 契约 v2 草案。

聊天消息流密度与交互重构、Chat 壳层与侧栏模块导航均已按对应 2026-07-15 规格完成代码、自动化验证与用户手动视觉验收。当前已落地 ChatOnly 纵向模块入口、Split 三组会话抽屉、模块打开态 Dock、中心 Chat 卡片保护、直接使用画布背景且无直线分隔的常驻会话导航，以及案例展示退役；全局 `Ctrl/Command + K` 消息搜索的第一阶段展示优化也已完成，以双行结果提供可读会话、发送者、相对时间、查询词高亮及话题父消息摘要/回复数，不再显示内部 DM/thread 名称。A1-A6、P-A7 H1-H4、P-A8 与 P-A9 均已完成；下一阶段候选已收敛为 P-A10 Agent Harness v2，获得实现授权后从 P-A10.0 的 migration 前置、契约冻结和真实 adapter/中文 recall 基线开始。

## 3. 当前路线：个人 AgentOS 本机化

### P-A1 权威文档收敛

把 vision、decisions、roadmap、产品规格、架构、UI、术语、进度和命令口径统一到本机个人 AgentOS。历史研究可保留，但必须标注其多用户/多设备内容不代表产品路线。

验收：核心文档不再把多真人、多机器、公网或云端描述为未来目标；新增本机化权威规格；后续阶段与删除范围明确。

### P-A2 本地领域与数据模型

状态：原定切片与 P-A7 H1-H4 已完成，并通过 2026-07-18 本轮用户验收。中央 `app.db`、唯一 Human、默认 `Home`、canonical Space 契约、唯一 Local Runtime Worker、19 表 workspace.db baseline 与 Space 级附件目录已落地；H1-H4 已补齐稳定 homeSpaceId、用户可见 Home root、Space root cwd、可移植 Agent Memory、文件夹创建/接入/重连契约，以及 Home-only Spaces 目录。

- 把中央 registry 扩展并更名为 `app.db`。
- 实现唯一 Human 和首次资料初始化；自动创建 `Home` Space。
- 已把产品领域中的 `server/serverId` 收敛为 `space/spaceId`，保留 `/s/:slug` URL。
- 保留 Space 内 agent membership，删除 Human membership、邀请、RBAC 和 Human-Human DM。
- 已删除 Machine/Computer、远程 daemon 注册和多主机调度；内部 daemon 已收敛为安装级唯一 Local Runtime Worker，并跨本机 Space 路由 agent 事件。
- workspace.db 已重建为单一 19 表 baseline：使用 `spaces/space_id`，删除 `users/server_members/machines/join_links` 与 `agents.machine_id`，分离 agent membership、唯一 Human 会话状态/收藏/Space 偏好，并把持久 actor 统一为 `human`。
- 已删除 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 和 DB workspace facade；Agent CLI 使用 `space info` 与 `space:read`。
- 删除 S3/对象存储，附件只走所属 Space 的 `<spaceRoot>/.kith/uploads`；根路径只能由 app.db registry 解析。

允许破坏性重置当前开发数据，不做旧 `.kith` 数据迁移。

验收：全新目录可初始化一个 Human、`Home` 和多个文件夹 Space；无需登录、邀请、机器注册、Postgres、Redis 或对象存储。

### P-A3 浏览器访问安全边界

状态：已完成。

- Web 模式已落地为关闭（默认）/仅本机/局域网；仅本机绑定 `127.0.0.1`，LAN 绑定 `0.0.0.0`。关闭模式保留 Desktop/Worker 的私有 loopback 传输，但不提供普通浏览器壳。
- 访问 Token 可设 16-256 字符，留空自动生成 32 字节高强度值；app.db 只存 scrypt 哈希与 revision。
- 验证成功后建立持久 HttpOnly、SameSite=Strict Cookie 会话，写请求同时校验 Origin 与 CSRF；可撤销当前浏览器授权会话或由 Desktop 全量撤销，Token 轮换使全部旧会话失效。这是访问授权语义，不恢复账户登录/退出概念。
- Desktop 信任、Worker 控制面和浏览器 Token 凭据已分离；Desktop 每次启动/重启进程组都会生成新的两份独立内部凭据，分进程调试才由环境注入。
- Human JWT、dev-login、`?as=`、Bearer 和 URL token 传递已从活跃路径删除。
- LAN v1 只做 HTTP 且拥有完整产品能力；只限受信任私网，禁止端口转发或公网暴露。

验收：未授权浏览器不能读取或操作数据；Token 不进入 URL、日志或明文数据库；Web 模式和会话撤销可验证。

### P-A4 Electron Desktop 宿主

状态：已完成。

- Electron 43.1.0 与 `pnpm run desktop:dev` 已落地；Desktop 统一启动 Core Service、唯一 Local Runtime Worker、开发期 Vite 和 Electron。
- Core 从 app.db 取得权威端口并先启动，ready IPC 后才启动 Worker/Vite；端口冲突、ready 超时和子进程异常都有明确诊断与整组清理。
- 每次进程组启动/重启轮换独立 Desktop/Worker 临时凭据，受管环境阻止 `.env` 回灌；渲染器 JavaScript 不持有私有凭据，Vite 子进程环境不包含私有凭据，agent runtime 只获得当前 agent 的能力。
- BrowserWindow 使用 sandbox/contextIsolation、关闭 Node 集成、拒绝权限/外部导航/新窗口；preload 只暴露经发送者校验的 Settings 窄桥。
- 默认关闭窗口进入托盘；显式退出等待 runtime 后停止 Windows process tree/Unix process group，失败时保留句柄供重试；可改为关闭即退出。Windows 打包态预留默认关闭的系统自启动，开发态显示 unsupported。
- Desktop Settings 管理 Web 模式、端口、Token 轮换、浏览器会话撤销、关闭行为和自启动；LAN 变更前确认 HTTP 风险，一次性 Token 保持显示到主动确认；普通浏览器无管理入口。

验收：Desktop 构建、监督器/安全/IPC/Settings 测试与隔离数据目录的实际 smoke 已通过；一次命令可启动完整 Windows 开发宿主，Desktop 管理进程不依赖用户内部凭据 `.env`。`desktop:build` 只负责 main/preload；A6 已在此基础上补齐生产 bundle、unpacked 包和 NSIS 安装器。

### P-A5 UI 与入口清理

状态：已完成。

- Desktop 首次启动通过仅 Desktop 私有信任可达的 setup API 收集 Human 名称、可选邮箱和描述，幂等初始化唯一 Human 与 `Home`；普通浏览器不会探测或调用该入口。全新 Desktop 目录不再要求 seed。
- 普通 Space 模块集合固定为 `Inbox | Tasks | Agents | Settings`，Home 额外包含 `Spaces`。ChatOnly 使用不含 Chat 的左侧纵向入口；模块打开态 Dock 保留 Chat 作为布局控制。
- `Members` 改为当前 Space 的 `Agents`；Human 资料进入全局 Settings；`Computers` 已在 A2.4 提前删除。
- 已删除 landing、登录、注册、邀请、PWA 和 `?legacy=1`/旧 `Layout`，静态路由只提供产品壳与 canonical Space 路径。
- 模块统一挂在当前 Chat/收藏等会话 pathname 上，以 `?module=<id>` 和模块专属 resource query 表达；切换频道、DM 或收藏时保留当前模块及其合法 resource，不再生成 `/tasks`、`/agent`、`/settings` 等旧模块 pathname。
- 浏览器的会话动作统一为“撤销访问授权”：`DELETE /api/browser-auth/session` 清除当前持久 Cookie 会话，不表达账户 logout。
- 延续 A4 的宿主能力边界：Desktop 显示 Web/Token/端口/托盘/自启动设置，普通浏览器无该入口且不能调用管理 API。

验收：全量单测 439/439、类型检查、集成测试、Web/Desktop 构建通过；已删除失效的 public landing 契约测试，当前不再有旧 `publicNavContract` 基线失败。隔离目录的浏览器 smoke 验证 Token Gate、canonical 模块 query 与会话导航保留；未 seed 的 fresh Desktop smoke 验证首次初始化探测、完整进程组启动和无端口残留。所有入口都服务一个 Human 与本机 agent；浏览器和 Desktop 复用工作区 UI，但权限边界不同。

### P-A6 继承资产清理与总审计

状态：已完成。

- 已删除 Dockerfile、compose、entrypoint、Railway、环境样例和 prod 脚本。
- 已删除公共 daemon package、npm/OIDC 发布 workflow 与 docs-site 发布路线；pnpm workspace 只保留根目录和 `web/`。
- Human 资料只走 `/api/human/profile`，Settings 使用 `settings=human`；旧 `/api/auth/me`、`settings=account` 与 `initialHumans` 产品入口已退役。
- 保留仓库内部 `server`、`daemon`、`web`、`browser-access:dev`、`dev:e2e:up` 和可选本地 `.env`，仅用于分进程源码调试。
- Electron 43.1.0 + electron-builder 26.15.3 + `@electron/rebuild` 4.2.0 已形成四层发行链：main/preload 开发构建、Web + Core/Worker/agent CLI 生产 bundle、Windows unpacked 包、x64 per-user assisted NSIS 安装器。构建关闭 electron-builder 自动 npm rebuild，包装器显式强制生成 Electron x64 的 `better-sqlite3`，再在 `finally` 中恢复 Node ABI；最终核对为 Node ABI 137、Electron ABI 148。
- Windows workflow 仅支持手动触发并上传未签名 installer artifact，不自动创建 Release 或发布。

验收：Windows Desktop 是唯一正式发行路径，仓库没有仍可启用的旧产品路线。typecheck、449/449 unit、完整 integration、2564-module Web build、production bundle/pack/dist、生产依赖高危审计与 packaged Desktop/Core fresh smoke 全部通过；最终 unpacked smoke Exit 0、`app.db` 创建、残留进程 0、端口监听 0。安装器 `Kith-space-Setup-0.1.0-x64.exe` 为 113625983 bytes，SHA-256 `D314DAE15A8E9AB598901D2E3DF8B90DE1C7B46E79824CC8575BD4C742B89646`，Authenticode `NotSigned`；它是可复现的本地/CI 未签名产物，不是已签名或已发布版本，公开分发前仍需代码签名，且尚未执行真实 NSIS 安装/卸载验收。

### P-A7 Home 总控 Space 与 Space root 归位

状态：设计与 H1-H4 代码切片已完成，并通过 2026-07-18 本轮用户验收；H5 和 Runtime 契约 v2 都未开始。

- H1 路径地基（已完成）：分离 `~/.kith-space` app data 与 `~/Kith-space` 默认 Space 容器；建立稳定 homeSpaceId 和 `~/Kith-space/Home`，并以 `KITH_SPACE_SPACES_DIR` 隔离开发/测试 Space 容器。
- H2 runtime cwd/记忆（已完成）：Claude Code、Codex、opencode 以 Space root 为 cwd；Agent Memory 移到 `<space>/.kith/agents/<agentId>`；adapter 临时状态移到 app data runtime 目录；文件树、skills、profile 与 reset 同步采用带防逃逸校验的三路径契约，同 agent reset/start 串行且 reset 不删除共享 Space 文件。OpenCode prompt 通过 child-only inline config 隔离，不覆盖用户 `AGENTS.md`；Copilot/Kimi/Cursor 仍标 experimental，并暂用 runtime state cwd 避免其 `AGENTS.md` 注入覆盖用户文件。
- H3 文件夹接入（已完成）：Desktop 原生目录选择器；授权浏览器通过 Core 受限浏览主机目录；默认位置新建、普通文件夹接入、兼容 workspace.db 稳定 ID 复用和移动后重新定位；重复 root/Space ID、损坏/不兼容数据库、symlink 与身份不匹配拒绝，冲突 slug 自动取本机唯一别名。接入与正式打开共用 SQLite 完整性/版本/产品表列校验。失联 Space 以 `ready | missing | error` 显示，普通 API 不会隐式重建缺失 root，relocate 失败回滚 registry；失联深链与全失联恢复不会卡在 skeleton。
- H4 Home UI（已完成）：普通冷启动进入稳定 Home Chat，显式 ready 深链接仍优先；Home 模块集合增加真实 registry 驱动的 Spaces 卡片模块，支持搜索、刷新、默认创建、已有文件夹接入、失联重连和同窗进入，并记录 ready Space 的最近打开时间。普通 Space 不显示该模块且会移除无效 query；SpaceSwitcher 收敛为快速切换、应急重连与 Home Spaces 入口，不恢复 OverviewShell。
- H5 跨 Space 编排：后续先做真实只读摘要，再做受审计、幂等且不冒充 Human 的 task/message/agent dispatch。

H1-H4 验收：代码验证已通过 typecheck、502/502 unit、完整 integration、2571-module Web build 与 Desktop build；用户已完成 Home/普通 Dock、Spaces 卡片、文件夹操作与同窗切换的本轮验收。agent 相对业务文件写入所属 Space root；复制 Space 带走 workspace.db、Space/Agent Memory、附件和用户文件；Home Spaces 只使用真实 registry，普通 Space 不出现该模块；测试隔离不会污染真实 `~/Kith-space`。

完整规格：`docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md`。

### P-A8 Agent 频道响应模式

状态：设计与代码切片均已完成，并通过 2026-07-18 本轮用户验收。该切片是 P4 频道协作体验的增量能力，没有启动 H5，也没有提前展开完整 Runtime 契约 v2。

- 每个 Agent 在当前 Space 保存 `active | mention_only | silent` 默认值；每个顶层频道 membership 保存可空覆盖，有效值为“频道覆盖 ?? Agent 默认”。
- Human 普通频道消息只环境唤醒主动成员且允许 Agent 判断后静默；被动成员只在明确 `@` 或已参与话题收到 Human 跟进时唤醒；静音成员不因频道事件自动唤醒。
- Human-Agent DM 与明确任务指派始终直达目标 Agent。话题继承父频道，不增加独立设置层；Agent 普通消息不环境唤醒其他 Agent。
- “指派任务 + 单一 `@Agent`”必须形成真实 assignee；无 `@` 创建未指派频道任务，多个 Agent mention 因单 assignee 模型而拒绝。
- Human 在频道或话题使用语言无关的规范 token `@all` 时，服务端快照父频道当前全部 Agent：主动/被动成员按明确 mention 必回，静音成员不自动唤醒；Agent-authored、DM 与任务模式不展开该 token；候选标签通过 i18n 显示“所有人 / Everyone”。
- 服务端以纯策略模块和设置模块统一实时 wake、reconnect、message check 与 prompt 指令；前端以独立 feature 组件提供 Agent 默认卡片，并在消息头像点击卡片中提供只作用于当前频道的模式选择，不把逻辑继续堆入 `core.ts`、`Chat.tsx` 或 `Members.tsx`。

实现与验证：schema v5、统一响应策略/设置模块、实时投递/reconnect/message check/prompt 指令、单一 mention 任务 assignee、Human `@all` 接收者快照、Agent 默认卡片和消息头像 Agent 卡片内的频道覆盖控件均已落地；三档矩阵覆盖顶层频道、话题、DM、任务、全体提及和 Worker 重连。频道卡片只修改当前频道覆盖并可恢复继承，Agent 默认值仍由 Agent 页面管理。模式切换以独立 watermark 保证不追溯唤醒且不伪造已读；真实浏览器已验证默认值、频道覆盖、恢复继承、双窗口实时同步、多 Agent 任务拦截，以及“所有人 `@all`”候选/任务模式隐藏。完整规格：`docs/superpowers/specs/2026-07-14-agent-channel-response-mode-design.md`。

### P-A9 Desktop 监督的模块化单体架构收敛

状态：P-A9.0–P-A9.7 的实现、文档、全量门禁、性能回归、packaged/browser smoke 与约定的一次独立只读终审已完成并提交；真实存量数据暴露的 Runtime admission 队列饥饿和错误状态传播也已修复，不再扩张 P-A9 范围。

- 保留 Electron Desktop Supervisor、Core Service、唯一 Local Runtime Worker、React UI 与外部 runtime 的进程拓扑；Core/Worker 都是 Desktop 内部边界，不恢复服务器部署或远程 daemon。
- 保留 TypeScript / Node / Electron / React / SQLite 主技术栈，不做 Rust 全量重写。Rust 只在性能基线与 profiler 证明单一稳定 CPU 热点后，才可作为窄 Adapter 单独评估。
- 以高内聚低耦合、单一职责、开放封闭、KISS、DRY、迪米特法则、依赖倒置和分层架构为约束，依次收敛 Message/Task、Agent 数据面、频道/文件、Runtime 与 Chat 控制层。
- `src/server/` 已收窄为组合根和 Transport Adapter；业务 Module 不反向依赖 server/desktop，Human、Agent CLI 与未来 MCP 复用同一用例 Interface。P-A9.3 已把 Agent 删除与本地对象存储迁入领域目录，P-A9.7 已删除旧 facade 和依赖护栏的临时 allowlist 机制。
- P-A9.0 已冻结全部消息写入调用方、31 个 Agent 端点、当前 Worker socket-send/reconnect 与 Chat 特征矩阵，建立 1/5/10/20 Agent Core 基线、100/500/1000 消息 UI 基线与各自绝对 SLO，并产出 16 项 P-A9.4 admission/replay 目标契约清单。P-A9.6 的 20-Agent SQL 已从 260 降到 151，绝对 SLO 通过。当前 socket-send 只作诊断指标；P-A9.0 的 total 仍止于 socket enqueue，而当前 total 口径已经等到 admission ack，RuntimeSession 容量/背压与持久 get-or-reserve 也已落地。冻结数据见 `docs/performance/p-a9-baseline.md`，矩阵见 `docs/architecture/p-a9-contract-matrices.md`。
- Message/Task 通过 `WakeDispatchPort` 隔离唤醒副作用；Core 的 dispatch guard 按逻辑键持久 `get-or-reserve`，Core→Worker 的 `RuntimeWorkerPort` 使用稳定 deliveryId 和 `admitted | queued | rejected` ack，Worker admission 容量为 `capacity=4`、`queue=128`、`ttl=120s`。wake 复用 reservationId，手动与生命周期命令使用独立 commandId；Core 只在接纳后 commit wake，断线按同一逻辑键重放而不重复消耗 wake budget，`lastReadSeq` 关闭未读重放窗口。
- 全阶段不改现有产品行为、公开 URL、Agent CLI 或 `/daemon/connect` 路径；默认不改 schema，若现有表无法保证重放幂等则停下并单独设计迁移。每个切片独立验证、独立回滚。

完整规格：`docs/superpowers/specs/2026-07-18-desktop-modular-monolith-architecture-design.md`。

## 4. 架构收敛后的能力路线

### 4.1 Runtime 契约 v2

该能力已纳入 P-A10 Agent Harness v2 提案：

- 以 `(spaceId, agentId, surfaceKind, surfaceId)` 建立 per-surface resumable session；
- 统一 Claude Code、Codex、opencode 的 turn lifecycle、usage、取消、completion、tool/compaction event 和 MCP bootstrap，但保留各 engine 内层语义；
- 建立消息事务内 durable delivery、logical turn/attempt/operation/output ledger、来源 delivery frontier、server-owned reply target 和逐输入 reply/cede/fail finalize gate；
- P-A10.0–P-A10.5 已完成；继续实施 P-A10.6 restricted advisor与结构化记忆管理/recall/debug UI，不提前混入P-A10.7或P-A11。

完整提案：`docs/superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md`。

### 4.2 生产力模块

按任务、日历、画布、邮箱顺序扩展 MCP 模块。画布强调 Chat 与可视对象联动；邮箱和浏览器类能力必须等待 HTTPS 与 runtime 权限升级。

### 4.3 记忆与上下文

P-A10.3已实现Context Envelope、MessageContextSnapshot、server-owned direct-mention thread、实时父级ACL与turn inspector；P-A10.4已实现同域MCP/CLI Gateway、later-query refresh、权威conversation/turn查询、按activation原子绑定且可过期/崩溃清扫的临时附件、session checklist、short wake和manual inbox summary；P-A10.5已实现canonical+immutable revision结构化episodic memory、Human CAS生命周期、disclosure grant/suppression、source ACL、continuity+中文FTS recall、Agent `memory.recall/get`与Context注入。P-A10.6–P-A10.7继续实现restricted advisor、Human manage/recall/debug面板、snapshot与compaction telemetry。现有 User/Space/Agent 三层 `MEMORY.md + notes/` 继续保留，结构化记忆是带 typed evidence/relation 的附加层，不替代文件记忆。受限 consolidation、skill reconciliation 和 runtime security/approval/Vault 分别后置为 P-A11、P-A12、P-S1，不再捆成一个 P-A10.8。

### 4.4 本机跨 Space 聚合

以 Home Spaces 目录和 SpaceDirectoryService 为地基，在真实 `scope = current | all` 数据契约上提供跨 Space Inbox、Tasks、Calendar 和信息流。聚合遍历本机 Space 数据库，不引入云端或多用户语义。

### 4.5 编排成熟化

实现 Home agent 受审计的跨 Space task/message/agent dispatch，并完善 leader 拆解、依赖图、预算、计划审批、暂停/恢复、恢复策略与交付汇总。继续坚持 harness 优先，不把开发或其他具体场景写成硬流程。

### 4.6 平台扩展

Windows v1 稳定后支持 macOS 和 Linux。系统托盘、自启动、文件选择和进程管理优先使用跨平台 Electron/Node API。

## 5. 贯穿各阶段的原则

- harness 优先、角色通用、不做场景专用硬流程。
- 不自研 runtime，模块经 MCP 暴露。
- local-first、Desktop-first、一个 Human、一台本机。
- Desktop 监督的模块化单体；深 Module、小 Interface、必要 Seam，性能优化必须有基线与 profiler 证据。
- 外科手术式改动，每阶段独立验证和提交。
- OpenLoaf 只作设计参考，禁止复制 AGPL 源码。
- 文档与代码同一阶段同步；当前实现和目标态必须明确区分。
