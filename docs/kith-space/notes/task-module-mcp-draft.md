# 任务模块 MCP 接口草案

> 2026-07-11 术语修正：目标 MCP 上下文使用 `spaceId`。下文引用上游/当前 schema 时出现的 `serverId` 只是待 A2 清理的过渡字段。

> 状态：Wave 2 实施草案（2026-07-10）  
> 事实来源：`reference/open-tag/` 只读上游源码；目标约束来自 `docs/decisions.md` 与 `docs/kith-space/architecture-proposal.md`。  
> 本文把“已核实现状”和“建议接口”分开；接口名、参数与权限分级均为 Kith-space 草案，不代表 open-tag 已实现。

## 1. 结论前置

1. open-tag 没有独立任务表；任务是一条被提升为 task 的 message。任务正文、作者、频道和 thread 锚点沿用消息字段，任务状态、编号、负责人和时间戳则是同一行上的可空 task 字段（`reference/open-tag/src/db/schema.ts:119`–`reference/open-tag/src/db/schema.ts:141`）。
2. Wave 2 不应让 MCP handler 直接写数据库。应把现有 `createMessage` / `convertMessageToTask` / `claimTask` / `assignTask` / `setTaskStatus` 收口成任务应用服务，REST、CLI、MCP 和 UI 共用同一套事务、权限、事件与审计语义。
3. v1 最小工具面建议为七个写工具：`task_create`、`task_decompose`、`task_assign`、`task_claim`、`task_transition`、`task_report`、`task_submit_delivery`。读取可先复用 `task_list` / `task_get` 两个无副作用工具，否则模型无法稳定取得 canonical task id 和最新版本。
4. “改任务数据”和“唤醒另一个 agent”不是同一风险。创建、领取、自身状态更新属于本地可逆写；分派、拆解扩张、通知和提交交付会触发 agent runtime、消耗预算，应进入编排护栏。
5. MCP 连接上下文必须提供 `spaceId`、调用者 `agentId` 和授权 scopes；这些身份字段不能由模型作为工具参数传入。工具只接收资源 id 和业务输入。

## 2. 已核实：open-tag 的任务承载模型

### 2.1 schema：message-as-task

`messages` 是消息与任务的共同实体，核心消息字段包括 `serverId`、`channelId`、发送者、正文、`actionMetadata` 和 `threadId`（`reference/open-tag/src/db/schema.ts:120`–`reference/open-tag/src/db/schema.ts:131`）。任务相关字段从第 132 行开始：

| 字段 | 现状语义 | 源码 |
|---|---|---|
| `taskStatus` | `null` 表示普通消息；非空表示任务。注释列出 `todo / in_progress / in_review / done / closed`；claim 不使用独立 status | `reference/open-tag/src/db/schema.ts:132`–`reference/open-tag/src/db/schema.ts:133` |
| `taskNumber` | 面向人类的可空任务号 | `reference/open-tag/src/db/schema.ts:134` |
| `taskAssigneeType` / `taskAssigneeId` | 负责人类型（user/agent）与 id | `reference/open-tag/src/db/schema.ts:135`–`reference/open-tag/src/db/schema.ts:136` |
| `taskClaimedAt` | 领取或分派时间 | `reference/open-tag/src/db/schema.ts:137` |
| `taskCompletedAt` | `done` / `closed` 时写入的结束时间 | `reference/open-tag/src/db/schema.ts:138`；写入逻辑见 `reference/open-tag/src/server/core.ts:765`–`reference/open-tag/src/server/core.ts:770` |
| `threadId` | 任务拥有的 thread channel id；不是父子任务关系 | `reference/open-tag/src/db/schema.ts:131` |

序列化给客户端的消息会直接带回上述 task 字段，所以看板不需要第二套任务 DTO（`reference/open-tag/src/server/core.ts:162`–`reference/open-tag/src/server/core.ts:174`）。任务号不是全局唯一：DM 内按会话计数，其余频道类型共享 workspace/server 计数（`reference/open-tag/src/redis.ts:54`–`reference/open-tag/src/redis.ts:66`）。因此工具不能只接受 `taskNumber`；至少要搭配 channel，最好始终返回并优先使用完整 `taskId`。

当前 schema 没有以下概念：父子任务、拆解层级、依赖、任务 revision、幂等键、结构化进展报告、结构化交付、审核人、每任务 execution mode/预算。`agents.executionMode` 是 agent 字段而非 task 字段（`reference/open-tag/src/db/schema.ts:67`–`reference/open-tag/src/db/schema.ts:77`）。

### 2.2 创建与转换

直接创建任务走 `createMessage({ asTask: true })`：先取 task number，再插入一条 `taskStatus="todo"` 的消息（`reference/open-tag/src/server/core.ts:337`–`reference/open-tag/src/server/core.ts:354`）；随后创建 thread 并回填 `threadId`（`reference/open-tag/src/server/core.ts:389`–`reference/open-tag/src/server/core.ts:394`），发布 message/task 实时事件并写一条系统审计消息（`reference/open-tag/src/server/core.ts:395`–`reference/open-tag/src/server/core.ts:400`）。

把已有消息转成任务走 `convertMessageToTask`。它先用 `taskStatus IS NULL` 做条件更新，保证并发转换只有一个 winner（`reference/open-tag/src/server/core.ts:598`–`reference/open-tag/src/server/core.ts:606`），winner 再分配任务号、创建 thread、回填并发布 `task:created` 与审计消息（`reference/open-tag/src/server/core.ts:607`–`reference/open-tag/src/server/core.ts:615`）。

两个路径都不是单个数据库事务：直接创建会在插入任务后才创建 thread；转换会先把 status 改为 `todo`，再生成编号和 thread。中间失败可能留下缺编号或缺 thread 的半成品；并发转换的 loser 也可能在 winner 完成后续回填前读到这个过渡态。Wave 2 应在任务应用服务中根治这一点（`reference/open-tag/src/server/core.ts:604`–`reference/open-tag/src/server/core.ts:611`）。

另一个容易遗漏的副作用是：`createMessage` 在发布事件后继续进入统一 agent 唤醒循环（`reference/open-tag/src/server/core.ts:403`–`reference/open-tag/src/server/core.ts:435`）。agent 创建的普通频道任务不会仅凭 ambient inbox scope 唤醒其他 agent，但显式 @ 或 DM 仍会投递；人类创建的任务还可能触发 ambient wake。因此“创建”与“分派/唤醒”在现有控制流中仍有耦合，MCP 语义应把两者明确分开。

### 2.3 领取、释放与指派

- `claimTask` 通过单条条件 UPDATE 原子领取：任务必须存在，负责人为空或已经是当前领取者；成功后设置 `in_progress`、负责人和 `taskClaimedAt`，并发布更新与审计消息（`reference/open-tag/src/server/core.ts:658`–`reference/open-tag/src/server/core.ts:673`）。这能防双 claim，但没有排除 `done/closed` 等终态。
- `unclaimTask` 把任务重置为 `todo` 并清空负责人和 claim 时间（`reference/open-tag/src/server/core.ts:676`–`reference/open-tag/src/server/core.ts:683`）。它没有校验调用者是当前负责人。
- `assignTask` 先确认目标 agent 属于当前 server 且未软删除，再读取任务（`reference/open-tag/src/server/core.ts:686`–`reference/open-tag/src/server/core.ts:704`）。同一负责人会幂等返回；否则 `todo` 自动变成 `in_progress`，负责人被覆盖（`reference/open-tag/src/server/core.ts:706`–`reference/open-tag/src/server/core.ts:724`）。随后确保 thread、把负责人加入 thread、写审计消息并通过 daemon control plane 启动/投递给目标 agent（`reference/open-tag/src/server/core.ts:726`–`reference/open-tag/src/server/core.ts:758`）。

`assignTask` 的 read-then-update 没有把“预期原负责人/版本”放进 UPDATE 条件，并发重分派可能最后写入者覆盖前者。MCP 分派必须增加乐观并发条件或 revision。

### 2.4 状态流转

合法值常量是 `todo / in_progress / in_review / done / closed`（`reference/open-tag/src/server/core.ts:761`–`reference/open-tag/src/server/core.ts:762`）。现有 agent REST route 会先检查传入值是否属于该集合（`reference/open-tag/src/server/routes-agent.ts:296`–`reference/open-tag/src/server/routes-agent.ts:313`），但 `setTaskStatus` 自身接受任意 string，且不校验 from→to 状态图（`reference/open-tag/src/server/core.ts:765`–`reference/open-tag/src/server/core.ts:770`）。

状态更新后会：

- 发布 `task:updated`，供频道 badge/看板刷新（`reference/open-tag/src/server/core.ts:771`–`reference/open-tag/src/server/core.ts:772`）；
- 在任务 thread 写一条“moved to …”系统审计消息（`reference/open-tag/src/server/core.ts:773`–`reference/open-tag/src/server/core.ts:781`）；
- 若修改者不是已分派 agent，则确保它在 thread 中并唤醒它（`reference/open-tag/src/server/core.ts:782`–`reference/open-tag/src/server/core.ts:793`）；
- `done` 或 `closed` 写 `taskCompletedAt`，其他状态清空该时间（`reference/open-tag/src/server/core.ts:765`–`reference/open-tag/src/server/core.ts:770`）。

### 2.5 thread 内汇报

任务创建/转换时原则上都会拥有 thread（`reference/open-tag/src/server/core.ts:389`–`reference/open-tag/src/server/core.ts:394`、`reference/open-tag/src/server/core.ts:607`–`reference/open-tag/src/server/core.ts:611`）。现有 agent route 的 thread reply 是 `getOrCreateThread` + 普通 `createMessage`，返回 thread channel 与消息 id（`reference/open-tag/src/server/routes-agent.ts:374`–`reference/open-tag/src/server/routes-agent.ts:381`）；领取接口也明确返回稳定的 `thread:<parentShortId>`，提示后续在任务 thread 汇报（`reference/open-tag/src/server/routes-agent.ts:274`–`reference/open-tag/src/server/routes-agent.ts:294`）。

这说明 thread 是正确的汇报时间线，但 open-tag 没有结构化的 `progress / blocker / result / delivery` 类型，也没有“汇报但不 ambient-wake 全部 thread agent”的专用服务。

### 2.6 现有权限面

当前 agent gateway 把任务读取映射到 `task:read`，创建、领取、释放、更新和指派全部映射到一个粗粒度 `task:write`（`reference/open-tag/src/server/routes-agent.ts:18`–`reference/open-tag/src/server/routes-agent.ts:35`）。scope 定义也只有 `task:read` 与 `task:write` 两项（`reference/open-tag/src/server/scopes.ts:16`–`reference/open-tag/src/server/scopes.ts:17`）；默认模式会授予全部 scope（`reference/open-tag/src/server/scopes.ts:25`–`reference/open-tag/src/server/scopes.ts:33`）。

thread 读写则分别需要 `message:read` / `message:send`（`reference/open-tag/src/server/routes-agent.ts:30`–`reference/open-tag/src/server/routes-agent.ts:31`）。Wave 2 若直接照搬，会把“改一个本地字段”和“唤醒另一个 runtime 并开始花 token”当成同一种权限。

## 3. 建议的权限与执行级别

| 级别 | 含义 | 默认策略 |
|---|---|---|
| L0 读取 | 无业务写入 | 有 scope 且通过 workspace/channel ACL 后自动放行 |
| L1 本地可逆写 | 创建/修改本地任务或 thread 内容，不启动其他 agent | v1 自动放行，完整审计 |
| L2 编排副作用 | 生成子任务链、唤醒/通知其他 agent、可能消耗 token | autopilot 下经深度/预算/急停护栏放行；plan-first 下需确认 |
| L3 不可逆或外部副作用 | 删除不可恢复数据、发送外部内容等 | 人工审批；本草案七个工具均不需要 L3 |

建议保留 `task:read` / `task:write`，新增 `task:dispatch`。凡会启动或投递到其他 agent 的动作必须同时具备 `task:dispatch`，并经过任务的 execution mode、dispatch depth、token budget 与 workspace emergency-stop 校验。thread 汇报可继续依赖 `message:send`，也可在 MCP 层把它收口为 `task:write`；两种通道最终必须调用同一个 ACL 服务。

## 4. 公共协议

### 4.1 身份与资源引用

- MCP session 注入：`spaceId`、`actorType="agent"`、`actorId`、scopes、调用 trace id。
- 工具参数不得出现可伪造的 `actorId`、`senderName` 或跨 workspace 的 server id。
- 写工具以完整 `taskId` 为 canonical 引用。为人类交互兼容，可接受 `{ channelId, taskNumber }`，解析后必须返回完整 id。
- 不建议 MCP 工具接受短 id；短前缀适合 CLI 展示，但不适合机器协议中的唯一标识。

### 4.2 统一返回

```ts
interface TaskToolResult {
  ok: true;
  task: TaskView;
  effects: {
    eventIds: string[];
    threadMessageIds: string[];
    dispatchedAgentIds: string[];
  };
  idempotentReplay: boolean;
}
```

`TaskView` 至少返回 `id / number / channelId / threadId / status / assignee / parentTaskId / createdAt / updatedAt / revision`。错误使用稳定 code：`INVALID_ARGUMENT`、`NOT_FOUND`、`FORBIDDEN`、`CONFLICT`、`INVALID_TRANSITION`、`GUARD_BLOCKED`、`RUNTIME_UNAVAILABLE`；不要只返回自然语言。

所有可能被 runtime 重试的写工具都带 `requestId`。应用服务按 `(workspaceId, actorId, toolName, requestId)` 去重，并返回首次结果；否则 `task_create`、`task_decompose`、thread 汇报和交付提交都可能重复落库。

## 5. MCP 工具草案

### 5.1 `task_create`：创建任务或把已有消息转为任务

**参数**

```ts
type TaskCreateInput = {
  requestId: string;
  sourceMessageId?: string; // 与 channelId/title 二选一
  channelId?: string;
  title?: string;
  description?: string;
};
```

**返回**：`TaskToolResult`，含 canonical `taskId`、task number 和 thread id。

**副作用**：原子生成 task message、编号与 thread；发布 task/message 实时事件；写审计消息。默认不唤醒任何 agent，分派必须另调 `task_assign`。

**权限**：`task:write`，L1；还要通过 source message/channel ACL。

**实现映射**：新任务复用 `createMessage(asTask)` 的持久化与事件语义；已有消息复用 `convertMessageToTask` 的并发幂等语义，但两者应改为同一个事务型 `TaskService.create`，并把唤醒策略显式设为 none。v1 不必为 title/description 增列：按“首行 title + 空行 + description”写入现有 `messages.content`，与当前取首行作为任务标题的逻辑一致（`reference/open-tag/src/server/core.ts:579`）。

### 5.2 `task_decompose`：把一个任务拆为一组有父子关系的子任务

**参数**

```ts
type TaskDecomposeInput = {
  requestId: string;
  parentTaskId: string;
  expectedRevision: number;
  items: Array<{
    clientKey: string; // 本次请求内稳定去重/回填
    title: string;
    description?: string;
  }>;
};
```

**返回**：父任务最新视图、`clientKey → child TaskView` 映射、当前 dispatch depth 与剩余预算。

**副作用**：在同一事务内创建全部子任务与 thread，写父子关系和父 thread 审计消息；只拆解、不分派、不唤醒。任何一项失败则整体回滚。

**权限**：`task:write` + `task:dispatch`，L2。原因不是外部副作用，而是它扩张任务图，必须受最大拆解深度、每次子任务数和总任务预算限制。

**实现缺口**：现有 batch `task/new` 只循环创建平级任务（`reference/open-tag/src/server/routes-agent.ts:351`–`reference/open-tag/src/server/routes-agent.ts:360`），没有父子关系，也不是原子批处理。最小 schema 扩展建议是在 task message 上增加 nullable `taskParentId`（自引用 `messages.id`）和 `taskRevision`；不要为了 v1 预建通用 DAG/依赖系统。

### 5.3 `task_assign`：指派并唤醒 agent

**参数**

```ts
type TaskAssignInput = {
  requestId: string;
  taskId: string;
  assigneeAgentId: string;
  expectedRevision: number;
};
```

**返回**：最新任务、是否为幂等同指派、dispatch 是否送达；未送达时给稳定 reason，但不谎报任务未指派。

**副作用**：设置负责人和 claim 时间；`todo` 变 `in_progress`；把负责人加入 task thread；写审计；启动/投递目标 runtime。与当前 `assignTask` 的行为对应（`reference/open-tag/src/server/core.ts:706`–`reference/open-tag/src/server/core.ts:758`）。

**权限**：`task:write` + `task:dispatch`，L2；必须过 execution mode、深度、token 预算和急停护栏。

**并发要求**：UPDATE 必须带 `expectedRevision`（或 expected assignee）条件，冲突返回 `CONFLICT` 和当前任务，不允许当前 read-then-write 的静默覆盖。

### 5.4 `task_claim`：调用者领取任务

**参数**

```ts
type TaskClaimInput = {
  requestId: string;
  taskId: string;
  expectedRevision?: number;
};
```

**返回**：最新任务；冲突时返回 `CONFLICT`、当前负责人和状态。

**副作用**：原子地把未领取、非终态任务分配给当前 MCP agent，设置 `in_progress` 与 claim 时间，发布更新并写审计；不启动新的 runtime。

**权限**：`task:write`，L1。

**实现映射**：复用 `claimTask` 的单 UPDATE 竞争控制（`reference/open-tag/src/server/core.ts:658`–`reference/open-tag/src/server/core.ts:670`），补上 `status IN (todo, in_progress)`、调用者频道 ACL 和 revision 条件。领取者身份只取 MCP session。

### 5.5 `task_transition`：受控状态流转

**参数**

```ts
type TaskTransitionInput = {
  requestId: string;
  taskId: string;
  from: "todo" | "in_progress" | "in_review" | "done" | "closed";
  to: "todo" | "in_progress" | "in_review" | "done" | "closed";
  expectedRevision: number;
  reason?: string;
};
```

**返回**：最新任务与 `completedAt`。

**副作用**：原子校验并更新状态；维护完成时间；发布 `task:updated`；在 thread 写审计。若修改他人负责的任务需要通知负责人，则通知作为 L2 分支显式返回在 effects 中。

**权限**：基础为 `task:write`、L1；通知其他 agent 时还需 `task:dispatch` 并按 L2 过护栏。

**建议状态图**：`todo → in_progress|closed`；`in_progress → todo|in_review|closed`；`in_review → in_progress|done|closed`；`done → in_progress`（重开）；`closed → todo`（重开）。这是 Wave 2 建议，现有 open-tag 只校验枚举、不限制跳转，需在实现前由产品验收规则最终确认。

### 5.6 `task_report`：在任务 thread 内结构化汇报

**参数**

```ts
type TaskReportInput = {
  requestId: string;
  taskId: string;
  kind: "progress" | "blocker" | "question" | "result";
  content: string;
  artifactRefs?: Array<{ kind: "file" | "url" | "message"; ref: string; label?: string }>;
  notifyAgentIds?: string[];
};
```

**返回**：任务最新视图、thread message id、实际通知对象。

**副作用**：在任务 thread 写一条带结构化 metadata 的消息；不自动改状态。无 `notifyAgentIds` 时只写本地时间线，不 ambient-wake thread 内全部 agent；有通知时只投递给显式对象。

**权限**：无通知时 `task:write`（或复用 `message:send`）、L1；通知时还需 `task:dispatch`、L2。

**实现映射**：复用 `getOrCreateThread` + `createMessage` 的消息与实时事件能力，但需要一个 `wakePolicy: none|explicit`，避免沿用统一 ambient wake。结构化字段可先落在 thread message 的 `actionMetadata`；该字段已存在（`reference/open-tag/src/db/schema.ts:128`–`reference/open-tag/src/db/schema.ts:130`）。

### 5.7 `task_submit_delivery`：提交交付汇总并进入审核

**参数**

```ts
type TaskSubmitDeliveryInput = {
  requestId: string;
  taskId: string;
  expectedRevision: number;
  summary: string;
  childTaskIds?: string[];
  artifactRefs?: Array<{ kind: "file" | "url" | "message"; ref: string; label?: string }>;
  reviewerAgentIds?: string[];
};
```

**返回**：最新任务（通常为 `in_review`）、delivery thread message id、子任务状态快照、实际通知的 reviewer。

**副作用**：校验子任务确属该父任务；在 thread 写一条 `kind="task-delivery"` 的结构化交付消息；将父任务从 `in_progress` 原子转为 `in_review`；发布 task/message 事件；只通知显式 reviewer/任务创建者。它不自动把任务设为 `done`，完成仍由审核后的 `task_transition` 表达。

**权限**：`task:write` + `task:dispatch`，L2。

**实现缺口**：open-tag 没有交付复合算子。不能在 MCP handler 中先发消息、再独立改状态；两步必须由 `TaskService.submitDelivery` 统一提交或补偿，否则会出现“有交付但状态未进审核”或相反的半成功。

## 6. 两个读取工具（建议一并提供）

| 工具 | 最小参数 | 返回 | 权限 |
|---|---|---|---|
| `task_get` | `taskId` 或 `{channelId, taskNumber}` | `TaskView`、父/直接子任务摘要、最近 thread 汇报、当前 revision | `task:read`，L0 |
| `task_list` | `channelId? / status? / assigneeId? / parentTaskId? / limit / cursor` | 稳定分页的 `TaskView[]` | `task:read`，L0 |

现有 list 只按一个 channel 查询并在内存中过滤 task（`reference/open-tag/src/server/routes-agent.ts:268`–`reference/open-tag/src/server/routes-agent.ts:272`）；Wave 2 应把 `taskStatus IS NOT NULL` 和过滤/分页下推到 repository。

## 7. 建议的模块边界

为避免把 MCP、HTTP、业务规则和数据库继续堆进 `server/core.ts`，最小拆分如下：

```text
tasks/
  taskTypes.ts       # TaskView、状态、输入/错误类型
  taskPolicy.ts      # 状态图、ACL、L1/L2 与护栏判断
  taskRepository.ts  # message-as-task 的查询与条件更新
  taskService.ts     # 七个用例的事务、事件、审计与幂等
  taskMcp.ts         # MCP schema/参数转换；不含业务 SQL
```

REST/CLI 现有 routes 与 MCP 都调用 `taskService`。实时事件和 daemon dispatch 由 service 的明确 effects 驱动；不要让 repository 隐式唤醒 agent。

## 8. 与现有 open-tag 任务模型的映射与差距

| 能力 | 可复用现状 | 主要差距 / Wave 2 动作 |
|---|---|---|
| 创建任务 | `createMessage(asTask)` 已生成 task message、编号、thread、事件和审计（`reference/open-tag/src/server/core.ts:337`–`reference/open-tag/src/server/core.ts:400`） | 把编号/消息/thread 纳入事务；创建默认不走 ambient wake；增加幂等键 |
| 消息转任务 | `convertMessageToTask` 有原子 winner（`reference/open-tag/src/server/core.ts:598`–`reference/open-tag/src/server/core.ts:606`） | winner 后续编号/thread 仍非事务；修复半成品窗口 |
| 拆解 | agent REST 支持 batch new（`reference/open-tag/src/server/routes-agent.ts:351`–`reference/open-tag/src/server/routes-agent.ts:360`） | 无父子关系、深度、原子批处理、预算和幂等；最小增加 `taskParentId` + revision |
| 分派 | `assignTask` 已加 thread 成员、审计并唤醒目标（`reference/open-tag/src/server/core.ts:686`–`reference/open-tag/src/server/core.ts:758`） | read-then-write 可覆盖并发指派；没有 execution mode/深度/token/急停校验；`task:write` 权限过粗 |
| 领取 | `claimTask` 已用条件 UPDATE 防双 claim（`reference/open-tag/src/server/core.ts:658`–`reference/open-tag/src/server/core.ts:670`） | 终态也可能被领取；补状态、ACL、revision 条件；unclaim 要校验所有者/管理权限 |
| 状态流转 | `setTaskStatus` 维护完成时间、事件、thread 审计与通知（`reference/open-tag/src/server/core.ts:765`–`reference/open-tag/src/server/core.ts:794`） | core 不校验 enum/状态图；任意跳转；并发无 expected state/revision |
| thread 汇报 | route 已能向 thread 回复（`reference/open-tag/src/server/routes-agent.ts:374`–`reference/open-tag/src/server/routes-agent.ts:381`） | 只是普通消息；无 report kind/artifact；统一 `createMessage` 可能 ambient-wake，需要显式 wake policy |
| 交付汇总 | 可组合 thread message + `setTaskStatus(in_review)` | 无原子复合用例、结构化 delivery、子任务校验和 reviewer 通知 |
| 权限 | `task:read` / `task:write` 已在 gateway 强制（`reference/open-tag/src/server/routes-agent.ts:18`–`reference/open-tag/src/server/routes-agent.ts:35`） | 写权限把本地更新与 runtime dispatch 混在一起；增加 `task:dispatch` 与 L2 护栏 |
| 可观测性 | `task:created/updated/deleted` 与系统审计消息已存在（`reference/open-tag/src/server/core.ts:573`–`reference/open-tag/src/server/core.ts:595`） | 缺 operation/request id、统一 trace、guard-blocked 事件和 dispatch 结果 |

## 9. Wave 2 实施顺序与验收点

1. **抽任务应用服务，不改外部行为**：REST/CLI 回归测试应继续通过；MCP 暂不接 SQL。
2. **补事务、revision 与幂等**：并发转换/领取/指派测试；故障注入后不存在 `taskStatus != null` 但无 task number/thread 的记录。
3. **拆开 create 与 dispatch**：`task_create` 不唤醒；只有 `task_assign`、显式 notify、delivery review 会投递 runtime。
4. **增加父子关系与拆解护栏**：深度、批量上限、预算、急停均有稳定 `GUARD_BLOCKED` 返回。
5. **接 MCP transport**：七个工具只调 `TaskService`；参数 schema、错误 code、scope 和 ACL 有契约测试。
6. **接 UI 桥**：每个成功写操作只产生一次预期 task/message 事件；MCP 重试不会出现重复任务、重复报告或重复交付。

最关键的并发验收：两个 agent 同时 claim 只能一个成功；两个 agent 同时 assign 不得静默覆盖；同一 `requestId` 重试不得重复创建；提交交付与进入 `in_review` 必须同成同败。
