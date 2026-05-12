export interface Recurrence {
  type: 'once' | 'daily' | 'weekly' | 'monthly';
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Memo {
  id: string;
  title: string;
  content: string;
  reminderTime: string | null;
  recurrence: Recurrence | null;
  completed: boolean;
  pinned: boolean;
  tags: string[];
  createdAt: string;
}

export interface MemoFormData {
  id?: string;
  title: string;
  content: string;
  reminderTime?: string | null;
  recurrence?: Recurrence | null;
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
  toggleComplete: (id: string) => Promise<Memo | null>;
  togglePin: (id: string) => Promise<Memo | null>;
  selectImage: () => Promise<ImageResult | null>;
  saveDroppedImage: (filePath: string) => Promise<ImageResult | null>;
  getImagePath: (fileName: string) => Promise<string>;
  getTags: () => Promise<Tag[]>;
  addTag: (tag: { name: string; color?: string }) => Promise<Tag>;
  updateTag: (tag: Tag) => Promise<Tag>;
  deleteTag: (id: string) => Promise<boolean>;
  onReminder: (callback: (data: ReminderData) => void) => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
