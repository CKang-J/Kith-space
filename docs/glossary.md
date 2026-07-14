# Kith-space 术语正典

本文固定 Kith-space 的关键术语，给出准确、稳定的口径，防止未来文档与代码互相漂移。每条只给一句定义、必要时与相近概念的区分、以及它落在架构的哪一层。理念、决策、阶段、界面等展开内容各有专文（见 `docs/kith-space/` 五份设计文档），本文只做定义，需要展开处引用它们。

术语按主题分组。事实以 `decisions.md` 的当前结论和 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md` 为准。

---

## 项目与理念

**Kith-space**
: 一个人与一支有身份、职责、记忆的 agent 团队共处的本地协作空间。Kith 是旧词，指"你信任的一圈熟人"，对应 agent 是持续共事的团队成员而非一次性问答工具；-space 兼指人与 agent 真实共处的空间，与开发者对 namespace / workspace 的语感。长期定位是"个人的工作生活操作系统"。

**个人 AgentOS**
: Kith-space 的长期产品定位：一个 Human 在一台物理电脑上，与本机 agent 跨多个本地 Space 工作。多真人、远程 agent 主机、服务器部署和云端产品不属于该定义。

**harness engineering（harness 优先）**
: 把设计重心放在"搭好 agent 做事的环境"（工具、上下文、记忆、协作协议）而非"替 agent 决定怎么做事"。三条原则：harness 优先、角色通用、不做场景专用硬流程。取舍是接受略低的开箱即用完成度，换更高的通用性与生命力。

**角色通用**
: agent 默认空白，靠职责提示词获得身份、靠记忆积累经验；产品不生产"开发专用""客服专用"等定制 agent，只提供通用角色框架与少量可选起点模板（填空用的起点，不绑定流程）。

---

## 工作区与协作结构

**Human**
: 一个 Kith-space 安装实例中唯一的真人使用者。名称必填，邮箱和描述选填；这是给 agent 使用的本地资料，不是账户、登录身份、成员或权限角色。

持久化 actor 使用 `human` 表示该唯一 Human；runtime 自身协议中的 `role: "user"` 是外部协议字面量，不代表多用户账户，也不属于数据库 actor 命名。

**Personal Setup（首次初始化）**
: Desktop 在全新安装数据中建立唯一 Human 与默认 `Home` 的一次性应用生命周期。它只收集名称、可选邮箱和描述，允许从“已有 Human、尚缺 Home”的中断态恢复，并保持重复提交幂等；它不是注册、登录或浏览器授权流程。

**Human Settings / Human Profile**
: 唯一 Human 在全局 Settings 中查看和修改本地资料的入口，规范 URL resource 为 `settings=human`，数据接口为 `GET/PATCH /api/human/profile`。它不是账户页；旧 `settings=account` 与 `/api/auth/me` 已退役，`initialHumans` 也不是当前产品入口。

**工作区 / Space（空间）**
: 一个根植于用户可见本地文件夹、自包含、可移植的协作单元，装着自己的 agent 队伍、频道、消息、任务和记忆；一个文件夹对应一个 Space，所属 agent 共享该文件夹作为 runtime cwd。产品 schema、API、Socket、CLI 与类型统一使用 `space/spaceId`；`server` 只可描述 Core Service 等技术进程或保留在历史研究原文中。

**Home Space（总控 Space）**
: 每个安装实例唯一、由稳定 `homeSpaceId` 标识的特殊 Space；普通冷启动进入它，它既有自己的 Chat/任务/agent/记忆，也通过 Home-only `Spaces` 模块管理本机普通 Space。它是逻辑总控入口，不是普通 Space 的物理父目录，也不是旧 Overview 壳。

**普通 Space / Regular Space**
: Home 之外、由用户新建文件夹或接入已有文件夹形成的 Space。普通 Space 可位于任意本机磁盘，不形成递归子 Space 层级。

**Space root（Space 根目录）**
: 用户为某个 Space 选择的本地文件夹，也是该 Space 全部 agent 的 runtime cwd；用户文件位于根目录普通文件树，产品自包含状态位于其 `.kith/`。cwd 是默认文件上下文，不是安全沙箱。

**应用数据根 / App data root**
: 安装实例内部数据目录，默认 `~/.kith-space`，保存 app.db、User Memory、runtime state、日志和 CLI wrapper；它不等于默认 Space 容器，也不是 agent 生成业务文件的 cwd。

**默认 Space 容器**
: 未手动选路径时创建 Home 和普通 Space 的用户可见父目录，默认 `~/Kith-space`；Home 的默认根目录为 `~/Kith-space/Home`。它与 app data root 必须独立配置和测试。

**Agent membership**
: agent 与频道的长期成员关系，物理表为 `channel_agent_members`。它决定 agent 可读取、接收和被唤醒的频道范围，不承载 Human 权限；唯一 Human 对本机 Space 拥有隐式完整访问。

**Human channel state**
: 唯一 Human 在频道中的 read cursor、Human-Agent DM 对端和 thread follow/done 状态，物理表为 `human_channel_states`。它是会话状态而非 membership；收藏和 Space 偏好分别存于 `human_saved_messages` 与 `human_space_preferences`。

**频道**
: 工作区内的多方对话空间，人与多个 agent 在此对话、@唤醒、派活、汇报。是空间内部态的 C 位（见"群聊 C 位"）。

**群聊**
: 特指频道里"人 + 多个 agent"的多方对话形态，是产品心脏；与"频道"基本同指，"群聊"强调多 agent 协作这一属性。

**私聊 / DM**
: Human 与单个 agent 的一对一会话，在会话列表里与频道并列。产品不支持 Human-Human DM；唤醒规则上 Human-Agent DM 无条件唤醒目标 agent。

**话题 / thread**
: 挂在某条消息（常是一个任务）下的子对话线，任务的领取、推进、汇报在其中发生；中文用户界面统一称“话题”，代码、数据模型、API、CLI 与 URL query 继续使用 `thread`，不引入 `topic` 代号。

---

## Agent 与 Runtime

**Agent**
: 有身份、职责与记忆的团队成员，跑在本机已有的 runtime 上，通过 @提及被唤醒，可领任务、互相分派、交付结果，并经统一工具层操作模块。agent 在所属 Space root 中工作，个人语义记忆位于该 Space 的 `.kith/agents/<agentId>/`，runtime 临时状态位于 app data。

**原生 agent vs 外接 agent（术语澄清）**
: 早期设想里"原生 agent"指跑在自研 runtime 内、操控更丝滑的 agent。本项目 v1 已锁定**不自研 runtime**，所有 agent 均为**外接**——连接本机已有 runtime。所谓"原生丝滑"改由 MCP 工具层 + UI 桥实现，而非 in-app runtime。故在 Kith-space 语境中不存在"原生 agent"，只有外接 agent；提到"原生"多指复用 runtime 的原生文件/工具能力。

**Runtime**
: agent 的执行引擎，即本机已安装的 agent CLI（v1 强路径为 Claude Code / Codex / opencode）。产品把它当可插拔组件，不再造一个。

**Runtime 适配器**
: 把某个 runtime CLI 接入统一 `Runtime` 接口的适配层，负责启动进程、驱动一轮对话、解析其输出、回吐 session/活动/轨迹。新增一个 runtime = 实现一个 `Runtime` 对象并注册。注册表已带 8 条，v1 只把三条做稳。

**Agent 首轮触发场景**
: Core 启动 agent 时传给 Local Runtime Worker 的显式原因：`create` 表示新建后的单次 Human 私信介绍，`manual` 表示手动启动/重启/恢复且空收件箱静默，`wake` 表示有真实持久化消息或任务需要在原目标处理。只有实际采用 introduction prompt 的 runtime 进程持有一次性 token，且仅 `message send --introduction` 会把它附到请求；服务端同步消费成功后才把介绍私信与 `agents.introduced_at` 原子写入。真实 wake 会撤销 token 并拒绝迟到问候，已完成 token 的重复问候同样拒绝；普通回复不携带 token。普通重启保留完成状态，清 Agent Memory 的完整 reset 会清除它。

**Local Runtime Worker**
: Desktop 自动管理的安装级唯一内部 daemon 进程，负责启动和驱动所有本机 Space 的 runtime。它是进程隔离边界，不隶属某个 Space；Core Service 以 installation-unique agentId 把它的状态、轨迹、session 和回复路由回 agent 所属 Space。它不是 Machine/Computer，不支持远程注册或多主机调度。

---

## 模块与工具

**MCP（模块即 MCP 工具）**
: 自建生产力模块（v1 = 任务；后续 = 邮箱/日历/画布）不进 runtime，而是各自包成一个 MCP server 暴露给外接 agent。agent 像调用普通工具一样调用 `task_create` 等，落到我方服务端逻辑。这是"原生丝滑"的实现路径之一，与 UI 桥配合。

**UI 桥**
: 把 MCP 工具调用的副作用实时反映到界面（如任务看板随任务事件刷新）的机制，与 MCP 工具设计共同构成"丝滑"的两半。

---

## 记忆

**三层记忆**
: 用户级（app data 中的跨 Space 偏好，Human 策展）、Space 级（`<space>/.kith/memory/` 的共享规则和背景，agent 可写、Human 策展）、Agent 级（`<space>/.kith/agents/<agentId>/` 中由 agent 维护的 `MEMORY.md` + `notes/`）。读取一律用 runtime 原生文件工具，不做读 MCP 工具。

**一事一文件 + 索引约定**
: 借鉴 OpenLoaf 的记忆结构——每个知识点一个文件，`MEMORY.md` 作自足索引指向 `notes/` 里的细节，compaction 前后以 `MEMORY.md` 为恢复点。它是写进 system prompt 强制执行的**约定**，不是工具。写记忆的 MCP 工具（如 `memory_save`）v1 延后，agent 先用原生文件操作写。

---

## 编排与护栏

**编排**
: 把用户需求拆解为子任务、分派给合适 agent、协调唤醒与汇总的过程。agent→agent 分派天然成立，依托 open-tag 的唤醒策略（被 @ 者无条件唤醒且不看发送者）。

**autopilot**
: 编排自主性的默认取值——agent 自动拆解、分派、唤醒，无需用户逐步确认；所有动作在频道/thread 里留可见记录。因其自动连锁，三护栏为强制项。

**plan-first**
: 编排自主性的另一取值——agent 先出计划、等确认再执行。是按任务开关的一个取值，默认仍为 autopilot。

**软闸 vs 硬闸**
: 软闸 = 靠角色提示词让 agent"先出计划再动手"，是 v1 里 plan-first 的实现方式，agent 可能不严格遵守。硬闸 = 在系统层强制拦截未获批准的执行，v1 延后。

**三护栏**
: 因默认 autopilot 而强制的三项可控性保障，缺一不可，均落在 server 唤醒环这一收口处：**分派深度上限**（限制 agent→agent 逐层再分派的最大深度）、**每任务 token 预算**（单任务用量超限即熔断该分支）、**一键急停**（用户随时停止全空间所有 agent）。与 Chat 实时轨迹（可见性）配套，共同支撑"默认自动、始终可见可停"。

---

## 界面（单窗口工作区）

**WorkspaceFrame / 单窗口工作区**
: 当前唯一顶层工作壳。应用直接进入当前 Space，Chat 与一个 Module Pane 在同一窗口中按三态协作；此前“双壳 / 空间总览态 / 空间内部态”术语已废止。

**ChatOnly**
: 只有 Chat 可见、没有打开模块的状态。Chat 是唯一工作面时不能被隐藏；全宽 Chat 可同时展示会话列表、当前会话和当前会话聚合面板。

**Split**
: Chat 与一个模块同时可见的分屏状态。Chat 与 Module 间隙可拖拽；Chat 使用紧凑形态，会话列表改为抽屉，宽度允许时聚合面板固定显示在 Chat 与 Module 之间。

**ModuleOnly**
: 模块可见、Chat 暂时隐藏的专注状态。点击 Dock 的 Chat 可恢复 Split。

**Module Pane**
: Inbox、Tasks、Agents、Settings 等功能模块的第二工作面。一次只打开一个模块，可与 Chat 分屏或独占窗口；当前阶段全部服从当前 Space。

**Dock**
: 当前主要工作面板底部的统一控制器。Home 为 Chat、Spaces、Inbox、Tasks、Agents、Settings，普通 Space 为 Chat、Inbox、Tasks、Agents、Settings；当前模块横向展开，Chat 始终只显示图标。它同时负责模块切换与 Chat 显隐。

**Spaces 模块 / 空间模块**
: 只在 Home Dock 出现的真实 Space registry 页面，用卡片提供搜索、刷新、创建、接入、失联重连和同窗打开普通 Space；规范 module id 为 `spaces`。它不聚合尚未实现的 Inbox/Tasks，也不是旧空间总览壳。

**规范工作区 URL**
: 用当前 Space 的会话 pathname 表达频道或 Human-Agent DM，用 `module`/`chat` 表达工作区三态，并由 `taskScope`、`agent`/`agentTab`、`settings` 分别表达模块资源的唯一 URL 形式。切换会话时保留 active module 及其资源，替换旧 `msg`/`thread` 临时焦点；旧模块实体路径不属于规范 URL。

**agent 实时轨迹**
: 近实时展示 agent 执行动作的透明度窗口，位于当前会话聚合面板的“轨迹”Tab；只显示明确归属当前 base conversation 的有界前端缓冲，不是业务模块 Dock 项。

**会话聚合面板 / Conversation Aggregate Panel**
: 依附当前可见 Chat 的会话级辅助工作面，固定承载“轨迹 / 话题 / 文件”三个 Tab；它在 Split 中位于 Chat 与 Module 之间，宽度不足或 ModuleOnly 时临时隐藏，不是可任意停靠的通用面板或第二个 Module。

**Message Context Snapshot**
: 消息发送时固化的结构化界面上下文，包含 Space、会话、当前模块、Context Stack 与 focused item。Kith-space 保存自己的结构，不把 OpenLoaf `<stack>` XML 硬编码进核心模型；当前仍是待实现契约。

**跨 Space 视角**
: 以 Home 为入口的本机全局视角：当前先由 Spaces 模块展示真实 registry，后续再基于 `scope = current | all` 增加 Inbox、Tasks、Calendar 和信息流聚合；不提供数据不真实的薄总览页，也不引入云端控制面。

**跨 Space 委派 / Cross-Space Delegation**
: Home agent 代表唯一 Human 对指定目标 Space 发起 task、message 或 agent dispatch 的受审计操作。记录真实 acting agent、Home 来源、Human 委派和目标资源，不冒充 Human，也不直接写目标 SQLite。

---

## 宿主形态与数据层

**Electron 桌面壳**
: 唯一正式宿主与发行形态。Electron 主进程监督 Core Service 和 Local Runtime Worker、创建受控 UI 窗口，并管理端口、托盘、关闭行为与系统自启动；Windows 发行由 production bundle、unpacked 包和 NSIS 安装器组成。

**Production Desktop Bundle**
: `pnpm run desktop:bundle` 生成的完整打包输入：共享 `web/dist`、Electron main/preload、Core Service CJS、Local Runtime Worker ESM 与 agent CLI ESM。它是生产运行资产集合，不等于安装器。

**Windows unpacked 包**
: `pnpm run desktop:pack` 生成的 `dist/desktop/win-unpacked` 目录，用于在不经过安装器的情况下验证真实 packaged Desktop、内置 Core/Worker/Web/Drizzle 资产和退出行为；它不是公开发行包。

**Windows NSIS 安装器**
: `pnpm run desktop:dist` 生成的 x64、per-user、assisted NSIS `.exe`。当前本地与手动 CI 产物默认未签名，CI 只上传 artifact、不创建 Release；公开分发前必须配置 Windows 代码签名证书并执行真实安装/卸载验收。

**未签名 installer artifact**
: 能证明 Desktop 打包链可复现、但 Authenticode 状态为 `NotSigned` 的构建产物。它不等于已签名版本或已公开发布版本，不能绕过代码签名与安装流程验收。

**Core Service**
: Desktop 管理的本机单实例 HTTP/socket.io/业务服务。名称只描述技术进程，不是公开部署的 server 产品，也不等于 Space。

**Web 模式**
: Desktop 设置中的浏览器入口策略：关闭（默认）、仅本机、局域网。关闭时 Core Service 仍保留 Desktop/Worker 的私有 loopback 传输，但不提供普通浏览器壳；仅本机绑定 `127.0.0.1`，局域网绑定 `0.0.0.0`。浏览器入口依附 Desktop 生命周期，不形成独立 Web 产品；LAN v1 仅限受信任私网的 HTTP。

**访问 Token**
: 普通浏览器首次进入 Kith-space 时验证的共享访问秘密。用户可设 16-256 字符，留空时自动生成 32 字节值；app.db 只保存 scrypt 哈希和 revision。它与 Desktop 信任、Worker 内部凭据和 agent session token 相互独立，不进入 URL、日志或明文数据库。

**浏览器授权会话**
: Access Token 验证成功后创建的持久会话。原始随机 session token 只存在 HttpOnly、SameSite=Strict Cookie，app.db 只存 SHA-256 哈希；写请求另做 Origin 与 CSRF 校验。会话持续到浏览器数据清除、当前浏览器撤销授权、Desktop 全量撤销或 Access Token 轮换；撤销当前会话不是 Human 账户 logout。

**内部进程凭据**
: Desktop 信任凭据和 Local Runtime Worker 控制凭据的统称。两者彼此独立，也不与浏览器 Access Token 或 agent session token 复用。Desktop 每次启动/重启受管进程组都会重新生成；只有手动分进程开发才临时使用 `KITH_SPACE_DESKTOP_TOKEN` 和 `KITH_SPACE_WORKER_TOKEN` 注入。

**每工作区独立 SQLite 文件**
: 每个 Space 把自己的 `spaces` 元数据、消息、任务、频道、agent、agent membership 与 Space 内 Human 状态存进 `<folder>/.kith/workspace.db`。当前 baseline 有 19 张产品表；连同 Drizzle 的 `__drizzle_migrations` 是 20 张物理表，`PRAGMA user_version=3`。所有领域外键使用 `space_id`；Human 资料和 Desktop 设置不随 Space 复制。

**`.kith/`**
: Space root 下承载其可移植状态的目录：`workspace.db`（Space 元数据、agent 阵容、频道、消息和任务）、`memory/`（Space Memory）、`agents/<agentId>/`（Agent Memory）和 `uploads/`（附件对象）。runtime prompt、日志和宿主临时状态不放在这里。

**app.db**
: app data root 中的中央 SQLite 库，保存唯一 Human、稳定 homeSpaceId、Desktop/Web 设置、访问 Token 哈希、浏览器会话、Space registry 和最近打开记录；不保存 Space 消息或任务。

**Machine / Computer / serverId（退役术语）**
: open-tag 遗留的多主机和工作区领域命名。Machine/Computer 已从服务、API、Worker 协议、UI 和物理 schema 删除；产品 `server/serverId` 兼容边界也已删除并统一为 `space/spaceId`。HTTP 技术进程称 Core Service；历史研究文档可保留原术语，但不代表当前产品能力。

**进程内替代 Redis**
: 单机单进程下用内存计数器 / EventEmitter 取代 Redis。核实后 Redis 运行时只余两个单调计数器（seq、任务号），pub/sub 与 agent 唤醒已分别由 socket.io 直发和 daemon WS 承担，故 `redis.ts` 可整体删除。

---

## 许可证与代码组织

**Apache-2.0（底座）**
: open-tag 的许可证，也是 Kith-space 采用的宽松协议。保留原 LICENSE/NOTICE 并追加衍生声明与归属即可自由采用。

**AGPLv3（OpenLoaf，仅参考）**
: OpenLoaf 的传染性 copyleft 协议，与本项目宽松许可立场冲突，故 OpenLoaf 被降级为**纯设计参考**——只借界面质感、记忆/模块概念，用自己的代码重实现，绝不拷贝其源码。

**MIT**
: zano 的许可证（协议干净的局部参考之一）；也代表本项目认可的宽松协议家族。openagents 为 Apache-2.0，同为局部参考。

**reference/（只读上游）**
: 存放上游项目源码的只读目录，作查阅与设计参照之用，不在其中开发。当前上游（open-tag / OpenLoaf / openagents / zano）用于对照。

**根目录 src/（开发副本）**
: Kith-space 自身的开发代码，从 open-tag fork 而来并逐步改造。与 reference/ 的区别：reference/ 是不改的上游原件，src/ 是可改的产品代码。
