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

function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function rowToMemo(row: any): Memo {
  return {
    id: row.id,
    title: row.title,
    content: row.content || '',
    reminderTime: row.reminder_time || null,
    recurrence: safeJsonParse(row.recurrence, null),
    reminders: safeJsonParse(row.reminders, []),
    mutePeriods: safeJsonParse(row.mute_periods, []),
    attachments: safeJsonParse(row.attachments, []),
    webhook: safeJsonParse(row.webhook, null),
    completed: row.completed === 1,
    pinned: row.pinned === 1,
    tags: safeJsonParse(row.tags, []),
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

/**
 * 多关键词搜索备忘录
 * 支持空格分隔的多关键词（取交集），每个词在标题或内容中匹配即可
 */
export function searchMemos(keyword: string): Memo[] {
  const db = getDb();
  const input = keyword.trim();
  if (!input) return getAllMemos();

  // 按空格拆分为多个关键词
  const keywords = input.split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return getAllMemos();

  // 构建 SQL：每个关键词都需要在 title 或 content 中出现（AND 交集）
  const conditions = keywords.map(() => '(title LIKE ? OR content LIKE ?)').join(' AND ');
  const sql = `SELECT * FROM memos WHERE deleted_at IS NULL AND ${conditions} ORDER BY pinned DESC, created_at DESC`;
  const params = keywords.flatMap((k) => [`%${k}%`, `%${k}%`]);

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToMemo);
}
