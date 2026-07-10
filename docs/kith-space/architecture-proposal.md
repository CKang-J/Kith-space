# Kith-space 架构提案

本文是 5 份设计文档中的架构篇，只描述模块边界、runtime 接口、数据层与护栏落点。产品定位见 `product-brief.md`，第一版范围与验收见 `mvp-spec.md`，界面信息架构见 `ui-direction.md`，从 open-tag fork 到目标产品的分阶段步骤见 `migration-plan.md`。

底座为 open-tag（Apache-2.0）。凡涉及现状的判断都标 `文件:行号`，取自 `open-tag/src/`。

## 0. 结论前置

- 桌面壳几乎免费：open-tag 本就是 server + web 两件套，Electron 只做进程托管与打包，"可选浏览器访问"在 v1 是零成本副产品。
- 不自研 runtime：agent 全部外接，接口已存在（`daemon/runtime.ts:35` 的 `Runtime` / `RuntimeSession`），v1 只打磨 Claude Code / Codex / opencode 三条。
- 模块即 MCP 工具：自建模块（v1=任务）包成 MCP server 暴露给外接 agent，"原生丝滑"靠 MCP 工具设计 + UI 桥，天花板略低于 in-app runtime，可接受。
- 记忆复用现成：open-tag 的文件式 per-agent 记忆（`daemon/memory.ts` + `daemon/prompt.ts`）直接支撑三层记忆的"读=原生文件工具、结构=约定写进 system prompt"，v1 不做写工具。
- 数据层可确定性迁移：Postgres+Redis → SQLite + 单进程替代。消息 seq 采用启动时从 DB 对齐的进程内计数器；任务号为保证与任务消息同事务提交，已改为工作区 SQLite 内的持久化计数器。
- 编排靠现成唤醒策略：agent→agent 分派天然成立（`agentWakePolicy.ts:10`），autopilot 为默认，plan-first 为软闸，三护栏（深度/预算/急停）在 server 唤醒环上落点明确。

## 1. 总体架构：桌面壳 + 三平面

### 1.1 Electron 桌面壳

宿主形态是 Electron 包住 daemon + server + web 三个进程，与 OpenLoaf 同构。三者在 open-tag 里已独立存在：

- server：`open-tag/src/server/index.ts`（HTTP + socket.io）。
- daemon：`open-tag/src/daemon/`（承载 agent 进程，通过 raw WS 连 server）。
- web：`open-tag/web/src/`（React + Vite SPA）。

Electron 主进程只做三件事：拉起本地 server、拉起本地 daemon、开一个指向 `localhost:7777`（`server/core.ts:14` 的默认 PORT）的窗口。这就是"桌面为主"。

### 1.2 三平面通信模型（直接复用）

open-tag 最值得复用的是它的三平面隔离，v1 原样保留：

- Human/Web plane：React SPA → `/api/*` + socket.io 实时。
- Daemon control plane：server ↔ daemon，raw WS `/daemon/connect`，用于 `agent:start` / `agent:deliver` / `agent:stop`（`server/core.ts:820` 起的 `sendAgentStart` / `sendAgentDeliver` / `sendAgentControl`）。
- Agent data plane：agent 进程 → `/agent-api/*`，走注入到 PATH 上的 `open-tag` CLI（scope 表见 `server/routes-agent.ts:19` 的 `requiredScope`）。

### 1.3 "可选 web 访问"为何几乎免费

因为 web plane 本就是一个跑在 server 上的独立 SPA，桌面窗口只是它的一个客户端。v1 的"浏览器里也能用"= 用户自己开浏览器访问 `localhost`，零额外工作（决策 17 的 level-one）。

跨设备 / 局域网 / 公网访问（level-two）在 v1 明确不做：一旦打开，就击穿单机安全前提（决策 4/5），并与 agent 的 `bypassPermissions` 全权（见 §7）正面冲突，因此必须与鉴权 + agent 权限重估一起上线。按钮在架构上预留，v1 置灰或缺席。

## 2. Runtime 层：外接 adapter

### 2.1 接口现状

runtime 是一个窄接口，已经定义好，不需要改：

```
Runtime.start(opts: StartOpts, cb: RuntimeCallbacks): RuntimeSession
```

- `Runtime`：`daemon/runtime.ts:35`，字段 `name` / `experimental?` / `oneShotWake?` / `start`。
- `StartOpts`：`daemon/runtime.ts:20`，含 `cwd` / `model?` / `systemPrompt` / `env` / `sessionId?` / `initialPrompt`。
- `RuntimeSession`：`daemon/runtime.ts:30`，只有 `deliver(text)` 和 `stop()` 两个方法——`deliver` 驱动一轮（claude 写 stdin，codex 走 turn/start），`stop` 结束进程。
- 回调：`RuntimeCallbacks`（`daemon/runtime.ts:12`）把 `onSession` / `onActivity` / `onTrajectory` / `onExit` 回吐给上层，用于 session 持久化、活动状态、轨迹流。

注册表在 `daemon/runtimes.ts:26`（`REG`），本机探测在 `daemon/runtimes.ts:22`（`detectRuntimes`，Win 用 `where`、其余用 `command -v`）。

### 2.2 v1 只打磨三条

现有注册表已带 8 个 runtime（claude/codex/copilot/opencode/kimi/pi/cursor/hermes，`daemon/runtimes.ts:26`）。v1 只把 **Claude Code / Codex / opencode** 三条做到稳，其余标 experimental 或隐藏。理由：runtime adapter 依赖各 CLI 的输出格式解析，版本漂移会破坏解析，收敛面积换稳定性。

### 2.3 不自研 runtime

不写自己的 tool-loop agent。产品的差异化不在"再造一个 runtime"，而在协作空间 + 模块 MCP 工具 + 记忆（§3/§4）。runtime 只当可插拔的执行引擎，接口已足够抽象，新增一个 runtime = 实现一个 `Runtime` 对象并注册进 `REG`。

## 3. 模块即 MCP 工具

### 3.1 思路

自建生产力模块（v1 = 任务；后续 = 邮箱 / 日历 / 画布）不进 runtime，而是各自包成一个 MCP server，通过 agent runtime 的 MCP 客户端能力暴露给外接 agent。agent 在会话里像调用普通工具一样调用 `task_create` / `task_update` 等，落到我们的 server 逻辑。

open-tag 现在的做法是把能力做成 `open-tag` CLI 注入 PATH（`daemon/prompt.ts:26` 的 CLI 规格 + `server/routes-agent.ts` 的 `/agent-api/*`）。MCP 化是这套 data plane 的自然演进：把同一批服务端能力（`server/core.ts` 里的 `createMessage` / `convertMessageToTask` / `claimTask` / `assignTask` / `setTaskStatus`）从"CLI 子命令"再暴露一层为"MCP 工具"。两条通道可以共存，MCP 更适合被 runtime 原生识别。

### 3.2 任务模块（v1 唯一自建模块）

任务继续承载在 message 上，不新增独立任务表。除原有状态、编号、负责人和时间字段外，现增加 nullable `taskParentId`（直接父任务）与整数 `taskRevision`（乐观并发版本）；父子任务必须属于同一频道，避免父任务详情跨频道泄漏子任务内容（`db/schema.ts:145`–`:158`，校验见 `server/tasks/taskRepository.ts:58`）。普通消息 revision 为 0，创建或转换成任务后为 1，每次 claim / assign / unclaim / 状态或 execution-mode 变更递增。

任务写入按职责拆到 `server/tasks/`，没有重写 `server/core.ts`：

- `taskTypes.ts`：五状态、稳定错误码、结构化 report/delivery metadata。
- `taskPolicy.ts:3`：唯一状态图。允许 `todo→in_progress|closed`、`in_progress→todo|in_review|closed`、`in_review→in_progress|done|closed`、`done→in_progress`、`closed→todo`；同状态重试幂等，其他跳转返回 `INVALID_TRANSITION`。
- `taskRepository.ts:59` / `:98`：任务创建与消息转换把任务号、task message、父子关系和 owning thread 放在同一个 SQLite 事务中，失败整体回滚；不存在 `taskStatus != null` 但缺 task number/thread 的过渡态。
- `taskRepository.ts:149` / `:236` / `:287`：claim、assign、状态流转均以 `taskRevision` 和当前状态/负责人做条件更新。claim 只允许未领取的 `todo|in_progress`；并发领取只有一个 winner。assign 的同负责人重试幂等，跨负责人重分派要求调用者是当前 agent 负责人或提交 `expectedRevision`，并发 assign 不会静默覆盖。状态字段更新与 thread 审计消息也在同一事务中提交。
- `server/core.ts:469` / `:883` / `:965`：core 保留现有事件和 daemon 副作用，只把结构性数据库写委托给任务 repository；数据库提交成功后才广播实时事件或投递 runtime。

REST 与 agent CLI 已暴露 revision 并接受 `expectedRevision` / `from`；冲突返回 HTTP 409 + `CONFLICT`，非法跳转返回 HTTP 409 + `INVALID_TRANSITION`。agent data plane 增加 `task/get`、`task/report`、`task/delivery`（`server/routes-agent.ts:287`、`:396`、`:405`），CLI 对应 `task get/report/deliver`（`cli/index.ts:133`、`:176`、`:180`）。这不是任务 MCP bootstrap；后续 MCP handler 应复用同一任务服务，不能自行写 SQL。

thread 汇报与最终交付不另造表，复用 `messages.actionMetadata`：

- 结构化汇报由 `reportTask` 承担，在任务 owning thread 写 `kind=task-report`，记录 `progress|blocker|question|result` 与 artifact refs，不触发 ambient wake（`server/tasks/taskService.ts:40`）。
- `submitTaskDelivery` 在一个事务内向父任务所在频道写 `kind=task-delivery` 消息并把父任务从 `in_progress` 转为 `in_review`；metadata 固化父任务 id、直接子任务 ids、来源 thread ids、报告 message ids 与 artifact refs（`server/tasks/taskService.ts:90`）。消息插入或状态更新任一步失败都会整体回滚。
- `getTaskDetails` 一次返回父任务、直接子任务、父/子 thread 的结构化报告及频道交付消息，leader 和 UI 可从交付回溯到每个来源 thread（`server/tasks/taskService.ts:183`）。

### 3.3 UI 桥与天花板

"原生丝滑"由两半构成：MCP 工具设计（工具粒度、参数、返回结构对模型友好）+ UI 桥（工具的副作用实时反映到右侧模块面板，例如任务看板随 `task:updated` 事件刷新）。

天花板要如实说明：MCP 工具 + 外接 runtime 的操控丝滑度，低于 OpenLoaf 那种 in-app 自研 runtime（后者能把工具调用、流式渲染、审批弹窗编织进同一进程）。这是决策 2 明确接受的取舍——用略低的丝滑度换"不自研 runtime + 可插拔多 runtime"。

## 4. 记忆架构：三层文件式记忆

### 4.1 三层

- 用户层：跨空间的用户偏好、习惯，用户策展为主。
- 空间层：团队规则、项目背景，**agent 可写、用户策展**（决策 9 的 option B）。
- agent 层：每个 agent 自己的 `MEMORY.md` + `notes/`，agent 自主维护。

### 4.2 三条工程约定

- **读 = runtime 原生文件工具**：不做读 MCP 工具。agent 直接用自己 runtime 的 Read/文件工具读 `MEMORY.md` 与 `notes/`。
- **结构 = OpenLoaf 式"一事一文件 + MEMORY.md 索引"约定**：这套约定不是工具，而是写进 system prompt 强制执行。open-tag 的 prompt 已经内建了这套约定：`daemon/prompt.ts:104` 起要求 MEMORY.md 作自足索引、`notes/` 放细节、compaction 前后以 MEMORY.md 为恢复点（`daemon/prompt.ts:120` 的 Compaction safety 段）。
- **写 MCP 工具延后**：v1 agent 用原生文件写操作维护记忆；仅当自由写变乱时，再提升为 `memory_save` 之类的 MCP 工具（决策 9）。

### 4.3 复用 open-tag 现有 memory.ts / prompt.ts

open-tag 已有一套 per-agent 文件记忆，v1 直接复用、不重建：

- 每个 agent 独立 workspace 目录（`db/schema.ts:61` 注释：`~/.open-tag/agents/<id>`）。
- seed：`daemon/memory.ts:5` 的 `seedMemory` 在首启写出 `# displayName / ## Role / ## Key Knowledge / ## Active Context`。
- profile 同步：`daemon/memory.ts:20` 的 `applyProfileToMemory` 做"外科手术式"改写——只改 H1 标题与 `## Role` 段，保留 agent 自己写的其余段落；触发点是 `server/core.ts:920` 的 `syncAgentProfile`（发 `agent:profile` 给 daemon）。
- 启动读 / 睡前写：由 `daemon/prompt.ts` 的 startup sequence（`:91`）与 compaction safety（`:120`）驱动。

三层记忆里，**agent 层已完全现成**；用户层与空间层是在此文件式模型上新增两个目录层级 + 在 system prompt 里补两段索引约定，不是从零造模块。因此 v1 的自建模块只有任务一个（决策 6/9）。

## 5. 数据层：工作区根植文件夹 + 每工作区独立 SQLite + 进程内替代 Redis

### 5.0 存储拓扑：工作区根植文件夹、自包含可移植（决策 19）

工作区（open-tag 的 `servers`）不再只是中心库里的一行，而是**根植于一个本地文件夹、自包含、可移植**：创建时选一个现有文件夹，或在默认路径 `~/Kith-space/<工作区名>/` 下生成，一个文件夹对应一个工作区（1:1，参考 OpenLoaf 的 project）。

拆分原则——人可读、本就该落文件、需要随工作区走的东西进文件夹；需要高效查询 / 增量 sync / 高频并发写的东西进该工作区自己的 SQLite 文件：

| 数据 | 落点 | 形态 |
|---|---|---|
| agent 阵容配置（职责 prompt / runtime / model / scopes）| `<folder>/.kith/agents/` | 明文（JSON/MD），可读可分享 |
| 三层记忆中的空间层 + agent 层 | `<folder>/.kith/memory/` | 一事一文件 + 索引（决策 9） |
| 群聊消息 / 任务 / 频道 / 成员 | `<folder>/.kith/workspace.db` | 每工作区一个 SQLite 文件 |
| 工作区 registry（有哪些工作区、路径、上次打开）| 中心 registry db（应用数据目录）| 轻量索引 |

**关键点**：因为决策 18 已把底座定为 SQLite，而 SQLite 本身就是文件，"聊天历史随文件夹走"不需要改存储格式——把整个工作区的库做成 `<folder>/.kith/workspace.db` 即可。拷走文件夹 = 拷走该 db 文件 = 带走全部聊天/任务/成员。中心库退化成只记 registry。

两个现状事实让这条低成本：open-tag 的 seq 计数器本就按工作区分（`redis.ts` 的 `seq:${serverId}`），每工作区一个库时 seq 天然在各自库内单调、`reconcileCounters` 语义照搬即可；24 个 import `db` 单例的文件查询语句与 schema **完全不变**，只是把"全局 db"换成"当前工作区的 db"。改造范围见 §5.4。总览态（全局 bento 驾驶舱）的跨工作区聚合，从"一个库 WHERE workspaceId"变为"遍历 N 个工作区库各查一遍、应用层合并"（或 SQLite ATTACH）——单真人只有几个工作区，开销可忽略。

### 5.1 现状

- DB：`db/index.ts:2` 用 `drizzle-orm/postgres-js` + `postgres`，默认连 `postgres://…:5433/opentag`（单一中心库）。
- schema：`db/schema.ts` 标准 Postgres 方言，259 行，全部主键 uuid，含 jsonb / timestamp。
- Redis：`redis.ts` 声明了三类用途（顶部注释 `redis.ts:1`）——全局 seq 计数器、SSE pub/sub、agent 唤醒 long-poll。

一个重要的现状澄清：**运行时真正依赖 Redis 的只剩计数器**。

- pub/sub 已经不走 Redis：`realtime.ts:9` 的 `publish` 直接调 socket.io 的 `emitMapped`（单实例直发），`realtime.ts:2` 注释也点明多实例才需要切回 redis-adapter。`redis.ts:70` 的 `publishEvent` 是遗留路径。
- agent 唤醒不走 Redis long-poll：唤醒通过 daemon control plane 的 WS 定向下发（`server/core.ts` 的 `sendAgentStart` / `sendAgentDeliver` → daemonHub）。`redis.ts:75` 的 `pokeAgent` 未被 server 逻辑实际调用。
- 原 Redis 的两个 INCR 均已迁出：`nextSeq` 仍是启动对齐的进程内计数器；`nextTaskNumber` 已落 SQLite 持久计数，DM 按会话、其余按 workspace。

因此 Redis 三件事里，pub/sub 与 wake 已在代码层由 socket.io 直发 + daemon WS 承担，迁移主要是把两个计数器搬进程内。

### 5.2 进程内替代（各自对位）

单机单进程下三者都能零功能损失地进程内化：

| Redis 职责 | 进程内替代 | 现有承接点 |
|---|---|---|
| 全局 seq 计数器 | 内存计数器（启动时 `SELECT max(seq)` 对齐，见 `redis.ts:18` 的 `reconcileCounters` 逻辑照搬） | `nextSeq`（`redis.ts:50`） |
| 任务号计数器 | SQLite `task_number_counters`，在调用者事务内原子 `UPSERT + 1` | `counters.ts:77`–`:90`、`db/schema.ts:164` |
| SSE pub/sub 扇出 | Node `EventEmitter`（实际已由 socket.io 直发承担） | `realtime.ts:9` |
| agent 唤醒 long-poll | 内存队列（实际已由 daemon WS 承担） | `server/core.ts` daemonHub |

消息 seq 的内存计数器保留 `reconcileCounters` 的启动对齐语义：进程重启后从 DB max 恢复，避免 seq 回退导致 `/messages/sync` 静默丢消息。任务号迁移会从既有 task max 初始化持久 counter；之后 `allocateTaskNumber` 与 task message/thread 在同一事务提交，回滚不会消耗或悬空任务号（`counters.ts:85`、`server/tasks/taskRepository.ts:58`）。

### 5.3 schema 方言迁移点

Drizzle 原生支持 SQLite 方言，迁移是确定性替换（决策 18）：

- `pgTable` → `sqliteTable`，`pg-core` 导入换 `sqlite-core`（`db/schema.ts:4`）。
- **jsonb → text + JSON 序列化**：8 处 `jsonb`（`machines.runtimes` `:49`、`agents.runtimeConfig` `:73`、`agents.envVars` `:75`、`agents.scopes` `:77`、`messages.actionMetadata` `:130`、`serverSidebarPrefs.prefs` `:233` 等），SQLite 用 `text({ mode: "json" })` 保留 `$type<>` 类型标注。
- **uuid → text**：全表主键与外键 uuid 改 text，`defaultRandom()` 换成应用层生成（如 `crypto.randomUUID()`）。short-id 前缀匹配的表达式索引（`messages_id_text_prefix_idx`，`db/schema.ts:147`）在 SQLite 上简化——id 本就是 text，不再需要 `::text` cast。
- **timestamp → integer(ms) 或 text(ISO)**：29 处 `timestamp({ withTimezone: true })` 改 SQLite 的 `integer({ mode: "timestamp_ms" })`，`defaultNow()` 换 `sql\`(unixepoch())\`` 或应用层写入。
- 部分索引 `.where(sql\`… is null\`)`（如 `agents_name_uniq` `:87`、`channels_dm_uniq` `:105`）SQLite 支持 partial index，语法基本平移。

### 5.4 三个文件的改造范围

- `db/index.ts`（10 行）：`drizzle-orm/postgres-js` → `drizzle-orm/better-sqlite3`；且从"导出一个全局 db 单例"改为"按 workspaceId 打开/取对应 `<folder>/.kith/workspace.db` 连接"的 `Map<workspaceId, conn>` + `dbFor(workspaceId)`（server 可同时服务多个活动工作区）。另起一个中心 registry 库连接（记工作区路径等）。这是本次数据层改造的核心，工作量中等但有界。
- 24 个 import `db` 单例的调用点：机械替换为 `dbFor(workspaceId)`，查询与 schema 不动。
- `counters.ts`：`nextSeq` 使用进程内 `Map` + `reconcileCounters` 启动对齐；任务号改为 `task_number_counters` 持久 UPSERT，并提供可嵌入任务事务的 `allocateTaskNumber`（`counters.ts:77`–`:90`）。
- `realtime.ts`（14 行）：现已是 socket.io 直发，迁移后维持不变，仅 `nextSeq` 的 re-export 指向新内存实现；多实例扩展的 redis-adapter TODO（`realtime.ts:2`）在单机形态下永久搁置。

云 / 多用户（决策 4 休眠）将来再引回 Postgres——Drizzle 反向换方言同样容易。分阶段步骤见 `migration-plan.md`。

## 6. 编排与护栏

### 6.1 agent→agent 分派机制（基于现有唤醒策略）

分派天然成立，靠的是 open-tag 的纯唤醒判据 `isWakeable`（`agentWakePolicy.ts:10`）。三条规则决定了协作闭环的形状：

- **被 @ 的成员无条件唤醒**：`isWakeable` 里 `if (o.mentioned) return true`（`agentWakePolicy.ts:12`），且不看发送者身份——所以 agent A 在频道里 @agent B，B 就被唤醒，agent→agent 分派原生可用。
- **被 @ 的 agent 须已是频道成员**：agent 发的文本不能改频道成员（`canAutoJoinMentionedMembers` 仅对 `senderType === "user"` 返回 true，`agentWakePolicy.ts:3`；`server/core.ts:377` 的自动加入分支据此只对人类生效）。因此 leader 要能 @dev，dev 必须已在频道里——分派前的编排要保证被派 agent 在场（或由人类 @ 拉入，或走 `task assign` 直接指派并唤醒，`server/core.ts:686`）。
- **汇报须 @ 回去**：agent 的普通频道发言不唤醒其他 agent（`agentWakePolicy.ts:13`：`if (o.senderType === "agent") return false`，环境噪声防自激循环）。所以 dev 干完要汇报 leader，必须 @leader 才能唤醒它；这条同时是防 agent 互相刷屏的 loop guard。

DM 是唯一例外：`isWakeable` 里 `if (o.channelType === "dm") return true`（`agentWakePolicy.ts:11`），DM 无条件唤醒对方 agent。

### 6.2 autopilot / plan-first 软闸

- 默认 = autopilot（决策 7 的 A）：agent 可自动创建 / 分派 / 唤醒任务，动作全部落在频道 / thread 里可见（`server/core.ts` 每次 task 事件都发 `sysTaskMsg` 审计消息，如 `:614` / `:672` / `:737`）。
- plan-first（B）在 v1 是**软闸**：基于 role-prompt 实现（要求 agent 先出计划、等确认再执行），不做硬闸。落点是 agent 的 `description`（role prompt，`db/schema.ts:66`）+ 每任务开关。schema 已有 `executionMode`（`db/schema.ts:74`，默认 `"auto"`）可作为该开关的持久化字段，硬闸延后。

### 6.3 三护栏（因默认 autopilot 而强制，决策 7）

三者都落在 server 的唤醒环上，即 `createMessage` 里遍历成员、逐个 `sendAgentStart` / `sendAgentDeliver` 的循环（`server/core.ts:412`–`:436`）与 `assignTask`（`server/core.ts:686`）：

- **分派深度上限**：在 deliver 载荷里带一个 dispatch-depth 计数，agent→agent 每跨一跳 +1，超阈值在唤醒环处拒绝下发。落点 = `createMessage` 唤醒环 / `assignTask` 的 `sendAgentDeliver` 前。
- **每任务 token 预算**：以任务（message-as-task）为单位累计 runtime 用量，超预算则停止对该任务链的后续唤醒。用量数据来自 runtime 回调链（`daemon/runtime.ts:12` 的 `onActivity` / `onTrajectory`）上报，落库后在唤醒环处校验。
- **一键急停**：复用现有 `stopAgent`（`server/core.ts:896`，发 `agent:stop` 给 daemon）+ 一个"停止全空间唤醒"的开关，急停时唤醒环直接短路。

三护栏都不需要改 runtime 或 daemon 协议，只在 server 唤醒环这一个收口处加判断，改动集中、可回滚。

P3 任务加固没有绕开该收口：`assignTask` 完成并发条件更新后，仍通过 `reserveDispatchWake` 再执行 `sendAgentStart` / `sendAgentDeliver`，所以空间急停、任务急停、分派深度和 wake 预算继续生效（`server/core.ts:883`–`:937`）。`task report` 与 `task delivery` 只写本地消息/状态、不启动 runtime，因此不会伪造 guard 消耗；若未来接口增加显式 reviewer 通知，必须同样经过 `reserveDispatchWake`。

## 7. 安全模型

### 7.1 v1 现状：bypassPermissions + 目录隔离

外接 runtime 的原生文件 / shell 权限，v1 沿用 open-tag 现状——全权。以 Claude 为例，`daemon/claudeRuntime.ts:31`–`:33`（`buildClaudeArgs`）固定带：

```
--dangerously-skip-permissions --permission-mode bypassPermissions
```

即 agent 对本机有不受限访问。v1 的缓解只有两层：

- **目录隔离**：每个 agent 一个独立 workspace（`cwd`，`daemon/runtime.ts:21`；目录约定 `~/.open-tag/agents/<id>`，`db/schema.ts:61`），进程 cwd 级隔离，不是安全沙箱。
- **工具能力裁剪**：同一 argv 里禁用了 plan/cron/ask 类工具（`daemon/claudeRuntime.ts:33` 的 `--disallowed-tools`），减少自主脱缰，但不限制文件 / shell。

我们自己的模块工具（v1 = 任务）走另一条轴：按风险分级，可逆 / 本地的自动放行（任务在 v1 基本全自动），不可逆 / 外部的（发邮件、删除、日历邀请）需审批（决策 8）。

### 7.2 升级触发点（tracked debt）

v1 接受 bypassPermissions，但这是**明确记账的债**。升级的硬触发点是：**邮箱 / 浏览器等"摄入不可信外部内容"的模块上线的那一刻**。届时权限模型必须升级为审批路由或沙箱，否则形成 "prompt 注入 → 破坏性 shell" 的攻击链（决策 8）。同一时刻也是 level-two 网络访问（§1.3）解禁的前置条件——两者共享同一次 agent 权限重估。

在那之前，v1 的安全边界严格建立在"单机 + 单用户 + 仅本机可信内容 + 桌面双击运行"这组前提上（决策 4/5/17）。
