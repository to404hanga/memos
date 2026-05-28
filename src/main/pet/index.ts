/**
 * 宠物模块入口
 * 负责创建 petWindow、初始化状态机、注册 IPC、监听应用事件
 * 从数据库恢复位置/宠物/可见性设置
 */
import { BrowserWindow } from 'electron';
import { createPetWindow } from './window';
import { PetStateMachine } from './state';
import { registerPetIpc } from './ipc';
import { getDefaultPetId } from './pets';
import { getSetting } from '../database/settings.repo';

let petWindow: BrowserWindow | null = null;
let stateMachine: PetStateMachine | null = null;

export function initPetModule(): void {
  // 从数据库恢复设置
  const savedPet = getSetting('pet_current') || getDefaultPetId();
  const savedVisible = getSetting('pet_visible') !== '0'; // 默认可见
  const savedX = parseInt(getSetting('pet_position_x') || '-1', 10);
  const savedY = parseInt(getSetting('pet_position_y') || '-1', 10);

  stateMachine = new PetStateMachine({
    visible: savedVisible,
    currentPet: savedPet,
    position: { x: savedX, y: savedY },
  });

  petWindow = createPetWindow();

  // 恢复保存的位置
  if (savedX >= 0 && savedY >= 0) {
    petWindow.setPosition(savedX, savedY);
  }

  // 如果设置为不可见，启动后隐藏窗口
  if (!savedVisible) {
    petWindow.hide();
  }

  registerPetIpc(petWindow, stateMachine);

  // 状态变化时推送给宠物渲染进程
  stateMachine.onStateChange((state) => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:state-update', state);
    }
  });

  // 窗口关闭时清理
  petWindow.on('closed', () => {
    petWindow = null;
  });
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow;
}

export function getPetStateMachine(): PetStateMachine | null {
  return stateMachine;
}
