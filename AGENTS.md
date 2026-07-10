# AGENTS.md — Kith-space

本文件是任何 AI agent（Claude Code / Codex / opencode 等）或人类贡献者接手本仓库时的**首读入口**。目标：即使没有任何历史对话上下文，读完本文 + 下面指引的文档，也能准确理解 Kith-space 是什么、为什么这样设计、当前进展、以及怎么在这里工作。

## 一句话

Kith-space 是一个**桌面优先、单人使用的"个人工作生活 OS"**：你和一队有身份 / 职责 / 记忆的 agent 待在一个空间里，通过频道群聊和私聊协作；agent 由本机的 Claude Code / Codex / opencode 承载，隔着 MCP 操控你的模块（v1 是任务与记忆，后续是邮箱 / 日历 / 画布）；你 @leader 提需求，它能自动拆解、分派给其他 agent、并汇总交付。以 open-tag 为底座二次开发，吸收 OpenLoaf 的界面气质与理念，纯开源、宽松协议。

## 先读这些（文档地图 — 唯一事实来源）

动手前请按需读。**这些文档是权威，本 README/记忆若与之冲突，以文档为准。**

- `docs/vision.md` — 北极星：完整理念 + **超越 MVP 的长远愿景**。理解"为什么"从这里开始。
- `docs/decisions.md` — 全部 19 条决策 + 推理 + 权衡 + **被推翻/修正的决策**演化脉络。理解"凭什么这样定"看这里。
- `docs/roadmap.md` — 产品能力分期：MVP 做什么、之后做什么、为何延后（延后 ≠ 放弃）。
- `docs/glossary.md` — 术语正典，防口径漂移。术语拿不准查这里。
- `docs/kith-space/` — 5 份专项设计文档：
  - `product-brief.md` 产品定位；`mvp-spec.md` v1 范围与验收；
  - `architecture-proposal.md` 架构（模块边界 / runtime 接口 / 数据层 / 护栏，含源码行号引用）；
  - `ui-direction.md` 界面信息架构；`migration-plan.md` 从 open-tag fork 的分阶段工程步骤。
- `docs/agent-collaboration-project-exploration.md` — 最初对四个源项目的探索报告（背景参考）。

## 不可动摇的核心原则

所有设计与实现都必须服从这些（详见 `docs/vision.md`）：

1. **harness 优先、角色通用、不做场景专用硬流程。** 把工具 / 上下文 / 记忆 / 协议这套系统环境设计好，让通用 agent 自主决策用哪个工具。开发只是众多角色场景之一（还有调研 / 文案 / 测试…），**绝不为"做开发"而硬编码 git / 测试 / 构建流水线**。
2. **不自研 runtime。** 拥抱本机已有 runtime（Claude Code / Codex / opencode），通过适配器接入；自建模块能力经 **MCP** 暴露给 agent，而不是把 agent 逻辑写进应用。
3. **local-first、桌面优先、单人为主。** 数据在用户机器上；工作区根植本地文件夹、自包含可移植。
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
- 包管理：**pnpm**（workspace：根 + `web/` + `packages/*`，`pnpm-lock.yaml`）。安装 `pnpm install`。注意 pnpm 的传参约定：脚本参数**直接跟在后面、不加 `--`**——用 `pnpm test --unit` / `pnpm test --integration`，**不要**写 `pnpm test -- --integration`（那样参数不会传到脚本、会跑全量）。（发布 workflow 保留 `npm publish` 以护住 OIDC 免 token 发布。）
- 数据层：**SQLite**（每工作区一个 `<folder>/.kith/workspace.db` + 中心 registry），非 open-tag 原来的 Postgres+Redis。详见 `architecture-proposal.md §5`。
- 测试：内置 `node:test`（`src/**/*.test.ts`、`test/**`）。`pnpm test --unit` 跑单测、`pnpm test --integration` 跑集成、`pnpm run typecheck` 类型检查。跑测试时把 `KITH_SPACE_HOME` 指向临时目录，零 Postgres/Redis 即可全绿（既有 `publicNavContract` 因缺 `docs-site/` 失败，非回归）。改动配套跑测试再提交。
- 提交：中文提交信息，列要点变更；只在用户明确要求时提交；先分支不直推主干。
- 安全：v1 单人单机接受外接 runtime 的 `bypassPermissions` + 目录隔离，但这是**追踪中的技术债**——一旦上邮箱/浏览器模块或开启跨设备 web 访问，必须先上认证/沙箱/权限重估（见 `decisions.md` 决策 8/17）。

## 当前进展（2026-07-09）

- 设计阶段完成：19 条决策锁定、项目名定为 **Kith-space**、5 份专项设计文档 + 4 份纲领文档（vision/decisions/roadmap/glossary）齐备。
- **待办的物理搭建**（因编辑器占用文件句柄未完成，需关闭 VS Code / Codex 后执行）：把四个原项目移入 `reference/`；用 `git archive` 从 `reference/open-tag` 导出干净源码（排除 node_modules/.git）复制到根目录；保留 LICENSE/NOTICE。`reference/` 目录已建好。
- 下一步开发从 **P0** 起（fork 改名 + 数据层迁移 SQLite + 工作区文件夹化），见 `migration-plan.md`。
