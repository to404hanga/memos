/**
 * 企微 Webhook 配置子组件
 *
 * 负责 Webhook 的启用/禁用、URL 配置、消息模板编辑和发送测试。
 */
import React, { useState } from 'react';
import type { WebhookConfig } from '../../types/global';

interface Props {
  webhook: WebhookConfig;
  onWebhookChange: (webhook: WebhookConfig) => void;
  /** 当前表单的标题/内容/标签，用于测试发送 */
  memoData: { title: string; content: string; tags: string[] };
}

export default function WebhookConfigPanel({ webhook, onWebhookChange, memoData }: Props): React.ReactElement {
  const [testResult, setTestResult] = useState<string | null>(null);

  return (
    <div className="form-group">
      <div className="content-label-row">
        <label>企微 Webhook</label>
        <label className="switch">
          <input type="checkbox" checked={webhook.enabled} onChange={(e) => onWebhookChange({ ...webhook, enabled: e.target.checked })} />
          <span className="switch-slider" />
        </label>
      </div>
      {webhook.enabled && (
        <div className="webhook-fields">
          <input
            type="text"
            value={webhook.url}
            onChange={(e) => onWebhookChange({ ...webhook, url: e.target.value })}
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
          />
          <textarea
            className="webhook-body-input"
            value={webhook.content || ''}
            onChange={(e) => onWebhookChange({ ...webhook, content: e.target.value })}
            placeholder={'发送内容（Markdown 格式）\n可用变量: {{title}} {{content}} {{tags}} {{time}}'}
            rows={3}
          />
          <p className="webhook-hint">示例: # ⏰ {'{{title}}'}\n{'{{content}}'}\n&gt; 标签: {'{{tags}}'}</p>
          <div className="webhook-test-row">
            <button type="button" className="webhook-test-btn" onClick={async () => {
              if (!webhook.url) { setTestResult('❌ 请先填写 URL'); return; }
              if (!webhook.content) { setTestResult('❌ 请填写发送内容'); return; }
              setTestResult('⏳ 发送中...');
              const r = await window.api.testWebhook(webhook.url, webhook.content, memoData);
              setTestResult(r.success ? `✅ 成功 (HTTP ${r.status})` : `❌ ${r.error}`);
            }}>发送测试</button>
            {testResult && <span className="webhook-test-result">{testResult}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
