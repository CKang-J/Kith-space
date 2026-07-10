# Kith-space

一个桌面优先、单人使用的**个人工作生活 OS**：你和一队有身份、职责、记忆的 agent 待在同一个空间里协作。

你在频道里群聊、也能和每个 agent 私聊；agent 由你本机的 Claude Code / Codex / opencode 承载，隔着 MCP 操控你的模块（任务、记忆，后续邮箱 / 日历 / 画布）。你 @leader 提一个需求，它能自己拆解、分派给其他 agent、最后汇总交付给你。

Kith 意为"你熟识信任的一圈自己人"——正是这些懂你（有记忆）、各有职责的 agent；`-space` 是你和它们共处的协作空间。

## 状态

开发进行中。以 open-tag 为底座（Apache-2.0）二次开发，吸收 OpenLoaf 的界面气质与理念。纯开源，宽松协议。已完成：改名、数据层迁 SQLite（每工作区独立 db）、编排护栏、三层记忆与角色模板、任务后端、包管理迁 pnpm。P4 正在把前端纠偏为 ChatOnly / Split / ModuleOnly 单窗口工作区，生产壳第一版等待视觉联调复核。

## 快速开始

包管理器是 **pnpm**。完整命令见 [`docs/dev-commands.md`](./docs/dev-commands.md)。

```bash
pnpm install
cp .env.example .env        # 填 JWT_SECRET、DAEMON_BOOTSTRAP_KEY（openssl rand -hex 32）
pnpm run dev:e2e:up         # 一键起 server + daemon + dev-bot，浏览器开 http://localhost:7777
```

手动分起：`pnpm run server`（API）、`pnpm run daemon`（承载 agent）、`pnpm --dir web run dev`（前端热更）。测试：`pnpm test --unit` / `pnpm test --integration`。

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

harness 优先、角色通用，不做场景专用硬流程；不自研 runtime，拥抱本机已有 runtime，模块经 MCP 暴露给 agent；local-first、桌面优先；工作区根植本地文件夹、自包含可移植。

## 许可证

Apache-2.0（继承自底座 open-tag，见 `LICENSE` / `NOTICE`）。
