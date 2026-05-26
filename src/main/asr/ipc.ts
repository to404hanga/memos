/**
 * ASR IPC 处理器
 *
 * 注册语音识别相关的 IPC 通信通道：
 * - asr:status    获取 ASR 引擎/模型状态
 * - asr:recognize 接收音频数据返回识别文本
 * - asr:preload   预加载模型到内存
 * - asr:download  下载模型文件（带进度事件）
 * - asr:cancel-download  取消模型下载
 * - asr:get-hotwords / asr:set-hotwords  热词配置
 * - asr:get-correction-map / asr:set-correction-map  纠错映射
 */
import { ipcMain, BrowserWindow, systemPreferences } from 'electron';
import * as path from 'path';
import { asrEngine } from './engine';
import { modelDownloader } from './downloader';
import { getSetting, setSetting } from '../database/settings.repo';

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

  // 开始录音（在隐藏窗口中，带 VAD 静音检测）
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
          window._silenceStart = 0;
          window._hasVoice = false;
          window._vadStopped = false;

          window._mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
              noiseSuppression: true,
              echoCancellation: true,
              autoGainControl: true
            } 
          });

          // 使用 AudioContext 实时提取 PCM 并发送给主进程
          window._vadCtx = new AudioContext({ sampleRate: 16000 });
          const source = window._vadCtx.createMediaStreamSource(window._mediaStream);
          
          // 创建 ScriptProcessorNode 来实时截取 PCM (兼容性好)
          window._processor = window._vadCtx.createScriptProcessor(4096, 1, 1);
          window._processor.onaudioprocess = (e) => {
            if (window._vadStopped) return;
            const inputData = e.inputBuffer.getChannelData(0);
            // 复制一份数据，通过 IPC 发送给主进程
            const pcm = new Float32Array(inputData);
            // 转换为 Uint8Array 确保 IPC 序列化正确
            require('electron').ipcRenderer.send('asr:audio-chunk', new Uint8Array(pcm.buffer));
          };

          window._vadAnalyser = window._vadCtx.createAnalyser();
          window._vadAnalyser.fftSize = 512;
          
          source.connect(window._vadAnalyser);
          window._vadAnalyser.connect(window._processor);
          window._processor.connect(window._vadCtx.destination);

          const bufferLength = window._vadAnalyser.fftSize;
          const dataArray = new Float32Array(bufferLength);

          window._vadInterval = setInterval(() => {
            if (window._vadStopped) return;
            window._vadAnalyser.getFloatTimeDomainData(dataArray);
            // 计算 RMS
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
              sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / bufferLength);

            if (rms > 0.01) {
              // 有声音
              window._hasVoice = true;
              window._silenceStart = 0;
            } else if (window._hasVoice) {
              // 静音中
              if (!window._silenceStart) {
                window._silenceStart = Date.now();
              } else if (Date.now() - window._silenceStart > 600) {
                // 静音超过 0.6 秒，触发分段
                window._hasVoice = false;
                window._silenceStart = 0;
                require('electron').ipcRenderer.send('asr:segment-end');
              }
            }
          }, 100);

          return true;
        })()
      `);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 检查 VAD 是否自动停止了
  ipcMain.handle('asr:check-vad-stopped', async () => {
    try {
      if (!recordWindow || recordWindow.isDestroyed()) return { stopped: false };
      const stopped = await recordWindow.webContents.executeJavaScript('!!window._vadStopped');
      return { stopped };
    } catch {
      return { stopped: false };
    }
  });

  // 停止录音并返回 PCM 数据
  ipcMain.handle('asr:stop-recording', async () => {
    try {
      if (recordWindow && !recordWindow.isDestroyed()) {
        recordWindow.webContents.executeJavaScript(`
          (function() {
            window._vadStopped = true;
            if (window._vadInterval) { clearInterval(window._vadInterval); window._vadInterval = null; }
            if (window._processor) { window._processor.disconnect(); window._processor = null; }
            if (window._vadCtx) { window._vadCtx.close().catch(() => {}); window._vadCtx = null; }
            if (window._mediaStream) {
              window._mediaStream.getTracks().forEach(t => t.stop());
              window._mediaStream = null;
            }
          })()
        `).catch(console.error);
      }

      // 立即执行 flushStream，不再等待 executeJavaScript 的 Promise 结果
      const text = await asrEngine.flushStream();
      if (text && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('asr:progress', { type: 'final', text, segmentId: Date.now().toString() });
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // 取消录音
  ipcMain.handle('asr:cancel-recording', async () => {
    try {
      const win = getRecordWindow();
      await win.webContents.executeJavaScript(`
        window._vadStopped = true;
        if (window._processor) { window._processor.disconnect(); window._processor = null; }
        if (window._vadInterval) { clearInterval(window._vadInterval); window._vadInterval = null; }
        if (window._vadCtx) { window._vadCtx.close().catch(() => {}); window._vadCtx = null; }
        if (window._mediaStream) { window._mediaStream.getTracks().forEach(t => t.stop()); window._mediaStream = null; }
      `);
      asrEngine.cancelStream();
      return { success: true };
    } catch (e) {
      return { success: true };
    }
  });

  // 接收实时音频块
  ipcMain.on('asr:audio-chunk', (event, rawData: Uint8Array) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 从 IPC 传过来的 Uint8Array/Buffer 还原为 Float32Array
      const pcm = new Float32Array(rawData.buffer, rawData.byteOffset, rawData.byteLength / 4);
      asrEngine.pushChunk(pcm).then((partialText) => {
        if (partialText) {
          mainWindow.webContents.send('asr:progress', { type: 'partial', text: partialText });
        }
      });
    }
  });

  // 处理 VAD 分段
  ipcMain.on('asr:segment-end', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const text = await asrEngine.flushStream();
      if (text) {
        mainWindow.webContents.send('asr:progress', { type: 'final', text, segmentId: Date.now().toString() });
      }
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

  // ASR 优化配置
  ipcMain.handle('asr:get-hotwords', () => getSetting('asr_hotwords'));
  ipcMain.handle('asr:set-hotwords', (_, hotwords: string) => {
    setSetting('asr_hotwords', hotwords);
    // 修改热词后，销毁当前引擎实例，以便下次使用时重新加载关键词文件
    asrEngine.destroy();
    return true;
  });

  ipcMain.handle('asr:get-correction-map', () => getSetting('asr_correction_map'));
  ipcMain.handle('asr:set-correction-map', (_, map: string) => {
    setSetting('asr_correction_map', map);
    return true;
  });
}
