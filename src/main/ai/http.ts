/**
 * HTTP 请求工具函数
 *
 * 提供两种 HTTP 请求方式，均基于 Node.js 原生 http/https 模块（不依赖第三方库）：
 *
 * 1. httpJson - 普通 JSON 请求
 *    - 发送 JSON 请求体，等待完整响应后返回解析后的数据
 *    - 自动处理 HTTP 错误码（非 2xx 抛出 Error）
 *    - 支持超时设置
 *
 * 2. httpStream - 流式请求（SSE / NDJSON）
 *    - 发送请求后逐行读取响应流
 *    - 每收到一行通过 onLine 回调推送给调用方
 *    - 内部维护行缓冲区，正确处理跨 chunk 的行分割
 *    - 用于 AI 流式对话响应
 *
 * 辅助工具：
 * - joinUrl: URL 路径拼接
 * - safeJsonParse: 安全 JSON 解析（解析失败返回 null 而非抛异常）
 */

export function httpJson({ url, method = 'POST', headers = {}, body, timeoutMs = 30000 }: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    let urlObj: URL;
    try { urlObj = new URL(url); } catch (e) { return reject(new Error(`无效的 URL: ${url}`)); }
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? require('https') : require('http');
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = httpModule.request(options, (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
          catch (e) { resolve({ status: res.statusCode, data: text }); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${text.substring(0, 300)}`));
        }
      });
    });
    req.on('error', (err: Error) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error(`请求超时（${timeoutMs / 1000}s）`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

export function httpStream({ url, method = 'POST', headers = {}, body, timeoutMs = 60000, onLine }: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
  onLine?: (line: string) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    let urlObj: URL;
    try { urlObj = new URL(url); } catch (e) { return reject(new Error(`无效的 URL: ${url}`)); }
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? require('https') : require('http');
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = httpModule.request(options, (res: any) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf-8').substring(0, 300)}`)));
        return;
      }
      let buffer = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          try { onLine && onLine(line); }
          catch (e) { console.error('[stream] line handler error:', e); }
        }
      });
      res.on('end', () => {
        if (buffer) {
          try { onLine && onLine(buffer); } catch (e) {}
        }
        resolve();
      });
      res.on('error', (err: Error) => reject(err));
    });
    req.on('error', (err: Error) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error(`请求超时（${timeoutMs / 1000}s）`)); });
    if (payload) req.write(payload);
    req.end();
  });
}

export function joinUrl(base: string, urlPath: string): string {
  return base.replace(/\/+$/, '') + urlPath;
}

export function safeJsonParse(s: any): any {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch (e) { return null; }
}
