import React from 'react';

export default function Timeline({ memos, onToggle, onEdit }) {
  const now = new Date();
  const timelineMemos = memos
    .filter((m) => m.reminderTime)
    .sort((a, b) => new Date(a.reminderTime) - new Date(b.reminderTime));

  const groups = {};
  timelineMemos.forEach((memo) => {
    const d = new Date(memo.reminderTime);
    const key = getDateLabel(d, now);
    if (!groups[key]) groups[key] = [];
    groups[key].push(memo);
  });

  const noTimeMemos = memos.filter((m) => !m.reminderTime);

  function getDateLabel(date, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = (target - today) / 86400000;
    if (diff < 0) return '已过期';
    if (diff === 0) return '今天';
    if (diff === 1) return '明天';
    if (diff === 2) return '后天';
    if (diff <= 7) return `${Math.floor(diff)} 天后`;
    return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  }

  function getTimeStr(isoStr) {
    return new Date(isoStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function getTimeKey(isoStr) {
    const d = new Date(isoStr);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function getNodeStatus(memo) {
    if (memo.completed) return 'completed';
    const d = new Date(memo.reminderTime);
    if (d < now) return 'expired';
    if (d - now < 3600000) return 'soon';
    return 'pending';
  }

  // 按时间点分组
  function groupByTime(items) {
    const timeGroups = [];
    let lastKey = null;
    items.forEach((memo) => {
      const key = getTimeKey(memo.reminderTime);
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

  let singleSideIndex = 0; // 用于单个项交替方向

  function renderCard(memo, status, hasTime) {
    return (
      <div className={`tl-center-card ${status}`} onClick={() => onEdit(memo)}>
        {hasTime && (
          <div className="tl-center-card-header">
            <span className="tl-center-time">{getTimeStr(memo.reminderTime)}</span>
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

  function renderTimeSlot(slotMemos, hasTime) {
    // 取这组中最"紧急"的状态作为节点状态
    const statuses = slotMemos.map((m) => hasTime ? getNodeStatus(m) : (m.completed ? 'completed' : 'no-time'));
    const nodeStatus = statuses.find((s) => s === 'soon') || statuses.find((s) => s === 'expired') || statuses[0];
    const anyCompleted = slotMemos.some((m) => m.completed);

    if (slotMemos.length >= 2) {
      // 多个同时间项：左右并排
      const leftItems = [];
      const rightItems = [];
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
      // 单个项：交替左右
      const memo = slotMemos[0];
      const status = hasTime ? getNodeStatus(memo) : (memo.completed ? 'completed' : 'no-time');
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
