/**
 * 宠物相关 IPC 通信
 * 处理宠物窗口的拖拽、鼠标穿透、宠物列表/切换、显示/隐藏、
 * AI 对话框开关、Agent 状态联动等操作
 */
import { ipcMain, BrowserWindow, screen, dialog } from 'electron';
import { PetStateMachine, PetState } from './state';
import { getAllPets, getPetGifPath, PET_ACTIONS, importPetPack, deleteUserPet, getPetActions } from './pets';
import { setSetting } from '../database/settings.repo';
import { getMemoById, updateReminderTime, updateMemoInDb } from '../database/memo.repo';
import { reschedule } from '../scheduler';

const PET_WINDOW_NORMAL = { width: 200, height: 200 };
const PET_WINDOW_CHAT = { width: 420, height: 600 };

export function registerPetIpc(petWindow: BrowserWindow, stateMachine: PetStateMachine, mainWindow: BrowserWindow | null): void {
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

  // 结束拖拽：恢复鼠标穿透 + 保存位置 + 记录所在屏幕
  ipcMain.on('pet:end-drag', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
      const [x, y] = petWindow.getPosition();
      stateMachine.setPosition(x, y);
      setSetting('pet_position_x', String(x));
      setSetting('pet_position_y', String(y));
      const display = screen.getDisplayNearestPoint({ x, y });
      setSetting('pet_display_id', String(display.id));
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

  // ==================== 对话框开关（调整窗口大小） ====================

  ipcMain.on('pet:open-chat-dialog', (_e, size?: { width: number; height: number }) => {
    if (petWindow && !petWindow.isDestroyed()) {
      const target = size || PET_WINDOW_CHAT;
      const [x, y] = petWindow.getPosition();
      const dy = target.height - PET_WINDOW_NORMAL.height;
      const dx = (target.width - PET_WINDOW_NORMAL.width) / 2;
      petWindow.setBounds({
        x: Math.round(x - dx),
        y: y - dy,
        width: target.width,
        height: target.height,
      });
      petWindow.setIgnoreMouseEvents(false);
      petWindow.setFocusable(true);
      petWindow.focus();
    }
  });

  ipcMain.on('pet:close-chat-dialog', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      const [x, y] = petWindow.getPosition();
      const [curW, curH] = petWindow.getSize();
      // 用当前实际尺寸计算偏移，收缩回原始大小
      const dy = curH - PET_WINDOW_NORMAL.height;
      const dx = (curW - PET_WINDOW_NORMAL.width) / 2;
      petWindow.setBounds({
        x: Math.round(x + dx),
        y: y + dy,
        width: PET_WINDOW_NORMAL.width,
        height: PET_WINDOW_NORMAL.height,
      });
      petWindow.setFocusable(false);
      petWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  // ==================== Agent 状态联动 ====================

  ipcMain.on('pet:set-agent-state', (_e, state: string) => {
    const validStates: PetState[] = ['idle', 'ai_working', 'all_done', 'failed', 'review'];
    if (validStates.includes(state as PetState)) {
      stateMachine.transition(state as PetState);
    }
  });

  // 通知主窗口刷新备忘录列表
  ipcMain.on('pet:notify-memos-changed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memos-changed');
    }
  });

  // 延后提醒：将提醒时间推迟 N 分钟
  ipcMain.handle('pet:snooze-memo', (_e, memoId: string, minutes: number) => {
    const memo = getMemoById(memoId);
    if (!memo) return { success: false };

    const snoozeTime = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    // 更新 reminders 数组中的提醒时间（调度器实际读取的数据源）
    const reminders = [...(memo.reminders || [])];
    if (reminders.length > 0) {
      // 将第一个提醒改为延后时间
      reminders[0] = { ...reminders[0], type: 'once', time: snoozeTime };
      updateMemoInDb({ ...memo, reminders, reminderTime: snoozeTime });
    } else {
      // 没有 reminders 数组，直接更新 reminderTime
      updateReminderTime(memoId, snoozeTime);
    }

    reschedule();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memos-changed');
    }
    return { success: true };
  });

  // ==================== 基础状态查询 ====================

  ipcMain.handle('pet:get-state', () => {
    return stateMachine.getState();
  });

  ipcMain.handle('pet:get-pets', () => {
    return getAllPets().map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      author: p.author,
      source: p.source,
    }));
  });

  ipcMain.handle('pet:set-current-pet', (_e, petId: string) => {
    stateMachine.setCurrentPet(petId);
    setSetting('pet_current', petId);
    return { success: true };
  });

  ipcMain.handle('pet:get-gif-path', (_e, petId: string, state: string) => {
    return getPetGifPath(petId, state);
  });

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

  // ==================== 宠物导入管理 ====================

  // 获取标准动作列表
  ipcMain.handle('pet:get-actions', () => {
    return PET_ACTIONS;
  });

  // 选择 GIF 文件（打开文件对话框）
  ipcMain.handle('pet:select-gif', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 GIF 文件',
      filters: [{ name: 'GIF 图片', extensions: ['gif'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // 导入宠物包
  ipcMain.handle('pet:import', (_e, petName: string, actionMap: Record<string, string>) => {
    return importPetPack(petName, actionMap);
  });

  // 删除用户宠物
  ipcMain.handle('pet:delete', (_e, petId: string) => {
    return deleteUserPet(petId);
  });

  // 获取宠物的动作 GIF 状态
  ipcMain.handle('pet:get-pet-actions', (_e, petId: string) => {
    return getPetActions(petId);
  });
}
