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
 * 迁移策略：
 * - 使用 settings 表中 `db_version` 键记录当前数据库版本号
 * - 每次 schema 变更新增一个迁移函数（版本号递增）
 * - 启动时自动检测并顺序执行所有未运行的迁移
 * - 向后兼容：旧数据库（无版本号）视为 version 0，从头执行所有迁移
 */
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { app, safeStorage } from 'electron';

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

// ===== 版本化迁移系统 =====

/** 迁移函数类型 */
type Migration = (database: SqlJsDatabase) => void;

/**
 * 迁移注册表：按版本号顺序排列
 * - key: 目标版本号（从 1 开始递增）
 * - value: 迁移函数
 *
 * 新增迁移时只需在数组末尾追加即可。
 */
const migrations: Migration[] = [
  // === Version 1: 基础表结构 ===
  (d) => {
    d.run(`
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
    d.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#007aff'
      )
    `);
    d.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  },

  // === Version 2: memos 扩展列 ===
  (d) => {
    const addCol = (col: string, def: string) => {
      try { d.run(`SELECT ${col} FROM memos LIMIT 1`); }
      catch { d.run(`ALTER TABLE memos ADD COLUMN ${col} ${def}`); }
    };
    addCol('pinned', 'INTEGER DEFAULT 0');
    addCol('reminders', "TEXT DEFAULT '[]'");
    addCol('deleted_at', 'TEXT DEFAULT NULL');
    addCol('mute_periods', "TEXT DEFAULT '[]'");
    addCol('attachments', "TEXT DEFAULT '[]'");
    addCol('webhook', 'TEXT DEFAULT NULL');
  },

  // === Version 3: AI Provider / Model 表 ===
  (d) => {
    // 清理旧版 schema（如果存在 model/priority/thinking 列说明是 v1 schema）
    try {
      const stmt = d.prepare("PRAGMA table_info(ai_providers)");
      const cols: string[] = [];
      while (stmt.step()) cols.push((stmt.getAsObject() as any).name);
      stmt.free();
      if (cols.includes('model') || cols.includes('priority') || cols.includes('thinking')) {
        d.run('DROP TABLE IF EXISTS ai_providers');
        d.run('DROP TABLE IF EXISTS ai_models');
      }
    } catch {}

    d.run(`
      CREATE TABLE IF NOT EXISTS ai_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
    `);
    d.run(`
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
      d.run('CREATE INDEX IF NOT EXISTS idx_ai_models_priority ON ai_models(enabled, priority)');
      d.run('CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models(provider_id)');
    } catch {}
  },

  // === Version 4: ai_models 添加 max_context 列 ===
  (d) => {
    try { d.run('SELECT max_context FROM ai_models LIMIT 1'); }
    catch { d.run('ALTER TABLE ai_models ADD COLUMN max_context INTEGER DEFAULT NULL'); }
  },

  // === Version 5: AI 对话历史表 ===
  (d) => {
    d.run(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        messages TEXT NOT NULL
      )
    `);
    try {
      d.run('CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated ON ai_conversations(updated_at)');
    } catch {}
  },

  // === Version 6: 旧提醒数据迁移到 reminders 数组 ===
  (d) => {
    const stmt = d.prepare("SELECT id, reminder_time, recurrence, reminders FROM memos WHERE (reminder_time IS NOT NULL OR recurrence IS NOT NULL) AND (reminders IS NULL OR reminders = '[]')");
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
        d.run('UPDATE memos SET reminders = ? WHERE id = ?', [JSON.stringify(reminders), row.id]);
      }
    }
    if (toMigrate.length > 0) {
      console.log(`[DB] 迁移了 ${toMigrate.length} 条旧提醒数据`);
    }
  },

  // === Version 7: API Key 加密功能标记（历史版本，实际加密在 Version 8） ===
  (d) => {},

  // === Version 8: 加密已有的明文 API Key ===
  (d) => {
    if (!safeStorage.isEncryptionAvailable()) {
      console.log('[DB] 系统加密不可用，跳过 API Key 加密迁移');
      return;
    }
    const stmt = d.prepare("SELECT id, api_key FROM ai_providers WHERE api_key != ''");
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    let count = 0;
    for (const row of rows) {
      const key = row.api_key || '';
      // 检测是否已经是加密数据（尝试 base64 解码后解密）
      try {
        const buf = Buffer.from(key, 'base64');
        safeStorage.decryptString(buf);
        // 能解密说明已经是加密数据，跳过
        continue;
      } catch {
        // 解密失败说明是明文，需要加密
      }
      const encrypted = safeStorage.encryptString(key).toString('base64');
      d.run('UPDATE ai_providers SET api_key = ? WHERE id = ?', [encrypted, row.id]);
      count++;
    }
    if (count > 0) {
      console.log(`[DB] 已加密 ${count} 个 API Key`);
    }
  },
];

/** 当前最新数据库版本号 */
const LATEST_VERSION = migrations.length;

/** 获取数据库当前版本号 */
function getDbVersion(database: SqlJsDatabase): number {
  try {
    const stmt = database.prepare("SELECT value FROM settings WHERE key = 'db_version'");
    if (stmt.step()) {
      const val = (stmt.getAsObject() as any).value;
      stmt.free();
      return parseInt(val, 10) || 0;
    }
    stmt.free();
  } catch {
    // settings 表可能不存在（全新数据库）
  }
  return 0;
}

/** 设置数据库版本号 */
function setDbVersion(database: SqlJsDatabase, version: number): void {
  database.run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('db_version', ?)",
    [String(version)]
  );
}

/** 执行数据库迁移（含备份策略） */
function runMigrations(database: SqlJsDatabase): void {
  const currentVersion = getDbVersion(database);

  if (currentVersion >= LATEST_VERSION) {
    return; // 已是最新版本，不做任何操作（保留 .prev 不动）
  }

  console.log(`[DB] 数据库版本 ${currentVersion} → ${LATEST_VERSION}，开始迁移...`);

  // 备份策略：
  // - 只有新的迁移动作即将执行时，才删除上次的 .prev 并创建新备份
  // - .prev 保留到下次迁移时才被替换，作为回滚兜底
  const prevPath = dbPath + '.prev';
  if (fs.existsSync(dbPath)) {
    if (fs.existsSync(prevPath)) {
      fs.unlinkSync(prevPath);
      console.log('[DB] 已清理上次迁移备份');
    }
    fs.copyFileSync(dbPath, prevPath);
    console.log(`[DB] 已备份原数据库 → ${path.basename(prevPath)}`);
  }

  for (let v = currentVersion; v < LATEST_VERSION; v++) {
    const migrationFn = migrations[v];
    try {
      migrationFn(database);
      console.log(`[DB] ✓ 迁移到版本 ${v + 1} 完成`);
    } catch (err: any) {
      console.error(`[DB] ✗ 迁移到版本 ${v + 1} 失败:`, err.message || err);
      // 迁移失败时停止，记录已完成的版本
      setDbVersion(database, v);
      console.error(`[DB] 迁移中断，原数据库已保留在 ${path.basename(prevPath)}，可手动恢复`);
      return;
    }
  }

  setDbVersion(database, LATEST_VERSION);
  console.log(`[DB] 所有迁移完成，当前版本: ${LATEST_VERSION}（原数据库保留在 ${path.basename(prevPath)}）`);
}

// ===== 公共接口 =====

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();
  dbPath = path.join(app.getPath('userData'), 'memos.db');

  let recovered = false;

  if (fs.existsSync(dbPath)) {
    try {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
      // 验证数据库完整性（简单查询测试）
      db.exec("SELECT 1");
    } catch (err: any) {
      console.error('[DB] 数据库文件加载失败，尝试恢复:', err.message || err);
      // 备份损坏的文件
      const corruptPath = dbPath + '.corrupt.' + Date.now();
      try {
        fs.copyFileSync(dbPath, corruptPath);
        console.log(`[DB] 已备份损坏文件 → ${path.basename(corruptPath)}`);
      } catch (backupErr: any) {
        console.error('[DB] 备份损坏文件失败:', backupErr.message || backupErr);
      }
      // 创建全新空数据库
      db = new SQL.Database();
      recovered = true;
      console.log('[DB] 已创建新的空数据库');
    }
  } else {
    db = new SQL.Database();
  }

  // 执行版本化迁移
  runMigrations(db);

  saveDb();
  console.log(`[DB] SQLite 已初始化: ${dbPath} (version: ${LATEST_VERSION})`);

  // 通知用户数据库已恢复
  if (recovered) {
    const { dialog } = require('electron');
    setImmediate(() => {
      dialog.showMessageBox({
        type: 'warning',
        title: '数据库恢复',
        message: '数据库文件损坏，已自动创建新数据库。',
        detail: '损坏的数据库文件已备份（.corrupt 后缀），如需恢复数据请联系技术支持。',
      }).catch(() => {});
    });
  }
}

export function closeDatabase(): void {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}
