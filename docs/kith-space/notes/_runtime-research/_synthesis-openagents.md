# openagents × 三 runtime 适配综合调研

> 调研日期：2026-07-10  
> 对照范围：`reference/openagents/packages/agent-connector`、Kith-space 三份 runtime 专项调研、open-tag 现有适配器。  
> 证据标记：**源码已证实**表示结论可由仓库内源码直接确认；**官方已证实**表示三家当前官方文档或官方协议源码明确说明，链接后的查阅日期均为 2026-07-10；**未证实**表示公开契约、当前源码或本次静态调研不足以确认。  
> 本次只做静态源码与官方资料调研，没有运行三家 CLI，也没有初始化或使用 CodeGraph。

## 结论摘要

openagents 最值得借鉴的不是某个 runtime 的完整实现，而是两层边界：`BaseAdapter` 统一处理 workspace 连接、心跳、控制事件与 per-channel 串行队列，各 runtime 子类只处理 CLI 差异；同时用 `registry.json` 统一安装、就绪检查与通用 env 映射。`reference/openagents/packages/agent-connector/src/adapters/base.js:1-15`、`reference/openagents/packages/agent-connector/src/adapters/base.js:614-763`、`reference/openagents/packages/agent-connector/src/env.js:6-12`、`reference/openagents/packages/agent-connector/src/env.js:63-107`（源码已证实）

但不能把它概括成“registry 驱动的统一 runtime adapter”：adapter class 仍由 `ADAPTER_MAP` 硬编码，三家 spawn、prompt、session、权限与 parser 也都写死在各自文件里；Claude 的 registry `launch.args` 没有成为实际命令构造的单一事实来源，Codex 的 `launch.args` 甚至是 `[null]`，OpenCode 没有 `launch` 段。`reference/openagents/packages/agent-connector/src/adapters/index.js:23-52`、`reference/openagents/packages/agent-connector/registry.json:138-155`、`reference/openagents/packages/agent-connector/registry.json:247-294`、`reference/openagents/packages/agent-connector/registry.json:675-746`（源码已证实）

对 Kith-space 两个跨 runtime 缺口的直接答案是：

1. **usage 缺口仍在契约层。** openagents 的三条 CLI 路径都已经接到包含 usage 的官方结构化输出附近，但没有一条真正解析并上送 usage：Claude 收到完整 `result` 后只取 session/error，Codex 不处理 `turn.completed`，OpenCode 明确过滤 `step_finish`。因此 openagents 没有解决我们 `runtime.ts` 缺少 usage/turn-done 的问题，只再次证明应先扩公共契约。`reference/openagents/packages/agent-connector/src/adapters/claude.js:779-811`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:365-412`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:371-390`（源码已证实）
2. **MCP 没有形成三家统一 bootstrap。** openagents 只有 Claude 的可选 `toolMode: "mcp"` 会生成临时 `--mcp-config`；默认却是 `skills`，Codex/OpenCode 都把 workspace REST token 塞进 prompt/skill 后让模型用 `curl`，不是 MCP。`registry.json` 也没有三家的 MCP 描述。`reference/openagents/packages/agent-connector/src/adapters/claude.js:32-37`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:430-436`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:573-591`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:168-179`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:169-195`（源码已证实）

## 1. openagents 如何适配三家 runtime

### 1.1 共用底座：BaseAdapter 与 registry

`BaseAdapter` 负责加入 workspace、30 秒心跳、消息/控制事件轮询、消息去重、per-channel busy queue、stop/restart 控制以及把 status/thinking/response/error 发回 workspace；不同 channel 可并行，同一 channel 串行。`reference/openagents/packages/agent-connector/src/adapters/base.js:31-36`、`reference/openagents/packages/agent-connector/src/adapters/base.js:155-229`、`reference/openagents/packages/agent-connector/src/adapters/base.js:602-695`、`reference/openagents/packages/agent-connector/src/adapters/base.js:702-763`（源码已证实）

这个抽象统一的是**产品消息调度与连接生命周期**，不是 runtime wire protocol。它没有 turn id、usage、MCP ready 或结构化 turn result 回调；子类直接在 `_handleMessage()` 中发 workspace 消息。`reference/openagents/packages/agent-connector/src/adapters/base.js:918-924`、`reference/openagents/packages/agent-connector/src/adapters/base.js:792-907`（源码已证实）

`registry.json` 为每种 agent 声明安装命令、binary、就绪检查、配置表单与 `resolve_env`；`EnvManager` 按 **agent type** 保存 `~/.openagents/env/<type>.env` 并把 `LLM_*` 映射为 provider env。它不是 per-agent 凭证隔离：同 runtime 类型的多个 agent 默认共用同一份 env 文件。`reference/openagents/packages/agent-connector/src/env.js:6-12`、`reference/openagents/packages/agent-connector/src/env.js:18-51`、`reference/openagents/packages/agent-connector/src/env.js:63-107`（源码已证实）

未配置工作目录时，openagents 为每个 agent 建立 `~/.openagents/workspaces/<safe-agent-name>`，避免 packaged daemon 从系统目录启动并提供 cwd 级隔离；这仍不等于隔离三家 runtime 的全局 auth/config/session home。`reference/openagents/packages/agent-connector/src/paths.js:454-473`（源码已证实）

### 1.2 Claude Code

#### Spawn / 调用

- 构造阶段生成 `claude -p <prompt> --output-format stream-json --verbose`，追加 system prompt、禁用会阻塞的工具，并按 channel 加 `--resume <session-id>`。`reference/openagents/packages/agent-connector/src/adapters/claude.js:401-428`（源码已证实）
- 真正 spawn 持久进程前会移除 argv prompt，补 `--input-format stream-json`，以 pipe stdin/stdout/stderr 启动；每轮向 stdin 写一条 NDJSON user message。因此一个 channel 可复用一个 Claude 子进程，而不是每条消息重新 spawn。`reference/openagents/packages/agent-connector/src/adapters/claude.js:667-702`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:863-899`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:959-999`（源码已证实）
- 官方当前确认 `claude -p` 是非交互入口，`stream-json` 是 NDJSON，streaming input 支持多轮队列；脚本/SDK 调用官方推荐 `--bare`，但 bare 会跳过用户配置/MCP/OAuth keychain。openagents 没有使用 `--bare`。（官方已证实；[Programmatic usage](https://code.claude.com/docs/en/headless)、[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）

#### 输出解析与 usage

- parser 按行解析 `assistant`、`result`、部分 `system` 与 `rate_limit_event`。assistant text 先作为 thinking 实时发出，最终再聚合成 response；tool use 变成 status。`reference/openagents/packages/agent-connector/src/adapters/claude.js:728-820`（源码已证实）
- `result` 事件完整保存在 `resultEvent` 中，代码只读取 `session_id`、`is_error` 与 `result` 文本，没有读取 `usage`、`modelUsage`、`total_cost_usd`、`subtype` 或 `num_turns`，上层也没有 usage 回调。`reference/openagents/packages/agent-connector/src/adapters/claude.js:779-811`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:963-990`（源码已证实）
- 官方当前明确：最终 result 是一次 query 的累计 usage/cost，成功和错误 result 都携带 usage；assistant message 也有逐 step usage，但并行工具消息需按 message id 去重。（官方已证实；[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)，查阅：2026-07-10）

结论：**openagents 没有解析 Claude usage；只是已经拿到了应解析的终态事件。**

#### 会话延续

- 以 `workspaceId + agentName` 为文件名，把 `channel → Claude session_id` 写入 `~/.openagents/sessions`；每个 channel 独立恢复。`reference/openagents/packages/agent-connector/src/adapters/claude.js:37-54`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:57-76`（源码已证实）
- 正常 stop 保留 session；restart 清指定 channel 的 session。resume 失败或进程首轮退出时会删旧 id、重建 channel recap 并无 resume 重试一次。`reference/openagents/packages/agent-connector/src/adapters/claude.js:100-139`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:1059-1103`（源码已证实）
- 官方推荐多会话持久化明确 session id，而不是用 `--continue` 猜最近会话。（官方已证实；[Programmatic usage：continue conversations](https://code.claude.com/docs/en/headless)、[CLI reference](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）

#### system prompt / 身份

- 使用 `--append-system-prompt` 注入 identity、workspace/channel、协作规则、mode 与 guardrail，保留 Claude 默认 prompt。`reference/openagents/packages/agent-connector/src/adapters/claude.js:407-422`、`reference/openagents/packages/agent-connector/src/adapters/workspace-prompt.js:562-589`（源码已证实）
- 这是三家里最接近官方稳定入口的做法；官方明确区分 append（保留默认工具/安全指导）与 replace。（官方已证实；[CLI reference：system prompt flags](https://code.claude.com/docs/en/cli-usage)，查阅：2026-07-10）

#### MCP

- `toolMode` 默认是 `skills`，会在工作目录写 `.claude/skills/openagents-workspace.md`，让 Claude 通过 Bash + curl 使用 workspace；只有显式 `mcp` 模式才生成 MCP config。`reference/openagents/packages/agent-connector/src/adapters/claude.js:32-37`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:430-471`（源码已证实）
- MCP 模式把 local stdio server 翻译为 `{mcpServers: {openagents-workspace: {type, command, args, env}}}`，token 通过 MCP child env `OA_WORKSPACE_TOKEN` 传入，配置写到 `~/.openagents/mcp-configs` 临时 JSON，再传 `--mcp-config`；消息处理结束后删除临时文件。`reference/openagents/packages/agent-connector/src/adapters/claude.js:522-591`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:1174-1176`（源码已证实）
- 没有加 `--strict-mcp-config`，所以用户/项目已有 MCP 仍可能一并加载；也没有解析 `system/init` 来确认预期 server/tools ready。官方提供 `--strict-mcp-config`，且 `system/init` 会报告 tools 与 MCP servers。（官方已证实；[CLI reference](https://code.claude.com/docs/en/cli-usage)、[Programmatic usage](https://code.claude.com/docs/en/headless)，查阅：2026-07-10）

#### 认证 / env / 隔离

- registry 就绪检查支持 `ANTHROPIC_API_KEY`、`~/.claude/sessions`、keychain service 与 `claude --print hi`；实际 child env 基于 agent env，但删除大部分 `CLAUDE_*`/harness 标记，并为第三方 Anthropic-compatible endpoint 补 Bearer auth 兼容。`reference/openagents/packages/agent-connector/registry.json:144-155`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:1005-1045`（源码已证实）
- 没有为每个 agent 设置 `CLAUDE_CONFIG_DIR`，所以仍复用用户默认 `~/.claude` 的 credentials/config/session state；只有 cwd 与 openagents 自己的 session 映射隔离。官方确认 Linux/Windows 的 credentials 会随 `CLAUDE_CONFIG_DIR` 切换，但切换目录后如何无缝复用用户既有 OAuth 仍需单独认证设计，不能把“换目录”写成无成本隔离。（官方已证实；[Authentication](https://code.claude.com/docs/en/team)、[External session storage](https://code.claude.com/docs/en/agent-sdk/session-storage)，查阅：2026-07-10；OAuth 复用方案**未证实**）
- skills 模式把 workspace token 写入 SKILL.md；MCP 模式只放 child env。前者会把凭证落盘并暴露给模型上下文，安全性明显更差。`reference/openagents/packages/agent-connector/src/adapters/claude.js:451-468`、`reference/openagents/packages/agent-connector/src/adapters/workspace-prompt.js:155-186`（源码已证实）

#### 权限、生命周期与错误

- execute 模式固定 `--dangerously-skip-permissions`，plan 模式用 `--permission-mode plan` 与只读 allowlist；另显式禁用 AskUserQuestion/本地调度工具。`reference/openagents/packages/agent-connector/src/adapters/claude.js:419-422`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:442-449`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:514-520`（源码已证实）
- 每个持久进程有 1 小时 idle 回收、静默 watchdog、跨平台进程树停止；watchdog 在 tool use 后暂停，5 分钟无 stdout 才杀进程。`reference/openagents/packages/agent-connector/src/adapters/claude.js:46-49`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:594-660`（源码已证实）
- 错误 result 会保留具体错误文本；stale session、prompt too long、auth error 都有分支，但仍没有结构化 turn status，任何 `result.subtype` 的差异都被丢掉。`reference/openagents/packages/agent-connector/src/adapters/claude.js:786-796`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:1090-1148`（源码已证实）

### 1.3 Codex

#### Spawn / 调用

- 主路径每条消息 spawn 一次 `codex exec [resume <thread-id>] --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check`，可加 model 与 `-C workingDir`；prompt 通过 stdin 写入并立即关闭。`reference/openagents/packages/agent-connector/src/adapters/codex.js:279-315`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:338-363`（源码已证实）
- 这与 open-tag 不同：open-tag 已采用常驻 `codex app-server --listen stdio://`。官方把 `exec` 定位为脚本/CI 的 non-interactive 路径，而 app-server 更适合深度产品集成、持续事件、审批与 MCP 状态，因此 Kith-space 应保留 open-tag 主路径。（官方已证实；[Non-interactive mode](https://developers.openai.com/codex/noninteractive/)、[Codex App Server](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- 若 Codex CLI 不可用或 endpoint 不是 OpenAI native，adapter 可能绕过 Codex runtime，直接调用 OpenAI-compatible `/chat/completions`；这条 fallback 没有 Codex agent loop、MCP、sandbox 或工具能力，并用一个 adapter 全局 history 数组跨 channel 复用。`reference/openagents/packages/agent-connector/src/adapters/codex.js:52-84`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:459-489`（源码已证实）

#### 输出解析与 usage

- parser 只处理 `thread.started`、部分 `item.completed` 与 `turn.failed`；agent message 作为 thinking 后聚合，command/file change 作为 status。`turn.failed` 仅写日志，没有成为结构化失败。`reference/openagents/packages/agent-connector/src/adapters/codex.js:365-412`（源码已证实）
- 它完全不处理 `turn.completed`，因此丢掉其中的 `usage.input_tokens`、`cached_input_tokens`、`output_tokens`、`reasoning_output_tokens`。官方当前 non-interactive JSONL 示例明确给出该结构。（官方已证实；[Non-interactive mode：JSONL output](https://developers.openai.com/codex/noninteractive/)，查阅：2026-07-10）
- open-tag 的 app-server 主路径则应消费 `thread/tokenUsage/updated`，而不是照搬 exec parser；官方 app-server 同时提供 `turn/completed` 的 completed/interrupted/failed 终态。（官方已证实；[Codex App Server：turn events](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

结论：**openagents 没有解析 Codex usage，且连 exec 路径最明确的 `turn.completed.usage` 都未处理。**

#### 会话、prompt、MCP

- 以 `channel → thread_id` 写入 `~/.openagents/sessions/*_codex.json`；resume 非零退出时清 id 后重试 fresh。`reference/openagents/packages/agent-connector/src/adapters/codex.js:43-50`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:91-110`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:290-329`（源码已证实）
- 每一轮都把 identity/workspace/REST instructions 与用户消息拼成一个普通 prompt；没有使用 Codex app-server 的 `developerInstructions`。`reference/openagents/packages/agent-connector/src/adapters/codex.js:168-179`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:287-288`（源码已证实）
- 没有 MCP bootstrap。workspace 工具通过 prompt 中的 curl 指令使用，token 被直接拼入 auth header 文本。`reference/openagents/packages/agent-connector/src/adapters/workspace-prompt.js:155-186`（源码已证实）
- 官方支持 stdio/Streamable HTTP MCP、required、tool allowlist、startup/tool timeout；app-server 还有 startup status 与 status list。一次性 `--config/-c` 支持 dot notation，可在 spawn 时注入 `mcp_servers.*`，无需写用户 config。（官方已证实；[Codex MCP](https://developers.openai.com/codex/mcp/)、[Advanced configuration](https://developers.openai.com/codex/config-advanced/)、[Codex App Server](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）

#### 认证 / env / 权限 / 生命周期

- registry 支持 API key + base URL 或 `codex login status`；`resolve_env` 把通用 key/base/model 映射为 OpenAI/Codex env。`reference/openagents/packages/agent-connector/registry.json:252-294`（源码已证实）
- child 继承完整 agent env，没有设置 per-agent `CODEX_HOME`，因此复用用户默认 auth/config/sessions/skills/MCP；只有 workingDir 和 openagents 自己的 thread map 分开。`reference/openagents/packages/agent-connector/src/adapters/codex.js:279-285`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:338-347`（源码已证实）
- 官方确认 `CODEX_HOME` 覆盖 config、auth、logs、sessions、skills 等，而且目录必须预先存在；是否隔离应成为显式产品策略，不应由 adapter 偶然继承。（官方已证实；[Environment variables](https://developers.openai.com/codex/environment-variables/)，查阅：2026-07-10）
- 固定危险 bypass 关闭审批和 sandbox；官方只建议在外部硬化环境使用，并推荐自动化优先选明确 sandbox。`reference/openagents/packages/agent-connector/src/adapters/codex.js:300-312`（源码已证实）；[CLI reference](https://developers.openai.com/codex/cli/reference/)（官方已证实，查阅：2026-07-10）
- stop 有跨平台进程树终止；正常完成主要依赖 process exit + 是否聚合出文本，业务 turn 终态与 OS process 终态没有分开。`reference/openagents/packages/agent-connector/src/adapters/codex.js:216-249`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:423-452`（源码已证实）

### 1.4 OpenCode

#### Spawn / 调用

- 每条消息 spawn 一次 `opencode run --format json --dir <agentHome> --model <provider/model> [--session <id>]`；prompt 通过 stdin 写入并关闭。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:634-687`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:722-730`（源码已证实）
- 对 Windows 优先找 native binary，避免 `.cmd`/console 触发 TUI；固定 5 分钟 timeout。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:25-27`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:202-264`（源码已证实）
- registry 固定安装 `opencode-ai@1.17.11`，adapter 设 `1.17.0` floor、`1.17.11` tested max，并对更高版本 degraded 放行。这是三家中版本 gate 最明确的一条。`reference/openagents/packages/agent-connector/registry.json:688-695`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:29-45`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:802-835`（源码已证实）

#### 输出解析与 usage

- parser 能从任意 chunk 中抽取拼接/不完整 JSON 对象，不依赖换行；tool 变 status，text/reasoning 变 thinking，error 结合 stdout/stderr/exit code 分类。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:319-365`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:393-464`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:738-786`（源码已证实）
- `_extractTextFromEvent` 明确把 `step_finish` 当 control event 丢弃，没有读取 `part.cost` 或 `part.tokens`。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:371-390`（源码已证实）
- 官方当前 `run.ts` 会把 `step-finish` 发成 `step_finish`；官方生成类型的 `StepFinishPart` 包含 `cost` 与 input/output/reasoning/cache read/cache write tokens。（官方已证实；[官方 run.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)、[官方生成类型](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)，查阅：2026-07-10）

结论：**openagents 没有解析 OpenCode usage；它甚至为了避免把 control JSON 当回复而显式跳过了承载 usage 的事件。**

#### 会话与身份

- 在 `~/.openagents/agents/<agentName>/sessions.json` 持久化 channel → OpenCode session id，每轮 `--session` 恢复。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:81-137`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:514-535`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:652-661`（源码已证实）
- 只有新 session 才把 system context 拼在首条 user prompt 前；resume 后只发用户 content。该内容没有通过原生 system/agent config 注入。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:652-661`（源码已证实）
- 同时在 agentHome 写 `.opencode/skills/openagents-workspace.md`，其中含 workspace API 与 token；这是 cwd 级隔离，但凭证会落盘并进入模型可读文件。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:166-195`、`reference/openagents/packages/agent-connector/src/adapters/workspace-prompt.js:639-669`（源码已证实）
- 官方提供 `OPENCODE_CONFIG_CONTENT` inline runtime override 与 `--agent`，可注入固定内部 execution agent 的 prompt，不必把 Kith 身份伪装成第一条 user message或写用户 `AGENTS.md`。（官方已证实；[Config](https://opencode.ai/docs/config/)、[CLI](https://opencode.ai/docs/cli/)，查阅：2026-07-10）

#### MCP、认证、权限与生命周期

- 没有 MCP bootstrap，也没有使用 `OPENCODE_CONFIG_CONTENT`。官方 inline config 可定义 local/remote MCP；local 用 command array/cwd/environment，remote 用 url/headers/oauth。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:634-680`（源码已证实）；[Config](https://opencode.ai/docs/config/)、[MCP servers](https://opencode.ai/docs/mcp-servers/)（官方已证实，查阅：2026-07-10）
- `agentHome` 只作为 cwd/project root；credential probe 仍读用户全局 `~/.local/share/opencode/auth.json` 与全局 config。没有已实现的 per-agent OpenCode auth/data home 隔离。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:81-87`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:881-907`（源码已证实）
- registry 强制表单填写 `LLM_API_KEY` 和 `LLM_MODEL`，只把通用 key/base/model 映射到 OpenAI-compatible env；这与 OpenCode 官方支持 `opencode auth login` 和多 provider 的能力不完全一致。`reference/openagents/packages/agent-connector/registry.json:701-746`（源码已证实）；[OpenCode CLI：auth](https://opencode.ai/docs/cli/#auth)（官方已证实，查阅：2026-07-10）
- command 没有 `--auto`，所以 adapter 未显式实现无人值守批准策略。官方当前 `--auto` 只自动批准原本会 ask 的请求，explicit deny 仍生效；不加 auto 的 non-interactive 行为不应被当作“全自动全权限”。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:644-656`（源码已证实）；[Permissions](https://opencode.ai/docs/permissions/)（官方已证实，查阅：2026-07-10）
- 生命周期实现较扎实：等 `close` 而非 `exit` 确保 pipe drained；区分 signal/timeout、非零退出、error+exit 0、空 response，并对诊断做 secret redaction。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:733-786`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:910-949`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:1014-1101`（源码已证实）

## 2. openagents vs open-tag vs 官方推荐

| 能力点 | openagents | open-tag（Kith-space 底座） | 官方当前推荐 / 谁更干净 / 可借鉴点 |
|---|---|---|---|
| adapter 注册与安装 | registry 统一 install/readiness/env，但 class 与 runtime protocol 仍硬编码。`reference/openagents/packages/agent-connector/registry.json:111-155`、`reference/openagents/packages/agent-connector/registry.json:221-294`、`reference/openagents/packages/agent-connector/registry.json:675-746`、`reference/openagents/packages/agent-connector/src/adapters/index.js:23-52` | 运行时注册表较小，强路径已收敛到三家；安装/ready 元数据不如 openagents 集中。`docs/kith-space/notes/runtime-adapters-current-state.md:77-83` | **openagents 的运维元数据更干净**。借 registry schema，但不要把 adapter module/协议伪装成纯配置可替换。 |
| 消息并发与背压 | BaseAdapter 做 per-channel 串行、跨 channel 并行与 queue cancel。`reference/openagents/packages/agent-connector/src/adapters/base.js:702-763` | Codex/OpenCode 有 pump；Claude 直接写 stdin、缺 busy queue。`docs/kith-space/notes/runtime-adapters-current-state.md:124-138`、`docs/kith-space/notes/runtime-adapters-current-state.md:177-194`、`docs/kith-space/notes/runtime-adapters-current-state.md:229-249` | **openagents BaseAdapter 更完整**。把 queue/turn correlation 放公共调度层，wire parser 留在 adapter。 |
| Claude 进程模型 | 每 channel 长连接 streaming input，1 小时 idle 回收。`reference/openagents/packages/agent-connector/src/adapters/claude.js:667-702`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:959-999` | 每 logical session 一个持久 Claude process。`docs/kith-space/notes/runtime-adapters-current-state.md:124-138` | 两者方向都符合官方 streaming input；**openagents 多了 queue/watchdog/idle policy**。 |
| Codex 进程模型 | 每消息 `codex exec --json`，另有非 Codex 的直连 chat/completions fallback。`reference/openagents/packages/agent-connector/src/adapters/codex.js:279-338`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:459-555` | 常驻 app-server + JSON-RPC，多轮 thread。`docs/kith-space/notes/runtime-adapters-current-state.md:142-194` | 官方产品嵌入更偏 app-server；**open-tag 更干净**。不要引入 direct API fallback，它会改变 runtime 语义。 |
| OpenCode 进程模型 | 每 turn one-shot `opencode run --format json`，版本 pin/gate 完整。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:29-45`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:634-687` | 同为 one-shot CLI。`docs/kith-space/notes/runtime-adapters-current-state.md:198-249` | 官方还提供 `serve` + HTTP/attach 避免 MCP cold start。短期保留 one-shot，**借 openagents 版本 gate 与 close/error 分类**；中期评估 serve。 |
| 输出 parser | Claude/Codex 只覆盖少量事件；OpenCode chunk parser 与错误分类较强。`reference/openagents/packages/agent-connector/src/adapters/claude.js:728-820`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:365-412`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:319-464` | Claude/Codex/OpenCode parser 更贴近各自主路径，但也有尾行、错误终态、协议漂移缺口。`docs/kith-space/notes/runtime-adapters-current-state.md:265-289` | **按 runtime 分治是对的**；公共层只统一规范化事件，不统一原始 schema。借 OpenCode 的 unknown/error/redaction 思路。 |
| token usage | 三家都没解析/上送。Claude 拿到 result、Codex 忽略 turn.completed、OpenCode丢 step_finish。`reference/openagents/packages/agent-connector/src/adapters/claude.js:779-811`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:365-412`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:371-390` | 三家也都没上送，`RuntimeCallbacks` 无 usage/turn done。`docs/kith-space/notes/runtime-adapters-current-state.md:273-277` | 三家官方都已提供。**两项目同一缺口**；先改公共契约，再分别解析。 |
| turn 终态 | 多数以 response/process exit 隐式完成；无结构化 turn status。`reference/openagents/packages/agent-connector/src/adapters/claude.js:833-855`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:423-452`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:733-786` | Codex 有 turn completed 概念但公共层不承载；OpenCode error 可被后续 online 覆盖。`docs/kith-space/notes/runtime-adapters-current-state.md:251-253` | 官方都区分业务结果和进程退出。新增 once-only `onTurnCompleted`，process exit 只作 transport/lifecycle。 |
| session 延续 | 三家都按 channel 保存 native id；Claude stale resume 会 recap+fresh retry。`reference/openagents/packages/agent-connector/src/adapters/claude.js:37-76`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:1059-1103`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:43-110`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:81-137` | 三家都已有 session id 恢复，Codex app-server 的语义最完整。`docs/kith-space/notes/runtime-adapters-current-state.md:339-343` | **openagents 的 per-channel map 与 stale fallback 值得借**，但自动 fresh 必须上报新 id/continuity loss，不能静默。 |
| 身份注入 | Claude 用官方 append；Codex 每轮把 instructions 塞 user prompt；OpenCode只首轮塞 user prompt并写 skill。`reference/openagents/packages/agent-connector/src/adapters/claude.js:407-422`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:168-179`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:287-288`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:652-661` | Claude append、Codex developerInstructions、OpenCode 覆盖 AGENTS.md。`docs/kith-space/notes/runtime-adapters-current-state.md:118-122`、`docs/kith-space/notes/runtime-adapters-current-state.md:166-175`、`docs/kith-space/notes/runtime-adapters-current-state.md:221-227` | Claude/open-tag Codex 更贴官方；OpenCode 两边都不理想。采用 runtime-native：Claude append、Codex developerInstructions、OpenCode inline execution agent/system。 |
| MCP bootstrap | 仅 Claude 可选 MCP；默认 skills。Codex/OpenCode 无 MCP，registry 无公共描述。`reference/openagents/packages/agent-connector/src/adapters/claude.js:32-37`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:522-591`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:279-315`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:634-680` | 三家都没有 Kith MCP 输入。`docs/kith-space/notes/runtime-adapters-current-state.md:267-271` | **官方能力比两项目现状完整**。定义一份公共 bootstrap，再由三 adapter 翻译；不要依赖用户预配全局 MCP。 |
| MCP ready | Claude 也不检查 init/server/tools；另两家无 MCP。`reference/openagents/packages/agent-connector/src/adapters/claude.js:728-820`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:279-315`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:634-680` | 无统一 ready gate；Codex parser 也不消费 MCP startup status。`docs/kith-space/notes/_runtime-research/claude-code.md:187-205`、`docs/kith-space/notes/_runtime-research/codex.md:211-225`、`docs/kith-space/notes/_runtime-research/opencode.md:176-184` | Claude 查 init，Codex required + startupStatus/list，OpenCode serve 查 `GET /mcp`；one-shot OpenCode ready 需 smoke，不能假装已证实。 |
| auth/state 隔离 | 有 per-agent cwd，但 env 按 runtime type 共用；三家用户 auth/state root 均未 per-agent 隔离。`reference/openagents/packages/agent-connector/src/env.js:18-51`、`reference/openagents/packages/agent-connector/src/paths.js:454-473` | per-agent cwd；Codex明确复用用户 `CODEX_HOME`，其余也主要复用本机状态。`docs/kith-space/notes/_runtime-research/claude-code.md:221-234`、`docs/kith-space/notes/runtime-adapters-current-state.md:150-154`、`docs/kith-space/notes/_runtime-research/opencode.md:186-209` | **两者都偏 MVP**。公共契约显式声明 reuse-user / managed-per-agent；Claude 有 `CLAUDE_CONFIG_DIR`、Codex 有 `CODEX_HOME`；OpenCode 是否存在完全对等的官方单变量**未证实**，不能虚构三家同构隔离。 |
| secret 处理 | MCP 模式 Claude token 用 child env；skills/curl 模式把 token写 prompt/skill；env 文件按 type 明文保存。`reference/openagents/packages/agent-connector/src/adapters/claude.js:573-589`、`reference/openagents/packages/agent-connector/src/adapters/workspace-prompt.js:155-186`、`reference/openagents/packages/agent-connector/src/env.js:43-51` | 设计上计划专用 env/短期凭证，但当前 MCP 未接。`docs/kith-space/notes/runtime-adapters-current-state.md:295-304` | **Claude MCP 子进程 env 模式可借；prompt/skill token 必须避开**。Kith MCP 凭证只进 child env/header-from-env。 |
| 权限 | Claude/Codex 固定危险 bypass；OpenCode 未加 `--auto`。`reference/openagents/packages/agent-connector/src/adapters/claude.js:442-449`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:300-312`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:644-656` | Claude/OpenCode危险 flag，Codex自动批准 JSON-RPC 请求。`docs/kith-space/notes/runtime-adapters-current-state.md:279-281` | 三家官方机制不同。统一“策略语义”而非统一 flag；v1 full access 也要显式、可审计，未来高风险模块前重评。 |
| version/capability gate | OpenCode 有 pinned/floor/tested max；Claude/Codex 主要多级找 binary，无协议 gate。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:29-45`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:802-873` | 当前三家缺系统 version/capability fixture。`docs/kith-space/notes/runtime-adapters-current-state.md:306-316`、`docs/kith-space/notes/runtime-adapters-current-state.md:351-359` | **借 OpenCode gate**，但更优是 capability smoke + fixture；Claude 可读 init capabilities，Codex app-server 可 schema/version gate。 |
| 生命周期与错误 | BaseAdapter 心跳/队列好；Claude watchdog好；OpenCode错误 taxonomy/redaction好；Codex最弱。`reference/openagents/packages/agent-connector/src/adapters/base.js:602-763`、`reference/openagents/packages/agent-connector/src/adapters/claude.js:594-660`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:910-1101` | Codex app-server 生命周期模型更强，但局部 init/turn error once guard 有缺口。`docs/kith-space/notes/runtime-adapters-current-state.md:251-253` | 组合借鉴：Base queue + Claude watchdog + OpenCode taxonomy/redaction + open-tag Codex app-server；统一结构化终态。 |

## 3. 值得借鉴的模式

### 3.1 借“控制面 registry”，不追求“协议全配置化”

把 binary、安装方式、最低/已验证版本、ready probe、支持的 auth 模式、env form 与 capability 标记放 registry；adapter class 仍保留真正的 spawn/parser/session 翻译。openagents 已证明 install/readiness/env 元数据适合配置化，但 runtime protocol 仍需要代码边界。`reference/openagents/packages/agent-connector/registry.json:111-155`、`reference/openagents/packages/agent-connector/registry.json:221-294`、`reference/openagents/packages/agent-connector/registry.json:675-746`（源码已证实）

建议 Kith-space registry 额外声明：`protocol`、`minVersion`、`testedRange`、`supports.usage`、`supports.mcpTransport`、`supports.systemPromptMode`、`supports.stateIsolation`，这些是 capability/诊断元数据，不是把 argv 全塞 JSON。

### 3.2 借 BaseAdapter 的调度边界

per-channel queue、跨 channel 并行、cancel queued、control poll 与 heartbeat 是产品层共性，应该在 runtime adapter 外围统一；Claude/Codex/OpenCode 的 NDJSON/JSON-RPC/one-shot 差异留在各自 driver。`reference/openagents/packages/agent-connector/src/adapters/base.js:614-763`（源码已证实）

Kith-space 可把这层落成 `RuntimeSupervisor`/`TurnScheduler`，而不是继续扩每个 adapter 的临时 queue。每次 deliver 先分配 Kith `turnId`，再串行投递，最终只由一次 `onTurnCompleted` 释放 queue。

### 3.3 借 Claude MCP 的“临时配置 + child env”核心，不照抄细节

openagents 已验证了正确的安全方向：runtime config 只描述 command/args，workspace token 放 MCP child env，避免 Windows argv JSON quoting。`reference/openagents/packages/agent-connector/src/adapters/claude.js:573-589`（源码已证实）

Kith-space 应把临时配置文件放自己的 per-agent runtime state 目录并限制文件权限；Claude 再加 `--strict-mcp-config`（若选择 strict policy）与 init ready 校验。不要把 token写入 SKILL.md，也不要把 openagents 自有 `mcp-server` 命令形状写进公共契约。

### 3.4 借 OpenCode 的版本 gate、流解析和错误 taxonomy

OpenCode adapter 对 concatenated JSON、partial chunk、close-after-drain、error+exit 0、timeout/signal、secret redaction 的处理比另外两条成熟。`reference/openagents/packages/agent-connector/src/adapters/opencode.js:319-365`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:733-786`、`reference/openagents/packages/agent-connector/src/adapters/opencode.js:1014-1101`（源码已证实）

应抽取的是测试策略和规范化错误类型，不是把同一 parser 强套给 Claude/Codex。三家都应保存固定版本的真实输出 fixture，并对 unknown event 计数/记录。

### 3.5 借 session map，但显式报告 continuity

三家都实现 `channel → native session/thread id`，说明产品 channel 与 runtime session 分离是合理边界。Kith-space 应持久化 `runtime + agentId + channel/threadId → nativeSessionId`，并在 stale fallback 新建 session 时发结构化 `sessionChanged({previous,current,reason:"resume_failed"})`，避免用户以为上下文无损延续。

## 4. 要避开的坑

1. **不要把 registry 说成完整配置驱动。** `ADAPTER_MAP` 和三份硬编码 adapter 才是实际协议真相；重复的 `launch.args` 反而会漂移。`reference/openagents/packages/agent-connector/src/adapters/index.js:23-52`、`reference/openagents/packages/agent-connector/registry.json:138-143`（源码已证实）
2. **不要把 skills/curl 当 MCP 等价物。** 它缺 tool schema、ready/status、tool-level permission 与短期凭证边界，还把 token 写进 prompt/skill。`reference/openagents/packages/agent-connector/src/adapters/workspace-prompt.js:155-186`（源码已证实）
3. **不要引入 Codex direct chat/completions fallback。** 这不是“另一路 Codex”，而是绕过 runtime；工具、sandbox、session、usage 语义全变，而且当前 history 非 per-channel。`reference/openagents/packages/agent-connector/src/adapters/codex.js:52-84`、`reference/openagents/packages/agent-connector/src/adapters/codex.js:459-489`（源码已证实）
4. **不要用 process exit 代替 turn result。** Claude result subtype、Codex turn completed status、OpenCode step/error/idle 都是业务协议；exit 只说明 transport/process。openagents 三条目前都没有统一 turn result（源码已证实）。
5. **不要把 per-agent cwd 误称 auth 隔离。** `~/.claude`、`CODEX_HOME`、OpenCode全局 data/auth 仍会被复用；openagents env 甚至按 runtime type 共用，不是按 agent。`reference/openagents/packages/agent-connector/src/env.js:18-51`、`reference/openagents/packages/agent-connector/src/paths.js:454-473`（源码已证实）
6. **不要固定全权限而不建模策略。** Claude/Codex 危险 bypass 与 OpenCode `--auto` 的语义并不相同；应统一 `permissionPolicy`，由 adapter 翻译并记录实际生效值。
7. **不要把 OpenCode 1.17.11 的 schema 永久化。** pin/tested range 是好事，但用户本机 runtime 会升级；应 capability smoke + fixture，而非只做 semver 比较。
8. **不要静默 fresh resume。** recap 是降级恢复，不是原会话恢复；必须上报 continuity loss，并让 task/session 账本切换 native id。
9. **不要把 usage 混进 trajectory 文本。** trajectory 面向 UI，usage 是可结算数据；需要独立结构化通道和 once-only turn completion。

## 5. 对 Kith-space Runtime 契约的最终建议

### 5.1 职责边界

建议拆为四层，避免把所有逻辑继续堆进每个 runtime 文件：

1. `RuntimeRegistry`：安装/探测/版本/capability 元数据。
2. `RuntimeSupervisor`：per-channel queue、Kith turn id、cancel、process lifecycle、统一错误与 retry policy。
3. `RuntimeDriver`：Claude/Codex/OpenCode 原生 argv/env/protocol/parser/session 翻译。
4. `RuntimeLedger`：消费 once-only `TurnCompleted`，把 usage 归属到 task/thread 并累计预算。

这比直接把 openagents `BaseAdapter` 搬进来更符合 Kith-space：我们只借职责边界，不绑定其 workspace HTTP client、消息格式或 skills/curl 协议。

### 5.2 建议的公共启动输入

```ts
type RuntimeStartOptions = {
  runtime: "claude-code" | "codex" | "opencode";
  agentId: string;
  cwd: string;
  runtimeStateDir: string;
  env: Record<string, string>;
  identity: {
    systemPrompt: string;
  };
  model?: string;
  reasoningEffort?: string;
  permissionPolicy: "plan-readonly" | "unattended-workspace" | "unattended-full-access";
  statePolicy: "reuse-user" | "managed-per-agent";
  mcpServers: McpServerBootstrap[];
};

type McpServerBootstrap = {
  name: string;
  required: boolean;
  transport:
    | { type: "stdio"; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
    | { type: "streamable-http"; url: string; headersFromEnv?: Record<string, string>; bearerTokenEnv?: string };
  enabledTools?: string[];
  disabledTools?: string[];
  startupTimeoutMs?: number;
  toolTimeoutMs?: number;
};
```

边界要求：

- `systemPrompt` 只表达身份/职责/协作协议，不承载 MCP secret 或 runtime-native config。
- `mcpServers` 是逻辑输入，不暴露 `--mcp-config`、TOML dot key 或 OpenCode JSON 等三家细节。
- `env` 是显式合成后的 child env；MCP secret 优先只放该 MCP child 所需 env。
- `statePolicy` 必须被 driver 回报为 `effectiveStatePolicy`；某 runtime 做不到时返回 capability warning，而不是假装隔离成功。

### 5.3 建议的 turn / usage 终态

```ts
type RuntimeTurnRequest = {
  turnId: string;          // Kith-space 生成，稳定关联 task/thread
  content: string;
  attachments?: RuntimeAttachment[];
};

type RuntimeUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  nativeScope: "turn" | "query" | "step" | "thread-total-delta";
};

type RuntimeTurnCompleted = {
  runtime: RuntimeStartOptions["runtime"];
  turnId: string;
  nativeSessionId?: string;
  nativeTurnId?: string;
  status: "completed" | "failed" | "interrupted" | "cancelled";
  usage?: RuntimeUsage;
  model?: string;
  stopReason?: string;
  error?: { category: string; message: string; retryable?: boolean };
  process?: { exitCode?: number; signal?: string };
};
```

推荐 callbacks：

```ts
onSessionChanged(change): void;
onRuntimeReady(info): void;
onTrajectory(event): void;
onTurnCompleted(result: RuntimeTurnCompleted): void; // 每个 turnId 恰好一次
onProcessExit(info): void;                           // 与 turn 完成分离
```

关键语义：

- `onTurnCompleted` 是预算结算和 queue release 的唯一入口，每个 `turnId` once-only。
- `onTrajectory` 可丢弃/节流，不能作为 usage 账本。
- runtime 不提供某字段时用 `undefined`，不要填 0；`nativeScope` 保留三家统计口径差异。
- process crash 且没有原生终态时，supervisor 合成一次 failed/interrupted turn，并附 process 信息。

### 5.4 三家 usage 的具体落法

#### Claude Code

- 以最终 `result.usage` 作为当前 query/turn 的结算值，读取 `input_tokens`、`output_tokens`、cache creation/read、`modelUsage`、`total_cost_usd`、`subtype` 与 `num_turns`；成功/错误 result 都结算。（官方已证实；[Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)，查阅：2026-07-10）
- openagents 已把完整 event 交给 `resultEvent`，说明改 parser 的成本不高；不要仿照它继续只取 session/error。`reference/openagents/packages/agent-connector/src/adapters/claude.js:779-811`（源码已证实）
- 若做实时预警，再消费 assistant usage，并按 message id 去重；最终账仍以 result 为准。

#### Codex

- Kith-space 主路径继续 app-server：订阅 `thread/tokenUsage/updated`，按 `threadId + turnId` 归属；在真实 fixture 验证 `last` 与 total delta 语义前，建议以 turn 前后 thread total 差值作为候选结算值，并保存 native payload 供审计。`turn/completed` 负责 status，不由 error notification抢先完成。（字段已证实；整轮差值口径需 fixture，故口径部分**未证实**；[Codex App Server](https://developers.openai.com/codex/app-server/)，查阅：2026-07-10）
- `codex exec --json` 只作为 smoke/oracle 或降级研究路径：其 `turn.completed.usage` 可直接映射 input/cached/output/reasoning output。openagents 没解析它，不应照抄。`reference/openagents/packages/agent-connector/src/adapters/codex.js:365-412`（源码已证实）；[Non-interactive mode](https://developers.openai.com/codex/noninteractive/)（官方已证实，查阅：2026-07-10）

#### OpenCode

- one-shot `run --format json` 解析每个 `step_finish.part`，按 `part.id` 去重，将 input/output/reasoning/cache read/cache write/cost 聚合到当前 Kith turn；进程 close 且未见 error 后完成 turn。（字段已证实；多 step 是增量还是累计需真实 fixture，故汇总语义**未证实**；[官方 run.ts](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)、[官方生成类型](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)，查阅：2026-07-10）
- 若中期切 `opencode serve`，直接消费 server session/message events 与原生 part schema，process exit 与 session idle/error 分离；这更适合长期 MCP ready 和多轮生命周期。（官方已证实；[OpenCode Server](https://opencode.ai/docs/server/)，查阅：2026-07-10）

### 5.5 一份 MCP bootstrap，三家翻译

#### Claude Code driver

1. 把 `McpServerBootstrap[]` 翻译为 Claude `mcpServers` JSON；stdio 的 secret 放 server `env`，HTTP 用对应 URL/header 配置。
2. 写入 Kith `runtimeStateDir` 下的临时文件，spawn 加 `--mcp-config <file>`；需要排除用户 MCP 时加 `--strict-mcp-config`。
3. 从 `system/init` 验证 expected server/tools；缺 required server 则 `onRuntimeReady` 失败，不接第一条业务 turn。

官方入口已证实：[CLI reference](https://code.claude.com/docs/en/cli-usage)、[Programmatic usage](https://code.claude.com/docs/en/headless)（查阅：2026-07-10）。openagents 已实现步骤 1/2 的 stdio 子集，但没有公共输入、strict 与步骤 3。`reference/openagents/packages/agent-connector/src/adapters/claude.js:522-591`（源码已证实）

#### Codex driver

1. 在 app-server spawn argv 用 repeatable `-c/--config` 把同一逻辑 server 翻译为 `mcp_servers.<name>.*`；复杂数组/TOML quoting 做 Windows/macOS/Linux fixture。不要调用会写持久配置的 `codex mcp add`。
2. required server 设 `required=true`，精确翻译 enabled/disabled tools、startup/tool timeout；secret 只用 env/env-var indirection。
3. initialize → thread start/resume → `mcpServer/startupStatus/updated` / `mcpServerStatus/list` 校验 ready 与工具集合，再投递首轮。

官方入口已证实：[Codex MCP](https://developers.openai.com/codex/mcp/)、[Advanced configuration](https://developers.openai.com/codex/config-advanced/)、[Codex App Server](https://developers.openai.com/codex/app-server/)（查阅：2026-07-10）。将完整新 MCP server 放入 `thread/start.config` 是否是长期稳定入口仍**未证实**，所以首选 spawn-level `-c`。

#### OpenCode driver

1. one-shot 路径把同一逻辑 server 翻译为 child-only `OPENCODE_CONFIG_CONTENT.mcp`：stdio → `{type:"local", command:[command,...args], cwd, environment, enabled:true, timeout}`；HTTP → `{type:"remote", url, headers/oauth, enabled:true, timeout}`。
2. 同一个 inline config 同时定义固定内部 execution agent 的 prompt/permission，并用 `--agent` 选择；无人值守按策略加正式 `--auto`，explicit deny 仍保留。
3. 官方 one-shot JSON 没有已文档化的 MCP ready event。短期必须在首个业务 turn 前用相同 env/config 做 MCP status/smoke；若要强 ready gate，中期采用 `opencode serve` 后用 `GET /mcp`，必要时 `POST /mcp` 动态注册。

官方入口已证实：[Config](https://opencode.ai/docs/config/)、[MCP servers](https://opencode.ai/docs/mcp-servers/)、[CLI](https://opencode.ai/docs/cli/)、[Server](https://opencode.ai/docs/server/)（查阅：2026-07-10）。one-shot 下“仅凭 inline config 即能在首条业务消息前证明 server ready”**未证实**。

## 6. 收敛决策

1. **保留 open-tag 的三条主路径，不用 openagents 替换实现：** Claude 长连接 CLI、Codex app-server、OpenCode one-shot（中期评估 serve）。openagents 的 Codex exec/direct API 路径不如底座适合 Kith-space。
2. **先扩 `runtime.ts`，再补三 parser：** 新增 runtime-neutral MCP bootstrap、permission/state policy、Kith turn id、`onRuntimeReady`、once-only `onTurnCompleted` 与结构化 usage。当前 `RuntimeCallbacks` 无 usage/turn done 是两个项目的共同根因。`docs/kith-space/notes/runtime-adapters-current-state.md:273-277`（源码调研已证实）
3. **借 openagents 的四个局部模式：** BaseAdapter 的 per-channel queue、Claude 的临时 MCP child-env、OpenCode 的 version gate/chunk parser/error taxonomy、三家的 channel→native session map。
4. **拒绝四个局部模式：** skills/curl 代替 MCP、token 写 prompt/skill、Codex direct chat/completions fallback、把 per-agent cwd 宣称为 auth/state 隔离。
5. **MCP ready 与 usage 都纳入 adapter 契约测试：** 每条强路径至少验证创建/恢复 session、Kith MCP required/ready/工具集合、一次只读工具调用、usage、成功/失败/取消终态、CLI/process crash，以及新版本 unknown event。

最终判断：openagents 提供了很好的“adapter 外围运行骨架”和若干生产化细节，但没有解决 Kith-space 最关键的 usage 与统一 MCP bootstrap；这两项必须由我们在公共 Runtime 契约中先建模，再利用三家官方入口分别翻译，不能靠 registry、prompt 或 trajectory 文本补出来。
