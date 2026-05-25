/**
 * ASR 引擎 - sherpa-onnx Qwen3-ASR 封装
 *
 * 职责：
 * 1. 模型懒加载（首次识别时加载，避免启动延迟）
 * 2. 语音转文本核心 API
 * 3. 资源生命周期管理（空闲释放）
 */
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

let sherpa: typeof import('sherpa-onnx-node') | null = null;

export type AsrStatus = 'not_downloaded' | 'downloading' | 'loading' | 'ready' | 'error';

// 模型文件存放目录
function getModelDir(): string {
  return path.join(app.getPath('userData'), 'models', 'qwen3-asr-0.6b');
}

// 模型所需文件列表
const MODEL_FILES = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'tokens.txt',
];

class AsrEngine {
  private recognizer: any = null;
  private status: AsrStatus = 'not_downloaded';
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 分钟空闲后释放

  /**
   * 获取当前引擎状态
   */
  getStatus(): AsrStatus {
    if (this.recognizer) return 'ready';
    if (this.status === 'loading') return 'loading';
    if (this.status === 'downloading') return 'downloading';
    if (this.isModelAvailable()) return 'not_downloaded'; // 有模型但未加载 → 可用
    return this.status;
  }

  /**
   * 检查模型文件是否已下载完整
   */
  isModelAvailable(): boolean {
    const modelDir = getModelDir();
    if (!fs.existsSync(modelDir)) return false;
    return MODEL_FILES.every(file => fs.existsSync(path.join(modelDir, file)));
  }

  /**
   * 初始化/加载 ASR 引擎
   */
  async init(): Promise<void> {
    if (this.recognizer) return;
    if (!this.isModelAvailable()) {
      this.status = 'not_downloaded';
      throw new Error('ASR model files not found. Please download the model first.');
    }

    this.status = 'loading';
    try {
      // 动态导入 sherpa-onnx-node
      if (!sherpa) {
        sherpa = require('sherpa-onnx-node');
      }

      const modelDir = getModelDir();

      const config = {
        modelConfig: {
          qwen3Asr: {
            model: path.join(modelDir, 'encoder.int8.onnx'),
            decoder: path.join(modelDir, 'decoder.int8.onnx'),
          },
          tokens: path.join(modelDir, 'tokens.txt'),
          numThreads: 4,
          provider: 'cpu',
          debug: false,
        },
        decodingMethod: 'greedy_search',
      };

      this.recognizer = new sherpa!.OfflineRecognizer(config);
      this.status = 'ready';
      this.resetIdleTimer();
    } catch (err) {
      this.status = 'error';
      this.recognizer = null;
      throw err;
    }
  }

  /**
   * 识别音频数据
   * @param samples - PCM Float32 音频采样数据
   * @param sampleRate - 采样率（默认 16000）
   * @returns 识别文本
   */
  async recognize(samples: Float32Array, sampleRate: number = 16000): Promise<string> {
    if (!this.recognizer) {
      await this.init();
    }

    this.resetIdleTimer();

    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples });
    this.recognizer.decode(stream);
    const text = stream.result.text?.trim() || '';
    return text;
  }

  /**
   * 销毁引擎释放资源
   */
  destroy(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.recognizer) {
      this.recognizer.free?.();
      this.recognizer = null;
    }
    this.status = 'not_downloaded';
  }

  /**
   * 重置空闲计时器
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      console.log('[ASR] Idle timeout reached, releasing model resources.');
      this.destroy();
    }, this.IDLE_TIMEOUT);
  }
}

// 单例导出
export const asrEngine = new AsrEngine();
export { getModelDir, MODEL_FILES };
