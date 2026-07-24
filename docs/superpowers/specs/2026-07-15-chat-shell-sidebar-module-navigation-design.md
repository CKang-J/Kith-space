# Kith-space Chat 壳层与侧栏模块导航重构设计

- 日期：2026-07-15
- 状态：原切片已于 2026-07-18 验收；2026-07-23 的“图标 + 文字”壳层已被后续图标栏设计取代
- 范围：常驻左侧栏、主卡片同槽位切换、Settings 模态层、Dock 与案例展示退役
- 关联规格：`2026-07-10-kith-space-single-window-workspace-design.md`、`2026-07-14-chat-aggregate-panel-design.md`、`2026-07-15-chat-message-ui-density-design.md`

> **2026-07-23 最新覆盖：** `2026-07-23-chat-icon-rail-message-pane-design.md` 把“图标 + 文字的单一左侧栏”改为“窄图标导航栏 + 消息中栏”。模块同槽位切换、Dock 退役、Settings 模态层、规范 URL、模块 resource query、会话聚合面板和 Composer 数据契约继续有效。本文后续视觉结构只保留为历史设计依据。

## 1. 决策摘要

当前 ChatOnly 同时存在会话区域、中心 Chat 卡片和底部悬浮 Dock。需要收敛的是导航入口分散和内容轨道不齐，而不是推翻用户已经确认的中心 Chat 卡片骨架；会话区域则可以取消独立卡片底板，直接使用应用画布背景。

本轮采用以下方案：

1. **ChatOnly 不再显示底部 Dock。** Inbox、Tasks、Agents、Settings 等模块入口迁入左侧常驻会话栏顶部，以“图标 + 文字”的纵向列表展示；Home 额外显示 Spaces。
2. **纵向模块列表不显示 Chat 项。** 用户此时已经位于 Chat，重复入口没有信息价值。
3. **点击模块后进入现有模块工作姿态。** 固定左侧会话栏隐藏，模块面板打开，底部 Dock 迁移到 Module Pane 并恢复现有横向交互。
4. **模块打开态的 Dock 保留 Chat 图标。** 它不是 ChatOnly 的重复入口，而是 Split 与 ModuleOnly 之间切换 Chat 显隐所必需的状态控制器。
5. **Split 中继续使用现有会话列表按钮和抽屉交互。** 抽屉只承载“已保存、频道、私信”三组会话导航，不显示模块入口、案例展示或底部 agent 状态区。
6. **完整删除“案例展示”产品功能。** 不只是隐藏入口，还要退役路由、静态视图、演示数据/资产及仅为 Showcase 存在的表现分支和测试。
7. **保留原有中心 Chat 卡片式 UI。** 中心 Chat 继续使用原有圆角、背景与间隙；新会话/模块列表取消独立卡片底板，直接位于应用画布上，也不以贯穿式横线或竖线分割，只用留白、分组标题和行底色建立层级。
8. **所有功能性文字统一使用无衬线字体。** 标题、会话名、模块名、消息元信息和正文使用同一字体体系，通过字号、字重与颜色区分层级，不再混用衬线标题。

文中“左侧常驻模块列表”指参考图所示的纵向图标文字区。用户描述中的“右侧列表的这些 Dock 功能按钮”按截图和上下文统一解释为这组左侧入口。

## 2. 目标与非目标

### 2.1 目标

- 在保留中心 Chat 圆角卡片骨架的前提下，让会话导航直接融入画布，且不新增与 Chat 卡片竞争的边框或分隔线。
- 把高频模块入口放到用户已经用于切换上下文的左侧区域，缩短视线和指针移动距离。
- 在 ChatOnly、Split、ModuleOnly 三态间建立清楚且可预测的导航迁移。
- 让固定侧栏和临时会话抽屉复用同一份会话数据与行组件，但只展示各自需要的内容。
- 统一字体、颜色、边界、阴影和内容对齐轨道，减少视觉层级竞争。
- 完整退役无真实产品价值的案例展示，避免只读演示逻辑继续污染真实聊天表现层。
- 保留当前 URL 可恢复、浏览器前进后退、会话切换和模块资源 query 语义。

### 2.2 非目标

- 不修改 ChatOnly / Split / ModuleOnly 三态的数据模型或 URL 协议。
- 不增加新的模块、跨 Space 聚合、任意停靠、多模块并排或用户自定义导航排序。
- 不重新设计 Inbox、Tasks、Agents、Settings、Spaces 的模块内容。
- 不改变消息、话题、附件、reaction、任务、响应模式、Composer 或聚合面板的数据契约。
- 不通过全局缩放或把正文字号整体缩小来获得“更整齐”的假象。
- 不引入第三方参考产品的品牌色、图标资产或特有业务入口。
- 不在本轮重新设计窄屏移动端；只要求现有桌面最小宽度和响应式降级不回退。

## 3. 信息架构

### 3.1 ChatOnly 左侧常驻栏

ChatOnly 的左侧栏从单纯“会话列表”升级为 **Chat 导航侧栏**，从上到下固定为：

```text
模块导航
  [Home only] Spaces
  Inbox
  Tasks
  Agents
  Settings

已保存

频道
  置顶频道（沿用现有规则）
  活跃频道
  已归档（有数据时显示，默认收起）

私信
  Human-Agent DM

底部 agent 运行状态（沿用现有常驻栏能力）
```

约束：

- 模块导航复用 `workspaceModules.tsx` 的同一注册表与 Home/普通 Space 过滤规则，不维护第二份模块名称、图标或可见性判断。
- Search 继续位于顶部全局入口，不进入模块列表。
- Chat 不进入模块列表；左侧栏本身和当前会话已经明确表达 Chat 上下文。
- 模块入口与会话入口之间使用留白和轻量分组标题区分，不使用独立卡片或粗分隔框。
- ChatOnly 常驻栏不显示“对话”总标题；模块图标的左边界与“频道 / 私信”等会话分组标题的文字起点对齐。
- “已保存”保持单一入口；置顶和已归档仍属于“频道”的内部组织，不提升为第四、第五个顶层分组。
- 会话行继续保留未读、在线状态、当前项和时间等现有业务反馈，但不增加新的装饰徽标。

### 3.2 模块打开后的工作区

点击任一纵向模块入口后：

1. 在当前会话 pathname 上写入规范 `?module=<id>`；模块自有 resource query 继续按现有规则生成。
2. 固定左侧 Chat 导航侧栏隐藏，不在 Split 外侧保留一条重复导航栏。
3. 宽度允许时进入 Split；不满足面板下限时沿用现有约束退化为 ModuleOnly。
4. Module Pane 底部显示现有横向 Dock；当前模块保持展开标签，其余模块保持图标形态。
5. 横向 Dock 中保留 Chat 图标：Split 点击后进入 ModuleOnly，ModuleOnly 点击后恢复 Split。
6. 点击当前模块仍关闭模块并回到 ChatOnly；此时底部 Dock 消失，左侧 Chat 导航侧栏恢复。

### 3.3 Split 会话抽屉

模块打开且 Chat 可见时，固定左侧栏已隐藏。当前会话标题最左侧的既有列表按钮继续打开覆盖 Chat Pane 的会话抽屉。

抽屉的产品内容严格限定为：

```text
已保存
频道
私信
```

具体边界：

- “频道”内部继续包含置顶、活跃与默认收起的已归档分组。
- 不显示模块入口，因为模块切换由 Module Pane 底部 Dock 负责。
- 不显示 Chat 项、案例展示或底部 agent 运行状态区。
- 抽屉可以有“会话”标题、关闭按钮和必要的容器 chrome；“只显示三项”约束针对产品导航分组，而不是禁止辅助关闭控件。
- 选择会话后关闭抽屉并保留 active module、Chat 显隐和模块 resource query。
- Escape、点击遮罩、切换会话后的关闭行为、焦点返回和只覆盖 Chat Pane 的空间边界继续沿用现有实现。

ModuleOnly 没有可见 Chat 标题，因此不单独提供会话抽屉入口；用户先通过 Dock 的 Chat 图标恢复 Split，再切换会话。

## 4. 三态与状态转换

状态机本身不增加第四种形态，只改变导航控制器在三态中的位置：

| 状态 | 固定 Chat 导航侧栏 | 会话抽屉入口 | Module Pane | 横向 Dock |
|---|---|---|---|---|
| ChatOnly | 显示，含纵向模块入口 | 不需要 | 隐藏 | 隐藏 |
| Split | 隐藏 | 显示在 Chat 标题栏 | 显示 | 显示，含 Chat 图标 |
| ModuleOnly | 隐藏 | 不显示 | 显示 | 显示，含 Chat 图标 |

| 当前状态 | 用户动作 | 结果 |
|---|---|---|
| ChatOnly | 点击纵向模块 | 打开对应模块，进入 Split；空间不足时进入 ModuleOnly |
| Split | 点击 Dock Chat | 隐藏 Chat，进入 ModuleOnly |
| ModuleOnly | 点击 Dock Chat | 恢复 Chat，进入 Split |
| Split / ModuleOnly | 点击当前模块 | 关闭模块，回到 ChatOnly 并恢复固定侧栏 |
| Split / ModuleOnly | 点击其他模块 | 替换模块并保持当前 Chat 可见性 |
| Split | 点击会话列表按钮 | 打开只含已保存/频道/私信的会话抽屉 |

不允许 Chat 与 Module 同时隐藏。刷新、前进、后退继续以 pathname、`module` 和 `chat=0` 为唯一事实来源，不新增仅存于 React local state 的第四套布局状态。

## 5. 视觉语言

### 5.1 原有卡片骨架与边界

- 应用继续使用原有浅灰画布；中心 Chat 保持原有白色圆角卡片，会话导航取消独立卡片背景并直接落在画布上，两者之间保留既有间隙。
- 不移除或拉平中心 Chat 卡片，也不在会话导航与 Chat 之间新增贯穿全高的竖线。
- 新增纵向模块入口、会话分组和 Split 会话抽屉不绘制横向分隔线或独立描边；归档频道入口与常驻 agent 状态区也不使用横线隔开，只通过留白、分组标题、hover/active 行底色建立层级。
- 原有卡片阴影、覆盖层阴影和拖拽边界沿用现状；本轮不重新定义全局表面层级。
- 活跃模块、会话和 hover 状态使用轻微表面色变化，不使用高饱和大色块或多套互相竞争的强调色。
- Human 消息继续使用 `#eff4fb`；Agent 使用中性浅灰。模块选中态、侧栏选中态和 Human 气泡使用同一冷色家族，但保持不同明度，避免所有选中项都变成蓝色块。

### 5.2 字体

功能 UI 统一为系统无衬线字体：

```css
font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
```

- 当前环境没有 Inter 时自然回落，不为单一标题单独加载衬线字体。
- 页面/会话标题建议 `18–20px / 600`；分组标题 `12px / 500`；导航与会话名 `14px / 500–600`；辅助信息 `11–12px / 400`。
- 消息昵称、时间与正文继续遵守消息密度规格，不通过额外字距制造“精致感”。
- 品牌图形可以保留自身造型，但所有可操作文字、标题、标签、提示和状态都服从统一无衬线体系。

### 5.3 纵向模块入口

建议实现尺寸：

| 项目 | 目标值 |
|---|---:|
| 单行高度 | 36–40px |
| 左右内边距 | 10–12px |
| 图标 | 18px |
| 图标与文字间距 | 10px |
| 标签 | 14px / 500–600 |
| 行圆角 | 8px，仅用于 hover/active 底色 |
| 相邻行间距 | 2px |

行本身不加边框和阴影。未选中项透明，hover 使用浅中性底色；模块被点击后立即进入模块工作姿态，因此 ChatOnly 不需要保留一个“已选中模块”的常驻状态。

### 5.4 主内容对齐

- Chat 标题栏独立于消息内容轨道，左右距 Chat 卡片边界恒定为 14px，与 24px 私聊头像在 52px 标题栏中的上下留白一致；不随消息最大宽度、响应式 gutter 或滚动条槽位变化。
- 日期分隔、消息流和 Composer 使用同一条稳定水平内容轨道；消息轨道保持 1040px 可读上限并在宽屏居中，左右留白对称。
- ChatOnly 与 Split 的主消息区统一使用 `10px` 水平内边距；ChatOnly 主 Chat 卡片沿用 Split 的 `360px` 绝对宽度下限，日期分隔、消息与 Composer 仍共用同一轨道。
- 侧栏分组标题、图标、会话头像和文本起点形成两条稳定竖向基线，避免每组各自发明缩进。

## 6. 案例展示退役

“案例展示”不再属于 Kith-space 目标信息架构。实施时按完整功能删除处理：

- 删除 Chat 导航中的“案例展示”入口及激活态。
- 删除 `showcase` 会话路由解析、规范化和快捷切换结果。
- 删除静态 Showcase 视图、演示数据、演示附件/头像等资产。
- 删除 Showcase 专属 i18n、CSS、单元测试和静态 fallback 断言。
- 清理只为 Showcase 只读模式存在的消息/Composer/成员/快捷切换分支；真实归档频道的只读能力必须保留。
- 保留真实聊天仍在使用的共享消息、附件 Lightbox、话题摘要和 action card 组件，不因 Showcase 退役误删通用能力。
- 若数据库初始化仍创建仅服务 Showcase 的演示 agent 或内容，先核实其来源和是否被其他 fixture 使用，再在同一实施切片中删除；不得仅凭变量名批量清理。
- 历史规格中以 Showcase 作为只读验收样本的条目，实施后改由真实归档频道或专用测试 fixture 覆盖。

删除完成后，`showcase` 旧 URL 不保留产品兼容页，应按未知会话路径规范化到当前 Space 默认频道，同时保留合法的模块 query。

## 7. 组件与职责边界

建议沿现有 `web/src/shell/` 边界进行局部拆分：

### 7.1 `SidebarModuleNavigation`

- 只负责把 `dockModulesForSpace(isHome)` 渲染成纵向图标文字列表。
- 只通过 `onSelectModule(id)` 发出意图，不直接读写 URL、控制 Chat 或理解模块内容。
- 不渲染 Chat 和 Search，不复制 Inbox 未读等模块元数据的计算来源。

### 7.2 `ConversationListContent`

- 只负责已保存、频道、已归档频道和私信的分组与行渲染。
- 固定侧栏和会话抽屉共享同一组件或同一组分组组件，避免两套筛选、未读和导航逻辑漂移。
- 导航函数继续保留 active module 与合法 resource query。

### 7.3 `ChatSidebar`

- 作为 ChatOnly 常驻壳组合标题、`SidebarModuleNavigation`、`ConversationListContent` 和底部运行状态。
- 不通过大量 `showX` 布尔值同时兼容抽屉；抽屉使用更窄的组合组件。

### 7.4 `ConversationDrawer`

- 只组合抽屉 chrome 与 `ConversationListContent`。
- 继续由 `ChatWorkspace` 管理打开、关闭、焦点恢复、Escape 和遮罩，不把布局状态下放到列表内容。

### 7.5 `WorkspaceDock` 与 `WorkspaceFrame`

- `WorkspaceDock` 保持横向模块切换和 Chat 显隐职责，只在 active module 存在时挂载。
- `WorkspaceFrame`/`ChatWorkspace` 依据现有三态决定常驻侧栏、抽屉入口和 Dock 的挂载位置，不引入新的持久化状态源。
- 模块定义、图标、标签、Home 可见性和未读状态继续集中在现有模块注册层。

## 8. 响应式、可访问性与状态保持

- 纵向模块行使用真实 `button` 或语义等价控件，保留可见的 `:focus-visible`，点击热区不小于 36px 高。
- 图标必须有文字标签；收起侧栏不是本轮能力，不依赖 tooltip 才能理解入口。
- 当前会话、未读数和模块未读徽标通过文字/ARIA 同步表达，不只靠颜色。
- Split 会话按钮使用 `aria-expanded` 与抽屉 id 关联；抽屉打开后焦点进入可操作区域，关闭后返回触发按钮。
- `prefers-reduced-motion` 下取消非必要位移动画，但保留最终宽度与可见性状态。
- 打开模块、切换会话、前进后退和刷新不得丢失 active module 的合法 resource query。
- 视口不足时继续服从现有 pane constraints；不得为了保留常驻左侧栏压出低于下限的 Split。

## 9. 实施切片

### S1：壳层组合与共享会话内容

- 抽取共享会话分组内容。
- 新增纵向模块导航。
- ChatOnly 组合新侧栏，保持现有会话数据、未读和导航行为。

验证：固定侧栏只出现一份模块注册数据；Home/普通 Space 模块差异正确；已保存、频道、私信行为无回退。

### S2：三态导航迁移

- ChatOnly 移除底部 Dock。
- 模块点击进入现有 Split/ModuleOnly 状态。
- active module 状态的 Dock 保留 Chat 图标和既有切换语义。
- Split 抽屉改用纯会话内容组合。

验证：三态转换、窄窗降级、刷新/前进/后退和模块 resource query 全部保持。

### S3：卡片视觉保护与对齐系统

- 保留中心 Chat 卡片圆角、画布间隙与表面层级；会话导航取消独立卡片表面。
- 新模块入口和会话列表不新增横向/纵向分隔线。
- 统一无衬线字体、侧栏列表尺寸和选中/hover 表面。
- 将 Chat 标题栏固定为左右 14px，使其与标题内容上下留白一致；ChatOnly 与 Split 的消息区统一使用 10px gutter，消息、日期分隔与 Composer 继续共用居中内容轨道。

验证：常用桌面宽度下中心 Chat 卡片完整保留，会话导航直接使用画布背景且无贯穿分隔线，也没有悬浮 Dock 覆盖或来源不明的大块空白；窄 Split 仍可读。

### S4：案例展示完整删除

- 按第 6 节删除入口、路由、视图、资产和专属分支。
- 把只读回归覆盖迁移到归档频道/专用 fixture。

验证：代码和产品文案不再生成 Showcase；旧 URL 安全规范化；归档频道、附件 Lightbox 和真实消息展示全绿。

### S5：文档与验收

- 实施后更新 `docs/progress.md`、本 UI 方向文档及受影响的架构行号。
- 运行 typecheck、相关单测、完整集成测试和 Web build。
- 浏览器视觉验收由用户届时决定；未执行时必须如实记录。

### 9.1 实施记录

- 已新增 `SidebarModuleNavigation`，直接消费 `dockModulesForSpace(isHome)`；ChatOnly 只显示纵向模块入口，横向 Dock 只在 Module Pane 挂载。
- 已抽取 `ConversationListContent`，由常驻 `ChatSidebar` 与 `ConversationDrawerSidebar` 共享；抽屉不组合模块入口或 `LiveAgentBar`。
- 已恢复并锁定中心 Chat 卡片、圆角、画布间隙与配色；常驻会话导航取消卡片底板并直接使用画布背景，新增模块入口和会话抽屉不使用贯穿分隔线。统一无衬线字体；Chat 标题栏固定左右 14px，与标题内容上下留白一致；ChatOnly 与 Split 使用同一 10px 消息 gutter 和 360px Chat 卡片绝对下限，日期分隔、消息与 Composer 使用 1040px 居中内容轨道，Human 气泡继续使用 `#eff4fb`。
- 已删除 Showcase 产品入口、路由识别、视图、数据、资产、i18n、样式和专属测试/表现分支；旧 URL 仅保留服务端 SPA fallback，并由客户端规范化到当前 Space 默认频道。
- 自动化验证：`pnpm run typecheck`、610/610 unit、完整 integration、Web build（2622 modules）通过。当时按用户要求未由 Agent 启动浏览器；用户已于 2026-07-18 完成本轮视觉与真实三态交互验收。

## 10. 验收标准

### 10.1 产品行为

- [x] ChatOnly 左侧栏按纵向“图标 + 文字”展示当前 Space 可用模块，且没有 Chat 项。
- [x] ChatOnly 不显示底部悬浮 Dock。
- [x] Home 比普通 Space 多 Spaces；Search 不进入模块列表。
- [x] 点击纵向模块后固定左侧栏隐藏，并进入现有 Split 或响应式 ModuleOnly。
- [x] 模块打开态底部 Dock 可切换模块；Chat 图标可在 Split / ModuleOnly 间切换。
- [x] 点击当前模块关闭后回到 ChatOnly，固定左侧栏恢复，底部 Dock 消失。
- [x] Split 的会话按钮仍可打开抽屉，抽屉产品内容只有已保存、频道、私信。
- [x] 抽屉切换会话后保留 active module 和合法 resource query。
- [x] Showcase 入口、路由、视图、资产和专属产品逻辑全部删除。

### 10.2 视觉与可用性

- [ ] 功能 UI 不再混用衬线标题，统一无衬线字体体系。
- [ ] 中心 Chat 卡片、圆角和画布间隙保持不变；常驻会话导航无独立卡片底板。
- [ ] 新增纵向模块入口、会话列表和 Split 抽屉没有贯穿式横线或竖线。
- [ ] Chat 标题栏相对 Chat 卡片左右恒定 14px，并与标题内容上下留白一致；ChatOnly 与 Split 的消息 gutter、360px Chat 下限、日期分隔、消息流和 Composer 轨道一致。
- [ ] Human 气泡保持 `#eff4fb`，Agent 气泡与侧栏/选中态不产生杂乱的多套色相。
- [ ] 模块行、会话行、抽屉和 Dock 均可键盘操作，焦点样式清晰且不引发布局跳动。

### 10.3 自动化矩阵

- [x] `workspaceLayout` 三态单测保持通过。
- [x] `workspaceRoute` 覆盖模块打开、当前模块关闭、`chat=0`、会话切换保留 query 和旧 Showcase URL 规范化。
- [x] 组件测试覆盖 Home/普通 Space 纵向模块差异、无 Chat 项、ChatOnly 无 Dock。
- [x] 组件测试覆盖 Split 抽屉仅三组内容且不含模块/Showcase/LiveAgentBar。
- [x] Showcase 专属测试删除或迁移后，归档只读、附件和消息表现回归仍通过。
- [x] `pnpm run typecheck`、相关单测、完整集成测试和 `pnpm run web:build` 通过。

## 11. 已锁定解释与剩余边界

- “不显示 Dock 的 Chat 图标”锁定为 **ChatOnly 左侧纵向模块列表不显示 Chat**；模块打开后，横向 Dock 仍保留 Chat 图标以承担三态切换。若把它也删除，ModuleOnly 将没有现成方式恢复 Chat，属于另一个状态机决策。
- Split 抽屉的“三个内容”锁定为三个产品导航分组；标题、关闭按钮、遮罩和无障碍辅助结构不计入产品内容。
- 固定 ChatOnly 侧栏底部的 agent 运行状态继续保留；它不进入 Split 会话抽屉。
- 该方案不恢复旧的全局 IconRail，也不改变“一次一个 Module Pane”。纵向入口只属于 ChatOnly 的上下文导航，横向 Dock只属于模块打开后的工作姿态控制。
