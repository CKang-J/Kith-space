# Kith-space 目标架构

> 本文描述 2026-07-11 个人 AgentOS 转向后的目标模块边界。当前代码仍含 open-tag 的 `server`、Machine、多用户和环境变量遗留，按 `migration-plan.md` 分阶段移除。产品边界见 `product-brief.md`，验收见 `mvp-spec.md`。

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

- 关闭：不提供普通浏览器入口，只接受受控 Desktop 客户端和内部进程。
- 仅本机：绑定 loopback。
- 局域网：显式绑定 LAN 可达地址，并强制浏览器 Token 会话。

### 2.3 Local Runtime Worker

现 daemon 保留为独立进程隔离边界，但产品名称改为 Local Runtime Worker。它只连接本机 Core Service，承载 runtime 进程、轨迹和 session 生命周期；不再注册 Machine、不被用户手工连接，也不接受远程 worker。

### 2.4 React UI

Electron 和桌面浏览器复用同一 React UI、HTTP API 和 socket.io 事件。客户端能力由可信宿主信息决定：Desktop 可显示网络/Token/进程/托盘/自启动设置，浏览器必须隐藏并拒绝这些能力。

## 3. 通信平面

保留 open-tag 三平面结构，但收敛身份和连接范围：

1. Human UI plane：Electron 或已授权桌面浏览器到 `/api/*` 与 socket.io。
2. Worker control plane：本机 Core Service 与唯一 Local Runtime Worker 的受认证 WS，用于 agent start/deliver/stop/profile。
3. Agent data plane：本机 runtime 子进程以最小短期 session token 调用 `/agent-api/*` 或 MCP 工具。

浏览器访问 Token、Desktop 信任凭据、Worker 内部凭据和 agent session token 是四种不同凭据，不可复用或互相兑换。

## 4. 领域模块

### 4.1 Human

`HumanProfileService` 管理唯一 Human 的名称、可选邮箱和描述。它不提供注册、登录、密码、角色或成员关系。首次初始化是 app 生命周期的一部分，完成后创建默认 `Home` Space。

### 4.2 Space

`SpaceService` 管理本地文件夹注册、slug、最近打开记录和 `<space>/.kith/` 初始化。A2.2a 已落地 `src/spaces/spaceService.ts`：Space 列表、创建和修改以 app.db registry 为事实源，创建时仅为旧 workspace.db 写兼容 Human 投影。当前 avatar/plan 仍从旧表读取为 UI 展示投影，不决定 Space 身份或生命周期。产品 schema/API/type 分阶段从 `server/serverId` 迁移为 `space/spaceId`；URL `/s/:slug` 保留。

当前 canonical 传输契约是 `/api/spaces`、`x-space-id`、Socket handshake `spaceId` 和 `SpaceCtx`。Web 只使用这套契约；旧 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 与 DB facade 被限制在明确的服务端适配边界（dispatcher、util、socketio、ctx 与 db/index），且新旧 Space ID 同时存在但值不一致时拒绝请求。兼容层在 A2.3/A2.4 删除旧路由后移除。

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

文件和附件只使用本地磁盘服务。A2.5 已删除 S3 driver、SDK 依赖和 bucket 配置，并对存储 key 做平面文件名校验；当前上传目录仍是 app 级 `uploads/`。A2.2a 已让请求通过 `SpaceCtx` 获得 Space 作用域，但附件目录迁入 Space 根路径仍放在 A2 收口执行，不能用字符串路径绕过 registry 与根路径校验。

## 5. 数据拓扑

### 5.1 app.db

实现状态：A2.1 已落地 `src/app-data/appDatabase.ts`。旧 `registry.db/workspaces` 已被 `app.db/spaces` 取代；Human profile 为单例行。浏览器 Token、sessions 和 Desktop settings 仍分别属于 A3/A4，尚未提前建空表。

本机应用数据目录中的 `app.db` 保存：

- 唯一 Human profile 与初始化状态。
- Desktop/Web 设置：Web 模式、端口、关闭行为、自启动等。
- 浏览器访问 Token 哈希与 token revision。
- 浏览器授权会话和撤销状态。
- Space registry：id、slug、rootPath、displayName、最近打开时间。

app.db 不保存 Space 消息、任务或 agent 业务数据。

### 5.2 workspace.db

过渡状态：A2.1 创建 `Home` 时仍向 workspace.db 写入一份兼容 `users/owner/server_members` 投影，以维持现有 API；该投影不是第二个 Human 事实源，将在 A2.3 连同 Human membership/RBAC 删除。

每个 Space 的 `<space>/.kith/workspace.db` 保存：

- Space 内 agent、频道与 agent membership。
- 消息、thread、任务、任务计数和实时 seq。
- Space 级 UI/业务偏好中需要随文件夹迁移的部分。

一个 Space 文件夹可整体复制；Human 资料、浏览器会话和 Desktop 设置不会随之复制。未来本机跨 Space 聚合遍历多个 workspace.db 并在应用层合并，不引入中央云库。

### 5.3 schema 转向策略

允许清空开发期 app 数据与 `.kith`，不实现旧 schema 数据迁移。领域迁移按以下切片进行：

1. 建立 app.db 和唯一 Human/Home 初始化。
2. 将传输、请求上下文、Space API 与 Web 类型改为 `spaceId`，旧名只留服务端兼容边界。
3. 区分 Human 与 agent membership，再删除 Human membership/RBAC。
4. 删除 Machine 数据与远程 worker 路径，保留本机 worker 进程协议。
5. 破坏性重建 workspace.db baseline，把保留表的 `servers/server_id` 改为 `spaces/space_id`，并删除兼容边界。
6. 在已完成 S3 删除的基础上，把附件目录纳入 Space 根路径并做 A2 总验收。

不执行无边界的整仓替换；每个切片都需 schema、service、route 和 UI 契约测试。

## 6. 浏览器访问安全

### 6.1 AccessTokenService

- Token 可由用户设置，留空时自动生成高强度值。
- app.db 只保存慢哈希/安全哈希与版本，不保存明文。
- 验证接口必须限速，不把 Token 写入 URL、日志、错误或遥测。
- 轮换 Token 增加 token revision，并使全部既有浏览器会话失效。

### 6.2 BrowserSessionService

- 首次 Token 验证成功后创建持久、可撤销的随机 session。
- Cookie 使用 HttpOnly、SameSite=Strict；生产路径设置适合当前 HTTP/HTTPS 能力的安全属性。
- 有状态写请求继续做 Origin/CSRF 校验，不能把 SameSite 当作唯一保护。
- Desktop 可撤销全部浏览器会话；浏览器清除数据后需要重新验证。

### 6.3 LAN 限制

LAN 模式允许完整产品操作，因此默认关闭。首次启用显示明确警告：v1 HTTP 未加密，只限受信任私网，禁止端口转发或公网暴露。手机/平板不是 v1 支持客户端。

邮箱、浏览器等摄入不可信内容的模块上线前，必须完成 HTTPS 与 runtime 审批/沙箱升级。访问 Token 不能替代传输加密或 runtime 权限隔离。

## 7. 编排与护栏

agent-to-agent 分派继续经过统一 dispatch 收口。现有深度上限、唤醒预算和急停 guard 保留；任务 report/delivery 只写本地状态，不伪造唤醒消耗。Local Runtime Worker 虽然唯一，所有 start/deliver/stop 仍必须经过 Space、agent、频道成员和任务作用域校验。

默认 autopilot 与 plan-first 软闸保持不变。未来 usage 预算依赖 Runtime 契约 v2 的统一 usage 回调，不在 adapter 中分别堆业务判断。

## 8. 前端模块边界

- `WorkspaceFrame` 组合路由、响应式约束和三态布局，不承载任务或 agent 业务逻辑。
- `workspaceLayout.ts` 只表达 ChatOnly/Split/ModuleOnly 状态机。
- `paneConstraints.ts` 只计算面板最小宽度与单 Pane 降级。
- `workspaceModules.tsx` 注册 Inbox、Tasks、Agents、Settings；删除 Computers。
- `ChatWorkspace` 管理会话列表、Chat 和实时轨迹；业务模块不能直接操控 Chat 内部状态。
- URL 是模块与 Chat 显隐事实来源；删除 `?legacy=1` 和旧 `Layout`。
- `MessageContextSnapshot` 在发送时固化 Space、会话、模块、Context Stack 和 focused item，adapter 再编码为各 runtime 所需格式。

Desktop 专属设置通过宿主能力注入，不靠仅隐藏按钮实现安全；服务端必须拒绝普通浏览器调用。

## 9. 开发与发行

仓库内部保留 `pnpm run server`、`pnpm run daemon`、`pnpm --dir web run dev` 以便调试；新增 `pnpm run desktop:dev` 作为完整开发宿主。正式产品不要求 `.env`，普通设置全部进 app.db。

最终删除 Docker、远程部署、公共 server/daemon npm 发布和 OIDC workflow。Windows Desktop 是 v1 唯一正式发行物；系统能力选型不得无必要绑定 Windows，为 macOS/Linux 留出实现空间。
