# Kith-space 分阶段改造计划

本文定义从 open-tag fork（Apache-2.0）改造到 Kith-space 的分阶段路线：每阶段的目标、改动范围、验证标准，以及贯穿全程的关键风险、贵改/便宜改判断与阶段依赖关系。事实依据为 grilling-decisions.md 的 18 条锁定决策，与探索报告冲突时以锁定决策为准。产品定位见 product-brief.md，功能范围与验收见 mvp-spec.md，模块边界与数据模型见 architecture-proposal.md，界面信息架构与视觉见 ui-direction.md。本文只讲"怎么改、按什么顺序改"，不重复展开上述内容。

## 1. 总体原则

- 先地基后功能：数据层迁移、信息架构、桌面壳属"贵改"，波及面大、返工成本高，必须趁早对齐；视觉精雕属"便宜改"，可后置到架构定死之后。详见 §4。
- 外科手术式改动：open-tag 的 `src/server/core.ts`（927 行，集中承载消息 / mention / 任务 / wake / agent 生命周期）改动要谨慎，优先在其外围新增模块，不整块重写。
- 保留即复用：多机、多用户、Redis 抽象等机制在 v1 休眠而非删除（决策 4/5/18），为 P6 的云化/多真人留活口。
- 每阶段可验证：下列每阶段都给出可执行的验证标准，达标才进入下一阶段。

## 2. 阶段划分

阶段依赖为线性主线（P0 → P5），P6 为 v1 后续。跨阶段的强制先后约束见 §5。

### P0　Fork 与地基

目标：拿到一个改名、许可证清晰、单机可跑、测试通过的 Kith-space 基线，完成数据层从 Postgres+Redis 到 SQLite 的迁移，并一并落地"工作区根植文件夹 + 每工作区独立 db"（决策 19，与 SQLite 迁移合并做，避免做两遍）。

改动范围：

- Fork 与改名：fork `open-tag`，全局改名为 Kith-space（`package.json` name/description/repository、README、CLI bin 名、`~/.open-tag/` 家目录路径、注入的 agent CLI 名）。CLI 与家目录改名会波及 daemon 注入逻辑（`scripts/build-daemon-pkg.mjs`、`src/daemon/openTagBin.ts`），需连带更新。
- 许可证确认：open-tag 为 Apache-2.0（已核实 `LICENSE`、`package.json`）。保留原 `LICENSE`、`NOTICE`，在 NOTICE 追加 Kith-space 的衍生声明与原作者归属，满足 Apache-2.0 的署名要求。OpenLoaf 仅作设计参考，不得拷贝其 AGPLv3 源码（决策 3）。
- 数据层迁移（决策 18）：schema 为标准 PG（259 行，8 jsonb / 57 uuid / 29 timestamp），Drizzle 原生支持 SQLite dialect，迁移是确定性的体力活而非未知数。
  - `src/db/schema.ts`：PG dialect 换 SQLite dialect（uuid → text、timestamp → integer/text、jsonb → text+JSON、`pgTable` → `sqliteTable`）。
  - `src/db/index.ts`（9 行，postgres-js）：换成 better-sqlite3 或 libsql 驱动；同时从"全局 db 单例"改为"按 workspaceId 打开/取对应 `<folder>/.kith/workspace.db` 的连接"（`Map<workspaceId, conn>` + `dbFor(workspaceId)`），另起一个中心 registry 库。24 个 import `db` 的调用点机械替换为 `dbFor(workspaceId)`，查询/schema 不变。详见 `architecture-proposal.md` §5.0/§5.4。
  - 工作区根植文件夹（决策 19）：`servers` 加 `rootPath`；创建向导支持"选文件夹或默认 `~/Kith-space/<名>/`"；agent 配置与记忆落 `<folder>/.kith/`（明文），消息/任务/成员落 `<folder>/.kith/workspace.db`。整个文件夹自包含可移植（拷文件夹=带走含聊天的完整工作区）。
  - `src/redis.ts`（77 行）：核实后，Redis 实际只有一处在用——两个单调 INCR 计数器（`nextSeq` + `nextTaskNumber`）加启动时 `reconcileCounters`。其 pub/sub（`publishEvent`）与 agent wake（`pokeAgent`）导出均无调用点、是死代码：人类端实时已走 socket.io 单实例直发（`realtime.ts` `publish()` → `emitMapped`），agent 唤醒走 daemon WS。因此迁移很小：把两个计数器搬进程内、整体删除 `redis.ts`；`src/server/realtime.ts`（13 行）几乎不动（仅改 `nextSeq` 导入来源）。
  - `docker-compose.yml`、`drizzle.config.ts`、`.env` 相关基础设施配置随之简化。
- 跑通测试：open-tag 用内置 `node:test` 运行器（`src/**/*.test.ts` 与 `test/**`，无第三方框架依赖）。补一条 `test` npm script 汇总运行，确保迁移后既有单测与集成测全绿。

验证标准：

- 单机 `npm start` + daemon 起得来，Web 能打开，无 Postgres/Redis 依赖。
- 既有 `node:test` 用例（含 `agentWakePolicy`、`agentStartGuard`、`daemonHub` 等）全部通过。
- `npm run typecheck`（server + web 双 tsconfig）无错。
- 冒烟：建空间、发消息、SSE 实时刷新、seq 单调递增均正常。

### P1　协作闭环 MVP

目标：验证 leader/dev/tester 的 autopilot 场景端到端跑通，补齐三护栏与 plan-first 软闸。对应 mvp-spec.md §4 用户故事与 §5 验收。

改动范围：

- 跑通闭环（多为复用 + 联调，非新建）：创建空间 → 连本机 daemon → 创建 agent（含 runtime 选择）→ 频道内 @leader → autopilot 自动拆解分派 → dev/tester 在 thread 领取汇报 → leader 汇总交付 → 实时轨迹可见。open-tag 的 wake policy（`agentWakePolicy.ts`）已原生支持 @提及唤醒任意成员，agent→agent 分派可用；注意约束：被 @ 的 agent 须已是频道成员（agent 发文不能自动拉人入频道），回复的 agent 须 @leader 才能唤醒它（环境消息不唤醒他人，防循环）——这两条要在 leader 角色提示词与分派逻辑中显式适配。
- 三护栏（决策 7，因默认 autopilot 为 v1 强制项）：
  - 分派深度上限：给 agent→agent 分派链加深度计数与硬上限。可在 `core.ts` 的 wake/dispatch 路径外围新增 guard 模块，不改其主体。
  - 每任务 token 预算：按任务累计 runtime token 消耗，超预算熔断。
  - 一键急停：全局/按空间停止所有 agent 会话的开关，走 daemon hub 向对应 machine 定向下发 stop。
- plan-first 软闸（决策 7）：以角色提示词实现"先出计划再执行"，作为按任务开关的一个取值，默认仍是 autopilot。硬门延后到 v1 后。

验证标准：

- mvp-spec.md §5 的端到端主链路逐条通过。
- 三护栏各自有触发用例：构造超深分派链被截断、构造超预算任务被熔断、急停能在数秒内让所有 agent 停手。
- plan-first 开启时 agent 先输出计划、等确认再动手；关闭时维持 autopilot。

### P2　记忆与身份

目标：让 agent 从临时 bot 变成有身份和记忆的团队成员。对应 architecture-proposal.md 的记忆与身份模块。

改动范围：

- 三层记忆（决策 9）：用户级 / 空间级 / agent 级。复用 open-tag 既有 per-agent 文件记忆（`src/daemon/memory.ts`、`src/daemon/prompt.ts` 的启动读取 / 休眠写回模式），在其上叠加用户级与空间级两层。读 = 原生文件工具（不走 MCP）；空间级为 agent 可写、用户策展。写记忆的 MCP 工具 v1 延后，agent 先用原生文件操作写。
- 结构约定入系统提示词：把 OpenLoaf 的"一事一文件 + 自动维护 MEMORY.md 索引"约定写进 system prompt 强制执行（决策 9），不做成工具。
- 角色模板（决策 10）：open-tag 的 agents 表已含所需字段（name/displayName/avatar/description=角色提示词/runtime/model/scopes），无需扩表。模板 = 空白角色提示词 + 少量可选起点模板（填空起点，非流程绑定）。
- agent 创建向导：把身份 + 职责提示词 + runtime + 记忆 + 工作目录整合为一个创建流程。

验证标准：

- 三层记忆各自能被 agent 读到、按层级正确注入上下文。
- 空间级记忆 agent 可写、用户可编辑策展。
- 新建 agent 走向导即可产出可用的团队成员，重启后记忆与身份保持。
- 系统提示词约束下，agent 的记忆文件呈"一事一文件 + MEMORY.md 索引"结构。

### P3　任务模块打磨 + 右栏模块化容器 + 实时轨迹面板

目标：把 v1 唯一从零打磨的模块（任务）做扎实，并落地右栏模块化容器与 agent 实时轨迹面板。信息架构在此定死（属贵改，见 §4）。

改动范围：

- 任务模块打磨：open-tag 任务不是独立表、而是 message 上的 task 字段，"消息转任务、在 thread 推进"很自然。打磨创建 / 拆解 / 分派 / 领取 / 状态流转 / thread 汇报 / 交付汇总的完整体验。
- 右栏模块化容器（决策 14）：右栏是带自身底部 dock 的模块容器，dock 图标切换所显示模块（任务 / 文件 / agent 实时轨迹等）。DM 不进右栏——位于左导航、在中心区打开。
- agent 实时轨迹面板（决策 14）：作为众模块之一，是与默认 autopilot 配套的透明窗口。复用 open-tag 既有 live trace / activity log 与前端 `trajBuffer.ts`。
- 此阶段确定右栏 dock 的模块槽位与信息架构，为 P4 视觉精雕提供稳定骨架。

验证标准：

- 任务全生命周期在 UI 与 thread 中可操作、状态一致。
- 右栏 dock 能在多个模块间切换，容器行为稳定。
- 实时轨迹面板能实时反映 autopilot 下 agent 的动作序列。

### P4　UI 双壳重塑

目标：把信息架构落成双壳 UI，视觉学 OpenLoaf 的干净、丝滑（决策 11，用户已就本项目豁免其"去 AI 味"清单）。此阶段为便宜改，必须在 P3 信息架构定死之后进行。详见 ui-direction.md。

改动范围：

- 双壳（决策 12）：空间总览态 ↔ 空间内部态。进入空间时左导航收起、屏幕让位给协作。
- 总览态 bento 薄版（决策 16）：全局驾驶舱 = 空间列表 + 全局收件箱 + 简单聚合待办，v1 薄版。
- 空间内部态（决策 13/14/15）：中心恒为群聊（C 位）；右栏 dock 模块容器；左右分栏用可拖拽分隔条（自适应默认宽 + 自由拖拽）；右栏可隐藏（聊天占满）；宽度饥渴模块（画布/日历）可提升到中心。
- 左导航细图标条（决策 15）：双壳在空间态收起左导航时，变为细竖图标条（非第二个底部 dock，避免与右栏 dock 冲突）。
- open-tag 的 `Chat.tsx`、`Members.tsx`、`store.tsx` 偏大，重塑时保留行为、逐步拆分，不整块重写。

验证标准：

- 双壳切换顺畅，总览态与空间内部态信息架构清晰。
- 拖拽分隔条、右栏隐藏、模块提升到中心均可用。
- 视觉整体接近 OpenLoaf 的干净丝滑质感。

### P5　Electron 桌面壳

目标：打包 daemon + server + web 为桌面应用，双击即用，本机 localhost web 访问（决策 17，v1 只做 level-one）。

改动范围：

- Electron 包裹（选 Electron 而非 Tauri：TS 原生、成熟、与 OpenLoaf 对齐）。因 open-tag 已是 server + web，双形态几乎免费，Electron 只需包裹并托管本机 server + daemon 生命周期。
- 复用既有 daemon 打包链路（`scripts/build-daemon-pkg.mjs` 已能产出自包含 ESM bundle）。
- level-two（跨设备 / 局域网 / 公网访问）在架构上预留、v1 灰置或缺省——开启它会打破单机安全前提并与 bypassPermissions 相撞（见 §3、决策 8/17）。

验证标准：

- 双击启动，Electron 自动拉起并托管 server + daemon。
- 本机浏览器访问 localhost 与桌面壳内一致。
- 关闭应用时 server/daemon 干净退出，无残留进程。

### P6　v1 后续（不属 v1 交付）

目标：在 v1 站稳后扩展模块与多端能力。仅列方向，具体规格另议。

改动范围：

- 邮箱 / 日历 / 画布模块（作为 MCP 工具接入；邮箱是 OAuth/IMAP 深坑、画布对流畅度敏感，故延后）。
- 宽度饥渴模块提升到中心的完整体验。
- 跨设备访问 + 认证 + 沙箱：开启 level-two 的同时必须上认证与 agent 权限重估（触发安全升级，见 §3）。
- 多设备 / 多真人：唤醒 open-tag 中休眠的多机与多用户机制；云化时 Drizzle dialect 反向换回 Postgres（方向容易）。

验证标准：待 v1 收敛后按各模块单独定义。

## 3. 关键风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| `core.ts` 过重 | 927 行集中承载消息 / mention / 任务 / wake / agent 生命周期，改动牵一发动全身 | 一律在其外围新增 guard / 模块，不整块重写；改动配套单测；三护栏以外挂方式接入 wake/dispatch 路径 |
| runtime adapter 依赖 CLI 输出格式 | 各 runtime（Claude/Codex/opencode 等）adapter 解析其 CLI 输出，CLI 版本变动可能破坏解析 | v1 只打磨 Claude Code / Codex / opencode 三条强路径，其余标 beta；为解析层补充版本兼容测试与失败可观测 |
| 数据层迁移波及面 | PG → SQLite（schema + 驱动）为主；Redis 仅两个计数器需进程内化（pub/sub 与 wake 已是死代码，socket.io / daemon WS 已承担） | 迁移放在 P0 最前、任何新功能之前；分两步（先 schema/驱动，再计数器进程内化）各自过测试；保留 Drizzle dialect 抽象以便未来反向换回 Postgres |
| bypassPermissions 安全债 | open-tag 以 `--dangerously-skip-permissions --permission-mode bypassPermissions` 启动 Claude Code（`claudeRuntime.ts`），= 全机器无限制访问 | v1 接受此现状 + 按 agent 工作目录范围限制，作为显式追踪的技术债；一旦邮箱/浏览器等"不可信内容摄入"模块上线（P6），权限模型必须升级为审批路由或沙箱，防"提示注入 → 破坏性 shell"攻击链 |

## 4. 贵改 vs 便宜改

- 贵改（波及面大、返工成本高，必须趁早对齐）：
  - 信息架构（双壳、右栏 dock 槽位、导航结构）—— 在 P3 定死，是 P4 视觉的地基。
  - 数据层（schema dialect、驱动、实时机制）—— 在 P0 一次做对，避免带着旧数据假设往前跑。
  - 桌面壳形态（Electron 托管 server+daemon 的边界）—— 在 P5 定下进程与生命周期模型。
- 便宜改（可后置，改动局部）：
  - 视觉精雕（配色、间距、字重、组件质感）—— 后置到 P4，且必须在信息架构定死之后，否则边改边返工。
  - 角色起点模板内容、dock 图标集、具体文案 —— 可随时微调，属决策 10/UI 收尾项。

## 5. 阶段依赖关系

- 数据层迁移（P0）必须先于一切新功能（P1+）：新功能都建立在数据层之上，带着 PG+Redis 假设开发会全面返工。
- 协作闭环（P1）先于记忆与身份（P2）：先证明链路跑通，再让 agent 有记忆与身份，避免在未验证的链路上叠加复杂度。
- 信息架构定死（P3 末）必须先于视觉精雕（P4）：信息架构是贵改、视觉是便宜改，顺序颠倒会导致视觉反复返工。
- 桌面壳（P5）晚于 UI（P4）：Electron 只是包裹，等 web 形态稳定后再包成本最低。
- 安全升级（P6 的认证/沙箱）必须与 level-two 跨设备访问同时上线：二者绑定，缺一即打破单机安全前提（决策 8/17）。

主线：P0 → P1 → P2 → P3 → P4 → P5，其后 P6。P2 与 P3 之间耦合较松，若资源允许可小幅并行，但 P3 的信息架构定死不得晚于 P4 启动。
