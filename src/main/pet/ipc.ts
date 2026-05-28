/**
 * 宠物相关 IPC 通信
 * 处理宠物窗口的拖拽、鼠标穿透、宠物列表/切换、显示/隐藏等操作
 */
import { ipcMain, BrowserWindow } from 'electron';
import { PetStateMachine } from './state';
import { getAllPets, getPetGifPath } from './pets';
import { getSetting, setSetting } from '../database/settings.repo';

export function registerPetIpc(petWindow: BrowserWindow, stateMachine: PetStateMachine): void {
  // 开始拖拽：取消鼠标穿透
  ipcMain.on('pet:start-drag', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(false);
    }
  });

  // 移动窗口
  ipcMain.on('pet:move-window', (_e, dx: number, dy: number) => {
    if (petWindow && !petWindow.isDestroyed()) {
      const [x, y] = petWindow.getPosition();
      petWindow.setPosition(x + dx, y + dy);
    }
  });

  // 结束拖拽：恢复鼠标穿透 + 保存位置
  ipcMain.on('pet:end-drag', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
      const [x, y] = petWindow.getPosition();
      stateMachine.setPosition(x, y);
      // 持久化位置
      setSetting('pet_position_x', String(x));
      setSetting('pet_position_y', String(y));
    }
  });

  // 设置鼠标穿透（宠物区域内外切换）
  ipcMain.on('pet:set-ignore-mouse', (_e, ignore: boolean, options?: { forward: boolean }) => {
    if (petWindow && !petWindow.isDestroyed()) {
      if (ignore) {
        petWindow.setIgnoreMouseEvents(true, options || { forward: true });
      } else {
        petWindow.setIgnoreMouseEvents(false);
      }
    }
  });

  // 获取宠物当前状态
  ipcMain.handle('pet:get-state', () => {
    return stateMachine.getState();
  });

  // 获取所有可用宠物列表
  ipcMain.handle('pet:get-pets', () => {
    return getAllPets().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      author: p.author,
      source: p.source,
    }));
  });

  // 切换当前宠物
  ipcMain.handle('pet:set-current-pet', (_e, petId: string) => {
    stateMachine.setCurrentPet(petId);
    setSetting('pet_current', petId);
    return { success: true };
  });

  // 获取宠物指定状态的 GIF 路径
  ipcMain.handle('pet:get-gif-path', (_e, petId: string, state: string) => {
    return getPetGifPath(petId, state);
  });

  // 显示/隐藏宠物
  ipcMain.handle('pet:set-visible', (_e, visible: boolean) => {
    stateMachine.setVisible(visible);
    setSetting('pet_visible', visible ? '1' : '0');
    if (petWindow && !petWindow.isDestroyed()) {
      if (visible) {
        petWindow.show();
      } else {
        petWindow.hide();
      }
    }
  });
}
