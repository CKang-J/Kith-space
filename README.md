# Kith-space

一个桌面优先、单人使用的**个人 AgentOS**：一个 Human 和本机一队有身份、职责、记忆的 agent，在多个本地 Space 中持续协作。

你在频道里群聊、也能和每个 agent 私聊；agent 由你本机的 Claude Code / Codex / opencode 承载，隔着 MCP 操控你的模块（任务、记忆，后续邮箱 / 日历 / 画布）。你 @leader 提一个需求，它能自己拆解、分派给其他 agent、最后汇总交付给你。

Kith 意为"你熟识信任的一圈自己人"——正是这些懂你（有记忆）、各有职责的 agent；`-space` 是你和它们共处的协作空间。

## 状态

开发进行中。以 open-tag 为底座（Apache-2.0）二次开发，吸收 OpenLoaf 的界面气质与理念。已完成 SQLite（每 Space 独立 db）、编排护栏、三层记忆、任务后端和 ChatOnly / Split / ModuleOnly 单窗口生产壳。

当前最高优先级是 2026-07-11 锁定的本机化转向：正式产品只有 Electron Desktop，一个 Human、一个本机 Local Runtime Worker、多个本地 Space；浏览器入口是 Desktop 可选开放的本机/LAN 附属能力。多真人、多机器、服务器部署、云同步、Docker、账户登录和独立 Web 发行路线已经取消。完整规格见 [`个人 AgentOS 本机化路线设计`](./docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md)。

本机化 A2 已完成中央 `app.db`、唯一 Human、默认 `Home` Space、本地附件存储、canonical Space 契约、A2.3 唯一 Human 协作边界，以及 A2.4 Machine/Computer/远程 worker 活跃产品路径删除。当前由安装级唯一 Local Runtime Worker 承载所有本机 Space 的 agent 并跨 Space 路由事件。下一步是 A2.2b 破坏性压平 workspace.db；旧多用户表、`machines`/`agents.machine_id` 物理残留、raw `user` discriminator 和临时 JWT/dev-login 按后续切片处理。

## 当前过渡开发启动

包管理器是 **pnpm**。完整命令见 [`docs/dev-commands.md`](./docs/dev-commands.md)。

下面命令准确反映**当前代码**。个人 AgentOS 改造完成后，普通用户不再维护 `.env`，并将增加 `pnpm run desktop:dev`；在 Desktop 接管配置与内部凭据前不要提前删除过渡配置。

```bash
pnpm install
cp .env.example .env        # 填 JWT_SECRET、DAEMON_BOOTSTRAP_KEY（openssl rand -hex 32）
pnpm run dev:e2e:up         # 一键起 Core Service + Local Runtime Worker + dev-bot，浏览器开 http://127.0.0.1:7777
```

手动分起：`pnpm run server`（API，当前仅监听 127.0.0.1）、`pnpm run daemon`（唯一 Local Runtime Worker 的过渡命令名）、`pnpm --dir web run dev`（前端热更）。`dev:e2e:up` 会等待 `/health.workerConnected` 后再继续。测试：`pnpm test --unit` / `pnpm test --integration`。

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
