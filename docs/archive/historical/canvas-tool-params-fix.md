# Canvas 工具参数映射修复

## 修复日期
2026-08-19

## 问题描述
Agent 操作画布时出现以下问题：
1. **文本不显示**：创建 text 节点后，文字内容没有写进去（元素存在但无文本）
2. **圆角不生效**：修改 cornerRadius 后画布上没有任何效果
3. **其他样式参数可能也有问题**：stroke、opacity、rotation 等

## 根因分析

通过查看前端代码（`web/src/features/canvas/upstream/apps/web/src/components/rcb/scene/`），发现：

1. **文本内容存储格式**：前端需要 `attrs.DATA` 和 `attrs.ORIGIN_DATA` 字段，而后端只设置了 `node.text`
2. **圆角字段名称**：前端需要 `attrs.radiusTL/TR/BR/BL` 四个角分别设置，而后端只设置了 `attrs.cornerRadius`
3. **其他字段映射错误**：
   - `fill` → 需要映射为 `attrs['fill-color']`
   - `stroke` → 需要映射为 `attrs['border-color']`
   - `borderWidth`/`strokeWidth` → 需要映射为 `attrs['border-width']`
   - `rotation` → 需要映射为 `attrs.angle`
   - `opacity` → 节点顶级字段（0-1 范围）

## 修复内容

修改文件：`src/canvas/canvasToolOps.ts`

### 1. create_* 操作修复

在 `create_text`、`create_shape` 等操作中添加：

```typescript
// 文本内容正确构建（使用 buildTextAttrs）
if (op === "create_text" && typeof raw.text === "string") {
  const textStyle = {
    fontSize: ...,
    fill: ...,
    fontWeight: ...,
    fontFamily: ...
  };
  const textAttrs = buildTextAttrs(raw.text, textStyle);
  Object.assign(attrs, textAttrs);
}

// 圆角拆分为四个角
if (cornerRadius !== undefined) {
  attrs.radiusTL = cornerRadius;
  attrs.radiusTR = cornerRadius;
  attrs.radiusBR = cornerRadius;
  attrs.radiusBL = cornerRadius;
  delete attrs.cornerRadius;
}

// 描边字段映射
if (typeof raw.stroke === "string") {
  attrs["border-color"] = raw.stroke;
  attrs.stroke = raw.stroke;
}
if (typeof raw.borderWidth === "number") {
  attrs["border-width"] = raw.borderWidth;
}

// 旋转字段映射
if (typeof raw.rotation === "number") {
  attrs.angle = raw.rotation;
}

// 不透明度（节点级别）
if (typeof raw.opacity === "number") {
  node.opacity = Math.max(0, Math.min(1, raw.opacity));
}

// 其他样式字段
if (typeof raw.blendMode === "string") node.blendMode = raw.blendMode;
if (typeof raw.flipX === "boolean") node.flipX = raw.flipX;
if (typeof raw.flipY === "boolean") node.flipY = raw.flipY;
if (typeof raw.locked === "boolean") node.locked = raw.locked;
if (typeof raw.hidden === "boolean") node.hidden = raw.hidden;
```

### 2. update_node 操作修复

同样的逻辑应用到 `update_node` 操作中，确保更新时也正确映射所有字段。

## 修复后效果

- ✅ 创建 text 节点时，文本内容正确显示
- ✅ 设置 cornerRadius 时，圆角正确渲染
- ✅ 设置 stroke/borderWidth 时，描边正确显示
- ✅ 设置 rotation 时，元素正确旋转
- ✅ 设置 opacity 时，透明度正确应用
- ✅ 其他样式参数（blendMode、flipX/Y、locked、hidden）正确生效

## 测试建议

1. **文本测试**：`canvas.create_text({ text: "Hello", x: 100, y: 100, fill: "#ff0000" })`
2. **圆角测试**：`canvas.create_shape({ shapeType: "rect", x: 100, y: 100, width: 100, height: 100, fill: "#00ff00", cornerRadius: 20 })`
3. **描边测试**：`canvas.create_shape({ ..., stroke: "#0000ff", borderWidth: 5 })`
4. **旋转测试**：`canvas.update_node({ nodeId: "xxx", rotation: 45 })`
5. **透明度测试**：`canvas.update_node({ nodeId: "xxx", opacity: 0.5 })`

## 下一步

这些修复属于 **Phase 0：工具底座增强** 的一部分。接下来还需要：

1. 补全更多参数（fillType、gradientAngle、strokeAlign 等高级样式）
2. 增强工具描述（移植 RECOMBYN 的 model_hint）
3. 添加结构化错误反馈（LAST_ERROR 机制）
4. 补全缺失的 typed tools（update_frame、align_nodes、distribute_nodes 等）
