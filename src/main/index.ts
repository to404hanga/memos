import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as os from 'os';
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

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');

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
      webSecurity: false,
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
  startCliServer(mainWindow);

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
