const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');

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
      created_at TEXT NOT NULL
    )
  `);

  saveDb();
  console.log(`[DB] SQLite 已初始化: ${dbPath}`);
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// ===== 数据库操作封装 =====
function getAllMemos() {
  const stmt = db.prepare('SELECT * FROM memos ORDER BY created_at DESC');
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
    'INSERT INTO memos (id, title, content, reminder_time, recurrence, completed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [memo.id, memo.title, memo.content || '', memo.reminderTime || null, memo.recurrence ? JSON.stringify(memo.recurrence) : null, memo.completed ? 1 : 0, memo.createdAt]
  );
  saveDb();
}

function updateMemoInDb(memo) {
  db.run(
    'UPDATE memos SET title = ?, content = ?, reminder_time = ?, recurrence = ?, completed = ? WHERE id = ?',
    [memo.title, memo.content || '', memo.reminderTime || null, memo.recurrence ? JSON.stringify(memo.recurrence) : null, memo.completed ? 1 : 0, memo.id]
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
    completed: row.completed === 1,
    createdAt: row.created_at,
  };
}

// ===== 窗口 & 托盘 =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1188,
    minWidth: 600,
    minHeight: 420,
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
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle('📝');
  tray.setToolTip('备忘录提醒');
  const contextMenu = Menu.buildFromTemplate([
    { label: '打开备忘录', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow && mainWindow.show());
}

// ===== 提醒调度 =====
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

function scheduleReminder(memo) {
  if (activeTimers.has(memo.id)) {
    clearTimeout(activeTimers.get(memo.id));
    activeTimers.delete(memo.id);
  }

  if (memo.completed) return;

  let targetDate;

  if (memo.recurrence && memo.recurrence.type !== 'once') {
    targetDate = getNextOccurrence(memo.recurrence);
    if (!targetDate) return;
    updateReminderTime(memo.id, targetDate.toISOString());
  } else {
    if (!memo.reminderTime) return;
    targetDate = new Date(memo.reminderTime);
  }

  const now = new Date();
  const delay = targetDate.getTime() - now.getTime();

  console.log(`[提醒] "${memo.title}" 计划于 ${targetDate.toLocaleString()}，延迟 ${Math.round(delay / 1000)}s${memo.recurrence && memo.recurrence.type !== 'once' ? ` (${memo.recurrence.type})` : ''}`);

  if (delay <= 0) {
    console.log(`[提醒] "${memo.title}" 已过期，跳过`);
    return;
  }

  const timer = setTimeout(() => {
    console.log(`[提醒] 触发: "${memo.title}"`);

    if (Notification.isSupported()) {
      const recLabel = memo.recurrence && memo.recurrence.type !== 'once' ? ' 🔁' : '';
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

    activeTimers.delete(memo.id);

    if (memo.recurrence && memo.recurrence.type !== 'once') {
      const freshMemo = getMemoById(memo.id);
      if (freshMemo && !freshMemo.completed) {
        scheduleReminder(freshMemo);
      }
    }
  }, delay);

  activeTimers.set(memo.id, timer);
}

function loadAllReminders() {
  const memos = getAllMemos();
  memos.forEach((memo) => scheduleReminder(memo));
}

// ===== IPC 通信 =====
ipcMain.handle('get-memos', () => getAllMemos());

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
    completed: false,
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
  if (activeTimers.has(id)) {
    clearTimeout(activeTimers.get(id));
    activeTimers.delete(id);
  }
  return true;
});

ipcMain.handle('toggle-complete', (_, id) => {
  const memo = getMemoById(id);
  if (!memo) return null;
  memo.completed = !memo.completed;
  updateMemoInDb(memo);
  if (memo.completed && activeTimers.has(id)) {
    clearTimeout(activeTimers.get(id));
    activeTimers.delete(id);
  } else if (!memo.completed) {
    scheduleReminder(memo);
  }
  return memo;
});

// ===== 应用生命周期 =====
app.whenReady().then(async () => {
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
