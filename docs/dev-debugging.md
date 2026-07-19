# Kith-space 高级开发与调试

本文收纳低频调试命令。日常启动、测试和打包请先看 [`dev-commands.md`](./dev-commands.md)。

## 1. 手动分进程环境变量

`pnpm run desktop:dev` 会自动生成并轮换内部凭据，不需要 `.env`。只有手动启动 Core Service 和 Worker 时，才需要在不提交的本地 `.env` 或各进程环境中设置：

```dotenv
PORT=7777
KITH_SPACE_HOME=C:/path/to/kith-space-data
KITH_SPACE_SPACES_DIR=C:/path/to/kith-space-spaces
KITH_SPACE_DESKTOP_TOKEN=<独立随机值>
KITH_SPACE_WORKER_TOKEN=<另一个独立随机值>
```

- `PORT`：手动 Core Service 端口，默认 `7777`。
- `KITH_SPACE_HOME`：app.db、日志和当前 runtime 内部数据根目录，默认 `~/.kith-space`；它不再改变默认 Space 容器。
- `KITH_SPACE_SPACES_DIR`：开发/测试专用的默认 Space 容器覆盖，正式默认值为 `~/Kith-space`。隔离验收时应与 `KITH_SPACE_HOME` 一起指向临时 profile 的不同子目录。
- `KITH_SPACE_DESKTOP_TOKEN`：手动开发管理请求到 Core 的内部凭据。
- `KITH_SPACE_WORKER_TOKEN`：Worker 控制 WebSocket 的独立凭据。

路径职责固定为：主要 runtime 的 cwd 是 registry 中所属 Space 的 rootPath；Agent Memory 位于 `<space>/.kith/agents/<agentId>`；prompt、turn 文件等 runtime 临时状态位于 `$KITH_SPACE_HOME/runtime/<spaceId>/<agentId>`。普通 reset 只清 session/runtime state，完整 reset 额外清当前 Agent Memory；两者都不会删除共享 Space 文件，同 agent 的 reset/start 会在 Worker 内串行。OpenCode system prompt 只通过 child env 的 inline execution agent 注入，不写 Space 的 `AGENTS.md`。Copilot/Kimi/Cursor 仍为 experimental adapter，因其会向 cwd 写 `AGENTS.md`，暂时使用 runtime state cwd。

两个内部 Token 必须不同，也不能复用浏览器访问 Token。PowerShell 可分别执行两次以下命令生成 32 字节随机值：

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
```

## 2. 浏览器访问模式

Web 模式和端口保存在 `$KITH_SPACE_HOME/app.db`。Desktop 运行时优先从 Desktop Settings 管理；以下命令只供手动调试：

```powershell
pnpm run browser-access:dev off
pnpm run browser-access:dev local --port 7777 --rotate-token
pnpm run browser-access:dev lan --port 7777 --token "a-custom-token-at-least-16-chars"
```

- `local` 只绑定 `127.0.0.1`；`lan` 绑定 `0.0.0.0`。
- `--rotate-token` 自动生成新 Token，并只在本次命令输出一次。
- `--token <VALUE>` 接受 16-256 个字符；省略时保留已有 Token。
- 模式或端口变化后需要重启 Core Service。
- LAN v1 是未加密 HTTP，只能用于受信任私有局域网，不能暴露到互联网。

浏览器首次访问时输入访问 Token，随后使用持久 HttpOnly Cookie 会话。URL 不携带 Token，也不支持旧的 `?as=` 参数。

## 3. 数据库与调试数据

正式 Desktop 首次初始化不需要 `seed`。以下命令只用于手动分进程、测试 fixture 或 schema 调试：

```powershell
pnpm run seed       # 幂等创建唯一 Human、Home Space 和 schema
pnpm run seed:dev   # 追加开发用 dev-bot
pnpm run db:push    # 把 schema 推到 ./.kith-space-dev.db scratch 库
pnpm run db:studio  # 打开 scratch 库的 Drizzle Studio
```

应用运行时会自动迁移当前 baseline，不需要 `db:push`。若旧开发库被识别为 legacy workspace database，应先备份报错路径中的 `<space>/.kith/workspace.db`，再由开发者显式删除并重新初始化；应用不会自动删除旧库。

## 4. Runtime CLI 检测与 Windows 编码

Worker 启动日志的 `ready` 事件会列出实际可启动的 runtimes。Windows 下 Claude 的 `.exe` 与 Codex/opencode 等 npm `.cmd` shim 都经过同一个跨平台启动边界；安装或升级 CLI 后需要重启 Desktop/Worker 才会刷新列表。

PowerShell 可先确认宿主能找到命令：

```powershell
Get-Command claude, codex, opencode
```

Windows 上 Worker 会在开发态和打包态生成 `~/.kith-space/bin/kith-space.cmd`，并清理旧版本遗留的无扩展名 `#!/bin/sh` wrapper。升级到包含该修复的代码后必须重启 Desktop/Worker；若系统弹出“选择用什么软件打开 kith-space”，不要为该文件关联编辑器，先确认 Worker 已重启且 bin 目录中只剩可执行的 `.cmd` wrapper。

Windows PowerShell 5.1 向原生命令管道发送字符串时默认为 ASCII，中文会在到达 CLI 前变成 `?`。Agent 的平台化 system prompt 已自动使用下面的 UTF-8 约定；开发者手工复现 `message send`、`thread reply` 或 `action prepare` 时也应先设置：

```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
@'
中文测试
'@ | kith-space.cmd message send --target "#all"
```

Runtime stdout/stderr 与 `kith-space` CLI stdin 都使用有状态 UTF-8 解码，可正确处理一个汉字被 OS 拆到两个数据块的情况。不要用 `chcp`、`shell: true` 或强制模型“只说中文”替代这些边界；`chcp 65001` 只用于 `.cmd` 自身，无法恢复已经被 PowerShell ASCII 管道替换的字符。

如果命令存在但 Worker 的 `runtimes` 仍为空，运行 `pnpm run typecheck` 并检查 Desktop 启动终端中的 Worker 日志；不要通过 `shell: true` 或硬编码绝对路径绕过统一启动边界。

## 5. 一键 E2E 联调栈

`dev:e2e` 是内部联调工具，不是日常启动方式。它需要 Bash、已配置的 `.env`，以及已安装并登录的 `claude` CLI。

```powershell
pnpm run dev:e2e:up
pnpm run dev:e2e:down
```

`dev:e2e:up` 会 seed 数据、启用 local Web、轮换浏览器访问 Token、构建 Web，并启动 Core Service、Worker 和 dev-bot。它不会启动 Vite 或 Electron；浏览器访问地址和一次性显示的 Token 以终端输出为准。

## 6. 编排护栏参数

- `KITH_SPACE_MAX_DISPATCH_DEPTH`：agent 到 agent 派发链最大深度，默认 `4`。
- `KITH_SPACE_MAX_DISPATCH_WAKES`：每条派发链最大成功唤醒次数，默认 `16`。

急停等运行时控制走 `/api/tasks/:id/dispatch/*` 和 `/api/spaces/:id/dispatch/*`，架构说明见 [`kith-space/architecture-proposal.md`](./kith-space/architecture-proposal.md)。

## 7. 打包实现说明

```powershell
pnpm run desktop:bundle  # Web + Electron + Core + Worker + agent CLI
pnpm run desktop:pack    # dist/desktop/win-unpacked
pnpm run desktop:dist    # x64、per-user、assisted NSIS 安装器
```

`desktop:pack` 和 `desktop:dist` 会先为 Electron x64 强制重建 `better-sqlite3`，打包结束或失败后再恢复本地 Node ABI。安装器当前未签名，公开分发前必须配置 Windows 代码签名证书。A6 的具体构建与 smoke 验收记录以 [`progress.md`](./progress.md) 为准。

## 8. P-A9 Chat 浏览器基线与回归

Chat 基线只能在全新临时 profile 上运行，且只用于 UI 首次可见、实时追加和滚动 SLO；它不测量 Core/Worker admission、容量或 SQL。先创建一个绝对临时目录并保存 fixture 输出：

```powershell
$profile = Join-Path $env:TEMP ("kith-space-p-a9-ui-" + [guid]::NewGuid().ToString("N"))
pnpm exec tsx scripts/p-a9/prepare-chat-baseline.ts --profile $profile --port 7777
```

fixture 要求 `$profile` 尚不存在，并为 100/500/1000 各创建一对等量频道、5 个独立 realtime 频道和随机生成的 local browser access token（都在一次性 JSON 输出中）。随后按第 1、2 节配置同一个 profile、临时 Desktop/Worker credential，启动 Core 与 Vite：

```powershell
$env:KITH_SPACE_HOME = Join-Path $profile "app-data"
$env:KITH_SPACE_SPACES_DIR = Join-Path $profile "spaces"
```

不要复用真实 app data，也不要把 fixture 输出的临时 token 当正式凭据。

在授权的内置 Browser 打开 Vite，注入 `scripts/p-a9/chat-browser-probe.js`。Vite `/api` 开发代理已显式启用 keep-alive，重复切换不得改用为每次请求强制关闭连接的临时代理配置。记录前让测试页保持前台，并用短 rAF 采样确认频率接近显示器刷新率；Windows 上后台或被遮挡的内置 Browser 可能降到约 1 Hz，这类 round 必须丢弃并重新测量。首次可见使用 fixture 的 `channelPairs`，把每对 A/B 的 `name` 映射为 `channelName` 后先交替预热 100 次，再记录 5 个独立的 100 次 round：

```js
const targets = [pair.a, pair.b].map(({ name, targetText }) => ({ channelName: name, targetText }));
await pA9BrowserProbe.renderRound(targets, 100); // warmup，不记录
const rounds = [];
for (let round = 0; round < 5; round += 1) rounds.push(await pA9BrowserProbe.renderRound(targets, 100));
```

每个记录 round 的 `durationsMs.length` 必须为 100；不得用一次频道打开伪称 p95。实时轮次使用独立 `appendChannels`，先 `armRealtime(round, 100)`，再从终端执行：

```powershell
pnpm exec tsx scripts/p-a9/append-chat-baseline.ts `
  --server http://127.0.0.1:7777 `
  --desktop-token <temporary-desktop-token> `
  --space-id <fixture-space-id> `
  --channel-id <fixture-append-channel-id> `
  --round 1
```

追加完成后调用 `readRealtime()`。滚动样本先调用 `loadHistory(100|500|1000)`，确认 article 全量挂载，再执行 5 次 `scrollRound(100)`。结束时调用 `cleanup()`、停止 Core/Vite 并删除本轮临时 profile。Core SQL 与 Worker admission 证据分别由 `core-baseline.ts` 和 `runtime-baseline.ts` 采集；统计口径、真实样本和绝对 SLO 见 [`performance/p-a9-baseline.md`](./performance/p-a9-baseline.md)。

## 9. P-A10 Runtime Contract 基线

P-A10.0 的可执行 adapter fixture运行：

```powershell
pnpm exec tsx --test src/runtime/contract/v2/runtimeContract.test.ts src/daemon/runtimeContractBaseline.test.ts
```

Claude/Codex fixture证明同一常驻进程可串行处理两轮，opencode fixture证明one-shot子进程会在第二轮携带首轮session ID；三者同时验证显式 completion 与可映射的 final usage。P-A10.1 v2 bridge另验证critical event ack、process cancel、stable broker activation和stale generation拒绝。P-A10.2增加admit/activate分离、event/terminal ACK、lease recovery、dispatch reservation和Core generation/broker变化后的reopen测试。P-A10.3增加Human/Agent/v2-output原子direct-mention thread、mixed-mode reserved wake崩溃恢复、Context Envelope bound frontier与8k拆批/HMAC tombstone、Human/Agent父级撤权、task-scoped release/reassign/终态/expiry、stale output和turn inspector injection-state定向回归；workspace v6会续跑`0006_legacy_dispatch_recovery`索引，app.db会从v1原位升级到v2并生成只保存在`installation_state`的content HMAC key。P-A10.4增加真实Gateway后端的stdio MCP、CLI client与CLI parser fixture、Task operation链、canonical reply/cede与attachment绑定、25 MiB超限/批失败清理、`0007_temporary_attachment_lifecycle`过期及文件/DB crash reconcile、三家config注入、stdio握手失败降级/双路fail-closed、turn-start ACK前不启动runtime、实际transport诊断、跨私密ref-only projection、later-query refresh、checklist/跨turn short wake和manual summary回归；`desktop:bundle`会同时生成`runtime/kith-core-mcp.mjs`与`agent-cli.mjs`。三家MCP bootstrap在最终provider smoke前标`fixture_v2`；tool isolation、cwd relocation与compaction telemetry继续标`unsupported`。

v2 runtime子进程只看到stable `KITH_SPACE_BROKER_HANDLE`、loopback endpoint和mode `0600` activation file路径；activation file在每个attempt运行前写入、结束后删除，MCP/CLI常驻进程每次调用都会重新读取。不要把handle、activation ID或文件内容复制到日志、fixture或问题报告；它们不是浏览器Access Token，也不能脱离当前lease使用。Gateway只接受loopback请求并再次核对DB中的attempt/session generation/input scope和实时surface ACL。Core或Worker重启时旧generation事件会被拒绝，scanner在lease过期后恢复；不要人工修改attempt状态来“解卡”。

真实 smoke 只能在隔离Space/runtime state中执行，必须使用已登录的Claude Code/Codex和显式opencode provider/model。usage只能来自raw engine event；tool isolation必须用实际shell/file探针验证；relocation必须在两个root放不同marker；不能用模型自述或prompt“不要调用工具”代替证据。
