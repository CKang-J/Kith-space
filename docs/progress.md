# 开发进度与续接指南 - Kith-space

本文件是当前进度的权威来源。新会话先读本文件和 `AGENTS.md`，再按文档地图进入专项资料。

最后更新：2026-07-11。

## 一、现在在哪

- 分支：`feat/p0-foundation`，尚未合并或推送远端。
- 已完成：P0-P3 后端；P4 单窗口 ChatOnly / Split / ModuleOnly 生产壳；任务模块“全部任务/频道任务”范围侧栏。
- 当前阶段：**A2 本地领域与数据模型进行中**。A2.1 app.db/Human/Home、A2.5 本地附件、A2.2a Space 契约、A2.3 唯一 Human authority/identity、A2.4 Machine/远程 worker 活跃产品路径删除，以及 A2.2b workspace.db baseline 均已落地；下一步是 A2 收口，而不是进入 A3。
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
- `src/app-data/appDatabase.ts` 是 app.db Human 事实源；`src/human/humanAuthority.ts` 把临时 JWT subject 限定为唯一 Human；`src/human/humanIdentity.ts` 提供稳定 `@you` handle 与 app.db 展示名。REST、公开附件和 Socket 不再查询 `server_members` 授权，新 Space 也不再写该行。
- A2.2b 已把 workspace.db 压成单一 19 表 baseline：`spaces/space_id` 是唯一领域命名；`users/server_members/machines/join_links` 与 `agents.machine_id` 已删除。`channel_agent_members` 只表达 agent membership；唯一 Human 的 read/DM/thread、收藏与 Space 偏好分别落在 `human_channel_states`、`human_saved_messages`、`human_space_preferences`。持久 actor discriminator 使用 `human`，runtime 协议自身的 `role: "user"` 不受影响。
- A2.4 已建立 `src/local-runtime/workerHub.ts` 安装级唯一 Worker 控制面：同一时刻只认一个连接，新连接以专用关闭码替换旧连接，旧进程停止自动重连，generation lease 阻止 stale ready/event/disconnect/catch-up 覆盖当前状态；ready snapshot 报告 runtimes/runningAgents 等运行信息，不再携带 Machine 身份。`src/local-runtime/agentLocator.ts` 与 Worker reconnect/reconcile 会遍历本机 Space registry，让唯一 Worker 的状态、轨迹、session、回复和补唤醒正确回到 agent 所属 Space。
- Machine/Computer 活跃路径和物理 schema 均已删除：没有 Machines API、machine 注册/密钥/心跳/调度、agent machine 选择、Computers Dock/路由、`machines` 表或 `agents.machine_id`。不能据此恢复 Machine 产品概念。
- canonical 契约为 `/api/spaces`、`x-space-id`、Socket `spaceId` 与 `SpaceCtx`；旧 `/api/servers`、`x-server-id`、Socket `serverId`、`ServerCtx` 和 DB workspace facade 已删除。Agent CLI 使用 `space info` 与 `space:read`。
- 附件存储已删除 S3 driver/SDK/config，只走本地磁盘并校验平面 storage key；当前仍使用 app 级 `uploads/`，Space 根路径收敛放在 A2 最终 schema 压平时完成。
- A2.4 验证：`pnpm run typecheck` 通过，`pnpm run web:build` 通过（2563 modules），`pnpm test --integration` 全量通过；`pnpm test --unit` 361 项中 360 项通过，唯一失败仍是既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。Worker 单例/替换与 stale generation、产品 API 不再接受 Machine、跨 Space 路由和旧 Computers 路由降级均有契约或行为测试覆盖。
- A2.2b 验证：`pnpm run typecheck` 通过，`pnpm run web:build` 通过（2563 modules），`pnpm test --integration` 全量通过；`pnpm test --unit` 364 项中 363 项通过，唯一失败仍是既有 `publicNavContract` 缺 `docs-site/src/pages/index.astro`。fresh baseline、legacy schema 拒绝、canonical Space transport、唯一 Human channel state 与 agent-only membership 均有行为或契约测试覆盖；A2 最终收口后仍需再跑一次整阶段验收。
- P4 壳位于 `web/src/shell/`。URL 以频道/DM 路径、`?module=<id>` 和 `chat=0` 表达三态；Split 默认 Chat 25%。
- 产品登录/注册、成员/RBAC/邀请 API、Web Human roster、Human-Human DM、Machines API 和 Computers UI 已删除；Dock/模块使用 Agents，频道成员只增删 agent，Human 资料入口位于 Settings；匿名页的“进入空间”只触发 A3 前临时 dev-login。A2.2b 又删除了 raw `user` 持久 actor、旧 `/api/servers`/`x-server-id`/Socket `serverId`、workspace.db `servers/server_id` 与 Machine 物理字段。临时 JWT/dev-login、Landing、`?legacy=1`、`.env`/Worker bootstrap key、Docker/发布仍待后续阶段清理，这些不是目标能力。
- Core Service 当前强制绑定 `127.0.0.1`；`/health` 暴露 `workerConnected`，`dev:e2e:up` 只有在唯一 Local Runtime Worker ready 后才继续 seed dev-bot。A3 完成访问 Token 与浏览器会话前不得开放 LAN 监听。
- 当前开发启动仍暂时依赖现有环境变量和分进程命令；在 A3/A4 接管设置与内部凭据前，`docs/dev-commands.md` 必须继续如实记录过渡命令。
- Message Context Snapshot 仍是设计契约，尚未持久化。
- token 预算目前以唤醒次数为代理；真实 usage 等待 Runtime 契约 v2。
- 外接 runtime 仍使用高权限模式。邮箱/浏览器等不可信内容模块上线前必须补 HTTPS 与审批/沙箱权限升级。

## 五、下一步顺序

1. A2 收口：把仍为 app 级的上传目录纳入 Space 根路径，清理残余本地领域资产，跑完整验证并更新 A2 验收状态。
2. A3：实现 Web 三模式、访问 Token、浏览器会话和内部临时凭据；在此之前保持 loopback-only。
3. A4-A6：Electron 宿主、UI/入口清理和继承资产总审计。
4. 本机化基础稳定后再做 Runtime 契约 v2、生产力模块、Context Snapshot 与 P4 视觉收尾。

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
