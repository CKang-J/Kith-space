# Kith-space 决策档案

## 前言

这份文档记录 Kith-space 的锁定决策。第一轮 `/grill-me` 会话发生在 2026-07-09，形成最初 19 条决策；随后包管理迁移形成决策 20。第二轮 `/grill-me` 发生在 2026-07-11，在 40 个问题内把产品正式收敛为本机、单 Human 的个人 AgentOS，并形成决策 21，推翻原先“多用户/多机器能力休眠保留”的路线。2026-07-12 的 A1-A6 用户验收进一步确认 Agent 首轮生命周期（决策 22）以及 Home 总控 Space、用户可见 Space 根目录和跨 Space 委派边界（决策 23）；随后授权浏览器的目录选择收敛为受限主机目录浏览器（决策 24）。2026-07-14 又锁定会话聚合面板（决策 25）与 Agent 频道响应模式（决策 26）；2026-07-15 在该响应机制上补充 Human 专属的频道全体提及（决策 27），并把 ChatOnly 的模块导航迁入左侧栏、模块打开态继续使用 Dock，同时退役案例展示（决策 28）。2026-07-18 本轮 UI 验收结束后，项目锁定“保留 Desktop/Core/Worker 拓扑与 TypeScript 主栈，以模块化单体渐进收敛、性能证据驱动 Rust 决策”的工程路线（决策 29）；P-A10 的 Agent Harness v2 形成决策 30，2026-07-22 至 23 又形成并修订系统 Memory Advisor Provider、模型配置和快捷安装边界（决策 31–33）；2026-07-24 新增前端统一采用 Tailwind CSS v4 + shadcn/ui 的渐进迁移决策（决策 34）。当前结论以每条决策中的最新修正和决策 21–34 为准。

盘问的方式是一次给一个决策、每次给一个明确建议，让用户在 either/or 之间做取舍。会话过程中有几条决策被推翻或修正过（底座、runtime、Redis 的真实用途、聊天历史随文件夹走的成本），这些演化本身是理解项目为什么长成现在这样的关键，因此单列一节保留。

本文只负责"决定了什么 + 为什么 + 代价是什么"。理念与长远愿景见 `vision.md`，阶段划分见 `roadmap.md`，术语见 `glossary.md`，各专项设计的展开见 `docs/kith-space/*.md`（产品定位、MVP 规格、架构提案、UI 方向、迁移计划），本文引用而不重复。

每条决策统一用同一套小标题：一句话结论、背景、选项与选择、推理与权衡、已核实源码事实（若有，标 `文件:行号`，取自 open-tag 源码）。

## 总览索引

| # | 决策 | 一句话结论 |
|---|---|---|
| 1 | 产品核心 | B（个人工作生活 OS）为主线，A（AI 开发团队分工）也要，长期偏重 B |
| 2 | Runtime 形态 | 不自研 runtime，agent 全外接，自建模块以 MCP 工具暴露 |
| 3 | 代码底座 | open-tag（Apache-2.0），OpenLoaf 降为设计参考 |
| 4 | 用户数 | 一个安装实例永久只有一个 Human，删除多用户机制 |
| 5 | 机器数 | agent 永久只在本机唯一 Local Runtime Worker 上执行 |
| 6 | v1 范围 | 薄纵切：协作空间 + 记忆 + 任务两个模块 |
| 7 | 编排自主性 | 按任务开关，默认 autopilot，plan-first 为软闸，三护栏强制 |
| 8 | 工具权限 | 两轴：模块工具按风险分级；外接 runtime 沿用 bypass，记账为债 |
| 9 | 记忆 | 三层文件式，读用原生文件工具，写工具延后 |
| 10 | 角色模板 | 空白职责 + 少量可选起点模板，不绑定流程 |
| 11 | UI 投入 | 信息架构现在定死，视觉学 OpenLoaf，豁免"去 AI 味"清单 |
| 12 | 壳形态 | 单窗口工作区；普通冷启动进入 Home，旧双壳被推翻 |
| 13 | Chat 地位 | Chat 是默认基础工作面；仅在模块已打开时可收起 |
| 14 | 导航与模块 | Home 增加 Spaces；普通 Space 保持 `Inbox | Tasks | Agents | Settings`；左侧栏常驻 |
| 15 | 布局能力 | 右侧单主卡片在 Chat/业务模块间切换；Settings 使用模态层 |
| 16 | 跨 Space 视角 | 不恢复薄总览壳；Home Spaces 先落真实目录，聚合能力渐进实现 |
| 17 | 宿主形态 | Desktop 是唯一正式宿主，可选本机/LAN 浏览器入口 |
| 18 | 数据层 | 迁移到 SQLite + 进程内替代 Redis |
| 19 | 工作区 | 根植用户文件夹、共享 Space cwd、每 Space 独立 db 和记忆 |
| 20 | 包管理 | 仓库统一从 npm 迁移到 pnpm |
| 21 | 个人 AgentOS 本机化 | 删除服务器部署、多真人、多机器、账户体系和云端路线 |
| 22 | Agent 首轮 | 创建问候、空启动静默、真实投递按原目标回复 |
| 23 | Home 与 Space 根目录 | Home 是总控 Space；app data、Space 数据和 runtime 状态分离 |
| 24 | 浏览器目录选择 | 授权浏览器通过 Core 受限浏览主机目录，不手填路径也不读取文件内容 |
| 25 | 会话聚合面板 | 轨迹/话题/文件收敛为当前会话辅助面板，轨迹按 base conversation 隔离 |
| 26 | Agent 频道响应模式 | Agent 默认值加频道成员覆盖；私聊与明确任务指派不受模式限制 |
| 27 | 频道全体提及 | Human 的规范 token `@all` 快照当前频道 Agent；主动/被动必回，静音不唤醒 |
| 28 | Chat 壳层导航 | 左侧纵向模块入口常驻；右侧主卡片在 Chat 与模块间切换；Settings 使用弹窗；Dock 与案例展示退役 |
| 29 | 代码架构与性能语言 | 保留 Desktop/Core/Worker 与 TypeScript 主栈；P-A9.0–P-A9.7 的实现、最终门禁与一次独立只读终审已完成，Rust 只由性能证据触发 |
| 30 | Agent Harness v2 | per-surface session + durable delivery/logical turn/attempt + Context Envelope + revisioned episodic memory + restricted advisor + broker-backed MCP/CLI Gateway + snapshot/compaction telemetry；P-A10.0–P-A10.7 已完成 |
| 31 | Memory Advisor Provider | 结构化记忆提炼使用安装级可替换 Provider，与聊天 runtime 解耦 |
| 32 | 模型配置 | Kith 管理供应商、模型与运行器绑定；CLI 配置只读导入并按启动注入 |
| 33 | Runtime 快捷安装 | 只安装和删除 Kith-owned 锁版副本，不接管系统 CLI |
| 34 | 前端样式与组件基线 | 新增 UI 使用 Tailwind CSS v4 + shadcn/ui，存量 CSS 按触达范围渐进迁移 |

---

## 决策 1：产品核心是个人工作生活 OS，AI 开发团队为辅线

**结论**：以 B（个人工作生活 OS——agent 操作邮箱/日历/任务/研究/写作）为主线，A（AI 开发团队——leader/dev/tester 分工）也要，长期重量偏向 B。

**背景**：用户最初的表述在两种产品形态之间摇摆——一种是给自己用的"个人助理团队"，一种是软件开发场景的"AI 工程团队"。这两种形态影响后续几乎所有决策（模块选型、角色模板、编排方式），必须先定主次。

**选项与选择**：A（开发团队）/ B（个人 OS）/ 两者都要。用户的第一反应是"我都想要"。收敛结果是：两者都要，但明确 B 为主线、长期权重更高，A 作为 B 的一个具体分工场景存在。

**推理与权衡**：用户的决策风格是遇到 either/or 就想全要（见 `user-profile`），这里没有强行二选一，而是确立优先级——因为主次一旦定了，harness-first 的通用设计就能同时覆盖两者：把环境搭好，通用 agent 既能当个人助理也能当开发成员。代价是 v1 不为任何一个场景做专用硬流程，开箱即用完成度略低，换取通用性和更长生命力。

---

## 决策 2：不自研 runtime，agent 全外接，自建模块以 MCP 工具暴露

**结论**：不做自己的 agent 执行内核。所有 agent 通过适配器外接到本机已有 runtime（Claude Code / Codex / opencode）；自建的生产力模块（v1=任务）包成 MCP server 暴露给外接 agent。

**背景**：产品需要 agent 能"原生丝滑"地操作自建模块。实现路径有两条：自己写一个 in-app runtime（能把工具调用、流式渲染、审批弹窗编织进同一进程，丝滑度最高），或纯外接现成 runtime + 用 MCP 层桥接。

**选项与选择**：Path 1 = 纯外接 + MCP（选中）；Path 2 = 薄自研 runtime。选 Path 1。

**推理与权衡**："不从零造 runtime"是用户的硬要求（见 `user-profile`）。产品的差异化不在再造一个 runtime，而在协作空间 + 模块 MCP 工具 + 记忆。"原生丝滑"改由精心设计的 MCP 层 + UI 桥达成：工具粒度/参数/返回结构对模型友好，工具副作用实时反映到当前 Module Pane。代价是明确接受的——MCP + 外接 runtime 的操控丝滑度天花板低于 in-app 自研 runtime，用略低的丝滑度换"不自研 + 可插拔多 runtime"。

**已核实源码事实**：runtime 是窄接口，已定义好、不需改：`Runtime`（`daemon/runtime.ts:35`）、`StartOpts`（`daemon/runtime.ts:20`）、`RuntimeSession` 只有 `deliver`/`stop`（`daemon/runtime.ts:30`）。注册表 `REG`（`daemon/runtimes.ts:26`）已带 8 个 runtime。open-tag 现以注入 PATH 的 CLI 暴露能力（`daemon/prompt.ts:26`），MCP 化是这套 data plane 的自然演进。

---

## 决策 3：底座选 open-tag，OpenLoaf 降为设计参考

**结论**：代码底座 = open-tag（Apache-2.0）。OpenLoaf 只作设计参考，用自己的代码重新实现其模块概念，绝不拷贝源码。

**背景**：这是一条**被推翻后重定**的决策（演化详见后文专节）。底座曾一度锁定 OpenLoaf——因为用户欣赏它的界面质感和 local-first 生产力 OS 的完整形态。

**选项与选择**：OpenLoaf（曾选，后推翻）/ open-tag（最终选）/ openagents / zano。最终选 open-tag。

**推理与权衡**：推翻 OpenLoaf 的直接原因是许可证——用户明确要 MIT/Apache 宽松协议、不走闭源商业化，而 OpenLoaf 是 AGPLv3（传染性 copyleft，不可重新授权），协议立场根本冲突。选 open-tag 的正面理由有二：协作空间成熟度（原生就有频道/私聊/任务的一等公民模型），以及协议干净（Apache-2.0）。代价是放弃 OpenLoaf 现成的画布/邮箱/日历/记忆代码，这些概念要用自己的代码重做。

**已核实源码事实**：许可证已核实——OpenLoaf=AGPLv3，open-tag=Apache-2.0，openagents=Apache-2.0，zano=MIT。open-tag 白给频道/群聊/私聊 + runtime 适配器。

---

## 决策 4：一个安装实例永久只有一个 Human

**当前结论（2026-07-11 推翻）**：一个安装实例只有一个全局 Human，并对全部本地 Space 拥有完整权限。首次启动只填写名称（必填）、邮箱和描述（选填），这是给 agent 使用的本地资料，不是账户注册。删除邀请、登录、密码、owner/admin/member、Human membership、Human-Human DM 和 RBAC。

**原决定**：v1 单真人，但保留 open-tag 多用户能力，等待未来云化/多真人。

**推理与权衡**：多用户不是“免费保留”。它持续渗透 schema、API、导航、认证和权限判断，并让个人 AgentOS 的领域模型含混。产品定位已经排除团队协作，因此现在删除比长期背负双重语义更低成本。Agent 的频道成员关系仍保留，只承担上下文与唤醒语义。

**实施状态（A5）**：首次资料流程由 Desktop 私有信任调用 setup API；普通浏览器不会探测该入口，也不能伪造首次初始化。接口幂等创建唯一 Human 与默认 `Home`，已有资料不会被再次覆盖；全新 Desktop 数据目录直接进入首次初始化界面，不再以 `seed` 作为产品前置步骤。

---

## 决策 5：agent 永久只在本机唯一 Local Runtime Worker 上执行

**当前结论（2026-07-11 推翻）**：全部 agent 只在本台物理电脑上执行。Desktop 自动管理一个独立的 Local Runtime Worker 进程；删除 Machine/Computer 产品概念、远程 daemon 注册、机器连接向导和多主机调度。

**原决定**：v1 使用单机，但保留 open-tag 多机机制以备未来跨设备 agent 加入。

**推理与权衡**：独立进程仍有 runtime 隔离和崩溃边界价值，但“可连接的机器”没有产品价值。将进程边界与多设备领域模型拆开后，既保留可靠性，也清除用户不需要的机器管理复杂度。Desktop 每次启动生成内部临时凭据，用户不配置 daemon API key。

---

## 决策 6：v1 范围是薄纵切——协作空间 + 记忆 + 任务

**结论**：v1 = 重做外观的协作空间（open-tag）+ 两个最低摩擦的模块（记忆 + 任务）作为 MCP 工具 + 外接 runtime。邮箱/日历/画布延后。

**背景**：需要划一条能证明核心价值又不铺太大的 v1 边界。目标命题是："有身份和记忆的外接 agent，在频道里通过模块协作、交付任务，感觉是好的。"

**选项与选择**：在候选模块（记忆/任务/邮箱/日历/画布）里挑 v1 做哪些。选记忆 + 任务两个最低摩擦项。

**推理与权衡**：邮箱是 OAuth/IMAP 的工程深坑；画布对流畅度敏感（外接 runtime + MCP 的丝滑天花板难撑）。记忆 + 任务摩擦最低且直击核心命题。进一步地，记忆在 open-tag 里基本现成（见决策 9），所以 **v1 真正从零打磨的模块只有任务一个**。代价是 v1 功能面窄，不能演示邮箱/日历那类"生活 OS"的完整想象，但换来一条能快速验证灵魂假设的薄切片。

---

## 决策 7：编排自主性按任务开关，默认 autopilot，三护栏强制

**结论**：编排自主性是每任务开关，autopilot（A，自动拆解/分派/唤醒）和 plan-first（B，先出计划等确认）都支持，**默认 A**。B 在 v1 是基于角色提示词的**软闸**，硬闸延后。因默认 A，三护栏（分派深度上限、每任务 token 预算、一键急停）为 v1 强制项。

**背景**：agent 团队协作时，leader 能不能不经用户逐步确认就自动拆解分派？这是自主性与可控性的核心取舍。

**选项与选择**：A（autopilot 默认）/ B（plan-first 默认）/ 做成开关。用户又是"我都要"，收敛为按任务开关，且**默认选了更激进的 A**——即便听过风险取舍后，用户仍偏向自主/魔法感（见 `user-profile`）。

**推理与权衡**：默认 autopilot 给的是"魔法感"——agent 自动把活干了。但自动连锁会自我扩散（agent→agent 无限派生任务链、失控烧 token）。所以默认 A 的代价是三护栏从"可选优化"变成"强制项"：深度上限防无限派生，token 预算防失控烧钱，一键急停给用户随时夺回控制权的确定手段。plan-first 先用软闸（角色提示词要求先出计划）实现，硬闸延后——因为软闸零架构成本，够验证。三护栏配合右栏实时轨迹模块（决策 14）：轨迹提供可见性，护栏提供可控性。

**后续修正（2026-07-14）**：决策 26 落地后，旧纯唤醒判据 `isWakeable` 已删除；`src/agents/agentResponsePolicy.ts:42` 统一判断实时、reconnect 与 message check 的 `required | optional | observe`。agent 普通发言仍不环境唤醒其他 agent，明确 `@` 只唤醒已在频道内且有效模式为主动/被动的目标，静音目标不因频道 mention 启动；`src/server/agentWakePolicy.ts:3` 只保留 Human mention 自动加入频道的 membership 规则。DM 与明确任务指派仍为 required，后者由 `src/server/core.ts:1010` 的统一 dispatch 路径执行并继续服从既有深度、预算和急停护栏。该修正改变唤醒细节，不改变本决策的 autopilot/plan-first 与三护栏结论。

---

## 决策 8：工具权限两轴——模块工具按风险分级，外接 runtime 沿用 bypass 并记账为债

**当前结论（2026-07-12 修正）**：权限分两条轴。(a) 自建模块工具按风险分级：可逆/本地操作自动放行（v1 记忆/任务基本全自动），不可逆/外部操作（发邮件、删除、日历邀约）需审批。(b) 外接 runtime 的原生文件/shell 全权：v1 沿用 open-tag 现状（bypassPermissions），这是**明确记账的技术债**。同一 Space 的 agent 以后都以 Space 根目录为 cwd；cwd 只提供默认文件上下文，不是安全沙箱或 per-agent 隔离。

**背景**：agent 既调用我们的模块工具，也拥有 runtime 赋予的本机文件/shell 能力。这两类权限性质完全不同，要分开处理。

**选项与选择**：模块工具——全放行 / 全审批 / 按风险分级（选中）。runtime 权限——v1 就上审批路由/沙箱 / 沿用现状记为债（选中后者）。

**推理与权衡**：模块工具按风险分级是常识取舍：可逆的自动放行保丝滑，不可逆的要审批防误伤（这些不可逆操作 v1 多在范围外，规则先锁定）。runtime 全权是更重的取舍——当前接受 bypassPermissions 是因为单机 + 单 Human + 仅本机可信内容的前提下风险可控，且能保住外接 runtime 的操作丝滑。但代价被明确记账：**升级的硬触发点是邮箱/浏览器等“摄入不可信外部内容”的模块上线之前**，届时必须先用审批路由或沙箱切断“prompt 注入到破坏性 shell”的攻击链。LAN 浏览器入口已由决策 17/21 限定为显式启用的受信任私网 HTTP + Token，它不能替代该 runtime 权限升级。

**已核实源码事实与实施状态**：open-tag 以 `--dangerously-skip-permissions --permission-mode bypassPermissions` 启动 Claude Code，即对本机不受限访问。Kith-space H2 已让 Claude Code、Codex、opencode 使用所属 Space root cwd，并把 Agent Memory 与 runtime state 分别建模；这让相对文件操作落到正确项目，但仍不能阻止 runtime 用绝对路径访问其他文件。cwd 不是隔离，工具能力裁剪也不能限制任意文件/shell，真正的风险控制仍依赖审批、runtime 权限与未来沙箱。

---

## 决策 9：记忆是三层文件式，读用原生文件工具，写工具延后

**当前结论（2026-07-12 路径补充）**：记忆分三层（用户级 / 空间级 / agent 级）。读 = runtime 原生文件工具（不做读 MCP）；结构 = OpenLoaf 式"一事一文件 + 自动维护 MEMORY.md 索引"约定，写进 system prompt 强制执行（不是工具）；写 MCP 工具延后。用户层位于 app data，Space 层位于 `<space>/.kith/memory/`，Agent 层位于 `<space>/.kith/agents/<agentId>/`，随所属 Space 搬迁。空间层 agent 可写、用户策展。

**背景**：agent 要从一次性问答工具变成有记忆的团队成员，需要一套记忆系统。OpenLoaf 有跨会话记忆设计可参考，openagents 没有真正的记忆系统。

**选项与选择**：从零造记忆模块 / 复用 open-tag 现成文件记忆（选中）。空间层写权限——只读 / agent 可写用户策展（option B，选中）/ 完全放开。

**推理与权衡**：三层是从 OpenLoaf 设计重构而来。关键取舍是**不把记忆做成 v1 的从零模块**——open-tag 已有一套 per-agent 文件记忆，直接复用，只在其上加两个目录层级（用户级/空间级）+ 在 system prompt 补两段索引约定。读用原生文件工具而非 MCP，是因为读操作 runtime 天然会做，包成 MCP 反而多一层。写工具延后，是先看 agent 用原生文件写会不会乱——若乱再提升为 `memory_save` 之类 MCP 工具（最小必要，不预先造）。空间层"agent 可写、用户策展"是自主与秩序的折中：agent 能沉淀团队知识，用户保留最终编辑权。结果：**v1 从零造的模块只有任务一个**（呼应决策 6）。

**已核实源码事实与实施状态**：`resolveMemoryLayerPaths` 把 User Memory 放在 app data、Space Memory 放在 `<space>/.kith/memory/`；H2 又把 Agent Memory 归位到 `<space>/.kith/agents/<id>`，复制 Space 时可以随行。seed、profile 外科式同步和 prompt 驱动的索引约定继续复用；本次只迁移路径职责，没有重造记忆系统。

---

## 决策 10：角色模板是空白职责 + 少量可选起点模板，不绑定流程

**结论**：agent 身份直接用 open-tag agents 表现有字段，无需扩表。角色模板 = 空白职责提示词 + 几个可选起点模板（填空用的起点，不绑定流程）。

**背景**：产品要不要预设"开发专用 agent""客服专用 agent"这类角色？这直接关系 harness-first 理念能否落地。

**选项与选择**：A（产品预置固定角色/岗位表）/ B（空白 + 可选起点模板，选中）。选 B。

**推理与权衡**：与 harness 优先、角色通用的核心理念一致（见 `vision`）——agent 默认空白，靠职责提示词获得身份，靠记忆积累经验。模板只是填空起点，不是发给用户的岗位表，也不绑定流程。代价是开箱即用完成度低于"预置角色"，但换来通用性——同一套框架适配用户想让 agent 做的大多数事，不必每个新场景重造。起点模板的具体内容属便宜改、可后置（见留白节）。

**已核实源码事实**：agents 表已含所需全部字段——name / displayName / avatar / description（=角色提示词）/ runtime / model / scopes（`db/schema.ts:66` 附近）。无需扩表。

---

## 决策 11：UI 投入——信息架构现在定死，视觉学 OpenLoaf，豁免"去 AI 味"清单

**结论**：信息架构现在就定死（不推迟）。视觉方向 = 模仿 OpenLoaf 干净、好看、丝滑的质感。用户**明确豁免**自己 CLAUDE.md 里那套"去 AI 味"清单（字重、卡片、阴影、状态圆点、全大写等约束）对本项目的适用。

**背景**：UI 投入到什么程度、什么时候投入，需要定调。用户在会话中主动调整了这条——从"视觉可后置"上调为"信息架构现在定"。

**选项与选择**：信息架构也后置 / 信息架构现在定死（用户调整后选中）。视觉——遵循"去 AI 味"清单 / 学 OpenLoaf 质感（选中，豁免清单）。

**推理与权衡**：信息架构是贵改（波及面大、返工成本高），必须趁早对齐，作为后续视觉精雕的稳定地基；视觉是便宜改，可后置到架构定死之后。这条排序贯穿迁移计划（P3 定信息架构、P4 做视觉）。豁免"去 AI 味"清单是用户对本项目的明确特批——设计以 OpenLoaf 质感为准绳，允许卡片、bento 分区、适度阴影圆角，只要服务于 OpenLoaf 式观感。代价是本项目视觉判断标准换成"是否贴近 OpenLoaf 干净好看"，而非那份通用清单；但不等于放任视觉噪声，信息优先级依然要清晰。

---

## 决策 12：壳形态改为单窗口工作区

**当前结论（2026-07-12 再修正）**：v1 采用一个 `WorkspaceFrame`。普通冷启动且没有显式深链接时进入唯一 `Home` Space；显式 Space 深链接继续直达目标，托盘重新显示未销毁窗口时保留现场。Chat 是默认主页，功能模块在同一窗口中与 Chat 分屏或独占，不再经过独立空间总览壳。

**原决定**：最初选择“空间总览态 ↔ 空间内部态”双壳，并做过薄版总览骨架。P4 联调后用户确认该方向偏离实际使用意图，明确要求移除总览页，旧决定由本条修正取代。

**选项与选择**：当前阶段做 OpenLoaf 式主窗口 + 项目窗口 / 先做单窗口工作区（选中）。未来跨 Space 聚合或双窗口能力可以演化，但不得让当前壳为未实现的全局视角承担复杂度。

**推理与权衡**：单窗口把最常用的“对话 + 模块”放在一个稳定骨架中，减少进入空间、收起导航和切换壳的额外步骤，也能直接复用当前 Space 路由与业务视图。Home 的 Spaces 模块仍服从同一个壳和真实 registry 数据，因此不是被推翻的 OverviewShell；真正聚合 Inbox/Tasks 等能力继续等真实数据契约。

---

## 决策 13：Chat 是默认基础工作面，但可在模块已打开时收起

**当前结论（2026-07-10 修正）**：Chat 仍是产品心脏、应用默认主页和基础工作面。没有模块时 Chat 必须保持全宽，点击 Chat 按钮无操作；打开模块后，用户可以把 Chat 收为紧凑侧栏，也可以暂时隐藏 Chat 让模块全宽，再由 Chat 按钮恢复分屏。

**原决定**：曾锁定“群聊常驻 C 位，不可被替换”，随后又允许成员、机器、收件箱、搜索临时占据中间区。两次细化仍把布局理解成固定中心 + 右栏，不能表达用户最终确认的可切换工作姿态。

**推理与权衡**：Chat 的产品地位由“永远占最大面积”改为“永远是默认入口且不能成为空状态”。这既保住 @唤醒、派活、汇报与追问的协作主线，也让任务、画布、日历等吃宽度的模块真正可用。约束“仅 Chat 时不能隐藏”保证系统永远至少有一个有效工作面。

---

## 决策 14：模块集合与工作姿态控制器

**当前结论（2026-07-23 最新修正）**：Home 的业务模块集合为 `Spaces | Inbox | Tasks | Agents | Settings`，普通 Space 为 `Inbox | Tasks | Agents | Settings`；Chat 通过最左侧 Messages 图标返回。常驻纯图标栏统一控制 Messages、Search 与业务模块，所有入口提供 tooltip，不显示底部 Dock。点击 Spaces、Inbox、Tasks、Agents 时图标栏保持不动，消息中栏退出，右侧复用同一主工作区槽位切换内容；Settings 使用模态层。模块继续在当前会话 pathname 上使用 `?module=<id>` 及既有 resource query。完整修正见决策 28。

**原决定**：Dock 曾被限定为“窄右栏容器自身的底部导航”，实时轨迹也曾作为右栏模块之一；随后 Dock 又被设为 ChatOnly、Split、ModuleOnly 都常驻的统一底部控制器，再迁移为只在模块打开态出现。2026-07-23 的当前方向最终退役 Dock 与可伸缩第二工作面。

**推理与权衡**：纯图标栏稳定承载功能导航，独立消息中栏承载频道和私信，二者不再混为一层；tooltip 与可访问名称补足图标识别。模块打开后图标栏保持不动，右侧主工作区原位替换，因此同一时刻只有一套模块导航，也不再需要用户理解导航迁移、Chat 显隐或 Split 比例。

---

## 决策 15：主卡片在 Chat 与模块间切换

**当前结论（2026-07-23 最新修正）**：工作区不再同时并排 Chat 与业务模块。最左侧图标导航保持稳定；Messages 激活时显示消息中栏与 Chat，业务模块激活时消息中栏退出并由唯一主工作区显示 Spaces/Inbox/Tasks/Agents 之一；Settings 作为模态层覆盖当前工作区。旧 Split 比例、拖拽分隔和 ModuleOnly→Split 恢复控制不再属于活跃产品壳。

**交互约束**：点击模块使主工作区切换到该模块；点击 Messages 返回当前 Chat；点击当前业务模块仍返回 Chat；点击其他模块原位替换内容。Settings 点击打开模态层，关闭后回到原 Chat 会话。图标栏始终保留唯一模块导航。

**原决定**：“模块提升到中心”“右栏隐藏”与旧 `IconRail` 都基于旧双壳和固定右栏。最新实现虽然恢复了窄图标导航这一视觉层级，但没有恢复旧组件、旧双工作面或 Chat 显隐状态机。

**推理与权衡**：有限状态机比多个互相叠加的开关更容易解释、测试和恢复。拖拽比例仍保留用户自由；响应式降级为未来窄窗方案预留接口。代价是当前不做任意停靠和多模块并排，但这不是 v1 的目标。

---

## 决策 16：不恢复薄总览壳；Home 先提供真实 Spaces 目录

**当前结论（2026-07-12 再修正）**：产品没有独立空间总览壳，也不展示伪全局 Inbox 或 Tasks。唯一 Home 在同一个 WorkspaceFrame 中提供 Home-only `Spaces` 模块，读取 app.db 的真实 Space registry，负责创建、接入、搜索和打开普通 Space；所有 Chat、Inbox、Tasks、Agents 与 Settings 仍明确服从当前 Space。

**原决定**：曾计划 v1 用“空间列表 + 全局收件箱 + 聚合待办”组成薄版 bento 驾驶舱。实际接线时全局收件箱只能复用当前 Space 数据，既增加壳复杂度又产生错误语义，因此用户明确要求移除。

**未来接口**：Spaces 目录先形成真实全局入口；跨 Space Inbox、Tasks、Calendar 和信息流继续基于 `scope = current | all` 逐项实现。Home agent 的跨 Space task/message/dispatch 必须经过受审计的服务。没有真实聚合数据前不展示对应空入口，也不引入第二窗口。

**推理与权衡**：诚实的当前 Space 作用域优于看似完整、实际不聚合的总览页；但 Space registry 已是真实全局事实，不需要继续隐藏。把它放进 Home 的 Module Pane，既补足个人 OS 的总入口，又不恢复被删除的双壳或伪聚合。

---

## 决策 17：Desktop 是唯一正式宿主，可选开放本机/LAN 浏览器入口

**当前结论（2026-07-11 推翻并细化）**：Electron Desktop 是唯一正式宿主和发行物，自动管理 Core Service、Local Runtime Worker 与 React UI。浏览器访问不是独立 Web 产品，而是 Desktop 运行期间对同一 Core Service 的可选入口。模式为“关闭（默认）/仅本机/局域网”，默认稳定端口 7777，可由 Desktop 修改。

**访问安全**：所有浏览器首次访问都输入访问 Token，Electron 内嵌界面免输。Token 可自定义 16-256 字符，留空自动生成 32 字节；app.db 只存 scrypt 哈希与 revision。持久会话的原始随机值只进 HttpOnly、SameSite=Strict Cookie，DB 只存 SHA-256 哈希；写请求同时做 Origin 和 CSRF 校验。浏览器可通过 `DELETE /api/browser-auth/session` 撤销当前访问授权，Desktop 可轮换 Token 或撤销全部会话，轮换通过 revision 立即使全部旧会话失效；产品文案和状态方法不再把该动作称为账户 logout。局域网浏览器具有完整产品能力，但 v1 只支持 HTTP 和桌面级浏览器；首次开启必须警告仅限受信任私网、不得端口转发或公网暴露。

**凭据隔离**：浏览器 Access Token、Desktop 私有信任、Local Runtime Worker 控制凭据和 agent session token 四者互不复用。A3 已删除 Human JWT、dev-login、`?as=`、Bearer/localStorage 会话和 URL token；Desktop 管理 API 对普通浏览器返回 404。A4 Electron 已在每次进程组启动/重启时为 Desktop/Worker 生成两个独立内部凭据，并阻止受管子进程从 `.env` 回灌；渲染器 JavaScript 不持有凭据，Vite 子进程环境不包含凭据，agent runtime 环境会剥离全部宿主级 `KITH_SPACE_*` 变量后只注入当前 agent 的短期能力。只有保留给开发调试的手动分进程模式从环境变量注入。

**Desktop 生命周期**：关闭窗口默认隐藏到托盘，服务和 agent 继续运行；显式退出才停止全部进程。可选改为关闭即退出。系统自启动默认关闭，启用后以托盘方式启动；A4 已接入 Windows 打包态的 Electron 自启动接口，开发态明确标记 unsupported。A6 已补齐正式生产 bundle、Windows unpacked 包与 NSIS 安装器，打包态可实际走系统自启动接口。

**发行边界**：Windows v1 使用 Electron 43.1.0 与 electron-builder 26.15.3。正式构建分为 main/preload、Web + Core/Worker/agent CLI 生产 bundle、`win-unpacked` 和 x64 per-user assisted NSIS 四层；公共 daemon/npm/OIDC/docs-site 发布路径已删除。当前本地与手动 CI 只产出未签名 installer artifact，不自动创建 Release。公开分发前必须配置 Windows 代码签名证书；在真实执行 NSIS 安装/卸载前，不得把“安装器构建成功”描述成安装流程已验收。

**推理与权衡**：共享 UI/API 避免维护两个产品；Desktop 监督内部进程，消除普通用户的服务配置负担。LAN 入口满足同一局域网内的临时访问需求，但不改变单 Human、本机 agent 和本地数据边界。HTTP 是明确安全债；HTTPS 与 runtime 权限升级是邮箱、浏览器等高风险模块上线前的硬前置。

**原决定**：Electron + 本机 localhost Web，跨设备/LAN/公网作为统一的 level-two 延后。新决定只接纳依附 Desktop 的受控 LAN 浏览器入口，永久排除公网托管、独立 Web 发行和远程 agent 主机。

---

## 决策 18：数据层迁移到 SQLite + 进程内替代 Redis

**结论**：数据层从 Postgres + Redis 迁移到 SQLite + 进程内替代 Redis（option B）。**修正**：Redis 运行时真正在用的只有两个单调 INCR 计数器（`nextSeq` + `nextTaskNumber`）+ 启动 `reconcileCounters`；其 pub/sub 与 agent-wake 导出都是死代码。所以迁移比初判更小。

**背景**：这是一条**在写文档时被更深源码核实修正**的决策（演化详见后文专节）。open-tag 用 Postgres + Redis；本产品是单用户单机桌面双击形态，需要决定数据层怎么走。

**选项与选择**：保留 Postgres+Redis / 迁移到 SQLite + 进程内替代（option B，选中）。选 SQLite。

**推理与权衡**：SQLite 契合单用户/单机/桌面双击 + Electron 打包——一个文件、零外部服务依赖。迁移一度被描述为 Redis"做三件事"（seq 计数、SSE pub/sub、agent 唤醒 long-poll）都要替代；更深核实后修正为**只有两个计数器在跑**，pub/sub 与 wake 是死代码（零调用点），人类端实时早已走 socket.io 单实例直发、agent 唤醒早已走 daemon WS。所以迁移主要是把两个计数器搬进程内、整体删掉 `redis.ts`。schema 迁移是确定性苦力活（Drizzle 原生支持 SQLite 方言），不是未知数。代价：schema 方言逐处替换 + 计数器进程内化要保留启动对齐语义（否则 seq 回退会让增量 sync 静默丢消息）。产品不再规划因云/多用户反向迁回 Postgres。

**已核实源码事实**：现状——DB 用 `drizzle-orm/postgres-js`（`db/index.ts:2`），schema 标准 PG 方言 259 行（8 jsonb / 57 uuid / 29 timestamp）。Redis 顶部注释声明三类用途（`redis.ts:1`），但：pub/sub 已不走 Redis（`realtime.ts:9` 的 `publish` 直调 socket.io `emitMapped`，`redis.ts:70` 的 `publishEvent` 是遗留路径）；agent 唤醒不走 Redis long-poll（走 daemon WS 定向下发，`redis.ts:75` 的 `pokeAgent` 无实际调用方）；真正在跑的只有 `nextSeq`（`redis.ts:50`）与 `nextTaskNumber`（`redis.ts:65`）两个 INCR + `reconcileCounters`（`redis.ts:18`）。迁移点：`db/index.ts` 换 `better-sqlite3` 驱动；`db/schema.ts:4` 的 `pgTable→sqliteTable`、8 处 jsonb→`text({mode:"json"})`、uuid→text、29 处 timestamp→`integer({mode:"timestamp_ms"})`；`redis.ts`（78 行）计数器改内存 Map、pub/sub 与 wake 导出直接移除；`realtime.ts`（14 行）几乎不动，仅改 `nextSeq` 导入来源。

---

## 决策 19：工作区根植文件夹、每工作区独立 db、自包含可移植

**当前结论（2026-07-12 路径补充）**：Space 根植于一个用户可见的本地文件夹、自包含、可移植（option C，升级为“每 Space 独立 SQLite 文件”）。默认 Space 容器为 `~/Kith-space`，唯一 Home 位于 `~/Kith-space/Home`，普通 Space 可由用户选择任意本机文件夹。每个 Space 保留自己的频道、消息、任务、agent、Space Memory 和 Agent Memory；同一 Space 的 agent 共享该 Space 根目录作为 cwd。中央 app data 默认 `~/.kith-space`，保存 app.db、User Memory、runtime state、日志与 CLI wrapper，不作为业务文件 cwd。

**背景**：这是一条**在 SQLite 决策下被重新评估成本**的决策（演化详见后文专节）。工作区数据怎么存、能不能随文件夹搬走？openagents 用中心存储，OpenLoaf 用文件夹根植（`<proj>/.openloaf/`，可移植）。

**选项与选择**：中心库存全部 / 文件夹根植可移植（option C，选中，并升级为每工作区独立 db 文件）。选文件夹根植。

**推理与权衡**："聊天历史随文件夹走"一度被判为大改，但 SQLite 使 `<folder>/.kith/workspace.db` 成为有界方案。进一步验收发现，旧 per-agent cwd 把 Agent Memory 和业务输出留在 app data，实际破坏了自包含承诺。目标拆分因此固定为：用户文件与 runtime cwd 在 Space root；频道、消息、任务和 agent 配置在 workspace.db；Space/Agent Memory 与附件在 `.kith`；Human 资料、User Memory、宿主设置和 runtime 临时状态在 app data。复制 Space 文件夹即可带走 Space 内容，而 Human 与安装设置不会被错误复制。

**已核实源码事实**：两个现状事实让这条低成本——open-tag 的 seq 计数器本就按工作区分（`redis.ts` 的 `seq:${serverId}`），每工作区一库时 seq 天然在各自库内单调、`reconcileCounters` 语义照搬即可；24 个 import `db` 单例的文件查询语句与 schema 完全不变，只是把"全局 db"换成"当前工作区的 db"。

---

## 决策 20：仓库统一使用 pnpm

**结论**：仓库根目录与 `web/` workspace 统一使用 pnpm 和 `pnpm-lock.yaml`。脚本参数直接传递，例如 `pnpm test --unit`，不写额外的 `--`。A6 已删除公共 daemon package 及其 `npm publish`/OIDC workflow，当前 workspace 不再包含 `packages/*`，也不存在产品 npm 发行路线。

**推理与权衡**：pnpm 的 workspace 与确定性依赖布局更适合当前多包仓库，也避免 npm/pnpm 双锁文件漂移。迁移已经完成，后续文档、脚本和 CI 必须保持一致。

---

## 决策 21：产品路线收敛为本机个人 AgentOS

**结论（2026-07-11）**：Kith-space 的长期边界是一个 Human、一台物理电脑、多个本地 Space 和一组本机 agent。Windows 是 v1 正式平台，macOS/Linux 后续支持。正式发行只有 Desktop 安装包；可选浏览器入口依附 Desktop 生命周期。删除服务器部署、多真人、多机器、账户体系、云同步、对象存储、PWA 和独立 Web 发行路线。

**领域收敛**：产品术语统一为 `Space`；schema、API 和类型中的 `server/serverId` 分阶段改为 `space/spaceId`，URL `/s/:slug` 保留。对外删除 `machine/machineId`，内部 daemon 称为 Local Runtime Worker。`Members` 改为 `Agents`，Human 资料位于 Settings；普通 Space Dock 为五项，Home 按决策 23 增加 `Spaces`。

**数据与配置**：允许破坏性重置当前开发数据，不编写旧 `.kith` 迁移。正式产品不要求 `.env`；端口、Web 模式、访问 Token、托盘和自启动由 Desktop 设置管理。文件与附件只存本地磁盘，未来备份采用显式导出/导入。

**删除不是延后**：多真人、远程 agent 主机、公网托管、SaaS、云数据库、移动 Web、PWA 和推送是永久非目标。邮箱、日历、画布、跨 Space 聚合、HTTPS 安全升级及 macOS/Linux 发行才是延后能力。

**实施方式**：先同步权威文档，再依次完成本地领域与 `app.db`、浏览器访问安全、Electron 宿主、UI/入口清理和继承资产总审计。每阶段独立验证、独立提交。完整规格见 `docs/superpowers/specs/2026-07-11-personal-agent-os-local-pivot-design.md`。

**Windows 发行姿态**：Desktop 是唯一正式发行路径，但“有安装器文件”和“已公开发行”必须分开。A6 锁定 x64、per-user、assisted NSIS；本地/CI 产物默认未签名，CI 只上传 artifact。代码签名证书是公开分发的硬前置，真实安装/卸载测试也是正式发布验收的一部分。该约束不改变未来 macOS/Linux 路线，只规定当前 Windows v1 的可验证边界。

**实施状态（2026-07-18 更新）**：A2-A6 的原定代码切片与 P-A7 H1-H4 已落地；app data/Space root 分离、Space root cwd、可移植 Agent Memory、文件夹创建/接入/重连、stable Home 默认入口与 Home-only Spaces 模块均已完成，并通过本轮用户验收。H5 与 Runtime 契约 v2 继续等待决策 29 的 P-A9 Module Interface 稳定。

---

## 决策 22：Agent 首轮按创建、普通启动和真实唤醒分流

**结论（2026-07-12）**：新建 agent 的首个成功 turn 只向唯一 Human 的 `dm:@you` 发送一次简短自我介绍；已有 agent 手动启动、重启或恢复时只检查真实待处理消息，空收件箱必须静默；由频道、DM、任务或 reconnect backlog 触发的 turn 只处理持久化消息并在原目标回复。

**推理与权衡**：一次入职问候能把配置项变成有身份的团队成员，同时验证 runtime、Agent CLI 和 Human-Agent DM 整条链路。但不能用“有人给你发了消息”伪造触发原因，否则不同 runtime 会产生不一致行为：Codex 会严格执行“停止前必须回复”并发送无工作汇报，Claude Code/opencode 则可能静默。显式 `create | manual | wake` 原因让三种 adapter 共享同一产品语义，不依赖模型猜测。Core 为候选 introduction turn 生成一次性 token，只有 Worker 实际选择 introduction prompt 时才把 token 注入该 runtime 进程；CLI 也只有创建提示明确调用 `message send --introduction` 时才附带 token，普通 wake/后续回复不会被旧 token 污染。Human DM 发送在全部异步目标校验后、数据库事务前同步校验并消费 token；已撤销 token 的迟到问候和已完成 token 的重复问候都会被拒绝，普通消息因不携带 token 而不受影响。介绍消息与 `agents.introduced_at` 在同一事务提交，避免把普通回复、runtime online 或 turn 结束误判为 Human 已收到问候，也避免消息已出现但状态未写入后重复问候。

**边界**：问候限制为 2-3 句、只发一次 Human DM，不读取频道历史、不广播、不写记忆。schema v3 会把升级前已有 agent 回填为已介绍；普通 reset 保留介绍状态，清 Agent Memory 的完整 reset 会清空它并视为重新入职。真实投递在启动准备期间到达时合并进同一个 wake turn，避免“先问候、再处理通知”的双 turn。

---

## 决策 23：Home 是总控 Space，Space root 是 agent 共享工作目录

**结论（2026-07-12）**：每个安装实例有且只有一个稳定 Home Space。普通冷启动进入 Home Chat；Home 在同一个 WorkspaceFrame 的 Dock 中增加 `Spaces` 模块，用真实 app.db registry 创建、接入、搜索和打开普通 Space。应用内部数据默认位于 `~/.kith-space`，默认用户 Space 容器位于 `~/Kith-space`，Home 位于 `~/Kith-space/Home`；用户可把普通 Space 接入任意本机文件夹。所有属于某 Space 的 agent 都以该 Space root 为 runtime cwd，Agent Memory 位于 `<space>/.kith/agents/<agentId>`，runtime 临时状态位于 app data。

**背景**：A1-A6 验收实例通过 `KITH_SPACE_HOME` 把 Home 落在系统 Temp，并继承 open-tag 的 `<appData>/agents/<id>` cwd。agent 因而把用户要求生成的业务文件写进隐藏验收目录，`<space>/.kith` 也没有包含 Agent Memory。这与“用户选择一个文件夹作为 Space”“复制文件夹即可带走完整 Space”的锁定承诺冲突。与此同时，用户确认 Home 不是可删除的空默认项目，而是个人 AgentOS 的总控空间。

**选项与选择**：继续 per-agent cwd / 使用 Space root 作为共享 cwd（选中）；Home 放 app data / 放用户可见 `~/Kith-space/Home`（选中）；恢复独立总览壳 / 在 Home 单窗口中增加 Spaces 模块（选中）；跨 Space 写操作冒充 Human / 保留真实 Home agent 与 Human 委派审计（选中后者）。

**推理与权衡**：Space root cwd 让 Claude Code、Codex、opencode 的体验等价于用户在目标文件夹启动 CLI，多个 agent 也能对同一项目文件协作。代价是失去本就不可靠的 per-agent cwd 心理隔离，因此安全文档必须明确 cwd 不是沙箱。把 Agent Memory 放回 `.kith` 恢复可移植性，把 prompt 临时文件和 adapter 状态留在 app data 则避免污染用户项目。Home 的 Spaces 模块基于真实 registry，不重犯伪全局 Inbox 的错误；跨 Space task/message/dispatch 通过 Core 领域服务按 targetSpaceId 执行、幂等并审计，不直接写其他 SQLite，也不假装是 Human 亲自发送。

**实施边界**：H1-H4（路径、cwd/记忆、文件夹接入、Home Spaces UI）属于 A1-A6 验收前置修复。跨 Space 写编排 H5 后续渐进实现，先只读真实摘要，再接 task/message/dispatch；没有真实数据前不做占位视图。完整规格见 `docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md`。

**实施状态**：P-A7 H1-H4 已完成。`src/paths.ts` 已把 `KITH_SPACE_HOME` 收窄为 app data 覆盖，并以 `KITH_SPACE_SPACES_DIR` 独立隔离默认 Space 容器；app.db 保存稳定 homeSpaceId，Home 默认根为 `~/Kith-space/Home`。`src/agents/agentWorkspacePaths.ts` 与 `AgentManager` 已把主要 runtime cwd、Agent Memory 和 runtime state 拆为三个路径，并对派生删除路径做容器逃逸校验；项目 skills 使用 Space root，profile/reset 与 Human 侧记忆浏览使用对应 Agent Memory，同 agent reset/start 串行。OpenCode 已用 child-only inline execution agent 替代覆盖用户 `AGENTS.md`。H3 的 `SpaceRootService` 和 Space API 已实现默认创建、普通目录接入、兼容 workspace.db 稳定 ID 复用、`ready | missing | error` 列表状态与移动后重新定位；重复 root/ID、损坏或不兼容数据库、symlink 和身份不匹配会拒绝，冲突 slug 只调整本机路由别名，接入/打开共用 SQLite 完整性与表列校验。普通 API 不隐式重建缺失 root，relocate 失败回滚 registry；失联深链和全失联恢复保持 relocate 可达。H4 已以 stable Home 身份实现普通冷启动 Home、Home-only Spaces Dock/卡片、搜索/刷新/创建/接入/重连、最近打开记录与同窗导航；普通 Space 不能激活该模块。SpaceSwitcher 只保留快速切换、应急重连和 Home Spaces 入口。2026-07-18 本轮用户验收已完成，H5 未开始。

---

## 决策 24：授权浏览器通过 Core 受限浏览主机目录

**结论**：Desktop 继续使用 Electron 原生目录选择器；授权浏览器的创建、接入和重连流程通过 Core 的受保护接口浏览运行 Kith-space 的主机目录。接口只返回目录导航元数据，不读取或返回文件内容，选中路径仍交给统一 Space root 校验。

**背景**：浏览器本机的文件选择器无法可靠提供 Desktop 主机绝对路径，LAN 浏览器选择的还可能是另一台设备上的目录。此前的绝对路径输入虽然技术上正确，但体验差，也不符合“LAN 浏览器拥有完整产品能力”的既定边界。

**选项与选择**：A（继续手填主机绝对路径）/ B（让浏览器文件选择器冒充主机路径）/ C（由 Core 提供受限主机目录浏览器）。选择 C。B 的路径归属错误；A 仅保留为被推翻的过渡实现。

**推理与权衡**：目录枚举属于高敏感本机元数据，因此接口必须位于 Human 授权 gate 后，只接受绝对路径，只列目录，不返回文件内容；LAN v1 仍建立在“持有访问 Token 的受信任私网用户拥有完整产品能力”这一假设上。代价是授权浏览器能够看见主机目录结构，这必须继续受访问 Token、会话和既有 LAN 风险提示保护。

**已实现事实**：`src/spaces/hostDirectoryBrowser.ts` 负责跨平台根位置与目录枚举；`src/server/routes-api/hostDirectories.ts` 提供 gate-1 `GET /api/host-directories`；`web/src/spaces/HostDirectoryPicker.tsx` 提供浏览器目录选择 UI。创建与接入表单由 `SpaceFolderDialog` 承载为紧凑模态弹窗。

---

## 决策 25：会话辅助信息收敛为聚合面板，轨迹按 base conversation 隔离

**结论（2026-07-14）**：删除 Chat 顶部“会话 / Chat / 轨迹”工具条和 Chat 内嵌 Tasks/Files Tab。会话列表开关、当前会话 Tasks、成员和聚合面板入口进入会话标题栏；聚合面板固定承载“轨迹 / 话题 / 文件”，在 Split 中位于 Chat 与 Module 之间。中文 UI 用“话题”，内部继续使用 `thread`。实时轨迹只进入明确归属的 base conversation，thread 归一到父会话，无作用域或 ambiguous 事件不得猜测归属。

**推理与权衡**：原实时轨迹栏展示所有会话事件，会把并行 agent 工作误导为当前会话上下文；文件和 thread 索引又散落在 Chat Tab，模块打开后入口与布局规则不一致。一个会话级聚合面板把“当前会话的辅助索引”放在稳定位置，同时保留 Module 一次一个、话题正文仍在 Chat、Tasks 仍是模块的既有边界。代价是三栏需要明确最小宽度和降级顺序，因此聚合面板优先于会话列表、低于主要工作面与 Module；宽度不足时临时收至 `0`，不退化为覆盖 Module 的抽屉。

**实施边界**：聚合面板不是通用停靠系统，不可拖拽改宽，不持久化到 URL；轨迹仍是本次前端会话内每会话 300 条的有界缓冲，不新增历史表。话题列表用独立 thread summaries 查询，文件搜索只覆盖本次加载的当前会话 100 条附件。完整规格见 `docs/superpowers/specs/2026-07-14-chat-aggregate-panel-design.md`。

---

## 决策 26：Agent 响应模式采用“Space 默认 + 顶层频道覆盖”两层模型

**结论（2026-07-14）**：每个 Agent 在所属 Space 中保存一个默认响应模式，每个顶层频道的 Agent membership 可保存一个可空覆盖；有效值为“频道覆盖 ?? Agent 默认”。三档固定为主动（`active`）、被动（`mention_only`）和静音（`silent`），“跟随 Agent 默认”只是覆盖为空的继承状态。已有和新建 Agent 默认主动。Human-Agent 私聊和明确任务指派始终直达目标 Agent，不受模式限制；话题继承父频道，不增加第三层设置。

**背景**：现有 Human 频道消息会沿频道成员范围唤醒 Agent，runtime wake 提示又倾向要求每个目标都回复，导致“加入频道”同时承担阅读权限、自动启动和强制回应三种职责。用户需要的是按 Agent、按频道控制主动程度，同时保留私聊、任务指派和话题连续对话的确定性。

**选项与选择**：只做前端显示 / 在服务端建立统一响应策略（选中后者）；只设 Agent 默认 / 默认加频道覆盖（选中后者）；让 DM、话题各自再有一层 / DM 绕过且话题继承频道（选中后者）。响应模式不成为发送权限，也不取代 membership、频道生命周期或编排护栏。

**运行语义**：主动模式只对 Human 的普通频道消息做环境唤醒，Agent 可以判断后静默；被动模式只因明确 `@` 或已参与话题中的 Human 跟进唤醒；静音模式不因频道消息、频道 `@` 或话题跟进自动唤醒。Agent 普通消息不环境唤醒其他 Agent，避免循环；明确 `@` 仍可唤醒主动或被动目标。模式切换只作用于新事件，不补唤醒历史消息，也不复用 read cursor。

**任务边界**：Human 选择“指派任务”并恰好 `@` 一个 Agent 时，必须把该 Agent 写成真实 assignee，并按明确指派绕过三种模式；没有 `@` 时创建未指派频道任务，仅主动成员可被环境唤醒；多个 Agent mention 因当前任务只有单 assignee 而在提交前拒绝，不能静默挑选目标。

**实施边界与状态**：该决策已于 2026-07-14 落地。纯策略、独立设置与消息适配模块分别位于 `src/agents/agentResponsePolicy.ts`、`agentResponseSettings.ts` 和 `agentResponseDelivery.ts`；实时 wake、reconnect backlog、Agent message check 与 prompt 共同消费响应指令。schema v5、默认值/频道覆盖 API、窄实时失效、真实任务 assignee 与 Agent Profile 默认卡片均已实现。2026-07-16 只调整前端入口：频道昵称后徽标/hover 菜单退役，频道覆盖改由消息头像点击 Agent 卡片承载；该卡片只能写当前频道覆盖或恢复默认，不能修改 Agent 默认值，成员设置页仍不复制第二套编辑器。完整规格与验证状态见 `docs/superpowers/specs/2026-07-14-agent-channel-response-mode-design.md`。

---

## 决策 27：`@all` 使用 Human 专属的发送时 Agent 快照

**结论（2026-07-15）**：Human 在可写顶层频道或其话题发送语言无关的规范 token `@all` 时，服务端以父频道当时的全部 Agent 成员生成接收者快照。主动和被动目标按明确 mention 得到 `required` 投递，静音目标保留可见消息但不自动唤醒。Agent 发送同样文本不产生群体 mention，避免 agent-to-agent 连锁扩散。界面候选标签使用 i18n 显示“所有人 / Everyone”，协议、数据库 mention name 与历史正文不保存本地化 token。

**持久化与话题语义**：消息只显示一个 `@all` 标记，不在正文或 UI 展开名单；`message_mentions` 同时保存 `channel_all` 展示标记和每个快照 Agent 的普通 `agent` mention 行，因而实时 wake、Worker reconnect 与 message check 自动复用决策 26 的统一路径。话题以内层发送时取父频道成员快照，并以当前消息可处理的边界把快照 Agent 加入话题；后续新增频道成员不会追溯成为旧消息接收者。

**产品边界**：v1 不在 Human-Agent DM、归档频道或“指派任务”中提供该能力；只读 Showcase 在决策 28 实施前同样禁用，并随该功能退役退出产品边界。任务仍保持单 assignee：`指派任务 + @all` 在任何消息、成员关系或任务状态落库前拒绝，用户应明确 `@` 一个 Agent 或创建未指派任务。频道生命周期、membership、Space 隔离、dispatch 深度、wake budget 与 emergency stop 继续作为外围 guard，`@all` 不提供绕过能力。

**推理与权衡**：发送时快照同时满足“这条历史消息当时通知了谁”的稳定性和既有投递链复用；若只在读取时解释为当前成员，成员变更会篡改历史语义。限制 Human 发起与任务模式禁用，避免把方便的频道广播误变成无边界的 agent 群体派发或多负责人任务。

---

## 决策 28：侧栏统一控制主卡片切换，Dock 退役

**结论（2026-07-23 最新修正）**：工作区最左侧常驻 `68px` 纯图标导航栏，顺序为 Messages、Search、Spaces（Home only）、Inbox、Tasks、Agents、Settings；每个入口通过 hover/focus tooltip 显示名称。Messages 是 Chat 的正式入口，激活时在图标栏右侧显示只含已保存、频道、私信和运行状态的消息中栏，消息中栏不放搜索框。点击 Spaces、Inbox、Tasks 或 Agents 后图标栏不隐藏，消息中栏随 Chat 退出，右侧主工作区原位切换为对应模块；不再创建 Split 第二工作面，也不挂载横向 Dock。Settings 保留同一 URL/resource 契约，但以覆盖当前工作区的模态层呈现。

**视觉结论（2026-07-24 按用户最新反馈修正）**：采用参考图的连续三栏表面：最左图标栏使用 `#f5f5f5` 且不绘制右边线，白色消息中栏和白色 Chat 主区只用约 `#f0f0f0` 的必要细分隔线区分；消息中栏使用“消息 / 已保存 / 频道 / 私信”的清楚层级，不放搜索框。Human 消息右对齐并使用 `#e7f0fe` 气泡；Agent 消息左对齐并使用 `#f5f5f5` 气泡，消息头像统一为 `36px`。频道 Agent 保留常规字重昵称且气泡顶部落在头像圆心，私聊隐藏重复昵称并让气泡与头像顶部平齐。Agent 时间只显示气泡下方 `HH:mm`，仅在消息 hover/focus 时出现；hover 工具栏与“更多”菜单使用一致的白色表面、浅边线、圆角和投影，并按发送方向优先放在 Agent 气泡右侧或 Human 气泡左侧，空间不足时放到上方。话题回复预览从气泡分离为独立 hover 卡片；话题分栏从主标题栏下方开始，父消息无重复背景，头像和 Agent 气泡使用对称安全边距。日期使用居中灰色胶囊。Composer 本轮保持不变。

**案例展示边界**：案例展示不再属于目标信息架构，实施时完整删除入口、路由、静态视图、演示资产、专属文案/样式/测试和仅为该只读场景存在的产品分支；真实归档频道继续承担只读能力和回归覆盖。旧 Showcase URL 规范化到当前 Space 默认频道，不保留兼容产品页。

**背景与选择**：该决策先后经历了底部 Dock、单一“图标 + 文字”侧栏与最新双层左侧导航。最新参考图和用户反馈明确要求把模块入口收窄为纯图标，并把频道/私信迁入右侧独立消息中栏，同时补充 Messages 入口；输入框与消息中栏搜索不在本轮范围。

**推理与权衡**：最左侧图标栏只回答“去哪个功能”，消息中栏只回答“打开哪个会话”，职责拆分后不会再把频道、私信和业务模块混在同一长列表。tooltip 与 `aria-label` 补足纯图标的识别和可访问性；模块继续同槽位替换，避免恢复 Dock 或第二工作面。Settings 信息密度和内部二级导航较高，继续使用独立模态层。完整规格见 `docs/superpowers/specs/2026-07-23-chat-icon-rail-message-pane-design.md`。

**实施状态**：2026-07-23 最新修正已实现。`WorkspaceNavigationRail` 组合 SpaceSwitcher 和纯图标 `SidebarModuleNavigation`；`ChatSidebar` 只在 Chat 中挂载消息中栏，业务模块态只保留图标栏。Settings 由独立 `SettingsDialog` 复用既有设置内容。URL 与模块 resource query 保持可恢复，`WorkspaceDock` 与案例展示继续保持退役。

---

## 决策 29：保留 Desktop/Core/Worker 拓扑，以模块化单体渐进收敛；Rust 只由性能证据触发

**结论（2026-07-18）**：Kith-space 继续使用 Electron Desktop Supervisor + Node/TypeScript Core Service + 安装级唯一 Local Runtime Worker + React UI + SQLite 的本机拓扑。Core 收窄为组合根和 HTTP/Socket Transport Adapter，Worker 负责外部 runtime 进程隔离；消息、任务、Agent、频道、文件、Space 与 Runtime 控制逐步形成高内聚的深 Module。P-A9 不做全量 Rust 重写、微服务化或把 Core 塞回 Electron main。

**职责与依赖约束**：设计遵循高内聚低耦合、单一职责、开放封闭、KISS、DRY、迪米特法则、依赖倒置和关注点分离。Transport 只做认证、解析、序列化；业务用例通过窄 Interface 暴露；SQLite、Socket、外部 CLI 和 OS 行为由必要 Adapter 实现。领域 Module 不导入 `src/server/` 或 `src/desktop/`，Human HTTP、Agent data plane 与未来 MCP 复用同一消息/任务 Interface。SQLite 与本地文件系统用真实临时资源测试，不为每张表建立通用 Repository。

**为何保留 Core 与 Worker**：Core 为 sandboxed renderer、Desktop 与授权本机/LAN 浏览器、Agent CLI 提供同一份本机权威、Space guard 和实时行为；这不是公网 server 路线。Worker 隔离长时间运行且可能崩溃/取消的外部 runtime 进程，并承载每 Agent 顺序、容量和停机排空；这不是远程 daemon。合并二者会降低故障隔离，合并进 Electron main 会让宿主生命周期重新耦合业务与数据库。

**Worker 接纳与重放边界**：Core 写入 WebSocket 不等于 Worker 已接纳。Message/Task Module 通过 `WakeDispatchPort` 提交 effect，Core 控制层再用 `RuntimeWorkerPort` 的稳定 deliveryId 等待 `admitted | queued | rejected`；wake 使用 reservationId，手动与生命周期命令使用独立 commandId 且不占 wake budget。Core 的 get-or-reserve 以 `(spaceId, chainId, messageId, targetAgentId)` 为持久逻辑键，只在接纳 ack 后提交 wake；断线用同一 reservation 重放，重复 command/ack 与 reconnect 不得重复消耗 wake budget，Agent check/read 推进的 `lastReadSeq` 关闭未读重放窗口。若现有 `dispatch_wakes` 不能证明持久唯一性，必须先补独立 schema/迁移/恢复设计，不能只用内存去重。

**可靠性口径**：上述契约保证接纳确认与未读重放，不保证外部 runtime 端到端 exactly-once。Agent 已 check/read、推进 `lastReadSeq` 后若在回复前崩溃，恢复仍需要 Runtime 契约 v2 的 turn completion 语义；P-A9 不得把该已知窗口表述成“绝不丢工作”。

**为何不全量换 Rust**：当前负载主要是 SQLite、WebSocket、文件与子进程 I/O，以及外部模型/工具等待；`better-sqlite3` 已使用原生实现。现有瓶颈首先是职责集中、fan-out 重复查询、缺少安装级 runtime 背压和 Chat 控制层拥挤，语言重写不能解决这些结构问题，反而增加 Electron/Node/Rust IPC、三端原生产物、签名、ABI、诊断和双语言维护成本。

**Rust 决策门**：只有可重复性能基线显示产品 SLO 未达标、结构性问题已经消除、profiler 把多数可控 CPU 时间归因到一个稳定且可独立输入输出的 Module，并且 Windows/macOS/Linux 构建维护收益为正时，才另立 ADR 评估 sidecar、N-API 或独立二进制 Adapter。替换必须保持 Module Interface 和可回滚路径；全量 Core/项目重写不属于当前路线。

**实施方式**：P-A9.0 先冻结全部消息写入与 Agent 端点所有权矩阵、静态依赖基线、当前 Worker socket-send/reconnect 行为和 1/5/10/20 Agent Core/UI 基线，并产出 P-A9.4 admission/replay 目标契约清单；不要求尚未实现的 ack 测试提前变绿，也不把 socket-send 指标命名为 admission SLO。之后按 Message/Task、Agent Transport、领域依赖、Runtime admission/session 容量、Chat 控制层和证据驱动性能优化逐切片迁移。依赖测试对当前唯一 `agents/agentDeletion -> server/storage` 采用精确临时 allowlist，P-A9.3 强制清除；每个切片保留短期兼容 facade、迁移调用方后删除旧 Implementation。默认不改 schema、公开 URL、Agent CLI 或 `/daemon/connect` 路径；可靠性需要 schema 时必须单独设计。完整规格见 `docs/superpowers/specs/2026-07-18-desktop-modular-monolith-architecture-design.md`。

**实施状态**：方案已锁定，P-A9.0 当前行为特征测试、精确依赖护栏、Core/UI 性能基线、fake Runtime harness 与 P-A9.4 目标契约清单已完成；P-A9.1a–P-A9.7 的实现、文档、全量门禁、性能回归、packaged/browser smoke 与约定的一次独立只读终审也已完成，并以 `d5261c1` 收口提交。随后真实存量数据暴露了空闲常驻 RuntimeSession 占满容量、队列在 120 秒 TTL 后过期的回归；修复保持容量/队列参数不变，由 AgentManager 按既有消息合并批次和 adapter `online/error` activity 终态产生本地 idle hint，再结合队列压力决定空闲会话是否立即让位，同时让 queued 手动启动延迟到实际 admitted 才进入工作态，并让失败 wake 终止可见回复占位。这不新增跨 Core/Worker 的 turn-complete 协议。socket-send 仍只作为同步 enqueue 诊断指标，total 口径已切到 admission ack，持久 get-or-reserve、RuntimeSession 容量队列以及 P-A9.6 的 20-Agent SQL 260→151 绝对 SLO 结果都已落地。Runtime 契约 v2 在 P-A9 收口时尚未开始，后续已由 P-A10 完成；H5 仍未开始。

---

## 决策 30：Agent Harness v2 采用 per-surface session、durable delivery/turn、Context Envelope 与双层记忆

**状态**：Accepted / Implemented。P-A10.0–P-A10.7 已完成迁移、workspace schema v8/app.db v4、Runtime v2 bridge、per-surface registry、durable turn、server-owned direct-mention thread、Context Envelope、实时父级ACL、turn inspector、完整`kith-core` MCP/CLI Gateway、revisioned episodic memory、restricted advisor/记忆管理UI，以及checklist/snapshot/compaction telemetry。

**结论**：同一 Agent 的频道、Human-Agent DM 与话题使用独立、可恢复的 runtime session；automation 只保留未来扩展类型，P-A10 不启用。消息事务先逐 Agent 持久化 durable delivery item，scheduler 再按 target session 形成 logical turn；每次执行追加带 Worker generation/lease 的 attempt。Core 持久 Context Envelope、逐输入 obligation、operation/output、usage 与 reply/cede/fail 终态，Worker 只持可重建的 engine process/session handle。Human 顶层 direct mention 默认由服务端原子创建 root/thread/membership/delivery，并锁定 Agent reply target；模型 stdout 不直接成为消息。

记忆继续保留 User/Space/Agent 三层 `MEMORY.md + notes/`，另加 Agent-scoped structured episodic memory：canonical item指向不可变 revision，typed evidence/relation、disclosure projection、forget suppression、稳定 continuity bundle、中文2/3-gram+FTS recall、advisor，以及 Human manage/Agent recall/debug 三个显式 view。消息记录仍是事实源，记忆只是带来源、可纠正、可归档的派生线索；embedding仅作为后置可替换 Port。

工具由 Capability Gateway 统一：turn/session 原子能力和生产力模块优先 MCP，受控 CLI/shell 可用时现有 `kith-space` CLI 作为兼容 Adapter；二者调用同一领域 Module。常驻 runtime 不通过普通环境变量持有 per-turn bearer，而由 session-bound broker 激活当前 attempt；Core实时校验 Agent/Space/surface/input/watermark/scope/expiry。授权、错发、operation冲突与确定性披露失败 fail-closed；recall/advisor/consolidation失败 fail-open。Gateway是唯一受支持产品 API，但在OS sandbox前不是物理隔离。公开频道目标语义收紧为“可发现、加入后读写”，私有频道只对成员可见；跨频道不自动注入原文，私密来源按canonical/internal/shareable/ref投影披露并审计。

**推理与权衡**：Helio实测证明“像真实同事”不需要一个全局无限session，而来自局部session、自动recall、权威历史查询、私有wiki、turn ledger和严格消息交付协议的组合。两路对抗性审查进一步证明，若消息提交后才创建turn、只存一个可变attempt、让模型自带随机幂等key或只保存current memory text，仍会在崩溃、合批、父频道root、撤权和forget时失去正确性。Kith-space因此在P-A9地基上增加durable delivery inbox、logical turn/attempt/output、broker与immutable memory revision，而不是复制Helio的云控制面或继续依赖prompt。代价是v6/v7表与迁移显著增加，消息事务多出有界fan-out写入，必须以P-A9 SLO、RSS/FD和中文recall基线验证。

**备选方案**：

- 每 Agent 一个全局 session：因跨频道污染、无法独立逐出/压缩/审计而否决；
- 每消息冷 session：因连续性、成本和工具状态丢失而否决；
- 只用三层文件记忆：保留但不足以承担低延迟 top-k、纠错链和管理面板；
- 只用向量记忆：无法替代权威消息和来源审计；
- 全 CLI 或全 MCP：前者结构脆弱，后者不能覆盖支持不完整的 runtime，故采用共享领域实现的双 Adapter；
- Worker 直接写 workspace.db：破坏 Core 单一写入权威和 P-A9 模块边界，否决。
- 仅在 post-commit 创建 pending turn：Core 崩溃会丢 required work，改为消息事务写 durable delivery；
- per-turn token 固定注入常驻进程 env：无法轮换且可被 shell 读取，改为 broker activation；
- memory只保存current text或hard delete：无法重建历史revision且会被advisor重新学习，改为revision+suppression。

**提案默认值**：direct mention总是开话题（`@all`例外）；公开频道join后可读；通过严格evidence门槛的agent-private候选可自动active且可关闭；detail默认90天；同一Agent单turn串行；silent可加入thread但不wake；记忆删除拆成archive/delete/forget+suppress；OS sandbox前只声明产品内私有。这些值仍可由用户在编码前推翻，推翻需同步规格/ADR/验收。P-A10.0只冻结契约和修复migration前置，不改变UI行为。

**P-A10.0 实施状态**：`src/db/spaceDatabaseSchemaHistory.ts` 与 `spaceDatabaseCompatibility.ts` 已把 migration 前检查改为 immutable version manifest + journal hash/prefix，future DB 不再与 legacy 共用删除引导；`src/app-data/appDatabaseMigrations.ts` 建立 app.db v1、checksum journal和事务回滚。`src/runtime/contract/v2/` 与 deliveries/turns/context/capabilities/memory contract冻结目标codec，但当前v1 adapter仍按能力矩阵标missing/unsupported。该切片不改变schema v5、`agents.session_id`、CLI写权限或UI。

**P-A10.1 实施状态**：workspace schema v6 新增 `agent_harness_state/runtime_sessions` 与 current-generation partial unique index；v5迁移显式记录legacy并保留 `agents.session_id`，不猜测旧全局session属于哪个surface。Core `SessionModule`强制drain后的 `legacy→migrating→v2` 和回滚，runtime/model/config/adapter/host/workspace变化创建新generation。stable broker handle只有匹配的短时attempt activation才能兑换claims；Worker session host分离active turn与resident process、同Agent串行并LRU逐出。Claude/Codex/opencode bridge提供显式session change/completion/final usage/process cancel；Kith MCP、tool isolation、cwd relocation和compaction telemetry仍为unsupported。legacy API/Worker/reconnect/start在非legacy mode下拒绝，P-A10.2前不切实际产品Agent。

**P-A10.2 实施状态**：schema v6 的后续 migration journal 前缀新增 durable delivery、turn/attempt/event、operation/output/input mapping、activation/context/disclosure/checklist/wakeup 表和既有消息/membership列；同版本的 P-A10.1 前缀仍可合法续迁。Message/Task/output 与 delivery 同事务提交，task非assignee也得到observe事实，连续frontier以`seq > watermark`的分页join推进；actionable delivery逐条复用既有dispatch reservation和wake budget。Core持有turn lease、同步续租broker claim、obligation和server-owned output权威；stop/reset使用cancel+未结input requeue而非retry，rollback以稳定acceptedAt在任何外部副作用前授权并在最终事务复核。Worker的admitted+activated总量有界，admission 120秒TTL，同Agent排队可取消，安装级Space FIFO配合每Space/Agent有界批次；event有64KiB单条、2000条/8MiB聚合上限、critical预留和truncation摘要，terminal使用strict usage codec与128KiB envelope cap，在Core幂等ACK前保留重传，Core generation推进会清理旧admission/preparing/running/terminal，过期lease的event/output/terminal均fail closed。2026-07-20真实registry中一个故意损坏的schema测试Space暴露`allSpaceDbs()` eager scan会让健康P10 Space的event/terminal ACK一并失败；现在Worker event显式携带admission `spaceId`，Core只在该Space内核对turn/attempt/session，安装级ready/offline/lookup/reminder扫描逐Space跳过不可用项。过期attempt恢复后真实两条旧消息和一条新消息均形成reply、output、usage与trajectory。Agent reply解析当前成员mention并继承唯一dispatch chain/depth，含mention的多链合并被拒绝且实时事件携带mention，防止绕过递归wake预算。runtime配置漂移退休旧turn并requeue未结input，由新session generation重绑，不形成热循环。最小loopback Gateway和CLI只开放`turn context/reply/cede`；既有Agent切换先关闭legacy admission并等待在途HTTP drain，legacy/v2不双消费。逐调用实时membership/父话题ACL已由P-A10.3补齐；完整MCP与其余产品工具仍属P-A10.4。

**P-A10.3 实施状态**：Human/Agent direct mention在消息事务内建立唯一thread与合法参与者，v2 `turn.reply`同样不能绕过该语义；root来源cursor保持父频道而session/output固定到thread，现有thread内只能加入已有父级访问权的Agent。mixed cutover中v2 mention只写durable delivery，legacy mention复用同一响应模式/水位线判定并只把actionable dispatch reservation与output同事务提交，由Conversation Module执行/重启扫描恢复；post-commit设置变化产生的确定性no-wake会原子退款预算，migrating消息由cutover backfill接管，不双消费；workspace v6第三个不可变journal前缀增加reserved wake恢复索引。`@all`不建thread，silent只获得terminal observe。Context Envelope保存current batch、root、root前as-of父频道快照、continuity profile、task/attachment/UI不可变snapshot、文件记忆索引ref、预算/omission和多source watermark；冻结frontier不吸收未绑定later delivery，required超8k按连续前缀拆到后续turn。app.db v2保存不出库的安装级HMAC key，删除source只剩不可逆tombstone。Gateway、Context assembly与output提交都重验当前membership；Human移除和Agent自助leave同事务失效普通child session/attempt/capability/wakeup，非父级task assignee使用带task ref与到期时间的`task_scoped`grant并在release/reassign/任务终态、admission前自然到期或运行中heartbeat越界时撤销。Agent持久回复通过`producedByTurnId`进入Context/Steps/Usage/Outcome抽屉，omitted/ref-only不返回正文；output surface在冻结watermark之后出现Human/其他Agent消息时返回`stale_context`。完整MCP与refresh留给P-A10.4。

**P-A10.4 实施状态**：`CapabilityGateway`成为MCP与CLI Transport Adapter之后的共同领域入口，覆盖context refresh、server-owned reply/cede、progress/turn inspector、ACL约束的conversation read/search、surface checklist、short wake、capability describe，以及通过窄port复用既有Task Module的list/get/create/claim/update/assign/unclaim/report/deliver；两个Adapter复用冻结的canonical strict reply/cede schema、CAS/idempotency、崩溃reconciliation和operation ledger。Agent custom scopes决定reply、attachment、task与conversation能力；required turn缺少`message:send`时在runtime admission前失败。JSON POST先有界解析再授权，每个领域写事务内原子重验activation/lease/generation/实时scope/父级ACL，Core单写进程对同operation single-flight，create/report/deliver以operation ID精确reconcile。v2临时附件按turn/activation/owner/server-owned surface与一小时expiry持久化，reply与message原子绑定；25 MiB超限或批内任一失败清理本批对象，temporary/deleting/bound状态及启动/调度GC恢复文件/SQLite崩溃窗口。跨private/DM disclosure domain在P-A10.5策略引擎前read只给`ref_only`、search不形成关键词oracle。stable broker handle仍只在当前attempt activation内有权，常驻进程逐调用读取短时descriptor。later-query source/watermark追加审计并旋转freshness claim，原Envelope不改写。Runtime准备按文件存在性选择mode后执行真实stdio/list-tools探针，探针失败只在CLI可执行时降级，否则在外部模型启动前返回`mcp_bootstrap_failed`；实际MCP/CLI调用更新有界transport诊断。short wake保存原始业务幂等键并由`UNIQUE(session_id,idempotency_key)`保证同generation跨turn重试仍只产生一条trigger。manual start只返回body-free逐surface inbox summary。真实Gateway fixture同时跑MCP、CLI client与CLI parser，并覆盖reply normalization/attachment/Task写；三家provider bootstrap在最终Desktop smoke前仍暂标`fixture_v2`，tool isolation、cwd relocation和compaction telemetry明确unsupported。P-A10.4未开放任意写Gateway，也未提前实现memory/H5/P-S1。

**P-A10.5 实施状态**：workspace schema v7与app.db v3分别引入Space内和Human-only user-global episodic memory；当前app.db v4用独立、可回滚的rebuild migration修复早期v3变体缺失的复合revision FK，接受已知immutable v3 journal checksum但不放松当前schema gate。迁移前拒绝orphan，事务内保留canonical/revision/evidence/relation以及未重建的tag/lexical/FTS数据，失败回滚并恢复连接外键开关。canonical只指向append-only revision，typed evidence/relation、tag、suppression、actor域幂等mutation ledger和normalized FTS均已落地。Human控制面支持CAS lifecycle、历史revision/relation审计、replacement pointer与suppression解除；secret和权威exclude source拒绝入库。两库continuity/query候选按统一score breakdown合并，读取与最终reply都重验message/turn/file生命周期、跨Space ACL和validity；mixed evidence使用最严格projection。forget以secure-delete+WAL truncate清除正文，Agent full reset/delete只清private结构化记忆。Context Envelope冻结revision/HMAC/projection/score/evidence，Agent通过`knowledge:read`约束的`memory.recall/get`读取；一次性grant固定turn/source revision/target/action digest/TTL并由reply事务consume-once。P-A10.5没有自动advisor或Human记忆面板；它们仍由P-A10.6实施。

**P-A10.6–P-A10.7 实施状态**：workspace schema v8增加restricted advisor control plane、proposal/recall observation与session revision；Claude maintenance运行在无工具/MCP/CLI、ephemeral cwd的独立Port，provider结果经typed actor/evidence、exclude/secret、source ACL、suppression、dedupe、成本/批次/lease验证后才能active/proposed，Codex/opencode当前明确unsupported。Advisor在provider返回和最终写事务内再次CAS校验job lease、Agent/source生命周期，混合retry/source cap按job结算，canonical/revision/evidence/proposal/conflict relation/mutation原子提交；安装级队列限制跨Space maintenance并发。Human面板提供Structured/Files、manage/recall/debug、proposal/revision/relation/evidence/disclosure/source revoke/suppression与advisor freshness，并允许Human把撤权来源的item以新manual revision确认为独立知识而不恢复旧ACL。Core启动和每5秒执行幂等durable-turn恢复扫描，封闭message+delivery提交后所有post-commit effect都失败且再无新事件的窗口。snapshot按session/generation/checksum/64KiB门禁持久和恢复，checklist/short wake跨restart使用session单调revision；compaction以持久turn event revision作为下一Envelope一次性`post_compaction`标记，terminal可重建append后投影失败窗口；高频preview以250ms窗口按类合并并在critical/terminal/cancel/close前flush，event/terminal/usage即时ACK并有60秒snapshot兜底。Codex提供可映射compaction telemetry，Claude/opencode不伪造统一summary。真实Desktop/Web验收发现并根治了Worker turn identity漏接`source=turn`、v2明确任务被legacy task wake双消费并误停Agent、terminal usage未承接final usage event三条跨边界问题。

完整规格：`docs/superpowers/specs/2026-07-19-agent-harness-session-context-memory-tools-design.md`。

---

## 决策 31：结构化记忆提炼采用安装级可替换 Advisor Provider，与聊天 runtime 解耦

**状态**：Accepted / Implemented。2026-07-23按“内置Pi为新安装默认、Claude可切换、模型设置独立”修订并完成切片0–4。fresh install进入`provider_v1 + pi_sdk + setup_required`，既有安装保持`legacy_runtime`；Claude/Codex/opencode聊天Agent在逐Agent授权后可共用系统Provider，结构化recall、Human管理与文件记忆不受Provider状态限制。

**结论**：Memory Advisor的业务管线继续由Core `MemoryAdvisorService`拥有，但执行一次结构化completion的能力收敛为安装级`AdvisorProvider`。它不是普通Agent，不具备身份、频道membership、DM、消息发送、工具、MCP、持久session、业务ACL或数据库写入权。同一个Provider可在Human显式授权后处理Claude Code、Codex、opencode聊天Agent产生的eligible turn，聊天runtime的session、工具、模型和配置不被复用。

设置、job/run和审计必须区分三层：本机execution adapter、不可变`Advisor Model Profile`（实际model provider/model/API/endpoint/credential source/data policy）和完整出站计划（canonical endpoint、region、credential identity、tenant/project、proxy/allowed egress）。新安装默认选择Desktop内置、精确锁版的Pi SDK Provider，Claude Code作为可切换Provider；既有安装不静默切换处理方。Adapter必须在读取evidence与外发正文前完成无正文preflight，任何unknown或漂移fail-closed；调用后校验只作二次审计。每个job/run同时固定Provider revision、Model Profile revision、installation identity、Provider/revocation epoch、配置/能力digest、egress、source-scope与per-Agent consent epoch；凭据通过绑定run/epoch/Worker generation的短时单次activation handle注入，不持久化。Core用`ProviderEpochGate`封闭最终app epoch复核与workspace事务提交之间的设置切换窗口。旧`enabled=1`不构成云端外发授权，Agent ACL可见但不在consent scope的DM/私有正文不得外发；跨机器、撤回后重授或边界变化也不能静默重路由或批量重放历史。Provider返回只是不可信candidate，仍需经过既有typed schema、memory-poisoning policy、source ACL、secret/noise、suppression、dedupe、disclosure、lease、Agent/Space lifecycle和最终原子事务。

**推理与权衡**：为每种聊天runtime分别实现maintenance会重复无工具、MCP/session/cwd/environment隔离、schema、取消、usage和版本兼容，并使记忆能力随聊天引擎漂移。普通内置Agent又拥有过多身份、会话和工具能力。安装级无状态Provider用更窄接口获得更低维护成本和一致记忆体验，但引入app.db Provider revision/epoch、workspace per-Agent consent epoch、provider run、配置漂移恢复与独立设置UI。迁移先冻结现有Claude结果，再补最小env、临时HOME、可执行物完整性与进程树终止能力；外发授权控制面上线时，旧enabled状态不自动继承为consent，Codex/opencode也只在明确授权后开放。

**Pi边界**：Kith-space内置并精确锁版`@earendil-works/pi-ai`，用Kith-owned helper通过锁定版本公开的`createModels`/provider factory/`models.completeSimple()`执行一次completion，不启动完整Pi coding agent、AgentSession、agent loop、文件/shell工具、项目配置或资源发现。系统Pi CLI不是执行依赖，只能由Human显式触发；Kith自有纯数据解析器只读其全局模型目录和所选凭据来源，不调用命令/env resolver、OAuth刷新、provider hook或写回。项目`.pi`、`!command`、复合环境插值与动态网络刷新都不执行。导入生成脱敏不可变快照，配置变化需刷新、重新预检并按边界重新授权。Pi不是sandbox，选择Pi也不代表数据留在本机，仍需显示并授权实际backend/model/destination。

**备选方案**：否决“每聊天runtime各做一套Advisor”，因为安全与维护逻辑重复；否决“普通内置Agent”与“内置完整Pi coding agent”，因为权限面和资源发现面过大；否决“只调用系统Pi CLI”，因为版本、PATH、全局配置和供应链不可复现；暂缓“捆绑本地模型权重”，因为分发、硬件、质量与许可证成本。保留确定性规则作为模型前后的admission/validation而非唯一语义提炼器；Pi SDK统一多模型调用仍必须走相同授权和审计。

**实施边界**：本决策不命名为P-A10.8，也不吞并P-A11 consolidation、P-A12 skill reconciliation或P-S1 sandbox/approval/Vault。完整提案见`docs/superpowers/specs/2026-07-22-system-memory-advisor-provider-design.md`。

**实施事实**：app.db v5持久Provider/Model Profile revision、installation identity、provider/revocation epoch、迁移状态与Pi CLI脱敏快照；workspace schema v9持久逐Agent consent、job执行快照和独立Provider Run。内置`@earendil-works/pi-ai@0.81.1`经one-shot helper只调用公开`createModels → provider factory → getModel → completeSimple`，构建依赖图拒绝`pi-agent-core`、`pi-coding-agent`和compat。CredentialPort、模型Compiler/认证矩阵、artifact digest、最小env/临时HOME、DNS pinning、redirect拒绝、pre/postflight、ProviderEpochGate和最终ACL/epoch复核均已进入实际执行链路。通用Core→Worker completion命令只携带单次activation handle，凭据由Worker经独立本机兑换消息按run/epoch/generation/snapshot取回；Agent/Space/来源频道撤权、设置切换与probe使用同一active-run取消屏障，Core断线时Worker先清理旧helper与准备态再重连。设置UI与Agent Memory面板分别承担安装级配置/诊断/Run审计和逐Agent授权/撤权。

---

## 决策 32：模型配置由 Kith 统一管理，CLI 配置只读导入并在启动时注入

**状态**：Implemented（2026-07-23）。

**结论**：Kith-space 的安装级 `app.db` 成为模型供应商连接、可复用模型配置、运行器默认值和 Memory Advisor 模型绑定的产品事实源。供应商连接与 Claude Code、Codex、OpenCode、Pi 等 runtime 解耦，由 runtime 专属 compiler 按 API 协议、认证方式和本机版本判断兼容；Agent 只保存“跟随运行器默认”或“固定某个模型配置 revision”的绑定意图，不复制 endpoint 或密钥。运行器默认值显式区分 Kith 模型配置、受限的 `unmanaged_cli_native` 与未设置三态，不能用 nullable 字段混淆；CLI-native 不可用于 Advisor。

**配置边界**：Kith 可以由 Human 显式触发、只读并脱敏地导入受支持的 Pi/Claude/Codex/OpenCode 全局配置，但默认不写回任何 CLI 用户配置。Core 固定 provider/model/runtime revision 和执行 fingerprint，Local Runtime Worker 在每次启动时用参数、child-only 环境和 Kith-owned 临时配置注入；配置变化先提升安装级 runtime epoch、阻断旧 admission，再进入新的 session generation，不热改或错误 resume 旧 session。未来“同步到 CLI”若实现，只能是显式、展示 diff、备份、原子写入和可回滚的高级动作，不能成为正常运行依赖。

**Pi Runtime**：Pi 从现有 experimental print-mode one-shot adapter 提升为正式 P-A10 v2 runtime，优先适配本机外部 Pi CLI 的 RPC 模式，接入 per-surface session、durable turn、Context Envelope、Kith CLI Gateway、usage、cancel、snapshot 和 compaction telemetry。Pi Agent runtime 与内置 `pi-ai` Memory Advisor 是两条独立路径，不共享 session、工具权限或执行配置；Pi 没有内置 MCP 时必须诚实标记 unsupported，不能把 CLI fallback 伪报成 MCP。正式 ready 必须通过版本化 RPC 基线与默认禁用项目/用户 extension、skill、prompt、theme、context 的安全启动探针，并以 `agent_settled` 作为唯一 turn terminal。

**UI 结论**：Settings 增加“模型与供应商”和“运行器”。模型页采用单列来源总览，添加与编辑复用同一弹窗并在其中维护该供应商的模型；一次保存由服务端聚合命令在runtime configuration写锁内读取当前状态，并在单一app.db事务内提交供应商revision、模型增删改和runtime epoch，不能由前端逐接口形成部分保存，也不能让排队并发请求复用旧快照。删除采用二次确认，仍被运行器、Advisor或任一可用Space active pinned Agent引用时fail-closed；软删除Agent不再占用，任一已登记Space不可访问时拒绝删除。disabled配置不再进入选择器或执行解析。Memory Advisor 页只负责启用状态、执行器、模型配置、真实数据目的地与授权影响，revision/epoch/digest 和 Provider Run 进入高级诊断。Agent 记忆页把 Advisor 收敛为摘要条与管理抽屉，主体空间优先给结构化记忆列表/详情；类型和范围筛选收敛为单一菜单。现有 `Advisor Model Profile` 继续作为内部不可变执行快照，不再作为普通用户直接编辑的产品概念。

**推理与权衡**：自动修改全局 CLI 配置会影响 Kith 之外的终端、引入并发覆盖、schema/版本/企业 managed policy 冲突，并扩大密钥复制面；只靠各 CLI 自有配置又无法提供 Agent/Advisor 可复用、可审计和可迁移的统一体验。Kith-owned 配置加 per-launch compiler 把副作用限制在 Kith 子进程，代价是需要维护四家窄 adapter、在 Codex 等 machine-local 配置受限的 runtime 上使用临时配置根，并在 Space 移机缺少安装级配置时明确进入 `setup_required`。

**安全边界**：普通授权浏览器可管理供应商/模型和选择已有绑定；新增或更换长期密钥额外要求Desktop私有信任，或请求peer、Host与Origin三者全部为loopback且Origin/Host同源（含端口）。本机`localhost:7777`因此可获得与Desktop一致的供应商体验，但跨端口localhost页面与LAN HTTP不承载新密钥。任何已保存密钥的供应商只要backend、API协议、endpoint、network class或allowed egress发生变化，都必须重新输入密钥，禁止旧credential ref静默跟随新的执行身份或目的地。读取本机CLI文件、显示一次性secret与导出诊断仍仅Desktop。聊天 runtime 新增独立 `RuntimeCredentialActivationPort`：Core 只发送强绑定、无密钥 descriptor，Worker 通过Worker-only本机控制通道单次兑换，明文只进入当前Worker内存与child env，并在失败、取消、关闭、超时或lease变化时撤销；不得复用Advisor activation，也不得进入workspace.db、普通控制消息、日志或UI。完整规格见 `docs/superpowers/specs/2026-07-23-model-provider-runtime-memory-settings-design.md`。

**实施事实**：app.db v6与workspace.db v10迁移、稳定对象/不可变revision、三态runtime default、Agent绑定快照、runtime epoch、四家compiler registry、独立聊天activation、Pi RPC v2、脱敏presenter和Settings三页已落地。Pi使用本机0.81.1外部CLI，fixture覆盖strict LF/UTF-8半帧、correlated response、usage、abort、compaction与`agent_settled`；MCP保持unsupported并通过CLI Gateway。CLI导入只读固定用户级文件、拒绝symlink/超限/动态资源，默认从不写回。

---

## 决策 33：快捷安装只管理 Kith-owned runtime 副本

**状态**：Implemented（2026-07-23）。

**结论**：运行器页可以在Desktop trust下快捷安装Claude Code、Codex、OpenCode和Pi，但只允许Kith内置清单中的固定包名与支持版本，并安装到`<appData>/managed-runtimes/<runtimeId>`。Worker下次启动时把Kith-owned bin放到自身PATH前部；Kith不修改系统PATH、不覆盖或卸载系统CLI、不写账号文件和模型全局配置。安装/删除逐runtime串行并使用同父目录staging/隔离目录补偿回滚；删除动作也只能删除Kith-owned目录，且不会清空用户已有的自定义可执行路径。系统PATH另有同名CLI时，下次Worker启动自动回退。

**推理与权衡**：只给安装命令会让普通用户仍需理解npm、PATH和版本兼容；直接全局安装或接管各CLI配置则会影响Kith之外的终端、扩大删除权限并引入供应链与配置冲突。Kith-owned锁版副本把快捷安装的便利限定在可撤销目录内，代价是支持版本升级必须更新清单并验收，且安装/删除后需要重启Worker，不能假装热生效。

**安全边界**：安装与删除只接受Desktop trusted请求，API不接受包名、命令、registry或任意目标路径；普通Web只读取脱敏的安装、版本和账号状态。账号探测只返回`ready / signed_out / unknown`与人类可读摘要，不回传CLI原始输出或凭据。模型配置仍遵循决策32：Kith是事实源，CLI配置只读导入且不写回。

---

## 决策 34：新增前端统一使用 Tailwind CSS v4 与 shadcn/ui

**状态**：Implemented（2026-07-24，基础设施与规则已落地）。

**结论**：React UI 的新增样式统一使用 Tailwind CSS v4 原子类，基础交互组件优先使用 shadcn/ui。组件从 `@/components/ui/*` 导入，条件类名统一通过 `@/lib/utils` 的 `cn()` 合并，颜色优先使用 shadcn 语义 Token。除 Tailwind/shadcn 主题基础层和无法枚举的运行时几何值外，不新增全局 CSS、局部 CSS、CSS Modules 或内联样式。

**迁移边界**：当前已验收界面仍有大量 `styles.css` 与 feature CSS，不能为技术栈切换做一次性重写。新增组件遵循新基线；结构性修改已有组件时，在范围可控的前提下迁移被触达组件；纯缺陷修复允许外科式维护存量 CSS。迁移不得改变已有信息架构、视觉验收结果、可访问性或业务行为。

**推理与权衡**：Tailwind 把新增样式约束收口到组件附近，shadcn/ui 提供可维护、可审查且保留源码所有权的基础组件，能减少重复弹窗、菜单、表单和状态逻辑。代价是迁移期存在两套样式表达；通过“新增强制、存量渐进”和语义 Token 隔离控制复杂度，而不是扩大改动面换取名义上的统一。

**实施事实**：共享 UI 使用 React 19.2.8 + TypeScript + Vite 5；React 19 升级保持 `createRoot`/StrictMode 和现有 SPA 架构，不捆绑 Router/Vite 大版本或新 API 重构。Vite 已接入 `@tailwindcss/vite`；`web/components.json` 使用 Radix/Nova、Lucide 与 CSS variables；`@/*` 映射到 `web/src/*`；`web/src/lib/utils.ts` 提供 `cn()`。`web/src/styles.css` 是唯一 Tailwind/shadcn 主题入口；迁移期只导入 Tailwind theme/utilities、不启用全局 Preflight，基础边框/焦点规则只作用于 `data-slot` 组件，并将 shadcn 的 `muted` 底层变量与存量 `--muted` 文本色隔离。2026-07-25 后全局无衬线字体栈改为内置 Sora Variable 覆盖英文、数字和拉丁标点，中文回退到系统 `PingFang SC` / `Microsoft YaHei`，代码与路径保留系统等宽字体。首批迁移已覆盖通用搜索、Space 新建菜单、Space 卡片按钮/右键菜单、Space 重命名和频道删除确认；使用 Input Group、Dropdown Menu、Context Menu、Dialog、Alert Dialog、Field、Input 与 Button 替换自建交互，同时删除对应旧 CSS、portal、全局监听和坐标状态。搜索框保留参考图视觉，聚焦时不出现黑框；Radix 独立进入 `ui-vendor` 构建分块。

---

## 决策 35：全局字体设置采用三个安装级作用域和内置白名单

**状态**：Implemented（2026-07-25）。

**结论**：Settings 新增“外观”分区，字体只分为三个用户可理解且职责稳定的作用域：界面、消息与文档、代码。默认组合保持当前视觉：界面使用 Sora Variable 并对中文回退系统字体，消息与文档跟随界面，代码使用系统等宽字体。界面字体按无衬线与等宽分组，可选 System UI、Sora、Inter、Geist、System Monospace、JetBrains Mono、Fira Code、Geist Mono；消息与文档提供跟随界面及四种无衬线字体；代码提供四种等宽字体。除系统栈外的候选全部随应用打包，不依赖网络。

**持久化与运行边界**：设置属于安装而非 Space。app.db v7 初始把三个受 CHECK 约束的稳定 ID 写入 `installation_state`，v8 将其迁入职责更窄的 `appearance_settings` 单例，并把界面字体白名单扩展为无衬线与等宽两组；v9 再在同一单例增加受 CHECK 约束的 `12–16px` UI字号。独立 `AppearanceSettingsService` 承担请求字段和白名单校验，gate-1 Human API 负责读取与部分更新；前端只把已验证值映射到根节点语义字体与字号 Token。消息与文档作用域覆盖聊天 Markdown 和 Workspace Markdown，代码作用域继续通过统一 `--mono` Token 覆盖代码块、行内代码、路径和技术标识。选择即时应用；保存失败回滚；刷新或重启后重新从 app.db 恢复。Web 开发代理保留浏览器可见 Host，以满足 Core 的 Origin/CSRF 与 WebSocket 同源门禁，不通过放宽服务端策略解决代理差异。

**推理与权衡**：只提供一个“界面字体”无法让重阅读内容和代码保持各自可读性；按标题、正文、数字、路径等继续细分会让设置和 CSS 依赖迅速膨胀，且用户难以预测影响范围。三个作用域是最小稳定边界。第一版不接受任意本机字体名或上传字体，因为 Desktop 与可选浏览器入口的字体可用性不同，任意字符串也会使持久设置不可复现；未来若支持自定义字体，必须另行设计文件导入、许可证提示、校验、存储和跨入口降级。

**实施事实**：当前迁移位于 `src/app-data/appDatabaseMigrations.ts`；领域校验位于 `src/appearance-settings/appearanceSettingsService.ts`；Human API 位于 `src/server/routes-api/appearanceSettings.ts:11`；页面位于 `web/src/views/appearance-settings/AppearanceSettings.tsx`；运行时字体与字号映射位于 `web/src/appearanceFonts.ts`。

## 决策 36：统一 UI 与消息正文的可调字号及字重

**结论**：默认 UI 与消息正文均为14px，页面标题和其他标题为16px，非消息 UI 一律采用400常规字重；聊天 Markdown 的标题与粗体为600。Human 可在“外观”中以12、13、14、15、16px同步调整 UI 与消息正文，标题始终为当前正文 `+2px`；时间、状态、路径、数量和说明等辅助信息使用 `max(12px, 正文字号 - 2px)`。

**推理与权衡**：此前存量样式通过大量局部字号和粗体表达层级，造成相近界面视觉密度不一致。以一个安装级字号作为唯一可调尺度，保留标题的固定相对差、辅助信息的受下限保护相对差和消息 Markdown 的语义强调，既能满足阅读偏好，也不把导航、正文、日期、代码等拆成难以预测的多项设置。消息以外用位置、颜色、留白和更轻的辅助字号表达层级，避免粗体竞争注意力。

**实施事实**：`appearance_settings.ui_font_size` 由 app.db v9 迁移、领域服务和 Human API 校验；`web/src/styles.css` 使用 `--font-size-base`、`--font-size-title` 和 `--font-size-meta` 根节点 Token 统一 UI 与 Markdown，并只在 `.md` 作用域恢复600强调。

---

## 决策 36：当前发行保持 Windows-first，共享工程按 Windows/macOS/Linux 三端设计

**状态**：Accepted（2026-07-25；工程规则已生效，三端发行与完整门禁尚未完成）。

**结论**：当前正式产品发行范围仍是 Windows x64 v1，macOS/Linux 继续属于 planned；但所有新增或修改的共享代码必须同时评估 Windows、macOS、Linux。路径、文件权限、进程树、shell/可执行文件、临时文件、native ABI、Electron 集成和测试不能默认继承当前开发宿主的语义。平台差异必须位于窄 Interface 后的 Adapter；领域、数据和共享 UI 不散落平台命令或假设。

**推理与权衡**：等到开始 macOS/Linux 打包时再补兼容，会让 Windows-only 假设持续进入共享模块，最终形成高成本回填；现在立即宣称三端已支持又与真实发行、CI 和实机证据冲突。因此采用“发行范围与工程基线分离”：产品状态诚实保持 Windows-first，新增工程决策从现在起不继续制造跨平台债，并用活审计清单记录尚未完成的部分。

**验证边界**：平台无关行为先由共享契约测试覆盖；涉及宿主语义的改动再由 Windows/macOS/Linux runner 或真实 smoke 覆盖。条件 `skip` 只代表透明缺口，不算目标平台通过。某平台暂未验证时必须在能力探测、UI/错误、PR 验证说明和 `docs/cross-platform-compatibility.md` 中显式记录，不得静默降级。当前审计已确认三端 CI、Windows 进程树/测试门禁、macOS/Linux packaging 与 platform integration 等缺口，处理顺序以该文档为准。

---

## 被推翻/修正的决策

这一节专门记录会话中演化过的决策。保留它们，是因为"为什么没走另一条路"往往比结论本身更能帮未来的读者理解项目的形状。

### 一、底座：OpenLoaf → open-tag（推翻）

底座曾一度锁定 **OpenLoaf**——它是 local-first 的 AI 生产力 OS（画布、跨会话记忆、自建 ToolLoopAgent runtime、原生邮箱/日历/任务模块），界面质感和完整度都很吸引用户。

推翻的原因是许可证。用户明确要 MIT/Apache 宽松协议、不走闭源商业化，而 **OpenLoaf 是 AGPLv3**——传染性 copyleft，不可重新授权，与项目的宽松许可立场根本冲突。于是底座改为 **open-tag（Apache-2.0）**，OpenLoaf 降级为纯设计参考：借它的模块概念和界面质感，用自己的代码重新实现，绝不拷贝源码。

这次推翻的连锁影响很大——它直接触发了下面 runtime 决策的改变，也定下了此后"凡涉及协议的选型都必须干净可自由采用"的原则。

### 二、runtime：复用 OpenLoaf 现成 runtime → 全外接、不自研（随底座改变）

在底座还是 OpenLoaf 时，runtime 的矛盾（用户既要"不从零造 runtime"、又要"原生丝滑操作"）曾用一个折中化解：**复用 OpenLoaf 现成的 ToolLoopAgent runtime**——既没从零造，又能拿到 in-app runtime 的丝滑。

底座推翻后这个折中不成立了（不能拷 AGPLv3 代码）。于是 runtime 决策重定为**全外接、不自研**（决策 2）：所有 agent 接本机已有 runtime，自建模块以 MCP 工具暴露。"原生丝滑"改由 MCP 层 + UI 桥达成，并明确接受略低的丝滑天花板。这条演化说明：底座这类地基决策一变，上层的技术取舍要跟着重算。

### 三、Redis 用途：三件事 → 只有两个计数器在跑（修正）

Redis 一度被描述为"做三件事"：全局 seq 计数器、SSE pub/sub、agent 唤醒 long-poll（这也是 `redis.ts` 顶部注释的声明，`redis.ts:1`）。据此，迁移到 SQLite 被认为要替代三套机制。

写文档时的更深源码核实**修正**了这个判断：运行时真正依赖 Redis 的**只剩两个 INCR 计数器**（`nextSeq` `redis.ts:50` + `nextTaskNumber` `redis.ts:65`）。pub/sub 与 wake 是死代码——人类端实时早已由 socket.io 单实例直发承担（`realtime.ts:9`），agent 唤醒早已走 daemon WS 定向下发，`publishEvent`（`redis.ts:70`）和 `pokeAgent`（`redis.ts:75`）零调用点。所以迁移比初判小得多：把两个计数器搬进程内、整体删掉 `redis.ts`，`realtime.ts` 几乎不动。这条修正提醒：顶部注释可能滞后于代码实际，判断迁移成本要看真实调用点。

### 四、聊天历史随文件夹走：大改 → 中等有界（修正）

"让聊天历史随工作区文件夹走"一度被判为**大改**——但那个判断成立于 Postgres 语境：消息都在一个中心 PG 库里，要拆到文件夹意味着改存储模型。

SQLite 决策（决策 18）落定后这个成本被**修正**：SQLite 本身就是文件，把整个工作区的库做成 `<folder>/.kith/workspace.db` 即可，不改存储格式。于是"随文件夹走"从大改降为**中等、有界**的改动（每工作区一个 db 文件，趁 P0 数据迁移一起做）。这条修正是决策 18 和决策 19 联动的结果——一个地基决策（换 SQLite）顺带把另一条决策（可移植工作区）的成本大幅拉低。

### 五、per-agent cwd 隔离 -> Space root 共享 cwd（修正）

open-tag 的每 agent 私有 cwd 曾被沿用为默认工作空间，并在权限决策中被描述成一层目录隔离。A1-A6 实际验收证明它会把用户业务文件生成进隐藏 app data，并让 Agent Memory 脱离所属 Space；同时 cwd 从来不能阻止高权限 runtime 访问绝对路径，因此不是安全边界。

决策 23 修正为同一 Space 的 agent 共享 Space root cwd。隔离职责拆开：Agent Memory 以 `<space>/.kith/agents/<id>` 区分，runtime 临时状态以 app data 下的 `<spaceId>/<agentId>` 区分，真正的风险控制仍由工具审批、runtime 权限与未来沙箱承担。

---

## 尚未决定 / 刻意留白

以下几项要么已定、要么被有意推后，记录在此以免将来误以为遗漏。

- **项目名**：已定 **Kith-space**。Kith = 你信任的一圈熟人（对应 agent 作为有身份/记忆的团队成员这一核心），-space = 人与 agent 共处的空间 + 开发者对 namespace/workspace 的语感。可用性已核查：npm 无 `kith-space` 包（registry 返回 404）、GitHub 无同名项目，仅存在拼写近似的 `kitspace`（无 h，电子元件分享站）需留意混淆风险。
- **Dock 具体图标集**：Home/普通 Space 的模块结构已定（决策 14/23），但具体图标集属便宜改、UI 收尾项，暂不锁定。
- **起步角色模板内容**：模板的机制已定（空白职责 + 少量可选起点，决策 10），但模板具体写什么内容留待后填，随时可微调。
- **HTTPS 与 runtime 权限升级细节**：v1 的 LAN 浏览器入口只做 HTTP + 访问 Token，并明确限于受信任私网。HTTPS 和更细权限是邮箱、浏览器等高风险模块上线前的硬前置，具体实现将在对应阶段单独设计。

---

*本文档记录设计会话的决策与推理，是"为什么这样定"的档案。落地步骤见 `docs/kith-space/migration-plan.md`，功能验收见 `docs/kith-space/mvp-spec.md`。*
