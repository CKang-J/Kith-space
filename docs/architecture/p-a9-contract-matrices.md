# P-A9.0 当前契约矩阵与 P-A9.4 目标清单

状态：P-A9.0 已冻结；最后核对 2026-07-18。机器可检查的所有权矩阵位于 `scripts/p-a9/contract-matrix.mjs`。

本文只描述 P-A9.0 观察到的现状和 P-A9.4 尚未实现的目标。它不改变 schema、公开 URL、Agent CLI、消息行为或 Worker 协议，也不声称当前已有 admission ack、幂等 get-or-reserve 或容量队列。

## 1. 生产写入所有权

| 用例 | 当前入口 | P-A9 目标所有者 | P-A9.0 证据 |
| --- | --- | --- | --- |
| Human 普通消息 | `src/server/routes-api/messages.ts` | `MessagePostingModule` | Human sender 与正文进入 `createMessage` |
| Human As Task | `src/server/routes-api/messages.ts` | `TaskModule` | `asTask` 与 execution mode 同路进入 |
| Human 批量任务 | `src/server/routes-api/tasks.ts` | `TaskModule` | 循环建立 task 与 parent relation |
| Agent 普通消息 | `src/server/routes-agent.ts` | `MessagePostingModule` | Agent sender、附件与 introduction turn 共用 post helper |
| Agent introduction | `src/server/routes-agent.ts` | `MessagePostingModule` | introduction agent/token 进入写入用例 |
| Agent 话题回复 | `src/server/routes-agent.ts` | `MessagePostingModule` | 解析 thread 后写入 thread channel |
| Agent 任务 | `src/server/routes-agent.ts` | `TaskModule` | Agent 批量 task 与 parent relation |
| Action prepare | `src/server/routes-agent.ts` | `ActionModule` | action message 与 metadata |
| Reminder 写入 | `src/server/routes-agent.ts` | `ReminderModule` | reminder insert/update |
| Reminder 到期投递 | `src/server/reminders.ts` | `MessagePostingModule` | due reminder 通过 `createMessage` 写 visible system message |
| 内部任务审计 | `src/server/core.ts` | `TaskModule` | system task message 与 task event |

`test/pA9ContractMatrix.unit.test.ts` 会逐项核对这 11 个用例的源文件证据，并用 TypeScript AST 双向扫描生产源码中的 `createMessage` import/call site；当前精确调用方为 `reminders.ts` 1 处、`routes-agent.ts` 4 处、`routes-api/messages.ts` 1 处、`routes-api/tasks.ts` 1 处。新增或搬迁写入口时必须同时更新矩阵，不能让调用方悄悄落在 `core.ts` 或 Transport 中。

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

## 3. 当前 message/task commit 与副作用事实

| 事实 | 当前结果 | 特征测试 |
| --- | --- | --- |
| 普通 message insert 后 dispatch chain 写失败 | message 已存在；调用返回失败 | `test/pA9MessageCommitCharacterization.integration.ts` |
| task 本体/编号/owning thread 后 system audit 写失败 | task 与 owning thread 已存在；调用返回失败 | 同上 |
| task assignment 更新后 system audit 写失败 | assignment、revision 与 `in_progress` 已提交；`task` realtime 已发布；调用返回失败 | 同上 |
| 离线 Worker 目标无法启动 | reservation 被释放，chain wake count 回到 0 | 同上 |
| 上传后的 attachment 绑定消息 | `messageId/channelId` 在后续更新中写入 | 同上 |
| Human 在话题回复 | Human 自动 follow 该话题 | 同上 |
| Reminder 到期投递 | 先 claim 为 `fired`，再按 anchor channel 写 visible system message 并发布 `message` realtime | 同上 |

这些是 P-A9.1a 等价提取必须保持的现状，不是理想事务定义。P-A9.1b 才能在独立切片以失败注入测试收拢同库事务；在那之前不得把“目标 durable commit”误写成现状。

## 4. 当前 Worker/Runtime transport 事实与删除条件

- `sendToWorker` 的 `true` 只表示当前 WebSocket 同步 `send` 被调用，没有 Worker admission 语义。
- Worker 侧现在会发 `agent:deliver:ack`，Core 的 Worker WebSocket handler 不消费该消息；因此它不是可依赖的 ack 契约。
- Agent 尚未启动时，`AgentManager` 当前恰好只保留最新 10 条可区分的 pending delivery；默认 TTL 边界为 14999 ms 仍保留、15000 ms 已过期。另有可配置短 TTL 测试；这些只冻结现状，不把数值升级为目标规则。
- Worker reconnect catch-up 以 `lastReadSeq` 为未读窗口。当前同一未读消息跨新 Worker lease 会再次 start，并创建新的 success reservation；推进 `lastReadSeq` 后才停止重放。这是 P-A9.4 必须替换的当前缺陷，不能写成已有 get-or-reserve。
- fake Runtime harness 能记录 start/session、deliver、stop 与 exit；当前 20 Agent burst 会达到 20 个存活 session，说明现状没有安装级容量上限。
- 20 Agent Core 样本的 fan-out p95 是 16，来源是当前 dispatch wake budget，而不是 Runtime 容量策略。

当前事实由 `test/workerTransportCurrentFacts.unit.test.ts`、`src/daemon/agentManagerTransportCharacterization.test.ts`、`test/pA9ReconnectReservationCharacterization.integration.ts`、`src/local-runtime/testing/inMemoryWorkerAdapter.test.ts` 与 `src/daemon/testing/fakeRuntimeHarness.test.ts` 覆盖。P-A9.4 引入真实 deliveryId/admission ack、get-or-reserve、generation 与容量队列后，必须更新或删除冲突的旧事实断言；不得把“ack 未消费”、重复新建 reservation 或 pending 10/15 秒永久固化为产品规则。

## 5. P-A9.4 admission/replay 目标清单

以下全部标记为 `target-p-a9.4`，P-A9.0 只检查清单完整性，不要求目标行为变绿：

1. 持久逻辑键 get-or-reserve 复用 reservation，不重复消耗 wake budget。
2. Core 只在当前 Worker generation 对匹配 deliveryId 返回 admitted/queued 后 commit wake。
3. 同一 Worker generation 内的重复 command 与重复 admission ack 都幂等。
4. ack 前断线或超时保持同一 reservation 为 pending，并在新 Worker lease 重放同一 deliveryId。
5. 旧 Worker generation 的 ack 不能提交 wake。
6. 安装级容量只统计存活 `RuntimeSession`，并且永不越过上限。
7. stop、sleep、exit 各自恰好释放一次 session slot。
8. 等待与合并后的投递保持每 Agent 顺序。
9. 优先级为手动控制 > required DM/任务/mention > optional ambient，并以 aging 保证 Space 间公平和低优先级不永久饥饿。
10. 排队中的 stop/reset 具有确定的取消或替换结果。
11. Worker 停机具有确定的排空/取消结果。
12. queue full 与过期结果明确且不泄漏 reservation。
13. ack 后未 check/read 的消息按 `lastReadSeq` 以同一 reservationId 重放，不重复增加 wake budget。
14. wake 复用 reservationId；手动/生命周期命令使用独立 commandId。
15. 手动/生命周期命令不占消息 wake budget。
16. “已 read、回复前崩溃”继续明确标成 Runtime 契约 v2 已知限制，不宣称端到端 exactly-once。

P-A9.4 开始时必须先把这 16 项改写成可执行的失败测试，再实施协议或队列。若现有 `dispatch_wakes` 无法证明并发 get-or-reserve 唯一性，按权威规格停下，先做独立 schema/迁移/恢复设计，不能用内存去重代替。
