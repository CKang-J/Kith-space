<p align="center">
  <img src="./assets/brand/kith-space-lockup-source.png" alt="Kith-space" width="640">
</p>

<p align="center">
  <a href="https://github.com/CKang-J/Kith-space/actions/workflows/ci.yml"><img src="https://github.com/CKang-J/Kith-space/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/CKang-J/Kith-space/stargazers"><img src="https://img.shields.io/github/stars/CKang-J/Kith-space?style=flat&amp;logo=github" alt="GitHub stars"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D4" alt="Windows, macOS and Linux">
  <img src="https://img.shields.io/badge/deployment-local--first-0E9F6E" alt="Local-first">
  <img src="https://img.shields.io/badge/runtimes-Claude%20Code%20%7C%20Codex%20%7C%20opencode-7C3AED" alt="Claude Code, Codex and opencode runtimes">
</p>

一个桌面优先、单人使用的**个人 AgentOS**：一个 Human 和本机一队有身份、职责、记忆的 agent，在多个本地 Space 中持续协作。

你在频道里群聊、也能和每个 agent 私聊；agent 由你本机的 Claude Code / Codex / opencode 承载，隔着 MCP 操控你的模块（任务、记忆，后续邮箱 / 日历 / 画布）。你 @leader 提一个需求，它能自己拆解、分派给其他 agent、最后汇总交付给你。

Kith 意为"你熟识信任的一圈自己人"——正是这些懂你（有记忆）、各有职责的 agent；`-space` 是你和它们共处的协作空间。

## 状态

开发进行中。以 open-tag 为底座（Apache-2.0）二次开发，吸收 OpenLoaf 的界面气质与理念。已完成 SQLite（每 Space 独立 db）、编排护栏、三层记忆、任务后端和 ChatOnly / Split / ModuleOnly 单窗口生产壳。

当前最高优先级是 2026-07-11 锁定的本机化转向：正式产品只有 Electron Desktop，一个 Human、一个本机 Local Runtime Worker、多个本地 Space；浏览器入口是 Desktop 可选开放的本机/LAN 附属能力。多真人、多机器、服务器部署、云同步、Docker、账户登录和独立 Web 发行路线已经取消。完整规格见 [`个人 AgentOS 本机化路线设计`](./docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md)。

本机化 A2-A6 原定代码切片与 P-A7 H1-H4 已完成并进入用户验收：中央 `app.db`、唯一 Human、canonical Space 契约、安装级唯一 Local Runtime Worker、19 表 workspace.db baseline、浏览器 Token/Cookie 安全边界和 Electron Desktop 宿主均已落地；app data 与默认 Space 容器已经分离，Home 使用 app.db 中的稳定身份并默认位于用户可见的 `~/Kith-space/Home`；Claude Code、Codex、opencode 以所属 Space root 为 cwd，Agent Memory 随 Space 存放；用户可在 Home-only Spaces 模块搜索、刷新、新建、接入、重连并同窗打开普通 Space。顶部 SpaceSwitcher 只负责快速切换、失联恢复和进入 Home Spaces。普通冷启动默认进入 Home Chat，显式可用 Space 深链接仍优先；普通 Space 不显示也不能激活 Spaces 模块。H5 与 Runtime 契约 v2 都保持暂停，等待用户完成 H1-H4 验收。完整补充规格见 [`Home 与 Space root 设计`](./docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md)。

P-A8 Agent 频道响应模式与频道全体提及已实现并等待用户验收：当前 Space 的 Agent 默认值可由顶层频道 membership 覆盖，三档为主动/被动/静音；Human-Agent 私聊和明确任务指派始终直达，话题继承父频道。“指派任务 + 单一 @Agent”会形成真实 assignee，无 `@` 保持未指派，多个 Agent mention 或 `@all` 在任务模式发送前拒绝。Human 在频道/话题发送语言无关的规范 token `@all` 时，按发送瞬间的父频道 Agent 成员生成接收者快照，主动/被动目标必须回应，静音目标不自动唤醒；Agent-authored 与 DM 文本不会群体展开。界面标签通过 i18n 显示“所有人 / Everyone”，历史消息和协议始终保留 `@all`。实时 wake、Worker reconnect、Agent message check 与 prompt 共用统一响应指令，Agent 详情默认卡片、频道昵称后覆盖菜单和 Composer 全体候选均已落地。Composer 已把照片/文件与“指派任务”合并到左下角圆形“+”菜单，任务启用后显示可移除胶囊并与正文共享单行空间；短单行草稿保持紧凑，只有任务胶囊与文字的合计占位接近右侧安全区、显式换行或附件存在时才展开。完整边界见 [`Agent 频道响应模式设计`](./docs/superpowers/specs/2026-07-14-agent-channel-response-mode-design.md)。

## Desktop 开发启动

包管理器是 **pnpm**。日常命令见 [`docs/dev-commands.md`](./docs/dev-commands.md)，低频调试见 [`docs/dev-debugging.md`](./docs/dev-debugging.md)。

推荐由 Desktop 启动完整开发进程组。全新数据目录无需预先 seed，首次窗口会要求填写 Human 名称（必填）、邮箱和描述（选填），随后进入 `Home`：

```bash
pnpm install
pnpm run desktop:dev        # 构建 Electron main/preload，并启动 Core + Worker + Vite + Electron
```

Desktop 每次启动或重启进程组都会生成相互独立的 Desktop/Worker 临时凭据，渲染器不可读取；Core 端口以 `app.db` 为准，并在 ready 后才启动 Worker 与 Vite。`pnpm run seed` 仅保留为手动分进程调试或测试 fixture 辅助；手动分起的 `server`、`daemon` 和 `web` 命令继续保留给调试，此时才需要开发者自行提供内部凭据。日常启动见 [`docs/dev-commands.md`](./docs/dev-commands.md)，Web 模式、访问 Token 与低频联调见 [`docs/dev-debugging.md`](./docs/dev-debugging.md)。测试：`pnpm test --unit` / `pnpm test --integration`；当前验收单测基线为 591/591。

Windows 构建分为四层：

```bash
pnpm run desktop:build       # 仅 Electron main/preload
pnpm run desktop:bundle      # Web + Core/Worker/agent CLI 生产 bundle
pnpm run desktop:pack        # dist/desktop/win-unpacked
pnpm run desktop:dist        # x64、per-user、assisted NSIS 安装器
```

当前生成的是可复现的本地/CI **未签名**安装器，不等于已公开发布。公开分发前仍需 Windows 代码签名证书；真实 NSIS 安装/卸载流程尚未执行验收。

## 文档

- 当前进度与续接指南（新会话先读）：[`docs/progress.md`](./docs/progress.md)
- Home 总控 Space、路径/cwd/记忆与跨 Space 委派：[`2026-07-12-home-space-and-space-root-design.md`](./docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md)
- Agent 默认/频道覆盖、任务指派与唤醒矩阵：[`2026-07-14-agent-channel-response-mode-design.md`](./docs/superpowers/specs/2026-07-14-agent-channel-response-mode-design.md)
- 日常开发命令（启动/测试/打包）：[`docs/dev-commands.md`](./docs/dev-commands.md)
- 高级开发与调试（Token/Web/数据库/E2E）：[`docs/dev-debugging.md`](./docs/dev-debugging.md)
- 理念与长远愿景：[`docs/vision.md`](./docs/vision.md)
- 全部设计决策与推理：[`docs/decisions.md`](./docs/decisions.md)
- 能力路线图（MVP 与之后）：[`docs/roadmap.md`](./docs/roadmap.md)
- 术语表：[`docs/glossary.md`](./docs/glossary.md)
- 专项设计（定位 / MVP / 架构 / UI / 迁移）：[`docs/kith-space/`](./docs/kith-space/)
- 参与开发：[`CONTRIBUTING.md`](./CONTRIBUTING.md)
- 项目背景与 AI 接手入口：[`AGENTS.md`](./AGENTS.md)

## 核心理念

harness 优先、角色通用，不做场景专用硬流程；不自研 runtime，模块经 MCP 暴露；local-first、Desktop-first、一个 Human、一台本机；Space 根植本地文件夹、自包含可移植。浏览器访问不改变单 Human、本机 agent 和本地数据边界。

## 许可证

Apache-2.0（继承自底座 open-tag，见 `LICENSE` / `NOTICE`）。
