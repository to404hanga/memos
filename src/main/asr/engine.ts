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

function getModelDir(): string {
  return path.join(app.getPath('userData'), 'models', 'qwen3-asr-0.6b');
}

const MODEL_FILES = [
  'encoder.int8.onnx',
  'decoder.int8.onnx',
  'tokens.txt',
];

class AsrEngine {
  private recognizer: any = null;
  private status: AsrStatus = 'not_downloaded';
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000;

  getStatus(): AsrStatus {
    if (this.recognizer) return 'ready';
    if (this.status === 'loading') return 'loading';
    if (this.status === 'downloading') return 'downloading';
    return this.status;
  }

  isModelAvailable(): boolean {
    const modelDir = getModelDir();
    if (!fs.existsSync(modelDir)) return false;
    return MODEL_FILES.every(file => fs.existsSync(path.join(modelDir, file)));
  }

  async init(): Promise<void> {
    if (this.recognizer) return;
    if (!this.isModelAvailable()) {
      this.status = 'not_downloaded';
      throw new Error('ASR model files not found. Please download the model first.');
    }

    this.status = 'loading';
    try {
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

  async recognize(samples: Float32Array, sampleRate: number = 16000): Promise<string> {
    if (!this.recognizer) {
      await this.init();
    }
    this.resetIdleTimer();

    const stream = this.recognizer.createStream();
    stream.acceptWaveform({ sampleRate, samples });
    this.recognizer.decode(stream);
    return stream.result.text?.trim() || '';
  }

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

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.destroy();
    }, this.IDLE_TIMEOUT);
  }
}

export const asrEngine = new AsrEngine();
export { getModelDir, MODEL_FILES };
