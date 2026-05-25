/**
 * ASR IPC 处理器
 *
 * 注册语音识别相关的 IPC 通信通道：
 * - asr:status    获取 ASR 引擎/模型状态
 * - asr:recognize 接收音频数据返回识别文本
 * - asr:preload   预加载模型到内存
 * - asr:download  下载模型文件（带进度事件）
 * - asr:cancel-download  取消模型下载
 */
import { ipcMain, BrowserWindow } from 'electron';
import { asrEngine } from './engine';
import { modelDownloader } from './downloader';

export function registerAsrIpc(mainWindow: BrowserWindow | null): void {
  // 获取 ASR 状态
  ipcMain.handle('asr:status', () => {
    if (modelDownloader.getStatus() === 'downloading') return 'downloading';
    if (asrEngine.isModelAvailable()) {
      return asrEngine.getStatus() === 'ready' ? 'ready' : 'idle';
    }
    return 'not_downloaded';
  });

  // 识别音频
  ipcMain.handle('asr:recognize', async (_, audioData: ArrayBuffer) => {
    try {
      const samples = new Float32Array(audioData);
      const text = await asrEngine.recognize(samples, 16000);
      return { success: true, text };
    } catch (err: any) {
      return { success: false, error: err.message || 'Recognition failed' };
    }
  });

  // 预加载模型
  ipcMain.handle('asr:preload', async () => {
    try {
      await asrEngine.init();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 下载模型
  ipcMain.handle('asr:download', async (event) => {
    try {
      await modelDownloader.download((progress) => {
        mainWindow?.webContents.send('asr:download-progress', progress);
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Download failed' };
    }
  });

  // 取消下载
  ipcMain.handle('asr:cancel-download', () => {
    modelDownloader.cancel();
    return { success: true };
  });
}
