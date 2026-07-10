# CLAUDE.md — Kith-space

**先读 [`AGENTS.md`](./AGENTS.md)。** 它是本仓库的规范入口（项目是什么、文档地图、核心原则、仓库结构、开发约定、当前进展）。本文件只补充给 Claude 的要点，不重复 AGENTS.md。

## 最重要的三件事

1. **权威在文档，不在记忆。** 动手前读 `docs/vision.md`（理念与长远）、`docs/decisions.md`（19 条决策 + 推理 + 演化）、`docs/roadmap.md`（分期）、相关的 `docs/kith-space/*.md`（专项设计）。这些冲突时以文档为准。
2. **理念不止 MVP。** 我们锁定的决策目前落在 MVP，但用户的构想覆盖 MVP 之外（邮箱/日历/画布、多真人、多设备、成熟人机团队协作等）。做任何改动都要对齐 `docs/vision.md` 的长远方向，别把产品做窄。
3. **守住核心原则**（详见 AGENTS.md）：harness 优先、角色通用、不做场景专用硬流程；不自研 runtime、模块经 MCP 暴露；local-first 桌面优先；宽松协议、不拷 OpenLoaf(AGPL) 代码；外科手术式最小改动。

## 协作与工具

- 底座 open-tag 的核心文件（如 `src/server/core.ts`）职责集中、改动牵一发动全身：一律在其外围新增 guard/模块，不整块重写。
- 涉及跨多文件的探索或结构性问题，优先用 codegraph（若已初始化）或分派子代理并行，别把大量源码灌进主上下文。
- 关键设计事实要先核实源码再下结论（本项目的决策就是这么定的，引用都带 `文件:行号`）。

## 开发命令

包管理是 **pnpm**（传参不加 `--`：`pnpm test --unit`）。启动/测试/数据库等**完整命令看 `docs/dev-commands.md`**；常用：`pnpm run dev:e2e:up`（一键起全栈）、`pnpm run server`、`pnpm run daemon`、`pnpm run typecheck`。

## 文档更新规则（强制，务必遵守）

代码/命令/架构/决策一旦变更，**必须在同一次改动里同步更新相应文档**，避免旧文档误导：命令改动 → `docs/dev-commands.md` + README；新/翻决策 → `docs/decisions.md`（+ vision/roadmap）；架构/接口/护栏 → `docs/kith-space/architecture-proposal.md`；UI → `ui-direction.md`；术语 → `glossary.md`；进展 → README 状态段。判断标准：只读文档不看聊天，也能得到与代码一致的事实。详见 `AGENTS.md` 同名章节。

## 提交

中文提交信息、列要点变更、防乱码；只在用户明确要求时提交；先分支不直推主干；改动配套跑测试（`pnpm test --unit` / `--integration`）。

Co-Authored-By 等规范遵循全局约定。
