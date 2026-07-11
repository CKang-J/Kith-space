# Kith-space 目标架构

> 本文描述 2026-07-11 个人 AgentOS 转向后的目标模块边界。A2 本地领域与数据模型、A3 浏览器访问安全边界已完成；Electron 宿主、发行和其他继承资产仍按 `migration-plan.md` 分阶段收口。产品边界见 `product-brief.md`，验收见 `mvp-spec.md`。

## 1. 架构原则

- Desktop 是唯一正式宿主和进程监督者，浏览器入口依附 Desktop 生命周期。
- 一个安装实例只有一个 Human、一个 Local Runtime Worker，可注册多个本地 Space。
- 不自研 runtime；Claude Code、Codex、opencode 通过 adapter 接入。
- 模块能力经 MCP 暴露，UI、HTTP、agent data plane 和 MCP handler 复用同一领域服务。
- app 级数据与 Space 级数据分库；文件和附件只存本地磁盘。
- 保留进程隔离、Space/路径边界、浏览器鉴权和 runtime 权限；删除多租户/RBAC 和远程主机抽象。

## 2. 进程与信任边界

### 2.1 Desktop Supervisor

Electron main 是正式入口，职责限制为：

- 读取本机 app 设置并决定监听模式/端口。
- 每次启动生成内部临时凭据。
- 按顺序启动、健康检查和监督 Core Service 与 Local Runtime Worker。
- 创建受控 Electron 窗口，提供 Desktop 信任桥。
- 管理托盘、关闭行为、系统自启动、端口冲突和显式退出。

业务逻辑不进入 Electron main。Desktop 专属设置通过受限 IPC/本机管理接口访问，普通浏览器不可调用。

### 2.2 Core Service

Core Service 是本机单实例业务服务，承载 HTTP、socket.io、浏览器访问门、领域服务和数据连接。代码目录仍为 `src/server/` 时，“server”只描述技术进程；产品领域中的工作区统一称为 Space。

Core Service 根据 Web 模式监听：

- 关闭（默认）：仍在 `127.0.0.1` 保留 Desktop/Worker 所需的私有传输，但不提供普通浏览器产品壳。
- 仅本机：绑定 `127.0.0.1`，普通浏览器经 Access Token 会话访问。
- 局域网：绑定 `0.0.0.0`，同样强制 Access Token 会话，并只允许与请求 Host 匹配的 Origin。

`src/browser-access/browserAccessPolicy.ts:41` 把模式与监听决策隔离为窄策略；`src/server/index.ts:45` 在进程启动时读取该决策，开发用 `PORT` 仅覆盖端口。模式/端口更改需重启 Core Service 后改变监听。非 Desktop 请求在关闭模式下会被 `src/server/index.ts:73` 的产品壳门拒绝。

### 2.3 Local Runtime Worker

现 daemon 保留为独立进程隔离边界，但产品名称改为 Local Runtime Worker。`src/local-runtime/workerHub.ts` 在 Core Service 内维护安装级唯一连接、ready snapshot 与请求/响应；新连接会用专用关闭码替换旧连接，旧进程停止自动重连，generation lease 阻止旧连接的异步 ready、事件、补唤醒或断线回收覆盖新连接状态。它只连接本机 Core Service，承载 runtime 进程、轨迹和 session 生命周期；不再注册 Machine、不被用户手工连接，也不接受远程 worker。过渡 Worker CLI 固定连接 `http://127.0.0.1:$PORT/daemon/connect`，以私有 `x-kith-worker-token` header 握手，凭据不进 URL；不提供 `--server-url` 或其他远程端点覆盖。A4 只接管凭据生成与 Desktop 监督方式，不重新引入远程 Worker。

唯一 Worker 服务所有本机 Space，而不是隶属某个 Space。Worker 消息只携带 installation-unique agentId；`src/local-runtime/agentLocator.ts` 遍历已注册 Space 定位 agent 所属数据库，`src/server/ws.ts` 再把 status/activity/session/trajectory/reply 发布到正确 Space。Worker ready/reconnect 同样遍历所有 Space 做状态对齐和积压补唤醒。

### 2.4 React UI

Electron 和桌面浏览器复用同一 React UI、HTTP API 和 socket.io 事件。客户端能力由可信宿主信息决定：Desktop 可显示网络/Token/进程/托盘/自启动设置，浏览器必须隐藏并拒绝这些能力。

## 3. 通信平面

保留 open-tag 三平面结构，但收敛身份和连接范围：

1. Human UI plane：Electron 通过私有 Desktop 凭据，已授权桌面浏览器通过 HttpOnly Cookie 会话访问 `/api/*` 与 socket.io。
2. Worker control plane：本机 Core Service 与唯一 Local Runtime Worker 以独立 Worker 凭据建立 WS，用于 agent start/deliver/stop/profile。
3. Agent data plane：本机 runtime 子进程以最小短期 session token 调用 `/agent-api/*` 或 MCP 工具。

浏览器访问 Token、Desktop 信任凭据、Worker 内部凭据和 agent session token 是四种不同凭据，不可复用或互相兑换。

## 4. 领域模块

### 4.1 Human

`src/app-data/appDatabase.ts` 管理唯一 Human 的名称、可选邮箱和描述；`src/human/humanIdentity.ts` 把协作寻址固定为稳定的 `@you`，展示名始终读取 app.db。REST 和 socket.io 的 Human authority 只来自 Desktop 私有信任或已验证的浏览器 Cookie 会话（`src/server/humanRequestAuth.ts:18`），不存在 Human JWT、Bearer 登录或 dev-login。它不提供注册、登录、密码、角色或成员关系。首次初始化是 app 生命周期的一部分，完成后创建默认 `Home` Space。

### 4.2 Space

`SpaceService` 管理本地文件夹注册、slug、最近打开记录和 `<space>/.kith/` 初始化。Space 列表、创建和修改以 app.db registry 为事实源；每个 workspace.db 另有一行 `spaces` 元数据和 `#all`，由 `dbForSpace` 在 fresh baseline 初始化时保证。产品 schema/API/type 使用 `space/spaceId`，URL `/s/:slug` 保留。

canonical 传输契约是 `/api/spaces`、`x-space-id`、Socket handshake `spaceId` 和 `SpaceCtx`。Web 只使用这套契约；HTTP、公开附件和 Socket 以 app.db 唯一 Human + registered Space 授权，不依赖 Human Space membership。旧 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 与 `dbFor/listWorkspaces/registerWorkspace` 等 DB facade 已删除；Agent CLI 使用 `space info` 和 `space:read`。

每个 Space 拥有频道、消息、任务、agent 队伍和 Space/agent 记忆。Agent membership 只表达“某 agent 是否在频道中并可被唤醒”，不承载 Human 权限。

### 4.3 Runtime

继续复用窄 `Runtime.start(opts, callbacks): RuntimeSession` 适配契约（当前定义在 `src/daemon/runtime.ts`）。v1 只稳定 Claude Code、Codex、opencode；其他 adapter 隐藏或标 experimental。Runtime 契约 v2 统一 usage、完成、取消和 MCP bootstrap，但不把工具循环搬入 Kith-space。

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

实现状态：A2.1 已落地 `src/app-data/appDatabase.ts`。旧 `registry.db/workspaces` 已被 `app.db/spaces` 取代；Human profile 为单例行。A3 又增加单例 `browser_access_settings` 和 `browser_sessions`（`src/app-data/appDatabase.ts:78`）。A4 才增加托盘、关闭行为和系统自启动等 Desktop 设置。

本机应用数据目录中的 `app.db` 保存：

- 唯一 Human profile 与初始化状态。
- 已实现的 Web 设置：Web 模式和端口。
- 浏览器访问 Token 哈希与 token revision。
- 浏览器授权会话和撤销状态。
- A4 待实现的 Desktop 设置：关闭行为、托盘和系统自启动等。
- Space registry：id、slug、rootPath、displayName、最近打开时间。

app.db 不保存 Space 消息、任务或 agent 业务数据。

### 5.2 workspace.db

A2.2b 已把 workspace.db 重建为单一 19 表 baseline。它包含 `spaces`、agent、频道、消息/任务、dispatch、附件/提醒/知识/活动，以及分离后的 Human 状态表；所有 Space 外键统一为 `space_id`。`users/server_members/machines/join_links`、`agents.machine_id` 和旧 `servers/server_id` 已删除。

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
- 公开验证端点以远程地址做内存限速（`src/server/browserSessionHttp.ts:93`），不把 Token 写入 URL、日志、错误或遥测。
- 轮换 Token 在同一 app.db 事务中增加 revision 并删除全部旧浏览器会话（`src/app-data/browserAccessData.ts:69`）。

### 6.2 BrowserSessionService

- 首次 Token 验证成功后创建 32 字节随机 session；原始值只进 HttpOnly Cookie，app.db 只保存 SHA-256 哈希和 token revision（`src/browser-access/browserSessionService.ts:13`）。
- session Cookie 使用 HttpOnly、SameSite=Strict；可读 CSRF Cookie 也是 SameSite=Strict。当传输本身为 HTTPS 时才加 `Secure`，v1 LAN HTTP 不伪装传输安全。
- 浏览器写请求同时检查模式允许的 Origin、CSRF Cookie 与 `x-kith-csrf` 等值（`src/server/browserSessionHttp.ts:81`）。
- 会话持续到浏览器数据清除、当前会话退出、Desktop 全量撤销或 Token 轮换；不依赖 Human 账户/JWT 到期。

### 6.3 Desktop 与内部凭据

- `src/local-runtime/internalCredentials.ts:31` 为一次 Desktop 管理的进程组生成两个独立 32 字节凭据；A4 Electron 负责每次启动调用并分别注入子进程。
- Core Service 当前对 `KITH_SPACE_DESKTOP_TOKEN` 与 `KITH_SPACE_WORKER_TOKEN` 做 fail-fast；前者只接受 loopback 请求中的 `x-kith-desktop-token` 私有管理信任，后者只接受 loopback Worker `/daemon/connect` 的 `x-kith-worker-token` header。分进程开发在 A4 前由 `.env` 注入，两者不得进 URL，也不得与浏览器访问 Token 复用。
- `/api/desktop/browser-access` 的查询、模式/端口/Token 轮换与会话撤销只对 Desktop 凭据开放；普通浏览器统一收到 404（`src/server/routes-api/browserAccess.ts:125`）。

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
- URL 是模块与 Chat 显隐事实来源；删除 `?legacy=1` 和旧 `Layout`。
- `MessageContextSnapshot` 在发送时固化 Space、会话、模块、Context Stack 和 focused item，adapter 再编码为各 runtime 所需格式。

Desktop 专属设置通过宿主能力注入，不靠仅隐藏按钮实现安全；服务端必须拒绝普通浏览器调用。

A3 已把 Web bootstrap 改为 Cookie 会话探测（`web/src/browserAuth.ts:20`）；未授权浏览器只渲染 `AccessTokenGate`（`web/src/views/AccessTokenGate.tsx:4`），不先渲染工作区。客户端不保存 Human Bearer/localStorage JWT，Socket 握手只携带 `spaceId`，附件/头像 URL 不携带认证查询参数。

## 9. 开发与发行

仓库内部保留 `pnpm run server`、`pnpm run daemon`、`pnpm --dir web run dev` 以便调试；其中 daemon 只是 Local Runtime Worker 的过渡代码/命令名。`pnpm run browser-access:dev <off|local|lan>` 是 A4 前唯一显式修改 app.db Web 模式/端口与轮换访问 Token 的开发管理入口；`dev:e2e:up` 会启用 local、同步 `PORT`、每次轮换随机 Token，并只在该启动终端显示一次。A4 新增 `pnpm run desktop:dev` 作为完整开发宿主。正式产品不要求 `.env`，普通设置全部进 app.db。

最终删除 Docker、远程部署、公共 server/daemon npm 发布和 OIDC workflow。Windows Desktop 是 v1 唯一正式发行物；系统能力选型不得无必要绑定 Windows，为 macOS/Linux 留出实现空间。
