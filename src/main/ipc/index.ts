/**
 * IPC 注册入口
 *
 * 统一注册所有 Electron IPC 通信处理器。
 * 将 IPC 按职责拆分为三个子模块：
 * - memo.ipc: 备忘录 CRUD、图片/附件、标签、Webhook
 * - ai.ipc: AI Provider/Model 管理、流式/非流式对话、对话历史
 * - data.ipc: 数据导入导出（ZIP 格式）
 */
import { BrowserWindow } from 'electron';
import { registerMemoIpc } from './memo.ipc';
import { registerAiIpc } from './ai.ipc';
import { registerDataIpc } from './data.ipc';
import { registerAsrIpc } from '../asr';

export function registerAllIpc(mainWindow: BrowserWindow | null): void {
  registerMemoIpc(mainWindow);
  registerAiIpc(mainWindow);
  registerDataIpc(mainWindow);
  registerAsrIpc(mainWindow);
}
