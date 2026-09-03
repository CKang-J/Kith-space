# Recombyn 画布设计质量差距分析：为什么同样的提示词效果略逊于原项目

> 日期：2026-09-02
> 问题：画布功能已从 recombyn 移植并完成 P0–P3 修复（实时同步、工具描述、skill 系统、生图 job），但同样的提示词与设计要求，Kith 的产出仍略逊于 recombyn 原生内置 Agent。
> 方法：对两侧代码库并行深挖（原生 Agent 机制 / Kith 集成现状 / skill 逐项 diff / 未移植清单），关键结论已逐条核实源码。

## 一、一句话结论

差距不在某个单点，而是**四个层级的机制叠加**。原项目的输出质量由一条完整闭环保证（brief 门禁 → 绘制 → 真实场景回喂 → 七车道评审分值门 → repair/polish 重试预算 → 合规终门）；Kith 目前是「单回合工具调用 + 错误反馈注入」，质量完全依赖模型自觉。技能库只移植了 9/28 且触发/协作机制全部丢失。

## 二、四层差距

### 层级 1：流程闭环（最大差距）

| 机制 | recombyn 原生 | Kith 现状 |
|---|---|---|
| 阶段编排 | LangGraph 状态机 `bootstrap → intent_classify → decide → paint_ops → action → observe → review → settle`（`apps/api/app/services/design/runtime/graph/build.py:612`） | 单回合工具调用，无阶段划分 |
| brief 门禁 | decide 阶段强制 design_brief P0 字段（purpose/audience/emotion/visual_thesis/visual_hero/composition/avoid），不全则不 stash、带 `design_brief_missing` 重试（`graph/nodes/decide.py:393-499`） | 无强制；design_brief skill 是"建议加载" |
| 场景回喂 | `observe` 是 HITL 中断点：等画布稳定后回传真实 scene_nodes/frames/preview_image（`graph/nodes/observe.py:1013`），前端 `runDesignAgent.ts:3651` 快照回传 | 无回喂阶段；模型想读状态需主动调 `canvas.scene_summary` |
| 确定性 critique | observe 计算事实（hero 覆盖率、h1/h2 比、溢出、重叠、anti-slop 命中）喂给评审（`review.py:784-893 deterministic_lane_seed`） | 无；无任何服务端计算的布局事实 |
| 评审循环 | 7 车道并行评分（composition/hierarchy/typography/color/consistency/content/originality + anti_slop），带画布 PNG 的 vision（`review.py:1742-1791`）；运行时门禁 `<70 重建 / 70-89 修复 / 90+ 通过`（`review.py:609-632`） | 无评审循环。`design_review` skill 未移植；`polish` 虽已移植但**无任何调用方**（grep 全 src 仅测试与静态目录行） |
| 修复重试 | must_fix → 编译 Repair Plan（纯修复 op、禁 create_）或减法 polish 轮（只删/对齐/缩小）或整轮回 paint，受 review_left 预算约束（`review.py:1865-2123`） | 无服务端重试；依赖模型读 `LAST_CANVAS_ERROR` 自行修正参数（该机制存在且可用：`canvasSkills.ts:380-407` 注入 skill pack） |
| 合规终门 | P41 governance（品牌对比度/WCAG/版权/相似度），fail 则 settle 拦截（`governance.py:162-376`） | 无（Kith 有 intentGate 但 `enforcedOnReply:false`，纯遥测，`canvasIntentGate.ts:12-13`） |
| 模型路由 | 按阶段/任务车道化选型（fast/standard/reasoning/vision/image 五道 + LLM 车道分类器 + review 独立模型，`runtime/models_route.py:992-1134`） | Kith 用 agent 自身模型配置，无 per-stage 路由、无 vision 车道 |

### 层级 2：知识层（skill 系统）

权威基线是移植 manifest（`web/src/features/canvas/manifests/upstreamDisposition.ts`）：28 个 skill 中 25 个定级 `migrate_as_skill`、3 个 defer（brush_ops/image_gen/motion_lottie）。

- **数量**：实际只移植 9 个（foundation 6 + domains 3）；16 个定级 migrate 的未移植（foundation：design_review/design_system/imagery/layout/responsive/visual_direction；domains：awesome_design_md/dashboard_ui/ecommerce_surface/garden_style/icon_set/long_scroll/mobile_app_ui/resume_layout/shadcn_ui/type_specimen）。注：image_gen 当时 defer 的原因是"生成 Provider/job 是 post-MVP"——该依赖现已打通（phase3），可解除 defer。
- **内容**：已移植的 9 个全部是重写而非照搬（逐字保留率 2%~46%）。五类删减模式：① 分值/评审运行时机制整段删除（polish 的 "score 70-89 → Repair Plan" 变成定性清单）；② 对未移植附属 skill 的引用被剪除或内联；③ 跨领域判别句删减；④ references/examples/review 附件层整层消失（poster_craft 原 16 个 md 压成 1 个）；⑤ 重写数值漂移（typography 行宽 40-70 改 50-75）。移植方也新增了 host 级禁令（禁 CSS gradient、catalog fonts only），属同向强化。
- **触发与协作机制全部丢失**：原项目 `_meta.json` 声明式机制——`triggers`（intent_in + 中英文关键词 + scene 过滤 + **否定窗口**防"不要海报风"误触）、`extends` 继承链（poster_craft extends 7 个 foundation）、`mutex_group`、`context_mode`（rules/full 预算档）、`preferred_tools`（形成画布 op 硬白名单 ACL）、`prompt_negative`、`locales`。Kith 侧 skillRegistry 只有 7 个信息字段，触发靠"模型读 catalog 自觉"（`canvasSkills.ts:341-345`），无关键词匹配代码、无继承链、无互斥、无 ACL。
- **注入方式差异**：原项目「目录先行、详情按需」——decide system prompt 只含 catalog 一行条（≤16 条），模型声明 need_skills 后详情以 user 消息 pending_blocks 注入（6000 字截断，`runtime/graph/turns.py:437-452`）。Kith 把整个 skill pack（设计原则全文 + 能力发现 + grant 明细 + 静态目录）**每轮渲染期重算并整块追加**在上下文末尾（`contextAssembler.ts:586-591`），无预算截断、不进冻结 envelope。

### 层级 3：感知层

- recombyn 每轮注入 `scene_digest` + `edit_context`（≤2500 字，含 fill）；review 阶段还通过 canvasAttach 把画布**栅格化成 PNG** 给 vision 模型看（`canvasAttach.ts`）。
- Kith 的 `canvas.scene_summary`（模型主动调用）有硬上限：空选 50 节点 / 否则 80（`canvasSceneSummary.ts:16,178`），文本预览截 40 字（`:249`），selection snapshot 文本字段 ≤240 字、单轮 ≤8 个快照；且画布快照在上下文预算紧张时属较早被驱逐的类别（`contextAssembler.ts:375-385`）。
- 无视觉通道：Kith 无任何"把画布变成模型可见图像"的工具。

### 层级 4：工具层（大部分已对齐）

2026-08-19 工作已把核心工具描述提升到接近原版 model_hint 水平（如 boolean_op 描述基本逐句转写并有增益）。剩余缺口：

- **未实现的 deferred op**：`outline_text`（fontkit 转路径）、`image_process`——`canvasToolOps.ts:62` 占位，执行即抛错。
- **op 层已实现但无 typed 工具**：`create_svg`/`create_icon`（sanitizer 已就绪）、`create_lottie(assetId)`、`create_audio`、`create_video(assetId)`、`delete_frame`——只能绕 `elements_apply` 底层通道；而 create_shape 的工具描述（`canvasAgentTools.ts:356`）却指引 "Only use create_svg…"，模型面前没有这个 typed 工具。
- **参数级缺口**：`update_node` 排版参数（textAlign/lineHeight/letterSpacing/fontStyle/textDecoration——底层 DATA 结构支持，typed schema 无入口）、`boolean_op` resultId、`update_frame` x/y 位移、`reorder_nodes` order 数组语义。
- **描述不均衡**：align/distribute/reorder/group/flip/duplicate 类仅一句话，无示例与逐参说明；enum 值只存在于 zod schema 不进 description。
- `update_node` 保留 `patch` 逃生舱（`canvasAgentTools.ts:176`）——模型可绕过类型校验写任意 key。

## 三、优化方案（按优先级，全部 Kith-native，不触碰锁定决策）

锁定约束：Kith Harness 是唯一 Agent runtime（决策 3A），不移植 LangGraph；不把 45 类 prompt 全局注入；MVP 后路线第 7 条已备案"可选 reviewer task"。以下方案是该约束内的等价物。

### P0 — 低挂果实（每项 <1 天）

1. **补移植 16 个定级 migrate 的 skill**（清单见上；image_gen 解除 defer）。沿用现有 9 个的"侧车精华并入单 md"格式，把 references/examples/review 的关键数值与检查表保留，避免二次丢失。
2. **结构化触发**：给 `skillRegistry` 增加 triggers 字段（intent_in/prompt_includes_any 中英文关键词 + 否定窗口，移植原项目 `skill_store/runtime.py:1041-1142` 语义），在 `canvasSkillPackText` 组装时做服务端预筛选：触发命中的 skill 核心节直接注入 pack。把"模型自觉加载"变成"默认已注入、模型可再加载"。
3. **评审自检协议（纯 skill 层）**：移植 design_review + 在 `CANVAS_DESIGN_PRINCIPLES` 增加 settle 前协议——mutation 完成后必须重读 `canvas.scene_summary`、按检查表评审、must_fix 必须修复、然后才 `turn.reply`。复刻原项目 "Prioritize DESIGN_BRIEF fidelity"（`review.py:1689`）的优先级措辞。
4. **指引一致性**：补 typed `create_svg`/`create_icon`（sanitizer 已就绪，manifest 定级 migrate_as_tool_policy），或把 create_shape 描述里的 create_svg 指引改为 boolean_op。
5. **感知量提升**：scene_summary 文本预览 40→120 字、快照文本 240→400 字；复核上下文预算驱逐顺序中画布快照的优先级。

### P1 — 中等工程（每项 1-3 天）

6. **确定性 critique 事实区**（observe 的 deterministic_lane_seed 最便宜的高保真移植）：scene_summary 由服务端零 LLM 成本计算 hero 覆盖率、h1/h2 字号比、越界节点、重叠节点对、anti-slop 命中，作为结构区输出。模型拿事实自评远准于空想。
7. **补 typed 工具面**：create_svg/create_icon、delete_frame、update_node 排版参数、boolean_op resultId、update_frame x/y、reorder order 语义；arrange 类描述从 `canvas_actions_seed.json` 的 model_hint 直接移植补齐。
8. **视觉闭环（需评估）**：`canvas.render_png` 工具把画布栅格化供 vision 模型评审（原项目 canvasAttach + review vision 车道的等价物）。成本取决于 renderer 服务端化方案（Electron 桥 or headless），评估后决定 P1/P2。

### P2 — 较大工程 / 路线图

9. **可选 reviewer 任务**：turn settle 前可选拉起 reviewer 用同一 grant 读 scene_summary 跑 design_review（MVP 后路线第 7 条已备案）。实现前需用户决策：是否默认开启、用哪个模型。
10. **eval 基线**（解决"感觉差一点"不可度量）：移植原项目 `eval/design-agent/` 思路——同一批提示词 + rubric（refs good/bad）建 10-20 个任务，改动前后跑分对比；后续可接"eval 结果反哺 skill 硬规则"的自进化机制（原项目 `pack_io.py:762-1152`）。
11. **生成链路收尾**（phase3 规格自标遗留）：job 轮询工具（agent 现在只能盲猜重读 scene_summary）、前端进度 UI、video 节点播放、真实 API key 联调 smoke。

### 运营注意

- `KITH_CANVAS_AGENT_EXECUTION` 生产打包默认 fail-closed（`src/desktop/processCommands.ts:29` 注释 "packaged stays fail-closed"；dev 注入 "1"）。**打包版里画布 agent 执行是关闭的**，发布前必须决策：打包版打开、还是做成设置项。

## 四、未移植清单（分类）

### A. 决策性不移植（锁定决策 3A / 非目标，不应补）

| 原项目 | 理由 |
|---|---|
| Python LangGraph runtime 全套（graph/build.py、nodes/decide·paint·observe·review·settle、models_route、governance、checkpoint/resume） | 决策 3A：Kith Harness 是唯一 Agent runtime |
| 45 类 prompt packs（`apps/api/seeds/design_prompt_packs/`） | manifest 多数 delete/replace；部分 defer（paint_retry/recover_edit_retry 已被 Kith LAST_ERROR 机制等价覆盖） |
| runDesignAgent.ts / designTools.ts 执行层（SSE 编排、rebase、AIOperationQueue） | Kith CanvasMutationService 替代 |
| agentMemory / designAgentEventRouter / useChatSessions / canvasAttach / boardModes | Kith memory/事件/附件体系替代；canvasAttach 的"画布→PNG 视觉"能力以 render_png 提案补回（P1-8） |
| Python agent-sdk / skill-sdk / scene-builder-py / intelligence-client | 私有后端/离线工具，非在线 Agent 路径 |
| apps/api（FastAPI）、apps/collab、Home/Auth/Billing/Share/Cloud、Tauri/Rust sidecar | 产品壳/云架构 |
| plugins/canvas（watermark 3 文件已迁）、plugins/skills/festival_poster | 插件体系非 MVP |
| eval-framework + eval/design-agent 套件 | 见 P2-10 提案 |
| e2e / perf / deploy 栈 | 桌面单机无部署栈 |
| Yjs/CRDT、便签/链接卡/PDF、语义图、多 Agent 区域 | MVP 非目标 |

### B. 定级应移植但未完成（对应 P0-1）

- 16 个 skill（manifest `migrate_as_skill` 但 `src/canvas/skills/` 缺失）。
- image_gen（defer 理由已失效，生成链路 phase3 已打通）。
- 已移植 9 个 skill 的附件层（references/examples/review 侧车内容在"合并单文件"时被丢弃的部分）。

### C. ToolOps 缺口（manifest 有定级）

- `outline_text`（defer：需 fontkit + 授权本地字体门；历史质量计划 P1.2 仍标未实现）。
- `image_process`（defer：需 durable image job + provider）。
- `set_viewport`（replace_with_kith：临时建议，已实现为语义）。
- `export_canvas`（replace：`canvas.export` 已实现）。
- op 层已实现但 typed 工具未暴露：create_svg / create_icon / create_lottie(assetId) / create_audio / create_video(assetId) / delete_frame。

### D. 生成链路遗留（phase3 规格自标未完成）

备选 stability/runway provider（规格 3.4 未勾选）、prompt 内容审查（规格 6.1 声称有但代码未见）、Agent 轨迹/前端进度 UI（turnOutputArtifacts 只认 `canvas_mutation` kind）、video 节点播放 UI。

### E. 前端 UI 未迁（决策性：产品壳删除）

AgentDock 系列组件、ChatTurnList、boardModes（2 文件）、2 个品牌资产（dreamina.png / sync_lipsync.png，来源未验证而排除）、本地字体 SmileySans-Oblique.woff2（46 家族字体目录数据已全量一致）。

## 五、验证方式

实施任何一项后，用同一批提示词与设计要求做前后对照；P2-10 的 eval 基线落地后改为量化对比。当前所有"效果差"判断均为主观感受，无客观度量是首要治理对象（即先做 P2-10 或至少手工固定一组测试提示词）。
