# 开发进度与续接指南 - Kith-space

本文件是当前进度的权威来源。新会话先读本文件和 `AGENTS.md`，再按文档地图进入专项资料。

最后更新：2026-07-11。

## 一、现在在哪

- 分支：`feat/p0-foundation`，尚未合并或推送远端。
- 已完成：P0-P3 后端；P4 单窗口 ChatOnly / Split / ModuleOnly 生产壳；任务模块“全部任务/频道任务”范围侧栏。
- 当前阶段：**A4 Electron Desktop 宿主已完成**。Electron 43.1.0 已接管 Core Service、唯一 Local Runtime Worker 与开发期 Vite 的启动监督、临时凭据、托盘生命周期和 Desktop Settings；下一步进入 A5 首次 Human 初始化与旧界面/登录残留清理。
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
- Dock 目标为 `Chat | Inbox | Tasks | Agents | Settings`；旧 `Layout` 回退将彻底删除。
- 允许破坏性重置当前开发数据，不做旧 `.kith` schema 迁移。

完整共识与验收见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`。决策推理见 `docs/decisions.md` 决策 21，工程顺序见 `docs/kith-space/migration-plan.md`。

## 三、已完成提交

| 提交 | 内容 |
|---|---|
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
- P4 壳位于 `web/src/shell/`。URL 以频道/DM 路径、`?module=<id>` 和 `chat=0` 表达三态；Split 默认 Chat 25%。
- 产品登录/注册、成员/RBAC/邀请 API、Web Human roster、Human-Human DM、Machines API 和 Computers UI 已删除；Dock/模块使用 Agents，频道成员只增删 agent，Human 资料入口位于 Settings。A3 进一步删除了 Human JWT、dev-login、`?as=`、localStorage/Bearer 会话和附件/Socket URL token；未授权浏览器只看到 Access Token Gate。Landing、`?legacy=1`、Docker/发布等其他继承资产仍待 A5/A6 清理。
- Core Service 启动时从 app.db 读取 Web 模式：off（默认）与 local 均绑定 `127.0.0.1`，lan 绑定 `0.0.0.0`。off 只留 Desktop/Worker 私有传输，普通浏览器壳被拒绝；LAN 只允许匹配 Host 的 Origin。`/health` 只对 loopback/Desktop 可见并暴露 `workerConnected`。
- 访问 Token 可自定义 16-256 字符，留空自动生成 32 字节；app.db 只存 scrypt 哈希和 revision。原始 browser session token 只进 HttpOnly、SameSite=Strict Cookie，DB 只存 SHA-256 哈希；写请求同时校验 Origin 和 CSRF。Token 轮换或 Desktop 全量撤销会使旧会话失效。
- `src/desktop/processSupervisor.ts` 先启动 Core，并等待其通过 IPC 报告 app.db 中的实际端口；收到 ready 后才启动唯一 Worker 和可选 Vite。Core 报端口占用、ready 超时或任一关键子进程异常时会给出明确诊断并收掉进程组；显式退出按 Vite、Worker、Core 顺序停止，Worker 等待全部 runtime 报告退出，超时后使用 Windows process tree 或 Unix process group 强制收尾。终止失败会保留句柄和托盘重试入口，不会假装退出成功。
- Desktop 每次启动或重启进程组都会轮换独立的 Desktop/Worker 32 字节凭据。Core 仅同时持有两者，Worker 只持有 Worker 凭据，Vite 子进程环境不包含两者；`KITH_SPACE_DESKTOP_MANAGED=1` 阻止受管子进程从 `.env` 回灌凭据。agent runtime 环境会大小写无关剥离全部宿主 `KITH_SPACE_*`/IPC/端口变量，只重加当前 agent 的 server URL、id 和 token。渲染器 JavaScript 不接触 Desktop 私有凭据，Electron session 只在允许的 loopback Core/API/socket 请求上附加信任 header，并排除 `/api/desktop/*` 管理路径。
- `src/desktop/main.ts` 使用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 的 BrowserWindow，拒绝新窗口、外部导航、webview 与全部权限请求；`src/desktop/preload.ts` 只暴露读取/修改 Desktop Settings 和撤销浏览器会话的窄桥，IPC 同时校验发送者。
- app.db 现保存 `desktop_settings` 单例（关闭到托盘/关闭即退出、系统自启动）以及既有浏览器访问设置。Desktop Settings 管理 off/local/lan、端口、访问 Token、会话撤销和生命周期；进入 LAN 前先确认明文 HTTP 风险，自动生成的 Token 保持显示到用户主动确认已保存。普通浏览器没有 preload bridge，Desktop 管理 HTTP 路由继续统一返回 404。Windows 打包态使用 Electron 系统自启动接口，开发态明确显示 unsupported。
- `pnpm run desktop:dev` 是完整开发宿主入口；`desktop:build` 只构建 Electron main/preload，不生成安装器。`server`、`daemon`、`web`、`browser-access:dev` 与 `dev:e2e:up` 继续保留给分进程调试，手动模式仍需独立环境凭据。正式生产子进程 bundle、Windows 安装器和发行流程尚未完成。
- LAN 浏览器具有完整产品能力，v1 仅支持桌面浏览器和 HTTP；只限受信任私网，禁止端口转发或公网暴露。
- Message Context Snapshot 仍是设计契约，尚未持久化。
- token 预算目前以唤醒次数为代理；真实 usage 等待 Runtime 契约 v2。
- 外接 runtime 仍使用高权限模式。邮箱/浏览器等不可信内容模块上线前必须补 HTTPS 与审批/沙箱权限升级。

## 五、下一步顺序

1. A5：实现首次 Human 初始化与 Home 进入流程，彻底删除 Landing、`?legacy=1`、旧 `Layout` 和登录残留；保留 A4 已落地的 Desktop Settings 能力边界。
2. A6：清理继承的部署/发布资产，完成 Windows 正式打包/安装器和总审计。
3. 本机化基础稳定后再做 Runtime 契约 v2、生产力模块、Context Snapshot 与 P4 视觉收尾。

每阶段独立验证、独立中文提交。未获得用户明确指示，不合并 main、不推远端、不发布。

## 六、验证与工作约定

- 包管理使用 pnpm；脚本参数直接跟在后面，例如 `pnpm test --unit`。
- 常规验证：`pnpm run typecheck`、`pnpm test --unit`、`pnpm test --integration`、`pnpm --dir web run build`。
- 测试把 `KITH_SPACE_HOME` 指向仓库内或系统临时目录，绝不在用户 home 生成测试数据。
- 既有 `publicNavContract` 因缺 `docs-site/` 的失败是已知基线，不能用无关 hack 掩盖。
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
- `docs/dev-commands.md`：当前可运行的开发命令；以代码现状为准持续更新。
- `docs/glossary.md`：术语正典。
