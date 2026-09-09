# 模型设置使用指南

## 概述

Kith-space 现在支持为不同的 AI 运行器配置独立的模型供应商。每个运行器（Claude Code、Codex、Pi Agent、OpenCode）都有自己的配置界面和预设。

## 访问模型设置

1. 打开 Kith-space
2. 点击左侧导航栏的 **设置** 图标
3. 选择 **模型设置** 标签
4. 使用顶部标签切换不同的运行器

## 配置 Pi Agent（完整功能）

Pi Agent 是 Kith-space 内置的运行时，支持完整的配置流程。

### 添加供应商

1. 切换到 **Pi Agent** 标签
2. 在"添加供应商"区域浏览预设供应商
3. 使用搜索框或分类筛选找到需要的供应商
4. 点击供应商卡片进入配置表单

### 配置表单

1. **API Key**: 输入您的 API 密钥
   - 点击眼睛图标可以显示/隐藏密钥
   - 点击"获取 API Key"链接前往供应商网站

2. **API 端点**: 
   - 默认使用官方端点
   - 某些供应商支持多个候选端点（使用下拉菜单切换）

3. **模型选择**:
   - 从预设模型列表中选择
   - 查看模型的上下文窗口和支持的能力

4. **连接测试**:
   - 配置完成后点击"测试连接"
   - 验证 API Key 和端点是否正确

5. **保存**:
   - 测试成功后点击"保存配置"
   - 配置将写入 `~/.pi/agent/models.json`

### 管理已配置的供应商

- **编辑**: 点击供应商卡片的"编辑"按钮修改配置
- **删除**: 点击"删除"按钮移除供应商（需要确认）

### 支持的供应商（Pi Agent）

**官方供应商**:
- Anthropic (Claude 系列)
- OpenAI (GPT 系列)
- Google Gemini

**合作伙伴**:
- Kimi (月之暗面)
- DeepSeek
- 智谱 GLM
- 阿里 Qwen
- MiniMax

**社区供应商**:
- OpenRouter (统一 API)
- Together AI
- Groq

## 配置其他运行器

### Claude Code

1. 切换到 **Claude Code** 标签
2. 点击"导入本地配置"从 `~/.config/claude/config.toml` 导入
3. 或选择预设供应商手动配置（即将推出）

### Codex

1. 切换到 **Codex** 标签
2. 点击"导入本地配置"从 Codex TOML 配置导入
3. 或选择预设供应商手动配置（即将推出）

### OpenCode

1. 切换到 **OpenCode** 标签
2. 点击"导入本地配置"从 OpenCode JSON 配置导入
3. 或选择预设供应商手动配置（即将推出）

## 常见问题

### 配置保存在哪里？

- **Pi Agent**: `~/.pi/agent/models.json`
- **Claude Code**: `~/.config/claude/config.toml`
- **Codex**: Codex 配置目录
- **OpenCode**: OpenCode 配置目录

### 连接测试失败怎么办？

1. 检查 API Key 是否正确
2. 确认 API 端点可访问
3. 检查网络连接
4. 查看错误消息获取详细信息

### 如何切换模型？

1. 找到要修改的供应商
2. 点击"编辑"按钮
3. 在模型下拉菜单中选择新模型
4. 点击"保存配置"

### 可以配置多个供应商吗？

可以。您可以为同一个运行器配置多个供应商，每个供应商可以有不同的模型。

### 配置会影响其他运行器吗？

不会。每个运行器的配置是独立的，互不影响。

## API 格式说明

不同的供应商使用不同的 API 格式：

- **anthropic-messages**: Anthropic Claude API
- **openai-chat**: OpenAI Chat Completions API
- **openai-completions**: OpenAI Completions API (旧版)
- **google-generative-ai**: Google Gemini API
- **bedrock-converse-stream**: AWS Bedrock Converse API

选择预设供应商时，API 格式会自动设置。

## 高级功能（即将推出）

- 模型列表自动发现
- 配置导出与分享
- 使用统计与推荐
- 多环境配置（开发/生产）
- 配置版本管理

## 获取帮助

如果遇到问题：

1. 查看浏览器控制台的错误信息
2. 检查 Kith-space 日志
3. 在 GitHub 仓库提交 Issue
4. 查看 `MODEL_SETTINGS_IMPLEMENTATION.md` 了解技术细节

## 开发者信息

### API 端点

```
GET    /api/settings/pi-agent-config
POST   /api/settings/pi-agent-config/provider
GET    /api/settings/pi-agent-config/provider/:id
DELETE /api/settings/pi-agent-config/provider/:id
POST   /api/settings/pi-agent-config/test-connection
POST   /api/settings/cli-imports/preview
POST   /api/settings/cli-imports/apply
```

### 测试脚本

运行测试脚本验证 API 功能：

```bash
node scripts/test-model-settings.mjs
```

注意：需要先启动 Kith-space 服务器。

### 相关文件

- 实现文档: `MODEL_SETTINGS_IMPLEMENTATION.md`
- 架构设计: `MODEL_SETTINGS_REFACTOR_PLAN.md`
- 前端组件: `web/src/views/model-settings/`
- 后端服务: `src/server/routes-api/piConfigService.ts`
- 预设数据: `web/src/data/*ProviderPresets.ts`
