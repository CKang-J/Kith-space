# Kith-space 个人 AgentOS 本机化路线设计

状态：已确认，作为 2026-07-11 起产品路线与后续实现的权威规格。

> 2026-07-12 补充：Home 总控 Space、用户可见 Space root、agent cwd/记忆归属和跨 Space 委派已在 `2026-07-12-home-space-and-space-root-design.md` 锁定。本文的 A1-A6 产品边界继续有效；两文冲突时，以新补充设计对 Home、路径、Dock 和 cwd 的修正为准。

## 1. 目标

Kith-space 定位为桌面优先、单人使用的个人 AgentOS。一个 Human 与本机的一组 agent 在多个本地 Space 中协作。agent 继续由本机 Claude Code、Codex、opencode 等 runtime 承载，Kith-space 不自研 runtime。

产品不再沿 open-tag 的服务器部署、多真人、多 agent 主机和多设备协作方向演进。保留 open-tag 的消息、频道、daemon 和 runtime 接入基础，但收敛为单台物理电脑上的一个应用。

## 2. 不可变产品边界

- 一个安装实例只有一个全局 Human。
- Human 可以创建和进入多个本地 Space；每个 Space 根植一个本地文件夹。
- agent 属于某个 Space，但全部在本机唯一的 Local Runtime Worker 上执行。
- 保留频道、群聊、Human 与 agent 私聊、@agent、任务、记忆和 MCP 模块。
- 不支持多真人、邀请、团队成员权限、人类之间私聊或多人在线状态。
- 不支持远程 agent 主机、机器加入、跨机器 daemon、服务器部署或云端控制面。
- 不建设公网 Web 产品，不提供独立 server 发行物。
- 本机跨 Space 聚合保留为长期路线，但仍然完全在本机完成。

## 3. 宿主与进程拓扑

正式产品只有 Electron Desktop 安装包。Desktop 是进程监督者，启动并管理以下内部组件：

1. Core Service：本地 HTTP、API、socket.io、数据访问和业务服务。
2. Local Runtime Worker：隔离管理本机 runtime 会话和 agent 唤醒。
3. React UI：Electron 内嵌界面与浏览器界面复用同一套前端和 API。

Desktop 启动时自动启动 Core Service 和 Local Runtime Worker。关闭主窗口默认隐藏到系统托盘，内部服务与正在运行的 agent 保持工作；显式“退出”才停止全部进程。用户可以把关闭行为改为直接退出。系统自启动可选，默认关闭；启用后以托盘方式启动。

开发环境继续支持分进程命令，同时增加一个统一的 `pnpm run desktop:dev`，负责启动 Core Service、Local Runtime Worker、Vite 和 Electron。正式发行不要求用户维护 `.env` 或手动启动任何服务。

## 4. 浏览器访问模型

“Web”不是第二个产品，而是 Desktop 启动期间对同一 Core Service 的可选浏览器入口。Desktop 设置提供三种模式：

- 关闭：默认值，只允许 Electron 内嵌界面。
- 仅本机：允许本机桌面浏览器访问。
- 局域网：允许同一受信任局域网内的桌面浏览器访问。

默认端口为 7777，可在 Desktop 设置中修改。端口冲突必须显示明确错误和修复入口，不得静默切换到随机端口。

v1 的局域网访问只支持 HTTP。首次启用时必须明确提示：传输未加密，只适用于受信任的私有局域网，不得做端口转发或暴露到公网。HTTPS 是安全债；在邮箱、浏览器等会摄入不可信外部内容的模块上线前必须解决。

局域网浏览器拥有完整产品能力，包括聊天、触发 agent、任务和文件操作。v1 只验收桌面级浏览器，不做手机、平板响应式界面，不做 PWA 或推送。

## 5. 访问 Token 与内部凭据

浏览器访问使用独立的访问 Token：

- Desktop 设置允许用户指定 Token；留空时自动生成高强度 Token。
- 所有浏览器入口，包括本机浏览器，首次访问都必须输入 Token。
- Electron 内嵌界面通过受控的 Desktop 通道识别，不要求输入浏览器 Token。
- Token 不得出现在 URL 中；服务端只保存哈希。
- 验证成功后建立 HttpOnly、SameSite=Strict 的持久授权会话。
- 会话持续到浏览器数据清除、用户在 Desktop 撤销全部会话或 Token 被轮换。
- Token 轮换必须使全部既有浏览器会话失效。
- 浏览器端不能查看或修改 Token、监听地址、端口、进程和系统自启动设置。

浏览器 Token 与内部进程凭据严格分离。Desktop 每次启动生成临时的 Core Service 与 Local Runtime Worker 内部凭据；agent 只取得完成当前会话所需的最小短期凭据。用户不配置这些内部凭据。

## 6. 身份与领域模型

### 6.1 Human

首次启动只进行本地资料初始化，不是注册或登录：

- 名称必填。
- 邮箱选填。
- 描述选填。

Human 在整个安装实例中唯一，对全部本地 Space 拥有完整权限。删除账户、所有者、管理员、成员、邀请、注册、密码和 RBAC 概念。保留真实安全边界：Space 归属与作用域校验、路径隔离、浏览器访问 Token、CSRF/会话保护和 runtime 权限控制。

初始化 Human 后，在用户可见的 `~/Kith-space/Home` 自动创建唯一 Home Space，并在 app.db 以稳定 homeSpaceId 标识。普通冷启动进入 Home；之后可以把任意本地文件夹注册为普通 Space。

### 6.2 Space

`Space` 是唯一产品术语。产品领域、schema、API 和类型中的 `server` / `serverId` 分阶段迁移为 `space` / `spaceId`。URL 保留 `/s/:slug`，其中 `s` 明确表示 Space。

每个 Space 有自己的用户文件、频道、消息、任务、agent 队伍和分层记忆。所属 agent 共享 Space root 作为 runtime cwd，Agent Memory 位于 `<space>/.kith/agents/<agentId>`；cwd 不是安全沙箱。Agent 频道成员关系保留，用于上下文与唤醒语义；它不再与 Human 成员或 RBAC 混合。

### 6.3 Local Runtime Worker

对外删除 Machine、Computer、machineId、机器连接向导和远程 daemon 注册。内部 daemon 进程重命名为 Local Runtime Worker，只代表本机唯一的 runtime 执行边界，不是用户可管理的机器实体。

## 7. 数据拓扑

本次转向允许破坏性 schema 重置，不迁移当前开发期 `.kith` 数据。

- app data 默认 `~/.kith-space`，保存 `app.db`、User Memory、runtime state、日志与 CLI wrapper；`app.db` 保存唯一 Human、稳定 homeSpaceId、Desktop/Web 设置、访问 Token 哈希、浏览器会话和 Space registry。
- 默认 Space 容器为用户可见的 `~/Kith-space`，Home 位于 `~/Kith-space/Home`；普通 Space 可选择任意本机文件夹。
- 每个 Space 使用 `<space>/.kith/workspace.db`，并在 `.kith/memory`、`.kith/agents` 和 `.kith/uploads` 保存 Space/Agent Memory 与附件。
- 文件和附件只存本地磁盘，删除 S3 和对象存储路径。
- 未来备份采用显式本地导出/导入，不规划云同步和云数据库。

## 8. 界面信息架构

保留已确认的单窗口 ChatOnly / Split / ModuleOnly 工作区和面板式视觉语言。停止旧双壳和旧 `Layout` 回退。

Dock 按 Space 类型固定：Home 为 `Chat | Spaces | Inbox | Tasks | Agents | Settings`，普通 Space 为 `Chat | Inbox | Tasks | Agents | Settings`。

- `Members` 更名为 `Agents`，只展示当前 Space 的 agent 队伍。
- 删除 `Computers`。
- 唯一 Human 的资料放入全局 Settings。
- 网络、Token、端口、托盘、自启动和进程设置只在 Electron Desktop 中显示。
- 浏览器 Settings 只显示可安全远程操作的产品设置。
- 根路径进入首次初始化；普通冷启动完成后进入 Home，显式 Space 深链接仍可直达目标。
- 删除公共首页、登录、注册、邀请、加入链接、PWA 和旧界面回退入口。

## 9. 环境、发行与删除范围

正式产品不需要 `.env`。端口、浏览器访问模式和 Token 由 Desktop 设置管理。只保留少量内部开发/测试覆盖项，例如只覆盖 app data 的 `KITH_SPACE_HOME`、独立的默认 Space 容器覆盖、日志级别和 runtime 测试开关；它们不进入普通用户文档，也不能让测试污染真实 `~/Kith-space`。

删除以下继承资产：

- Dockerfile、docker-compose、Docker entrypoint 和 Docker 环境样例。
- 面向用户的 `.env`、`.env.example`、`.env.docker.example`。
- 公共 server/daemon npm 包、独立安装器、OIDC 发布 workflow 和远程部署文档。
- 登录、JWT 账户认证、注册、邀请和多用户权限代码。
- 多机器连接、远程 daemon onboarding 和 Machines/Computers UI。
- S3、对象存储、PWA、push 和公共 landing page。

开发分进程命令属于仓库内部工具，继续保留。正式发行物只有 Desktop 安装包；Windows 是 v1 正式平台，macOS 和 Linux 后续支持，新增系统能力必须优先使用跨平台 Electron/Node API。

## 10. 分阶段实施

### 阶段 1：权威文档收敛

更新 vision、decisions、roadmap、产品规格、架构、UI、术语、进度和命令文档。旧的多真人、多设备、服务器部署路线改为明确非目标；历史研究保留，但标注不代表产品路线。

验收：只读权威文档即可得出本文全部边界，搜索不到仍被表述为未来产品目标的旧路线。

### 阶段 2：本地领域与数据模型收敛

建立 `app.db`，实现唯一 Human 和默认 `Home`；完成 `server` 到 `space` 的领域迁移；删除 Human membership/RBAC、Machine、多主机和 S3 数据路径；保留 Space 内 agent membership。

验收：全新本地目录可初始化一个 Human 和 Home Space；每个 Space 独立存储；没有登录、邀请、机器注册或对象存储依赖。

### 阶段 3：浏览器访问安全边界

实现三种 Web 模式、访问 Token、持久浏览器会话、轮换与全量撤销；实现 Desktop 内嵌信任通道和内部临时进程凭据。

验收：默认无浏览器监听；本机和 LAN 模式按设置生效；未授权浏览器无法读取或操作任何数据；Token 不进 URL/日志/明文数据库。

### 阶段 4：Electron Desktop 宿主

实现 Desktop 进程监督、`desktop:dev`、稳定端口处理、托盘、关闭行为和默认关闭的系统自启动。

验收：一次命令启动完整开发宿主；正式形态不依赖用户 `.env`；退出和托盘生命周期符合规格。

### 阶段 5：界面与入口清理

实现首次 Human 初始化、Home 路由、Agents 模块和 Desktop Settings；删除 Computers、登录、邀请、landing、PWA 与旧 Layout。

验收：新安装从资料初始化进入 Home；Dock 与本规格一致；浏览器看不到 Desktop 专属设置。

### 阶段 6：继承资产清理与总审计

删除 Docker、远程发布/部署、公共 server/daemon 发行、遗留环境样例和残余旧术语；运行类型、单元、集成、构建和桌面冒烟验证。

验收：仓库没有对已删除路线的可执行入口或误导性权威文档；Windows Desktop 是唯一正式发行路径。

### 阶段 7：Home 总控 Space 与 Space root 验收修复

分离 app data 与默认 Space 容器；建立稳定 homeSpaceId 和用户可见 Home；把 runtime cwd 与 Agent Memory 归位到所属 Space；补 Desktop 文件夹接入和 Home-only Spaces 模块。跨 Space 写编排在路径与 UI 地基验收后渐进实现。

实施状态：H1-H4 代码切片与 2026-07-18 本轮用户验收均已完成；当前先实施 P-A9，H5 跨 Space 编排与 Runtime 契约 v2 均未开始。

验收：普通冷启动进入 Home Chat；用户可创建或接入文件夹 Space；agent 相对业务文件写入 Space root；复制 Space 带走 workspace.db、Space/Agent Memory、附件和用户文件；Home Spaces 使用真实 registry 且不恢复旧 OverviewShell。完整切片见 `2026-07-12-home-space-and-space-root-design.md`。

## 11. 实施约束

- 每个阶段独立验证、独立提交，并同步相应权威文档。
- 不在路线清理中顺手重写消息、任务、记忆或 runtime 适配器。
- open-tag 仍是 Apache-2.0 底座；OpenLoaf 只作设计参考，禁止复制 AGPL 源码。
- P4 与本轮 UI 验收已结束；P-A9 只把现有交互作为回归基线，不在架构切片中夹带视觉重做。
- 邮箱、浏览器等高风险模块必须等待 HTTPS 与 runtime 权限升级，不得在现有 HTTP LAN + bypass 权限前提下上线。

## 12. 明确非目标

- 多真人协作、团队账号、组织、邀请和 RBAC。
- 多 agent 主机、远程 daemon、跨电脑 Space 运行。
- 公网托管、SaaS、云同步、云数据库和独立 Web 部署。
- 手机/平板 Web、PWA、推送。
- 自研 agent runtime。
- v1 HTTPS LAN、自动云备份和正式 macOS/Linux 发行。
