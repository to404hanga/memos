/**
 * 宠物窗口管理
 * 创建透明、无边框、始终置顶的桌宠窗口
 */
import { BrowserWindow, screen } from 'electron';
import * as path from 'path';

const PET_SIZE = { width: 200, height: 200 };

export function createPetWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const petWindow = new BrowserWindow({
    width: PET_SIZE.width,
    height: PET_SIZE.height,
    x: screenWidth - PET_SIZE.width - 40,
    y: screenHeight - PET_SIZE.height - 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload-pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // macOS: 浮动面板层级 + 所有桌面可见
  if (process.platform === 'darwin') {
    petWindow.setAlwaysOnTop(true, 'floating');
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  }

  // 默认鼠标穿透（宠物渲染进程会动态切换）
  petWindow.setIgnoreMouseEvents(true, { forward: true });

  // 加载宠物渲染页面
  if (process.env.DEV_SERVER) {
    petWindow.loadURL('http://localhost:3001');
  } else {
    petWindow.loadFile(path.join(__dirname, '..', 'pet', 'index.html'));
  }

  return petWindow;
}
