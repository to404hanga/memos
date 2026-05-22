import { Memo } from '../database/memo.repo';

export function replaceWebhookVars(template: string, memo: any, time: string): string {
  return template
    .replace(/\{\{title\}\}/g, memo.title || '')
    .replace(/\{\{content\}\}/g, memo.content || '')
    .replace(/\{\{tags\}\}/g, (memo.tags || []).join(', '))
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{id\}\}/g, memo.id || '');
}

function sendWechatWebhook(url: string, markdownContent: string): Promise<any> {
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
