# Kith-space × Recombyn Canvas 移植探索

> 日期：2026-08-15
> 状态：探索完成；5 项产品决策已于 2026-08-15 全部按推荐方案确认；**不是实现完成声明**
> Kith 基线：`codex/development@4937690`
> Recombyn 基线：`follow-upstream@abd8198`
> 协议专题：[Canvas × Agent 协议边界研究](canvas-mcp-protocol-research.md)

## 1. 结论先行

1. Recombyn 根仓是 Apache-2.0，与 Kith 的 Apache-2.0 兼容，可以移植；必须保留 License/NOTICE、修改声明和 MIT skills 归属；Paynter 笔刷只有取得并随包携带完整上游 MIT notice 才能复制，图标/品牌资产另做商标与再分发核验。
2. “直接移植且不改 UI”可以落地，但合理边界是：**保留 RCB 画布编辑器内部的视觉、节点、工具栏、面板和交互；替换它的产品壳、AgentDock 后端、云同步、认证、计费、Tauri 和 Yjs 服务。** 整个 Recombyn 应用无法作为一个独立组件原封不动嵌入 Kith。
3. Recombyn 的画布核心不是第三方画布库，而是自研 React/SVG RCB。保持现有编辑体验需要迁移 RCB、canvas、nodes、chrome、基础组件、feature Redux store、主题和资产等约 8 万行前端代码，并建立隔离的样式/portal 边界。
4. Recombyn 的 Agent 不是 MCP：它是 Python/LangGraph + REST/SSE + 浏览器 ToolOps 修改 Redux + scene feedback。该执行循环不能成为 Kith 第二套 runtime；应由 Kith Harness v2、模型绑定、记忆、durable turn 和 Gateway 接管。
5. Recombyn 的 24 个画布 action、ToolOps schema、`op_id`、校验、危险操作规则和 28 个设计技能有迁移价值；24 项必须逐项分类，只有 durable scene 子集成为 Canvas atomic operations，viewport/export/image processing 分别走 UI suggestion、Export Port 或延后 job。
6. MCP `2026-07-28` 已正式 GA，也确实取消了 modern era 的 `initialize/initialized` 与 `Mcp-Session-Id`；但它只解决协议传输会话和实例亲和，不解决画布身份、ACL、幂等、事务、revision、冲突或撤销。Canvas MVP 不应以 MCP SDK 大迁移为前置。
7. 多 Agent 正确协作的核心不是“无会话 MCP”，而是 Kith-owned Canvas Command API、metadata/document/element/Frame/structure revisions、服务端派生影响集、atomic batch、幂等 ledger 与明确签发的 Agent capability。
8. `codex/development@4937690` 已实现“Chat 常驻 + 右侧 Workspace Tabs”：标签以 `moduleId + resourceId` 形成稳定身份、按 Space 持久化，URL 表达当前活动标签。Canvas 应扩展这个既有宿主，以 `canvasId` 作为 `resourceId`，不再新造顶层工作区状态机。早期 CodeGraph 索引仍返回旧单槽位实现，已以当前工作树源码纠正。

## 2. 产品原始意图与落地状态

用户提出的长期方向完整保留如下：

- Kith 继续以 Agent 聊天和多 Agent 协作为核心，右侧提供 Canvas、Browser 等多标签工作区，并与左侧聊天联动。
- Canvas 可承载文字、便签、图片、视频、链接、文件、手绘和 AI 生成内容，可组合为思维导图、流程图、灵感墙等，不局限于图片或视频生成。
- Human 可以圈选多个元素，通过画布输入框或聊天把选区作为上下文发送给 Agent。
- Agent 可以理解、整理、修改选区，并生成文字、图片、视频、思维导图或其他画布元素。
- Canvas 内容可发送到私聊、群聊或话题；Agent 结果可写回 Canvas 或发送到聊天。
- 多个 Agent 可在同一 Canvas 协作并拥有自己的工作区域；群聊消息和实际执行者分离，不默认唤醒所有 Agent。
- 支持多个 Canvas 标签；每个 Canvas 是独立无限平面，不增加用户可见 Page 层级。

这些方向不是 Recombyn 现成能力的同义词。实测差异如下：

| 能力 | Recombyn 当前事实 | Kith 处置 |
|---|---|---|
| 无限画布、平移缩放 | 已有，5%–10000% | 迁移 |
| Frame、文字、形状、手绘 | 已有 | 迁移 |
| 图片、视频、音频、Lottie、SVG | 已有导入/播放/部分编辑/导出 | 迁移编辑能力；资产改由 Kith 管理 |
| 多选、变换、分组、层级、对齐、布尔 | 已有 | 迁移 |
| 便签 | 无一等节点 | 后续新增或由样式化文字临时代替 |
| 链接/Web embed | 无一等节点，URL 仅是文本 | 后续新增 |
| 任意文件、PDF、DOCX | 不支持 | 后续新增文件卡片/预览管线 |
| 思维导图/流程图 | 无语义 edge/port/自动布局 | 后续新增语义层，不把普通箭头冒充完整能力 |
| AI 视频/音频 ToolOps | 没有对称原子工具 | 待 Kith 生成 Provider/job 落地 |
| 多 Agent 专属区域 | 不存在 | 新建 `CanvasAgentZone` 或 Frame reservation |
| 多 Canvas 标签 | 不存在 | 由 Kith Workspace Tabs 承担 |
| 无 Page 数据模型 | 不符合；Scene 仍有 `pages/activePageId` | MVP 固定一个隐藏内部 root，不暴露 Page；后续再去 Page 化 |

## 3. Recombyn 可移植边界

### 3.1 原样或近原样保留

- `apps/web/src/components/rcb/**`：camera、scene、paint、selection、frame、tool、LOD。
- `apps/web/src/components/editor/canvas/**`：输入工具、选择、剪贴板、拖放、右键菜单。
- `apps/web/src/components/editor/nodes/**`：文字、形状和媒体节点 UI。
- 编辑器 chrome、属性/图层/资产/导出面板的视觉结构、基础组件、主题、图标和许可通过的笔刷；资产数据语义与 Page 导出文案必须做宿主适配。
- `editor` feature Redux 的未提交手势、乐观投影与缓存；不保留能覆盖 Core canonical document 的本地/Yjs history。
- 24 个 Canvas action 的名称、参数语义与校验；开发阶段1逐项分类，Kith 另建 SVG sanitizer 和 Core policy。
- 设计 prompt 中与 placement、Frame、ID、危险操作、review 维度有关的规则。
- 28 个 foundation/domain design skills，按许可证和版本固定后作为可选 Canvas skills。

### 3.2 必须做宿主适配

- `CanvasDocumentStore`：从 IndexedDB + 云 API 改为 Kith Core/Space 权威存储。
- `CanvasAssetStore`：媒体写入 Space 本地资产目录，Scene 只保存稳定 asset ref，禁止 data URL 膨胀文档。
- `CanvasChatBridge`：选区发送目标从 Recombyn AgentDock 改为 Kith 私聊/频道/话题 Composer。
- `CanvasToolGateway`：ToolOps 从浏览器直接改 Redux，改为 Core command commit 后由 realtime 投影到 UI。
- `CanvasFileExportAdapter`：Tauri dialog/fs 改为 Electron preload/main 窄桥；浏览器保留受限下载。
- `CanvasAssetPanelAdapter`：保留 AssetPanel 视觉骨架，改接 Canvas-local asset library/import；image-to-scene/OCR 与 AI 资产后端延后。
- CSS/portal isolation：Recombyn Tailwind 3 独立构建并作用域化，隔离 Preflight，Kith 全局选择器排除 Canvas root，建立 scoped reset、token scope、独立 portal root 与 computed-style 门；若仍不能保持 UI，iframe/独立 renderer island 作为需重新决策的备选。

### 3.3 不移植

- Python/LangGraph `canvas_ops_v1` 执行循环和 Recombyn run lease/checkpoint。
- Recombyn 自有聊天、session、memory、模型 router、BYOK/wallet、Ask 流程和云附件。
- Coding CLI 临时 scene workspace + stdout JSON fence 兼容桥。
- Home/Auth/Account/Billing/Share 和原 projects 云 API。
- Tauri/Rust/Python sidecar。
- Yjs/collab 服务，至少不进入 MVP。

## 4. 提示词、工具与 Agent 引擎适配

### 4.1 Prompt 不应整包塞入每个 Agent

Recombyn 的 prompt pack 有 45 个 kind，包含 persona、intent、decide、paint、review、Ask、partial edit、资源加载和 legacy 兼容。Kith 的适配方式应是：

| Recombyn 内容 | Kith 处置 |
|---|---|
| `Recombyn Auto` persona/品牌 | 删除，保留当前 Kith Agent identity |
| intent 的 `chat/canvas_op/design` 分类 | 作为 Canvas skill 的任务判断参考 |
| Decide 的 Design Brief、按需 tool/skill | 迁为可选 skill 指令 |
| Paint 的 placement/ID/Frame/危险操作规则 | 迁为 Canvas tool contract 与 skill 约束 |
| Review 的七类评审 | 后续可选 reviewer task，不默认 fork swarm |
| legacy、Ask、自有 memory/session/model 文案 | 删除，由 Harness/设置/审批接管 |

普通 Agent 不会因为安装 Canvas 而被改造成统一的“设计 Agent”。只有当前任务需要 Canvas 时，Harness 才投影相关 capability 和 skills；Agent 仍保持原身份、职责、模型和记忆。

### 4.2 工具边界

Recombyn 的 24 个 action 全部进入适配 manifest，但只有 durable scene 子集成为内部原子 operation；Agent-facing 工具收敛为少量稳定 use case：

- `canvas.snapshot_get`
- `canvas.elements_get`
- `canvas.elements_apply`
- `canvas.context_bundle_create`
- `canvas.asset_import`
- `canvas.export`
- 后续 `canvas.job_create` / `canvas.job_get`

MCP 和 CLI 只负责 schema/transport；两者必须调用同一个 Canvas Module。`set_viewport` 默认属于临时 UI 能力，不与持久写 scope 混在一起。删除、覆盖、外部生成和导出使用独立风险 scope/审批。

### 4.3 群聊消息与执行者分离

源码核验表明，仅靠现有频道候选/响应模式或正文 `@Agent` 无法满足“保持原 surface、只执行一个 Agent”；正文 mention 还可能创建新 thread。因此 MVP 必须增加 server-owned Message Execution Binding：

- Human 消息仍对频道成员可见；
- eligible executor 必须未删除、v2、有当前 surface access 且实时拥有 `message:send`；
- snapshot、message/ref、binding 和 executor required delivery 同事务，其他 Agent 不获得 optional wake；
- Canvas Access Grant 只能从 binding + bound delivery 派生并逐调用重验；
- 每个实际执行者拥有独立 logical turn、attempt、capability 和 Canvas mutation provenance。

## 5. 候选目标架构

```text
Recombyn Canvas UI island
  -> Canvas UI adapter / feature Redux projection
  -> Kith Human Canvas API -----------------------┐
                                                  v
Kith Agent runtime -> MCP/CLI thin adapter -> Canvas Module
                                                  |
                                                  +-> command/CAS/idempotency policy
                                                  +-> workspace.db Canvas records
                                                  +-> Space-local asset store
                                                  +-> mutation ledger + realtime outbox
                                                  +-> Context snapshot resolver
```

建议新增的模块边界：

- `web/src/features/canvas/`：CanvasSurface、tabs bridge、feature store、UI host adapters。
- `src/canvas/`：Canvas use cases、contracts、policy、snapshot resolver、mutation ledger、asset/job ports。
- `src/server/routes-api/canvas.ts`：Human Transport Adapter，仅做认证/解析/序列化。
- `src/capabilities/canvasGatewayPort.ts`：Agent Gateway 窄端口，避免继续扩大 `capabilityGateway.ts` 的职责。
- `src/server/mcp/` 与 CLI：注册相同 schema 的薄工具。

Core 继续是唯一业务写入者。Renderer Redux 是交互投影，不是 durable truth；Yjs 不进入 MVP。

## 6. 数据、上下文与并发

### 6.1 每 Space 数据

候选数据对象：

- `canvases`：每个 Canvas 独立无限平面及单调 revision。
- `canvas_documents` 或 revisioned scene snapshot：保存 canonical SceneDocument；内部固定一个隐藏 root/page。
- `canvas_elements`/element revision 索引：支持局部读取和 CAS；最终是否拆表由文档体积实测决定。
- `canvas_mutations` + `canvas_mutation_ops`：actor、turn/attempt、operation key、request hash、base/result revision、revert provenance。
- `canvas_selection_snapshots`：不可变选区上下文。
- `canvas_assets`：Canvas 生命周期拥有的本地资产，不借用绑定聊天消息的附件生命周期。
- `canvas_agent_zones`：后续专属区域/Frame reservation，不等于 Page 或 chat session。

### 6.2 选区发给 Agent

现有 `MessageContextSnapshot.openObjectRefs` 不应直接塞 40–80 个节点。发送时先由 Canvas Module 冻结：

```text
CanvasSelectionSnapshot
  = canvasId
  + documentRevision
  + selected element/frame ids + revisions
  + bounded canonical projection
  + preview asset ref
  + selection hash
```

聊天消息只引用一个 `canvas_selection_snapshot:<id>`。注册式 `ContextObjectSnapshotResolver` 在 turn 开始时遍历所有 bound message 的规范 refs，把该不可变对象解析为 `turnContextSnapshots`；即使画布后来变化，Turn Inspector 仍能解释 Agent 当时看到的内容。

### 6.3 并发和撤销

- 不同元素：per-element revision CAS，可并行成功。
- 同一元素：revision 不匹配返回结构化 conflict，Agent 重新读取/规划，不静默覆盖。
- 多元素布局：携带所有 expected revisions，在一个 SQLite transaction 中全成或全败。
- Canvas 元数据：使用 expected canvas revision。
- presence/cursor/viewport/selection outline：短暂 LWW/内存态，不写 durable ledger。
- Undo：提交新的 inverse mutation，并记录 `revertsMutationId`；不删除历史。
- 长生成任务：先创建 durable job；完成时重新校验权限和目标 revision，冲突时保存为 unattached result，不覆盖新内容。

## 7. MCP 2026-07-28 决策输入

采用其**显式状态思想**，不把协议升级绑进 Canvas MVP：

- 每次调用显式携带 `canvasId`、selection bundle、job id 和 revision；不把“当前 Canvas/选区”藏进连接。
- 保留 `x-kith-session-handle` 对应的 Kith capability；它不是 `Mcp-Session-Id`。
- MVP 继续使用现有 broker-backed stdio MCP + CLI fallback。
- TypeScript MCP SDK v2/dual-era 作为独立后续切片，逐 runtime 实测后再启用 modern era。
- 只有出现外部 host、受控 LAN 标准入口或真实多实例需求时，才增加 modern Streamable HTTP endpoint。

详细证据与官方来源见 [Canvas × Agent 协议边界研究](canvas-mcp-protocol-research.md)。

## 8. 已确认 MVP

### MVP-A：Canvas UI island 与本地真相源

- 扩展 Kith 已有 Workspace Tabs，允许同一 `canvas` module 打开多个以 `canvasId` 区分的资源标签。
- 每个 tab 对应一个 `canvasId`；用户只看到一张无限平面，不看到 Page。
- 迁移 Recombyn RCB 编辑器内部 UI 与现有原生节点/编辑能力。
- Scene/command 落 Space SQLite；媒体落 Space-local Canvas assets。
- 完成 CSS/portal 隔离、NOTICE/第三方许可、Kith-owned SVG sanitizer 和三端路径适配；Scene JSON 只能经 Kith Import Service 转成受限 Core operations，不能直接替换 canonical scene。

### MVP-B：Chat 联动与冻结上下文

- 圈选多个元素，创建 selection snapshot，并发送到明确的私聊、频道或话题。
- Canvas 内输入框复用明确的 Kith conversation/executor，而不是创建第二套聊天记录。
- 消息显示 Canvas context chip/deep link；Turn Inspector 显示冻结的 Canvas 来源。
- 第一版提供“发送到聊天/发送到画布”命令；原生跨栏拖拽可后置。

### MVP-C：一个明确执行者的 Agent 回写

- 当前选中的一个 Kith Agent 通过 Canvas Gateway 读取、创建、修改、删除、排列和导出。
- Core 使用 revision、atomic batch、operation idempotency 和 mutation provenance 提交。
- Agent 的 Canvas mutation 与 server-owned chat reply 分开建模；聊天中可附 Canvas mutation 链接。
- MVP 不迁入 Recombyn Python Agent、Review swarm、Yjs 或 MCP SDK v2 大迁移。

### MVP 建议保留的 Recombyn 原生内容

- Frame、文字、形状、图片/视频/音频/Lottie/SVG、手绘；
- 多选、变换、分组、层级、锁定、对齐、分布、翻转、布尔；
- clipboard、导入、现有导出和 24 个 action 中可在 Kith 安全落库的部分。

### MVP 建议延后

- 一等便签、链接、任意文件/PDF/DOCX；
- 语义思维导图/流程图 edge/port/自动布局；
- AI 视频/音频完整生成管线和重型 OCR/SAM/LaMa；
- 多 Agent 同时自由修改同一区域、可见光标、区域租约和跨区协商；
- Review Agent tournament/swarm；
- Yjs 真人远程协作；
- 原生跨 Chat/Canvas 拖放；
- MCP SDK v2/Streamable HTTP 对外入口。

## 9. 后续路线

MVP 后按独立切片增加：

1. 一等便签、链接、文件卡片与 PDF/DOCX 预览。
2. 语义 connector、port、自动布局和思维导图/流程图工具。
3. `CanvasAgentZone`、Agent 可见 presence、区域 capability、跨区申请与冲突 UI。
4. 图片/视频/音频生成 Provider 与 durable job；生成结果可附着或进入待处理区。
5. Canvas ↔ Chat 原生拖放及 Browser 等其他 Workspace tab。
6. 可选 reviewer task、多 Agent 委派与结果合并；群聊可见消息继续与实际执行者分离。
7. 确有远程真人协作需求后，再评估 Yjs/CRDT；不因“多 Agent”三个字提前承担该复杂度。

## 10. 风险与验证门

- **规模**：RCB 有约 96 个 full SVG host / 4096 个代理框的既有 LOD 假设；媒体节点、长手绘、undo 50 项/64 MiB 和大图导出需要压力基线。
- **样式**：Kith/Recombyn 都定义 `--canvas/--surface/--ink/--accent`，Kith 全局字体规则会破坏 Recombyn UI；必须做真实浏览器像素与 portal 验证。
- **依赖**：React 小版本接近，但 Router/Vite/Tailwind 不同；Canvas island 不能带入 Recombyn Router 7/Vite 8/Tailwind 3 产品壳。
- **安全**：上游没有可复用的 Canvas SVG 安全链；Kith-owned sanitizer 必须覆盖资产、Scene import 和 op apply，媒体 CORS、FFmpeg WASM worker/CSP、文件大小和 Agent 生成内容另做 Core 门禁与限额。
- **local-first**：在线 Google Fonts/jsDelivr 必须改为许可核验后的本地打包；不得复制 Tauri 的 `$HOME/**` 广权限。
- **三端**：共享逻辑按 Windows/macOS/Linux 设计；文件保存通过窄平台 adapter，当前宿主定向测试加 CI/真实 smoke 说明其他平台证据。
- **恢复**：Core/renderer/Worker 在 command commit、realtime、渲染 ACK 任一边界崩溃后，必须能从 snapshot + operation sequence 恢复，不重复 mutation 或外部生成。

## 11. 已确认的 5 项产品决策

1. **UI 移植边界（1A）**：保留 Recombyn RCB 编辑器内部视觉和交互；不保留 AgentDock、Home/Auth/Billing/Share/Cloud/Tauri 产品壳。
2. **工作区壳层（2A）**：复用当前已实现的“左侧 Chat + 右侧 Workspace Tabs”；Canvas 可多开并按 Space 恢复，未来 Browser 等模块复用同一宿主。
3. **Agent runtime（3A）**：Kith Harness 是唯一 runtime；不保留 Recombyn LangGraph 兼容模式，只适配 ToolOps、prompt rules 和 design skills。
4. **发起与完成语义（4A）**：Canvas 调用绑定明确私聊/频道/话题与一个执行 Agent；Canvas mutation 和 server-owned Chat 回执都必须留存。
5. **MVP 边界（5A）**：先交付 Recombyn 原生编辑能力、多 Canvas 标签、选区发 Chat、一个明确 Agent 的 revisioned 回写；便签、链接、任意文件、语义图、多 Agent 区域与 AI 视频/音频后置。

正式方案见 [Recombyn Canvas Workspace 设计规格](../../specs/2026-08-15-recombyn-canvas-workspace-design.md)。

## 12. 关键源码证据

- Recombyn 许可：`reference/recombyn/LICENSE:67`、`:90`、`:139`，`reference/recombyn/NOTICE:1`。
- RCB 架构：`reference/recombyn/docs/canvas-architecture.md:7`、`:29`、`:67`。
- Scene/Page：`reference/recombyn/apps/web/src/components/rcb/sceneNode.ts:12`、`:72`、`:80`。
- 选择发送：`reference/recombyn/apps/web/src/components/editor/panels/agent/canvasAttach.ts:21`。
- ToolOps：`reference/recombyn/apps/api/seeds/canvas_actions_seed.json:2`，`reference/recombyn/apps/api/app/services/design/ops/tool_ops_contract.py:918`。
- Agent 执行：`reference/recombyn/apps/api/app/services/design/runtime/graph/build.py:612`，`reference/recombyn/apps/web/src/components/editor/panels/agent/runDesignAgent.ts:3633`。
- Kith 标签状态与稳定资源身份：`web/src/shell/workspaceTabs.ts:7`、`:69`、`:116`、`:155`。
- Kith 标签 UI 与现有 Chat/工作区并排宿主：`web/src/shell/WorkspaceTabs.tsx:19`、`web/src/shell/WorkspaceFrame.tsx:313`、`:381`。
- Kith UI 权威说明：`docs/kith-space/ui-direction.md:37`、`:61`、`:141`。
- Kith Context：`src/context/messageContextSnapshot.ts:12`，`src/context/contextAssembler.ts:346`。
- Kith durable turn/Gateway：`src/deliveries/deliveryJournal.ts:39`，`src/turns/turnOutputService.ts:369`，`src/capabilities/capabilityGateway.ts:515`。
