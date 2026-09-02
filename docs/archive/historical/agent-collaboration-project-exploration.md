# 多 Agent 协作项目探索报告

> 历史调研说明：本文记录 2026-07-09 选底座时对四个项目的原始探索，包含当时尚未排除的多真人、多设备、公网和云端方案。2026-07-11 产品已锁定为单 Human、本机 agent、Desktop 唯一正式宿主；本文中的多设备/公网内容只用于解释参考项目，不是 Kith-space 路线。当前结论见 `docs/archive/specs/2026-07-11-personal-agent-os-local-pivot-design.md`。

日期：2026-07-09

## 1. 探索目标

本次探索围绕一个仍在成形中的产品方向：

> 人类和多个 agent 在同一个工作空间内协作。每个 agent 有身份、职责、记忆和可选 runtime。用户可以在频道/群聊里 @agent，也可以和 agent 私聊。agent 可以领取、分派、交付任务，并能操作项目内的功能模块，例如文件、任务、邮箱、日历、画布等。

用户当前倾向：

- 不想自己从零造 agent runtime，优先连接本地已有 runtime，例如 Claude Code、Codex、OpenCode 等。
- 想要频道/群聊/私聊形态，而不是孤立聊天窗口。
- 想要多个 agent 组成团队，例如 leader、开发、测试，由 leader 分派任务并汇总交付。
- 想要 agent 有独立身份、职责提示词、记忆和工作区。
- 想吸收 OpenLoaf 的界面、画布、跨会话记忆、邮箱/日历等原生可操作模块。
- 技术栈偏好 Web/TypeScript，但能接受底层有必要的非 Web 部分。

本次由 4 个并行子代理分别只读探索：

- `openagents/`
- `open-tag/`
- `zano/`
- `OpenLoaf/`

所有探索均未修改项目代码。部分项目未初始化 CodeGraph，子代理按只读要求没有执行初始化，改用源码、文档、配置和测试文件静态梳理。

## 2. 一句话结论

如果首要目标是“人类 + 多个本地 runtime agent 在频道/私聊/任务中协作”，最适合的主底座是 **open-tag**。

如果首要目标变成“本地优先 AI 生产力桌面，带项目、画布、邮箱、日历、记忆和自研 agent”，主底座才应转向 **OpenLoaf**。

当前更推荐的路线是：

> 以 `open-tag` 做协作和 runtime 底座，吸收 `OpenLoaf` 的产品形态、局部 UI、记忆/技能/画布/邮箱/日历思想；参考 `openagents` 的多设备 workspace 和浏览器/文件能力；`zano` 只作为轻量交互参考，不建议作为主底座。

## 3. 横向评分矩阵

| 项目 | 底座评分 | 最适合承担 | 技术栈契合 | 协作空间成熟度 | 本地 runtime 接入 | 工具/生产力模块 | 最大风险 |
|---|---:|---|---|---|---|---|---|
| `open-tag` | 8/10 | 主协作底座 | 高：TypeScript/React/Node | 高：channel/thread/DM/task/inbox | 高：多 runtime adapter + daemon | 中：附件、任务、workspace file、activity | 早期项目，`core.ts` 业务集中，UI/store 较大，安全 hardening 未完 |
| `openagents` | 7.5/10 | 多设备 workspace / connector 参考 | 中：Python + FastAPI + Next + Node connector | 中高：thread/files/browser/tasks | 高：runtime 覆盖很广 | 高：共享浏览器、文件、workspace URL | 多栈混合，安全隔离偏 MVP，DM/task 不够一等公民 |
| `OpenLoaf` | 7/10 | 本地 AI 生产力 OS 底座 | 高：TS/Next/Hono/tRPC/Electron | 低：缺内部频道/群聊/DM 模型 | 中：自研 runtime 强，外部 runtime adapter 弱 | 极高：画布、邮箱、日历、任务、项目、记忆 | AGPL、代码规模大、runtime/工具/项目耦合深 |
| `zano` | 5.5/10 | 轻量交互参考 | 高：Next/Supabase/Node | 中：channel/DM 骨架有，thread/task UI 不完整 | 低中：基本硬编码 Claude Code | 低中：agent workspace、memory | schema 漂移、RLS/bridge 边界弱、测试/迁移不足 |

## 4. 项目详查

### 4.1 open-tag

#### 定位

`open-tag` 是一个自托管的 Slack-like multi-agent workspace。人类和 agent 在 workspace/channel/thread/DM/task 中协作，agent 由本地 daemon 承载，可以被 @mention 唤醒、领取任务、上传附件、记录活动轨迹。

关键证据：

- `open-tag/README.md`
- `open-tag/ARCHITECTURE.md`
- `open-tag/FEATURES.md`

#### 技术结构

主要边界：

- Server：`open-tag/src/server/index.ts`
- 消息/任务/mention/wake 核心：`open-tag/src/server/core.ts`
- Human REST API：`open-tag/src/server/routes-api/`
- Agent API：`open-tag/src/server/routes-agent.ts`
- Daemon WS：`open-tag/src/server/ws.ts`
- Daemon hub：`open-tag/src/server/daemonHub.ts`
- Runtime adapter interface：`open-tag/src/daemon/runtime.ts`
- Runtime registry：`open-tag/src/daemon/runtimes.ts`
- Agent manager：`open-tag/src/daemon/agentManager.ts`
- Agent CLI：`open-tag/src/cli/index.ts`
- DB schema：`open-tag/src/db/schema.ts`
- Web app：`open-tag/web/src/`

技术栈：

- TypeScript ESM
- Node server
- React + Vite
- Drizzle + Postgres
- Redis
- socket.io
- raw WebSocket
- Commander CLI

#### Runtime 与 agent 隔离

已支持 runtime：

- `claude`
- `codex`
- `copilot`
- `opencode`
- `kimi`
- `pi`
- `cursor`
- `hermes`

核心接口是 `Runtime.start(opts, callbacks)`，返回 `RuntimeSession`，再通过 `deliver()`、`stop()` 与上层交互。

隔离模型：

- 每个 agent 有独立 `agentId`
- 每个 agent 有独立本地 workspace：`~/.open-tag/agents/<agentId>/`
- 每个 agent 有 `MEMORY.md`
- `agents.sessionId` 存 DB
- agent 绑定 `machineId`
- server 能通过 daemon hub 定向发送到对应 machine

这非常贴近“同一 runtime 可创建多个 agent，agent 有独立身份/职责/记忆/工作区”的目标。

#### 通信模型

`open-tag` 的三平面设计是它最值得复用的部分：

- Human/Web plane：React SPA -> `/api/*` + socket.io
- Daemon control plane：Server <-> Daemon，raw WS `/daemon/connect?key=...`
- Agent data plane：Agent process -> `/agent-api/*`，通过注入的 `open-tag` CLI 调用

典型链路：

1. 人类在 channel/DM/thread 发消息。
2. Server 写 DB、广播给 Web。
3. wake policy 判断是否唤醒 agent。
4. Server 通过 daemon WS 发送 `agent:start` 或 `agent:deliver`。
5. Daemon 启动或投递给 runtime。
6. Agent 通过 `open-tag message check/send` 等 CLI 读写协作空间。
7. 回复再次进入 Server，广播给所有人。

#### 数据模型

核心表：

- `users`
- `servers`
- `server_members`
- `machines`
- `agents`
- `channels`
- `channel_members`
- `messages`
- `message_mentions`
- `attachments`
- `reminders`
- `agent_activity_log`
- `saved_messages`
- `join_links`

任务不是独立表，而是 message 上的 task 字段。这使“把一条消息转任务，再在线程里推进”很自然。

#### UI 可复用性

可复用：

- workspace/channel/DM/thread 聊天
- composer
- @mention
- attachments
- task board
- inbox/mentions/saved
- agent profile
- machine connect wizard
- live trace
- agent workspace file browser

主要 UI 文件：

- `open-tag/web/src/views/Chat.tsx`
- `open-tag/web/src/views/Composer.tsx`
- `open-tag/web/src/views/Members.tsx`
- `open-tag/web/src/TaskBoard.tsx`
- `open-tag/web/src/store.tsx`

需要注意：

- `Chat.tsx`、`Members.tsx`、`store.tsx` 偏大，二创时应保留行为，逐步拆分。
- 当前视觉偏 warm/editorial，仍有较多卡片、pill、状态圆点、阴影和装饰感，需要按用户的“去 AI 味”规则重做视觉层。

#### 最值得复用

1. 三平面架构。
2. Runtime adapter + daemon agent manager。
3. Agent CLI + agent data plane。
4. Workspace/machine/agent/channel/message/task/attachment/activity 数据模型。
5. Mention wake、DM、thread、task assign 等协作闭环。
6. Connect computer / machine onboarding。

#### 最大风险

1. `src/server/core.ts` 同时承载消息、mention、任务、wake、agent lifecycle，改动要非常谨慎。
2. UI 和 store 偏大，容易二创成整块重写。
3. Agent token TTL/revoke、CSP、socket.io 横向扩展、task ownership 等 hardening 仍需补。
4. Runtime adapter 依赖各 CLI 输出格式，Claude/Codex/Cursor 等版本变动可能破坏解析。
5. 多 machine 下部分 workspace file RPC 需要专项验证是否始终定向到 agent 所在 machine。

#### 选择它的 MVP 路线

1. 保留 server/daemon/CLI/DB。
2. 先重做 UI shell：左侧空间/频道/私聊，中间消息，右侧 agent roster/context。
3. 保留 channel/DM/thread/task/inbox/attachments。
4. 做 agent 创建向导：身份、职责 prompt、runtime、machine、workspace。
5. 加强 leader -> developer/tester 的任务分派体验，优先基于现有 task assign/thread。
6. 上线前补 directed daemon RPC、token revoke/rotate、CSP、agent ownership、socket.io Redis adapter。

### 4.2 openagents

#### 定位

`openagents` 是一个 “workspace URL + agent connector + multi-agent collaboration” 产品。用户创建 workspace，本地或远程机器上的 agents 通过 daemon/launcher 连接进 workspace，共享 threads、files、browser、tasks。

关键证据：

- `openagents/README.md`
- `openagents/workspace/`
- `openagents/packages/agent-connector/`
- `openagents/packages/launcher/`

#### 技术结构

它不是单一技术栈，而是多套体系并存：

- Python SDK：`openagents/pyproject.toml`，包名 `openagents`
- Workspace 后端：`openagents/workspace/backend/`，FastAPI + SQLAlchemy + Postgres + Redis
- Workspace 前端：`openagents/workspace/frontend/`，Next 16 + React 19 + Tailwind
- Agent connector：`openagents/packages/agent-connector/`，Node CLI/daemon
- Launcher：`openagents/packages/launcher/`，Electron/Vite/React

对二创最有价值的是：

- `workspace/`
- `packages/agent-connector/`

Python SDK 是更底层的 agent network/mod/transport 框架，MVP 阶段未必需要深改。

#### Runtime 与 agent 隔离

支持 runtime 很广，包括：

- OpenClaw
- Claude Code
- Codex CLI
- Hermes
- Cursor
- OpenCode
- Copilot CLI
- Gemini
- Cline
- Amp
- Aider
- Goose

关键文件：

- `openagents/packages/agent-connector/registry.json`
- `openagents/packages/agent-connector/src/daemon.js`
- `openagents/packages/agent-connector/src/adapters/index.js`
- `openagents/packages/agent-connector/src/adapters/`
- `openagents/packages/agent-connector/src/paths.js`
- `openagents/packages/agent-connector/src/env.js`

隔离结论：

- agent name、workspace session、working dir、部分 session 文件隔离。
- runtime 安装和默认 env 多数按 type 共享，不是严格按 agent 实例隔离。
- 同 runtime 多 agent 可以跑，但 per-agent env/sandbox 需要增强。

典型 session 持久化：

- Claude：按 workspaceId + agentName 保存 session mapping。
- Codex：按 workspaceId + agentName 保存 codex thread。
- Aider：每个 channel 独立 chat history。
- Goose：按 workspace/agent/channel hash 生成 session name。

#### 通信模型

主链路是中心化 workspace 后端：

```text
Web UI / local daemon / cloud agent
  -> FastAPI REST/SSE
  -> Postgres events
  -> Redis pubsub/cache
  -> UI/daemon polling
  -> runtime CLI
```

关键接口：

- `openagents/workspace/backend/app/routers/events.py`
- `openagents/workspace/backend/app/routers/network.py`
- `openagents/packages/agent-connector/src/workspace-client.js`

多设备加入主要靠 workspace slug/token URL、Firebase bearer、workspace collaborator 机制。本地 daemon 默认会连接官方 endpoint，这对二创自托管需要改造。

#### 数据模型与安全

核心模型：

- `EventRecord`
- `Workspace`
- `WorkspaceMember`
- `WorkspaceCollaborator`
- `Channel`
- `ChannelMember`
- `ChannelHumanMember`
- `FileRecord`
- `BrowserTab`
- `BrowserContext`
- `TodoRecord`
- `RoutineRecord`
- `NotificationRecord`
- `CloudAgentConfig`

关键文件：

- `openagents/workspace/backend/app/models.py`

主要安全风险：

- workspace token/hash 设计偏 MVP。
- collaborator role 粗粒度。
- browser/file/task 多数是 workspace 级访问，细粒度 ACL 不强。
- Cloud agent API key 存 DB，需要重新设计密钥存储。
- CORS 默认较宽。
- 部分 runtime adapter 默认使用危险权限 flag，例如跳过 permission/sandbox。

#### UI 可复用性

可复用价值较高：

- Thread list
- ChatView
- Agent roster
- Files
- Browser tabs/view
- Tasks
- Inbox
- Knowledge
- Skills
- Connect Agent
- Monitor grid

关键文件：

- `openagents/workspace/frontend/components/layout/wrapper.tsx`
- `openagents/workspace/frontend/components/chat/chat-view.tsx`

视觉上与用户期望仍有距离：卡片、边框、圆角、状态点偏多，适合保留结构和交互，不适合原样复刻。

#### 最值得复用

1. Agent connector 的 runtime adapter 覆盖面。
2. 公网 workspace + 多设备 agent 加入模型。
3. Files/browser/tasks/inbox/knowledge/skills 的产品模块布局。
4. Shared browser 思路。
5. Workspace URL 和远程 agent 接入方式。

#### 最大风险

1. Python SDK、FastAPI workspace、Node connector、Electron launcher 多代架构并存。
2. 安全和隔离偏 MVP。
3. DM 和 task 不够一等公民，需要补模型。
4. 默认 endpoint 指向官方服务，自托管改造要彻底。
5. 同 runtime 多 agent env 隔离不彻底。

#### 选择它的 MVP 路线

1. 保留 `workspace/backend`、`workspace/frontend`、`packages/agent-connector`。
2. 暂时冻结 Python SDK 深度改造。
3. 先支持 Claude/Codex/Aider 或 OpenClaw 这类少量 runtime。
4. 将产品模型重定为 Workspace -> Channel/DM/Task -> Participants -> Events。
5. 补 token hash、agent-scoped token、人类 JWT role、文件/浏览器/task ACL。
6. 移除默认 openagents.org endpoint。
7. 重做 UI 信息架构。

### 4.3 zano

#### 定位

`zano` 方向上很接近目标：人类和 AI agents 在 shared channels 中协作，agent 是本地 Claude Code 进程，有独立 workspace 和 `MEMORY.md`。

关键证据：

- `zano/README.md`
- `zano/apps/web/`
- `zano/apps/bridge/`
- `zano/packages/cli/`
- `zano/packages/db/src/*.sql`

#### 技术结构

主要边界：

- Web：`zano/apps/web/`，Next.js + Supabase SSR/Realtime
- Bridge：`zano/apps/bridge/`，本地 Node daemon
- CLI：`zano/packages/cli/`，agent 进程内使用
- DB：`zano/packages/db/src/*.sql`
- Shared：`zano/packages/shared/`

技术栈与用户偏好的 Web/TypeScript 很契合，但 Supabase 绑定很深。

#### Runtime 与 agent 隔离

当前主路径基本只支持 Claude Code。

关键证据：

- `zano/apps/bridge/src/agent-manager.ts` 直接 `spawn("claude", args)`
- 参数硬编码 Claude Code 的 stream-json、append-system-prompt、model、resume 等
- 使用 `--permission-mode bypassPermissions`

隔离模型：

- 每个 agent 一个进程。
- 每个 agent 一个目录：`agentsDir/agentId`
- 每个目录有 `MEMORY.md`、`notes/`
- 每个 workspace 写 `.zano/zano` CLI wrapper
- `session_id` 存 DB，重启 `--resume`

这只是 cwd 级隔离，不是安全隔离。

#### 通信模型

```text
Web client
  -> Supabase DB/Realtime
  -> local bridge
  -> Claude Code
  -> zano CLI
  -> Supabase DB/Realtime
  -> Web
```

关键文件：

- `zano/apps/web/src/components/message-area.tsx`
- `zano/apps/web/src/app/api/bridge/connect/route.ts`
- `zano/apps/bridge/src/bridge.ts`
- `zano/apps/bridge/src/system-prompt.ts`
- `zano/apps/bridge/src/agent-manager.ts`

#### 数据模型与安全

核心表来自 SQL 文件：

- `profiles`
- `agents`
- `channels`
- `channel_members`
- `messages`
- `tasks`
- `servers`
- `server_members`
- `machine_keys`

最大问题是 schema 漂移：

- 代码使用 `agents.model`、`workspace_path`、`session_id`，但 SQL schema 中不一致。
- onboarding trigger 使用不存在或约束不匹配的字段。
- SQL 文件不像一个一致的迁移集合。

安全边界风险：

- 部分表全局可读。
- `channel_members` insert policy 过宽。
- machine key 存全量 key，API 也返回。
- bridge RPC channel 偏全局，没有清晰 per-user/per-server namespace。
- bridge `loadAgents()` 按 owner 而非 server，边界不够严。

#### UI 可复用性

值得参考：

- `MessageArea`：分页、Realtime、agent activity、Tiptap 输入、@mention autocomplete。
- `Sidebar`：workspace switcher、DM、channel、machine 状态。
- `AgentSettingsPanel`：agent 配置、workspace browser。
- `SetupWizard`：本地 bridge 引导体验。

不适合直接当主 UI：

- thread Web UI 不完整。
- task board Web UI 不完整。
- 核心组件数据访问、状态、展示混在一起。
- UI 风格偏 sand/card，不符合用户要求的干净、低容器、少阴影。

#### 最值得复用

1. Bridge + CLI 的轻量思路。
2. `MEMORY.md` + per-agent workspace + session resume。
3. MessageArea 的 Realtime chat 体验。
4. Agent settings/workspace browser。
5. system prompt 中关于协作礼仪、task claim、thread target 的协议设计。

#### 最大风险

1. schema 与代码严重不同步。
2. 只有 Claude Code 真正接入。
3. RLS/Realtime broadcast 不足以支撑多租户安全。
4. 任务板和 thread 在 Web 端不完整。
5. 缺迁移、测试和稳定 CI。

#### 选择它的 MVP 路线

如果仍选择 zano，应先做工程地基，而不是直接做产品：

1. 冻结 fork。
2. 补一份单一有序 migration。
3. 先做单用户/单 workspace MVP。
4. 把 bridge 抽成 `RuntimeAdapter`，第一版只实现 ClaudeCodeAdapter。
5. 重做 RLS 和 bridge RPC。
6. 补 Web task board 和 thread drawer。

基于当前目标，不建议用它做主底座。

### 4.4 OpenLoaf

#### 定位

`OpenLoaf` 是本地优先、项目中心、多 agent 的 AI 生产力桌面应用。它不是围绕内部频道/群聊构建，而是围绕 project、project window、Secretary/Project/Worker agents、memory、skills、tools、canvas、email、calendar 等构建。

关键证据：

- `OpenLoaf/README.md`
- `OpenLoaf/apps/web/`
- `OpenLoaf/apps/server/`
- `OpenLoaf/apps/desktop/`
- `OpenLoaf/packages/api/`
- `OpenLoaf/packages/db/`

#### 技术结构

项目规模较大：

- 约 2924 文件。
- TS/TSX/JS/Prisma 约 42 万行。
- `apps/web` 约 1026 个代码文件。
- `apps/server` 约 510 个代码文件。
- `packages/ui` 约 303 个代码文件。

主要边界：

- `apps/web`：Next.js/React/Tailwind 前端壳。
- `apps/server`：Hono + tRPC + AI runtime/tools。
- `apps/desktop`：Electron 宿主，窗口、IPC、系统能力。
- `packages/api`：tRPC 契约、共享类型和业务 service。
- `packages/db`：Prisma + SQLite。
- `packages/ui`：共享 UI/日历组件。
- `packages/config`：路径解析。
- `packages/widget-sdk`：动态 widget SDK。

#### 自研 agent runtime

OpenLoaf 的核心不是连接外部 Claude Code/Codex runtime，而是基于 AI SDK 的自研 `ToolLoopAgent` runtime。

关键文件：

- `OpenLoaf/apps/server/src/ai/services/chat/chatStreamService.ts`
- `OpenLoaf/apps/server/src/ai/services/agentFactory.ts`
- `OpenLoaf/apps/server/src/ai/services/masterAgentRunner.ts`
- `OpenLoaf/apps/server/src/ai/services/agentManager.ts`
- `OpenLoaf/apps/server/src/ai/services/agentExecutor.ts`
- `OpenLoaf/apps/server/src/ai/tools/toolRegistry.ts`
- `OpenLoaf/apps/server/src/ai/shared/coreToolIds.ts`

已有 agent 类型：

- Master
- PM
- Channel
- SubAgent / Worker

工具能力覆盖：

- 文件
- 终端
- 项目
- 画布
- 邮箱
- 日历
- 任务
- MCP
- 云任务
- memory
- skills

这对“AI 原生操控项目功能”非常强，但对“不自研 runtime、连接本地 runtime”这个偏好并不吻合。

#### 记忆、技能、MCP

关键文件：

- `OpenLoaf/apps/server/src/ai/shared/memoryLoader.ts`
- `OpenLoaf/apps/server/src/ai/tools/memoryTools.ts`
- `OpenLoaf/apps/server/src/ai/services/skillsLoader.ts`
- `OpenLoaf/apps/server/src/ai/tools/loadSkillTool.ts`
- `OpenLoaf/apps/server/src/ai/services/mcpClientManager.ts`
- `OpenLoaf/apps/server/src/services/mcpConfigService.ts`

记忆模型是文件系统优先：

- user memory
- project memory
- parent/linked project memory
- agent memory

这很适合吸收到目标产品中，但不一定要整体迁移 OpenLoaf。

#### 通信与数据流

典型链路：

```text
Electron
  -> 启动/管理本地 server 与 web
Web
  -> tRPC
Server
  -> AI runtime/tools
SQLite
  -> 存索引/元数据
Filesystem
  -> 存项目配置、memory、chat messages、文件内容等
```

关键文件：

- `OpenLoaf/apps/web/src/utils/trpc.ts`
- `OpenLoaf/apps/server/src/bootstrap/createApp.ts`
- `OpenLoaf/apps/server/src/types/appRouter.ts`
- `OpenLoaf/apps/desktop/src/preload/index.ts`
- `OpenLoaf/packages/db/src/index.ts`
- `OpenLoaf/packages/config/src/openloaf-paths.ts`
- `OpenLoaf/packages/api/src/services/chatSessionPaths.ts`

聊天消息是 `messages.jsonl`，不是 DB 表。这对本地优先很好，对多人云同步会更复杂。

#### 数据模型与安全

核心 DB schema：

- `OpenLoaf/packages/db/prisma/schema/project.prisma`
- `OpenLoaf/packages/db/prisma/schema/chat.prisma`
- `OpenLoaf/packages/db/prisma/schema/board.prisma`
- `OpenLoaf/packages/db/prisma/schema/email.prisma`
- `OpenLoaf/packages/db/prisma/schema/calendar.prisma`
- `OpenLoaf/packages/db/prisma/schema/schema.prisma`

真实项目配置：

- `<project>/.openloaf/project.json`
- `OpenLoaf/packages/api/src/services/projectTreeService.ts`
- `OpenLoaf/packages/api/src/services/projectRegistryConfig.ts`

安全假设偏本机：

- localhost 放行。
- 远程访问才走 local auth。
- CSRF 依赖 `X-OpenLoaf-Client`。
- Electron + localhost + 本机文件权限能力很强。

如果目标转向多人云协作，需要重做权限模型。

#### UI 可复用性

很强的可复用模块：

- Electron 本地壳。
- 项目窗口。
- 侧边栏和工作台布局。
- 右侧 agent chat。
- 文件浏览/预览。
- 终端。
- 任务页。
- 画布。
- 邮箱。
- 日历。

关键文件：

- `OpenLoaf/apps/web/src/components/layout/TabLayout.tsx`
- `OpenLoaf/apps/web/src/utils/panel-utils.ts`
- `OpenLoaf/apps/web/src/components/project/Project.tsx`
- `OpenLoaf/apps/web/src/components/board/CanvasListPage.tsx`
- `OpenLoaf/apps/web/src/components/email/EmailPage.tsx`
- `OpenLoaf/apps/web/src/components/calendar/Calendar.tsx`
- `OpenLoaf/apps/web/src/components/tasks/TaskBoardPage.tsx`

但缺目标产品最核心的内部协作模型：

- Space
- Channel
- DM
- Membership
- AgentParticipant
- AgentPresence
- ChannelMessage
- Thread
- Mention/Routing
- 空间级 memory
- 空间级 tool approval

现有 WeChat/channel agent 是外部 IM 桥，不是内部频道系统。

#### 最值得复用

1. Electron 本地壳。
2. 项目系统。
3. 画布。
4. 任务执行器。
5. 自研 agent tool runtime。
6. memory/skills/MCP。
7. 邮箱/日历模块。

#### 最大风险

1. AGPLv3。闭源商业二创需要商业授权或换底座。
2. 代码规模大，理解和改造成本高。
3. runtime、工具、审批、文件系统、项目、任务、画布耦合较深。
4. 缺内部频道/群聊/DM 协作模型。
5. 数据大量落文件系统，云同步/多人协作冲突策略复杂。
6. 安全边界默认是本机应用，而不是公网多人协作平台。

#### 选择它的 MVP 路线

1. 保留 `apps/desktop + apps/server + apps/web + packages/api/db/config/ui`。
2. 不要第一阶段替换 runtime。
3. 新增 Space/Channel/DM/Participant/AgentParticipant/ChannelMessage。
4. 复用现有 Chat 渲染和 `runChatStream`。
5. 把 Project/Board/Email/Calendar/Task 作为空间侧栏对象接入。
6. 新增空间级 memory 和 tool approval。
7. 做 agent roster：Secretary、Project PM、Worker 作为频道参与者。
8. 最后再处理多人在线、云同步、权限分层和外部 runtime adapter。

## 5. 推荐产品雏形

建议把目标项目先命名为一个中性概念：

> Agent Collaboration Workspace

或更产品化地说：

> 一个给人类和 AI 团队共用的工作空间。人类在空间中召集、指派和审阅 agent；agent 以成员身份在频道、私聊、任务和项目工具中协作。

### 5.1 核心对象

第一版应围绕这些对象，而不是先围绕复杂工具：

- Workspace/Space：一个协作空间。
- Channel：多人对话空间，可包含人类和 agent。
- DM：人与 agent、agent 与 agent、人与人之间的一对一或小范围私聊。
- Thread：围绕一条消息或任务的上下文。
- Agent：工作空间成员，有身份、职责、runtime、model、memory、workspace。
- RuntimeHost/Machine：本地电脑 daemon，负责承载 agent process。
- Task：从消息中生成或由 agent 创建，可 claim、assign、status transition。
- Artifact/File：agent 输出物、附件、报告、代码文件。
- Memory：用户级、空间级、agent 级、项目级。
- Tool Surface：画布、邮箱、日历、文件、浏览器、任务板等可被 agent 操作的模块。

### 5.2 第一版必须成立的用户故事

1. 用户创建 workspace。
2. 用户连接本机 daemon。
3. 用户创建 3 个 agent：leader、dev、tester。
4. 每个 agent 能选 runtime，例如 Claude Code、Codex、OpenCode。
5. 每个 agent 有职责 prompt 和独立 memory/workspace。
6. 用户在频道中 @leader 提出项目需求。
7. leader 将任务拆给 dev/tester。
8. dev/tester 在任务 thread 或频道中汇报进度。
9. leader 汇总结果交付给用户。
10. 用户可以打开每个 agent 的私聊、活动轨迹、workspace 文件和 memory。

这条链路比邮箱/日历/画布更核心。工具模块应第二阶段接入，否则容易把产品做成大杂烩。

### 5.3 不应第一版就做的东西

- 完整云端多人商业权限体系。
- 自研全套 agent runtime。
- 完整 OpenLoaf 级别邮箱/日历/画布重构。
- 同时支持所有 runtime。
- agent 自动自治组织公司式复杂流程。
- 插件市场/技能市场。
- 多租户 SaaS hardening。

第一版应先证明“频道中的 AI 团队协作闭环”。

## 6. 推荐底座策略

### 推荐方案 A：open-tag 主底座，渐进吸收 OpenLoaf

这是当前最推荐方案。

做法：

- Fork `open-tag`。
- 保留 server/daemon/CLI/runtime adapter/DB。
- 重做或重构 UI shell，使其接近 OpenLoaf 的干净、专业、低噪声工作台风格。
- 将 agent 创建流程加强为“身份 + 职责 + runtime + memory + 权限”。
- 基于现有 task assign/thread 做 leader/dev/tester 协作流。
- 第二阶段再把 OpenLoaf 的 memory/skills/canvas/email/calendar 思想迁入，而不是直接拷整套代码。

优点：

- 最贴近核心协作目标。
- Web/TypeScript 技术栈契合。
- 多 runtime adapter 已经存在。
- channel/DM/thread/task/inbox 已经成型。
- Apache-2.0 许可证友好。

缺点：

- UI 需要重做。
- 部分后端核心文件较重。
- 生产级安全和多 machine 边界要补。
- 工具型生产力模块不如 OpenLoaf 丰富。

适合：

- 当前这个“人和多个本地 runtime agent 在空间中协作”的目标。

### 备选方案 B：OpenLoaf 主底座，新增协作空间

做法：

- Fork `OpenLoaf`。
- 保留 desktop/server/web/projects/tools/memory/canvas/email/calendar。
- 新增 Space/Channel/DM/AgentParticipant/ChannelMessage 模型。
- 将现有 Secretary/Project/Worker agents 作为空间成员呈现。
- 后续再接外部 runtime adapter。

优点：

- 本地优先桌面体验成熟。
- 生产力模块极强。
- 记忆、技能、MCP、工具执行体系完整。
- UI 气质更接近用户偏好。

缺点：

- 没有现成内部频道协作模型。
- 外部 runtime adapter 不是现成主路径。
- AGPLv3 对闭源商业二创不友好。
- 代码规模大，重构成本高。

适合：

- 如果最终产品更像“个人 AI 工作台/桌面 OS”，而不是“多 runtime agent 协作空间”。

### 备选方案 C：openagents 主底座，聚焦公网 workspace

做法：

- 保留 workspace/backend、workspace/frontend、agent-connector。
- 移除官方 endpoint 默认依赖。
- 强化安全、权限、token、runtime 隔离。
- 让 DM/task 一等公民化。

优点：

- 多设备 agent 加入和 workspace URL 思路最好。
- runtime 覆盖面广。
- 共享浏览器、文件、任务和 connector 很有价值。

缺点：

- 多栈混合复杂。
- 安全隔离偏 MVP。
- DM/task 模型需要加强。
- Python/FastAPI 与用户 Web 技术栈偏好有一定冲突。

适合：

- 如果“公网 URL、多设备 agent 加入、共享浏览器”是不可妥协的第一优先级。

### 不推荐方案 D：zano 主底座

`zano` 更适合作为轻量交互参考，不适合作为主底座。

原因：

- schema 与代码不同步。
- runtime 基本硬编码 Claude Code。
- Supabase/RLS/bridge 安全边界弱。
- thread/task Web UI 不完整。
- 测试和迁移基础不足。

可以借鉴：

- MessageArea 的输入体验。
- Setup Wizard。
- Agent settings/workspace browser。
- system prompt 中的协作协议。

## 7. 建议 MVP 路线

基于推荐方案 A：`open-tag` 主底座。

### Phase 0：产品边界冻结

目标：先定产品不是“大而全 AI OS”，而是“多 agent 协作空间”。

决策项：

- 第一版是否只做单用户/自托管？
- 是否必须多设备加入？
- 是否必须公网 workspace？
- 第一版 runtime 支持哪些？
- agent 是否能默认操作本机文件，还是必须显式授权？
- 是否接受先没有邮箱/日历/画布？

### Phase 1：协作闭环 MVP

目标：跑通 leader/dev/tester 场景。

范围：

- workspace
- connect machine
- create agent
- agent role prompt
- runtime selection
- channel
- DM
- @mention wake
- task create/assign/claim/update
- thread report
- activity trace
- agent workspace file browser

成功标准：

- 用户在 `#project` 中 @leader。
- leader 创建或分派任务给 dev/tester。
- dev/tester 各自在任务 thread 中交付。
- leader 汇总最终报告。
- 用户能查看 agent activity 和输出文件。

### Phase 2：UI 与信息架构重塑

目标：把现有 open-tag UI 重塑为更干净、专业、自然的人类工作台。

设计原则：

- 少卡片，少阴影，少状态圆点。
- 左侧信息架构清晰：workspace / channel / DM / tasks / files / agents。
- 中间消息区低噪声、易扫描。
- 右侧上下文面板：agent roster、thread、task、file、trace 可切换。
- agent 状态不用彩色圆点堆砌，改为文字、图标、活动摘要和轻量进度。

### Phase 3：记忆与职责系统

目标：让 agent 不是临时 bot，而是团队成员。

范围：

- Agent profile：名称、显示名、职责、工作方式、默认 runtime、权限。
- Agent memory：`MEMORY.md` + structured notes。
- Workspace memory：团队规则、项目背景。
- Role templates：leader/dev/tester/reviewer/researcher。
- 用户可编辑职责 prompt。
- agent profile 变更同步到 workspace memory。

可参考：

- `open-tag/src/daemon/memory.ts`
- `OpenLoaf` 的 memory loader / skills loader 思路。

### Phase 4：工具表面接入

目标：让 agent 能操作空间内功能，而不仅是聊天。

优先级：

1. Files/artifacts
2. Task board
3. Browser/shared preview
4. Canvas
5. Calendar
6. Email

注意：邮箱/日历/画布不应第一版进入主路径，否则会模糊产品核心。

### Phase 5：安全与部署 hardening

范围：

- agent token rotate/revoke/TTL
- machine key rotate/reconnect
- CSP
- agent scoped permissions
- file/tool approval
- per-agent env isolation
- sandbox policy
- socket.io Redis adapter
- directed daemon RPC 全面检查
- audit log

## 8. 关键取舍问题

下一步 grill-me 应围绕这些问题逐个推进。

### 8.1 产品优先级

第一优先级到底是：

- A. 多 agent 协作空间。
- B. 本地 AI 生产力桌面。
- C. 公网多设备 agent hub。

当前材料指向 A。

### 8.2 本地优先 vs 公网协作

你更想要：

- A. 完全自托管/本地优先，数据主要在自己机器或自己的服务器。
- B. 像 openagents 一样有公网 workspace URL，多设备/多人方便加入。
- C. 两者都要，但先做本地自托管。

这决定底座是 open-tag 还是 openagents/OpenLoaf。

### 8.3 Runtime 策略

第一版 runtime 是否只保留：

- Claude Code
- Codex
- OpenCode

还是要继承 open-tag/openagents 的全部 runtime？

建议第一版只保留 2-3 个强路径，其他 adapter 暂时隐藏或标 beta。

### 8.4 Agent 自主性

leader 是否可以自动创建任务、指派 agent、唤醒 agent？

选项：

- A. 可以自动做，但关键操作要显示在频道。
- B. 需要用户确认后才能分派。
- C. 第一版不做自治，只做用户手动 @agent 和 assign。

建议先 A/B 混合：创建/分派任务可自动，但所有动作必须可见、可撤销。

### 8.5 工具权限

agent 操作文件、邮箱、日历、浏览器时，默认权限是什么？

建议：

- 第一版默认低权限。
- 文件写入、命令执行、邮件发送、日历创建必须有审批或明确授权。
- 不要默认使用危险 bypass flag。

### 8.6 商业与许可证

是否计划闭源商业化？

- 如果是，OpenLoaf 的 AGPLv3 是重大约束。
- `open-tag` Apache-2.0 更友好。
- `openagents` 根部 Apache-2.0，但子包 MIT，需要做 license 边界确认。

## 9. 当前推荐决策

在没有进一步澄清前，建议暂定：

1. 主底座：`open-tag`。
2. 产品路线：多 agent 协作空间。
3. 技术路线：TypeScript/Web 优先，保留 Node daemon。
4. UI 方向：吸收 OpenLoaf 的干净工作台气质，不直接照搬 open-tag/openagents 视觉。
5. 功能路线：先 channel/DM/task/agent runtime，后 canvas/email/calendar。
6. Runtime 策略：第一版只打磨 Claude Code + Codex + OpenCode 或 Aider。
7. 安全策略：明确 agent 权限、memory、workspace、file/tool approval。

这条路线最小化了“从零造 runtime”的成本，也避免一开始陷入 OpenLoaf 式大型桌面 OS 的复杂度。

## 10. 后续文档计划

本报告只是探索文档，不是最终设计规格。

建议后续再产出：

1. `product-brief.md`：产品定位、目标用户、非目标。
2. `mvp-spec.md`：第一版功能范围和验收标准。
3. `architecture-proposal.md`：基于 open-tag 的模块边界、数据模型、runtime 接口、权限模型。
4. `ui-direction.md`：融合 openagents/open-tag/OpenLoaf 的界面信息架构和视觉原则。
5. `migration-plan.md`：从 open-tag fork 到目标产品的阶段性改造计划。
