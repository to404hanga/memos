import React, { useState, useEffect, useCallback, useRef } from 'react';
import MemoForm from './components/MemoForm';
import MemoList from './components/MemoList';
import Timeline from './components/Timeline';
import CalendarView from './components/CalendarView';
import KanbanView from './components/KanbanView';
import type { Memo, MemoFormData, ReminderData, Tag } from '../types/global';

type FilterType = 'all' | 'active' | 'completed';
type ViewType = 'list' | 'timeline' | 'calendar' | 'kanban' | 'trash';
type ThemeMode = 'auto' | 'light' | 'dark';

export default function App(): React.ReactElement {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [trashMemos, setTrashMemos] = useState<Memo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [reminder, setReminder] = useState<ReminderData | null>(null);
  const [view, setView] = useState<ViewType>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('theme') as ThemeMode) || 'auto';
  });

  // 主题应用
  useEffect(() => {
    const applyTheme = () => {
      let dark = false;
      if (themeMode === 'dark') dark = true;
      else if (themeMode === 'auto') dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    applyTheme();
    localStorage.setItem('theme', themeMode);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [themeMode]);

  const loadMemos = useCallback(async () => {
    if (searchQuery.trim()) {
      const data = await window.api.searchMemos(searchQuery.trim());
      setMemos(data);
    } else {
      const data = await window.api.getMemos();
      setMemos(data);
    }
  }, [searchQuery]);

  useEffect(() => {
    loadMemos();
    window.api.getTags().then(setAllTags);
    const interval = setInterval(loadMemos, 60000);

    window.api.onReminder((data: ReminderData) => {
      setReminder(data);
      loadMemos();
    });

    return () => clearInterval(interval);
  }, [loadMemos]);

  const refreshTags = () => window.api.getTags().then(setAllTags);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      if (value.trim()) {
        const data = await window.api.searchMemos(value.trim());
        setMemos(data);
      } else {
        const data = await window.api.getMemos();
        setMemos(data);
      }
    }, 300);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setIsSearching(false);
    window.api.getMemos().then(setMemos);
    searchRef.current?.blur();
  };

  const handleAdd = async (memo: MemoFormData) => {
    await window.api.addMemo(memo);
    await loadMemos();
    refreshTags();
    setShowForm(false);
  };

  const handleUpdate = async (memo: MemoFormData) => {
    await window.api.updateMemo(memo);
    await loadMemos();
    refreshTags();
    setEditingMemo(null);
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await window.api.deleteMemo(id);
    await loadMemos();
    refreshTags();
  };

  const loadTrash = async () => {
    const data = await window.api.getTrash();
    setTrashMemos(data);
  };

  const handleRestore = async (id: string) => {
    await window.api.restoreMemo(id);
    await loadTrash();
    await loadMemos();
  };

  const handlePermanentDelete = async (id: string) => {
    await window.api.permanentDelete(id);
    await loadTrash();
  };

  const handleEmptyTrash = async () => {
    await window.api.emptyTrash();
    setTrashMemos([]);
  };

  const handleToggle = async (id: string) => {
    await window.api.toggleComplete(id);
    await loadMemos();
  };

  const handlePin = async (id: string) => {
    await window.api.togglePin(id);
    await loadMemos();
  };

  const handleEdit = (memo: Memo) => {
    setEditingMemo(memo);
    setShowForm(true);
  };

  const handleCancel = () => {
    setEditingMemo(null);
    setShowForm(false);
  };

  const filteredMemos = memos.filter((m) => {
    if (filter === 'active' && m.completed) return false;
    if (filter === 'completed' && !m.completed) return false;
    if (filterTag && (!m.tags || !m.tags.includes(filterTag))) return false;
    return true;
  });

  const activeCount = memos.filter((m) => !m.completed).length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <h1>备忘录</h1>
          <span className="badge">{activeCount} 项待办</span>
        </div>
        <div className="search-bar">
          <span className="search-icon">🔍</span>
          <input
            ref={searchRef}
            type="text"
            className="search-input"
            placeholder="搜索备忘录..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => setIsSearching(true)}
            onBlur={() => { if (!searchQuery) setIsSearching(false); }}
          />
          {searchQuery && (
            <button className="search-clear" onClick={clearSearch}>✕</button>
          )}
        </div>
        <div className="header-actions">
          <div className="filter-tabs">
            <button
              className={`filter-btn ${view === 'list' ? 'active' : ''}`}
              onClick={() => setView('list')}
            >
              列表
            </button>
            <button
              className={`filter-btn ${view === 'timeline' ? 'active' : ''}`}
              onClick={() => setView('timeline')}
            >
              时间轴
            </button>
            <button
              className={`filter-btn ${view === 'calendar' ? 'active' : ''}`}
              onClick={() => setView('calendar')}
            >
              日历
            </button>
            <button
              className={`filter-btn ${view === 'kanban' ? 'active' : ''}`}
              onClick={() => setView('kanban')}
            >
              看板
            </button>
            <button
              className={`filter-btn ${view === 'trash' ? 'active' : ''}`}
              onClick={() => { setView('trash'); loadTrash(); }}
            >
              回收站
            </button>
          </div>
          <div className="header-right">
            <button className="add-btn" onClick={() => { setEditingMemo(null); setShowForm(true); }}>
              + 新建
            </button>
            <div className="theme-toggle">
              <button className={`theme-btn ${themeMode === 'auto' ? 'active' : ''}`} onClick={() => setThemeMode('auto')} title="跟随系统">🌗</button>
              <button className={`theme-btn ${themeMode === 'light' ? 'active' : ''}`} onClick={() => setThemeMode('light')} title="浅色">☀️</button>
              <button className={`theme-btn ${themeMode === 'dark' ? 'active' : ''}`} onClick={() => setThemeMode('dark')} title="深色">🌙</button>
            </div>
          </div>
        </div>
        {view === 'list' && (
          <div className="sub-filter">
            {(['all', 'active', 'completed'] as FilterType[]).map((f) => (
              <button
                key={f}
                className={`sub-filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? '全部' : f === 'active' ? '待办' : '已完成'}
              </button>
            ))}
          </div>
        )}
        {allTags.length > 0 && (
          <div className="tag-filter">
            <button
              className={`tag-filter-btn ${filterTag === null ? 'active' : ''}`}
              onClick={() => setFilterTag(null)}
            >
              全部标签
            </button>
            {allTags.map((tag) => (
              <button
                key={tag.id}
                className={`tag-filter-btn ${filterTag === tag.name ? 'active' : ''}`}
                style={{ '--tag-color': tag.color } as React.CSSProperties}
                onClick={() => setFilterTag(filterTag === tag.name ? null : tag.name)}
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {showForm && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <MemoForm
              memo={editingMemo}
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
            memos={filteredMemos}
            onToggle={handleToggle}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onPin={handlePin}
          />
          {filteredMemos.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">{searchQuery ? '🔍' : '📝'}</div>
              <p>{searchQuery ? `未找到与「${searchQuery}」相关的备忘录` : filter === 'all' ? '暂无备忘录，点击「+ 新建」添加' : '该分类下暂无内容'}</p>
            </div>
          )}
        </>
      ) : view === 'timeline' ? (
        <Timeline
          memos={memos}
          onToggle={handleToggle}
          onEdit={handleEdit}
        />
      ) : view === 'calendar' ? (
        <CalendarView
          memos={memos}
          onEdit={handleEdit}
          onToggle={handleToggle}
        />
      ) : view === 'kanban' ? (
        <KanbanView
          memos={memos}
          onEdit={handleEdit}
          onToggle={handleToggle}
          onPin={handlePin}
        />
      ) : (
        <div className="trash-view">
          {trashMemos.length > 0 && (
            <div className="trash-header">
              <span className="trash-info">{trashMemos.length} 项已删除（30 天后自动清理）</span>
              <button className="trash-empty-btn" onClick={handleEmptyTrash}>清空回收站</button>
            </div>
          )}
          <div className="memo-list">
            {trashMemos.map((memo) => (
              <div key={memo.id} className="memo-item trash-item">
                <div className="memo-main">
                  <div className="memo-content">
                    <h3 className="memo-title">{memo.title}</h3>
                    {memo.content && (
                      <p className="memo-desc">{memo.content.replace(/[#*`!\[\]()]/g, '').substring(0, 60)}</p>
                    )}
                    <div className="trash-meta">
                      删除于 {new Date(memo.deletedAt!).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
                <div className="memo-actions">
                  <button className="action-btn restore" onClick={() => handleRestore(memo.id)} title="恢复">
                    ↩️
                  </button>
                  <button className="action-btn delete" onClick={() => handlePermanentDelete(memo.id)} title="永久删除">
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
          {trashMemos.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">🗑️</div>
              <p>回收站为空</p>
            </div>
          )}
        </div>
      )}
      </div>

      {reminder && (
        <div className="reminder-overlay" onClick={() => setReminder(null)}>
          <div className="reminder-popup" onClick={(e) => e.stopPropagation()}>
            <div className="reminder-icon-large">⏰</div>
            <h2>提醒时间到！</h2>
            <h3>{reminder.title}</h3>
            {reminder.content && <p className="reminder-content">{reminder.content}</p>}
            <button className="btn-submit" onClick={() => setReminder(null)}>
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
