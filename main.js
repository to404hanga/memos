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

function getMemoCount() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM memos');
  stmt.step();
  const count = stmt.getAsObject().count;
  stmt.free();
  return count;
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

// ===== Mock 数据 =====
function initMockData() {
  if (getMemoCount() > 0) return;

  const now = new Date();
  const h = (hours) => new Date(now.getTime() + hours * 3600000).toISOString();
  const d = (days, hour = 10) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  const mockMemos = [
    { id: uuidv4(), title: '团队周会', content: '## 议程\n\n- **项目进度**回顾\n- 技术难点讨论\n- 下周 `Sprint` 计划\n\n> 记得准备演示文稿', reminderTime: null, recurrence: { type: 'weekly', dayOfWeek: 1, hour: 10, minute: 0 }, completed: false, createdAt: h(-2) },
    { id: uuidv4(), title: '提交周报', content: '汇总本周工作内容，发送给主管\n\n### 要点\n1. 完成了登录模块重构\n2. 修复了 **3 个** 线上 Bug\n3. 编写单元测试 `coverage > 80%`', reminderTime: h(1.5), recurrence: null, completed: false, createdAt: h(-5) },
    { id: uuidv4(), title: '回复客户邮件', content: '关于 V2.0 版本需求确认\n\n- [ ] 用户权限管理\n- [ ] 数据导出功能\n- [x] 多语言支持', reminderTime: h(-1), recurrence: null, completed: false, createdAt: h(-24) },
    { id: uuidv4(), title: '代码审查', content: '审查小王提交的登录模块 PR\n\n关注点：\n- 安全性：*SQL注入*防护\n- 性能：接口响应时间\n- 代码规范', reminderTime: d(1, 10), recurrence: null, completed: false, createdAt: h(-3) },
    { id: uuidv4(), title: '预约牙医', content: '下午 3 点，记得带**医保卡**', reminderTime: d(1, 15), recurrence: null, completed: false, createdAt: h(-48) },
    { id: uuidv4(), title: '准备技术分享 PPT', content: '## 微服务架构实践\n\n### 大纲\n1. 为什么选择微服务\n2. 服务拆分策略\n3. `gRPC` vs `REST`\n4. 监控与可观测性\n\n参考：[Martin Fowler](https://martinfowler.com/microservices/)', reminderTime: d(2, 9), recurrence: null, completed: false, createdAt: h(-10) },
    { id: uuidv4(), title: '健身', content: '腿部训练日 💪', reminderTime: null, recurrence: { type: 'weekly', dayOfWeek: 3, hour: 18, minute: 0 }, completed: false, createdAt: h(-1) },
    { id: uuidv4(), title: '缴纳水电费', content: '', reminderTime: null, recurrence: { type: 'monthly', dayOfMonth: 5, hour: 10, minute: 0 }, completed: false, createdAt: h(-72) },
    { id: uuidv4(), title: '买生日礼物', content: '小李下周五生日\n\n备选：\n- 机械键盘 ⌨️\n- 技术书籍 📚\n- 咖啡礼盒 ☕', reminderTime: d(7, 11), recurrence: null, completed: false, createdAt: h(-24) },
    { id: uuidv4(), title: '整理书签收藏', content: '', reminderTime: null, recurrence: null, completed: false, createdAt: h(-100) },
    { id: uuidv4(), title: '更新项目文档', content: 'API 接口文档需要补充新增的 **5** 个端点', reminderTime: h(-24), recurrence: null, completed: true, createdAt: h(-72) },
    { id: uuidv4(), title: '修复登录页 Bug', content: '验证码输入框在 Safari 上无法聚焦\n\n```css\ninput:focus { outline: none; }\n```', reminderTime: h(-48), recurrence: null, completed: true, createdAt: h(-96) },
  ];

  mockMemos.forEach((m) => insertMemo(m));
  console.log(`[Mock] 已插入 ${mockMemos.length} 条示例数据`);
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
  initMockData();

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
