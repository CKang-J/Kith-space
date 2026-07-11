# Kith-space 产品路线图

> 路线基线：2026-07-11 个人 AgentOS 本机化转向。完整边界见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`，当前工程状态见 `docs/progress.md`。

## 1. 产品终点与永久边界

Kith-space 的终点是桌面优先、单人使用的个人 AgentOS：一个 Human 和本机 agent 在多个本地 Space 中协作。正式产品只有 Desktop 安装包；浏览器入口依附 Desktop 生命周期，可选择关闭、仅本机或受信任局域网访问。

以下方向已经取消，不再作为“以后再做”：

- 多真人、邀请、团队账号、Human membership 和 RBAC。
- 多 agent 主机、远程 daemon、机器加入和跨电脑运行。
- 公网部署、SaaS、云同步、云数据库和独立 Web 发行。
- 移动 Web、PWA、push、Docker 部署和公共 server/daemon 包。

仍在长期路线中的能力包括：本机跨 Space 聚合、邮箱、日历、画布、记忆增强、编排成熟化、HTTPS 与 runtime 权限升级、macOS/Linux 发行。

## 2. 已完成基础

- P0：SQLite 与每 Space `<root>/.kith/workspace.db`，中央 registry。
- P1：派发深度、唤醒预算与急停护栏。
- P2：三层记忆与通用角色模板。
- P3：任务领域与 HTTP 接口。
- P4：单窗口 ChatOnly / Split / ModuleOnly 工作区、可拖拽面板、常驻 Dock、任务范围侧栏。
- Runtime 调研：Claude Code、Codex、opencode 适配边界与 Runtime 契约 v2 草案。

P4 的视觉微调暂停。先清除底座中与新定位冲突的领域和运行方式，再回到视觉收尾。

## 3. 当前路线：个人 AgentOS 本机化

### P-A1 权威文档收敛

把 vision、decisions、roadmap、产品规格、架构、UI、术语、进度和命令口径统一到本机个人 AgentOS。历史研究可保留，但必须标注其多用户/多设备内容不代表产品路线。

验收：核心文档不再把多真人、多机器、公网或云端描述为未来目标；新增本机化权威规格；后续阶段与删除范围明确。

### P-A2 本地领域与数据模型

- 把中央 registry 扩展并更名为 `app.db`。
- 实现唯一 Human 和首次资料初始化；自动创建 `Home` Space。
- 把产品领域中的 `server/serverId` 收敛为 `space/spaceId`，保留 `/s/:slug` URL。
- 保留 Space 内 agent membership，删除 Human membership、邀请、RBAC 和 Human-Human DM。
- 删除 Machine/Computer、远程 daemon 注册和多主机调度；内部 daemon 收敛为唯一 Local Runtime Worker。
- 删除 S3/对象存储，附件只走本地磁盘。

允许破坏性重置当前开发数据，不做旧 `.kith` 数据迁移。

验收：全新目录可初始化一个 Human、`Home` 和多个文件夹 Space；无需登录、邀请、机器注册、Postgres、Redis 或对象存储。

### P-A3 浏览器访问安全边界

- 实现“关闭/仅本机/局域网”三种模式，默认关闭。
- 实现访问 Token、哈希存储、首次验证、HttpOnly 持久会话、轮换和全量撤销。
- Electron 内嵌 UI 使用受控信任通道，浏览器 Token 与内部进程凭据分离。
- Desktop 每次启动生成临时内部凭据，普通用户不配置 daemon key。
- LAN v1 只做 HTTP，并显示私网限定和禁止公网暴露的警告。

验收：未授权浏览器不能读取或操作数据；Token 不进入 URL、日志或明文数据库；Web 模式和会话撤销可验证。

### P-A4 Electron Desktop 宿主

- 增加 `pnpm run desktop:dev`，统一启动 Core Service、Local Runtime Worker、Vite 和 Electron。
- 实现子进程监督、稳定端口与冲突处理。
- 默认关闭窗口进入托盘；显式退出停止全部；提供关闭即退出设置。
- 提供默认关闭的系统自启动，启用后托盘启动。
- Desktop Settings 管理 Web 模式、端口、Token、托盘和自启动。

验收：Windows 上一次命令启动完整开发宿主；正式形态不要求用户 `.env`；托盘和退出生命周期符合规格。

### P-A5 UI 与入口清理

- 首次启动收集 Human 名称、可选邮箱和描述，然后进入 `Home`。
- Dock 固定为 `Chat | Inbox | Tasks | Agents | Settings`。
- `Members` 改为当前 Space 的 `Agents`；Human 资料进入全局 Settings；删除 `Computers`。
- 删除 landing、登录、注册、邀请、PWA 和 `?legacy=1`/旧 `Layout`。
- 浏览器隐藏 Token、端口、监听、进程和系统自启动等 Desktop 专属设置。

验收：所有入口都服务一个 Human 与本机 agent；浏览器和 Desktop 复用工作区 UI，但权限边界不同。

### P-A6 继承资产清理与总审计

- 删除 Dockerfile、compose、entrypoint、环境样例和远程部署文档。
- 删除公共 server/daemon npm 发布、独立安装器和 OIDC 发布 workflow。
- 删除残余 JWT 账户认证、Machine、多用户、S3、PWA 和旧领域术语。
- 保留仓库内部的分进程开发命令与少量测试覆盖环境变量。
- 完成 typecheck、单元、集成、web build、Electron 冒烟和文档口径审计。

验收：Windows Desktop 是唯一正式发行路径，仓库没有仍可启用的旧产品路线。

## 4. 本机化基础完成后的能力路线

### 4.1 Runtime 契约 v2

统一 Claude Code、Codex、opencode 的生命周期、usage 回调、取消、完成事件和 MCP bootstrap。它是模块、记忆写入和可靠编排的共同前置。

### 4.2 生产力模块

按任务、日历、画布、邮箱顺序扩展 MCP 模块。画布强调 Chat 与可视对象联动；邮箱和浏览器类能力必须等待 HTTPS 与 runtime 权限升级。

### 4.3 记忆与上下文

实现结构化 `memory_save`、检索和衰减策略；实现 `MessageContextSnapshot`，让消息携带当前 Space、模块、打开对象和 focused item 的结构化快照。

### 4.4 本机跨 Space 聚合

在真实 `scope = current | all` 数据契约上提供跨 Space Inbox、Tasks、Calendar 和信息流。聚合遍历本机 Space 数据库，不引入云端或多用户语义。

### 4.5 编排成熟化

完善 leader 拆解、依赖图、预算、计划审批、暂停/恢复、恢复策略与交付汇总。继续坚持 harness 优先，不把开发或其他具体场景写成硬流程。

### 4.6 平台扩展

Windows v1 稳定后支持 macOS 和 Linux。系统托盘、自启动、文件选择和进程管理优先使用跨平台 Electron/Node API。

## 5. 贯穿各阶段的原则

- harness 优先、角色通用、不做场景专用硬流程。
- 不自研 runtime，模块经 MCP 暴露。
- local-first、Desktop-first、一个 Human、一台本机。
- 外科手术式改动，每阶段独立验证和提交。
- OpenLoaf 只作设计参考，禁止复制 AGPL 源码。
- 文档与代码同一阶段同步；当前实现和目标态必须明确区分。
