# Kith-space 响应式分屏宽度设计

> 2026-07-11 路线修正：分栏算法继续有效；模块清单以个人 AgentOS 规格为准。`Members` 改为 `Agents`，`Computers` 删除。

- 日期：2026-07-11
- 状态：已实现并通过静态验证；25% 调整按用户要求未重跑浏览器 QA
- 范围：P4-3 单窗口工作区的 Split 宽度约束与拖拽持久化
- 依据：用户在 1493px 与约 2048px 浏览器窗口中的实测反馈

## 1. 问题

当前 Split 使用固定像素约束：Chat 最小 360px、模块最小 480px、模块最大 960px，并把拖拽结果保存为模块像素宽度。

这会产生两个问题：

- 在约 2048px 的宽窗口里，Module Pane 到 960px 后不能继续变宽，剩余空间被迫全部给 Chat，形成接近 50/50 的分屏；Chat 看起来过宽。
- 保存的是像素而不是比例，浏览器窗口或显示器变化后，原来的宽度偏好不再代表同一种工作姿态。

因此根因不是 Chat 最小宽度按百分比，而是固定模块上限与像素持久化共同造成的响应式失真。

## 2. 已确认结论

Split 的默认姿态为 Chat 25%、Module 75%。其中 25% 同时是宽屏下 Chat 的最小占比：

- 从 ChatOnly 第一次打开模块时，Chat 自动收至当前窗口允许的最小宽度。
- 从 ModuleOnly 点击 Chat 恢复 Split 时，Chat 同样收至最小宽度。
- 用户可以把 Chat 向右拖宽，但不能把它缩到小于响应式最小宽度。
- 在 Split 中切换模块时保持用户当前比例，并按新模块下限做必要夹取。
- 关闭模块回到 ChatOnly 后，再次打开模块会重新使用 25/75，而不是沿用上一次较宽的 Chat。

## 3. 响应式约束

### 3.1 Chat 下限

```text
chatMin = max(360px, workspaceWidth × 25%)
```

25% 随窗口变化，360px 是保证 Composer、会话标题和紧凑工具栏可用的绝对底线。

示例：

| 工作区宽度 | Chat 最小宽度 | Module 实际可用宽度（扣除 10px 间隙） |
|---:|---:|---:|
| 1024px | 360px | 654px |
| 1493px | 373px | 1110px |
| 2048px | 512px | 1526px |

### 3.2 模块下限

不同模块的内部结构不同，不再共用 480px：

| 模块 | 最小宽度 | 原因 |
|---|---:|---|
| Inbox | 640px | 筛选侧栏 + 消息内容区 |
| Agents | 640px | agent roster / profile 双区内容 |
| Settings | 640px | 设置导航 + 表单内容 |
| Tasks | 560px | 看板 / 列表与筛选控件 |
| Search | 560px | 搜索输入与结果列表 |

Module Pane 不再有固定 960px 最大宽度。其最大宽度由下面公式决定：

```text
moduleMax = workspaceWidth - chatMin - 10px gap
```

### 3.3 单 Pane 阈值

```text
canSplit = workspaceWidth >= chatMin + activeModuleMin + 10px gap
```

因此不同模块可以在不同窗口宽度进入单 Pane。例如 Inbox 比 Tasks 更早退化为单 Pane，这是模块内部结构不同的正常结果。

## 4. 拖拽与持久化

- 状态从 `moduleWidth: px` 改为 `moduleRatio: 0..1`。
- 默认模块比例为 `0.75`。
- 拖拽时把实际模块宽度换算为工作区比例并持久化。
- 渲染时把比例换算回像素，再按当前 Chat 下限和当前模块下限夹取。
- 使用新的版本化本地存储键；旧的像素宽度键不参与新布局，避免历史值继续制造大屏失真。
- 不引入新的 React 状态层；宽度仍由现有 `useSyncExternalStore` 壳状态承载，`ResizeObserver` 提供工作区实际宽度。

## 5. 模块边界

新增一个无 React 依赖的纯约束模块，负责：

- 根据 `workspaceWidth` 计算 Chat 最小宽度。
- 根据 `WorkspaceModuleId` 返回模块最小宽度。
- 判断当前模块是否可 Split。
- 把比例换算为经过夹取的模块像素宽度。

`WorkspaceFrame` 只消费计算结果；`DragDivider` 继续只处理指针与键盘输入；业务模块不感知外层分屏计算。

## 6. 验证

### 6.1 纯函数测试

- 1024 / 1493 / 2048px 下 Chat 下限计算正确。
- Inbox 与 Tasks 的模块下限不同。
- 模块宽度不再被 960px 截断。
- 拖拽比例在窗口变化后保持相同工作姿态。
- 不满足两边下限时进入单 Pane。

### 6.2 浏览器 QA

先通过当前 Access Token Gate 建立浏览器会话，再使用 `http://localhost:5273/` 验证：

- 1493px：打开 Tasks，Chat 自动约为 25%。
- 2048px：打开 Inbox，Module Pane 可超过 960px，Chat 保持约 25%。
- 960px：Tasks 与 Inbox 根据各自下限采用不同的 Split / 单 Pane 结果。
- 拖宽 Chat、切换模块、关闭并重新打开模块，分别验证“保持比例”和“重置到最小宽度”。
- 指针拖拽与键盘方向键均受同一动态边界约束。
- 控制台无新增应用错误。

## 7. 不在本次范围

- ChatOnly 中会话列表与实时轨迹各自的收起/调宽。
- 移动端专用布局。
- Message Context Snapshot。
- 模块内部 UI 的高保真视觉重塑。
