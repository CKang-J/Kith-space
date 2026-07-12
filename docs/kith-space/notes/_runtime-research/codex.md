# OpenAI Codex CLI runtime 对接调研

> 调研日期：2026-07-10  
> 范围：仅 OpenAI Codex CLI、Codex SDK 与 `codex app-server`；不涉及其他 runtime，也不讨论自研 agent loop。  
> 本地基线：只读 `reference/open-tag/src/daemon/codexRuntime.ts`、`reference/open-tag/src/daemon/runtime.ts` 与 `docs/kith-space/notes/runtime-adapters-current-state.md`。  
> 证据口径：产品能力以 OpenAI 官方最新文档为主；公开文档未给出精确 wire shape 时，补充引用 OpenAI 官方 `openai/codex` 仓库的当前协议源码。每条外部结论均标注“已证实 / 部分已证实 / 未证实”与查阅日期。

> 2026-07-12 落地注记：Codex 的 Windows npm shim 已与其他 runtime 一样经过统一 `cross-spawn` 边界启动；app-server stdout/stderr 现由该边界做有状态 UTF-8 解码，跨数据块的中文 JSON-RPC fixture 已回归覆盖。Windows agent CLI 只保留 `.cmd` wrapper，system prompt 明确使用 PowerShell 和 UTF-8 stdin。usage、MCP bootstrap、版本 schema 与审批策略仍属于后续 Runtime 契约 v2，本次验收修复没有提前宣称完成。

## 结论摘要

Kith-space 当前选择 `codex app-server --listen stdio://` 的总体方向是对的。OpenAI 现在明确把 app-server 定位为“把 Codex 深度嵌入自己的产品”时使用的接口，覆盖认证、会话历史、审批和流式 agent 事件；`codex exec` 更适合一次性脚本/CI，Codex SDK 更适合不想直接维护 wire protocol 的程序化调用。Kith-space 需要持续多轮、审批接管、完整轨迹、MCP 就绪检查，因此 app-server 比每轮 spawn `codex exec` 更贴合。（已证实；[Codex App Server](https://developers.openai.com/codex/app-server/)、[Codex SDK](https://developers.openai.com/codex/codex-sdk/)、[Non-interactive mode](https://developers.openai.com/codex/noninteractive/)，查阅：2026-07-10）

当前适配器最大的三个实际缺口是：没有消费 `thread/tokenUsage/updated`，没有以 Kith-space 自己的启动输入注入并强制校验 MCP server，以及权限请求仍被统一“自动 accept”。其中 usage 已经不是“官方没提供”：当前 v2 app-server 明确发 usage 通知，官方协议源码还定义了 input、cached input、output、reasoning output 和 total token；现状只是 parser 与公共 runtime 契约把它丢掉了。（已证实；[Codex App Server：events](https://developers.openai.com/codex/app-server/)、[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）`reference/open-tag/src/daemon/codexRuntime.ts:77-113`、`reference/open-tag/src/daemon/runtime.ts:5-18`

另一个必须尽快修正的兼容性判断是：官方当前 wire protocol 是“省略 `jsonrpc: "2.0"` 头的 JSON-RPC 2.0 风格消息”，主事件面是 v2 typed notifications；app-server 命令本身仍标 Experimental，并允许按本机安装版本生成精确 TypeScript/JSON Schema。适配器不应长期依靠手写的 raw/legacy method 猜测集合，而应把“CLI 版本 + 该版本生成 schema + 真实 fixture”绑定成兼容基线。（已证实；[Codex App Server：protocol and schema](https://developers.openai.com/codex/app-server/)、[CLI reference：app-server](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）

## A. 无头调用 / 协议

### 我们需要什么

需要一个能由 daemon 无 UI 启动、可长期双向通信、能显式管理 thread/turn、能承接审批和流式事件的入口；同时要区分“一次性自动化”和“嵌入产品的 runtime 协议”，避免只因 `codex exec` 更简单就失去长连接与审批能力。

### 官方最新怎么提供

- `codex exec` 是稳定的非交互入口，面向脚本、CI、管道和一次性任务；普通模式把进度写到 stderr、最终 agent message 写到 stdout，`--json` 后改为 JSONL 事件流。（已证实；[Non-interactive mode](https://developers.openai.com/codex/noninteractive/)、[CLI reference](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）
- Codex SDK 是官方的程序化封装。TypeScript SDK 被描述为比非交互模式更全面灵活；Python SDK直接通过 JSON-RPC 控制本地 app-server，但发布包默认带固定版本的 Codex CLI runtime，只有显式传 `codex_bin` 才使用指定本地 executable。（已证实；[Codex SDK](https://developers.openai.com/codex/codex-sdk/)，查阅：2026-07-10）
- `codex app-server` 是官方给“深度嵌入自己的产品”使用的接口，覆盖 authentication、conversation history、approvals 和 streamed agent events；文档同时说纯 job/CI 自动化优先用 SDK。（已证实；[Codex App Server](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- app-server 的 stdio transport 是默认项，`--listen stdio://` 明确使用逐行 JSON（JSONL）；协议语义是双向 JSON-RPC 2.0，但官方 wire 示例省略 `"jsonrpc":"2.0"` 头。WebSocket transport 仍是 experimental/unsupported，Kith-space 本机 daemon 没必要为它承担额外风险。（已证实；[Codex App Server：protocol](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- app-server 的主抽象是 Thread → Turn → Item。连接必须先 `initialize` / `initialized`，再 `thread/start` 或 `thread/resume`，每条业务消息通过 `turn/start`，进度从通知流读取。（已证实；[Codex App Server：lifecycle](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

### 本地适配器现状

当前 spawn `codex app-server --listen stdio://`，以 stdin/stdout 逐行收发 JSON，并自己维护 request id、pending map 与 notification 分发。`reference/open-tag/src/daemon/codexRuntime.ts:26-62`、`reference/open-tag/src/daemon/codexRuntime.ts:128-138`

每条写出的消息都带 `jsonrpc: "2.0"`；这与官方当前“wire 上省略该头”的示例不一致。现有 CLI 是否始终容忍多余字段没有被本地 fixture 证明。`reference/open-tag/src/daemon/codexRuntime.ts:41-50`

### 差距与建议

继续以 app-server 为 Codex adapter 主路径，不改成每轮 `codex exec`。`exec --json` 可保留为低成本 smoke/降级研究样本，但不能替代需要长连接、审批接管与 MCP 状态的主 adapter。

wire writer 应跟随当前生成 schema，默认不发送 `jsonrpc` 字段；如果为了兼容旧版本保留它，必须由版本 fixture 证明旧/新 CLI 都接受，而不是凭经验。parser 继续按 JSONL framing 处理，但要把 JSON parse 失败、尾行无换行、超长行与 stdin write error 纳入显式错误契约。

不建议现在直接切 Codex SDK：TypeScript SDK更方便但主要适合官方抽象允许的控制面；Python SDK 默认固定 runtime 又与“复用用户本机 CLI”目标相冲突。可以做独立 spike 比较 SDK 是否覆盖 developer instructions、MCP bootstrap、审批和 usage，但主实现目前仍应是 app-server v2。（“SDK 是否完整覆盖 Kith-space 所需控制面”未证实；[Codex SDK](https://developers.openai.com/codex/codex-sdk/)，查阅：2026-07-10）

## B. 可解析输出

### 我们需要什么

需要可靠拿到 agent text、reasoning/thinking、tool 调用、命令输出与结构化 turn error；P1 token 护栏还需要每轮可归属、可去重的 input/output/cache/reasoning token，不能从轨迹文本估算。

### 官方最新怎么提供

- v2 item lifecycle 是 `item/started` → 零到多个 delta → `item/completed`，其中 completed item 是权威最终状态。常见 item 包括 `agentMessage`、`plan`、`reasoning`、`commandExecution`、`fileChange`、`mcpToolCall`、`webSearch`、`contextCompaction` 等。（已证实；[Codex App Server：items](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- agent text 可从 `item/agentMessage/delta` 流式取得，最终完整文本在 `item/completed` 的 `agentMessage.text`；reasoning 有 summary delta、summary part boundary、可选 raw reasoning text delta，最终 reasoning item 含 `summary` 与 `content`。raw reasoning 是否存在依模型而定，不能作为控制流条件。（已证实；[Codex App Server：item deltas](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- turn 失败时先发 `error`，随后仍以 `turn/completed` 且 `turn.status = "failed"` 收束；错误可含 `ContextWindowExceeded`、`UsageLimitExceeded`、HTTP/stream/sandbox/auth 等分类与可选 HTTP status。（已证实；[Codex App Server：errors](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- app-server v2 有独立 `thread/tokenUsage/updated`。官方协议源码的当前 wire shape 是 `{threadId, turnId, tokenUsage}`；`tokenUsage` 含 `total`、`last`、`modelContextWindow`，两组 breakdown 都含 `totalTokens`、`inputTokens`、`cachedInputTokens`、`outputTokens`、`reasoningOutputTokens`。（已证实；[Codex App Server：turn events](https://developers.openai.com/codex/app-server/)、[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）
- `codex exec --json` 的 `turn.completed.usage` 也明确包含 `input_tokens`、`cached_input_tokens`、`output_tokens`、`reasoning_output_tokens`，说明官方非交互层已经把“一轮 usage”当成稳定可消费数据。（已证实；[Non-interactive mode：JSONL output](https://developers.openai.com/codex/noninteractive/)，查阅：2026-07-10）
- `account/usage/read` 是 ChatGPT 账号级 lifetime/daily token 活动摘要，不是某一 Kith task/turn 的结算数据，也不支持 API-key-only/Bedrock auth；不能拿它做 P1 task budget。（已证实；[Codex App Server：account usage](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- 官方文档没有明确承诺 `tokenUsage.last` 在一个包含多次模型调用、tool loop 或 compaction 的 turn 中等于“整轮新增用量”；准确语义应以生成 schema、真实事件序列和累计值差分验证。（部分已证实；字段已证实，整轮结算语义未证实；[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）

### 本地适配器现状

raw 分支能映射最终 agentMessage/plan、reasoning 与 tool item，主动忽略 text/reasoning delta 和 command output delta，以免当前 UI 每个 delta 建一行。`reference/open-tag/src/daemon/codexRuntime.ts:87-113`

legacy 分支只处理 `task_started`、`agent_message`、`exec_command_begin`、`patch_apply_begin`、`task_complete`、`turn_aborted`。`reference/open-tag/src/daemon/codexRuntime.ts:116-125`

parser 完全没有处理 `thread/tokenUsage/updated`，公共 `TrajectoryEntry` / `RuntimeCallbacks` 也没有 usage、turn id 或正式 turn result。`reference/open-tag/src/daemon/runtime.ts:5-18`；现状文档已指出 token 护栏的数据契约缺口。`docs/kith-space/notes/runtime-adapters-current-state.md:273-277`

`error` 分支在 `willRetry` 为假时会直接调用内部 `onTurnDone(false)`，随后官方仍应发送的 `turn/completed(failed)` 可能再次触发完成；当前代码没有 once guard，也没有把结构化错误带给上层。`reference/open-tag/src/daemon/codexRuntime.ts:90-113`

### 差距与建议

先扩公共契约，再做 P1 token budget。建议新增结构化 `onTurnCompleted`（或等价事件），至少带 runtime、thread id、turn id、status、error 分类，以及 input/cached input/output/reasoning/total token。不要把 usage 塞进 UI trajectory。

app-server 下以 `thread/tokenUsage/updated.tokenUsage.total` 在 turn 前后的差值做候选结算值，并以通知自身的 `turnId` 归属；同时保存 `last` 供诊断。必须用真实 fixture 覆盖“一轮多次模型调用、MCP tool loop、compaction、resume 后首个恢复 usage 事件”，确认差分不会重复或回退后再定 P1 口径。`exec --json` 的 `turn.completed.usage` 可作为对照 oracle，但两条协议字段不应未经验证直接等同。

`error` 只上报中间失败信息，不结束 queue；唯一业务终态应由对应 `turn/completed` 决定。给每个 turn id 加一次性完成 guard，failed/interrupted/completed 分开回调。

继续让 completed item 做 trajectory 权威来源，delta 在 UI 支持聚合前可忽略；但 command/MCP item 应保留结构化 tool name、input 摘要、status 和 error，避免所有非用户 item 只按 `item.type` 粗略显示。

## C. 会话延续

### 我们需要什么

需要跨轮保持上下文、daemon 重启后按明确 id 恢复、避免“最近会话”猜测；还要决定一个 app-server 是每轮 spawn、每 agent 常驻，还是全 daemon 共享。

### 官方最新怎么提供

- Thread 是持久会话，包含多个 Turn；`thread/start` 创建并自动订阅事件，`thread/resume` 按此前保存的 `thread.id` 恢复，`thread/fork` 分叉成新 thread。（已证实；[Codex App Server：threads](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- thread/start/resume 返回完整 `thread`；`thread.id` 用于以后 resume。`thread.sessionId` 表示当前 live session tree 的根，fork 后可能与 thread id 不同，因此不能把两者混为一谈。（已证实；[Codex App Server：start or resume](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- resume 可以带与 start 相同的模型、cwd、developer instructions、sandbox/config overrides；若换模型，Codex 会告警并在下一轮加入一次性 model-switch instruction。（已证实；[Codex App Server：resume](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- `codex exec` 也支持 `codex exec resume <SESSION_ID>` 与 `--last`，但 `--last` 默认按 cwd 找最近会话；Kith-space 应持久化精确 id，不用最近会话选择。（已证实；[Non-interactive mode：resume](https://developers.openai.com/codex/noninteractive/)、[CLI reference：exec resume](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）
- 同一 app-server 连接可加载和订阅多个 thread，且有 `thread/loaded/list`、`thread/status/changed` 与 unsubscribe/idle unload；官方没有要求“一 thread 一进程”。（已证实；[Codex App Server：thread management](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

### 本地适配器现状

有 session id 时先 `thread/resume`；失败后 warn 并回退 `thread/start`，成功后用 `onSession(threadId)` 持久化。`reference/open-tag/src/daemon/codexRuntime.ts:167-180`

每个 `Runtime.start` 创建一个持续 app-server，内部 queue 保证同一 thread 的 turn 串行；`deliver()` 不会每轮 spawn 新进程。`reference/open-tag/src/daemon/codexRuntime.ts:128-159`、`reference/open-tag/src/daemon/codexRuntime.ts:199`

thread id 提取兼容 `threadId`、`thread.id`、`thread_id`、`id` 四种形态，但没有保存或区分 `thread.sessionId`。`reference/open-tag/src/daemon/codexRuntime.ts:10-12`

### 差距与建议

保持“每个活动 agent/session 一个常驻 app-server + 一个活动 thread”的现状，至少在 v1 不做全 daemon 共享；这让 cwd、env、审批状态、MCP 凭证和故障域更清楚。跨进程恢复仍靠 `thread.id`，不是依赖同一 app-server 永远不退出。

把持久字段明确命名为 `threadId`，不要泛称 session id；若未来用 fork/子 agent，再另存 `sessionId`/parent relationship。恢复失败自动新建可以保留，但必须产生显式“stale thread replaced”事件并立即保存新 id，避免用户以为原历史仍在延续。

resume 后可能立即回放已持久化的 `thread/tokenUsage/updated`；usage 结算器必须在第一条新业务 turn 前建立基线，不能把恢复历史累计量记到当前 task。（已证实；[OpenAI app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)，查阅：2026-07-10）

## D. 身份 / 系统提示注入

### 我们需要什么

daemon 要稳定注入 agent 身份、职责、standing instructions 与 Kith-space 协作协议，同时尽量保留 Codex 自带的 coding-agent 基础能力，不依赖修改用户全局配置或工作区 `AGENTS.md`。

### 官方最新怎么提供

- Codex 配置有 `developer_instructions`，官方定义为注入 session 的额外 developer instructions。（已证实；[Configuration Reference](https://developers.openai.com/codex/config-reference/)，查阅：2026-07-10）
- 当前 v2 协议的 `thread/start`、`thread/resume` 和 `thread/fork` 都有 top-level `developerInstructions` 与 `baseInstructions`；字段在 Rust 源码中用 snake_case 定义，v2 wire 因 `rename_all = "camelCase"` 变为 camelCase。（已证实；[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）
- `developerInstructions` 是附加的 developer-role 指令入口；`baseInstructions` 是替代基础 instructions 的更强入口。Kith-space 只需身份/协作层时应优先 developer instructions，不应无意替换 Codex 内建基础 prompt。（developer instructions 注入已证实；base instructions 的完整替换边界公开文档未充分展开，部分未证实；[Codex MCP Server](https://developers.openai.com/codex/mcp-server/)、[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）
- start/resume 响应还会返回 `instructionSources`，列出加载的 instruction 文件绝对路径，可用来审计 agent 最终还继承了哪些项目/用户指令。（已证实；[Codex App Server：start/resume](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

### 本地适配器现状

新建和恢复 thread 都把 `opts.systemPrompt` 放到 top-level `developerInstructions`，符合当前 v2 wire 字段；公共接口也明确把 Codex 的 systemPrompt 注入点定义为 developerInstructions。`reference/open-tag/src/daemon/codexRuntime.ts:167-175`、`reference/open-tag/src/daemon/runtime.ts:20-27`

适配器没有读取 start/resume 响应中的 `instructionSources`，也没有记录实际 model/cwd/approval/sandbox/reasoningEffort 响应值。`reference/open-tag/src/daemon/codexRuntime.ts:167-180`

### 差距与建议

保留 top-level `developerInstructions` 方案，不改成写 `AGENTS.md`，也不使用 `baseInstructions` 覆盖默认基础 prompt。system prompt 应由上层按身份、职责、工具协议分段生成，但 adapter 只负责原样注入。

把 start/resume response 解析为 ready 元数据：至少记录 thread id、实际 model、reasoning effort、cwd、approval policy、sandbox/permission profile、`instructionSources`。若实际加载了非预期用户/项目 instructions，日志和 UI 应可诊断。

身份变更后继续旧 thread 是否应该重写 developer instructions，需要产品语义明确。技术上 resume 支持覆盖，但历史中的旧身份消息仍可能保留；若角色根本变化，默认新 thread 更可预测。（“覆盖后历史身份的具体优先级”未证实；[Codex App Server](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

## E. 模型与推理强度

### 我们需要什么

需要按 agent 配模型与 reasoning effort，知道请求值是否受当前模型支持，并记录实际生效值；不能把一份静态 effort 白名单永久写死。

### 官方最新怎么提供

- `thread/start`/resume 可指定 `model`；`turn/start` 也可覆盖 model、effort、summary 等，并且这些 turn override 会成为后续 turn 的默认值。（已证实；[Codex App Server：turn/start](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- `model/list` 返回当前安装/账号可用模型，以及 `defaultReasoningEffort`、`supportedReasoningEfforts`、是否默认、输入模态和 personality 支持；这是客户端构建模型/effort 选择器的权威发现入口。（已证实；[Codex App Server：model/list](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- 当前公开配置 reference 把 `model_reasoning_effort` 列为 `minimal | low | medium | high | xhigh`，并说明 `xhigh` 取决于模型。官方协议源码的底层枚举可能包含额外兼容值，因此客户端仍应以 `model/list.supportedReasoningEfforts` 为准。（已证实；[Configuration Reference](https://developers.openai.com/codex/config-reference/)、[Codex App Server：model/list](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- start/resume response 会返回实际 `model` 和 `reasoningEffort`，可用于验证请求是否生效。（已证实；[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）

### 本地适配器现状

模型通过 start/resume 的 top-level `model` 传入；effort 同时在线程 config 里写 `model_reasoning_effort`，又在每次 `turn/start` 传 `effort`。`reference/open-tag/src/daemon/codexRuntime.ts:13-24`、`reference/open-tag/src/daemon/codexRuntime.ts:166-175`

effort 白名单硬编码为 `none | minimal | low | medium | high | xhigh`，没有请求 `model/list`，也没有读取 start/resume 返回的实际 effort。`reference/open-tag/src/daemon/codexRuntime.ts:9-24`

### 差距与建议

adapter 启动后调用一次 `model/list`，按目标 model 的 `supportedReasoningEfforts` 校验；未知或不支持值明确回退到模型默认并记录 warning。不要让静态 Set 成为产品能力来源。

选择一个主注入层：thread start/resume 传初始 model 与 `config.model_reasoning_effort`，后续只有用户确实动态修改时才在 `turn/start` 覆盖。当前每轮重复传 effort 虽合法，但会掩盖“恢复 thread 沿用旧配置”与“本轮主动变更”的区别。

ready 回调应携带实际 model/effort；usage 也应按实际 model 归属。模型别名/目录会随 CLI 更新，若任务要求完全可复现，应连同 CLI 版本和返回 model id 一起记录。

## F. 无人值守权限

### 我们需要什么

需要在无人值守时没有悬空 prompt，同时把“是否询问”和“实际能访问什么”分开：approval policy 决定是否请求批准，sandbox/permission profile 决定文件系统和网络边界。未来还要能把危险请求交给 Kith-space 审批 UI，而不是永久全放行。

### 官方最新怎么提供

- CLI/app-server 的 approval policy 支持 `untrusted`、`on-request`、`never`；当前配置还支持 granular policy，分别控制 sandbox escalation、rules、MCP elicitations、request_permissions、skill approval 是否可弹出。`on-failure` 已弃用。（已证实；[Configuration Reference](https://developers.openai.com/codex/config-reference/)、[CLI reference](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）
- 官方当前资料存在一个需按版本 schema 处理的命名冲突：app-server 的 turn 示例仍写 `approvalPolicy: "unlessTrusted"`，而最新配置 reference 与 v2 源码 wire rename 使用 `untrusted`。不能把其中任一个值硬编码成跨版本常量；应以本机 `generate-json-schema` 为准。（冲突已证实；[Codex App Server：turn/start](https://developers.openai.com/codex/app-server/)、[Configuration Reference](https://developers.openai.com/codex/config-reference/)、[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）
- sandbox 模式是 `read-only | workspace-write | danger-full-access`；官方明确建议无人值守本地工作优先 workspace-write，只有外部硬化环境才使用 bypass/full access。（已证实；[CLI reference：safety tips](https://developers.openai.com/codex/cli/reference/)、[Non-interactive mode：permissions](https://developers.openai.com/codex/noninteractive/)，查阅：2026-07-10）
- app-server 可以在 thread/start 或 turn/start 设置 approval/sandbox；当前 beta 还可选择 named permission profile，但不应同时发送 legacy sandbox 与 permissions。（已证实；[Codex App Server：thread/start and turn/start](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- command/file approval 是 server→client request。当前 command decision 支持 `accept`、`acceptForSession`、`decline`、`cancel` 和 execpolicy amendment；file decision 支持前四项。（已证实；[Codex App Server：approvals](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- `item/permissions/requestApproval` 不是普通 decision：客户端必须返回所请求 network/filesystem permissions 的子集，并可用 `scope: "turn" | "session"`；未请求的权限会被忽略。（已证实；[Codex App Server：permission requests](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- MCP elicitation 必须按 form/url request 返回 `accept + content`、`decline` 或 `cancel`；无内容自动 accept 不一定满足 schema。（已证实；[Codex App Server：MCP elicitation](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

### 本地适配器现状

没有显式设置 approval policy 或 sandbox，因而先继承用户 config；一旦收到 command/file/permission request，又统一返回 `{decision: "accept"}`。`reference/open-tag/src/daemon/codexRuntime.ts:64-74`、`reference/open-tag/src/daemon/codexRuntime.ts:167-175`

MCP elicitation 统一返回 `{action: "accept", content: null, _meta: null}`；未知 request 直接 `-32601`。`reference/open-tag/src/daemon/codexRuntime.ts:64-74`

### 差距与建议

当前 `item/permissions/requestApproval` 的 response shape 已不符合官方最新协议，是确定性 bug，不只是安全偏好。必须拆成 command、file、permissions、MCP elicitation、user input 五类 handler，并按 request id/thread id/turn id 做审计与超时。

v1 若继续既定“本机可信内容下无人值守”，建议显式设置 `approvalPolicy: "never"`，同时用 `workspaceWrite` 或 Kith permission profile 限定资源，而不是“继承任意用户 policy + 收到什么都 accept”。`never` 负责不弹 prompt，sandbox 才负责能力边界。

需要更高权限时提供明确的 Kith full-access 档，并在 UI/日志显示实际 sandbox；不要把 `dangerFullAccess` 当默认。未来接审批 UI 时，改为 `on-request`/granular，并把 current request details 原样上送；不要用 `acceptForSession` 扩权，除非用户明确选择 session scope。

MCP elicitation v1 默认应 decline/cancel，或只对 Kith 自己定义且能自动填写的 schema 生成有效 content；`accept + null` 不能作为通用策略。

## G. MCP server 接入

### 我们需要什么

daemon 每次启动 Codex runtime 时都要显式注册 Kith-space MCP server、注入短期凭证、限制可见工具，并在第一条业务 turn 前确认 server ready。不能要求用户预先改全局 `~/.codex/config.toml`，也不能污染项目 `.codex/config.toml`。

### 官方最新怎么提供

- Codex 支持本地 stdio MCP 与 Streamable HTTP MCP。stdio 配置含 `command`、`args`、`env`、`env_vars`、`cwd`；HTTP 配置含 `url`、bearer token env、static/env headers 与 OAuth。（已证实；[Codex MCP](https://developers.openai.com/codex/mcp/)，查阅：2026-07-10）
- 持久配置位于 `config.toml` 的 `[mcp_servers.<name>]`；默认用户文件是 `~/.codex/config.toml`，可信项目也可用 `.codex/config.toml`。`codex mcp add` 会配置持久 server，适合用户手工设置，不适合 Kith 每次 spawn 的临时注入。（已证实；[Codex MCP：connect](https://developers.openai.com/codex/mcp/)，查阅：2026-07-10）
- MCP server 支持 `required = true`，初始化失败时 thread/start/resume 或 `codex exec` 直接失败；还有 `enabled_tools`、`disabled_tools`、server/tool approval mode、startup/tool timeout。（已证实；[Codex MCP：configuration](https://developers.openai.com/codex/mcp/)、[Codex App Server：start/resume](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- app-server 会发 `mcpServer/startupStatus/updated`，状态为 starting/ready/failed/cancelled，并提供 `mcpServerStatus/list` 查看 server、tools、resources 与 auth status。（已证实；[Codex App Server：MCP status](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- CLI `-c key=value` / `--config` 是最高优先级的一次性 override，并适用于 app-server 这类 runtime command；dot notation 可设置任意嵌套 key，官方示例直接使用 `mcp_servers.context7.enabled=false`。因此可以在 spawn argv 中用 `mcp_servers.kith.*` 注册 server，而不写用户文件；复杂 TOML quoting 仍需按平台测试。（已证实；[Config basics：precedence](https://developers.openai.com/codex/config-basic/)、[Advanced Configuration：one-off overrides](https://developers.openai.com/codex/config-advanced/)、[CLI reference：global flags](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）
- 当前 v2 thread/start/resume 的 `config` 是通用配置 override map，协议源码也保留未知 config key；但公开产品文档没有直接给“在 thread/start.config 内动态新增完整 MCP server”的示例。把 MCP server 全量塞进该字段是否跨版本稳定，未证实。（部分已证实；[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)、[Codex App Server](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

### 本地适配器现状

`StartOpts` 没有 MCP server 描述；Codex spawn 也没有 `-c mcp_servers...`，thread config 只放 reasoning effort。`reference/open-tag/src/daemon/runtime.ts:20-28`、`reference/open-tag/src/daemon/codexRuntime.ts:17-24`、`reference/open-tag/src/daemon/codexRuntime.ts:134-175`

源码明确不覆盖 `CODEX_HOME`，复用用户默认 `~/.codex`；注释把 per-agent CODEX_HOME isolation + auth/MCP injection 留作未来改进。`reference/open-tag/src/daemon/codexRuntime.ts:131-137`

parser 没有处理 MCP startup status，也不会在 thread ready 后调用 `mcpServerStatus/list`。现状文档已确认三条 runtime 都没有结构化 MCP bootstrap。`docs/kith-space/notes/runtime-adapters-current-state.md:267-271`、`docs/kith-space/notes/runtime-adapters-current-state.md:295-304`

### 差距与建议

给 `StartOpts` 增加 runtime-neutral `mcpServers` 描述，Codex adapter 首选在 spawn 时翻译成一组 session-only `-c mcp_servers.kith.*` 参数：stdio 用 command/args/env-vars，HTTP 用 url + bearer-token env/header；设 `required=true`、精确 `enabled_tools`、合理 startup/tool timeout。凭证只放专用 env，不放 argv 明文值、prompt 或项目文件。

不调用 `codex mcp add`，因为它会修改用户持久配置。也不把 Kith MCP 写入项目 `.codex/config.toml`。thread/start.config 动态注入可作为真实 CLI spike，但在官方给出明确示例或 fixture 验证前不要把它当唯一稳定入口。

ready 闸门应是：initialize 成功 → thread start/resume 成功（`required=true` 已保证必需 MCP 没有初始化失败）→ 再用 `mcpServerStatus/list(threadId)` 确认 `kith` 存在、ready、工具集合符合预期。失败则不投递 `initialPrompt`。

复用用户 `CODEX_HOME` 时，session-only override 只保证 Kith server 被加入，不会自动排除用户已有 MCP。若要求“只允许 Kith MCP”，官方没有等价于 Claude `--strict-mcp-config` 的已证实 app-server flag；需要用独立 CODEX_HOME，或通过 managed requirements/明确的工具暴露策略实现。完整的“忽略所有用户 MCP但复用其登录”方案目前未证实。（未证实；[Codex MCP](https://developers.openai.com/codex/mcp/)、[Environment variables](https://developers.openai.com/codex/environment-variables/)，查阅：2026-07-10）

## H. 运行环境 / 隔离

### 我们需要什么

需要明确 workspace cwd、spawn env、Codex state/auth/session/config、MCP secret 和 sandbox 的边界。复用用户本机登录不能顺带无审计继承所有全局 MCP、hooks、skills、rules 和敏感环境变量。

### 官方最新怎么提供

- `cwd` 可在线程 start/resume 与 turn/start 显式设置；CLI 对应 `-C/--cd`。cwd 还参与项目 `.codex/config.toml` 与 rule/instruction 发现。（已证实；[Codex App Server](https://developers.openai.com/codex/app-server/)、[CLI reference](https://developers.openai.com/codex/cli/reference/)、[Config basics](https://developers.openai.com/codex/config-basic/)，查阅：2026-07-10）
- `CODEX_HOME` 默认 `~/.codex`，覆盖 config、auth、logs、sessions、skills 与 standalone package metadata；设定时目录必须已经存在。`CODEX_SQLITE_HOME` 可单独放 SQLite state。（已证实；[Environment variables](https://developers.openai.com/codex/environment-variables/)，查阅：2026-07-10）
- credentials 可能在 `CODEX_HOME/auth.json`，也可能在 OS credential store；`cli_auth_credentials_store = file | keyring | auto` 决定位置。因此只复制/切换 CODEX_HOME 不保证能复用用户登录。（已证实；[Authentication：credential storage](https://developers.openai.com/codex/auth/)，查阅：2026-07-10）
- 配置优先级是 CLI flags/`-c` > project config > profile > user config > system config > built-in defaults。即使项目 untrusted 而跳过 project `.codex/`，user/system config 仍会加载。（已证实；[Config basics：precedence](https://developers.openai.com/codex/config-basic/)，查阅：2026-07-10）
- `codex exec --ignore-user-config` 可不读 `$CODEX_HOME/config.toml`，但认证仍用 CODEX_HOME。官方当前只在 exec 文档/flag 表中明确它；app-server 是否支持同等 flag 未证实。（部分已证实；[Non-interactive mode](https://developers.openai.com/codex/noninteractive/)、[CLI reference](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）
- `CODEX_API_KEY` 只支持 `codex exec`；app-server/可信自动化可使用 `CODEX_ACCESS_TOKEN`，持久登录则走 auth state。不能假设给 app-server 设置 `CODEX_API_KEY` 就能认证。（已证实；[Environment variables](https://developers.openai.com/codex/environment-variables/)、[Authentication](https://developers.openai.com/codex/auth/)，查阅：2026-07-10）

### 本地适配器现状

spawn 原样使用 `opts.cwd` 与完整 `opts.env`；Windows 额外 `shell: true`。`reference/open-tag/src/daemon/codexRuntime.ts:134-137`

不设置 CODEX_HOME，明确复用用户默认 state/auth，同时也继承其 config、sessions、skills 与 MCP；没有 env allowlist 或对 user/project config 的审计。`reference/open-tag/src/daemon/codexRuntime.ts:131-137`

### 差距与建议

cwd 保持真实 Kith workspace 根，不要为隔离把 cwd 偷换成 agent data dir。runtime state 与 workspace 是两个概念。

明确提供两种运行档：

1. “复用用户 Codex”档：沿用默认 CODEX_HOME 获得本机登录，但通过 session-only `-c` 显式覆盖 model/permission/Kith MCP，并在 ready 元数据中展示加载的 instruction/MCP/config 来源。用户全局能力仍可能进入运行时，必须明示。
2. “Kith 托管隔离”档：Kith 自有 per-agent CODEX_HOME、显式 config/MCP 和独立认证。由于 keyring 与 ChatGPT 登录迁移并不等价于复制目录，这一档需要单独设计 access token/API login bootstrap，不能只设置空目录就宣称可用。（认证产品路径未证实；[Environment variables](https://developers.openai.com/codex/environment-variables/)、[Authentication](https://developers.openai.com/codex/auth/)，查阅：2026-07-10）

spawn env 改成 allowlist/显式合成，至少审计 PATH、HOME/USERPROFILE、CODEX_HOME、CODEX_SQLITE_HOME、代理、OpenAI/Codex credentials 和 Kith MCP 专用 token。MCP stdio child 只得到它自己所需 env。

真正开放邮箱、浏览器等高风险 MCP 前，权限边界必须从当前“自动批准 + 用户全局状态”升级为 workspace sandbox、tool allowlist 与短期凭证；CODEX_HOME 隔离不能替代 OS sandbox。

## I. 生命周期

### 我们需要什么

需要独立建模 transport initialized、thread ready、MCP ready、turn started、turn completed/failed/interrupted、process exited；初始化失败必须产生一次明确终态并清理子进程，不能让逻辑 agent 永久挂在 running map。

### 官方最新怎么提供

- 每个 transport connection 必须先且只 `initialize` 一次，再发 `initialized`；此前 request 会报 `Not initialized`，重复 initialize 会报 `Already initialized`。initialize response 返回 upstream user agent 与 platform 信息。（已证实；[Codex App Server：initialization](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- `thread/start`/resume request 成功返回 thread，并发 `thread/started`；response 可带实际 model、cwd、reasoning effort、approval/sandbox 与 instruction sources。必需 MCP 配 `required=true` 时，MCP 初始化失败会让 start/resume 失败。（已证实；[Codex App Server：start/resume](https://developers.openai.com/codex/app-server/)、[Codex MCP](https://developers.openai.com/codex/mcp/)，查阅：2026-07-10）
- `turn/start` 立即返回 status `inProgress` 的 turn 并发 `turn/started`；业务终态是 `turn/completed`，status 只应是 completed/interrupted/failed，失败附结构化 error。（已证实；[Codex App Server：turn events](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- app-server 有 `thread/status/changed`，可显示 active/waitingOnApproval/idle/systemError 等运行状态；recoverable config 问题走 `configWarning`，非致命问题走 `warning`。（已证实；[Codex App Server：events](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- WebSocket ingress 过载会返回 `-32001 Server overloaded; retry later`，官方要求指数退避加 jitter；stdio 是否同样出现该错误未明确承诺。（部分已证实；[Codex App Server：protocol](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- 官方没有发布 app-server 进程退出码与业务错误的一一映射表。turn 结果应依赖结构化通知，process exit code 只表示 runtime process 生命周期。（未证实；[Codex App Server](https://developers.openai.com/codex/app-server/)、[CLI reference](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）

### 本地适配器现状

初始化顺序正确：request initialize → notify initialized → resume/start thread → 保存 thread id → ready → 入队 initialPrompt。`reference/open-tag/src/daemon/codexRuntime.ts:161-180`

turn queue 以 `turn/completed` 或部分 error/legacy event 释放 busy；没有 turn id 关联和 once guard。`reference/open-tag/src/daemon/codexRuntime.ts:87-125`、`reference/open-tag/src/daemon/codexRuntime.ts:151-159`

spawn error 与 process exit 会 close pending 并经 guard 上报一次 `onExit`；stop 只发 `SIGTERM`。`reference/open-tag/src/daemon/codexRuntime.ts:145-149`、`reference/open-tag/src/daemon/codexRuntime.ts:188-199`

初始化异常或拿不到 thread id 时仅 offline 后 return，没有 kill app-server 或 `onExit`。现状文档已指出逻辑 agent 可能仍留在 running map。`reference/open-tag/src/daemon/codexRuntime.ts:177-185`、`docs/kith-space/notes/runtime-adapters-current-state.md:192-194`、`docs/kith-space/notes/runtime-adapters-current-state.md:287-289`

### 差距与建议

建立明确状态机：`starting -> initialized -> threadReady -> mcpReady -> ready -> busy -> turnCompleted|turnFailed|turnInterrupted -> ready -> stopping -> exited`。`online` 不再同时承担 ready 与 turn-done 两种语义。

init、thread start/resume、MCP ready、turn、graceful stop 分别设置 timeout。任何初始化阶段失败都必须：拒绝队列、关闭 pending、停止 app-server、产生一次明确 runtime exit/failed 终态。修正当前 no-thread/init-error 泄漏不需要先大改公共 Runtime 接口。

以 `turnId` 绑定 started、usage、error、completed；只有 `turn/completed` 释放 busy。`error`、warning、configWarning、MCP status 只更新诊断状态。process `exit` 时若有活动 turn，要先生成 process-level aborted/failed，再上报 exited。

监听 stdin write callback/error，保留有上限的 stderr ring buffer，process exit 前处理 stdout buffer 中无换行尾行。官方没有稳定退出码表，所以日志要同时包含 exit code、signal、最后 RPC error、最后 stderr 摘要。

## J. 版本兼容风险

### 我们需要什么

用户安装的 Codex CLI 会升级；app-server method、experimental field、approval shape 与 notification 名会变化。需要定义最低/最高验证版本、固定真实 fixture、安装后 smoke，而不是只靠 TypeScript 编译通过。

### 官方最新怎么提供

- CLI reference 当前仍把 `codex app-server` 标为 Experimental，并明确“主要用于开发和调试，可能无通知变化”；因此 Kith-space 必须自己承担版本适配层。（已证实；[CLI reference：app-server](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）
- 官方提供 `codex app-server generate-ts --out DIR` 与 `generate-json-schema --out DIR`；输出与执行该命令的 Codex 版本精确匹配。这是最适合构建版本 fixture 的官方能力。（已证实；[Codex App Server：message schema](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- 官方仓库说明所有活跃 app-server API 开发都在 v2，新 surface 不再加到 v1；当前公开文档也只把 `thread/*`、`turn/*`、`item/*` typed notifications 当主事件面。（已证实；[openai/codex AGENTS.md](https://github.com/openai/codex/blob/main/AGENTS.md)、[Codex App Server：events](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- `experimentalApi` 是显式 opt-in；不启用时 experimental method/field 会被拒绝，启用后则接受更多可能变化的 surface。客户端应只依赖真正需要的 experimental 字段。（已证实；[Codex App Server：experimental opt-in](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- 当前 v2 协议仍包含 `experimentalRawEvents` 和 `persistExtendedHistory`，但它们被标为 experimental/internal/richer-history 相关；method descriptor 与 Rust field/JSON 名之间还存在历史命名差异。这些都不能当稳定主协议。（已证实；[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）
- 当前官方 app-server 文档没有把 `codex/event`/`codex/event/*` legacy envelope 列为新客户端主事件协议。旧版本是否仍需它取决于 Kith-space 支持的最低 CLI 版本，不能从最新文档反推。（当前文档缺失已证实；旧版本范围未证实；[Codex App Server](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

### 本地适配器现状

适配器自行探测 `codex/event*` 为 legacy，或 `turn/started`、`turn/completed`、`thread/started`、`item/*` 为所谓 raw，然后只走其中一种。`reference/open-tag/src/daemon/codexRuntime.ts:30-31`、`reference/open-tag/src/daemon/codexRuntime.ts:77-85`

initialize 固定声明 `experimentalApi: true`；thread/start 固定发送 `persistExtendedHistory: true` 与 `experimentalRawEvents: false`。`reference/open-tag/src/daemon/codexRuntime.ts:161-175`

没有读取/记录 CLI 版本，没有生成 schema、能力探测、最低版本 gate 或真实协议 fixture；现状文档已要求固定 Codex raw/legacy 与 approval method 样本。`docs/kith-space/notes/runtime-adapters-current-state.md:310-316`、`docs/kith-space/notes/runtime-adapters-current-state.md:359-361`

### 差距与建议

把当前内部 `raw` 命名改为 `v2`，将 v2 typed notifications 作为主协议；legacy 只在明确支持的旧 CLI 版本范围内启用。不要以“先收到哪种事件”作为永久协议协商，因为并存兼容通知或新事件顺序都可能误判。

启动前记录 `codex --version`，维护已验证区间与最低版本；超出区间可允许带 warning 启动，但 token/MCP/approval 这类关键能力必须通过 capability smoke 才标 ready。不要自动替用户升级 CLI。

固定两层资产：

1. 版本 schema/fixture：对每个受支持基线运行官方 `generate-ts`/`generate-json-schema`，保存 initialize、thread start/resume、MCP ready/fail、text/reasoning/tool、usage、success/failed/interrupted turn、五类 server request、unknown notification、乱 chunk 与尾行无换行样本。
2. 安装后 smoke：低成本只读任务，核对 CLI version、实际 model/effort/cwd、Kith MCP required+ready、一次只读 MCP call、usage、turn completed、进程仍存活、按 thread id resume 第二轮。

若 `persistExtendedHistory` 不是 Kith v1 的验收必需，停止发送它并关闭 broad experimental opt-in，缩小变化面；若确实需要恢复完整 item 历史，则保留 `experimentalApi: true`，但必须把 schema 和最低版本锁定。`experimentalRawEvents: false` 是显式使用 experimental 字段，即使值为 false 也不应被当成“没依赖 experimental”。

## 对我们适配器最关键的 3 条建议

1. **先接正式 usage / turn-result 契约，再实现 P1 token 护栏。** 消费 `thread/tokenUsage/updated`，用 thread/turn id 归属，以累计 total 的 turn 前后差值做候选结算并用真实 fixture 验证；`turn/completed` 是唯一业务终态，`error` 不能提前释放队列。官方已经提供 input/cache/output/reasoning/total token，当前缺口在 adapter 和公共 Runtime 契约。（已证实；[Codex App Server：events](https://developers.openai.com/codex/app-server/)、[官方 v2 协议源码](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2.rs)，查阅：2026-07-10）
2. **把 Kith MCP 做成 spawn 的结构化必填输入和 ready 闸门。** 用 session-only `-c mcp_servers.kith.*` 注入，不调用 `codex mcp add`、不写用户/项目 config；设 `required=true`、tool allowlist、短期 env credential，并在 thread 成功后用 MCP status 验证 server/tool 集合再投递首轮。（可行入口与状态能力已证实；thread/start.config 动态全量注入未证实；[Codex MCP](https://developers.openai.com/codex/mcp/)、[Advanced Configuration](https://developers.openai.com/codex/config-advanced/)、[Codex App Server](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
3. **把权限处理和版本协议一起重做，不再统一 auto-accept。** 显式选择 approval policy + sandbox，按 command/file/permissions/elicitation/user-input 分类型响应；以 v2 typed notifications 为主，记录 CLI 版本，并用官方 per-version schema + fixture + smoke 锁定兼容。当前 permission response shape 已过时，init/no-thread 失败也必须 teardown 并产生明确终态。（已证实；[Codex App Server：approvals and schema](https://developers.openai.com/codex/app-server/)、[CLI reference](https://developers.openai.com/codex/cli/reference/)，查阅：2026-07-10）
