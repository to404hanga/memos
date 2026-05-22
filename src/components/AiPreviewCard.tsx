/**
 * AI 创建备忘录预览卡片组件
 *
 * 当 AI 通过 create_memo 工具调用请求创建备忘录时，
 * 该组件以卡片形式展示待创建备忘录的详细信息：
 * - 标题、内容、提醒时间、周期配置、标签、静默期
 * - 支持两种操作：直接确认创建 / 进入表单编辑
 * - 显示创建状态：待确认(pending) / 已创建(created) / 编辑中(editing)
 *
 * 同时导出 aiArgsToMemo 工具函数，用于将 AI 工具调用参数转换为表单数据。
 */
import React from 'react';
import type { AiCreateMemoArgs, MemoFormData } from '../../types/global';

interface Props {
  /** AI create_memo 工具的参数 */
  args: AiCreateMemoArgs;
  /** 当前操作状态 */
  status: 'pending' | 'created' | 'editing';
  /** 确认创建回调 */
  onConfirm: () => void;
  /** 跳转编辑回调 */
  onEdit: () => void;
}

/** 格式化 ISO 时间字符串为中文本地化格式 */
function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch { return iso; }
}

/** 将周期提醒配置转换为人类可读的中文描述 */
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

/**
 * 将 AI create_memo 工具参数转换为 MemoFormData
 *
 * 负责参数格式适配：将 AI 返回的扁平结构转换为表单组件所需的嵌套结构，
 * 特别是将 recurrence/reminderTime 统一转换为 reminders 数组格式。
 */
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
    mutePeriods: args.mutePeriods || [],
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
      {args.mutePeriods && args.mutePeriods.length > 0 && (
        <div className="ai-preview-row">
          <span className="ai-preview-label">🔇 静默期</span>
          <span className="ai-preview-value">
            {args.mutePeriods.map((p, i) => (
              <span key={i}>{p.from} ~ {p.to}{i < args.mutePeriods!.length - 1 ? '、' : ''}</span>
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
