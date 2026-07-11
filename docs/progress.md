# 开发进度与续接指南 - Kith-space

本文件是当前进度的权威来源。新会话先读本文件和 `AGENTS.md`，再按文档地图进入专项资料。

最后更新：2026-07-11。

## 一、现在在哪

- 分支：`feat/p0-foundation`，尚未合并或推送远端。
- 已完成：P0-P3 后端；P4 单窗口 ChatOnly / Split / ModuleOnly 生产壳；任务模块“全部任务/频道任务”范围侧栏。
- 当前阶段：**A1 个人 AgentOS 本机化权威文档收敛已完成，等待用户审阅规格**。
- P4 视觉微调已暂停。用户确认 A1 书面规格后，进入 A2 本地领域与数据模型。
- 底座为 open-tag 衍生开发副本；`reference/` 只读。OpenLoaf 只作设计参考，禁止复制 AGPL 源码。

## 二、2026-07-11 路线转向

产品已正式收敛为 Desktop-first、单 Human、本机 agent 的个人 AgentOS：

- 一个安装实例只有一个 Human，可管理多个本地 Space。
- 所有 agent 只在本机唯一 Local Runtime Worker 上执行。
- Desktop 是唯一正式宿主和发行物；浏览器入口依附 Desktop，可关闭、仅本机或 LAN。
- LAN 浏览器拥有完整产品能力，v1 使用 HTTP + 访问 Token，只限受信任私网。
- 删除多真人、邀请/RBAC、Machines/Computers、远程 daemon、服务器部署、云同步、S3、Docker、PWA 和独立 Web 发行路线。
- 中央 registry 将扩展并更名为 `app.db`；每个 Space 继续使用 `<space>/.kith/workspace.db`。
- Dock 目标为 `Chat | Inbox | Tasks | Agents | Settings`；旧 `Layout` 回退将彻底删除。
- 允许破坏性重置当前开发数据，不做旧 `.kith` schema 迁移。

完整共识与验收见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`。决策推理见 `docs/decisions.md` 决策 21，工程顺序见 `docs/kith-space/migration-plan.md`。

## 三、已完成提交

| 提交 | 内容 |
|---|---|
| `ec6b735` | 恢复 Tasks 全部/频道范围侧栏；更新 CodeGraph 与相关进度资料 |
| `0a8eb89` | P4-3 单窗口工作区生产壳、25/75 响应式分栏和路由状态机 |
| `7cc026e` | 单窗口原型、交互规格、面板视觉语言与 Context Snapshot 契约 |
| P3 提交 | 任务事务、并发保护、状态图、report/delivery 和 `src/server/tasks/` 模块化 |
| P2 提交 | 三层记忆、角色模板和记忆结构约定 |
| P1 提交 | 分派深度、唤醒预算、急停和 plan-first 软闸 |
| P0 提交 | SQLite、每 Space workspace.db、中央 registry、改名与许可证基线 |

Runtime 对接调研已完成，位于 `docs/kith-space/notes/_runtime-research/`。这些文档中的多设备参考只作技术背景，不代表新产品路线。

## 四、当前代码事实与过渡债

- 数据层已经是 SQLite：每 Space `<rootPath>/.kith/workspace.db`，中央库目前仍名为 `registry.db`；连接入口是 `src/db/index.ts` 的 `dbFor(workspaceId)`。
- P4 壳位于 `web/src/shell/`。URL 以频道/DM 路径、`?module=<id>` 和 `chat=0` 表达三态；Split 默认 Chat 25%。
- 当前代码仍有 Members、Computers、Machine、多 Human/认证、`server/serverId` 领域名、`?legacy=1`、`.env`/daemon key、Docker/S3/发布遗留。它们属于 A2-A6 删除清单，不是目标能力。
- 当前开发启动仍暂时依赖现有环境变量和分进程命令；在 A3/A4 接管设置与内部凭据前，`docs/dev-commands.md` 必须继续如实记录过渡命令。
- Message Context Snapshot 仍是设计契约，尚未持久化。
- token 预算目前以唤醒次数为代理；真实 usage 等待 Runtime 契约 v2。
- 外接 runtime 仍使用高权限模式。邮箱/浏览器等不可信内容模块上线前必须补 HTTPS 与审批/沙箱权限升级。

## 五、下一步顺序

1. 审阅并确认 A1 权威规格；如有调整，在进入代码前修正文档。
2. A2：建立 app.db、唯一 Human/Home、Space 领域；删除 Human membership/RBAC、Machine 和 S3。
3. A3：实现 Web 三模式、访问 Token、浏览器会话和内部临时凭据。
4. A4：Electron 进程监督、`desktop:dev`、托盘、自启动和 Desktop Settings。
5. A5：初始化 UI、Agents、删除 Computers/login/landing/PWA/legacy。
6. A6：删除 Docker、远程发布/部署和残余旧口径，完成总验证。
7. 本机化基础稳定后再做 Runtime 契约 v2、生产力模块、Context Snapshot 与 P4 视觉收尾。

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
