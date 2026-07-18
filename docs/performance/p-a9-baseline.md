# P-A9.0 Core/UI 性能与 Runtime 事实基线

状态：2026-07-18 冻结。后续 P-A9 切片的 Core/UI 性能场景必须在相同硬件、数据和 Adapter 下比较；median p95 退化超过 10% 必须解释，安全/正确性换时延需要用户确认。fake Runtime 与 CLI 小节只记录事实/smoke，不适用该性能回归门。

## 1. 方法与机器

- Windows 10.0.26200 x64；AMD Ryzen 7 9800X3D，16 logical CPU；31.2 GiB RAM。
- Node v24.14.0；Core 最终采样启用 `--expose-gc`，每个 round 使用新临时 Space/SQLite、独立 in-memory Worker/Event Adapter，先预热 100 次并显式 GC，再测 100 次。
- 每个 Agent 档 5 个 round；percentile 使用 nearest-rank，最终值是 5 个 round p95 的 median，离散度是 round p95 的总体变异系数（CV）。
- Chat 使用授权的内置 Browser、隔离 profile 与固定 fixture；首次可见为每档一对等量频道，先交替预热 100 次，再做 5 个独立 round × 每轮 100 次交替切换；实时追加使用 5 个独立空频道 × 每轮 100 条，滚动在全量加载 100/500/1000 article 后执行 5 轮 × 每轮 100 次上下往返。
- `scripts/p-a9/statistics.mjs`、`core-baseline.ts`、`runtime-baseline.ts`、`runtime-cli-smoke.ps1`、`prepare-chat-baseline.ts`、`append-chat-baseline.ts` 与 `chat-browser-probe.js` 是可重复原始工具。
- `pnpm run typecheck` 覆盖 `scripts/p-a9/**/*.ts|mts`；shell/JS/MJS 工具由脚本单测和实际 smoke 覆盖。

## 2. Core current-behavior baseline

`durable prefix` 是进入 `createMessage` 到首次 `message` realtime publication；该 publication 位于当前 message/chain/follow/attachment/mention/channel-time 写入之后。它不是 P-A9.1b 的目标统一事务承诺。`total` 还包含当前响应决策、wake reservation 与同步 socket enqueue。

| 候选 Agent | total median p50 / p95 | total round p95（ms） | CV | durable median p50 / p95 | durable round p95（ms） | CV | SQL p95 | fan-out p95 | heap peak |
| ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | 2.374 / 3.263 ms | 3.263 / 3.030 / 3.365 / 4.015 / 2.855 | 12.0% | 1.131 / 1.682 ms | 1.682 / 1.598 / 1.758 / 2.010 / 1.427 | 11.3% | 21 | 1 | 69.2 MiB |
| 5 | 7.111 / 12.444 ms | 10.106 / 13.214 / 13.652 / 10.142 / 12.444 | 12.7% | 1.386 / 1.933 ms | 2.170 / 1.961 / 1.879 / 1.855 / 1.933 | 5.7% | 73 | 5 | 74.6 MiB |
| 10 | 12.970 / 32.138 ms | 21.427 / 38.496 / 32.138 / 40.303 / 19.697 | 28.0% | 1.745 / 2.493 ms | 2.666 / 2.248 / 2.402 / 2.493 / 2.507 | 5.6% | 138 | 10 | 83.8 MiB |
| 20 | 24.156 / 48.597 ms | 48.597 / 55.484 / 82.981 / 35.470 / 33.930 | 34.7% | 2.381 / 3.205 ms | 3.616 / 3.205 / 3.752 / 3.156 / 3.005 | 8.6% | 260 | 16 | 84.9 MiB |

10/20 Agent 的 total p95 对 event-loop/GC 调度敏感，即使已增加 100 次预热与显式 GC，CV 仍为 28.0%/34.7%；因此后续主要回归门使用稳定的 durable prefix，同时保留 total 每轮值，不用单一低值掩盖抖动。SQL 从 21 增至 260，证明当前 per-Agent 响应模式/scope 路径线性扩张；20 档 fan-out 为 16 是 `DEFAULT_MAX_DISPATCH_WAKES=16` 的现状。

事件循环各轮 p95（1/5/10/20 Agent）分别为 `4.342/3.766/4.272/4.837/3.410`、`13.410/13.599/17.908/12.550/13.976`、`26.395/41.091/38.601/43.680/24.707`、`56.525/63.996/89.522/43.024/43.876` ms。

同步 fake socket 内 JSON parse/capture 的 median p95 为 0.0048/0.0046/0.0049/0.0049 ms。它只叫 `socketSendEnqueueDiagnosticMs`，**不是 Worker admission SLO**，也不能用于推导 session 容量。

## 3. Core 与 UI 绝对 SLO

这些是架构迁移安全上限，不是对现有 UX 的理想化评价：

- Core durable-prefix：1/5/10/20 Agent 各档 median p95 均须 ≤ 10 ms。
- Core total：20 Agent median p95 须 ≤ 120 ms；同时与本表基线相比不得无解释退化 >10%。这仍只到同步 socket enqueue，不包含 Worker admission。
- Chat 首次可见提交：100/500/1000 数据集各档 median p95 ≤ 250 ms。
- Chat 独立频道实时追加：单消息端到端 median p95 ≤ 400 ms；100 条批次应用 round median ≤ 1.2 s。
- 全量挂载滚动操作 median p95：100 article ≤ 120 ms，500 article ≤ 500 ms，1000 article ≤ 1000 ms；长任务 median p95 分别 ≤ 120/450/900 ms。

真正的 Worker admission 绝对 SLO 只能在 P-A9.4 Core 消费 generation + deliveryId ack 后建立。

## 4. fake Runtime 与已安装 CLI smoke

fake Runtime 记录的是当前 `AgentManager -> Runtime` seam，不模拟外部模型或 admission。它是确定性的 current-fact smoke，不采集或声称延迟 p95/SLO。1/5/10/20 Agent 各跑 5 轮，每轮 `totalStarts`、`peakActiveSessions`、`totalStops`、`totalExits` 都恰好等于该档 Agent 数，`activeAfterStop` 都为 0。它只证明当前 seam 可启动并完整停止 20 个存活 session，**不**是容量目标、性能结论或公平性保证。

本机已安装 CLI 只运行离线 `--version`，5 轮 median launcher startup / median launcher peak working set：Claude Code 2.1.205 为 125.8 ms / 175.4 MiB，Codex CLI 0.144.1 为 336.9 ms / 75.0 MiB，opencode 1.17.18 为 595.3 ms / 74.7 MiB。Windows PATH 中的脚本 shim 会经隐藏 PowerShell launcher 执行，因此 working set 只描述 launcher，不代表完整子进程树。这是环境观测 smoke，不是模型支持的 Runtime session、网络耗时、回归 SLO 或容量结论；P-A9.4 仍须结合真实 admission 与进程策略重新决定内部默认值。

## 5. Chat browser baseline

### 首次可见提交

当前 API 首屏只挂载最新 50 条，所以三档数据集都显示 50 article。每档用 A/B 两个等量频道交替；先预热 100 次，然后每个独立 round 再切换 100 次。每次 operation 从频道点击前计时，到目标频道最后一条消息首次进入 DOM；表中 round p95 都由 100 个 operation 计算：

| 数据集 | round p95（ms） | median p95 | CV | long-task round p95 / median |
| ---: | --- | ---: | ---: | --- |
| 100 | 66.3 / 61.5 / 64.0 / 59.6 / 63.3 | 63.3 ms | 3.6% | 0/51/0/0/0 → 0 ms |
| 500 | 59.7 / 60.7 / 67.5 / 61.4 / 65.6 | 61.4 ms | 4.8% | 0/63/0/0/0 → 0 ms |
| 1000 | 73.0 / 58.8 / 60.1 / 60.2 / 62.4 | 60.2 ms | 8.2% | 57/0/0/0/0 → 0 ms |

对应每轮 100 次切换总时长分别为：100 档 `6333.3/6086.8/6218.8/6042.1/6204.3` ms，500 档 `5994.3/6064.4/6158.7/6020.0/6242.9` ms，1000 档 `6495.7/6015.6/6013.8/6103.7/6043.6` ms。

### 实时追加

5 个独立空频道各顺序 POST 100 条，消息携带同机 epoch 时间；Browser 在 paragraph 首次挂载时计算端到端延迟。各 round p95 为 236/245/257/256/230 ms，median p95 245 ms，CV 4.4%。每个 round 另产生一个“100 条从首条到末条应用”聚合值：783.9/782.8/740.8/721.2/666.1 ms；这 5 个 round 标量的 median 为 740.8 ms，CV 5.9%，不称为 p95。长任务 p95 为 83/98/83/95/86 ms，median 86 ms。

另做的单频道连续 5×100 追加诊断显示 article 从 100/200/300/400 后维持 400，batch application 最高 1011.6 ms，long-task p95 随挂载量升至 367 ms。该诊断不替代上面的独立 round 基线，但证明当前 400 article 挂载上限附近已有可复现压力。

### 全量历史滚动

`loadHistory` 先滚到顶部直到挂载全部 article；每 round 做 100 次 top/bottom 往返并逐次等到下一 animation frame：

| 挂载 article | operation round p95（ms） | median p95 | CV | long-task round p95 / median | 每轮总时长 |
| ---: | --- | ---: | ---: | --- | --- |
| 100 | 91.3 / 83.4 / 82.0 / 82.7 / 79.9 | 82.7 ms | 4.7% | 87/77/76/86/74 → 77 ms | 7.28–7.90 s |
| 500 | 399.5 / 396.3 / 403.0 / 395.8 / 403.6 | 399.5 ms | 0.8% | 378/369/372/367/373 → 372 ms | 34.85–35.95 s |
| 1000 | 871.2 / 858.5 / 861.5 / 868.1 / 856.4 | 861.5 ms | 0.7% | 743/733/736/733/733 → 733 ms | 75.42–78.09 s |

这是稳定的线性/超线性 UI 热点证据；P-A9.0 只记录，不在基线切片引入虚拟列表或改 Chat 行为。

## 6. 重跑入口

```powershell
# Core：固定 5×100，预热 100；使用显式 GC 的冻结口径
node --expose-gc --import tsx scripts/p-a9/core-baseline.ts

# fake Runtime 与安全的本机 CLI --version smoke
pnpm exec tsx scripts/p-a9/runtime-baseline.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p-a9/runtime-cli-smoke.ps1

# UI fixture；必须使用全新绝对临时 profile
pnpm exec tsx scripts/p-a9/prepare-chat-baseline.ts --profile <absolute-temp-profile> --port 7777
```

按 `docs/dev-debugging.md` 的 P-A9 小节用该 profile 启动 Core/Vite，在授权 Browser 中注入 `scripts/p-a9/chat-browser-probe.js`。首次可见把 `channelPairs` 中的 `name` 映射为 probe 的 `channelName`，先调用一次 `renderRound(targets, 100)` 预热，再记录 5 次 `renderRound(targets, 100)`；每次返回值必须有 100 个 `durationsMs`。实时轮次调用 `armRealtime/readRealtime`，滚动轮次调用 `loadHistory/scrollRound`。实时追加使用 fixture 输出的 5 个 `appendChannels`：

```powershell
pnpm exec tsx scripts/p-a9/append-chat-baseline.ts --server http://127.0.0.1:7777 --desktop-token <temporary-desktop-token> --space-id <space-id> --channel-id <append-channel-id> --round 1
```

所有目录和凭据必须是本轮临时值；不得对真实 `~/.kith-space` 或 `~/Kith-space` 跑 fixture。
