# Kith-space 日常开发命令

这是日常开发的命令速查。低频环境变量、浏览器访问、数据库和 E2E 联调见 [`dev-debugging.md`](./dev-debugging.md)。

项目使用根目录 `packageManager` 固定的 **pnpm 11.13.1**；CI 与启用 Corepack 的本机环境会读取该版本。脚本参数直接跟在命令后，不要额外添加 `--`：

```powershell
pnpm test --unit
pnpm run browser-access:dev local --port 7777 --rotate-token
```

当前正式打包与实机验收只覆盖 Windows x64；macOS/Linux 尚未进入发行范围。源码与共享命令仍须遵守 [`Windows/macOS/Linux 兼容性基线`](./archive/cross-platform-compatibility.md)。下文以 PowerShell 为主；不含环境变量赋值的 `pnpm` 命令可在 PowerShell、cmd、bash、zsh 中直接运行。`stop`、`wt:*`、`dev:e2e:*` 已统一为 Node 入口，平台进程操作封装在窄适配器中，不再要求 Bash 或 `pkill`。

## 1. 首次准备

```powershell
cd <仓库目录>
pnpm install
```

应用使用 SQLite，不需要 Postgres、Redis 或 `db:push`。

前端已初始化 Tailwind CSS v4 与 shadcn/ui。添加基础组件前先检查 `web/src/components/ui/`，缺少时从仓库根目录运行：

```powershell
pnpm --dir web exec shadcn add button
```

把 `button` 替换为所需组件名；不要手工复制 registry 源码，也不要重复添加已有组件。组件配置位于 `web/components.json`，新增组件应保持 `@/components/ui/*` 与 `@/lib/utils` 别名。

## 2. 启动 Desktop 开发环境

日常开发推荐只运行这一条：

```powershell
pnpm run desktop:dev
```

它会构建 Electron main/preload，并统一启动 Core Service、Local Runtime Worker、Vite 和 Electron。全新数据目录无需 `seed`；首次窗口会收集 Human 名称、邮箱和描述，并自动创建 `Home` Space。

Canvas Agent 执行入口 `KITH_CANVAS_AGENT_EXECUTION` 自决策 40 起默认开启：真实选区消息默认派生 Canvas Access Grant 与 `canvas.read/write/import/export` activation scopes；设 `0`/`false`/`off` 可整体关闭（含打包产物，需重启进程且新 turn 生效，旧 activation 不会被静默降级）。`src/desktop/processCommands.ts` 不再注入开发专用开关，见 [`dev-debugging.md`](./dev-debugging.md#1-手动分进程环境变量)。

开发模式下，Core 的本机 Web 入口（例如 `http://127.0.0.1:7777`）会把前端请求代理到 Vite `5273`，因此浏览器与 Electron 窗口一样支持热更新；Vite 尚未就绪时刷新即可。若在 Desktop 的“Desktop & Web”设置中启用了本机 Web，7777 首次访问应显示访问 Token 登录页，而不是 `{"error":"not found"}`。

开发脚本会把额外参数原样传给Electron；例如本机UI自动化可用`pnpm run desktop:dev --remote-debugging-port=9222`。这只应用于开发宿主，不进入production bundle；调试端口不得在LAN/公网暴露，完整约束见`dev-debugging.md`。

默认数据目录是 `~/.kith-space`。需要隔离验收数据时，可在当前 PowerShell 会话中先设置：

```powershell
$env:KITH_SPACE_HOME = Join-Path $env:TEMP ("kith-space-dev-" + [guid]::NewGuid().ToString("N"))
$env:KITH_SPACE_SPACES_DIR = Join-Path $env:KITH_SPACE_HOME "spaces"
pnpm run desktop:dev
```

这会为本次终端创建一套带随机 GUID 的一次性 app data 与 Space 容器，不是一台电脑唯一的正式目录。正式默认值分别是 `~/.kith-space` 与 `~/Kith-space`。该临时 profile 中创建的 Space 和 Agent Memory 都会随终端验收目录一起丢弃；Claude Code、Codex、opencode 的 cwd 是其中实际注册的 Space root，不要在这套 profile 中保存正式工作。路径分层见 [`Home 与 Space root 设计`](./archive/specs/2026-07-12-home-space-and-space-root-design.md)。

关闭窗口默认只是进入托盘。彻底停止时使用托盘菜单的 **Quit**，或在启动终端按 `Ctrl+C`。

## 3. 分进程启动

只在需要单独观察某个进程时使用。手动模式需要本地 `.env` 中的内部凭据；配置方法见 [`dev-debugging.md`](./dev-debugging.md#1-手动分进程环境变量)。全新 `KITH_SPACE_HOME` 还应先运行一次 `pnpm run seed`。

启动进程前，配置本机 Web 模式和访问 Token：

```powershell
pnpm run browser-access:dev local --port 7777 --rotate-token
```

分别打开三个终端：

```powershell
# 终端 A：Core Service（API + WebSocket，热更新）
pnpm run server
```

```powershell
# 终端 B：本机唯一 Local Runtime Worker
pnpm run daemon
```

```powershell
# 终端 C：Vite 前端热更新
pnpm --dir web run dev
```

进程启动后打开 `http://127.0.0.1:5273`，输入前面生成的访问 Token。停止时在三个终端分别按 `Ctrl+C`。

本机需要安装并登录至少一个受支持的 runtime CLI，例如 Claude Code、Codex 或 opencode；否则应用仍可启动，但对应 agent 无法运行。

## 4. 测试与检查

```powershell
pnpm run typecheck       # Core + Web TypeScript 检查
pnpm test --unit         # 单元测试
pnpm test --integration  # 集成测试
pnpm test                # 全量测试
```

测试 runner 会同时生成临时 `KITH_SPACE_HOME` 与 `KITH_SPACE_SPACES_DIR`，避免污染真实 app data 和 `~/Kith-space`，并显式使用根目录 `tsconfig.test.json`，使 tsx 行为测试与 Vite/Web TypeScript 共用 `@/* → web/src/*` 别名而不修改 Core 根配置。手工直跑单个测试时必须同时设置两者，并使用 `pnpm exec tsx --tsconfig tsconfig.test.json --test <测试文件>`；只给fixture传`rootPath`仍可能把Space注册进默认`~/.kith-space/app.db`，不能代替app data隔离。standalone integration应在finally注销自己的registry并删除fixture root，但这只是崩溃外的第二道防线，不能作为省略环境变量的理由。

## 4.1 画布设计 eval 打分

画布质量对齐的前后对比基线（决策 39）。任务提示词需先在画布 Agent 里手动跑出结果，再对导出的 canvas 打分：

```bash
node eval/canvas-design/run.mjs --db <Space>/workspace.db --canvas <canvasId> --task poster-001
```

逐项打印 PASS/FAIL 表并追加到 `eval/canvas-design/results.json`（含时间戳/分支/git rev）；全部通过退出码 0。任务套件、检查项类型与编写规范见 `eval/canvas-design/README.md`。

## 5. 构建与打包

```powershell
pnpm run web:build       # Web 构建到 web/dist
pnpm run desktop:build   # 仅构建 Electron main/preload
pnpm run desktop:bundle  # 完整生产 bundle，不生成安装器
pnpm run desktop:pack    # Windows unpacked 包
pnpm run desktop:dist    # Windows x64 NSIS 安装器
```

主要输出位置：

- Web：`web/dist/`
- Electron 开发构建：`desktop/dist/`
- Windows unpacked：`dist/desktop/win-unpacked/`
- Windows 安装器：`dist/desktop/Kith-space-Setup-<version>-x64.exe`

当前安装器未签名。打包实现、原生模块重建和低频调试命令见 [`dev-debugging.md`](./dev-debugging.md)。

## 6. P-A9 架构基线与护栏

这些命令只用于 P-A9 迁移回归和 admission p95 / capacity 证据采集，不是日常启动流程：

```powershell
node scripts/p-a9/module-dependency-guard.mjs
node --expose-gc --import tsx scripts/p-a9/core-baseline.ts
pnpm exec tsx scripts/p-a9/runtime-baseline.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/p-a9/runtime-cli-smoke.ps1
```

Core 与 fake Runtime 默认执行 1/5/10/20 Agent、5 个 round；Core 每轮先预热 100 次，再测 100 次，最终用于观察 RuntimeWorkerPort admission ack 后的 p95 与容量表现。fake Runtime 只核对确定性的 session 启停事实，不承担最终 SLO 证据；P-A9.6 的 20-Agent SQL 已从 260 降到 151，绝对 SLO 通过。`pnpm run typecheck` 同时覆盖 P-A9 TypeScript 基线脚本。浏览器 Chat fixture 与探针属于低频调试，见 [`dev-debugging.md`](./dev-debugging.md#8-p-a9-chat-浏览器基线与回归)。冻结结果、SLO 与 socket-send/admission 口径见 [`performance/p-a9-baseline.md`](./archive/performance/p-a9-baseline.md)。

## 7. P-A10 契约与本机容量基线

P-A10.0 的本机 SQLite 基线使用临时数据库，不读取真实 Space 或 app.db：

```powershell
pnpm exec tsx scripts/p-a10/baseline.ts
```

它预填 10 万条消息和 1 万条结构化记忆候选，测量 1/5/20 Agent 同事务 fan-out、英文与中文 2 字 FTS 查询，并报告临时数据库体积。它仍是纯SQLite projection基线；P-A10.5的最终正确性另由Memory Module测试覆盖source ACL、continuity、revision与disclosure。Runtime adapter 的 fixture 与 live smoke边界见 [`dev-debugging.md`](./dev-debugging.md#9-p-a10-runtime-contract-基线)。

P-A10.4 durable turn/context/Gateway回归使用项目测试runner的随机profile运行；不要直接绕过runner复用真实`~/.kith-space`：

```powershell
pnpm test --unit
```

当前unit门覆盖migration前缀、cutover/backfill/rollback窗口、message+delivery回滚、task observe与分页frontier、dispatch reservation、logical turn/lease+broker续租、cancel/requeue、operation幂等、reply mention+chain/depth/attachment原子绑定、逐输入finalize、admission/event上限、terminal重传、原子direct-mention thread、Context Envelope/HMAC tombstone、父级ACL撤权、stale refresh、真实Gateway MCP/CLI/CLI parser同域fixture、Task全链路、v2 task/legacy wake互斥、三家MCP bootstrap/握手降级、跨私密projection/grant、checklist/short wake、上传超限/中断整批清理、临时附件过期/崩溃GC、manual inbox summary、workspace v8 advisor migration、advisor queue/lease/cost/validation/source ACL/suppression、结构化记忆管理面板、snapshot checksum/generation/secret门、checklist revision、Codex compaction映射和final usage terminal持久化。完整integration仍使用`pnpm test --integration`。`kith-space context check`、`turn context|reply|cede|progress|get`、`attachment upload`、`conversation read|search`、`memory recall|get`、`task ...`、`session checklist|wake`与`capability describe`只在Worker注入的active v2 turn中可用，不是Human手动调试命令；缺少activation时按设计返回`capability_inactive`。`memory recall --query <text>`默认合并continuity，`memory get --id <id>`只返回当前output surface允许的projection。v2 `attachment upload --file <path>`不接受目标频道，返回的ID只能由同一activation的`turn reply --attach <id>`绑定到server-owned surface；每批最多10个文件、单文件上限25 MiB，超限或连接中断会拒绝并清理整批，临时ID一小时后失效。需要显式引用被ref-only隐藏的私密source时，必须先由Human控制面签发短期grant，再用`turn reply --source-ref '<json>' --disclosure-grant <id>`提交完全匹配的正文；grant只消费一次。

## 8. 系统 Memory Advisor Provider 门禁

日常验证仍使用统一命令，不向真实profile写测试凭据：

```powershell
pnpm test --unit
pnpm test --integration
pnpm run typecheck
pnpm run desktop:build
pnpm run desktop:bundle
```

`desktop:build`和`desktop:bundle`都会生成`desktop/dist/runtime/pi-advisor-helper.mjs`与`pi-advisor-build-manifest.json`。manifest固定`@earendil-works/pi-ai@0.84.2`、lockfile integrity、helper SHA-256、Node下限和依赖输入；构建在发现`pi-agent-core`、`pi-coding-agent`或`pi-ai/compat`时失败，并以无网络的非法空请求启动helper，确认ESM/Node builtin加载成功且返回有界`provider_request_invalid`。不要直接执行helper处理真实正文；真实能力探测从Settings“记忆 Advisor”发起，它先完成无正文egress preflight，再使用短时单次凭据activation。
