const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');

// 必须在 ready 之前设置，否则 Dock 标签不生效
app.name = '备忘录';

let db = null;
let dbPath = '';
let mainWindow = null;
let tray = null;
const activeTimers = new Map();

// ===== SQLite 初始化 =====
async function initDatabase() {
  const SQL = await initSqlJs();
  dbPath = path.join(app.getPath('userData'), 'memos.db');

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

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

  // 兼容旧数据库：如果 memos 表没有 tags 列则添加
  try {
    db.run('SELECT tags FROM memos LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE memos ADD COLUMN tags TEXT DEFAULT '[]'");
  }

  try {
    db.run('SELECT pinned FROM memos LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE memos ADD COLUMN pinned INTEGER DEFAULT 0');
  }

  try {
    db.run('SELECT reminders FROM memos LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE memos ADD COLUMN reminders TEXT DEFAULT '[]'");
  }

  try {
    db.run('SELECT deleted_at FROM memos LIMIT 1');
  } catch (e) {
    db.run('ALTER TABLE memos ADD COLUMN deleted_at TEXT DEFAULT NULL');
  }

  try {
    db.run('SELECT mute_periods FROM memos LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE memos ADD COLUMN mute_periods TEXT DEFAULT '[]'");
  }

  try {
    db.run('SELECT attachments FROM memos LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE memos ADD COLUMN attachments TEXT DEFAULT '[]'");
  }

  try {
    db.run('SELECT webhook FROM memos LIMIT 1');
  } catch (e) {
    db.run("ALTER TABLE memos ADD COLUMN webhook TEXT DEFAULT NULL");
  }

  // AI Provider / Model 配置（v2 schema）
  // 一次性清理旧 schema（开发期可接受），后续再做正式迁移
  try {
    const stmt = db.prepare("PRAGMA table_info(ai_providers)");
    const cols = [];
    while (stmt.step()) cols.push(stmt.getAsObject().name);
    stmt.free();
    // 旧表里有 model / priority / thinking 列，新表已不需要
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

  // 迁移旧数据：将单个 reminderTime/recurrence 转为 reminders 数组
  migrateOldReminders();

  saveDb();
  console.log(`[DB] SQLite 已初始化: ${dbPath}`);
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function migrateOldReminders() {
  const stmt = db.prepare("SELECT id, reminder_time, recurrence, reminders FROM memos WHERE (reminder_time IS NOT NULL OR recurrence IS NOT NULL) AND (reminders IS NULL OR reminders = '[]')");
  const toMigrate = [];
  while (stmt.step()) toMigrate.push(stmt.getAsObject());
  stmt.free();

  for (const row of toMigrate) {
    const reminders = [];
    const rec = row.recurrence ? JSON.parse(row.recurrence) : null;
    if (rec && rec.type !== 'once') {
      reminders.push(rec);
    } else if (row.reminder_time) {
      reminders.push({ type: 'once', time: row.reminder_time });
    }
    if (reminders.length > 0) {
      db.run('UPDATE memos SET reminders = ? WHERE id = ?', [JSON.stringify(reminders), row.id]);
    }
  }
  if (toMigrate.length > 0) {
    saveDb();
    console.log(`[DB] 迁移了 ${toMigrate.length} 条旧提醒数据`);
  }
}

// ===== 数据库操作封装 =====
function getAllMemos() {
  const stmt = db.prepare('SELECT * FROM memos WHERE deleted_at IS NULL ORDER BY pinned DESC, created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(rowToMemo);
}

function getTrashMemos() {
  const stmt = db.prepare('SELECT * FROM memos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(rowToMemo);
}

function cleanupOldTrash() {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  db.run('DELETE FROM memos WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]);
  saveDb();
}

function getMemoById(id) {
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

function insertMemo(memo) {
  db.run(
    'INSERT INTO memos (id, title, content, reminder_time, recurrence, completed, pinned, tags, reminders, mute_periods, attachments, webhook, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [memo.id, memo.title, memo.content || '', memo.reminderTime || null, memo.recurrence ? JSON.stringify(memo.recurrence) : null, memo.completed ? 1 : 0, memo.pinned ? 1 : 0, JSON.stringify(memo.tags || []), JSON.stringify(memo.reminders || []), JSON.stringify(memo.mutePeriods || []), JSON.stringify(memo.attachments || []), memo.webhook ? JSON.stringify(memo.webhook) : null, memo.createdAt]
  );
  saveDb();
}

function updateMemoInDb(memo) {
  db.run(
    'UPDATE memos SET title = ?, content = ?, reminder_time = ?, recurrence = ?, completed = ?, pinned = ?, tags = ?, reminders = ?, mute_periods = ?, attachments = ?, webhook = ? WHERE id = ?',
    [memo.title, memo.content || '', memo.reminderTime || null, memo.recurrence ? JSON.stringify(memo.recurrence) : null, memo.completed ? 1 : 0, memo.pinned ? 1 : 0, JSON.stringify(memo.tags || []), JSON.stringify(memo.reminders || []), JSON.stringify(memo.mutePeriods || []), JSON.stringify(memo.attachments || []), memo.webhook ? JSON.stringify(memo.webhook) : null, memo.id]
  );
  saveDb();
}

function deleteMemoFromDb(id) {
  db.run('DELETE FROM memos WHERE id = ?', [id]);
  saveDb();
}

function updateReminderTime(id, reminderTime) {
  db.run('UPDATE memos SET reminder_time = ? WHERE id = ?', [reminderTime, id]);
  saveDb();
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

// ===== 窗口 & 托盘 =====
const iconPath = path.join(__dirname, 'assets', 'icon.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1188,
    minWidth: 600,
    minHeight: 420,
    title: '备忘录',
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  if (process.env.DEV_SERVER) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  tray = new Tray(trayIcon);
  tray.setToolTip('备忘录');
  const contextMenu = Menu.buildFromTemplate([
    { label: '打开备忘录', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow && mainWindow.show());
}

// ===== 提醒调度 =====

// 中国法定假日和调休日历（格式：YYYY-MM-DD）
// holidays: 放假日（包含周末调到工作日放假的情况）
// workdays: 调休补班日（周末变工作日）
const cnCalendar = {
  holidays: new Set([
    // 2025
    '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04',
    '2025-04-04', '2025-04-05', '2025-04-06', '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05',
    '2025-05-31', '2025-06-01', '2025-06-02', '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
    // 2026
    '2026-01-01', '2026-01-02', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
    '2026-04-05', '2026-04-06', '2026-04-07', '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21', '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
    // 2027
    '2027-01-01', '2027-01-02', '2027-01-03', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12',
    '2027-04-05', '2027-04-06', '2027-04-07', '2027-05-01', '2027-05-02', '2027-05-03',
    '2027-06-14', '2027-09-25', '2027-09-26', '2027-09-27',
    '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04', '2027-10-05', '2027-10-06', '2027-10-07',
  ]),
  workdays: new Set([
    // 2025 调休补班
    '2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11',
    // 2026 调休补班
    '2026-02-14', '2026-02-15', '2026-04-26', '2026-05-09', '2026-09-19', '2026-10-10',
    // 2027 调休补班
    '2027-02-20', '2027-10-09',
  ]),
};

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWorkday(date) {
  const key = formatDateKey(date);
  // 如果在调休补班日中，就是工作日
  if (cnCalendar.workdays.has(key)) return true;
  // 如果在假日中，就不是工作日
  if (cnCalendar.holidays.has(key)) return false;
  // 否则按周末判断
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function getNextOccurrence(recurrence) {
  if (!recurrence || recurrence.type === 'once') return null;

  const now = new Date();
  const { type, hour, minute } = recurrence;

  if (type === 'daily') {
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  if (type === 'workday') {
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    // 找到下一个工作日（最多查 30 天防止无限循环）
    for (let i = 0; i < 30; i++) {
      if (isWorkday(next)) return next;
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (type === 'weekly') {
    const dayOfWeek = recurrence.dayOfWeek;
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    const currentDay = now.getDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
      daysUntil += 7;
    }
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  if (type === 'monthly') {
    const dayOfMonth = recurrence.dayOfMonth;
    const next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, minute, 0, 0);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
    if (next.getDate() !== dayOfMonth) {
      next.setDate(0);
    }
    return next;
  }

  return null;
}

function clearMemoTimers(memoId) {
  const timers = activeTimers.get(memoId);
  if (timers) {
    timers.forEach((t) => clearTimeout(t));
    activeTimers.delete(memoId);
  }
}

function scheduleReminder(memo) {
  clearMemoTimers(memo.id);
  if (memo.completed) return;

  const mutePeriods = memo.mutePeriods || [];

  function isInMutePeriod(date) {
    const dateKey = formatDateKey(date);
    return mutePeriods.some((p) => dateKey >= p.from && dateKey <= p.to);
  }

  const reminders = memo.reminders || [];
  // 兼容旧数据
  if (reminders.length === 0) {
    if (memo.recurrence && memo.recurrence.type !== 'once') {
      reminders.push(memo.recurrence);
    } else if (memo.reminderTime) {
      reminders.push({ type: 'once', time: memo.reminderTime });
    }
  }

  if (reminders.length === 0) return;

  const timers = [];
  let nearestTime = null;

  reminders.forEach((rem, idx) => {
    let targetDate;

    if (rem.type === 'once') {
      if (!rem.time) return;
      targetDate = new Date(rem.time);
      // 单次提醒在静默期内则跳过
      if (isInMutePeriod(targetDate)) {
        console.log(`[提醒] "${memo.title}" #${idx + 1} 在静默期内，跳过`);
        return;
      }
    } else {
      targetDate = getNextOccurrence(rem);
      if (!targetDate) return;
      // 周期提醒：如果在静默期内，向后寻找最多 60 天
      let attempts = 0;
      while (isInMutePeriod(targetDate) && attempts < 60) {
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(rem.hour || 0, rem.minute || 0, 0, 0);
        attempts++;
      }
      if (attempts >= 60) return;
    }

    const now = new Date();
    const delay = targetDate.getTime() - now.getTime();

    // 记录最近的提醒时间
    if (delay > 0 && (!nearestTime || targetDate < nearestTime)) {
      nearestTime = targetDate;
    }

    const typeLabel = rem.type !== 'once' ? ` (${rem.type})` : '';
    console.log(`[提醒] "${memo.title}" #${idx + 1} 计划于 ${targetDate.toLocaleString()}，延迟 ${Math.round(delay / 1000)}s${typeLabel}`);

    if (delay <= 0) {
      console.log(`[提醒] "${memo.title}" #${idx + 1} 已过期，跳过`);
      return;
    }

    const timer = setTimeout(() => {
      console.log(`[提醒] 触发: "${memo.title}" #${idx + 1}`);

      if (Notification.isSupported()) {
        const recLabel = rem.type !== 'once' ? ' 🔁' : '';
        const notification = new Notification({
          title: `⏰ 备忘录提醒${recLabel}`,
          body: memo.title,
          subtitle: memo.content || '',
          silent: false,
          urgency: 'critical',
        });
        notification.on('click', () => {
          mainWindow && mainWindow.show();
        });
        notification.show();
      }

      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('reminder-triggered', {
          id: memo.id,
          title: memo.title,
          content: memo.content,
        });
      }

      // 发送 Webhook
      sendWebhook(memo, rem.type).catch(() => {});

      // 周期性提醒自动调度下一次
      if (rem.type !== 'once') {
        const freshMemo = getMemoById(memo.id);
        if (freshMemo && !freshMemo.completed) {
          scheduleReminder(freshMemo);
        }
      }
    }, delay);

    timers.push(timer);
  });

  if (timers.length > 0) {
    activeTimers.set(memo.id, timers);
  }

  // 更新 reminder_time 为最近的提醒时间（用于时间轴排序显示）
  if (nearestTime) {
    updateReminderTime(memo.id, nearestTime.toISOString());
  }
}

function loadAllReminders() {
  const memos = getAllMemos();
  memos.forEach((memo) => scheduleReminder(memo));
}

// ===== Webhook =====
function replaceWebhookVars(template, memo, time) {
  return template
    .replace(/\{\{title\}\}/g, memo.title || '')
    .replace(/\{\{content\}\}/g, memo.content || '')
    .replace(/\{\{tags\}\}/g, (memo.tags || []).join(', '))
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{id\}\}/g, memo.id || '');
}

function sendWechatWebhook(url, markdownContent) {
  const payload = JSON.stringify({
    msgtype: 'markdown_v2',
    markdown_v2: { content: markdownContent },
  });

  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === 'https:';
  const httpModule = isHttps ? require('https') : require('http');

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    timeout: 5000,
  };

  return new Promise((resolve) => {
    const req = httpModule.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        console.log(`[Webhook] ${res.statusCode} - ${body.substring(0, 100)}`);
        resolve({ success: true, status: res.statusCode, body: body.substring(0, 200) });
      });
    });
    req.on('error', (err) => {
      console.error(`[Webhook] 失败: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
    req.on('timeout', () => {
      console.error(`[Webhook] 超时`);
      req.destroy();
      resolve({ success: false, error: '请求超时（5s）' });
    });
    req.write(payload);
    req.end();
  });
}

async function sendWebhook(memo, reminderType) {
  const config = memo.webhook;
  if (!config || !config.enabled || !config.url || !config.content) return;

  const now = new Date().toISOString();
  const markdownContent = replaceWebhookVars(config.content, memo, now);
  const result = await sendWechatWebhook(config.url, markdownContent);
  if (result.success) {
    console.log(`[Webhook] 发送成功: "${memo.title}"`);
  } else {
    console.error(`[Webhook] 发送失败: "${memo.title}" - ${result.error}`);
  }
}

// ===== AI 助手 =====

function rowToProvider(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    apiKey: row.api_key || '',
    createdAt: row.created_at,
  };
}

function rowToModel(row) {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    displayName: row.display_name || undefined,
    enabled: row.enabled === 1,
    thinking: row.thinking === 1,
    priority: row.priority,
    lastError: row.last_error || undefined,
    lastUsedAt: row.last_used_at || undefined,
    createdAt: row.created_at,
  };
}

function getAllProviders() {
  const stmt = db.prepare('SELECT * FROM ai_providers ORDER BY created_at ASC');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToProvider);
}

function getProviderById(id) {
  const stmt = db.prepare('SELECT * FROM ai_providers WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToProvider(row);
  }
  stmt.free();
  return null;
}

function getAllModels() {
  const stmt = db.prepare('SELECT * FROM ai_models ORDER BY priority ASC');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToModel);
}

function getModelById(id) {
  const stmt = db.prepare('SELECT * FROM ai_models WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToModel(row);
  }
  stmt.free();
  return null;
}

function getEnabledModelsOrdered() {
  const stmt = db.prepare('SELECT * FROM ai_models WHERE enabled = 1 ORDER BY priority ASC');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows.map(rowToModel);
}

function isLocalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  } catch { return false; }
}

// ----- Provider CRUD -----
function saveProvider(input) {
  const isUpdate = input.id && getProviderById(input.id);
  if (isUpdate) {
    db.run(
      'UPDATE ai_providers SET name = ?, type = ?, base_url = ?, api_key = ? WHERE id = ?',
      [input.name, input.type, input.baseUrl, input.apiKey || '', input.id]
    );
    saveDb();
    return getProviderById(input.id);
  }
  const id = input.id || uuidv4();
  db.run(
    'INSERT INTO ai_providers (id, name, type, base_url, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, input.name, input.type, input.baseUrl, input.apiKey || '', new Date().toISOString()]
  );
  saveDb();
  return getProviderById(id);
}

function deleteProvider(id) {
  const target = getProviderById(id);
  if (!target) return false;

  // 找出该 Provider 下所有模型，删除并重排剩余模型 priority 保持连续
  const modelsStmt = db.prepare('SELECT id, priority FROM ai_models WHERE provider_id = ? ORDER BY priority ASC');
  modelsStmt.bind([id]);
  const removedPriorities = [];
  while (modelsStmt.step()) removedPriorities.push(modelsStmt.getAsObject().priority);
  modelsStmt.free();

  db.run('DELETE FROM ai_models WHERE provider_id = ?', [id]);
  db.run('DELETE FROM ai_providers WHERE id = ?', [id]);

  // 重排：将剩余 model 的 priority 压紧
  const remain = getAllModels(); // 已 ORDER BY priority
  // 先 +100000 避免冲突
  db.run('UPDATE ai_models SET priority = priority + 100000');
  remain.forEach((m, idx) => {
    db.run('UPDATE ai_models SET priority = ? WHERE id = ?', [idx, m.id]);
  });
  saveDb();
  return true;
}

// ----- Model CRUD -----
function saveModel(input) {
  const isUpdate = input.id && getModelById(input.id);
  if (isUpdate) {
    db.run(
      'UPDATE ai_models SET name = ?, display_name = ?, thinking = ? WHERE id = ?',
      [input.name, input.displayName || null, input.thinking ? 1 : 0, input.id]
    );
    saveDb();
    return getModelById(input.id);
  }
  if (!input.providerId) throw new Error('providerId 不能为空');

  // 新增：priority = max + 1
  const maxStmt = db.prepare('SELECT COALESCE(MAX(priority), -1) AS m FROM ai_models');
  maxStmt.step();
  const max = maxStmt.getAsObject().m;
  maxStmt.free();
  const id = input.id || uuidv4();
  db.run(
    'INSERT INTO ai_models (id, provider_id, name, display_name, enabled, thinking, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.providerId, input.name, input.displayName || null, input.enabled === false ? 0 : 1, input.thinking ? 1 : 0, max + 1, new Date().toISOString()]
  );
  saveDb();
  return getModelById(id);
}

function deleteModel(id) {
  const target = getModelById(id);
  if (!target) return false;
  db.run('DELETE FROM ai_models WHERE id = ?', [id]);
  // 重排：priority > target.priority 的所有项 -1
  db.run('UPDATE ai_models SET priority = priority - 1 WHERE priority > ?', [target.priority]);
  saveDb();
  return true;
}

function setModelEnabled(id, enabled) {
  db.run('UPDATE ai_models SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  saveDb();
  return true;
}

function reorderModels(sortedIds) {
  // 1. 先把所有 priority 加大避免 UNIQUE 冲突
  db.run('UPDATE ai_models SET priority = priority + 100000');
  // 2. 按拖拽后的顺序重排
  sortedIds.forEach((id, idx) => {
    db.run('UPDATE ai_models SET priority = ? WHERE id = ?', [idx, id]);
  });
  saveDb();
}

function updateModelRuntime(id, fields) {
  const sets = [];
  const args = [];
  if ('lastError' in fields) {
    sets.push('last_error = ?');
    args.push(fields.lastError || null);
  }
  if ('lastUsedAt' in fields) {
    sets.push('last_used_at = ?');
    args.push(fields.lastUsedAt || null);
  }
  if (sets.length === 0) return;
  args.push(id);
  db.run(`UPDATE ai_models SET ${sets.join(', ')} WHERE id = ?`, args);
  saveDb();
}

// ----- Tool 定义 -----
// 客户端工具（不立即执行，由 UI 渲染卡片由用户确认）
const CLIENT_TOOLS = new Set(['create_memo']);
// 服务端工具（立即执行并把结果回灌给 LLM）
const SERVER_TOOLS = new Set(['list_memos', 'complete_memo', 'delete_memo']);

const AI_TOOLS_OPENAI = [
  {
    type: 'function',
    function: {
      name: 'create_memo',
      description: '创建一条新的备忘录/待办。仅生成预览卡片，由用户点击「✓ 创建」后才会真正写入数据库。所以可以放心调用，无需先反复确认。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '备忘录标题' },
          content: { type: 'string', description: '正文内容（Markdown）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          reminderTime: { type: 'string', description: 'ISO 8601 格式的提醒时间，如 2026-05-21T15:00:00+08:00' },
          recurrence: {
            type: 'object',
            description: '周期提醒配置',
            properties: {
              type: { type: 'string', enum: ['once', 'daily', 'workday', 'weekly', 'monthly'] },
              hour: { type: 'number' },
              minute: { type: 'number' },
              dayOfWeek: { type: 'number', description: '0=周日, 1=周一, ..., 6=周六' },
              dayOfMonth: { type: 'number' },
            },
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_memos',
      description: '查询用户已有的备忘录/待办列表。可按关键词、标签、状态筛选。返回精简字段：标题、内容摘要、提醒时间、标签、是否完成、是否置顶。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '在标题或内容中搜索的关键词，可选' },
          tag: { type: 'string', description: '只返回包含此标签的备忘录，可选' },
          status: {
            type: 'string',
            enum: ['all', 'active', 'completed'],
            description: '过滤状态：all=全部, active=未完成（默认）, completed=已完成',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_memo',
      description: '标记一条备忘录为已完成（或取消完成）。接受标题的模糊关键词或精确 ID。如果匹配到多条，返回候选列表让用户确认。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '备忘录的标题关键词或 ID' },
          undo: { type: 'boolean', description: '设为 true 则取消完成（恢复为未完成），默认 false' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_memo',
      description: '删除一条备忘录（移入回收站，30天后自动清理）。接受标题的模糊关键词或精确 ID。如果匹配到多条，返回候选列表让用户确认。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '备忘录的标题关键词或 ID' },
        },
        required: ['query'],
      },
    },
  },
];

const AI_TOOLS_ANTHROPIC = AI_TOOLS_OPENAI.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

// ----- 服务端工具实际执行 -----
function executeServerTool(name, args) {
  if (name === 'list_memos') {
    const all = getAllMemos(); // 已排除回收站
    const status = args && args.status;
    const keyword = args && typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
    const tag = args && typeof args.tag === 'string' ? args.tag.trim() : '';

    let filtered = all;
    // 默认过滤未完成
    if (!status || status === 'active') filtered = filtered.filter((m) => !m.completed);
    else if (status === 'completed') filtered = filtered.filter((m) => m.completed);
    // status === 'all' 不过滤

    if (keyword) {
      filtered = filtered.filter((m) =>
        (m.title || '').toLowerCase().includes(keyword) ||
        (m.content || '').toLowerCase().includes(keyword)
      );
    }
    if (tag) {
      filtered = filtered.filter((m) => Array.isArray(m.tags) && m.tags.includes(tag));
    }

    // 精简字段
    const items = filtered.map((m) => {
      const contentExcerpt = (m.content || '')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')   // 去图片
        .replace(/[#*`>\-]/g, '')                // 去 markdown 符号
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      // 把 ISO 时间转为本地可读格式，避免 LLM 做错时区转换
      let reminderTimeLocal;
      if (m.reminderTime) {
        try {
          reminderTimeLocal = new Date(m.reminderTime).toLocaleString('zh-CN', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
          });
        } catch (e) { reminderTimeLocal = m.reminderTime; }
      }
      return {
        id: m.id,
        title: m.title,
        contentExcerpt: contentExcerpt || undefined,
        reminderTime: reminderTimeLocal || undefined,
        tags: m.tags && m.tags.length ? m.tags : undefined,
        completed: m.completed,
        pinned: m.pinned || undefined,
      };
    });

    return { count: items.length, items };
  }

  if (name === 'complete_memo') {
    const query = (args && args.query || '').trim();
    const undo = args && args.undo;
    if (!query) return { error: '缺少 query 参数' };

    // 先尝试精确 ID 匹配
    const byId = getMemoById(query);
    if (byId) {
      const newState = undo ? false : true;
      if (byId.completed === newState) {
        return { success: true, message: `「${byId.title}」已经是${newState ? '已完成' : '未完成'}状态` };
      }
      byId.completed = newState;
      updateMemoInDb(byId);
      if (newState) clearMemoTimers(byId.id);
      else scheduleReminder(byId);
      return { success: true, message: `已将「${byId.title}」标记为${newState ? '已完成 ✅' : '未完成'}` };
    }

    // 模糊匹配标题
    const all = getAllMemos();
    const keyword = query.toLowerCase();
    const matches = all.filter((m) => (m.title || '').toLowerCase().includes(keyword));

    if (matches.length === 0) {
      return { error: `未找到包含「${query}」的备忘录` };
    }
    if (matches.length === 1) {
      const target = matches[0];
      const newState = undo ? false : true;
      if (target.completed === newState) {
        return { success: true, message: `「${target.title}」已经是${newState ? '已完成' : '未完成'}状态` };
      }
      target.completed = newState;
      updateMemoInDb(target);
      if (newState) clearMemoTimers(target.id);
      else scheduleReminder(target);
      return { success: true, message: `已将「${target.title}」标记为${newState ? '已完成 ✅' : '未完成'}` };
    }
    // 多条匹配，返回候选
    return {
      ambiguous: true,
      message: `找到 ${matches.length} 条匹配，请用户确认具体是哪一条：`,
      candidates: matches.slice(0, 10).map((m) => ({ id: m.id, title: m.title, completed: m.completed })),
    };
  }

  if (name === 'delete_memo') {
    const query = (args && args.query || '').trim();
    if (!query) return { error: '缺少 query 参数' };

    // 先尝试精确 ID 匹配
    const byId = getMemoById(query);
    if (byId) {
      db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), byId.id]);
      saveDb();
      clearMemoTimers(byId.id);
      return { success: true, message: `已将「${byId.title}」移入回收站 🗑️` };
    }

    // 模糊匹配标题
    const all = getAllMemos();
    const keyword = query.toLowerCase();
    const matches = all.filter((m) => (m.title || '').toLowerCase().includes(keyword));

    if (matches.length === 0) {
      return { error: `未找到包含「${query}」的备忘录` };
    }
    if (matches.length === 1) {
      const target = matches[0];
      db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), target.id]);
      saveDb();
      clearMemoTimers(target.id);
      return { success: true, message: `已将「${target.title}」移入回收站 🗑️` };
    }
    return {
      ambiguous: true,
      message: `找到 ${matches.length} 条匹配，请用户确认具体删除哪一条：`,
      candidates: matches.slice(0, 10).map((m) => ({ id: m.id, title: m.title })),
    };
  }

  return { error: `未知工具: ${name}` };
}

function buildSystemPrompt() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tagStmt = db.prepare('SELECT name FROM tags ORDER BY name');
  const tagNames = [];
  while (tagStmt.step()) tagNames.push(tagStmt.getAsObject().name);
  tagStmt.free();

  return [
    '你是一个智能备忘录助手，帮助用户管理待办事项。',
    `当前时间：${now.toLocaleString('zh-CN', { hour12: false })}（ISO: ${now.toISOString()}）`,
    `用户时区：${tz}`,
    `用户已有标签：${tagNames.length ? tagNames.join('、') : '（暂无）'}`,
    '',
    '可用工具：',
    '- create_memo：创建新待办，仅生成预览卡片，需用户点击「✓ 创建」才落库',
    '- list_memos：查询用户已有的待办列表，可按 keyword/tag/status 过滤',
    '- complete_memo：标记待办为已完成（或 undo 取消完成），按标题关键词或 ID 匹配',
    '- delete_memo：删除待办（移入回收站），按标题关键词或 ID 匹配',
    '',
    '规则：',
    '1. 用户用自然语言描述新任务时，提取标题、提醒时间、标签等字段，调用 create_memo',
    '2. 用户询问"我有什么待办 / 帮我看看任务"等，先调用 list_memos 拿到数据再回复',
    '3. 用户说"把xx完成了 / xx已经做完了"，调用 complete_memo',
    '4. 用户说"删掉xx / 把xx去掉"，调用 delete_memo',
    '5. 如果 complete_memo 或 delete_memo 返回 ambiguous（多条匹配），将候选列表展示给用户，询问具体是哪一条',
    '6. 时间表达需转为具体时间（基于上方"当前时间"）：',
    '   - "明天下午3点" → 当前日期+1，15:00',
    '   - "下周一上午9点" → 计算下周一的日期',
    '   - "每天早上 8 点" → recurrence: { type: daily, hour: 8, minute: 0 }',
    '7. 缺关键信息时主动询问（如只说"提醒我"没有时间）',
    '8. 如果用户提到的标签不在已有列表，可以建议新建',
    '9. 调用 create_memo 仅生成"预览卡片"，不会直接写入数据库——必须由用户点击「✓ 创建」按钮才会真正落库。所以你可以放心调用工具，无需反复确认。',
    '10. 用户表达修改意图（如"再加个标签"）时，重新调用 create_memo 输出新版本预览',
    '11. 调用 list_memos 后，根据返回结果用自然语言总结给用户（如分组、按时间排序、突出重要项）',
    '12. 回复使用中文，简洁友好',
  ].join('\n');
}

// ----- HTTP 请求工具 -----
function httpJson({ url, method = 'POST', headers = {}, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try { urlObj = new URL(url); } catch (e) { return reject(new Error(`无效的 URL: ${url}`)); }
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? require('https') : require('http');
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = httpModule.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
          catch (e) { resolve({ status: res.statusCode, data: text }); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${text.substring(0, 300)}`));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error(`请求超时（${timeoutMs / 1000}s）`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ----- 流式 HTTP 请求（行回调） -----
// onLine: 每收到一行（按 \n 切分）触发；onEnd: 全部读完
function httpStream({ url, method = 'POST', headers = {}, body, timeoutMs = 60000, onLine }) {
  return new Promise((resolve, reject) => {
    let urlObj;
    try { urlObj = new URL(url); } catch (e) { return reject(new Error(`无效的 URL: ${url}`)); }
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? require('https') : require('http');
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = httpModule.request(options, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf-8').substring(0, 300)}`)));
        return;
      }
      let buffer = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          try { onLine && onLine(line); }
          catch (e) { console.error('[stream] line handler error:', e); }
        }
      });
      res.on('end', () => {
        if (buffer) {
          try { onLine && onLine(buffer); } catch (e) {}
        }
        resolve();
      });
      res.on('error', (err) => reject(err));
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error(`请求超时（${timeoutMs / 1000}s）`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ----- Provider 适配器 -----
function joinUrl(base, path) {
  return base.replace(/\/+$/, '') + path;
}

async function callOpenAi(provider, model, messages, tools, onDelta) {
  const url = joinUrl(provider.baseUrl, '/chat/completions');

  const payloadMessages = [{ role: 'system', content: buildSystemPrompt() }];
  for (const m of messages) {
    if (m.role === 'tool') {
      payloadMessages.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content || '',
      });
    } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      payloadMessages.push({
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
        })),
      });
    } else {
      payloadMessages.push({ role: m.role, content: m.content || '' });
    }
  }

  const body = {
    model: model.name,
    messages: payloadMessages,
    tools,
    tool_choice: 'auto',
    temperature: 0.3,
  };
  if (model.thinking) {
    body.reasoning_effort = 'medium';
    body.enable_thinking = true;
  }
  const headers = { Authorization: `Bearer ${provider.apiKey}` };

  // 非流式（用于测试连接等场景）
  if (!onDelta) {
    const { data } = await httpJson({ url, headers, body, timeoutMs: 30000 });
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error('响应格式异常：缺少 choices');
    const msg = choice.message || {};
    const toolCalls = (msg.tool_calls || []).map((tc) => ({
      id: tc.id || uuidv4(),
      name: tc.function && tc.function.name,
      arguments: safeJsonParse(tc.function && tc.function.arguments) || {},
    })).filter((tc) => tc.name);
    return {
      content: msg.content || '',
      toolCalls,
      thinking: msg.reasoning_content || msg.reasoning || undefined,
    };
  }

  // 流式
  body.stream = true;
  let content = '';
  let thinking = '';
  // toolCalls 流式累积，按 index
  const toolCallsAccum = {};

  await httpStream({
    url, headers, body, timeoutMs: 60000,
    onLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') return;
      let json;
      try { json = JSON.parse(dataStr); } catch { return; }
      const choice = json.choices && json.choices[0];
      if (!choice) return;
      const delta = choice.delta || {};

      // 思考流（reasoning_content / reasoning）
      const reasoningDelta = delta.reasoning_content || delta.reasoning;
      if (reasoningDelta) {
        thinking += reasoningDelta;
        onDelta({ type: 'thinking_delta', text: reasoningDelta });
      }
      // 文本流
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onDelta({ type: 'content_delta', text: delta.content });
      }
      // tool_calls 流式拼装
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index != null ? tc.index : 0;
          if (!toolCallsAccum[idx]) {
            toolCallsAccum[idx] = { id: tc.id || uuidv4(), name: '', argumentsRaw: '' };
          }
          if (tc.id) toolCallsAccum[idx].id = tc.id;
          if (tc.function) {
            if (tc.function.name) toolCallsAccum[idx].name += tc.function.name;
            if (tc.function.arguments) toolCallsAccum[idx].argumentsRaw += tc.function.arguments;
          }
        }
      }
    },
  });

  const toolCalls = Object.values(toolCallsAccum)
    .filter((tc) => tc.name)
    .map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: safeJsonParse(tc.argumentsRaw) || {},
    }));

  return {
    content,
    toolCalls,
    thinking: thinking || undefined,
  };
}

async function callAnthropic(provider, model, messages, tools, onDelta) {
  const url = joinUrl(provider.baseUrl, '/messages');

  const claudeMessages = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      claudeMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '' }],
      });
    } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments || {} });
      }
      claudeMessages.push({ role: 'assistant', content: blocks });
    } else {
      claudeMessages.push({ role: m.role, content: m.content || '' });
    }
  }

  const body = {
    model: model.name,
    max_tokens: 2048,
    system: buildSystemPrompt(),
    messages: claudeMessages,
    tools,
  };
  if (model.thinking) {
    body.thinking = { type: 'enabled', budget_tokens: 8000 };
  }
  const headers = {
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01',
  };

  // 非流式
  if (!onDelta) {
    const { data } = await httpJson({ url, headers, body, timeoutMs: 30000 });
    let content = '';
    const toolCalls = [];
    let thinking;
    for (const block of data.content || []) {
      if (block.type === 'text') content += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id || uuidv4(), name: block.name, arguments: block.input || {} });
      } else if (block.type === 'thinking') {
        thinking = (thinking || '') + (block.thinking || '');
      }
    }
    return { content, toolCalls, thinking };
  }

  // 流式
  body.stream = true;
  let content = '';
  let thinking = '';
  const blocksAccum = {}; // index -> { type, ...meta, text/argumentsRaw }

  await httpStream({
    url, headers, body, timeoutMs: 60000,
    onLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr) return;
      let json;
      try { json = JSON.parse(dataStr); } catch { return; }

      if (json.type === 'content_block_start') {
        const cb = json.content_block || {};
        blocksAccum[json.index] = {
          type: cb.type,
          id: cb.id,
          name: cb.name,
          text: '',
          thinking: '',
          argumentsRaw: '',
        };
      } else if (json.type === 'content_block_delta') {
        const block = blocksAccum[json.index];
        if (!block) return;
        const d = json.delta || {};
        if (d.type === 'text_delta' && d.text) {
          block.text += d.text;
          content += d.text;
          onDelta({ type: 'content_delta', text: d.text });
        } else if (d.type === 'thinking_delta' && d.thinking) {
          block.thinking += d.thinking;
          thinking += d.thinking;
          onDelta({ type: 'thinking_delta', text: d.thinking });
        } else if (d.type === 'input_json_delta' && d.partial_json) {
          block.argumentsRaw += d.partial_json;
        }
      }
    },
  });

  const toolCalls = Object.values(blocksAccum)
    .filter((b) => b.type === 'tool_use' && b.name)
    .map((b) => ({
      id: b.id || uuidv4(),
      name: b.name,
      arguments: safeJsonParse(b.argumentsRaw) || {},
    }));

  return { content, toolCalls, thinking: thinking || undefined };
}

async function callOllama(provider, model, messages, tools, onDelta) {
  const url = joinUrl(provider.baseUrl, '/api/chat');

  const ollamaMessages = [{ role: 'system', content: buildSystemPrompt() }];
  for (const m of messages) {
    if (m.role === 'tool') {
      ollamaMessages.push({
        role: 'tool',
        content: m.content || '',
      });
    } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      ollamaMessages.push({
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.arguments || {} },
        })),
      });
    } else {
      ollamaMessages.push({ role: m.role, content: m.content || '' });
    }
  }

  const body = {
    model: model.name,
    messages: ollamaMessages,
    tools,
    options: { temperature: 0.3 },
  };
  if (model.thinking) {
    body.think = true;
  }

  // 非流式
  if (!onDelta) {
    body.stream = false;
    const { data } = await httpJson({ url, body, timeoutMs: 60000 });
    const msg = data.message || {};
    const toolCalls = (msg.tool_calls || []).map((tc) => ({
      id: uuidv4(),
      name: tc.function && tc.function.name,
      arguments: tc.function && tc.function.arguments || {},
    })).filter((tc) => tc.name);
    return {
      content: msg.content || '',
      toolCalls,
      thinking: msg.thinking || undefined,
    };
  }

  // 流式（NDJSON）
  body.stream = true;
  let content = '';
  let thinking = '';
  let toolCallsAccum = [];

  await httpStream({
    url, body, timeoutMs: 120000,
    onLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let json;
      try { json = JSON.parse(trimmed); } catch { return; }
      const msg = json.message || {};
      if (typeof msg.content === 'string' && msg.content) {
        content += msg.content;
        onDelta({ type: 'content_delta', text: msg.content });
      }
      if (typeof msg.thinking === 'string' && msg.thinking) {
        thinking += msg.thinking;
        onDelta({ type: 'thinking_delta', text: msg.thinking });
      }
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          toolCallsAccum.push({
            id: uuidv4(),
            name: tc.function && tc.function.name,
            arguments: (tc.function && tc.function.arguments) || {},
          });
        }
      }
    },
  });

  return {
    content,
    toolCalls: toolCallsAccum.filter((tc) => tc.name),
    thinking: thinking || undefined,
  };
}

function safeJsonParse(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch (e) { return null; }
}

async function invokeModel(provider, model, messages, onDelta) {
  if (provider.type === 'anthropic') {
    return callAnthropic(provider, model, messages, AI_TOOLS_ANTHROPIC, onDelta);
  }
  if (provider.type === 'ollama') {
    return callOllama(provider, model, messages, AI_TOOLS_OPENAI.map((t) => t.function), onDelta);
  }
  return callOpenAi(provider, model, messages, AI_TOOLS_OPENAI, onDelta);
}

// 描述: "DeepSeek/deepseek-chat"
function modelLabel(provider, model) {
  return `${provider.name} / ${model.displayName || model.name}`;
}

// 多轮工具循环：服务端工具立即执行并回灌结果，客户端工具直接返回交给前端
const MAX_TOOL_LOOPS = 4;
async function runConversation(provider, model, initialMessages, onDelta) {
  let working = [...initialMessages];
  const allClientCalls = [];
  let lastTextContent = '';
  let thinkingAccum;

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    // 把 loop 信息透传给 onDelta，前端可以判断是不是新一轮
    const wrappedDelta = onDelta ? (chunk) => onDelta({ ...chunk, loop }) : undefined;
    const r = await invokeModel(provider, model, working, wrappedDelta);
    if (r.thinking) thinkingAccum = (thinkingAccum || '') + r.thinking;
    lastTextContent = r.content || '';
    const calls = r.toolCalls || [];

    // 区分客户端/服务端工具
    const serverCalls = calls.filter((tc) => SERVER_TOOLS.has(tc.name));
    const clientCalls = calls.filter((tc) => CLIENT_TOOLS.has(tc.name));
    const unknownCalls = calls.filter((tc) => !SERVER_TOOLS.has(tc.name) && !CLIENT_TOOLS.has(tc.name));

    allClientCalls.push(...clientCalls);

    // 没有服务端工具调用 → 终止循环
    if (serverCalls.length === 0) {
      // 未知工具直接当客户端工具透传（让前端展示提示）
      allClientCalls.push(...unknownCalls);
      return { content: lastTextContent, toolCalls: allClientCalls, thinking: thinkingAccum };
    }

    // 执行服务端工具 → 回灌 tool 消息
    const toolResults = serverCalls.map((tc) => {
      let result;
      try { result = executeServerTool(tc.name, tc.arguments || {}); }
      catch (e) { result = { error: (e && e.message) || String(e) }; }
      return { call: tc, result };
    });

    // 通知前端：服务端工具被调用了
    if (onDelta) {
      serverCalls.forEach((tc) => {
        onDelta({ type: 'server_tool', name: tc.name, arguments: tc.arguments || {}, loop });
      });
    }

    // 执行并回灌
    working.push({
      role: 'assistant',
      content: lastTextContent,
      toolCalls: serverCalls,
    });
    toolResults.forEach(({ call, result }) => {
      working.push({
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        content: JSON.stringify(result),
      });
    });

    // 通知前端：工具执行完毕（带摘要）
    if (onDelta) {
      toolResults.forEach(({ call, result }) => {
        let summary = '';
        if (result && result.error) summary = `错误: ${result.error}`;
        else if (result && result.ambiguous) summary = `${result.candidates?.length || 0} 条候选`;
        else if (result && typeof result.count === 'number') summary = `找到 ${result.count} 条结果`;
        else if (result && result.success) summary = result.message || '执行完成';
        else summary = '执行完成';
        onDelta({ type: 'server_tool_done', name: call.name, summary, loop });
      });
    }

    // 如果有写操作（complete/delete），通知主窗口刷新列表
    const hasMutation = serverCalls.some((tc) => tc.name === 'complete_memo' || tc.name === 'delete_memo');
    if (hasMutation && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memos-changed');
    }
  }

  // 达到循环上限
  return {
    content: lastTextContent || '（未能完成多轮工具调用，请重试）',
    toolCalls: allClientCalls,
    thinking: thinkingAccum,
  };
}

async function callLLM(messages, online, options) {
  options = options || {};
  const onDelta = options.onDelta;
  // 指定模型模式：不降级
  if (options.modelId) {
    const m = getModelById(options.modelId);
    if (!m) throw new Error('指定的模型不存在');
    if (!m.enabled) throw new Error('指定的模型已禁用');
    const p = getProviderById(m.providerId);
    if (!p) throw new Error('该模型对应的 Provider 已被删除');
    if (!online && !isLocalUrl(p.baseUrl)) throw new Error('当前离线，且该模型不是本地 Provider');
    try {
      if (onDelta) onDelta({ type: 'model_start', providerName: p.name, modelLabel: modelLabel(p, m) });
      const r = await runConversation(p, m, messages, onDelta);
      updateModelRuntime(m.id, { lastError: null, lastUsedAt: new Date().toISOString() });
      return { ...r, providerName: p.name, modelName: m.name, modelLabel: modelLabel(p, m) };
    } catch (err) {
      const msg = (err && err.message) || String(err);
      updateModelRuntime(m.id, { lastError: msg });
      throw new Error(`${modelLabel(p, m)} 失败：${msg}`);
    }
  }

  // Auto 模式：按 priority 升序遍历，自动降级
  const allModels = getEnabledModelsOrdered();
  if (allModels.length === 0) throw new Error('未配置任何启用的模型');

  const candidates = allModels
    .map((m) => ({ m, p: getProviderById(m.providerId) }))
    .filter((x) => x.p && (online || isLocalUrl(x.p.baseUrl)));

  if (candidates.length === 0) {
    throw new Error('当前离线，未找到可用的本地模型');
  }

  const primary = candidates[0];
  const errors = [];
  for (const { m, p } of candidates) {
    try {
      if (onDelta) onDelta({ type: 'model_start', providerName: p.name, modelLabel: modelLabel(p, m), fallbackFrom: m.id !== primary.m.id ? modelLabel(primary.p, primary.m) : undefined });
      const r = await runConversation(p, m, messages, onDelta);
      updateModelRuntime(m.id, { lastError: null, lastUsedAt: new Date().toISOString() });
      const usedLabel = modelLabel(p, m);
      const fallbackFromLabel = m.id !== primary.m.id ? modelLabel(primary.p, primary.m) : undefined;
      return {
        ...r,
        providerName: p.name,
        modelName: m.name,
        modelLabel: usedLabel,
        fallbackFrom: fallbackFromLabel,
      };
    } catch (err) {
      const msg = (err && err.message) || String(err);
      console.warn(`[AI] ${modelLabel(p, m)} 失败，降级到下一个: ${msg}`);
      updateModelRuntime(m.id, { lastError: msg });
      errors.push(`${modelLabel(p, m)}: ${msg}`);
      if (onDelta) onDelta({ type: 'model_failed', modelLabel: modelLabel(p, m), error: msg });
    }
  }
  throw new Error(`所有模型均不可用：\n${errors.join('\n')}`);
}

// ===== IPC 通信 =====
ipcMain.handle('get-memos', () => getAllMemos());

ipcMain.handle('search-memos', (_, keyword) => {
  const k = `%${keyword}%`;
  const stmt = db.prepare('SELECT * FROM memos WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) ORDER BY pinned DESC, created_at DESC');
  stmt.bind([k, k]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(rowToMemo);
});

ipcMain.handle('select-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const srcPath = result.filePaths[0];
  const ext = path.extname(srcPath);
  const fileName = `${uuidv4()}${ext}`;

  const imagesDir = path.join(app.getPath('userData'), 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const destPath = path.join(imagesDir, fileName);
  fs.copyFileSync(srcPath, destPath);
  return { fileName, filePath: destPath };
});

ipcMain.handle('save-dropped-image', (_, srcPath) => {
  const ext = path.extname(srcPath).toLowerCase();
  const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
  if (!allowed.includes(ext)) return null;

  const fileName = `${uuidv4()}${ext}`;
  const imagesDir = path.join(app.getPath('userData'), 'images');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const destPath = path.join(imagesDir, fileName);
  fs.copyFileSync(srcPath, destPath);
  return { fileName, filePath: destPath };
});

ipcMain.handle('get-image-path', (_, fileName) => {
  return path.join(app.getPath('userData'), 'images', fileName);
});

ipcMain.handle('select-attachment', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: '所有文件', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const srcPath = result.filePaths[0];
  const originalName = path.basename(srcPath);
  const ext = path.extname(srcPath);
  const fileName = `${uuidv4()}${ext}`;
  const stats = fs.statSync(srcPath);

  const attachDir = path.join(app.getPath('userData'), 'attachments');
  if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

  const destPath = path.join(attachDir, fileName);
  fs.copyFileSync(srcPath, destPath);
  return { fileName, originalName, size: stats.size, filePath: destPath };
});

ipcMain.handle('save-dropped-file', (_, srcPath) => {
  if (!fs.existsSync(srcPath)) return null;
  const originalName = path.basename(srcPath);
  const ext = path.extname(srcPath);
  const fileName = `${uuidv4()}${ext}`;
  const stats = fs.statSync(srcPath);

  const attachDir = path.join(app.getPath('userData'), 'attachments');
  if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

  const destPath = path.join(attachDir, fileName);
  fs.copyFileSync(srcPath, destPath);
  return { fileName, originalName, size: stats.size, filePath: destPath };
});

ipcMain.handle('open-attachment', (_, filePath) => {
  const { shell } = require('electron');
  shell.openPath(filePath);
});

ipcMain.handle('add-memo', (_, memo) => {
  const newMemo = {
    id: uuidv4(),
    title: memo.title,
    content: memo.content || '',
    reminderTime: memo.reminderTime || null,
    recurrence: memo.recurrence || null,
    reminders: memo.reminders || [],
    mutePeriods: memo.mutePeriods || [],
    attachments: memo.attachments || [],
    webhook: memo.webhook || null,
    completed: false,
    tags: memo.tags || [],
    createdAt: new Date().toISOString(),
  };
  insertMemo(newMemo);
  scheduleReminder(newMemo);
  return newMemo;
});

ipcMain.handle('update-memo', (_, updatedMemo) => {
  const existing = getMemoById(updatedMemo.id);
  if (!existing) return null;
  const merged = { ...existing, ...updatedMemo };
  updateMemoInDb(merged);
  scheduleReminder(merged);
  return merged;
});

ipcMain.handle('delete-memo', (_, id) => {
  // 软删除：设置 deleted_at 时间戳
  db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id]);
  saveDb();
  clearMemoTimers(id);
  return true;
});

ipcMain.handle('get-trash', () => getTrashMemos());

ipcMain.handle('restore-memo', (_, id) => {
  db.run('UPDATE memos SET deleted_at = NULL WHERE id = ?', [id]);
  saveDb();
  const memo = getMemoById(id);
  if (memo) scheduleReminder(memo);
  return memo;
});

ipcMain.handle('permanent-delete', (_, id) => {
  db.run('DELETE FROM memos WHERE id = ?', [id]);
  saveDb();
  return true;
});

ipcMain.handle('empty-trash', () => {
  db.run('DELETE FROM memos WHERE deleted_at IS NOT NULL');
  saveDb();
  return true;
});

ipcMain.handle('toggle-complete', (_, id) => {
  const memo = getMemoById(id);
  if (!memo) return null;
  memo.completed = !memo.completed;
  updateMemoInDb(memo);
  if (memo.completed) {
    clearMemoTimers(id);
  } else {
    scheduleReminder(memo);
  }
  return memo;
});

ipcMain.handle('toggle-pin', (_, id) => {
  const memo = getMemoById(id);
  if (!memo) return null;
  memo.pinned = !memo.pinned;
  updateMemoInDb(memo);
  return memo;
});

// ===== 标签管理 =====
ipcMain.handle('get-tags', () => {
  const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
});

ipcMain.handle('add-tag', (_, tag) => {
  const id = uuidv4();
  db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [id, tag.name, tag.color || '#007aff']);
  saveDb();
  return { id, name: tag.name, color: tag.color || '#007aff' };
});

ipcMain.handle('update-tag', (_, tag) => {
  db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', [tag.name, tag.color, tag.id]);
  saveDb();
  return tag;
});

ipcMain.handle('delete-tag', (_, id) => {
  // 从所有 memos 中移除该标签
  const memos = getAllMemos();
  const stmt2 = db.prepare('SELECT name FROM tags WHERE id = ?');
  stmt2.bind([id]);
  let tagName = '';
  if (stmt2.step()) tagName = stmt2.getAsObject().name;
  stmt2.free();

  if (tagName) {
    memos.forEach((m) => {
      if (m.tags && m.tags.includes(tagName)) {
        m.tags = m.tags.filter((t) => t !== tagName);
        db.run('UPDATE memos SET tags = ? WHERE id = ?', [JSON.stringify(m.tags), m.id]);
      }
    });
  }
  db.run('DELETE FROM tags WHERE id = ?', [id]);
  saveDb();
  return true;
});

// ===== Webhook 测试 =====
ipcMain.handle('test-webhook', async (_, url, contentTemplate, memoData) => {
  const now = new Date().toISOString();
  const memo = {
    id: 'test-001',
    title: (memoData && memoData.title) || '测试提醒',
    content: (memoData && memoData.content) || '',
    tags: (memoData && memoData.tags) || [],
  };
  const markdownContent = replaceWebhookVars(contentTemplate || '# {{title}}', memo, now);
  return sendWechatWebhook(url, markdownContent);
});

// ===== AI IPC =====
ipcMain.handle('ai-get-providers', () => getAllProviders());
ipcMain.handle('ai-save-provider', (_, input) => saveProvider(input));
ipcMain.handle('ai-delete-provider', (_, id) => deleteProvider(id));

ipcMain.handle('ai-get-models', () => getAllModels());
ipcMain.handle('ai-save-model', (_, input) => saveModel(input));
ipcMain.handle('ai-delete-model', (_, id) => deleteModel(id));
ipcMain.handle('ai-toggle-model', (_, id, enabled) => setModelEnabled(id, !!enabled));
ipcMain.handle('ai-reorder-models', (_, sortedIds) => {
  reorderModels(sortedIds || []);
  return true;
});

ipcMain.handle('ai-has-usable-model', () => {
  const online = require('electron').net.isOnline();
  const models = getEnabledModelsOrdered();
  return models.some((m) => {
    const p = getProviderById(m.providerId);
    return p && (online || isLocalUrl(p.baseUrl));
  });
});

ipcMain.handle('ai-test-model', async (_, providerInput, modelName, thinking) => {
  const start = Date.now();
  const tempProvider = {
    id: providerInput.id || 'test',
    name: providerInput.name || 'test',
    type: providerInput.type,
    baseUrl: providerInput.baseUrl,
    apiKey: providerInput.apiKey || '',
    createdAt: new Date().toISOString(),
  };
  const tempModel = {
    id: 'test-model',
    providerId: tempProvider.id,
    name: modelName,
    enabled: true,
    thinking: !!thinking,
    priority: 0,
    createdAt: new Date().toISOString(),
  };
  try {
    const r = await invokeModel(tempProvider, tempModel, [{ role: 'user', content: '你好，请回复"ok"两个字。' }]);
    return { success: true, latencyMs: Date.now() - start, modelEcho: (r.content || '').slice(0, 60) };
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

// 流式 AI Chat IPC
ipcMain.on('ai-chat-stream', async (event, args) => {
  const online = require('electron').net.isOnline();
  const messages = (args && args.messages) || [];
  const modelId = args && args.modelId;
  const streamId = args && args.streamId || Date.now().toString();

  const emit = (chunk) => {
    if (event.sender.isDestroyed()) return;
    event.sender.send('ai-chat-chunk', { streamId, ...chunk });
  };

  try {
    const r = await callLLM(messages, online, {
      modelId,
      onDelta: (delta) => emit(delta),
    });
    // 流结束：发送 done + 完整结果
    emit({
      type: 'done',
      message: {
        role: 'assistant',
        content: r.content || '',
        toolCalls: r.toolCalls || [],
        thinking: r.thinking,
        providerName: r.providerName,
        modelName: r.modelName,
        modelLabel: r.modelLabel,
        fallbackFrom: r.fallbackFrom,
        ts: new Date().toISOString(),
      },
    });
  } catch (err) {
    emit({ type: 'error', error: err.message || String(err) });
  }
});

// 非流式 ai-chat 保留向后兼容（测试等场景用）
ipcMain.handle('ai-chat', async (_, args) => {
  const online = require('electron').net.isOnline();
  const messages = Array.isArray(args) ? args : (args && args.messages) || [];
  const modelId = !Array.isArray(args) && args ? args.modelId : undefined;
  try {
    const r = await callLLM(messages, online, { modelId });
    return {
      message: {
        role: 'assistant',
        content: r.content || '',
        toolCalls: r.toolCalls || [],
        thinking: r.thinking,
        providerName: r.providerName,
        modelName: r.modelName,
        modelLabel: r.modelLabel,
        fallbackFrom: r.fallbackFrom,
        ts: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      message: {
        role: 'assistant',
        content: '',
        ts: new Date().toISOString(),
      },
      error: err.message || String(err),
    };
  }
});

// ===== 导入/导出 =====
ipcMain.handle('export-data', async () => {
  const dateSuffix = new Date().toISOString().slice(0, 10);
  const folderName = `备忘录导出_${dateSuffix}`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出备忘录',
    defaultPath: `${folderName}.zip`,
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return { success: false };

  try {
    const zip = new AdmZip();
    const memos = getAllMemos();
    const tags = [];
    const tagStmt = db.prepare('SELECT * FROM tags ORDER BY name');
    while (tagStmt.step()) tags.push(tagStmt.getAsObject());
    tagStmt.free();

    // 收集所有图片路径并重写为相对路径
    const imagesDir = path.join(app.getPath('userData'), 'images');
    const imageFiles = new Set();
    const attachmentFiles = new Set();

    const exportMemos = memos.map((m) => {
      let content = m.content || '';
      const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      content = content.replace(imgRegex, (match, alt, imgPath) => {
        if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) return match;
        const fileName = path.basename(imgPath);
        const fullPath = imgPath.startsWith('/') ? imgPath : path.join(imagesDir, fileName);
        if (fs.existsSync(fullPath)) {
          imageFiles.add(fullPath);
          return `![${alt}](images/${fileName})`;
        }
        return match;
      });
      // 附件路径重写为相对路径
      const exportAttachments = (m.attachments || []).map((att) => {
        if (att.filePath && fs.existsSync(att.filePath)) {
          attachmentFiles.add(att.filePath);
          return { ...att, filePath: `attachments/${att.fileName}` };
        }
        return att;
      });
      return { ...m, content, attachments: exportAttachments };
    });

    // 所有文件放在同名文件夹下
    zip.addFile(`${folderName}/memos.json`, Buffer.from(JSON.stringify({ memos: exportMemos, tags }, null, 2), 'utf-8'));

    imageFiles.forEach((imgPath) => {
      const fileName = path.basename(imgPath);
      zip.addLocalFile(imgPath, `${folderName}/images`, fileName);
    });

    attachmentFiles.forEach((attPath) => {
      const fileName = path.basename(attPath);
      zip.addLocalFile(attPath, `${folderName}/attachments`, fileName);
    });

    zip.writeZip(result.filePath);
    return { success: true, path: result.filePath, count: memos.length };
  } catch (err) {
    console.error('[导出] 失败:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('import-data', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入备忘录',
    properties: ['openFile'],
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false };

  try {
    const zip = new AdmZip(result.filePaths[0]);
    const entries = zip.getEntries();

    // 自动检测根文件夹前缀（兼容有/无文件夹两种格式）
    let prefix = '';
    const jsonEntry = entries.find((e) => e.entryName.endsWith('memos.json'));
    if (!jsonEntry) return { success: false, error: '无效的备忘录导出文件' };
    prefix = jsonEntry.entryName.replace('memos.json', '');

    const data = JSON.parse(jsonEntry.getData().toString('utf-8'));
    if (!data.memos || !Array.isArray(data.memos)) return { success: false, error: '数据格式错误' };

    // 解压图片
    const imagesDir = path.join(app.getPath('userData'), 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const imagePrefix = `${prefix}images/`;
    const imageEntries = entries.filter((e) => e.entryName.startsWith(imagePrefix) && !e.isDirectory);
    imageEntries.forEach((entry) => {
      const fileName = path.basename(entry.entryName);
      const destPath = path.join(imagesDir, fileName);
      if (!fs.existsSync(destPath)) {
        fs.writeFileSync(destPath, entry.getData());
      }
    });

    // 解压附件
    const attachDir = path.join(app.getPath('userData'), 'attachments');
    if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

    const attachPrefix = `${prefix}attachments/`;
    const attachEntries = entries.filter((e) => e.entryName.startsWith(attachPrefix) && !e.isDirectory);
    attachEntries.forEach((entry) => {
      const fileName = path.basename(entry.entryName);
      const destPath = path.join(attachDir, fileName);
      if (!fs.existsSync(destPath)) {
        fs.writeFileSync(destPath, entry.getData());
      }
    });

    // 导入标签
    let tagsImported = 0;
    if (data.tags && Array.isArray(data.tags)) {
      data.tags.forEach((tag) => {
        try {
          db.run('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)', [tag.id || uuidv4(), tag.name, tag.color || '#007aff']);
          tagsImported++;
        } catch (e) { /* 忽略重复 */ }
      });
    }

    // 导入备忘录
    let imported = 0;
    let skipped = 0;
    data.memos.forEach((m) => {
      const existing = getMemoById(m.id);
      if (existing) { skipped++; return; }

      // 重写图片路径为本地绝对路径
      let content = m.content || '';
      const imgRegex = /!\[([^\]]*)\]\(images\/([^)]+)\)/g;
      content = content.replace(imgRegex, (match, alt, fileName) => {
        const localPath = path.join(imagesDir, fileName);
        if (fs.existsSync(localPath)) {
          return `![${alt}](${localPath})`;
        }
        return match;
      });

      // 重写附件路径为本地绝对路径
      const importAttachments = (m.attachments || []).map((att) => {
        if (att.filePath && att.filePath.startsWith('attachments/')) {
          const localPath = path.join(attachDir, att.fileName);
          return { ...att, filePath: localPath };
        }
        return att;
      });

      const newMemo = {
        id: m.id || uuidv4(),
        title: m.title,
        content: content,
        reminderTime: m.reminderTime || null,
        recurrence: m.recurrence || null,
        reminders: m.reminders || [],
        mutePeriods: m.mutePeriods || [],
        attachments: importAttachments,
        completed: m.completed || false,
        pinned: m.pinned || false,
        tags: m.tags || [],
        createdAt: m.createdAt || new Date().toISOString(),
      };
      insertMemo(newMemo);
      scheduleReminder(newMemo);
      imported++;
    });

    saveDb();
    return { success: true, imported, skipped, tagsImported };
  } catch (err) {
    console.error('[导入] 失败:', err);
    return { success: false, error: err.message };
  }
});

// ===== 本地 HTTP API（供 CLI 调用） =====
const CLI_PORT = 19527;

function startCliServer() {
  const http = require('http');

  const routes = {
    'GET /api/memos': () => getAllMemos(),
    'GET /api/trash': () => getTrashMemos(),
    'GET /api/tags': () => {
      const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    'POST /api/memos': (body) => {
      const newMemo = {
        id: uuidv4(),
        title: body.title,
        content: body.content || '',
        reminderTime: body.reminderTime || null,
        recurrence: body.recurrence || null,
        reminders: body.reminders || [],
        mutePeriods: body.mutePeriods || [],
        attachments: body.attachments || [],
        webhook: body.webhook || null,
        completed: false,
        tags: body.tags || [],
        createdAt: new Date().toISOString(),
      };
      insertMemo(newMemo);
      scheduleReminder(newMemo);
      return newMemo;
    },
    'PUT /api/memos': (body) => {
      const existing = getMemoById(body.id);
      if (!existing) return { error: 'not found' };
      const merged = { ...existing, ...body };
      updateMemoInDb(merged);
      scheduleReminder(merged);
      return merged;
    },
    'DELETE /api/memos': (body) => {
      db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), body.id]);
      saveDb();
      clearMemoTimers(body.id);
      return { success: true };
    },
    'POST /api/memos/complete': (body) => {
      const memo = getMemoById(body.id);
      if (!memo) return { error: 'not found' };
      memo.completed = !memo.completed;
      updateMemoInDb(memo);
      if (memo.completed) clearMemoTimers(body.id);
      else scheduleReminder(memo);
      return memo;
    },
    'POST /api/memos/pin': (body) => {
      const memo = getMemoById(body.id);
      if (!memo) return { error: 'not found' };
      memo.pinned = !memo.pinned;
      updateMemoInDb(memo);
      return memo;
    },
    'POST /api/memos/restore': (body) => {
      db.run('UPDATE memos SET deleted_at = NULL WHERE id = ?', [body.id]);
      saveDb();
      const memo = getMemoById(body.id);
      if (memo) scheduleReminder(memo);
      return memo;
    },
    'DELETE /api/memos/permanent': (body) => {
      db.run('DELETE FROM memos WHERE id = ?', [body.id]);
      saveDb();
      return { success: true };
    },
    'DELETE /api/trash': () => {
      db.run('DELETE FROM memos WHERE deleted_at IS NOT NULL');
      saveDb();
      return { success: true };
    },
    'GET /api/search': (_, query) => {
      const k = `%${query.q || ''}%`;
      const stmt = db.prepare('SELECT * FROM memos WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) ORDER BY pinned DESC, created_at DESC');
      stmt.bind([k, k]);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows.map(rowToMemo);
    },
    'POST /api/tags': (body) => {
      const id = uuidv4();
      db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [id, body.name, body.color || '#007aff']);
      saveDb();
      return { id, name: body.name, color: body.color || '#007aff' };
    },
    'DELETE /api/tags': (body) => {
      db.run('DELETE FROM tags WHERE id = ?', [body.id]);
      saveDb();
      return { success: true };
    },
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${CLI_PORT}`);
    const routeKey = `${req.method} ${url.pathname}`;

    res.setHeader('Content-Type', 'application/json');

    if (routeKey === 'GET /api/ping') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    const handler = routes[routeKey];
    if (!handler) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    if (req.method === 'GET') {
      const query = Object.fromEntries(url.searchParams);
      const result = handler(null, query);
      res.end(JSON.stringify(result));
    } else {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(data); } catch (e) {}
        const result = handler(body);
        res.end(JSON.stringify(result));
      });
    }
  });

  server.listen(CLI_PORT, '127.0.0.1', () => {
    console.log(`[CLI Server] 监听 http://127.0.0.1:${CLI_PORT}`);
  });
  server.on('error', (err) => {
    console.error(`[CLI Server] 启动失败: ${err.message}`);
  });
}

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
  // 设置 Dock 图标和应用名
  if (process.platform === 'darwin') {
    app.dock.setIcon(iconPath);
    app.setName('备忘录');
  }

  await initDatabase();
  cleanupOldTrash();

  createWindow();
  createTray();
  loadAllReminders();
  startCliServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow && mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (db) {
    saveDb();
    db.close();
  }
});
