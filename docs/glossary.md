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

**工作区 / Space（空间）**
: 一个根植于本地文件夹、自包含、可移植的协作单元，装着自己的 agent 队伍、频道、消息、任务和记忆；一个文件夹对应一个 Space。open-tag 的 `server/serverId` 是待迁移的底座术语，目标代码统一为 `space/spaceId`。

**频道**
: 工作区内的多方对话空间，人与多个 agent 在此对话、@唤醒、派活、汇报。是空间内部态的 C 位（见"群聊 C 位"）。

**群聊**
: 特指频道里"人 + 多个 agent"的多方对话形态，是产品心脏；与"频道"基本同指，"群聊"强调多 agent 协作这一属性。

**私聊 / DM**
: Human 与单个 agent 的一对一会话，在会话列表里与频道并列。产品不支持 Human-Human DM；唤醒规则上 Human-Agent DM 无条件唤醒目标 agent。

**thread**
: 挂在某条消息（常是一个任务）下的子对话线，任务的领取、推进、汇报在其 thread 内发生。

---

## Agent 与 Runtime

**Agent**
: 有身份、职责与记忆的团队成员，跑在本机已有的 runtime 上，通过 @提及被唤醒，可领任务、互相分派、交付结果，并经统一工具层操作模块。身份字段（name/displayName/avatar/职责提示词/runtime/model/scopes）复用 open-tag 的 agents 表。

**原生 agent vs 外接 agent（术语澄清）**
: 早期设想里"原生 agent"指跑在自研 runtime 内、操控更丝滑的 agent。本项目 v1 已锁定**不自研 runtime**，所有 agent 均为**外接**——连接本机已有 runtime。所谓"原生丝滑"改由 MCP 工具层 + UI 桥实现，而非 in-app runtime。故在 Kith-space 语境中不存在"原生 agent"，只有外接 agent；提到"原生"多指复用 runtime 的原生文件/工具能力。

**Runtime**
: agent 的执行引擎，即本机已安装的 agent CLI（v1 强路径为 Claude Code / Codex / opencode）。产品把它当可插拔组件，不再造一个。

**Runtime 适配器**
: 把某个 runtime CLI 接入统一 `Runtime` 接口的适配层，负责启动进程、驱动一轮对话、解析其输出、回吐 session/活动/轨迹。新增一个 runtime = 实现一个 `Runtime` 对象并注册。注册表已带 8 条，v1 只把三条做稳。

**Local Runtime Worker**
: Desktop 自动管理的唯一内部 daemon 进程，负责启动和驱动本机 runtime。它是进程隔离边界，不是 Machine/Computer，不支持远程注册或多主机调度。

---

## 模块与工具

**MCP（模块即 MCP 工具）**
: 自建生产力模块（v1 = 任务；后续 = 邮箱/日历/画布）不进 runtime，而是各自包成一个 MCP server 暴露给外接 agent。agent 像调用普通工具一样调用 `task_create` 等，落到我方服务端逻辑。这是"原生丝滑"的实现路径之一，与 UI 桥配合。

**UI 桥**
: 把 MCP 工具调用的副作用实时反映到界面（如任务看板随任务事件刷新）的机制，与 MCP 工具设计共同构成"丝滑"的两半。

---

## 记忆

**三层记忆**
: 用户级（跨空间偏好，用户策展）、空间级（团队规则/项目背景，agent 可写、用户策展）、agent 级（每个 agent 自己维护的 `MEMORY.md` + `notes/`）。读取一律用 runtime 原生文件工具，不做读 MCP 工具。

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
: 只有 Chat 可见、没有打开模块的状态。Chat 是唯一工作面时不能被隐藏；全宽 Chat 由会话列表、当前会话和实时轨迹三张白色面板组成。

**Split**
: Chat 与一个模块同时可见的分屏状态。两区间隙可拖拽；Chat 使用紧凑形态，会话列表与实时轨迹改为互斥抽屉。

**ModuleOnly**
: 模块可见、Chat 暂时隐藏的专注状态。点击 Dock 的 Chat 可恢复 Split。

**Module Pane**
: Inbox、Tasks、Agents、Settings 等功能模块的第二工作面。一次只打开一个模块，可与 Chat 分屏或独占窗口；当前阶段全部服从当前 Space。

**Dock**
: 当前主要工作面板底部的统一控制器，固定为 Chat、Inbox、Tasks、Agents、Settings；当前模块横向展开，Chat 始终只显示图标。它同时负责模块切换与 Chat 显隐。

**agent 实时轨迹**
: 近实时展示 agent 执行动作的透明度窗口。ChatOnly 时是 Chat 右侧独立面板，Split 时收进 Chat 内的轨迹抽屉，不是业务模块 Dock 项。

**Message Context Snapshot**
: 消息发送时固化的结构化界面上下文，包含 Space、会话、当前模块、Context Stack 与 focused item。Kith-space 保存自己的结构，不把 OpenLoaf `<stack>` XML 硬编码进核心模型；当前仍是待实现契约。

**跨 Space 视角**
: 未来基于 `scope = current | all` 的真实聚合能力，可演化为全局窗口或驾驶舱。v1 不提供数据不真实的薄总览页。

---

## 宿主形态与数据层

**Electron 桌面壳**
: 唯一正式宿主与发行形态。Electron 主进程监督 Core Service 和 Local Runtime Worker、创建受控 UI 窗口，并管理端口、托盘、关闭行为与系统自启动。

**Core Service**
: Desktop 管理的本机单实例 HTTP/socket.io/业务服务。名称只描述技术进程，不是公开部署的 server 产品，也不等于 Space。

**Web 模式**
: Desktop 设置中的浏览器入口策略：关闭（默认）、仅本机、局域网。浏览器访问依附 Desktop 生命周期，不形成独立 Web 产品；LAN v1 仅限受信任私网的 HTTP。

**访问 Token**
: 普通浏览器首次进入 Kith-space 时验证的共享访问秘密。服务端只保存哈希，验证后建立可撤销的持久浏览器会话；它与 Desktop 信任、Worker 内部凭据和 agent session token 相互独立。

**每工作区独立 SQLite 文件**
: 每个 Space 把自己的消息、任务、频道、agent 和 agent membership 存进 `<folder>/.kith/workspace.db`；Human 资料和 Desktop 设置不随 Space 复制。

**`.kith/`**
: 工作区文件夹下承载其全部状态的目录：`workspace.db`（结构化数据）、`agents/`（agent 阵容配置，明文）、`memory/`（空间级 + agent 级记忆，一事一文件）。

**app.db**
: 应用数据目录中的中央 SQLite 库，保存唯一 Human、Desktop/Web 设置、访问 Token 哈希、浏览器会话、Space registry 和最近打开记录；不保存 Space 消息或任务。

**Machine / Computer / serverId（退役术语）**
: open-tag 遗留的多主机和工作区领域命名。Machine/Computer 产品概念删除；产品 `server/serverId` 改为 `space/spaceId`。HTTP 技术进程统一称 Core Service。

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
