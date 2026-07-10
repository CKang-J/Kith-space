# Claude Code runtime 对接调研

> 调研日期：2026-07-10  
> 范围：仅 Claude Code CLI / Claude Agent SDK；不涉及 Codex、OpenCode，也不讨论自研 agent loop。  
> 本地基线：只读 `reference/open-tag/src/daemon/claudeRuntime.ts`、`reference/open-tag/src/daemon/runtime.ts`、`docs/kith-space/notes/runtime-adapters-current-state.md`。  
> 结论标记：“已证实”表示 Anthropic 官方当前文档明确说明；“未证实”表示官方当前文档没有给出足够稳定的契约。所有外部链接均为 Anthropic 官方文档，查阅日期均写在结论旁。

## 结论摘要

Claude Code 已把 `claude -p` 明确定义为 Agent SDK 的 CLI 形态，`--input-format stream-json` + `--output-format stream-json` 可承载长连接、多轮输入和结构化事件；当前适配器的总体方向是成立的。官方同时把 Python / TypeScript Agent SDK 定位为“完整程序化控制”和“生产自动化”的优先接口，SDK 本质上仍会启动 Claude Code 子进程并通过本地 pipe 通信，因此它是官方协议封装，不是另一个 agent runtime。（已证实；[Programmatic usage](https://code.claude.com/docs/en/headless)、[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)、[Observability](https://code.claude.com/docs/en/agent-sdk/observability)，查阅：2026-07-10）

当前适配器最严重的三个能力缺口不是“能不能启动 Claude”，而是：没有读取 `result.usage`、没有按启动参数注入并校验 Kith-space MCP server、没有把 `result.subtype` 建模为正式的单轮终态。它目前会把任何 `result` 都当作 online，导致 token 预算、MCP 就绪和错误终态都无法可靠实现。`reference/open-tag/src/daemon/claudeRuntime.ts:88-105`；公共接口也没有 usage、MCP 或 turn-done 字段。`reference/open-tag/src/daemon/runtime.ts:5-18`、`reference/open-tag/src/daemon/runtime.ts:20-28`

## A. 无头调用

### 我们需要什么

daemon 要能无 TTY 地启动 Claude Code，首轮与后续轮都能结构化投递；输入不能因 argv 长度或 shell quoting 失真；同时要决定继续维护裸 CLI 协议，还是用官方 Agent SDK 包装同一个 runtime。

### 官方最新怎么提供

- `claude -p` / `--print` 是官方非交互入口；`--output-format` 支持 `text | json | stream-json`，`--input-format` 支持 `text | stream-json`。普通文本既可放 argv，也可从 stdin pipe 输入；从 v2.1.128 起，piped stdin 上限为 10 MB，超限会清晰报错并非零退出。（已证实；[Programmatic usage](https://code.claude.com/docs/en/headless)、[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）
- 官方 Agent SDK 把 streaming input 定义为“默认且推荐”的方式：长生命周期进程可接收队列消息、处理中断、权限请求和多轮上下文。TypeScript 输入为 `string | AsyncIterable<SDKUserMessage>`；官方示例中的用户事件包含 `type: "user"`、`message.role/content` 与 `parent_tool_use_id: null`。（已证实；[Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)，查阅：2026-07-10）
- 官方当前推荐脚本和 SDK 调用加 `--bare`：它跳过 hooks、skills、plugins、MCP 自动发现、auto memory 和 `CLAUDE.md`，只加载显式 flag；官方还说明未来 `-p` 会默认变成 bare。重要代价是 bare 跳过 OAuth 与 keychain，认证必须来自 `ANTHROPIC_API_KEY` 或 `--settings` 中的 `apiKeyHelper`。（已证实；[Programmatic usage：bare mode](https://code.claude.com/docs/en/headless)，查阅：2026-07-10）
- 官方将“one-off task”偏向 CLI，将“custom applications / production automation”偏向 Agent SDK。TypeScript SDK 会捆绑平台对应的 Claude Code 原生二进制，也允许通过 `pathToClaudeCodeExecutable` 指向单独安装的 `claude`；SDK 自身仍是启动 Claude Code 子进程并通过本地 pipe 通信。（已证实；[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)、[Observability](https://code.claude.com/docs/en/agent-sdk/observability)，查阅：2026-07-10）

### 本地适配器现状

`buildClaudeArgs` 固定加入 `-p --output-format stream-json --input-format stream-json --verbose --include-partial-messages`。`reference/open-tag/src/daemon/claudeRuntime.ts:24-35`

适配器用 `spawn("claude", args)` 启动一个 stdin/stdout/stderr 全 pipe 的持续进程；首轮与 `deliver()` 都向 stdin 写 NDJSON user message，没有把 prompt 放 argv。`reference/open-tag/src/daemon/claudeRuntime.ts:59-71`、`reference/open-tag/src/daemon/claudeRuntime.ts:109`

当前手写 user event 没有官方 SDK 示例中的 `parent_tool_use_id: null`，也没有输入队列、busy 状态、背压、write callback 或 stdin 关闭处理。`reference/open-tag/src/daemon/claudeRuntime.ts:67-71`、`reference/open-tag/src/daemon/runtime.ts:30-33`

### 差距与建议

短期可保留裸 CLI 以满足“使用本机已有 runtime”的既定方向，但应把 NDJSON 输入/输出单独封装成版本化协议模块，并把 user event 补齐为官方 `SDKUserMessage` 形状；所有投递先进入 per-session 串行队列，等本轮 `result` 后再驱动下一条。官方说明 streaming input 支持队列并顺序处理，所以这不是另造 agent loop，而是补齐 transport 控制。（已证实；[Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)，查阅：2026-07-10）

同时做一个 TypeScript Agent SDK 适配 spike：比较 `query({ prompt: AsyncIterable, options })` 与当前 raw CLI 的进程控制、取消、MCP、usage 和 session 行为。若采用 SDK，应明确选择“捆绑匹配版本的 binary”还是 `pathToClaudeCodeExecutable` 指向用户 CLI；前者协议稳定，后者更符合复用本机 runtime，但版本组合仍需 smoke test。不要把 Agent SDK误解为自研 runtime，它是 Anthropic 官方的 Claude Code 程序化封装。（已证实；[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)，查阅：2026-07-10）

`--bare` 不应在未决定认证方案前直接加入：它能解决用户级配置污染，却会切断现有 OAuth/keychain 复用。见 H 节建议。

## B. 可解析输出

### 我们需要什么

需要稳定区分 init、thinking、text、tool use、tool result、重试、单轮结果和错误；尤其必须得到每轮 input/output/cache token，才能实现 P1 token 预算护栏。

### 官方最新怎么提供

- `stream-json` 是逐行 JSON。开启 `--include-partial-messages` 后，会额外收到 `type: "stream_event"`，内部是 API 原始 `message_start`、`content_block_start/delta/stop`、`message_delta`、`message_stop`；text delta 位于 `event.delta.type === "text_delta"`，tool input 增量位于 `input_json_delta.partial_json`。完整 `assistant` 与最终 `result` 仍会发送。（已证实；[Programmatic usage：stream responses](https://code.claude.com/docs/en/headless)、[Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output)，查阅：2026-07-10）
- 完整 `assistant` 包装一个 Anthropic `BetaMessage`，含 `id`、`content`、`model`、`stop_reason`、`usage`；content 可包含文本、thinking 与 tool-use 类 block。thinking 是否出现取决于所选模型、推理配置和运行时，官方没有保证每一轮都暴露 thinking 文本，因此应视为可选观测，不应成为控制流依赖。（部分已证实；[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)、[Python SDK reference](https://code.claude.com/docs/en/agent-sdk/python)，查阅：2026-07-10；“每轮必有 thinking”未证实）
- 每个完整 assistant message 的 `message.usage` 有该 API step 的 token；并行工具调用可能产生多个共享同一 message id 和相同 usage 的 assistant message，逐 step 累计时必须按 id 去重。最终 `result` 有本次 query 的累计 `usage`、`modelUsage`、`total_cost_usd`，成功与错误 result 都携带 usage。cache creation/read token 也在 usage 中。（已证实；[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)，查阅：2026-07-10）
- `total_cost_usd` 是客户端随版本捆绑价格表计算的估值，不是权威账单；可用于开发观察和近似预算，不应作为最终计费依据。token 计数本身可用于 Kith-space 的 task budget；跨多次 query 的 session 累计要由调用方自己做。（已证实；[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)，查阅：2026-07-10）

### 本地适配器现状

stdout 已做跨 chunk 缓冲与逐行 JSON 解析，但非法 JSON 被静默丢弃；进程退出时没有补解析最后一条无换行的 buffer。stderr 每个 chunk 只记录最多 300 字。`reference/open-tag/src/daemon/claudeRuntime.ts:73-87`

当前仅处理 `system/init`、`result` 和完整 `assistant`。assistant 中会提取 `thinking`、`text`、`tool_use`，但统一裁到 2,000 字，工具输入仅对 Bash 与 Read/Write/Edit 做摘要；它完全忽略 `stream_event`、tool result、API retry、assistant error、result subtype、usage、cost、stop reason 和 permission denial。`reference/open-tag/src/daemon/claudeRuntime.ts:8-15`、`reference/open-tag/src/daemon/claudeRuntime.ts:86-107`

公共 `TrajectoryEntry` 没有 event id、message id、turn id、usage 或 error；`RuntimeCallbacks` 也没有 turn result / usage 回调。`reference/open-tag/src/daemon/runtime.ts:5-18`；现状文档已指出 P1 token 预算因此没有数据契约。`docs/kith-space/notes/runtime-adapters-current-state.md:273-277`

### 差距与建议

先扩公共契约，再改 parser：新增结构化 `onTurnCompleted`（或等价事件），至少包含 runtime、session id、result subtype、stop reason、input/output/cache creation/cache read tokens、modelUsage、estimated cost、num turns、errors。对 P1 预算以最终 `result.usage` 为本轮唯一结算值；需要实时预警时才读取 assistant usage，并按 message id 去重。不要从 trajectory 文本估算 token。（已证实；[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)，查阅：2026-07-10）

轨迹显示应消费完整 assistant block，partial stream 只用于即时 UI；若同时显示两者，必须按 uuid/message id/content block 设计去重。thinking 是可选展示数据，不参与 ready、预算或完成判断。parser 对未知事件应保留类型化日志/指标而不是静默吞掉，以便 CLI 更新后能看到协议漂移。

Claude CLI 另有 `--max-budget-usd` 和 `--max-turns` 原生终止护栏，可作为失控保护，但前者是美元估值、后者是 agentic turn 数，都不能替代 Kith-space 的 task token budget。（已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)、[Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)，查阅：2026-07-10）

## C. 会话延续

### 我们需要什么

每个逻辑 agent 要能跨消息、sleep、daemon 重启继续同一上下文，同时明确“一个活进程的多轮”与“依赖 session id 的跨进程恢复”是两层机制。

### 官方最新怎么提供

- `--continue` 恢复当前目录最近会话，`--resume <session-id-or-name>` 恢复指定会话。按 ID 查找受当前项目目录及其 git worktrees 限制，因此多 agent 产品应持久化明确 session id，不应用 `--continue` 猜最近会话。（已证实；[Programmatic usage：continue conversations](https://code.claude.com/docs/en/headless)、[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）
- Agent SDK 会把会话 JSONL 写到本地磁盘；会话保存对话、工具调用与结果，不保存 filesystem snapshot。进程内多轮推荐长连接 streaming input；进程重启后传 `resume`。TypeScript 也可用 `continue: true` 找当前目录最近会话，但多会话仍推荐显式 ID。（已证实；[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)、[Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)，查阅：2026-07-10）
- 每次 query 的 `result` 都只统计该 query 的 usage/cost；resume 后不是自动提供 session 总计，调用方需累计。（已证实；[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)，查阅：2026-07-10）

### 本地适配器现状

有已存 `sessionId` 时，spawn argv 加 `--resume <id>`；本地还会从 `system/init` 与 `result` 更新 session id。`reference/open-tag/src/daemon/claudeRuntime.ts:36-40`、`reference/open-tag/src/daemon/claudeRuntime.ts:60-69`、`reference/open-tag/src/daemon/claudeRuntime.ts:88-92`

当前一个 `RuntimeSession` 对应一个持续子进程，`deliver` 直接写同一 stdin；stop/exit 不会清空 session id。`reference/open-tag/src/daemon/claudeRuntime.ts:59-71`、`reference/open-tag/src/daemon/claudeRuntime.ts:109`、`reference/open-tag/src/daemon/runtime.ts:30-33`

没有 stale/corrupt session 的专门恢复分支，没有 busy queue，也没有把 `result` 显式关联到哪一条 user input。现状核实见 `docs/kith-space/notes/runtime-adapters-current-state.md:124-138`。

### 差距与建议

保持“活跃 agent 一个长连接进程；sleep/crash 后以 session id 重新 spawn”的模型，这与官方 streaming input 推荐一致。上层只在显式 reset 时清 session id；普通 stop/sleep 保留。每条 deliver 分配 Kith turn id，串行入队，并以对应的 `result` 完成本轮。

resume 失败不能仅按进程退出处理。应识别 result/assistant error 与 stderr 中的 session-not-found 类错误，记录原 id，再按产品策略显式选择“报错等待用户”或“新建会话并立即上报新 id”；官方当前未给出“无效 `--resume` 自动回退新会话”的稳定 CLI 契约，因此自动回退行为标为未证实。（未证实；[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)，查阅：2026-07-10）

## D. 身份 / 系统提示注入

### 我们需要什么

要注入 agent 身份、职责、记忆协议和 Kith-space 协作规则，同时避免把临时 system prompt 文件写进用户工作区，且要决定是保留 Claude Code 默认 prompt 还是完全替换。

### 官方最新怎么提供

- CLI 有四个明确入口：`--append-system-prompt`、`--append-system-prompt-file` 保留并追加默认 prompt；`--system-prompt`、`--system-prompt-file` 完全替换默认 prompt。官方对 CLI 自动化示例优先使用 append。（已证实；[CLI reference：system prompt flags](https://code.claude.com/docs/en/cli-usage)、[Programmatic usage](https://code.claude.com/docs/en/headless)，查阅：2026-07-10）
- Agent SDK 与 CLI 默认值不同：SDK 未显式传 systemPrompt 时仅用最小 tool-calling prompt；若要匹配 CLI，需选择 `claude_code` preset，可附 `append`。官方建议：类似 CLI/IDE 的 coding agent 用 preset；不同 surface、identity 或 permission model 的 agent 可用自定义 prompt，但调用方要自行补回需要的工具指导和安全指令。（已证实；[Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)，查阅：2026-07-10）
- 默认非-bare CLI/SDK 还可能从工作目录与 `~/.claude/` 自动载入 `CLAUDE.md` 等配置；bare 只使用显式 flag。（已证实；[Programmatic usage：bare mode](https://code.claude.com/docs/en/headless)、[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)，查阅：2026-07-10）

### 本地适配器现状

适配器默认准备 `--append-system-prompt <text>`，随后尝试把 prompt 写到 `{cwd}/.claude-system-prompt.md`，成功则改用 `--append-system-prompt-file`；写文件失败才回退 inline。固定路径会覆盖，退出时不清理。`reference/open-tag/src/daemon/claudeRuntime.ts:46-50`

按现有上层约定，`systemPrompt` 是 `StartOpts` 必填字段；当前 `cwd` 是 runtime 进程目录。`reference/open-tag/src/daemon/runtime.ts:20-28`。现状文档说明该文件目前落在 per-agent 隔离目录，但若未来 cwd 改为用户工作区根，就会污染工作区。`docs/kith-space/notes/runtime-adapters-current-state.md:118-122`、`docs/kith-space/notes/runtime-adapters-current-state.md:283-285`

### 差距与建议

P1 先保持 append：它保留 Claude Code 默认工具与安全指导，改动风险最低。若未来要让非开发角色完全摆脱 Claude Code 身份，再单独评估 Agent SDK custom systemPrompt；不要只为改名就丢失默认工具指导。（已证实；[Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)，查阅：2026-07-10）

prompt file 必须写到 Kith-space 管理的 per-agent runtime state 目录，并把绝对路径传给 `--append-system-prompt-file`；不要再用 `{cwd}` 隐式决定存放点。若改用 Agent SDK，直接传 `systemPrompt`/preset+append 可消除该临时文件。任何凭证都不得写入 system prompt，因为 prompt 会进入会话转录并随 resume 保留。

## E. 模型与推理强度

### 我们需要什么

允许用户选择模型与 reasoning effort，同时知道实际生效的模型/强度，并避免 UI 白名单落后于 CLI。

### 官方最新怎么提供

- `--model` 可用动态别名 `sonnet | opus | haiku | fable` 或完整模型 ID，并覆盖 settings 与 `ANTHROPIC_MODEL`。动态别名会随 Claude Code 更新指向新模型；完整 ID 更可重复。（已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)、[Model configuration](https://code.claude.com/docs/en/model-config)，查阅：2026-07-10）
- 当前 `--effort` 接受 `low | medium | high | xhigh | max | ultracode`，可用级别依模型而异；`max` 不约束 token spend，`ultracode` 是 xhigh 加动态 workflow 的 session-only 设置，要求 Claude Code v2.1.203+。环境变量 `CLAUDE_CODE_EFFORT_LEVEL` 优先于配置级别；官方 init/hook 数据能反映实际模型/effort 的部分状态，但不能假定请求值一定原样生效。（已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)、[Model configuration](https://code.claude.com/docs/en/model-config)，查阅：2026-07-10）

### 本地适配器现状

model 非空才传 `--model`，否则沿用用户本机默认。`reference/open-tag/src/daemon/claudeRuntime.ts:20-21`、`reference/open-tag/src/daemon/claudeRuntime.ts:36`

effort 在本地硬编码白名单 `low | medium | high | xhigh | max`，合法才传 `--effort`；当前漏掉官方新增的 `ultracode`。`reference/open-tag/src/daemon/claudeRuntime.ts:17-18`、`reference/open-tag/src/daemon/claudeRuntime.ts:37-38`

parser 只在 init 时取 session id，没有保留 init 中的实际 model、CLI version 或 permission mode。`reference/open-tag/src/daemon/claudeRuntime.ts:88-90`

### 差距与建议

把 model/effort 能力作为版本探测结果，而不是永久写死 UI 枚举。最低限度应解析 `system/init.model` 与 `claude_code_version`，把“请求值 / 实际值”分别上报；不支持的 effort 要给明确错误，不能静默回本机默认。`ultracode` 是否纳入 Kith-space UI 应作为产品选择，因为它会启用额外工作流，不只是更高 thinking。

对可复现任务可保存完整 model ID；对普通本机体验可保存别名，并在每轮 usage 里记录实际 model。P1 token 预算默认不应开放 `max`，或至少给出“无 token spending constraint”的明确警示。（已证实；[Model configuration](https://code.claude.com/docs/en/model-config)，查阅：2026-07-10）

## F. 无人值守权限

### 我们需要什么

在没有终端交互的情况下既不能挂起等确认，也不能把“能继续运行”误当成“必须获得宿主机全权”。需要可表达全权、白名单自动运行、拒绝未知操作，以及未来接 Kith-space 审批 UI。

### 官方最新怎么提供

- `--dangerously-skip-permissions` 与 `--permission-mode bypassPermissions` 等价。bypass 会让所有工具立即执行，跳过权限提示与大部分安全检查；官方明确只建议隔离容器/VM，且它不能防 prompt injection 或意外操作。自 v2.1.126 起也可写通常受保护路径；文件系统根与 home 的极端删除仍有 circuit breaker。（已证实；[Permission modes](https://code.claude.com/docs/en/permission-modes)、[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）
- 在 Agent SDK 中，`allowedTools` 与 bypass 同时使用并不会把 bypass 限定到允许列表；bypass 仍批准全部工具。显式 deny/ask 规则与 hooks 可在 mode check 前阻止操作，但不能把 bypass 当作最小权限机制。（已证实；[Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)，查阅：2026-07-10）
- 更细粒度的无人值守替代包括：`dontAsk` 自动拒绝所有未被 allow rules/只读集合预批准的工具；`acceptEdits` 自动批准文件编辑和常见文件系统命令；`allowedTools` 精确预批准工具；`--tools` 限制模型能看到的内建工具。`auto` 用后台分类器判断，但可用性受账号/模型条件影响，不应当作跨环境确定契约。（已证实；[Programmatic usage：auto-approve](https://code.claude.com/docs/en/headless)、[Permission modes](https://code.claude.com/docs/en/permission-modes)、[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）
- `--permission-prompt-tool <mcp-tool>` 可在非交互模式把权限请求交给一个 MCP tool；这提供了未来接 Kith-space 审批服务的官方入口。（已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）

### 本地适配器现状

当前同时硬编码 `--dangerously-skip-permissions` 与 `--permission-mode bypassPermissions`，两者语义重复；同时只 disallow plan/cron/ask 类工具，未限制 Bash、文件写入或 MCP 工具。`reference/open-tag/src/daemon/claudeRuntime.ts:30-34`

公共 `StartOpts` 没有 permission policy，调用方无法选择受限无人值守模式。`reference/open-tag/src/daemon/runtime.ts:20-28`

### 差距与建议

在公共 runtime contract 加语义级策略，而不是暴露 Claude flag，例如 `unattended-full-access`、`unattended-allowlist`、`interactive-approval`。Claude adapter 分别映射为 bypass、`dontAsk + allowedTools/permissions.allow`、`--permission-prompt-tool`。

v1 若按既定决策保留 full access，至少去掉重复 flag、在 UI/日志中标明实际 mode，并把它限定在本机可信内容 + 隔离 cwd/凭证最小化的前提下。MCP 工具优先用 `allowedTools: ["mcp__kith__*"]` 精确授权；官方明确建议 MCP access 优先用 allowedTools 而不是宽泛 bypass。（已证实；[Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp)，查阅：2026-07-10）

## G. MCP server 接入

### 我们需要什么

daemon 每次启动 Claude runtime 时都要显式注册 Kith-space MCP server，传入短期凭证，授权所需工具，并在首轮开始前确认连接成功；不能要求用户预先修改全局 Claude 配置，也不能污染工作区 `.mcp.json`。

### 官方最新怎么提供

- CLI 支持 `--mcp-config <file-or-json>`，可传一个或多个 JSON 文件/字符串；`--strict-mcp-config` 会只使用该参数里的 MCP servers，忽略其他 MCP 配置。bare 模式也明确允许通过 `--mcp-config` 显式载入 server。（已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)、[Programmatic usage：bare mode](https://code.claude.com/docs/en/headless)，查阅：2026-07-10）
- 官方支持本地 stdio、远程 HTTP、已弃用的 SSE，以及配置文件形式的 WebSocket。对 Kith-space 本机模块，stdio 最直接；对 daemon 已运行的本地服务，streamable HTTP 也可。stdio 配置含 `command`、`args`、`env`，HTTP 配置含 `type: "http"`、`url`、`headers`。SSE 已明确 deprecated。（已证实；[Claude Code MCP](https://code.claude.com/docs/en/mcp)、[Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp)，查阅：2026-07-10）
- MCP tool 名为 `mcp__<server-name>__<tool-name>`；要无人值守调用，应用 `--allowedTools`/`allowedTools` 精确批准。`system/init.mcp_servers` 会列出每个 server 的连接状态，可在 agent 开始工作前检查 `status === "connected"`。server 名 `workspace` 被保留，不能使用。（已证实；[Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)，查阅：2026-07-10）
- project scope 会在工作区根写 `.mcp.json`，且首次使用会要求信任；local/user scope 写 `~/.claude.json`。这些都不适合 Kith-space 每次 spawn 的临时、每 agent 注入。（已证实；[Claude Code MCP：installation scopes](https://code.claude.com/docs/en/mcp)，查阅：2026-07-10）

### 本地适配器现状

`StartOpts` 没有 MCP server 描述；Claude argv builder 也没有 `--mcp-config`、`--strict-mcp-config` 或 MCP allowed-tools 注入。`reference/open-tag/src/daemon/runtime.ts:20-28`、`reference/open-tag/src/daemon/claudeRuntime.ts:24-40`

当前 `system/init` parser 只取 session id，完全丢弃 `mcp_servers` 状态。`reference/open-tag/src/daemon/claudeRuntime.ts:88-90`

现状文档已把它识别为三条 runtime 的共同缺口。`docs/kith-space/notes/runtime-adapters-current-state.md:265-271`

### 差距与建议

给 `StartOpts` 增加 runtime-neutral 的 `mcpServers` 与 `allowedMcpTools`；Claude adapter 将其序列化成内存 JSON 参数，或写到 Kith-space 自己的 runtime state 目录后传绝对路径。推荐 argv 形态：

```text
--mcp-config <Kith-space 生成的 JSON>
--strict-mcp-config
--allowedTools mcp__kith__*
```

server 名建议用 `kith` 或 `kith-space`，不要用保留名 `workspace`。凭证通过 MCP server 专用 `env` 或 HTTP header 注入，不放 prompt、不写 project `.mcp.json`。stdio server 若由 Claude Code负责 spawn，daemon 应传一个短期 bearer/token 和 workspace/agent id；若用 HTTP，则 daemon 自己管理 server 生命周期，Claude 只连 URL。

`system/init` 是启动闸门：若 `kith` 缺失或 status 非 connected，应阻止首条业务 turn、上报明确 runtime unavailable；不能像现在一样仅拿到 session id 就开始。官方对 MCP 连接失败给出的检查点正是 init status。（已证实；[Agent SDK MCP：error handling](https://code.claude.com/docs/en/agent-sdk/mcp)，查阅：2026-07-10）

## H. 运行环境 / 隔离

### 我们需要什么

明确 cwd、用户工作区、runtime state、环境变量、session 存储和认证目录的边界；既要让 Claude 操作正确工作区，也要防止用户全局 hooks/MCP/credentials 无意进入 agent。

### 官方最新怎么提供

- cwd 决定工具的初始工作目录、项目配置发现、session 的项目归属与 `--resume` 查找范围。额外目录可用 `--add-dir`；MCP 的 `roots/list` 会返回 launch directory 与额外目录。（已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)、[Claude Code MCP](https://code.claude.com/docs/en/mcp)、[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)，查阅：2026-07-10）
- 默认会从工作区 `.claude/`、`CLAUDE.md`、`.mcp.json` 和用户 `~/.claude/` / `~/.claude.json` 读配置。`--bare` 可关闭这些自动发现；`--setting-sources` 可限制 user/project/local settings，但它不等同于完整隔离。（已证实；[Programmatic usage](https://code.claude.com/docs/en/headless)、[Settings](https://code.claude.com/docs/en/configuration)、[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)，查阅：2026-07-10）
- Linux/Windows 的 Claude credentials 默认在 `~/.claude/.credentials.json` / `%USERPROFILE%\.claude\.credentials.json`，设置 `CLAUDE_CONFIG_DIR` 后改到该目录。session 也会落本地配置目录；官方说明即使使用外部 sessionStore，CLI 仍先写本地，可用 `CLAUDE_CONFIG_DIR` 指向临时/隔离目录。（已证实；[Authentication](https://code.claude.com/docs/en/team)、[External session storage](https://code.claude.com/docs/en/agent-sdk/session-storage)，查阅：2026-07-10）
- 认证优先级包括 provider credentials、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`apiKeyHelper`、`CLAUDE_CODE_OAUTH_TOKEN`、用户 `/login` OAuth。非交互模式有 `ANTHROPIC_API_KEY` 时总是优先。Anthropic 还明确要求：第三方产品/服务使用 Agent SDK 时应采用 Console API key 或支持的 cloud provider；未经批准不得向产品用户提供 claude.ai login/rate limits。Kith-space 属于本机开源工具是否构成该政策中的第三方产品，需要项目方单独确认，本文不作法律结论。（已证实；[Authentication](https://code.claude.com/docs/en/team)、[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)、[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)，查阅：2026-07-10；对 Kith-space 的适用结论未证实）
- 官方安全部署建议把 Claude Code/Agent SDK 放在 sandbox、container 或 VM 内，并遵循最小文件系统、网络与凭证权限；bypassPermissions 不能替代隔离。（已证实；[Secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)、[Hosting](https://code.claude.com/docs/en/agent-sdk/hosting)，查阅：2026-07-10）

### 本地适配器现状

`StartOpts` 传入 `cwd` 和完整 `env`；Claude spawn 原样使用两者。`reference/open-tag/src/daemon/runtime.ts:20-28`、`reference/open-tag/src/daemon/claudeRuntime.ts:59`

适配器没有设置 `CLAUDE_CONFIG_DIR`，没有 `--bare` / `--setting-sources`，也没有过滤用户全局 Claude 配置或敏感 env；因此默认继承调用方给它的全部环境与用户 Claude 状态。它还把 system prompt 文件写进 cwd。`reference/open-tag/src/daemon/claudeRuntime.ts:46-50`、`reference/open-tag/src/daemon/claudeRuntime.ts:59`

### 差距与建议

把两个概念分开：Claude 的 `cwd` 应是它实际要操作、用于 session scope 的 Kith workspace 根；runtime state（prompt file、MCP config、日志、可选 `CLAUDE_CONFIG_DIR`）应在 Kith-space 管理的 per-agent 目录。不要再靠“把 cwd 指向 agent data dir”间接隔离，否则 Claude 对真实项目的 cwd/session/config 语义会失真。

认证与确定性需要明确提供两种运行档，而不是混搭：

1. “复用用户 Claude”档：不用 bare、不改默认 `CLAUDE_CONFIG_DIR`，可使用本机 `/login`，但必须向用户说明会加载全局 Claude 配置，并用 `--strict-mcp-config` 至少锁定 MCP 来源。
2. “Kith 托管自动化”档：`--bare` + Kith 自有 `CLAUDE_CONFIG_DIR` + API key/apiKeyHelper，所有 prompt/settings/MCP 显式传入，最可复现。bare 不读 OAuth/keychain，不能假定复用用户登录。（已证实；[Programmatic usage：bare mode](https://code.claude.com/docs/en/headless)，查阅：2026-07-10）

无论哪一档，env 必须采用 allowlist/显式合成，至少审计 API key、proxy、cloud provider、`CLAUDE_*`、`ANTHROPIC_*`、PATH；不要把 daemon 的全部环境无筛选透传。真正启用邮箱/浏览器等高风险 MCP 前，应按既定决策先上 sandbox/permission 重评。

## I. 生命周期

### 我们需要什么

需要独立的 process ready、MCP ready、turn busy、turn done、turn error、process exited 信号；需要能区分模型/API/权限错误与进程级错误，而不是只看退出码。

### 官方最新怎么提供

- `system/init` 是正常 stream 的首个 session 事件，包含 `session_id`、`claude_code_version`、cwd、model、tools、MCP statuses、permission mode 等；若启用同步 plugin install，init 前可能先有 `system/plugin_install`。因此 ready 不能写成“stdout 第一行必为 init”，但可写成“收到 init 且所需 MCP connected”。（已证实；[Programmatic usage：stream responses](https://code.claude.com/docs/en/headless)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)，查阅：2026-07-10）
- `result` 标记一次 agent loop/query 的业务终态。主要 subtype 为 `success`、`error_max_turns`、`error_max_budget_usd`、`error_during_execution`、`error_max_structured_output_retries`；另有 stop reason、errors、usage、permission denials 等。官方提醒 result 后仍可能有少量 trailing system event，因此消费 SDK iterator 时应读到流结束；对持续 raw CLI 进程则应把 result 当“本轮完成”，而不是“进程完成”。（已证实；[Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)，查阅：2026-07-10）
- 可重试 API 错误会先发 `system/api_retry`，含 attempt、max retries、delay、HTTP status/category；适配器可直接显示 retrying，而不是误判离线。（已证实；[Programmatic usage](https://code.claude.com/docs/en/headless)，查阅：2026-07-10）
- 官方没有发布一张覆盖所有 `claude -p` 失败类型的稳定进程退出码表。当前只明确若干情况会 non-zero（例如 stdin 超限、max turns/参数错误），因此“exit code 精确映射业务错误”未证实；业务终态应以结构化 result/assistant error 为主，process exit code 为辅。（未证实；[Programmatic usage](https://code.claude.com/docs/en/headless)、[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）

### 本地适配器现状

收到 `system/init` 后更新 session 并设为 `working/starting`；收到任意 `result` 后一律设为 `online`，不检查 subtype/is_error。`reference/open-tag/src/daemon/claudeRuntime.ts:88-93`

spawn error 会报 offline 并 `onExit(1)`；process exit 通过一次性 guard 上报 code；stop 只发 `SIGTERM`。`reference/open-tag/src/daemon/claudeRuntime.ts:61-65`、`reference/open-tag/src/daemon/claudeRuntime.ts:79-84`、`reference/open-tag/src/daemon/claudeRuntime.ts:109`

公共接口没有 `onReady`、`onTurnDone`、`onError`，`deliver()` 也不返回 Promise/turn id。`reference/open-tag/src/daemon/runtime.ts:12-18`、`reference/open-tag/src/daemon/runtime.ts:30-33`；现状文档同样指出 `online` 只是最接近 turn-done 的间接信号。`docs/kith-space/notes/runtime-adapters-current-state.md:52-64`

### 差距与建议

建立明确状态机：`starting -> initialized -> ready -> busy -> turnCompleted|turnFailed -> ready -> stopping -> exited`。init 必须验证 CLI version、cwd、model、permission mode、必需 MCP status；result 必须按 subtype 产生 turnCompleted/turnFailed，并携带 usage。只有 process error/exit 才产生 exited/offline。

补全错误处理：保留 stderr ring buffer；JSON parse 失败计数并记录截断样本；exit 前 flush 无换行尾行；stdin write 监听 callback/error；init timeout、MCP timeout、turn timeout、graceful stop timeout 分开；`system/api_retry` 进入 retrying 状态。不要因为收到 error result 后 process 仍活着就覆盖成 online。

## J. 版本兼容风险

### 我们需要什么

用户安装的 Claude Code 会自动更新，stream event、tool 名、flag、权限与会话行为可能变化；必须在真实 CLI 上有可复现 fixture 和最小 smoke test，避免“编译通过但 runtime 协议已漂移”。

### 官方最新怎么提供

- Claude Code 默认自动检查并后台更新，新版本下次启动生效；可禁用 auto-update，但 Kith-space 不应擅自修改用户全局设置。（已证实；[Set up Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started)、[Changelog](https://code.claude.com/docs/en/changelog)，查阅：2026-07-10）
- 官方 CLI reference 明确说 `claude --help` 不会列出所有 flag，所以不能用“help 中不存在”判定不支持；应结合 init 里的 `claude_code_version`、官方 changelog 和实际 smoke test。（已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）
- 已有明确的版本化行为变化：v2.1.128 stdin 10 MB 上限；v2.1.126 bypass 对 protected paths 的语义变化；v2.1.163 修复 background process 让 `-p` 永久不退出；v2.1.182 给 background agents 等待加默认上限；v2.1.203 变更 MCP roots 并加入 ultracode；v2.1.205 改了 queued message/max-turn 与若干 flag 行为。工具名也发生过 `Task` -> `Agent` 迁移且部分 init/denial 字段仍保留旧名。（已证实；[Programmatic usage](https://code.claude.com/docs/en/headless)、[MCP](https://code.claude.com/docs/en/mcp)、[Model configuration](https://code.claude.com/docs/en/model-config)、[Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)、[Changelog](https://code.claude.com/docs/en/changelog)，查阅：2026-07-10）
- 官方已预告 bare 将在未来成为 `-p` 默认值；这会改变配置发现和认证行为，是必须提前固定的兼容边界。（已证实；[Programmatic usage：bare mode](https://code.claude.com/docs/en/headless)，查阅：2026-07-10）

### 本地适配器现状

当前固定依赖若干 CLI flag 与事件名，没有最低/最高版本、capabilities 检查或 init version 记录。`reference/open-tag/src/daemon/claudeRuntime.ts:24-40`、`reference/open-tag/src/daemon/claudeRuntime.ts:86-107`

effort 白名单已落后于当前官方值；disallowed tool 名也属于可能随 CLI 变化的内部工具表。`reference/open-tag/src/daemon/claudeRuntime.ts:17-18`、`reference/open-tag/src/daemon/claudeRuntime.ts:30-34`

现状文档已指出 partial message 去重仍需真实 CLI 验证。`docs/kith-space/notes/runtime-adapters-current-state.md:294-297`

### 差距与建议

启动时解析并记录 `claude_code_version` 与 init capabilities，维护一张“已验证版本区间/最低功能版本”表；不满足最低版本时明确拒绝启用 MCP/usage 等能力，而不是带病运行。不要自动替用户升级或改全局设置。

固定两层测试资产：

1. 协议 fixture：保存真实版本产出的 init、assistant(text/thinking/tool)、stream_event、tool result、success/error result、api_retry、permission denial、MCP failure、尾行无换行样本，parser 单测覆盖未知字段与乱 chunk。
2. 安装后 smoke：执行只读、低成本任务，核对 init version/cwd/model、Kith MCP connected、一次只读 MCP tool、result usage/subtype/session id、resume 第二轮。对每个支持的 OS 至少验证一次。

若继续 raw CLI，建议记录“SDK message schema 版本 + Claude CLI version”的组合；若改 Agent SDK，锁定 npm 版本并仍测试实际被启动的 binary 版本。官方 SDK 与 CLI 都在快速演进，类型包不能替代端到端 smoke test。

## 对我们适配器最关键的 3 条建议

1. **先补正式 turn result / usage 契约，再做 P1 token 预算。** `result.usage`、`modelUsage`、subtype 和 errors 官方已提供，当前只是 parser/公共接口丢弃；以 result 做每轮结算，assistant usage 仅作实时预警并按 message id 去重。（已证实；[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)、[TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)，查阅：2026-07-10）
2. **把 Kith-space MCP 作为 spawn 的结构化必填输入。** 用 `--mcp-config` + `--strict-mcp-config` + 精确 `allowedTools` 注入，不写用户 `.mcp.json`；收到 `system/init` 后确认 Kith server connected，失败则禁止首轮业务执行。（已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)、[Agent SDK MCP](https://code.claude.com/docs/en/agent-sdk/mcp)，查阅：2026-07-10）
3. **权限、认证、隔离必须一起定档。** 当前硬编码 bypass + 继承用户环境/配置不适合长期扩展。v1 可保留明确标注的本机 full-access 档，但应新增 `dontAsk + allowlist` 档，并尽快决定“复用用户 Claude”与“bare + Kith 配置目录 + API key”两套认证/隔离路径；在此决策前不要贸然加 `--bare`，也不要把 cwd 切到用户根后继续写 prompt 文件。（权限与 bare 行为已证实；[Permission modes](https://code.claude.com/docs/en/permission-modes)、[Programmatic usage](https://code.claude.com/docs/en/headless)、[Authentication](https://code.claude.com/docs/en/team)，查阅：2026-07-10；Kith-space 最终认证产品策略未证实）
