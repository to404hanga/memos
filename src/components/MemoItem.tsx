/**
 * 单个备忘录项组件
 *
 * 在列表视图中展示一条备忘录的完整信息，功能包括：
 * - 完成状态切换（复选框）
 * - 标题展示（置顶图标 + 标签徽章）
 * - 内容预览（纯文本摘要 / Markdown 展开）
 * - 提醒时间显示及状态标签（已过期/即将/待提醒/已完成）
 * - 操作按钮：置顶、编辑、删除（含二次确认）
 * - 富文本内容支持展开/收起详情（Markdown 渲染）
 *
 * 提醒状态判断逻辑：
 * - expired: 提醒时间已过且未完成
 * - soon: 距提醒时间不到 1 小时
 * - pending: 正常等待中
 * - completed: 已完成
 */
import React, { useState } from 'react';
import MarkdownView from './MarkdownView';
import type { Memo } from '../../types/global';

/** 提醒状态枚举 */
type ReminderStatus = 'expired' | 'soon' | 'pending' | 'completed';

interface MemoItemProps {
  memo: Memo;
  onToggle: (id: string) => void;
  onEdit: (memo: Memo) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onSendToAi?: (memo: Memo) => void;
}

export default function MemoItem({ memo, onToggle, onEdit, onDelete, onPin, onSendToAi }: MemoItemProps): React.ReactElement {
  const [showConfirm, setShowConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

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
    <div className={`memo-item ${memo.completed ? 'completed' : ''} ${memo.pinned ? 'pinned' : ''}`} onContextMenu={handleContextMenu}>
      {contextMenu && (
        <>
          <div className="context-menu-overlay" onClick={closeContextMenu} />
          <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }}>
            {onSendToAi && (
              <div className="context-menu-item" onClick={() => { onSendToAi(memo); closeContextMenu(); }}>
                <span className="context-menu-icon">🤖</span>发送到 AI 对话
              </div>
            )}
            <div className="context-menu-item" onClick={() => { onEdit(memo); closeContextMenu(); }}>
              <span className="context-menu-icon">✏️</span>编辑
            </div>
            <div className="context-menu-item" onClick={() => { onPin(memo.id); closeContextMenu(); }}>
              <span className="context-menu-icon">📌</span>{memo.pinned ? '取消置顶' : '置顶'}
            </div>
            <div className="context-menu-item" onClick={() => { onToggle(memo.id); closeContextMenu(); }}>
              <span className="context-menu-icon">{memo.completed ? '↩️' : '✅'}</span>{memo.completed ? '取消完成' : '标记完成'}
            </div>
            <div className="context-menu-divider" />
            <div className="context-menu-item danger" onClick={() => { onDelete(memo.id); closeContextMenu(); }}>
              <span className="context-menu-icon">🗑️</span>删除
            </div>
          </div>
        </>
      )}
      <div className="memo-main">
        <div className={`checkbox ${memo.completed ? 'checked' : ''}`} onClick={() => onToggle(memo.id)}>
          {memo.completed && '✓'}
        </div>
        <div className="memo-content" onClick={() => hasRichContent ? setExpanded(!expanded) : onToggle(memo.id)}>
          <h3 className="memo-title">
            {memo.pinned && <span className="pin-icon">📌</span>}
            {memo.title}
          </h3>
          {memo.tags && memo.tags.length > 0 && (
            <div className="memo-tags">
              {memo.tags.map((tag) => (
                <span key={tag} className="memo-tag-badge">{tag}</span>
              ))}
            </div>
          )}
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
              <span className="reminder-icon">{memo.reminders && memo.reminders.some((r) => r.type !== 'once') ? '🔁' : '⏰'}</span>
              <span className="reminder-time">{formatTime(memo.reminderTime)}</span>
              {memo.reminders && memo.reminders.length > 1 && (
                <span className="reminder-count">+{memo.reminders.length - 1}个提醒</span>
              )}
              {memo.reminders && memo.reminders.some((r) => r.type !== 'once') && (
                <span className="recurrence-label">周期</span>
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
        <button
          className={`action-btn pin ${memo.pinned ? 'active' : ''}`}
          onClick={() => onPin(memo.id)}
          title={memo.pinned ? '取消置顶' : '置顶'}
        >
          📌
        </button>
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
