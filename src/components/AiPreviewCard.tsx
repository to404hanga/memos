import React from 'react';
import type { AiCreateMemoArgs, MemoFormData } from '../../types/global';

interface Props {
  args: AiCreateMemoArgs;
  status: 'pending' | 'created' | 'editing';
  onConfirm: () => void;
  onEdit: () => void;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch { return iso; }
}

function describeRecurrence(rec?: AiCreateMemoArgs['recurrence']): string {
  if (!rec) return '';
  const h = String(rec.hour ?? 0).padStart(2, '0');
  const m = String(rec.minute ?? 0).padStart(2, '0');
  const time = `${h}:${m}`;
  switch (rec.type) {
    case 'daily': return `每天 ${time}`;
    case 'workday': return `工作日 ${time}`;
    case 'weekly': {
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return `每周${days[rec.dayOfWeek ?? 1]} ${time}`;
    }
    case 'monthly': return `每月 ${rec.dayOfMonth ?? 1} 日 ${time}`;
    default: return '';
  }
}

export function aiArgsToMemo(args: AiCreateMemoArgs): MemoFormData {
  const reminders: any[] = [];
  if (args.recurrence && args.recurrence.type !== 'once') {
    reminders.push(args.recurrence);
  } else if (args.reminderTime) {
    reminders.push({ type: 'once', time: args.reminderTime });
  }
  return {
    title: args.title,
    content: args.content || '',
    tags: args.tags || [],
    reminderTime: args.reminderTime || null,
    recurrence: args.recurrence || null,
    reminders,
  };
}

export default function AiPreviewCard({ args, status, onConfirm, onEdit }: Props): React.ReactElement {
  const recDesc = describeRecurrence(args.recurrence);
  return (
    <div className={`ai-preview-card status-${status}`}>
      <div className="ai-preview-header">
        <span className="ai-preview-tag">📌 待办预览</span>
        {status === 'created' && <span className="ai-preview-status ok">✓ 已创建</span>}
      </div>
      <div className="ai-preview-row">
        <span className="ai-preview-label">标题</span>
        <span className="ai-preview-value">{args.title}</span>
      </div>
      {args.content && (
        <div className="ai-preview-row">
          <span className="ai-preview-label">内容</span>
          <span className="ai-preview-value">{args.content}</span>
        </div>
      )}
      {args.reminderTime && !recDesc && (
        <div className="ai-preview-row">
          <span className="ai-preview-label">⏰ 提醒</span>
          <span className="ai-preview-value">{formatTime(args.reminderTime)}</span>
        </div>
      )}
      {recDesc && (
        <div className="ai-preview-row">
          <span className="ai-preview-label">🔁 周期</span>
          <span className="ai-preview-value">{recDesc}</span>
        </div>
      )}
      {args.tags && args.tags.length > 0 && (
        <div className="ai-preview-row">
          <span className="ai-preview-label">🏷️ 标签</span>
          <span className="ai-preview-value">
            {args.tags.map((t) => (
              <span key={t} className="tag-chip">{t}</span>
            ))}
          </span>
        </div>
      )}
      {status === 'pending' && (
        <div className="ai-preview-actions">
          <button className="btn-submit" onClick={onConfirm}>✓ 创建</button>
          <button className="btn-cancel" onClick={onEdit}>✏️ 修改</button>
        </div>
      )}
    </div>
  );
}
