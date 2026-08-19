# Canvas Agent 效果对齐方案

> 日期：2026-08-19
> 状态：Accepted（决策点已确认）
> 基线：阶段 4 已落地（typed tools + Gateway + Grant + skill pack stub）
> 目标：让 Kith-space Agent 操控画布的效果对齐 Recombyn 原生 Agent 水平
> 关联文档：`2026-08-15-recombyn-canvas-workspace-design.md`
> 参考源码：`reference/recombyn/`（`apps/api/app/services/design/`、`skills/`、`apps/api/seeds/`）

## 1. 问题与根因

### 1.1 现象

Agent 操控画布效果差：
- 叫它创建红色矩形，放了个无色矩形
- 复杂任务（海报、排版）质量远不如 Recombyn 原生 Agent
- 工具参数经常用错（fill 格式、放置位置、frame 归属等）

### 1.2 根因

工具本身（24 个 ToolOps action）已基本移植完整，差距不在工具层，而在 **Agent 操作画布的"操作系统"缺失**。

| 维度 | Recombyn 原生 | Kith-space 当前 | 差距级别 |
|------|-------------|----------------|----------|
| 工具描述 | 每个工具有详尽 model_hint + args_schema | 一句话描述 | ⭐⭐ 中 |
| 参数覆盖 | 完整（fillType/gradient/stroke全套/角半径/混合模式等） | typed tools 仅暴露子集 | ⭐⭐ 中 |
| 多阶段编排 | intent→decide→paint→observe→review→correction→final | 单轮自由 tool call | ⭐⭐⭐⭐⭐ 致命 |
| 设计技能系统 | 28 个 skills（11 foundation + 17 domains），含完整 playbook | ~40 行 capability discovery 文本 | ⭐⭐⭐⭐⭐ 致命 |
| 结构化输出协议 | 自定义 JSON 协议（thought/intent/design_brief/tool_ops/choice_ui），服务端强校验 | 原生 MCP tool call（自由格式） | ⭐⭐⭐ 大 |
| 错误重试 | LAST_ERROR code + fix 提示 + paint_retry 专用 prompt | 错误直接抛出，无结构化重试引导 | ⭐⭐⭐ 大 |
| 评审闭环 | 7 条独立评审线，<70重建/70-89修复/90+通过 | 无 | ⭐⭐⭐⭐⭐ 致命 |
| 设计 Brief | 结构化 design_brief 作为执行契约 | 无 | ⭐⭐⭐⭐ 严重 |
| 图像/视频生成 | 内置火山引擎 Seedream + 视频生成，genPrompt 直接生成 | 完全不可用（genPrompt 被拒） | ⭐⭐⭐⭐ 严重 |
| 模型路由 | fast/standard/reasoning/vision 四档按任务选模型 | 单模型跑全部 | ⭐⭐⭐ 大 |

### 1.3 为什么"红色矩形"变成无色

具体到这个例子，四层缺失共同导致：
1. **工具描述太薄**：没有强调 fill 参数的格式和必要性
2. **无 paint 阶段 prompt**：Recombyn paint_system 专门写了 "Fills: solid → fill=#RRGGBB|rgba(…)"
3. **无错误重试**：参数缺失/格式错误时直接失败，Agent 不知道怎么修正
4. **无 review 自检**：画完不检查，错了就错了

---

## 2. 总体策略

### 2.1 核心思想

**不重建 Recombyn 的 LangGraph runtime，但移植它的"Agent 操作方法论"。**

Kith 已有 Harness、MCP/CLI Gateway、Canvas Core 这些基础设施，比 Recombyn 的 Python 后端 + SSE + 前端解析 JSON 更现代化。问题不在架构，在内容厚度。

正确做法：把 Recombyn 已验证有效的"Agent 操作画布的方法论"移植为 Kith 体系内的 **skill pack 扩展 + 工具增强 + 多轮引导**。

### 2.2 架构评价

现有架构方向正确：
- ✅ MCP/CLI 双 transport + 统一 CapabilityGateway — 比 Recombyn 更干净
- ✅ Canvas Core 作为唯一真相源 + revision CAS — 比 Recombyn 前端乐观更新更严谨
- ✅ CanvasAccessGrant 权限模型 — 比 Recombyn 简单用户鉴权更精细

需要补充的是内容厚度：工具描述、操作协议、设计技能、媒体生成。

### 2.3 已确认决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Skill 系统形态 | 混合模式：系统推荐 + Agent 自主加载 | 兼顾可靠性与自主性，对齐 Recombyn 做法 |
| 图像生成 provider 策略 | 先只接入火山引擎（Doubao Ark / Seedream） | 简单、效果有保障，先跑通闭环 |
| 生成任务交互模式 | 图片同步阻塞、视频异步 | 图片 5-15s 可接受；视频几分钟必须异步 |
| Review 机制投入 | Phase 2 先做 skill 内自检清单，Phase 4 升级完整评审 | 先有再优，分阶段投入 |

---

## 3. 三层能力模型

```
┌─────────────────────────────────────────────────────┐
│  第三层：Design Skill Pack（设计能力）                │
│  Foundation skills + Domain skills + Review 流程     │
│  让 Agent 会"设计"，而不只是"调用工具"               │
├─────────────────────────────────────────────────────┤
│  第二层：Canvas Craft Protocol（操作协议）           │
│  操作流程引导 + 结构化错误重试 + scene 上下文格式    │
│  让 Agent 正确、稳定、高效地调用工具                 │
├─────────────────────────────────────────────────────┤
│  第一层：Canvas Tools（工具底座，已有）              │
│  完整参数 + 详尽描述 + 错误码 + 缺失工具补全         │
│  让工具本身描述充分、参数完整、能力完整              │
└─────────────────────────────────────────────────────┘
```

---

## 4. 第一层：工具底座增强（Phase 0）

**目标**：只改描述和参数，不改架构，快速提升基础操作正确率。
**预计投入**：1-2 天
**验收**：叫 Agent "创建一个红色矩形" → 正确率从 <50% → >80%

### 4.1 补全 typed tools 参数 schema

从 RECOMBYN `canvas_actions_seed.json` 完整移植参数。

#### create_shape 新增参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `fillType` | solid \| linear \| radial \| angular \| diffuse \| image? | 填充类型 |
| `fillEnd` | string? | 渐变结束色 |
| `gradientAngle` | number? | 渐变角度（度） |
| `strokeAlign` | center \| inside \| outside? | 描边对齐 |
| `strokeStyle` | solid \| dashed \| dotted? | 描边样式 |
| `strokeLinecap` | butt \| round \| square? | 描边线帽 |
| `strokeLinejoin` | miter \| round \| bevel? | 描边连接 |
| `strokeOpacity` | number 0-100? | 描边不透明度 |
| `cornerRadius` | number? | 圆角半径 |
| `rotation` | number? | 旋转角度 |
| `blendMode` | string? | 混合模式 |
| `opacity` | number? | 不透明度 |
| `flipX`, `flipY` | boolean? | 翻转 |
| `path` | string? | SVG d 或点列表（pen/pencil/path） |
| `closed` | boolean? | 路径是否闭合 |
| `sides` | number? | 多边形/星形边数 |
| `brushStyle` | string? | 铅笔笔触 id |
| `brushHardness` | number 0-100? | 笔触硬度 |
| `pathPressure` | string? | 压力值 CSV |
| `pressureEnabled` | boolean? | 是否启用压力 |

#### update_node 新增参数

同上（所有样式/几何参数），加上：
- `stroke`, `strokeAlign`, `strokeStyle`, `strokeLinecap`, `strokeLinejoin`, `strokeOpacity`
- `fillType`, `fillEnd`, `gradientAngle`
- `cornerRadius`, `rotation`, `blendMode`, `opacity`
- `flipX`, `flipY`
- `fontSize`, `fontWeight`, `fontFamily`（文本节点）
- `name`（已有）
- `hidden`, `locked`（已有）

#### create_text 新增参数

- `height`（已有）
- `fontWeight`, `fontFamily`（已有）
- 补充 `rotation`, `opacity`, `blendMode`, `name`（已有）等通用属性

### 4.2 补全 typed tools 种类

优先补上 Agent 做排版最常用的：

第一批（Phase 0 一起做）：
- `canvas.update_frame` — 更新画框
- `canvas.align_nodes` — 对齐
- `canvas.distribute_nodes` — 分布
- `canvas.reorder_nodes` — 图层顺序
- `canvas.group_nodes` — 成组
- `canvas.ungroup_nodes` — 解组
- `canvas.duplicate_nodes` — 复制
- `canvas.flip_nodes` — 翻转
- `canvas.boolean_op` — 布尔运算
- `canvas.set_canvas_background` — 画布背景

第二批（Phase 1 按需）：
- `canvas.create_svg`, `canvas.create_icon`, `canvas.create_lottie`

### 4.3 增强工具描述（移植 model_hint）

把 RECOMBYN 每个工具的 `model_hint` **完整移植**为 MCP 工具的 description。这是投入产出比最高的改动。

示例（create_shape 的 model_hint 摘录）：
```
Add a shape. Args: shapeType|type = rect|ellipse|circle|line|arrow|triangle|polygon|star|path|pen|pencil...
Fills: solid → fill=#RRGGBB|rgba(…); gradient → fillType=linear|radial|angular|diffuse + fill + fillEnd + gradientAngle?
NEVER put CSS linear-gradient()/radial-gradient()/conic-gradient() in fill — rejected by host.
Icons: prefer primitives + boolean_op (cutouts/combines); create_svg/create_icon only for simple single-path marks.
For Q-illustration / pencil sketch do NOT collage with circles — use multiple pencil strokes with pressure.
```

注意：
- 保持英文（模型对英文指令更敏感），可在末尾加中文关键词辅助
- 描述要具体到参数级别，不能泛泛而谈
- 要包含"不要做什么"（负面约束比正面描述更有效）

### 4.4 结构化错误反馈（LAST_ERROR 机制）

仿照 RECOMBYN `format_op_error`：
```
code=invalid_fill; fix="use fill=#RRGGBB or rgba(…), never CSS gradient()"; detail="fill=linear-gradient(red,blue)"
```

实现要点：
1. `canvasToolOps.ts` 中的每个验证失败点都返回结构化错误（code + fix + detail）
2. `canvasGatewayTools.ts` 的 `mapCanvasToolError` 把错误转成带 code/fix/detail 的 HarnessError
3. **关键**：在下一轮 turn 组装时，如果上一轮 canvas 工具调用失败，把 LAST_ERROR 注入到系统提示中，引导 Agent 修正
   - 注入位置：`contextAssembler.ts` 的 canvas skill pack 部分
   - 注入内容：`LAST_CANVAS_ERROR: code=xxx; fix=xxx; detail=xxx`
   - 只注入最近一次错误

### 4.5 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/canvas/canvasAgentTools.ts` | Zod schema 补全参数 + 新增工具 + 描述替换为 model_hint |
| `src/canvas/canvasGatewayTools.ts` | 新增 typed mutation 分发（update_frame/align/...） |
| `src/canvas/canvasToolOps.ts` | 确认底层 patch 已支持所有参数（应该已支持，只需验证） |
| `src/canvas/canvasSkills.ts` | 增加 LAST_ERROR 注入逻辑说明（实际注入在 contextAssembler） |
| `src/context/contextAssembler.ts` | 增加上轮 canvas 错误注入 |
| `src/capabilities/capabilityGateway.ts` | 新增 gateway 方法（与新工具一一对应） |
| `src/server/mcp/stdio.ts` | 注册新 MCP 工具 |
| `src/cli/index.ts` | 注册新 CLI 命令 |

---

## 5. 第二层：Canvas Craft Protocol（Phase 1）

**目标**：让 Agent 从"乱调用工具"变成"专业操作画布"
**预计投入**：3-5 天
**验收**：Agent 做简单海报时，会先 create_frame，再在 frame 内放内容，布局合理，不在自由画布乱飞

### 5.1 操作流程引导协议

大幅扩展 `canvasSkills.ts` 中的 `CANVAS_CAPABILITY_DISCOVERY`，移植 RECOMBYN 的：

#### Paint 阶段规则（paint_system）
- 放置协议（frame vs 自由画布）
- 同批次 create_frame + 内容的 frameId 绑定
- FOCUS frame 权威（目标 frame 内操作）
- 填充格式规范（重点强调 fillType + 禁止 CSS gradient）
- 编辑协议（优先 update_node，不删除+重建）
- 多画板规则（一个 create_frame 一个板地画）
- 图标规范（用 create_icon/create_svg，禁止 emoji 作图标）
- DELETE 安全（frame 用 delete_frame，不用 delete_nodes）

#### Edit 协议（edit protocol）
- 目标元素定位（从 scene_summary 的 id 引用）
- 类型 morph 用 update_node shapeType，不用 delete+create
- 清画板用 delete_nodes/delete_frame，不用满屏覆盖矩形

#### Placement / Boards 规则
- canvas_op（简单增删改）→ 自由画布坐标
- design create → 先 create_frame，再在 focus frame 内放
- 新任务 vs 已有 board → 创建新 frame，不修改 ambient boards
- 尺寸推断（poster→1080x1920, phone UI→390x844, dashboard→1440x900）

### 5.2 scene_summary 输出格式优化

让 `canvasSceneSummary.ts` 的输出格式对齐 RECOMBYN 喂给模型的格式：

```
=== CANVAS_SCENE ===
canvasId: <id>
revision: <n>
documentRevision: <n>

=== SCENE_FRAMES ===
- <frameId>: <name> x=<n> y=<n> width=<n> height=<n>
  FOCUS_FRAME: <frameId>  (only when single frame in grant)

=== SCENE_NODES ===
- <nodeId>: <key> name=<name?> x=<n> y=<n> w=<n> h=<n> parent=<parentId> frame=<frameId?>
  style: fill=<fill?> shapeType=<shapeType?> fontSize=<fontSize?>
  text_preview: <first 40 chars if text>

=== GRANT ===
actions: read_snapshot, read_live, write_existing, create, ...
createParents: ROOT, <frameId>, ...
selectedElements: [<ids>]
selectedFrames: [<ids>]
```

为什么要对齐格式？因为模型在训练和微调中见过大量类似格式的画布操作数据，格式越接近，表现越好。

### 5.3 工具延迟加载机制（可选优化）

RECOMBYN 用了"先给工具目录（names + 一句话），Agent 说 need_tools 后再注入完整 schema + hint"的策略来省 token。

Kith 用 MCP 天然有 tool schema 注入（MCP protocol 自带 tool 列表），不需要手动搞目录。但如果未来发现 token 压力大，可以考虑只注册核心工具，其他通过 `canvas.tool_details(name)` 动态查询。

**Phase 1 不做**，观察 token 使用情况再说。

### 5.4 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/canvas/canvasSkills.ts` | 大幅扩展 skill pack 文本（paint_system + edit protocol + placement rules） |
| `src/canvas/canvasSceneSummary.ts` | 优化输出格式，对齐 RECOMBYN SCENE_NODES/SCENE_FRAMES 结构 |

---

## 6. 第三层：Design Skill Pack（Phase 2）

**目标**：从"会操作工具"升级到"会做设计"
**预计投入**：5-7 天
**验收**：叫 Agent "设计一张万圣节活动海报" → 成品有设计感（构图、色彩、层次、排版）

### 6.1 Skill 系统架构

```
Agent 发现可用 skills（canvas.skill_list）
  → Agent 判断需要哪个/哪些
  → Agent 调用 canvas.skill_get("poster_craft")
  → Skill 内容作为系统提示注入
  → Agent 按 skill playbook 操作
```

### 6.2 新增工具

| 工具 | 描述 |
|------|------|
| `canvas.skill_list` | 列出可用 skills（skill_key + displayName + when_to_use + 一句话描述 + category） |
| `canvas.skill_get` | 加载指定 skill 的完整内容（playbook 全文） |

两个都是只读工具，不需要写权限，有 `read_snapshot` 或 `read_live` 即可用。

### 6.3 Foundation Skills（第一批移植 6 个）

| skill_key | 作用 | 优先级 |
|-----------|------|--------|
| `design_brief` | 设计简报方法论（purpose/audience/emotion/visual_thesis/...） | P0 |
| `composition` | 构图 archetypes 与规则 | P0 |
| `color` | 色彩理论与配色策略 | P0 |
| `typography` | 排版阶梯与字体选择 | P0 |
| `anti_ai_slop` | 反 AI 俗套禁令（紫蓝渐变/玻璃卡片/等距功能卡/随机粒子…） | P0 |
| `polish` | 打磨与自检清单 | P1 |

为什么这 6 个最关键：design_brief 是所有设计任务的起点，composition/color/typography 是三大基础能力，anti_ai_slop 是防止千篇一律的关键。

### 6.4 Domain Skills（第一批移植 3 个）

| skill_key | 适用场景 | 优先级 |
|-----------|----------|--------|
| `poster_craft` | 海报/易拉宝/KV | P0 |
| `landing_page` | 落地页/官网首页 | P1 |
| `banner_ad` | 横幅广告 | P1 |

`poster_craft` 优先——这是用户提到"能绘制比较成熟的海报"的核心技能。

### 6.5 Skill 内容结构

每个 skill 是一个 Markdown 文件，遵循 RECOMBYN 的结构：

```markdown
# <Skill Name>

Deliverable: <适用场景>.
Kernel still Decide → Paint → Observe → Review. This skill owns craft process.

## Process (mandatory order)
INPUT → BRIEF → ART DIRECTION → LAYOUT PLAN → DESIGN SYSTEM → EXECUTION → OBSERVE → REVIEW → CORRECTION → FINAL

## 1. Brief (P0)
<设计简报模板>

## 2. Composition
<构图 archetype 列表 + 默认硬规则>

## 3. Typography
<排版规则>

## 4. Color
<色彩策略>

## 5. Execution stack
<执行步骤：先做什么后做什么>

## Hard rules
<硬性禁令清单>

## Done when
<完成标准>

## Related
<关联 skills>
```

### 6.6 Skill 存放位置

```
src/canvas/skills/
  foundation/
    design_brief.md
    composition.md
    color.md
    typography.md
    anti_ai_slop.md
    polish.md
  domains/
    poster_craft.md
    landing_page.md
    banner_ad.md
  skillRegistry.ts   — 注册、查询、分类
  skillLoader.ts     — 读取 skill 文件、注入系统提示
```

Skill 内容是纯文本 Markdown，和 Recombyn 一样从文件加载，方便迭代和贡献。

### 6.7 Skill 选择引导

在 Canvas skill pack（第二层）中加入 skill 目录和选择指导：

```
=== CANVAS_SKILLS_CATALOG ===
Available design skills (use canvas.skill_get to load full content):

Foundation:
- design_brief: Structured design brief template (purpose/audience/emotion/visual_thesis/composition)
- composition: Layout archetypes and composition rules
- color: Color theory and palette strategies
- typography: Type ladders and font selection rules
- anti_ai_slop: Common AI design clichés to avoid
- polish: Refinement and self-review checklist

Domains:
- poster_craft: Poster / roll-up / KV design playbook
- landing_page: Landing page / homepage design playbook
- banner_ad: Banner ad design playbook

How to choose:
- New design from scratch → load ONE primary surface skill (poster_craft / landing_page / ...) + design_brief
- Just recolor / rearrange → no skill needed, use typed tools directly
- Style/color decisions → load color + composition
```

### 6.8 Skill 注入机制

Agent 调用 `canvas.skill_get("poster_craft")` 后，skill 内容通过什么机制进入系统提示？

**方案**：`canvas.skill_get` 的返回值就是 skill 的完整 Markdown 内容。Agent 会把它读入上下文。同时，为了强化效果（和 Recombyn 的"注入系统提示"等价），我们可以在 Gateway 侧维护一个 "loaded skills" 列表，每次 turn 组装时把已加载的 skill 内容追加到 Canvas skill pack 后面。

简化版（Phase 2 先用这个）：Agent 自己从 tool 返回值读取 skill 内容并记住。优点是实现简单，缺点是 Agent 可能忽略。

强化版（Phase 2+ 升级）：服务端跟踪 loaded skills，每次 turn 自动注入。更接近 Recombyn 效果。

**Phase 2 先做简化版**，验证 skill 内容本身的有效性后再升级。

### 6.9 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/canvas/skills/skillRegistry.ts` | 新增：skill 注册与目录 |
| `src/canvas/skills/skillLoader.ts` | 新增：skill 文件读取 |
| `src/canvas/skills/foundation/*.md` | 新增：6 个 foundation skills |
| `src/canvas/skills/domains/*.md` | 新增：3 个 domain skills |
| `src/canvas/canvasGatewayTools.ts` | 新增 skill_list / skill_get 执行方法 |
| `src/capabilities/capabilityGateway.ts` | 新增 gateway 方法 |
| `src/server/mcp/stdio.ts` | 注册新 MCP 工具 |
| `src/cli/index.ts` | 注册新 CLI 命令 |
| `src/canvas/canvasSkills.ts` | 扩展 skill pack，加入 skill catalog 引导 |

---

## 7. 第四层：图像/视频生成接入（Phase 3）

**目标**：补齐媒体生成能力，让 Agent 能做有视觉冲击力的设计
**预计投入**：5-7 天
**验收**：Agent "做一张有赛博朋克城市背景的海报" → 自动生成背景图并放到合适位置

### 7.1 模型设置扩展

在设置中新增 **图像模型** 和 **视频模型** 配置页。

#### 增加火山引擎（Doubao Ark）Provider

现有 provider 列表：OpenAI / Anthropic / DeepSeek / 自定义
新增：**火山引擎**（backendId: `volcengine`，apiKind: `openai-completions` — 因为火山 API 是 OpenAI 兼容的）

其实火山引擎的文本 API 和图像 API 用的是同一套密钥（同一 endpoint base），所以：
- 文本模型：已有 DeepSeek 等，火山可作为新增文本模型选项
- 图像模型：Seedream 系列（走 images.generate 接口）
- 视频模型：Seedance 系列（走 videos 提交+轮询接口）

#### 设置页新增内容

在"模型设置"下增加：
1. **图像生成模型** 配置区
   - 默认图像模型选择
   - 支持的模型列表（Seedream 5.0 Lite / Pro / 4.5 / 4.0）
   - 分辨率选项（1K / 2K / 4K）
2. **视频生成模型** 配置区
   - 默认视频模型选择
   - 支持的模型列表（Seedance 2.0 Fast 等）
   - 默认时长（5s / 10s）

技术上，图像/视频模型属于 **Generation Model**，和文本 Chat Model 是同一 provider 下的不同能力。在 `ModelConfiguration` 中扩展 `capabilities` 字段（已有 `inputCapabilities`，增加 `outputCapabilities: ["text", "image", "video"]`）。

### 7.2 图像生成服务

新建 `src/media-generation/` 模块：

```
src/media-generation/
  contracts.ts          — 类型定义
  imageService.ts       — 图像生成服务
  videoService.ts       — 视频生成服务
  volcengineProvider.ts — 火山引擎 provider 实现
  jobStore.ts           — 生成任务持久化
  canvasAssetBinder.ts  — 生成结果 → Canvas asset 绑定
```

#### 图像生成流程

图片生成用同步阻塞模式（一般 5-15 秒）：

1. Agent 调用 `canvas.image_generate({ prompt, aspectRatio?, resolution?, model? })`
2. Gateway 校验：grant 有 `create` + `import` 权限
3. 调用火山引擎 images.generate API
4. 下载图片 → 存入 CanvasAssetStore（staged → ready）
5. 返回 `{ assetId, width, height, model, seed? }`
6. Agent 接着调用 `canvas.create_image` 带上这个 assetId

为什么不让 image_generate 直接创建 image 节点？
- 保持工具单一职责（生成 = 生成资产，放置 = 放置节点）
- Agent 可以控制放置位置、大小
- 和 asset_import 的模式一致（先有 assetId，再 create_image）

### 7.3 视频生成流程

视频生成用异步模式（几十秒到几分钟）：

1. Agent 调用 `canvas.video_generate({ prompt, duration?, aspectRatio?, model?, firstFrameAssetId? })`
2. 创建生成 job（状态：pending）
3. 返回 `{ jobId, status: "pending" }`
4. Worker 后台执行：提交到火山引擎 → 轮询 → 下载 → 存 asset → 创建 video 节点 → 写 mutation
5. Agent 可用 `canvas.job_status(jobId)` 查询进度
6. 完成后通过 realtime event 通知前端

### 7.4 与 Canvas 的集成点

- `canvas.image_generate`：新增工具，走 Canvas Gateway，需要 `import` scope
- `canvas.video_generate`：新增工具，走 Canvas Gateway，需要 `import` scope
- `canvas.job_status`：新增工具，查询生成任务状态
- `canvas.job_list`：新增工具，列出当前 canvas 的生成任务

### 7.5 后续可扩展

- 图生图（image-to-image）
- 图片处理（upscale / removeBg / replaceText / expand 等）
- 多 provider 抽象层（接入 OpenAI DALL·E / Midjourney 等）
- Lottie 生成

这些都不是 MVP 必须的，先把基础图像生成做通。

### 7.6 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/media-generation/contracts.ts` | 新增 |
| `src/media-generation/volcengineProvider.ts` | 新增：火山引擎 API 调用 |
| `src/media-generation/imageService.ts` | 新增：图像生成服务 |
| `src/media-generation/videoService.ts` | 新增：视频生成服务 |
| `src/media-generation/jobStore.ts` | 新增：生成任务持久化 |
| `src/canvas/canvasGatewayTools.ts` | 新增 image_generate / video_generate / job_status 执行 |
| `src/capabilities/capabilityGateway.ts` | 新增 gateway 方法 |
| `src/server/mcp/stdio.ts` | 注册新 MCP 工具 |
| `src/model-control/` | 扩展模型配置支持 image/video capabilities |
| `web/src/views/model-settings/` | 新增图像/视频模型设置 UI |

---

## 8. 第五层：Review 与质量闭环（Phase 4，后续）

**目标**：接近 Recombyn 的完整评审质量门效果
**状态**：规划中，Phase 3 之后再启动

### 8.1 自检清单（轻量版，Phase 2 已在 polish skill 中包含）

每个 domain skill 自带 "Done when" + "Hard rules" + 自检清单。
Agent 完成操作后，按清单自检，发现问题自行修正。

### 8.2 独立 Review 循环（完整版）

类似 Recombyn 的 7 条评审线：
1. composition（构图）
2. hierarchy（层次）
3. typography（排版）
4. color（色彩）
5. consistency（一致性）
6. anti_slop（反俗套）
7. originality（原创性）

实现方式：
- Agent 调用 `canvas.review()` 工具
- 工具内部调用 LLM（同一个 runtime，不同 system prompt），按 7 条线打分
- 输出评分 + issue 列表 + fix_hint
- Agent 根据评审结果决定是否修正

评分门槛：
- < 70 → 重建（建议重新设计）
- 70-89 → 修复（针对 issue 修正）
- 90+ → 通过

这部分涉及更多 LLM 调用（token 成本），作为后续优化项。

---

## 9. 实施路径与验收标准

### Phase 0：工具底座增强（1-2天）

**目标**：补全参数、增强描述、结构化错误
**验收标准**：
- [x] typed tools 参数 schema 完整覆盖 RECOMBYN model_hint 中列出的所有参数
- [x] 工具描述替换为 Recombyn 级别的详尽 model_hint
- [x] 10 个常用 typed tools 补全（update_frame、align/distribute/reorder、group/ungroup、duplicate、flip、boolean_op、set_canvas_background）
- [x] 结构化错误码 + fix 提示机制生效
- [ ] 基础操作测试：创建红色矩形 → 正确有红色（成功率 > 80%）——自动化已覆盖 fill 写入与 CSS gradient 拒绝；真实 Agent smoke 仍待本机 Desktop
- [x] `pnpm run typecheck` 通过
- [x] `pnpm run web:build` 通过

### Phase 1：操作协议层（3-5天）

**目标**：让 Agent 专业地操作画布
**验收标准**：
- [ ] Canvas skill pack 扩展完成（paint_system + edit protocol + placement rules）
- [ ] scene_summary 输出格式对齐 Recombyn（SCENE_FRAMES / SCENE_NODES / FOCUS_FRAME / GRANT 分区）
- [ ] 操作测试：让 Agent "做一个简单的海报（标题+副标题+一个装饰形状）"
  - 会先 create_frame
  - 内容都在 frame 内
  - 文本有正确的颜色和大小
  - 形状有正确的填充色
- [ ] 编辑测试：让 Agent "把标题改成蓝色" → 正确 update_node，不删除重建

### Phase 2：设计技能系统（5-7天）

**目标**：从"会操作"到"会设计"
**验收标准**：
- [ ] skill_list / skill_get 工具可用
- [ ] 6 个 foundation skills 移植完成
- [ ] 3 个 domain skills 移植完成（poster_craft 优先）
- [ ] skill catalog 正确注入 Canvas skill pack
- [ ] 海报设计测试：叫 Agent "设计一张万圣节活动海报"
  - 会主动加载 poster_craft skill
  - 有结构化 design brief
  - 构图完整（hero + title + support text + CTA）
  - 色彩氛围符合主题
  - 层次清晰
- [ ] anti_ai_slop 禁令生效：不出现紫蓝渐变、玻璃卡片等俗套

### Phase 3：图像/视频生成接入（5-7天）

**目标**：补齐媒体生成能力
**验收标准**：
- [ ] 火山引擎 provider 接入（文本 + 图像 + 视频）
- [ ] 设置页有图像模型和视频模型配置
- [ ] canvas.image_generate 工具可用（同步）
- [ ] canvas.video_generate 工具可用（异步 job）
- [ ] 生成的图片正确存入 Canvas asset
- [ ] 综合测试：叫 Agent "做一张有赛博朋克城市背景的海报"
  - 自动调用 image_generate 生成背景
  - 背景图正确放置在 frame 内
  - 标题文字在背景之上且可读

### Phase 4：Review 与质量闭环（后续）

**目标**：接近 Recombyn 完整评审效果
**验收标准**：待 Phase 3 完成后细化

---

## 10. 关键技术决策记录

### 决策 1：MCP vs CLI vs 自定义协议

**结论**：保持 MCP + CLI 双 transport，不引入自定义 JSON 协议。

理由：
- MCP 的结构化 tool call 比 Recombyn 的"输出 JSON 数组让后端解析"更现代、更可靠
- Recombyn 用 JSON 数组是因为 2024 年时 structured tool use 还不成熟
- CLI fallback 对 Pi runtime 是必须的
- 两者已经共享同一 Gateway 层，架构正确

### 决策 2：Skill 加载方式

**结论**：混合模式（catalog + 按需加载），Phase 2 先用简化版（Agent 自己读 tool 返回值），后续升级服务端注入。

### 决策 3：图像生成 Provider

**结论**：先只接火山引擎（Doubao Ark + Seedream），效果有保障、API 兼容 OpenAI、实现简单。

### 决策 4：生成任务交互模式

**结论**：图片同步阻塞（5-15s 可接受），视频异步 job。

### 决策 5：Review 机制

**结论**：分阶段。Phase 2 先做 skill 内自检清单，Phase 4 再做独立评审循环。

---

## 11. 风险与注意事项

### 11.1 Token 成本

大量 skill 内容 + 详细工具描述 + scene_summary 会增加 token 消耗。
- 缓解：skill 延迟加载（不调用 skill_get 就不注入全文）
- 缓解：scene_summary 只返回授权范围内的元素摘要（已做）
- 监控：观察实际使用中的 token 数据，再决定是否需要进一步压缩

### 11.2 Skill 内容质量

Recombyn 的 skills 是经过大量迭代打磨的，我们直接移植能保证质量。但要注意：
- 内容是英文的，需要保留英文（模型对英文设计术语更敏感）
- 可以补充中文关键词辅助，但主体保持英文
- 要在 "Hard rules" 中明确禁止使用 emoji 作图标、禁止 CSS gradient 等常见错误

### 11.3 生成服务稳定性

火山引擎 API 可能有速率限制、故障等情况：
- 实现重试机制（指数退避）
- 失败时清晰报错，Agent 可以重试或换方式
- 生成任务超时处理（图片 60s，视频 600s）

### 11.4 与现有架构的兼容

- 所有新增工具都必须走 CapabilityGateway + CanvasAccessGrant 鉴权
- 写入操作必须经过 revision CAS
- 生成的图片必须走 CanvasAssetStore，不能直接写 URL
- 所有新功能受 `KITH_CANVAS_AGENT_EXECUTION` 开关保护吗？
  - 图像/视频生成：需要独立的 feature flag（`KITH_MEDIA_GENERATION`），因为它有外部 API 调用和费用
  - skills：不需要额外 flag，因为它只是 prompt 内容，不产生外部调用

---

## 12. 参考资源

### Recombyn 关键文件

**工具定义**：
- `reference/recombyn/apps/api/seeds/canvas_actions_seed.json` — 24 个 ToolOps 的完整定义（model_hint + args_schema）
- `reference/recombyn/apps/api/app/services/design/ops/tool_ops_contract.py` — 验证合约 + 错误格式

**系统提示词**：
- `reference/recombyn/apps/api/seeds/design_prompt_packs/stages/decide.md` — decide 阶段系统提示
- `reference/recombyn/apps/api/seeds/design_prompt_packs/stages/paint.md` — paint 阶段系统提示
- `reference/recombyn/apps/api/seeds/design_prompt_packs/stages/review.md` — review 阶段系统提示
- `reference/recombyn/apps/api/seeds/design_prompt_packs/stages/intent_precheck.md` — intent 分类

**Skills**：
- `reference/recombyn/skills/foundation/` — 基础技能（11 个）
- `reference/recombyn/skills/domains/` — 领域技能（17 个）
- 重点参考：`skills/domains/poster_craft/`

**图像/视频生成**：
- `reference/recombyn/apps/api/app/services/llm/image.py` — 图像生成服务
- `reference/recombyn/apps/api/app/services/llm/video.py` — 视频生成服务
- `reference/recombyn/apps/api/app/services/llm/__init__.py` — 模型目录 + provider URL

**Agent 运行时**：
- `reference/recombyn/apps/api/seeds/agents/profiles/design.canvas.yaml` — AgentProfile 定义
- `reference/recombyn/apps/api/app/services/design/runtime/orchestrator.py` — 编排器
- `reference/recombyn/apps/api/app/services/design/runtime/graph/build.py` — LangGraph 构建
