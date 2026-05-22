/**
 * 主应用组件
 *
 * 整个备忘录应用的顶层组件，负责：
 * 1. 视图切换：列表 / 时间轴 / 日历 / 看板 / 回收站
 * 2. 搜索功能：关键词模糊搜索备忘录
 * 3. 标签筛选：按标签过滤备忘录
 * 4. 主题切换：浅色 / 深色 / 跟随系统
 * 5. AI 侧边栏：打开/关闭 AI 助手
 * 6. 表单弹窗：新建/编辑备忘录
 * 7. 提醒弹窗：接收主进程推送的到时提醒
 * 8. 数据导入导出
 */
import React, { useState, useRef } from 'react';
import MemoForm from './components/MemoForm';
import MemoList from './components/MemoList';
import Timeline from './components/Timeline';
import CalendarView from './components/CalendarView';
import KanbanView from './components/KanbanView';
import AiChatModal from './components/AiChatModal';
import { useTheme } from './hooks/useTheme';
import { useMemos } from './hooks/useMemos';
import type { Memo, MemoFormData, ReminderData } from '../types/global';

/** 应用支持的视图类型 */
type ViewType = 'list' | 'timeline' | 'calendar' | 'kanban' | 'trash';

export default function App(): React.ReactElement {
  const { themeMode, setThemeMode } = useTheme();
  const memo = useMemos();
  const [view, setView] = useState<ViewType>('list');
  const [showForm, setShowForm] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null);
  const [showAiChat, setShowAiChat] = useState(false);
  const [aiDraft, setAiDraft] = useState<MemoFormData | null>(null);
  const [aiAttachedMemo, setAiAttachedMemo] = useState<Memo | null>(null);
  const aiInputKey = useRef(0);
  const [reminder, setReminder] = useState<ReminderData | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // 提醒事件
  React.useEffect(() => {
    window.api.onReminder((data: ReminderData) => {
      setReminder(data);
      memo.loadMemos();
    });
  }, []);

  const handleAdd = async (data: MemoFormData) => {
    await memo.addMemo(data);
    setAiDraft(null);
    setShowForm(false);
  };

  const handleUpdate = async (data: MemoFormData) => {
    await memo.updateMemo(data);
    setEditingMemo(null);
    setShowForm(false);
  };

  const handleEdit = (m: Memo) => {
    setEditingMemo(m);
    setShowForm(true);
  };

  const handleCancel = () => {
    setEditingMemo(null);
    setAiDraft(null);
    setShowForm(false);
  };

  const handleSendToAi = (m: Memo) => {
    aiInputKey.current += 1;
    setAiAttachedMemo(m);
    setShowAiChat(true);
  };

  return (
    <div className={`app ${showAiChat ? 'with-ai-sidebar' : ''}`}>
      <div className="app-main">
      <header className="app-header">
        <div className="header-top">
          <h1>备忘录</h1>
          <span className="badge">{memo.activeCount} 项待办</span>
        </div>
        <div className="search-bar">
          <span className="search-icon">🔍</span>
          <input
            ref={searchRef}
            type="text"
            className="search-input"
            placeholder="搜索备忘录..."
            value={memo.searchQuery}
            onChange={(e) => memo.handleSearchChange(e.target.value)}
            onFocus={() => setIsSearching(true)}
            onBlur={() => { if (!memo.searchQuery) setIsSearching(false); }}
          />
          {memo.searchQuery && (
            <button className="search-clear" onClick={() => { memo.clearSearch(); setIsSearching(false); searchRef.current?.blur(); }}>✕</button>
          )}
        </div>
        <div className="header-actions">
          <div className="filter-tabs">
            <button className={`filter-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>列表</button>
            <button className={`filter-btn ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')}>时间轴</button>
            <button className={`filter-btn ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>日历</button>
            <button className={`filter-btn ${view === 'kanban' ? 'active' : ''}`} onClick={() => setView('kanban')}>看板</button>
            <button className={`filter-btn ${view === 'trash' ? 'active' : ''}`} onClick={() => { setView('trash'); memo.loadTrash(); }}>回收站</button>
          </div>
          <div className="header-right">
            <div className="io-btns">
              <button className="io-btn" onClick={memo.exportData} title="导出数据">📤</button>
              <button className="io-btn" onClick={memo.importData} title="导入数据">📥</button>
            </div>
            <button className="add-btn" onClick={() => { setEditingMemo(null); setShowForm(true); }}>+ 新建</button>
            <div className="theme-toggle">
              <button className={`theme-btn ${themeMode === 'auto' ? 'active' : ''}`} onClick={() => setThemeMode('auto')} title="跟随系统">🌗</button>
              <button className={`theme-btn ${themeMode === 'light' ? 'active' : ''}`} onClick={() => setThemeMode('light')} title="浅色">☀️</button>
              <button className={`theme-btn ${themeMode === 'dark' ? 'active' : ''}`} onClick={() => setThemeMode('dark')} title="深色">🌙</button>
            </div>
            <button
              className={`ai-toggle-btn ${showAiChat ? 'active' : ''}`}
              onClick={() => setShowAiChat((v) => !v)}
              title={showAiChat ? '收起 AI 助手' : '打开 AI 助手'}
            >🤖</button>
          </div>
        </div>
        {view === 'list' && (
          <div className="sub-filter">
            {(['all', 'active', 'completed'] as const).map((f) => (
              <button
                key={f}
                className={`sub-filter-btn ${memo.filter === f ? 'active' : ''}`}
                onClick={() => memo.setFilter(f)}
              >
                {f === 'all' ? '全部' : f === 'active' ? '待办' : '已完成'}
              </button>
            ))}
          </div>
        )}
        {memo.allTags.length > 0 && (
          <div className="tag-filter">
            <button
              className={`tag-filter-btn ${memo.filterTag === null ? 'active' : ''}`}
              onClick={() => memo.setFilterTag(null)}
            >全部标签</button>
            <button
              className={`tag-filter-btn ${memo.filterTag === '__none__' ? 'active' : ''}`}
              onClick={() => memo.setFilterTag(memo.filterTag === '__none__' ? null : '__none__')}
            >无标签</button>
            {memo.allTags.map((tag) => (
              <button
                key={tag.id}
                className={`tag-filter-btn ${memo.filterTag === tag.name ? 'active' : ''}`}
                style={{ '--tag-color': tag.color } as React.CSSProperties}
                onClick={() => memo.setFilterTag(memo.filterTag === tag.name ? null : tag.name)}
              >{tag.name}</button>
            ))}
          </div>
        )}
      </header>

      {showForm && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <MemoForm
              memo={editingMemo || (aiDraft ? {
                id: '',
                title: aiDraft.title,
                content: aiDraft.content,
                reminderTime: aiDraft.reminderTime || null,
                recurrence: aiDraft.recurrence || null,
                reminders: aiDraft.reminders || [],
                mutePeriods: aiDraft.mutePeriods || [],
                attachments: aiDraft.attachments || [],
                webhook: aiDraft.webhook || null,
                completed: false,
                pinned: false,
                tags: aiDraft.tags || [],
                createdAt: new Date().toISOString(),
                deletedAt: null,
              } : null)}
              onSubmit={editingMemo ? handleUpdate : handleAdd}
              onCancel={handleCancel}
            />
          </div>
        </div>
      )}

      <div className={`app-content ${view === 'calendar' || view === 'kanban' ? 'no-scroll' : ''}`}>
      {view === 'list' ? (
        <>
          <MemoList
            memos={memo.filteredMemos}
            onToggle={memo.toggleComplete}
            onEdit={handleEdit}
            onDelete={memo.deleteMemo}
            onPin={memo.togglePin}
            onSendToAi={handleSendToAi}
          />
          {memo.filteredMemos.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">{memo.searchQuery ? '🔍' : '📝'}</div>
              <p>{memo.searchQuery ? `未找到与「${memo.searchQuery}」相关的备忘录` : memo.filter === 'all' ? '暂无备忘录，点击「+ 新建」添加' : '该分类下暂无内容'}</p>
            </div>
          )}
        </>
      ) : view === 'timeline' ? (
        <Timeline memos={memo.tagFilteredMemos} onToggle={memo.toggleComplete} onEdit={handleEdit} />
      ) : view === 'calendar' ? (
        <CalendarView memos={memo.tagFilteredMemos} onEdit={handleEdit} onToggle={memo.toggleComplete} />
      ) : view === 'kanban' ? (
        <KanbanView memos={memo.tagFilteredMemos} onEdit={handleEdit} onToggle={memo.toggleComplete} onPin={memo.togglePin} />
      ) : (
        <div className="trash-view">
          {memo.tagFilteredTrash.length > 0 && (
            <div className="trash-header">
              <span className="trash-info">{memo.tagFilteredTrash.length} 项已删除（30 天后自动清理）</span>
              <button className="trash-empty-btn" onClick={memo.emptyTrash}>清空回收站</button>
            </div>
          )}
          <div className="memo-list">
            {memo.tagFilteredTrash.map((m) => (
              <div key={m.id} className="memo-item trash-item">
                <div className="memo-main">
                  <div className="memo-content">
                    <h3 className="memo-title">{m.title}</h3>
                    {m.content && <p className="memo-desc">{m.content.replace(/[#*`!\[\]()]/g, '').substring(0, 60)}</p>}
                    <div className="trash-meta">
                      删除于 {new Date(m.deletedAt!).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
                <div className="memo-actions">
                  <button className="action-btn restore" onClick={() => memo.restoreMemo(m.id)} title="恢复">↩️</button>
                  <button className="action-btn delete" onClick={() => memo.permanentDelete(m.id)} title="永久删除">🗑️</button>
                </div>
              </div>
            ))}
          </div>
          {memo.tagFilteredTrash.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">🗑️</div>
              <p>回收站为空</p>
            </div>
          )}
        </div>
      )}
      </div>
      </div>{/* /app-main */}

      {showAiChat && (
        <AiChatModal
          onClose={() => { setShowAiChat(false); setAiAttachedMemo(null); }}
          attachedMemo={aiAttachedMemo}
          attachKey={aiInputKey.current}
          onConfirmCreate={async (m) => {
            await memo.addMemoWithTags(m);
          }}
          onEditDraft={(m) => {
            setEditingMemo(null);
            setAiDraft(m);
            setShowAiChat(false);
            setShowForm(true);
          }}
        />
      )}

      {reminder && (
        <div className="reminder-overlay" onClick={() => setReminder(null)}>
          <div className="reminder-popup" onClick={(e) => e.stopPropagation()}>
            <div className="reminder-icon-large">⏰</div>
            <h2>提醒时间到！</h2>
            <h3>{reminder.title}</h3>
            {reminder.content && <p className="reminder-content">{reminder.content}</p>}
            <button className="btn-submit" onClick={() => setReminder(null)}>知道了</button>
          </div>
        </div>
      )}
    </div>
  );
}
