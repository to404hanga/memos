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
  onReminder: (callback: (data: ReminderData) => void) => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
