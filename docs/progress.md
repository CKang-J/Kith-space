# 开发进度与续接指南 - Kith-space

本文件是当前进度的权威来源。新会话先读本文件和 `AGENTS.md`，再按文档地图进入专项资料。

最后更新：2026-07-12。

## 一、现在在哪

- 分支：`feat/p0-foundation`，尚未合并或推送远端。
- 已完成：P0-P3 后端；P4 单窗口 ChatOnly / Split / ModuleOnly 生产壳；任务模块“全部任务/频道任务”范围侧栏。
- 当前阶段：**A1-A6 已完成，正在由用户验收**。验收期已修复 Windows runtime 发现/启动、宿主原生 CLI wrapper 与 UTF-8 中英文流问题；Runtime 契约 v2 暂停，只有用户确认 A1-A6 验收通过后才进入下一阶段。
- P4 视觉微调已暂停，等本机化基础收敛后再恢复。
- 底座为 open-tag 衍生开发副本；`reference/` 只读。OpenLoaf 只作设计参考，禁止复制 AGPL 源码。

## 二、2026-07-11 路线转向

产品已正式收敛为 Desktop-first、单 Human、本机 agent 的个人 AgentOS：

- 一个安装实例只有一个 Human，可管理多个本地 Space。
- 所有 agent 只在本机唯一 Local Runtime Worker 上执行。
- Desktop 是唯一正式宿主和发行物；浏览器入口依附 Desktop，可关闭、仅本机或 LAN。
- LAN 浏览器拥有完整产品能力，v1 使用 HTTP + 访问 Token，只限受信任私网。
- 删除多真人、邀请/RBAC、Machines/Computers、远程 daemon、服务器部署、云同步、S3、Docker、PWA 和独立 Web 发行路线。
- 中央 registry 已扩展并更名为 `app.db`；每个 Space 继续使用 `<space>/.kith/workspace.db`。
- Dock 已固定为 `Chat | Inbox | Tasks | Agents | Settings`；旧 `Layout` 回退、Landing 与 PWA 已删除。
- 允许破坏性重置当前开发数据，不做旧 `.kith` schema 迁移。

完整共识与验收见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`。决策推理见 `docs/decisions.md` 决策 21，工程顺序见 `docs/kith-space/migration-plan.md`。

## 三、已完成提交

| 提交 | 内容 |
|---|---|
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

- 数据层是 SQLite：中央 `app.db` 保存唯一 Human 与 `spaces` registry；每 Space 使用 `<rootPath>/.kith/workspace.db`。canonical 连接入口为 `dbForSpace(spaceId)` / `listSpaces()`；`dbFor`、`listWorkspaces`、`registerWorkspace` 等 workspace facade 已删除。
- `src/app-data/appDatabase.ts` 是 app.db 事实源：除唯一 Human/Space registry 外，A3 增加单例 `browser_access_settings` 与 `browser_sessions`。REST、附件读取和 Socket 的 Human authority 只来自 Desktop 私有信任或已验证的浏览器 Cookie 会话，不再查询 `server_members`，也不存在 Human JWT/Bearer/dev-login。`src/human/humanIdentity.ts` 继续提供稳定 `@you` handle 与 app.db 展示名。
- A2.2b 已把 workspace.db 压成单一 19 表 baseline：`spaces/space_id` 是唯一领域命名；`users/server_members/machines/join_links` 与 `agents.machine_id` 已删除。`channel_agent_members` 只表达 agent membership；唯一 Human 的 read/DM/thread、收藏与 Space 偏好分别落在 `human_channel_states`、`human_saved_messages`、`human_space_preferences`。持久 actor discriminator 使用 `human`，runtime 协议自身的 `role: "user"` 不受影响。
- A2.4 已建立 `src/local-runtime/workerHub.ts` 安装级唯一 Worker 控制面：同一时刻只认一个连接，新连接以专用关闭码替换旧连接，旧进程停止自动重连，generation lease 阻止 stale ready/event/disconnect/catch-up 覆盖当前状态；ready snapshot 报告 runtimes/runningAgents 等运行信息，不再携带 Machine 身份。Worker 入口只连接 `127.0.0.1:$PORT`，不再接受远程 `--server-url`。`src/local-runtime/agentLocator.ts` 与 Worker reconnect/reconcile 会遍历本机 Space registry，让状态、轨迹、session、回复和补唤醒正确回到 agent 所属 Space。
- Machine/Computer 活跃路径和物理 schema 均已删除：没有 Machines API、machine 注册/密钥/心跳/调度、agent machine 选择、Computers Dock/路由、`machines` 表或 `agents.machine_id`。不能据此恢复 Machine 产品概念。
- canonical 契约为 `/api/spaces`、`x-space-id`、Socket `spaceId` 与 `SpaceCtx`；旧 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 和 DB workspace facade 已删除。Agent CLI 使用 `space info` 与 `space:read`。
- 附件存储已删除 S3 driver/SDK/config，只走本地磁盘并校验平面 storage key。`src/server/storage.ts` 以 `spaceId` 查询 app.db registry 后固定读写 `<spaceRoot>/.kith/uploads`；公开下载使用附件记录的 Space，agent plane 使用认证 Space，调用方不能传入任意根路径。旧 `KITH_SPACE_UPLOAD_DIR` 配置与两份不兼容的一次性维护脚本已移除。
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
- 最终 unpacked Desktop fresh smoke 以全新隔离数据目录运行并 Exit 0：Core/Worker ready，内置 Web/Drizzle/setup status 可用，`app.db` 成功创建，`kith-space.cmd --help` 可运行；退出后残留受管进程为 0，7777/5273 监听为 0。另一次 packaged Core 真实初始化创建唯一 Human 与 `Home`；当时生成的 workspace.db 为 19 张产品表 + `__drizzle_migrations` 共 20 张物理表、`PRAGMA user_version=2`，并完成优雅退出；当前连接时会自动升级为 schema v3。
- 最终安装器为 `D:/Projects/multi-agent/dist/desktop/Kith-space-Setup-0.1.0-x64.exe`，大小 113625983 bytes，SHA-256 `D314DAE15A8E9AB598901D2E3DF8B90DE1C7B46E79824CC8575BD4C742B89646`，Authenticode 状态 `NotSigned`。这是可复现的本地/CI 未签名安装器，不代表已签名或已发布；公开分发前仍需 Windows 代码签名证书，且本阶段没有实际执行 NSIS 安装/卸载流程。
- P4 壳位于 `web/src/shell/`。URL 以频道/DM 路径、`?module=<id>` 和 `chat=0` 表达三态；Split 默认 Chat 25%。
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
- Agent 首轮生命周期已拆成三种显式场景：`create` 只向 `dm:@you` 做一次简短自我介绍，`manual` 启动/恢复在空收件箱时静默，`wake` 处理真实持久化投递并在每个原目标回复。Core 会把创建、消息/任务和 reconnect backlog 的原因传给唯一 Worker；启动准备期的投递被合并为单个 wake turn。候选 introduction turn 使用一次性 token，只有 Worker 实际选择 introduction prompt 才注入进程，CLI 也只在 `message send --introduction` 时附带；普通 wake 回复不携带 token。真实 wake 会撤销 active token 并拒绝迟到问候，completed token 的重复问候同样拒绝。Human DM 在异步校验后、事务前同步消费，因此被忽略的重复 start 和普通回复都不会误记为介绍。介绍消息与 `agents.introduced_at` 原子提交，普通重启保留，完整 wipe 清除；schema v3 会安全升级 v2 并将已有 agent 回填为已介绍。定向 TDD、typecheck、476/476 全量单测、全量集成和 Web build 均通过。
- LAN 浏览器具有完整产品能力，v1 仅支持桌面浏览器和 HTTP；只限受信任私网，禁止端口转发或公网暴露。
- Message Context Snapshot 仍是设计契约，尚未持久化。
- token 预算目前以唤醒次数为代理；真实 usage 等待 Runtime 契约 v2。
- 外接 runtime 仍使用高权限模式。邮箱/浏览器等不可信内容模块上线前必须补 HTTPS 与审批/沙箱权限升级。

## 五、下一步顺序

1. 用户完成 A1-A6 验收；确认通过前不进入下一阶段。
2. Runtime 契约 v2：统一 Claude Code、Codex、opencode 的 usage、完成/取消事件与 MCP bootstrap。
3. 生产力模块、Message Context Snapshot 与 P4 视觉收尾；邮箱/浏览器等高风险模块仍以后续 HTTPS 与 runtime 权限升级为硬前置。

每阶段独立验证、独立中文提交。未获得用户明确指示，不合并 main、不推远端、不发布。

## 六、验证与工作约定

- 包管理使用 pnpm；脚本参数直接跟在后面，例如 `pnpm test --unit`。
- 常规验证：`pnpm run typecheck`、`pnpm test --unit`、`pnpm test --integration`、`pnpm --dir web run build`。
- 测试把 `KITH_SPACE_HOME` 指向仓库内或系统临时目录，绝不在用户 home 生成测试数据。
- 当前验收单测基线为 476/476；旧 `publicNavContract` 随 public landing 路线一起删除，不再接受把它列为可忽略失败。A2-A6 小节里的旧数字只描述当时检查点，不是当前基线。
- 新功能优先拆到职责清楚的模块；不整块重写 `src/server/core.ts` 或大型 React 组件。
- 代码、命令、架构、UI、术语或阶段变化时，同一提交同步相应文档。
- 用户未要求时不修改或提交 `.agents/`、`.claude/`、`.codegraph/daemon.pid`、`skills-lock.json` 等外部/个人工具文件。

## 七、文档地图

- `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`：本次转向完整规格。
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
