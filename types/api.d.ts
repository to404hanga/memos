import { Memo, MemoFormData, ReminderData, ImageResult, Attachment, Tag } from './memo';
import { AiProvider, AiProviderInput, AiModel, AiModelInput, AiMessage, AiChatArgs, AiStreamChunk, AiChatResult, AiConversationMeta, AiConversation, AiTestResult } from './ai';

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
  // AI
  aiGetProviders: () => Promise<AiProvider[]>;
  aiSaveProvider: (provider: AiProviderInput) => Promise<AiProvider>;
  aiDeleteProvider: (id: string) => Promise<boolean>;
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
  aiChat: (args: AiChatArgs | AiMessage[]) => Promise<AiChatResult>;
  aiChatStream: (args: AiChatArgs, onChunk: (chunk: AiStreamChunk) => void) => string;
  aiChatStreamOff: (streamId: string) => void;
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
