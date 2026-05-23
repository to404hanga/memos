/**
 * 备忘录表单组件
 *
 * 用于创建和编辑备忘录的完整表单，以模态框形式展示。
 * 通过子组件拆分实现职责分离：
 * - ReminderEditor: 多提醒配置 + 静默期
 * - AttachmentManager: 附件管理
 * - WebhookConfigPanel: 企微 Webhook 配置
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import MarkdownView from './MarkdownView';
import ReminderEditor from './ReminderEditor';
import AttachmentManager from './AttachmentManager';
import WebhookConfigPanel from './WebhookConfigPanel';
import type { Memo, MemoFormData, Recurrence, Tag, MutePeriod, Attachment, WebhookConfig } from '../../types/global';

/** 编辑器显示模式 */
type EditorMode = 'split' | 'edit' | 'preview';

interface MemoFormProps {
  memo: Memo | null;
  onSubmit: (data: MemoFormData) => void;
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
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current--;
    if (dragCountRef.current === 0) setIsDragging(false);
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
    const imageFiles = files.filter((f) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name));
    const otherFiles = files.filter((f) => !/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name));

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
      if (result) setAttachments((prev) => [...prev, result]);
    }

    if (files.length > 0 && textareaRef.current) textareaRef.current.focus();
  };

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

      <ReminderEditor
        reminders={reminders}
        mutePeriods={mutePeriods}
        onRemindersChange={setReminders}
        onMutePeriodsChange={setMutePeriods}
      />

      <AttachmentManager
        attachments={attachments}
        onAttachmentsChange={setAttachments}
      />

      <WebhookConfigPanel
        webhook={webhook}
        onWebhookChange={setWebhook}
        memoData={{ title, content, tags: selectedTags }}
      />

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
