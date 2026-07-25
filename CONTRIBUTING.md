# 参与 Kith-space 开发

感谢你愿意参与 Kith-space。本项目采用轻量 GitHub Flow：只保留一个长期主分支 `main`，每项改动在短分支完成，通过 Pull Request（PR）合入。

项目背景、架构边界和 AI 开发约束以 [`AGENTS.md`](./AGENTS.md) 为准；当前进度以 [`docs/progress.md`](./docs/progress.md) 为准；开发、测试和打包命令以 [`docs/dev-commands.md`](./docs/dev-commands.md) 为准。

## 开始之前

- 先阅读 `AGENTS.md` 和与改动相关的权威文档。
- 一个分支、一个 PR 只处理一个目标，不混入无关重构或格式化。
- 较大的功能、架构变更或拿不准的方向，先开 Issue 讨论；小修复和文档改动可直接提交 PR。
- `reference/` 仅供本地对照，不纳入提交。OpenLoaf 是 AGPLv3 项目，只能参考理念和交互，不得复制其源码。

## 分支

从最新 `main` 创建短分支，不使用长期 `develop` 分支。下面以 GitHub clone 的默认远端名 `origin` 为例；如果本地远端名是 `github`，请将命令中的 `origin` 替换为 `github`。

```powershell
git switch main
git pull --ff-only origin main
git switch -c feat/short-description
```

常用命名：

- `feat/...`：新功能
- `fix/...`：问题修复
- `docs/...`：文档
- `refactor/...`：重构
- `chore/...`：维护工作
- Codex 创建的分支使用 `codex/<type>-<description>`

不要直接向 `main` 推送代码。

## 开发与验证

- 保持最小必要修改，匹配现有风格。
- 新增前端 UI 使用 Tailwind CSS v4 与 shadcn/ui，优先复用 `web/src/components/ui/`，并遵循 `AGENTS.md` 的前端开发规范；存量 CSS 只按触达范围渐进迁移。
- 提交前查看 `git status`、`git diff --stat` 和 `git diff`，确认没有密钥、本机路径、生成物或无关文件。
- 代码改动至少运行 `pnpm run typecheck` 和相关测试；完整测试命令见 `docs/dev-commands.md`。
- 开发共享功能时必须检查 Windows、macOS、Linux 的路径、权限、进程、shell、native module 和 Electron 差异；详细规则与当前缺口见 `docs/cross-platform-compatibility.md`。
- 平台相关 PR 要列出三端验证结果。未在某端运行时写明原因和对应 CI/待办；平台条件 `skip` 不得表述为该端已通过。
- 只改文档时不要求本地运行完整代码测试，但仍需检查链接、命令和差异；PR 中如实注明未运行的检查。
- 命令、架构、产品决策、界面信息架构或阶段状态发生变化时，同一个 PR 更新对应权威文档。

## 提交信息

使用中文 Conventional Commits：

```text
<类型>(<模块>): <中文摘要>
```

例如：

```text
feat(space): 支持重新定位失联空间
fix(runtime): 修复任务终止后状态未更新
docs(dev): 更新桌面端调试命令
chore(deps): 更新 Electron 依赖
```

可用类型：`feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`build`、`ci`、`chore`、`revert`。模块可省略；需要正文时使用中文要点说明原因、边界和验证结果。

一次提交应表达一个可独立理解、可回退的逻辑改动。分支中出现临时提交没有关系，PR 最终会通过 Squash 合并为一个主干提交。

## Pull Request

- PR 标题使用与提交信息相同的格式，并概括整个改动。
- 按 PR 模板填写目标、变更、测试证据、文档同步和未验证内容。
- 当前频繁开发阶段，PR 更新不自动触发完整三端 CI；提交者必须在 PR 中如实记录本地验证。`verify` 会在改动合入 `main` 后自动执行，也可在 GitHub Actions 中按需手动触发；当前单人维护阶段不强制人工审批。
- 合并前重点检查：改动是否只围绕目标、是否包含敏感信息、测试是否覆盖关键路径、文档是否与代码一致。
- 使用 **Squash and merge** 合入 `main`，合并后删除远端分支。

合并后同步本地仓库：

```powershell
git switch main
git pull --ff-only origin main
git branch -d <branch-name>
git fetch --prune origin
```

## 使用 AI 开发

向 AI 交代任务时，尽量给出目标、非目标、允许修改的范围、完成标准和需要运行的检查。AI 应保留用户已有改动，不做无关清理；只有在用户明确要求时才创建提交、推送或 PR。
