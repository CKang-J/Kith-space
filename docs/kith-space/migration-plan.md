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

当前进度：A2 已完成。`app.db`、唯一 Human、幂等 `Home`、canonical Space 契约、安装级唯一 Worker、19 表 workspace.db baseline 与 `<spaceRoot>/.kith/uploads` 均已落地；旧多用户/Machine/Space 兼容、app 级上传配置和不兼容的一次性维护脚本已收口。

改动边界：

- 新建 app 数据层，中央 registry 扩展/更名为 `app.db`。
- 唯一 Human、首次资料初始化和默认 `Home`。
- 已完成 `server/serverId` 到 `space/spaceId` 的领域/schema/API/类型迁移；`/s/:slug` 保留。
- Human membership/RBAC/邀请/Human-Human DM 删除；Space 内 agent membership 保留。
- Machine/Computer/远程 daemon 注册删除；内部 daemon 变为安装级唯一 Local Runtime Worker，并以 agentId 跨 Space 路由。
- S3/对象存储删除，本地文件服务保留。
- 附件存储由 `spaceId` 经 app.db registry 解析 Space 根目录，公开下载与 agent plane 均不能跨 Space 取文件。

实施顺序补充：A2.2b 已用允许的破坏性重置一次性把保留表的 `servers/server_id` 压平为 `spaces/space_id`，删除 `users/server_members/machines/join_links` 与 `agents.machine_id`，拆出 agent-only channel membership、Human 会话状态/收藏/Space 偏好，并把持久 actor 切到 `human`。旧 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 和 DB workspace facade 同时删除；Agent CLI 使用 `space info` 与 `space:read`。

旧 workspace.db 不做自动迁移或删除：打开时明确报错并给出数据库路径，要求用户先备份再显式删除。Drizzle 使用单一 `0000` baseline，fresh DB 初始化 `spaces` 元数据与 `#all`。

模块边界建议：`src/app-data/` 负责 app.db；`src/spaces/` 负责 Space registry/生命周期；`src/human/` 负责唯一 Human；`src/local-runtime/` 负责 Desktop 与 worker 内部协议。实际命名在落地前按现有结构核对，不为目录整齐而搬动无关文件。

验证：A2 最终通过 typecheck、web build（2563 modules）和完整 integration；unit 367 项中 366 项通过，唯一失败仍是既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。fresh/legacy baseline、唯一 Worker 与跨 Space 路由、Worker loopback-only、Machine/旧 Space 契约不可达、Human 状态、任务/消息以及 Space 隔离附件均有覆盖。

### A3 浏览器访问安全边界

当前进度：A3 已完成。浏览器入口不再复用 Human JWT 或开发登录，Desktop/Worker/浏览器三类凭据已彻底分离。

已落地边界：

- `BrowserAccessPolicy` 只表达 off/local/lan 与监听决策：off 只留 Desktop/Worker 私有 loopback 传输，local 绑定 `127.0.0.1`，lan 绑定 `0.0.0.0`。
- `AccessTokenService` 负责 16-256 字符自定义 Token、留空时的 32 字节自动生成、scrypt 哈希、revision 轮换与验证。
- `BrowserSessionService` 只负责持久授权、触碰和撤销；`browserSessionHttp` 集中管理 HttpOnly/Strict Cookie、Origin/CSRF 和公开 Token 验证限速。
- Desktop 专用 `/api/desktop/browser-access` 管理面只认 `x-kith-desktop-token`，对浏览器统一 404；浏览器只能用 Cookie 会话访问产品 API。
- `generateInternalProcessCredentials` 可生成独立 Desktop/Worker 凭据；当前分进程开发从 `KITH_SPACE_DESKTOP_TOKEN`/`KITH_SPACE_WORKER_TOKEN` 注入，Worker 用 `/daemon/connect` 的私有 `x-kith-worker-token` header 握手，不把凭据放入 URL；A4 再由 Desktop 每次启动调用。
- 前端以 Cookie 会话探测和 Access Token Gate 代替 Human Bearer/localStorage JWT、dev-login、`?as=` 和 URL token。Socket 握手只携带 `spaceId`。
- LAN 浏览器拥有完整产品能力，v1 仅 HTTP 且只限受信任私网，明确禁止端口转发或公网暴露。

验证：typecheck 通过，web build 通过（2559 modules），integration 全量通过，unit 除既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro` 外全部通过。策略、Token 密码学、Cookie/CSRF/Origin/限速、Desktop/Worker 内部凭据、Token 验证到会话/产品 API/退出/撤销/轮换失效、前端 Token Gate 与旧 JWT/URL token 活跃路径均有行为或契约覆盖。

### A4 Electron Desktop 宿主

改动边界：

- Electron main 负责启动顺序、健康检查、异常退出和干净关闭。
- Settings 持久化端口、Web 模式、关闭行为和自启动。
- Tray 管理显示主窗口、暂停/恢复可用动作和显式退出。
- 增加 `pnpm run desktop:dev`；保留 server/daemon/web 分进程命令给开发调试。

验证：Windows 开发启动、端口冲突、子进程崩溃、托盘、关闭/退出和自启动冒烟。

### A5 UI 与入口清理

改动：Human 首次初始化、Home 入口与 Desktop Settings；完成 Dock `Chat | Inbox | Tasks | Agents | Settings`；删除 Landing、PWA、`?legacy=1` 和旧入口。Agents/Human Settings 表面迁移及登录/注册/邀请 UI/API 已在 A2.3 提前完成，Computers 已在 A2.4 提前删除，相关 `join_links`/Machine 物理表已在 A2.2b 删除。

验证：路由契约、Dock 状态机、Desktop/Web 设置差异、web build 与浏览器冒烟。

### A6 继承资产清理与总审计

改动：删除 Docker、环境样例、远程部署/发布、公共 server/daemon 包、OIDC workflow 和残余旧领域；保留内部开发/测试覆盖变量。

验证：`rg` 旧路线审计、typecheck、单元/集成测试、web build、Electron 冒烟、许可证和文档检查。

## 4. 强制依赖

- A1 先于任何代码改动，避免继续沿旧路线设计。
- A2 先于 A3/A4/A5；Token、Desktop 和 UI 都依赖唯一 Human、app.db 与 Space 领域。
- A3 已在 LAN 绑定前建立 Token/会话/Origin/CSRF 安全门；后续不得绕过该门直接暴露新路由。
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
