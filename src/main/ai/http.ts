// HTTP 请求工具函数

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
