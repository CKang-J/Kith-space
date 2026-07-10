# OpenCode CLI runtime 对接调研

> 调研对象：OpenCode CLI（仅此一个 runtime）  
> 调研日期：2026-07-10  
> 方法：以 OpenCode 官方最新文档为主；官方文档未展开的 `run --format json` 事件细节，补查 OpenCode 官方仓库当前 `dev` 分支的 CLI 源码与生成类型。未运行本机 CLI。  
> 本地基线：只读 `reference/open-tag/src/daemon/opencodeRuntime.ts`、`reference/open-tag/src/daemon/runtime.ts`、`docs/kith-space/notes/runtime-adapters-current-state.md`、`docs/kith-space/notes/opencode-agent-model.md`。  
> 证据口径：“已证实”表示当前官方文档或官方源码明确支持；“未证实”表示官方公开资料没有给出稳定承诺，不能由本地注释或训练记忆外推。

## 结论摘要

OpenCode 当前有两条可接入路径：短期继续使用 `opencode run --format json`，每轮一进程、用 session id 延续；后续若冷启动或 MCP 初始化成本成为问题，可改为 Kith-space 管理 `opencode serve`，再用 `run --attach` 保持现有事件协议，或直接接 HTTP/SSE API。现适配器的 stdin 关闭处理仍然正确，但 prompt、usage、权限和错误终态都应按最新能力重做。

## A. 无头调用

### 我们需要什么

daemon 需要可脚本化、无 TTY、不会等输入或审批的一轮执行入口；需要能指定 cwd、把本轮消息送入 argv，并在多轮间保持可恢复会话。还需要评估“每轮 spawn”与“常驻 server”的复杂度和收益。

### 官方最新怎么提供

- `opencode run [message..]` 是官方无交互入口，明确用于 scripting/automation；`--dir` 指定目录，`--attach` 可连接已运行的 `opencode serve`，官方给出的目的就是避免每次 run 都冷启动 MCP server。（已证实；[CLI：run](https://opencode.ai/docs/cli/#run)，[Server](https://opencode.ai/docs/server/)，查阅：2026-07-10）
- `--format` 当前官方只列 `default`（格式化文本）和 `json`（raw JSON events）。没有名为 `text` 的已文档化取值，因此不能把 `--format text` 当兼容接口。（已证实；[CLI：run flags](https://opencode.ai/docs/cli/#run)，查阅：2026-07-10）
- 当前官方 `run.ts` 会在 stdin 不是 TTY 时先 `await Bun.stdin.text()`，然后再把 stdin 内容与 argv message 合并。这意味着父进程若给 child 一个保持打开的 pipe，即使消息已在 argv，CLI 也会等 EOF；关闭/忽略 stdin 是当前实现层面的必要条件。（已证实；[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，查阅：2026-07-10）
- `opencode serve` 默认监听 `127.0.0.1:4096`，暴露 OpenAPI 3.1 HTTP API和 SSE event stream；`OPENCODE_SERVER_PASSWORD` 启用 Basic Auth。`run --attach` 继续提供 CLI 的 JSON 事件外观，而直接接 server API 可绕过每轮 CLI 客户端进程。（已证实；[Server：usage/auth/spec](https://opencode.ai/docs/server/)，[CLI：run --attach](https://opencode.ai/docs/cli/#run)，查阅：2026-07-10）

### 本地适配器现状

当前每个 turn 都 spawn 一次 `opencode run`，逻辑 session 自己串行排队，靠捕获的 session id 串联。`reference/open-tag/src/daemon/opencodeRuntime.ts:1-3`、`reference/open-tag/src/daemon/opencodeRuntime.ts:82-118`

argv 固定包含 `run --format json --dangerously-skip-permissions --dir <cwd>`，消息作为最后一个 argv；stdin 明确为 `ignore`。`reference/open-tag/src/daemon/opencodeRuntime.ts:71-80`、`reference/open-tag/src/daemon/opencodeRuntime.ts:112-118`

### 差距与建议

短期保留“每轮 spawn + `--session`”，它的故障面最小且退出即天然 turn 边界；继续强制 stdin 为 `ignore`，不要改成 pipe 后只写消息而不 close。

若 smoke 数据证明 MCP 冷启动显著，再引入由 daemon 管理的 per-workspace `serve`。第一阶段可仍 spawn `opencode run --attach ... --format json`，复用现有 parser；长期若需要干净的 system prompt、动态 MCP、明确 abort/status，再直接用 HTTP/SSE。server 必须只绑 loopback、随机或受管端口、强密码，并有 health/readiness、崩溃重启和 workspace 归属。

## B. 可解析输出

### 我们需要什么

需要稳定拿到 text、thinking、tool call、错误和逐轮 token usage/cost；P1 token 护栏必须使用 runtime 的结构化用量，不能靠输出文本估算。

### 官方最新怎么提供

- `--format json` 输出逐行 JSON。当前官方实现生成 `{ type, timestamp, sessionID, ... }`，选择性发出 `step_start`、`step_finish`、`text`、`reasoning`、`tool_use`、`error`。（已证实；[CLI：raw JSON events](https://opencode.ai/docs/cli/#run)，[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，查阅：2026-07-10）
- `text` 只在 text part 完成后发；`tool_use` 只在工具状态为 completed 或 error 时发，part 内含 tool 名、call id、input 及 completed output 或 error；它不是 token/delta 级流式协议。（已证实；[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，[官方生成类型](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)，查阅：2026-07-10）
- 非交互 `run` 的 `--thinking` 默认是 false；当前实现只有显式开启时才发 `reasoning` 事件。仅仅解析 `reasoning` 分支、却不传 `--thinking`，不能保证拿到 thinking。（已证实；[CLI：`--thinking`](https://opencode.ai/docs/cli/#run)，[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，查阅：2026-07-10）
- `step_finish.part` 当前包含 `reason`、`cost` 和 `tokens`；tokens 有 `input`、`output`、`reasoning`、`cache.read`、`cache.write`。因此 OpenCode 当前 JSON run 已能给 P1 提供结构化用量。（已证实；[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，[官方 `StepFinishPart` 类型](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)，查阅：2026-07-10）
- server/SSE 的正式类型还包含 `message.updated`、`message.part.updated`、`session.status`、`session.idle`、`session.error`；assistant message 自身也带 cost 与 input/output/reasoning/cache tokens。直接接 server 比 CLI 的筛选事件更完整。（已证实；[Server：events/messages](https://opencode.ai/docs/server/)，[官方生成类型](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)，查阅：2026-07-10）

### 本地适配器现状

parser 已映射 `step_start`、`text`、`reasoning`、`tool_use` 和 `error`，但完全忽略 `step_finish`；工具只保留一段 160 字输入摘要。`reference/open-tag/src/daemon/opencodeRuntime.ts:26-68`

argv 没有 `--thinking`。`reference/open-tag/src/daemon/opencodeRuntime.ts:71-80`

公共 `TrajectoryEntry` 与 callbacks 没有 usage、cost、turn/message id 或结构化 error 通道。`reference/open-tag/src/daemon/runtime.ts:5-18`；现状缺口也已记录于 `docs/kith-space/notes/runtime-adapters-current-state.md:273-277`。

### 差距与建议

立即增加 `step_finish` 解析，并在公共 runtime contract 增加独立 `onUsage` 或 `onTurnDone({ usage, cost, result })`，至少保留 runtime、session id、message/part id、input/output/reasoning/cache read/cache write tokens 和 cost。一个 turn 可能包含多个 step，按唯一 part id 去重后汇总，fixture 必须验证“每步值”还是“累计值”，未验证前不要直接作为强制预算扣减。（汇总语义未证实）

若 UI 需要 thinking，argv 增加 `--thinking`；若只为 token 护栏，不需要暴露 reasoning 文本也能从 `step_finish.tokens.reasoning` 计量。

## C. 会话延续

### 我们需要什么

每个 Kith-space agent 需要一个可持久化的 OpenCode session id；daemon/CLI 进程退出后下一轮能继续，reset 才清空。未来还可能需要显式分叉。

### 官方最新怎么提供

- `--session/-s <id>` 继续指定 session，`--continue/-c` 继续最近 session，`--fork` 必须和其中一个搭配并先分叉再继续。（已证实；[CLI：run flags](https://opencode.ai/docs/cli/#run)，查阅：2026-07-10）
- server API 提供 create/get/list/fork/abort session，以及同步 message 和异步 `prompt_async`；session 是持久对象，不绑定某一个 `run` 客户端进程。（已证实；[Server：sessions/messages](https://opencode.ai/docs/server/)，查阅：2026-07-10）
- OpenCode 把 session/message 等项目数据保存在用户数据目录的 project storage 中；session 可跨 CLI 进程恢复。（已证实；[Troubleshooting：storage](https://opencode.ai/docs/troubleshooting/#storage)，查阅：2026-07-10）

### 本地适配器现状

构造逻辑 session 时采用已有 `opts.sessionId`，每轮事件一旦出现新的顶层 `sessionID` 就保存并回调，下一轮加 `--session`。`reference/open-tag/src/daemon/opencodeRuntime.ts:89-103`、`reference/open-tag/src/daemon/opencodeRuntime.ts:122-129`

没有 stale/损坏 session id 的自动回退，也没有 `--continue`/`--fork` 产品语义。`reference/open-tag/src/daemon/opencodeRuntime.ts:71-80`、`docs/kith-space/notes/runtime-adapters-current-state.md:282-285`

### 差距与建议

继续用显式 `--session`，不要用 `--continue` 代替：后者是“最近 session”，在多个 Kith agent/工作区并行时可能串错上下文。resume 失败应产生结构化错误；只有能确认是 session 不存在/不兼容时才新建并立即 `onSession(newId)`，不要对任意 provider 错误静默丢历史。

`--fork` 只在 Kith 产品出现“从某会话创建分支”能力时暴露，不用于普通失败恢复。

## D. 身份 / 系统提示注入

### 我们需要什么

Kith-space 定义 identity/role/memory，OpenCode 只作为执行引擎。system prompt 注入不能覆盖用户工作区的 `AGENTS.md`，也不应要求把 Kith 的角色映射成用户可见的一套 OpenCode agent。

### 官方最新怎么提供

- `opencode run` 当前没有独立 `--system-prompt` flag；官方支持 `--agent <name>`，agent 配置可含自定义 `prompt`，JSON 示例既支持直接 prompt 字符串，也支持 `{file:...}`。（已证实；[CLI：run flags](https://opencode.ai/docs/cli/#run)，[Agents：JSON/Prompt](https://opencode.ai/docs/agents/)，查阅：2026-07-10）
- `OPENCODE_CONFIG_CONTENT` 是官方的 inline JSON runtime override，优先级在 project config 与 `.opencode` 目录之后、managed config 之前；可在 child env 内定义一个固定的 Kith execution agent，而无需写用户项目文件。（已证实；[Config：precedence](https://opencode.ai/docs/config/#precedence-order)，[CLI：environment variables](https://opencode.ai/docs/cli/#environment-variables)，查阅：2026-07-10）
- server 的 `POST /session/:id/message` / `prompt_async` body 明确有可选 `system` 字段，这是当前最直接的 per-message system 注入入口。（已证实；[Server：messages](https://opencode.ai/docs/server/)，查阅：2026-07-10）
- OpenCode 也会从 rules/instructions 体系发现 `AGENTS.md`；这适合用户项目规则，不等于第三方 runtime 必须用它注入身份。（已证实；[Config：instructions](https://opencode.ai/docs/config/#instructions)，[Agents](https://opencode.ai/docs/agents/)，查阅：2026-07-10）

### 本地适配器现状

构造函数直接覆盖 `{cwd}/AGENTS.md`；写失败只 warn，仍继续运行。`reference/open-tag/src/daemon/opencodeRuntime.ts:93-102`

现阶段 cwd 是 per-agent 隔离目录，所以没有直接覆盖用户项目；一旦 cwd 改为真实 workspace 根就会污染用户文件。`docs/kith-space/notes/runtime-adapters-current-state.md:221-227`、`docs/kith-space/notes/runtime-adapters-current-state.md:283-285`

本地术语决策明确：Kith agent 是产品身份层，OpenCode agent 只可作为透明的执行配置层，不能把 leader/dev/tester 一一映射成 OpenCode primary/subagent。`docs/kith-space/notes/opencode-agent-model.md:7-26`

### 差距与建议

在 one-shot `run` 路径，用 `OPENCODE_CONFIG_CONTENT` 注入一个固定、内部命名的 primary agent（例如 `__kith_runtime__`），其 `prompt` 为本次 Kith system prompt，并用 `--agent __kith_runtime__` 选择它；所有 Kith 角色共用这一个“执行壳”，不做角色映射。这样不写 `AGENTS.md`。

若改直连 server API，则优先使用 message body 的 `system` 字段。需要用真实 fixture 验证：续接 session 时每轮重复 system 的叠加/覆盖语义，以及 system 是否进入持久 history；公开概览没有解释这两个细节，故目前未证实。

## E. 模型与推理强度

### 我们需要什么

上层要显式选择 provider/model，并把统一的 reasoning effort 映射为该模型实际支持的 variant；无效 effort 不能盲传后才在运行中失败。

### 官方最新怎么提供

- `--model/-m` 使用 `provider/model`；加载优先级是 CLI flag、config、last used、内部默认。（已证实；[Models：loading models](https://opencode.ai/docs/models/#loading-models)，[CLI：run flags](https://opencode.ai/docs/cli/#run)，查阅：2026-07-10）
- `--variant` 是 provider-specific reasoning effort。官方当前列出的常见内置值：Anthropic `high|max`；OpenAI 大致为 `none|minimal|low|medium|high|xhigh`；Google `low|high`，且明确说明列表不完整。（已证实；[Models：variants](https://opencode.ai/docs/models/#variants)，[CLI：run flags](https://opencode.ai/docs/cli/#run)，查阅：2026-07-10）
- agent config 还能透传 provider-specific model options，如 `reasoningEffort`；因此同名 effort 在不同 provider 上不是统一枚举。（已证实；[Agents：additional options](https://opencode.ai/docs/agents/#additional)，查阅：2026-07-10）

### 本地适配器现状

非 `default` 的 model 直接作为 `--model`；任意非空 `runtimeConfig.reasoningEffort` 都直接作为 `--variant`，没有 provider/model 能力校验。`reference/open-tag/src/daemon/opencodeRuntime.ts:20-24`、`reference/open-tag/src/daemon/opencodeRuntime.ts:71-78`

### 差距与建议

保留 `--model` 和 `--variant`，但把 Kith 的通用 effort 先经过 runtime-specific capability mapping；至少按 provider family 白名单，未知 provider/variant 明确回退到“未指定”，并记录实际选择。不要把 `max` 视为 OpenAI 通用值，也不要假设所有 provider 都支持 `xhigh`。

fixture 覆盖 model 不存在、provider 未认证、variant 不支持，以及 resume 后模型/variant 是否沿用或被本轮覆盖。

## F. 无人值守权限

### 我们需要什么

v1 在“单人、本机、可信内容”前提下需要无人值守；同时要能把显式 deny 保留下来，并为未来邮箱/浏览器等高风险 MCP 提供细粒度策略。

### 官方最新怎么提供

- 当前正式文档推荐 `opencode run --auto`：自动批准原本会 ask 的请求，显式 `deny` 仍然执行。（已证实；[Permissions：auto mode](https://opencode.ai/docs/permissions/#auto-mode)，[CLI：run flags](https://opencode.ai/docs/cli/#run)，查阅：2026-07-10）
- permission 支持 `allow|ask|deny`，可按 bash command、文件路径、URL、subagent、external directory 等 pattern 细分；最后匹配规则生效。默认大多 allow，但 `external_directory` 和 `doom_loop` 默认 ask，`.env` 读取默认 deny。（已证实；[Permissions](https://opencode.ai/docs/permissions/)，查阅：2026-07-10）
- 官方当前 `run.ts` 仍接受隐藏的 `--dangerously-skip-permissions`/`--yolo`，但它们与 `--auto` 归并为同一个 `auto` 布尔路径；正式 CLI flags 表只公开 `--auto`。因此危险 flag 是当前源码兼容别名，不应视为稳定公开契约。（部分已证实；[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，[CLI：run flags](https://opencode.ai/docs/cli/#run)，查阅：2026-07-10）
- 当前非交互 `run` 对未 auto 的 ask 请求会自动 reject，而不是无限等待；这是当前官方源码行为，正式文档未单独承诺其长期稳定性。（部分已证实；[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，查阅：2026-07-10）

### 本地适配器现状

固定使用 `--dangerously-skip-permissions`，公共 `StartOpts` 没有 permission policy。`reference/open-tag/src/daemon/opencodeRuntime.ts:5-11`、`reference/open-tag/src/daemon/opencodeRuntime.ts:71-78`、`reference/open-tag/src/daemon/runtime.ts:20-28`

### 差距与建议

改用正式公开的 `--auto`，并通过 `OPENCODE_CONFIG_CONTENT` 注入明确 permission rules；v1 可以表达“workspace 内常用工具 allow、question deny、external_directory deny、Kith MCP 精确 allow”。不要只依赖默认值，也不要继续把隐藏危险 flag 当唯一入口。

未来高风险模块上线时，`--auto` 只能免交互，不能替代 OS sandbox、MCP 短期凭证和工具级授权。`deny` 必须在 adapter bootstrap 中显式生成，并做 smoke 验证。

## G. MCP server 接入

### 我们需要什么

spawn runtime 时动态注册 Kith-space 自建 MCP server，不要求用户先改全局配置，不向用户项目写 `opencode.json`，凭证只通过专用 env；启动后能确认 server ready 和工具集合。

### 官方最新怎么提供

- `opencode.json` 的 `mcp` 支持 local 与 remote。local 使用 `command: string[]`，可设置 `cwd`、`environment`、`enabled`、tool discovery timeout；remote 使用 `url`、`headers`、`oauth`、`enabled`、timeout。（已证实；[MCP servers：local/remote](https://opencode.ai/docs/mcp-servers/)，查阅：2026-07-10）
- MCP tools 自动注册，并以 server 名作为工具前缀；可用 glob 在全局或 per-agent 权限/工具配置里控制。（已证实；[MCP servers：manage](https://opencode.ai/docs/mcp-servers/#manage)，[Agents：permissions](https://opencode.ai/docs/agents/#permissions)，查阅：2026-07-10）
- `OPENCODE_CONFIG_CONTENT` 可在 spawn env 注入 inline config，且处在 project config 之后，适合 session-only 添加 `mcp.kith`；env/file substitution 可避免把 secret 明文写入配置文件。（已证实；[Config：precedence/variables](https://opencode.ai/docs/config/)，[CLI：environment variables](https://opencode.ai/docs/cli/#environment-variables)，查阅：2026-07-10）
- 常驻 server 还提供 `GET /mcp` 查看状态、`POST /mcp` 动态添加 server；因此可在 health 后注册 Kith MCP 并验证状态。（已证实；[Server：LSP, Formatters & MCP](https://opencode.ai/docs/server/)，查阅：2026-07-10）
- `opencode mcp add` 是交互式向配置中添加 server 的管理命令，不是合适的每次 spawn bootstrap 接口。（已证实；[CLI：mcp add](https://opencode.ai/docs/cli/#mcp)，查阅：2026-07-10）

### 本地适配器现状

`StartOpts` 无 MCP 描述，OpenCode argv/env 构造也不注册 Kith MCP。`reference/open-tag/src/daemon/runtime.ts:20-28`、`reference/open-tag/src/daemon/opencodeRuntime.ts:71-100`；共性缺口见 `docs/kith-space/notes/runtime-adapters-current-state.md:267-271`。

### 差距与建议

给公共 runtime bootstrap 增加结构化 `mcpServers`，OpenCode adapter 翻译为 child-only `OPENCODE_CONFIG_CONTENT`：local server 使用 command/args、受控 cwd、最小 env 和合理 timeout；凭证值放 child env，配置只写 `{env:KITH_...}`。不要调用 `opencode mcp add`，不要写用户全局/项目 config。

one-shot 模式下，首个真实 turn 前做一次低成本 MCP smoke（或让第一轮本身完成只读工具调用）；serve 模式下用 `GET /mcp` 作为 ready 闸门。官方 config 是“合并而非替换”，inline 注入 Kith MCP 不会自动排除用户已有 MCP；官方没有已文档化的 `--strict-mcp-config`/`--ignore-user-config` 等价物，因此“只加载 Kith MCP、同时复用用户 auth”目前未证实。可先枚举并记录额外 MCP，安全升级阶段再设计独立配置/auth 隔离。

## H. 运行环境 / 隔离

### 我们需要什么

需要明确 cwd、PWD、child env、用户认证、session storage、项目 `.env`、全局/project config 和 MCP secret 的边界；既要复用用户已登录 provider，又不能无审计继承一切。

### 官方最新怎么提供

- `--dir` 是官方工作目录入口；当前 `run.ts` 先以 `process.env.PWD ?? process.cwd()` 解析 root，再处理 `--dir` 并 `chdir`。因此 PWD 会参与启动锚点，显式保持 PWD 与 cwd 一致是合理的兼容措施。（已证实；[CLI：run flags](https://opencode.ai/docs/cli/#run)，[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，查阅：2026-07-10）
- 配置是多源合并：remote、用户全局、`OPENCODE_CONFIG`、project `opencode.json`、`.opencode`、`OPENCODE_CONFIG_CONTENT`、managed config。cwd/project root 因而会影响项目配置和 instruction/plugin/skill 发现。（已证实；[Config：locations/precedence](https://opencode.ai/docs/config/#locations)，查阅：2026-07-10）
- auth、session/message data 和 logs 默认位于 `~/.local/share/opencode`（Windows 为 `%USERPROFILE%\.local\share\opencode`）；CLI 还会读取 provider env 和项目 `.env` 中的 key。（已证实；[CLI：auth](https://opencode.ai/docs/cli/#auth)，[Troubleshooting：storage](https://opencode.ai/docs/troubleshooting/#storage)，查阅：2026-07-10）
- `OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR`、`OPENCODE_CONFIG_CONTENT`、`OPENCODE_PERMISSION`、`OPENCODE_DISABLE_AUTOUPDATE` 等是官方 child-env 控制点；`--pure` 只承诺不加载 external plugins，不等于忽略所有用户/project config。（已证实；[CLI：global flags/environment variables](https://opencode.ai/docs/cli/#global-flags)，[Config](https://opencode.ai/docs/config/)，查阅：2026-07-10）

### 本地适配器现状

child env 基于完整 `opts.env`，强制 `PWD=opts.cwd`，删除 `NODE_OPTIONS`；spawn 同时设置 `cwd: opts.cwd`。`reference/open-tag/src/daemon/opencodeRuntime.ts:93-100`、`reference/open-tag/src/daemon/opencodeRuntime.ts:115-118`

删除 `NODE_OPTIONS` 的原因只存在于本地注释：某些代理 flag 会让 bundled CLI 拒绝启动。OpenCode 官方文档没有给出这条兼容规则，所以它仍是“本地 1.15.5 声明，官方未证实”。`reference/open-tag/src/daemon/opencodeRuntime.ts:5-11`

### 差距与建议

保持 spawn `cwd`、`PWD`、`--dir` 三者一致。把 env 从全量透传收敛为显式合成/审计，至少关注 PATH、HOME/USERPROFILE、代理、provider credentials、OpenCode config/data 控制变量和 Kith MCP token；不要把无关 secret 交给 runtime 或 MCP child。

短期复用用户数据目录以获得登录与 session persistence，但在 runtime diagnostics 中记录加载的 config/MCP/plugin 来源，并考虑 `--pure` 禁用外部 plugins。项目 `.env` 会被读取，不能把“cwd 内文件可信”当成永久安全边界。删除 `NODE_OPTIONS` 可暂留，但必须用带/不带常见代理值的 smoke test 固化原因。

## I. 生命周期

### 我们需要什么

需要分别建模 turn started、step finished、session idle、business error、process exit；一次 error 不能随后被 online 覆盖。每轮一进程时还需要明确何时释放 queue、何时把逻辑 runtime 判死。

### 官方最新怎么提供

- 当前 CLI JSON 的 `step_finish` 只是一个 step 的结束；官方 `run.ts` 实际以底层 `session.status=idle` 退出事件循环，随后本地 run 进程结束。CLI 的筛选 JSON 不转发 `session.idle`，所以 adapter 仍以进程退出作为 one-shot 完成边界。（已证实；[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，[Server：events](https://opencode.ai/docs/server/)，查阅：2026-07-10）
- 当前官方 `run.ts` 捕获 `session.error` 后会发 JSON `error`，在非 attach 的 finish 路径设置 `process.exitCode = 1`；prompt/command request 直接失败也发 error 并设置 1。（已证实；[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，查阅：2026-07-10）
- server API 有 `session.status`（busy/retry/idle）、`session.idle`、`session.error` 和 abort；常驻模式应依赖这些业务事件，不把 server process exit 当 turn done。（已证实；[Server：sessions/events](https://opencode.ai/docs/server/)，[官方生成类型](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)，查阅：2026-07-10）
- 官方文档没有承诺所有版本、所有 provider error、local 与 attach 两条路径的退出码矩阵；退出码不能成为唯一业务结果来源。（未证实；[CLI](https://opencode.ai/docs/cli/)，[Server](https://opencode.ai/docs/server/)，查阅：2026-07-10）

### 本地适配器现状

error event 立即写 error trajectory/activity；但 exit code 0 一律把 activity 改回 online。非零退出首轮会 `onExit`，曾成功后的后续失败只继续 pump。`reference/open-tag/src/daemon/opencodeRuntime.ts:122-159`

本地文件头明确声明其在 1.15.5 上观察到“模型错误可 exit 0”。`reference/open-tag/src/daemon/opencodeRuntime.ts:5-11`、`reference/open-tag/src/daemon/opencodeRuntime.ts:62-66`

### 差距与建议

每个 turn 记录 `sawErrorEvent`、step usage、exit code/signal、stderr tail。只有“未见 error 且 exit 0”才上报成功；见 error 后即使 exit 0 也保持 failed，不能再覆盖 online。非零 exit 没有 error event 时生成 process-level failure。

这不是简单相信最新 exit 1，而是同时兼容旧 1.15.5 的 error+0 与当前源码的 error+1。公共 contract 最好增加 `onTurnDone(result)`；在此之前至少修正局部状态覆盖并固定 fixture。stop during turn 要记录 aborted，不能伪装成 provider failure。

## J. 版本兼容风险

### 我们需要什么

用户本机 OpenCode 会升级，隐藏 flags、事件筛选、part schema、exit code、权限默认值和 MCP config 都可能变化。需要已验证版本区间、真实 fixture 和安装后 smoke。

### 官方最新怎么提供

- CLI 提供 `--version`；config 默认可自动更新，也可设 `autoupdate: false` 或 `OPENCODE_DISABLE_AUTOUPDATE`。Kith-space 可以记录版本并避免 adapter 会话中触发不可控自更新。（已证实；[CLI：global flags/environment variables](https://opencode.ai/docs/cli/#global-flags)，[Config：autoupdate](https://opencode.ai/docs/config/#autoupdate)，查阅：2026-07-10）
- server `GET /global/health` 返回 `{ healthy: true, version }`；常驻模式可把版本与健康检查合并。（已证实；[Server：global](https://opencode.ai/docs/server/)，查阅：2026-07-10）
- 当前正式文档只公开 `--auto`，危险 skip flag 在源码中是 hidden alias；当前 JSON reasoning 需要 `--thinking`；当前 `step_finish` 已带 tokens；当前本地 run 对 error 设置 exit 1。这些都和现适配器基于 1.15.5 的假设存在变化面。（已证实；[CLI：run](https://opencode.ai/docs/cli/#run)，[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，[官方生成类型](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)，查阅：2026-07-10）
- 官方生成 SDK types 与 server OpenAPI spec 是当前 server 协议的一手 schema；CLI 的 synthetic JSON 事件则由 `run.ts` 手工筛选，二者不能假定完全相同。（已证实；[Server：spec](https://opencode.ai/docs/server/#spec)，[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，查阅：2026-07-10）

### 本地适配器现状

文件头写明两个 gotcha “verified against opencode 1.15.5”，但 adapter 不读取/记录 CLI 版本。`reference/open-tag/src/daemon/opencodeRuntime.ts:1-11`

parser 只覆盖五类事件，没有保存 raw fixture、schema/version gate、usage 或 capability smoke。`reference/open-tag/src/daemon/opencodeRuntime.ts:32-68`、`reference/open-tag/src/daemon/opencodeRuntime.ts:122-138`

### 差距与建议

启动时记录 `opencode --version`，维护最小支持版本和已验证区间；超出区间允许带 warning 启动，但 MCP、usage、permission 等关键能力未通过 smoke 时不能标 ready。child env 设置 `OPENCODE_DISABLE_AUTOUPDATE=true`，升级由用户或 Kith 明确流程完成。

至少固定这些真实 NDJSON fixture：正常 text；带 `--thinking` 的 reasoning；completed/error tool；多个 step_finish 与 tokens/cache/cost；provider error+exit 0、error+exit 1、非 JSON stderr；stale session；stdin pipe 未 close 的防回归；MCP ready/失败；未知事件与尾行无换行。再做安装后两轮 smoke：创建 session → Kith MCP 只读 call → usage → 成功终态 → `--session` 恢复第二轮。

serve 路径另存 OpenAPI/SDK type 基线，覆盖 health/version、dynamic MCP、system prompt、SSE reconnect、session idle/error/abort 和 server crash；不要用 CLI synthetic event fixture替代 server protocol fixture。

## 对我们适配器最关键的 3 条建议

1. **先接 `step_finish` usage，再做 P1 token 护栏。** OpenCode 当前已给 input/output/reasoning/cache read/cache write tokens 与 cost，缺口在 adapter 和公共 Runtime contract；按 part id 去重、真实 fixture 验证逐步/累计语义后再强制预算。（已证实；[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，[官方生成类型](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)，查阅：2026-07-10）
2. **停止覆盖 `AGENTS.md`，把 prompt、权限和 Kith MCP 作为 child-only bootstrap 注入。** one-shot 用 `OPENCODE_CONFIG_CONTENT` + 固定内部 execution agent + `--agent`；serve 直连时用 message `system`，MCP 用 inline config 或 server `POST /mcp`，凭证只放专用 env。（能力已证实；server system 的跨轮叠加语义未证实；[Config](https://opencode.ai/docs/config/)，[Agents](https://opencode.ai/docs/agents/)，[MCP servers](https://opencode.ai/docs/mcp-servers/)，[Server](https://opencode.ai/docs/server/)，查阅：2026-07-10）
3. **以 error event + exit code 双通道判终态，并建立版本 gate/fixture/smoke。** 当前源码已从本地 1.15.5 声明的 error+0 变化为本地 run error+1；同时 `--dangerously-skip-permissions` 已是隐藏别名，正式入口应迁到 `--auto`，stdin 关闭仍必须保留。（已证实当前源码行为；旧版行为仅由本地适配器声明；[Permissions](https://opencode.ai/docs/permissions/)，[官方 `run.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/run.ts)，查阅：2026-07-10）
