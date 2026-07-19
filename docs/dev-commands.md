# Kith-space 日常开发命令

这是日常开发的命令速查。低频环境变量、浏览器访问、数据库和 E2E 联调见 [`dev-debugging.md`](./dev-debugging.md)。

项目使用根目录 `packageManager` 固定的 **pnpm 11.13.1**；CI 与启用 Corepack 的本机环境会读取该版本。脚本参数直接跟在命令后，不要额外添加 `--`：

```powershell
pnpm test --unit
pnpm run browser-access:dev local --port 7777 --rotate-token
```

## 1. 首次准备

```powershell
cd D:\Projects\multi-agent
pnpm install
```

应用使用 SQLite，不需要 Postgres、Redis 或 `db:push`。

## 2. 启动 Desktop 开发环境

日常开发推荐只运行这一条：

```powershell
pnpm run desktop:dev
```

它会构建 Electron main/preload，并统一启动 Core Service、Local Runtime Worker、Vite 和 Electron。全新数据目录无需 `seed`；首次窗口会收集 Human 名称、邮箱和描述，并自动创建 `Home` Space。

默认数据目录是 `~/.kith-space`。需要隔离验收数据时，可在当前 PowerShell 会话中先设置：

```powershell
$env:KITH_SPACE_HOME = Join-Path $env:TEMP ("kith-space-dev-" + [guid]::NewGuid().ToString("N"))
$env:KITH_SPACE_SPACES_DIR = Join-Path $env:KITH_SPACE_HOME "spaces"
pnpm run desktop:dev
```

这会为本次终端创建一套带随机 GUID 的一次性 app data 与 Space 容器，不是一台电脑唯一的正式目录。正式默认值分别是 `~/.kith-space` 与 `~/Kith-space`。该临时 profile 中创建的 Space 和 Agent Memory 都会随终端验收目录一起丢弃；Claude Code、Codex、opencode 的 cwd 是其中实际注册的 Space root，不要在这套 profile 中保存正式工作。路径分层见 [`Home 与 Space root 设计`](./superpowers/specs/2026-07-12-home-space-and-space-root-design.md)。

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

测试 runner 会同时生成临时 `KITH_SPACE_HOME` 与 `KITH_SPACE_SPACES_DIR`，避免污染真实 app data 和 `~/Kith-space`。手工直跑单个测试时也应同时设置两者，或为 fixture 显式传入 rootPath。

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

Core 与 fake Runtime 默认执行 1/5/10/20 Agent、5 个 round；Core 每轮先预热 100 次，再测 100 次，最终用于观察 RuntimeWorkerPort admission ack 后的 p95 与容量表现。fake Runtime 只核对确定性的 session 启停事实，不承担最终 SLO 证据；P-A9.6 的 20-Agent SQL 已从 260 降到 151，绝对 SLO 通过。`pnpm run typecheck` 同时覆盖 P-A9 TypeScript 基线脚本。浏览器 Chat fixture 与探针属于低频调试，见 [`dev-debugging.md`](./dev-debugging.md#8-p-a9-chat-浏览器基线与回归)。冻结结果、SLO 与 socket-send/admission 口径见 [`performance/p-a9-baseline.md`](./performance/p-a9-baseline.md)。

## 7. P-A10 契约与本机容量基线

P-A10.0 的本机 SQLite 基线使用临时数据库，不读取真实 Space 或 app.db：

```powershell
pnpm exec tsx scripts/p-a10/baseline.ts
```

它预填 10 万条消息和 1 万条结构化记忆候选，测量 1/5/20 Agent 同事务 fan-out、英文与中文 2 字 FTS 查询，并报告临时数据库体积。该脚本只冻结本机起点，不等于 P-A10.5 的最终 recall 质量/SLO。Runtime adapter 的 fixture 与 live smoke边界见 [`dev-debugging.md`](./dev-debugging.md#9-p-a10-runtime-contract-基线)。
