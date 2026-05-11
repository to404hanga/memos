import React from 'react';

export default function Timeline({ memos, onToggle, onEdit }) {
  // 筛选有提醒时间的备忘录，按时间排序
  const now = new Date();
  const timelineMemos = memos
    .filter((m) => m.reminderTime)
    .sort((a, b) => new Date(a.reminderTime) - new Date(b.reminderTime));

  // 按日期分组
  const groups = {};
  timelineMemos.forEach((memo) => {
    const d = new Date(memo.reminderTime);
    const key = getDateLabel(d, now);
    if (!groups[key]) groups[key] = [];
    groups[key].push(memo);
  });

  // 没有提醒时间的备忘录单独分组
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
    return new Date(isoStr).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getNodeStatus(memo) {
    if (memo.completed) return 'completed';
    const d = new Date(memo.reminderTime);
    if (d < now) return 'expired';
    if (d - now < 3600000) return 'soon';
    return 'pending';
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

  return (
    <div className="timeline">
      {groupEntries.map(([label, items]) => (
        <div key={label} className="timeline-group">
          <div className="timeline-date">
            <span className={`date-label ${label === '已过期' ? 'expired' : label === '今天' ? 'today' : ''}`}>
              {label}
            </span>
          </div>
          <div className="timeline-items">
            {items.map((memo) => {
              const status = getNodeStatus(memo);
              return (
                <div key={memo.id} className={`timeline-item ${status}`} onClick={() => onEdit(memo)}>
                  <div className="timeline-line">
                    <div className={`timeline-node ${status}`} onClick={(e) => { e.stopPropagation(); onToggle(memo.id); }}>
                      {memo.completed && <span className="node-check">✓</span>}
                    </div>
                  </div>
                  <div className="timeline-card">
                    <div className="timeline-card-header">
                      <span className="timeline-time">{getTimeStr(memo.reminderTime)}</span>
                      {status === 'soon' && <span className="timeline-tag soon">即将到期</span>}
                      {status === 'expired' && !memo.completed && <span className="timeline-tag expired">已过期</span>}
                    </div>
                    <h4 className={`timeline-title ${memo.completed ? 'done' : ''}`}>{memo.title}</h4>
                    {memo.content && <p className="timeline-desc">{memo.content}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {noTimeMemos.length > 0 && (
        <div className="timeline-group">
          <div className="timeline-date">
            <span className="date-label muted">未设置时间</span>
          </div>
          <div className="timeline-items">
            {noTimeMemos.map((memo) => (
              <div key={memo.id} className={`timeline-item ${memo.completed ? 'completed' : 'no-time'}`} onClick={() => onEdit(memo)}>
                <div className="timeline-line">
                  <div className={`timeline-node ${memo.completed ? 'completed' : 'no-time'}`} onClick={(e) => { e.stopPropagation(); onToggle(memo.id); }}>
                    {memo.completed && <span className="node-check">✓</span>}
                  </div>
                </div>
                <div className="timeline-card">
                  <h4 className={`timeline-title ${memo.completed ? 'done' : ''}`}>{memo.title}</h4>
                  {memo.content && <p className="timeline-desc">{memo.content}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
