# Agent 频道响应模式设计

> 状态：2026-07-14 已定稿，尚未实现。本文锁定产品语义、数据边界、运行时策略、界面和验收标准；当前代码仍按既有频道成员唤醒规则运行。

## 1. 决策摘要

Kith-space 为 Agent 增加两层响应模式：

1. **Agent 默认响应模式**：属于当前 Space 中的 Agent 配置。
2. **频道响应模式覆盖**：属于该 Agent 在某个顶层频道中的成员关系。

有效值固定为：

```text
effectiveMode = channelMember.responseModeOverride ?? agent.defaultResponseMode
```

用户界面显示三档：

- **主动模式**（`active`）：Human 在频道中的普通消息可以唤醒 Agent，由 Agent 判断是否值得回复。
- **被动模式**（`mention_only`）：频道普通消息不唤醒；被明确 `@` 或已参与话题后收到 Human 跟进时才唤醒。
- **静音模式**（`silent`）：不因频道消息、频道 `@` 或话题跟进自动唤醒，只保留阅读和手动发送能力。

“跟随 Agent 默认”只是频道覆盖为空时的继承状态，持久化为 `NULL`，不是第四种模式。已有和新建 Agent 的默认值均为 `active`。

这套模式只控制**频道中的自动唤醒与回复要求**：

- Human-Agent 私聊始终直达目标 Agent，不受响应模式限制。
- 明确指派给 Agent 的任务始终直达受派 Agent，不受响应模式限制。
- 话题不增加第三层设置，继承父频道的有效模式。
- 响应模式不是读写权限，也不改变 Agent membership。

## 2. 目标与非目标

### 2.1 目标

- 让 Human 能控制每个 Agent 在不同频道中的主动程度，减少无关回复和无效 runtime 唤醒。
- 保留“频道里像团队成员一样自然协作”的体验，不要求每条消息都逐个 `@`。
- 让主动模式真正做到“看见后自行判断”，而不是每次唤醒都被提示词强制回复。
- 让实时消息、断线补偿、Agent 收件箱检查和任务指派使用同一套策略。
- 把策略收口到独立领域模块，避免继续把条件分散堆入 `core.ts`、prompt 和大型 React 页面。

### 2.2 非目标

- 不为私聊增加响应模式。
- 不为话题增加独立覆盖层或独立设置 UI。
- 不把静音实现成禁止 Agent 发消息、读消息或领取任务的权限。
- 不重做完整 Runtime 契约 v2，也不引入通用规则引擎。
- 不在第一版把同一设置复制到频道设置的成员页；频道内昵称后的入口是唯一频道覆盖编辑器。
- 不改变现有频道归档、删除、成员、派发深度、唤醒预算和急停护栏。

## 3. 领域语义

### 3.1 模式与响应指令

服务端策略除了决定是否唤醒，还必须给 runtime 一个明确的响应指令：

| 指令 | 含义 |
|---|---|
| `required` | 必须处理，并在原目标给出回复或状态反馈 |
| `optional` | 必须读取和判断；没有有价值内容时可以静默结束 |
| `observe` | 可作为上下文读取，但不能仅因此消息产生回复或补唤醒 |

响应模式与响应指令不是同一个维度。模式是持久设置；指令由每次事件的发送者、消息类型、是否 `@`、是否已参与话题和是否为明确任务指派共同计算。

### 3.2 唤醒矩阵

| 事件 | 主动模式 | 被动模式 | 静音模式 |
|---|---|---|---|
| Human 在顶层频道发送普通消息 | 唤醒，`optional` | 不唤醒，`observe` | 不唤醒，`observe` |
| Human 或 Agent 在普通消息中明确 `@Agent` | 唤醒，`required` | 唤醒，`required` | 不自动唤醒，`observe` |
| Agent 在频道发送普通消息、未 `@` | 不做环境唤醒 | 不做环境唤醒 | 不做环境唤醒 |
| Human 在 Agent 已参与的话题中继续回复 | 唤醒，`optional` | 唤醒，`optional` | 不唤醒，`observe` |
| Human-Agent 私聊 | 始终唤醒，`required` | 始终唤醒，`required` | 始终唤醒，`required` |
| 明确指派给 Agent 的任务 | 始终唤醒，`required` | 始终唤醒，`required` | 始终唤醒，`required` |
| 未指派的频道任务 | 唤醒，`optional` | 不唤醒，`observe` | 不唤醒，`observe` |

Agent 普通消息不做全频道环境唤醒，用于阻止 Agent 之间互相触发循环。Agent 明确 `@` 另一个 Agent 时仍可唤醒主动或被动模式的目标，但必须继续经过现有派发深度、唤醒预算、急停、成员和频道生命周期 guard。

同一事件命中多条规则时按以下顺序解释，避免“话题跟进同时包含 @”之类的重叠：频道生命周期/Space/membership/编排 guard → 明确任务指派 → Human-Agent DM → 明确 mention → 已参与话题的 Human 跟进 → 顶层频道环境消息。明确任务指派与 DM 绕过响应模式；mention 和话题跟进仍按三档模式判断。

### 3.3 频道成员关系与模式正交

Agent membership 继续决定：

- Agent 是否属于该频道；
- Agent 是否可以读取该频道；
- 频道上下文是否可进入 Agent 的收件箱。

响应模式只决定某条可见事件是否足以自动启动 runtime，以及本轮是必须回复还是可以静默。静音不会把 Agent 移出频道，也不会在服务端禁止 Agent 主动发言。

归档或删除频道仍由频道生命周期 guard 提前排除，不存在任何模式下的自动唤醒。归档详情可以显示当前有效模式作为只读信息，但不能修改覆盖值。

## 4. 频道、私聊与话题边界

### 4.1 顶层频道

响应模式覆盖只挂在顶层频道的 `channel_agent_members` 上。`# all` 与普通频道使用同一规则；`# all` 的必需频道属性不意味着所有 Agent 都必须主动响应。

### 4.2 私聊

Human-Agent DM 是明确寻址，不显示模式徽标，不读取频道覆盖，也不受 Agent 默认模式限制。Human 发出的 DM 始终唤醒目标 Agent 并要求回复。

### 4.3 话题

话题继承父频道中该 Agent 的有效模式，不持久化自己的覆盖值，也不提供设置入口。

话题参与者按事件逐步形成，不能把父频道全部 Agent 自动加入：

- Agent 是话题内消息的作者；
- Agent 在话题中被明确 `@`；
- Agent 已经在该话题中回复过。

Agent 成为参与者后，Human 在该话题中的后续回复可以唤醒主动或被动模式的 Agent，无需重复 `@`；静音模式仍不自动唤醒。Agent 在话题中的普通回复不环境唤醒其他 Agent，明确 `@` 时才按矩阵处理。

如果某个任务话题的受派 Agent 不属于父频道，明确任务指派服务必须先为它建立该任务话题的受限 membership，再直达该 Agent；这不自动把它加入父频道，也不创建频道覆盖。话题中的后续参与按其 Agent 默认模式解释。

## 5. “作为任务”的确定语义

Composer 的“作为任务”不只是给消息增加外观；它必须创建真实任务并形成确定的 assignee 语义。

### 5.1 恰好一个 `@Agent`

当 Human 选择“作为任务”，且正文中恰好包含一个可在当前会话中寻址的唯一 Agent 目标：

- 创建频道任务；
- 将该 Agent 写入任务 assignee；
- 确保该 Agent 是任务话题成员，使其只获得完成任务所需的会话访问；
- 将这次事件视为**明确任务指派**；
- 受派 Agent 无论处于主动、被动还是静音模式都立即唤醒，响应指令为 `required`；
- 其他未被指派的频道成员不能仅因这是一条定向任务而被环境唤醒。

当前实现只把 `@` 记录为 mention，并不会据此写入任务 assignee；实现本规格时必须同时修正任务数据与唤醒语义，不能只绕过响应模式。

### 5.2 没有 `@Agent`

当 Human 选择“作为任务”但没有 `@Agent`：

- 创建未指派的频道任务；
- 主动模式成员可以被唤醒并自行判断是否领取，响应指令为 `optional`；
- 被动和静音成员不自动唤醒；
- 任务持续显示在 Tasks 中，后续可以由 Human 或现有编排能力明确指派；
- 后续明确指派会立即唤醒受派 Agent，不受响应模式限制。

### 5.3 多个 `@Agent`

当前任务模型只有一个 assignee。第一版在“作为任务”正文中出现多个 Agent mention 时必须在提交前给出明确校验错误，不能静默选择第一个、创建多份任务或假装支持多人指派。普通非任务消息仍允许多个 mention，并按每个目标的有效模式处理。

## 6. 设置与界面

### 6.1 Agent 设置页

在 Agent 详情的 Profile 页中，基本信息之后、Skills 之前增加独立的“响应模式”卡片，不继续把逻辑堆入大型 `AgentProfile`：

- 标题：`响应模式`；
- 说明：`当前 Space 中该 Agent 的默认值。各频道可在成员消息旁覆盖。`；
- 三段式控件：`主动模式 / 被动模式 / 静音模式`；
- 下方补充：`私聊和明确指派的任务不受此设置限制。`；
- 选择后即时保存，保存失败回滚到服务端值并显示就地错误；
- 不使用“全局默认”，因为 Agent 归属于当前 Space。

### 6.2 频道消息中的模式徽标

在顶层频道和其话题中，每条当前成员 Agent 消息的昵称后显示紧凑模式徽标：

- 徽标显示**当前有效模式**，不是发送消息时的历史快照；
- 只显示在 Agent 作者后，不显示在 Human、系统消息、Human-Agent DM 或已移除 Agent 后；
- 视觉上与在线状态分开，不能让用户误认为运行中/离线状态；
- 归档频道可显示只读徽标，但不能打开可编辑菜单。

### 6.3 Hover / click 菜单

可编辑徽标在约 250ms hover 后打开，同时支持点击、键盘聚焦和触屏点击；浮层必须有安全 hover corridor、`Escape` 关闭、焦点返回和 viewport-aware 定位。

菜单结构固定为：

1. 标题“响应方式”，说明“决定该 Agent 在本频道如何回应消息”。
2. `跟随 Agent 默认（当前为：主动模式）`，选中时把覆盖写为 `NULL`。
3. 分隔后的频道覆盖：`主动模式 / 被动模式 / 静音模式`。
4. 简短说明与“在 Agent 资料中修改默认值”的入口。

选择同一值是幂等操作。显式覆盖可以恰好等于当前默认值，仍保留“已覆盖”来源；只有选择“跟随 Agent 默认”才删除覆盖。默认值变化后，继承成员的徽标随之变化，显式覆盖成员保持不变。

### 6.4 数据装载

频道消息列表不得为每条消息单独请求响应模式。进入频道时一次取得成员的默认值、覆盖值和有效值，复用到所有消息作者；收到窄实时事件后更新或失效重取。Agent 默认值在其他窗口修改后，所有显示该 Agent 且处于继承状态的已打开频道都必须收敛到新值。

第一版不在 `ChannelMemberSettings` 再放一套编辑器，避免两个入口的状态、说明和交互漂移。

## 7. 数据模型与迁移

当前 workspace.db 是 schema v4。实现本规格时升级为 v5，仍保持 19 张产品表，只增加字段：

```text
agents.default_response_mode
  TEXT NOT NULL DEFAULT 'active'

channel_agent_members.response_mode_override
  TEXT NULL

channel_agent_members.ambient_wake_after_seq
  INTEGER NOT NULL DEFAULT 0

channel_agent_members.mention_wake_after_seq
  INTEGER NOT NULL DEFAULT 0
```

字段值必须由应用层和迁移约束收敛到 `active | mention_only | silent`。v4 升级时：

- 所有已有 Agent 的默认值回填为 `active`；
- 所有已有频道成员覆盖值为 `NULL`；
- 已有 membership 的两类 wake watermark 初始化为 `0`，继续由现有 `last_read_seq` 保留当前待处理边界，不丢弃迁移前真实未处理消息；
- 不新增表，不重写现有 membership 或 Human channel state。

`last_read_seq` 继续只表达 Agent 的读取进度，不能复用为模式切换时间点；否则切换模式会把未读消息错误标成已读。

新 membership 的两类 watermark 与现有加入边界一致：人工加入使用当前频道最大 seq，避免把入群前历史补唤醒；Human mention 自动加入使用触发消息 seq - 1，让当前 mention 保持可处理。任务明确指派给 thread-only Agent 时以指派时的当前 seq 初始化话题 membership，但该次任务本身通过明确指派路径直达。

## 8. 非追溯切换与 wake watermark

模式修改只影响保存成功后的新事件：

- 不补唤醒历史消息；
- 不取消已经投递给 runtime 的当前 turn；
- 不改变消息是否已读；
- reconnect backlog 必须遵守修改后的边界。

为区分两类唤醒资格，成员关系保留两个独立 watermark：

- `ambient_wake_after_seq`：顶层 Human 普通消息、未指派频道任务等主动模式环境唤醒；
- `mention_wake_after_seq`：明确频道 mention 与已参与话题的 Human 跟进。

当一次默认值或覆盖值变更使某类投递从“禁用”变为“启用”时，把对应 watermark 设为当前 Space 最大 seq；只有 `message.seq > watermark` 的事件才可触发该类新唤醒。禁用某类投递时不回写 read cursor；再次启用时重新推进对应 watermark。

两类 watermark 的必要性：

- 主动 → 被动只关闭环境唤醒，但 mention / 已参与话题仍可用；
- 静音 → 被动只重新开放 mention / 已参与话题，不应把历史普通消息补唤醒；
- 被动 → 主动重新开放环境唤醒，也不应回放切换前的频道消息。

Agent 默认值变更时，设置服务只处理实际继承该默认值且有效模式发生变化的频道成员；显式覆盖成员不推进 watermark。

`channel_agent_members` 同时承载顶层频道和话题参与关系，因此只有顶层频道行允许写 `response_mode_override`；话题行始终继承父频道有效值（没有父频道 membership 时继承 Agent 默认）。顶层覆盖或 Agent 默认变化使话题的 mention/跟进资格从禁用变为启用时，设置服务必须同步推进该 Agent 对应话题 membership 的 `mention_wake_after_seq`，避免 Worker 重连后回放切换前的话题回复。

## 9. 服务端模块边界

### 9.1 纯策略模块

新增 `src/agents/agentResponsePolicy.ts`，只负责从规范输入计算结果，不访问数据库、不发送 WS、不拼 prompt：

```ts
type ResponseDirective = "required" | "optional" | "observe"

type AgentResponseDecision = {
  wake: boolean
  directive: ResponseDirective
  reason: string
}
```

输入至少包括频道类型、发送者类型、有效模式、是否明确 mention、是否明确任务指派、是否为未指派任务、是否为已参与话题的 Human 跟进。频道生命周期、membership、派发深度、预算与急停仍是外围 guard，不塞入通用规则引擎。

### 9.2 设置与解析模块

新增 `src/agents/agentResponseSettings.ts`，集中承担：

- 枚举校验；
- 读取 Agent 默认值和频道覆盖；
- 计算有效模式与来源；
- 在事务中更新设置和两类 watermark；
- 为 Agent 默认值变更找出受影响的继承成员；
- 生成 API 和实时事件需要的稳定 DTO。

路由、`core.ts` 和 reconnect 逻辑只调用该模块，不各自直接写响应模式字段。

### 9.3 唤醒收口

以下路径必须消费同一个 `AgentResponseDecision`：

- Human/Agent 新消息持久化后的实时 wake loop；
- Worker reconnect backlog；
- Agent 的 `/agent-api/message/check` 增量检查；
- runtime prompt / inbox notice；
- Human Composer 和 Agent 工具产生的任务指派。

当前 `core.ts` 会在 Human 频道消息后唤醒可达的频道 Agent，`agentWakePolicy.ts` 把 mention/DM 视为可唤醒，`WAKE_NUDGE` 又要求每个目标都回复。实现时必须用新策略替代这些互相分散的判断，不能只在前端隐藏徽标或只修改一个实时路径。

## 10. API 与实时同步

### 10.1 Agent 默认值

- `GET /api/agents/:id` 增加 `defaultResponseMode`。
- 现有 Human `PATCH /api/agents/:id` 接受严格校验的 `defaultResponseMode`。
- Agent 自身 profile 接口不允许修改该 Human 管理设置。

### 10.2 频道覆盖

- `GET /api/channels/:channelId/members` 为 Agent 成员增加：
  - `defaultResponseMode`；
  - `responseModeOverride`；
  - `effectiveResponseMode`；
  - `responseModeSource: "agent_default" | "channel_override"`。
- `PATCH /api/channels/:channelId/members/:agentId` 接受：

```json
{ "responseModeOverride": null }
```

或三种合法枚举值之一。

非成员或其他 Space 的 Agent 返回 404；归档频道返回稳定的 409 lifecycle error；DM 或话题 ID 返回 400 `response_mode_not_applicable`，要求编辑其顶层父频道；无效枚举返回 400。只有唯一 Human 的 Desktop 私有信任或已授权浏览器会话可以修改，Agent CLI 不获得该写权限。

保存成功后发布窄响应模式更新事件，使同 Space 的其他窗口失效重取 Agent 详情或频道成员策略。事件不携带敏感内容，也不广播整份消息历史。

## 11. Runtime 与增量收件箱

runtime prompt 必须把每个待处理目标的响应指令表达清楚：

- `required`：在原目标处理并反馈，不得无故静默；
- `optional`：读取、判断，仅在有价值时回复，可以静默结束；
- `observe`：只作为上下文，不因该消息生成回复。

`/agent-api/message/check` 可以继续让 Agent 看见 membership 范围内的消息，但每条结果必须增加稳定的 `responseDirective` 与 `responseReason`，区分可触发项与观察上下文，不能把所有新增消息都重新解释为“必须回复”。推进读取进度不等于允许补唤醒。

同一 runtime turn 同时取到多个目标时，指令逐消息/逐目标保留：所有 `required` 目标必须反馈，`optional` 目标可以判断后静默，`observe` 只提供上下文。不能因为批次中有一个 `required`，就把其余目标全部升级成强制回复。

reconnect backlog 使用与实时投递完全相同的 policy、话题参与判断和 watermark。模式切换前已存在但未读取的消息可以作为 `observe` 上下文返回，不能在 Worker 重连时突然启动历史 turn。

这是一项现有 Kith CLI/prompt 语义的增量升级，但不扩大 `Runtime.start` 适配接口，也不提前实现 usage、取消、完成回调或 MCP bootstrap 等 Runtime 契约 v2 内容。

## 12. 前端模块边界

新增响应模式 UI 时保持以下边界：

- `web/src/views/agent-response-mode/AgentDefaultResponseModeCard.tsx`：Agent 默认卡片与即时保存状态；
- `web/src/views/agent-response-mode/ChannelAgentResponseModeBadge.tsx`：消息昵称后的徽标；
- `web/src/views/agent-response-mode/ChannelAgentResponseModeMenu.tsx`：浮层、键盘与选择交互；
- `web/src/views/agent-response-mode/useChannelAgentResponseModes.ts`：一次装载、缓存和实时失效；
- 共享类型与展示文案集中在同一 feature 目录的小模块中。

`Members.tsx` 只负责插入独立默认卡片，`Chat.tsx` 只把作者和频道上下文交给徽标组件；不得把请求、模式解析和浮层状态继续堆进这两个大型文件。现有 `channel-settings/` 成员页不复制编辑器。

文件名可以在实现时按仓库既有命名微调，但职责边界不得退回单一大组件。

## 13. 错误、并发与安全

- 默认值和覆盖值更新使用服务端当前值计算 old/new effective mode，并在同一事务写设置与 watermark。
- 重复提交同一值幂等，不推进 watermark，不制造重复实时事件。
- 并发修改以最后一次成功写入为准；前端失败时回滚并重新取得服务端值。
- Agent 已被移出频道时，覆盖更新返回 404；重新加入后默认跟随 Agent 当前默认值，不复用已删除 membership 的覆盖。
- 响应模式不能绕过归档/删除、Space 隔离、membership、任务作用域、dispatch 深度、wake budget 或 emergency stop。明确任务指派可以由任务领域服务建立受派 Agent 的任务话题 membership，但不能借此加入无关父频道。
- 静音不成为服务端发信禁令；Agent 的主动工具调用仍走原有发送权限与生命周期检查。

## 14. 实施切片

1. **领域与迁移**：增加 v5 字段、设置服务、纯策略矩阵和迁移测试。
2. **投递链路**：实时 wake、reconnect、message check 与 prompt 统一消费决策和响应指令。
3. **任务语义**：把“作为任务 + 单一 `@Agent`”落成真实 assignee；补无 mention 与多 mention 分支。
4. **HTTP 与实时**：扩展 Agent/频道成员 DTO、Human 写接口和多窗口失效事件。
5. **前端**：Agent 默认卡片、频道徽标/菜单、无每消息请求、归档只读与键盘/触屏交互。
6. **真实验收**：覆盖顶层频道、话题、DM、任务、重连、模式切换和双窗口同步。

每个切片保持最小修改，不顺手重构频道设置、完整 Chat 或 Runtime 契约 v2。

## 15. 测试与验收

### 15.1 必须自动化

- 纯策略模块覆盖唤醒矩阵的全部组合，尤其是 Agent 普通消息反循环、静音 mention 和话题参与。
- v4 → v5 迁移保持 19 张产品表，已有 Agent/成员默认行为等同当前主动模式。
- 默认值与覆盖值解析、显式覆盖等于默认、重置为继承、幂等保存和两个 watermark 转换测试。
- `core.ts` 实时投递与 reconnect backlog 对同一事件产生相同决策。
- message check / prompt 分别正确表达 `required | optional | observe`。
- “作为任务”覆盖：单一 mention 真正指派并绕过模式、零 mention 未指派、多 mention 拒绝。
- DM 与后续明确任务指派在三种模式下都能唤醒。
- 归档/删除、非成员、跨 Space、派发护栏不能被模式设置绕过。
- API 枚举、404/409、Human authority 和 realtime invalidation 测试。
- 前端卡片、徽标、继承/覆盖、错误回滚、归档只读和键盘操作测试。

### 15.2 用户验收场景

1. 将 Agent 默认设为被动；频道徽标同步显示被动，普通频道消息不唤醒，`@Agent` 会唤醒。
2. 在某频道覆盖为主动；其他频道仍跟随被动，当前频道普通 Human 消息可唤醒但 Agent 可以判断后静默。
3. 将频道覆盖设为静音；普通消息和 `@` 都不唤醒，但 Human 私聊和明确指派任务仍唤醒。
4. 清除覆盖；徽标立刻跟随 Agent 默认值，菜单明确显示来源。
5. Agent 已参与话题后，Human 后续回复在主动/被动模式下无需重复 `@`；静音不唤醒。
6. Human 发送“作为任务 + 单一 `@Agent`”；任务详情显示真实 assignee，静音 Agent 仍收到任务，其他成员不被唤醒。
7. Human 发送未 `@` 的频道任务；任务保持未指派，只有主动成员可以被环境唤醒。
8. 切换模式后重连 Worker；切换前的旧消息不补唤醒，当前未读状态不被伪造。
9. 两个窗口同时打开同一频道；一处修改后另一处徽标和菜单收敛到新值。

## 16. 当前实现边界

截至 2026-07-14，本规格只有文档和决策，以下均**尚未实现**：

- schema v5 与响应模式字段；
- 统一响应策略/设置模块；
- API、实时事件和 Runtime 响应指令；
- Composer 由单一 mention 自动形成真实 assignee；
- Agent 设置卡片、频道徽标和 hover 菜单。

当前 schema 仍是 v4，Human 频道消息仍沿既有成员唤醒路径，现有 wake prompt 仍倾向要求目标回复。后续实现必须以本文为验收来源，并在代码落地的同一提交再次同步架构、UI、路线和进度文档中的“待实现”状态。
