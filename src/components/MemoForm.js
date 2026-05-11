import React, { useState, useEffect, useRef } from 'react';
import MarkdownView from './MarkdownView';

export default function MemoForm({ memo, onSubmit, onCancel }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef(null);

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
      content: content,
      reminderTime: reminderTime ? new Date(reminderTime).toISOString() : null,
    };
    if (memo) data.id = memo.id;
    onSubmit(data);
  };

  const handleInsertImage = async () => {
    const result = await window.api.selectImage();
    if (!result) return;
    const mdImage = `![图片](${result.filePath})`;
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newContent = content.substring(0, start) + mdImage + content.substring(end);
      setContent(newContent);
      // 光标移到插入内容之后
      setTimeout(() => {
        ta.selectionStart = ta.selectionEnd = start + mdImage.length;
        ta.focus();
      }, 0);
    } else {
      setContent(content + '\n' + mdImage);
    }
  };

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
        <div className="content-label-row">
          <label htmlFor="content">内容</label>
          <div className="content-toolbar">
            <button type="button" className="toolbar-btn" onClick={handleInsertImage} title="插入图片">
              🖼️
            </button>
            <button
              type="button"
              className={`toolbar-btn ${showPreview ? 'active' : ''}`}
              onClick={() => setShowPreview(!showPreview)}
              title="预览 Markdown"
            >
              {showPreview ? '编辑' : '预览'}
            </button>
          </div>
        </div>
        {showPreview ? (
          <div className="content-preview">
            {content ? (
              <MarkdownView content={content} />
            ) : (
              <p className="preview-empty">暂无内容</p>
            )}
          </div>
        ) : (
          <textarea
            id="content"
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="支持 Markdown 格式，可插入图片..."
            rows={6}
          />
        )}
        <div className="md-hint">支持 **粗体**、*斜体*、# 标题、- 列表、`代码` 等 Markdown 语法</div>
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
