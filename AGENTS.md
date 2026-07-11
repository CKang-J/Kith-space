# AGENTS.md — Kith-space

本文件是任何 AI agent（Claude Code / Codex / opencode 等）或人类贡献者接手本仓库时的**首读入口**。目标：即使没有任何历史对话上下文，读完本文 + 下面指引的文档，也能准确理解 Kith-space 是什么、为什么这样设计、当前进展、以及怎么在这里工作。

## 一句话

Kith-space 是一个**桌面优先、单人使用的个人 AgentOS**：一个 Human 和本机一队有身份 / 职责 / 记忆的 agent 在多个本地 Space 中，通过频道、私聊、任务和 MCP 模块协作。正式产品只有 Electron Desktop；浏览器是 Desktop 可选开放的本机/LAN 入口。以 open-tag 为底座二次开发，吸收 OpenLoaf 的界面气质与理念，纯开源、宽松协议。

## 先读这些（文档地图 — 唯一事实来源）

动手前请按需读。**这些文档是权威，本 README/记忆若与之冲突，以文档为准。**

- `docs/progress.md` — **当前进度与续接指南**：做到哪、下一步、leader 调度与验收约定、易丢失的关键技术事实。**新会话/新模型接手先读这个。**
- `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md` — **当前产品路线总规格**：单 Human、本机 agent、Desktop/Web 边界、删除范围与 A1-A6 验收。
- `docs/vision.md` — 北极星：完整理念 + **超越 MVP 的长远愿景**。理解"为什么"从这里开始。
- `docs/decisions.md` — 全部决策（21 条）+ 推理 + 权衡 + **被推翻/修正的决策**演化脉络。理解"凭什么这样定"看这里。
- `docs/roadmap.md` — 产品能力分期：当前 A1-A6 与其后的本机能力路线，并区分延后能力和永久非目标。
- `docs/glossary.md` — 术语正典，防口径漂移。术语拿不准查这里。
- `docs/kith-space/` — 5 份专项设计文档：
  - `product-brief.md` 产品定位；`mvp-spec.md` v1 范围与验收；
  - `architecture-proposal.md` 目标架构（模块边界 / 信任边界 / runtime / 数据层 / 护栏）；
  - `ui-direction.md` 界面信息架构；`migration-plan.md` 从 open-tag fork 的分阶段工程步骤。
- `docs/dev-commands.md` — **开发命令权威来源**：环境准备、服务启动、测试、数据库、护栏环境变量。跑起项目看这里。
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
├─ src/ web/ packages/ scripts/ test/   ← 开发源码，初始 = 从 reference/open-tag 复制（不含 node_modules/.git）
├─ package.json  tsconfig.json  drizzle.config.ts …  ← 构建配置（来自 open-tag）
├─ LICENSE  NOTICE                 ← 沿用 open-tag 的 Apache-2.0，NOTICE 追加衍生署名
├─ AGENTS.md  CLAUDE.md  README.md ← Kith-space 自己的
└─ docs/                           ← 见上面文档地图
```

代码引用约定：文档里 `db/schema.ts:12` 这类行号引用，指向**根目录 `src/`**（开发副本），与 `reference/open-tag/` 内容初始一致。

## 开发约定

- 技术栈：TypeScript / Node（server + daemon）、React + Vite（web）、Drizzle ORM。
- 包管理：**pnpm**（workspace：根 + `web/` + `packages/*`，`pnpm-lock.yaml`）。安装 `pnpm install`。注意 pnpm 的传参约定：脚本参数**直接跟在后面、不加 `--`**——用 `pnpm test --unit` / `pnpm test --integration`，**不要**写 `pnpm test -- --integration`。当前 OIDC/npm 发布 workflow 是 A6 待删除遗留，不是产品发行路线。
- 数据层：**SQLite**。每 Space 一个 `<folder>/.kith/workspace.db`；中央 `app.db` 保存唯一 Human 和 Space registry。A2 仍在清理 workspace.db 内的兼容 user/owner 投影。非 open-tag 原来的 Postgres+Redis。详见 `architecture-proposal.md §5`。
- 测试：内置 `node:test`（`src/**/*.test.ts`、`test/**`）。`pnpm test --unit` 跑单测、`pnpm test --integration` 跑集成、`pnpm run typecheck` 类型检查。跑测试时把 `KITH_SPACE_HOME` 指向临时目录，零 Postgres/Redis 即可全绿（既有 `publicNavContract` 因缺 `docs-site/` 失败，非回归）。改动配套跑测试再提交。
- 启动：当前过渡代码仍使用 `pnpm install` → 配 `.env` → `pnpm run dev:e2e:up`，或手动分起 server/daemon/web。目标态由 Desktop 管理设置与内部凭据并提供 `pnpm run desktop:dev`，普通用户不维护 `.env`。**以当前 `docs/dev-commands.md` 为准，不得提前写入尚未实现的命令。**
- 提交：中文提交信息，列要点变更；只在用户明确要求时提交；先分支不直推主干。
- 安全：外接 runtime 的高权限是追踪中的技术债。LAN 浏览器 v1 使用 HTTP + 访问 Token且仅限受信任私网；邮箱/浏览器等不可信内容模块上线前，必须先完成 HTTPS 与审批/沙箱权限升级（见 `decisions.md` 决策 8/17/21）。

## 文档更新规则（强制）

代码/命令/架构/决策一旦变更，**必须在同一次改动里同步更新相应文档**，不留旧内容误导后来者：

- 改了**启动/测试/构建等命令**或脚本 → 更新 `docs/dev-commands.md`，并检查 `README.md`、本文件里引用的命令是否还准。
- 做了**新决策**或推翻旧决策 → 记入 `docs/decisions.md`（含推理与被推翻项）；影响长远方向的同步 `docs/vision.md`、`docs/roadmap.md`。
- 改了**架构/数据模型/接口/护栏** → 更新 `docs/kith-space/architecture-proposal.md`（引用带 `文件:行号`）。
- 改了 **UI 信息架构** → 更新 `docs/kith-space/ui-direction.md`。
- 引入**新术语**或术语含义变化 → 更新 `docs/glossary.md`。
- 阶段进展变化 → 更新 `README.md` 状态段与 `docs/roadmap.md`。

判断标准：任何人（或 AI）只读文档、不看聊天记录，就能得到与代码一致的事实。文档与代码冲突时，先修文档使其准确，再继续。

## 当前进展

**进度以 `docs/progress.md` 为权威来源**（本段不重复，避免漂移）。截至 2026-07-11：A1 文档路线已提交；A2.1 `app.db + 唯一 Human + Home`、A2.5 本地附件存储和 A2.2a Space 传输/API/前端术语已经落地。下一步删除 Human membership/RBAC 与 Machine，再压平 workspace.db 的旧物理 schema。做到哪、下一步与关键过渡事实全部见 `docs/progress.md`。

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
