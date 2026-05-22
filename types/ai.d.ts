/**
 * AI 助手相关类型定义
 *
 * 本应用支持多 Provider 的 AI 助手功能：
 * - 支持 OpenAI 兼容（DeepSeek/通义/智谱/混元等）、Anthropic Claude、Ollama 本地模型
 * - 支持流式对话（SSE）、思考模式（reasoning）、服务端工具调用（tool use）
 * - 支持多模型自动降级：按全局优先级尝试，失败后自动切换下一个可用模型
 * - 支持上下文压缩：对话过长时自动压缩历史消息
 */

import { Recurrence } from './memo';

/** AI Provider 类型枚举 */
export type AiProviderType = 'openai' | 'anthropic' | 'ollama';

/**
 * AI Provider（供应商）
 *
 * 代表一个 LLM API 服务端点，如 DeepSeek、Anthropic、本地 Ollama 等。
 * 一个 Provider 下可挂载多个 Model。
 */
export interface AiProvider {
  /** Provider 唯一标识（UUID） */
  id: string;
  /** 显示名称（如 "DeepSeek"、"Anthropic"） */
  name: string;
  /** Provider 类型，决定 API 调用协议 */
  type: AiProviderType;
  /** API 基础地址（如 https://api.deepseek.com/v1） */
  baseUrl: string;
  /** API 密钥（Ollama 类型无需填写） */
  apiKey: string;
  /** 创建时间（ISO 格式） */
  createdAt: string;
}

/**
 * Provider 表单输入
 *
 * 创建/编辑 Provider 时使用的数据结构。
 * id 可选：有值表示编辑已有记录，无值表示新建。
 */
export type AiProviderInput = Omit<AiProvider, 'id' | 'createdAt'> & {
  /** 编辑时传入已有 ID，新建时不传 */
  id?: string;
};

/**
 * AI 模型
 *
 * 代表某个 Provider 下的一个具体模型（如 deepseek-chat、claude-sonnet-4 等）。
 * 模型有全局优先级，Auto 模式下按优先级顺序尝试调用。
 */
export interface AiModel {
  /** 模型唯一标识（UUID） */
  id: string;
  /** 所属 Provider ID */
  providerId: string;
  /** 模型标识符（传给 API 的实际 model 名称） */
  name: string;
  /** 显示别名（可选，用于界面友好展示） */
  displayName?: string;
  /** 是否启用（禁用的模型不参与 Auto 降级） */
  enabled: boolean;
  /** 是否启用思考模式（reasoning/extended thinking） */
  thinking: boolean;
  /** 最大上下文长度（单位 K，如 128 表示 128K tokens） */
  maxContext?: number;
  /** 全局优先级（数字越小优先级越高，Auto 模式按此排序） */
  priority: number;
  /** 上次调用失败的错误信息 */
  lastError?: string;
  /** 上次成功使用的时间（ISO 格式） */
  lastUsedAt?: string;
  /** 创建时间（ISO 格式） */
  createdAt: string;
}

/**
 * 模型表单输入
 *
 * 创建/编辑模型时使用。省略了系统自动管理的字段（priority/lastError/lastUsedAt）。
 */
export type AiModelInput = Omit<AiModel, 'id' | 'createdAt' | 'priority' | 'lastError' | 'lastUsedAt'> & {
  /** 编辑时传入已有 ID，新建时不传 */
  id?: string;
};

/**
 * AI 工具调用
 *
 * 当 AI 模型决定执行一个操作（如创建备忘录）时，
 * 会返回一个 tool call 结构，前端根据此结构展示预览或执行操作。
 */
export interface AiToolCall {
  /** 工具调用 ID（用于跟踪状态） */
  id: string;
  /** 工具名称（如 create_memo、list_memos、complete_memo、delete_memo） */
  name: string;
  /** 工具参数（JSON 对象） */
  arguments: Record<string, any>;
}

/**
 * AI 创建备忘录的参数
 *
 * 当 AI 调用 create_memo 工具时传入的参数结构。
 * 前端收到后展示预览卡片，用户确认后才真正创建。
 */
export interface AiCreateMemoArgs {
  /** 备忘录标题 */
  title: string;
  /** 备忘录内容（Markdown 格式） */
  content?: string;
  /** 标签列表（不存在的标签会自动创建） */
  tags?: string[];
  /** 单次提醒时间（ISO 格式） */
  reminderTime?: string;
  /** 周期提醒配置 */
  recurrence?: Recurrence;
  /** 静默期配置 */
  mutePeriods?: Array<{ from: string; to: string }>;
}

/**
 * AI 对话消息
 *
 * 表示对话中的一条消息（用户发出或 AI 回复）。
 * AI 回复可能包含思考过程（thinking）和工具调用（toolCalls）。
 */
export interface AiMessage {
  /** 消息角色：user=用户, assistant=AI */
  role: 'user' | 'assistant';
  /** 消息文本内容 */
  content: string;
  /** AI 请求的工具调用列表（仅 assistant 消息） */
  toolCalls?: AiToolCall[];
  /** AI 的思考/推理过程文本（thinking/reasoning 模式） */
  thinking?: string;
  /** 实际使用的 Provider 名称 */
  providerName?: string;
  /** 实际使用的模型标识符 */
  modelName?: string;
  /** 模型显示标签（如 "DeepSeek / DeepSeek-V3"） */
  modelLabel?: string;
  /** 降级来源：如果是降级后的结果，记录原始请求的模型标签 */
  fallbackFrom?: string;
  /** 消息时间戳（ISO 格式） */
  ts: string;
}

/**
 * AI 聊天请求参数
 *
 * 发起一次 AI 对话请求时的完整参数。
 */
export interface AiChatArgs {
  /** 完整对话历史（包含本次用户消息） */
  messages: AiMessage[];
  /** 指定模型 ID（不传则使用 Auto 模式按优先级选择） */
  modelId?: string;
  /** 流式请求的唯一标识（用于前端取消和追踪） */
  streamId?: string;
}

/**
 * AI 流式响应数据块
 *
 * 流式对话中，主进程通过 IPC 逐块推送给渲染进程。
 * 不同 type 代表不同的事件类型：
 *
 * - thinking_delta: 思考过程增量文本
 * - content_delta: 回复内容增量文本
 * - server_tool: 服务端开始执行工具（如查询备忘录列表）
 * - server_tool_done: 服务端工具执行完成
 * - model_start: 开始使用某个模型（含降级信息）
 * - model_failed: 当前模型调用失败，即将尝试下一个
 * - done: 整个响应完成
 * - error: 发生错误（所有模型均失败）
 */
export interface AiStreamChunk {
  /** 流 ID，用于前端匹配对应请求 */
  streamId: string;
  /** 数据块类型 */
  type: 'thinking_delta' | 'content_delta' | 'server_tool' | 'server_tool_done' | 'model_start' | 'model_failed' | 'done' | 'error';
  /** 增量文本（thinking_delta / content_delta 时使用） */
  text?: string;
  /** 工具名称（server_tool / server_tool_done 时使用） */
  name?: string;
  /** 工具参数（server_tool 时使用） */
  arguments?: Record<string, any>;
  /** 工具执行摘要（server_tool_done 时使用，如 "找到 5 条"） */
  summary?: string;
  /** Provider 名称（model_start 时使用） */
  providerName?: string;
  /** 模型显示标签（model_start 时使用） */
  modelLabel?: string;
  /** 降级来源模型标签（model_start 时，从哪个模型降级过来） */
  fallbackFrom?: string;
  /** 错误信息（error 类型时使用） */
  error?: string;
  /** 完成时的最终消息（done 类型时使用） */
  message?: AiMessage;
  /** 当前多轮工具调用的循环次数 */
  loop?: number;
}

/**
 * AI 非流式聊天结果
 *
 * 非流式模式下，一次性返回完整的 AI 回复。
 */
export interface AiChatResult {
  /** AI 回复的完整消息 */
  message: AiMessage;
  /** 错误信息（调用失败时） */
  error?: string;
}

/**
 * AI 对话元数据
 *
 * 对话列表中每条记录的摘要信息（不含完整消息内容）。
 */
export interface AiConversationMeta {
  /** 对话唯一标识 */
  id: string;
  /** 对话标题（取自首条用户消息的前 20 字） */
  title: string | null;
  /** 创建时间（ISO 格式） */
  createdAt: string;
  /** 最后更新时间（ISO 格式） */
  updatedAt: string;
}

/**
 * AI 完整对话记录
 *
 * 包含对话元数据和完整的消息历史，用于恢复历史对话。
 */
export interface AiConversation extends AiConversationMeta {
  /** 完整消息列表 */
  messages: AiMessage[];
}

/**
 * 模型连接测试结果
 *
 * 用于验证 Provider + Model 配置是否正确、网络是否可达。
 */
export interface AiTestResult {
  /** 测试是否成功 */
  success: boolean;
  /** 响应延迟（毫秒） */
  latencyMs?: number;
  /** 模型返回的测试内容 */
  modelEcho?: string;
  /** 失败时的错误信息 */
  error?: string;
}
