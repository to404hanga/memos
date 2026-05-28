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
import { getSetting } from '../database/settings.repo';

// @ts-ignore
let sherpa: typeof import('sherpa-onnx-node') | null = null;

export type AsrStatus = 'not_downloaded' | 'downloading' | 'loading' | 'ready' | 'error';

function getModelDir(): string {
  return path.join(app.getPath('userData'), 'models', 'qwen3-asr-0.6b');
}

const MODEL_FILES = [
  'conv_frontend.onnx',
  'encoder.int8.onnx',
  'decoder.int8.onnx',
];

class AsrEngine {
  private recognizer: any = null;
  private status: AsrStatus = 'not_downloaded';
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000;

  // 流式缓冲
  private pcmBuffer: Float32Array = new Float32Array(0);
  private isStreaming: boolean = false;
  private lastDecodeTime: number = 0;

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
      
      // 处理热词/关键词
      let keywordsFile = '';
      const hotwords = getSetting('asr_hotwords');
      if (hotwords) {
        const keywordsPath = path.join(app.getPath('userData'), 'keywords.txt');
        // 将热词转换为 sherpa-onnx 格式 (每行一个词)
        const formattedKeywords = hotwords.split(/[,\n，]/).map(w => w.trim()).filter(Boolean).join('\n');
        if (formattedKeywords) {
          fs.writeFileSync(keywordsPath, formattedKeywords);
          keywordsFile = keywordsPath;
        }
      }

      const config: any = {
        modelConfig: {
          qwen3Asr: {
            convFrontend: path.join(modelDir, 'conv_frontend.onnx'),
            encoder: path.join(modelDir, 'encoder.int8.onnx'),
            decoder: path.join(modelDir, 'decoder.int8.onnx'),
            tokenizer: path.join(modelDir, 'tokenizer'),
          },
          numThreads: 4,
          provider: 'cpu',
          debug: false,
        },
      };

      if (keywordsFile) {
        config.modelConfig.keywordsFile = keywordsFile;
        config.modelConfig.keywordsScore = 1.5; // 默认权重系数
      }

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
    const result = this.recognizer.getResult(stream);
    stream.free?.();
    return result?.text?.trim() || '';
  }

  // --- 模拟流式识别接口 ---
  async pushChunk(chunk: Float32Array, sampleRate: number = 16000): Promise<string> {
    if (!this.recognizer) await this.init();
    this.resetIdleTimer();
    this.isStreaming = true;

    // 追加缓冲
    const newBuffer = new Float32Array(this.pcmBuffer.length + chunk.length);
    newBuffer.set(this.pcmBuffer);
    newBuffer.set(chunk, this.pcmBuffer.length);
    this.pcmBuffer = newBuffer;

    const now = Date.now();
    // 节流：每 500ms 至少执行一次 decode 返回 partial 结果
    if (now - this.lastDecodeTime > 500) {
      this.lastDecodeTime = now;
      return this.recognize(this.pcmBuffer, sampleRate);
    }
    return ''; // 未触发 decode
  }

  async flushStream(sampleRate: number = 16000): Promise<string> {
    if (!this.isStreaming || this.pcmBuffer.length === 0) return '';
    const text = await this.recognize(this.pcmBuffer, sampleRate);
    this.cancelStream();
    return text;
  }

  cancelStream(): void {
    this.pcmBuffer = new Float32Array(0);
    this.isStreaming = false;
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
    // 根据模型文件是否存在设置正确状态
    this.status = this.isModelAvailable() ? 'not_downloaded' : 'not_downloaded';
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
