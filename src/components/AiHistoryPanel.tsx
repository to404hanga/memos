/**
 * AI 对话历史管理面板
 */
import React from 'react';
import type { AiConversationMeta } from '../../types/global';

interface Props {
  conversations: AiConversationMeta[];
  currentConvId: string | null;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export default function AiHistoryPanel({ conversations, currentConvId, onSwitch, onDelete, onClearAll }: Props): React.ReactElement {
  return (
    <div className="ai-history-panel">
      <div className="ai-history-header">
        <span>对话历史</span>
        {conversations.length > 0 && (
          <button className="ai-history-clear" onClick={onClearAll}>清空全部</button>
        )}
      </div>
      <div className="ai-history-list">
        {conversations.length === 0 && (
          <div className="ai-history-empty">暂无历史对话</div>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`ai-history-item ${c.id === currentConvId ? 'active' : ''}`}
            onClick={() => onSwitch(c.id)}
          >
            <div className="ai-history-item-title">{c.title || '新对话'}</div>
            <div className="ai-history-item-time">
              {new Date(c.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
            <button
              className="ai-history-item-del"
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
              title="删除"
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
