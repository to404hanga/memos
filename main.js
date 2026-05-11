const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');

const store = new Store({
  name: 'memos',
  defaults: { memos: [] },
});

let mainWindow = null;
let tray = null;
const activeTimers = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 400,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 优先加载构建产物，仅当 DEV_SERVER 环境变量存在时使用 dev server
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

function scheduleReminder(memo) {
  // 清除旧的定时器
  if (activeTimers.has(memo.id)) {
    clearTimeout(activeTimers.get(memo.id));
    activeTimers.delete(memo.id);
  }

  if (!memo.reminderTime || memo.completed) return;

  const reminderDate = new Date(memo.reminderTime);
  const now = new Date();
  const delay = reminderDate.getTime() - now.getTime();

  console.log(`[提醒] "${memo.title}" 计划于 ${reminderDate.toLocaleString()}，延迟 ${Math.round(delay / 1000)}s`);

  if (delay <= 0) {
    console.log(`[提醒] "${memo.title}" 已过期，跳过`);
    return;
  }

  const timer = setTimeout(() => {
    console.log(`[提醒] 触发: "${memo.title}"`);

    // 系统通知
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: '⏰ 备忘录提醒',
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

    // 同时通知渲染进程弹窗（作为后备提醒）
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
  }, delay);

  activeTimers.set(memo.id, timer);
}

function loadAllReminders() {
  const memos = store.get('memos', []);
  memos.forEach((memo) => scheduleReminder(memo));
}

// IPC 通信
ipcMain.handle('get-memos', () => {
  return store.get('memos', []);
});

ipcMain.handle('add-memo', (_, memo) => {
  const memos = store.get('memos', []);
  const newMemo = {
    id: uuidv4(),
    title: memo.title,
    content: memo.content || '',
    reminderTime: memo.reminderTime || null,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  memos.unshift(newMemo);
  store.set('memos', memos);
  scheduleReminder(newMemo);
  return newMemo;
});

ipcMain.handle('update-memo', (_, updatedMemo) => {
  const memos = store.get('memos', []);
  const index = memos.findIndex((m) => m.id === updatedMemo.id);
  if (index !== -1) {
    memos[index] = { ...memos[index], ...updatedMemo };
    store.set('memos', memos);
    scheduleReminder(memos[index]);
    return memos[index];
  }
  return null;
});

ipcMain.handle('delete-memo', (_, id) => {
  const memos = store.get('memos', []);
  const filtered = memos.filter((m) => m.id !== id);
  store.set('memos', filtered);
  if (activeTimers.has(id)) {
    clearTimeout(activeTimers.get(id));
    activeTimers.delete(id);
  }
  return true;
});

ipcMain.handle('toggle-complete', (_, id) => {
  const memos = store.get('memos', []);
  const index = memos.findIndex((m) => m.id === id);
  if (index !== -1) {
    memos[index].completed = !memos[index].completed;
    store.set('memos', memos);
    if (memos[index].completed && activeTimers.has(id)) {
      clearTimeout(activeTimers.get(id));
      activeTimers.delete(id);
    } else if (!memos[index].completed) {
      scheduleReminder(memos[index]);
    }
    return memos[index];
  }
  return null;
});

app.whenReady().then(() => {
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
});
