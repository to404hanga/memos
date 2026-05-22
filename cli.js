#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const CLI_PORT = 19527;
const DB_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  'Library', 'Application Support', '备忘录', 'memos.db'
);

// ===== 连接模式检测 =====
let useDirectDb = false;
let directDb = null;

async function checkGuiRunning() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port: CLI_PORT, path: '/api/ping',
      method: 'GET', timeout: 1000,
    }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function initDirectDb() {
  if (directDb) return;
  if (!fs.existsSync(DB_PATH)) {
    console.error(`数据库不存在: ${DB_PATH}`);
    process.exit(1);
  }
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  directDb = new SQL.Database(buffer);

  // 执行与 GUI 相同的列迁移
  const colsResult = directDb.exec('PRAGMA table_info(memos)');
  const cols = colsResult.length > 0 ? colsResult[0].values.map((r) => r[1]) : [];
  const migrations = [
    ['tags', "ALTER TABLE memos ADD COLUMN tags TEXT DEFAULT '[]'"],
    ['pinned', 'ALTER TABLE memos ADD COLUMN pinned INTEGER DEFAULT 0'],
    ['reminders', "ALTER TABLE memos ADD COLUMN reminders TEXT DEFAULT '[]'"],
    ['deleted_at', 'ALTER TABLE memos ADD COLUMN deleted_at TEXT DEFAULT NULL'],
    ['mute_periods', "ALTER TABLE memos ADD COLUMN mute_periods TEXT DEFAULT '[]'"],
    ['attachments', "ALTER TABLE memos ADD COLUMN attachments TEXT DEFAULT '[]'"],
    ['webhook', 'ALTER TABLE memos ADD COLUMN webhook TEXT DEFAULT NULL'],
  ];
  for (const [col, sql] of migrations) {
    if (!cols.includes(col)) {
      directDb.run(sql);
    }
  }
}

function saveDirectDb() {
  if (!directDb) return;
  const data = directDb.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function queryAll(sql, params) {
  const stmt = directDb.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function rowToMemo(row) {
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

// ===== 直连数据库操作 =====
const dbOps = {
  async getMemos() {
    await initDirectDb();
    return queryAll('SELECT * FROM memos WHERE deleted_at IS NULL ORDER BY pinned DESC, created_at DESC').map(rowToMemo);
  },
  async searchMemos(keyword) {
    await initDirectDb();
    const k = `%${keyword}%`;
    return queryAll('SELECT * FROM memos WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) ORDER BY pinned DESC, created_at DESC', [k, k]).map(rowToMemo);
  },
  async getTrash() {
    await initDirectDb();
    return queryAll('SELECT * FROM memos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').map(rowToMemo);
  },
  async getTags() {
    await initDirectDb();
    return queryAll('SELECT * FROM tags ORDER BY name');
  },
  async getMemoById(id) {
    await initDirectDb();
    const row = queryOne('SELECT * FROM memos WHERE id = ?', [id]);
    return row ? rowToMemo(row) : null;
  },
  async addMemo(data) {
    await initDirectDb();
    const memo = {
      id: uuidv4(), title: data.title, content: data.content || '',
      reminderTime: data.reminderTime || null, recurrence: data.recurrence || null,
      reminders: data.reminders || [], mutePeriods: data.mutePeriods || [],
      attachments: data.attachments || [], webhook: data.webhook || null,
      completed: false, pinned: false, tags: data.tags || [],
      createdAt: new Date().toISOString(),
    };
    directDb.run(
      'INSERT INTO memos (id, title, content, reminder_time, recurrence, completed, pinned, tags, reminders, mute_periods, attachments, webhook, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [memo.id, memo.title, memo.content, memo.reminderTime,
       memo.recurrence ? JSON.stringify(memo.recurrence) : null,
       0, 0, JSON.stringify(memo.tags), JSON.stringify(memo.reminders),
       JSON.stringify(memo.mutePeriods), JSON.stringify(memo.attachments),
       memo.webhook ? JSON.stringify(memo.webhook) : null, memo.createdAt]
    );
    saveDirectDb();
    return memo;
  },
  async updateMemo(data) {
    await initDirectDb();
    const existing = await dbOps.getMemoById(data.id);
    if (!existing) return null;
    const merged = { ...existing, ...data };
    directDb.run(
      'UPDATE memos SET title = ?, content = ?, reminder_time = ?, recurrence = ?, completed = ?, pinned = ?, tags = ?, reminders = ?, mute_periods = ?, attachments = ?, webhook = ? WHERE id = ?',
      [merged.title, merged.content || '', merged.reminderTime || null,
       merged.recurrence ? JSON.stringify(merged.recurrence) : null,
       merged.completed ? 1 : 0, merged.pinned ? 1 : 0,
       JSON.stringify(merged.tags || []), JSON.stringify(merged.reminders || []),
       JSON.stringify(merged.mutePeriods || []), JSON.stringify(merged.attachments || []),
       merged.webhook ? JSON.stringify(merged.webhook) : null, merged.id]
    );
    saveDirectDb();
    return merged;
  },
  async deleteMemo(data) {
    await initDirectDb();
    directDb.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), data.id || data]);
    saveDirectDb();
    return { success: true };
  },
  async toggleComplete(data) {
    await initDirectDb();
    const id = data.id || data;
    const memo = await dbOps.getMemoById(id);
    if (!memo) return null;
    memo.completed = !memo.completed;
    directDb.run('UPDATE memos SET completed = ? WHERE id = ?', [memo.completed ? 1 : 0, id]);
    saveDirectDb();
    return memo;
  },
  async togglePin(data) {
    await initDirectDb();
    const id = data.id || data;
    const memo = await dbOps.getMemoById(id);
    if (!memo) return null;
    memo.pinned = !memo.pinned;
    directDb.run('UPDATE memos SET pinned = ? WHERE id = ?', [memo.pinned ? 1 : 0, id]);
    saveDirectDb();
    return memo;
  },
  async restoreMemo(data) {
    await initDirectDb();
    const id = data.id || data;
    directDb.run('UPDATE memos SET deleted_at = NULL WHERE id = ?', [id]);
    saveDirectDb();
    return await dbOps.getMemoById(id);
  },
  async permanentDelete(data) {
    await initDirectDb();
    directDb.run('DELETE FROM memos WHERE id = ?', [data.id || data]);
    saveDirectDb();
    return { success: true };
  },
  async emptyTrash() {
    await initDirectDb();
    directDb.run('DELETE FROM memos WHERE deleted_at IS NOT NULL');
    saveDirectDb();
    return { success: true };
  },
  async addTag(data) {
    await initDirectDb();
    const id = uuidv4();
    directDb.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [id, data.name, data.color || '#007aff']);
    saveDirectDb();
    return { id, name: data.name, color: data.color || '#007aff' };
  },
  async deleteTag(data) {
    await initDirectDb();
    directDb.run('DELETE FROM tags WHERE id = ?', [data.id || data]);
    saveDirectDb();
    return { success: true };
  },
};

// ===== HTTP 请求（GUI 模式） =====
function getCliToken() {
  const tokenPath = path.join(
    process.env.HOME || process.env.USERPROFILE,
    'Library', 'Application Support', '备忘录', '.cli-token'
  );
  try { return fs.readFileSync(tokenPath, 'utf-8').trim(); } catch { return ''; }
}

function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, `http://127.0.0.1:${CLI_PORT}/api`);
    const payload = body ? JSON.stringify(body) : '';
    const token = getCliToken();
    const options = {
      hostname: '127.0.0.1', port: CLI_PORT,
      path: url.pathname + url.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      timeout: 3000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ===== 统一调用层 =====
async function api(action, ...args) {
  if (!useDirectDb) {
    // GUI 模式：通过 HTTP
    const map = {
      getMemos: () => httpRequest('GET', '/api/memos'),
      searchMemos: (kw) => httpRequest('GET', `/api/search?q=${encodeURIComponent(kw)}`),
      getTrash: () => httpRequest('GET', '/api/trash'),
      getTags: () => httpRequest('GET', '/api/tags'),
      addMemo: (d) => httpRequest('POST', '/api/memos', d),
      updateMemo: (d) => httpRequest('PUT', '/api/memos', d),
      deleteMemo: (d) => httpRequest('DELETE', '/api/memos', d),
      toggleComplete: (d) => httpRequest('POST', '/api/memos/complete', d),
      togglePin: (d) => httpRequest('POST', '/api/memos/pin', d),
      restoreMemo: (d) => httpRequest('POST', '/api/memos/restore', d),
      permanentDelete: (d) => httpRequest('DELETE', '/api/memos/permanent', d),
      emptyTrash: () => httpRequest('DELETE', '/api/trash'),
      addTag: (d) => httpRequest('POST', '/api/tags', d),
      deleteTag: (d) => httpRequest('DELETE', '/api/tags', d),
    };
    return map[action](...args);
  }
  // 直连模式
  return dbOps[action](...args);
}

// ===== 格式化输出 =====
function formatMemo(m, verbose) {
  const status = m.completed ? '✅' : m.pinned ? '📌' : '⬜';
  const tags = m.tags && m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
  const reminders = m.reminders && m.reminders.length > 0 ? ` ⏰×${m.reminders.length}` : '';
  const line = `${status} ${m.id.substring(0, 8)} │ ${m.title}${tags}${reminders}`;
  if (verbose && m.content) {
    return `${line}\n   ${m.content.replace(/[#*`!\[\]()]/g, '').substring(0, 80)}`;
  }
  return line;
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString('zh-CN') : '';
}

function printMemos(memos, verbose) {
  if (memos.length === 0) { console.log('  (空)'); return; }
  memos.forEach((m) => console.log(formatMemo(m, verbose)));
}

async function findMemo(id, source) {
  const memos = await api(source || 'getMemos');
  return memos.find((m) => m.id.startsWith(id));
}

// ===== CLI 定义 =====
const program = new Command();
program.name('memo').description('备忘录 CLI — 通过命令行管理备忘录').version('1.0.0');
program.hook('preAction', async () => {
  const guiRunning = await checkGuiRunning();
  if (guiRunning) {
    useDirectDb = false;
  } else {
    useDirectDb = true;
    console.log('⚡ GUI 未运行，使用直连数据库模式（提醒调度不可用）');
  }
});

program.command('list').alias('ls').description('列出所有备忘录')
  .option('-v, --verbose', '显示内容预览')
  .option('-a, --all', '包含已完成')
  .action(async (opts) => {
    let memos = await api('getMemos');
    if (!opts.all) memos = memos.filter((m) => !m.completed);
    console.log(`\n📋 备忘录 (${memos.length} 项)\n`);
    printMemos(memos, opts.verbose);
    console.log();
  });

program.command('search <keyword>').alias('s').description('搜索备忘录')
  .option('-v, --verbose', '显示内容预览')
  .action(async (keyword, opts) => {
    const memos = await api('searchMemos', keyword);
    console.log(`\n🔍 搜索 "${keyword}" (${memos.length} 项)\n`);
    printMemos(memos, opts.verbose);
    console.log();
  });

program.command('show <id>').description('查看备忘录详情')
  .action(async (id) => {
    const memo = await findMemo(id);
    if (!memo) { console.error('未找到该备忘录'); return; }
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`标题: ${memo.title}`);
    console.log(`ID:   ${memo.id}`);
    console.log(`状态: ${memo.completed ? '已完成' : '待办'}${memo.pinned ? ' (置顶)' : ''}`);
    if (memo.tags && memo.tags.length > 0) console.log(`标签: ${memo.tags.join(', ')}`);
    if (memo.reminders && memo.reminders.length > 0) {
      console.log(`提醒: ${memo.reminders.length} 个`);
      memo.reminders.forEach((r, i) => {
        if (r.type === 'once') console.log(`  ${i + 1}. 单次 ${formatDate(r.time)}`);
        else console.log(`  ${i + 1}. ${r.type} ${String(r.hour||0).padStart(2,'0')}:${String(r.minute||0).padStart(2,'0')}`);
      });
    }
    if (memo.webhook && memo.webhook.enabled) console.log(`Webhook: ✅ ${memo.webhook.url}`);
    if (memo.attachments && memo.attachments.length > 0) console.log(`附件: ${memo.attachments.length} 个`);
    console.log(`创建: ${formatDate(memo.createdAt)}`);
    console.log(`${'─'.repeat(50)}`);
    if (memo.content) console.log(`\n${memo.content}\n`);
  });

program.command('add <title>').alias('a').description('新建备忘录')
  .option('-c, --content <content>', '正文内容')
  .option('-t, --tags <tags>', '标签（逗号分隔）')
  .option('-r, --reminder <time>', '提醒时间 (如 "2026-05-15 10:00")')
  .action(async (title, opts) => {
    const data = { title, content: opts.content || '' };
    if (opts.tags) data.tags = opts.tags.split(',').map((t) => t.trim());
    if (opts.reminder) data.reminders = [{ type: 'once', time: new Date(opts.reminder).toISOString() }];
    const memo = await api('addMemo', data);
    console.log(`✅ 已创建: ${memo.id.substring(0, 8)} │ ${memo.title}`);
  });

program.command('edit <id>').alias('e').description('编辑备忘录')
  .option('-T, --title <title>', '修改标题')
  .option('-c, --content <content>', '修改内容')
  .option('-t, --tags <tags>', '修改标签（逗号分隔）')
  .action(async (id, opts) => {
    const memo = await findMemo(id);
    if (!memo) { console.error('未找到该备忘录'); return; }
    const update = { id: memo.id };
    if (opts.title) update.title = opts.title;
    if (opts.content) update.content = opts.content;
    if (opts.tags) update.tags = opts.tags.split(',').map((t) => t.trim());
    const result = await api('updateMemo', update);
    console.log(`✅ 已更新: ${result.id.substring(0, 8)} │ ${result.title}`);
  });

program.command('delete <id>').alias('rm').description('删除备忘录（移到回收站）')
  .action(async (id) => {
    const memo = await findMemo(id);
    if (!memo) { console.error('未找到该备忘录'); return; }
    await api('deleteMemo', { id: memo.id });
    console.log(`🗑️  已删除: ${memo.title}`);
  });

program.command('done <id>').alias('d').description('切换完成状态')
  .action(async (id) => {
    const memo = await findMemo(id);
    if (!memo) { console.error('未找到该备忘录'); return; }
    const result = await api('toggleComplete', { id: memo.id });
    console.log(`${result.completed ? '✅' : '⬜'} ${result.title}`);
  });

program.command('pin <id>').description('切换置顶状态')
  .action(async (id) => {
    const memo = await findMemo(id);
    if (!memo) { console.error('未找到该备忘录'); return; }
    const result = await api('togglePin', { id: memo.id });
    console.log(`${result.pinned ? '📌 已置顶' : '📌 已取消置顶'}: ${result.title}`);
  });

program.command('trash').description('查看回收站')
  .action(async () => {
    const memos = await api('getTrash');
    console.log(`\n🗑️  回收站 (${memos.length} 项)\n`);
    memos.forEach((m) => console.log(`  ${m.id.substring(0, 8)} │ ${m.title}  (删除于 ${formatDate(m.deletedAt)})`));
    if (memos.length === 0) console.log('  (空)');
    console.log();
  });

program.command('restore <id>').description('从回收站恢复备忘录')
  .action(async (id) => {
    const memo = await findMemo(id, 'getTrash');
    if (!memo) { console.error('未在回收站中找到'); return; }
    await api('restoreMemo', { id: memo.id });
    console.log(`↩️  已恢复: ${memo.title}`);
  });

program.command('empty-trash').description('清空回收站')
  .action(async () => {
    await api('emptyTrash');
    console.log('🗑️  回收站已清空');
  });

const tagCmd = program.command('tag').description('标签管理');
tagCmd.command('list').alias('ls').description('列出所有标签')
  .action(async () => {
    const tags = await api('getTags');
    console.log(`\n🏷️  标签 (${tags.length} 个)\n`);
    tags.forEach((t) => console.log(`  ${t.name} (${t.color})`));
    if (tags.length === 0) console.log('  (无)');
    console.log();
  });
tagCmd.command('add <name>').option('-c, --color <color>', '颜色', '#007aff').description('添加标签')
  .action(async (name, opts) => {
    const tag = await api('addTag', { name, color: opts.color });
    console.log(`🏷️  已添加: ${tag.name}`);
  });
tagCmd.command('delete <id>').alias('rm').description('删除标签')
  .action(async (id) => {
    await api('deleteTag', { id });
    console.log('🏷️  已删除');
  });

program.command('export [path]').description('导出备忘录数据（JSON 格式）')
  .action(async (filePath) => {
    const memos = await api('getMemos');
    const tags = await api('getTags');
    const data = JSON.stringify({ memos, tags }, null, 2);
    if (filePath) {
      fs.writeFileSync(filePath, data, 'utf-8');
      console.log(`📤 已导出 ${memos.length} 条到 ${filePath}`);
    } else {
      process.stdout.write(data + '\n');
    }
  });

program.command('import <path>').description('从 JSON 文件导入备忘录')
  .action(async (filePath) => {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const memos = data.memos || [];
    const existing = await api('getMemos');
    const existingIds = new Set(existing.map((m) => m.id));
    let imported = 0, skipped = 0;
    for (const m of memos) {
      if (existingIds.has(m.id)) { skipped++; continue; }
      await api('addMemo', m);
      imported++;
    }
    console.log(`📥 导入完成: 新增 ${imported}，跳过 ${skipped}`);
  });

program.parse();
