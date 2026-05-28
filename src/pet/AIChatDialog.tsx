/**
 * 宠物窗口 AI 对话框
 * 复用主应用的 useAiChat hook + AiMessageList 组件
 */
import React, { useEffect, useRef, useCallback } from 'react';
import { useAiChat } from '../hooks/useAiChat';
import AiMessageList from '../components/AiMessageList';
import { aiArgsToMemo } from '../components/AiPreviewCard';
import type { AiCreateMemoArgs, AiToolCall } from '../../types/global';
import '../styles.css';

interface Props {
  onClose: () => void;
}

export const AIChatDialog: React.FC<Props> = ({ onClose }) => {
  const chat = useAiChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.messages]);

  // Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !chat.sending) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, chat.sending]);

  // Agent 状态联动
  useEffect(() => {
    if (chat.sending) {
      (window as any).petApi.setAgentState('ai_working');
    }
  }, [chat.sending]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chat.send();
    }
  }, [chat.send]);

  // 确认创建备忘录
  const handleConfirmCreate = async (msgIdx: number, tc: AiToolCall) => {
    if (tc.name !== 'create_memo') return;
    const args = (tc.arguments || {}) as AiCreateMemoArgs;
    const memo = aiArgsToMemo(args);
    await (window as any).api.addMemo(memo);
    chat.setMessages((prev) => prev.map((m, i) => {
      if (i !== msgIdx) return m;
      return { ...m, toolStatus: { ...(m.toolStatus || {}), [tc.id]: 'created' } };
    }));
    (window as any).petApi.setAgentState('all_done');
  };

  const handleEditDraft = (_tc: AiToolCall) => {
    // 宠物窗口暂不支持编辑草稿
  };

  return (
    <div className="chat-dialog" onClick={(e) => e.stopPropagation()}>
      <div className="chat-messages" ref={scrollRef}>
        <AiMessageList
          messages={chat.messages}
          onConfirmCreate={handleConfirmCreate}
          onEditDraft={handleEditDraft}
        />
      </div>

      <div className="chat-composer">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={chat.input}
          onChange={(e) => chat.setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，Enter 发送"
          rows={1}
          disabled={chat.sending}
        />
        {chat.sending ? (
          <button className="chat-send-btn chat-abort-btn" onClick={() => { chat.handleAbort(); (window as any).petApi.setAgentState('idle'); }} title="中断">
            ⏹
          </button>
        ) : (
          <button
            className="chat-send-btn"
            onClick={() => chat.send()}
            disabled={!chat.input.trim()}
            title="发送"
          >
            ▶
          </button>
        )}
      </div>
    </div>
  );
};
