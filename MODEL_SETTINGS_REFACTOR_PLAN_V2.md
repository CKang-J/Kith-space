# 模型设置模块重构计划（简化版 - 不含统一供应商）

## 目标

为每个运行器（Claude Code、Codex、Pi、OpenCode）创建独立的模型配置界面，参考 cc-switch 的设计。

## 简化后的架构

```
┌─────────────────────────────────────────────┐
│  [Claude Code] [Codex] [Pi] [OpenCode]      │  ← 运行器标签页
├─────────────────────────────────────────────┤
│  当前选中运行器的预设供应商网格                │
│  （根据运行器类型动态显示不同的预设）          │
├─────────────────────────────────────────────┤
│  添加/编辑供应商对话框                       │
│  （根据运行器类型显示不同的表单字段）          │
└─────────────────────────────────────────────┘
```

## 核心功能

### 1. 运行器标签切换
- Claude Code 标签 → 显示 Claude 专用预设和配置
- Codex 标签 → 显示 Codex/OpenAI 预设和配置
- Pi 标签 → 显示 Pi 专用预设和配置
- OpenCode 标签 → 显示 OpenCode 专用预设和配置

### 2. 每个运行器的独立配置
- **独立的预设列表**：每个运行器有自己的推荐供应商
- **独立的表单字段**：根据运行器类型显示不同的配置项
- **独立的配置文件**：写入到对应运行器的配置文件中

### 3. 共享功能
- 连接测试
- 获取模型列表
- 配置验证
- 从本机导入现有配置

## 精简后的实施计划

### 阶段 1: 基础架构（2 天）

#### 1.1 数据结构设计
```typescript
// 运行器类型
type RuntimeId = 'claude' | 'codex' | 'pi' | 'opencode';

// 运行器配置
interface RuntimeConfig {
  id: RuntimeId;
  name: string;
  configFile: string;  // 配置文件路径
  apiFormats: ApiFormat[];  // 支持的 API 格式
}

// 供应商预设
interface ProviderPreset {
  id: string;
  name: string;
  runtimeId: RuntimeId;  // 所属运行器
  apiFormat: ApiFormat;
  canonicalOrigin: string;
  models?: ModelPreset[];
  category: 'official' | 'partner' | 'community';
}
```

#### 1.2 UI 结构
- 创建 `RuntimeTabs.tsx` - 运行器标签切换组件
- 创建 `RuntimeProviderPanel.tsx` - 运行器配置面板（容器）
- 修改 `ModelProviderSettings.tsx` - 集成标签和面板

### 阶段 2: Claude Code 支持（2-3 天）

#### 2.1 预设定义
```typescript
// src/model-control/presets/claudePresets.ts
export const CLAUDE_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic-official',
    name: 'Anthropic Official',
    runtimeId: 'claude',
    apiFormat: 'anthropic-messages',
    canonicalOrigin: 'https://api.anthropic.com',
    category: 'official',
    models: [
      { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-1', displayName: 'Claude Sonnet 4.1' },
    ],
  },
  {
    id: 'kimi',
    name: 'Kimi',
    runtimeId: 'claude',
    apiFormat: 'openai-chat',
    canonicalOrigin: 'https://api.moonshot.cn/v1',
    category: 'partner',
  },
  // ... 更多 Claude 预设
];
```

#### 2.2 表单组件
```typescript
// web/src/views/model-settings/forms/ClaudeProviderForm.tsx
export function ClaudeProviderForm({ preset, onSave }) {
  // Claude 特定的字段：
  // - API 格式选择（anthropic-messages, openai-chat, openai-responses）
  // - API Key
  // - 基础 URL
  // - 模型列表
}
```

#### 2.3 配置服务
```typescript
// src/model-control/runtimes/claudeConfigService.ts
export class ClaudeConfigService {
  // 读取 ~/.claude/config.toml
  async readConfig(): Promise<ClaudeConfig> { }
  
  // 写入 ~/.claude/config.toml
  async writeConfig(config: ClaudeConfig): Promise<void> { }
  
  // 验证配置
  validateConfig(config: ClaudeConfig): ValidationResult { }
}
```

### 阶段 3: Codex 支持（2-3 天）

类似 Claude，但配置格式和 API 格式略有不同：
- `src/model-control/presets/codexPresets.ts`
- `web/src/views/model-settings/forms/CodexProviderForm.tsx`
- `src/model-control/runtimes/codexConfigService.ts`

### 阶段 4: Pi 支持（2-3 天）

Pi 的特殊性：
- 支持多种 API 格式
- 有 Thinking Profiles 配置
- 配置文件是 JSON 格式
- `src/model-control/presets/piPresets.ts`
- `web/src/views/model-settings/forms/PiProviderForm.tsx`
- `src/model-control/runtimes/piConfigService.ts`

### 阶段 5: OpenCode 支持（2-3 天）

OpenCode 的特殊性：
- 使用 AI SDK 包
- 累加模式配置
- `src/model-control/presets/opencodePresets.ts`
- `web/src/views/model-settings/forms/OpenCodeProviderForm.tsx`
- `src/model-control/runtimes/opencodeConfigService.ts`

### 阶段 6: 共享功能和优化（2-3 天）

- 连接测试功能
- 获取模型列表功能
- 配置导入功能
- 错误处理和验证
- UI/UX 优化

### 阶段 7: 测试和文档（1-2 天）

- 单元测试
- 集成测试
- 用户文档

## 工作量估算（简化版）

- **总工时**: 约 13-19 天（相比之前减少了 9-10 天）
- **代码量**: 约 5,000-7,000 行（去掉统一供应商相关代码）
- **关键减少项**:
  - 不需要跨运行器同步逻辑
  - 不需要统一供应商数据模型
  - 不需要复杂的冲突解决机制

## 文件结构

```
src/model-control/
├── presets/
│   ├── claudePresets.ts      # Claude 预设
│   ├── codexPresets.ts       # Codex 预设
│   ├── piPresets.ts          # Pi 预设
│   └── opencodePresets.ts    # OpenCode 预设
├── runtimes/
│   ├── claudeConfigService.ts
│   ├── codexConfigService.ts
│   ├── piConfigService.ts
│   └── opencodeConfigService.ts
├── shared/
│   ├── providerTestService.ts  # 连接测试
│   └── modelFetchService.ts    # 获取模型列表
└── types.ts

web/src/views/model-settings/
├── ModelProviderSettings.tsx   # 主容器（带标签）
├── RuntimeTabs.tsx            # 标签切换
├── RuntimeProviderPanel.tsx   # 运行器面板
├── forms/
│   ├── ClaudeProviderForm.tsx
│   ├── CodexProviderForm.tsx
│   ├── PiProviderForm.tsx
│   └── OpenCodeProviderForm.tsx
└── components/
    ├── ProviderPresetGrid.tsx  # 预设网格
    ├── ProviderTestPanel.tsx   # 测试面板
    └── ModelListEditor.tsx     # 模型列表编辑器
```

## 优先级建议

### MVP（最小可用产品）
1. **阶段 1** - 基础架构
2. **阶段 4** - Pi 支持（因为你刚做了内置 Pi Agent）
3. **阶段 2** - Claude Code 支持（最常用）

### 完整版
再依次完成 Codex 和 OpenCode

## 立即开始的步骤

如果你同意这个简化方案，我可以立即开始：

1. **创建基础数据结构和类型定义**
2. **实现运行器标签切换 UI**
3. **实现 Pi 运行器的完整支持**（预设 + 表单 + 配置服务）

这样你就可以立即使用 Pi 的模型配置功能，其他运行器可以逐步添加。

**准备好开始了吗？我可以马上动手实现阶段 1。**
