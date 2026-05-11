import React, { useState, useEffect, useCallback } from 'react';
import MemoForm from './components/MemoForm';
import MemoList from './components/MemoList';
import Timeline from './components/Timeline';

export default function App() {
  const [memos, setMemos] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingMemo, setEditingMemo] = useState(null);
  const [filter, setFilter] = useState('all'); // all | active | completed
  const [reminder, setReminder] = useState(null);
  const [view, setView] = useState('list'); // list | timeline

  const loadMemos = useCallback(async () => {
    const data = await window.api.getMemos();
    setMemos(data);
  }, []);

  useEffect(() => {
    loadMemos();
    const interval = setInterval(loadMemos, 60000);

    // 监听主进程的提醒事件
    window.api.onReminder((data) => {
      setReminder(data);
      loadMemos();
    });

    return () => clearInterval(interval);
  }, [loadMemos]);

  const handleAdd = async (memo) => {
    await window.api.addMemo(memo);
    await loadMemos();
    setShowForm(false);
  };

  const handleUpdate = async (memo) => {
    await window.api.updateMemo(memo);
    await loadMemos();
    setEditingMemo(null);
    setShowForm(false);
  };

  const handleDelete = async (id) => {
    await window.api.deleteMemo(id);
    await loadMemos();
  };

  const handleToggle = async (id) => {
    await window.api.toggleComplete(id);
    await loadMemos();
  };

  const handleEdit = (memo) => {
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
            {['all', 'active', 'completed'].map((f) => (
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
              <div className="empty-icon">📝</div>
              <p>{filter === 'all' ? '暂无备忘录，点击「+ 新建」添加' : '该分类下暂无内容'}</p>
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
