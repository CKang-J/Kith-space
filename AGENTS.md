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
- `docs/superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md` — **P-A10 Agent Harness v2 规格**：per-surface session generation、durable delivery/logical turn/attempt、Context Envelope、server-owned thread reply、broker-backed MCP/CLI Gateway、revisioned episodic memory、restricted advisor、disclosure/suppression、continuity recall、checklist/snapshot/compaction telemetry与分阶段验收；P-A10.0–P-A10.7已完成。
- `docs/superpowers/specs/2026-07-22-system-memory-advisor-provider-design.md` — **系统级可替换 Memory Advisor Provider 规格**：把结构化记忆提炼从聊天 runtime 解耦；新安装默认使用内置、精确锁版的 Pi SDK Provider，Claude Code 可切换，并把执行 Provider、Advisor Model Profile、Pi CLI 全局配置安全导入、能力门禁和 revisioned consent 分层；切片0–4已实现。
- `docs/superpowers/specs/2026-07-23-model-provider-runtime-memory-settings-design.md` — **模型供应商、运行器与记忆设置重构规格**：已实现；以Kith配置为事实源，CLI配置只读导入、启动时注入，统一模型供应商/模型配置/运行器边界，把Pi提升为第四个正式v2 runtime，并重构Memory Advisor与Agent记忆页。
- `docs/superpowers/specs/2026-08-15-recombyn-canvas-workspace-design.md` — **Recombyn Canvas Workspace 规格**：阶段1–4已实现；保留Recombyn RCB内部UI，正式Workspace Tabs、Canvas Core/SQLite、本地资产、Selection Snapshot/Chat 联动、Access Grant、Gateway/MCP/CLI 与 Agent 写回已接入；生产入口受 `KITH_CANVAS_AGENT_EXECUTION` 保护，阶段5硬化与真实 smoke 仍待后续。
- `docs/kith-space/agent-harness-v2-mechanisms.md` — **P-A10 机制全景导读**：以架构图、时序图和状态机系统解释会话、投递/turn、Context Envelope、话题路由、结构化记忆、MCP/CLI Gateway、消息落 UI、恢复与安全边界；理解“这些机制如何共同工作”优先读这里。
- `docs/vision.md` — 北极星：完整理念 + **超越 MVP 的长远愿景**。理解"为什么"从这里开始。
- `docs/decisions.md` — 记录全部锁定决策；决策 38 已接受 Recombyn Canvas Module 方案，当前阶段1–3已实现，同时保留推理、权衡和**被推翻/修正的决策**演化脉络。理解"凭什么这样定"看这里。
- `docs/roadmap.md` — 产品能力分期：当前 A1-A6 与其后的本机能力路线，并区分延后能力和永久非目标。
- `docs/glossary.md` — 术语正典，防口径漂移。术语拿不准查这里。
- `docs/kith-space/` — 5 份专项设计文档：
  - `product-brief.md` 产品定位；`mvp-spec.md` v1 范围与验收；
  - `architecture-proposal.md` 目标架构（模块边界 / 信任边界 / runtime / 数据层 / 护栏）；
  - `ui-direction.md` 界面信息架构；`migration-plan.md` 从 open-tag fork 的分阶段工程步骤。
- `docs/dev-commands.md` — **日常开发命令权威来源**：Desktop/分进程启动、测试与打包。跑起项目先看这里。
- `docs/dev-debugging.md` — 低频高级调试：内部凭据、浏览器模式、数据库、E2E 联调、护栏与打包细节。
- `docs/cross-platform-compatibility.md` — **Windows/macOS/Linux 工程兼容基线与缺口清单**：当前证据、严重度、修复顺序和新功能验收模板。
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

当前数据版本：workspace schema v14在v13 Selection Snapshot/`message_execution_bindings` 之上增加 `canvas_access_grants`、`turn_output_artifacts` 与 binding `binding_source`；app.db v10在v9安装级三作用域字体与12–16px UI字号之上增加全局 light / dark / system 颜色模式。下方较早的v9/v5描述仅是历史基线。

- 技术栈：TypeScript / Node（Core Service + 安装级唯一 Local Runtime Worker；目录/命令仍暂用 server/daemon）、Electron 43.1.0 + electron-builder 26.15.3（正式 Desktop 宿主与 Windows 打包）、React 19.2.8 + Vite 5 + Tailwind CSS v4 + shadcn/ui（共享 UI）、Drizzle ORM。
- 包管理：**pnpm 11.13.1**（由根目录 `packageManager` 固定；workspace 仅根目录 + `web/`，`pnpm-lock.yaml`）。安装 `pnpm install`。注意 pnpm 的传参约定：脚本参数**直接跟在后面、不加 `--`**——用 `pnpm test --unit` / `pnpm test --integration`，**不要**写 `pnpm test -- --integration`。公共 daemon 包与 npm/OIDC 发布 workflow 已在 A6 删除；仓库不再维护公共 npm 发行路线。
- 数据层：**SQLite**。每 Space 一个 `<folder>/.kith/workspace.db`；中央 `app.db` 保存唯一 Human、稳定 Home 身份、Space registry、Web 模式、访问 Token 哈希/版本、浏览器会话、Desktop设置、安装级外观设置、Human-only user-global episodic memory、安装级Advisor Provider控制面，以及模型供应商、模型配置和runtime profile。当前workspace schema v14在v13 `canvas_selection_snapshots` / `message_execution_bindings` 之上增加 `canvas_access_grants`、`turn_output_artifacts`，并为 binding 增加 `binding_source`；app.db当前为v10。Canvas canonical scene、revision、ledger与资产状态归workspace SQLite所有，文件位于Space内`.kith/canvas-assets`。阶段3把选区冻结为不可变 Selection Snapshot，并与 Chat message context ref、server-owned `MessageExecutionBinding` 和 executor required delivery 同事务写入；阶段4从 binding+bound delivery+frozen snapshot 派生 durable `CanvasAccessGrant`，经现有 Capability Gateway/MCP/CLI thin tools 读回写，并以 `turn_output_artifacts` 关联已提交 mutation；生产入口受 `KITH_CANVAS_AGENT_EXECUTION` 保护。`agents.session_id`仍只作互斥legacy rollback来源。app data 默认 `~/.kith-space`，默认 Space 容器为 `~/Kith-space`，Home 为 `~/Kith-space/Home`；`KITH_SPACE_HOME` 只覆盖 app data，`KITH_SPACE_SPACES_DIR` 独立覆盖开发/测试默认 Space 容器。P-A7 H2 已把 Claude Code、Codex、opencode、Pi 的 cwd 切到所属 Space root，把 Agent Memory 放入 `<space>/.kith/agents/<agentId>`，把 adapter 临时状态和Pi generation留在app data runtime目录；Agents 详情的“记忆”文件浏览器只读取当前 agentMemoryDir。Copilot/Kimi/Cursor 仍为 experimental adapter并暂用runtime state cwd。H3/H4的Space root与Home边界不变。v2–v12合法workspace前缀与app.db v1–v9会按immutable manifest/journal迁移到当前版本；workspace migration SQL固定为LF，兼容层只额外接受历史Windows CRLF checkout产生的逐文件精确hash，未知journal仍拒绝；更旧legacy或future schema明确拒绝。
- 测试：内置 `node:test`（`src/**/*.test.ts`、`test/**`）。`pnpm test --unit` 跑单测、`pnpm test --integration` 跑集成、`pnpm run typecheck` 类型检查。测试 runner 会同时把 `KITH_SPACE_HOME` 与 `KITH_SPACE_SPACES_DIR` 指向随机临时 profile。文本型契约测试不得依赖 checkout 的 CRLF/LF，读取后应先转成 canonical LF 再验证语义。2026-07-25 三端兼容收口后的本机 Windows 结果以当前分支验证记录为准；远端 Ubuntu/Windows/macOS 矩阵仍以实际 CI 结果为准，不能在未运行前表述为三端全绿。改动须配套运行相关测试并如实记录未通过项。
- 启动与发行：推荐 `pnpm install` → `pnpm run desktop:dev`。全新数据目录由 Desktop 首次初始化界面收集 Human 名称（必填）、邮箱和描述（选填），并创建 `Home`，不再要求预先执行 `seed`；`pnpm run seed` 只保留为手动分进程调试或 fixture 辅助。Desktop 统一启动 Core Service、唯一 Local Runtime Worker、开发期 Vite 与 Electron；每次进程组启动/重启生成相互独立的 Desktop/Worker 临时凭据，普通用户和渲染器都不接触它们。`desktop:build` 只构建 Electron main/preload；`desktop:bundle` 生成 Web + Core/Worker/agent CLI 生产 bundle；`desktop:pack` 在隔离staging中重建native dependency并生成Windows unpacked目录，不改写开发树ABI；`desktop:dist` 生成x64、per-user、assisted NSIS安装器，输出在`dist/desktop/`。常规CI在Ubuntu、Windows、macOS执行typecheck、unit、integration和bundle，但当前正式安装器仍是Windows未签名产物；公开分发前必须配置Windows代码签名证书并完成真实安装/卸载验收。`server`、`daemon`、`web`、`browser-access:dev` 和 `dev:e2e:up` 继续作为分进程调试入口；`stop`、worktree与E2E入口均为跨shell Node脚本，手动分进程模式仍只从可选本地`.env`或进程环境注入独立内部凭据。日常命令以`docs/dev-commands.md`为准，低频参数以`docs/dev-debugging.md`为准。
- Git/PR：采用轻量 GitHub Flow，只保留长期分支 `main`；从最新 `main` 创建短分支，通过 PR Squash 合入。当前频繁开发阶段不为 `pull_request` 自动触发完整三端 CI，提交者须在 PR 中如实记录本地验证；完整矩阵在推送到 `main` 后自动执行，也可按需手动触发。提交使用中文 Conventional Commits，必要时用中文要点说明原因、边界和验证结果。完整流程见 `CONTRIBUTING.md`。
- 提交权限：只在用户明确要求时创建提交、推送或 PR；先分支，不直推 `main`。
- 安全：外接 runtime 的高权限是追踪中的技术债。LAN 浏览器 v1 使用 HTTP + 访问 Token且仅限受信任私网；邮箱/浏览器等不可信内容模块上线前，必须先完成 HTTPS 与审批/沙箱权限升级（见 `decisions.md` 决策 8/17/21）。

## 跨平台兼容规则（强制）

当前正式发行仍是 Windows x64 v1，macOS/Linux 属于 planned；这不等于共享代码可以继续只按 Windows 设计。所有新增或修改的功能都必须评估 Windows、macOS、Linux，并遵守：

- 共享逻辑使用 `node:path`、`node:os`、URL 和平台无关 API；不得写死盘符、`/tmp`、路径分隔符、文件名大小写或某一 shell。确实需要 PowerShell、Bash、`taskkill` 等能力时，放在窄平台 Adapter 中并有明确 capability/unsupported 结果。
- runtime/CLI 启动统一经过可解析 Windows `.cmd`/PATHEXT 的无 shell-injection Port；进程退出语义必须覆盖普通退出、取消、超时、崩溃和后代进程回收，不能把 Unix signal 或 process group 语义直接套到 Windows。
- 文件权限按平台事实建模：macOS/Linux 使用 uid、mode、symlink 与 executable bit；Windows 使用 owner/DACL、junction/reparse point 和共享锁语义。不得用 Node 在 Windows 合成的 POSIX mode 作为安全判断，也不得因为 Windows 无 mode 就跳过其他完整性校验。
- 磁盘格式和可移植数据必须固定 canonical bytes/encoding；换行、Unicode、大小写、保留名、长路径、原子 rename、文件占用和 SQLite/native module 行为都要纳入设计。含凭据、prompt、turn 或其他敏感内容的临时文件必须在成功、失败、取消、超时和崩溃恢复路径统一清理。
- Electron 与 native dependency 必须显式声明 OS、arch、ABI、图标、托盘、登录启动、签名/公证和安装/升级/卸载边界；不同平台实现放在同一 Interface 后的 Adapter，不在业务模块散落条件分支。
- 测试优先写平台无关行为契约，再补 Windows/macOS/Linux 平台测试。`skip` 只能表示透明的未覆盖缺口，不能算通过；改动触及平台边界时，至少运行当前宿主定向测试，并在 PR 中说明其他两端由 CI、真实 smoke 还是待办清单覆盖。
- 文档命令优先给平台无关写法；shell 专属步骤同时提供 PowerShell 与 POSIX 版本，或明确标注支持平台和依赖。新增已知缺口同步登记到 `docs/cross-platform-compatibility.md`。

## 前端开发规范与规则

### 技术栈规范

- 前端框架使用 React 19 + TypeScript，构建工具使用 Vite。
- 新增 UI 与新增样式统一使用 Tailwind CSS v4；除主题变量、Tailwind/shadcn 基础层及必须维护的存量样式外，不新增全局 CSS、局部 CSS 或 CSS Modules。
- 基础 UI 组件优先使用 shadcn/ui，并从 `@/components/ui/*` 导入；先检查已有组件或用 shadcn CLI 添加，不手写已有的复杂交互组件。
- 存量 CSS 按触达范围渐进迁移，不做一次性全量重写。对已有页面做结构性 UI 修改时，在范围可控的前提下迁移被修改组件；纯缺陷修复可最小修改原样式，避免为了迁移扩大改动面。

### 组件架构与导入规范

- 界面、交互逻辑、请求、工具和类型保持清晰边界；组件 Props 必须定义明确的 TypeScript 类型。
- Button、Card、Dialog、Dropdown Menu、Tabs、表单控件等基础元素优先复用 shadcn/ui；弹窗、菜单、标签页等复杂交互不得重复手写状态机。
- 动态或条件类名统一使用 `@/lib/utils` 的 `cn()`，不手写模板字符串拼接。
- 使用 `@/*` 路径别名导入 `web/src/*`，避免新增深层相对路径。

### 样式与布局标准

- 新写布局、间距、颜色、排版以及 hover/focus/disabled 等状态必须通过 Tailwind 原子类表达。
- 禁止内联 `style={{ ... }}`；仅鼠标实时坐标、测量结果、Canvas 偏移等无法预先枚举的运行时数值允许例外，并应附简短说明。
- 使用 `sm:`、`md:`、`lg:` 等响应式前缀；颜色优先使用 `bg-background`、`text-foreground`、`bg-muted` 等 shadcn 语义 Token，不散落原始颜色值。暗色主题通过语义 Token 适配，仅在语义 Token 无法表达时使用 `dark:`。
- 间距优先使用 `flex/grid + gap-*`，不使用 `space-x-*` / `space-y-*`；宽高相同使用 `size-*`。
- shadcn 组件优先使用既有 variant 和 size；业务层 `className` 主要负责布局，不覆盖组件内部颜色与排版。

### 前端代码质量检查

生成或重构 React 前端代码时，至少确认：

1. 组件职责单一、拆分适度，没有把界面、请求和复杂状态继续堆入大型组件。
2. 已优先复用 shadcn/ui，Dialog/Sheet/Drawer 具备可访问标题，表单、菜单、Tabs 等遵循组件组合约束。
3. Props 与状态类型明确，`cn()`、语义 Token、响应式和键盘/焦点状态使用正确。
4. 未新增无必要的 CSS 文件、CSS Modules、内联样式或重复实现的基础交互组件。
5. `pnpm run typecheck` 与 `pnpm run web:build` 通过；涉及行为时补充并运行相应测试。

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

**进度以 `docs/progress.md` 为权威来源**（本段不重复，避免漂移）。截至 2026-07-23：A2-A6、P-A7 H1-H4、P4/P-A8、本轮聊天与壳层 UI、P-A9.0–P-A9.7及P-A10.0–P-A10.7均已完成；支持runtime的新Agent已通过durable delivery/turn、server-owned thread、Context Envelope、完整Gateway、revisioned episodic recall、advisor和snapshot实际使用v2，既有Agent可显式互斥cutover。系统级可替换Memory Advisor Provider切片0–4也已实现：fresh默认内置Pi SDK、Claude Code可切换、模型Profile独立、Pi CLI配置显式安全导入，Claude/Codex/opencode聊天Agent可在逐Agent同意后共享系统Provider。H5、P-A11、P-A12与P-S1继续独立实施。做到哪、下一步与关键发行边界全部见 `docs/progress.md`。

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
