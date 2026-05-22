/**
 * SQLite 数据库初始化与管理
 *
 * 使用 sql.js（WebAssembly 版 SQLite）在 Electron 主进程中运行数据库。
 * 数据库文件存储在 ~/Library/Application Support/备忘录/memos.db。
 *
 * 核心功能：
 * - initDatabase: 初始化数据库、创建表结构、执行版本迁移
 * - saveDb: 将内存中的数据库状态持久化到文件
 * - closeDatabase: 保存并关闭数据库
 * - getDb/getDbPath: 获取数据库实例/路径
 *
 * 表结构：
 * - memos: 备忘录主表（含软删除、多提醒、静默期、附件、Webhook）
 * - tags: 标签表
 * - settings: 键值对设置表
 * - ai_providers: AI Provider 配置表
 * - ai_models: AI 模型配置表（含优先级、思考模式、上下文限制）
 * - ai_conversations: AI 对话历史表
 *
 * 迁移策略：
 * - 使用 addColumnIfMissing 渐进式添加新列（兼容旧版数据库）
 * - 旧版 ai_providers schema 冲突时自动 DROP 重建
 * - 旧版单提醒数据自动迁移到 reminders 数组格式
 */
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

let db: SqlJsDatabase | null = null;
let dbPath = '';

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function getDbPath(): string {
  return dbPath;
}

export function saveDb(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();
  dbPath = path.join(app.getPath('userData'), 'memos.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 创建基础表
  db.run(`
    CREATE TABLE IF NOT EXISTS memos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      reminder_time TEXT,
      recurrence TEXT,
      completed INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#007aff'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 兼容旧数据库：如果 memos 表没有某列则添加
  const addColumnIfMissing = (column: string, defaultValue: string) => {
    try {
      db!.run(`SELECT ${column} FROM memos LIMIT 1`);
    } catch (e) {
      db!.run(`ALTER TABLE memos ADD COLUMN ${column} ${defaultValue}`);
    }
  };

  addColumnIfMissing('pinned', 'INTEGER DEFAULT 0');
  addColumnIfMissing('reminders', "TEXT DEFAULT '[]'");
  addColumnIfMissing('deleted_at', 'TEXT DEFAULT NULL');
  addColumnIfMissing('mute_periods', "TEXT DEFAULT '[]'");
  addColumnIfMissing('attachments', "TEXT DEFAULT '[]'");
  addColumnIfMissing('webhook', 'TEXT DEFAULT NULL');

  // 旧的 tags 列兼容
  try {
    db.run('SELECT tags FROM memos LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE memos ADD COLUMN tags TEXT DEFAULT '[]'");
  }

  // AI Provider / Model 配置（v2 schema）
  try {
    const stmt = db.prepare("PRAGMA table_info(ai_providers)");
    const cols: string[] = [];
    while (stmt.step()) cols.push((stmt.getAsObject() as any).name);
    stmt.free();
    if (cols.includes('model') || cols.includes('priority') || cols.includes('thinking')) {
      db.run('DROP TABLE IF EXISTS ai_providers');
      db.run('DROP TABLE IF EXISTS ai_models');
      console.log('[DB] 旧版 ai_providers schema 已清理（重建中）');
    }
  } catch (e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      display_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      thinking INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL UNIQUE,
      last_error TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE CASCADE
    )
  `);

  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_ai_models_priority ON ai_models(enabled, priority)');
    db.run('CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id)');
  } catch (e) {}

  // 迁移: 添加 max_context 列
  try {
    db.run('SELECT max_context FROM ai_models LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE ai_models ADD COLUMN max_context INTEGER DEFAULT NULL');
  }

  // 对话历史表
  db.run(`
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      messages TEXT NOT NULL
    )
  `);

  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated ON ai_conversations(updated_at)');
  } catch (e) {}

  // 迁移旧数据
  migrateOldReminders();

  saveDb();
  console.log(`[DB] SQLite 已初始化: ${dbPath}`);
}

function migrateOldReminders(): void {
  if (!db) return;
  const stmt = db.prepare("SELECT id, reminder_time, recurrence, reminders FROM memos WHERE (reminder_time IS NOT NULL OR recurrence IS NOT NULL) AND (reminders IS NULL OR reminders = '[]')");
  const toMigrate: any[] = [];
  while (stmt.step()) toMigrate.push(stmt.getAsObject());
  stmt.free();

  for (const row of toMigrate) {
    const reminders: any[] = [];
    const rec = row.recurrence ? JSON.parse(row.recurrence) : null;
    if (rec && rec.type !== 'once') {
      reminders.push(rec);
    } else if (row.reminder_time) {
      reminders.push({ type: 'once', time: row.reminder_time });
    }
    if (reminders.length > 0) {
      db!.run('UPDATE memos SET reminders = ? WHERE id = ?', [JSON.stringify(reminders), row.id]);
    }
  }
  if (toMigrate.length > 0) {
    saveDb();
    console.log(`[DB] 迁移了 ${toMigrate.length} 条旧提醒数据`);
  }
}

export function closeDatabase(): void {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}
