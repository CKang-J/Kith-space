# OpenCode 模型发现与 Runtime 安装状态设计

日期：2026-07-12

## 背景

Kith-space 创建 OpenCode Agent 时只能显示 `Default`。实测本机执行 `opencode models` 可以返回 16 个 `provider/model`，但 Worker 内的模型探测返回 `null`。原因是模型探测仍直接使用 Node 原生 `spawn`，没有经过已经建立的 Windows 跨平台 runtime 进程边界，因而无法正确启动 npm 安装产生的 OpenCode shim。

当没有显式模型时，OpenCode 会自行选择默认 Provider。本机当前没有配置明确的默认模型，实际落到了一个认证无效的 Provider，并返回 `401 Invalid API Key`。Kith-space 不应再用虚假的 `Default` 掩盖模型发现失败。

创建 Agent 界面目前还硬编码全部 runtime，不能反映 Local Runtime Worker 实际检测到的安装状态。

## 目标

1. OpenCode Agent 创建界面展示用户现有 OpenCode 配置可见的真实模型列表。
2. 创建 OpenCode Agent 时必须选择明确的 `provider/model`，避免静默落入不可控的默认 Provider。
3. runtime 列表展示全部受支持 runtime，明确标注安装状态，已安装项排在前面。
4. 未安装 runtime 保留展示但禁止选择，避免创建必然无法启动的 Agent。
5. runtime 及 Provider 凭据继续由用户安装的外部 runtime 自己管理，Kith-space 不复制或保存其 API Key。

## 非目标

- 不在 Kith-space 中新增 OpenCode Provider API Key 管理。
- 不修改用户的 OpenCode 全局配置或认证文件。
- 不尝试在创建 Agent 时验证每个模型的远端额度、权限或 API Key 有效性。
- 不自动安装缺失的 runtime。

## 方案

### 1. Runtime 目录与安装状态

服务端维护一份受支持 runtime 的规范目录，包含稳定 ID 与显示名。安装状态来自当前已连接 Local Runtime Worker 的 runtime 探测快照，不由前端自行推断。

新增本地 runtime HTTP 查询接口，返回全部目录项：

```ts
type RuntimeAvailability = {
  id: RuntimeId;
  label: string;
  installed: boolean;
};
```

返回顺序遵循：

1. 已安装项优先；
2. 同一状态内保持规范目录原顺序，保证界面稳定。

Worker 未连接时，所有目录项视为未检测到安装；接口不得伪造已安装状态。

### 2. 创建 Agent 界面

创建 Agent 弹窗打开后读取 runtime availability：

- 已安装项显示“已安装”，可选择；
- 未安装项显示“未安装”，置于列表后部并禁用；
- 默认选择第一个已安装 runtime；
- 没有已安装 runtime 时禁止创建，并显示明确提示。

前端不再维护独立的 runtime 安装判断逻辑。必要的静态类型与请求状态可以独立成小模块，避免继续扩大成员管理组件的职责。

### 3. OpenCode 模型发现

Worker 的模型发现统一使用现有跨平台 runtime 进程边界执行：

```text
opencode models --verbose
```

若 verbose 输出不可用，可以沿用普通 `opencode models` 的兼容回退。解析结果保留 OpenCode 官方 `provider/model` ID，并去重。

行为规则：

- 探测成功且有结果：仅展示真实模型，不追加 `Default`；
- 探测失败或为空：显示“无法读取模型配置”，禁止用 OpenCode 创建 Agent；
- 切换 runtime 时取消或忽略过期请求结果，避免旧模型覆盖当前选项。

### 4. OpenCode 启动

启动 OpenCode 时始终向 `opencode run` 传入用户选择的明确模型：

```text
--model provider/model
```

自动批准参数采用当前官方公开参数 `--auto`，替换旧的 `--dangerously-skip-permissions`。模型和 Provider 认证仍由 OpenCode 自身配置解析。

如果运行时返回认证错误，Kith-space 保留 OpenCode 的错误语义，并在可获得时带上当前模型 ID，帮助用户定位对应 Provider；不得打印 API Key 或完整敏感配置。

## 模块边界

- Local Runtime Worker：负责可执行文件探测、模型 CLI 调用和输出解析。
- Core Service：负责规范 runtime 目录、把 Worker 快照映射为 availability，并提供 HTTP 接口。
- Web UI：只负责读取状态、展示、选择和提交，不自行执行本地探测。
- OpenCode adapter：只负责启动协议、明确模型参数和事件转换，不管理 Provider 凭据。

## 错误处理

- runtime 状态接口失败：弹窗显示加载失败并禁止创建，不退回硬编码的“可用”状态。
- OpenCode 模型发现失败：显示可重试错误，不伪装成 `Default`。
- runtime 在弹窗打开后被卸载或 Worker 状态变化：Core 启动护栏仍作为最终校验，返回 runtime unavailable。
- OpenCode Provider 认证失败：作为外部 runtime 配置错误呈现，不自动更换模型或 Provider。

## 验证

至少覆盖以下自动化检查：

1. Windows npm shim 可以通过统一进程边界完成 OpenCode 模型发现。
2. `provider/model` 输出解析、去重及 verbose 回退正确。
3. runtime availability 按已安装优先排序，未安装项完整保留。
4. 创建 Agent 界面默认选择第一个已安装 runtime，未安装项不可选。
5. OpenCode 模型发现失败时不能以 `Default` 创建。
6. OpenCode 启动参数包含 `--auto` 和明确的 `--model provider/model`。
7. 类型检查、相关单测、完整单测和 Web 构建通过。

## 文档同步

实现完成时同步更新：

- `docs/kith-space/architecture-proposal.md`：runtime availability 和模型发现边界；
- `docs/kith-space/notes/_runtime-research/opencode.md`：实际适配方式与 Windows 进程边界；
- `docs/progress.md`：问题修复状态与验证结果；
- 若用户可见行为需要补充，再更新 `docs/kith-space/ui-direction.md`。
