const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
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

function initMockData() {
  const memos = store.get('memos', []);
  if (memos.length > 0) return; // 已有数据则跳过

  const now = new Date();
  const h = (hours) => new Date(now.getTime() + hours * 3600000).toISOString();
  const d = (days, hour = 10) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  const mockMemos = [
    {
      id: uuidv4(),
      title: '团队周会',
      content: '## 议程\n\n- **项目进度**回顾\n- 技术难点讨论\n- 下周 `Sprint` 计划\n\n> 记得准备演示文稿',
      reminderTime: h(0.5),
      completed: false,
      createdAt: h(-2),
    },
    {
      id: uuidv4(),
      title: '提交周报',
      content: '汇总本周工作内容，发送给主管\n\n### 要点\n1. 完成了登录模块重构\n2. 修复了 **3 个** 线上 Bug\n3. 编写单元测试 `coverage > 80%`',
      reminderTime: h(1.5),
      completed: false,
      createdAt: h(-5),
    },
    {
      id: uuidv4(),
      title: '回复客户邮件',
      content: '关于 V2.0 版本需求确认\n\n- [ ] 用户权限管理\n- [ ] 数据导出功能\n- [x] 多语言支持',
      reminderTime: h(-1),
      completed: false,
      createdAt: h(-24),
    },
    {
      id: uuidv4(),
      title: '代码审查',
      content: '审查小王提交的登录模块 PR\n\n关注点：\n- 安全性：*SQL注入*防护\n- 性能：接口响应时间\n- 代码规范',
      reminderTime: d(1, 10),
      completed: false,
      createdAt: h(-3),
    },
    {
      id: uuidv4(),
      title: '预约牙医',
      content: '下午 3 点，记得带**医保卡**',
      reminderTime: d(1, 15),
      completed: false,
      createdAt: h(-48),
    },
    {
      id: uuidv4(),
      title: '准备技术分享 PPT',
      content: '## 微服务架构实践\n\n### 大纲\n1. 为什么选择微服务\n2. 服务拆分策略\n3. `gRPC` vs `REST`\n4. 监控与可观测性\n\n参考：[Martin Fowler](https://martinfowler.com/microservices/)',
      reminderTime: d(2, 9),
      completed: false,
      createdAt: h(-10),
    },
    {
      id: uuidv4(),
      title: '健身',
      content: '腿部训练日 💪',
      reminderTime: d(2, 18),
      completed: false,
      createdAt: h(-1),
    },
    {
      id: uuidv4(),
      title: '缴纳水电费',
      content: '',
      reminderTime: d(5, 12),
      completed: false,
      createdAt: h(-72),
    },
    {
      id: uuidv4(),
      title: '买生日礼物',
      content: '小李下周五生日\n\n备选：\n- 机械键盘 ⌨️\n- 技术书籍 📚\n- 咖啡礼盒 ☕',
      reminderTime: d(7, 11),
      completed: false,
      createdAt: h(-24),
    },
    {
      id: uuidv4(),
      title: '整理书签收藏',
      content: '',
      reminderTime: null,
      completed: false,
      createdAt: h(-100),
    },
    {
      id: uuidv4(),
      title: '更新项目文档',
      content: 'API 接口文档需要补充新增的 **5** 个端点',
      reminderTime: h(-24),
      completed: true,
      createdAt: h(-72),
    },
    {
      id: uuidv4(),
      title: '修复登录页 Bug',
      content: '验证码输入框在 Safari 上无法聚焦\n\n```css\ninput:focus { outline: none; }\n```',
      reminderTime: h(-48),
      completed: true,
      createdAt: h(-96),
    },
  ];

  store.set('memos', mockMemos);
  console.log(`[Mock] 已插入 ${mockMemos.length} 条示例数据`);
}

// IPC 通信
ipcMain.handle('get-memos', () => {
  return store.get('memos', []);
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

  // 存储到应用数据目录下的 images 文件夹
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
  // 清除旧数据，重新插入 mock 数据以便预览
  store.set('memos', []);
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
});
