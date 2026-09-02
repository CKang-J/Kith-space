# Kith-space v1 规格与验收标准

本文定义个人 AgentOS 路线下的 v1。架构见 `architecture-proposal.md`，UI 见 `ui-direction.md`，实施顺序见 `migration-plan.md`，完整转向共识见 `../superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`，Home/Space root 补充规格见 `../superpowers/specs/2026-07-12-home-space-and-space-root-design.md`。

## 1. v1 一句话

Windows Desktop 上，一个 Human 在多个本地 Space 中与本机 agent 协作；可按需向本机或受信任局域网桌面浏览器开放同一产品界面。

## 2. v1 范围

- 首次启动创建唯一 Human：名称必填，邮箱和描述选填；在 `~/Kith-space/Home` 自动创建唯一 Home Space，普通冷启动进入 Home Chat。
- Home 是真实总控 Space，Dock 增加 Spaces 模块，用于创建、接入、搜索和打开普通 Space。
- 多个本地 Space：用户可以在默认容器创建文件夹或选择已有文件夹；每个 Space 使用独立 `<space>/.kith/workspace.db`，所属 agent 共享 Space root cwd。
- 频道、Human-Agent DM、thread、@agent 和 agent 频道成员关系。
- agent 身份、职责、三层记忆、Claude Code/Codex/opencode 适配器。
- 任务生命周期、autopilot/plan-first 与分派深度、唤醒预算、急停护栏。
- ChatOnly / Split / ModuleOnly 单窗口工作区；Home Dock 为 `Chat | Spaces | Inbox | Tasks | Agents | Settings`，普通 Space Dock 为 `Chat | Inbox | Tasks | Agents | Settings`。
- Electron Desktop 监督 Core Service 和唯一 Local Runtime Worker，支持托盘和可选系统自启动。
- Windows production bundle、unpacked 包和 x64 per-user assisted NSIS 安装器；安装器公开分发前必须完成代码签名与真实安装/卸载验收。
- Web 模式：关闭（默认）、仅本机、局域网；访问 Token、持久授权会话、轮换和撤销。
- 本地磁盘文件/附件，不依赖 Postgres、Redis、S3、Docker 或用户 `.env`。

## 3. 明确不做

- 多真人、邀请、登录账户、密码、RBAC、Human-Human DM。
- Computers/Machines、远程 daemon、多 agent 主机。
- 公网部署、云同步、SaaS、独立 Web 发行、移动 Web、PWA、push。
- 邮箱、日历、画布、跨 Space Inbox/Tasks 等聚合和跨 Space agent 写编排；Home 的真实 Spaces 目录不属于这里，当前必须实现。
- v1 HTTPS LAN；当前 HTTP LAN 必须显示受信任私网和禁止公网暴露警告。

## 4. 核心用户故事

1. 用户首次打开 Desktop，填写本地 Human 资料并进入自动创建的 Home Chat。
2. 用户从 Home 的 Spaces 模块在默认位置新建 Space，或选择已有本地文件夹接入；点击卡片在同一窗口进入目标 Space。
3. 用户在当前 Space 创建带职责和 runtime 的 agent，并在频道 @leader 提需求。
4. leader 拆解并分派任务，其他 agent 在 thread 推进，leader 汇总交付。
5. 用户通过 Chat、任务模块和实时轨迹观察、调整或急停执行。
6. 用户打开 Tasks，能切换“全部任务”和当前频道任务作用域。
7. 用户按需打开仅本机或 LAN 浏览器入口，首次输入 Token 后使用完整产品能力。
8. agent 生成相对文件时写入所属 Space 根目录，而不是隐藏 app data 的 per-agent 目录。
9. 用户关闭主窗口后应用进入托盘继续运行；显式退出停止所有内部进程。

## 5. 验收标准

### 5.1 初始化与数据

- 全新应用数据目录启动时只出现本地资料初始化，不出现注册、登录或邀请。
- Human 名称为空不能继续；邮箱和描述可留空。
- 初始化完成后存在唯一 Human、稳定 homeSpaceId 和 `~/Kith-space/Home`；普通冷启动进入 Home，显式深链接仍可进入目标 Space。
- app data 默认 `~/.kith-space`，默认 Space 容器为 `~/Kith-space`；设置开发测试 app data 覆盖不能隐式把正式 Space 放回 app data。
- 新 Space 选择本地文件夹后生成 `.kith/workspace.db`；中央 `app.db` 不承载 Space 消息和任务。
- 已有兼容 `.kith` 的文件夹按稳定 Space ID 接入或重连；不兼容 `.kith` 必须报错，不能自动删除。
- `.kith` 包含 workspace.db、Space Memory、Agent Memory 和附件；复制 Space 文件夹时这些内容与用户文件一起移动。
- 本次开发期 schema 可破坏性重置，不要求兼容旧 `.kith` 数据。

### 5.2 agent 协作

- 同一 Space 可创建并区分至少三个 agent，分别使用 Claude Code、Codex、opencode。
- @agent 只唤醒符合频道成员与 wake policy 的本机 agent。
- leader 可创建、分派和汇总子任务；任务状态与 thread 汇报一致。
- 分派深度、唤醒预算和急停均有可重复触发的测试。
- 每个 agent 的职责与记忆重启后保持；同一 Space 的 agent 共享 Space root 文件树，但 Agent Memory 和 app data runtime state 按 agent 分开。
- Claude Code、Codex、opencode 都以所属 Space root 为 cwd；prompt 临时文件不得污染用户根目录。

### 5.3 工作区 UI

- 根路径在未初始化时进入 Human 初始化，已初始化且没有显式 Space 深链接时进入 Home。
- Home Dock 有 Chat、Spaces、Inbox、Tasks、Agents、Settings；普通 Space 没有 Spaces；全产品没有 Members、Computers 或旧 Layout 回退。
- Spaces 是 Home-only Module Pane，以真实 registry 卡片提供搜索、创建、接入和同窗切换，不恢复独立 OverviewShell，也不伪造全局 Inbox/Tasks。
- ChatOnly、Split、ModuleOnly 三态均可达；Chat 和 Module 不会同时隐藏。
- Split 可拖拽，默认 Chat 占 25%，窄窗按面板最小宽度退化为单 Pane。
- Agents 只展示当前 Space agent；Human 资料位于全局 Settings。
- Human Settings 使用规范 `settings=human` resource 与 `/api/human/profile`，不恢复账户页、`settings=account` 或 `/api/auth/me`。

### 5.4 Desktop 与浏览器访问

- `pnpm run desktop:dev` 一次启动完整开发宿主；正式 Desktop 自动管理内部进程。
- `desktop:build` 只生成 main/preload；`desktop:bundle` 包含 Web/Core/Worker/agent CLI；`desktop:pack` 生成可运行 unpacked 目录；`desktop:dist` 生成 Windows NSIS 安装器。
- Web 默认关闭；仅本机模式不接受 LAN 连接；LAN 模式显式启用且显示 HTTP 风险提示。
- 默认端口 7777，可在 Desktop 修改；冲突时给出明确错误和修复入口。
- 所有浏览器首次访问必须输入 Token；Token 不在 URL、日志或明文数据库出现。
- 授权会话使用 HttpOnly、SameSite=Strict cookie；轮换 Token 或撤销全部会话后立即失效。
- 浏览器不能查看/修改 Token、监听、端口、进程、托盘或系统自启动设置。
- 关闭窗口默认进入托盘，显式退出清理全部子进程；关闭即退出选项有效。
- packaged Desktop 在全新数据目录中可启动内置 Core/Worker/Web/Drizzle 资产、完成 Human/Home 初始化并优雅退出；退出后默认端口无残留监听。
- CI 只手动构建并上传未签名 installer artifact，不自动发布。公开分发前必须具备 Windows 代码签名证书，并补做真实 NSIS 安装/卸载；未签名 `.exe` 构建成功不能被描述为已签名或已发布。

## 6. 安全姿态

- 浏览器 Token 只保护浏览器入口，不与 Local Runtime Worker 内部凭据复用。
- Desktop 每次启动生成内部临时凭据，普通用户不配置 daemon API key。
- 唯一 Human 拥有全部本地 Space 权限，但 Space 作用域、路径隔离、CSRF/会话和 runtime 权限校验仍是安全边界。
- 当前外接 runtime 的高权限是显式技术债。邮箱、浏览器等不可信内容模块上线前，必须先完成 HTTPS 与审批/沙箱权限升级。
- LAN v1 只适用于受信任私网，不支持端口转发或公网暴露。
