# Kith-space 文档总览

本文档是 `docs/` 的唯一入口。它不重复展开各文档内容，只告诉你"哪份文档解决什么问题、何时读它"。

上手流程：读 `AGENTS.md` 了解项目与开发约定 → 按需查下列文档。

## 核心文档

| 文档 | 作用 | 何时读 |
|---|---|---|
| [`vision.md`](./vision.md) | 产品理念与长远愿景、永久边界 | 理解"为什么" |
| [`decisions.md`](./decisions.md) | 全部锁定决策、推理与权衡 | 理解"凭什么这样定" |
| [`glossary.md`](./glossary.md) | 术语正典，防口径漂移 | 术语拿不准 |
| [`dev-commands.md`](./dev-commands.md) | 日常开发命令（启动/测试/打包） | 跑起项目 |
| [`dev-debugging.md`](./dev-debugging.md) | 低频高级调试（凭据/Web/数据库/E2E） | 需要调试 |
| [`frontend-standards.md`](./frontend-standards.md) | 前端技术栈约束、代码约定与质量检查 | 改前端 |
| [`brand.md`](./brand.md) | 品牌资产与回归约束 | 涉及品牌/图标 |

## kith-space/（专项设计）

- [`kith-space/agent-harness-v2-mechanisms.md`](./kith-space/agent-harness-v2-mechanisms.md) — **P-A10 Agent Harness v2 机制全景导读**：架构图、时序图、状态机。理解"这些机制如何共同工作"优先读这里。
- [`kith-space/architecture-proposal.md`](./kith-space/architecture-proposal.md) — 目标架构：模块边界 / 信任边界 / runtime / 数据层 / 护栏。
- [`kith-space/ui-direction.md`](./kith-space/ui-direction.md) — 界面信息架构与视觉语言。
- [`kith-space/product-brief.md`](./kith-space/product-brief.md) — 产品定位（"是什么、给谁用、明确不是什么"）。

## archive/（历史归档）

只读历史记录，不构成当前事实。新增或修改功能时**不要**据此决策，除非文档明确指向：

- `archive/specs/` — 各历史设计规格（阶段性产品/架构设计，已实现）。
- `archive/kith-space/` — 已归档的 MVP 规格与迁移计划。
- `archive/performance/` — 已归档的性能基线（P-A9 / P-A10）。
- `archive/architecture/` — 已归档的架构契约矩阵。
- `archive/adr/` — 已归档的 ADR。
- `archive/historical/` — 早期调研、探索报告、一次性验收记录（research/analysis/notes/prototypes，以及 canvas 实现总结、design-qa 等）。
- `archive/cross-platform-compatibility.md` — 已归档的三端工程兼容基线与缺口清单。

## 目录说明

```
docs/
├── index.md                 ← 本入口
├── vision.md  decisions.md  glossary.md
├── dev-commands.md  dev-debugging.md
├── frontend-standards.md  brand.md
├── kith-space/              ← 当前专项设计（机制/架构/UI/定位）
├── superpowers/             ← 目录保留（历史 specs 已归档到 archive/specs/）
└── archive/                 ← 历史归档（specs/kith-space/performance/architecture/adr/historical 等，不做当前事实）
```
