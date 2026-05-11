import React, { useState, useEffect } from 'react';

export default function MemoForm({ memo, onSubmit, onCancel }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reminderTime, setReminderTime] = useState('');

  useEffect(() => {
    if (memo) {
      setTitle(memo.title || '');
      setContent(memo.content || '');
      setReminderTime(memo.reminderTime ? toLocalDatetime(memo.reminderTime) : '');
    }
  }, [memo]);

  function toLocalDatetime(isoStr) {
    const d = new Date(isoStr);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const data = {
      title: title.trim(),
      content: content.trim(),
      reminderTime: reminderTime ? new Date(reminderTime).toISOString() : null,
    };
    if (memo) data.id = memo.id;
    onSubmit(data);
  };

  // 获取当前时间字符串，用于 min 属性
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localNow = new Date(now.getTime() - offset * 60000);
  const minDatetime = localNow.toISOString().slice(0, 16);

  return (
    <form className="memo-form" onSubmit={handleSubmit}>
      <h2>{memo ? '编辑备忘录' : '新建备忘录'}</h2>

      <div className="form-group">
        <label htmlFor="title">标题 *</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="输入备忘标题..."
          autoFocus
          required
        />
      </div>

      <div className="form-group">
        <label htmlFor="content">内容</label>
        <textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="详细描述（可选）..."
          rows={3}
        />
      </div>

      <div className="form-group">
        <label htmlFor="reminder">提醒时间</label>
        <input
          id="reminder"
          type="datetime-local"
          value={reminderTime}
          onChange={(e) => setReminderTime(e.target.value)}
          min={minDatetime}
        />
        {reminderTime && (
          <button type="button" className="clear-time" onClick={() => setReminderTime('')}>
            清除时间
          </button>
        )}
      </div>

      <div className="form-actions">
        <button type="button" className="btn-cancel" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn-submit">
          {memo ? '保存修改' : '创建'}
        </button>
      </div>
    </form>
  );
}
