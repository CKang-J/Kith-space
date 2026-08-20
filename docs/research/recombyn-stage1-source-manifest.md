# Recombyn Canvas 阶段 1 来源、许可与能力处置

> 上游固定为 `reference/recombyn@abd81983716b41c7fc6e2f591c23e6d9bb9c4643`。本阶段仅提供开发态原生 editor island、内存 document seam 与禁用的外部能力外壳；Workspace Tabs、SQLite、Canvas Core、Agent Gateway/写回均未开始。

## 精确来源与生成方式

`pnpm run canvas:stage1:materialize` 是唯一复制入口，依次执行：

1. `scripts/audit-recombyn-stage1-closure.mjs`：直接读取固定 `abd8198` Git object，不依赖 `reference/recombyn` 当前 checkout；从 `EditorPage.tsx`、RCB/editor/nodes/chrome/panels/styles 等 13 个入口解析静态 import/export、字面量 dynamic import 和 `new URL(..., import.meta.url)`。
2. `scripts/materialize-recombyn-stage1-native.mjs`：从同一固定 Git object 按审计清单写入 `web/src/features/canvas/upstream/`，加入固定来源/Apache 修改声明并只执行 manifest 已记录的 alias、portal、能力禁用与 adapter 转换。
3. `scripts/build-recombyn-stage1-css.mjs`：使用上游 Tailwind 3 配置生成 CSS，把 light/dark token 与 Preflight 一并置于 `@scope ([data-kith-canvas-root][data-recombyn-native-editor])`，保留原字体栈但移除未核清的在线字体请求。

机器清单是权威逐文件 manifest：

- `docs/research/recombyn-stage1-upstream-closure-audit.json`：320 个上游条目、4,007,797 bytes、44 个外部包；SHA-256 `2af57bde12acebe032716c63af473e8db9e0bc9d935dce39d2b1a670edbe7383`。
- `web/src/features/canvas/upstream/source-mapping.json`：每项包含完整上游路径、固定 source SHA-256、目标路径、target SHA-256、处置和逐项变化；SHA-256 `dc57bca5e5449f4930f7d892cf47adde0bd195d0cccd0d808bf1a0af4cd93397`。
- 320 项处置：17 个非代码文件 exact copy；297 个原生源码文件保留上游结构并作声明/alias/隔离转换；4 个 host adapter seam；2 个无法核清的模型品牌 PNG 不复制。实际 materialize 318 项。`service/chat.ts` 的媒体 Job 实现改为 unavailable 后，其未使用的 `utils/request` 依赖从审计和物化闭包一并移除。
- `fixtures/recombyn-upstream-scene.json` 来自用户指定 live editor 的原生“导出 JSON”；原始导出 SHA-256 为 `665aac2e159423f8fad9fff06b49ea21fc1e35308d010525d920dde99fe87f42`。唯一在线生成图 URL 因许可/长期可用性不可核清，以同尺寸本地中性 SVG 替换；入仓 fixture SHA-256 为 `647dedce04fada8a1faa2344d7cb7a19b5d7022e3768c8f9a22d718a4e58a335`，其余 scene 结构和值保持原导出。`recombyn-stage1-fixture-transformation.json` 记录 JSON pointer、变换前后值摘要和移除该 pointer 后相同的 canonical document 摘要，使变换不依赖下载目录即可复核。

静态 resolver 不解析 CSS `url()` 或运行时拼接模块；CSS 在线 URL 另由 fail-closed 构建检查处理。`exportRaster.worker.ts` 已由 `new URL` 纳入，审计无 unresolved import。

## 宿主 seam 与有意修改

Kith 新写代码只位于 host/adapters/state：

| 文件 | 职责 |
|---|---|
| `host/NativeRecombynCanvasHarness.tsx` | 原生 `EditorPage` 的开发入口、固定 fixture、Provider/Router、主题与文案宿主适配 |
| `adapters/recombynStageOneServices.ts` | API query 返回显式空结果；mutation/外部动作抛 `StageOneCapabilityUnavailable` |
| `adapters/recombynStageOneWallet.ts` | 钱包/计费 query 返回本地空快照，阻断绕过 client seam 的 raw fetch |
| `adapters/recombynStageOneCollaboration.tsx` | 保留 Provider 组件边界但不启动 Yjs/WebSocket/IndexedDB |
| `adapters/recombynUnavailablePlatform.ts` | 把上游 Tauri 动态入口收口为显式 unavailable，不链接 native runtime |
| `adapters/recombynProjectMemory.ts` | 替代 IndexedDB 的进程内 draft/session store |
| `adapters/recombynNativeDocument.ts` | 内存 canonical document；上游 Redux 只作编辑交互/UI/投影状态 |
| `adapters/recombynComposerSceneContext.ts` | 从上游收敛生成器 composer 真正使用的三个纯 scene helper，不引入 Agent runtime |
| `adapters/recombynLocalMedia.ts` | 只接受 data/blob 与本地 FileReader；拒绝 HTTP(S) 和 Recombyn upload URL |
| `adapters/recombynStageOneDesign.ts` | 保留原生模型/生成器 UI 的 design 类型边界，执行明确 unavailable |
| `adapters/recombynFloatingUi.tsx` | Floating UI portal 固定挂入 island 内部；resize 的临时 cursor/user-select 也只作用于 island |
| `adapters/recombynReactDom.ts` | 把上游指向 `document.body` 的 React portal 改挂 island portal root |
| `adapters/recombynBrandAssets.ts` | 两个排除品牌 PNG 的中性本地 fallback |
| `state/nativePerformanceProbe.ts` | 只读活动 pointer/wheel 输入到下一 rAF callback 延迟采样，不参与编辑状态 |

原生 UI 中的最窄修改也逐项写入 `source-mapping.json`：AgentDock、开关与占位移除；图片/视频生成提交缩为显式 unavailable；引用文件只保存在本地 data URL；图片 AI 处理、导出与其他外部副作用 disabled，但原组件、布局、菜单、图标和 disabled 视觉保留。selection-to-chat 只保留 host event seam。导出文案从 Page 改为 Frame/Canvas，不引入 Kith Page 领域模型。旧手写 `StageOneEditorChrome/StageOneNodeLayer/StageOneCanvasSurface/recombyn-stage1.css` 脚手架已删除。

## 迁入 / 替换 / 延后 / 删除

- 直接迁入并运行：`EditorPage`、完整 RCB camera/scene/selection/tools/frames、原生 nodes、editor chrome、Layer/Asset/Export panels、minimap、shortcuts、image context toolbar、Tailwind 3 token/Preflight/theme、原图标与本地画布编辑逻辑；AgentDock 不进入物化闭包。
- 替换：cloud/API client、IndexedDB draft store、body portal、两张未知品牌 PNG；产品名只在 loader 文案替换为 Kith-space。
- 延后且 UI disabled：文件上传、OCR/image-to-scene、AI 生成、remove-bg/upscale/eraser/mark/layer/multi-angle 等图片任务、真实导出、Agent 发送/上传。
- 删除/不进入入口：Home/Auth/Billing 页面、Recombyn Python/LangGraph runtime、云凭据/钱包语义、正式协作会话和持久化连接。源码闭包中为保持类型与原组件结构而存在的模块，不代表运行时能力已启用。

### 闭包中保留的 agent-chat / api-service 文件

- 原生生成器 composer UI：`AgentComposerShell.tsx`、`AgentModelsPanel.tsx`、`agentRoutePrefs.ts`、`AgentRoutePrefsEditor.tsx`、`customLlmProviders.ts`、`ImageAspectRatioPicker.tsx`、`llmModelMeta.ts`、`MentionAttachPanel.tsx`、`ModelPickerPanel.tsx`。它们保留模型、比例、引用和本地偏好界面；design 调用已改走 unavailable adapter。
- selection seam：`flyToChat.tsx` 只保留画布选择到 host event 的原生过渡表现；`utils/chatImageDrag.ts` 只保留本地拖动 payload 解析。
- `service/chat.ts`：仍为原生媒体 composer 提供共享类型；图片、视频、音频生成函数在物化时统一改为直接 unavailable，媒体 Job URL 和轮询 transport 已移除。
- `service/auth.ts`、`service/projects.ts`：原生 editor shell/项目类型兼容，实际请求统一落到被替换的 `service/client.ts`。
- `service/collab.ts`：保留原生协作类型边界；真正 Provider 已由 `recombynStageOneCollaboration.tsx` 替换，不启动 Yjs/WebSocket/IndexedDB。
- `service/imageTools.ts`：保留原生图片工具类型和 disabled UI；阶段 1 图片处理入口不可执行。
- `utils/apiBase.ts`：保留 editor shell 的 URL/本地模式兼容；`service/upload.ts` 已退出闭包，`utils/uploadImage.ts` 整体物化为 data/blob 本地边界，不包含 API client、token、upload URL 或远端 fetch fallback。
- `service/wallet.ts`、`service/client.ts`：source mapping 中保留来源身份，但产物分别由本地空钱包 seam 和统一 unavailable API seam 完整替换。

## 45 / 28 / 24 逐项处置

`web/src/features/canvas/manifests/upstreamDisposition.ts` 固定：

- 45 个 prompt kind；
- 28 个 design skill；
- 24 个 ToolOps。

每项含准确 key、来源路径、许可证、处置枚举和理由。`dependencies` 只表示硬运行依赖（skill `_meta.json` 的 `extends` / `preferred_tools`，或 ToolOps 的实际执行 port）；skill `related` 逐项锁定 `SKILL.md` 的 `## Related` 交叉引用，prompt `usedBy` 逐项锁定 `_index.json`。测试对 45 个 prompt 的 `usedBy` 和 28 个 skill 的 `related` 与固定上游逐项比对，而非只验数量。阶段 1 不把这些 prompt/skill/Agent ToolOps 注册到 Kith runtime，也不产生 Agent 写回。

## 许可与资产结论

- Recombyn 根代码为 Apache-2.0；根 `NOTICE` 保留完整上游 notice 并声明 Kith 修改。生成的每个上游源码文件都有固定 commit、来源路径、`Modified by Kith-space` 与 Apache/NOTICE 声明。
- 28 个 skills 中 25 个随 Recombyn 根许可证为 Apache-2.0；`awesome_design_md`、`garden_style`、`shadcn_ui` 自带 MIT。阶段 1 只记录 manifest，不复制 skill 正文。
- Paynter `watercolor.png` 缺少可随分发的完整 notice；brush tip 位图不复制，`brush_ops` 延后。
- `SmileySans-Oblique.woff2` 无同目录可核许可证，不复制。
- 上游 `fonts.css` 的 Google Fonts/jsDelivr URL 只作为 Apache 源文件引用保留在 source mapping；运行 CSS 中没有这些 URL，也没有下载/打包字体 bytes。保留原字体栈，命中安装级 Alibaba/Noto 或系统 fallback。
- Recombyn logo-mark/favicon/mascot 二进制未复制；loader 的上游品牌字样替换为 Kith-space。
- `@lobehub/icons-static-svg` 现已作为 web 构建依赖安装（与 Recombyn 同包、`^1.94.0`），供 Canvas 模型选择器显示供应商图标；静态 SVG 经 Vite `?url` 打进产物，不发起在线图标请求。两张未核清来源的 PNG `dreamina.png`、`sync_lipsync.png` 仍不复制：Dreamina 回退到同包 `jimeng-color.svg`，lipsync 继续用中性 SVG data URI。editor cursor SVG 与 React icon 源代码位于 Apache 上游闭包。不存在在线 AI 资产请求。

## 能力矩阵

| 能力 | 阶段 1 | 可见行为 / 边界 |
|---|---|---|
| 无限 pan/zoom、选择/多选/变换、Frame、文字、shape、pen/pencil | active | 上游原生 Redux/RCB，本地内存 document 投影 |
| 分组/层级/锁定、对齐/分布/翻转/布尔、快捷键、面板 | active | 上游本地逻辑；未写 Core/SQLite |
| 媒体节点渲染 | active fixture | 只用本地 placeholder；无在线资源 |
| JSON fixture import | harness-only | 启动时内存重放固定 SceneDocument，不是正式 Import Service |
| 图片/视频/音频导入与替换 | local-only | 浏览器 FileReader 形成 data URL 并进入内存/开发态文档投影；无对象存储或 Recombyn upload 请求 |
| OCR / image-to-scene | disabled/defer | 未接模型、job 或安全边界 |
| AI 资产/图片/视频/音频生成 | disabled/defer | 不调用 Recombyn API/runtime |
| remove-bg/upscale/eraser/mark/分层/多角度 | Stage 1 曾 disabled；当前 Human 工具条已启用放大/去背景/橡皮/标记/多角度（Kith Job / 本地），分层仍 defer | 见 `docs/progress.md` |
| PNG/JPEG/SVG/JSON 导出 | disabled/defer | 原菜单保留，Frame/Canvas 文案适配；不触发下载/Tauri |
| Canvas selection-to-chat | active seam | 只派发本地 host event；无 AgentDock、Agent runtime、上传或写回 |

## 跨平台风险

新增宿主代码只使用 React/DOM/URL/Pointer Events、Node `path`、OS 临时目录和内存对象，没有盘符、shell、POSIX signal、Tauri 或路径分隔符假设；Tauri/Yjs 包不在 Kith 依赖中。当前只在 macOS Chrome 151 实测；Windows/Linux 仍需 CI/真实 smoke 覆盖字体 fallback、触控板 wheel、Pointer capture、GPU/SVG/Lottie/FFmpeg worker 差异。Stage 1 不把“共享 TypeScript 可构建”表述为三端实机已通过。

## 最终验证（2026-08-15）

- `pnpm run typecheck`：通过。
- Canvas 定向契约（document authority、320 项 source mapping/隔离 seam、45/28/24 处置）：7/7 通过。
- `pnpm run web:build`：通过，4,687 modules；普通 production 没有 Native Recombyn 运行入口。
- `pnpm run canvas:stage1:build`：通过，4,687 modules；原生 island JS 3,526.73 kB（gzip 1,060.59 kB）、隔离 CSS 133.73 kB（gzip 24.09 kB）。保留 `lottie-web` eval、上游静态/动态重复 import 与大 chunk 提示，不把这些提示记为性能门通过。
- `pnpm test --unit`：1,012 tests，999 pass，12 platform skip，1 fail。唯一失败是既存 `web/src/personalAgentOsContract.test.ts:95` 对多行 `<Sidebar collapsible="offcanvas">` 的文本正则不匹配；该测试和 `WorkspaceNavigationRail.tsx` 均不在本阶段 diff，Canvas 定向契约不受影响。未把完整 unit 表述为全绿。
- `git diff --check`：通过。浏览器/截图/console/computed-style/交互与性能结果见同目录 live baseline、browser evidence 和 performance baseline；当前实机覆盖仅 macOS Chrome 151，Windows/Linux 未运行。
