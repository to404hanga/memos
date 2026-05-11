import React, { useState } from 'react';
import MarkdownView from './MarkdownView';
import type { Memo } from '../../types/global';

type ReminderStatus = 'expired' | 'soon' | 'pending' | 'completed';

interface MemoItemProps {
  memo: Memo;
  onToggle: (id: string) => void;
  onEdit: (memo: Memo) => void;
  onDelete: (id: string) => void;
}

export default function MemoItem({ memo, onToggle, onEdit, onDelete }: MemoItemProps): React.ReactElement {
  const [showConfirm, setShowConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const formatTime = (isoStr: string): string => {
    const d = new Date(isoStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();

    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    if (isToday) return `今天 ${time}`;
    if (isTomorrow) return `明天 ${time}`;
    return d.toLocaleDateString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getReminderStatus = (): ReminderStatus | null => {
    if (!memo.reminderTime) return null;
    const d = new Date(memo.reminderTime);
    const now = new Date();
    if (memo.completed) return 'completed';
    if (d < now) return 'expired';
    if (d.getTime() - now.getTime() < 3600000) return 'soon';
    return 'pending';
  };

  const status = getReminderStatus();
  const statusLabels: Record<ReminderStatus, string> = {
    expired: '已过期',
    soon: '即将提醒',
    pending: '待提醒',
    completed: '已完成',
  };
  const statusColors: Record<ReminderStatus, string> = {
    expired: '#ff6b6b',
    soon: '#ffa726',
    pending: '#42a5f5',
    completed: '#66bb6a',
  };

  const hasRichContent = memo.content && (
    memo.content.includes('![') ||
    memo.content.includes('**') ||
    memo.content.includes('# ') ||
    memo.content.includes('`') ||
    memo.content.includes('- ') ||
    memo.content.includes('\n')
  );

  return (
    <div className={`memo-item ${memo.completed ? 'completed' : ''}`}>
      <div className="memo-main">
        <div className={`checkbox ${memo.completed ? 'checked' : ''}`} onClick={() => onToggle(memo.id)}>
          {memo.completed && '✓'}
        </div>
        <div className="memo-content" onClick={() => hasRichContent ? setExpanded(!expanded) : onToggle(memo.id)}>
          <h3 className="memo-title">{memo.title}</h3>
          {memo.content && (
            expanded ? (
              <div className="memo-desc-rich">
                <MarkdownView content={memo.content} />
              </div>
            ) : (
              <p className="memo-desc">{memo.content.replace(/[#*`!\[\]()]/g, '').substring(0, 60)}{memo.content.length > 60 ? '...' : ''}</p>
            )
          )}
          {hasRichContent && (
            <button className="expand-btn" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
              {expanded ? '收起' : '展开详情'}
            </button>
          )}
          {memo.reminderTime && (
            <div className="memo-reminder">
              <span className="reminder-icon">{memo.recurrence && memo.recurrence.type !== 'once' ? '🔁' : '⏰'}</span>
              <span className="reminder-time">{formatTime(memo.reminderTime)}</span>
              {memo.recurrence && memo.recurrence.type !== 'once' && (
                <span className="recurrence-label">
                  {memo.recurrence.type === 'daily' && '每天'}
                  {memo.recurrence.type === 'weekly' && '每周'}
                  {memo.recurrence.type === 'monthly' && '每月'}
                </span>
              )}
              {status && (
                <span className="reminder-status" style={{ color: statusColors[status] }}>
                  {statusLabels[status]}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="memo-actions">
        <button className="action-btn edit" onClick={() => onEdit(memo)} title="编辑">
          ✏️
        </button>
        {showConfirm ? (
          <div className="confirm-delete">
            <button className="action-btn confirm-yes" onClick={() => { onDelete(memo.id); setShowConfirm(false); }}>
              确认
            </button>
            <button className="action-btn confirm-no" onClick={() => setShowConfirm(false)}>
              取消
            </button>
          </div>
        ) : (
          <button className="action-btn delete" onClick={() => setShowConfirm(true)} title="删除">
            🗑️
          </button>
        )}
      </div>
    </div>
  );
}
