/**
 * ASR 模型下载管理器
 *
 * 职责：
 * 1. 检查模型文件完整性
 * 2. 从远程下载模型文件（支持进度回调）
 * 3. 下载断点续传（TODO: 后续优化）
 */
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { getModelDir, MODEL_FILES } from './engine';

// 模型下载源（优先使用国内镜像）
const MODEL_BASE_URLS = [
  // HuggingFace 镜像
  'https://hf-mirror.com/k2-fsa/sherpa-onnx-qwen3-asr-0.6B-2026-03-25',
  // HuggingFace 原始
  'https://huggingface.co/k2-fsa/sherpa-onnx-qwen3-asr-0.6B-2026-03-25/resolve/main',
];

export type DownloadProgress = {
  file: string;
  fileIndex: number;
  totalFiles: number;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number; // 0-100 总进度
};

export type DownloadStatus = 'idle' | 'downloading' | 'done' | 'error';

class ModelDownloader {
  private status: DownloadStatus = 'idle';
  private abortController: AbortController | null = null;

  getStatus(): DownloadStatus {
    return this.status;
  }

  /**
   * 检查模型是否完整
   */
  isModelComplete(): boolean {
    const modelDir = getModelDir();
    if (!fs.existsSync(modelDir)) return false;
    return MODEL_FILES.every(file => fs.existsSync(path.join(modelDir, file)));
  }

  /**
   * 下载模型文件
   */
  async download(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    if (this.status === 'downloading') {
      throw new Error('Download already in progress');
    }

    this.status = 'downloading';
    const modelDir = getModelDir();

    // 确保目录存在
    fs.mkdirSync(modelDir, { recursive: true });

    try {
      for (let i = 0; i < MODEL_FILES.length; i++) {
        const file = MODEL_FILES[i];
        const filePath = path.join(modelDir, file);

        // 跳过已存在的文件
        if (fs.existsSync(filePath)) {
          onProgress?.({
            file,
            fileIndex: i,
            totalFiles: MODEL_FILES.length,
            bytesDownloaded: 0,
            totalBytes: 0,
            percent: Math.round(((i + 1) / MODEL_FILES.length) * 100),
          });
          continue;
        }

        await this.downloadFile(file, filePath, (bytesDownloaded, totalBytes) => {
          const fileProgress = totalBytes > 0 ? bytesDownloaded / totalBytes : 0;
          const overallPercent = Math.round(((i + fileProgress) / MODEL_FILES.length) * 100);
          onProgress?.({
            file,
            fileIndex: i,
            totalFiles: MODEL_FILES.length,
            bytesDownloaded,
            totalBytes,
            percent: overallPercent,
          });
        });
      }

      this.status = 'done';
    } catch (err) {
      this.status = 'error';
      throw err;
    }
  }

  /**
   * 取消下载
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.status = 'idle';
  }

  /**
   * 下载单个文件
   */
  private downloadFile(
    fileName: string,
    destPath: string,
    onProgress: (downloaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tryUrl = (urlIndex: number) => {
        if (urlIndex >= MODEL_BASE_URLS.length) {
          reject(new Error(`Failed to download ${fileName} from all sources`));
          return;
        }

        const url = `${MODEL_BASE_URLS[urlIndex]}/${fileName}`;
        const client = url.startsWith('https') ? https : http;
        const tmpPath = destPath + '.tmp';

        const req = client.get(url, { timeout: 30000 }, (res) => {
          // 处理重定向
          if (res.statusCode === 301 || res.statusCode === 302) {
            const redirectUrl = res.headers.location;
            if (redirectUrl) {
              this.downloadFromUrl(redirectUrl, tmpPath, onProgress)
                .then(() => {
                  fs.renameSync(tmpPath, destPath);
                  resolve();
                })
                .catch(() => tryUrl(urlIndex + 1));
              return;
            }
          }

          if (res.statusCode !== 200) {
            res.resume();
            tryUrl(urlIndex + 1);
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          const writeStream = fs.createWriteStream(tmpPath);
          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            onProgress(downloaded, totalBytes);
          });
          res.pipe(writeStream);

          writeStream.on('finish', () => {
            fs.renameSync(tmpPath, destPath);
            resolve();
          });

          writeStream.on('error', () => {
            try { fs.unlinkSync(tmpPath); } catch {}
            tryUrl(urlIndex + 1);
          });
        });

        req.on('error', () => tryUrl(urlIndex + 1));
        req.on('timeout', () => {
          req.destroy();
          tryUrl(urlIndex + 1);
        });
      };

      tryUrl(0);
    });
  }

  /**
   * 从指定 URL 下载
   */
  private downloadFromUrl(
    url: string,
    destPath: string,
    onProgress: (downloaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 60000 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;

        const writeStream = fs.createWriteStream(destPath);
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          onProgress(downloaded, totalBytes);
        });
        res.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }
}

export const modelDownloader = new ModelDownloader();
