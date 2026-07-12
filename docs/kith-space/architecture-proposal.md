# Kith-space 目标架构

> 本文描述 2026-07-11 个人 AgentOS 转向后的目标模块边界。A2 本地领域与数据模型、A3 浏览器访问安全边界、A4 Electron Desktop 宿主、A5 首次初始化与旧入口清理、A6 继承资产清理与 Windows 打包均已完成；下一工程阶段是 Runtime 契约 v2。产品边界见 `product-brief.md`，验收见 `mvp-spec.md`。

## 1. 架构原则

- Desktop 是唯一正式宿主和进程监督者，浏览器入口依附 Desktop 生命周期。
- 一个安装实例只有一个 Human、一个 Local Runtime Worker，可注册多个本地 Space。
- 不自研 runtime；Claude Code、Codex、opencode 通过 adapter 接入。
- 模块能力经 MCP 暴露，UI、HTTP、agent data plane 和 MCP handler 复用同一领域服务。
- app 级数据与 Space 级数据分库；文件和附件只存本地磁盘。
- 保留进程隔离、Space/路径边界、浏览器鉴权和 runtime 权限；删除多租户/RBAC 和远程主机抽象。

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

业务逻辑不进入 Electron main。`src/desktop/main.ts:249` 创建 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 的 BrowserWindow，拒绝权限请求、新窗口、webview 和白名单外导航。`src/desktop/preload.ts:3` 只暴露读取/更新 Desktop Settings 与撤销浏览器会话的窄桥；main 同时校验 IPC sender。Desktop 私有 header 由独立 Electron session 仅附加到允许的 loopback 产品 API/socket 请求，并排除 Desktop 管理路径；渲染器 JavaScript 不持有凭据。普通浏览器既没有 preload bridge，也不能调用 Desktop 管理接口。

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

首次初始化是 Desktop 应用生命周期的一部分。`PersonalSetupService`（`src/personal-setup/personalSetupService.ts:68`）读取唯一 Human 与 `Home` 的组合状态；两者都存在时重复初始化直接返回原结果，只有 Human 的中断态则返回该资料供界面预填恢复。初始化只接受 `name/email/description`，并通过既有 `ensurePersonalApp` 幂等补齐默认 `Home`，客户端不能提交 rootPath 或选择另一个首次 Space。`GET /api/setup/status` 与 `POST /api/setup/initialize` 集中在 `src/server/routes-api/setup.ts:12`，虽然挂在鉴权前的 gate 0（`src/server/routes-api/index.ts:43`），路由自身仍先校验 Desktop 私有信任；普通浏览器、Worker、错误凭据和远程请求统一得到 404。全新数据目录因此直接运行 Desktop 即可完成初始化，不再要求先执行 seed。

旧 `initialHumans` bootstrap/产品契约已在 A6 退役；测试 fixture 中为构造特定频道状态保留的同名字面量不构成 HTTP、UI 或持久领域入口。

### 4.2 Space

`SpaceService` 管理本地文件夹注册、slug、最近打开记录和 `<space>/.kith/` 初始化。Space 列表、创建和修改以 app.db registry 为事实源；每个 workspace.db 另有一行 `spaces` 元数据和 `#all`，由 `dbForSpace` 在 fresh baseline 初始化时保证。产品 schema/API/type 使用 `space/spaceId`，URL `/s/:slug` 保留。

canonical 传输契约是 `/api/spaces`、`x-space-id`、Socket handshake `spaceId` 和 `SpaceCtx`。Web 只使用这套契约；HTTP、公开附件和 Socket 以 app.db 唯一 Human + registered Space 授权，不依赖 Human Space membership。旧 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 与 `dbFor/listWorkspaces/registerWorkspace` 等 DB facade 已删除；Agent CLI 使用 `space info` 和 `space:read`。

每个 Space 拥有频道、消息、任务、agent 队伍和 Space/agent 记忆。Agent membership 只表达“某 agent 是否在频道中并可被唤醒”，不承载 Human 权限。

### 4.3 Runtime

继续复用窄 `Runtime.start(opts, callbacks): RuntimeSession` 适配契约（当前定义在 `src/daemon/runtime.ts`）。v1 只稳定 Claude Code、Codex、opencode；其他 adapter 隐藏或标 experimental。Runtime 契约 v2 统一 usage、完成、取消和 MCP bootstrap，但不把工具循环搬入 Kith-space。

Agent 首轮驱动明确分为三种原因，Core 通过 `src/local-runtime/agentStart.ts:1` 的 `create | manual | wake` 随 `agent:start` 传给 Worker，Worker 再由 `src/daemon/agentLifecycle.ts:9` 选择提示：新建 agent 执行一次 `dm:@you` 自我介绍；已有 agent 手动启动/恢复只检查一次收件箱，无消息必须静默；真实频道、DM、任务或 reconnect backlog 唤醒时处理持久化消息，并在每个原目标回复。启动准备期间收到的投递已经在数据库中，因此合并进同一个 wake turn，不再追加第二次 inbox notice。Core 为未介绍 agent 的候选创建/重试 turn 生成一次性 token；Worker 只有实际选择 introduction prompt 时才把它注入 runtime 环境（`src/daemon/agentManager.ts:207`），因此对已运行 agent 被忽略的 start 不会授权其普通回复。CLI 只有创建提示要求的 `message send --introduction` 才附带 token，普通 send 不带 token（`src/cli/index.ts:79`-`:85`）；服务端在全部异步 Human-Agent DM 校验后、数据库事务前同步消费匹配 token。真实 wake 会撤销 active token，撤销后迟到的 introduction 请求返回 409，completed token 的重复 introduction 同样返回 409，而同一进程不带 token 的普通 wake 回复不受影响（`src/server/agentIntroduction.ts:15`-`:30`）。随后介绍消息与 `agents.introduced_at` 在同一数据库事务提交（`src/server/core.ts:477`-`:507`）。停止、reset 或删除会清除该 agent 的全部进程 token；普通 reset 保留持久介绍状态，完整 wipe 清除它并重新进入首次介绍。

Runtime 命令发现与启动统一经过 `src/daemon/runtimeProcess.ts:5`。Worker ready 不再调用 Unix 专用的 `command -v`，而是通过 `runtimeCommandAvailable` 使用与 adapter 相同的 `cross-spawn` 边界执行轻量 `--version` 探测；全部 adapter 同样通过该边界启动 CLI。这样 Windows 上的原生 `.exe` 与 npm `.cmd` shim 具有一致语义，避免 Worker 错报 `runtimes=[]`，也避免 Codex/opencode 在检测通过后仍因原生 `child_process.spawn` 的 `EPERM`/`ENOENT` 启动失败。该边界同时对 runtime 的 stdout/stderr 启用 Node 有状态 UTF-8 解码，禁止 adapter 对任意 Buffer 分块分别 `toString()`；否则一个跨块汉字会在 JSON/JSONL 解析前不可逆地变成替换字符。Core 仍以 Worker ready snapshot 为权威，在 `src/server/core.ts` 的启动 guard 中拒绝真正不可用的 runtime。

Agent CLI wrapper 由 `src/daemon/kithSpaceBin.ts:22` 按宿主平台生成：Windows 开发态和打包态都只保留 `~/.kith-space/bin/kith-space.cmd`，启动时清除旧的无扩展名 POSIX wrapper；Linux/macOS 只生成带 `#!/bin/sh` 且可执行的 `kith-space`。`src/daemon/prompt.ts:17` 根据 `win32` 与 POSIX 环境注入宿主命令约定：Windows 明确调用 `.cmd`、禁止照抄 shebang/bash/chmod，优先给出 PowerShell 写法；若 runtime 明确提供 POSIX shell 才允许使用该 shell 的语法。在 Windows PowerShell 5.1 向原生命令管道发送非 ASCII 文本前必须把 `$OutputEncoding` 切到 UTF-8。CLI 的消息、线程与 action STDIN 共用 `src/cli/readStdin.ts:5` 的有状态 UTF-8 读取边界。因此中文正确性由 wrapper、输入流和输出流共同保证，而不是依赖“请用中文回复”的提示词。

受支持 runtime 的规范目录位于 `src/local-runtime/runtimeCatalog.ts`。`GET /api/local-runtime/runtimes` 把 Worker ready snapshot 映射为完整 availability 列表：已安装项稳定前置，未安装项继续返回但由 UI 禁止选择。runtime 的模型发现也必须经过同一 `spawnRuntimeProcess` 边界；OpenCode 使用其官方 `opencode models --verbose`，失败时 `/api/local-runtime/models/opencode` 返回明确错误而不是伪造 `Default`。创建 OpenCode agent 必须提交显式 `provider/model`；adapter 以官方 `--auto` 和 `--model provider/model` 启动，缺少显式模型时直接拒绝启动。Provider API Key 仍由用户自己的 OpenCode 配置管理，Kith-space 不读取或保存。

### 4.4 Tasks

任务服务继续位于 `src/server/tasks/`，由 repository、policy、service、HTTP 和 types 分层组成。任务仍以 task message + owning thread 表达；状态图、revision、父子关系、report/delivery metadata 和并发控制继续复用。

REST、agent API、MCP handler 和 UI 必须调用同一 Task Service，不能各自写 SQL。任务号、任务消息、thread、审计消息和状态变更继续保持事务一致性。

### 4.5 Memory

记忆保持三层：

- Human 层：跨 Space 偏好和长期背景，位于 app 本地数据区。
- Space 层：当前 Space 规则与背景，位于 `<space>/.kith/memory/`。
- Agent 层：当前 Space 内 agent 的 `MEMORY.md` 与 notes。

读取继续使用 runtime 原生文件工具；写入先遵循“一事一文件 + 索引”提示词约定，后续再增加结构化 `memory_save` MCP 工具。

### 4.6 Files

文件和附件只使用本地磁盘服务。S3 driver、SDK 依赖、bucket 配置和 app 级上传目录均已删除；storage key 必须是平面文件名。`src/server/storage.ts` 接收 `spaceId`，通过 app.db registry 解析已注册 Space 的 rootPath，并只读写 `<spaceRoot>/.kith/uploads`。Public download 以附件记录的 `spaceId` 为准，agent plane 以认证 `spaceId` 为准；请求和调用方都不能用字符串路径绕过 registry。

## 5. 数据拓扑

### 5.1 app.db

实现状态：A2.1 已落地 `src/app-data/appDatabase.ts`。旧 `registry.db/workspaces` 已被 `app.db/spaces` 取代；Human profile 为单例行。A3 增加单例 `browser_access_settings` 和 `browser_sessions`，A4 增加单例 `desktop_settings`（`src/app-data/appDatabase.ts:91`）。

本机应用数据目录中的 `app.db` 保存：

- 唯一 Human profile 与初始化状态。
- 已实现的 Web 设置：Web 模式和端口。
- 浏览器访问 Token 哈希与 token revision。
- 浏览器授权会话和撤销状态。
- 已实现的 Desktop 设置：关闭到托盘/关闭即退出与系统自启动开关；托盘本身由 Electron 生命周期管理。
- Space registry：id、slug、rootPath、displayName、最近打开时间。

app.db 不保存 Space 消息、任务或 agent 业务数据。

### 5.2 workspace.db

A2.2b 已把 workspace.db 重建为单一 19 张产品表 baseline。连同 Drizzle 内部的 `__drizzle_migrations`，fresh 数据库共有 20 张物理表；当前 `PRAGMA user_version=3`，v2 数据库会自动增加 `agents.introduced_at` 并把已有 agent 回填为已介绍（`src/db/index.ts:32`-`:59`、`drizzle/0001_agent_introduction.sql:1`）。它包含 `spaces`、agent、频道、消息/任务、dispatch、附件/提醒/知识/活动，以及分离后的 Human 状态表；所有 Space 外键统一为 `space_id`。`users/server_members/machines/join_links`、`agents.machine_id` 和旧 `servers/server_id` 已删除。

每个 Space 的 `<space>/.kith/workspace.db` 保存：

- Space 元数据，以及 Space 内 agent、频道与 agent-only `channel_agent_members`。
- 消息、thread、任务、任务计数和实时 seq。
- 唯一 Human 的 read/DM/thread 状态 `human_channel_states`、收藏 `human_saved_messages` 与 Space 偏好 `human_space_preferences`。
- 持久 actor 使用 `human | agent | system`（按字段适用）；runtime 协议的 `role: "user"` 是外部协议字面量，不属于数据库 actor。

一个 Space 文件夹可整体复制；Human 资料、浏览器会话和 Desktop 设置不会随之复制。未来本机跨 Space 聚合遍历多个 workspace.db 并在应用层合并，不引入中央云库。

### 5.3 schema 转向策略

允许清空开发期 app 数据与 `.kith`，不实现旧 schema 数据迁移。A2.2b 把 Drizzle 历史压成单一 `0000` baseline；打开旧 schema 时抛出包含数据库路径的可操作错误，要求先备份再显式删除，应用绝不自动迁移或删除旧库。领域迁移状态如下：

1. 建立 app.db 和唯一 Human/Home 初始化。
2. 将传输、请求上下文、Space API 与 Web 类型改为 `spaceId`，并删除旧服务端兼容边界。
3. A2.3 已完成：唯一 Human 成为传输 authority，稳定身份为 `@you`，删除产品 membership/RBAC/邀请/Web Human roster/Human-Human DM，频道成员只管理 agent。
4. A2.4 已完成：删除 Machine 服务/API/UI、machine key/心跳/调度与 agent machine 选择；保留安装级唯一 Worker 进程协议，并让 Worker 事件跨 Space 定位。
5. A2.2b 已完成：破坏性重建 workspace.db baseline，把保留表的 `servers/server_id` 改为 `spaces/space_id`，拆出单 Human 状态/收藏/偏好，并删除旧物理表与兼容边界。
6. A2 已完成：附件目录纳入 Space 根路径，旧 app 级上传配置、命名 facade 与不兼容维护脚本已删除，并完成整阶段验收。

不执行无边界的整仓替换；每个切片都需 schema、service、route 和 UI 契约测试。

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

agent-to-agent 分派继续经过统一 dispatch 收口。现有深度上限、唤醒预算和急停 guard 保留；任务 report/delivery 只写本地状态，不伪造唤醒消耗。Local Runtime Worker 虽然唯一，所有 start/deliver/stop 仍必须经过 Space、agent、频道成员和任务作用域校验。

默认 autopilot 与 plan-first 软闸保持不变。未来 usage 预算依赖 Runtime 契约 v2 的统一 usage 回调，不在 adapter 中分别堆业务判断。

## 8. 前端模块边界

- `WorkspaceFrame` 组合路由、响应式约束和三态布局，不承载任务或 agent 业务逻辑。
- `workspaceLayout.ts` 只表达 ChatOnly/Split/ModuleOnly 状态机。
- `paneConstraints.ts` 只计算面板最小宽度与单 Pane 降级。
- `workspaceModules.tsx` 当前注册 Inbox、Tasks、Agents、Settings 与非 Dock 的 Search；Computers/Machines 已退出模块注册和路由。
- `ChatWorkspace` 管理会话列表、Chat 和实时轨迹；业务模块不能直接操控 Chat 内部状态。
- URL 是模块与 Chat 显隐事实来源。会话始终使用规范 `/s/:slug/channel[/<channelId>]`、`saved` 或 `showcase` 路径；`module`/`chat` 表达工作区布局，`taskScope`、`agent`/`agentTab`、`settings` 分别表达 Tasks、Agents、Settings 的模块资源（`web/src/shell/workspaceRoute.ts:65`、`:128`）。模块切换由 `workspaceLocationForModule`（`:143`）生成 query，不再生成 `/tasks`、`/agent`、`/settings` 等模块实体路径；Settings 未指定或传入旧/未知资源时统一归一为 `human`（`:138`）。
- 切换频道或 Human-Agent DM 时保留当前 active module、Chat 显隐和该模块拥有的 resource query，同时丢弃旧会话的 `msg`/`thread` 等临时聚焦参数（`web/src/shell/workspaceRoute.ts:180`）。这样模块上下文跨会话导航保持稳定，旧消息焦点不会泄漏到新会话。
- `MessageContextSnapshot` 在发送时固化 Space、会话、模块、Context Stack 和 focused item，adapter 再编码为各 runtime 所需格式。

Desktop 专属设置通过 `window.kithDesktop` 窄桥注入，不靠仅隐藏按钮实现安全；服务端同时拒绝普通浏览器调用。Windows 打包态可调用 Electron 系统自启动接口，开发态通过 `launchAtLoginSupported: false` 明确禁用该控件。

A3 已把 Web bootstrap 改为 Cookie 会话探测（`web/src/browserAuth.ts:20`）；未授权浏览器只渲染 `AccessTokenGate`（`web/src/views/AccessTokenGate.tsx:4`），不先渲染工作区。客户端不保存 Human Bearer/localStorage JWT，Socket 握手只携带 `spaceId`，附件/头像 URL 不携带认证查询参数。

A5 后 `web/src/App.tsx:4` 只渲染 `WorkspaceFrame`。Landing、Features、旧 `Layout`、`?legacy=1`、SSR/prerender、PWA/营销元数据和公开营销资产均已删除；静态入口只服务共享产品壳与规范 Space 路由，不再维护独立 Web 营销面或旧界面回退。

## 9. 开发与发行

Electron 固定为 43.1.0，electron-builder 固定为 26.15.3，`@electron/rebuild` 固定为 4.2.0（`package.json:122`、`:128`-`:129`）。`pnpm run desktop:dev` 先执行 `desktop:build`，再由 Electron 统一启动 Core、唯一 Worker 和开发期 Vite；它是完整开发宿主。全新 `KITH_SPACE_HOME` 会在 Electron 内显示首次初始化页，完成后进入 `Home`，正常 Desktop 开发启动不再以 `pnpm run seed` 为前置。仓库内部仍保留 `pnpm run server`、`pnpm run daemon`、`pnpm --dir web run dev`、`browser-access:dev` 与 `dev:e2e:up` 以便分进程调试，其中 daemon 只是 Local Runtime Worker 的过渡代码/命令名。`src/env.ts:1`-`:11` 仍允许源码调试加载可选本地 `.env`；受管/打包 Desktop 不加载它，普通配置全部进入 app.db。

发行脚本在 `package.json:43`-`:46` 固定为四层：

1. `desktop:build`：`scripts/build-desktop.mjs:10`-`:31` 仅生成 Electron main/preload CJS。
2. `desktop:bundle`：先构建 `web/dist`，再以 production 模式生成 main/preload、Core CJS、Worker ESM 和 agent CLI ESM（`scripts/build-desktop.mjs:33`-`:72`）。
3. `desktop:pack`：生成 `dist/desktop/win-unpacked`，用于 packaged smoke。
4. `desktop:dist`：生成 x64、per-user、assisted NSIS 安装器；electron-builder 的文件、`extraResources`、asar、`npmRebuild=false` 与 NSIS 约束位于 `package.json:57`-`:108`。

`scripts/package-desktop.mjs:33` 会先刷新 production bundle。随后它使用 `@electron/rebuild` 对 pnpm store 中的 `better-sqlite3` 执行显式 `--force --arch x64` Electron rebuild（`:40`-`:54`），成功后才调用 electron-builder；包装器在 `finally`（`:56`-`:58`）中执行 Node rebuild，即使 native rebuild 或打包中途失败也恢复开发/测试 ABI。最终核对为本地 Node ABI 137、packaged Electron ABI 148。旧 Docker/compose/Railway、环境样例、prod 脚本、公共 daemon package、npm/OIDC 与 docs-site workflow 已删除；pnpm workspace 只有根目录和 `web/`。

`.github/workflows/desktop-release.yml:1`-`:40` 仅支持手动触发 Windows x64 构建，并上传未签名 installer artifact 14 天；它不创建 Release、不签名、不自动发布。本地最终安装器 `dist/desktop/Kith-space-Setup-0.1.0-x64.exe` 为 113625983 bytes，SHA-256 `D314DAE15A8E9AB598901D2E3DF8B90DE1C7B46E79824CC8575BD4C742B89646`，Authenticode `NotSigned`。最终 unpacked Desktop smoke Exit 0、`app.db` 创建、残留进程 0、端口监听 0；packaged Core、内置 Web/Drizzle/CLI 与优雅退出也已 smoke。真实 NSIS 安装/卸载尚未执行。公开分发前必须配置 Windows 代码签名证书并补齐安装流程验收，不能把可复现的未签名 artifact 描述为已签名或已发布。

Windows Desktop 是 v1 唯一正式发行物；系统能力选型不得无必要绑定 Windows，为 macOS/Linux 留出实现空间。
