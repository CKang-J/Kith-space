# Home 总控 Space、Space 根目录与跨 Space 编排设计

状态：已确认设计，尚未实现。
确认日期：2026-07-12。
适用范围：A1-A6 用户验收后的前置修复；完成前不进入 Runtime 契约 v2。

本文固定四件事：`Home` 的产品角色、用户可见 Space 根目录、agent 的实际工作目录与记忆归属，以及未来跨 Space 编排的安全边界。它补充 `2026-07-11-personal-agent-os-local-pivot-design.md`，并修正当前实现仍继承自 open-tag 的 per-agent cwd。

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

`KITH_SPACE_HOME` 只覆盖内部 app data。开发和测试需要隔离默认 Space 时，必须使用另一个明确的默认 Space 容器覆盖项，或在创建 fixture 时显式传入 rootPath；不能再靠“设置过 KITH_SPACE_HOME”改变产品路径语义。

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
- reset/wipe 必须分别表达“清 runtime 状态”“清 agent memory”和“删除 agent 生成的 Space 文件”；不得用删除旧 agent cwd 的方式模糊三者。
- 非琐碎 turn 继续按 User、Space、Agent 顺序读取三个 MEMORY.md。

三层记忆归属：

- User Memory：app data，跨 Space，Human 主策展。
- Home Space Memory：Home 的全局协调背景、Space 组合与跨 Space 计划。
- 普通 Space Memory：具体 Space 的共享规则和项目背景。
- Agent Memory：agent 在所属 Space 内的角色、工作知识和恢复上下文。

## 6. 创建、接入与重连 Space

创建流程必须先规范化并校验宿主绝对路径，app.db 只注册规范路径。

### 6.1 在默认位置创建

用户输入名称，默认建议 `<SpacesHome>/<name>`。路径不存在时创建文件夹并初始化 `.kith`；路径已存在且没有 `.kith` 时必须明确告知将把它接入为 Space，不能静默覆盖文件。

### 6.2 使用已有文件夹

Desktop 使用 Electron 原生目录选择器。授权浏览器不能使用浏览器本机文件选择器冒充 Desktop 主机路径；它可以提交 Desktop 主机绝对路径并由 Core 校验，后续可增加受限的主机目录浏览器。

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

### H1 路径地基

- 分离 app data 与默认 Space 容器。
- 为 Home 建立稳定 homeSpaceId 和 `~/Kith-space/Home` 根路径。
- 补路径、重复注册、已有 `.kith` 和重连测试。

### H2 runtime cwd 与记忆归位

- runtime cwd 改为 Space root。
- Agent Memory 移到 `<space>/.kith/agents/<agentId>`。
- runtime prompt/临时文件移到 app data runtimeStateDir。
- 更新 reset/wipe 与三层记忆测试。

### H3 Space 创建与接入

- Desktop 原生目录选择器。
- 创建、接入、重新定位 API 与 UI。
- 授权浏览器的主机路径输入和服务端校验。

### H4 Home 与 Spaces 模块

- 普通冷启动进入 Home。
- Home-only Spaces Dock 项、卡片页面、搜索、创建与同窗切换。
- 保留顶部快速 Space 切换，不恢复旧 OverviewShell。

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

## 11. 当前实现差距

截至设计确认时，代码仍有以下差距，不能误写成已完成：

- Desktop 会向子进程始终注入 KITH_SPACE_HOME，`defaultSpacesDir()` 因而把正式 Home 也落到 app data 下的 `workspaces/home`。
- AgentManager 仍以 `<KITH_SPACE_HOME>/agents/<agentId>` 为 runtime cwd。
- Agent Memory 仍和 cwd 共用该目录，复制 Space 时不会随 `.kith` 搬迁。
- `/api/spaces` 已接受 rootPath，但现有创建 UI 只提交 name/slug，没有 Desktop 文件夹选择器。
- Home 尚无稳定 homeSpaceId、Home-only Spaces 模块或跨 Space command service。

这些差距属于已确认目标态与现有代码之间的验收修复，不代表设计尚未决定。
