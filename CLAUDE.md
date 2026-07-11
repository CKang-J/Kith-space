# CLAUDE.md — Kith-space

**先读 [`AGENTS.md`](./AGENTS.md)。** 它是本仓库的规范入口（项目是什么、文档地图、核心原则、仓库结构、开发约定、当前进展）。本文件只补充给 Claude 的要点，不重复 AGENTS.md。

## 最重要的三件事

1. **权威在文档，不在记忆。** 先读 `docs/progress.md` 和 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`，再读 vision、decisions、roadmap 与相关专项设计。冲突时以最新权威规格和决策为准。
2. **本机个人 AgentOS 是永久边界。** 一个安装实例只有一个 Human、一个本机 Local Runtime Worker和多个本地 Space。多真人、多机器、服务器部署、公网托管、云同步和独立 Web 发行已经取消，不是“以后再做”。浏览器只是 Desktop 可选开放的本机/LAN 入口。
3. **守住核心原则**（详见 AGENTS.md）：harness 优先、角色通用、不做场景专用硬流程；不自研 runtime、模块经 MCP 暴露；local-first、Desktop-first、单 Human/单本机；宽松协议、不拷 OpenLoaf(AGPL) 代码；外科手术式最小改动。

## 协作与工具

- 底座 open-tag 的核心文件（如 `src/server/core.ts`）职责集中、改动牵一发动全身：一律在其外围新增 guard/模块，不整块重写。
- 涉及跨多文件的探索或结构性问题，优先用 codegraph（若已初始化）或分派子代理并行，别把大量源码灌进主上下文。
- 关键设计事实要先核实源码再下结论（本项目的决策就是这么定的，引用都带 `文件:行号`）。

## 开发命令

包管理是 **pnpm**（传参不加 `--`：`pnpm test --unit`）。启动/测试/数据库等**完整命令看 `docs/dev-commands.md`**。当前代码仍处于 `.env` + 分进程过渡期；目标是 Desktop 设置和内部临时凭据，不要把过渡方式误写成长期产品要求。

## 文档更新规则（强制，务必遵守）

代码/命令/架构/决策一旦变更，**必须在同一次改动里同步更新相应文档**，避免旧文档误导：命令改动 → `docs/dev-commands.md` + README；新/翻决策 → `docs/decisions.md`（+ vision/roadmap）；架构/接口/护栏 → `docs/kith-space/architecture-proposal.md`；UI → `ui-direction.md`；术语 → `glossary.md`；进展 → README 状态段。判断标准：只读文档不看聊天，也能得到与代码一致的事实。详见 `AGENTS.md` 同名章节。

## 提交

中文提交信息、列要点变更、防乱码；只在用户明确要求时提交；先分支不直推主干；改动配套跑测试（`pnpm test --unit` / `--integration`）。

Co-Authored-By 等规范遵循全局约定。
