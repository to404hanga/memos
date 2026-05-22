export interface Recurrence {
  type: 'once' | 'daily' | 'workday' | 'weekly' | 'monthly';
  time?: string;
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export interface MutePeriod {
  from: string; // ISO date string (YYYY-MM-DD)
  to: string;   // ISO date string (YYYY-MM-DD)
}

export interface Attachment {
  fileName: string;   // 存储的文件名（UUID）
  originalName: string; // 原始文件名
  size: number;       // 文件大小（字节）
  filePath: string;   // 本地绝对路径
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  content: string; // 企微 markdown_v2 content 模板，支持 {{title}} {{content}} {{tags}} {{time}} 变量
}

export interface Memo {
  id: string;
  title: string;
  content: string;
  reminderTime: string | null;
  recurrence: Recurrence | null;
  reminders: Recurrence[];
  mutePeriods: MutePeriod[];
  attachments: Attachment[];
  webhook: WebhookConfig | null;
  completed: boolean;
  pinned: boolean;
  tags: string[];
  createdAt: string;
  deletedAt: string | null;
}

export interface MemoFormData {
  id?: string;
  title: string;
  content: string;
  reminderTime?: string | null;
  recurrence?: Recurrence | null;
  reminders?: Recurrence[];
  mutePeriods?: MutePeriod[];
  attachments?: Attachment[];
  webhook?: WebhookConfig | null;
  tags?: string[];
}

export interface ReminderData {
  id: string;
  title: string;
  content: string;
}

export interface ImageResult {
  fileName: string;
  filePath: string;
}

// ===== AI 助手 =====
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
  name: string;          // API 模型名，如 deepseek-chat
  displayName?: string;  // 用户自定义别名
  enabled: boolean;
  thinking: boolean;
  priority: number;      // 全局优先级，越小越优先
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
  modelLabel?: string;     // "ProviderName/ModelName"
  fallbackFrom?: string;   // 主模型 label（若降级才有值）
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

export interface ElectronAPI {
  getMemos: () => Promise<Memo[]>;
  searchMemos: (keyword: string) => Promise<Memo[]>;
  addMemo: (memo: MemoFormData) => Promise<Memo>;
  updateMemo: (memo: MemoFormData) => Promise<Memo | null>;
  deleteMemo: (id: string) => Promise<boolean>;
  getTrash: () => Promise<Memo[]>;
  restoreMemo: (id: string) => Promise<Memo | null>;
  permanentDelete: (id: string) => Promise<boolean>;
  emptyTrash: () => Promise<boolean>;
  toggleComplete: (id: string) => Promise<Memo | null>;
  togglePin: (id: string) => Promise<Memo | null>;
  selectImage: () => Promise<ImageResult | null>;
  saveDroppedImage: (filePath: string) => Promise<ImageResult | null>;
  getImagePath: (fileName: string) => Promise<string>;
  selectAttachment: () => Promise<Attachment | null>;
  saveDroppedFile: (filePath: string) => Promise<Attachment | null>;
  openAttachment: (filePath: string) => Promise<void>;
  getTags: () => Promise<Tag[]>;
  addTag: (tag: { name: string; color?: string }) => Promise<Tag>;
  updateTag: (tag: Tag) => Promise<Tag>;
  deleteTag: (id: string) => Promise<boolean>;
  exportData: () => Promise<{ success: boolean; path?: string; count?: number; error?: string }>;
  importData: () => Promise<{ success: boolean; imported?: number; skipped?: number; tagsImported?: number; error?: string }>;
  testWebhook: (url: string, content: string, memo: { title: string; content: string; tags: string[] }) => Promise<{ success: boolean; status?: number; body?: string; error?: string }>;
  // AI Providers
  aiGetProviders: () => Promise<AiProvider[]>;
  aiSaveProvider: (provider: AiProviderInput) => Promise<AiProvider>;
  aiDeleteProvider: (id: string) => Promise<boolean>;
  // AI Models
  aiGetModels: () => Promise<AiModel[]>;
  aiSaveModel: (model: AiModelInput) => Promise<AiModel>;
  aiDeleteModel: (id: string) => Promise<boolean>;
  aiToggleModel: (id: string, enabled: boolean) => Promise<boolean>;
  aiReorderModels: (sortedIds: string[]) => Promise<boolean>;
  aiTestModel: (provider: AiProviderInput, modelName: string, thinking: boolean) => Promise<AiTestResult>;
  aiOllamaModels: (baseUrl: string) => Promise<{ success: boolean; models: string[]; error?: string }>;
  aiGetPromptTemplate: () => Promise<string>;
  aiSetPromptTemplate: (template: string) => Promise<boolean>;
  aiHasUsableModel: () => Promise<boolean>;
  // AI Chat
  aiChat: (args: AiChatArgs | AiMessage[]) => Promise<AiChatResult>;
  aiChatStream: (args: AiChatArgs, onChunk: (chunk: AiStreamChunk) => void) => string;
  aiChatStreamOff: (streamId: string) => void;
  // AI Conversations
  aiGetConversations: () => Promise<AiConversationMeta[]>;
  aiGetConversation: (id: string) => Promise<AiConversation | null>;
  aiSaveConversation: (conv: { id: string; title?: string; messages: AiMessage[] }) => Promise<boolean>;
  aiDeleteConversation: (id: string) => Promise<boolean>;
  aiClearConversations: () => Promise<boolean>;
  onReminder: (callback: (data: ReminderData) => void) => void;
  onMemosChanged: (callback: () => void) => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
