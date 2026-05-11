import React, { useState, useEffect, useRef } from 'react';
import MarkdownView from './MarkdownView';
import type { Memo, MemoFormData, Recurrence } from '../../types/global';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

type RecurrenceType = 'once' | 'daily' | 'weekly' | 'monthly';

interface MemoFormProps {
  memo: Memo | null;
  onSubmit: (data: MemoFormData) => void;
  onCancel: () => void;
}

export default function MemoForm({ memo, onSubmit, onCancel }: MemoFormProps): React.ReactElement {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('once');
  const [recDayOfWeek, setRecDayOfWeek] = useState(1);
  const [recDayOfMonth, setRecDayOfMonth] = useState(1);
  const [recHour, setRecHour] = useState(9);
  const [recMinute, setRecMinute] = useState(0);

  useEffect(() => {
    if (memo) {
      setTitle(memo.title || '');
      setContent(memo.content || '');
      setReminderTime(memo.reminderTime ? toLocalDatetime(memo.reminderTime) : '');
      if (memo.recurrence && memo.recurrence.type !== 'once') {
        setRecurrenceType(memo.recurrence.type);
        setRecDayOfWeek(memo.recurrence.dayOfWeek ?? 1);
        setRecDayOfMonth(memo.recurrence.dayOfMonth ?? 1);
        setRecHour(memo.recurrence.hour ?? 9);
        setRecMinute(memo.recurrence.minute ?? 0);
      } else {
        setRecurrenceType('once');
      }
    }
  }, [memo]);

  function toLocalDatetime(isoStr: string): string {
    const d = new Date(isoStr);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const data: MemoFormData = {
      title: title.trim(),
      content: content,
    };

    if (recurrenceType === 'once') {
      data.reminderTime = reminderTime ? new Date(reminderTime).toISOString() : null;
      data.recurrence = null;
    } else {
      const rec: Recurrence = {
        type: recurrenceType,
        hour: recHour,
        minute: recMinute,
      };
      if (recurrenceType === 'weekly') rec.dayOfWeek = recDayOfWeek;
      if (recurrenceType === 'monthly') rec.dayOfMonth = recDayOfMonth;
      data.recurrence = rec;
      data.reminderTime = null;
    }

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

  function getRecurrencePreview(): string {
    const timeStr = `${String(recHour).padStart(2, '0')}:${String(recMinute).padStart(2, '0')}`;
    if (recurrenceType === 'daily') return `每天 ${timeStr}`;
    if (recurrenceType === 'weekly') return `每${WEEKDAYS[recDayOfWeek]} ${timeStr}`;
    if (recurrenceType === 'monthly') return `每月 ${recDayOfMonth} 号 ${timeStr}`;
    return '';
  }

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
        <label>提醒方式</label>
        <div className="recurrence-tabs">
          {([
            { key: 'once' as const, label: '单次' },
            { key: 'daily' as const, label: '每天' },
            { key: 'weekly' as const, label: '每周' },
            { key: 'monthly' as const, label: '每月' },
          ]).map((item) => (
            <button
              key={item.key}
              type="button"
              className={`rec-tab ${recurrenceType === item.key ? 'active' : ''}`}
              onClick={() => setRecurrenceType(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {recurrenceType === 'once' ? (
          <div className="rec-once-row">
            <input
              id="reminder"
              type="datetime-local"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              min={minDatetime}
            />
            {reminderTime && (
              <button type="button" className="clear-time" onClick={() => setReminderTime('')}>
                清除
              </button>
            )}
          </div>
        ) : (
          <div className="rec-config">
            {recurrenceType === 'weekly' && (
              <div className="rec-row">
                <span className="rec-label">星期</span>
                <div className="weekday-picker">
                  {WEEKDAYS.map((name, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`weekday-btn ${recDayOfWeek === i ? 'active' : ''}`}
                      onClick={() => setRecDayOfWeek(i)}
                    >
                      {name.replace('周', '')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {recurrenceType === 'monthly' && (
              <div className="rec-row">
                <span className="rec-label">日期</span>
                <select
                  className="rec-select"
                  value={recDayOfMonth}
                  onChange={(e) => setRecDayOfMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d} 号</option>
                  ))}
                </select>
              </div>
            )}

            <div className="rec-row">
              <span className="rec-label">时间</span>
              <div className="time-picker">
                <select
                  className="rec-select"
                  value={recHour}
                  onChange={(e) => setRecHour(Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                  ))}
                </select>
                <span className="time-sep">:</span>
                <select
                  className="rec-select"
                  value={recMinute}
                  onChange={(e) => setRecMinute(Number(e.target.value))}
                >
                  {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                    <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rec-preview">🔁 {getRecurrencePreview()}</div>
          </div>
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
