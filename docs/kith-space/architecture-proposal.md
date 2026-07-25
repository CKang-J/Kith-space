# Kith-space 目标架构

> 本文描述个人 AgentOS 的目标模块边界。A2-A6、Home/Space root 的 H1-H4、P-A8、本轮聊天/壳层 UI、P-A9.0-P-A9.7、P-A10.0–P-A10.7、系统Memory Advisor Provider切片0–4与统一模型/运行器控制面均已完成。当前 workspace schema v10、app.db v8、per-surface SessionModule、四家 v2 runtime、durable delivery/turn、Context Envelope、broker-backed MCP/CLI Gateway、revisioned episodic memory、安装级模型/运行器/Advisor控制面、外观字体设置、snapshot与compaction telemetry已落地。H5继续作为独立后续。完整控制面见`../superpowers/specs/2026-07-23-model-provider-runtime-memory-settings-design.md`。

## 1. 架构原则

- Desktop 是唯一正式宿主和进程监督者，浏览器入口依附 Desktop 生命周期。
- 一个安装实例只有一个 Human、一个 Home Space、一个 Local Runtime Worker，可注册多个普通本地 Space。
- 不自研 runtime；Claude Code、Codex、opencode 通过 adapter 接入。
- 模块能力经 MCP 暴露，UI、HTTP、agent data plane 和 MCP handler 复用同一领域服务。
- app data、Space 自包含数据和 runtime state 分层；应用内部根默认 `~/.kith-space`，用户 Space 容器默认 `~/Kith-space`。
- Space root 是所属 agent 的共享 cwd，但不是安全沙箱；保留 Space 作用域、路径校验、浏览器鉴权和 runtime 权限边界，删除多租户/RBAC 和远程主机抽象。
- 采用 Desktop 监督的模块化单体：Core 收窄为组合根与 Transport Adapter，业务能力形成深 Module；依赖方向、高内聚/低耦合、KISS 与测试 Seam 优先于机械拆文件。
- 性能优化以可重复基线和 profiler 为前提；TypeScript / Node / Electron / SQLite 继续作为主栈，Rust 只可能替换经证据确认的窄热点 Implementation。

## 2. 进程与信任边界

### 2.1 Desktop Supervisor

Electron 43.1.0 main 是正式入口，职责限制为：

- 读取本机 app 设置并决定监听模式/端口。
- 每次启动生成内部临时凭据。
- 按顺序启动、健康检查和监督 Core Service 与 Local Runtime Worker。
- 创建受控 Electron 窗口，提供 Desktop 信任桥。
- 管理托盘、关闭行为、系统自启动、端口冲突和显式退出。

`src/desktop/processSupervisor.ts:68` 先启动 Core 并等待 `src/server/index.ts:145` 的 ready IPC；只有拿到 Core 报告的实际端口后才启动唯一 Worker 和可选 Vite。每次 `start`/`restart` 重新生成一对独立凭据，受管环境固定 `KITH_SPACE_DESKTOP_MANAGED=1`，Core 同时获得 Desktop/Worker 凭据，Worker 只获得 Worker 凭据，Vite 子进程环境不包含两者。端口占用、ready 超时和关键子进程退出都会形成明确诊断并清理整组；显式退出先等待 agent runtime 退出，再用 Windows process tree/Unix process group 作为超时兜底。终止失败时监督器保留子进程句柄，Desktop 留驻托盘供用户重试 Quit。

开发态与打包态的子进程命令由 `src/desktop/processCommands.ts:25` 统一解析。开发态使用 Node + tsx/Vite；打包态在 `src/desktop/processCommands.ts:39` 以 Electron 可执行文件、`ELECTRON_RUN_AS_NODE=1` 和内置 `runtime/core.cjs`/`worker.mjs` 启动 Core/Worker，并通过 `KITH_SPACE_WEB_DIST`、`KITH_SPACE_MIGRATIONS_DIR` 指向 `resources` 内的 Web 与 Drizzle 资产。这样 production Desktop 不依赖源码树、tsx、Vite 或用户 `.env`。

业务逻辑不进入 Electron main。`src/desktop/main.ts` 创建 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 的 BrowserWindow，拒绝权限请求、新窗口、webview 和白名单外导航；同时移除 Electron 应用菜单栏，避免 Windows Desktop 窗口显示默认的 File/Edit/View/Window 菜单。`src/desktop/preload.ts:3` 只暴露读取/更新 Desktop Settings 与撤销浏览器会话的窄桥；main 同时校验 IPC sender。Desktop 私有 header 由独立 Electron session 仅附加到允许的 loopback 产品 API/socket 请求，并排除 Desktop 管理路径；渲染器 JavaScript 不持有凭据。普通浏览器既没有 preload bridge，也不能调用 Desktop 管理接口。

### 2.2 Core Service

Core Service 是本机单实例业务服务，承载 HTTP、socket.io、浏览器访问门、领域服务和数据连接。代码目录仍为 `src/server/` 时，“server”只描述技术进程；产品领域中的工作区统一称为 Space。

Core Service 根据 Web 模式监听：

- 关闭（默认）：仍在 `127.0.0.1` 保留 Desktop/Worker 所需的私有传输，但不提供普通浏览器产品壳。
- 仅本机：绑定 `127.0.0.1`，普通浏览器经 Access Token 会话访问。
- 局域网：绑定 `0.0.0.0`，同样强制 Access Token 会话，并只允许与请求 Host 匹配的 Origin。

`src/browser-access/browserAccessPolicy.ts:41` 把模式与监听决策隔离为窄策略；`src/server/localEndpoint.ts:7` 让 Desktop 管理的 Core 以 app.db 端口为权威，只有手动分进程开发才允许 `PORT` 覆盖。模式/端口更改后 Desktop 重启整个受管进程组。非 Desktop 请求在关闭模式下会被 `src/server/index.ts:115` 的产品壳门拒绝。

### 2.3 Local Runtime Worker

现 daemon 保留为独立进程隔离边界，但产品名称改为 Local Runtime Worker。`src/local-runtime/workerHub.ts` 在 Core Service 内维护安装级唯一连接、ready snapshot 与请求/响应；新连接会用专用关闭码替换旧连接，旧进程停止自动重连，generation lease 阻止旧连接的异步 ready、事件、补唤醒或断线回收覆盖新连接状态。它只连接本机 Core Service，承载 runtime 进程、轨迹和 session 生命周期；不再注册 Machine、不被用户手工连接，也不接受远程 worker。Worker 固定连接 Desktop 报告的 `http://127.0.0.1:$PORT/daemon/connect`，以私有 `x-kith-worker-token` header 握手，凭据不进 URL；不提供 `--server-url` 或其他远程端点覆盖。手动分进程命令仅作为调试入口保留，不重新引入远程 Worker。

唯一 Worker 服务所有本机 Space，而不是隶属某个 Space。Worker 消息只携带 installation-unique agentId；`src/local-runtime/agentLocator.ts` 遍历已注册 Space 定位 agent 所属数据库，`src/server/ws.ts` 再把 status/activity/session/trajectory/reply 发布到正确 Space。Worker ready/reconnect 同样遍历所有 Space 做状态对齐和积压补唤醒。

### 2.4 React UI

Electron 和桌面浏览器复用同一 React UI、HTTP API 和 socket.io 事件。客户端能力由不可伪造的宿主桥决定：`web/src/desktopBridge.ts:62` 只有检测到窄 preload bridge 时才开放 Desktop 设置区；普通浏览器请求该区会经 `resolveSettingsSection`（`:67`）回落到 Human 设置，并且服务端仍拒绝其管理调用。Human Settings 的规范 resource 是 `settings=human`；Desktop Settings 管理 Web 模式、端口、Token 轮换、浏览器会话撤销、关闭行为和自启动。

共享 UI 的当前实现栈是 React 19.2.8、TypeScript、Vite 5、Tailwind CSS v4 与 shadcn/ui（`web/package.json:19`）。React 19 升级只更新 React/React DOM 与对应类型，不连带升级 Vite、React Router，也不在版本迁移中引入 Actions 等新 API；现有 `createRoot`、StrictMode 和客户端 SPA 边界保持不变。`web/vite.config.ts:15` 接入 Tailwind Vite 插件，`:18` 把 `@/*` 映射到 `web/src/*`；`tsconfig.test.json:4`-`:9` 只为 tsx 单测镜像同一别名，并由 `scripts/run-tests.mjs:38`-`:43` 显式选择，不扩大 Core 根 TypeScript 配置的解析边界。`web/vite.config.ts:36`-`:43` 将 React/Router 与 Radix 分别稳定切入 `react-vendor`、`ui-vendor`，避免框架和基础交互代码回落到业务主包。`web/components.json` 固定 shadcn 的 Radix/Nova、语义 CSS 变量和 Lucide 图标配置，`web/src/lib/utils.ts` 提供统一 `cn()`。新增基础组件进入 `web/src/components/ui/`，业务 feature 只组合这些源码组件，不反向把业务状态写入 UI 基础层。

Tailwind/shadcn 是新增 UI 的强制基线，存量 CSS 是迁移债而非新代码模板。`web/src/styles.css` 暂时同时承载既有全局规则和 Tailwind/shadcn 主题入口；迁移期只加载 Tailwind theme/utilities，不启用会全局重置元素的 Preflight，并把 shadcn 基础边框/焦点规则限定到带 `data-slot` 的组件。shadcn 的 `muted` 语义变量使用独立底层变量映射，避免覆盖存量 `--muted` 文本色。迁移按被触达组件渐进进行，不以全量重写换取表面一致。

首批存量迁移继续保持“业务状态在 feature、交互语义在基础组件”的边界：`web/src/components/SearchField.tsx:18`-`:64` 组合 Input Group 并保留受调用方控制的 value/clear 契约；`web/src/spaces/SpaceCreateMenu.tsx:14`-`:59` 使用 Dropdown Menu，`web/src/spaces/SpaceCardMenu.tsx:159`-`:206` 让同一组业务动作同时服务按钮菜单与卡片右键菜单；`web/src/spaces/SpaceRenameDialog.tsx:22`-`:103` 和 `web/src/views/channel-settings/ChannelDeleteDialog.tsx:25`-`:108` 分别组合 Dialog/Alert Dialog、Field、Input 与 Button。旧组件自建的 portal、document 级事件监听和菜单坐标状态已退役；Alert Dialog 基础层只增加窄 `overlayProps` 透传，以保留现有非 busy 遮罩点击取消行为，不把频道业务写入基础层。

首次初始化位于产品 Store 之前：`web/src/main.tsx:58` 定义正常产品根，`web/src/main.tsx:78` 再用 `DesktopSetupBoundary` 包住它，因此未初始化时不会先创建 `StoreProvider` 或发起 Space bootstrap。`web/src/personalSetup.ts:54` 只在检测到完整 preload bridge 时启用检查；普通浏览器不探测 setup API，只进入既有 Cookie 会话探测与 Access Token Gate。`web/src/personalSetupBoundary.tsx:22` 负责 loading、可恢复表单、错误重试和完成后一次性挂载正常产品树。

## 3. 通信平面

保留 open-tag 三平面结构，但收敛身份和连接范围：

1. Human UI plane：Electron 通过私有 Desktop 凭据，已授权桌面浏览器通过 HttpOnly Cookie 会话访问 `/api/*` 与 socket.io。
2. Worker control plane：本机 Core Service 与唯一 Local Runtime Worker 以独立 Worker 凭据建立 WS，用于 agent start/deliver/stop/profile。
3. Agent data plane：本机 runtime 子进程以最小短期 session token 调用 `/agent-api/*` 或 MCP 工具。

浏览器访问 Token、Desktop 信任凭据、Worker 内部凭据和 agent session token 是四种不同凭据，不可复用或互相兑换。

## 4. 领域模块

### 4.1 Human

`src/app-data/appDatabase.ts` 管理唯一 Human 的名称、可选邮箱和描述；`src/human/humanIdentity.ts` 把协作寻址固定为稳定的 `@you`，展示名始终读取 app.db。REST 和 socket.io 的 Human authority 只来自 Desktop 私有信任或已验证的浏览器 Cookie 会话（`src/server/humanRequestAuth.ts:18`），不存在 Human JWT、Bearer 登录或 dev-login。唯一资料接口是 `handleHumanProfile`（`src/server/routes-api/humanProfile.ts:7`）提供的 `GET/PATCH /api/human/profile`；旧 `/api/auth/me` 在同一 handler 的 `:9` 显式 404。前端 Human Settings 在 `web/src/views/misc.tsx:289` 读取该接口，规范 query 是 `settings=human`，不提供账户、密码、角色或成员关系。

首次初始化是 Desktop 应用生命周期的一部分。`PersonalSetupService` 读取唯一 Human 与稳定 Home 记录，幂等补齐默认 Home；setup 路由只接受 Desktop 私有信任。`src/app-data/appDatabase.ts:81` 的单例 `installation_state.home_space_id` 保存 Home 身份，`registerHomeSpace`（`:281`）在 app.db 事务中原子注册并认领 Home，`unregisterSpace`（`:335`）拒绝移除 Home；旧 app.db 仅在该字段为空时由既有 `slug=home` 一次性回填，并保留已有 rootPath，不自动搬动用户数据。`src/db/personalApp.ts:36` 默认在独立于 app data 的 `~/Kith-space/Home` 初始化全新 Home。初始化仍只收集 `name/email/description`，不让用户把另一个普通 Space 冒充 Home；已有不兼容 `.kith` 时停止并给出可操作错误，不能自动覆盖。

旧 `initialHumans` bootstrap/产品契约已在 A6 退役；测试 fixture 中为构造特定频道状态保留的同名字面量不构成 HTTP、UI 或持久领域入口。

### 4.2 Space

`SpaceService` 当前管理本地文件夹注册、slug、最近打开记录和 `<space>/.kith/` 初始化。H1-H4 把职责收口为三个边界：Home 身份服务维护稳定 homeSpaceId 和 Home 不变量；Space root 服务负责路径规范化、创建、接入、重连与 `.kith` 校验；Space route/目录层向 UI 提供 registry、稳定 `isHome`、状态与最近打开信息。具体类名可按代码风格调整，但职责不得重新堆回 Core 大文件。

默认 app data 为 `~/.kith-space`，默认 Space 容器为 `~/Kith-space`，Home 为 `~/Kith-space/Home`；普通 Space 可以位于任意本机磁盘。`src/paths.ts:9` 已把 `KITH_SPACE_HOME` 收窄为 app data 覆盖，`KITH_SPACE_SPACES_DIR` 独立覆盖默认 Space 容器；开发/测试必须使用后者或显式 rootPath 隔离 Space fixture。

Space 列表、创建和修改以 app.db registry 为事实源；每个 workspace.db 另有一行 `spaces` 元数据和 `#all`。同一规范 rootPath 或同一稳定 Space ID 不得重复注册；已有兼容 `.kith` 时接入/重连，不兼容或损坏时拒绝并提示备份，绝不自动删除。产品 schema/API/type 使用 `space/spaceId`，URL `/s/:slug` 保留。

canonical 传输契约是 `/api/spaces`、`x-space-id`、Socket handshake `spaceId` 和 `SpaceCtx`。Web 只使用这套契约；HTTP、公开附件和 Socket 以 app.db 唯一 Human + registered Space 授权，不依赖 Human Space membership。旧 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 与 `dbFor/listWorkspaces/registerWorkspace` 等 DB facade 已删除；Agent CLI 使用 `space info` 和 `space:read`。

每个 Space 拥有用户文件、频道、消息、任务、agent 队伍和 Space/Agent Memory。Home 是其中唯一带总控能力的真实 Space；普通 Space 是 registry 中除 homeSpaceId 外的条目，不要求成为 Home 的物理子目录。Agent membership 表达“某 Agent 是否属于并可读取该频道”，不承载 Human 权限；P-A8 再由 Agent 默认响应模式与 membership 上的可空频道覆盖决定某条可见事件是否足以自动唤醒，不能把响应模式解释成读写权限。

### 4.3 Runtime

继续复用窄 `Runtime.start(opts, callbacks): RuntimeSession` 适配契约（当前定义在 `src/daemon/runtime.ts`）。`RuntimeSession.stop()` 允许返回 Promise，调用方在取消、关闭和 deadline 路径等待进程树真正退出。v1 只稳定 Claude Code、Codex、opencode；其他 adapter 隐藏或标 experimental。Runtime 契约 v2 统一 usage、完成、取消和 MCP bootstrap，但不把工具循环搬入 Kith-space。

H2 已在不扩大 Runtime 接口业务职责的前提下落地三路径契约：中立领域模块 `src/agents/agentWorkspacePaths.ts` 为 Server 与 Local Runtime Worker 共同解析 `workspaceRoot = Space root`、`agentMemoryDir = <space>/.kith/agents/<agentId>`、`runtimeStateDir = <appData>/runtime/<spaceId>/<agentId>`，并以安全单路径段与 descendant 断言阻止递归删除逃逸容器；`src/daemon/agentManager.ts` 创建并使用这些目录。Claude Code、Codex、opencode 的 cwd 是 workspaceRoot，Claude system prompt 与 Hermes turn 文件等 adapter 产物写 runtimeStateDir。OpenCode 以 `OPENCODE_CONFIG_CONTENT` 定义固定的 `__kith_runtime__` execution agent，并通过 `--agent` 选择，system prompt 只存在于对应 child env，不修改用户项目的 `AGENTS.md`。Copilot/Kimi/Cursor 仍标 experimental：它们的现有 adapter 会在 cwd 写 `AGENTS.md`，所以暂用 runtimeStateDir，避免覆盖用户 Space 中的同名文件；其正式 Space root 适配应先取消该 cwd 注入副作用。

Agent 首轮驱动仍分为 `create | manual | wake` 三种产品原因，但P-A10.2后按harness mode实现：legacy adapter继续使用既有一次性introduction token与`message send --introduction`；Claude/Codex/opencode新Agent从创建事务直接获得Human-Agent DM上的required introduction delivery，其active turn capability就是一次性proof，只有server-owned `turn.reply`与该input同事务提交后才写`agents.introduced_at`。manual对v2只扫描durable inbox并按surface调度，不创建无surface session；wake只绑定对应surface delivery。stop/reset先撤销attempt/capability并通过带ACK的Worker命令关闭该Agent hosted session，reset再归档旧generation和清理runtime state。两条data plane按Agent互斥，legacy token不能调用v2 Gateway，v2也不能回退到`/agent-api/*`。

P-A8 已把“是否启动 runtime”与“本轮是否必须回复”拆开。`src/agents/agentResponsePolicy.ts:42` 是无 I/O 的纯领域决策，返回 `wake`、`required | optional | observe` 指令和稳定 reason；`src/agents/agentResponseSettings.ts:252` 批量解析候选 Agent 的默认值、频道覆盖与 watermark，`src/agents/agentResponseDelivery.ts:29` 把消息、任务和话题上下文适配到纯策略。实时消息由 `src/messages/messagePostingModule.ts:502` 规划并通过窄 wake port 投递，任务指派/状态审计由 `src/tasks/taskLifecycleModule.ts:303` 之后的生命周期命令负责，Worker reconnect backlog 仍由 `src/server/reconnectCatchup.ts:40` 计算；Agent data plane 的 message check 已归入 `src/server/agent-http/messagesContextModule.ts`，`src/server/routes-agent.ts:59` 只做认证后的分组派发。Human 普通频道消息只对主动成员产生 `optional` wake，明确 mention 对主动/被动成员产生 `required` wake，静音不因频道事件自动启动；DM 与明确任务指派始终为 `required`。Worker 只为 required 投递建立回复预览，optional 可静默。前端只在同一 Agent 对触发父消息产生非空 `thread:updated` 后移除父频道预览，空话题创建不会提前清理。这些变化没有扩大 `Runtime.start` 接口，也没有提前实现 Runtime 契约 v2。

频道全体提及由独立领域 helper `src/channels/channelAllMention.ts:14`-`:32` 识别语言无关的规范 token `@all`、合并展示标记与接收者快照；`src/messages/messagePostingModule.ts:356` 的无写入 preflight 完成任务拒绝、频道/话题作用域和接收者解析，随后在统一事务内补齐话题 membership 并写入快照 mention。已有实时 wake、reconnect 和 message check 仍只消费普通 Agent mention 行，因此主动/被动成员得到 `required`，静音成员不自动启动。Agent-authored 同名文本、DM 和任务消息不会进入该展开路径；Human 的“指派任务 + @all”无论会话类型都在 seq、消息和 membership 变更前返回参数错误。候选标签及说明留在 i18n 文案中，不进入协议或数据库 mention name。

Runtime 命令发现与启动统一经过 `src/daemon/runtimeProcess.ts`。Worker ready 不再调用 Unix 专用的 `command -v`，而是通过 `runtimeCommandAvailable` 使用与 adapter 相同的 `cross-spawn` 边界执行轻量 `--version` 探测；全部 adapter 同样通过该边界启动 CLI。`src/processes/processTree.ts` 统一普通退出、取消、超时与 shutdown：POSIX 以独立process group先TERM后KILL，Windows以`taskkill /T /F`回收后代，并以目标child的真实exit作为完成条件；`src/processes/runCommand.ts`为安装和模型探测提供同一有界命令执行语义。这样 Windows 上的原生 `.exe` 与 npm `.cmd` shim 具有一致语义，也不会在调用方已经settle后留下后代进程。runtime stdout/stderr继续使用Node有状态UTF-8解码，禁止adapter对任意Buffer分块分别`toString()`。Core仍以Worker ready snapshot为权威，在`src/server/core.ts`的启动guard中拒绝真正不可用的runtime。

Agent CLI wrapper 由 `src/daemon/kithSpaceBin.ts:22` 按宿主平台生成：Windows 开发态和打包态都只保留 `~/.kith-space/bin/kith-space.cmd`，启动时清除旧的无扩展名 POSIX wrapper；Linux/macOS 只生成带 `#!/bin/sh` 且可执行的 `kith-space`。`src/daemon/prompt.ts:17` 根据 `win32` 与 POSIX 环境注入宿主命令约定：Windows 明确调用 `.cmd`、禁止照抄 shebang/bash/chmod，优先给出 PowerShell 写法；若 runtime 明确提供 POSIX shell 才允许使用该 shell 的语法。在 Windows PowerShell 5.1 向原生命令管道发送非 ASCII 文本前必须把 `$OutputEncoding` 切到 UTF-8。CLI 的消息、线程与 action STDIN 共用 `src/cli/readStdin.ts:5` 的有状态 UTF-8 读取边界。因此中文正确性由 wrapper、输入流和输出流共同保证，而不是依赖“请用中文回复”的提示词。

受支持 runtime 的规范目录位于 `src/local-runtime/runtimeCatalog.ts`。`GET /api/local-runtime/runtimes` 把 Worker ready snapshot 映射为完整 availability 列表：已安装项稳定前置，未安装项继续返回但由 UI 禁止选择。runtime 的模型发现也必须经过同一 `spawnRuntimeProcess` 边界；OpenCode 使用其官方 `opencode models --verbose`，失败时 `/api/local-runtime/models/opencode` 返回明确错误而不是伪造 `Default`。创建 OpenCode agent 必须提交显式 `provider/model`；adapter 以官方 `--auto` 和 `--model provider/model` 启动，缺少显式模型时直接拒绝启动。Provider API Key 仍由用户自己的 OpenCode 配置管理，Kith-space 不读取或保存。

### 4.4 Tasks

任务领域位于 `src/tasks/`，由 lifecycle Module、repository、policy、service、creation helper 和 types 分层组成；`src/tasks/taskLifecycleModule.ts:62` 是 Transport 使用的窄生命周期 Interface，HTTP 映射留在 `src/server/tasks/taskHttp.ts`。任务仍以 task message + owning thread 表达；状态图、revision、父子关系、report/delivery metadata 和并发控制继续复用。

REST、agent API、MCP handler 和 UI 必须调用同一 Task Service，不能各自写 SQL。任务号、任务消息、thread、审计消息和状态变更继续保持事务一致性。

### 4.5 Memory

文件记忆继续保持三层：

- User 层：唯一 Human 的跨 Space 偏好和长期背景，位于 `<appData>/memory/`。
- Space 层：当前 Space 规则与背景，位于 `<space>/.kith/memory/`。
- Agent 层：当前 Space 内 agent 的工作知识与恢复上下文，位于 `<space>/.kith/agents/<agentId>/`。

Home Space Memory 承载跨 Space 协调背景和组合计划，不替代 User Memory；普通 Space Memory 只承载该 Space 的共享知识。读取继续使用 runtime 原生文件工具；写入遵循“一事一文件 + 索引”提示词约定。H2 已把 Agent Memory 归位到所属 Space 的 `.kith/agents/<agentId>`，profile 外科式同步和 runtime prompt 都使用同一解析结果。Agents 详情中的 Human 只读“记忆”文件浏览器也从 Core 解析同一 `agentMemoryDir`，再通过兼容的 `/api/agents/:id/workspace-files` 列表/读取协议交给本机 Worker；它不暴露共享 Space root，也不接受前端传入任意绝对路径。P-A10.5另加不替代文件记忆的结构化Episodic Memory：Agent只可通过broker-backed `memory.recall/get`读取，Human经控制面管理；不存在通用`memory_save` Agent写工具。

### 4.6 Files

文件和附件只使用本地磁盘服务。用户业务文件位于 Space root 的普通文件树，agent 相对文件操作与项目 skills 默认落在这里；产品状态位于 `.kith`，runtime prompt/临时状态位于 app data。项目 skills 由 Core 从 app.db registry 解析并向 Worker 传递 Space root，项目文件树隐藏 `.kith`、`.git` 与 `node_modules`。Agent 详情的记忆列表和读取则由 Core 解析所属 Space 后传递精确的 `agentMemoryDir = <space>/.kith/agents/<agentId>`，只能浏览该 Agent 的记忆目录；两类请求都拒绝路径遍历，调用方不能提交任意绝对路径。S3 driver、SDK 依赖、bucket 配置和 app 级上传目录均已删除；storage key 必须是平面文件名。`src/server/attachments.ts` 在统一 multipart 边界按 UTF-8 解码文件名参数，确保浏览器和本机 Agent CLI 上传的非 ASCII 原名不会被 Latin-1 误解码。`src/files/localObjectStorage.ts:28` 接收 `spaceId`，通过 app.db registry 解析已注册 Space 的 rootPath，并只读写 `<spaceRoot>/.kith/uploads`；P-A9.7 已删除旧 `src/server/storage.ts` facade。Public download 以附件记录的 `spaceId` 为准，agent plane 以认证 `spaceId` 为准；请求和调用方都不能用字符串路径绕过 registry。

### 4.7 Home 与跨 Space 委派

Home 的 Spaces 模块只读取 app.db registry 和真实摘要。未来 Home agent 的 `list/get/task-create/message-send/agent-dispatch` 通过 `CrossSpaceCommandService` 或等价领域边界执行：请求显式携带 sourceSpaceId、actingAgentId、requestedBy、targetSpaceId、目标资源和 idempotency key；Core 从 registry 解析目标并复用目标 Space 的 Task/Message/Agent 服务。

跨 Space 操作不直接读写目标 SQLite，也不能依赖跨数据库事务。实现必须以幂等请求和可查询审计状态处理重试。目标消息保留真实 Home agent，并显示其代表唯一 Human 从 Home 发起；不能持久化成 Human actor。需要修改目标文件时默认创建任务并调度目标 Space agent，让后者在目标 Space root cwd 中执行。Home agent 只按需读取相关摘要和资源，不无界预加载所有 Space 的消息与记忆。

## 5. 数据拓扑

### 5.1 app.db

实现状态：A2.1 已落地 `src/app-data/appDatabase.ts`。旧 `registry.db/workspaces` 已被 `app.db/spaces` 取代；Human profile 为单例行。A3 增加单例 `browser_access_settings` 和 `browser_sessions`，A4 增加单例 `desktop_settings`，P-A7 H1 增加单例 `installation_state.home_space_id`。P-A10.0建立app.db migration journal，P-A10.3把schema升至v2并在`installation_state.content_hmac_key`生成稳定的32-byte安装级key；P-A10.5的v3增加隔离的`user_global` episodic memory表族，v4以事务性table rebuild修复早期v3缺失的复合revision外键并保留全部数据；当前v5增加安装级Advisor execution mode、Provider/Model Profile不可变revision、epoch与Pi CLI脱敏导入快照。HMAC key只用于Context/memory lineage、claim、action与配置来源digest，不作为浏览器或Agent凭据。

本机 app data root 默认 `~/.kith-space`，目标结构为：

```text
~/.kith-space/
  app.db
  memory/
  managed-runtimes/<runtimeId>/node_modules/.bin/
  runtime/<spaceId>/<agentId>/
  bin/
  logs/
```

其中 `app.db` 保存：

- 唯一 Human profile 与初始化状态。
- 已实现的 Web 设置：Web 模式和端口。
- 浏览器访问 Token 哈希与 token revision。
- 浏览器授权会话和撤销状态。
- 已实现的 Desktop 设置：关闭到托盘/关闭即退出与系统自启动开关；托盘本身由 Electron 生命周期管理。
- 稳定 homeSpaceId。
- Space registry：id、slug、rootPath、displayName、最近打开时间。

app.db 不保存 Space 消息、任务或 agent 业务数据。

P-A7 H3-H4 已把 Space root 生命周期收口到 `src/spaces/spaceRootService.ts` 与 `src/spaces/spaceService.ts`：默认创建只接受新的默认路径；显式接入可初始化普通目录，或从兼容 `.kith/workspace.db` 读取并复用稳定 Space ID；移动后的目录必须用 relocate 更新同一个 registry 记录。规范 root 或 Space ID 重复、损坏/不兼容数据库、`.kith`/workspace.db symlink、身份不匹配均返回可操作错误且不删除用户文件；已有数据库的 slug 只作本机路由别名，默认冲突时自动取唯一值，不改变稳定 Space ID。`src/db/spaceDatabaseCompatibility.ts` 由接入探测和 `dbForSpace` 共用，在迁移/打开前执行 SQLite `quick_check`、版本及全产品表/列校验，迁移后再验证当前 schema。workspace migration SQL由`.gitattributes:8`固定为LF，journal以`src/db/spaceDatabaseSchemaHistory.ts:17`中的canonical LF hash为准；对旧Windows checkout已写入的CRLF结果只接受逐迁移显式列出的精确hash，顺序、时间戳、长度与schema/index/FK校验不变，未知hash继续在`src/db/spaceDatabaseCompatibility.ts:115` fail-closed。`GET /api/spaces` 返回 `ready | missing | error`、稳定 `isHome`、`lastOpenedAt` 与错误码；relocate 由 `POST /api/spaces/:id/relocate` 执行，显式打开由 `POST /api/spaces/:id/open` 记录最近打开时间且只接受 ready root。目标打开失败时恢复旧 registry root；注册后的普通数据库访问会先校验 root、`.kith` 与 workspace.db，缺失时明确失败而不隐式重建。

### 5.2 workspace.db

A2.2b 建立的19张产品表baseline经P-A8升至v5；P-A10.1把`PRAGMA user_version`升至6并新增`agent_harness_state/runtime_sessions`，P-A10.2在同一版本的后续不可变journal前缀再加入13张durable harness表。已应用P-A10.1的合法v6前缀会按journal count选择manifest并继续迁移，不会因同版本漏跑。P-A10.5的`0008_episodic_memory_core.sql`把workspace升至v7，增加8张关系表与`memory_fts`虚表；postflight继续核对完整journal、关键索引和FK（`src/db/spaceDatabaseSchemaHistory.ts`、`src/db/spaceDatabaseCompatibility.ts`）。v5 `agents.session_id`原样保留给legacy rollback，绝不backfill到per-surface session。

P-A8 的 schema v5 仍保持 19 张产品表：`agents.default_response_mode` 默认 `active`（`src/db/schema.ts:31`）；`channel_agent_members` 增加可空 `response_mode_override`，以及彼此独立的 `ambient_wake_after_seq`、`mention_wake_after_seq`（`src/db/schema.ts:71`-`:77`）。覆盖只允许写在顶层频道 membership；话题 membership 继承父频道有效值，并用自己的 mention watermark 维护参与后的非追溯边界。两类 watermark 只阻止模式重新开放后补唤醒旧事件，不能复用或推进 `last_read_seq`。

频道全体提及不增加 schema 版本或产品表。`message_mentions.mention_type` 原为开放文本字段，现在约定 `human | agent | channel_all`：`channel_all` 行只保存展示标记和父频道 ID，发送时的真实 Agent 接收者仍保存为普通 `agent` 行（`src/db/schema.ts:184`-`:191`、`src/channels/channelAllMention.ts:18`-`:32`）。因此成员变更不改写历史接收范围，现有 Agent mention 查询也无需增加第二套群体投递分支。

每个 Space 的 `<space>/.kith/workspace.db` 保存：

- Space 元数据，以及 Space 内 agent、频道与 agent-only `channel_agent_members`。
- 消息、thread、任务、任务计数和实时 seq。
- 唯一 Human 的 read/DM/thread 状态及频道通知级别 `human_channel_states`、收藏 `human_saved_messages` 与 Space 偏好 `human_space_preferences`；`notification_level` 受约束为 `all | mentions | none`，默认 `all`（`src/db/schema.ts:81`-`:89`）。
- 持久 actor 使用 `human | agent | system`（按字段适用）；runtime 协议的 `role: "user"` 是外部协议字面量，不属于数据库 actor。

同一个 `.kith` 还包含 `<space>/.kith/memory/`、`<space>/.kith/agents/<agentId>/` 和 `<space>/.kith/uploads/`。一个 Space 文件夹可整体复制，带走用户文件、workspace.db、Space Memory、Agent Memory 与附件；Human 资料、User Memory、浏览器会话、Desktop 设置和 runtime state 不随之复制。未来本机跨 Space 聚合遍历多个 workspace.db 并在应用层合并，不引入中央云库。

### 5.3 schema 转向策略

允许清空开发期 app 数据与 `.kith`，不实现旧 schema 数据迁移。A2.2b 把 Drizzle 历史压成单一 `0000` baseline；打开旧 schema 时抛出包含数据库路径的可操作错误，要求先备份再显式删除，应用绝不自动迁移或删除旧库。领域迁移状态如下：

1. 建立 app.db 和唯一 Human/Home 初始化。
2. 将传输、请求上下文、Space API 与 Web 类型改为 `spaceId`，并删除旧服务端兼容边界。
3. A2.3 已完成：唯一 Human 成为传输 authority，稳定身份为 `@you`，删除产品 membership/RBAC/邀请/Web Human roster/Human-Human DM，频道成员只管理 agent。
4. A2.4 已完成：删除 Machine 服务/API/UI、machine key/心跳/调度与 agent machine 选择；保留安装级唯一 Worker 进程协议，并让 Worker 事件跨 Space 定位。
5. A2.2b 已完成：破坏性重建 workspace.db baseline，把保留表的 `servers/server_id` 改为 `spaces/space_id`，拆出单 Human 状态/收藏/偏好，并删除旧物理表与兼容边界。
6. A2 已完成：附件目录纳入 Space 根路径，旧 app 级上传配置、命名 facade 与不兼容维护脚本已删除，并完成整阶段验收。
7. H1-H4 已完成：稳定 homeSpaceId，分离 app data/默认 Space 容器，把主要 runtime cwd、Agent Memory 与 runtime state 归入三路径契约，完成默认创建、文件夹接入、失联重连，并交付 Home-only Spaces 模块、默认 Home 启动和同窗切换；2026-07-18 本轮用户验收已完成。
8. P-A8 已完成：schema v5、统一响应策略/设置、任务 assignee 语义、Human 频道 `@all` 接收者快照、实时/reconnect/message check/prompt 指令与前端默认值/频道覆盖 UI 已同步落地；这是当时尚未启动 H5 或 Runtime 契约 v2 的历史边界，当前 P-A10.1 已补 v2 session 地基但仍未切产品消息消费。

不执行无边界的整仓替换；每个切片都需 schema、service、route 和 UI 契约测试。

### 5.4 频道生命周期与唯一 Human 偏好

频道生命周期分为活跃、已归档和已删除。归档是可恢复的只读状态，删除继续使用 `deleted_at` tombstone 且产品不提供恢复入口；普通列表、Inbox、未读、搜索、agent 检查及唤醒只消费活跃频道，归档详情仍允许在当前 Space 权限边界内读取历史。中立领域模块 `src/channels/channelLifecycle.ts:21`-`:53` 先把 thread 解析到父频道，再以统一 `assertChannelWritable` 返回稳定的 `channel_archived | channel_deleted | channel_not_found` 错误；`:56`-`:80` 为列表型表面集中排除归档/删除频道及其 thread，Human 状态与 server 路由都依赖该模块而不形成领域层反向依赖 server。Human/agent 消息、话题/回复、附件、reaction、action card、频道成员和任务写入口复用该 guard；核心消息入口本身也在持久化前强制校验（`src/server/core.ts:484`-`:495`），避免只靠前端禁用。Mentions 和 Space Tasks 这类跨频道聚合也先通过 `activeChannels` 收窄候选频道，因此归档/删除父频道的 thread 内容不会泄漏回活跃聚合（`src/server/routes-api/messages.ts:18`-`:43`、`src/server/routes-api/tasks.ts:47`-`:58`）。

Agent 删除采用“私域物理删除、共享历史保留”的边界。`src/agents/agentDeletion.ts` 在同一 workspace 事务内从 Human DM 状态和 Agent channel membership 找到所有包含目标 Agent 的 DM，递归纳入其直接话题，清除消息、附件元数据、mention、reaction、收藏、提醒、dispatch 状态与频道记录，同时移除剩余频道 membership 并给 Agent 身份写入 `deleted_at`；事务提交后再尽力删除 `<spaceRoot>/.kith/uploads` 中对应本地对象。保留 Agent tombstone 是为了让公共频道/话题历史仍可按发送时快照归因；`attachMentions` 和话题预览序列化会输出 `senderDeleted`，实时删除事件也会更新当前已加载消息与话题预览，但 `/api/agents`、DM、Inbox 与前端命令面板只消费未删除 Agent。消息搜索继续受当前 Space 与 Human 可读活跃频道约束。`GET /api/messages/search` 先按字面转义 SQL LIKE 通配符（`src/server/routes-api/messages.ts:108`-`:116`），再由独立展示模块通过批量查询解析 Human-Agent/Agent-Agent 私信参与者、私信头像、话题父消息摘要、父频道和回复总数（`src/server/messageSearchPresentation.ts:52`-`:116`），返回稳定的 `conversationName` 展示语义而不暴露 `dm:*`/`thread:*` 内部名称（`:119`-`:148`）；统一 `Ctrl/Command + K` 面板据此直接回到原消息。话题命中使用独立 `threadMsg` 焦点参数，在打开父话题后滚动并高亮具体回复。

每个 Space 的 `# all` 是当前唯一必需频道。原始 SQLite 约束集中在 `src/db/requiredChannel.ts:11`-`:38`：数据库基线打开后优先恢复既有 `all` 行的 `archived_at/deleted_at`，缺失时才创建；`ensureSpaceBaseline` 在 Space 身份确认后幂等执行（`src/db/index.ts:119`-`:132`）。频道 API 对 `# all` 的归档、删除、名称和可见性修改统一返回 `required_channel`，而不是依赖隐藏按钮（`src/server/routes-api/channels.ts:449`-`:482`）。

`GET /api/channels` 默认只返回活跃普通/私密频道，`?archived=only` 单独返回已归档频道，`?archived=include` 返回全部非删除频道（`src/server/routes-api/channels.ts:150`-`:156`）；Web Store 并行维护活跃与归档数组（`web/src/store.tsx:107`-`:117`）。唯一 Human 的频道通知偏好由 `GET/PATCH /api/channels/:channelId/notification` 读写并校验三档枚举（`src/server/routes-api/channels.ts:429`-`:447`），持久化 helper 位于 `src/human/humanChannelState.ts:45`-`:59`。它不改变 agent 唤醒、消息持久化、未读或 Inbox 语义。

P-A8 的 Agent 响应模式与 Human 通知偏好是两套正交状态：前者属于 Agent/频道 membership 并控制 runtime 自动唤醒，后者只属于唯一 Human。Agent 详情通过既有 `GET/PATCH /api/agents/:id` 读写 Space 默认值（`src/server/routes-api/agents.ts:64`-`:110`）；`GET /api/channels/:channelId/members` 返回默认、覆盖、有效值和来源，`PATCH /api/channels/:channelId/members/:agentId` 写可空覆盖（`src/server/routes-api/channels.ts:249`-`:341`）。归档频道拒绝修改，非成员/跨 Space Agent 返回 404。设置保存后发布窄 `agent:response-mode-updated` 事件，前端按频道一次装载并失效重取，禁止逐消息请求。

## 6. 浏览器访问安全

### 6.1 AccessTokenService

- `src/browser-access/accessTokenService.ts:25` 接受 16-256 字符的自定义 Token；留空时从 32 随机字节生成 base64url 值。
- app.db 只保存 scrypt 哈希与 revision，不保存明文；原始 Token 只在生成/轮换当次的 Desktop 受信响应中返回。
- 公开验证端点以远程地址做内存限速（`src/server/routes-api/browserAccess.ts:79`-`:101`），不把 Token 写入 URL、日志、错误或遥测。
- 轮换 Token 在同一 app.db 事务中增加 revision 并删除全部旧浏览器会话（`src/app-data/browserAccessData.ts:69`）。

### 6.2 BrowserSessionService

- 首次 Token 验证成功后创建 32 字节随机 session；原始值只进 HttpOnly Cookie，app.db 只保存 SHA-256 哈希和 token revision（`src/browser-access/browserSessionService.ts:13`）。
- session Cookie 使用 HttpOnly、SameSite=Strict；可读 CSRF Cookie 也是 SameSite=Strict。当传输本身为 HTTPS 时才加 `Secure`，v1 LAN HTTP 不伪装传输安全。
- 浏览器写请求同时检查模式允许的 Origin、CSRF Cookie 与 `x-kith-csrf` 等值（`src/server/browserSessionHttp.ts:112`）。
- 会话持续到浏览器数据清除、当前会话撤销、Desktop 全量撤销或 Token 轮换；不依赖 Human 账户/JWT 到期。当前浏览器用带 CSRF 的 `DELETE /api/browser-auth/session` 撤销自己的授权并清除 Cookie（`src/server/routes-api/browserAccess.ts:111`）；这是浏览器访问授权操作，不是 Human 账户 logout。

### 6.3 Desktop 与内部凭据

- `src/local-runtime/internalCredentials.ts:37` 为一次 Desktop 管理的进程组生成两个独立 32 字节凭据；`src/desktop/processSupervisor.ts:73` 在每次启动/重启调用并按最小权限分别注入子进程。
- Core Service 对 `KITH_SPACE_DESKTOP_TOKEN` 与 `KITH_SPACE_WORKER_TOKEN` 做 fail-fast；前者只接受 loopback 请求中的 `x-kith-desktop-token` 私有管理信任，后者只接受 loopback Worker `/daemon/connect` 的 `x-kith-worker-token` header。受管进程阻止 `.env` 回灌；只有手动分进程调试从环境注入。两者不得进 URL，也不得与浏览器访问 Token 复用。
- `src/daemon/agentProcessEnv.ts` 在启动 runtime 前剥离全部宿主级 `KITH_SPACE_*`、IPC 和端口变量，再只注入当前 agent 的 server URL、id 与短期 token；agent 无法取得 Worker/Desktop 控制凭据。
- `/api/desktop/browser-access` 与 `/api/desktop/settings` 只对 Desktop 凭据开放；前者管理模式/端口/Token/会话，后者管理关闭行为/自启动，普通浏览器统一收到 404（`src/server/routes-api/browserAccess.ts:127`、`src/server/routes-api/desktopSettings.ts:10`）。

### 6.4 LAN 限制

LAN 模式允许完整产品操作，因此默认关闭。首次启用显示明确警告：v1 HTTP 未加密，只限受信任私网，禁止端口转发或公网暴露。手机/平板不是 v1 支持客户端。

邮箱、浏览器等摄入不可信内容的模块上线前，必须完成 HTTPS 与 runtime 审批/沙箱升级。访问 Token 不能替代传输加密或 runtime 权限隔离。

## 7. 编排与护栏

agent-to-agent 分派继续经过统一 dispatch 收口。现有深度上限、唤醒预算和急停 guard 保留；任务 report/delivery 只写本地状态，不伪造唤醒消耗。Local Runtime Worker 虽然唯一，所有 start/deliver/stop 仍必须经过 Space、agent、频道成员和任务作用域校验。P-A8 的响应策略位于这些 guard 之后：它可以进一步决定不自动唤醒，但不能授权原本不可达的 Agent；明确任务指派可以绕过响应模式，却不能绕过 dispatch 深度、预算或急停。

默认 autopilot 与 plan-first 软闸保持不变。未来 usage 预算依赖 Runtime 契约 v2 的统一 usage 回调，不在 adapter 中分别堆业务判断。

## 8. 前端模块边界

- `WorkspaceFrame` 组合路由、常驻 `WorkspaceNavigationRail`、Messages 下的消息中栏、Chat / 业务模块主工作区切换、Settings 模态层和会话聚合面板，不承载文件、话题、任务或 agent 数据查询；频道设置的场景状态、脏表单退出确认、焦点恢复、`beforeunload` 与 `popstate` 历史保护集中在 `useChannelSettingsScene`。频道设置在可用时占用 Chat 右侧聚合面板，空间不足时把同一个组件交给 Chat 右侧抽屉，并在场景退出后恢复此前挂载的聚合内容。
- `workspaceLayout.ts` 只表达 Chat、模块与 Settings 选择；展示层把普通模块映射为右侧主卡片替换，把 Settings 映射为模态层。
- `paneConstraints.ts` 以消息中栏与主 Chat 合计 `568px` 为绝对下限，并计算 300px 会话聚合面板目标宽度；宽度不足时临时隐藏聚合面板并保留意图。业务模块替换 Chat，不再参与多 Pane 宽度计算。
- `workspaceModules.tsx` 当前注册 Home-only Spaces、Inbox、Tasks、Agents、Settings 与非侧栏的 Search；`sidebarModulesForSpace` 用稳定 `isHome` 选择 Home/普通侧栏集合。Computers/Machines 与 Dock 已退出模块注册和活跃壳层。Settings 的安装级“外观”分区由 `web/src/views/appearance-settings/AppearanceSettings.tsx:56` 组合 shadcn Field/Select，并通过 `web/src/appearanceFonts.ts:42` 只映射根节点字体 Token；它不把设置状态继续堆进 `misc.tsx`。
- `ChatWorkspace` 只管理消息中栏、Chat 和响应式设置抽屉；业务模块打开时整个 ChatWorkspace 退出，只保留最左侧图标栏。旧“会话 / Chat / 轨迹”工具条与全局轨迹栏已删除。`ConversationAggregatePanel` 以窄 props 接收当前 `conversationId`、轨迹节点、关闭/导航回调和可选设置场景；其52px标题栏直接调用壳层的既有 `toggleAggregate`，不复制聚合开关状态。设置打开时原三个 Tab 内容保持挂载并以 `hidden` 隐藏，因此文件分类、关键词和搜索展开状态不会丢失。轨迹、话题与文件仍由三个子视图各自负责，只有 `conversationId` 改变时由 keyed 子视图重置。`web/src/components/SlidingTabs.tsx` 以同一滑块底板分别导出 radio 语义的通用分段控件与 tab 语义包装，聚合面板、Agent 默认响应模式和消息 Agent 卡片共享选中动画、键盘遍历与视觉 Token；聚合面板只在自己的CSS作用域内覆盖轨道圆角、底板投影和字号，不复制第三套分段交互。`components/SearchField.tsx` 统一 Agents 与会话文件的搜索输入、清除和焦点行为，页面只保留各自的筛选状态与展开动画。业务模块不能直接操控 Chat 内部状态。
- 消息表现层位于 `web/src/views/chat-message/`：`ChatMessageItem`、`MessageHeader`、`MessageToolbar` 与 `MessageTopicPreview` 只组合头像、发送者行、气泡、工具 slot、气泡下时间和独立话题预览卡片，不读取 Store、Router 或直接发 API；sender type 到 Human/Agent tone 及 surface 映射留在 `messagePresentation.ts`，相邻消息分组由 `messageGrouping.ts` 的纯函数按发送者、日期和消息类型判断。工具栏位置仍只在气泡进入 hover/focus 时读取一次矩形，不建立逐消息监听；Agent 比较气泡右侧空间，Human 比较气泡左侧空间，足够时放在对应侧边，否则放到气泡上方。气泡下 `HH:mm` 时间用纯 CSS 随当前消息 hover/focus 显隐，不引入 React 状态。消息专用 Token、36px 头像、26px 链尾/6px 组内间距、1040px 居中流宽、右对齐 Human `#e7f0fe` 气泡、左对齐 Agent `#f5f5f5` 气泡、16px 气泡圆角、工具栏/菜单表面、话题回复预览和窄宽度规则集中在 `chatMessage.css` 与全局菜单样式。频道 Agent 保留18px常规字重身份行，私聊由组合层隐藏重复昵称并让气泡与头像顶部平齐；话题分栏通过壳层偏移从52px当前会话标题栏下方开始，主标题栏利用 `--chat-thread-occupied-width` 跨过 divider 和话题宽度，因此展开前后右侧操作按钮位置不变且底部分割线连续。话题工具栏固定为44px紧凑高度，父消息容器保持透明，话题消息复用对称边距并让 Agent 气泡填满可用内容列。`threadPreviewApi.ts` 独立封装父消息 ID 批量元数据请求；`GET /api/channels/:channelId/threads?parentMessageIds=…` 在原有 `replyCount / unreadCount / followed / lastReplyAt` 上增加按 seq 排序、排除 system 事件后的最近三条 `previews`（`id / senderType / senderId / senderName / content / createdAt`）；`replyCount` 仍表示话题全部回复，不增加表、路由或逐话题请求。P-A9.5 进一步把请求包装收口到 `web/src/features/conversation/data/`，把消息分页/实时状态、话题面板与视口行为分别收口到 `useConversationMessages`（`web/src/features/conversation/model/useConversationMessages.ts:39`）、`useConversationThreads`（`:47`）和 `useConversationViewport`（`:51`）；首屏 page signal 同时携带初始 thread metadata，消息与该 metadata 都完成（metadata 失败则按可选空结果降级）后才解除 loading，保持提取前的可见提交语义。`Chat.tsx:231` 现在只组合这些语义模型、既有交互状态与表现层，不直接持有通用 API 或 Socket 生命周期。归档与 Showcase 的统一只读边界继续约束所有写动作，URL、视觉和交互语义保持不变。
- 频道设置拆在 `web/src/views/channel-settings/`：`ChannelSettingsPanel` 只编排首页、常规、成员、通知、脏状态返回/关闭与数据装载；生命周期入口和精确名称删除确认分别由 `ChannelSettingsIndex` 与 `ChannelDeleteDialog` 承担，新增 agent 选择弹窗由 `ChannelAddMemberDialog` 独立负责。成员页从 Store 接收唯一 Human 资料而不伪造“你”为名称，移除 agent 复用全局危险操作确认；`# all` 继续由 API 硬保护，但设置首页显式渲染禁用删除动作来解释限制。归档频道的 active/store 分离由 `ArchivedChannelGroup` 和 Store 负责；Chat 只解析当前频道是否归档，渲染带直接恢复动作的只读 banner，并把只读状态下传到消息、话题和成员入口（`web/src/views/ChatSidebar.tsx:78`-`:85`、`web/src/views/Chat.tsx:255`-`:280`、`:581`-`:599`、`:626`-`:715`）。
- P-A8 前端把默认设置与频道覆盖保持为两条清晰边界：`web/src/views/agent-response-mode/AgentDefaultResponseModeCard.tsx:14` 只修改当前 Space 的 Agent 默认值；`web/src/views/agent-response-mode/useChannelAgentResponseModes.ts:28` 只负责每频道一次装载、实时失效与频道覆盖写入。消息侧点击入口位于 `web/src/views/chat-message/AgentMessageCard.tsx:36`，从 `Chat.tsx` 接收已加载的 Agent/频道 DTO 和更新回调（`web/src/views/Chat.tsx:354`、`:897`），卡片本身不读取 Store、Router 或直接请求 API；其三段式控件只写当前频道覆盖，并提供恢复为 Agent 默认，绝不修改 Agent 默认值。话题复用父频道有效值，DM 不渲染频道模式，归档只读；`channel-settings/` 成员页不复制编辑器。Composer 的多 Agent 任务检查由 `web/src/views/composerTaskMentions.ts` 独立解析，频道全体 token 的识别与候选匹配由 `web/src/views/composerChannelAllMention.ts` 承担；动作菜单、附件预览和文本宽度驱动的紧凑/展开状态分别收口在 `web/src/views/composer/ComposerActions.tsx`、`ComposerAttachments.tsx` 与 `useComposerExpansion.ts`，`Composer.tsx` 只组合这些窄组件并保留发送语义。
- URL 是当前主卡片或 Settings 模态层的事实来源。会话始终使用规范 `/s/:slug/channel[/<channelId>]` 或 `saved` 路径；Spaces / Inbox / Tasks / Agents 统一生成 `module=<id>&chat=0` 并替换 Chat，Settings 统一生成 `module=settings&settings=<section>` 并覆盖 Chat。`taskScope`、`agent`/`agentTab`、`settings` 分别表达模块资源；`appearance` 是合法 Settings section，未指定或传入旧/未知资源时统一归一为 `human`。
- 切换频道或 Human-Agent DM 时保留当前 active module、Chat 显隐和该模块拥有的 resource query，同时丢弃旧会话的 `msg`/`thread` 等临时聚焦参数（`web/src/shell/workspaceRoute.ts:180`）。这样模块上下文跨会话导航保持稳定，旧消息焦点不会泄漏到新会话。
- Thread 批量元数据同时返回单一 Human 的 `followed` 状态；`useConversationThreads` 将其作为受控状态交给 Thread 面板，并通过既有 `follow` / `unfollow` 接口切换，关注切换与面板关闭保持为两个独立行为。
- 聚合面板的话题索引不从前端消息分页推导。`GET /api/channels/:channelId/thread-summaries` 复用会话可读权限并调用 `src/channels/threadSummaries.ts:22`，返回当前频道或 DM 的全部未删除 thread、父消息摘要/发起者、回复数、未读、关注与最近活动时间（Transport 映射见 `src/server/routes-api/channels.ts:163`）。首次创建空 thread 与后续回复都经 `src/channels/threadModule.ts:20` 或消息 Module 发布 `thread:updated`，使已挂载的话题索引立即失效重取。内部实体、API 和 query 继续使用 `thread`，只有用户可见术语改为“话题”。会话文件查询在原 100 条边界内联查 `sourceMessageText`，避免前端逐条补请求。
- Worker 给 `agent:activity` / `agent:trajectory` 事件标记 `scoped | unscoped | ambiguous` 和实际 `channelId`；同步投递失败会用 schedule token 精确回滚自己的作用域，不能污染下一轮（`src/daemon/agentManager.ts:357`-`:383`、`src/daemon/trajectoryScope.ts:77`）。Core 对同一 Worker 连接的消息使用串行队列，确保 trajectory 数据先于随后到达的 terminal activity 边界处理（`src/server/ws.ts:55`、`src/server/workerMessageQueue.ts:1`）；随后校验该 channel 属于当前 Space，并把 thread 逐级归一为父 `conversationId`（`src/server/trajectoryScope.ts:61`）。Socket 透传作用域，Web Store 只把明确 `scoped` 事件写入 `trajByConversation[conversationId]` 的独立 300 条缓冲，Space 切换清空全部桶（`web/src/store.tsx:43`、`:370`-`:395`）。无作用域或 ambiguous 事件仍可进入 Agent 活动流，但不得出现在任何会话聚合面板。
- `MessageContextSnapshot` 在发送时固化 Space、会话、模块、Context Stack 和 focused item，adapter 再编码为各 runtime 所需格式。

Home Spaces UI 只负责卡片、搜索、创建入口和同窗导航；路径规范化、`.kith` 校验、homeSpaceId 与 registry 摘要属于领域服务。规范 URL 是 Home 当前会话路径上的 `?module=spaces`；普通 Space 收到该 query 时移除它。从任意 Space 打开全局空间入口时导航到 Home Spaces，而不是创建第二壳。

H4 已把完整生命周期入口移入 `web/src/spaces/SpacesModule.tsx`：它过滤稳定 Home 身份，展示真实普通 Space 卡片，并提供搜索、刷新、默认创建、已有目录接入、失联重连和同窗导航。卡片操作菜单拆到 `SpaceCardMenu`，重命名表单由 `SpaceRenameDialog` 承担；`PATCH /api/spaces/:id` 继续同步 app.db 与 Space 内身份，新增 `DELETE /api/spaces/:id` 只调用领域服务注销非 Home registry 并关闭数据库连接，不删除 Space root。收藏仅是 Web 客户端 localStorage 排序偏好，不进入跨设备/跨客户端领域模型。`SpaceSwitcher` 只保留快速切换、应急重连和进入 Home Spaces；展开时继续刷新 registry root 状态。Desktop 表单通过 sender 校验后的 preload 窄桥调用 Electron 原生 `openDirectory` 对话框；文件管理器操作通过同一 sender 校验后的窄桥调用 Electron `shell.openPath`，浏览器模式不暴露任意主机路径打开能力。授权浏览器通过 gate-1 的 `GET /api/host-directories` 调用 `src/spaces/hostDirectoryBrowser.ts`，只枚举主机目录及导航元数据，不返回文件内容，且无论来源如何，选中的路径都必须通过既有 Space root 校验。创建与接入使用 `SpaceFolderDialog` 模态弹窗，浏览器目录 UI 独立位于 `HostDirectoryPicker`。路由只激活 `ready` Space：失联深链规范化到可用 Space；如果全部注册项都失联，Store 外壳内的 `SpaceRecovery` 仍可调用同一 relocate 服务，避免 skeleton 死锁。普通 Space 的 `module=spaces` 会被规范化回 Chat。

Desktop 专属设置通过 `window.kithDesktop` 窄桥注入，不靠仅隐藏按钮实现安全；服务端同时拒绝普通浏览器调用。Windows 打包态可调用 Electron 系统自启动接口，开发态通过 `launchAtLoginSupported: false` 明确禁用该控件。

A3 已把 Web bootstrap 改为 Cookie 会话探测（`web/src/browserAuth.ts:20`）；未授权浏览器只渲染 `AccessTokenGate`（`web/src/views/AccessTokenGate.tsx:4`），不先渲染工作区。客户端不保存 Human Bearer/localStorage JWT，Socket 握手只携带 `spaceId`，附件/头像 URL 不携带认证查询参数。

A5 后 `web/src/App.tsx:4` 只渲染 `WorkspaceFrame`。Landing、Features、旧 `Layout`、`?legacy=1`、SSR/prerender、PWA/营销元数据和公开营销资产均已删除；静态入口只服务共享产品壳与规范 Space 路由，不再维护独立 Web 营销面或旧界面回退。

## 9. 开发与发行

Electron 固定为 43.1.0，electron-builder 固定为 26.15.3，`@electron/rebuild` 固定为 4.2.0（`package.json:122`、`:128`-`:129`）。`pnpm run desktop:dev` 先执行 `desktop:build`，再由 Electron 统一启动 Core、唯一 Worker 和开发期 Vite；它是完整开发宿主。全新 app data 会在 Electron 内显示首次初始化页，完成后进入 Home，正常 Desktop 开发启动不再以 `pnpm run seed` 为前置。`KITH_SPACE_HOME` 只隔离 app data；测试若不能显式提供 Space root，必须同时设置 `KITH_SPACE_SPACES_DIR` 或直接提供 rootPath，绝不能在真实 `~/Kith-space` 生成 fixture。仓库内部仍保留 `server`、`daemon`、`web`、`browser-access:dev` 与 `dev:e2e:up` 作为分进程调试入口。

发行脚本在 `package.json:43`-`:46` 固定为四层：

1. `desktop:build`：`scripts/build-desktop.mjs:10`-`:31` 仅生成 Electron main/preload CJS。
2. `desktop:bundle`：先构建 `web/dist`，再以 production 模式生成 main/preload、Core CJS、Worker ESM 和 agent CLI ESM（`scripts/build-desktop.mjs:33`-`:72`）。
3. `desktop:pack`：生成 `dist/desktop/win-unpacked`，用于 packaged smoke。
4. `desktop:dist`：生成 x64、per-user、assisted NSIS 安装器；electron-builder 的文件、`extraResources`、asar、`npmRebuild=false` 与 NSIS 约束位于 `package.json:57`-`:108`。

`scripts/package-desktop.mjs` 会先在源码树刷新production bundle，再创建只含锁文件、package metadata和待打包资产的一次性staging project。staging按锁文件以copy导入方式安装完整构建依赖，`@electron/rebuild`和electron-builder都从staging自身解析并只在那里运行，electron-builder仍只收集production dependency，输出写入源码树`dist/desktop`；`finally`只需删除staging，开发树`node_modules`与pnpm store的Node ABI不会被改写。2026-07-25 Windows实跑`desktop:pack`成功，打包前后开发树`better_sqlite3.node` SHA-256一致。旧 Docker/compose/Railway、环境样例、prod 脚本、公共 daemon package、npm/OIDC 与 docs-site workflow 已删除；pnpm workspace 只有根目录和 `web/`。

`.github/workflows/desktop-release.yml:1`-`:40` 仅支持手动触发 Windows x64 构建，并上传未签名 installer artifact 14 天；它不创建 Release、不签名、不自动发布。本地最终安装器 `dist/desktop/Kith-space-Setup-0.1.0-x64.exe` 为 113625983 bytes，SHA-256 `D314DAE15A8E9AB598901D2E3DF8B90DE1C7B46E79824CC8575BD4C742B89646`，Authenticode `NotSigned`。最终 unpacked Desktop smoke Exit 0、`app.db` 创建、残留进程 0、端口监听 0；packaged Core、内置 Web/Drizzle/CLI 与优雅退出也已 smoke。真实 NSIS 安装/卸载尚未执行。公开分发前必须配置 Windows 代码签名证书并补齐安装流程验收，不能把可复现的未签名 artifact 描述为已签名或已发布。

Windows Desktop 是 v1 唯一正式发行物；系统能力选型不得无必要绑定 Windows，为 macOS/Linux 留出实现空间。

## 10. P-A9 模块化单体最终边界

### 10.1 进程拓扑不变，代码所有权已收敛

P-A9 保留 `Electron Desktop -> Core Service -> Local Runtime Worker -> 外部 runtime` 拓扑。Core 为 sandboxed renderer、授权浏览器和 Agent CLI 提供同一份本机权威；Worker 隔离外部 runtime 进程、每 Agent 顺序和安装级容量。业务逻辑没有移入 Electron main，也没有为了“去 server 化”取消本机 Core。

`src/server/` 现在只承担组合根、认证、HTTP/Socket 解析、错误/DTO 映射和 Production Adapter。消息、任务、Agent、频道、文件、Space 与 Runtime 控制分别位于领域目录；`scripts/p-a9/module-dependency-guard.mjs` 直接拒绝 `src/{messages,tasks,agents,channels,files}` 对 `src/{server,desktop}` 的生产依赖，P-A9.7 已删除临时 allowlist 机制与所有旧 facade。`src/server/core.ts` 已从 1412 行降至约 911 行，保留组合与 Transport 协调；`src/server/routes-agent.ts:59` 已成为 87 行的 Agent data plane 分组路由，不再直接访问数据库。

### 10.2 深 Module 与窄 Transport Adapter

- `src/messages/messagePostingModule.ts:95` 暴露 `MessagePostingModule`，`createConversationModules`（`:267`）组合 Message/Task 用例。无写入 preflight（`:356`）先完成权限、作用域、mention、任务与附件校验；同库事务再原子提交 seq、消息、dispatch chain、follow、附件、membership、mentions、频道时间，以及可选任务、system audit 与 assignment chain。实时发布和 Worker wake 是明确的 post-commit effect，失败不会回滚已提交事实，也不会产生半提交业务行。
- `src/tasks/taskLifecycleModule.ts:62` 封装 convert/claim/unclaim/assign/status 生命周期，repository 只实现同库写入，HTTP、Agent API 和消息创建均复用同一领域语义。任务 system audit、dispatch chain 与 membership 和任务状态在同一事务提交，实时发布与 wake 通过窄 sink/port 执行。
- `src/server/agent-http/` 按 messages/context、channels/threads、tasks、actions、files、profile/space、reminders 分组；`routes-agent.ts` 只认证、构造 context 并依次派发。频道成员、话题摘要、Agent scope/响应设置、删除与本地对象存储分别归入 `src/channels/`、`src/agents/` 和 `src/files/`，不再经 server facade 反向依赖。
- SQLite 与本地文件系统仍是可在临时目录真实替换的进程内依赖，不为每张表建立 Repository Interface；公开 Module Interface、事件 sink、wake port 和 in-memory/fake Implementation 是主要测试 seam，不引入通用 DI 或事件总线框架。

### 10.3 Core/Worker admission 与持久重放

Core→Worker 通过 `src/runtime/contract/runtimeWorkerPort.ts` 的窄命令契约和 `src/runtime/control/runtimeWorkerAdapter.ts` 的 Production Adapter。每条 start/deliver/stop/sleep/reset 都携带稳定 command/delivery ID 与 Worker generation；`requestWorkerAdmission`（`src/local-runtime/workerHub.ts:134`）等待匹配当前 lease 的 `admitted | queued | rejected` ack，重复或过期 ack 幂等，`ws.send()` 成功不再被解释为已接纳。

Wake 使用 `src/server/dispatchGuard.ts:173` 的持久 get-or-reserve 逻辑键复用 reservationId；accepted/queued 后 commit，明确 rejected 时 release，断线或 ack 不确定时在新 lease 重放同一 reservation。重复命令、ack 与 reconnect 不重复增加 wake count，Agent check/read 推进 `lastReadSeq` 后关闭未读重放窗口。这个边界只保证接纳确认和未读重放，不声称 Agent 已读后、回复前崩溃的端到端 exactly-once；turn completion 仍属于尚未开始的 Runtime 契约 v2。

Worker 内 `src/runtime/worker/runtimeAdmissionController.ts:48` 维护安装级容量 4、最大队列 128 和 120 秒 TTL，保持同 Agent 命令顺序，并以 required/生命周期优先、等待老化和跨 Agent 公平选择队列；stop/reset/sleep、session exit 和 shutdown 都精确释放或排空。AgentManager 在既有消息合并边界登记实际 batch turn，并用 adapter 已有 `online/error` activity 结算：没有排队工作时完成会话继续保温，一旦其他 Agent 等待容量就立即 sleep 并释放 slot；尚未完成的批次会阻止上一轮结束时误休眠。该 idle hint 不新增跨 Core/Worker 的 turn-complete 协议或 turn 级 admission，Runtime 契约 v2 边界不变。Core 只有在手动启动实际 `admitted` 后才写入 active/working；failed/cancelled/expired wake 的终态带回 channel/stream，由 Core 结束对应回复占位并保留待重试 wake。`src/daemon/index.ts:75` 拒绝缺少 admission identity 的旧 raw 生命周期命令，P-A9.7 已删除 `agent:deliver:ack` 等兼容路径。

### 10.4 Chat 组合层与证据驱动性能

`web/src/views/Chat.tsx:231` 现在组合 `conversationApi`、`taskApi`、`useConversationMessages`、`useConversationThreads`、`useThreadPanelModel` 与 `useConversationViewport`；请求包装、分页/实时失效、话题状态和视口行为分别由 `web/src/features/conversation/data/` 与 `model/` 所有。相关交互状态仍保持局部，切换会话/话题时重置语义、URL、视觉与现有操作不变；Chat 不再直接持有通用 API 或 Socket 生命周期。

P-A9.6 只优化冻结基线可复现的路径：频道 membership 和响应设置批量查询、wake target 批量解析、跨 Agent admission 并发而同 Agent 顺序不变，并在无 `@` 时跳过 mention 解析。1/5/10/20 Agent 的最终 Core 总 p95 为 3.489/9.632/14.661/50.481 ms，SQL 为 18/46/81/151，20 Agent 仍低于 120 ms SLO；1/5/10/20 的 Runtime admission 三轮中位数为 0.213/0.496/0.574/0.342 ms，均低于 25 ms SLO。统一事务让 20 Agent durable-prefix 相对 P-A9.0 增加，但绝对值仍低于 10 ms，这是 P-A9.1b 为原子一致性接受并单独记录的权衡。Chat 同口径回归的首次可见 median p95 为 62.8/65.2/62.4 ms，全量滚动为 70.6/311.5/621.9 ms，均通过绝对 SLO 且对应 median p95 相对冻结值未退化超过 10%；因此没有引入列表虚拟化或视觉改动。完整数据、统计口径和波动说明见 `../performance/p-a9-baseline.md`。

当前主栈继续是 TypeScript / Node / Electron / React / SQLite；`better-sqlite3` 已包含原生数据库实现。没有证据触发 Rust 决策门，也没有启动全量或局部 Rust 重写。

### 10.5 完成范围与后续边界

P-A9.1a-P-A9.7 已按 Message/Task、同库事务、Agent Transport、领域依赖、Runtime admission/session 容量、Chat 控制层、证据驱动优化和兼容清理顺序完成。旧 Implementation、失效 facade、临时 allowlist 和 admission 兼容路径已删除；公开 URL、Agent CLI、workspace schema、Electron/Core/Worker 拓扑和产品交互未改变。契约矩阵及删除证据见 `../architecture/p-a9-contract-matrices.md`。

在 P-A9 收口时，Runtime 契约 v2、H5、Message Context Snapshot、Rust 试验、公开 Web/H5 产品化和 UI 重做均未开始，因此不得被解释为 P-A9 的隐含交付；其中 Runtime 契约 v2 与 Message Context Snapshot 后续已由 P-A10 完成，H5 等其余边界仍未开始。阶段验证和当前唯一续接状态以 `../progress.md` 为准。

## 11. P-A10 Agent Harness v2 边界（P-A10.0–P-A10.7 已实现）

P-A10 在 P-A9 深 Module 与 Worker admission 地基上增加一层 runtime-neutral Agent Harness，不改变 Desktop/Core/Worker 拓扑：

```text
Message / Task durable fact
  -> response policy
  -> same-transaction AgentDeliveryItem
  -> Delivery / Turn / Attempt Modules
  -> Context Assembler
  -> WakeDispatchPort / Worker scheduler
  -> per-surface RuntimeSessionV2
  -> session-bound capability broker
  -> MCP/CLI Capability Gateway
  -> Message/Task/Memory Module
  -> SQLite + realtime UI
```

目标职责：

- `DeliveryModule`：Message/Task事务逐Agent持久delivery item、触发时policy、来源cursor owner与dispatch wake binding；post-commit失败可扫描恢复；
- `SessionModule`：以 `(spaceId, agentId, surfaceKind, surfaceId)` 持久 per-surface engine session generation、runtime/config fingerprint、snapshot 和 idle/evicted/resume 状态；Chat cursor继续归来源membership，不在session复制；
- `TurnModule`：把未绑定delivery items冻结为logical turn，为每次执行追加带Worker generation/lease的attempt；lease heartbeat与broker expiry同步，stop/reset使用cancel并重开未结input。operation/output/逐输入obligation原子实现reply/cede/fail finalize、mention+dispatch chain/depth与分页join cursor结算；
- `ContextAssembler`：构造并审计 root、as-of parent snapshot、当前 batch、object snapshot、episodic recall 和文件 memory refs，不把全部历史无界拼入 prompt；
- `MemoryModule`：保留三层文件记忆，另以 canonical item + immutable revision + typed evidence/relation/suppression、continuity bundle和中文2/3-gram/FTS提供Agent episodic memory、advisor、Human manage/Agent recall/debug三view；
- `CapabilityGateway`：让MCP与受控CLI调用同一领域Interface；常驻runtime通过session broker激活当前attempt，不在固定env保存per-turn bearer；turn capability固定output surface、input IDs、seen watermarks、scope、expiry和披露投影；
- `RuntimeV2 Adapter`：只统一session/attempt、usage、tool、completion、cancel、MCP bootstrap、context metadata与compaction telemetry，不统一Claude/Codex/opencode的内层transcript/summary schema。

目标数据已按四期迁移：workspace schema v6增加harness cutover、runtime session、delivery、logical turn/attempt、operation/output、context、capability/disclosure、checklist和short wake；v7增加episodic canonical/revision/evidence/relation/tag/suppression/mutation与normalized FTS；v8增加restricted advisor control plane、recall observation，以及session checklist/snapshot/compaction单调revision；v9增加精确Provider/Model consent、job执行快照与`advisor_provider_runs`。app.db v3以独立表族承载user-global structured memory，v4修复其复合revision外键，v5增加系统Provider控制面。`agents.session_id`和`agent_activity_log`仅在兼容期保留；v2按Agent互斥cutover且不把旧全局session backfill到任意surface。Core继续是SQLite唯一业务写入者；Worker只持可重建process/session/broker handle并向Core上报normalized event/非权威snapshot。

P-A10把公开频道从“未加入也可读正文”收紧为“可发现、加入后读取/参与”，私有频道继续只对成员可见；跨频道原文不自动注入，Agent通过ACL查询、continuity/query recall和canonical/internal/shareable/ref disclosure projection获得连续性。Human顶层direct mention默认由服务端原子创建root/thread/membership/delivery并把Agent reply target锁定为该thread；silent可加入但不wake。普通thread每次同时校验父频道，撤权同步失效membership/session/capability。

P-A10.2的Worker terminal本来已携带`spaceId`，event现同样在外层携带admission Space；`src/turns/turnTargetLocator.ts`只在该Space内核对turn/attempt/session，不再为一个终态eager打开全部registry。`availableSpaceDbs`专供安装级ready/offline、Agent/object lookup与reminder等后台扫描，逐Space跳过missing/error/incompatible项；针对明确Space的业务调用仍使用`dbForSpace`并fail closed。因此一个失联或损坏Space不能阻断健康Space的event ACK、terminal ACK、reply或trajectory。P-A10.3由`src/messages/messagePostingModule.ts`与`src/turns/turnOutputService.ts`原子建立direct-mention root/thread/membership/delivery；mixed cutover按目标mode把v2送入DeliveryJournal，legacy仅在同一output事务通过共享响应模式/水位线判定后，才由`src/dispatch/dispatchReservation.ts`写actionable reserved wake并由Conversation Module执行/重启扫描恢复；设置或mode在post-commit后变化为确定性no-wake时，scanner原子退款chain budget，migrating留给cutover backfill。`0006_legacy_dispatch_recovery.sql`为该scanner增加`(status,created_at)`索引。`src/context/contextAssembler.ts`只在已绑定frontier内、逐次ACL复核后冻结可审计Context Envelope并以app.db v2安装级key生成lineage HMAC，`src/turns/turnLedger.ts`按保守8k required预算绑定连续前缀、把尾部留给下一logical turn。`src/channels/agentSurfaceAccess.ts`、`channelAgentAccessRevocation.ts`与`taskScopedAccess.ts`提供逐调用父级ACL及Human移除、Agent leave、task release/reassign/终态/自然到期的同事务撤权；DB提交后再关闭broker handle并取消Worker attempt，过期grant在admission前或运行中heartbeat越界时关闭。`src/turns/turnInspector.ts`与`web/src/views/chat-message/TurnDetailsButton.tsx`提供Context/Steps/Usage/Outcome、tombstone和真实injection state视图。`turn.reply`以output-surface watermark确定性拒绝later Human/other-Agent消息。

P-A10.4由`src/capabilities/capabilityGateway.ts`集中承载context refresh、conversation/turn查询、checklist、short wake、progress和Task工具；`src/capabilities/gatewayClient.ts`被`src/server/mcp/stdio.ts`与`src/cli/index.ts`共同复用，两个Transport Adapter不拥有业务规则且reply/cede直接复用冻结的canonical strict schema。Task写通过`src/capabilities/taskGatewayPort.ts`窄端口回到既有Task Module，不让capabilities层反向依赖`server/core.ts`；custom Agent scopes决定claims中的reply/task/message query能力，required turn缺少`message:send`时在admission前失败。所有JSON POST在1 MiB有界解析后授权，每个领域写事务内通过共享precondition原子复核activation、attempt lease、generation、实时scope与surface ACL。Core单写进程对同operation single-flight；create/report/deliver使用operation ID作为确定性message ID精确reconcile，状态mutation重放既有Task Module幂等语义。`src/server/turn-gateway/routes.ts`只做loopback transport、schema解析和broker授权。v2附件先写入按turn/activation/owner/server-owned surface绑定的一小时临时行，reply事务同时绑定message；`0007_temporary_attachment_lifecycle.sql`保存temporary/deleting/bound、owner与expiry，`src/files/temporaryAttachmentCleanup.ts`原子claim过期行并清理文件，还按文件mtime回收文件先落盘、DB未提交的崩溃orphan；25 MiB超限或同批任一失败均删除本批对象。跨disclosure domain的private/DM read在P-A10.5前只返回`ref_only`并按真实projection审计，search只检索可canonical披露的domain。`src/runtime/worker/sessions/runtimeSessionPreparation.ts`按实际文件存在性选择`mcp_with_cli_fallback`、`mcp_only`或`cli_only`，再用真实stdio/list-tools探针验证launch；失败时仅在CLI可执行时降级，否则在runtime启动前返回`mcp_bootstrap_failed`。Claude以`--mcp-config --strict-mcp-config`、Codex以app-server config、opencode以local MCP config注入同一stdio server。`turn_started`在runtime启动前由Core确认，实际MCP/CLI调用更新有界transport诊断。later-query source与surface watermark追加到turn audit而不改写原Envelope；checklist与wake写操作复用turn operation ledger，wake保存原始业务幂等键并由session级唯一约束跨turn去重，到期后按同session generation和当前ACL创建一个新的durable trigger。manual start只经`src/deliveries/inboxSummary.ts`返回逐surface计数，不汇总正文。三家bootstrap在最终Desktop live smoke前保持`fixture_v2`，tool isolation、cwd relocation和compaction telemetry仍为unsupported。

P-A10.5由`src/memory/episodicMemoryService.ts`、`userGlobalMemoryService.ts`、`memoryLifecycle.ts`、`disclosurePolicy.ts`与`disclosureGrantService.ts`形成独立Memory Module。workspace v7保存Space内agent-private/space-shared canonical/revision/evidence/relation/tag/suppression/mutation/lexical/FTS，app.db v3引入Human手工提升的user-global同构表族；v4 runner接受已知早期v3 journal变体，先验证无orphan，再临时关闭连接FK、在单事务内复制/重建四张revision关联表、校验完整复合FK与`foreign_key_check`并恢复原FK设置，当前v5在其上增加独立Advisor控制表族。current revision/evidence/relation由复合FK约束，mutation按actor+idempotency key唯一。Human REST位于独立`routes-api/memories.ts`，可读取历史revision/relation和解除suppression；Agent的`memory.recall/get`由`knowledge:read`映射到同一Gateway。两库先各自取候选，再以相同lexical/continuity/importance/recency breakdown归一化重排；读取和最终reply逐次解析message/turn/file生命周期、跨Space membership/父级ACL与validity，任一source不可用即暂停整项。replacement relation让旧词/旧ID解析到当前item；跨surface只使用预存canonical/internal/shareable/ref投影。`ContextAssembler`冻结revision/HMAC/score breakdown/evidence/projection且recall故障fail-open，forget后只留HMAC tombstone。hard delete使用SQLite `secure_delete`并truncate WAL；Agent full reset/delete通过Memory lifecycle helper清理private payload/suppression而不碰Space shared。Human grant固定source/revision/target/action/TTL并由reply事务consume-once。

P-A10.6由`memoryAdvisorService.ts`、`memoryManagementService.ts`、独立advisor routes、`MaintenanceRuntimePort`和`web/src/views/agent-memory/`承担。advisor与user-facing runtime session物理分端口、无工具/MCP/CLI、ephemeral cwd并受typed validation、source cap、成本、backoff、lease、suppression和实时ACL约束；provider返回后与最终写事务内复核job/source/Agent生命周期，canonical、proposal与conflict relation原子提交，跨Space maintenance使用安装级有界队列。撤权item可由Human执行`retain_independent`创建manual revision，旧source只作审计且不恢复ACL；当前Claude受支持，Codex/opencode maintenance明确unsupported。P-A10.7由`sessionSnapshotService.ts`、`sessionCompactionMarker.ts`、Worker session host和Runtime Contract snapshot/compaction事件承担；snapshot按session/generation/checksum/64KiB门禁恢复，checklist/wake使用session单调revision，compaction marker从append-only turn event重建并在下一Envelope冻结后消费，Codex可映射compaction事件而Claude/opencode不伪造能力。Worker host对activity/thinking/text preview默认以250ms窗口按类合并，critical/terminal与所有结束边界前flush，caps只按实际转发事件计算；emergency stop在持久取消attempt后显式结束对应turn preview，Worker迟到terminal只作幂等ACK。`durableTurnRecovery.ts`在Core启动与周期扫描中只调用既有scheduler，恢复post-commit调度丢失而不复制wake budget或turn。workspace与user-global recall都失败时Context仍保留required batch并记录双路omission，受审计conversation Gateway继续可读；runtime usage event必须进入terminal结果再由Core持久，避免Steps有usage而Usage页为空。

完整类型、11条ADR、失败模式、NFR、P-A10.0-P-A10.7切片、P-A11/P-A12/P-S1后续边界和43个验收场景见 `../superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md`。P-A10.0 的 migration/contract/基线由 `src/app-data/appDatabaseMigrations.ts`、`src/db/spaceDatabaseCompatibility.ts`、`src/runtime/contract/v2/` 与 `src/memory/lexicalProjection.ts` 承担。P-A10.1 由 `src/sessions/sessionModule.ts`、broker、三家adapter bridge与Worker host承担。P-A10.2由`src/deliveries/deliveryJournal.ts`、`deliveryFrontier.ts`、`src/turns/turnLedger.ts`、`turnScheduler.ts`、`turnOutputService.ts`、`src/capabilities/turnCapabilityService.ts`、`src/server/turn-gateway/`和Worker `runtimeTurnController.ts`承担；`src/server/turnDispatchAdapter.ts`以窄端口复用既有dispatch guard。legacy Agent API、Worker event、reconnect和start在非legacy mode下拒绝；显式cutover先封锁新legacy HTTP请求并等待已进入请求drain。Runtime v2使用安装级Space FIFO和每Space/Agent有界批次，admission+execution总量受128上限约束，未activate admission 120秒过期；Core generation推进会取消旧preparing/running并停止旧terminal重传，shutdown最多等待10秒。terminal使用strict usage codec、128KiB envelope cap并重发到Core幂等ACK，event按64KiB单条、2000条/8MiB聚合上限与critical预留截断。runtime配置漂移退休旧turn并requeue到新session generation；rollback以副作用前的稳定acceptedAt授权。P-A10.3补齐逐调用实时membership/父话题ACL与撤权事务；P-A10.4在同一broker与operation ledger上完成MCP/CLI Gateway；P-A10.5完成revisioned episodic memory、disclosure/suppression和Context/Gateway recall；P-A10.6完成restricted advisor与Human面板；P-A10.7完成snapshot/checklist revision与可支持的compaction telemetry。

面向开发者与产品设计者的系统性机制导读见 `agent-harness-v2-mechanisms.md`；它用流程图、时序图和状态机说明上述模块如何共同完成一次真实 Agent 协作，不替代本节的源码事实或完整规格。

## 12. 系统级可替换 Memory Advisor Provider（已实现）

P-A10.6既有结构化记忆、recall、Human管理与validation/revision语义保持不变，自动提炼的执行选择已从聊天`agent.runtime`收敛为安装级`AdvisorProvider`。`legacy_runtime`仍保留Claude maintenance回滚路径；`provider_v1`让同一个受限Provider在Human逐Agent授权后处理Claude Code、Codex、opencode聊天Agent产生的eligible turn，聊天session、工具、模型与runtime配置均不被复用。

目标所有权固定为：Core的`MemoryAdvisorService`继续拥有eligible admission、evidence/ACL、suppression、预算、lease、schema、dedupe、conflict/disclosure、immutable revision和原子事务；Worker的Provider registry只负责能力探测和一次无状态结构化completion。Provider不是产品Agent，没有身份、频道membership、DM、消息发送、工具、MCP、持久session或数据库权限。新增Provider只实现descriptor/probe/complete窄接口及统一contract fixture，不复制Memory领域规则。

Provider设置、不可变revision和单调provider/revocation epoch属于安装级app.db，Agent enabled/paused、预算和单调consent epoch属于所属Space；跨库收敛不是一个SQLite原子事务，任一epoch不确定时不得执行或写回。Core用安装级`ProviderEpochGate`阻止设置切换插入最终epoch复核与workspace提交之间。每个job/run固定installation identity、execution adapter/完整性摘要、model backend、model、credential identity、canonical endpoint/allowed egress、data-policy、配置/能力digest、policy、source-scope与consent epoch；实际凭据通过单次、绑定run/epoch/Worker generation的短时activation handle交给Provider helper，不持久进job。Adapter在读取evidence和外发正文前先返回无正文`ResolvedEgressPlan`，未知或漂移fail-closed；调用后结果只作二次校验。旧`enabled=1`不等于云端外发consent，ACL可见但不在consent source scope的DM/私有正文也不得外发。Space搬到新机器后结构化记忆和recall继续可用，未完成job按installation identity阻塞，自动提炼等待本机配置与重新授权。

内置Provider精确锁定`@earendil-works/pi-ai@0.81.1`并设为fresh install默认，Claude Code保留为显式可切换Provider；既有安装保持`legacy_runtime`。Kith-owned `pi-advisor-helper.mjs`只通过锁定版本公开`createModels`、显式provider factory、`models.getModel`与`models.completeSimple()`完成一次调用，不实例化Pi AgentSession、agent loop、工具或资源发现，也不依赖系统已安装的Pi CLI。Provider与`Advisor Model Profile`正交：后者独立选择模型供应商、模型、API、thinking、endpoint、凭据来源与数据政策，切换聊天runtime或Provider均不默默换模型。

本机Pi CLI只作为可选配置/凭据来源。Human明确触发后，Kith纯数据解析器以真实路径、owner/mode、`O_NOFOLLOW`和同一FD前后`fstat`读取全局`settings.json`、`models.json`和选定provider的`auth.json`来源，生成脱敏不可变快照；不读取Space项目`.pi`配置，不加载extension/skill/session，不调用命令/env resolver、OAuth刷新、provider hook或写回。新安装“默认Pi”只设置Provider初值，没有兼容Model Profile、凭据、能力探测与per-Agent consent时仍保持setup且不读取evidence。实现模块位于`src/advisor-provider/`、`src/runtime/worker/maintenance/advisorRunController.ts`、`piSdkAdvisorProvider.ts`和`pi-advisor-helper.ts`；Advisor Provider基础控制面由app.db v5与workspace schema v9承担，当前总版本app.db v8/workspace schema v10在其上增加统一模型/runtime控制面、安装级外观字体设置和Space内Agent绑定。完整架构、数据模型、时序、迁移切片、失败模式、安全门禁和验收矩阵见`../superpowers/specs/2026-07-22-system-memory-advisor-provider-design.md`。

## 13. 统一模型/运行器控制面与 Pi Runtime（已实现）

2026-07-23 的后续目标把安装级配置拆为三个正交对象：

1. `ModelProviderConnection`：endpoint、API协议、凭据引用、数据目的地和能力；
2. `ModelConfiguration`：一个revisioned provider/model/reasoning能力快照；
3. `RuntimeProfile`：本机runtime可执行物、三态默认绑定和runtime专属选项；短寿命版本/能力probe独立缓存。

这些对象属于app.db，明文凭据继续只由CredentialPort持有，并加密保存在`<appData>/secrets/advisor-credentials.json`。普通文件、大小上限、同一FD读取前后身份与内容digest等门禁在三端保持不变；macOS/Linux通过`src/security/posixFileMetadata.ts`校验uid和group/world权限掩码，Windows通过`src/security/privateFileSecurity.ts`取得当前SID，在保留安全描述符非DACL元数据的前提下禁用继承、清空access rule并确定性写入当前owner唯一Allow规则，不依赖宿主相关的逐条`icacls /remove:g`行为，也不把Node合成的`st_mode`当成安全事实。任何其他主体的Allow ACE仍fail closed。既有Windows凭据会在首次读取时升级，任何收紧或复核失败都fail closed。运行器默认显式区分`kith_model_configuration | unmanaged_cli_native | unset`；CLI-native不可用于Advisor且不能冒充完整可审计配置。Space内Agent只保存`runtime_default | pinned`绑定意图、稳定配置ID/revision和最近由Human确认的非敏感provider/model/安装fingerprint；跨库不建立SQLite外键，目标机器缺失安装级配置或默认fingerprint变化时进入`confirmation_required/setup_required`，不静默使用该机器的其他默认模型。现有Advisor Model Profile保留为由Model Configuration编译出的内部不可变执行快照，继续服务job pinning、egress、epoch和consent，不再成为普通用户直接编辑的第二套模型对象。

Core新增窄`ModelProviderConnectionService`、`ModelConfigurationService`、`RuntimeProfileService`、`AdvisorBindingService`和脱敏presenter；Worker新增`RuntimeConfigCompilerRegistry`，按runtime把统一配置翻译为参数、child-only环境、Kith-owned临时配置和fingerprint。聊天runtime另有`RuntimeCredentialActivationPort`：Core只下发绑定session/generation/revisions/epoch/digest/expiry的无密钥descriptor，Worker通过Worker-only本机控制通道单次兑换，明文只短暂进入Worker内存和child env。安全相关配置变化先提升安装级`runtime_configuration_epoch`阻断旧admission，再撤销attempt/activation和关闭旧session，不能把异步`restart_required`当安全门。Claude Code使用启动参数/官方环境，Codex使用启动override或临时`CODEX_HOME`/profile，OpenCode继续使用`OPENCODE_CONFIG_CONTENT`，Pi使用Kith-owned`PI_CODING_AGENT_DIR`与RPC启动配置。Kith可显式、只读导入Pi/Claude/Codex/OpenCode安全配置元数据，但默认不修改任何用户CLI全局文件；未来写回若存在，必须是独立、显式、diff/备份/原子/可回滚的高级动作。

Agent启动 admission 同样 fail closed：除合法legacy绑定外，解析结果不是`ready`时，Core在创建/恢复runtime session之前直接拒绝。Human必须在Agent详情的独立绑定编辑器中重新确认当前默认fingerprint或选择固定配置；确认后才创建携带当前epoch的新generation，避免`restart_required`状态被一次普通“启动”静默绕过。

`src/runtime/adapters/piRpcRuntimeV2.ts`已把本机外部Pi CLI提升为第四家正式P-A10 v2 runtime：每个surface generation使用Kith-owned目录，strict LF + streaming UTF-8解析、correlated response、`get_state`、abort、usage、compaction和`agent_settled`终态均有独立fixture。启动固定禁用project/user extension、skill、prompt template、theme、context、更新检查和telemetry；snapshot只保存不透明session id与fingerprint。Pi通过既有`kith-space` CLI Gateway使用工具并诚实报告MCP unsupported，与内置Pi SDK Advisor的helper/session/activation完全分离。

app.db v6新增稳定连接、模型配置、runtime profile及其不可变revision、短寿命probe和脱敏CLI导入快照；v7 初始增加三类字体白名单字段，当前 v8 将其迁入独立 `appearance_settings` 单例并允许界面字体选择无衬线或等宽分组（`src/app-data/appDatabaseMigrations.ts:730`）。独立 `AppearanceSettingsService` 校验并部分更新（`src/appearance-settings/appearanceSettingsService.ts:33`），Human-authenticated `GET/PATCH /api/settings/appearance` 暴露安装级设置（`src/server/routes-api/appearanceSettings.ts:11`）。Vite 开发代理保留浏览器可见 Host，使 Core 的 Origin/CSRF 与 WebSocket 同源门禁继续成立（`web/vite.config.ts:26`）。workspace.db v10增加Agent模型绑定、跨安装确认快照与session runtime epoch，同时保留旧runtime/model/runtime_config作迁移输入。`model-control/`拥有领域服务与脱敏presenter，`runtime/config/`拥有四家窄compiler、单次凭据activation和fail-closed epoch gate。配置revision变化提升安装级epoch，旧session admission立即失效并由新generation生效；默认不写任何CLI全局配置。

模型来源控制面把供应商和其模型作为一个面向Human的编辑单元，但领域层仍保持`ModelProviderConnection`与`ModelConfiguration`两个独立revision对象。`ModelProviderBundleService`把一次弹窗保存收敛为一个runtime configuration change和一个app.db事务：进入写锁后才读取当前供应商/模型集合并统一预检删除占用，再原子追加供应商revision、增删改模型和提升epoch，排队的并发请求不会拿旧快照继续写，失败时不暴露部分状态；模型更新复制普通表单未暴露的reasoning、context、capability与options字段。编辑供应商时，只有backend/API/endpoint/network class/allowed egress均不变才允许留空并保留原CredentialPort引用；执行身份或目的地改变必须重新输入密钥，防止旧密钥被带到新endpoint。删除来源同样是软停用事务：若其任一active模型仍被runtime profile、Advisor或任一可用Space的active pinned Agent绑定则整体拒绝；软删除Agent不再占用模型，任一已登记Space不可访问则整个破坏性操作fail-closed；否则同事务停用供应商及其当前模型并提升epoch。disabled对象不再进入运行器、Agent或Advisor选择器，binding resolve也会fail-closed。供应商/模型CRUD接受已认证且通过同源Origin/CSRF门禁的浏览器；API Key额外要求Desktop trust，或peer、Host与Origin均为loopback且Origin与Host端口一致，本机浏览器可完整操作而LAN HTTP无法承载新密钥。

运行器安装由`local-runtime/runtimeSetupCatalog.ts`和`runtimeSetupService.ts`形成独立OS边界：Catalog只允许Claude Code、Codex、OpenCode、Pi四个固定包名/支持版本；Service分别探测可执行文件、版本和账号就绪状态，并只在Desktop trust下安装/删除`<appData>/managed-runtimes/<runtimeId>`。Worker启动时通过`withManagedRuntimePath`把这些bin置于自身PATH前部，因此Kith-owned副本可以优先于系统CLI但不会修改用户PATH。安装/删除按runtime串行，在同父目录完成staging验证后再替换，失败会回滚到原目录；删除先隔离目录并只在当前profile确实指向Kith副本时清空偏好，自定义可执行路径不会被覆盖。安装/删除后提升runtime profile revision/epoch并要求重启Worker；删除不触碰系统安装、CLI账号文件或全局配置。CLI探测与安装通过异步子进程执行，版本和账号探测可并发且不阻塞Core事件循环；同一安装根/PATH下的探测Promise短缓存30秒，强制探测仍受10秒single-flight冷却限制。超时进程先TERM、宽限后KILL并确定性结束请求。HTTP route只编排该Service，不执行任意命令或接受任意包名。
