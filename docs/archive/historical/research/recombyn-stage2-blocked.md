# Recombyn 阶段二阻塞记录

## 已记录但不阻塞

- 任务书要求新增 workspace schema immutable migration，但路径白名单未逐项列出 `drizzle/**`。现有 `src/db/index.ts` 只从 `drizzle/` 执行迁移，若不新增 `drizzle/0013_canvas_core.sql` 并更新 journal，schema v12 无法真实创建或升级。按“确需越界先记 blocked”记录；仅修改这一必要迁移及其元数据，不扩展到其他路径。
- Stage1 materializer 为隔离云 upload 副作用，把原生 `EditorToolStrip` 媒体按钮固化为 `disabled`；阶段二必须恢复该原生入口，但又必须保持 Stage1 mapping SHA 且禁止直接改 `upstream/**`。采用 Vite `pre` 阶段的单文件、单匹配、失败即停的 Stage2 materializer，仅在编译流把 `disabled` 还原为 `disabled={toolsLocked}`；磁盘上的 upstream 和 Stage1 source mapping 均不变。
- 当前 mutation ledger 已从三份完整 scene 收敛为 operation/inverse 与轻量 committed result，但仍按 Canvas 历史线性保留；资产 reachability 为保证任意 Core Undo/Redo 可恢复，也会把历史中引用过的资产视为占用。长生命周期下的有界 retention/checkpoint/GC 尚未实现，不能把长期存储性能或资产回收门禁表述为通过。
- Canvas 已 lazy-load，但生产独立 chunk 仍约 3.5 MB，Vite 的 >500 kB 与 lottie `eval` 告警未关闭；构建成功只证明功能可打包，不代表性能/CSP 门禁通过。

## 当前阻塞

无。

阶段2所有收尾已实现并通过主任务最终复核；Windows/Linux junction/reparse 与真实文件占用仍未实机验证，物理资产 GC 明确留阶段5，不作为当前阻塞或通过项。
