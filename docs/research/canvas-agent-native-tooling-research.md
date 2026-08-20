# Kith Canvas Agent 原生操控研究

> 日期：2026-08-18；实现追记：2026-08-19  
> 范围：对照当前 Kith 阶段四实现与 reference/recombyn 原生画布 Agent 工具链，解释“Grant 已可用但 Agent 不操作画布”的原因，并给出后续实现契约。  
> 结论性质：研究与方案。下方“实现追记”记录已落地的收敛，不改写上文的历史根因分析。

## 实现追记（2026-08-19）

用户确认：自然语言意图分析主要由 Canvas skill/Agent 自己完成。服务端不再用正则主导 edit/question/read/export。

已落地：

- Canvas skill 明确要求 Agent 自己判断，并在编辑任务中执行 `scene_summary → typed mutation → verify → turn.reply`。
- ContextAssembler 不再把 heuristic intent 注入成 `mutationRequired=yes`。“怎么添加文字 / 如何修改 Frame”等问句不再被服务端写成 edit。
- `canvasIntentGate` 降级为显式 Agent intent 的后置 policy/telemetry；默认 `unknown`。当前没有可靠的 Agent finish/intent 输入，因此 `turn.reply` **不做**自然语言硬拦截（`enforcedOnReply=false`）。服务端只校验 Grant/action、mutation 是否提交、以及 `outputRefs` 是否绑定本 Turn mutation。
- `create_image`/`create_lottie`/`create_icon` 的 `assetId` 必须存在且属于当前 Canvas；`create_frame` 自定义 id 不能是 `ROOT` 或与已有 element/Frame 冲突；`update_node`/`delete_nodes` schema 在缺目标时即拒绝。
- CLI 已补齐 create_text/shape/image 与 update_node 常用字段。Gateway 仍接受 `update_node.patch`；CLI 不解析 JSON patch。

仍未完成：真实 Desktop/Web Agent smoke、Recombyn 式 finish 硬约束、媒体生成 job、阶段5硬化。不移植 Python/LangGraph runtime。

## 结论先行

当前问题不是 Canvas Access Grant 本身，而是 Agent-facing API 的抽象层级和执行提示不足：

1. Kith 已能在带冻结选区的 Turn 中派生 Grant，并通过 MCP/CLI 进入同一个 Canvas Core；写入安全边界基本存在。
2. 但 Agent 看到的主要写入口是 canvas.elements_apply，其 operations 是 z.record(z.string(), z.unknown()) 数组。模型需要自行猜 ToolOp 名称、参数、父 Frame、revision 和执行顺序。
3. Kith Canvas skill pack 只有能力发现和工具名列表，没有“先读选区 → 选择 Frame → 调用具体 create/update → 验证 → reply”的任务协议，也没有明确禁止通过项目源代码探索 Canvas。
4. Recombyn 则把每个画布动作注册为独立工具（如 create_text、create_shape、create_image、update_node），每个工具有严格 schema、模型提示和独立描述；另有 get_scene_summary、list_capabilities、finish 元工具。
5. Recombyn Prompt Pack 明确区分 decide/paint：编辑任务必须输出非空 ToolOps；创建内容要遵循 Frame/父级/坐标规则；只有 Canvas 工具成功后才允许 finish。Kith 当前没有等价的 intent gate 或完成约束，因此 Claude 可能选择“查看代码并解释”而不是直接调用 Canvas。

因此，正确方向不是移植 Recombyn Python/LangGraph runtime，也不是绕过 Kith Gateway，而是在现有 Grant + Gateway + Canvas Core 上补一层 Kith 原生 Agent Canvas Tool Contract。

## 一、源码证据

### 1. Kith 当前链路

- src/context/contextAssembler.ts:586-592：只有在开发开关开启且当前 Turn 有 Grant 时才注入 Canvas skill pack。
- src/canvas/canvasSkills.ts:3-16：文本只要求发现 canvas.read/write/export，列出 snapshot_get、elements_get、elements_apply 和 ToolOps 名称；没有操作流程、示例、完成条件或场景摘要协议。
- src/server/mcp/stdio.ts:123-148：MCP 暴露 snapshot_get、elements_get、泛化 elements_apply、export、context_bundle_create、asset_import。其中 elements_apply.operations 是任意 record 数组（:131-136），对模型不是强类型工具接口。
- src/canvas/canvasGatewayTools.ts:142-207：Gateway 先读取 live scene，再将任意 operations 交给 mapCanvasToolOps，分析影响集、校验 Grant、执行 Core CAS；安全执行层已经统一，但模型如何选工具和参数仍未建模。
- src/turns/turnScheduler.ts:473-512：Canvas skill pack 作为 assembled.renderedContext 注入 runtime；它不是模型原生工具定义，也没有在 runtime 层形成 Canvas 专用执行阶段。
- src/daemon/prompt.ts：通用 Harness prompt 只规定 turn/reply/MCP 使用方法，没有 Canvas 编辑意图门禁；Agent 仍可使用其原生代码工具探索 workspace。

### 2. Recombyn 当前链路

- reference/recombyn/apps/api/app/services/llm/design_tools.py:205-237：从 Admin/action registry 读取启用的 Canvas action。
- design_tools.py:252-280：提供 get_scene_summary、list_capabilities、ask_user、finish；get_scene_summary 的描述要求“不确定画布状态或 artboard 时调用”，finish 明确要求“Canvas tools 成功后才能结束”。
- design_tools.py:311-319、:339-369：每个 op_key 都被注册为独立 function tool；参数由 schema 动态生成 Pydantic model，extra=forbid，并形成 OpenAI/LangChain 原生工具定义。
- reference/recombyn/apps/api/seeds/design_prompt_packs/stages/decide.md:9-34：决定阶段要求 edit/create 在 schema 已加载时必须产生非空 tool_ops，不允许只聊天；工具细节缺失时先加载工具。
- reference/recombyn/apps/api/seeds/design_prompt_packs/stages/paint.md:3-18：Paint 阶段“唯一任务”是输出非空 ToolOps；明确 Frame、父级、坐标、已有节点 ID 和多画板规则。
- paint.md:27-37：编辑优先 update_node，删除需确认，失败后读取 LAST_ERROR 并重新输出非空 ToolOps。
- reference/recombyn/apps/api/app/services/design/runtime/graph/nodes/apply.py:205-206,519-523：ToolOps 应用后等待 scene feedback，再决定是否继续/重试；不是提交一个 JSON 后立即认为完成。

## 二、根因判定

### P0：模型工具面过于泛化

elements_apply 把 20+ 个动作压缩成一个低级批处理工具。对模型而言，当前选区是元素还是 Frame、新元素应使用哪个 createParent、海报属于新 Frame 还是修改现有 Frame、create_text/create_shape/create_image 的必需参数、revision 从何处取得、写入后是否需要验证，都需要自行推断。这会把画布编辑退化成代码/API 推理任务，正好解释了 Agent 去看项目代码。

### P0：缺少 Canvas intent 到 action 的强契约

用户说“在选中的 Frame 上画一张海报”时，Kith 没有系统级规则要求：

snapshot_get → elements_get 或 scene_summary → create/update tools → verify → turn.reply(outputRefs)

因此模型可能只输出计划、询问、生成聊天附件，或者使用代码工具完成旁路产物。

### P1：缺少场景反馈和完成态

Kith mutation 返回 revision/impact，但没有模型可见的 scene_summary 高层结果，也没有类似 Recombyn finish 的“无 mutation 不得宣称完成”工具或服务端完成约束。

### P1：工具描述没有承载 placement/craft 规则

Kith 仅列出 ToolOps 名称；Frame 内坐标、create parent、不要 delete+create 变形、媒体必须先 import 等关键规则没有跟随具体工具 schema 输出。

### P1：媒体生成能力与画布写入能力尚未闭合

当前 create_image/create_lottie/create_icon 只接受已有 assetId；传入 url、genPrompt 或 dataUrl 会被拒绝（src/canvas/canvasToolOps.ts:189-197）。因此“画一张海报”若需要新生成的主视觉，Agent 没有 Canvas 内原生生成入口，容易退回聊天附件或自行写 SVG。typed tools 解决工具发现后，还必须把图像/视频生成做成受 Grant 约束的 durable asset job，再以 asset_import 或 create_image 回写；不能把远程 URL 直接放进 Scene。

## 三、推荐目标架构

保留已有安全边界：

Kith Harness Turn → server-owned CanvasAccessGrant → MCP/CLI thin adapter → Agent-facing Canvas Tool Contract → CanvasGateway → mapCanvasToolOps / Core CAS / SQLite

### 1. Agent-facing 独立工具

新增工具不改变 Core 写入机制，只改变模型看到的接口。第一批建议：

- canvas.scene_summary
- canvas.snapshot_get
- canvas.elements_get
- canvas.create_frame
- canvas.create_text
- canvas.create_shape
- canvas.create_image
- canvas.create_svg
- canvas.update_node
- canvas.update_frame
- canvas.delete_nodes / canvas.delete_frame
- canvas.group_nodes / canvas.align_nodes / canvas.reorder_nodes
- canvas.asset_import、canvas.export

elements_apply 保留作为低级兼容或批量内部工具，但不再作为模型首选入口。每个公开工具都应使用 z.object(...).strict()，并在 Gateway 内转换成同一套 Recombyn-shaped ToolOp，再进入现有分析、授权和 Core transaction。

### 2. canvas.scene_summary

返回紧凑、面向模型的状态，而不是让模型解析完整 Scene JSON：

{
  canvasId, snapshotId, revision,
  selectedFrames: [{id, name, x, y, width, height}],
  elements: [{id, type, parentId, bounds, text}],
  allowedCreateParents
}

它对应 Recombyn get_scene_summary，避免 Agent 为了确定画布状态去读取仓库源码。

### 3. Canvas Skill Contract

当 Turn 有 Canvas Grant 时，注入短而强的系统契约：

本 Turn 带有冻结 Canvas 选区。

如果用户要求绘制、生成海报、添加文字或图片、修改 Frame、排版或整理画布：
1. 不要查看项目源代码来了解 Canvas。
2. 先调用 canvas.scene_summary；需要历史证据时再调用 canvas.snapshot_get。
3. 对现有内容调用 canvas.elements_get；创建内容时使用授权的 allowedCreateParents。
4. 直接调用对应的 canvas.create_* 或 canvas.update_* 工具，不要把操作改写成聊天计划。
5. 写入成功后检查 mutationId、revision、createdIds 和 updatedIds；必要时再次 scene_summary。
6. 只有实际 mutation committed 后，才可用 turn.reply，并在 outputRefs 写入 canvas_mutation。
7. 没有 Canvas mutation 成功，不得声称“已画好/已修改”。

纯问答、解释工具能力、导出或查看选区可以不触发 mutation；这是通用 Canvas intent gate，不是海报专用硬编码。

### 4. 结果反馈

每次写工具返回稳定结构：status、mutationId、operationId、canvasId、snapshotId、previousRevision、revision、createdIds、updatedIds、deletedIds、impact、nextSuggestedAction。它不替代 Core ledger，只是给模型的下一步反馈。

## 四、实施切片

### Slice A：Contract 与 manifest

- 从 reference/recombyn/apps/api/seeds/canvas_actions_seed.json 导出 Kith allowlisted ToolOps manifest。
- 给第一批工具定义严格 Zod schema、描述、示例和 Grant action 映射。
- 统一 MCP 与 CLI 的工具名、输入、错误码和结果结构。
- 为 scene_summary 增加只读 Gateway 入口。

### Slice B：首批 typed tools

实现 scene_summary、create_frame、create_text、create_shape、create_image、update_node、delete_nodes。内部仍调用 mapCanvasToolOps、analyzeCanvasOperationBatch、CanvasCore.apply。

### Slice C：Prompt / Agent-owned intent

- 扩展 canvasSkills.ts 为 Canvas Skill Contract，要求 Agent 自己判断 edit/question/read/export。
- 在 Context Assembler 中输出当前 grant 的 revision、Frame、create parents 和 workflow。
- **不要**用自然语言正则把问句写成 edit，也不要把 heuristic intent 注入成 `mutationRequired=yes`。
- 服务端后置校验只覆盖 Grant/action、mutation 是否提交、outputRefs 是否绑定本 Turn。没有 Agent finish/intent 工具时，不要伪造 turn.reply 硬拒绝。

### Slice D：feedback/finish/reply 约束

- 写工具返回结构化 mutation feedback。
- 增加 canvas.finish 或等价的服务端完成检查。
- Canvas intent Turn 若没有已提交 mutation，拒绝“完成”式 turn.reply；显式 ask/cede 例外。
- 记录 activity 和 Turn Inspector 的工具调用与 mutation 关系。

### Slice E：扩展 ToolOps 与生成媒体

再接入 SVG、Lottie、分组、对齐、布尔、媒体 import/job；不把远程 URL 或 data URL 绕过资产门禁。

### Slice F：真实 smoke

固定验收场景：选中 Frame → 发送到私聊 → “给我画一张海报”。Agent 轨迹必须出现：scene_summary 或 snapshot_get、至少一个 typed Canvas mutation tool、成功 mutation feedback、turn.reply.outputRefs 中的 canvas_mutation；且不读取项目源代码作为 Canvas 操作前置条件。

## 五、非目标与安全边界

- 不移植 Recombyn Python/LangGraph Agent runtime、run lease、Redux 直写或 SSE 协作协议。
- 不让 MCP transport/session 充当 Canvas 身份、ACL、revision 或事务。
- 不删除 elements_apply；它保留给兼容和内部批量路径。
- 不在没有 Grant、冻结选区或 eligible executor 时开放 Canvas 写入。
- 不把所有包含“画布”字样的聊天都强制改画；intent gate 必须区分读取、解释、导出和编辑。

## 六、最终判断

阶段四的安全基础已经足够，但 Agent 原生操控能力尚未完成。当前应把阶段四拆成“安全回写已完成”与“Agent-native tooling 补齐”两个连续子切片；在 Slice A–D 完成并通过真实 Claude smoke 前，不应把“Agent 能像 Recombyn 一样操控画布”视为完成。
