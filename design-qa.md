# Design QA — 图标导航栏、消息中栏与消息气泡

- 日期：2026-07-24
- 结果：PASSED
- 验证页面：`http://localhost:7777/s/home/channel`
- 验证视口：1092 × 863（Codex In-app Browser）
- 参考图：
  - `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-0dae6f42-13a7-4250-90ee-7497e5ed4c22.png`
  - `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-ea1b4d5d-0e67-443b-ba58-41c1c2e8ef3b.png`
  - `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-d3928890-1ef1-4d22-93b6-0716d9bf8cb1.png`
  - `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-487a16ff-c80f-4f14-97ba-81297da12582.png`
- 最终截图目录：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-message-refinement-20260724/`
- 最终同画面对照：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-message-refinement-20260724/reference-vs-channel-hover-focused.png`
- 聚合面板参考：用户在浏览器批注中附加的“历史 / Widgets / 话题 / 文件”局部示例图
- 聚合面板最终截图：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-aggregate-panel-20260724/aggregate-panel-final.png`
- 分段控制器视觉真值：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-627dfd72-302e-4a1c-9410-805d7a0a1e6b.png`（704 × 142，@2x；归一化到352 × 71）
- 分段控制器改造前基线：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-8a58e57e-a762-45a7-a315-b3d8278b050d.png`（600 × 128，@2x）
- 分段控制器最终截图：
  - `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-sliding-tabs-20260724/aggregate-shared-final.png`
  - `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-sliding-tabs-20260724/channel-response-shared-final.png`
- 分段控制器同画面对照：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-sliding-tabs-20260724/reference-vs-aggregate-1x.png`（左参考、右实现；均按1x高度归一化）

## 视觉检查

- [x] 最左侧为 `#f5f5f5` 窄幅纯图标导航栏，没有右边线；中栏与主区分隔线约为 `#f0f0f0`。
- [x] 导航栏包含 Messages、Search、Spaces、Inbox、Tasks、Agents、Settings。
- [x] 图标选中态、间距、尺寸和低对比表面与参考图方向一致。
- [x] Messages 右侧为独立消息中栏，包含“消息 / 已保存 / 频道 / 私信”层级。
- [x] 消息中栏没有搜索框；频道与私信均保留新建入口。
- [x] 频道选中行使用浅蓝表面，频道图标和私信头像尺寸统一。
- [x] Human 消息右对齐、使用 `#e7f0fe`、头像在右，并隐藏重复的自己标题行。
- [x] Agent 消息左对齐、使用 `#f5f5f5`；Human/Agent 头像均为 36px，气泡圆角均为 16px。
- [x] 频道 Agent 气泡顶部位于头像圆心高度；私聊隐藏重复昵称，气泡与头像顶部平齐。
- [x] Agent 时间只显示气泡下方 `HH:mm`，静止时隐藏，消息 hover/focus 时显示。
- [x] hover 工具栏和“更多”菜单共用白色表面、`#f0f0f0` 边线、12px 圆角与相同轻量投影。
- [x] Human 工具栏在左侧空间充足时显示在气泡左边；窄宽度路径按矩形计算回退到上方，Agent 保持右侧/上方规则。
- [x] Agent 昵称为 `400` 常规字重。
- [x] 话题回复预览为气泡外独立白色描边卡片，hover 终态为 `#f7f7f7`，并保留“最新 N 分钟前”。
- [x] 话题分栏从 52px 主标题栏下方开始；父消息容器透明且无 padding，没有重复遮罩。
- [x] 展开话题前后主标题栏横跨同一完整宽度，右侧按钮位置不变，底部分割线连续。
- [x] 话题标题为16px，工具栏高度为44px，操作按钮为28px。
- [x] 话题分栏实测 Agent 头像左边距、Agent 气泡右边距、Human 头像右边距均为 10px。
- [x] 聚合面板新增与主 Chat 同高的 52px 标题栏，标题下分割线与主 Chat 标题栏下边线连续对齐。
- [x] 聚合面板右侧关闭按钮为 30px 圆形点击面，hover 使用 `#f5f5f5` 圆形表面；关闭后可由原标题栏入口恢复。
- [x] “轨迹 / 话题 / 文件”控制器下方不再绘制额外横线；公共轨道使用 `#f5f5f5`、40px高度、2px内缩和12px圆角，白色选中底板为36px高度、10px圆角与克制的多层低透明投影。
- [x] 分段控件文字统一为常规500字重；未选项由偏淡的 `#777` 调整为接近参考图的 `#333`。
- [x] 参考样式落在公共 `SlidingTabs`，聚合面板、频道响应方式和 Agent 默认响应方式不再维护各自的选中视觉；38px紧凑规格沿用同一配方。
- [x] 日期分隔为居中灰色胶囊，没有贯穿消息区的横线。
- [x] Composer 的结构、尺寸、文案和操作区保持原样。
- [x] 参考图与实现截图已在同一对照图中检查；未发现裁切、溢出、错误边距、异常圆角或错误字体权重。

## 交互与可访问性检查

- [x] Messages 图标拥有可访问名称和 hover/focus tooltip。
- [x] 其余图标均拥有可访问名称和 hover/focus tooltip。
- [x] 点击 Tasks 后图标栏保持常驻，消息中栏退出，任务模块正常显示。
- [x] 点击 Messages 后恢复消息中栏和当前 Chat。
- [x] 聚合面板关闭、重新展开和三个分段切换均通过真实浏览器交互验证，切换后对应 `aria-selected` 与内容同步更新。
- [x] 当前入口使用 `aria-current="page"` 表达选中状态。
- [x] 浏览器控制台无 warning/error。

## 历史初轮对抗审查修正

- [x] 话题分栏拖拽命中区固定为 10px，不受壳层栏间距变量影响。
- [x] Chat 加载骨架包含图标栏和消息中栏；业务模块加载骨架只保留图标栏。
- [x] 聚合面板门槛按消息中栏与主 Chat 合计 568px 下限计算，窄窗不再裁切 Chat。
- [x] 频道和已保存入口使用原生按钮；Inbox 未读数进入可访问名称。
- [x] README、术语表与架构文档已同步最新三栏、颜色和间距事实。
- [x] 本轮初始差异（旧气泡色、32px 头像、私聊重复昵称、顶部完整时间、工具栏/菜单和图标栏边线）均已关闭；复验未发现 P0/P1/P2 视觉问题。

## 分段控制器对照迭代

- [x] 初次对照发现 P2：实现轨道为44px高、4px内缩、15px圆角，选中项为600字重，未选文字为 `#777`，整体比参考图更厚、更重。
- [x] 初次修正曾只落在聚合面板作用域；用户补充指出频道响应方式等调用点也属于同一公共组件，因此该局部方案记为 P2 一致性问题。
- [x] 最终修正迁入 `components/SlidingTabs.css`：常规轨道40px、紧凑轨道38px、统一2px内缩、500字重、`#333`未选文字和减弱后的投影；移除聚合面板视觉覆盖。
- [x] 后续同画面对照未发现可执行的 P0/P1/P2 差异；控件宽度差异来自参考容器与现有300px聚合面板的响应式宽度，不改变三等分比例。

## 验证

- [x] `pnpm run typecheck`
- [x] 36 项本轮相关壳层、消息表现和布局单测
- [x] `pnpm test --unit`：924 passed、11 skipped、0 failed
- [x] `pnpm run web:build`
- [x] 真实浏览器频道默认态、消息 hover、更多菜单、私聊态、话题分栏态和聚合面板展开/关闭/切换检查

## 有意保留的产品差异

- 使用 Kith-space 的真实 Space、频道、Agent、聚合面板和标题操作，不复制参考产品的品牌或示例数据。
- 按用户要求省略消息中栏搜索框。
- 按用户要求不修改 Composer。

final result: passed

---

# 工作区标签栏视觉 QA

## Scope and evidence

- Source visual truth: `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-b568a647-85d4-485b-9f0f-699734ad5340.png`
- Implementation screenshot: `/tmp/kith-workspace-tabs-final.png`
- Hover screenshot: `/tmp/kith-workspace-tabs-hover.png`
- Dark-theme screenshot: `/tmp/kith-workspace-tabs-dark.png`
- Focused comparison: `/tmp/kith-tabs-comparison.png`
- Route: `http://127.0.0.1:5273/s/home/channel/5f46398c-0859-4c8b-8f06-b64bae635562?module=inbox`
- Viewport: `1280 × 720 CSS px`，`devicePixelRatio = 2`
- Source dimensions: `2320 × 230 px`，按 @2x 归一化为 `1160 × 115 CSS px`
- Implementation dimensions: 浏览器截图 `1280 × 720 px`；聚焦比较区域 `500 × 60 px`
- State: Inbox 当前标签；Spaces 未选中标签分别验证默认与强制 hover 状态。

## Full-view and focused comparison

- 标签栏、标签内容区和模块内容区统一使用 `var(--card)`；亮色与暗色实测背景色完全一致。
- 标签栏不再绘制底部分割线，模块画布从顶栏到内容保持连续平面。
- 未激活标签默认透明；当前标签与 hover 标签使用 `var(--muted)` 的完整圆角底板。
- 标签高度、图标、文字、关闭按钮和新增按钮密度与参考方向一致；保留 Kith-space 既有模块图标与真实标签文案。
- 聚焦对照足以覆盖本次改动的全部视觉范围，因此不需要额外的全页逐像素比较。

## Required fidelity surfaces

- Fonts and typography: 沿用项目统一界面字体、14px 标签文字和中等字重；截断与关闭按钮间距正常。
- Spacing and layout rhythm: 52px 顶栏内使用 34px 标签和 4px 间距；圆角标签不再与内容边缘拼接。
- Colors and tokens: 只使用 `--card`、`--muted` 与现有前景色 Token；亮暗主题均通过。
- Image and icon fidelity: 没有新增图片资产；继续使用项目现有模块图标库，不使用临时字符或自绘图形。
- Copy and content: 保留 Spaces、Inbox 等真实模块名称；参考图中的产品专有文案不复制。

## Interaction and runtime verification

- 通过新增按钮打开 Inbox，URL 与活动标签同步切换。
- 两个标签同时存在时，未激活、hover、激活和关闭按钮布局均无跳动、裁切或重叠。
- 页面有完整业务内容，无空白页或框架错误覆盖层。
- 控制台无应用错误；仅有既有 React Router v7 future-flag 提示。
- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts`：13/13 passed。
- `pnpm run typecheck`：passed。
- `pnpm run web:build`：passed；仅既有 bundle-size warning。
- `git diff --check`：passed。

## Comparison history

- 初次对照没有发现 P0/P1/P2 差异。
- 截图中新增按钮曾保留键盘焦点环；这是正确的可访问性状态，不修改组件行为，最终中性截图通过主动移除临时焦点完成同状态比较。
- 最终无待处理 P0/P1/P2；没有需要继续阻断交付的视觉差异。

final result: passed

---

# Sidebar 抽屉位移与透明度协同 QA

| Before | After | Why |
| --- | --- | --- |
| 抽屉只做位移，整块面板视觉重量始终不变 | 容器位移与内部内容透明度协同变化 | 降低大面积面板横移的机械感，同时不让透明度参与持久布局切换 |
| 展开与收回只有单一时间轴 | 展开210ms位移/140ms淡入，收回150ms位移/100ms淡出 | 透明度先于位置稳定，让进入更轻；退场更短，让界面更快回到工作状态 |
| 合成提示没有跟随预览生命周期 | 仅在 `opening`、`open` 与 `closing` 阶段分别声明容器 `transform` 和内容 `opacity` 的 `will-change` | 提前建立合成层，同时避免常驻占用 |

- 透明度和位移均使用自定义 ease-out 曲线，快速反向移动时由 CSS transition 从当前位置连续接管。
- 仍以较长的 `transform` 过渡结束事件清理覆盖层，淡出提前结束不会导致退场层级提前撤销。
- `prefers-reduced-motion` 下继续移除 Sidebar 过渡。
- 暗色主题收起态与展开态均已通过本地截图验收（截图不纳入仓库）。侧栏与 Chat、Composer、工作区标签和 Inbox 的接缝均无错位、透底或层级穿透。
- 浏览器计算样式确认悬浮抽屉容器只过渡 `transform`，透明度只作用于内部内容层；持久展开/收起不再淡出 Sidebar 内容。
- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts test/desktopWindowAppearance.unit.test.ts` — 15/15 passed
- `pnpm run typecheck` — passed
- `pnpm run web:build` — passed；仅既有 bundle-size warning
- `git diff --check` — passed

final result: passed

---

# Sidebar 按钮布局动效与黑边回归 QA

| Before | After | Why |
| --- | --- | --- |
| Sidebar 占位宽度与固定容器 `transform` 同时运动 | 与聚合面板同构，只在 Sidebar 外层过渡 `width + flex-basis`；内部容器无独立动画 | 消除布局线程与合成线程两条时间轴，Sidebar 右边缘与 Chat 左边缘由同一个值驱动 |
| 持久切换复用抽屉透明度 | 持久切换不改变透明度，只有悬浮抽屉内容淡入淡出 | 避免布局尚未闭合时露出暗色底板 |
| ChatOnly 宽度依赖 `ResizeObserver` 每帧回写 | ChatOnly 使用稳定 Flex 实时分配剩余宽度 | 消除异步测量慢一帧导致的右侧黑边与聚合面板越界 |
| 父布局变化时 Chat/模块继续执行自己的宽度过渡 | Sidebar 布局运动期间关闭子面板二次宽度插值 | 避免嵌套过渡持续追赶父容器 |
| 点击收起后鼠标仍停在 Sidebar 上，会误启动210ms边缘预览 | 只有最左侧热区能启动预览；Sidebar 本体只能维持已打开的预览，持久切换期间两者同时禁用 | 防止预览时序覆盖420ms持久布局时序，根除桌面真实指针路径下的黑条与跳变 |

- 暗色主题中分别采样持久展开和收起中间帧进行本地验收（截图不纳入仓库）；并使用 macOS Electron 真实鼠标点击复测按钮路径。
- 展开中间帧：Sidebar右边缘、占位右边缘和Chat左边缘均为251.69px；Chat右边缘与聚合间隔起点保持849px，聚合面板固定在859–1159px。
- 收起中间帧：三条左侧边缘均为约4.32px；Chat仍填满至849px，聚合面板继续固定在859–1159px。
- 计算样式确认 Sidebar 与聚合面板均为 `width, flex-basis / 0.42s / cubic-bezier(0.25, 0.8, 0.25, 1)`；Sidebar 内部容器为 `transition: none`。
- 边缘预览状态机通过 `disabled: sidebarTransitioning` 与持久布局互斥；CSS 同时以 `:not([data-sidebar-transitioning="true"])` 作为防御性约束，即使残留预览状态也不能改写持久动画时长。
- 真实指针复测中，展开中间帧的占位右缘/Chat左缘为234.164px，Sidebar容器右缘为234.165px；收起尾帧三者分别为2.141px/2.141px/2.142px，同时 `data-sidebar-preview` 始终为 `closed`。
- 两个方向均未出现黑边、面板越界、输入框穿层或控制台错误；最终收起态与 macOS Electron 展开稳定帧均已通过本地截图验收（截图不纳入仓库）。
- 与聚合面板同构后的展开、收起稳定帧均已通过本地截图验收（截图不纳入仓库）。

final result: passed

---

# 设置页重构视觉 QA（历史记录）

日期：2026-07-23

## 对照范围

- 视口：1092 × 863
- 参考界面：`reference/codeg` 的 Agent SDK 管理截图，以及用户提供的供应商总览 / 编辑弹窗截图
- 改造前基线：用户补充的 Kith-space“运行器”和“记忆 Advisor”截图
- 最终页面：
  - `?module=settings&settings=models`
  - `?module=settings&settings=runtimes`
  - `?module=settings&settings=advisor`

## 同画面对照证据

- `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-settings-audit-20260723/09-runtime-comparison.png`
  - 左侧为 codeg 参考，右侧为最终运行器页。
- `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-settings-audit-20260723/10-runtime-before-after.png`
  - 左侧为 Kith-space 改造前，右侧为最终运行器页。
- `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-settings-audit-20260723/11-advisor-before-after.png`
  - 左侧为 Kith-space 改造前，右侧为最终自动整理记忆页。
- `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-settings-audit-20260723/17-models-overview-comparison.png`
  - 左侧为用户指定的供应商总览参考，右侧为最终模型与供应商页。
- `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/kith-settings-audit-20260723/18-models-modal-comparison.png`
  - 左侧为用户指定的供应商编辑弹窗参考，右侧为最终共享新增 / 编辑弹窗。

## 检查结论

- 运行器页已形成清晰的“左侧列表、右侧当前项详情”主从结构。
- 安装、版本、CLI 账号和默认模型不再混成一行，状态使用普通用户可理解的“可使用 / 需要登录 / 未安装”。
- “重新检查”“检查全部”等按钮在目标视口不换行、不重叠。
- 模型与供应商页改为单列来源总览，只展示已添加供应商、接口类型、模型摘要和模型数量；编辑与删除动作就地可达。
- 新增与编辑复用同一弹窗，供应商连接信息和模型增删在一个流程内完成；弹窗内容区独立滚动，取消 / 保存操作始终可见。
- 浏览器 Web 服务已实测完成供应商新增、改名、模型增删和供应商删除。localhost 浏览器可以录入 API Key；LAN 浏览器只允许管理非敏感字段，并明确提示密钥需在桌面端或本机浏览器设置。
- 模型删除已覆盖成功和失败路径：未被使用的模型删除后重新打开不会复现；正在被运行器、Agent 或自动整理记忆使用的模型会保留弹窗并展示可执行的切换指引，不再误报保存成功。
- 占用提示会显示具体位置；真实浏览器以当前绑定验证后直接提示“OpenCode 的默认模型、Pi 的默认模型、自动整理记忆”，Agent 占用则包含 Space 与 Agent 名称，避免用户逐页猜测。
- 供应商连接与模型列表通过同一个原子接口保存。真实浏览器已验证：删除正在使用的模型时，同一表单内的供应商改名也不会部分落库，重新打开后名称和模型列表均恢复原值。
- 自动整理记忆页只保留启用、整理方式、模型和触发说明；运行记录收进默认折叠的故障排查区。
- 三个页面均未发现文字遮挡、控件重叠、横向溢出或底部 Dock 遮住主要操作的问题。
- Agent 结构化记忆的筛选菜单已在 1092×863 与 1092×520 两档高度验证：浮层保持白色不透明背景，锚定筛选按钮并按可用空间上下翻转，不覆盖 Chat、Agent 列表或底部 Dock。
- 核心交互已验证：切换运行器、检查全部、浏览器供应商 CRUD、弹窗模型增删、受占用模型删除提示、展开故障排查。
- 参考图的视觉语言得到保留，但未照搬其全局 CLI 配置写回、密集环境变量编辑和技术状态码。

## 迭代记录

- 第一版延续“供应商列表 + 详情”主从布局；按用户反馈收敛为更轻量的单列总览，并把全部编辑能力移入弹窗。
- 初次视觉验收发现长弹窗底部操作区超出视口；改为固定高度的弹性容器、内容区独立滚动，复验时底部操作区完整可见。
- 初次删除回归发现接口 `409` 未被页面当成失败；加入统一响应校验后，失败不再继续保存或显示成功提示。
- 独立对抗性审查发现顺序保存可能产生半成品、Agent 固定模型未计入占用、localhost 跨端口边界过宽，以及保留旧密钥时可修改目标地址。最终改为 app.db 单事务保存、跨 Space 占用检查、精确到端口的同源判断，并要求目标地址变化时重新输入密钥。
- 修复后复审继续发现软删除 Agent 永久占用、不可用 Space 被跳过和并发预检位于写锁外；最终排除软删除 Agent、对不可用已登记 Space fail-closed，并把当前状态读取与全部预检一并移入runtime configuration写锁和事务。
- 最终独立复审逐项核对上述阻断项及新增测试，结论为可交付，指定范围内无剩余阻断。
- 最终验证：942 项单测中 931 通过、11 项平台条件跳过、0 失败；集成测试、TypeScript 类型检查、Web 生产构建和 `git diff --check` 全部通过。

final result: passed

---

# Sidebar 边缘悬浮抽屉与工作区自动收起 QA

## Scope and evidence

- Codex 侧栏悬浮抽屉参考：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-cbe8d2c9-42a6-40a6-9282-9de5bad951cb.png`
- macOS Electron 收起态：`/tmp/kith-sidebar-edge-closed-desktop-clean.png`
- macOS Electron 边缘悬浮态：`/tmp/kith-sidebar-edge-preview-desktop-3.png`
- Web 自动收起验证地址：`http://127.0.0.1:5273/s/home/channel?module=inbox`

## Findings and fixes

1. Sidebar 的持久展开状态与临时预览状态已分离。最左侧8px热区只临时拉回现有 shadcn off-canvas Sidebar，不复制导航 DOM，也不改写本地保存的展开/收起偏好。
2. 临时抽屉覆盖在 Chat 与右侧工作区上方，不挤压底层布局；使用侧栏语义 Token、右侧圆角、细边框和阴影，在当前暗色主题下与 sidebar-10 层级一致。
3. 鼠标离开热区和抽屉后延迟120ms关闭，避免从热区进入抽屉时产生闪退；`Escape` 可立即关闭。
4. 打开或切换新的右侧工作区标签时自动收起 Sidebar 一次。相同工作区保持活动期间，用户手动展开不会被 effect 再次强制收起。

## Interaction verification

- Web：手动展开 Sidebar 后点击 Tasks 标签，Sidebar 自动收起；随后点击 `Expand Sidebar` 可以再次正常展开。
- macOS Electron：从工作区把真实鼠标轨迹移动到窗口最左侧，抽屉覆盖出现；鼠标移回工作区后抽屉关闭，底层 Inbox、Chat 和标签栏没有位移。
- 暗色主题截图确认抽屉背景、选中行、边框、圆角、阴影和文字对比正常；未发现白色残留面板、裁切或 z-index 穿透。
- 浏览器和 Electron 控制台无应用错误；仅保留既有 React Router v7 future-flag 提示。

## Automated verification

- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts test/desktopWindowAppearance.unit.test.ts` — 15/15 passed
- `pnpm run typecheck` — passed
- `pnpm run web:build` — passed；仅既有 bundle-size warning
- `git diff --check` — passed

final result: passed

---

# 通用搜索框与首批 shadcn/ui 迁移视觉 QA

- Source: `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-3007fc60-7388-420f-b24f-ebe0a86233f3.png`
- Implementation screenshot: `/tmp/kith-dev-full-final.png`
- Focused comparison: `/tmp/kith-searchfield-focused-comparison-final.png`（左侧为参考图，右侧为实际渲染）
- Viewport: `1042 × 863 CSS px`
- Screenshot density: 浏览器页面 `devicePixelRatio = 2`；浏览器截图为 `1042 × 863 px`；聚焦区域统一放大到参考图的 2× 密度比较。
- State: Space 模块搜索框；输入为空且已获得输入焦点。

## Full-view comparison

参考图只包含搜索框局部，没有可对齐的完整页面。完整实现截图用于检查搜索框在 Space 模块中的实际上下文：组件未裁切，和标题、创建按钮及卡片列表的间距正常，未引起相邻布局回归。

## Focused region comparison

参考图可见主体为 `276 × 40 CSS px`（原图中 `552 × 80 px`，按 2× 密度换算）。实际渲染测量同为 `276 × 40 CSS px`，圆角、`#ececec` 背景、13px 占位文字和 Lucide 搜索图标的位置一致。实际英文文案来自当前测试环境语言；中文环境按调用场景使用对应搜索提示。

聚焦后，输入元素与外层 Input Group 的 `box-shadow` 均已验证为透明；外层没有线框、描边、阴影或浏览器默认 focus ring。

## Findings

- 初次对比：InputGroup addon 继承 shadcn `muted-foreground`，图标比参考图偏深。
- 初次聚焦：项目既有全局 `input:focus-visible` 规则向输入框注入了 2px 黑色阴影。
- 修正：搜索图标显式使用现有 `--muted-soft`；SearchField 输入以 Tailwind important utility 覆盖全局黑色阴影，外层在聚焦时也保持无框无阴影。
- 最终检查：组件尺寸、圆角、底色、图标/文字色和留白通过；新菜单、右键菜单、重命名弹窗、频道删除弹窗均完成真实交互检查，浏览器控制台无错误。
- 最终验证：936 项单测中 925 通过、11 项平台条件跳过、0 失败；相关契约测试、TypeScript 类型检查、Web 生产构建和 `git diff --check` 全部通过。

## Comparison history

1. 参考图 vs 初次实际渲染：发现图标偏深、聚焦态存在黑色阴影。
2. 调整语义色与 focus-visible 阴影后复验：图标与占位文字同为 `rgb(168, 162, 158)`，输入与外层聚焦线框全部消失。
3. 最终同尺寸局部对比及完整页面检查：通过。

final result: passed

---

# Phase 1 Design QA

## Scope

- Theme token foundation with `light`, `dark`, and `system` modes
- Sidebar-10 shell and Chat/workspace seam
- Per-Space module tabs for Tasks, Inbox, Agents, and later modules
- Dark-theme coverage for Chat, module workspaces, menus, and Human messages

## References and evidence

- User layout sketch: `/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-1088f2de-28d7-4b97-a891-3fd6372ce7e5.png`
- Official reference: <https://ui.shadcn.com/blocks/sidebar#sidebar-10>
- Official reference、草图对照、最终暗色工作区、Sidebar-10 暗色壳层与 Human 消息前后对照均已通过本地截图验收（截图不纳入仓库）。

The workspace was checked at 1159 × 863 and the corrected dark contrast was rechecked at 1280 × 720, with the Sidebar expanded, Tasks and Inbox open as tabs, Inbox active, and Dark selected explicitly.

## Visual findings and fixes

1. The Sidebar rail inherited native button styling and produced a visible raised seam against Chat. The rail now resets native appearance and uses the semantic Sidebar border/background contract.
2. The dark shell now matches the supplied Sidebar-10 reference's visible surface hierarchy:
   - Light Sidebar `#fafafa`, active/accent `#f5f5f5`
   - Dark canvas `#0a0a0a`, Sidebar `#171717`, cards `#181818`, active/accent `#343434`
3. Module workspaces and the conversation aggregate contained light-only surfaces. They now use semantic background, foreground, muted, popover, and border tokens.
4. Human messages were nearly white in Dark mode. Dedicated semantic Human-message tokens now produce a dark navy bubble with readable light text and a blue mention accent.
5. Native Button, Select, Tabs, toolbar, and context-menu appearance/focus states were normalized so the shadcn components remain visually consistent.
6. The tab strip and Chat header had a 48/52px alignment mismatch. Both now share a 52px shell header height.
7. The final full view has no horizontal overflow, Vite error overlay, or React error overlay.

## Interaction verification

- Opening an already-open module focuses its existing tab instead of duplicating it.
- Closing the active tab selects the adjacent tab.
- Closing all module tabs returns to Chat-only without removing the Sidebar.
- Module tabs and Sidebar collapsed state persist per Space across reload.
- Tasks, Inbox, and Agents render inside the right-hand tab workspace while Chat remains visible.
- Settings remains a modal and does not become a workspace tab.
- Light, Dark, and System modes apply immediately and persist; System follows the OS preference.
- Sidebar navigation, tab switching/closing, Settings, and theme selection were exercised in the in-app browser.

## Automated verification

- `pnpm run typecheck` — passed
- `pnpm run web:build` — passed; existing bundle-size warning only
- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts` — 11/11 passed
- Full unit suite — 987 passed, 0 failed, 12 skipped
- Full integration suite — passed
- `pnpm exec tsx --test test/chatMessagePresentation.unit.test.ts test/messageHeaderLayout.unit.test.ts` — 27/27 passed

final result: passed

---

# macOS Desktop 顶栏与拖拽区域视觉 QA

## Scope

- 将独立的顶部拖拽细条并入现有侧栏、Chat 和工作区标签顶栏
- 保留 macOS 原生 `hiddenInset` 红黄绿窗口控制器
- 确保 Sidebar 展开/收起时标题、开关和原生控制器互不遮挡
- 确保工作区标签、关闭按钮和其他顶栏控件保持可点击

## References and evidence

- Codex 侧栏收起参考：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-cc430b0a-c70d-463b-a832-99daf1948cbf.png`
- Codex 侧栏展开参考：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-b912b597-5ef7-4bd0-91ad-9c496db59658.png`
- 修复前项目截图：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-d1122ee1-33fd-444d-b354-0c9b74711b2a.png`
- 最终侧栏收起态：`/tmp/kith-titlebar-collapsed-final.png`
- 最终侧栏展开态：`/tmp/kith-titlebar-expanded-final.png`
- 收起态顶栏对比：`/tmp/kith-titlebar-collapsed-comparison.png`
- 展开态顶栏对比：`/tmp/kith-titlebar-expanded-comparison.png`

最终截图来自 macOS Electron Desktop，窗口内容区域为 `1229 × 768 px`，Light 主题，Inbox 模块已打开为工作区标签。

## Findings and fixes

1. 修复前存在一个固定在窗口顶部、`z-index: 1000` 的18px透明拖拽伪元素。它覆盖工作区标签栏顶部并截获点击，同时与下面的8px壳层留白组合成割裂的视觉细条。
2. 删除独立伪元素和壳层顶部留白，改由侧栏标题、Chat 标题、聚合面板标题和工作区标签栏共同承担连续拖拽区域。
3. 顶栏内的按钮、链接、输入控件、`role="button"` 和标签列表统一设为 `no-drag`，避免拖拽命中区吞掉交互。
4. 侧栏展开时，侧栏标题在原生窗口控制器下方开始；侧栏收起时，28px紧凑开关移动到红绿灯右侧，Chat 标题同步增加左侧安全距离。
5. 参考图与实现图的组合对比确认：顶部不再出现独立分割带；展开与收起状态都形成连续、同层的顶栏；紧凑开关、频道标题和工作区标签没有重叠或裁切。

## Interaction verification

- 在真实 Electron 中收起并重新展开 Sidebar，布局和内容均保持正常。
- 从侧栏打开 Tasks 后生成“任务”工作区标签，URL 切换到 `module=tasks&taskScope=space`。
- 点击“收件箱”标签后正常切回 `module=inbox`，证明标签不再被拖拽层拦截。
- 对 Chat 顶栏的非交互区域执行窗口拖拽，操作完成后 Electron 窗口和当前 Inbox 页面继续正常响应。
- 相关契约测试覆盖“无独立拖拽伪元素”“标签列表保持 no-drag”“收起态原生控制器安全距离”。

## Automated verification

- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts test/desktopWindowAppearance.unit.test.ts` — 14/14 passed
- `pnpm run typecheck` — passed
- `pnpm run web:build` — passed
- `git diff --check` — passed

final result: passed

---

# macOS Desktop 顶栏控件精调视觉 QA

## Scope

- 将原生红黄绿窗口控制器略微向下、向内调整
- Sidebar 开关在展开与收起时保持同一窗口坐标
- 使用不同的展开、收起图标，并统一顶栏图标尺寸

## References and evidence

- Codex 侧栏收起参考：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-a8429920-2af9-409e-b2ce-c80e79ea643b.png`（`1476 × 308 px`）
- Codex 侧栏展开参考：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-e6674a90-6ff6-4844-9da6-7177a8b87b9f.png`（`1770 × 446 px`）
- 最终侧栏收起态：`/tmp/kith-titlebar-refined-collapsed.png`
- 最终侧栏展开态：`/tmp/kith-titlebar-refined-expanded.png`
- 收起态对比：`/tmp/kith-titlebar-refined-collapsed-comparison.png`
- 展开态对比：`/tmp/kith-titlebar-refined-expanded-comparison.png`

参考图按50%缩放归一化后与实现对比；实现截图来自 macOS Electron Desktop，内容区域为 `1229 × 768 px`，Light 主题，Inbox 为活动工作区标签，Tasks 同时处于已打开状态。

## Findings and fixes

1. 原生窗口控制器此前完全使用 `hiddenInset` 默认位置，与参考图相比仍偏上、偏外。Desktop 窗口配置现将其固定到 `{ x: 16, y: 16 }`，在保留原生交互的同时获得一致的顶部和左侧边距。
2. Sidebar 开关此前随展开状态改变位置，且两个状态共用同一图标。开关现固定在同一窗口坐标，展开态使用收起图标，收起态使用展开图标。
3. 顶栏图标原先混用14px、17px和18px。Sidebar、频道、工作区标签和顶栏操作图标现统一为14px，开关点击区域保持26px。
4. 参考 Codex 的窗口层级和留白，但不复制其返回、前进和新建任务等 Kith-space 当前不具备的产品操作。
5. 收起与展开对比图确认：窗口控制器与开关垂直对齐，开关没有横向跳动，频道标题和工作区标签没有重叠、裁切或错位。

## Interaction verification

- 在真实 Electron 中连续收起、展开 Sidebar，按钮位置稳定且图标随状态正确切换。
- 点击 Tasks 与 Inbox 工作区标签均能正常切换，标签没有被拖拽区域拦截。
- 从顶栏非交互区域拖动窗口后，Electron 窗口与当前 Inbox 页面继续正常响应。
- 浏览器预览中未发现应用错误；控制台仅保留既有 React Router v7 future-flag 提示。

## Automated verification

- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts test/desktopWindowAppearance.unit.test.ts` — 14/14 passed
- `pnpm run typecheck` — passed
- `pnpm run web:build` — passed
- `git diff --check` — passed

final result: passed

---

# Sidebar 切换按钮命中区回归 QA

## Scope and evidence

- 用户提供的 Web 重叠截图：`/var/folders/z0/fh9q8wnx7v5_19vvzjwddp400000gn/T/codex-clipboard-e56fca1d-d816-46ab-8a32-35c6980fd906.png`
- Web 展开态：`/tmp/kith-sidebar-toggle-web-expanded.png`
- Web 收起态：`/tmp/kith-sidebar-toggle-web-collapsed.png`
- macOS Electron 重新展开态：`/tmp/kith-sidebar-toggle-desktop-expanded.png`

## Findings and fixes

1. Web 会话标题此前没有为绝对定位的 Sidebar 开关预留空间，开关与14px频道图标发生重叠。标题现预留38px前导空间；展开与收起状态下，开关和频道图标的可见间隔均为14px。
2. macOS 开关从 `left: 98px` 左移至 `left: 88px`，展开与收起状态保持同一窗口坐标。
3. 收起态开关覆盖在原生拖拽标题区域上，仅给按钮设置 `no-drag` 仍可能被拖拽命中吞掉。会话标题左侧现增加120px的专用 `no-drag` 区域，同时按钮使用独立点击层和显式 `pointer-events: auto`。

## Interaction verification

- Web：展开 Sidebar → 收起 → 点击 `Expand Sidebar` → 成功重新展开；两个状态均无标题图标重叠。
- macOS Electron：收起 Sidebar 后使用鼠标坐标点击可见按钮，按钮获得焦点并变为 `Collapse Sidebar`，证明真实命中路径已恢复。
- 页面无空白或框架错误覆盖层；控制台仅有既有 React Router v7 future-flag 提示。

## Automated verification

- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts test/desktopWindowAppearance.unit.test.ts` — 14/14 passed
- `pnpm run typecheck` — passed
- `pnpm run web:build` — passed；仅既有 bundle-size warning
- `git diff --check` — passed

final result: passed

---

# Sidebar 抽屉退场层级回归 QA

## Root cause and fix

- 原实现从 `open` 直接切到 `closed`，抽屉的 `z-index: 50` 会在 shadcn 200ms 位移动画开始时立即撤销；仍在屏幕内的退场尾段因此回落到默认 `z-index: 10`，被聊天 Composer 覆盖。
- 预览状态现改为 `open → closing → closed`。`closing` 阶段继续保留 `z-index: 50`、边框、圆角和阴影，仅让 off-canvas 位移执行；200ms 退场完成后才清理覆盖层。
- 鼠标在退场阶段重新进入抽屉会取消清理计时并恢复 `open`，避免快速往返时出现闪烁或穿层。

## Verification

- 契约测试明确要求 `open` 与 `closing` 两个状态共用 `z-index: 50`，只有 `open` 保持 `left: 0`。
- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts test/desktopWindowAppearance.unit.test.ts` — 15/15 passed
- `pnpm run typecheck` — passed
- `pnpm run web:build` — passed；仅既有 bundle-size warning
- `git diff --check` — passed

final result: passed

---

# Sidebar 收起态边缘光标回归 QA

- 根因：shadcn `SidebarRail` 在 off-canvas 收起后仍停留在窗口左缘，并保留约4px的 resize 光标命中范围。
- 修复：仅在 `data-collapsible="offcanvas"` 收起态隐藏 Rail，并禁用其 pointer events；展开态 Rail 与顶部 Sidebar 开关不受影响。
- 浏览器实际命中验证：左侧3px命中 `.shell-sidebar-edge-trigger`，计算光标为 `auto`；Rail 为 `display: none / pointer-events: none / cursor: default`。
- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts test/desktopWindowAppearance.unit.test.ts` — 15/15 passed
- `pnpm run web:build` — passed；仅既有 bundle-size warning
- `git diff --check` — passed

final result: passed

---

# Sidebar 抽屉退场动效优化 QA

| Before | After | Why |
| --- | --- | --- |
| 通过 `left` 执行200ms线性位移 | 通过 `translate3d` 执行GPU合成位移 | 避免布局与绘制开销，降低复杂聊天页面上的掉帧风险 |
| 展开与收回使用相同速度 | 展开200ms drawer曲线，收回140ms强ease-out曲线 | 高频退场更利落，同时保留空间连续性 |
| 固定定时器直接结束退场 | `transitionend` 作为主完成信号，320ms仅作异常兜底 | 不再比浏览器实际动画早一帧清理并造成跳变 |

- 快速重新进入时 CSS transition 从当前位置反向，不重启动画。
- `prefers-reduced-motion` 下移除 Sidebar 位移动画。
- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts test/desktopWindowAppearance.unit.test.ts` — 15/15 passed
- `pnpm run typecheck` — passed
- `pnpm run web:build` — passed；仅既有 bundle-size warning
- `git diff --check` — passed

final result: passed

---

# 工作区标签 28px 紧凑规格 QA

- Source visual truth: 用户在 `收件箱` 标签上的浏览器批注，以及调整前截图 `/tmp/kith-workspace-tabs-final.png`。
- Implementation screenshot: `/tmp/kith-workspace-tabs-28px.png`。
- Focused before/after comparison: `/tmp/kith-tabs-28px-comparison.png`。
- Viewport: `1280 × 720 CSS px`，`devicePixelRatio = 2`；浏览器截图为 `1280 × 720 px`。
- State: 空间与收件箱两个标签同时打开，收件箱为当前标签。
- 实测标签与新增按钮高度均为 `28px`；标签触发区左内边距 `8px`、右内边距 `0`，关闭按钮右外边距 `2px`，形成约 `8px` 的右侧视觉留白。
- 字体、图标和文案继续使用既有组件；没有新增或替换图片资产。
- 当前态、未选态、标签切换和新增按钮均无裁切、错位或点击区退化；空间与收件箱双向切换后 URL 正确同步。
- 页面无空白或框架错误覆盖层；控制台无应用错误，仅有既有 React Router v7 future-flag 提示。
- `pnpm exec tsx --test test/chatShellSidebarNavigation.unit.test.ts`：13/13 passed。
- `pnpm run typecheck`、`pnpm run web:build` 与 `git diff --check`：passed；构建仅有既有 bundle-size warning。
- 同画面对照未发现待处理 P0/P1/P2；最终尺寸与用户指定的新增按钮高度一致。

final result: passed
