/**
 * AI 模块对外接口
 *
 * 本模块为 AI 功能的统一入口，将内部拆分的子模块重新聚合导出：
 * - tools.ts: 工具定义（AI_TOOLS_OPENAI, AI_TOOLS_ANTHROPIC）
 * - executor.ts: 服务端工具执行
 * - compact.ts: 上下文压缩策略
 * - conversation.ts: 对话循环、Provider 调度、callLLM
 */

// 对外暴露的核心 API
export { callLLM, testModel, getOllamaModels, CallLLMOptions } from './conversation';

// 工具定义（供需要获取工具 schema 的场景使用）
export { AI_TOOLS_OPENAI, AI_TOOLS_ANTHROPIC } from './tools';
