# Runtime adapters 现状核实与 Wave 2 建议

> 调研日期：2026-07-10  
> 基线：只读上游副本 `reference/open-tag/`  
> 范围：`Runtime` 抽象、runtime 注册与探测、Claude Code / Codex / OpenCode 三条 v1 强路径，以及理解生命周期所必需的 `agentManager.ts` 调用点。  
> 方法：静态阅读一手 TypeScript 源码；本次没有运行任何 CLI，因此 CLI 版本兼容性与源码注释中声称的外部行为仍需独立验证。

本文先记录“源码已经证明的现状”，最后单列“Wave 2 改动建议”。建议不是对现状的描述。

## 0. 设计约束

Kith-space 已确定不自研 runtime，Claude Code / Codex / OpenCode 由 adapter 外接，自建模块则以 MCP 工具暴露给外接 agent。`docs/decisions.md:51-61`，`docs/kith-space/architecture-proposal.md:42-73`

Wave 2 的产品面只打磨 Claude Code / Codex / OpenCode 三条强路径，其他现有 adapter 标 experimental 或隐藏；同时，v1 明确沿用无交互全权运行，但它是以“单机 + 单用户 + 仅本机可信内容”为前提的已记账技术债。`docs/kith-space/architecture-proposal.md:59-65`，`docs/decisions.md:129-139`

## 1. 公共接口与实际生命周期

### 1.1 接口签名

```ts
interface Runtime {
  name: string;
  experimental?: boolean;
  oneShotWake?: boolean;
  start(opts: StartOpts, cb: RuntimeCallbacks): RuntimeSession;
}

interface RuntimeSession {
  deliver(text: string): void;
  stop(): void;
}
```

`Runtime.start` 是同步接口，立即返回一个只有 `deliver` / `stop` 的 session handle；它不表示底层 CLI 已初始化完成，也没有 ready Promise。`Runtime` 另有可选的 `experimental` 与 `oneShotWake` 能力标记。`reference/open-tag/src/daemon/runtime.ts:30-40`

`StartOpts` 当前字段如下：

| 字段 | 语义 |
|---|---|
| `cwd: string` | 子进程工作目录 |
| `model?: string` | 可选模型；各 runtime 的传递方式不同 |
| `runtimeConfig?: Record<string, unknown> \| null` | runtime 特有配置，目前三条路径主要从中读取 `reasoningEffort` |
| `sessionId?: string \| null` | 已持久化、用于恢复的会话标识 |
| `systemPrompt: string` | 上层生成的 standing/system prompt |
| `env: NodeJS.ProcessEnv` | 包含注入后的 `PATH` 与 `OPEN_TAG_*` 环境变量 |
| `initialPrompt: string` | 启动后的第一条驱动消息；新会话、恢复、one-shot wake 可使用不同 nudge |

字段定义及注释见 `reference/open-tag/src/daemon/runtime.ts:20-28`。接口没有 MCP server 清单、权限策略、token/usage 或工作任务上下文等显式字段。`reference/open-tag/src/daemon/runtime.ts:20-28`

`TrajectoryEntry` 只有 `thinking | text | tool | status` 四种 kind，附带可选的 `text` / `toolName` / `toolInput`；它没有 usage、turn id、event id 或错误结构。`reference/open-tag/src/daemon/runtime.ts:5-10`

### 1.2 回调契约

| 回调 | 当前契约与上层用途 |
|---|---|
| `onSession(sessionId)` | 接收、更新或清除 session id；`AgentManager` 缓存并转发为 `agent:session` |
| `onActivity(activity, detail?)` | 上报 `working` / `thinking` / `online` / `offline` 等状态；上层重置 idle timer 并驱动 UI 状态 |
| `onTrajectory(entries)` | 上报 thinking/text/tool 轨迹；上层同时转发轨迹和文本 reply preview |
| `onExit(code)` | 底层运行时退出；上层区分主动 teardown 与意外退出 |
| `log` | 适配器日志入口 |

接口定义见 `reference/open-tag/src/daemon/runtime.ts:12-18`；`AgentManager` 的具体转发见 `reference/open-tag/src/daemon/agentManager.ts:174-195`。

需要特别区分：`onActivity("online")` 是目前最接近“本轮结束/可继续”的信号，但公共接口没有正式的 `onReady` 或 `onTurnDone`。三条实现各自用内部协议判断一轮完成。`reference/open-tag/src/daemon/claudeRuntime.ts:88-105`，`reference/open-tag/src/daemon/codexRuntime.ts:87-125`，`reference/open-tag/src/daemon/opencodeRuntime.ts:149-159`

### 1.3 start → deliver → stop 的真实流程

1. `AgentManager` 解析 runtime，准备每 agent 工作目录、`MEMORY.md`、system prompt 与注入环境。`reference/open-tag/src/daemon/agentManager.ts:146-173`
2. 上层先把逻辑 agent 放入 running map，再调用 `runtime.start(...)`；传入已存 `sessionId`，并按新会话/恢复选择 `STARTUP_NUDGE` 或 `RESUME_NUDGE`。`reference/open-tag/src/daemon/agentManager.ts:197-215`
3. 三条实现都由 `start` 自动投递 `initialPrompt`：Claude 立即写 stdin；Codex 等 thread ready 后入队；OpenCode 构造 logical session 时入队。`reference/open-tag/src/daemon/claudeRuntime.ts:67-71`，`reference/open-tag/src/daemon/codexRuntime.ts:161-180`，`reference/open-tag/src/daemon/opencodeRuntime.ts:93-103`
4. 后续 server delivery 先在 `AgentManager` 聚合成 inbox notice，再同步调用 `session.deliver(note)`。公共方法没有成功值、背压或逐轮错误返回。`reference/open-tag/src/daemon/agentManager.ts:260-280`，`reference/open-tag/src/daemon/runtime.ts:30-32`
5. 主动 stop/sleep/reset 时，上层先从 running map 删除，再 `session.stop()`；这样随后到达的 `onExit` 会被认作主动 teardown，不覆盖上层已发出的状态。`reference/open-tag/src/daemon/agentManager.ts:61-72`，`reference/open-tag/src/daemon/agentManager.ts:183-192`
6. 意外退出时，上层保留 session id，把 agent 状态置为 sleeping；非零退出额外显示 error，下一次唤醒可尝试恢复。`reference/open-tag/src/daemon/agentManager.ts:183-192`

由此可见，`RuntimeSession` 是“逻辑会话控制句柄”，不等同于可持久恢复的 CLI session id：Claude/Codex 的一个当前 handle 各持有一个持续子进程，OpenCode 的一个 handle 则串行持有多个 one-shot 子进程；三者的 session id 都可跨进程生命周期继续使用。

## 2. 注册、探测与 v1 强路径现状

本机探测按 CLI 名逐个执行：Windows 使用 `where`，其他平台使用 `command -v`；探测列表为 Claude、Codex、Copilot、Kimi、OpenCode、Pi、Cursor、Hermes 共八条。`cursor-agent` 的结果会映射为 runtime 名 `cursor`。`reference/open-tag/src/daemon/runtimes.ts:15-24`

注册表也同时注册上述八条，`getRuntime(name)` 对未知名称返回 `null`。`reference/open-tag/src/daemon/runtimes.ts:26-27`

三条目标路径中，Claude 没有 `experimental` 标记；Codex 与 OpenCode 目前都明确标记 `experimental: true`。`reference/open-tag/src/daemon/claudeRuntime.ts:43-45`，`reference/open-tag/src/daemon/codexRuntime.ts:128-131`，`reference/open-tag/src/daemon/opencodeRuntime.ts:169-172`

## 3. Claude Code adapter

### 3.1 进程与完整 argv

Claude 使用一个持续运行的 `claude` 子进程，`cwd` / `env` 直接来自 `StartOpts`，stdin/stdout/stderr 全部为 pipe。`reference/open-tag/src/daemon/claudeRuntime.ts:59`

固定参数为：

```text
-p
--output-format stream-json
--input-format stream-json
--verbose
--dangerously-skip-permissions
--permission-mode bypassPermissions
--include-partial-messages
--disallowed-tools EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronList,CronDelete,AskUserQuestion
```

构造位置见 `reference/open-tag/src/daemon/claudeRuntime.ts:24-35`。

可选参数：

- `model` 非空时追加 `--model <model>`；为空时沿用用户本机 Claude 配置。`reference/open-tag/src/daemon/claudeRuntime.ts:20-21`，`reference/open-tag/src/daemon/claudeRuntime.ts:36`
- `runtimeConfig.reasoningEffort` 只有属于 `low | medium | high | xhigh | max` 白名单时才追加 `--effort`。`reference/open-tag/src/daemon/claudeRuntime.ts:17-18`，`reference/open-tag/src/daemon/claudeRuntime.ts:37-38`
- 有 `sessionId` 时追加 `--resume <sessionId>`。`reference/open-tag/src/daemon/claudeRuntime.ts:39`

### 3.2 权限语义

Claude 同时带 `--dangerously-skip-permissions` 与 `--permission-mode bypassPermissions`，即当前 adapter 固定选择无交互 bypass；同时只禁用 plan/cron/ask 类工具，不限制文件与 shell 工具。`reference/open-tag/src/daemon/claudeRuntime.ts:30-34`

这不是从 `StartOpts` 传入的策略，而是 adapter 内硬编码行为。`StartOpts` 本身没有权限字段。`reference/open-tag/src/daemon/runtime.ts:20-28`

### 3.3 system prompt 注入

默认方案是 `--append-system-prompt <text>`；adapter 会先尝试把 prompt 写到 `{cwd}/.claude-system-prompt.md`，成功后改用 `--append-system-prompt-file <path>`，只有写文件失败才退回 inline 参数。`reference/open-tag/src/daemon/claudeRuntime.ts:46-50`

因此当前实现会覆盖固定路径 `.claude-system-prompt.md`，且没有清理逻辑。这一行为目前发生在每 agent 的隔离目录中，因为 `AgentManager` 把 `cwd` 设为 daemon data dir 下的 agent 子目录。`reference/open-tag/src/daemon/agentManager.ts:156-166`，`reference/open-tag/src/daemon/agentManager.ts:208-211`

### 3.4 输入、输出与 session 恢复

每次 `deliver` 都向同一 stdin 写一行 stream-json user message；当本地已有 session id 时，消息对象还会带 `session_id`。adapter 没有 turn-busy 队列。`reference/open-tag/src/daemon/claudeRuntime.ts:67-71`，`reference/open-tag/src/daemon/claudeRuntime.ts:109`

stdout 采用跨 chunk 缓冲、按换行切分、逐行 `JSON.parse` 的 NDJSON 解析方式；非法 JSON 被静默忽略。stderr 只以 debug 记录最多 300 字的片段。`reference/open-tag/src/daemon/claudeRuntime.ts:73-78`，`reference/open-tag/src/daemon/claudeRuntime.ts:86-87`

事件映射：

- `system/init`：捕获 `session_id`，调用 `onSession`，activity 设为 `working/starting`。`reference/open-tag/src/daemon/claudeRuntime.ts:88-90`
- `result`：如有 session id 则再次更新，activity 设为 `online`。`reference/open-tag/src/daemon/claudeRuntime.ts:90-93`
- `assistant`：把 content blocks 中的 `thinking`、`text`、`tool_use` 映射为 trajectory；工具摘要仅对 Bash command 与 Read/Write/Edit path 做专门提取。`reference/open-tag/src/daemon/claudeRuntime.ts:10-15`，`reference/open-tag/src/daemon/claudeRuntime.ts:93-106`

恢复有两层：进程启动带 `--resume`，后续 user 事件也带当前 `session_id`。源码没有“resume 失败后自动开新会话”的显式分支；启动失败或进程退出只通过 error/exit 路径上报。`reference/open-tag/src/daemon/claudeRuntime.ts:39`，`reference/open-tag/src/daemon/claudeRuntime.ts:60-69`，`reference/open-tag/src/daemon/claudeRuntime.ts:79-84`

spawn error 会上报 offline 并 `onExit(1)`；正常/异常进程退出都经一次性 finish guard 调 `onExit(code)`。`stop()` 发送 `SIGTERM`。`reference/open-tag/src/daemon/claudeRuntime.ts:61-65`，`reference/open-tag/src/daemon/claudeRuntime.ts:79-84`，`reference/open-tag/src/daemon/claudeRuntime.ts:109`

## 4. Codex adapter

### 4.1 进程、协议与初始化

Codex 启动一个持续运行的 app-server：

```text
codex app-server --listen stdio://
```

`cwd` / `env` 透传，Windows 单独设置 `shell: true`。adapter 不覆盖 `CODEX_HOME`，因此继续使用用户默认 `~/.codex` 的认证状态；源码明确把 per-agent `CODEX_HOME` 隔离和 auth/MCP 注入留作未来改进。`reference/open-tag/src/daemon/codexRuntime.ts:128-137`

stdin/stdout 传输逐行 JSON-RPC 2.0。client 为每个 request 分配 id、维护 pending map，并把 stdout 按换行缓冲后分流为 response、server request、notification。`reference/open-tag/src/daemon/codexRuntime.ts:26-62`

启动后先 request `initialize`，声明 clientInfo 为 `open-tag` 且 `experimentalApi: true`，再 notify `initialized`。`reference/open-tag/src/daemon/codexRuntime.ts:161-165`

### 4.2 权限语义

Codex 没有使用 CLI 权限 flag，而是在 JSON-RPC server request 层自动批准：

- command execution、file change、generic permission request 返回 `{ decision: "accept" }`；
- MCP elicitation 返回 `{ action: "accept", content: null, _meta: null }`；
- 未识别的 server request 返回 JSON-RPC `-32601`。

处理逻辑见 `reference/open-tag/src/daemon/codexRuntime.ts:64-74`。所以 Codex 的“全权限”与 Claude/OpenCode 的 flag 不是同一种机制。

### 4.3 system prompt、模型与 session 恢复

Codex 的模型、system prompt、session 恢复都不走 CLI 参数，而走 JSON-RPC：

- 有已存 session id 时先调用 `thread/resume`，传 `threadId`、`cwd`、`model`、`developerInstructions: systemPrompt` 和可选 config。`reference/open-tag/src/daemon/codexRuntime.ts:167-170`
- resume 失败会 warn，并自动回退到 `thread/start` 新建线程。`reference/open-tag/src/daemon/codexRuntime.ts:167-176`
- 新线程同样传 `developerInstructions: systemPrompt`，并设置 `persistExtendedHistory: true`、`experimentalRawEvents: false`。`reference/open-tag/src/daemon/codexRuntime.ts:173-175`
- 返回 thread id 的提取兼容 `threadId` / `thread.id` / `thread_id` / `id` 四种形态；成功后调用 `onSession`。`reference/open-tag/src/daemon/codexRuntime.ts:10-12`，`reference/open-tag/src/daemon/codexRuntime.ts:177-180`

`reasoningEffort` 白名单是 `none | minimal | low | medium | high | xhigh`；线程 start/resume 的 config 使用 `model_reasoning_effort`，每次 `turn/start` 又传 `effort`。`reference/open-tag/src/daemon/codexRuntime.ts:9-24`，`reference/open-tag/src/daemon/codexRuntime.ts:166-175`

### 4.4 deliver、输出流与退出

每次 `deliver` 先进入 adapter 队列。只有 thread ready、当前没有 busy turn 时才发送 `turn/start`；收到 turn done 后再 pump 下一项，因此 Codex adapter 自己保证逐轮串行。`reference/open-tag/src/daemon/codexRuntime.ts:142-159`，`reference/open-tag/src/daemon/codexRuntime.ts:199`

输出解析兼容两套通知协议：

- `codex/event` 或 `codex/event/*` 走 legacy 映射；
- 否则在看见 `turn/*`、`thread/started` 或 `item/*` 后判定为 raw 协议。

协议选择见 `reference/open-tag/src/daemon/codexRuntime.ts:77-85`。

raw 协议会过滤其他 thread 的事件；`turn/started` / `turn/completed` 驱动 activity 与队列；完成的 agentMessage/plan、reasoning、tool item 映射为 trajectory。token delta 与 command output delta 被有意忽略，避免 UI timeline 每个 delta 一行。`reference/open-tag/src/daemon/codexRuntime.ts:87-113`

legacy 协议映射 `task_started`、`agent_message`、`exec_command_begin`、`patch_apply_begin`、`task_complete` 与 `turn_aborted`。`reference/open-tag/src/daemon/codexRuntime.ts:116-125`

spawn error 会拒绝全部 pending request、上报 offline 与 `onExit(1)`；进程 exit 同样关闭 pending 并 `onExit(code)`。`stop()` 发送 `SIGTERM`。`reference/open-tag/src/daemon/codexRuntime.ts:188-199`

另有一个需在 Wave 2 验证/修正的边界：初始化异常或 `thread/start` 返回空 thread id 时，异步初始化分支只上报 offline 后 return，没有在该分支主动 kill app-server 或调用 `onExit`；若子进程没有自行退出，逻辑 agent 可能保持在 running map 中。`reference/open-tag/src/daemon/codexRuntime.ts:177-185`，`reference/open-tag/src/daemon/agentManager.ts:183-192`

## 5. OpenCode adapter

### 5.1 进程与完整 argv

OpenCode 不是持续进程：每个 turn 新 spawn 一次 `opencode run`，各次运行靠捕获到的 session id 串起来。逻辑 session 自己维护串行 queue。`reference/open-tag/src/daemon/opencodeRuntime.ts:1-3`，`reference/open-tag/src/daemon/opencodeRuntime.ts:82-90`

基础参数为：

```text
opencode run --format json --dangerously-skip-permissions --dir <cwd>
```

可选参数：

- `model` 非空且不等于字符串 `default` 时追加 `--model`；
- 任意非空 `runtimeConfig.reasoningEffort` 作为 `--variant`，当前无白名单；
- 有 session id 时追加 `--session`；
- 本轮消息作为 argv 最后一项，不写 stdin。

参数构造见 `reference/open-tag/src/daemon/opencodeRuntime.ts:20-24`，`reference/open-tag/src/daemon/opencodeRuntime.ts:71-80`。

stdin 被强制设为 `ignore`。源码注释说明，在其验证过的 OpenCode 1.15.5 上，pipe/non-TTY stdout 搭配 piped stdin 会永久阻塞，因此 headless adapter 必须把消息放在 argv 并关闭 stdin；这属于源码作者的版本化声明，本次未运行 CLI 独立复验。`reference/open-tag/src/daemon/opencodeRuntime.ts:5-11`，`reference/open-tag/src/daemon/opencodeRuntime.ts:115-118`

环境会复制 `opts.env`、强制 `PWD=opts.cwd`，并删除 `NODE_OPTIONS`，避免某些代理参数令 bundled CLI 拒绝启动。`reference/open-tag/src/daemon/opencodeRuntime.ts:93-100`

### 5.2 权限与 system prompt

权限通过固定的 `--dangerously-skip-permissions` 实现；源码注释说明 headless 运行若没有它会等待审批。`reference/open-tag/src/daemon/opencodeRuntime.ts:5-11`，`reference/open-tag/src/daemon/opencodeRuntime.ts:71-78`

system prompt 通过原生项目发现机制注入：adapter 直接把 prompt 写到 `{cwd}/AGENTS.md`。写失败只 warn，运行仍继续；成功则覆盖同名文件，没有备份、合并或退出清理。`reference/open-tag/src/daemon/opencodeRuntime.ts:93-102`

当前 `cwd` 是每 agent 隔离目录，所以不会直接覆盖用户项目根的 `AGENTS.md`；如果 Wave 2 改变 cwd 语义，这个事实会立刻改变。`reference/open-tag/src/daemon/agentManager.ts:156-166`，`reference/open-tag/src/daemon/agentManager.ts:208-211`

### 5.3 输出流与 session 恢复

构造 logical session 时先采用 `opts.sessionId`；若已有 id，会立即 `onSession`，随后把 `initialPrompt` 入队。每轮 spawn 都加 `--session <id>`。`reference/open-tag/src/daemon/opencodeRuntime.ts:89-103`，`reference/open-tag/src/daemon/opencodeRuntime.ts:112-117`

stdout 按换行缓冲逐条解析 JSON，process exit 时会补处理最后一个没有换行的尾行。顶层 `sessionID` 一旦出现或变化，adapter 更新本地 id 并调用 `onSession`，下一轮使用新 id。`reference/open-tag/src/daemon/opencodeRuntime.ts:40-45`，`reference/open-tag/src/daemon/opencodeRuntime.ts:122-138`，`reference/open-tag/src/daemon/opencodeRuntime.ts:149-150`

事件映射：

- `step_start` → working；
- `text` → text trajectory；
- `reasoning` → thinking trajectory；
- `tool_use` → tool trajectory 与输入摘要；
- 顶层 `error` → 提取错误文本。

映射见 `reference/open-tag/src/daemon/opencodeRuntime.ts:40-68`。源码特别注明模型错误可能仍以进程退出码 0 结束，所以 error event 不能只靠 exit code 判断。`reference/open-tag/src/daemon/opencodeRuntime.ts:62-66`

stderr 只保留约 4096 字尾部。首轮 spawn/非零退出失败会 `onExit`；一旦曾经成功，后续单轮失败只显示 error 并继续 pump，让 logical session 保持可重试。exit 0 被视为本轮完成，activity 设为 online 并处理下一项。`reference/open-tag/src/daemon/opencodeRuntime.ts:139-159`

这带来一个已能从控制流确认的状态覆盖问题：顶层 `error` event 先上报 `activity=error`，但 OpenCode 若按源码注释所述以 code 0 退出，随后 exit handler 又上报 `activity=online`，最终 UI 很可能只保留 online；错误文本仍留在 trajectory。`reference/open-tag/src/daemon/opencodeRuntime.ts:62-66`，`reference/open-tag/src/daemon/opencodeRuntime.ts:125-132`，`reference/open-tag/src/daemon/opencodeRuntime.ts:149-156`

`stop()` 标记整个 logical session stopped，并对当前子进程发 `SIGTERM`；之后的 enqueue 会被忽略。`reference/open-tag/src/daemon/opencodeRuntime.ts:105-109`，`reference/open-tag/src/daemon/opencodeRuntime.ts:162-175`

## 6. 三条路径对照

| 维度 | Claude Code | Codex | OpenCode |
|---|---|---|---|
| OS process 模型 | 一条 session 一个持续 CLI 进程 | 一条 session 一个持续 app-server | 一条 logical session，多次 one-shot CLI 进程 |
| deliver | 直接写 stream-json stdin；adapter 无 busy queue | 入队后逐个 `turn/start` | 入队后每轮新 spawn |
| system prompt | `.claude-system-prompt.md` + append flag，失败退 inline | JSON-RPC `developerInstructions` | 覆盖 `{cwd}/AGENTS.md` |
| session 恢复 | `--resume`，消息也带 `session_id` | `thread/resume`，失败自动 `thread/start` | 每轮 `--session` |
| 输出协议 | Claude stream-json NDJSON | JSON-RPC NDJSON，兼容 raw/legacy notifications | `--format json` NDJSON events |
| 无交互权限/审批机制 | skip flag + bypass mode | 自动 accept approval RPC | skip flag |
| 当前稳定标记 | 非 experimental | experimental | experimental |

进程/投递事实：`reference/open-tag/src/daemon/claudeRuntime.ts:59-71`，`reference/open-tag/src/daemon/codexRuntime.ts:128-159`，`reference/open-tag/src/daemon/opencodeRuntime.ts:82-118`。提示与恢复事实：`reference/open-tag/src/daemon/claudeRuntime.ts:39-50`，`reference/open-tag/src/daemon/codexRuntime.ts:167-175`，`reference/open-tag/src/daemon/opencodeRuntime.ts:71-100`。权限事实：`reference/open-tag/src/daemon/claudeRuntime.ts:30-34`，`reference/open-tag/src/daemon/codexRuntime.ts:64-74`，`reference/open-tag/src/daemon/opencodeRuntime.ts:71-78`。

## 7. 已核实的共性缺口

### 7.1 “模块即 MCP 工具”尚未在 adapter 层接通

三条 adapter 当前都没有从 `StartOpts` 接收结构化 MCP server 配置，也没有在其 spawn/thread 参数中显式注册 Kith-space MCP server：Claude 的参数构造只覆盖输出/输入、权限、prompt、model、effort、resume；Codex 源码直接注明 per-agent auth/MCP injection 是 future improvement；OpenCode 的参数只覆盖 format、权限、cwd、model、variant、session 与 message。`reference/open-tag/src/daemon/runtime.ts:20-28`，`reference/open-tag/src/daemon/claudeRuntime.ts:24-40`，`reference/open-tag/src/daemon/codexRuntime.ts:128-175`，`reference/open-tag/src/daemon/opencodeRuntime.ts:71-100`

因此，设计文档中的“任务模块包成 MCP server”还需要一层 runtime-specific bootstrap，不能仅靠现有 `Runtime.start` 自动成立。

### 7.2 token 预算没有数据契约

`RuntimeCallbacks` 只有 session、activity、trajectory、exit 与 log；trajectory 也没有 usage 字段。当前三条 parser 都没有向上层保留 prompt/completion token 或 cost。`reference/open-tag/src/daemon/runtime.ts:5-18`

这与 Wave 2 的“每任务 token 预算”护栏直接相关：现有回调链能显示轨迹，但不能按任务可靠记账。架构提案目前假定用量可由 `onActivity` / `onTrajectory` 上报，并据此判断三护栏不需要修改 runtime/daemon 协议；源码现状不支持这个前提。`docs/kith-space/architecture-proposal.md:197-205` 因此 Wave 2 要么增加结构化 usage 契约并上报，要么明确缩减 v1 token 预算的验收口径；不能直接按当前提案实施。

### 7.3 权限策略是三套硬编码机制

Claude/OpenCode 靠危险 flag，Codex 靠自动接受 JSON-RPC approval；公共接口没有 permission mode。这意味着不能通过简单地统一一个 CLI flag 来收敛权限，且未来 Codex 新增 approval method 时，当前实现会走 unhandled `-32601`。`reference/open-tag/src/daemon/runtime.ts:20-28`，`reference/open-tag/src/daemon/claudeRuntime.ts:30-34`，`reference/open-tag/src/daemon/codexRuntime.ts:64-74`，`reference/open-tag/src/daemon/opencodeRuntime.ts:71-78`

### 7.4 prompt 文件注入依赖 cwd 隔离

Claude 覆盖固定隐藏文件，OpenCode 覆盖 `AGENTS.md`。当前之所以不污染用户项目，是因为 cwd 指向 daemon 的 per-agent data dir；若 Kith-space 为了“工作区根植文件夹”把 runtime cwd 直接改成用户工作区根，这两个写入就会进入用户目录。`reference/open-tag/src/daemon/claudeRuntime.ts:46-50`，`reference/open-tag/src/daemon/opencodeRuntime.ts:93-100`，`reference/open-tag/src/daemon/agentManager.ts:156-166`

### 7.5 两个失败分支的终态不可靠

Codex 初始化失败/拿不到 thread id 时没有显式结束 app-server 或 `onExit`；OpenCode 顶层 error 后若进程 code 0，error activity 会被 online 覆盖。两者都说明“进程退出码”和“模型 turn 结果”需要分别建模。`reference/open-tag/src/daemon/codexRuntime.ts:177-185`，`reference/open-tag/src/daemon/opencodeRuntime.ts:125-156`

## 8. Wave 2 改动建议

以下为实施建议，不是当前源码事实。

### 8.1 接入任务 MCP：先定义公共 bootstrap 输入，再逐 runtime 适配

建议把“任务 MCP server 如何启动/连接”视为 runtime adapter 的输入，而不是写进 agent 角色 prompt。实施顺序：

1. 先核实并锁定三条 CLI 的受支持 MCP 配置入口与兼容版本；不要假设它们共享同一 flag。
2. 在 `StartOpts` 增加最小、结构化的 MCP bootstrap 描述（例如 server 名、transport、command/args/env 或 endpoint），不要把三种 CLI 的原生配置混进任务模块。
3. 每个 adapter 只负责把同一份逻辑配置翻译为本 runtime 的原生配置；任务 MCP 的鉴权令牌继续用专用 env/短期凭证，不放 system prompt。
4. 为每条路径做“启动后能列出任务工具并完成一次只读调用”的契约测试，之后再开放有副作用的工具。

当前 Codex 明确复用用户全局 `CODEX_HOME`，且注释承认 per-agent MCP injection 尚未实现；Wave 2 不应依赖用户预先手配全局 MCP，否则 Kith-space 安装无法自包含。事实依据：`reference/open-tag/src/daemon/codexRuntime.ts:128-137`。

### 8.2 收敛为三条强路径：收敛产品面，不要先破坏持久化兼容

建议 UI/新建 agent 只展示 Claude Code、Codex、OpenCode，并把其他五条标为隐藏/unsupported；代码注册表可先保留兼容读取，避免已有 agent 的 `runtime` 字符串突然解析为 null。现有未知 runtime 会直接返回 null，上层只显示 offline。`reference/open-tag/src/daemon/runtimes.ts:26-27`，`reference/open-tag/src/daemon/agentManager.ts:146-153`

Codex/OpenCode 退出 experimental 前至少通过以下适配器契约：

- CLI 缺失与 Windows/macOS/Linux spawn；特别是当前只有 Codex 在 Windows 显式 `shell: true`。`reference/open-tag/src/daemon/claudeRuntime.ts:59`，`reference/open-tag/src/daemon/codexRuntime.ts:134-137`，`reference/open-tag/src/daemon/opencodeRuntime.ts:115-118`
- 新会话、正常恢复、过期/损坏 session id；三条恢复失败语义不同。
- stdout 任意 chunk 边界、尾行无换行、非法 JSON、stderr 噪声。
- 连续 deliver、忙时 deliver、stop during turn、CLI 意外退出。
- 固定版本的真实输出 fixture，覆盖 Claude partial messages、Codex raw/legacy notifications、OpenCode error-with-exit-0。

### 8.3 权限处理：统一策略语义，不要强行统一 flag

v1 仍可按既定决策使用全权限，但建议在公共层显式声明策略，例如 `unattended-full-access`，由三个 adapter 分别映射到自己的机制：

- Claude：skip + bypass，继续保留必要的 disallowed tools；
- Codex：只自动批准已知、被策略允许的 request；记录 method、对象与 decision；
- OpenCode：保留 headless 所需 skip flag。

不要直接删除危险 flag：源码指出 OpenCode headless 会等待审批，Claude 的工作流也按 bypass 设计；删除后可能不是“更安全地失败”，而是无人值守进程挂起。事实依据：`reference/open-tag/src/daemon/claudeRuntime.ts:30-34`，`reference/open-tag/src/daemon/opencodeRuntime.ts:5-11`。

Codex 当前连 MCP elicitation 都自动 accept 且 content 为 null。任务模块 v1 应尽量避免依赖 elicitation；将来出现外部不可逆动作时，必须接 Kith-space 审批 UI，而不是沿用这条无条件自动批准路径。事实依据：`reference/open-tag/src/daemon/codexRuntime.ts:64-74`。

### 8.4 保持 per-agent runtime cwd，不要覆盖用户工作区指令文件

建议继续区分：

- runtime state cwd：Kith-space 管理的 per-agent 隔离目录；
- 用户工作区根：作为明确的工作资源路径，通过 system prompt、工具 scope 或受控挂载暴露。

至少在 prompt 注入改造完成前，不要把 `opts.cwd` 直接切成用户项目根。OpenCode 的 `AGENTS.md` 写入尤其需要改成不会覆盖用户文件的方案；如果 CLI 只能依赖该文件，应采用 Kith-space 自有隔离 cwd，而不是做脆弱的备份/退出恢复。

### 8.5 明确 session id 是可恢复标识，不是进程存活标识

建议延续当前上层语义：sleep、stop、意外退出保留 session id；只有显式 reset 才清除。`onSession(null)` 不应在普通 `stop()` 中自动调用。当前 reset 由上层直接发 null，而三个 runtime 的 stop/exit 都不清 session。`reference/open-tag/src/daemon/agentManager.ts:67-72`，`reference/open-tag/src/daemon/claudeRuntime.ts:79-84`，`reference/open-tag/src/daemon/codexRuntime.ts:188-199`，`reference/open-tag/src/daemon/opencodeRuntime.ts:143-166`

同时为 stale session 定义统一结果：优先 resume；失败时允许创建新会话并立刻 `onSession(newId)`。Codex 已有此回退，Claude/OpenCode 尚无显式对等逻辑。`reference/open-tag/src/daemon/codexRuntime.ts:167-180`，`reference/open-tag/src/daemon/claudeRuntime.ts:39-40`，`reference/open-tag/src/daemon/opencodeRuntime.ts:93-102`

### 8.6 为任务预算增加专门 usage 通道

不要从 trajectory 文本估算 token。建议在 runtime contract 增加结构化 usage 回调或 turn-completed payload，至少带 runtime、session id、turn id、input/output/cached tokens（某 CLI 不提供时明确为 unknown）。任务层再把 turn 与 task/thread 关联并累计预算。

这项修改是 Wave 2 任务预算护栏的前置；当前接口无法可靠实现。事实依据：`reference/open-tag/src/daemon/runtime.ts:5-18`。

### 8.7 不急于扩张 `RuntimeSession`，先用契约测试固化差异

Claude 没有内部 busy queue，Codex 与 OpenCode 有串行 pump；这些差异应继续封装在 adapter 内。只有在 Wave 2 确实需要“等待本轮接受/完成”时，再把 `deliver` 改成 Promise 或增加 turn 回调，避免为统一表象重写三条已工作的协议循环。

同时先修正两条局部终态：Codex init/no-thread 失败应 teardown 并产生一次明确 exit；OpenCode 应记住本轮已见 error event，code 0 exit 时不要再把 activity 覆盖为 online。这两项都可用小型 adapter 测试固定，不需要先改公共接口。

## 9. 尚待运行验证的问题

- OpenCode 文件头关于 1.15.5 的 stdin 阻塞与权限等待是源码作者声明，本次未独立执行验证。`reference/open-tag/src/daemon/opencodeRuntime.ts:5-11`
- Claude 开启 `--include-partial-messages` 后，assistant 事件是否会重复携带累计内容；当前 parser 没有 event id 去重。`reference/open-tag/src/daemon/claudeRuntime.ts:30-33`，`reference/open-tag/src/daemon/claudeRuntime.ts:93-106`
- Codex raw/legacy method 名与 auto-approval request method 可能随 CLI 版本变化，应以固定版本 fixture 与真实 smoke test 锁定。当前兼容分支见 `reference/open-tag/src/daemon/codexRuntime.ts:64-125`。
- 三个实现都没有设置 `oneShotWake`；OpenCode 虽为每 turn 一进程，但该标记表达的是 wake prompt 语义而非进程形态，是否需要设置必须结合 daemon wake 行为另行验证。接口定义见 `reference/open-tag/src/daemon/runtime.ts:35-40`，OpenCode 定义见 `reference/open-tag/src/daemon/opencodeRuntime.ts:169-175`。
