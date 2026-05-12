const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');

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
  const stmt = db.prepare('SELECT * FROM memos ORDER BY pinned DESC, created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(rowToMemo);
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
    'INSERT INTO memos (id, title, content, reminder_time, recurrence, completed, pinned, tags, reminders, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [memo.id, memo.title, memo.content || '', memo.reminderTime || null, memo.recurrence ? JSON.stringify(memo.recurrence) : null, memo.completed ? 1 : 0, memo.pinned ? 1 : 0, JSON.stringify(memo.tags || []), JSON.stringify(memo.reminders || []), memo.createdAt]
  );
  saveDb();
}

function updateMemoInDb(memo) {
  db.run(
    'UPDATE memos SET title = ?, content = ?, reminder_time = ?, recurrence = ?, completed = ?, pinned = ?, tags = ?, reminders = ? WHERE id = ?',
    [memo.title, memo.content || '', memo.reminderTime || null, memo.recurrence ? JSON.stringify(memo.recurrence) : null, memo.completed ? 1 : 0, memo.pinned ? 1 : 0, JSON.stringify(memo.tags || []), JSON.stringify(memo.reminders || []), memo.id]
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
    completed: row.completed === 1,
    pinned: row.pinned === 1,
    tags: row.tags ? JSON.parse(row.tags) : [],
    createdAt: row.created_at,
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
    } else {
      targetDate = getNextOccurrence(rem);
      if (!targetDate) return;
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

// ===== IPC 通信 =====
ipcMain.handle('get-memos', () => getAllMemos());

ipcMain.handle('search-memos', (_, keyword) => {
  const k = `%${keyword}%`;
  const stmt = db.prepare('SELECT * FROM memos WHERE title LIKE ? OR content LIKE ? ORDER BY pinned DESC, created_at DESC');
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

ipcMain.handle('add-memo', (_, memo) => {
  const newMemo = {
    id: uuidv4(),
    title: memo.title,
    content: memo.content || '',
    reminderTime: memo.reminderTime || null,
    recurrence: memo.recurrence || null,
    reminders: memo.reminders || [],
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
  deleteMemoFromDb(id);
  clearMemoTimers(id);
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

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
  // 设置 Dock 图标和应用名
  if (process.platform === 'darwin') {
    app.dock.setIcon(iconPath);
    app.setName('备忘录');
  }

  await initDatabase();

  createWindow();
  createTray();
  loadAllReminders();

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
