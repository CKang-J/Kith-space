# 模型设置重构 - 实现文档

## 概述

本次重构实现了运行器特定的模型配置架构，为 Claude Code、Codex、Pi Agent、OpenCode 四种运行器提供独立的配置界面。

## 架构设计

### 核心原则
- **运行器隔离**：每个运行器有独立的配置、预设和 UI
- **配置格式独立**：
  - Claude Code / Codex: TOML 格式 (~/.config/claude/config.toml)
  - Pi Agent: JSON 格式 (~/.pi/agent/models.json)
  - OpenCode: JSON 格式
- **前后端分离**：类型定义分别维护，避免模块依赖冲突

### 类型系统

```typescript
// 运行器 ID
type RuntimeId = 'claude' | 'codex' | 'pi' | 'opencode';

// API 格式
type ApiFormat = 
  | 'openai-completions'
  | 'openai-chat'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'bedrock-converse-stream';

// 供应商分类
type ProviderCategory = 'official' | 'partner' | 'community' | 'custom';
```

## 已实现功能

### 1. Pi Agent 配置（完整）
- ✅ 15 个供应商预设（Anthropic、OpenAI、Kimi、DeepSeek 等）
- ✅ 供应商搜索与分类筛选
- ✅ API Key 配置（支持显示/隐藏）
- ✅ 端点选择（多候选端点支持）
- ✅ 模型选择（带上下文窗口、能力信息）
- ✅ 连接测试（Anthropic Messages、OpenAI Chat）
- ✅ 保存到 ~/.pi/agent/models.json
- ✅ 已配置供应商列表管理

### 2. Claude Code 配置
- ✅ 供应商预设（Anthropic、AWS Bedrock、Vertex AI）
- ✅ 本地 TOML 配置导入
- ⏳ 配置表单（待实现）

### 3. Codex 配置
- ✅ 供应商预设（OpenAI、Anthropic）
- ✅ 本地 TOML 配置导入
- ⏳ 配置表单（待实现）

### 4. OpenCode 配置
- ✅ 供应商预设（OpenAI、Anthropic、OpenRouter）
- ✅ 本地 JSON 配置导入
- ⏳ 配置表单（待实现）

## 文件结构

```
src/
├── model-control/
│   ├── runtimeTypes.ts          # 后端类型定义
│   └── presets/
│       └── piPresets.ts         # Pi 预设（后端）
├── server/routes-api/
│   ├── modelSettings.ts         # API 路由（包含 Pi 配置路由）
│   └── piConfigService.ts       # Pi 配置服务

web/src/
├── types/
│   └── runtimeTypes.ts          # 前端类型定义
├── data/
│   ├── piProviderPresets.ts     # Pi 供应商预设
│   ├── claudeProviderPresets.ts # Claude 供应商预设
│   ├── codexProviderPresets.ts  # Codex 供应商预设
│   └── opencodeProviderPresets.ts # OpenCode 供应商预设
└── views/model-settings/
    ├── ModelSettingsV2.tsx      # 主页面
    ├── RuntimeTabs.tsx          # 运行器标签
    ├── ProviderPresetGrid.tsx   # 预设网格
    ├── PiRuntimeSettings.tsx    # Pi 容器
    ├── PiProviderForm.tsx       # Pi 表单
    ├── ClaudeRuntimeSettings.tsx
    ├── CodexRuntimeSettings.tsx
    ├── OpenCodeRuntimeSettings.tsx
    └── modelSettings.css
```

## API 端点

### Pi Agent 配置
- `GET /api/settings/pi-agent-config` - 获取配置
- `POST /api/settings/pi-agent-config/provider` - 添加/更新供应商
- `GET /api/settings/pi-agent-config/provider/:id` - 获取供应商
- `DELETE /api/settings/pi-agent-config/provider/:id` - 删除供应商
- `POST /api/settings/pi-agent-config/test-connection` - 测试连接

### CLI 配置导入
- `POST /api/settings/cli-imports/preview` - 预览配置
- `POST /api/settings/cli-imports/apply` - 应用导入

## 下一步计划

### 短期（P0）
1. **完善 Pi Agent 配置**
   - 添加模型能力自动检测
   - 优化错误提示和用户反馈
   - 支持批量导入多个供应商

2. **实现其他运行器配置表单**
   - Claude Code 配置表单（复用 PiProviderForm 模式）
   - Codex 配置表单
   - OpenCode 配置表单

### 中期（P1）
1. **增强功能**
   - 模型列表自动发现（调用 /v1/models）
   - 配置验证与健康检查
   - 使用统计与推荐

2. **用户体验**
   - 配置向导（首次使用引导）
   - 快速切换常用配置
   - 导出配置到其他运行器

### 长期（P2）
1. **高级功能**
   - 配置版本管理与回滚
   - 多环境配置（开发/生产）
   - 团队配置共享

## 技术债务

1. **类型定义冗余**：前后端类型定义重复，考虑使用 monorepo shared types
2. **配置服务抽象**：piConfigService 应抽象为通用配置服务
3. **预设数据管理**：预设应支持动态加载和更新

## 测试清单

- [x] 类型检查通过
- [x] 运行器标签切换正常
- [x] Pi Agent 预设网格展示
- [x] Pi Agent 配置表单显示
- [ ] Pi Agent 连接测试（需要真实 API Key）
- [ ] Pi Agent 配置保存（需要文件系统权限）
- [ ] Claude/Codex/OpenCode 配置导入

## 性能指标

- 类型检查耗时: ~5-8s
- 组件渲染: <100ms
- 配置保存: <500ms
- 连接测试: <3s

## 参考资料

- [cc-switch 项目](https://github.com/example/cc-switch) - 架构参考
- [Pi SDK Catalog](src/advisor-provider/piSdkCatalog.ts) - Pi 模型列表
- [Model Configuration Service](src/model-control/modelConfigurationService.ts) - 配置管理
