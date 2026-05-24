/**
 * 备忘录业务逻辑层（Service）
 *
 * 封装备忘录的核心业务操作，供 IPC handler 和 HTTP API 统一调用。
 * 消除两处 handler 中的重复逻辑（UUID 生成、字段默认值、调度提醒等）。
 */
import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { getDb, saveDb } from '../database';
import { getMemoById, insertMemo, updateMemoInDb, Memo, invalidateCache } from '../database/memo.repo';
import { getTagNames, addTag } from '../database/settings.repo';
import { scheduleReminder, clearMemoTimers } from '../scheduler';

/** 创建备忘录的输入参数 */
export interface CreateMemoInput {
  title: string;
  content?: string;
  reminderTime?: string | null;
  recurrence?: any;
  reminders?: any[];
  mutePeriods?: any[];
  attachments?: any[];
  webhook?: any;
  tags?: string[];
}

/** 更新备忘录的输入参数（id 必填，其他可选） */
export interface UpdateMemoInput {
  id: string;
  title?: string;
  content?: string;
  reminderTime?: string | null;
  recurrence?: any;
  reminders?: any[];
  mutePeriods?: any[];
  attachments?: any[];
  webhook?: any;
  completed?: boolean;
  pinned?: boolean;
  tags?: string[];
}

/**
 * 创建新备忘录
 */
export function createMemo(input: CreateMemoInput, mainWindow: BrowserWindow | null): Memo {
  const newMemo: Memo = {
    id: uuidv4(),
    title: input.title,
    content: input.content || '',
    reminderTime: input.reminderTime || null,
    recurrence: input.recurrence || null,
    reminders: input.reminders || [],
    mutePeriods: input.mutePeriods || [],
    attachments: input.attachments || [],
    webhook: input.webhook || null,
    completed: false,
    pinned: false,
    tags: [...new Set(input.tags || [])],
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  insertMemo(newMemo);
  scheduleReminder(newMemo, mainWindow);
  return newMemo;
}

/**
 * 更新备忘录（白名单字段合并）
 */
export function updateMemo(input: UpdateMemoInput, mainWindow: BrowserWindow | null): Memo | null {
  const existing = getMemoById(input.id);
  if (!existing) return null;

  const allowed: (keyof UpdateMemoInput)[] = ['title', 'content', 'reminderTime', 'recurrence', 'reminders', 'mutePeriods', 'attachments', 'webhook', 'completed', 'pinned', 'tags'];
  for (const key of allowed) {
    if (key in input && key !== 'id') {
      (existing as any)[key] = (input as any)[key];
    }
  }

  // 标签去重（按标签名）
  if (Array.isArray(existing.tags)) {
    existing.tags = [...new Set(existing.tags)];
  }

  // 自动在 tags 表中创建不存在的新标签
  if (Array.isArray(input.tags) && input.tags.length > 0) {
    const existingTagNames = new Set(getTagNames());
    for (const tagName of input.tags) {
      if (tagName && !existingTagNames.has(tagName)) {
        addTag({ name: tagName });
      }
    }
  }

  updateMemoInDb(existing);
  scheduleReminder(existing, mainWindow);
  return existing;
}

/**
 * 软删除备忘录（移入回收站）
 */
export function deleteMemo(id: string): boolean {
  const db = getDb();
  db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  invalidateCache();
  saveDb();
  clearMemoTimers(id);
  return true;
}

/**
 * 从回收站恢复备忘录
 */
export function restoreMemo(id: string, mainWindow: BrowserWindow | null): Memo | null {
  const db = getDb();
  db.run('UPDATE memos SET deleted_at = NULL WHERE id = ?', [id]);
  invalidateCache();
  saveDb();
  const memo = getMemoById(id);
  if (memo) scheduleReminder(memo, mainWindow);
  return memo;
}

/**
 * 永久删除备忘录
 */
export function permanentDeleteMemo(id: string): boolean {
  const db = getDb();
  db.run('DELETE FROM memos WHERE id = ?', [id]);
  invalidateCache();
  saveDb();
  return true;
}

/**
 * 清空回收站
 */
export function emptyTrash(): boolean {
  const db = getDb();
  db.run('DELETE FROM memos WHERE deleted_at IS NOT NULL');
  invalidateCache();
  saveDb();
  return true;
}

/**
 * 切换完成状态
 */
export function toggleComplete(id: string, mainWindow: BrowserWindow | null): Memo | null {
  const memo = getMemoById(id);
  if (!memo) return null;
  memo.completed = !memo.completed;
  updateMemoInDb(memo);
  if (memo.completed) clearMemoTimers(id);
  else scheduleReminder(memo, mainWindow);
  return memo;
}

/**
 * 切换置顶状态
 */
export function togglePin(id: string): Memo | null {
  const memo = getMemoById(id);
  if (!memo) return null;
  memo.pinned = !memo.pinned;
  updateMemoInDb(memo);
  return memo;
}
