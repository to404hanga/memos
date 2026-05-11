import React from 'react';
import MemoItem from './MemoItem';
import type { Memo } from '../../types/global';

interface MemoListProps {
  memos: Memo[];
  onToggle: (id: string) => void;
  onEdit: (memo: Memo) => void;
  onDelete: (id: string) => void;
}

export default function MemoList({ memos, onToggle, onEdit, onDelete }: MemoListProps): React.ReactElement {
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
