# ADR-0038：以 Recombyn RCB 构建 Kith Canvas Module

> 状态：Accepted
> 日期：2026-08-15
> 决策者：产品用户（`1A / 2A / 3A / 4A / 5A`）
> 详细规格：[Recombyn Canvas Workspace 设计](../superpowers/specs/2026-08-15-recombyn-canvas-workspace-design.md)

## 背景

Kith-space 需要一个与 Chat、durable turn、Context Envelope 和多 Agent 协作相连的无限画布。目标不是单纯生图界面，而是承载文字、图形、媒体、手绘和未来语义图/文件/生成内容的通用视觉工作面。

`reference/recombyn` 的自研 React/SVG RCB 编辑器已经具备成熟无限画布和丰富原生编辑能力，根仓为 Apache-2.0；但其 Agent 链路是 Python/LangGraph + REST/SSE + 浏览器 ToolOps/Redux，其产品壳还绑定云同步、认证、计费、分享、Tauri 与 Yjs。整体照搬会在 Kith 内形成第二套 runtime、Chat、数据真相源和宿主。

当前 `codex/development@4937690` 已实现 Chat 常驻的右侧 Workspace Tabs，标签以 `moduleId + resourceId` 区分并按 Space 恢复，不需要再设计顶层标签系统。

MCP `2026-07-28` 的 modern core 取消传统 `initialize/initialized`；同版本 Streamable HTTP 另行取消 `Mcp-Session-Id` 和独立 GET stream endpoint。但这些变化都不提供 Canvas 所需的身份、ACL、幂等、事务、revision、冲突与撤销语义。

## 决策

1. 直接移植 Recombyn RCB 编辑器、节点、编辑器 chrome 和现有交互；其内部 UI 不做 Kith 化重设计。
2. 不移植 Recombyn AgentDock、Home/Auth/Billing/Share/Cloud、Tauri、Yjs 服务和 Python/LangGraph runtime。
3. 复用 Kith 现有 Workspace Tabs。`canvasId` 是 tab `resourceId`；每个 Canvas 是独立无限平面，没有用户可见 Page。
4. Kith Harness 是唯一 Agent runtime。Recombyn ToolOps、校验、安全规则、prompt rules 和 design skills 适配为 Kith Canvas capability/skills。
5. 新建 Kith-owned Canvas Core Module，Human API、MCP 与 CLI 都是其薄 Adapter；Core 是 durable truth，Renderer Redux 只是交互投影。
6. Canvas mutation 使用 metadata/document/element/frame/structure revision、Core-derived read/write set、atomic batch、既有 turn-operation 幂等域和 mutation ledger；已提交 undo/redo 也是 Core mutation。
7. 选区先冻结为不可变 Canvas Selection Snapshot，Chat 只引用 snapshot；注册式 Context Object resolver 再把所有 bound message 的规范 refs 冻结到 turn。
8. Canvas 发起必须绑定真实 DM/频道/话题和一个 eligible Agent（未删除、v2、有 surface access、实时拥有 `message:send`）。server-owned `MessageExecutionBinding` 与 snapshot/message/ref/required delivery 同事务写入，其他 Agent 不获 optional wake；不能以正文 mention 代替。
9. Canvas capability 只能从 executor binding + bound delivery 派生为 durable `CanvasAccessGrant` 并逐调用重验。mutation 关联既有 turn operation，`turn.reply.outputRefs` 通过 `turn_output_artifacts` 关联已提交 mutation。
10. MVP 继续使用现有 broker-backed stdio MCP + CLI fallback；TypeScript SDK v2 + `2026-07-28` dual-era/modern 支持独立后置。
11. MVP 范围固定为：Recombyn 原生编辑、多 Canvas tabs、选区发 Chat、一个明确 Agent revisioned 回写。其他内容按规格后置。

## 理由

- 直接移植保留已经验证的编辑体验，避免重新实现约 8 万行编辑器闭包。
- 以 Core Module 替换浏览器真相源，使 Human 与 Agent 共用一个可审计写入边界。
- 复用现有 Workspace Tabs 避免第二套壳层状态和路由。
- 复用 Harness 符合“不自研 runtime”和 harness-first 原则，也保留 Agent 身份、模型、记忆和 durable turn 的一致性。
- 显式 revision/幂等/事务解决真正的多操作者问题；升级 MCP transport 不能替代这些领域语义。
- 先做单执行者闭环把交付面控制在可验证范围，同时为未来多 Agent 分区协作保留正确地基。

## 代价与后果

正面结果：

- Kith 获得成熟无限画布，而无需接受 Recombyn 的产品壳和 runtime。
- Canvas 与 Chat、Context、Agent 回写、权限和审计形成一个系统闭环。
- 多 Canvas 直接落在既有 resource tab 模型上。
- 后续增加语义图、生成 job 和 Agent zone 时不需要推翻真相源。

接受的代价：

- 上游前端闭包规模大，需要持续维护 source manifest、NOTICE、修改声明和视觉回归。
- Recombyn Tailwind 3/样式 token/portal 与 Kith Tailwind 4 存在隔离成本。
- 必须为 SceneDocument、asset、mutation、selection snapshot 和 Gateway 新建领域模块与迁移。
- MVP 暂不提供便签、链接、任意文件、语义图、多 Agent 同时写和 AI 视频/音频生成。
- 当前 TypeScript SDK 1.x 与未来 SDK v2 + dual-era 会有一段兼容迁移期，但该成本不与 Canvas 首版耦合。

## 被否决方案

### 整体嵌入 Recombyn 应用

否决。它会引入第二套认证、云同步、Chat、模型、runtime、Tauri 和协作服务，并与 Kith Desktop/Core/Worker 拓扑冲突。

### 只迁 UI，继续让 Redux/IndexedDB 成为真相源

否决。Agent 和 Human 会形成不同写入路径，无法可靠实现 ACL、CAS、幂等、崩溃恢复和审计。

### 保留 Recombyn LangGraph 作为“画布专用 Agent”

否决。它违反不自研/不并存第二 runtime 的原则，也会复制 Kith 已有 session、memory、model routing 和 durable turn。

### 先升级 MCP `2026-07-28`

否决为 MVP 前置。新版 transport 有价值，但不解决 Canvas 领域一致性；把两项迁移捆绑会增加风险而不缩小 Canvas 工作量。

### 从零重写画布或改用另一画布库

否决。用户已明确要求直接移植 Recombyn，且现有 RCB 能力和 UI 保护价值高；重写会扩大周期并失去目标体验。

## 合规与复审条件

- 首次复制上游代码前必须完成来源 manifest、Apache-2.0 NOTICE/修改声明、MIT skill 与 Paynter brush 完整 notice、图标/品牌资产和字体许可核验；完整 Paynter notice 不可得时不复制该笔刷。
- Recombyn Tailwind 3/Preflight、portal、全局字体必须通过 source island、scoped reset、独立 portal root 与 computed-style 门禁隔离；SVG 清洗是 Kith 新建的安全链，不能宣称复用上游已有 sanitizer。
- Scene JSON 只能由 Kith-owned Import Service 转换为受限 Core operations，不能直接替换 canonical document；必须覆盖版本/大小/深度、ID/单 root、保留 metadata、资产重绑和 SVG/URL 清洗。
- 若同一 React tree 无法通过冻结视觉门，iframe/独立 renderer 只能作为新的显式决策，不能静默采用。
- 若 scene 全量事务未达到冻结性能门，允许在不改变外部 contract 的前提下增加元素索引；不得直接重写 RCB。
- 若未来出现外部 MCP host、多 Core 实例或 SDK 1.x 维护终止，另立 ADR 评估 SDK v2 + dual-era。
- 改变 UI 保护范围、唯一 runtime、双结果语义或 MVP 边界，必须新增 ADR 并重新请求用户确认。
