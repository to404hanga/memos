import React, { useState } from 'react';

export default function MemoItem({ memo, onToggle, onEdit, onDelete }) {
  const [showConfirm, setShowConfirm] = useState(false);

  const formatTime = (isoStr) => {
    if (!isoStr) return null;
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

  const getReminderStatus = () => {
    if (!memo.reminderTime) return null;
    const d = new Date(memo.reminderTime);
    const now = new Date();
    if (memo.completed) return 'completed';
    if (d < now) return 'expired';
    // 1小时内即将到期
    if (d - now < 3600000) return 'soon';
    return 'pending';
  };

  const status = getReminderStatus();
  const statusLabels = {
    expired: '已过期',
    soon: '即将提醒',
    pending: '待提醒',
    completed: '已完成',
  };
  const statusColors = {
    expired: '#ff6b6b',
    soon: '#ffa726',
    pending: '#42a5f5',
    completed: '#66bb6a',
  };

  return (
    <div className={`memo-item ${memo.completed ? 'completed' : ''}`}>
      <div className="memo-main" onClick={() => onToggle(memo.id)}>
        <div className={`checkbox ${memo.completed ? 'checked' : ''}`}>
          {memo.completed && '✓'}
        </div>
        <div className="memo-content">
          <h3 className="memo-title">{memo.title}</h3>
          {memo.content && <p className="memo-desc">{memo.content}</p>}
          {memo.reminderTime && (
            <div className="memo-reminder">
              <span className="reminder-icon">⏰</span>
              <span className="reminder-time">{formatTime(memo.reminderTime)}</span>
              {status && (
                <span
                  className="reminder-status"
                  style={{ color: statusColors[status] }}
                >
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
