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
- [x] 日期分隔为居中灰色胶囊，没有贯穿消息区的横线。
- [x] Composer 的结构、尺寸、文案和操作区保持原样。
- [x] 参考图与实现截图已在同一对照图中检查；未发现裁切、溢出、错误边距、异常圆角或错误字体权重。

## 交互与可访问性检查

- [x] Messages 图标拥有可访问名称和 hover/focus tooltip。
- [x] 其余图标均拥有可访问名称和 hover/focus tooltip。
- [x] 点击 Tasks 后图标栏保持常驻，消息中栏退出，任务模块正常显示。
- [x] 点击 Messages 后恢复消息中栏和当前 Chat。
- [x] 当前入口使用 `aria-current="page"` 表达选中状态。
- [x] 浏览器控制台无 warning/error。

## 历史初轮对抗审查修正

- [x] 话题分栏拖拽命中区固定为 10px，不受壳层栏间距变量影响。
- [x] Chat 加载骨架包含图标栏和消息中栏；业务模块加载骨架只保留图标栏。
- [x] 聚合面板门槛按消息中栏与主 Chat 合计 568px 下限计算，窄窗不再裁切 Chat。
- [x] 频道和已保存入口使用原生按钮；Inbox 未读数进入可访问名称。
- [x] README、术语表与架构文档已同步最新三栏、颜色和间距事实。
- [x] 本轮初始差异（旧气泡色、32px 头像、私聊重复昵称、顶部完整时间、工具栏/菜单和图标栏边线）均已关闭；复验未发现 P0/P1/P2 视觉问题。

## 验证

- [x] `pnpm run typecheck`
- [x] 36 项本轮相关壳层、消息表现和布局单测
- [x] `pnpm test --unit`：923 passed、11 skipped、0 failed
- [x] `pnpm run web:build`
- [x] 真实浏览器频道默认态、消息 hover、更多菜单、私聊态和话题分栏态检查

## 有意保留的产品差异

- 使用 Kith-space 的真实 Space、频道、Agent、聚合面板和标题操作，不复制参考产品的品牌或示例数据。
- 按用户要求省略消息中栏搜索框。
- 按用户要求不修改 Composer。

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
