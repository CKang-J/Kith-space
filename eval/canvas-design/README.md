# Canvas 设计 eval 基线

衡量画布设计产出质量的前后对比基线，回答「改动之后到底变好还是变差」：同一批任务提示词，改动前跑一遍打分留底，改动后重跑对比。

- **任务套件**：`tasks/*.json`，16 个原创中文任务，覆盖 8 个已移植 surface（poster / landing_page / banner_ad / icon_set / dashboard / mobile_app / type_specimen / resume），每个 surface 低/高复杂度各 1 个。
- **打分器**：`src/canvas/canvasEvalScore.ts`，纯函数、确定性（复用 `canvasSceneFacts` 的几何/样式事实，零 LLM 成本）。单测见 `src/canvas/canvasEvalScore.test.ts`。
- **runner**：`run.mjs`，对一份真实 workspace DB 里的画布打分并追加记录到 `results.json`。

## 前后对比工作流

1. **固定改动前基线**：在改动前的代码上，用相同会话设置逐条手动运行 16 个任务提示词（发给画布 Agent），每个任务导出/记下对应 canvasId。
2. **逐任务打分**：

   ```bash
   node eval/canvas-design/run.mjs --db <Space>/workspace.db --canvas <canvasId> --task poster-001
   ```

   控制台输出逐项 PASS/FAIL 表；结果（含时间戳、分支、git rev、canvas revision）追加进 `eval/canvas-design/results.json`。全部通过时退出码 0，否则 1。
3. **实施改动**（skill 文本、工具描述、事实口径等）。
4. **改动后重跑同一批任务**，重复步骤 1–2。
5. **对比**：对比两次 `results.json` 中相同 taskId 的 `passedCount/totalCount` 与逐项 `pass`；退步项（尤其 `anti_slop_hits_eq[0]`、`hero_coverage_between`）回看对应 skill 硬规则是否需要修正。

## 检查项类型

打分器对整张画布（无 grant 范围）计算事实后逐项判定；阈值含端点。

| 检查项 | 判定 | 事实缺失时 |
|---|---|---|
| `hero_coverage_between[min,max]` | 主视觉（最大非文本节点）面积占可视区（聚焦画板或画布）比例落在区间内 | 视口未知 → FAIL |
| `no_out_of_bounds` | 无越界节点（相对所属画板与画布的完全/部分越出均为 0） | — |
| `h1_h2_ratio_between[min,max]` | 最大/次大字号比落在区间内 | 少于两档字号 → FAIL |
| `anti_slop_hits_eq[n]` | anti-slop 命中总数（渐变填充 + 蓝紫渐变 + emoji + 半透明白 + 过度圆角）等于 n | — |
| `node_count_at_least[n]` | 节点总数 ≥ n | — |
| `text_nodes_at_least[n]` | 文本节点数 ≥ n | — |

检查名写错、参数解析失败都会直接抛错退出（fail loudly），不会静默算 PASS。

## 任务编写规范

- 每个任务一个 `<taskId>.json`：`id`、`surface`、`expectedSkill`、`prompt`、`checks`、`notes`。
- `prompt` 用用户视角的中文一句话 + 补充要求，与真实使用语气一致；任务内容必须原创，不复制上游文案。
- `checks` 阈值对应该 surface skill 的 Hard rules（如 poster 的 hero 60–85%、层级比 ≥1.25、anti-slop 归零）；拿不准时宁可用宽松区间，避免把风格偏好写成硬门。
- 一个 canvas 对应一个任务；多画板任务先只对主画板打分，或拆成多任务。
- 新增 surface 时先确认 `src/canvas/skills/domains/` 已有对应 skill 且 `computeCanvasSceneFacts` 能覆盖其关键事实。

## 边界与已知限制

- 打分器只看几何/样式事实（覆盖率、层级比、越界、slop），评不了创意与审美；主观项仍靠人看。
- 不跑真实生成（会花钱）：image/video provider 的联调 smoke 属于手动步骤——在 Settings 配好 provider 后用一条 `canvas.create_image(genPrompt)` + `canvas.generation_status` 轮询验证，不计入本 eval。
- `results.json` 是 append-only 的历史记录；想要干净重跑先自行归档旧文件。
