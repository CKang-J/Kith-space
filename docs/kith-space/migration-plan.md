# Kith-space 分阶段改造计划

本文记录从当前 open-tag 衍生实现收敛到本机个人 AgentOS 的工程顺序。产品边界见 `product-brief.md`，验收见 `mvp-spec.md`，权威转向规格见 `../superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`。

## 1. 已完成基线

P0-P3 已完成 SQLite、派发护栏、记忆/角色和任务领域；P4 已完成 ChatOnly / Split / ModuleOnly 单窗口壳、可拖拽面板、常驻 Dock 与任务作用域侧栏。它们作为本机化改造的可用基线保留。

旧计划中的“多用户/多机器机制休眠保留”“P6 云化/多真人”和“localhost Web 后再升级公网”全部失效。P4 视觉微调暂停，先处理领域与宿主边界。

## 2. 改造原则

- 先文档和领域，再安全入口、Desktop 宿主和 UI 清理。
- 新能力放在边界清晰的小模块中，不继续把职责堆入 `src/server/core.ts` 或大型 React 文件。
- 保留消息、任务、记忆、runtime adapter 等与转向无冲突的能力，不做无关重构。
- 允许破坏性 schema 重置，不为开发期 `.kith` 数据编写迁移。
- 每个阶段独立测试、独立中文提交，并同步文档。

## 3. 阶段

### A1 权威文档收敛

改动：同步 vision、decisions、roadmap、产品、架构、UI、术语、进度、开发命令和入口说明；历史研究增加非路线标注。

验证：审计权威文档，不再把多真人、多机器、公网部署或云同步描述为未来目标。

### A2 本地领域与数据模型

当前进度：A2.1 已完成 `app.db`、唯一 Human、幂等 `Home` 初始化；A2.5 已删除 S3；A2.2a 已完成 canonical Space 契约；A2.3 已完成唯一 Human 协作边界；A2.4 已删除 Machine/Computer/远程 worker 活跃产品路径，并建立安装级唯一、跨 Space 路由的 Local Runtime Worker。下一切片 A2.2b 负责旧 `/api/servers` 边界、workspace.db 多用户/Machine 物理旧表与 `server_id` 压平；全局上传目录仍待 A2 收口。

改动边界：

- 新建 app 数据层，中央 registry 扩展/更名为 `app.db`。
- 唯一 Human、首次资料初始化和默认 `Home`。
- `server/serverId` 到 `space/spaceId` 的领域/schema/API/类型迁移；`/s/:slug` 保留。
- Human membership/RBAC/邀请/Human-Human DM 删除；Space 内 agent membership 保留。
- Machine/Computer/远程 daemon 注册删除；内部 daemon 变为安装级唯一 Local Runtime Worker，并以 agentId 跨 Space 路由。
- S3/对象存储删除，本地文件服务保留。

实施顺序补充：A2.2a 后的 A2.3 authority/identity/UI 与 A2.4 Machine 产品路径删除均已完成。现在用允许的破坏性重置一次性把保留表的 `servers/server_id` 压平为 `spaces/space_id`，删除 `machines`/`agents.machine_id` 等无消费者物理字段，并把 raw `user` actor 与 Human 会话状态统一切到目标模型。这样避免迁移即将删除的表和字段两次。

模块边界建议：`src/app-data/` 负责 app.db；`src/spaces/` 负责 Space registry/生命周期；`src/human/` 负责唯一 Human；`src/local-runtime/` 负责 Desktop 与 worker 内部协议。实际命名在落地前按现有结构核对，不为目录整齐而搬动无关文件。

验证：schema/服务单测、全新目录初始化、唯一 Worker 替换与跨 Space 事件路由、Machine API/UI 不可达契约、typecheck、现有任务/消息回归。A3 前另验证 Core Service 仅绑定 loopback，`dev:e2e:up` 等待 `/health.workerConnected`。

### A3 浏览器访问安全边界

改动边界：

- `BrowserAccessPolicy` 只表达关闭/本机/LAN 与监听决策。
- `AccessTokenService` 负责生成、哈希、轮换和验证。
- `BrowserSessionService` 负责持久授权、撤销、cookie 与 CSRF。
- `DesktopTrustBridge` 只识别 Electron 内嵌请求，不向普通浏览器暴露万能凭据。
- `InternalProcessCredentials` 每次启动生成，只用于 Core Service 与 Local Runtime Worker。

验证：策略单测、token/session 集成测试、监听地址测试、日志泄露扫描和 LAN 风险文案。

### A4 Electron Desktop 宿主

改动边界：

- Electron main 负责启动顺序、健康检查、异常退出和干净关闭。
- Settings 持久化端口、Web 模式、关闭行为和自启动。
- Tray 管理显示主窗口、暂停/恢复可用动作和显式退出。
- 增加 `pnpm run desktop:dev`；保留 server/daemon/web 分进程命令给开发调试。

验证：Windows 开发启动、端口冲突、子进程崩溃、托盘、关闭/退出和自启动冒烟。

### A5 UI 与入口清理

改动：Human 首次初始化、Home 入口与 Desktop Settings；完成 Dock `Chat | Inbox | Tasks | Agents | Settings`；删除 Landing、PWA、`?legacy=1` 和旧入口。Agents/Human Settings 表面迁移及登录/注册/邀请 UI/API 已在 A2.3 提前完成，Computers 已在 A2.4 提前删除；物理 `join_links`/Machine 表仍归 A2.2b。

验证：路由契约、Dock 状态机、Desktop/Web 设置差异、web build 与浏览器冒烟。

### A6 继承资产清理与总审计

改动：删除 Docker、环境样例、远程部署/发布、公共 server/daemon 包、OIDC workflow 和残余旧领域；保留内部开发/测试覆盖变量。

验证：`rg` 旧路线审计、typecheck、单元/集成测试、web build、Electron 冒烟、许可证和文档检查。

## 4. 强制依赖

- A1 先于任何代码改动，避免继续沿旧路线设计。
- A2 先于 A3/A4/A5；Token、Desktop 和 UI 都依赖唯一 Human、app.db 与 Space 领域。
- A3 先于 LAN 正式开放；不能先绑定 `0.0.0.0` 再补鉴权。
- A4 先于删除用户 `.env` 和手工 daemon key；Desktop 必须先接管配置与内部凭据。
- A5 在领域/API 稳定后做，避免 UI 同时适配两套命名。
- A6 最后执行，但每个前置阶段都要清理自己产生的孤立引用。

## 5. 主要风险

| 风险 | 处理 |
|---|---|
| `server` 同时表示 HTTP 服务和 Space 领域 | 分批迁移，先定义 Space 领域与兼容边界，再改 schema/API；HTTP 进程称 Core Service |
| 删除 Human membership 误伤 agent membership | 先把两种关系拆成独立测试，再只删除 Human 分支 |
| 删除 Machine 误伤 daemon 进程隔离 | 保留 Local Runtime Worker 进程和内部协议，只删除远程注册/多主机领域 |
| LAN + 高权限 runtime 扩大攻击面 | 默认关闭、Token、持久会话/撤销、私网警告；高风险模块上线前补 HTTPS 与权限升级 |
| 大范围命名迁移造成一次性失控 diff | 按 schema、服务、API、前端四个可验证切片推进，不整仓机械替换 |
| 当前文档与过渡代码暂时不一致 | 明确标注“目标态”和“当前过渡命令”；代码阶段完成后立即删除过渡说明 |
