import { Recurrence } from './memo';

export type AiProviderType = 'openai' | 'anthropic' | 'ollama';

export interface AiProvider {
  id: string;
  name: string;
  type: AiProviderType;
  baseUrl: string;
  apiKey: string;
  createdAt: string;
}

export type AiProviderInput = Omit<AiProvider, 'id' | 'createdAt'> & {
  id?: string;
};

export interface AiModel {
  id: string;
  providerId: string;
  name: string;
  displayName?: string;
  enabled: boolean;
  thinking: boolean;
  maxContext?: number; // 最大上下文长度（单位 K，如 128 表示 128K）
  priority: number;
  lastError?: string;
  lastUsedAt?: string;
  createdAt: string;
}

export type AiModelInput = Omit<AiModel, 'id' | 'createdAt' | 'priority' | 'lastError' | 'lastUsedAt'> & {
  id?: string;
};

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AiCreateMemoArgs {
  title: string;
  content?: string;
  tags?: string[];
  reminderTime?: string;
  recurrence?: Recurrence;
  mutePeriods?: Array<{ from: string; to: string }>;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AiToolCall[];
  thinking?: string;
  providerName?: string;
  modelName?: string;
  modelLabel?: string;
  fallbackFrom?: string;
  ts: string;
}

export interface AiChatArgs {
  messages: AiMessage[];
  modelId?: string;
  streamId?: string;
}

export interface AiStreamChunk {
  streamId: string;
  type: 'thinking_delta' | 'content_delta' | 'server_tool' | 'server_tool_done' | 'model_start' | 'model_failed' | 'done' | 'error';
  text?: string;
  name?: string;
  arguments?: Record<string, any>;
  summary?: string;
  providerName?: string;
  modelLabel?: string;
  fallbackFrom?: string;
  error?: string;
  message?: AiMessage;
  loop?: number;
}

export interface AiChatResult {
  message: AiMessage;
  error?: string;
}

export interface AiConversationMeta {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiConversation extends AiConversationMeta {
  messages: AiMessage[];
}

export interface AiTestResult {
  success: boolean;
  latencyMs?: number;
  modelEcho?: string;
  error?: string;
}
