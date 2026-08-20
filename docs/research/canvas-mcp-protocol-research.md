# Canvas × Agent 协议边界研究：MCP 2026-07-28 是否适合 Kith-space

> 研究日期：2026-08-15<br>
> 范围：只核验 MCP 官方规范、官方 MCP 仓库与官方 SDK；结合 Kith-space 当前源码判断画布与 Agent 的协议边界。本文是研究输入，不替代后续 Canvas 产品/架构规格。
> Kith 源码基线：`codex/development@4937690`。

## 结论先行

1. 用户所说的核心事实**基本准确**：`2026-07-28` 已于 2026-07-28 正式发布，不再是 RC；这一现代协议代际移除了 `initialize` / `notifications/initialized`，也移除了 Streamable HTTP 的 `Mcp-Session-Id`。它以每请求 `_meta`、可选的 `server/discover`、每请求 HTTP POST 和显式应用状态 handle 取代隐式协议会话。[官方 GA 公告](https://blog.modelcontextprotocol.io/posts/2026-07-28/)、[版本协商规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)、[Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
2. 但“因此更适合多个 Agent 同时修改同一画布”只对了一小部分。新版 MCP 解决的是**协议传输状态、实例亲和和水平扩展**；它没有定义画布操作者身份、ACL、命令幂等、事务、元素版本、冲突合并或撤销语义。它让多个请求更容易落到不同服务实例，却不会让这些请求自动变成并发安全。
3. Kith MVP 不应把 MCP 当作画布的数据协议，也不应先做 MCP 大迁移。正确主边界是：**先建立 Kith-owned Canvas Command API / Canvas Module 作为唯一写入事实源；Human UI、现有 MCP 工具、CLI 和后台任务都只是它的适配器。**
4. 现有 Kith `broker-backed MCP/CLI Gateway` 应保留并扩展。当前 `x-kith-session-handle` 不是 MCP 的 `Mcp-Session-Id`，而是 application-level session broker handle；它单独存在时刻意无权，必须与当前 `activationId`、`workerGeneration` 组合后解析为 turn claims 并逐调用重验。现代 MCP 并不要求删除这种显式应用状态 handle。建议未来在概念/命名上叫 `brokerCapabilityHandle`，避免混淆。
5. MCP `2026-07-28` 值得作为**后续互操作与远期横向部署的现代传输 profile**，但不是 Canvas MVP 的前置条件。若升级，应使用 TypeScript SDK v2 的 dual-era 服务方式，兼容仍可能使用 legacy era 的 MCP host；Claude Code、Codex、opencode 是否能 pin modern 必须由逐 runtime smoke 决定，不能预设支持状态。

## 1. 事实核验

### 1.1 正式版本号、日期与状态

| 项目 | 核验结果 |
|---|---|
| 正式协议版本 | `2026-07-28` |
| 正式发布时间 | 2026-07-28 |
| 截至本文日期状态 | 已 GA，不是 draft / RC |
| 前一正式版本 | `2025-11-25` |
| 官方 TypeScript SDK | v2 已成为 stable release line；拆分为 `@modelcontextprotocol/server`、`@modelcontextprotocol/client` 等包 |
| Kith 当前依赖 | `@modelcontextprotocol/sdk ^1.29.0`，仍是单体 v1 包（`package.json:116`） |

官方发布公告明确称 `2026-07-28` 已发布，并列出 stateless core、MRTR、header routing、cache hints、Tasks 扩展和授权强化；四个 Tier 1 SDK 当日已支持该版本。[MCP 2026-07-28 官方公告](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

TypeScript SDK 官方仓库当前说明 v2 是随 `2026-07-28` 发布的 stable release line，而 v1 进入有限维护期。[官方 TypeScript SDK README](https://github.com/modelcontextprotocol/typescript-sdk)、[v2 API 文档](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/)

### 1.2 “取消传统握手”是否准确

准确，但要限定为 `2026-07-28` 开始的 modern era：

- `2025-11-25` 及以前属于 legacy era，以 `initialize` 建立协议版本、能力和身份上下文；
- `2026-07-28` 及以后属于 modern era，没有协商握手；
- 每个请求都携带 `io.modelcontextprotocol/protocolVersion` 与 `io.modelcontextprotocol/clientCapabilities`；`clientInfo` 推荐携带但不是强制字段；
- `server/discover` 是服务端必须实现、客户端可选调用的发现 RPC，不是创建会话的握手；客户端也可以直接发业务 RPC，再根据 `UnsupportedProtocolVersionError` 重试。

依据：[版本协商规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)、[Discovery 规范](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)、[Base Protocol `_meta` 规范](https://modelcontextprotocol.io/specification/2026-07-28/basic)

这并不意味着整个生态会在升级 SDK 后自动切换现代协议。官方 TypeScript SDK v2 的 client 默认仍是 legacy 模式；`mode: 'auto'` 才先做 `server/discover` 并在必要时回退，`pin: '2026-07-28'` 则拒绝旧服务端。服务端 stdio 要通过 `serveStdio(factory)` 同时承载两种代际。[TypeScript SDK Protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)

### 1.3 “取消 Mcp-Session-Id”是否准确

准确。`Mcp-Session-Id` 是旧 Streamable HTTP 的协议级会话标识；`2026-07-28` 移除了协议级会话和独立 GET stream endpoint。每条 JSON-RPC 消息都作为新的 HTTP POST，请求响应可以是 JSON 或仅属于该请求的 SSE stream。[Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

规范也明确要求：

- 服务端不得从同一连接上的历史请求推断版本、能力、身份或对话；
- 同一连接可以交错承载多个 task、thread 或 conversation；
- 跨请求状态必须由客户端每次传入显式标识符；
- stdio process / connection 也不是 conversation 或 session。

依据：[Base Protocol 的 Statelessness](https://modelcontextprotocol.io/specification/2026-07-28/basic)、[SEP-2567：Sessionless MCP via Explicit State Handles](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2567)

### 1.4 用户描述中需要修正的部分

| 原说法 | 更精确的说法 |
|---|---|
| “无会话请求” | **协议层无隐式会话**。应用仍可有 Canvas、task、browser、transaction 等显式 handle 和持久状态。 |
| “取消传统握手” | modern era 无 `initialize`；可选 `server/discover` 只发现版本/能力，不建立会话。 |
| “更适合多个操作者同时操作 MCP 中的数据” | 更适合多个独立请求跨实例路由；共享数据的并发控制仍完全是应用职责。 |
| “适合多 Agent” | 它允许同一 transport 交错多个 task/thread/conversation，但不会识别可信 Agent、分配权限或解决写冲突。 |
| “适合后台协作” | MRTR 和 Tasks extension 有助于无连接亲和的交互式/长任务调用；后台协作的 durable queue、lease、重试、权限和结果落库仍由 Kith 负责。 |

## 2. 六个容易混淆但必须分开的概念

| 层次 | 它回答的问题 | MCP 2026-07-28 是否负责 | Kith Canvas 应由谁负责 |
|---|---|---|---|
| 协议传输会话 | 请求是否必须回到创建 session 的同一实例 | 负责；现代版取消隐式 session | 不需要另造 transport session |
| 版本/能力发现 | 双方支持哪些协议版本、工具和扩展 | 负责；每请求 metadata + 可选 discover | MCP adapter 负责 |
| 应用级操作者身份 | 此请求实际是谁：Human、Agent、后台 job | 不负责；`clientInfo` 是自报 name/version，不能用于安全决策 | Kith capability / authenticated principal |
| 授权 | 此操作者能否读写此 Space、Canvas、元素或区域 | MCP 只提供 HTTP auth 框架，不理解 Canvas ACL | Kith Canvas policy + Gateway scope |
| 幂等与事务 | 重试是否重复写；一批元素是否原子提交 | 不负责 | Canvas Command Service + SQLite transaction |
| 并发与版本冲突 | 两个 Agent 同时改同一元素时谁成功、如何合并 | 不负责 | element/board revision、CAS、冲突返回与重试策略 |

一个特别重要的安全事实：现代协议的 `clientInfo` 与响应端的 `serverInfo` 都是发送方自报信息，规范明确说不能据此做安全决策。[Base Protocol `_meta` 安全说明](https://modelcontextprotocol.io/specification/2026-07-28/basic)

JSON-RPC `id` 也不是幂等键。它只要求在仍未收到响应的请求中不重复，用于把 response 与当前 in-flight request 对应；重试时不会天然复用，更不提供“只执行一次”语义。[Base Protocol Requests](https://modelcontextprotocol.io/specification/2026-07-28/basic)

## 3. 新版 MCP 对 Kith Canvas 真正有帮助的地方

### 3.1 负载均衡与故障隔离：有帮助，但不是 MVP 瓶颈

现代请求自描述，`Mcp-Method` 和特定请求的 `Mcp-Name` 会镜像到 HTTP header，网关可以不解析 JSON body 就做路由、鉴权、限流和观测；任何服务实例均可处理请求，不再需要 transport sticky session。[Streamable HTTP Request Metadata](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[SEP-2243](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2243)

但它只消除了**协议 session store**。如果 Canvas Command Service 多实例运行，它们仍需共享/协调：

- authoritative Canvas 数据库；
- command idempotency ledger；
- 对象存储与上传状态；
- change event / outbox；
- 长任务状态；
- 冲突检测所需的 revision。

Kith 当前是 Desktop-first、单机 Core + 唯一 Local Runtime Worker，画布 MVP 没有水平扩展需求。因此这项收益主要是未来价值，而非第一版采用新协议的充分理由。

### 3.2 多 Agent 并发：只改善请求承载，不改善共享写语义

新版规范明确要求服务端可处理多个 task/thread/conversation，且不能把连接身份当作连续上下文。这很适合 Kith 避免“一个 Agent 一个 MCP session”的隐式耦合。[Base Protocol Statelessness](https://modelcontextprotocol.io/specification/2026-07-28/basic)

但它不会回答：

- Agent A 与 Agent B 是否都能改同一 Canvas；
- 两者同时移动同一个节点时是否 LWW、拒绝、合并或创建冲突副本；
- 跨 20 个元素的布局操作是否原子；
- 重试 `tools/call` 是否会重复生成图片或重复插入元素；
- Agent 的“自己的工作区域”是视觉提示、软租约还是强 ACL；
- undo 是按用户、按 Agent、按 command 还是全画布。

这些必须由 Canvas Command API 定义。

### 3.3 后台协作：有可借用的机制，但不能替代 Kith Harness

- MRTR 允许工具返回 `input_required`，客户端收集 Human 输入后携 `inputResponses` 和 `requestState` 重发原请求；它适合删除确认、选择候选方案等中途交互，不要求常开双向 stream。[官方 MRTR 说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/)、[Tools 中的 Input Required](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- Tasks 已成为 `io.modelcontextprotocol/tasks` 扩展，适合远端 MCP tool 的异步执行、轮询状态和中途输入。[官方发布说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- `subscriptions/listen` 提供客户端主动打开的通知 stream，适合 tool/resource catalog 变化和 resource update，不应被当作 Canvas 的唯一 durable event log。[Streamable HTTP 规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[TypeScript SDK 2026 支持说明](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

Kith 已有 durable delivery / logical turn / attempt、lease recovery、server-owned reply 和 session wakeup。Canvas Agent 后台工作应接入这些机制；只有当 Kith 作为 MCP client 调用外部、长时间运行的 Canvas/生成服务时，MCP Tasks 才是互操作层的候选。不能用 MCP Tasks 取代 Kith 的 Agent task、turn ledger 或画布 command ledger。

### 3.4 显式状态 handle：与 Kith 的方向一致

官方指导明确建议有状态工具返回显式 handle，并让后续调用把它作为普通参数继续传递；handle 必须重新做授权校验，不能把 handle 本身默认当成权限。[Tools：Stateful Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)、[SEP-2567](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2567)

因此 Canvas 工具显式携带 `canvasId`、`commandId`、`expectedRevision` 是正确方向。反过来，把“当前 Canvas”“当前选区”“当前 Agent”藏进连接/session state 是应避免的方向。

## 4. Kith 当前 Gateway 的真实边界

### 4.1 当前 MCP 是 stdio adapter，不是 Canvas 数据平面

`src/server/mcp/stdio.ts:2-8` 使用 v1 单体 SDK创建 `McpServer` 与 `StdioServerTransport`；每个 tool handler 都调用 `BrokerGatewayClient`，再访问 Core 的 `/agent-gateway/*`。这说明 Kith 已经有正确的基本分层：

```text
Agent runtime MCP client
  -> Kith stdio MCP adapter
  -> BrokerGatewayClient
  -> loopback /agent-gateway/*
  -> CapabilityGateway use case
  -> workspace.db / product modules
```

MCP 与 CLI 共享 `CapabilityGateway`，而不是各自直接改数据库（`src/capabilities/capabilityGateway.ts:52-61`）。Canvas 应沿用这一原则。

### 4.2 Kith session handle 不是 MCP Session-Id

`src/capabilities/gatewayClient.ts:50-64` 发送：

- `x-kith-session-handle`；
- `x-kith-activation-id`；
- `x-kith-worker-generation`；
- `x-kith-gateway-transport`。

`src/server/turn-gateway/routes.ts:44-67` 将三项身份材料交给 session broker。`x-kith-session-handle` 单独无权；只有它与当前 `activationId`、`workerGeneration` 匹配，broker 才解析出受约束 turn claims，后续领域调用仍校验 session generation、surface ACL、scope 和 transport identity。

这套 broker handle 的语义是 Kith 应用安全边界，不是 MCP transport affinity，也不是可独立使用的 bearer capability。组合解析得到的 claims 才包含 `turnId`、`attemptId`、`sessionId/generation`、`workerGeneration`、`spaceId`、`agentId`、允许输入/输出、scope、disclosure grant 与过期时间（`src/capabilities/contracts.ts:3-20`，`src/capabilities/sessionCapabilityBroker.ts:18-20`、`:60-79`）。

所以采用 modern MCP 后：

- **不应删除**这类可信 Kith principal/capability；
- 不应以自报 `clientInfo` 替代它；
- public MCP Streamable HTTP adapter 可把认证主体解析为等价 claims，内部 Gateway 仍接收权威 claims；
- `sessionHandle` 可改名为 `brokerCapabilityHandle`，明确它不是 transport session，也不能脱离 activation/generation 授权。

### 4.3 Kith 已经具备 Canvas 应复用的幂等骨架

`CapabilityGateway.operation()` 以 `(turnId, toolName, idempotencyKey)` 查重，对请求做 canonical hash；同 key + 同请求返回第一次 committed result，同 key + 不同请求 fail closed，并把写操作包在数据库 transaction 中（`src/capabilities/capabilityGateway.ts:515-545`）。外部副作用还提供 in-flight 合并和 reconciliation（`src/capabilities/capabilityGateway.ts:548-637`）。

Checklist 与 Task 已使用 `expectedRevision` 做 CAS（例如 `src/capabilities/capabilityGateway.ts:351-381`）。这比 MCP base protocol 更接近 Canvas 多 Agent 协作真正需要的语义，应提炼/复用，而不是改由 transport 层承担。

### 4.4 当前边界的不足

现有 activation 是 turn-scoped 身份基础，但现有 claims 还没有 Canvas object/action scope；正式方案必须从 bound delivery + explicit executor binding 派生可撤销的 Canvas grant，并逐调用重验。未来长生成任务也不应持有当前 turn activation 数十分钟：

- turn 内提交生成 job 时，先由权威 command 创建 durable job；
- job 持有 server-minted、最小权限、可撤销的 job principal/capability；
- job 完成回写 Canvas 时重新校验 Canvas/Space 状态和目标 revision；
- 原 turn 已结束也不应让 job 丢失，但撤权/删除 Canvas 必须让回写失败或转入待处理结果。

这是应用级 delegation/lease 设计，不是 MCP session 设计。

## 5. 三种边界方案比较

| 维度 | A. 直接扩展现有 Kith broker Gateway | B. 先采用 modern Streamable HTTP MCP | C. 建立 Canvas Command API，再挂适配器 |
|---|---|---|---|
| 主要目的 | 给当前 Agent runtime 暴露可信工具 | 标准化远端/多实例 MCP 传输 | 定义 Canvas 的唯一业务写语义 |
| 能否复用 Kith claims | 能，原生 | 能，但要额外做 HTTP auth -> claims | 能，且与 transport 无关 |
| Human UI 可否复用 | 需要另包 Human API | 不适合让 UI 直接当 MCP client | 可以，Human/Agent 都走同一 use case |
| 多 Agent 并发冲突 | 需新增 Canvas 语义 | MCP 不提供 | 可在 command 层完整定义 |
| 幂等/事务 | 可复用 turnOperations，但需适配 Canvas | MCP 不提供 | 可定义 durable command ledger + SQLite transaction |
| 负载均衡 | 当前单 Core，无直接收益 | modern MCP 有 transport 层收益 | command service 无状态化后才具备真实收益 |
| 后台任务 | 接 Kith durable turn/job | 可另用 Tasks extension | job command + 可选 MCP Tasks adapter |
| MVP 改动/风险 | 中等 | 高：SDK v2、host 兼容、双代际、HTTP 安全 | 中等，但形成长期稳定边界 |
| 推荐定位 | Agent adapter | 后续互操作 adapter | **MVP 的权威内核** |

结论不是三选一，而是有明确层级的组合：

```text
Human Canvas UI ───────────────┐
Chat drag/drop adapter ────────┤
Kith MCP tools ────────────────┼─> Canvas Command API / Module
Kith CLI fallback ─────────────┤      -> policy / CAS / idempotency / transaction
background job completion ─────┘      -> Canvas store + command log + outbox

可选未来外部入口：MCP 2026-07-28 Streamable HTTP adapter
```

MCP adapter 必须保持“薄”：它负责协议 schema、tool result 与错误映射，不拥有 Canvas 业务状态。官方 TypeScript SDK 也把 framework middleware 定位为不引入业务逻辑的薄适配器，这与该分层一致。[官方 TypeScript SDK README](https://github.com/modelcontextprotocol/typescript-sdk)

## 6. 建议的应用级 Canvas Command 协议

### 6.1 权威 command envelope

以下是协议研究建议，不锁定最终字段名：

```ts
interface CanvasCommandEnvelope {
  schemaVersion: 1;
  commandId: string;            // 客户端重试稳定，服务端持久化查重
  canvasId: string;             // 显式应用 handle，不从连接推断
  idempotencyKey: string;
  expectedMetadataRevision?: number;
  expectedDocumentRevision?: number;
  expectedElementRevisions?: Record<string, number>;
  expectedFrameRevisions?: Record<string, number>;
  expectedStructureRevision?: number;
  operation:
    | { type: "elements.create"; elements: NewCanvasElement[] }
    | { type: "elements.patch"; patches: ElementPatch[] }
    | { type: "elements.delete"; elementIds: string[] }
    | { type: "selection.transform"; elementIds: string[]; transform: Matrix }
    | { type: "batch"; operations: AtomicCanvasOperation[] };
}
```

这些字段**不能由调用方伪造**，应由 Gateway / authenticated Human API 注入或验证：

```ts
interface CanvasActorContext {
  spaceId: string;
  actorType: "human" | "agent" | "job";
  actorId: string;
  turnId?: string;
  attemptId?: string;
  taskId?: string;
  scopes: readonly CanvasScope[];
  expiresAt?: number;
}
```

返回值至少包含：

- `commandId` 与 idempotent replay 标记；
- 新的 metadata/document/structure revisions 和单调 `realtimeSequence`；
- 各受影响元素的新 revision；
- 结构化 conflict：当前 revision、当前最小快照/差异、可否自动重试；
- 生成的 durable event / audit id；
- 对新增媒体只返回 Kith 管理的 asset reference，不把大二进制塞进 command log。

### 6.2 并发规则

建议 Canvas MVP 使用可解释的 optimistic concurrency，而不是一上来做 CRDT：

1. **不同元素的独立改动**：按 `elementRevision` CAS，可并行成功，避免全局 board revision 造成虚假冲突。
2. **同一元素的 durable 内容/几何改动**：revision 不匹配就返回 conflict；Agent 必须重新读取、重新计划，不能静默覆盖。
3. **圈选后的多元素/Frame/结构操作**：服务端从 normalize 后的 operation 派生完整 read/write/root/order set，要求调用方 revisions 与其一一对应，并在一个 SQLite transaction 中全成或全败；不能信任调用方自行声明影响集。
4. **全局域**：标题/lifecycle 使用 `expectedMetadataRevision`；背景等 scene-wide 内容使用 `expectedDocumentRevision`；stack/group/parenting 使用 `expectedStructureRevision`。
5. **临时 presence / cursor / viewport / selection outline**：可以 LWW 或内存态，不进入 durable command ledger，也不应触发 Agent 上下文事实变化。
6. **AI 生成结果回写**：生成 job 先持久化；完成时以创建 job 时记录的目标 revision 做条件提交。若目标已变化，保存为 unattached result 或待用户/Agent 决定，不覆盖新内容。

如果未来要求多人实时共同编辑同一文本块、同一路径或手绘 stroke，再评估 CRDT/OT；仅因为有多个 Agent，不足以让 MVP 承担 CRDT 的复杂度。

### 6.3 幂等与副作用

Canvas command ledger 应沿用 Kith Harness 的既有幂等域，而不是新建 Agent 全局 key：

```text
Agent: (turnId, toolName, idempotencyKey)
Human: (humanId, canvasId, globallyUniqueClientCommandId)
```

每次先重验 live capability，再查同 key；同 key + 同 canonical request hash 返回首次结果，同 key + 不同请求 fail closed，只有新 key 才做 CAS。对图片/视频生成、文件导入等外部副作用采用：

```text
pending command
  -> commit durable job/outbox in SQLite
  -> worker executes external side effect
  -> reconcile by provider/job id
  -> conditional Canvas commit
  -> committed / conflict / failed
```

不能把 HTTP POST、JSON-RPC request ID 或 MCP transport 重试当作 exactly-once 保证。

### 6.4 Agent-facing MCP 工具粒度

建议暴露稳定、面向意图的少量工具，并全部委托 Canvas Command API：

- `canvas.snapshot_get`：有界读取 Canvas/viewport/selection snapshot；
- `canvas.elements_get`：按 opaque element IDs 读明确元素；
- `canvas.elements_apply`：原子 create/patch/delete/transform batch，必带 idempotency 与 revision；
- `canvas.context_bundle_create`：把当前圈选物冻结成 revisioned context bundle，供 chat/turn 引用；
- `canvas.asset_import`：把 Kith attachment/asset 安全导入 Canvas；
- 后续 `canvas.job_create` / `canvas.job_get`：需要长时间生成时使用 durable job，而不是保持 MCP session。

不要把当前选区藏在 MCP connection state；UI 发送给 Agent 时应创建 `selectionBundleId` 或列出 `(elementId, revision)`，使后续 turn 可审计、可复现，并能明确提示内容已过期。

## 7. MCP 2026-07-28 的采用建议

### 阶段 1：Canvas MVP，不以协议升级为前置条件

- 建立独立 Canvas Module / Command Service / Store / Policy；
- 通过现有 Gateway 增加 Canvas read/write/import/export scopes，并从 bound delivery 与明确 executor 派生 object/action grant；
- `src/server/mcp/stdio.ts` 和 CLI 仅注册薄工具；
- Human UI 使用同一个 use case，而不是另写一套可绕过审计的数据库接口；
- 为 command idempotency、CAS conflict、批量原子性、grant 扩张/撤权和 output artifact reconciliation 写行为测试。

这一步不需要 Streamable HTTP，也不需要删除现有 broker handle。

### 阶段 2：单独迁移 TypeScript SDK v2，保持 dual era

Kith 当前是 `@modelcontextprotocol/sdk ^1.29.0`。v2 是拆包且有行为边界变化的迁移，官方建议 codemod 后逐项处理、typecheck 和测试；stdio modern/dual-era 要改为 `serveStdio(factory)`。[v1 -> v2 官方迁移指南](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)、[2026 支持指南](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

建议：

- 作为独立切片迁移，不与 Recombyn Canvas 大移植绑成一个 diff；
- server 采用 dual era，默认允许 legacy；
- 对每个支持 runtime 实测 `tools/list`、`tools/call`、structured result、错误、取消和进程关闭；
- 只有 host 矩阵证明支持后，才考虑让某个 runtime pin modern；
- 不把协议版本能力误当作 Canvas feature gate。

### 阶段 3：确有外部互操作/多实例需求时增加 Streamable HTTP

只有出现以下需求才值得做：

- 外部 Agent host 不便启动 Kith stdio MCP server；
- LAN/受控远端客户端需要标准入口；
- Canvas tool server 真实需要多实例与普通 round-robin；
- 第三方希望把 Kith Canvas 当 MCP integration 使用。

此时 modern Streamable HTTP endpoint 必须：

- Kith 产品门禁固定只绑定 loopback；官方规范对此是 SHOULD；
- 校验 `Origin`（官方 MUST），并实施真实认证（官方 SHOULD、Kith 产品门禁提升为强制）。[Streamable HTTP Security & Endpoint](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- 把认证主体映射为 Kith principal，绝不信任 `clientInfo`；
- 校验 `MCP-Protocol-Version`、`Mcp-Method`、`Mcp-Name` 与 body 一致；
- 所有业务仍调用 Canvas Command API；
- 多实例之前先把 command ledger、Canvas store、event bus、job state 与 asset store 做成跨实例一致；
- 将 `subscriptions/listen` 视为 delivery channel，不视为事实源；断流后必须可通过 snapshot + `realtimeSequence` 恢复。

## 8. 建议与反建议

### 建议

- **采用 modern MCP 的设计原则，但不把 SDK 升级列为 Canvas MVP 前置条件。** 显式 `canvasId`、selection bundle、job id、每请求 capability 和无连接隐式状态都应立即采用。
- **Canvas Command API 是唯一权威写边界。** MCP/CLI/Human API/后台 job 都调用它。
- **保留 Kith turn-scoped capability。** 它负责真实 Agent 身份、Space/Canvas ACL、scope、过期与撤权。
- **复用 Kith 现有幂等和 CAS 模式。** 为 Canvas 抽出可维护的 command ledger，而不是把所有逻辑继续堆进 `CapabilityGateway` 大文件。
- **MVP 用 optimistic concurrency + SQLite transaction。** 先解决可观测冲突，不为“可能多人实时协同”直接引入 CRDT。
- **长生成任务使用 durable job capability。** 不维持 turn 或 MCP connection 到任务完成。
- **未来对外 MCP endpoint 优先 modern 2026，但 server 保持 dual era。** 兼容性由真实 runtime/host smoke 决定。

### 反建议

- 不要把 Recombyn 的原生 Agent tool 直接连到其内部 Canvas state 并绕过 Kith Gateway；应把 tool 语义映射到 Kith Canvas Command API。
- 不要把 MCP `clientInfo` 当 Agent 身份或权限来源。
- 不要用 `Mcp-Session-Id`、stdio process、HTTP connection 或 SSE stream 表示当前 Canvas/当前话题/当前操作者。
- 不要认为 modern MCP 已提供 idempotency、事务、revision 或 conflict resolution。
- 不要为了“无状态”把所有 Canvas snapshot 塞进每次 MCP 请求；请求应带 opaque `canvasId` / bundle id，服务端按权限读取 authoritative state。
- 不要在 Canvas MVP 同时迁移 SDK v2、改全部 runtime MCP 配置、增加公开 HTTP endpoint和重做 Agent Harness；这些是可独立验收的高风险切片。
- 不要把 `subscriptions/listen` 当实时协作数据库；通知可丢/断流，事实仍在 Canvas store 与 command log。

## 9. 迁移与实现风险

| 风险 | 具体表现 | 缓解 |
|---|---|---|
| SDK 1.x -> 2.x breaking boundary | 拆包、import、schema/Zod、transport API 和 nominal object 边界变化 | 独立切片、官方 codemod、全量 typecheck/测试 |
| runtime host 不支持 modern era | Agent runtime 无法完成 discover 或错误处理新 wire shape | dual era；逐 runtime smoke；不 pin modern |
| 把 Kith capability 误删为“session” | 失去可信 agent/turn/scope/expiry 绑定 | 明确重命名与分层；保留应用 capability |
| 并发覆盖 | 两个 Agent 同时改同一元素，后写静默覆盖 | per-element CAS；结构化 conflict；重新读取后重试 |
| 重复外部副作用 | MCP/HTTP retry 重复生图、导入、插入元素 | durable command/job idempotency + reconciliation |
| 长任务越权回写 | turn 结束或权限变化后 job 仍写入 Canvas | 独立 job capability；完成时重新授权和 CAS |
| 多实例“假无状态” | transport 可 round-robin，但内存 idempotency/event bus/job state 不共享 | 上多实例前外置/持久化所有应用状态 |
| 双代际差异 | structured result、取消、notification、MRTR 行为不同 | protocol-era contract tests；adapter 内归一化 |
| HTTP 本地攻击面 | DNS rebinding、Origin 绕过、LAN 未授权访问 | loopback 默认、Origin 校验、认证、header/body 一致性校验 |
| 高频画布事件淹没 Agent | pointer/move/presence 都进入 durable turn/context | ephemeral 与 durable command 分流；批量/节流；只对语义提交建事件 |

## 10. 对后续 Canvas 方案文档的直接输入

后续规格应明确写下这些不可混淆的决策：

1. **MVP 主协议**：Kith Canvas Command API；MCP 是 Agent adapter，不是 Canvas 数据模型。
2. **MCP 版本策略**：MVP 允许当前基于 `@modelcontextprotocol/sdk` 1.x 的 legacy-compatible stdio；SDK v2 + dual-era/modern 支持为独立兼容性切片；对外 endpoint 才以 `2026-07-28` 为首选。
3. **身份策略**：Human/Agent/job principal 由 Kith 创建；Canvas grant 从 bound delivery + explicit executor binding 派生，MCP `clientInfo` 只用于显示/日志。
4. **状态策略**：所有跨请求状态通过显式 `canvasId`、element revision、selection bundle id、job id 表达；不依赖连接。
5. **并发策略**：MVP optimistic concurrency；metadata/document/element/Frame/structure revisions + 服务端派生影响集 + atomic batch；临时 presence 可 LWW。
6. **幂等策略**：Agent 沿用 `(turnId, toolName, key)`，Human 使用独立 client command 域；同 key 同请求 replay，同 key 不同请求拒绝；外部副作用可 reconcile。
7. **后台策略**：Kith durable job/turn 是权威；MCP Tasks 只作为外部互操作层。
8. **通知策略**：Kith realtime / 可选 `subscriptions/listen` 都是 delivery，不是事实源；客户端可从 snapshot + operation sequence 恢复。
9. **移植策略**：保留 Recombyn Canvas UI/engine 的可移植部分，但把其 Agent 写操作收口到 Kith command boundary，禁止并列的第二套事实源。

## 11. 一手来源索引

### MCP 正式规范与官方公告

- [The 2026-07-28 Specification（官方 GA 公告）](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [2026-07-28 Specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [Base Protocol / Statelessness / `_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic)
- [Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
- [Server Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Tools / Stateful Tools / Security](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

### 被纳入正式版本的官方 SEP

- [SEP-2575: Make MCP Stateless](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2575)
- [SEP-2567: Sessionless MCP via Explicit State Handles](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2567)
- [SEP-2322: Multi Round-Trip Requests](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2322)
- [SEP-2243: HTTP Standardization](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2243)

### 官方 TypeScript SDK

- [TypeScript SDK repository / v2 status](https://github.com/modelcontextprotocol/typescript-sdk)
- [TypeScript SDK v2 Protocol versions](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions)
- [Upgrading v1.x to v2](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [Supporting protocol revision 2026-07-28](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)

### Kith 当前源码证据

- `package.json:116` — 当前 `@modelcontextprotocol/sdk ^1.29.0`
- `src/server/mcp/stdio.ts:1-120` — stdio MCP adapter，工具调用转发到 Gateway
- `src/capabilities/gatewayClient.ts:15-83` — broker capability headers 与 loopback client
- `src/server/turn-gateway/routes.ts:37-67` — activation、scope、session generation、surface ACL 校验
- `src/capabilities/contracts.ts:3-20` — turn capability claims
- `src/capabilities/sessionCapabilityBroker.ts:18-163` — handle、activation、generation、expiry 与撤销
- `src/capabilities/capabilityGateway.ts:52-61` — MCP/CLI 共享 use-case module
- `src/capabilities/capabilityGateway.ts:515-637` — transaction、idempotency、external reconciliation
- `docs/kith-space/agent-harness-v2-mechanisms.md:220-260` — Kith runtime session/generation 与资源边界
- `docs/superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md:647-694` — durable admission、公平、幂等与 Agent 串行约束
