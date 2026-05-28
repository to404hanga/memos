/**
 * sherpa-onnx-node 类型声明
 *
 * 仅声明本项目使用到的 API 子集
 */
declare module 'sherpa-onnx-node' {
  interface Qwen3AsrModelConfig {
    convFrontend: string;
    encoder: string;
    decoder: string;
    tokenizer: string;
    maxTotalLen?: number;
    maxNewTokens?: number;
    temperature?: number;
    topP?: number;
    seed?: number;
  }

  interface OfflineModelConfig {
    qwen3Asr?: Qwen3AsrModelConfig;
    tokens?: string;
    numThreads?: number;
    provider?: string;
    debug?: boolean;
  }

  interface OfflineRecognizerConfig {
    modelConfig: OfflineModelConfig;
    decodingMethod?: 'greedy_search' | 'modified_beam_search';
    maxActivePaths?: number;
  }

  interface OfflineRecognizerResult {
    text: string;
    timestamps?: number[];
    tokens?: string[];
  }

  interface OfflineStream {
    acceptWaveform(params: { sampleRate: number; samples: Float32Array }): void;
    result: OfflineRecognizerResult;
  }

  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    free(): void;
  }
}
