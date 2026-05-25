/**
 * ASR 模块入口
 *
 * 聚合导出语音识别相关功能：
 * - engine: ASR 推理引擎
 * - downloader: 模型下载管理
 * - ipc: IPC 通道注册
 */
export { asrEngine, AsrStatus } from './engine';
export { modelDownloader, DownloadProgress } from './downloader';
export { registerAsrIpc } from './ipc';
