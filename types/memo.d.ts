export interface Recurrence {
  type: 'once' | 'daily' | 'workday' | 'weekly' | 'monthly';
  time?: string;
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export interface MutePeriod {
  from: string;
  to: string;
}

export interface Attachment {
  fileName: string;
  originalName: string;
  size: number;
  filePath: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  content: string;
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
