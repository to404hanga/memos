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

// 模型下载源（tar.bz2 压缩包）
const MODEL_DOWNLOAD_URLS = [
  // GitHub Release（官方）
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2',
];

// 模型文件最小大小（字节），用于完整性校验
const MODEL_MIN_SIZES: Record<string, number> = {
  'conv_frontend.onnx': 30 * 1024 * 1024,     // > 30MB
  'encoder.int8.onnx': 100 * 1024 * 1024,     // > 100MB
  'decoder.int8.onnx': 500 * 1024 * 1024,     // > 500MB
  'tokens.txt': 1024,                           // > 1KB (备选 tokenizer)
};

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
   * 检查模型是否完整（文件存在 + 大小合理）
   */
  isModelComplete(): boolean {
    const modelDir = getModelDir();
    if (!fs.existsSync(modelDir)) return false;
    return MODEL_FILES.every(file => {
      const filePath = path.join(modelDir, file);
      if (!fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      const minSize = MODEL_MIN_SIZES[file] || 0;
      return stat.size >= minSize;
    });
  }

  /**
   * 删除不完整的模型文件（用于重新下载）
   */
  cleanIncomplete(): void {
    const modelDir = getModelDir();
    if (!fs.existsSync(modelDir)) return;
    for (const file of MODEL_FILES) {
      const filePath = path.join(modelDir, file);
      const tmpPath = filePath + '.tmp';
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
      // 删除大小不对的文件
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        const minSize = MODEL_MIN_SIZES[file] || 0;
        if (stat.size < minSize) {
          try { fs.unlinkSync(filePath); } catch {}
        }
      }
    }
  }

  /**
   * 下载模型（下载 tar.bz2 并解压）
   */
  async download(onProgress?: (progress: DownloadProgress) => void): Promise<void> {
    if (this.status === 'downloading') {
      throw new Error('下载正在进行中');
    }

    this.status = 'downloading';
    const modelDir = getModelDir();
    fs.mkdirSync(modelDir, { recursive: true });

    const tarPath = path.join(modelDir, 'model.tar.bz2');

    try {
      // 下载压缩包
      await this.downloadUrl(MODEL_DOWNLOAD_URLS[0], tarPath, (bytesDownloaded, totalBytes) => {
        const percent = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 90) : 0;
        onProgress?.({
          file: 'model.tar.bz2',
          fileIndex: 0,
          totalFiles: 1,
          bytesDownloaded,
          totalBytes,
          percent,
        });
      });

      // 解压 tar.bz2
      onProgress?.({ file: '解压中...', fileIndex: 0, totalFiles: 1, bytesDownloaded: 0, totalBytes: 0, percent: 92 });

      const { execSync } = require('child_process');
      execSync(`tar xjf "${tarPath}" -C "${modelDir}" --strip-components=1`, { timeout: 120000 });

      // 清理压缩包
      try { fs.unlinkSync(tarPath); } catch {}

      onProgress?.({ file: '完成', fileIndex: 0, totalFiles: 1, bytesDownloaded: 0, totalBytes: 0, percent: 100 });
      this.status = 'done';
    } catch (err) {
      this.status = 'error';
      try { fs.unlinkSync(tarPath); } catch {}
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
   * 下载文件（支持重定向）
   */
  private downloadUrl(
    url: string,
    destPath: string,
    onProgress: (downloaded: number, total: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const doRequest = (reqUrl: string, redirects: number) => {
        if (redirects > 5) {
          reject(new Error('Too many redirects'));
          return;
        }
        const client = reqUrl.startsWith('https') ? https : http;
        const req = client.get(reqUrl, { timeout: 30000 }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
            const location = res.headers.location;
            res.resume();
            if (location) {
              doRequest(location, redirects + 1);
            } else {
              reject(new Error('Redirect without location'));
            }
            return;
          }
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
          writeStream.on('error', (err) => {
            try { fs.unlinkSync(destPath); } catch {}
            reject(err);
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
      };
      doRequest(url, 0);
    });
  }
}

export const modelDownloader = new ModelDownloader();
