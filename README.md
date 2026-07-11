# Kith-space

一个桌面优先、单人使用的**个人 AgentOS**：一个 Human 和本机一队有身份、职责、记忆的 agent，在多个本地 Space 中持续协作。

你在频道里群聊、也能和每个 agent 私聊；agent 由你本机的 Claude Code / Codex / opencode 承载，隔着 MCP 操控你的模块（任务、记忆，后续邮箱 / 日历 / 画布）。你 @leader 提一个需求，它能自己拆解、分派给其他 agent、最后汇总交付给你。

Kith 意为"你熟识信任的一圈自己人"——正是这些懂你（有记忆）、各有职责的 agent；`-space` 是你和它们共处的协作空间。

## 状态

开发进行中。以 open-tag 为底座（Apache-2.0）二次开发，吸收 OpenLoaf 的界面气质与理念。已完成 SQLite（每 Space 独立 db）、编排护栏、三层记忆、任务后端和 ChatOnly / Split / ModuleOnly 单窗口生产壳。

当前最高优先级是 2026-07-11 锁定的本机化转向：正式产品只有 Electron Desktop，一个 Human、一个本机 Local Runtime Worker、多个本地 Space；浏览器入口是 Desktop 可选开放的本机/LAN 附属能力。多真人、多机器、服务器部署、云同步、Docker、账户登录和独立 Web 发行路线已经取消。完整规格见 [`个人 AgentOS 本机化路线设计`](./docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md)。

本机化 A2-A3 已完成：中央 `app.db`、唯一 Human、默认 `Home` Space、canonical Space 契约、安装级唯一 Local Runtime Worker、19 表 workspace.db baseline 与 Space 级附件目录均已落地。浏览器入口已收口为默认关闭/仅本机/局域网三模式，使用独立访问 Token、持久 Cookie 会话和 CSRF/Origin 保护；Human JWT、dev-login、`?as=` 与 URL token 已退役。下一步进入 A4 Electron Desktop 宿主。

## 当前过渡开发启动

包管理器是 **pnpm**。完整命令见 [`docs/dev-commands.md`](./docs/dev-commands.md)。

下面命令准确反映**当前代码**。A4 完成后，普通用户将由 Desktop 管理设置和内部凭据，不再维护 `.env`；当前分进程开发仍需两个相互独立的内部凭据。

```bash
pnpm install
cp .env.example .env        # 填 KITH_SPACE_DESKTOP_TOKEN、KITH_SPACE_WORKER_TOKEN（分别生成）
pnpm run dev:e2e:up         # 启用 local Web，起 Core Service + Worker + dev-bot，终端一次显示访问 Token
```

手动分起：`pnpm run server`、`pnpm run daemon`（唯一 Local Runtime Worker 的过渡命令名）、`pnpm --dir web run dev`（前端热更）。Core Service 根据 app.db 中的 Web 模式选择 loopback/LAN 监听；关闭模式仍保留 Desktop/Worker 所需的私有 loopback 传输，但拒绝普通浏览器壳。完整启动、Web 模式与访问 Token 说明见 [`docs/dev-commands.md`](./docs/dev-commands.md)。测试：`pnpm test --unit` / `pnpm test --integration`。

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
