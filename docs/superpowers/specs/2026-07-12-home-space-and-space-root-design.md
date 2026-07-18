# Home 总控 Space、Space 根目录与跨 Space 编排设计

状态：已确认设计；H1-H4 已完成并等待用户验收，H5 为后续能力且尚未开始。
确认日期：2026-07-12。
适用范围：A1-A6 用户验收后的前置修复；完成前不进入 Runtime 契约 v2。

本文固定四件事：`Home` 的产品角色、用户可见 Space 根目录、agent 的实际工作目录与记忆归属，以及未来跨 Space 编排的安全边界。它补充 `2026-07-11-personal-agent-os-local-pivot-design.md`，并修正从 open-tag 继承的 per-agent cwd 遗留。

## 1. 目标与非目标

目标：

- `Home` 是安装实例唯一的总控 Space，也是普通启动的默认入口，而不是独立 Overview 壳。
- Human 可以在 `Home` 的“空间”模块中创建、接入、搜索和打开本机 Space。
- 普通 Space 根植于用户选择的文件夹；该 Space 的 agent runtime 以这个文件夹为 cwd。
- 应用内部数据、Space 可移植数据、runtime 临时状态彼此分离。
- Home agent 未来可通过受审计的服务在目标 Space 创建任务、发消息或调度目标 agent。

非目标：

- 不恢复已经删除的双壳、薄总览页或独立项目窗口。
- 不把普通 Space 强制放进 Home 的物理子目录。
- 不让 Home agent 直接打开其他 Space 的 SQLite 文件写数据。
- 不把全部 Space 内容预加载进 Home agent 上下文。
- 不把跨 Space 委派伪装成 Human 亲自操作。

## 2. 领域模型

### 2.1 Home Space

每个安装实例只有一个 `Home Space`。它是一个真实 Space，拥有自己的频道、消息、任务、agent、记忆、附件和普通文件；同时承担本机 Space 目录与跨 Space 编排入口。

Home 的身份必须由 app.db 中稳定的 `homeSpaceId` 表达，不通过显示名称、slug 或文件夹名推断。初始化完成后 Home 必须持续存在，不能像普通 Space 一样被取消注册；显示名称是否允许修改属于后续便宜改，不影响稳定身份。

### 2.2 Regular Space

除 Home 外的 Space 称为普通 Space。每个普通 Space 对应一个本地文件夹，可以位于任意本地磁盘。产品交互可称其为 Home 管理的 Space，但它不是 Home 文件夹的物理子目录，也不引入递归 Space 层级。

### 2.3 Space Registry

app.db 中的 Space registry 是本机已接入 Space 的目录，保存稳定 Space ID、slug、显示名称、rootPath、最近打开时间等安装级索引。Home 的“空间”模块读取 registry；每个 Space 的业务事实仍由自己的 `.kith/workspace.db` 持有。

### 2.4 Cross-Space Delegation

Home agent 代表唯一 Human 向另一个 Space 发起操作，称为“跨 Space 委派”。委派保留真实 acting agent、来源 Home、目标 Space 和 `requestedBy: human`，不能把消息伪装成 Human 亲自发送。

## 3. 启动与窗口信息架构

普通 Desktop 冷启动且没有显式深链接时始终进入 Home Chat。显式 `/s/:slug` 深链接继续打开目标 Space；从托盘重新显示尚未销毁的窗口时保留当前页面。

应用继续只有一个 `WorkspaceFrame` 和三种布局状态：ChatOnly、Split、ModuleOnly。Home 的“空间”是这个壳中的真实 Module Pane，不是启动前的总览页。

Dock 规则：

- Home：`Chat | Spaces | Inbox | Tasks | Agents | Settings`。
- 普通 Space：`Chat | Inbox | Tasks | Agents | Settings`。
- `Spaces` 的模块 id 为 `spaces`，只在 Home 有效。
- 规范 URL 为 Home 当前会话路径上的 `?module=spaces`。
- 在普通 Space 深链接 `module=spaces` 时删除无效 query；从顶部 Space 入口打开空间目录时导航到 Home 的 Spaces 模块。

Spaces 模块第一版包含：

- 搜索、刷新和“新建空间”。
- 普通 Space 卡片网格；Home 自身不重复出现在列表中。
- 卡片至少显示名称、路径和最近打开信息。
- 点击卡片在当前窗口进入目标 Space 的默认 Chat，不打开第二窗口。
- “新建空间”提供“在默认位置新建文件夹”和“使用已有文件夹”两条路径。

## 4. 路径与数据拓扑

### 4.1 两个根目录必须分开

应用数据根与用户 Space 容器是两个不同概念，不能继续由 `KITH_SPACE_HOME` 的存在与否隐式绑定。

默认路径：

```text
Windows app data:   C:\Users\<user>\.kith-space
Windows Spaces:    C:\Users\<user>\Kith-space
Windows Home:      C:\Users\<user>\Kith-space\Home

macOS app data:    /Users/<user>/.kith-space
macOS Spaces:      /Users/<user>/Kith-space
macOS Home:        /Users/<user>/Kith-space/Home

Linux app data:    /home/<user>/.kith-space
Linux Spaces:      /home/<user>/Kith-space
Linux Home:        /home/<user>/Kith-space/Home
```

`KITH_SPACE_HOME` 只覆盖内部 app data。开发和测试需要隔离默认 Space 时，必须使用 `KITH_SPACE_SPACES_DIR` 覆盖默认 Space 容器，或在创建 fixture 时显式传入 rootPath；不能再靠“设置过 KITH_SPACE_HOME”改变产品路径语义。

### 4.2 应用内部数据

```text
~/.kith-space/
  app.db
  memory/
    MEMORY.md
    notes/
  runtime/
    <spaceId>/
      <agentId>/
  bin/
  logs/
```

- app.db 保存唯一 Human、homeSpaceId、Space registry、Desktop/Web 设置和浏览器授权状态。
- `memory/` 是 User Memory，承载跨 Space 的 Human 偏好与长期背景。
- `runtime/` 保存 runtime prompt 文件、适配器临时状态等不应随 Space 搬迁的宿主内部数据。
- 业务文件不得默认生成在这里。

### 4.3 Space 自包含数据

```text
<spaceRoot>/
  .kith/
    workspace.db
    memory/
      MEMORY.md
      notes/
    agents/
      <agentId>/
        MEMORY.md
        notes/
    uploads/
  <user files>
```

- agent 名册、runtime/model 配置、频道、消息和任务继续存入 workspace.db。
- `.kith/memory/` 是 Space Memory。
- `.kith/agents/<agentId>/` 是该 Space 内 agent 的语义记忆，不是 runtime cwd。
- `.kith/uploads/` 是该 Space 的附件对象。
- `.kith` 外部是用户与全部 Space agent 共同工作的普通文件树。

复制一个普通 Space 文件夹应带走其业务数据库、Space Memory、Agent Memory、附件和用户文件；User Memory、Desktop 设置、浏览器会话和 runtime 临时状态不随之复制。

## 5. Agent 工作目录与记忆

每个 agent 启动时必须同时解析三个不同路径：

```text
workspaceRoot   = Space root，传给 runtime 作为 cwd
agentMemoryDir  = <spaceRoot>/.kith/agents/<agentId>
runtimeStateDir = <appData>/runtime/<spaceId>/<agentId>
```

约束：

- Claude Code、Codex、opencode 的 cwd 都是 workspaceRoot。
- 多个 agent 在同一 Space 中有意共享同一用户文件树；cwd 不是安全沙箱，也不能再被文档描述为 per-agent 隔离。
- Claude system prompt 临时文件等适配器产物写入 runtimeStateDir，不污染 Space 根目录。
- reset 必须分别表达“清 runtime 状态”和“清 Agent Memory”；两者都不得删除共享 Space 文件。若未来提供删除 agent 生成文件的能力，它必须是独立、显式且可审计的文件操作，不能伪装成 reset。
- 非琐碎 turn 继续按 User、Space、Agent 顺序读取三个 MEMORY.md。

三层记忆归属：

- User Memory：app data，跨 Space，Human 主策展。
- Home Space Memory：Home 的全局协调背景、Space 组合与跨 Space 计划。
- 普通 Space Memory：具体 Space 的共享规则和项目背景。
- Agent Memory：agent 在所属 Space 内的角色、工作知识和恢复上下文。

## 6. 创建、接入与重连 Space

创建流程必须先规范化并校验宿主绝对路径，app.db 只注册规范路径。

### 6.1 在默认位置创建

用户输入名称，应用以其规范 slug 建议 `<SpacesHome>/<slug>`。路径不存在时创建文件夹并初始化 `.kith`；默认路径已经存在时拒绝并要求改用显式“使用已有文件夹”流程，不能静默覆盖或接管文件。

### 6.2 使用已有文件夹

Desktop 使用 Electron 原生目录选择器。授权浏览器不能使用浏览器本机文件选择器冒充 Desktop 主机路径，而是通过 Core 提供的受限主机目录浏览器列出目录并选择路径；接口只返回目录名称、绝对路径、父级和主机根位置，不读取或返回文件内容。最终路径仍由 Core 的 Space root 规则规范化与校验。

选择结果分三种：

1. 没有 `.kith`：初始化新 Space。
2. 有兼容的 `.kith/workspace.db`：按其中稳定 Space ID 接入或重连。
3. 有不兼容或损坏的 `.kith`：停止并提示备份、修复或显式重建，绝不自动删除。

同一规范 rootPath 或同一 Space ID 不能重复注册。Space 文件夹移动后通过“重新定位文件夹”更新 registry；不得创建第二个逻辑 Space 来掩盖路径失效。

### 6.3 Home 初始化

首次初始化在 `<SpacesHome>/Home` 创建或接入 Home。已有普通文件不能被删除；已有不兼容 `.kith` 时显示可操作错误。开发期旧验收数据允许显式重置，但产品和测试不能自动清理用户目录。

## 7. 跨 Space 能力边界

Home agent 的跨 Space 能力通过 Core 领域服务和后续 MCP/CLI 契约暴露，不通过文件系统扫描或直接 SQL。

第一组目标能力：

- 列出 Space 和读取摘要。
- 在目标 Space 创建 task。
- 向目标 Space 的频道或 Human-Agent DM 发送消息。
- 唤醒或派发目标 Space 中的 agent。
- 查询目标 Space 的任务、未读和 agent 状态。

每个请求至少携带：

```text
sourceSpaceId = Home
actingAgentId
requestedBy = human
targetSpaceId
target resource
idempotency key
```

规则：

- 只有 Home agent 获得跨 Space 工具作用域；普通 Space agent 默认只能操作当前 Space。
- Core 从 registry 解析目标 Space 并复用目标领域服务，不接受 agent 提供任意数据库路径。
- 目标消息显示真实 Home agent，并标注“代表 Human 从 Home 发起”；不伪装成 Human actor。
- 跨库操作没有 SQLite 全局事务，必须以幂等请求和可查询审计状态处理重试；不能用双写后假装原子。
- Home agent 需要修改目标 Space 文件时，默认创建任务并调度目标 Space agent；目标 agent 在目标 rootPath cwd 中执行。
- Home 只按需读取目标 Space 的摘要和相关资源，不把所有 Space 的完整消息或记忆注入每次 turn。
- 删除、外部发送等高风险动作继续服从决策 8 的风险分级与审批要求。

## 8. 模块与服务边界

建议的职责边界，不要求把代码塞入现有大文件：

- `AppDataPaths`：应用数据根、默认 Space 容器和 runtime state 路径。
- `SpaceRootService`：路径规范化、创建、接入、重连与 `.kith` 校验。
- `HomeSpaceService`：稳定 homeSpaceId、首次初始化和 Home 不变量。
- `SpaceDirectoryService`：面向 UI/agent 的 Space 列表与摘要。
- `CrossSpaceCommandService`：目标解析、幂等、审计和目标领域服务调用。
- `AgentWorkspacePaths`：workspaceRoot、agentMemoryDir、runtimeStateDir 三路径契约。
- `SpacesModule`：Home-only 卡片模块，不承载路径和数据库业务逻辑。

具体名称可在实现时匹配仓库风格调整，但职责不能重新混回 `server/core.ts`、Desktop main 或单一 React 组件。

## 9. 实施切片

### H1 路径地基（已完成）

- 分离 app data 与默认 Space 容器。
- 为 Home 建立稳定 homeSpaceId 和 `~/Kith-space/Home` 根路径。
- 补路径分离、旧 app.db Home 身份回填、并发初始化与 Home 不可注销测试。

### H2 runtime cwd 与记忆归位（已完成）

- runtime cwd 改为 Space root。
- Agent Memory 移到 `<space>/.kith/agents/<agentId>`。
- runtime prompt/临时文件移到 app data runtimeStateDir。
- 更新 reset/wipe 与三层记忆测试。

实现说明：Claude Code、Codex、opencode 已使用 Space root cwd；OpenCode prompt 通过 child-only `OPENCODE_CONFIG_CONTENT` + 固定内部 execution agent 注入，不写用户 `AGENTS.md`。Copilot/Kimi/Cursor 仍是 experimental adapter，其现有 prompt 注入会在 cwd 写 `AGENTS.md`，暂时使用 runtimeStateDir，避免覆盖用户 Space 中的同名文件。项目 skills 使用 registry 解析的 Space root，profile 同步与 reset 使用同一三路径契约；Agents 详情的“记忆”文件树则只读取当前 agentMemoryDir。Space/Agent ID 必须是安全单路径段且派生目录不得逃逸容器，同 agent reset/start 串行执行。

### H3 Space 创建与接入（已完成）

- Desktop 原生目录选择器。
- 创建、接入、重新定位 API 与 UI。
- 授权浏览器的主机路径输入和服务端校验。

实现说明：默认创建只建立新的 `<SpacesHome>/<slug>`；显式接入可初始化没有 `.kith` 的普通目录，或从兼容 workspace.db 复用稳定 Space ID。重复规范 root/Space ID、损坏或不兼容数据库、`.kith`/workspace.db symlink 与身份不匹配都会返回可操作错误且不删除用户文件；未显式指定的冲突 slug 会生成本机唯一路由别名。接入探测与正式数据库打开共用 SQLite `quick_check`、版本以及全产品表/列校验。列表返回 `ready | missing | error`，普通 API 不会为失联 registry 记录隐式重建目录或数据库；移动后的 Space 通过 relocate 更新同一逻辑身份，目标打开失败时 registry 回滚。Desktop 通过 preload 窄桥调用 Electron 原生目录选择器；授权浏览器通过受保护的 `/api/host-directories` 浏览主机目录，不再手填绝对路径。H3 当时先在 SpaceSwitcher 提供最小创建/接入/重连入口；H4 已把完整创建/接入目录管理移入 Home Spaces，并让 SpaceSwitcher 收敛为快速切换、应急重连与管理入口。失联深链会回退到可用 Space，全部失联时显示独立恢复页。

验证：typecheck、497/497 单测、完整集成测试、Web build（2569 modules）和 Desktop build 通过；路径/身份/slug 冲突、数据库完整性与 schema、symlink、失联深链/全失联恢复、无隐式重建、relocate 回滚与两种宿主 UI 路径均有回归覆盖。

### H4 Home 与 Spaces 模块（已完成）

- 普通冷启动进入 Home。
- Home-only Spaces Dock 项、卡片页面、搜索、创建与同窗切换。
- 保留顶部快速 Space 切换，不恢复旧 OverviewShell。

实现说明：`GET /api/spaces` 以稳定 homeSpaceId 返回 `isHome`，`POST /api/spaces/:id/open` 只在注册 root 可用时更新最近打开时间。前端普通冷启动选择 ready Home，显式 ready Space 深链接仍优先。Home Dock 注册 `spaces`，卡片目录过滤 Home 自身并提供搜索、刷新、默认创建、已有文件夹接入、失联重连和同窗进入；普通 Space 收到 `module=spaces` 时规范化回 Chat。顶部 SpaceSwitcher 只保留快速切换、失联恢复和进入 Home Spaces 的入口。实现未增加 H5 跨 Space 聚合、写操作或伪摘要。

验证：typecheck、502/502 单测、完整集成测试、Web build（2571 modules）与 Desktop build 通过；单轮轻量复核发现的刷新入口遗漏已修复。实际 Desktop/Web 交互与视觉由用户在 H1-H4 验收中确认。

### 2026-07-18 增量：Spaces 批量移除

Home Spaces 增加批量管理模式：仅普通 Space 卡片可选，确认后逐个调用现有注册表移除接口；不会删除本地目录或数据，Home 始终不可选。批次中失败的项目保留选中状态，供用户修复后重试；这不是 H5 跨 Space 编排能力。

### H5 跨 Space 编排

- 先实现真实只读摘要，再实现 task/message/agent dispatch。
- 增加幂等、审计、来源显示和错误恢复。
- 与 Runtime 契约 v2、MCP bootstrap 的先后关系在 H1-H4 验收后决定。

H1-H4 是 A1-A6 验收前置修复；H5 是其上后续能力，不能用假数据提前占位。每个切片独立验证、同步文档并独立提交。

## 10. 验收标准

- 默认 Desktop app data 与用户可见 Space 根目录物理分离。
- 首次初始化创建唯一 Home，普通冷启动进入 Home Chat。
- Home Dock 显示 Spaces，普通 Space Dock 不显示。
- 用户可新建文件夹 Space、接入已有文件夹和重新定位已移动 Space。
- agent 在 Space 根目录创建相对文件，不再写入 app data 的 `agents/<id>`。
- 同 Space agent 共享项目文件，但各自 Agent Memory 和 runtime state 不混用。
- 复制 Space 文件夹包含 workspace.db、Space Memory、Agent Memory、附件和用户文件。
- Home agent 的跨 Space 操作明确目标、可审计、幂等，且不冒充 Human。
- 文档和 UI 不再把 cwd 描述为安全隔离，也不把 Spaces 模块描述成旧总览壳。

## 11. 当前实现状态与剩余差距

截至当前实现，状态如下：

- H1 已消除路径绑定：`KITH_SPACE_HOME` 只覆盖 app data，`KITH_SPACE_SPACES_DIR` 独立覆盖默认 Space 容器，正式 Home 默认为 `~/Kith-space/Home`。
- H2 已完成三路径归位：主要 runtime 以 Space root 为 cwd，Agent Memory 位于 `.kith/agents/<agentId>`，runtime 临时状态位于 app data；reset 不删除共享 Space 文件。
- H3 已完成 Space root 生命周期：默认新建、普通目录接入、兼容 workspace.db 稳定 ID 复用、失联状态、重新定位、冲突/损坏/不兼容/symlink 拒绝和 registry 回滚均已落地；Desktop 使用原生目录选择，授权浏览器使用受限主机目录浏览器，二者复用于 Home Spaces 和重连流程。
- H4 已完成 Home UI：Home 通过 `installation_state.home_space_id` 的稳定身份获得专属 Spaces Dock/模块；普通冷启动固定进入 ready Home，卡片目录使用真实 registry，并支持创建、接入、搜索、刷新、重连和同窗进入。普通 Space 不接受该模块。
- 尚未实现的是 H5 跨 Space command service；它不属于 H1-H4 本轮验收，不得用假数据占位。

这些差距属于已确认目标态与现有代码之间的验收修复，不代表设计尚未决定。
