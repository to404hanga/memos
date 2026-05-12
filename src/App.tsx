import React, { useState, useEffect, useCallback, useRef } from 'react';
import MemoForm from './components/MemoForm';
import MemoList from './components/MemoList';
import Timeline from './components/Timeline';
import type { Memo, MemoFormData, ReminderData } from '../types/global';

type FilterType = 'all' | 'active' | 'completed';
type ViewType = 'list' | 'timeline';

export default function App(): React.ReactElement {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingMemo, setEditingMemo] = useState<Memo | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [reminder, setReminder] = useState<ReminderData | null>(null);
  const [view, setView] = useState<ViewType>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const interval = setInterval(loadMemos, 60000);

    window.api.onReminder((data: ReminderData) => {
      setReminder(data);
      loadMemos();
    });

    return () => clearInterval(interval);
  }, [loadMemos]);

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
    setShowForm(false);
  };

  const handleUpdate = async (memo: MemoFormData) => {
    await window.api.updateMemo(memo);
    await loadMemos();
    setEditingMemo(null);
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    await window.api.deleteMemo(id);
    await loadMemos();
  };

  const handleToggle = async (id: string) => {
    await window.api.toggleComplete(id);
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
    if (filter === 'active') return !m.completed;
    if (filter === 'completed') return m.completed;
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
          </div>
          <button className="add-btn" onClick={() => { setEditingMemo(null); setShowForm(true); }}>
            + 新建
          </button>
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

      {view === 'list' ? (
        <>
          <MemoList
            memos={filteredMemos}
            onToggle={handleToggle}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
          {filteredMemos.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">{searchQuery ? '🔍' : '📝'}</div>
              <p>{searchQuery ? `未找到与「${searchQuery}」相关的备忘录` : filter === 'all' ? '暂无备忘录，点击「+ 新建」添加' : '该分类下暂无内容'}</p>
            </div>
          )}
        </>
      ) : (
        <Timeline
          memos={memos}
          onToggle={handleToggle}
          onEdit={handleEdit}
        />
      )}

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
