# Canvas Agent 操作问题根因分析

> 日期：2026-08-19
> 问题：Agent 操作画布后，前端没有实时更新；样式参数（颜色、圆角）经常无效

## 一、问题现象

### 1.1 实时更新问题
- **现象**：Agent 调用工具创建或修改元素后，画布上看不到变化，必须手动刷新页面
- **成功案例**：创建黑色圆形 → 立即显示
- **失败案例**：创建/修改其他形状 → 必须刷新才显示

### 1.2 样式参数问题
- **现象**：要求红色矩形 → 创建了透明矩形；要求圆角 + 颜色 → 仍然透明无圆角
- **表现**：元素能被选中（说明创建成功），但样式属性没有生效

---

## 二、根因分析

### 问题 1：实时同步缺失（致命）

#### 2.1 实时事件发布机制

**HTTP API 路由**（`src/server/routes-api/canvas.ts`）：
```typescript
// 第168行：HTTP API 会发布实时事件
const snapshot = core.apply({ ...body, canvasId });
await publish(ctx.spaceId, { 
  type: "canvas:changed", 
  canvasId, 
  sequence: snapshot.sequence, 
  revisions: snapshot.revisions 
});
```

**Agent Gateway**（`src/capabilities/capabilityGateway.ts`）：
```typescript
// 第614-642行：Agent 通过 Gateway 调用工具
private canvasTypedWrite(...) {
  const result = this.operation(..., (tx, operationId) => 
    executeCanvasTypedMutation(...)  // ← 执行成功，但没有 publish
  );
  return result;
}
```

**关键发现**：
- ✅ HTTP API 每次 `core.apply()` 后都会 `await publish(ctx.spaceId, { type: "canvas:changed", ... })`
- ❌ **Agent Gateway 调用 `core.apply()` 后没有发布任何实时事件**
- ✅ `CanvasCore.apply()` 本身不负责发布事件（职责分离是对的）
- ❌ **`capabilityGateway.ts` 的 `operation()` 方法也不发布事件**

#### 2.2 前端实时监听机制

**前端**（`web/src/features/canvas/host/useCanvasCoreResource.ts` 第69行）：
```typescript
socket.on("canvas:changed", recover);
```

前端通过 Socket.IO 监听 `canvas:changed` 事件，收到后调用 `client.changes(canvasId, lastAppliedSequence)` 增量拉取变更，然后调用 `connectionRef.current?.replaceFromCore(recovered.snapshot)` 更新画布。

**结论**：前端的实时更新**完全依赖** `canvas:changed` 事件。没有事件 = 没有更新。

#### 2.3 为什么有时候能成功？

**猜测**：成功的案例（"创建黑色圆形立即显示"）可能是因为：
1. 创建时前端先做了乐观更新（optimistic update）
2. 或者那次操作恰好触发了其他路径的刷新

但大部分情况下，**Agent 通过 MCP/CLI → Gateway → CanvasCore 的路径，完全不会触发前端更新**。

---

### 问题 2：样式参数传递问题（中等）

#### 2.4 工具参数定义

检查 `src/canvas/canvasAgentTools.ts`：

**create_shape schema**（第60-80行）：
```typescript
fill: z.string().optional(),          // ✅ 有
stroke: z.string().optional(),        // ✅ 有
borderWidth: z.number().optional(),   // ✅ 有
// ❌ 但缺失：
// - fillType (solid/linear/radial/...)
// - fillEnd, gradientAngle
// - cornerRadius
// - strokeAlign, strokeStyle
// - rotation, opacity, blendMode
```

**update_node schema**（第140-155行）：
```typescript
fill: z.string().optional(),     // ✅ 有
// ❌ 同样缺失大量样式参数
```

#### 2.5 工具描述不足

**当前描述**（`canvasAgentTools.ts` 第45-59行）：
```
"Create a shape node. ..."
```

非常简略，没有：
- fill 参数的格式说明（#RRGGBB？rgba()？CSS gradient？）
- 各参数的取值范围和约束
- 负面约束（"不要用 CSS linear-gradient()"）

对比 RECOMBYN 的 `model_hint`（几百字，具体到每个参数的格式）。

#### 2.6 typedCanvasCommandToToolOp 转换

检查 `src/canvas/canvasAgentTools.ts` 第229-253行（create_shape 转换）：

```typescript
case "canvas.create_shape": {
  return {
    action: "create_shape",
    id: cmd.id,
    x: cmd.x, y: cmd.y,
    width: cmd.width, height: cmd.height,
    shapeType: cmd.shapeType ?? "rect",
    // ✅ 传了 fill, stroke, borderWidth
    ...(cmd.fill ? { fill: cmd.fill } : {}),
    ...(cmd.stroke ? { stroke: cmd.stroke } : {}),
    ...(cmd.borderWidth !== undefined ? { borderWidth: cmd.borderWidth } : {}),
    ...(cmd.name ? { name: cmd.name } : {}),
    // ❌ 没有传 cornerRadius, rotation, opacity 等
  };
}
```

转换逻辑**只传了 schema 里定义的字段**，缺失的参数自然传不过去。

#### 2.7 canvasToolOps.ts 底层支持

检查 `src/canvas/canvasToolOps.ts` 第79-120行（create_shape 的 ToolOp → patch 映射）：

```typescript
case "create_shape": {
  const element = {
    id: op.id,
    key: "shape" as const,
    shapeType: op.shapeType ?? "rect",
    x: op.x, y: op.y,
    width: op.width, height: op.height,
    attrs: {
      ...(op.fill !== undefined ? { fill: op.fill } : {}),
      ...(op.stroke !== undefined ? { stroke: op.stroke } : {}),
      ...(op.borderWidth !== undefined ? { borderWidth: op.borderWidth } : {}),
      // ✅ 底层支持了 cornerRadius, rotation, opacity 等
      ...(op.cornerRadius !== undefined ? { cornerRadius: op.cornerRadius } : ),
      ...(op.rotation !== undefined ? { rotation: op.rotation } : {}),
      ...(op.opacity !== undefined ? { opacity: op.opacity } : {}),
      // ... 还有很多
    },
  };
}
```

**结论**：底层 ToolOps 完全支持这些参数，但 typed tools 层没有暴露出来。

#### 2.8 为什么"黑色圆形"能成功？

可能原因：
1. Agent 正好用对了 `fill` 参数的格式（`fill: "#000000"` 或 `fill: "black"`）
2. 圆形不需要 cornerRadius
3. 没有其他复杂样式需求

而"红色矩形"失败，可能是：
1. Agent 用错了格式（`fill: "red"` 可能不被识别，需要 `#FF0000`）
2. 或者 Agent 根本没传 fill 参数（工具描述太简略，Agent 不知道必须传）

---

## 三、修复方案

### 优先级 P0：修复实时同步（不修复则完全不可用）

**修改文件**：`src/capabilities/capabilityGateway.ts`

**位置**：第614-642行 `canvasTypedWrite()` 方法

**改动**：在 `operation()` 返回后，发布实时事件

```typescript
private canvasTypedWrite(
  claims: TurnCapabilityClaims,
  toolName: Exclude<CanvasTypedToolName, "canvas.scene_summary">,
  command: CanvasTypedMutationCommand,
): CanvasMutationFeedback {
  try {
    const result = this.operation(...) as CanvasMutationFeedback;
    this.clearCanvasLastError(claims);
    
    // ✅ 新增：发布实时事件
    if (result.canvasId && result.sequence !== undefined && result.revision !== undefined) {
      void publish(this.spaceId, {
        type: "canvas:changed",
        canvasId: result.canvasId,
        sequence: result.sequence,
        revisions: { revision: result.revision },
      }).catch((error) => {
        console.error("Failed to publish canvas:changed event", error);
      });
    }
    
    return result;
  } catch (error) {
    this.recordCanvasLastError(claims, error);
    mapCanvasToolError(error);
  }
}
```

**注意**：
- 需要 import `publish` from `"../server/realtime.js"`
- `void` 前缀表示不等待 publish（异步发布，不阻塞返回）
- catch 错误防止事件发布失败影响主流程

**同理**：`canvasElementsApply` 也需要加同样的逻辑（如果它也被 Agent 使用）。

---

### 优先级 P1：补全样式参数（修复后可用性大幅提升）

#### 3.1 补全 Zod schema

**修改文件**：`src/canvas/canvasAgentTools.ts`

**create_shape schema**（第60行附近）：
```typescript
export const CanvasCreateShapeCommandSchema = z.object({
  // ... 现有参数 ...
  fill: z.string().optional(),
  // ✅ 新增：
  fillType: z.enum(["solid", "linear", "radial", "angular", "diffuse", "image"]).optional(),
  fillEnd: z.string().optional(),
  gradientAngle: z.number().optional(),
  cornerRadius: z.number().optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(100).optional(),
  blendMode: z.string().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  // stroke 相关：
  strokeAlign: z.enum(["center", "inside", "outside"]).optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  strokeLinecap: z.enum(["butt", "round", "square"]).optional(),
  strokeLinejoin: z.enum(["miter", "round", "bevel"]).optional(),
  strokeOpacity: z.number().min(0).max(100).optional(),
});
```

**update_node schema**（第140行附近）：同样补全。

#### 3.2 修改 typedCanvasCommandToToolOp 转换

**修改文件**：`src/canvas/canvasAgentTools.ts` 第229-253行

```typescript
case "canvas.create_shape": {
  return {
    action: "create_shape",
    // ... 现有字段 ...
    // ✅ 新增：传递所有新参数
    ...(cmd.fillType ? { fillType: cmd.fillType } : {}),
    ...(cmd.fillEnd ? { fillEnd: cmd.fillEnd } : {}),
    ...(cmd.gradientAngle !== undefined ? { gradientAngle: cmd.gradientAngle } : {}),
    ...(cmd.cornerRadius !== undefined ? { cornerRadius: cmd.cornerRadius } : {}),
    ...(cmd.rotation !== undefined ? { rotation: cmd.rotation } : {}),
    ...(cmd.opacity !== undefined ? { opacity: cmd.opacity } : {}),
    ...(cmd.blendMode ? { blendMode: cmd.blendMode } : {}),
    ...(cmd.flipX !== undefined ? { flipX: cmd.flipX } : {}),
    ...(cmd.flipY !== undefined ? { flipY: cmd.flipY } : {}),
    ...(cmd.strokeAlign ? { strokeAlign: cmd.strokeAlign } : {}),
    ...(cmd.strokeStyle ? { strokeStyle: cmd.strokeStyle } : {}),
    ...(cmd.strokeLinecap ? { strokeLinecap: cmd.strokeLinecap } : {}),
    ...(cmd.strokeLinejoin ? { strokeLinejoin: cmd.strokeLinejoin } : {}),
    ...(cmd.strokeOpacity !== undefined ? { strokeOpacity: cmd.strokeOpacity } : {}),
  };
}
```

#### 3.3 增强工具描述（model_hint 移植）

**修改文件**：`src/canvas/canvasAgentTools.ts` 第45-59行（create_shape 的 description）

从 RECOMBYN 的 `canvas_actions_seed.json` 完整移植 model_hint。示例：

```
Create a shape node. Args: shapeType|type = rect|ellipse|circle|line|arrow|triangle|polygon|star|path|pen|pencil.
Position: x, y (top-left corner). Size: width, height.
Fills: solid → fill=#RRGGBB or rgba(R,G,B,A); gradient → fillType=linear|radial|angular|diffuse + fill (start color) + fillEnd (end color) + gradientAngle? (degrees).
NEVER put CSS linear-gradient()/radial-gradient()/conic-gradient() in fill — they are REJECTED by the host.
Stroke: stroke=#RRGGBB|rgba(...), borderWidth (px), strokeAlign=center|inside|outside, strokeStyle=solid|dashed|dotted, strokeLinecap=butt|round|square, strokeLinejoin=miter|round|bevel, strokeOpacity (0-100).
Corners: cornerRadius (px, uniform; or object { topLeft, topRight, bottomLeft, bottomRight }).
Transform: rotation (degrees), opacity (0-100), blendMode (multiply|screen|overlay|...), flipX/flipY (boolean).
Icons: prefer primitives + boolean_op (cutouts/combines) over create_svg/create_icon for multi-part marks.
For Q-illustration or pencil sketch, do NOT collage circles — use multiple pencil strokes with pressure.
```

**关键**：
- 格式要求具体到"fill=#RRGGBB or rgba(...)"，不能泛泛而谈
- 负面约束比正面描述更有效（"NEVER put CSS linear-gradient"）
- 保持英文（模型对英文更敏感），可在末尾加中文关键词

---

## 四、验证计划

### 4.1 验证实时同步修复

1. 启动开发环境
2. 让 Agent 创建一个矩形
3. **不刷新页面**，观察画布是否立即显示
4. 让 Agent 修改矩形颜色
5. **不刷新页面**，观察颜色是否立即更新

**预期**：100% 的操作都能实时显示。

### 4.2 验证样式参数修复

1. 让 Agent "创建一个红色矩形，圆角 10px"
2. 检查画布上的矩形：
   - ✅ 是红色的
   - ✅ 有圆角
3. 让 Agent "把矩形改成蓝色，圆角改成 20px，旋转 45 度"
4. 检查修改后的矩形：
   - ✅ 是蓝色的
   - ✅ 圆角 20px
   - ✅ 旋转了 45 度

**预期**：正确率从 <50% → >80%。

---

## 五、后续优化方向

修复上述两个问题后，Agent 操作画布就基本可用了。但要达到 RECOMBYN 的效果，还需要：

### Phase 1：操作协议层（让 Agent 专业地操作）
- 大幅扩展 Canvas skill pack（移植 RECOMBYN 的 paint_system、edit protocol、placement rules）
- 优化 scene_summary 输出格式
- 补全其他常用 typed tools（align/distribute/group/boolean_op 等）
- 结构化错误重试机制（LAST_ERROR）

### Phase 2：设计技能系统（从"会操作"到"会设计"）
- 移植 foundation skills（design_brief、composition、color、typography、anti_ai_slop）
- 移植 domain skills（poster_craft、landing_page 等）
- Skill 延迟加载机制
- Review 自检机制

### Phase 3：图像/视频生成接入
- 增加图像模型和视频模型设置
- 接入火山引擎（Doubao Ark）
- 实现 canvas.image_generate / canvas.video_generate job 机制

---

## 六、总结

| 问题 | 根因 | 优先级 | 工作量 | 修复后效果 |
|------|------|--------|--------|-----------|
| 前端不实时更新 | Gateway 没发布 `canvas:changed` 事件 | P0 | 1 小时 | 从"完全不可用"到"基本可用" |
| 样式参数无效 | typed tools 缺参数 + 描述太简略 | P1 | 2-4 小时 | 正确率从 <50% → >80% |
| 操作不专业 | 缺操作协议层（skill pack 太薄） | P2 | 3-5 天 | 达到"专业操作"水平 |
| 不会设计 | 缺设计技能系统 | P3 | 5-7 天 | 达到 RECOMBYN 效果 |
| 无法生图/视频 | 未接入媒体生成 | P4 | 5-7 天 | 完整能力对齐 |

**当务之急**：立即修复 P0（实时同步），否则其他优化都无意义。
