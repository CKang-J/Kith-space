# Kith-space

一个桌面优先、单人使用的**个人 AgentOS**：一个 Human 和本机一队有身份、职责、记忆的 agent，在多个本地 Space 中持续协作。

你在频道里群聊、也能和每个 agent 私聊；agent 由你本机的 Claude Code / Codex / opencode 承载，隔着 MCP 操控你的模块（任务、记忆，后续邮箱 / 日历 / 画布）。你 @leader 提一个需求，它能自己拆解、分派给其他 agent、最后汇总交付给你。

Kith 意为"你熟识信任的一圈自己人"——正是这些懂你（有记忆）、各有职责的 agent；`-space` 是你和它们共处的协作空间。

## 状态

开发进行中。以 open-tag 为底座（Apache-2.0）二次开发，吸收 OpenLoaf 的界面气质与理念。已完成 SQLite（每 Space 独立 db）、编排护栏、三层记忆、任务后端和 ChatOnly / Split / ModuleOnly 单窗口生产壳。

当前最高优先级是 2026-07-11 锁定的本机化转向：正式产品只有 Electron Desktop，一个 Human、一个本机 Local Runtime Worker、多个本地 Space；浏览器入口是 Desktop 可选开放的本机/LAN 附属能力。多真人、多机器、服务器部署、云同步、Docker、账户登录和独立 Web 发行路线已经取消。完整规格见 [`个人 AgentOS 本机化路线设计`](./docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md)。

本机化 A2-A5 已完成：中央 `app.db`、唯一 Human、默认 `Home` Space、canonical Space 契约、安装级唯一 Local Runtime Worker、19 表 workspace.db baseline 与 Space 级附件目录均已落地。浏览器入口已收口为默认关闭/仅本机/局域网三模式，使用独立访问 Token、持久 Cookie 会话和 CSRF/Origin 保护；Human JWT、dev-login、`?as=` 与 URL token 已退役。Electron 43.1.0 Desktop 现已成为正式开发宿主，统一监督 Core Service、唯一 Worker 与开发期 Vite，管理托盘、关闭行为、Web 入口和内部凭据。全新目录不再需要 seed：Desktop 首次初始化界面收集本地 Human 资料并创建 `Home`。Landing、PWA、旧 `Layout`、登录/注册/邀请残留已经删除，模块统一使用当前会话路径上的 canonical query，浏览器操作明确表达为撤销授权会话而非账户退出。下一步是 A6 继承部署/发布资产清理、Windows 正式打包/安装器与总审计。

## Desktop 开发启动

包管理器是 **pnpm**。完整命令见 [`docs/dev-commands.md`](./docs/dev-commands.md)。

推荐由 Desktop 启动完整开发进程组。全新数据目录无需预先 seed，首次窗口会要求填写 Human 名称（必填）、邮箱和描述（选填），随后进入 `Home`：

```bash
pnpm install
pnpm run desktop:dev        # 构建 Electron main/preload，并启动 Core + Worker + Vite + Electron
```

Desktop 每次启动或重启进程组都会生成相互独立的 Desktop/Worker 临时凭据，渲染器不可读取；Core 端口以 `app.db` 为准，并在 ready 后才启动 Worker 与 Vite。`pnpm run desktop:build` 只构建 Electron main/preload，不生成安装器。`pnpm run seed` 仅保留为手动分进程调试或测试 fixture 辅助；手动分起的 `server`、`daemon` 和 `web` 命令继续保留给调试，此时才需要开发者自行提供内部凭据。完整启动、Web 模式与访问 Token 说明见 [`docs/dev-commands.md`](./docs/dev-commands.md)。测试：`pnpm test --unit` / `pnpm test --integration`；A5 当前单测基线为 439/439。

## 文档

- 当前进度与续接指南（新会话先读）：[`docs/progress.md`](./docs/progress.md)
- 开发命令（启动/测试/数据库）：[`docs/dev-commands.md`](./docs/dev-commands.md)
- 理念与长远愿景：[`docs/vision.md`](./docs/vision.md)
- 全部设计决策与推理：[`docs/decisions.md`](./docs/decisions.md)
- 能力路线图（MVP 与之后）：[`docs/roadmap.md`](./docs/roadmap.md)
- 术语表：[`docs/glossary.md`](./docs/glossary.md)
- 专项设计（定位 / MVP / 架构 / UI / 迁移）：[`docs/kith-space/`](./docs/kith-space/)
- 贡献者与 AI 接手入口：[`AGENTS.md`](./AGENTS.md)

## 核心理念

harness 优先、角色通用，不做场景专用硬流程；不自研 runtime，模块经 MCP 暴露；local-first、Desktop-first、一个 Human、一台本机；Space 根植本地文件夹、自包含可移植。浏览器访问不改变单 Human、本机 agent 和本地数据边界。

## 许可证

Apache-2.0（继承自底座 open-tag，见 `LICENSE` / `NOTICE`）。
