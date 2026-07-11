# opencode 的 agent 概念与 Kith-space 的关系

> 调研日期：2026-07-10
> 来源：opencode 官方文档（/docs/agents、/docs/cli、/docs/）+ 本仓库适配现状 `runtime-adapters-current-state.md`
> 问题：opencode 自带一套 "agents"，我们的决策是"把 runtime 当引擎、agent 身份由 Kith-space 定义"。两层 agent 会不会打架？opencode 适不适合当 runtime？

## 一句话结论

**不冲突，opencode 适合当 runtime。** 两者是不同层级：opencode 的 "agent" 是它进程**内部**的执行配置（换 prompt/模型/工具权限的特化机制）；Kith-space 的 "agent" 是**我们产品层**的团队成员身份（identity/role/memory）。Kith-space 把 opencode 当无头执行引擎调用，一个 Kith-space agent = 一个 opencode 无头 session，**不把二者做映射**。

## opencode 的 agent 是什么

- 两类：**primary agent**（直接交互的主助手，内置 Build=全工具、Plan=只读分析，Tab 切换）与 **subagent**（primary 可自动调用、或用户 @ 调用，内置 General/Explore/Scout）。
- 定义方式：`opencode.json` 的 `agent` 字段，或 `~/.config/opencode/agents/`、`.opencode/agents/` 下的 markdown（frontmatter + prompt）。
- 一个 agent 可含：`description`、`mode`(primary/subagent/all)、`model`、`prompt`、`temperature`、`steps`、`permission`(read/edit/bash/... 三态 ask/allow/deny)、`hidden`、`disable` 等。
- CLI 选择：`opencode run --agent <name>`；subagent 靠 @ 提及或 primary 自动委派。

即：opencode 的 agent 是"给这个 CLI 进程配一套 prompt/模型/工具权限"的机制，它是**引擎内部**的事。

## 为什么两层不打架

- **Kith-space agent = 身份层**（我们定义）：谁、什么职责、什么记忆、绑哪个 runtime/model。落在我们的数据模型和 `.kith/` 里。
- **opencode agent = 执行配置层**（引擎内部）：这一次 CLI 运行用哪套 prompt/工具权限。
- 我们的适配器（`opencodeRuntime.ts`）已经把 Kith-space 的身份用 **system prompt 注入**（写到 `{cwd}/AGENTS.md`，opencode 的原生项目发现机制会读它），并用 `--dangerously-skip-permissions` 无头全权运行。**默认走 opencode 的 Build primary agent 即可**，我们不需要、也不应该把 Kith-space 的 leader/dev/tester 映射成 opencode 的 primary/subagent——那会把身份层和执行层搅在一起，违背"harness 优先、角色通用"的原则。

结论：opencode 的 agent 系统对 Kith-space 是**透明的下层细节**。我们只用它的无头执行能力，身份始终由 Kith-space 在其上层负责。术语上要注意 "agent" 一词在两个项目里含义不同（见 `../../glossary.md`）。

## 对 Kith-space 的可用点（供后续 wave，非 v1 必做）

- **`--auto`（auto-approve 未被 deny 的权限）**：比现在硬编码的 `--dangerously-skip-permissions` 更细的选择。做安全升级（决策 8/21 的触发点：上线邮箱、浏览器等会摄入不可信内容的模块）时，可用 `--auto` + agent 配置里对危险工具设 `deny/ask`，替代"一刀切跳过"。
- **`opencode serve` + `run --attach http://localhost:PORT`**：现适配器每轮都新 spawn `opencode run`（冷启动开销，见 `runtime-adapters-current-state.md` §5.1）。将来可跑一个常驻 server、每轮 attach，降延迟。`OPENCODE_SERVER_PASSWORD` 可加鉴权。
- **session 延续**：`--session <id>` / `--continue` / `--fork`。现适配器已用 `--session`；`--fork` 将来可支持"从某会话分叉"。
- **`--format json`**（已用）解析事件流；`--thinking` 可显示思考块。

## 落到决策与文档

- 不新增决策：这只是确认决策 2（不自研 runtime、runtime 当引擎、身份由 Kith-space 定义）在 opencode 上成立，并澄清 "agent" 术语的双层含义。
- 相关：`../../decisions.md` 决策 2；`../../glossary.md`（agent / 原生 vs 外接 / runtime）；本目录 `runtime-adapters-current-state.md`（opencode 适配现状与缺口）。
