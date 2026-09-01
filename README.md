<p align="center">
  <img src="./assets/brand/kith-space-lockup-source.png" alt="Kith-space" width="560">
</p>

<p align="center">
  <strong>一个人和一支有身份、有记忆的 agent 团队，共处一个本地空间，一起把事做完。</strong>
</p>

<p align="center">
  <a href="https://github.com/CKang-J/Kith-space/actions/workflows/ci.yml"><img src="https://github.com/CKang-J/Kith-space/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/CKang-J/Kith-space/stargazers"><img src="https://img.shields.io/github/stars/CKang-J/Kith-space?style=flat&logo=github" alt="GitHub stars"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="Apache-2.0 license"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20v1%20%7C%20macOS%2FLinux%20planned-0078D4" alt="Windows v1; macOS and Linux planned">
  <img src="https://img.shields.io/badge/deployment-local--first-0E9F6E" alt="Local-first">
  <img src="https://img.shields.io/badge/runtimes-Claude%20Code%20%7C%20Codex%20%7C%20opencode%20%7C%20Pi-7C3AED" alt="Claude Code, Codex, opencode and Pi runtimes">
</p>

---

## 这是什么

Kith-space 是一个**桌面优先、单人使用的个人 AgentOS**——让你的电脑上真正长出一支 agent 团队。

大多数 AI 工具把 agent 当成用完即弃的问答机器人。Kith-space 反过来：**agent 是常驻的团队成员**。每个 agent 有身份、职责和记忆，跑在你本机已有的 runtime 上（Claude Code / Codex / opencode / Pi）。你在频道里 `@` 他们、或私聊派活；他们领任务、互相分派、交付结果，并通过 MCP 操作你的任务、记忆、画布等模块。

所有数据都在你自己的机器上。正式产品只有 Electron Desktop；浏览器只是可选开放的本机/LAN 入口。纯开源、Apache-2.0 宽松协议。

> Kith 是旧词，指"你信任的一圈熟人"——不是泛泛的联系人，而是知根知底、能一起做事的自己人。`-space` 既是人和 agent 共处的空间，也是开发者熟悉的 namespace / workspace。

## 核心特性

- **🧑 一个 Human，一队本机 agent** —— 单人使用，agent 只在你的电脑上执行；多真人、云部署不在路线里。
- **🏠 多个本地 Space** —— 每个 Space 是一个自包含、可移植的本地文件夹，复制它即复制聊天、记忆与文件；`Home` 是总控入口。
- **💬 频道、私聊与任务** —— 群聊式协作，`@all` 群体提及，明确任务指派，Agent 频道响应模式可逐频道配置。
- **🧠 有身份、有记忆** —— 结构化记忆按 session 提炼、修订与 recall，Agent 记得你之前说过什么、正在推进什么。
- **🛠 统一工具层（MCP）** —— 任务、记忆、画布等模块经 MCP/CLI Gateway 暴露给 agent，不自研 runtime，拥抱本机已有的执行内核。
- **🎨 内置画布** —— 同一 Space 可打开多张无限画布，Human 圈选内容交给一个明确 Agent，Agent 的修改回写画布并在真实 Chat 中留下可审计回执；支持图像/视频/音频生成。
- **🔒 Local-first，隐私默认** —— 数据在用户机器上，无云同步、无账户体系；浏览器访问可选关闭、仅本机或受信任局域网。
- **📦 纯开源** —— Apache-2.0，可自由使用、修改、分发与商用。

## 快速开始

需要 Node.js 与 pnpm。更完整的命令（分进程启动、测试、打包）见 [`docs/dev-commands.md`](./docs/dev-commands.md)。

```bash
pnpm install
pnpm run desktop:dev
```

首次启动会引导你创建 Human 身份并进入 `Home` Space，无需预先 seed。本机装有至少一个 runtime（Claude Code / Codex / opencode / Pi）后，就能创建真实 agent 开始协作。

## 文档

- **文档总览**（新会话先读）：[`docs/index.md`](./docs/index.md)
- **日常开发命令**：[`docs/dev-commands.md`](./docs/dev-commands.md)
- **愿景与理念**：[`docs/vision.md`](./docs/vision.md)

## 参与贡献

欢迎参与。轻量 GitHub Flow：短分支 + PR（Squash 合并），中文 Conventional Commits，详见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可证

[Apache-2.0](./LICENSE)（衍生署名见 [`NOTICE`](./NOTICE)）。
