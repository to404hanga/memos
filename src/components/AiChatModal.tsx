/**
 * AI 聊天侧边栏组件
 *
 * 应用的核心 AI 交互界面，以侧边栏形式展示。
 * 通过子组件和 hook 拆分实现职责分离：
 * - useAiChat: 状态管理 + 发送逻辑
 * - AiMessageList: 消息渲染
 * - AiModelSelector: 模型选择菜单
 * - AiHistoryPanel: 历史管理面板
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { aiArgsToMemo } from './AiPreviewCard';
import AiProviderSettings from './AiProviderSettings';
import AiMessageList from './AiMessageList';
import AiModelSelector from './AiModelSelector';
import AiHistoryPanel from './AiHistoryPanel';
import { useAiChat } from '../hooks/useAiChat';
import type { AiCreateMemoArgs, AiToolCall, MemoFormData } from '../../types/global';

interface Props {
  onClose: () => void;
  onConfirmCreate: (memo: MemoFormData) => Promise<void> | void;
  onEditDraft: (memo: MemoFormData) => void;
  attachedMemo?: { id: string; title: string; content?: string; tags?: string[] } | null;
  attachKey?: number;
}

export default function AiSidebar({ onClose, onConfirmCreate, onEditDraft, attachedMemo, attachKey }: Props): React.ReactElement {
  const chat = useAiChat();
  const [showSettings, setShowSettings] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(420);

  // 拖拽调整侧边栏宽度
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarRef.current?.offsetWidth || 420;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const windowWidth = window.innerWidth;
      const maxWidth = windowWidth * 0.5;
      const minWidth = 420;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // textarea 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [chat.input]);

  // 外部附加备忘录
  useEffect(() => {
    if (attachedMemo) {
      chat.setAttachedMemos((prev) => {
        if (prev.some((m) => m.id === attachedMemo.id)) return prev;
        return [...prev, attachedMemo];
      });
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [attachedMemo, attachKey]);

  // 自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.messages, chat.sending]);

  const handleConfirm = async (msgIdx: number, tc: AiToolCall) => {
    if (tc.name !== 'create_memo') return;
    const args = (tc.arguments || {}) as AiCreateMemoArgs;
    const memo = aiArgsToMemo(args);
    await onConfirmCreate(memo);
    chat.setMessages((prev) => prev.map((m, i) => {
      if (i !== msgIdx) return m;
      return { ...m, toolStatus: { ...(m.toolStatus || {}), [tc.id]: 'created' } };
    }));
  };

  const handleEdit = (tc: AiToolCall) => {
    if (tc.name !== 'create_memo') return;
    const args = (tc.arguments || {}) as AiCreateMemoArgs;
    onEditDraft(aiArgsToMemo(args));
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chat.send();
    }
  };

  return (
    <>
      <aside className="ai-sidebar" ref={sidebarRef} style={{ width: sidebarWidth }} onClick={(e) => e.stopPropagation()}>
        <div className="ai-sidebar-resize-handle" onMouseDown={handleResizeMouseDown} />
        <div className="ai-chat-header">
          <h2>💬 AI 助手</h2>
          <div className="ai-chat-header-right">
            <button className="ai-icon-btn" onClick={() => { chat.startNewConversation(); setShowHistory(false); }} title="新对话">＋</button>
            <button className="ai-icon-btn" onClick={() => { setShowHistory((v) => !v); chat.loadConversations(); }} title="历史对话">🕓</button>
            <button className="ai-icon-btn" onClick={() => setShowSettings(true)} title="Provider 配置">⚙️</button>
            <button className="ai-icon-btn" onClick={onClose} title="收起侧边栏">✕</button>
          </div>
        </div>

        {chat.warning && (
          <div className="ai-chat-warning">
            <span>{chat.warning}</span>
            <button className="ai-link-btn" onClick={() => setShowSettings(true)}>打开设置</button>
          </div>
        )}

        {showHistory && (
          <AiHistoryPanel
            conversations={chat.conversations}
            currentConvId={chat.currentConvId}
            onSwitch={(id) => { chat.switchConversation(id); setShowHistory(false); }}
            onDelete={chat.deleteConversation}
            onClearAll={chat.clearAllConversations}
          />
        )}

        <div className="ai-chat-messages" ref={scrollRef}>
          <AiMessageList
            messages={chat.messages}
            onConfirmCreate={handleConfirm}
            onEditDraft={handleEdit}
          />
        </div>

        <div className="ai-composer-wrap">
          <div className="ai-composer">
            {chat.attachedMemos.length > 0 && (
              <div className="ai-attached-memos">
                {chat.attachedMemos.map((m) => (
                  <div key={m.id} className="ai-attached-chip">
                    <span className="ai-attached-chip-icon">📝</span>
                    <span className="ai-attached-chip-title">{m.title}</span>
                    <button
                      className="ai-attached-chip-remove"
                      onClick={() => chat.setAttachedMemos((prev) => prev.filter((x) => x.id !== m.id))}
                      title="移除"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              className="ai-composer-input"
              value={chat.input}
              onChange={(e) => chat.setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={chat.usable === false ? '请先配置可用的模型…' : '输入消息，Enter 发送，Shift+Enter 换行'}
              disabled={chat.sending}
              rows={1}
            />
            <div className="ai-composer-toolbar">
              <button
                className="ai-composer-model"
                onClick={() => setShowModelMenu((v) => !v)}
                title={chat.autoModelTitle}
              >
                <span className="ai-composer-model-label">{chat.selectedLabel}</span>
                <span className="ai-composer-model-caret">▾</span>
              </button>
              {chat.sending ? (
                <button
                  className="ai-composer-send abort"
                  onClick={chat.handleAbort}
                  title="打断 (Stop)"
                  aria-label="打断"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <div className="ai-composer-right">
                  {chat.contextInfo.maxK > 0 && (
                    <div className="ai-context-ring" title={`上下文 ${chat.contextInfo.usedK}K / ${chat.contextInfo.maxK}K`}>
                      <svg viewBox="0 0 24 24" width="32" height="32">
                        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border-input)" strokeWidth="2" />
                        <circle
                          cx="12" cy="12" r="9" fill="none"
                          stroke={chat.contextInfo.color}
                          strokeWidth="2"
                          strokeDasharray={`${chat.contextInfo.ratio * 56.5} 56.5`}
                          strokeLinecap="round"
                          transform="rotate(-90 12 12)"
                        />
                      </svg>
                    </div>
                  )}
                  <button
                    className="ai-composer-send"
                    onClick={chat.send}
                    disabled={!chat.input.trim() && chat.attachedMemos.length === 0}
                    title="发送 (Enter)"
                    aria-label="发送"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="13 6 19 12 13 18"></polyline>
                  </svg>
                </button>
                </div>
              )}
            </div>
            {showModelMenu && (
              <AiModelSelector
                modelChoice={chat.modelChoice}
                models={chat.models}
                providers={chat.providers}
                onSelect={(choice) => { chat.handleSelectModel(choice); setShowModelMenu(false); }}
                onClose={() => setShowModelMenu(false)}
              />
            )}
          </div>
        </div>
      </aside>

      {showSettings && (
        <AiProviderSettings onClose={async () => {
          setShowSettings(false);
          await chat.refresh();
        }} />
      )}
    </>
  );
}
