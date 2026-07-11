# 开发进度与续接指南 — Kith-space

本文件是**当前进度的权威来源**，写给"没有任何对话上下文的新会话/新模型"：读完它 + `AGENTS.md` 指的文档地图，就能知道现在在哪、已做什么、接下来怎么推进。**进度一变就更新本文件**（见 `AGENTS.md` 文档更新规则）。

最后更新：2026-07-11。

## 一、现在在哪

- 分支：`feat/p0-foundation`（从 `main`/`master` 切出，尚未合并、尚未推远端）。
- 阶段：P0–P3 后端已完成并提交；**P4-3 单窗口工作区联调进行中**。此前 P4-1/2/2b 的双壳方向已被用户推翻；单窗口设计规格、原型和生产壳第一版已提交，继续按用户反馈补齐模块能力与视觉细节。
- 底座已从 open-tag fork 到根目录，四个参考项目在 `reference/`（只读，勿改）。

## 二、已完成（按提交，最新在上）

| 提交 | 内容 |
|---|---|
| `0a8eb89 feat(ui): 完成 P4-3 单窗口工作区生产壳` | 用 ChatOnly / Split / ModuleOnly 取代旧双壳，接入常驻 Dock、模块工作面、25/75 响应式分栏、路由状态机与配套文档测试 |
| `7cc026e docs(ui): 固化单窗口工作区原型与设计规格` | 确认 ChatOnly / Split / ModuleOnly 三态、Dock 行为、OpenLoaf 式面板骨架、Context Snapshot 设计契约与桌面交互原型 |
| `docs: runtime 调研汇总` | Runtime 对接调研整块（见 `notes/_runtime-research/`）：claude-code / codex / opencode 三份 + `_synthesis-openagents.md` + README 索引 |
| `feat(tasks): P3` | 任务模块后端加固：事务化、并发保护（claim 条件更新 / assign revision CAS）、状态流转模型、交付/汇报链路、模块化到 `src/server/tasks/` |
| `docs: 开发命令 + 文档更新规则` | `docs/dev-commands.md`；README/AGENTS/CLAUDE 加命令入口与强制文档更新规则 |
| `feat(memory): P2` | 三层记忆（用户/空间/agent，`src/daemon/memoryLayers.ts`）+ 一事一文件约定进 prompt + 角色模板（`src/agents/roleTemplates.ts`） |
| `build: pnpm` | 包管理 npm→pnpm（决策 20）；发布 workflow 保留 `npm publish` 护 OIDC |
| `feat(orchestration): P1` | 编排三护栏（`src/server/dispatchGuard.ts`：深度上限/唤醒预算/急停）+ plan-first 软闸 + 闭环验证 |
| `docs: opencode agent` | opencode 自带 agent 与我们的关系（不冲突，两层） |
| `feat(db): 数据层` | Postgres+Redis → SQLite + 每工作区独立 db（决策 18/19），中心 registry，进程内计数器替代 Redis |
| `refactor: 改名` | open-tag → Kith-space 全局改名 |
| `基线` | open-tag 源码副本 + Kith-space 设计文档 |

当前分支共 24 个提交。每一波都经 leader 独立验收（非仅采信子代理），验收协议见第四节。

已提交的 P4-3 单窗口生产壳中，`web/src/shell/WorkspaceFrame.tsx` 取代双壳入口；`workspaceLayout.ts` 用纯状态机表达 ChatOnly / Split / ModuleOnly，URL 作为模块选择与 Chat 显隐的唯一事实来源（频道/DM 路径 + `?module=<id>` = Split，再加 `chat=0` = ModuleOnly），`workspaceRoute.ts` 补齐父壳手动渲染时的频道、成员、机器、设置等子路由参数，并确保 Split 内切换会话保留模块；旧模块实体路径仍兼容。`paneConstraints.ts` 集中计算 Chat 25% 响应式下限、模块差异下限和单 Pane 阈值；`shellStore.ts` 保存版本化模块宽度比例并按 Space 持久化最近 Chat 位置，旧像素宽度偏好不再参与布局。Space 切换保留布局和模块但清除临时详情。

ChatOnly 复用 `ChatSidebar` / `Chat` / `LiveTrace` 形成三张白色工作面板；Split 将会话列表与轨迹收为 Chat 内互斥抽屉，频道、布局或 Space 变化时自动关闭。Module Pane 薄适配 Inbox、Tasks、Members、Computers、Settings，Search 由顶部工具组打开。Dock 常驻且当前模块横向展开，模块区与 Chat 间完整 10px 间隙可拖拽；Split 内切换模块保留比例，从 ChatOnly 打开模块、关闭后重开或从 ModuleOnly 恢复 Chat 均重置为 Chat 25%。拖拽曾因模块 `flex: 1` 覆盖显式宽度失效，现已改为固定 `flex-basis`。旧 `OverviewShell`、`SpaceShell`、`IconRail`、`RightDock`、`ChatSlot` 已删除；`?legacy=1` 仍保留旧 `Layout` 回退。Message Context Snapshot 目前只是设计契约，尚未实现服务端持久化。

当前工作树（未提交）：任务 Module Pane 改为复用现有 `Tasks` 完整视图，恢复“全部任务 / 指定频道任务”范围侧栏；范围导航携带当前模块查询参数，避免切换任务范围时丢失 Split / ModuleOnly 姿态。

本轮已通过根 `pnpm run typecheck`、web 生产构建（2565 modules）、布局 / 路由 / 分栏约束纯函数测试 21/21；全量单测最近基线为 368/369，唯一失败仍是既有 `publicNavContract` 缺 `docs-site/`。Chat 下限随后按用户确认从 35% 调整为 25%；本次参数调整按用户要求只做静态验证，不重跑浏览器 QA，上一轮 35% 的浏览器尺寸数据不再作为当前宽度验收结果。

任务范围侧栏恢复后再次通过根 `pnpm run typecheck`、web 生产构建（2565 modules）与 21/21 壳测试。浏览器已验证 Split 中“全部任务 → 指定频道”和 ModuleOnly 中“指定频道 → 全部任务”均正确更新任务范围，后者持续保留 `chat=0`；无新增应用控制台错误。

## 三、接下来怎么推进（顺序 + 依据）

1. **P4 UI 联调（进行中）**：先完成单窗口生产壳的构建、状态机与浏览器回归，再交回用户 run-and-review；后续继续按截图逐块调整视觉，不自行扩展未确认的高保真细节。
2. **P5 Electron 桌面壳**：包 daemon+server+web，双击即用；v1 仅 level-one（本机浏览器 localhost）。
3. **Runtime 契约 v2**（见 `roadmap.md` §2.0，近期高优先但排在 UI 之后）：加 usage/turn-done 回调把 P1 token 护栏升级为真实计量 + 统一 MCP bootstrap 解锁"模块即 MCP 工具"。调研已完成（`notes/_runtime-research/`），建 contract 时照其收敛建议。
4. **P6 生产力模块**（邮箱/日历/画布，经 MCP）：依赖 Runtime 契约 v2 + 一次安全升级（上不可信内容前必须把 bypassPermissions 换成审批/沙箱，见决策 8/17、roadmap §2.1）。
5. **最终 codex review 审计**：用户最初要求的收尾审计，宜在 v1 形态齐全（UI 做完）时做，不是半成品时。

未合并/未推远端；何时合 `main`、何时推、是否发布，都等用户明确指示。

## 四、开发工作方式（leader 调度约定，务必延续）

- **调度外部 agent 用 codeg-mcp 的 `delegate_to_agent`**（不是内置 Agent 工具）。本会话 `claude_code` agent 类型不稳定（秒退 "child session ended without TurnComplete"），**用 `codex` 通道**（稳定、task_id 可查）。拿到 task_id 后先 `get_delegation_status` 验真在跑。
- **耦合的核心路径单线程派一个 agent**（多 agent 同改必冲突）；只有文件层面零重叠的活才并行。
- **安全边界（每个委派任务必须写死）**：只在仓库 `D:\Projects\multi-agent` 内写/删；**严禁碰仓库外任何路径，尤其用户 home `C:\Users\Administrator`**；严禁破坏性 shell 清理；测试建数据目录必须用 `KITH_SPACE_HOME=$(mktemp -d)` 重定向、绝不落 home；PowerShell 里别用 `$home` 做变量名（等于只读 `$HOME`）。此边界源于一次真实事故：一个子代理曾用 PowerShell `$home` 误删了用户 `~/.agents`。
- **leader 独立验收，不盲信报告**：每波完成后亲自跑 `pnpm run typecheck`、`pnpm test --unit`、`pnpm test --integration`（**pnpm 传参不加 `--`**），全程 `KITH_SPACE_HOME` 指临时目录、零 Postgres/Redis；核查 home 无误建 db/目录、工作树无 db 文件混入、只改了该改的文件；达标才 `git commit`（子代理不提交）。
- **既有基线失败**：`test/publicNavContract.unit.test.ts` 因仓库缺 `docs-site/` 而失败，非回归，历来如此，别为它 hack。
- **委派任务里禁止 `codegraph init`**（子代理常想跑，直接读文件即可）。
- **提交信息**：中文、列要点、用纯标点避免乱码（少用 → ✅ │ — 等特殊字符，终端会乱码）；只在用户要求时提交；先分支不直推主干。
- **文档更新规则（强制）**：代码/命令/架构/决策一变，同次更新对应文档（命令→dev-commands.md；决策→decisions.md；架构→architecture-proposal.md；UI→ui-direction.md；进度→本文件）。

## 五、关键技术事实（易被长上下文丢失，务必记住）

- **数据层**：SQLite，每工作区一个 `<rootPath>/.kith/workspace.db` + 中心 registry（`~/.kith-space/registry.db`）；`dbFor(workspaceId)` 取连接；无 Postgres/Redis。
- **P1 护栏**：`src/server/dispatchGuard.ts`，深度默认 4（`KITH_SPACE_MAX_DISPATCH_DEPTH`）、每链唤醒预算默认 16（`KITH_SPACE_MAX_DISPATCH_WAKES`）、任务/空间急停 API 在 `/api/*/dispatch/*`。token 预算目前是"成功唤醒次数"代理指标。
- **token usage 结论（调研已证实）**：三家 CLI 都提供完整 token 用量，缺口在我们的 `runtime.ts` 契约（无 usage 回调）——Runtime 契约 v2 会补。
- **MCP 结论**：两个参考项目都无统一 MCP bootstrap；三家各有干净注入入口，需我们建统一层。
- **权限技术债**：外接 runtime 现走 bypassPermissions + 目录隔离，v1 单人单机接受；上邮箱/浏览器或开跨设备访问前必须升级（决策 8/17）。
- **agent 记忆机制**：文件式，agent 用 runtime 原生文件工具读写；开机读 MEMORY.md、睡前写；写 MCP 工具延后。

## 六、必读文档地图（详见 `AGENTS.md`）

`docs/vision.md`（理念/长远）· `docs/decisions.md`（20 条决策+推理+被推翻项）· `docs/roadmap.md`（能力分期，含 §2.0 Runtime 契约 v2）· `docs/dev-commands.md`（开发命令）· `docs/glossary.md`（术语）· `docs/kith-space/`（product-brief / mvp-spec / architecture-proposal / ui-direction / migration-plan）· `docs/kith-space/notes/`（runtime 调研、opencode agent 关系、任务 MCP 草案）。
