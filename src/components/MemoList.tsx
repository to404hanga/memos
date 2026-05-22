/**
 * 备忘录列表组件
 *
 * 渲染备忘录项的容器组件，负责将备忘录数组映射为 MemoItem 组件列表。
 * 本身不包含筛选逻辑，接收已过滤的数据进行展示。
 */
import React from 'react';
import MemoItem from './MemoItem';
import type { Memo } from '../../types/global';

interface MemoListProps {
  memos: Memo[];
  onToggle: (id: string) => void;
  onEdit: (memo: Memo) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onSendToAi?: (memo: Memo) => void;
}

export default function MemoList({ memos, onToggle, onEdit, onDelete, onPin, onSendToAi }: MemoListProps): React.ReactElement {
  return (
    <div className="memo-list">
      {memos.map((memo) => (
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
    </div>
  );
}
