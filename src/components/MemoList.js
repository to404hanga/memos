import React from 'react';
import MemoItem from './MemoItem';

export default function MemoList({ memos, onToggle, onEdit, onDelete }) {
  return (
    <div className="memo-list">
      {memos.map((memo) => (
        <MemoItem
          key={memo.id}
          memo={memo}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
