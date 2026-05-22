/**
 * 看板视图组件
 *
 * 以三列看板形式展示备忘录的工作流状态：
 * - 待办（todo）：未完成 + 未置顶的备忘录
 * - 进行中（doing）：未完成 + 已置顶的备忘录
 * - 已完成（done）：已标记完成的备忘录
 *
 * 交互特性：
 * - 支持拖拽卡片在列之间移动，自动触发状态变更
 * - 拖入"已完成"列 → 标记完成
 * - 拖入"进行中"列 → 取消完成 + 设为置顶
 * - 拖入"待办"列 → 取消完成 + 取消置顶
 * - 卡片显示标题、内容摘要、标签和提醒图标
 * - 点击卡片进入编辑
 */
import React, { useState, useRef, useMemo } from 'react';
import type { Memo } from '../../types/global';

interface KanbanViewProps {
  memos: Memo[];
  onEdit: (memo: Memo) => void;
  onToggle: (id: string) => void;
  onPin: (id: string) => void;
}

type KanbanColumn = 'todo' | 'doing' | 'done';

const COLUMNS: { key: KanbanColumn; title: string; icon: string }[] = [
  { key: 'todo', title: '待办', icon: '📋' },
  { key: 'doing', title: '进行中', icon: '🚀' },
  { key: 'done', title: '已完成', icon: '✅' },
];

export default function KanbanView({ memos, onEdit, onToggle, onPin }: KanbanViewProps): React.ReactElement {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanColumn | null>(null);
  const dragCountRef = useRef<Record<string, number>>({ todo: 0, doing: 0, done: 0 });

  const getColumn = (memo: Memo): KanbanColumn => {
    if (memo.completed) return 'done';
    if (memo.pinned) return 'doing';
    return 'todo';
  };

  const grouped = useMemo(() => {
    const result: Record<KanbanColumn, Memo[]> = { todo: [], doing: [], done: [] };
    memos.forEach((m) => {
      result[getColumn(m)].push(m);
    });
    return result;
  }, [memos]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setDragOverCol(null);
    dragCountRef.current = { todo: 0, doing: 0, done: 0 };
  };

  const handleDragEnter = (e: React.DragEvent, col: KanbanColumn) => {
    e.preventDefault();
    dragCountRef.current[col]++;
    setDragOverCol(col);
  };

  const handleDragLeave = (e: React.DragEvent, col: KanbanColumn) => {
    e.preventDefault();
    dragCountRef.current[col]--;
    if (dragCountRef.current[col] <= 0) {
      dragCountRef.current[col] = 0;
      if (dragOverCol === col) setDragOverCol(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetCol: KanbanColumn) => {
    e.preventDefault();
    setDragOverCol(null);
    dragCountRef.current = { todo: 0, doing: 0, done: 0 };

    if (!dragId) return;
    const memo = memos.find((m) => m.id === dragId);
    if (!memo) return;

    const currentCol = getColumn(memo);
    if (currentCol === targetCol) return;

    // 根据目标列决定操作
    if (targetCol === 'done') {
      // 移到已完成
      if (!memo.completed) await onToggle(memo.id);
    } else if (targetCol === 'doing') {
      // 移到进行中 = pinned + 未完成
      if (memo.completed) await onToggle(memo.id);
      if (!memo.pinned) await onPin(memo.id);
    } else {
      // 移到待办 = 未完成 + 不 pinned
      if (memo.completed) await onToggle(memo.id);
      if (memo.pinned) await onPin(memo.id);
    }

    setDragId(null);
  };

  return (
    <div className="kanban-view">
      {COLUMNS.map((col) => (
        <div
          key={col.key}
          className={`kanban-column ${dragOverCol === col.key ? 'drag-over' : ''}`}
          onDragEnter={(e) => handleDragEnter(e, col.key)}
          onDragLeave={(e) => handleDragLeave(e, col.key)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, col.key)}
        >
          <div className="kanban-col-header">
            <span className="kanban-col-icon">{col.icon}</span>
            <span className="kanban-col-title">{col.title}</span>
            <span className="kanban-col-count">{grouped[col.key].length}</span>
          </div>
          <div className="kanban-col-body">
            {grouped[col.key].map((memo) => (
              <div
                key={memo.id}
                className={`kanban-card ${dragId === memo.id ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, memo.id)}
                onDragEnd={handleDragEnd}
                onClick={() => onEdit(memo)}
              >
                <div className="kanban-card-title">{memo.title}</div>
                {memo.content && (
                  <div className="kanban-card-desc">
                    {memo.content.replace(/[#*`!\[\]()]/g, '').substring(0, 80)}
                  </div>
                )}
                <div className="kanban-card-footer">
                  {memo.tags && memo.tags.length > 0 && (
                    <div className="kanban-card-tags">
                      {memo.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="kanban-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                  {memo.reminders && memo.reminders.length > 0 && (
                    <span className="kanban-card-reminder">⏰</span>
                  )}
                </div>
              </div>
            ))}
            {grouped[col.key].length === 0 && (
              <div className="kanban-empty">
                拖拽卡片到此列
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
