# Kith-space 决策档案

## 前言

这份文档记录 Kith-space 的锁定决策。第一轮 `/grill-me` 会话发生在 2026-07-09，形成最初 19 条决策；随后包管理迁移形成决策 20。第二轮 `/grill-me` 发生在 2026-07-11，在 40 个问题内把产品正式收敛为本机、单 Human 的个人 AgentOS，并形成决策 21，推翻原先“多用户/多机器能力休眠保留”的路线。2026-07-12 的 A1-A6 用户验收进一步确认 Agent 首轮生命周期（决策 22）以及 Home 总控 Space、用户可见 Space 根目录和跨 Space 委派边界（决策 23）。当前结论以每条决策中的最新修正和决策 21-23 为准。

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
| 14 | Dock 与模块 | Home 增加 Spaces；普通 Space 保持 `Chat | Inbox | Tasks | Agents | Settings` |
| 15 | 布局能力 | ChatOnly / Split / ModuleOnly 三态，可拖拽分隔 |
| 16 | 跨 Space 视角 | 不恢复薄总览壳；Home Spaces 先落真实目录，聚合能力渐进实现 |
| 17 | 宿主形态 | Desktop 是唯一正式宿主，可选本机/LAN 浏览器入口 |
| 18 | 数据层 | 迁移到 SQLite + 进程内替代 Redis |
| 19 | 工作区 | 根植用户文件夹、共享 Space cwd、每 Space 独立 db 和记忆 |
| 20 | 包管理 | 仓库统一从 npm 迁移到 pnpm |
| 21 | 个人 AgentOS 本机化 | 删除服务器部署、多真人、多机器、账户体系和云端路线 |
| 22 | Agent 首轮 | 创建问候、空启动静默、真实投递按原目标回复 |
| 23 | Home 与 Space 根目录 | Home 是总控 Space；app data、Space 数据和 runtime 状态分离 |

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

**已核实源码事实**：agent→agent 分派天然成立，靠纯唤醒判据 `isWakeable`（`agentWakePolicy.ts:10`）——被 @ 的成员无条件唤醒且不看发送者身份（`agentWakePolicy.ts:12`），所以 agent A @agent B 就能唤醒 B。但两条约束塑造协作闭环形状：被 @ 的 agent 须已是频道成员（agent 发文不能自动拉人，`canAutoJoinMentionedMembers` 仅对 `senderType==="user"` 为真，`agentWakePolicy.ts:3`）；agent 的普通发言不唤醒其他 agent（`agentWakePolicy.ts:13`，防自激循环），所以汇报须 @ 回 leader。DM 是例外，无条件唤醒（`agentWakePolicy.ts:11`）。三护栏都落在 server 唤醒环这一收口处（`server/core.ts:412`–`:436` 与 `assignTask` `server/core.ts:686`），不改 runtime/daemon 协议。schema 已有 `executionMode`（`db/schema.ts:74`，默认 `"auto"`）可作开关持久化字段。急停复用 `stopAgent`（`server/core.ts:896`）。

---

## 决策 8：工具权限两轴——模块工具按风险分级，外接 runtime 沿用 bypass 并记账为债

**当前结论（2026-07-12 修正）**：权限分两条轴。(a) 自建模块工具按风险分级：可逆/本地操作自动放行（v1 记忆/任务基本全自动），不可逆/外部操作（发邮件、删除、日历邀约）需审批。(b) 外接 runtime 的原生文件/shell 全权：v1 沿用 open-tag 现状（bypassPermissions），这是**明确记账的技术债**。同一 Space 的 agent 以后都以 Space 根目录为 cwd；cwd 只提供默认文件上下文，不是安全沙箱或 per-agent 隔离。

**背景**：agent 既调用我们的模块工具，也拥有 runtime 赋予的本机文件/shell 能力。这两类权限性质完全不同，要分开处理。

**选项与选择**：模块工具——全放行 / 全审批 / 按风险分级（选中）。runtime 权限——v1 就上审批路由/沙箱 / 沿用现状记为债（选中后者）。

**推理与权衡**：模块工具按风险分级是常识取舍：可逆的自动放行保丝滑，不可逆的要审批防误伤（这些不可逆操作 v1 多在范围外，规则先锁定）。runtime 全权是更重的取舍——当前接受 bypassPermissions 是因为单机 + 单 Human + 仅本机可信内容的前提下风险可控，且能保住外接 runtime 的操作丝滑。但代价被明确记账：**升级的硬触发点是邮箱/浏览器等“摄入不可信外部内容”的模块上线之前**，届时必须先用审批路由或沙箱切断“prompt 注入到破坏性 shell”的攻击链。LAN 浏览器入口已由决策 17/21 限定为显式启用的受信任私网 HTTP + Token，它不能替代该 runtime 权限升级。

**已核实源码事实与目标差距**：open-tag 以 `--dangerously-skip-permissions --permission-mode bypassPermissions` 启动 Claude Code，即对本机不受限访问。Kith-space 当前仍把 `<KITH_SPACE_HOME>/agents/<id>` 作为 cwd，但它从来不能阻止 runtime 用绝对路径访问其他文件；把它称为隔离会产生错误安全感。决策 23 要求改为 Space root cwd，并把真正的 Agent Memory、runtime state 与安全审批边界分别建模。工具能力裁剪仍不能限制任意文件/shell。

---

## 决策 9：记忆是三层文件式，读用原生文件工具，写工具延后

**当前结论（2026-07-12 路径补充）**：记忆分三层（用户级 / 空间级 / agent 级）。读 = runtime 原生文件工具（不做读 MCP）；结构 = OpenLoaf 式"一事一文件 + 自动维护 MEMORY.md 索引"约定，写进 system prompt 强制执行（不是工具）；写 MCP 工具延后。用户层位于 app data，Space 层位于 `<space>/.kith/memory/`，Agent 层位于 `<space>/.kith/agents/<agentId>/`，随所属 Space 搬迁。空间层 agent 可写、用户策展。

**背景**：agent 要从一次性问答工具变成有记忆的团队成员，需要一套记忆系统。OpenLoaf 有跨会话记忆设计可参考，openagents 没有真正的记忆系统。

**选项与选择**：从零造记忆模块 / 复用 open-tag 现成文件记忆（选中）。空间层写权限——只读 / agent 可写用户策展（option B，选中）/ 完全放开。

**推理与权衡**：三层是从 OpenLoaf 设计重构而来。关键取舍是**不把记忆做成 v1 的从零模块**——open-tag 已有一套 per-agent 文件记忆，直接复用，只在其上加两个目录层级（用户级/空间级）+ 在 system prompt 补两段索引约定。读用原生文件工具而非 MCP，是因为读操作 runtime 天然会做，包成 MCP 反而多一层。写工具延后，是先看 agent 用原生文件写会不会乱——若乱再提升为 `memory_save` 之类 MCP 工具（最小必要，不预先造）。空间层"agent 可写、用户策展"是自主与秩序的折中：agent 能沉淀团队知识，用户保留最终编辑权。结果：**v1 从零造的模块只有任务一个**（呼应决策 6）。

**已核实源码事实与目标差距**：当前 `resolveMemoryLayerPaths` 已把 User Memory 放在 app data、Space Memory 放在 `<space>/.kith/memory/`，但 Agent Memory 仍与旧 per-agent cwd 共用 `<KITH_SPACE_HOME>/agents/<id>`，复制 Space 时不会随行。seed、profile 外科式同步和 prompt 驱动的索引约定继续复用；实现决策 23 时只迁移路径职责，不重造记忆系统。

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

## 决策 14：底部 Dock 是工作姿态与模块切换的统一控制器

**当前结论（2026-07-12 再修正）**：Dock 常驻于当前主要工作面板底部。Home 为 `Chat | Spaces | Inbox | Tasks | Agents | Settings`；普通 Space 为 `Chat | Inbox | Tasks | Agents | Settings`。`Spaces` 是只在 Home 有效的真实 registry 模块，不是全局聚合占位。`Members` 收敛为当前 Space 的 `Agents`，`Computers` 删除，唯一 Human 的资料移入全局 Settings。Search 位于顶部入口。一次只打开一个模块；当前模块从纯图标横向展开并显示名称，Chat 始终只显示图标。模块不拥有独立 pathname，而是在当前频道、DM 或收藏会话路径上使用 `?module=<id>`；合法 resource query 分别为 Tasks 的 `taskScope`、Agents 的 `agent`/`agentTab` 与 Settings 的 `settings`。切换会话保留当前模块及其 resource，切换模块则清除不属于新模块的 resource。

**原决定**：Dock 曾被限定为“窄右栏容器自身的底部导航”，实时轨迹也曾作为右栏模块之一。新方向取消固定窄右栏：模块是可伸缩、可全宽的第二工作面；实时轨迹回到 Chat 工作面的伴随区域，在紧凑态以抽屉出现。

**推理与权衡**：一个稳定 Dock 同时负责打开模块、替换模块和控制 Chat 显隐，用户无需理解“提升模块”“隐藏右栏”等多套动作。Dock 随主工作面转移，既不覆盖 Composer，也不会在 Chat 与模块之间产生两套导航。代价是实时轨迹不再与业务模块平级，但更符合它服务当前会话执行透明度的职责。

---

## 决策 15：布局收敛为 ChatOnly / Split / ModuleOnly 三态

**当前结论（2026-07-11 三次修正）**：工作区只有三种合法状态：ChatOnly、Split、ModuleOnly。Split 默认让 Chat 占可用工作区的 25%、Module 占其余空间，Chat 下限为 `max(360px, 25%)`；完整面板间隙均为可拖拽热区。Split 内切换模块保留拖拽比例，关闭重开模块或从 ModuleOnly 恢复 Chat 时重置为默认比例。不同模块使用 560px / 640px 内容下限，Module 不设固定最大宽度；窗口过窄时临时退化为单 Pane，不压缩出不可用的双栏。

**交互约束**：Split 点击 Chat 进入 ModuleOnly；ModuleOnly 点击 Chat 恢复 Split；点击当前模块关闭模块并回到 ChatOnly；点击其他模块替换内容且保持当前 Chat 可见性。Chat 和 Module 不得同时隐藏。

**原决定**：“模块提升到中心”“右栏隐藏”“左细图标条”是基于旧双壳与固定右栏得出的动作。新状态机用三个直接可见的工作姿态取代这些概念，左细图标条随双壳一起取消。

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

**实施状态（2026-07-12）**：A2-A6 的原定代码切片已落地，但用户验收发现 app data/Space root 仍被 `KITH_SPACE_HOME` 耦合、runtime cwd 仍是旧 per-agent 目录、Agent Memory 未随 Space 搬迁，且 Home 尚无 Spaces 模块。决策 23 的 H1-H4 被列为 A1-A6 验收前置修复；完成前 Runtime 契约 v2 继续暂停。

---

## 决策 22：Agent 首轮按创建、普通启动和真实唤醒分流

**结论（2026-07-12）**：新建 agent 的首个成功 turn 只向唯一 Human 的 `dm:@you` 发送一次简短自我介绍；已有 agent 手动启动、重启或恢复时只检查真实待处理消息，空收件箱必须静默；由频道、DM、任务或 reconnect backlog 触发的 turn 只处理持久化消息并在原目标回复。

**推理与权衡**：一次入职问候能把配置项变成有身份的团队成员，同时验证 runtime、Agent CLI 和 Human-Agent DM 整条链路。但不能用“有人给你发了消息”伪造触发原因，否则不同 runtime 会产生不一致行为：Codex 会严格执行“停止前必须回复”并发送无工作汇报，Claude Code/opencode 则可能静默。显式 `create | manual | wake` 原因让三种 adapter 共享同一产品语义，不依赖模型猜测。Core 为候选 introduction turn 生成一次性 token，只有 Worker 实际选择 introduction prompt 时才把 token 注入该 runtime 进程；CLI 也只有创建提示明确调用 `message send --introduction` 时才附带 token，普通 wake/后续回复不会被旧 token 污染。Human DM 发送在全部异步目标校验后、数据库事务前同步校验并消费 token；已撤销 token 的迟到问候和已完成 token 的重复问候都会被拒绝，普通消息因不携带 token 而不受影响。介绍消息与 `agents.introduced_at` 在同一事务提交，避免把普通回复、runtime online 或 turn 结束误判为 Human 已收到问候，也避免消息已出现但状态未写入后重复问候。

**边界**：问候限制为 2-3 句、只发一次 Human DM，不读取频道历史、不广播、不写记忆。schema v3 会把升级前已有 agent 回填为已介绍；普通 reset 保留介绍状态，完整 wipe 清空它并视为重新入职。真实投递在启动准备期间到达时合并进同一个 wake turn，避免“先问候、再处理通知”的双 turn。

---

## 决策 23：Home 是总控 Space，Space root 是 agent 共享工作目录

**结论（2026-07-12）**：每个安装实例有且只有一个稳定 Home Space。普通冷启动进入 Home Chat；Home 在同一个 WorkspaceFrame 的 Dock 中增加 `Spaces` 模块，用真实 app.db registry 创建、接入、搜索和打开普通 Space。应用内部数据默认位于 `~/.kith-space`，默认用户 Space 容器位于 `~/Kith-space`，Home 位于 `~/Kith-space/Home`；用户可把普通 Space 接入任意本机文件夹。所有属于某 Space 的 agent 都以该 Space root 为 runtime cwd，Agent Memory 位于 `<space>/.kith/agents/<agentId>`，runtime 临时状态位于 app data。

**背景**：A1-A6 验收实例通过 `KITH_SPACE_HOME` 把 Home 落在系统 Temp，并继承 open-tag 的 `<appData>/agents/<id>` cwd。agent 因而把用户要求生成的业务文件写进隐藏验收目录，`<space>/.kith` 也没有包含 Agent Memory。这与“用户选择一个文件夹作为 Space”“复制文件夹即可带走完整 Space”的锁定承诺冲突。与此同时，用户确认 Home 不是可删除的空默认项目，而是个人 AgentOS 的总控空间。

**选项与选择**：继续 per-agent cwd / 使用 Space root 作为共享 cwd（选中）；Home 放 app data / 放用户可见 `~/Kith-space/Home`（选中）；恢复独立总览壳 / 在 Home 单窗口中增加 Spaces 模块（选中）；跨 Space 写操作冒充 Human / 保留真实 Home agent 与 Human 委派审计（选中后者）。

**推理与权衡**：Space root cwd 让 Claude Code、Codex、opencode 的体验等价于用户在目标文件夹启动 CLI，多个 agent 也能对同一项目文件协作。代价是失去本就不可靠的 per-agent cwd 心理隔离，因此安全文档必须明确 cwd 不是沙箱。把 Agent Memory 放回 `.kith` 恢复可移植性，把 prompt 临时文件和 adapter 状态留在 app data 则避免污染用户项目。Home 的 Spaces 模块基于真实 registry，不重犯伪全局 Inbox 的错误；跨 Space task/message/dispatch 通过 Core 领域服务按 targetSpaceId 执行、幂等并审计，不直接写其他 SQLite，也不假装是 Human 亲自发送。

**实施边界**：H1-H4（路径、cwd/记忆、文件夹接入、Home Spaces UI）属于 A1-A6 验收前置修复。跨 Space 写编排 H5 后续渐进实现，先只读真实摘要，再接 task/message/dispatch；没有真实数据前不做占位视图。完整规格见 `docs/superpowers/specs/2026-07-12-home-space-and-space-root-design.md`。

**已核实源码差距**：`src/desktop/managedChildEnv.ts` 始终向受管子进程注入 `KITH_SPACE_HOME`，而 `src/paths.ts` 在该变量存在时把默认 Space 放进 `<appData>/workspaces`；`src/daemon/agentManager.ts` 仍把 `<appData>/agents/<id>` 同时作为 cwd 和 Agent Memory；前端 `SpaceSwitcher` 创建请求尚不提交 rootPath。上述均是待实现差距，不是当前能力。

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
