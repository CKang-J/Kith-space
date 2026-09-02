# AGENTS.md — Kith-space

本文件是任何 AI agent（Claude Code / Codex / opencode 等）或人类贡献者接手本仓库时的**首读入口**。没有历史上下文的读者读完本文 + 下面指引的文档，也能准确理解 Kith-space 是什么、怎么在这里工作。

## 一句话

Kith-space 是一个**桌面优先、单人使用的个人 AgentOS**：一个 Human 和本机一队有身份 / 职责 / 记忆的 agent 在多个本地 Space 中，通过频道、私聊、任务和 MCP 模块协作。正式产品只有 Electron Desktop；浏览器是 Desktop 可选开放的本机/LAN 入口。纯开源、宽松协议。

## 文档地图 — 按需导航

本文件与 `docs/` 是权威事实来源；README 只作门面展示。整个 `docs/` 的结构与各文档用途见 [`docs/index.md`](./docs/index.md)，按需阅读，不要一次全读。

### 接手新会话，先读

- `docs/dev-commands.md` — **日常开发命令**：Desktop/分进程启动、测试与打包。

### 理解产品与"为什么"

- `docs/vision.md` — 理念与长远愿景、永久边界。
- `docs/decisions.md` — 全部锁定决策与推理、权衡。
- `docs/glossary.md` — 术语正典，防口径漂移。
- `docs/kith-space/product-brief.md` — 产品定位。

### 设计与架构权威（动手前按需读）

- `docs/kith-space/agent-harness-v2-mechanisms.md` — **P-A10 Agent Harness v2 机制全景导读**：架构图、时序图、状态机。理解"这些机制如何共同工作"优先读这里。
- `docs/kith-space/architecture-proposal.md` — 目标架构：模块边界 / 信任边界 / runtime / 数据层 / 护栏。
- `docs/kith-space/ui-direction.md` — 界面信息架构与视觉语言。
- `docs/archive/specs/` — 各历史设计规格（已实现，按需查阅，不逐条列出）。

### 工程与协作

- `docs/dev-debugging.md` — 低频高级调试：内部凭据、浏览器模式、数据库、E2E、护栏与打包。
- `docs/frontend-standards.md` — **前端开发规范**：技术栈约束、代码约定与质量检查。
- `CONTRIBUTING.md` — **轻量贡献流程**：分支、中文提交、验证、PR、Squash 合并，以及使用 AI 开发的约束。

## 开发约定

- **技术栈**：TypeScript / Node（Core Service + 安装级唯一 Local Runtime Worker；目录/命令仍暂用 server/daemon）、Electron 43.1.0 + electron-builder 26.15.3、React 19.2.8 + Vite 5 + Tailwind CSS v4 + shadcn/ui、Drizzle ORM、SQLite。
- **包管理**：**pnpm 11.13.1**（根目录 `packageManager` 固定；workspace 仅根目录 + `web/`）。脚本参数**直接跟在后面、不加 `--`**——用 `pnpm test --unit`，不要写 `pnpm test -- --unit`。
- **数据层**：**SQLite**。每 Space 一个 `<folder>/.kith/workspace.db`（当前 workspace schema v16）；中央 `app.db`（当前 v12）保存唯一 Human、Home 身份、Space registry、Web 模式、访问 Token、浏览器会话、Desktop/外观设置、记忆/Advisor 控制面与模型/运行器配置。数据版本与迁移规则见对应 specs。
- **启动与发行**：推荐 `pnpm install` → `pnpm run desktop:dev`。全新数据目录由 Desktop 首次初始化界面创建 Human 与 `Home`，无需 `seed`。`desktop:build/bundle/pack/dist` 分别对应 main/preload、生产 bundle、Windows unpacked 与 NSIS 安装器；当前正式安装器仍是 Windows 未签名产物，公开分发前必须配置代码签名证书并完成真实安装/卸载验收。`server`、`daemon`、`web`、`browser-access:dev`、`dev:e2e:up` 保留为分进程调试入口。命令详见 `docs/dev-commands.md`，低频参数见 `docs/dev-debugging.md`。
- **测试**：内置 `node:test`。`pnpm test --unit` / `pnpm test --integration` / `pnpm run typecheck`。测试 runner 会把 `KITH_SPACE_HOME` 与 `KITH_SPACE_SPACES_DIR` 指向随机临时 profile。文本型契约测试不得依赖 CRLF/LF，读取后先转成 canonical LF 再验证。改动须配套运行相关测试并如实记录未通过项。
- **Git/PR**：轻量 GitHub Flow，只保留长期分支 `main`；**每次新功能或改动，都先从最新 `main` 拉一个短特性分支，在短分支上提交并推送到远程，再开 PR Squash 合入 `main`——不直推 `main`**。当前频繁开发阶段不为 `pull_request` 自动触发完整三端 CI，提交者须在 PR 中如实记录本地验证。提交使用中文 Conventional Commits。完整流程见 `CONTRIBUTING.md`。
- **提交权限**：只在用户明确要求时创建提交、推送或 PR；先分支，不直推 `main`。
- **安全**：外接 runtime 的高权限是追踪中的技术债。LAN 浏览器 v1 使用 HTTP + 访问 Token 且仅限受信任私网；邮箱/浏览器等不可信内容模块上线前，必须先完成 HTTPS 与审批/沙箱权限升级（见 `decisions.md` 决策 8/17/21）。

## 跨平台兼容规则

当前正式发行仍是 Windows x64 v1，macOS/Linux 为 planned；这不等于共享代码可以继续只按 Windows 设计。**所有新增或修改的功能都必须评估 Windows / macOS / Linux 三端**，遵守平台无关 API、无 shell 注入的进程边界、按平台建模的文件权限、canonical bytes/encoding、显式声明的 Electron/native 边界，以及平台无关测试契约。`skip` 只表示透明的未覆盖缺口，不能算通过。详细的平台缺口清单见 `docs/archive/cross-platform-compatibility.md`。

## AI 协作与工具

- 开始实现前明确目标、非目标、允许修改的范围、完成标准和验证方式；存在会改变结果的歧义时先说明并询问。
- 优先保持模块边界和最小必要修改。`src/server/core.ts` 等职责集中的底座文件改动牵一发动全身，优先在外围增加清晰的 guard 或模块，不整块重写。
- 结构性问题优先使用已初始化的 CodeGraph；只有独立且边界清晰的工作才适合分派子代理。关键设计事实先核实源码，再在文档中引用具体文件和行号。
- 修改前检查并保留用户已有工作；不清理与当前目标无关的代码、文件或格式。
- 完成后检查 `git status` 和完整 diff，并按风险运行类型检查、相关测试、完整测试或真实运行验证；没有执行的检查必须如实说明。
- `Co-Authored-By` 等署名只按实际贡献和既有全局约定使用，不虚构贡献者。
- Claude Code、Codex、opencode 等 AI 工具统一遵循本文件。`CLAUDE.md` 仅作为兼容入口指向本文件。

## 文档更新规则（按需，不机械同步）

原则：**文档只在"事实发生变化"时更新，不为"每次代码改动"更新**。小改动、纯实现细节、不改变对外契约的迭代，不需要动文档。以下是必须同步的场景：

- 改了**启动/测试/构建等命令或脚本** → 更新 `docs/dev-commands.md`；涉及低频调试参数时同步 `docs/dev-debugging.md`。
- 做了**新决策**或推翻旧决策 → 记入 `docs/decisions.md`；影响长远方向时同步 `docs/vision.md`。
- 改了**架构边界 / 数据模型 / 接口 / 护栏** → 更新 `docs/kith-space/architecture-proposal.md`。
- 改了 **UI 信息架构** → 更新 `docs/kith-space/ui-direction.md`。
- 引入**新术语**或术语含义变化 → 更新 `docs/glossary.md`。

不需要同步的：README 门面、`docs/archive/` 历史记录、已实现的历史规格（变更记录进 decisions，不回改已验收规格）。

判断标准：任何人（或 AI）只读文档、不看聊天记录，就能得到与代码一致的事实。文档与代码冲突时，先修文档使其准确。

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
