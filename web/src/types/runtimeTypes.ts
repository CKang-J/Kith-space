/**
 * 前端运行器类型定义。
 *
 * 本机配置相关的形状（供应商、模型、凭据状态）统一放在 data/localRuntimeConfig.ts，
 * 那里是服务端 LocalRuntimeConfig 的镜像。这里只保留与运行器身份相关的枚举。
 */

export type RuntimeId = 'claude' | 'codex' | 'pi' | 'opencode';
