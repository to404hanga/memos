import { BrowserWindow } from 'electron';
import { registerMemoIpc } from './memo.ipc';
import { registerAiIpc } from './ai.ipc';
import { registerDataIpc } from './data.ipc';

export function registerAllIpc(mainWindow: BrowserWindow | null): void {
  registerMemoIpc(mainWindow);
  registerAiIpc(mainWindow);
  registerDataIpc(mainWindow);
}
