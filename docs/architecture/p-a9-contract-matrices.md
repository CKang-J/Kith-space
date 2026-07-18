# P-A9 最终契约矩阵与可执行证据

状态：P-A9.0 冻结基线保留；P-A9.1a–P-A9.7 已实现。机器可检查的写入、Agent HTTP 与 Runtime 契约矩阵位于 `scripts/p-a9/contract-matrix.mjs`，最后核对 2026-07-18。

本文描述 P-A9 收口后的当前架构，并保留 P-A9.0 性能对照。P-A9 没有改变 schema、公开 URL、Agent CLI 或产品交互；Runtime contract v2 的 turn completion、usage 与“已 read、回复前崩溃”恢复仍未实现，不能把当前 admission/replay 语义称为端到端 exactly-once。

## 1. 生产写入所有权

| 用例 | 当前入口 | P-A9 目标所有者 | P-A9.0 证据 |
| --- | --- | --- | --- |
| Human 普通消息 | `src/server/routes-api/messages.ts` | `MessagePostingModule` | Human sender 与正文进入 `createMessage` |
| Human As Task | `src/server/routes-api/messages.ts` | `TaskModule` | `asTask` 与 execution mode 同路进入 |
| Human 批量任务 | `src/server/routes-api/tasks.ts` | `TaskModule` | 循环建立 task 与 parent relation |
| Agent 普通消息 | `src/server/agent-http/messagesContextModule.ts` | `MessagePostingModule` | Agent sender、附件与 introduction turn 共用 post helper |
| Agent introduction | `src/server/agent-http/messagesContextModule.ts` | `MessagePostingModule` | introduction agent/token 进入写入用例 |
| Agent 话题回复 | `src/server/agent-http/channelsThreadsModule.ts` | `MessagePostingModule` | 解析 thread 后写入 thread channel |
| Agent 任务 | `src/server/agent-http/tasksModule.ts` | `TaskModule` | Agent 批量 task 与 parent relation |
| Action prepare | `src/server/agent-http/actionsModule.ts` | `ActionModule` | action message 与 metadata |
| Reminder 写入 | `src/server/agent-http/remindersModule.ts` | `ReminderModule` | reminder insert/update |
| Reminder 到期投递 | `src/server/reminders.ts` | `MessagePostingModule` | due reminder 通过 `createMessage` 写 visible system message |
| 内部任务审计 | `src/tasks/taskLifecycleModule.ts` | `TaskModule` | system task message 与 task event |

`test/pA9ContractMatrix.unit.test.ts` 会逐项核对这 11 个用例的源文件证据，并用 TypeScript AST 双向扫描生产源码中的 `createMessage` import/call site；当前精确调用方为四个 `src/server/agent-http/*Module.ts`、`reminders.ts`、`routes-api/messages.ts` 与 `routes-api/tasks.ts` 各 1 处。新增或搬迁写入口时必须同时更新矩阵，不能让业务 Implementation 悄悄回流到 Transport。

## 2. Agent HTTP 端点所有权

| 目标 Module | 当前端点 |
| --- | --- |
| `MessagesContextModule` | `GET message/check`、`POST message/send`、`POST message/react`、`GET message/read`、`GET search`、`GET message/resolve` |
| `ChannelsThreadsModule` | `POST channel/join`、`POST thread/reply`、`GET thread/read`、`GET channel/members`、`POST channel/leave`、`POST thread/unfollow` |
| `TaskModule` | `GET task/list`、`GET task/get`、`POST task/claim`、`POST task/update`、`POST task/assign`、`POST task/new`、`POST task/report`、`POST task/delivery`、`POST task/unclaim` |
| `ActionModule` | `POST action/prepare` |
| `FilesModule` | `POST attachment/upload`、`GET attachment/view` |
| `ProfileSpaceModule` | `GET space/info`、`GET profile/show`、`POST profile/update` |
| `ReminderModule` | `POST reminder/schedule`、`GET reminder/list`、`POST reminder/cancel`、`POST reminder/snooze` |

机器检查会从 `src/server/routes-agent.ts` 提取全部精确 `method + path` 分支，并要求与 31 个所有权条目一一对应、无重复。`test/pA9AgentHttpCharacterization.integration.ts` 另行冻结认证、scope、freshness、watermark、action normalization、短 ID、私有话题 ACL、搜索可见性、task CAS、附件 ACL/清理、reminder anchor 与稳定错误形状。

## 3. Message / Task durable commit 与副作用边界

`MessagePostingModule`（`src/messages/messagePostingModule.ts:95`、`:267`）与 `TaskLifecycleModule`（`src/tasks/taskLifecycleModule.ts:62`、`:103`）现在拥有消息和任务完整用例；`src/server/core.ts` 只组合依赖并保留稳定入口。失败注入锁定以下当前事实：

| 事实 | 当前结果 | 证据 |
| --- | --- | --- |
| message 与 dispatch chain | 同一 SQLite 事务；chain 写失败时 message 不存在，也不发布 realtime | `test/pA9ConversationTransaction.integration.ts`、`test/pA9MessageCommitCharacterization.integration.ts` |
| mention 与自动加入 membership | 同一事务；mention 写失败时 message、mention 与自动加入全部回滚 | `test/pA9ConversationTransaction.integration.ts` |
| attachment 绑定 | 与 message 同一事务；绑定失败时 message 回滚，attachment 保持未绑定 | `test/pA9ConversationTransaction.integration.ts` |
| task 本体、编号、owning thread 与创建审计 | 同一事务；任一写入失败不留下 task 或 thread | 两个上述失败注入测试 |
| task assignment 与审计 | 同一事务；审计失败时 assignee/status/revision 保持原值，不发布 realtime | `test/pA9MessageCommitCharacterization.integration.ts` |
| realtime / Worker effect | durable commit 之后执行；发布失败不会反向删除已提交消息，Worker 投递始终在事务外 | `test/pA9ConversationTransaction.integration.ts`、`src/messages/messagePostingModule.ts` |
| 离线或明确拒绝的 Worker 目标 | reserved wake 被释放，wake budget 不被消耗；ack 不确定时保留 pending 供 reconnect 重放 | `test/pA9MessageCommitCharacterization.integration.ts`、`test/pA9ReconnectReservationCharacterization.integration.ts` |
| Reminder 到期投递 | 先 claim 为 `fired`，再通过同一 `MessagePostingModule` 入口写 visible system message | `test/pA9MessageCommitCharacterization.integration.ts` |

`WakeDispatchPort` 只接收完整候选和 durable message 上下文；Production Adapter 在 `src/server/messageWakeDispatchAdapter.ts:10` 处理 reservation、Runtime target、admission 与 commit。这样 SQLite durable 边界、post-commit effect 和 Worker 进程 seam 不互相伪装成同一个事务。

## 4. 当前 Worker/Runtime admission、reservation 与 reconnect 事实

可执行证据由 `src/runtime/control/runtimeWorkerAdmission.test.ts`、`src/runtime/worker/runtimeAdmissionController.test.ts`、`src/runtime/worker/runtimeAdmissionAgentManager.test.ts`、`test/pA9ReconnectReservationCharacterization.integration.ts`、`test/pA9ManualRuntimeCommand.integration.ts`、`test/pA9WakeReservationIdempotency.integration.ts`、`test/pA9ContractMatrix.unit.test.ts` 与 `scripts/p-a9/runtime-baseline.ts` 锁定。

| 事实 | 已实现结果 | 证据 |
| --- | --- | --- |
| 当前 generation 的 admission ack 才能提交 wake | Core 只对匹配的 `admitted` / `queued` settle；重复或过期 ack 幂等拒绝 | `src/runtime/control/runtimeWorkerAdmission.test.ts` |
| 持久逻辑键 get-or-reserve | 同一 `(spaceId, chainId, messageId, targetAgentId)` 复用同一 reservationId，不重复消耗 wake budget | `test/pA9WakeReservationIdempotency.integration.ts` |
| 断线 / 超时前的 reservation | 同一 reservation 保持 pending，新的 Worker lease 重放相同 deliveryId | `test/pA9ReconnectReservationCharacterization.integration.ts` |
| unread replay | `lastReadSeq` 关闭未读重放窗口；在 read 之前，replay 保留同一 reservationId / deliveryId | `test/pA9ReconnectReservationCharacterization.integration.ts` |
| live-session 容量 | `capacity = 4`，1 个 Agent 的 peak RuntimeSession 为 1；5/10/20 个 Agent 的 peak RuntimeSession 都为 4；没有 reject | `scripts/p-a9/runtime-baseline.ts`、`src/runtime/worker/runtimeAdmissionController.test.ts`、`src/runtime/worker/runtimeAdmissionAgentManager.test.ts` |
| slot release | `stop` / `sleep` / `exit` 都恰好释放一次 session slot，`activeAfterStop = 0` | `src/runtime/worker/runtimeAdmissionController.test.ts`、`src/runtime/worker/runtimeAdmissionAgentManager.test.ts`、`scripts/p-a9/runtime-baseline.ts` |
| command identities | wake command 复用 reservationId 作为 deliveryId；手动 / 生命周期命令使用独立 commandId | `src/runtime/control/runtimeWorkerAdmission.test.ts`、`test/pA9ManualRuntimeCommand.integration.ts` |
| queue / fairness | queued / merged 投递保持 per-Agent 顺序，manual > required > optional，并通过 aging 避免 Space 间饥饿 | `src/runtime/worker/runtimeAdmissionController.test.ts` |
| shutdown / reset | 队列中的 stop / reset / shutdown 都有确定的取消或排空结果 | `src/runtime/worker/runtimeAdmissionController.test.ts`、`src/runtime/worker/runtimeAdmissionAgentManager.test.ts` |
| read-before-reply 边界 | `lastReadSeq` 只关闭未读重放窗口，不覆盖“已 read、回复前崩溃”的端到端 exactly-once | `test/pA9ReconnectReservationCharacterization.integration.ts` |

注：最后一行是刻意保留给 `Runtime contract v2` 的边界。P-A9.4 冻结的是当前 admission / reservation / reconnect 行为，不把 `lastReadSeq` 已推进但回复前崩溃的恢复语义包装成端到端 exactly-once。

## 5. P-A9.4 admission/replay 已实现矩阵

以下条目与 `test/pA9ContractMatrix.unit.test.ts` 中的 `P_A9_4_TARGET_CONTRACTS` 保持一致，stage 全部为 `implemented-p-a9.4`。

| ID | 已实现契约 | 证据 |
| --- | --- | --- |
| `persistent-get-or-reserve` | 持久逻辑键 get-or-reserve 复用 reservation，不重复消耗 wake budget。 | `test/pA9WakeReservationIdempotency.integration.ts` |
| `admission-ack-commit` | Core 只在当前 Worker generation 对匹配 deliveryId 返回 `admitted` / `queued` 后 commit wake。 | `src/runtime/control/runtimeWorkerAdmission.test.ts`、`test/pA9ReconnectReservationCharacterization.integration.ts` |
| `duplicate-command-ack` | 同一 Worker generation 内的重复 command 与重复 admission ack 都幂等。 | `src/runtime/control/runtimeWorkerAdmission.test.ts`、`src/runtime/worker/runtimeAdmissionController.test.ts` |
| `disconnect-before-ack` | ack 前断线或超时保持同一 reservation 为 pending，并在新 Worker lease 重放同一 deliveryId。 | `test/pA9ReconnectReservationCharacterization.integration.ts` |
| `stale-worker-generation` | 旧 Worker generation 的 ack 不能提交 wake。 | `src/runtime/control/runtimeWorkerAdmission.test.ts` |
| `live-session-capacity` | 安装级容量只统计存活 `RuntimeSession`，并且永不越过上限。 | `src/runtime/worker/runtimeAdmissionController.test.ts`、`src/runtime/worker/runtimeAdmissionAgentManager.test.ts`、`scripts/p-a9/runtime-baseline.ts` |
| `slot-release` | `stop`、`sleep`、`exit` 各自恰好释放一次 session slot。 | `src/runtime/worker/runtimeAdmissionController.test.ts`、`src/runtime/worker/runtimeAdmissionAgentManager.test.ts` |
| `per-agent-order` | 等待与合并后的投递保持每 Agent 顺序。 | `src/runtime/worker/runtimeAdmissionController.test.ts` |
| `priority-aging-fairness` | 优先级为手动控制 > required DM/任务/mention > optional ambient，并以 aging 保证 Space 间公平和低优先级不永久饥饿。 | `src/runtime/worker/runtimeAdmissionController.test.ts` |
| `queued-cancel-reset` | 排队中的 stop / reset 具有确定的取消或替换结果。 | `src/runtime/worker/runtimeAdmissionController.test.ts` |
| `shutdown-drain` | Worker 停机具有确定的排空 / 取消结果。 | `src/runtime/worker/runtimeAdmissionController.test.ts`、`src/runtime/worker/runtimeAdmissionAgentManager.test.ts` |
| `queue-full-expiry` | queue full 与过期结果明确且不泄漏 reservation。 | `src/runtime/worker/runtimeAdmissionController.test.ts`、`test/pA9WakeReservationIdempotency.integration.ts` |
| `unread-replay` | ack 后未 check/read 的消息按 `lastReadSeq` 以同一 reservationId 重放，不重复增加 wake budget。 | `test/pA9ReconnectReservationCharacterization.integration.ts` |
| `command-identities` | wake 复用 reservationId；手动 / 生命周期命令使用独立 commandId。 | `src/runtime/control/runtimeWorkerAdmission.test.ts`、`test/pA9ManualRuntimeCommand.integration.ts` |
| `manual-command-budget` | 手动 / 生命周期命令不占消息 wake budget。 | `test/pA9ManualRuntimeCommand.integration.ts` |
| `read-before-reply-limit` | “已 read、回复前崩溃”继续明确标成 Runtime 契约 v2 已知限制，不宣称端到端 exactly-once。 | `test/pA9ReconnectReservationCharacterization.integration.ts`、`src/server/reconnectCatchup.ts` |

Runtime contract v2 仍然只承接最后一行的 turn completion / usage 语义；P-A9.4 只冻结当前 admission / reservation / reconnect 行为，不把这条边界写成已经解决的 exactly-once。

## 6. P-A9.3 / P-A9.5 / P-A9.6 / P-A9.7 收口护栏

- 领域实现位于 `src/{messages,tasks,agents,channels,files,runtime}`；`scripts/p-a9/module-dependency-guard.mjs` 直接拒绝任何领域到 `src/{server,desktop}` 的生产依赖，不再存在临时 allowlist。
- `src/server/routes-agent.ts:59` 只负责认证、上下文和七个 Agent HTTP Module 的分派；这些 Module 的 31 个端点由矩阵双向核对，路由索引不访问数据库。
- Chat 的请求语义收口在 `web/src/features/conversation/data/`，分页/实时消息、话题和视口状态分别位于三个 model hook（`useConversationMessages.ts:39`、`useConversationThreads.ts:47`、`useConversationViewport.ts:51`）。`Chat.tsx` 保持现有 URL、DOM 结构和交互，只组合这些接口，不再直接持有 generic API 或 Socket 订阅生命周期。
- P-A9.6 只优化基线可归因路径：候选 Agent 的 membership、response mode、scope、可用 Runtime target 采用批量解析，20-Agent SQL p95 从 P-A9.0 的 260 降到 151；跨 Agent admission 可并行，但每 Agent 顺序仍由 Worker 控制器拥有。未引入虚拟列表或额外 React memoization。
- P-A9.7 已删除旧 `server/storage`、旧 task/thread/policy 转发、旧 message participant/scopes/wake policy facade、旧 Implementation 注释体、`reserveWake`/旧 wake adapter 别名和无 admission identity 的 Worker 命令兼容分支。`/daemon/connect`、公开 URL 与 Agent CLI 未改；它们是当前产品/调试契约，不属于失效 facade。
