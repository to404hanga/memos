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
  // 拖拽时的运动方向（'running_left' | 'running_right' | null）
  let dragRunState: PetState | null = null;

  // 开始拖拽：取消鼠标穿透
  ipcMain.on('pet:start-drag', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.setIgnoreMouseEvents(false);
    }
    dragRunState = null;
  });

  // 移动窗口
  ipcMain.on('pet:move-window', (_e, dx: number, dy: number) => {
    if (petWindow && !petWindow.isDestroyed()) {
      const [x, y] = petWindow.getPosition();
      petWindow.setPosition(x + dx, y + dy);

      // 根据水平运动分量播放运动动画（纯垂直拖动保持当前方向）
      let nextRunState: PetState | null = null;
      if (dx < 0) nextRunState = 'running_left';
      else if (dx > 0) nextRunState = 'running_right';

      if (nextRunState && nextRunState !== dragRunState) {
        dragRunState = nextRunState;
        stateMachine.transition(nextRunState);
      }
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

    // 拖拽结束：若处于拖拽运动状态，回到 idle
    if (dragRunState) {
      dragRunState = null;
      if (stateMachine.getState().currentState.startsWith('running_')) {
        stateMachine.transition('idle');
      }
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

  // 记录扩展前的宠物位置，关闭时精确恢复
  let petPosBeforeExpand: { x: number; y: number } | null = null;

  ipcMain.on('pet:open-chat-dialog', (_e, size?: { width: number; height: number }) => {
    if (petWindow && !petWindow.isDestroyed()) {
      const target = size || PET_WINDOW_CHAT;
      const [px, py] = petWindow.getPosition();

      // 记录扩展前宠物位置
      petPosBeforeExpand = { x: px, y: py };

      // 获取宠物当前所在屏幕的工作区
      const display = screen.getDisplayNearestPoint({ x: px + PET_WINDOW_NORMAL.width / 2, y: py + PET_WINDOW_NORMAL.height / 2 });
      const wa = display.workArea;

      // 宠物图片（120x120）在正常窗口（200x200）中的屏幕绝对位置：
      // 水平：居中 → 宠物中心 X = px + 100
      // 垂直：flex-end → 宠物中心 Y = py + 200 - 60 = py + 140
      const PET_IMG = 120;
      const petScreenCenterX = px + PET_WINDOW_NORMAL.width / 2;
      const petScreenCenterY = py + PET_WINDOW_NORMAL.height - PET_IMG / 2;

      // 判断方向
      const screenCenterY = wa.y + wa.height / 2;
      const petAtBottom = petScreenCenterY > screenCenterY;

      // 水平：以宠物中心为锚点
      let newX = petScreenCenterX - target.width / 2;

      // 垂直：确保宠物图片位置不变
      let newY: number;
      if (petAtBottom) {
        // 宠物在窗口底部：宠物中心 = newY + targetH - PET_IMG/2
        newY = petScreenCenterY + PET_IMG / 2 - target.height;
      } else {
        // 宠物在窗口顶部：宠物中心 = newY + PET_IMG/2
        newY = petScreenCenterY - PET_IMG / 2;
      }

      // 垂直方向确保不超出屏幕
      newY = Math.max(wa.y, Math.min(newY, wa.y + wa.height - target.height));
      // 水平方向确保不超出屏幕
      newX = Math.max(wa.x, Math.min(newX, wa.x + wa.width - target.width));

      // 计算宠物图片在新窗口中的水平偏移（让宠物视觉不动）
      // 宠物中心在新窗口中的相对 X = petScreenCenterX - newX
      const petOffsetX = petScreenCenterX - newX - target.width / 2;

      petWindow.setBounds({
        x: Math.round(newX),
        y: Math.round(newY),
        width: target.width,
        height: target.height,
      });
      petWindow.setIgnoreMouseEvents(false);
      petWindow.setFocusable(true);
      petWindow.focus();

      // 通知渲染进程宠物布局信息
      expandLayout = { petAtBottom, petOffsetX };
      petWindow.webContents.send('pet:layout-direction', { petAtBottom, petOffsetX });
    }
  });

  // 记录展开时的布局参数
  let expandLayout: { petAtBottom: boolean; petOffsetX: number } | null = null;

  ipcMain.on('pet:close-chat-dialog', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      const [wx, wy] = petWindow.getPosition();
      const [curW, curH] = petWindow.getSize();
      const PET_IMG = 120;

      // 根据当前窗口位置 + 布局信息，反算宠物的屏幕位置
      let petX: number;
      let petY: number;

      if (expandLayout) {
        // 宠物中心 X = wx + curW/2 + petOffsetX
        const petCenterX = wx + curW / 2 + expandLayout.petOffsetX;
        petX = petCenterX - PET_WINDOW_NORMAL.width / 2;

        if (expandLayout.petAtBottom) {
          // 宠物底边 = wy + curH
          petY = wy + curH - PET_WINDOW_NORMAL.height;
        } else {
          // 宠物顶边 = wy
          petY = wy;
        }
      } else {
        // fallback
        petX = wx + (curW - PET_WINDOW_NORMAL.width) / 2;
        petY = wy + curH - PET_WINDOW_NORMAL.height;
      }

      petWindow.setBounds({
        x: Math.round(petX),
        y: Math.round(petY),
        width: PET_WINDOW_NORMAL.width,
        height: PET_WINDOW_NORMAL.height,
      });

      petPosBeforeExpand = null;
      expandLayout = null;
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
