import { app, BrowserWindow, Tray, Menu, nativeImage, protocol, net } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { initDatabase, closeDatabase } from './database';
import { cleanupOldTrash, cleanupOldConversations } from './database/memo.repo';
import { registerAllIpc } from './ipc';
import { loadAllReminders } from './scheduler';
import { startCliServer } from './api-server';

// 必须在 ready 之前设置
app.name = '备忘录';
// 确保 userData 路径与旧版本一致（macOS: ~/Library/Application Support/备忘录）
const userDataPath = path.join(os.homedir(), 'Library', 'Application Support', '备忘录');
app.setPath('userData', userDataPath);

// 生成 CLI API Token（每次启动随机生成，写入文件供 CLI 读取）
const cliToken = crypto.randomBytes(16).toString('hex');
const tokenPath = path.join(userDataPath, '.cli-token');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');

// 注册自定义 protocol 处理本地文件访问
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } },
]);

function createWindow(): void {
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
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.DEV_SERVER) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault();
      mainWindow!.hide();
    }
  });
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  tray = new Tray(trayIcon);
  tray.setToolTip('备忘录');
  const contextMenu = Menu.buildFromTemplate([
    { label: '打开备忘录', click: () => mainWindow && mainWindow.show() },
    { type: 'separator' },
    { label: '退出', click: () => { (app as any).isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow && mainWindow.show());
}

app.whenReady().then(async () => {
  // 注册 local-file:// 协议处理本地文件（图片等）
  protocol.handle('local-file', (request) => {
    const filePath = decodeURIComponent(request.url.replace('local-file://', ''));
    return net.fetch('file://' + filePath);
  });

  // 写入 CLI token
  fs.writeFileSync(tokenPath, cliToken, { mode: 0o600 });

  if (process.platform === 'darwin') {
    app.dock.setIcon(iconPath);
    app.setName('备忘录');
  }

  await initDatabase();
  cleanupOldTrash();
  cleanupOldConversations();

  createWindow();
  createTray();

  registerAllIpc(mainWindow);
  loadAllReminders(mainWindow);
  startCliServer(mainWindow, cliToken);

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
  (app as any).isQuitting = true;
  closeDatabase();
});
