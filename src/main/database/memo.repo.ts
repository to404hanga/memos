/**
 * 备忘录数据仓库（Repository）
 *
 * 封装 memos 表的所有 CRUD 操作，负责：
 * - 数据库行（snake_case）与应用对象（camelCase）之间的转换
 * - JSON 字段的序列化/反序列化（recurrence/reminders/tags/mutePeriods/attachments/webhook）
 * - 查询：全部、回收站、按 ID、关键词搜索
 * - 写入：插入、更新、删除（物理删除）、更新提醒时间
 * - 清理：回收站 30 天过期自动清理、对话历史 30 天过期清理
 */
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDb } from './index';

export interface Memo {
  id: string;
  title: string;
  content: string;
  reminderTime: string | null;
  recurrence: any;
  reminders: any[];
  mutePeriods: any[];
  attachments: any[];
  webhook: any;
  completed: boolean;
  pinned: boolean;
  tags: string[];
  createdAt: string;
  deletedAt: string | null;
}

function rowToMemo(row: any): Memo {
  return {
    id: row.id,
    title: row.title,
    content: row.content || '',
    reminderTime: row.reminder_time || null,
    recurrence: row.recurrence ? JSON.parse(row.recurrence) : null,
    reminders: row.reminders ? JSON.parse(row.reminders) : [],
    mutePeriods: row.mute_periods ? JSON.parse(row.mute_periods) : [],
    attachments: row.attachments ? JSON.parse(row.attachments) : [],
    webhook: row.webhook ? JSON.parse(row.webhook) : null,
    completed: row.completed === 1,
    pinned: row.pinned === 1,
    tags: row.tags ? JSON.parse(row.tags) : [],
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null,
  };
}

export function getAllMemos(): Memo[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM memos WHERE deleted_at IS NULL ORDER BY pinned DESC, created_at DESC');
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToMemo);
}

export function getTrashMemos(): Memo[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM memos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToMemo);
}

export function getMemoById(id: string): Memo | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM memos WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToMemo(row);
  }
  stmt.free();
  return null;
}

export function insertMemo(memo: Memo): void {
  const db = getDb();
  db.run(
    'INSERT INTO memos (id, title, content, reminder_time, recurrence, completed, pinned, tags, reminders, mute_periods, attachments, webhook, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [memo.id, memo.title, memo.content || '', memo.reminderTime || null, memo.recurrence ? JSON.stringify(memo.recurrence) : null, memo.completed ? 1 : 0, memo.pinned ? 1 : 0, JSON.stringify(memo.tags || []), JSON.stringify(memo.reminders || []), JSON.stringify(memo.mutePeriods || []), JSON.stringify(memo.attachments || []), memo.webhook ? JSON.stringify(memo.webhook) : null, memo.createdAt]
  );
  saveDb();
}

export function updateMemoInDb(memo: Memo): void {
  const db = getDb();
  db.run(
    'UPDATE memos SET title = ?, content = ?, reminder_time = ?, recurrence = ?, completed = ?, pinned = ?, tags = ?, reminders = ?, mute_periods = ?, attachments = ?, webhook = ? WHERE id = ?',
    [memo.title, memo.content || '', memo.reminderTime || null, memo.recurrence ? JSON.stringify(memo.recurrence) : null, memo.completed ? 1 : 0, memo.pinned ? 1 : 0, JSON.stringify(memo.tags || []), JSON.stringify(memo.reminders || []), JSON.stringify(memo.mutePeriods || []), JSON.stringify(memo.attachments || []), memo.webhook ? JSON.stringify(memo.webhook) : null, memo.id]
  );
  saveDb();
}

export function deleteMemoFromDb(id: string): void {
  const db = getDb();
  db.run('DELETE FROM memos WHERE id = ?', [id]);
  saveDb();
}

export function updateReminderTime(id: string, reminderTime: string): void {
  const db = getDb();
  db.run('UPDATE memos SET reminder_time = ? WHERE id = ?', [reminderTime, id]);
  saveDb();
}

export function cleanupOldTrash(): void {
  const db = getDb();
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  db.run('DELETE FROM memos WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]);
  saveDb();
}

export function cleanupOldConversations(): void {
  const db = getDb();
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  db.run('DELETE FROM ai_conversations WHERE updated_at < ?', [cutoff]);
  saveDb();
}

export function searchMemos(keyword: string): Memo[] {
  const db = getDb();
  const k = `%${keyword}%`;
  const stmt = db.prepare('SELECT * FROM memos WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) ORDER BY pinned DESC, created_at DESC');
  stmt.bind([k, k]);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToMemo);
}
