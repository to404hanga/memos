/**
 * 备忘录表单组件
 *
 * 用于创建和编辑备忘录的完整表单，以模态框形式展示。
 * 功能模块：
 *
 * 1. 标题输入（必填）
 * 2. 标签选择器：显示已有标签（可多选），支持新建标签
 * 3. Markdown 编辑器：
 *    - 三种模式：分栏（编辑+预览）/ 纯编辑 / 纯预览
 *    - 工具栏：粗体/斜体/标题/删除线/代码/分割线/列表/引用/链接
 *    - 插入图片（文件选择器或拖拽）
 *    - 编辑器与预览区同步滚动
 *    - 拖拽支持：图片文件自动插入 Markdown，其他文件添加为附件
 * 4. 多提醒配置：
 *    - 支持单次/每天/工作日/每周/每月
 *    - 每种周期可设置具体时间
 *    - 支持添加多个不同类型的提醒
 * 5. 静默期：在指定日期范围内暂停提醒
 * 6. 附件管理：添加/查看/打开/移除附件
 * 7. 企微 Webhook：
 *    - 启用/禁用开关
 *    - URL 和消息模板配置
 *    - 发送测试功能
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import MarkdownView from './MarkdownView';
import type { Memo, MemoFormData, Recurrence, Tag, MutePeriod, Attachment, WebhookConfig } from '../../types/global';

/** 星期名称数组 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 根据文件扩展名返回对应的 emoji 图标 */
function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    ppt: '📽️', pptx: '📽️', txt: '📃', md: '📃', csv: '📊',
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    mp3: '🎵', wav: '🎵', flac: '🎵', mp4: '🎬', avi: '🎬', mov: '🎬',
    js: '💻', ts: '💻', py: '💻', java: '💻', html: '🌐', css: '🎨',
    json: '📋', xml: '📋', yaml: '📋', yml: '📋',
  };
  return iconMap[ext] || '📎';
}

/** 将字节数格式化为人类可读的文件大小（B/KB/MB） */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 提醒类型 */
type RecurrenceType = 'once' | 'daily' | 'workday' | 'weekly' | 'monthly';
/** 编辑器显示模式 */
type EditorMode = 'split' | 'edit' | 'preview';

interface MemoFormProps {
  /** 编辑时传入已有备忘录数据，新建时为 null */
  memo: Memo | null;
  /** 提交回调（创建或更新） */
  onSubmit: (data: MemoFormData) => void;
  /** 取消回调（关闭表单） */
  onCancel: () => void;
}

export default function MemoForm({ memo, onSubmit, onCancel }: MemoFormProps): React.ReactElement {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('split');
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragCountRef = useRef(0);

  const [reminders, setReminders] = useState<Recurrence[]>([]);
  const [mutePeriods, setMutePeriods] = useState<MutePeriod[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [webhook, setWebhook] = useState<WebhookConfig>({ enabled: false, url: '', content: '' });
  const [webhookTestResult, setWebhookTestResult] = useState<string | null>(null);

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [showNewTag, setShowNewTag] = useState(false);

  useEffect(() => {
    window.api.getTags().then(setAllTags);
  }, []);

  useEffect(() => {
    if (memo) {
      setTitle(memo.title || '');
      setContent(memo.content || '');
      setSelectedTags(memo.tags || []);
      setReminders(memo.reminders && memo.reminders.length > 0 ? memo.reminders : []);
      setMutePeriods(memo.mutePeriods || []);
      setAttachments(memo.attachments || []);
      setWebhook(memo.webhook || { enabled: false, url: '', content: '' });
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
      tags: selectedTags,
      reminders: reminders,
      mutePeriods: mutePeriods.filter((p) => p.from && p.to),
      attachments: attachments,
      webhook: webhook.enabled && webhook.url && webhook.content ? webhook : null,
    };

    if (memo) data.id = memo.id;
    onSubmit(data);
  };

  const handleInsertImage = async () => {
    const result = await window.api.selectImage();
    if (!result) return;
    insertAtCursor(`![图片](${result.filePath})`);
  };

  const insertAtCursor = useCallback((text: string, wrap?: { before: string; after: string }) => {
    const ta = textareaRef.current;
    if (!ta) {
      setContent((prev) => prev + text);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.substring(start, end);

    let insertion: string;
    let cursorPos: number;
    if (wrap && selected) {
      insertion = wrap.before + selected + wrap.after;
      cursorPos = start + insertion.length;
    } else if (wrap) {
      insertion = wrap.before + wrap.after;
      cursorPos = start + wrap.before.length;
    } else {
      insertion = text;
      cursorPos = start + text.length;
    }

    const newContent = content.substring(0, start) + insertion + content.substring(end);
    setContent(newContent);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = cursorPos;
      ta.focus();
    }, 0);
  }, [content]);

  const mdToolbar = [
    { label: 'B', title: '粗体', action: () => insertAtCursor('', { before: '**', after: '**' }) },
    { label: 'I', title: '斜体', action: () => insertAtCursor('', { before: '*', after: '*' }) },
    { label: 'H', title: '标题', action: () => insertAtCursor('## ') },
    { label: '~', title: '删除线', action: () => insertAtCursor('', { before: '~~', after: '~~' }) },
    { label: '<>', title: '代码', action: () => insertAtCursor('', { before: '`', after: '`' }) },
    { label: '—', title: '分割线', action: () => insertAtCursor('\n---\n') },
    { label: '•', title: '列表', action: () => insertAtCursor('- ') },
    { label: '1.', title: '有序列表', action: () => insertAtCursor('1. ') },
    { label: '>', title: '引用', action: () => insertAtCursor('> ') },
    { label: '🔗', title: '链接', action: () => insertAtCursor('[链接文字](https://)') },
  ];

  const handleEditorScroll = () => {
    const ta = textareaRef.current;
    const pv = previewRef.current;
    if (!ta || !pv) return;
    const ratio = ta.scrollTop / (ta.scrollHeight - ta.clientHeight || 1);
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCountRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((f) =>
      /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)
    );
    const otherFiles = files.filter((f) =>
      !/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)
    );

    for (const file of imageFiles) {
      const filePath = (file as unknown as { path: string }).path;
      const result = await window.api.saveDroppedImage(filePath);
      if (result) {
        const mdImage = `![${file.name}](${result.filePath})`;
        setContent((prev) => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + mdImage + '\n');
      }
    }

    for (const file of otherFiles) {
      const filePath = (file as unknown as { path: string }).path;
      const result = await window.api.saveDroppedFile(filePath);
      if (result) {
        setAttachments((prev) => [...prev, result]);
      }
    }

    if (files.length > 0 && textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localNow = new Date(now.getTime() - offset * 60000);
  const minDatetime = localNow.toISOString().slice(0, 16);

  const addReminder = () => {
    setReminders([...reminders, { type: 'once', time: '' }]);
  };

  const removeReminder = (index: number) => {
    setReminders(reminders.filter((_, i) => i !== index));
  };

  const updateReminder = (index: number, updated: Recurrence) => {
    const newReminders = [...reminders];
    newReminders[index] = updated;
    setReminders(newReminders);
  };

  function getReminderLabel(rem: Recurrence): string {
    if (rem.type === 'once' && rem.time) {
      return toLocalDatetime(rem.time).replace('T', ' ');
    }
    const timeStr = `${String(rem.hour ?? 0).padStart(2, '0')}:${String(rem.minute ?? 0).padStart(2, '0')}`;
    if (rem.type === 'daily') return `每天 ${timeStr}`;
    if (rem.type === 'workday') return `每个工作日 ${timeStr}`;
    if (rem.type === 'weekly') return `每${WEEKDAYS[rem.dayOfWeek ?? 0]} ${timeStr}`;
    if (rem.type === 'monthly') return `每月${rem.dayOfMonth ?? 1}号 ${timeStr}`;
    return '';
  }

  const TAG_COLORS = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5ac8fa', '#ff2d55', '#8e8e93'];

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  const handleAddTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    if (allTags.some((t) => t.name === name)) {
      if (!selectedTags.includes(name)) setSelectedTags([...selectedTags, name]);
      setNewTagName('');
      setShowNewTag(false);
      return;
    }
    const color = TAG_COLORS[allTags.length % TAG_COLORS.length];
    const tag = await window.api.addTag({ name, color });
    setAllTags([...allTags, tag]);
    setSelectedTags([...selectedTags, tag.name]);
    setNewTagName('');
    setShowNewTag(false);
  };

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
        <label>标签</label>
        <div className="tag-selector">
          {allTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`tag-chip ${selectedTags.includes(tag.name) ? 'selected' : ''}`}
              style={{ '--tag-color': tag.color } as React.CSSProperties}
              onClick={() => toggleTag(tag.name)}
            >
              {tag.name}
            </button>
          ))}
          {showNewTag ? (
            <div className="new-tag-input">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } if (e.key === 'Escape') setShowNewTag(false); }}
                placeholder="标签名..."
                autoFocus
              />
              <button type="button" className="new-tag-confirm" onClick={handleAddTag}>✓</button>
              <button type="button" className="new-tag-cancel" onClick={() => setShowNewTag(false)}>✕</button>
            </div>
          ) : (
            <button type="button" className="tag-add-btn" onClick={() => setShowNewTag(true)}>+ 新标签</button>
          )}
        </div>
      </div>

      <div className="form-group editor-group">
        <div className="editor-header">
          <label>内容</label>
          <div className="editor-toolbar">
            {mdToolbar.map((btn) => (
              <button key={btn.title} type="button" className="md-tool-btn" onClick={btn.action} title={btn.title}>
                {btn.label}
              </button>
            ))}
            <span className="toolbar-divider" />
            <button type="button" className="toolbar-btn" onClick={handleInsertImage} title="插入图片">
              🖼️
            </button>
            <span className="toolbar-divider" />
            <div className="editor-mode-tabs">
              {([
                { key: 'split' as const, label: '分栏' },
                { key: 'edit' as const, label: '编辑' },
                { key: 'preview' as const, label: '预览' },
              ]).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`mode-tab ${editorMode === m.key ? 'active' : ''}`}
                  onClick={() => setEditorMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className={`editor-container mode-${editorMode} ${isDragging ? 'drag-over' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="drop-overlay">
              <div className="drop-overlay-content">
                <span className="drop-icon">🖼️</span>
                <span>松开以插入图片</span>
              </div>
            </div>
          )}
          {editorMode !== 'preview' && (
            <div className="editor-pane">
              <textarea
                id="content"
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onScroll={handleEditorScroll}
                placeholder="支持 Markdown 格式，可拖拽图片到此处..."
                spellCheck={false}
              />
            </div>
          )}
          {editorMode !== 'edit' && (
            <div className="preview-pane" ref={previewRef}>
              {content ? (
                <MarkdownView content={content} />
              ) : (
                <p className="preview-empty">预览区域</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="form-group">
        <div className="content-label-row">
          <label>提醒</label>
          <button type="button" className="tag-add-btn" onClick={addReminder}>+ 添加提醒</button>
        </div>
        {reminders.length === 0 && (
          <p className="no-reminders">暂无提醒，点击「+ 添加提醒」设置</p>
        )}
        <div className="reminders-list">
          {reminders.map((rem, idx) => (
            <div key={idx} className="reminder-row">
              <select
                className="rec-select"
                value={rem.type}
                onChange={(e) => {
                  const type = e.target.value as RecurrenceType;
                  if (type === 'once') {
                    updateReminder(idx, { type: 'once', time: '' });
                  } else {
                    updateReminder(idx, { type, hour: rem.hour ?? 9, minute: rem.minute ?? 0, dayOfWeek: rem.dayOfWeek ?? 1, dayOfMonth: rem.dayOfMonth ?? 1 });
                  }
                }}
              >
                <option value="once">单次</option>
                <option value="daily">每天</option>
                <option value="workday">每个工作日</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select>

              {rem.type === 'once' && (
                <input
                  type="datetime-local"
                  className="rem-datetime"
                  value={rem.time ? toLocalDatetime(rem.time) : ''}
                  min={minDatetime}
                  onChange={(e) => updateReminder(idx, { ...rem, time: e.target.value ? new Date(e.target.value).toISOString() : '' })}
                />
              )}

              {rem.type === 'weekly' && (
                <select
                  className="rec-select"
                  value={rem.dayOfWeek ?? 1}
                  onChange={(e) => updateReminder(idx, { ...rem, dayOfWeek: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((name, i) => (
                    <option key={i} value={i}>{name}</option>
                  ))}
                </select>
              )}

              {rem.type === 'monthly' && (
                <select
                  className="rec-select"
                  value={rem.dayOfMonth ?? 1}
                  onChange={(e) => updateReminder(idx, { ...rem, dayOfMonth: Number(e.target.value) })}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}号</option>
                  ))}
                </select>
              )}

              {rem.type !== 'once' && (
                <div className="time-picker">
                  <select
                    className="rec-select"
                    value={rem.hour ?? 9}
                    onChange={(e) => updateReminder(idx, { ...rem, hour: Number(e.target.value) })}
                  >
                    {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                    ))}
                  </select>
                  <span className="time-sep">:</span>
                  <select
                    className="rec-select"
                    value={rem.minute ?? 0}
                    onChange={(e) => updateReminder(idx, { ...rem, minute: Number(e.target.value) })}
                  >
                    {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              )}

              <button type="button" className="rem-delete" onClick={() => removeReminder(idx)} title="删除此提醒">✕</button>
            </div>
          ))}
        </div>
      </div>

      {reminders.length > 0 && (
        <div className="form-group">
          <div className="content-label-row">
            <label>静默期（不提醒的日期范围）</label>
            <button type="button" className="tag-add-btn" onClick={() => setMutePeriods([...mutePeriods, { from: '', to: '' }])}>+ 添加</button>
          </div>
          {mutePeriods.length === 0 && (
            <p className="no-reminders">未设置静默期</p>
          )}
          <div className="reminders-list">
            {mutePeriods.map((period, idx) => (
              <div key={idx} className="reminder-row mute-row">
                <span className="mute-label">从</span>
                <input
                  type="date"
                  className="rem-datetime"
                  value={period.from}
                  onChange={(e) => {
                    const newPeriods = [...mutePeriods];
                    newPeriods[idx] = { ...newPeriods[idx], from: e.target.value };
                    setMutePeriods(newPeriods);
                  }}
                />
                <span className="mute-label">至</span>
                <input
                  type="date"
                  className="rem-datetime"
                  value={period.to}
                  min={period.from || undefined}
                  onChange={(e) => {
                    const newPeriods = [...mutePeriods];
                    newPeriods[idx] = { ...newPeriods[idx], to: e.target.value };
                    setMutePeriods(newPeriods);
                  }}
                />
                <button type="button" className="rem-delete" onClick={() => setMutePeriods(mutePeriods.filter((_, i) => i !== idx))}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="form-group">
        <div className="content-label-row">
          <label>附件</label>
          <button type="button" className="tag-add-btn" onClick={async () => {
            const result = await window.api.selectAttachment();
            if (result) setAttachments([...attachments, result]);
          }}>+ 添加附件</button>
        </div>
        {attachments.length === 0 && (
          <p className="no-reminders">暂无附件，可拖拽文件到编辑区或点击「+ 添加附件」</p>
        )}
        {attachments.length > 0 && (
          <div className="attachments-list">
            {attachments.map((att, idx) => (
              <div key={idx} className="attachment-item">
                <span className="attachment-icon">{getFileIcon(att.originalName)}</span>
                <div className="attachment-info">
                  <span className="attachment-name" title={att.originalName}>{att.originalName}</span>
                  <span className="attachment-size">{formatFileSize(att.size)}</span>
                </div>
                <button type="button" className="attachment-open" onClick={() => window.api.openAttachment(att.filePath)} title="打开文件">📂</button>
                <button type="button" className="rem-delete" onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))} title="移除">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="form-group">
        <div className="content-label-row">
          <label>企微 Webhook</label>
          <label className="switch">
            <input type="checkbox" checked={webhook.enabled} onChange={(e) => setWebhook({ ...webhook, enabled: e.target.checked })} />
            <span className="switch-slider" />
          </label>
        </div>
        {webhook.enabled && (
          <div className="webhook-fields">
            <input
              type="text"
              value={webhook.url}
              onChange={(e) => setWebhook({ ...webhook, url: e.target.value })}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
            />
            <textarea
              className="webhook-body-input"
              value={webhook.content || ''}
              onChange={(e) => setWebhook({ ...webhook, content: e.target.value })}
              placeholder={'发送内容（Markdown 格式）\n可用变量: {{title}} {{content}} {{tags}} {{time}}'}
              rows={3}
            />
            <p className="webhook-hint">示例: # ⏰ {'{{title}}'}\n{'{{content}}'}\n&gt; 标签: {'{{tags}}'}</p>
            <div className="webhook-test-row">
              <button type="button" className="webhook-test-btn" onClick={async () => {
                if (!webhook.url) { setWebhookTestResult('❌ 请先填写 URL'); return; }
                if (!webhook.content) { setWebhookTestResult('❌ 请填写发送内容'); return; }
                setWebhookTestResult('⏳ 发送中...');
                const r = await window.api.testWebhook(webhook.url, webhook.content, { title, content, tags: selectedTags });
                setWebhookTestResult(r.success ? `✅ 成功 (HTTP ${r.status})` : `❌ ${r.error}`);
              }}>发送测试</button>
              {webhookTestResult && <span className="webhook-test-result">{webhookTestResult}</span>}
            </div>
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
