import React from 'react';
import type { Memo } from '../../types/global';

type NodeStatus = 'completed' | 'expired' | 'soon' | 'pending' | 'no-time';

interface TimelineProps {
  memos: Memo[];
  onToggle: (id: string) => void;
  onEdit: (memo: Memo) => void;
}

export default function Timeline({ memos, onToggle, onEdit }: TimelineProps): React.ReactElement {
  const now = new Date();
  const timelineMemos = memos
    .filter((m) => m.reminderTime)
    .sort((a, b) => new Date(a.reminderTime!).getTime() - new Date(b.reminderTime!).getTime());

  const groups: Record<string, Memo[]> = {};
  timelineMemos.forEach((memo) => {
    const d = new Date(memo.reminderTime!);
    const key = getDateLabel(d, now);
    if (!groups[key]) groups[key] = [];
    groups[key].push(memo);
  });

  const noTimeMemos = memos.filter((m) => !m.reminderTime);

  function getDateLabel(date: Date, now: Date): string {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = (target.getTime() - today.getTime()) / 86400000;
    if (diff < 0) return '已过期';
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    if (diff <= 7) return `${Math.floor(diff)} 天后`;
    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  }

  function getTimeStr(isoStr: string): string {
    return new Date(isoStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function getTimeKey(isoStr: string): string {
    const d = new Date(isoStr);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function getNodeStatus(memo: Memo): NodeStatus {
    if (memo.completed) return 'completed';
    const d = new Date(memo.reminderTime!);
    if (d < now) return 'expired';
    if (d.getTime() - now.getTime() < 3600000) return 'soon';
    return 'pending';
  }

  function groupByTime(items: Memo[]): Memo[][] {
    const timeGroups: Memo[][] = [];
    let lastKey: string | null = null;
    items.forEach((memo) => {
      const key = getTimeKey(memo.reminderTime!);
      if (key === lastKey) {
        timeGroups[timeGroups.length - 1].push(memo);
      } else {
        timeGroups.push([memo]);
        lastKey = key;
      }
    });
    return timeGroups;
  }

  const groupEntries = Object.entries(groups);

  if (timelineMemos.length === 0 && noTimeMemos.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📅</div>
        <p>暂无备忘录</p>
      </div>
    );
  }

  let singleSideIndex = 0;

  function renderCard(memo: Memo, status: NodeStatus, hasTime: boolean): React.ReactElement {
    return (
      <div className={`tl-center-card ${status}`} onClick={() => onEdit(memo)}>
        {hasTime && (
          <div className="tl-center-card-header">
            <span className="tl-center-time">{getTimeStr(memo.reminderTime!)}</span>
            {status === 'soon' && <span className="timeline-tag soon">即将到期</span>}
            {status === 'expired' && !memo.completed && <span className="timeline-tag expired">已过期</span>}
          </div>
        )}
        <h4 className={`tl-center-title ${memo.completed ? 'done' : ''}`}>{memo.title}</h4>
        {memo.content && (
          <p className="tl-center-desc">
            {memo.content.replace(/[#*`!\[\]()]/g, '').substring(0, 80)}
            {memo.content.length > 80 ? '...' : ''}
          </p>
        )}
      </div>
    );
  }

  function renderTimeSlot(slotMemos: Memo[], hasTime: boolean): React.ReactElement {
    const statuses = slotMemos.map((m) => hasTime ? getNodeStatus(m) : (m.completed ? 'completed' : 'no-time') as NodeStatus);
    const nodeStatus = statuses.find((s) => s === 'soon') || statuses.find((s) => s === 'expired') || statuses[0];
    const anyCompleted = slotMemos.some((m) => m.completed);

    if (slotMemos.length >= 2) {
      const leftItems: Memo[] = [];
      const rightItems: Memo[] = [];
      slotMemos.forEach((m, i) => {
        if (i % 2 === 0) leftItems.push(m);
        else rightItems.push(m);
      });
      return (
        <div key={slotMemos[0].id} className="tl-row">
          <div className="tl-row-left">
            {leftItems.map((m) => (
              <div key={m.id} className="tl-row-card-wrap left">
                {renderCard(m, hasTime ? getNodeStatus(m) : (m.completed ? 'completed' : 'no-time'), hasTime)}
                <div className="tl-center-arrow left" />
              </div>
            ))}
          </div>
          <div className="tl-row-center">
            <div className={`tl-center-node ${nodeStatus}`} onClick={() => onToggle(slotMemos[0].id)}>
              {anyCompleted && <span className="node-check">✓</span>}
            </div>
          </div>
          <div className="tl-row-right">
            {rightItems.map((m) => (
              <div key={m.id} className="tl-row-card-wrap right">
                <div className="tl-center-arrow right" />
                {renderCard(m, hasTime ? getNodeStatus(m) : (m.completed ? 'completed' : 'no-time'), hasTime)}
              </div>
            ))}
          </div>
        </div>
      );
    } else {
      const memo = slotMemos[0];
      const status: NodeStatus = hasTime ? getNodeStatus(memo) : (memo.completed ? 'completed' : 'no-time');
      const side = singleSideIndex % 2 === 0 ? 'left' : 'right';
      singleSideIndex++;
      return (
        <div key={memo.id} className="tl-row">
          <div className="tl-row-left">
            {side === 'left' && (
              <div className="tl-row-card-wrap left">
                {renderCard(memo, status, hasTime)}
                <div className="tl-center-arrow left" />
              </div>
            )}
          </div>
          <div className="tl-row-center">
            <div className={`tl-center-node ${status}`} onClick={() => onToggle(memo.id)}>
              {memo.completed && <span className="node-check">✓</span>}
            </div>
          </div>
          <div className="tl-row-right">
            {side === 'right' && (
              <div className="tl-row-card-wrap right">
                <div className="tl-center-arrow right" />
                {renderCard(memo, status, hasTime)}
              </div>
            )}
          </div>
        </div>
      );
    }
  }

  return (
    <div className="tl-center">
      <div className="tl-center-line" />

      {groupEntries.map(([label, items]) => {
        const timeSlots = groupByTime(items);
        return (
          <div key={label} className="tl-center-group">
            <div className="tl-center-date">
              <span className={`date-label ${label === '已过期' ? 'expired' : label === '今天' ? 'today' : ''}`}>
                {label}
              </span>
            </div>
            {timeSlots.map((slot) => renderTimeSlot(slot, true))}
          </div>
        );
      })}

      {noTimeMemos.length > 0 && (
        <div className="tl-center-group">
          <div className="tl-center-date">
            <span className="date-label muted">未设置时间</span>
          </div>
          {noTimeMemos.map((memo) => renderTimeSlot([memo], false))}
        </div>
      )}
    </div>
  );
}
