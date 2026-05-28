/**
 * 宠物模块入口
 * 负责创建 petWindow、初始化状态机、注册 IPC、监听应用事件
 * 从数据库恢复位置/宠物/可见性设置
 */
import { BrowserWindow, screen } from 'electron';
import { createPetWindow } from './window';
import { PetStateMachine } from './state';
import { registerPetIpc } from './ipc';
import { getDefaultPetId } from './pets';
import { PetRoaming } from './roaming';
import { getSetting } from '../database/settings.repo';

let petWindow: BrowserWindow | null = null;
let stateMachine: PetStateMachine | null = null;
let roaming: PetRoaming | null = null;

const PET_SIZE = { width: 200, height: 200 };

export function initPetModule(mainWindow: BrowserWindow | null): void {
  // 从数据库恢复设置
  const savedPet = getSetting('pet_current') || getDefaultPetId();
  const savedVisible = getSetting('pet_visible') !== '0'; // 默认可见
  const savedX = parseInt(getSetting('pet_position_x') || '-1', 10);
  const savedY = parseInt(getSetting('pet_position_y') || '-1', 10);
  const savedDisplayId = getSetting('pet_display_id');

  // 校验保存的屏幕是否仍然存在
  let restoreX = -1;
  let restoreY = -1;

  if (savedX >= 0 && savedY >= 0 && savedDisplayId) {
    const allDisplays = screen.getAllDisplays();
    const targetDisplay = allDisplays.find(d => String(d.id) === savedDisplayId);
    if (targetDisplay) {
      // 屏幕仍在，确保位置在该屏幕工作区内
      const wa = targetDisplay.workArea;
      restoreX = Math.max(wa.x, Math.min(savedX, wa.x + wa.width - PET_SIZE.width));
      restoreY = Math.max(wa.y, Math.min(savedY, wa.y + wa.height - PET_SIZE.height));
    }
    // 屏幕不在了，restoreX/Y 保持 -1，后面走默认位置
  }

  // 默认位置：主屏幕右下角
  if (restoreX < 0 || restoreY < 0) {
    const primary = screen.getPrimaryDisplay().workArea;
    restoreX = primary.x + primary.width - PET_SIZE.width - 40;
    restoreY = primary.y + primary.height - PET_SIZE.height - 40;
  }

  stateMachine = new PetStateMachine({
    visible: savedVisible,
    currentPet: savedPet,
    position: { x: restoreX, y: restoreY },
  });

  petWindow = createPetWindow();
  petWindow.setPosition(restoreX, restoreY);

  // 如果设置为不可见，启动后隐藏窗口
  if (!savedVisible) {
    petWindow.hide();
  }

  registerPetIpc(petWindow, stateMachine, mainWindow);

  // 状态变化时推送给宠物渲染进程
  stateMachine.onStateChange((state) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:state-update', state);
    }
  });

  // 启动随机漫游
  roaming = new PetRoaming(petWindow, stateMachine);
  roaming.start();

  // 窗口关闭时清理
  petWindow.on('closed', () => {
    if (roaming) roaming.stop();
    petWindow = null;
  });
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow;
}

export function getPetStateMachine(): PetStateMachine | null {
  return stateMachine;
}
