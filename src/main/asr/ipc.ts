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
import { ipcMain, BrowserWindow, systemPreferences } from 'electron';
import * as path from 'path';
import { asrEngine } from './engine';
import { modelDownloader } from './downloader';

// 隐藏录音窗口（渲染进程 getUserMedia 会 crash 主窗口，所以用独立窗口）
let recordWindow: BrowserWindow | null = null;

function getRecordWindow(): BrowserWindow {
  if (recordWindow && !recordWindow.isDestroyed()) return recordWindow;
  recordWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  });
  // 加载本地 file:// 页面以获得安全上下文（navigator.mediaDevices 需要）
  const htmlPath = path.join(__dirname, '..', '..', 'assets', 'recorder.html');
  recordWindow.loadFile(htmlPath);
  recordWindow.on('closed', () => { recordWindow = null; });
  return recordWindow;
}

export function registerAsrIpc(mainWindow: BrowserWindow | null): void {
  // 请求麦克风权限
  ipcMain.handle('asr:request-mic-permission', async () => {
    if (process.platform !== 'darwin') return { granted: true };
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') return { granted: true };
    if (status === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return { granted };
    }
    return { granted: false, status };
  });

  // 开始录音（在隐藏窗口中）
  ipcMain.handle('asr:start-recording', async () => {
    try {
      const win = getRecordWindow();
      // 等待页面加载完成
      if (win.webContents.isLoading()) {
        await new Promise<void>(resolve => win.webContents.once('did-finish-load', resolve));
      }
      await win.webContents.executeJavaScript(`
        (async () => {
          if (window._mediaStream) {
            window._mediaStream.getTracks().forEach(t => t.stop());
          }
          window._chunks = [];
          window._mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          window._recorder = new MediaRecorder(window._mediaStream);
          window._recorder.ondataavailable = (e) => {
            if (e.data.size > 0) window._chunks.push(e.data);
          };
          window._recorder.start(500);
          return true;
        })()
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 停止录音并返回 PCM 数据
  ipcMain.handle('asr:stop-recording', async () => {
    try {
      const win = getRecordWindow();
      const result = await win.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          if (!window._recorder || window._recorder.state === 'inactive') {
            resolve(null);
            return;
          }
          window._recorder.onstop = async () => {
            try {
              const blob = new Blob(window._chunks, { type: 'audio/webm' });
              window._chunks = [];
              if (window._mediaStream) {
                window._mediaStream.getTracks().forEach(t => t.stop());
                window._mediaStream = null;
              }
              const arrayBuf = await blob.arrayBuffer();
              // 解码为 PCM 16kHz
              const audioCtx = new OfflineAudioContext(1, 1, 16000);
              const decoded = await audioCtx.decodeAudioData(arrayBuf);
              const offCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
              const src = offCtx.createBufferSource();
              src.buffer = decoded;
              src.connect(offCtx.destination);
              src.start(0);
              const rendered = await offCtx.startRendering();
              const pcm = rendered.getChannelData(0);
              // 转为普通数组传回
              resolve(Array.from(pcm));
            } catch (e) {
              reject(e);
            }
          };
          window._recorder.stop();
        })
      `);

      if (!result) return { success: false, error: '无录音数据' };

      const samples = new Float32Array(result);
      const text = await asrEngine.recognize(samples, 16000);
      return { success: true, text };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 取消录音
  ipcMain.handle('asr:cancel-recording', async () => {
    try {
      const win = getRecordWindow();
      await win.webContents.executeJavaScript(`
        if (window._recorder && window._recorder.state !== 'inactive') window._recorder.stop();
        if (window._mediaStream) { window._mediaStream.getTracks().forEach(t => t.stop()); window._mediaStream = null; }
        window._chunks = [];
      `);
      return { success: true };
    } catch (e) {
      return { success: true };
    }
  });

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
