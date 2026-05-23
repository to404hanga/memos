/**
 * 企业微信 Webhook 推送模块
 *
 * 当备忘录提醒触发时，如果该备忘录配置了 Webhook，
 * 则向企业微信群机器人发送 Markdown 格式的通知消息。
 *
 * 功能：
 * - replaceWebhookVars: 模板变量替换（{{title}}/{{content}}/{{tags}}/{{time}}/{{id}}）
 * - sendWechatWebhook: 向企微 Webhook URL 发送 markdown_v2 格式消息
 * - sendWebhook: 主入口，检查 Webhook 配置后发送
 * - testWebhook: 测试发送功能（使用模拟数据验证 URL 是否可达）
 *
 * 消息格式使用企微的 markdown_v2 类型，支持标准 Markdown 语法。
 * 超时设置为 5 秒，失败时仅记录日志不抛异常（不影响提醒弹窗）。
 */
import { Memo } from '../database/memo.repo';

/**
 * Webhook URL 安全校验
 * 防止 SSRF：禁止访问内网地址，仅允许 HTTPS
 */
function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
  try {
    const u = new URL(url);
    // 仅允许 HTTPS
    if (u.protocol !== 'https:') {
      return { valid: false, error: '仅支持 HTTPS 协议' };
    }
    // 禁止 localhost 和内网 IP
    const hostname = u.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      hostname.endsWith('.local')
    ) {
      return { valid: false, error: '禁止访问内网地址' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'URL 格式无效' };
  }
}

export function replaceWebhookVars(template: string, memo: any, time: string): string {
  return template
    .replace(/\{\{title\}\}/g, memo.title || '')
    .replace(/\{\{content\}\}/g, memo.content || '')
    .replace(/\{\{tags\}\}/g, (memo.tags || []).join(', '))
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{id\}\}/g, memo.id || '');
}

function sendWechatWebhook(url: string, markdownContent: string): Promise<any> {
  // 安全校验
  const check = validateWebhookUrl(url);
  if (!check.valid) {
    console.error(`[Webhook] URL 校验失败: ${check.error}`);
    return Promise.resolve({ success: false, error: check.error });
  }

  const payload = JSON.stringify({
    msgtype: 'markdown_v2',
    markdown_v2: { content: markdownContent },
  });

  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === 'https:';
  const httpModule = isHttps ? require('https') : require('http');

  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? 443 : 80),
    path: urlObj.pathname + urlObj.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    timeout: 5000,
  };

  return new Promise((resolve) => {
    const req = httpModule.request(options, (res: any) => {
      let body = '';
      res.on('data', (chunk: any) => { body += chunk; });
      res.on('end', () => {
        console.log(`[Webhook] ${res.statusCode} - ${body.substring(0, 100)}`);
        resolve({ success: true, status: res.statusCode, body: body.substring(0, 200) });
      });
    });
    req.on('error', (err: any) => {
      console.error(`[Webhook] 失败: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
    req.on('timeout', () => {
      console.error(`[Webhook] 超时`);
      req.destroy();
      resolve({ success: false, error: '请求超时（5s）' });
    });
    req.write(payload);
    req.end();
  });
}

export async function sendWebhook(memo: Memo, reminderType: string): Promise<void> {
  const config = memo.webhook;
  if (!config || !config.enabled || !config.url || !config.content) return;

  const now = new Date().toISOString();
  const markdownContent = replaceWebhookVars(config.content, memo, now);
  const result = await sendWechatWebhook(config.url, markdownContent);
  if (result.success) {
    console.log(`[Webhook] 发送成功: "${memo.title}"`);
  } else {
    console.error(`[Webhook] 发送失败: "${memo.title}" - ${result.error}`);
  }
}

export async function testWebhook(url: string, contentTemplate: string, memoData: any): Promise<any> {
  const now = new Date().toISOString();
  const memo = {
    id: 'test-001',
    title: (memoData && memoData.title) || '测试提醒',
    content: (memoData && memoData.content) || '',
    tags: (memoData && memoData.tags) || [],
  };
  const markdownContent = replaceWebhookVars(contentTemplate || '# {{title}}', memo, now);
  return sendWechatWebhook(url, markdownContent);
}
