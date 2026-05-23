/**
 * 备忘录列表组件（渐进式渲染）
 *
 * 当列表超过 PAGE_SIZE 条时，先渲染前 PAGE_SIZE 条，
 * 滚动到底部时自动加载更多，避免大列表一次性渲染所有 DOM。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import MemoItem from './MemoItem';
import type { Memo } from '../../types/global';

const PAGE_SIZE = 50;

interface MemoListProps {
  memos: Memo[];
  onToggle: (id: string) => void;
  onEdit: (memo: Memo) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onSendToAi?: (memo: Memo) => void;
}

export default function MemoList({ memos, onToggle, onEdit, onDelete, onPin, onSendToAi }: MemoListProps): React.ReactElement {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // memos 列表变化时重置分页
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [memos]);

  // IntersectionObserver 监听底部哨兵元素
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, memos.length));
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [memos.length]);

  const displayed = memos.slice(0, visibleCount);
  const hasMore = visibleCount < memos.length;

  return (
    <div className="memo-list">
      {displayed.map((memo) => (
        <MemoItem
          key={memo.id}
          memo={memo}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          onPin={onPin}
          onSendToAi={onSendToAi}
        />
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="memo-list-sentinel">
          <span className="memo-list-loading">加载更多...</span>
        </div>
      )}
    </div>
  );
}
