# 模型设置模块重构计划

## 背景

根据 cc-switch 项目的架构，模型设置应该按**运行器（Agent）类型**分别管理，而不是统一的提供商列表。因为每个 AI 编程工具（Claude Code、Codex、Pi、OpenCode）的配置文件格式、请求格式和写入逻辑都不同。

## 当前状态

- ✅ 修复了 `pi_model_error` 问题，现在显示详细错误信息
- ✅ 移除了"使用中无法删除"的限制
- ❌ 当前的模型设置界面是统一的，不区分运行器类型
- ❌ 没有按运行器类型提供不同的预设和配置选项

## cc-switch 的正确架构

### 1. 顶层结构
```
┌─────────────────────────────────────────────┐
│  [Claude 供应商] [Codex 供应商] [Pi 供应商]  │  ← 运行器标签页
│  [OpenCode 供应商] [统一供应商]              │
├─────────────────────────────────────────────┤
│  预设供应商网格（根据运行器类型动态显示）      │
│  - Claude: Claude Official, Kimi, ...       │
│  - Codex: OpenAI, DeepSeek, ...            │
│  - Pi: Pi 专用预设                          │
│  - OpenCode: OpenAI Compatible 预设          │
├─────────────────────────────────────────────┤
│  配置表单（根据运行器类型显示不同字段）        │
└─────────────────────────────────────────────┘
```

### 2. 每个运行器的特点

#### Claude Code
- **API 格式**: `anthropic-messages` (主要), `openai-chat`, `openai-responses`, `gemini-native`
- **配置文件**: `~/.claude/config.toml`, `~/.claude/auth.json`
- **特殊功能**: OAuth 认证、GitHub Copilot 集成
- **表单组件**: `ClaudeFormFields.tsx`

#### Codex (ChatGPT)
- **API 格式**: `openai-responses` (主要), `openai-chat`
- **配置文件**: `~/.codex/config.toml`, `~/.codex/auth.json`
- **特殊功能**: ChatGPT Plus/Pro OAuth、xAI OAuth、本地路由模式
- **表单组件**: `CodexFormFields.tsx`

#### Pi
- **API 格式**: `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`
- **配置文件**: `~/.pi/agent/models.json`, `~/.pi/agent/auth.json`
- **特殊功能**: Thinking Profiles、RPC 模式
- **表单组件**: `PiFormFields.tsx`

#### OpenCode
- **API 格式**: AI SDK 包 (`@ai-sdk/openai`, `@ai-sdk/anthropic`, 等)
- **配置文件**: `~/.opencode/opencode.json`
- **特殊功能**: 累加模式、NPM 包管理
- **表单组件**: `OpenCodeFormFields.tsx`

### 3. 统一供应商
- 跨运行器共享的供应商配置
- 一次配置，多处使用
- 适合团队统一管理 API Key

## 实施计划

### 阶段 0: 准备工作（1-2 天）
- [ ] 详细研究 cc-switch 的每个运行器表单实现
- [ ] 确定 Kith-space 需要支持的运行器列表
- [ ] 设计数据模型和 API 接口

### 阶段 1: 基础架构（2-3 天）
- [ ] 创建运行器类型定义和枚举
- [ ] 实现运行器标签页切换 UI
- [ ] 创建运行器配置服务基类
- [ ] 设计每个运行器的数据库表结构

### 阶段 2: Claude Code 支持（3-4 天）
- [ ] 实现 `claudeProviderPresets.ts`
- [ ] 创建 `ClaudeFormFields.tsx` 组件
- [ ] 实现 Claude 配置文件读写逻辑
- [ ] 支持 Anthropic Messages 格式
- [ ] 测试 Claude Code 集成

### 阶段 3: Codex 支持（3-4 天）
- [ ] 实现 `codexProviderPresets.ts`
- [ ] 创建 `CodexFormFields.tsx` 组件
- [ ] 实现 Codex 配置文件读写逻辑
- [ ] 支持 OpenAI Responses/Chat 格式
- [ ] 测试 Codex 集成

### 阶段 4: Pi 支持（3-4 天）
- [ ] 实现 `piProviderPresets.ts`
- [ ] 创建 `PiFormFields.tsx` 组件
- [ ] 实现 Pi 配置文件读写逻辑
- [ ] 支持多种 API 格式和 Thinking Profiles
- [ ] 测试 Pi 集成

### 阶段 5: OpenCode 支持（3-4 天）
- [ ] 实现 `opencodeProviderPresets.ts`
- [ ] 创建 `OpenCodeFormFields.tsx` 组件
- [ ] 实现 OpenCode 配置文件读写逻辑
- [ ] 支持 AI SDK 包管理
- [ ] 测试 OpenCode 集成

### 阶段 6: 统一供应商（2-3 天）
- [ ] 实现统一供应商数据模型
- [ ] 创建统一供应商管理 UI
- [ ] 实现跨运行器同步逻辑
- [ ] 测试统一供应商功能

### 阶段 7: 高级功能（3-4 天）
- [ ] 实现连接测试功能
- [ ] 实现获取模型列表功能
- [ ] 实现端点测速功能
- [ ] 添加配置导入/导出功能
- [ ] 实现配置验证和错误提示

### 阶段 8: 测试和优化（2-3 天）
- [ ] 编写单元测试
- [ ] 编写集成测试
- [ ] 性能优化
- [ ] UI/UX 改进
- [ ] 文档编写

## 技术难点

### 1. 配置文件格式差异
- Claude 和 Codex 使用 TOML 格式
- Pi 和 OpenCode 使用 JSON 格式
- 需要不同的解析器和序列化器

### 2. 认证方式差异
- Claude: API Key、OAuth
- Codex: API Key、ChatGPT OAuth、xAI OAuth
- Pi: API Key、Pi CLI Auth
- OpenCode: API Key、环境变量

### 3. 请求格式转换
- 需要在不同 API 格式之间转换
- 处理不同的参数和选项
- 保持兼容性

### 4. 配置文件写入安全
- 避免损坏用户现有配置
- 提供备份和恢复机制
- 处理并发写入

## 估算

- **总工时**: 约 22-29 天（按 1 人全职计算）
- **代码量**: 预计 8,000-12,000 行（参考 cc-switch）
- **测试覆盖**: 需要覆盖 4 个运行器 × 多种配置场景

## 建议

鉴于这是一个非常大的工程，我建议：

1. **分批实施**: 先实现 1-2 个最常用的运行器（如 Claude Code 和 Pi）
2. **迭代开发**: 每个阶段完成后进行测试和验证
3. **参考移植**: 大量参考 cc-switch 的实现，避免重复造轮子
4. **增量发布**: 每完成一个运行器就发布一个版本

## 下一步行动

请确认：
1. 是否要立即开始这个重构？
2. 优先实现哪些运行器？（建议：Claude Code + Pi）
3. 是否有时间和资源投入？

如果确认，我可以立即开始阶段 1 的开发。
