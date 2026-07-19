# AGENTS.md — Kith-space

本文件是任何 AI agent（Claude Code / Codex / opencode 等）或人类贡献者接手本仓库时的**首读入口**。目标：即使没有任何历史对话上下文，读完本文 + 下面指引的文档，也能准确理解 Kith-space 是什么、为什么这样设计、当前进展、以及怎么在这里工作。

## 一句话

Kith-space 是一个**桌面优先、单人使用的个人 AgentOS**：一个 Human 和本机一队有身份 / 职责 / 记忆的 agent 在多个本地 Space 中，通过频道、私聊、任务和 MCP 模块协作。正式产品只有 Electron Desktop；浏览器是 Desktop 可选开放的本机/LAN 入口。以 open-tag 为底座二次开发，吸收 OpenLoaf 的界面气质与理念，纯开源、宽松协议。

## 先读这些（文档地图 — 唯一事实来源）

动手前请按需读。**这些文档是权威，本 README/记忆若与之冲突，以文档为准。**

- `docs/progress.md` — **当前进度与续接指南**：做到哪、下一步、leader 调度与验收约定、易丢失的关键技术事实。**新会话/新模型接手先读这个。**
- `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md` — **当前产品路线总规格**：单 Human、本机 agent、Desktop/Web 边界、删除范围与 A1-A6 验收。
- `docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md` — **当前 Home/Space root 补充规格**：Home 总控 Space、用户文件夹、runtime cwd、记忆归属与跨 Space 委派；H1-H4 已完成并通过本轮用户验收，H5 尚未开始。
- `docs/superpowers/specs/2026-07-14-agent-channel-response-mode-design.md` — **Agent 频道响应模式规格**：Space 默认、频道覆盖、唤醒/响应指令矩阵、任务指派与 UI；已实现并通过本轮用户验收。
- `docs/superpowers/specs/2026-07-15-chat-message-ui-density-design.md` — **聊天消息流密度与交互重构规格**：消息气泡、字体与间距、工具交互、表现层组件边界、实施切片和量化验收；代码、自动化验证与用户手动视觉验收均已完成。
- `docs/superpowers/specs/2026-07-15-chat-shell-sidebar-module-navigation-design.md` — **Chat 壳层与侧栏模块导航规格**：ChatOnly 纵向模块入口、模块打开态 Dock、三组会话抽屉、中心 Chat 卡片保护、画布式会话导航与案例展示退役；代码、自动化验证与用户手动视觉验收均已完成。
- `docs/superpowers/specs/2026-07-18-desktop-modular-monolith-architecture-design.md` — **P-A9 桌面模块化单体架构收敛规格**：保留 Desktop/Core/Worker 拓扑与 TypeScript 主栈，按深 Module、窄 Interface、可替换 Seam 和性能基线渐进拆分；P-A9.0–P-A9.7 已完成并提交，真实存量数据暴露的 Runtime admission 队列饥饿与错误状态传播也已完成根因修复。
- `docs/superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md` — **P-A10 Agent Harness v2 规格**：per-surface session generation、durable delivery/logical turn/attempt、Context Envelope、server-owned thread reply、broker-backed MCP/CLI Gateway、revisioned episodic memory、disclosure/suppression、continuity recall 与分阶段验收；P-A10.0–P-A10.3 已实现，P-A10.4–P-A10.7 继续实施中。
- `docs/vision.md` — 北极星：完整理念 + **超越 MVP 的长远愿景**。理解"为什么"从这里开始。
- `docs/decisions.md` — 全部决策（30 条，含 1 条已审查但未实现提案）+ 推理 + 权衡 + **被推翻/修正的决策**演化脉络。理解"凭什么这样定"看这里。
- `docs/roadmap.md` — 产品能力分期：当前 A1-A6 与其后的本机能力路线，并区分延后能力和永久非目标。
- `docs/glossary.md` — 术语正典，防口径漂移。术语拿不准查这里。
- `docs/kith-space/` — 5 份专项设计文档：
  - `product-brief.md` 产品定位；`mvp-spec.md` v1 范围与验收；
  - `architecture-proposal.md` 目标架构（模块边界 / 信任边界 / runtime / 数据层 / 护栏）；
  - `ui-direction.md` 界面信息架构；`migration-plan.md` 从 open-tag fork 的分阶段工程步骤。
- `docs/dev-commands.md` — **日常开发命令权威来源**：Desktop/分进程启动、测试与打包。跑起项目先看这里。
- `docs/dev-debugging.md` — 低频高级调试：内部凭据、浏览器模式、数据库、E2E 联调、护栏与打包细节。
- `CONTRIBUTING.md` — **轻量贡献流程**：分支、中文提交、验证、PR、Squash 合并，以及使用 AI 开发时的约束。
- `docs/agent-collaboration-project-exploration.md` — 最初对四个源项目的探索报告（背景参考）。

## 不可动摇的核心原则

所有设计与实现都必须服从这些（详见 `docs/vision.md`）：

1. **harness 优先、角色通用、不做场景专用硬流程。** 把工具 / 上下文 / 记忆 / 协议这套系统环境设计好，让通用 agent 自主决策用哪个工具。开发只是众多角色场景之一（还有调研 / 文案 / 测试…），**绝不为"做开发"而硬编码 git / 测试 / 构建流水线**。
2. **不自研 runtime。** 拥抱本机已有 runtime（Claude Code / Codex / opencode），通过适配器接入；自建模块能力经 **MCP** 暴露给 agent，而不是把 agent 逻辑写进应用。
3. **local-first、Desktop-first、一个 Human、一台本机。** 数据在用户机器上；Space 根植本地文件夹、自包含可移植。多真人、远程 agent 主机、服务器部署、云同步和独立 Web 产品不属于路线。
4. **纯开源 + 宽松协议（Apache-2.0 / MIT）。** 因此**不得拷贝 AGPLv3 的 OpenLoaf 源码**——它只能作设计参考（思路不受版权保护，代码不可复制）。
5. **外科手术式修改，最小必要改动。** 匹配底座 open-tag 的既有风格，不顺手重构无关代码。

## 仓库结构

```
D:\Projects\multi-agent\           ← Kith-space 开发根目录
├─ reference/                      ← 四个原项目 + 界面截图，只读上游，永不在此开发；后续引用/对照都来这找
│   ├─ open-tag/  (Apache-2.0，本项目底座；保留其 .git 供对照上游)
│   ├─ openagents/ (Apache-2.0，多设备/connector 参考)
│   ├─ OpenLoaf/  (AGPLv3，仅设计参考，禁止拷代码)
│   ├─ zano/      (MIT，局部交互参考)
│   └─ screenshots/  (四项目界面参考图)
├─ src/ web/ scripts/ test/             ← 开发源码，初始 = 从 reference/open-tag 复制（不含 node_modules/.git）
├─ package.json  tsconfig.json  drizzle.config.ts …  ← 构建配置（来自 open-tag）
├─ LICENSE  NOTICE                 ← 沿用 open-tag 的 Apache-2.0，NOTICE 追加衍生署名
├─ AGENTS.md  CONTRIBUTING.md  README.md ← 项目与贡献入口
├─ CLAUDE.md                     ← 兼容入口，仅指向 AGENTS.md
└─ docs/                           ← 见上面文档地图
```

代码引用约定：文档里 `db/schema.ts:12` 这类行号引用，指向**根目录 `src/`**（开发副本），与 `reference/open-tag/` 内容初始一致。

## 开发约定

- 技术栈：TypeScript / Node（Core Service + 安装级唯一 Local Runtime Worker；目录/命令仍暂用 server/daemon）、Electron 43.1.0 + electron-builder 26.15.3（正式 Desktop 宿主与 Windows 打包）、React + Vite（共享 UI）、Drizzle ORM。
- 包管理：**pnpm 11.13.1**（由根目录 `packageManager` 固定；workspace 仅根目录 + `web/`，`pnpm-lock.yaml`）。安装 `pnpm install`。注意 pnpm 的传参约定：脚本参数**直接跟在后面、不加 `--`**——用 `pnpm test --unit` / `pnpm test --integration`，**不要**写 `pnpm test -- --integration`。公共 daemon 包与 npm/OIDC 发布 workflow 已在 A6 删除；仓库不再维护公共 npm 发行路线。
- 数据层：**SQLite**。每 Space 一个 `<folder>/.kith/workspace.db`；中央 `app.db` 保存唯一 Human、稳定 Home 身份、Space registry、Web 模式、访问 Token 哈希/版本、浏览器会话与 Desktop 关闭/自启动设置。A2.2b 的19表baseline已在P-A8升至v5；P-A10当前workspace schema v6以三个不可变journal前缀加入session、durable turn及legacy dispatch recovery索引，共34张产品表，并保留`agents.session_id`作为互斥legacy rollback来源，绝不回填到per-surface session。app data 默认 `~/.kith-space`，默认 Space 容器为 `~/Kith-space`，Home 为 `~/Kith-space/Home`；`KITH_SPACE_HOME` 只覆盖 app data，`KITH_SPACE_SPACES_DIR` 独立覆盖开发/测试默认 Space 容器。P-A7 H2 已把 Claude Code、Codex、opencode 的 cwd 切到所属 Space root，把 Agent Memory 放入 `<space>/.kith/agents/<agentId>`，把 adapter 临时状态留在 app data runtime 目录；Agents 详情的“记忆”文件浏览器只读取当前 agentMemoryDir。Copilot/Kimi/Cursor 仍为 experimental adapter并暂用runtime state cwd。H3/H4的Space root与Home边界不变。v2/v3/v4/v5、P-A10.1与P-A10.2的合法v6前缀会按immutable manifest/journal count迁移到完整v6；更旧legacy或future schema明确拒绝。
- 测试：内置 `node:test`（`src/**/*.test.ts`、`test/**`）。`pnpm test --unit` 跑单测、`pnpm test --integration` 跑集成、`pnpm run typecheck` 类型检查。测试 runner 会同时把 `KITH_SPACE_HOME` 与 `KITH_SPACE_SPACES_DIR` 指向随机临时 profile，零 Postgres/Redis 即可全绿；当前验收单测基线为736通过、11个平台条件skip、0失败，旧 `publicNavContract` 失败已随失效的 public landing 路线删除。改动配套跑测试再提交。
- 启动与发行：推荐 `pnpm install` → `pnpm run desktop:dev`。全新数据目录由 Desktop 首次初始化界面收集 Human 名称（必填）、邮箱和描述（选填），并创建 `Home`，不再要求预先执行 `seed`；`pnpm run seed` 只保留为手动分进程调试或 fixture 辅助。Desktop 统一启动 Core Service、唯一 Local Runtime Worker、开发期 Vite 与 Electron；每次进程组启动/重启生成相互独立的 Desktop/Worker 临时凭据，普通用户和渲染器都不接触它们。`desktop:build` 只构建 Electron main/preload；`desktop:bundle` 生成 Web + Core/Worker/agent CLI 生产 bundle；`desktop:pack` 生成 Windows unpacked 目录；`desktop:dist` 生成 x64、per-user、assisted NSIS 安装器，输出在 `dist/desktop/`。当前安装器是可复现的本地/CI **未签名**产物，公开分发前必须配置 Windows 代码签名证书；尚未完成真实 NSIS 安装/卸载验收。`server`、`daemon`、`web`、`browser-access:dev` 和 `dev:e2e:up` 继续作为分进程调试入口；只有这类手动调试才从可选本地 `.env` 或进程环境注入独立内部凭据。日常命令以 `docs/dev-commands.md` 为准，低频参数以 `docs/dev-debugging.md` 为准。
- Git/PR：采用轻量 GitHub Flow，只保留长期分支 `main`；从最新 `main` 创建短分支，通过 PR 和 CI 后 Squash 合入。提交使用中文 Conventional Commits，必要时用中文要点说明原因、边界和验证结果。完整流程见 `CONTRIBUTING.md`。
- 提交权限：只在用户明确要求时创建提交、推送或 PR；先分支，不直推 `main`。
- 安全：外接 runtime 的高权限是追踪中的技术债。LAN 浏览器 v1 使用 HTTP + 访问 Token且仅限受信任私网；邮箱/浏览器等不可信内容模块上线前，必须先完成 HTTPS 与审批/沙箱权限升级（见 `decisions.md` 决策 8/17/21）。

## AI 协作与工具

- 开始实现前明确目标、非目标、允许修改的范围、完成标准和验证方式；存在会改变结果的歧义时先说明并询问。
- 优先保持模块边界和最小必要修改。`src/server/core.ts` 等职责集中的底座文件改动牵一发动全身，优先在外围增加清晰的 guard 或模块，不整块重写。
- 结构性问题优先使用已初始化的 CodeGraph；只有独立且边界清晰的工作才适合分派子代理。关键设计事实先核实源码，再在文档中引用具体文件和行号。
- 修改前检查并保留用户已有工作；不清理与当前目标无关的代码、文件或格式。
- 完成后检查 `git status` 和完整 diff，并按风险运行类型检查、相关测试、完整测试或真实运行验证；没有执行的检查必须如实说明。
- `Co-Authored-By` 等署名只按实际贡献和既有全局约定使用，不虚构贡献者。
- Claude Code、Codex、opencode 等 AI 工具统一遵循本文件，不维护工具专属的重复规则。`CLAUDE.md` 仅作为兼容入口指向本文件。

## 文档更新规则（强制）

代码/命令/架构/决策一旦变更，**必须在同一次改动里同步更新相应文档**，不留旧内容误导后来者：

- 改了**启动/测试/构建等命令**或脚本 → 更新 `docs/dev-commands.md`；涉及低频调试参数时同步 `docs/dev-debugging.md`，并检查 `README.md`、本文件里引用的命令是否还准。
- 做了**新决策**或推翻旧决策 → 记入 `docs/decisions.md`（含推理与被推翻项）；影响长远方向的同步 `docs/vision.md`、`docs/roadmap.md`。
- 改了**架构/数据模型/接口/护栏** → 更新 `docs/kith-space/architecture-proposal.md`（引用带 `文件:行号`）。
- 改了 **UI 信息架构** → 更新 `docs/kith-space/ui-direction.md`。
- 引入**新术语**或术语含义变化 → 更新 `docs/glossary.md`。
- 阶段进展变化 → 更新 `README.md` 状态段与 `docs/roadmap.md`。

判断标准：任何人（或 AI）只读文档、不看聊天记录，就能得到与代码一致的事实。文档与代码冲突时，先修文档使其准确，再继续。

## 当前进展

**进度以 `docs/progress.md` 为权威来源**（本段不重复，避免漂移）。截至 2026-07-19：A2-A6、P-A7 H1-H4、P4/P-A8、本轮聊天与壳层 UI、P-A9.0–P-A9.7及P-A10.0–P-A10.3均已完成；支持runtime的新Agent已通过durable delivery/turn、server-owned thread、Context Envelope和最小Gateway实际使用v2，既有Agent可显式互斥cutover。P-A10.4–P-A10.7、H5与结构化记忆继续实施。做到哪、下一步与关键发行边界全部见 `docs/progress.md`。

<!-- CODEGRAPH_START -->

## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question                                                  | Tool                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| "Where is X defined?" / "Find symbol named X"             | `codegraph_search`                                           |
| "What calls function Y?"                                  | `codegraph_callers`                                          |
| "What does Y call?"                                       | `codegraph_callees`                                          |
| "How does X reach/become Y? / trace the flow from X to Y" | `codegraph_trace` (one call = the whole path, incl. callback/React/JSX dynamic hops) |
| "What would break if I changed Z?"                        | `codegraph_impact`                                           |
| "Show me Y's signature / source / docstring"              | `codegraph_node`                                             |
| "Give me focused context for a task/area"                 | `codegraph_context`                                          |
| "See several related symbols' source at once"             | `codegraph_explore`                                          |
| "What files exist under path/"                            | `codegraph_files`                                            |
| "Is the index healthy?"                                   | `codegraph_status`                                           |

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" / architecture questions, answer with 2-3 codegraph calls: `codegraph_context` first, then ONE `codegraph_explore` for the source of the symbols it surfaces. For a specific **flow** ("how does X reach Y") start with `codegraph_trace` from→to — one call returns the whole path with dynamic hops bridged — then ONE `codegraph_explore` for the bodies; don't rebuild the path with `codegraph_search` + `codegraph_callers`. Codegraph IS the pre-built index, so spawning a separate file-reading sub-task/agent — or running a grep + read loop — repeats work codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_context` is one call.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore` call returns several symbols' source grouped in a single capped call, while each separate node/Read call re-reads the whole context and costs far more.
- **Index lag — check the staleness banner, don't guess a wait.** When a codegraph response starts with "⚠️ Some files referenced below were edited since the last index sync…", the listed files are pending re-index — Read those specific files for accurate content. Files NOT in that banner are fresh and codegraph is authoritative for them. `codegraph_status` also lists pending files under "Pending sync".

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: *"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"*
<!-- CODEGRAPH_END -->
