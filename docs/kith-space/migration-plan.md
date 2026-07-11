# Kith-space 分阶段改造计划

本文记录从当前 open-tag 衍生实现收敛到本机个人 AgentOS 的工程顺序。产品边界见 `product-brief.md`，验收见 `mvp-spec.md`，权威转向规格见 `../superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`。

截至 2026-07-11，A1-A6 已全部完成。下一阶段不是继续清理旧路线，而是 Runtime 契约 v2。

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

验证：A2 当时通过 typecheck、web build（2563 modules）和完整 integration；当时的 unit 367 项中 366 项通过，失败项是既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。fresh/legacy baseline、唯一 Worker 与跨 Space 路由、Worker loopback-only、Machine/旧 Space 契约不可达、Human 状态、任务/消息以及 Space 隔离附件均有覆盖；该营销导航契约已在 A5 随对应入口一并删除。

### A3 浏览器访问安全边界

当前进度：A3 已完成。浏览器入口不再复用 Human JWT 或开发登录，Desktop/Worker/浏览器三类凭据已彻底分离。

已落地边界：

- `BrowserAccessPolicy` 只表达 off/local/lan 与监听决策：off 只留 Desktop/Worker 私有 loopback 传输，local 绑定 `127.0.0.1`，lan 绑定 `0.0.0.0`。
- `AccessTokenService` 负责 16-256 字符自定义 Token、留空时的 32 字节自动生成、scrypt 哈希、revision 轮换与验证。
- `BrowserSessionService` 只负责持久授权、触碰和撤销；`browserSessionHttp` 集中管理 HttpOnly/Strict Cookie、Origin/CSRF 和公开 Token 验证限速。
- Desktop 专用 `/api/desktop/browser-access` 管理面只认 `x-kith-desktop-token`，对浏览器统一 404；浏览器只能用 Cookie 会话访问产品 API。
- `generateInternalProcessCredentials` 生成独立 Desktop/Worker 凭据；A4 Desktop 已在每次进程组启动/重启时调用并按最小权限注入。手动分进程开发仍从 `KITH_SPACE_DESKTOP_TOKEN`/`KITH_SPACE_WORKER_TOKEN` 注入；Worker 用 `/daemon/connect` 的私有 `x-kith-worker-token` header 握手，不把凭据放入 URL。
- 前端以 Cookie 会话探测和 Access Token Gate 代替 Human Bearer/localStorage JWT、dev-login、`?as=` 和 URL token。Socket 握手只携带 `spaceId`。
- LAN 浏览器拥有完整产品能力，v1 仅 HTTP 且只限受信任私网，明确禁止端口转发或公网暴露。

验证：typecheck 通过，web build 通过（2559 modules），integration 全量通过，unit 除当时既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro` 外全部通过。策略、Token 密码学、Cookie/CSRF/Origin/限速、Desktop/Worker 内部凭据、Token 验证到会话/产品 API/单会话撤销/全量撤销/轮换失效、前端 Token Gate 与旧 JWT/URL token 活跃路径均有行为或契约覆盖。该公开营销导航契约已随 A5 删除，不再是当前测试基线中的已知失败。

### A4 Electron Desktop 宿主

当前进度：A4 已完成。Electron 43.1.0 Desktop 已成为完整开发宿主；A6 随后补齐了正式生产 bundle、打包与安装器。

已落地边界：

- `DesktopProcessSupervisor` 先启动 Core，等待实际端口 ready IPC 后再启动唯一 Worker 与可选 Vite；端口冲突、ready 超时、关键子进程崩溃和停止失败均有明确诊断与整组收尾。
- app.db 是 Core 端口与 Web/生命周期设置事实源；每次进程组启动/重启都会轮换相互独立的 Desktop/Worker 凭据，受管子进程阻止 `.env` 回灌，渲染器 JavaScript 不持有凭据，Vite 子进程环境不包含凭据。
- BrowserWindow 使用 sandbox、contextIsolation 和关闭 Node 集成的安全基线；拒绝权限、外部导航、新窗口与 webview，preload 只暴露经 sender 校验的 Desktop Settings 窄桥。
- Desktop Settings 管理 off/local/lan、端口、访问 Token/会话、关闭到托盘/关闭即退出和系统自启动；普通浏览器既无入口也不能调用管理 API。
- Tray 管理显示主窗口和显式退出；显式退出优雅停止 Core/Worker 及整个受管进程组。Windows 打包态使用系统自启动接口，开发态显示 unsupported。
- 已增加 `pnpm run desktop:dev` 和 `desktop:build`；保留 server/daemon/web 分进程命令给开发调试。

验证：A4 检查点的 Desktop 构建、监督器/安全策略/IPC/Settings/优雅关闭测试及隔离 `KITH_SPACE_HOME` 的实际 Desktop smoke 已通过。当时 `desktop:build` 只生成 main/preload；这个命令语义在 A6 后仍保持不变，安装器由新增的 `desktop:dist` 生成。

### A5 UI 与入口清理

当前进度：A5 已完成。Desktop 可在全新数据目录中直接完成唯一 Human 与 `Home` 初始化；共享前端只保留单窗口工作区和规范 Space URL，旧 Web 营销/PWA/登录入口与旧界面回退均已删除。

已落地边界：

- `PersonalSetupService` 以“唯一 Human + `Home`”判断完成态。重复初始化幂等返回；若中断后只有 Human，则 status 返回 partial Human 供表单预填恢复。请求仅接受 Human 名称、可选邮箱和描述，不能提交 rootPath 或改变默认首次 Space。
- Desktop-only `GET /api/setup/status` 与 `POST /api/setup/initialize` 位于普通产品鉴权之前，但仍要求 loopback Desktop 私有信任；普通浏览器、Worker、错误凭据和远程请求统一不可见。
- `DesktopSetupBoundary` 位于 `StoreProvider` 外，先完成 setup 再挂载产品 bootstrap。只有完整 preload bridge 会探测 setup API；普通浏览器始终沿用 Cookie 会话探测与 Access Token Gate，不会看到首次初始化页。
- 删除 Landing、Features、旧 `Layout`、`?legacy=1`、SSR/prerender、PWA manifest、公开营销元数据和营销图片；`App` 只渲染 `WorkspaceFrame`，Dock 固定为 `Chat | Inbox | Tasks | Agents | Settings`，Search 仍是顶部工具入口。
- 会话路径成为唯一规范 pathname；模块和资源统一进入 `module`/`chat`/`taskScope`/`agent`/`agentTab`/`settings` query。切换频道或 Human-Agent DM 时保留 active module 与其资源，清掉旧 `msg`/`thread` 焦点，不再生成 `/tasks`、`/agent`、`/settings` 等旧模块实体路径。
- 浏览器自身授权使用 `DELETE /api/browser-auth/session` 撤销并清 Cookie，前端和 Settings 均使用“撤销浏览器访问”语义，不再借用 Human logout 概念。
- 正常 `pnpm run desktop:dev` 在 fresh `KITH_SPACE_HOME` 下不再要求先运行 seed；seed 只保留给手动 fixture/debug 流程。

验证：typecheck、web build（2564 modules）、desktop build、完整 integration 与 439/439 unit 均通过；已删除的公开营销导航契约不再制造历史性测试失败。首次初始化、partial recovery、Desktop/Web 能力差异、规范模块 URL、会话导航与浏览器授权撤销均有行为或契约覆盖。

### A6 继承资产清理与总审计

当前进度：A6 已完成，等待阶段提交。

已落地边界：

- 删除 Dockerfile/compose/entrypoint、Railway、环境样例、prod 脚本、公共 daemon package 与构建脚本、npm/OIDC 发布 workflow、docs-site workflow/路由/脚本；pnpm workspace 仅保留根目录与 `web/`。
- 保留 `server`、`daemon`、`web`、`browser-access:dev`、`dev:e2e:up` 和可选本地 `.env`，仅作为源码分进程调试入口；正式 Desktop 不依赖这些配置或公共发行面。
- Human Settings 规范 resource 收口为 `settings=human`，唯一资料接口为 `GET/PATCH /api/human/profile`；旧 `/api/auth/me` 返回 404，`settings=account` 与 `initialHumans` 产品入口退役。
- 固定 Electron 43.1.0 + electron-builder 26.15.3；`desktop:build` 生成 main/preload，`desktop:bundle` 生成 Web + Core CJS + Worker/agent CLI ESM，`desktop:pack` 生成 `win-unpacked`，`desktop:dist` 生成 x64 per-user assisted NSIS。
- packaged Desktop 用 Electron 可执行文件的 Node 模式监督内置 Core/Worker，并从 `resources` 读取 Web 与 Drizzle migration；构建固定 `npmRebuild=false`，package wrapper 用 `@electron/rebuild` 显式强制生成 Electron x64 `better-sqlite3`，再在 `finally` 中恢复 Node ABI。最终核对为 Node ABI 137、Electron ABI 148。
- 新增仅手动触发的 Windows workflow，只上传未签名 installer artifact，不自动签名、创建 Release 或发布。

验证：旧路线 `rg` 审计、typecheck、449/449 unit、完整 integration、2564-module Web build、`desktop:bundle`/`pack`/`dist`、`pnpm audit --prod --audit-level=high` 均通过。最终 unpacked Desktop fresh smoke Exit 0，Core/Worker ready、内置 assets/setup/CLI、`app.db` 创建均通过，退出后残留进程 0、端口监听 0；packaged Core 真实初始化 Human/Home，workspace.db 为 19 张产品表 + migration 表共 20 张物理表、`user_version=2`，并优雅退出。最终安装器大小 113625983 bytes，SHA-256 `D314DAE15A8E9AB598901D2E3DF8B90DE1C7B46E79824CC8575BD4C742B89646`，Authenticode `NotSigned`。

发行边界：上述结果证明本地/CI 未签名安装器可复现，不代表已签名或已发布。公开分发前必须配置 Windows 代码签名证书；本阶段未实际执行 NSIS 安装/卸载，正式发布前仍需补做。

## 4. 强制依赖

- A1 先于任何代码改动，避免继续沿旧路线设计。
- A2 先于 A3/A4/A5；Token、Desktop 和 UI 都依赖唯一 Human、app.db 与 Space 领域。
- A3 已在 LAN 绑定前建立 Token/会话/Origin/CSRF 安全门；后续不得绕过该门直接暴露新路由。
- A4 已接管配置、内部凭据与受管进程；手动分进程 `.env` 仅保留为仓库调试入口。
- A5 已在稳定的领域/API/Desktop 能力边界上删除旧入口；A6 没有恢复旧兼容面，只保留内部开发调试入口。
- A6 已完成本机化基础收口。Runtime 契约 v2 现在成为生产力模块、可靠 usage 预算和统一 MCP bootstrap 的直接前置。

## 5. 主要风险

| 风险 | 处理 |
|---|---|
| `server` 同时表示 HTTP 服务和 Space 领域 | 分批迁移，先定义 Space 领域与兼容边界，再改 schema/API；HTTP 进程称 Core Service |
| 删除 Human membership 误伤 agent membership | 先把两种关系拆成独立测试，再只删除 Human 分支 |
| 删除 Machine 误伤 daemon 进程隔离 | 保留 Local Runtime Worker 进程和内部协议，只删除远程注册/多主机领域 |
| LAN + 高权限 runtime 扩大攻击面 | 默认关闭、Token、持久会话/撤销、私网警告；高风险模块上线前补 HTTPS 与权限升级 |
| 大范围命名迁移造成一次性失控 diff | 按 schema、服务、API、前端四个可验证切片推进，不整仓机械替换 |
| Desktop 构建产物被误标为正式发布 | 区分 `desktop:build`、`desktop:bundle`、`desktop:pack` 与 `desktop:dist`；当前 installer 未签名且未执行真实安装/卸载，公开分发前必须补代码签名与安装验收 |
