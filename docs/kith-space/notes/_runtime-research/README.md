# Runtime 对接调研 - 汇总索引

三条 v1 强路径 runtime 的"如何被 Kith-space 当无头引擎接入"调研（均查阅 2026-07-10，各文附官方 URL 与未证实标注）：

- [claude-code.md](./claude-code.md) - Claude Code
- [codex.md](./codex.md) - OpenAI Codex CLI
- [opencode.md](./opencode.md) - opencode

背景约束见 `../../decisions.md` 决策 2（不自研 runtime、模块经 MCP 暴露），现有适配器现状见 `../runtime-adapters-current-state.md`。

同类产品实测参考：[`../helio-agent-context-memory-tools-research.md`](../helio-agent-context-memory-tools-research.md) 记录 Helio Desktop 的 per-surface session、跨频道/私信/话题上下文桥接、三种记忆投影与设置面板、公开/私有频道 ACL、Heliox CLI/MCP、消息发送链、snapshot/Dream/compaction、Claude/Codex adapter、空闲逐出恢复与安全边界，并给出对 Kith-space Runtime Contract v2 和记忆分层的建议。

对应的 Kith-space 目标架构提案见 [`../../../superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md`](../../../superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md)：它把研究结论收敛为 P-A10 的 session generation、durable delivery/logical turn/attempt、Context Envelope、revisioned memory、capability broker、schema、NFR 与实施切片；已完成两路对抗性补全，尚未实现。

## 三家能力对照

| 维度 | Claude Code | Codex | opencode |
|---|---|---|---|
| 推荐无头入口 | `claude -p` stream-json（= Agent SDK 的 CLI 形态） | `codex app-server` + JSON-RPC | `opencode run --format json`；重活可 `serve` + `--attach` |
| 进程模型 | 常驻子进程 | 常驻 app-server | 每轮 spawn（或 serve 常驻） |
| token usage | result 事件带 usage/modelUsage/total_cost_usd | app-server 提供完整 usage | step_finish 提供 input/output/reasoning/cache + cost |
| 会话延续 | --resume + session id | thread/resume | --session/--continue/--fork |
| 身份/prompt 注入 | --append-system-prompt(-file) | developerInstructions | OPENCODE_CONFIG_CONTENT（勿覆盖 AGENTS.md） |
| MCP 注入 | --mcp-config / --strict-mcp-config | session-only `-c mcp_servers.kith.*` | OPENCODE_CONFIG_CONTENT 内 mcp，或 server POST /mcp |
| 无人值守权限 | --dangerously-skip-permissions / --permission-mode | approval policy + sandbox（按类型响应，勿统一 auto-accept） | --auto（--dangerously-skip-permissions 已成隐藏别名） |
| 单轮终态信号 | result（含 subtype） | turn/completed | error event + exit code 双通道 |

## 跨 runtime 的关键结论（可落地）

1. **token usage 三家都能拿，缺口在我们自己的 Runtime 契约，不在 CLI。** 三家的无头输出都带完整 token 用量，但当前三个适配器都没解析（`reference/open-tag/src/daemon/*Runtime.ts`），公共 `runtime.ts:5-18` 也没有 usage / turn-done 字段。这直接推翻了 P1"拿不到真 token、只能用代理指标"的前提。**后续应给 Runtime 契约加 `onTurnCompleted`/usage 回调，把 P1 的 token 护栏从"成功唤醒次数"代理升级为真实 token 计量**（按 message/part id 去重，以最终 result/turn-completed 结算）。这是一个独立的、值得做的后端波次。

2. **"模块即 MCP 工具"架构可行，但需要一层 runtime-specific 的 MCP bootstrap。** 三家各有干净的 per-spawn MCP 注入入口（见表），都能不污染用户配置地把 Kith-space MCP server 注册进去。所以决策 2 的 MCP 路线成立；要做的是在 `StartOpts` 增加结构化 MCP bootstrap 描述，每个适配器把它翻译成本 runtime 的原生方式，并在首轮投递前用 ready 闸门确认工具可用。这应先于"任务/记忆做成 MCP 工具"那一波。

3. **权限与终态需要按 runtime 分别重做，不能统一 flag。** 三家权限机制不同（skip flag / approval RPC / --auto），Codex 的统一 auto-accept 已过时、opencode 的错误退出码已从 exit0 变 exit1。安全升级（决策 8 触发点）时要按 runtime 分别映射到"无人值守但可控"的策略，并建立 per-version fixture + smoke test 锁定协议漂移。

## 状态

三份调研已完成并提交。以上结论供后续"Runtime 契约 + usage 回调""MCP bootstrap 层""安全升级"等波次直接取用，均未在本轮实现。
