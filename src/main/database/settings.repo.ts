import { getDb, saveDb } from './index';
import { v4 as uuidv4 } from 'uuid';

export function getTags(): any[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function addTag(tag: { name: string; color?: string }): any {
  const db = getDb();
  const id = uuidv4();
  db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [id, tag.name, tag.color || '#007aff']);
  saveDb();
  return { id, name: tag.name, color: tag.color || '#007aff' };
}

export function updateTag(tag: { id: string; name: string; color: string }): any {
  const db = getDb();
  db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', [tag.name, tag.color, tag.id]);
  saveDb();
  return tag;
}

export function deleteTag(id: string, getAllMemos: () => any[]): boolean {
  const db = getDb();
  const memos = getAllMemos();
  const stmt2 = db.prepare('SELECT name FROM tags WHERE id = ?');
  stmt2.bind([id]);
  let tagName = '';
  if (stmt2.step()) tagName = (stmt2.getAsObject() as any).name;
  stmt2.free();

  if (tagName) {
    memos.forEach((m: any) => {
      if (m.tags && m.tags.includes(tagName)) {
        m.tags = m.tags.filter((t: string) => t !== tagName);
        db.run('UPDATE memos SET tags = ? WHERE id = ?', [JSON.stringify(m.tags), m.id]);
      }
    });
  }
  db.run('DELETE FROM tags WHERE id = ?', [id]);
  saveDb();
  return true;
}

export function getTagNames(): string[] {
  const db = getDb();
  const stmt = db.prepare('SELECT name FROM tags ORDER BY name');
  const names: string[] = [];
  while (stmt.step()) names.push((stmt.getAsObject() as any).name);
  stmt.free();
  return names;
}

export function getSetting(key: string): string {
  const db = getDb();
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  stmt.bind([key]);
  if (stmt.step()) {
    const val = (stmt.getAsObject() as any).value;
    stmt.free();
    return val || '';
  }
  stmt.free();
  return '';
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  const exists = db.prepare('SELECT key FROM settings WHERE key = ?');
  exists.bind([key]);
  const found = exists.step();
  exists.free();
  if (found) {
    db.run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
  } else {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  saveDb();
}

// AI Conversations
export function getConversations(): any[] {
  const db = getDb();
  const stmt = db.prepare('SELECT id, title, created_at, updated_at FROM ai_conversations ORDER BY updated_at DESC');
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getConversation(id: string): any | null {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM ai_conversations WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const r = stmt.getAsObject() as any;
    stmt.free();
    return {
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messages: JSON.parse(r.messages || '[]'),
    };
  }
  stmt.free();
  return null;
}

export function saveConversation(conv: any): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM ai_conversations WHERE id = ?');
  existing.bind([conv.id]);
  const found = existing.step();
  existing.free();

  if (found) {
    db.run(
      'UPDATE ai_conversations SET title = ?, updated_at = ?, messages = ? WHERE id = ?',
      [conv.title || null, now, JSON.stringify(conv.messages || []), conv.id]
    );
  } else {
    db.run(
      'INSERT INTO ai_conversations (id, title, created_at, updated_at, messages) VALUES (?, ?, ?, ?, ?)',
      [conv.id, conv.title || null, now, now, JSON.stringify(conv.messages || [])]
    );
  }
  saveDb();
  return true;
}

export function deleteConversation(id: string): boolean {
  const db = getDb();
  db.run('DELETE FROM ai_conversations WHERE id = ?', [id]);
  saveDb();
  return true;
}

export function clearConversations(): boolean {
  const db = getDb();
  db.run('DELETE FROM ai_conversations');
  saveDb();
  return true;
}
