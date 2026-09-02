# P-A10 Agent Harness v2 基线

日期：2026-07-19。阶段：P-A10.0。该文只冻结迁移前本机起点，不代表 P-A10.1–P-A10.7 已实现。

## 环境与口径

- macOS Darwin 25.4.0 arm64；Node 24.14.0；pnpm 11.13.1。
- 本机 CLI：Claude Code 2.1.214、Codex 0.133.0、opencode 1.15.10。
- 命令：`pnpm exec tsx scripts/p-a10/baseline.ts`。
- 临时 SQLite 预填 100,000 条消息、10,000 条 memory candidate；每档预热由 SQLite/Node 首次执行自然承担，随后记录 5 个独立 round，每 round 100 次。
- fan-out 样本只测单事务 `message + N delivery rows` 的最小正确性成本，不包含 P-A8 policy、dispatch、Context、Worker 或模型耗时；不能与 P-A9 Core total 直接比较。
- recall 样本只测本机 FTS5 lexical/CJK projection，不包含 ACL、disclosure、revision merge、continuity bundle 或重排。

## 结果

| 场景 | 5 个 round p95（ms） | median p95（ms） |
|---|---|---:|
| 1 Agent fan-out | 0.085 / 0.060 / 0.063 / 0.068 / 0.082 | 0.068 |
| 5 Agent fan-out | 0.094 / 0.202 / 0.184 / 0.346 / 0.171 | 0.184 |
| 20 Agent fan-out | 0.437 / 0.748 / 1.154 / 2.796 / 2.369 | 1.154 |
| 中文 2 字 `周报` | 0.008 / 0.005 / 0.005 / 0.005 / 0.005 | 0.005 |
| 中文 2 字 `简洁` | 0.010 / 0.005 / 0.005 / 0.005 / 0.005 | 0.005 |
| English `weekly` | 0.005 / 0.005 / 0.037 / 0.007 / 0.006 | 0.006 |
| English `preference` | 0.007 / 0.005 / 0.005 / 0.005 / 0.005 | 0.005 |

临时数据库最终为 16,519,168 bytes。它没有物化“10 万消息 × 20 Agent = 200 万 delivery rows”的最坏长期容量，因此不能替代 P-A10.2 的真实 page/index 容量和消息事务 SLO；脚本只为可重复的单机起点。

## 中文与无词面结论

`src/memory/lexicalProjection.ts` 以 NFKC/小写规范化英文数字，并为连续 CJK 生成 2-gram、3-gram 和 1/2 字 exact fallback；fixture 已证明“用户喜欢简洁周报格式”可由 `周报` 与 `简洁` 命中。无词面改写不能由 lexical FTS 可靠保证，必须由 P-A10.5 的 active continuity bundle 覆盖；P-A10.0 不把尚未实现的 continuity 命中伪装成通过。

## Runtime 契约基线

可执行 shim 证明：

- Codex v1 在同一个 app-server 进程中串行处理两轮并保持同一 thread ID；
- opencode v1 每轮启动新进程，第二轮通过 `--session` 复用首轮 session ID。

三家 v1 adapter仍没有可依赖的 normalized usage、per-attempt completion/cancel、Kith MCP bootstrap或tool isolation；cwd relocation也未做真实smoke。`src/runtime/contract/v2/runtimeCapabilityBaseline.ts`因此把这些能力标为`missing`或`unsupported`，不是通过状态。
