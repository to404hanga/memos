import React, { useEffect, useRef, useState } from 'react';
import AiPreviewCard, { aiArgsToMemo } from './AiPreviewCard';
import AiProviderSettings from './AiProviderSettings';
import MarkdownView from './MarkdownView';
import type { AiCreateMemoArgs, AiMessage, AiModel, AiProvider, AiToolCall, MemoFormData } from '../../types/global';

interface Props {
  onClose: () => void;
  onConfirmCreate: (memo: MemoFormData) => Promise<void> | void;
  onEditDraft: (memo: MemoFormData) => void;
}

interface ToolStep {
  name: string;
  label: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

type RenderBlock =
  | { type: 'thinking'; segmentIdx: number }
  | { type: 'tool_step'; stepIdx: number };

interface DisplayMessage extends AiMessage {
  toolStatus?: Record<string, 'pending' | 'created' | 'editing'>;
  streaming?: boolean;
  serverToolHint?: string;
  toolSteps?: ToolStep[];
  thinkingSegments?: string[];
  currentSegmentIdx?: number;
  renderSequence?: RenderBlock[]; // 按时间顺序记录块
}

// "auto" 表示 Auto 模式（按全局优先级降级）
type ModelChoice = 'auto' | string; // string = modelId

export default function AiSidebar({ onClose, onConfirmCreate, onEditDraft }: Props): React.ReactElement {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [usable, setUsable] = useState<boolean | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [modelChoice, setModelChoice] = useState<ModelChoice>(() => {
    return (localStorage.getItem('ai-model-choice') as ModelChoice) || 'auto';
  });
  const [showModelMenu, setShowModelMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // textarea 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  const refresh = async () => {
    const ok = await window.api.aiHasUsableModel();
    setUsable(ok);
    setWarning(ok ? null : 'AI 当前不可用：未配置任何启用的模型，或当前离线且无本地模型。');

    const [ps, ms] = await Promise.all([window.api.aiGetProviders(), window.api.aiGetModels()]);
    setProviders(ps);
    setModels(ms);

    // 已选模型若被删/禁用，回退到 auto
    if (modelChoice !== 'auto') {
      const stillValid = ms.find((m) => m.id === modelChoice && m.enabled);
      if (!stillValid) {
        setModelChoice('auto');
        localStorage.removeItem('ai-model-choice');
      }
    }
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const handleSelectModel = (choice: ModelChoice) => {
    setModelChoice(choice);
    setShowModelMenu(false);
    if (choice === 'auto') localStorage.removeItem('ai-model-choice');
    else localStorage.setItem('ai-model-choice', choice);
  };

  // 当前选择的标签
  const selectedLabel = (() => {
    if (modelChoice === 'auto') {
      const sorted = [...models].filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
      const first = sorted[0];
      if (first) {
        const p = providers.find((x) => x.id === first.providerId);
        const display = first.displayName || first.name;
        return `🤖 Auto · 当前→ ${p?.name || '?'} / ${display}`;
      }
      return '🤖 Auto · 无可用模型';
    }
    const m = models.find((x) => x.id === modelChoice);
    if (!m) return '🤖 Auto';
    const p = providers.find((x) => x.id === m.providerId);
    const display = m.displayName || m.name;
    return `📌 ${p?.name || '?'} / ${display}`;
  })();

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    const userMsg: DisplayMessage = { role: 'user', content: text, ts: new Date().toISOString() };
    const next = [...messages, userMsg];
    setMessages(next);
    setSending(true);

    const wireMessages: AiMessage[] = next.map((m) => ({
      role: m.role,
      content: m.content,
      ts: m.ts,
    }));

    // 插入一个 streaming placeholder
    const placeholderIdx = next.length;
    setMessages((prev) => [...prev, {
      role: 'assistant',
      content: '',
      thinking: '',
      ts: new Date().toISOString(),
      streaming: true,
    }]);

    window.api.aiChatStream(
      {
        messages: wireMessages,
        modelId: modelChoice === 'auto' ? undefined : modelChoice,
      },
      (chunk) => {
        if (chunk.type === 'thinking_delta') {
          setMessages((prev) => {
            const updated = [...prev];
            const msg = { ...updated[placeholderIdx] };
            const segments = [...(msg.thinkingSegments || [])];
            const idx = msg.currentSegmentIdx ?? 0;
            const isNew = segments.length <= idx;
            if (isNew) segments.push('');
            segments[idx] = (segments[idx] || '') + (chunk.text || '');
            msg.thinkingSegments = segments;
            msg.thinking = segments.join('\n');
            // 首次出现这一段思考时，追加到 renderSequence
            if (isNew) {
              const seq = [...(msg.renderSequence || [])];
              seq.push({ type: 'thinking', segmentIdx: idx });
              msg.renderSequence = seq;
            }
            updated[placeholderIdx] = msg;
            return updated;
          });
        } else if (chunk.type === 'content_delta') {
          setMessages((prev) => {
            const updated = [...prev];
            const msg = { ...updated[placeholderIdx] };
            msg.content = (msg.content || '') + (chunk.text || '');
            updated[placeholderIdx] = msg;
            return updated;
          });
        } else if (chunk.type === 'server_tool') {
          const toolLabels: Record<string, string> = {
            list_memos: '查询备忘录',
            complete_memo: '标记完成',
            delete_memo: '删除备忘录',
          };
          const label = toolLabels[chunk.name || ''] || chunk.name || '工具调用';
          setMessages((prev) => {
            const updated = [...prev];
            const msg = { ...updated[placeholderIdx] };
            const steps = [...(msg.toolSteps || [])];
            const stepIdx = steps.length;
            steps.push({ name: chunk.name || '', label, status: 'running' });
            msg.toolSteps = steps;
            msg.serverToolHint = undefined;
            // 追加到 renderSequence
            const seq = [...(msg.renderSequence || [])];
            seq.push({ type: 'tool_step', stepIdx });
            msg.renderSequence = seq;
            updated[placeholderIdx] = msg;
            return updated;
          });
        } else if (chunk.type === 'server_tool_done') {
          setMessages((prev) => {
            const updated = [...prev];
            const msg = { ...updated[placeholderIdx] };
            const steps = [...(msg.toolSteps || [])];
            // 找到最后一个 running 状态的同名 step
            for (let i = steps.length - 1; i >= 0; i--) {
              if (steps[i].name === chunk.name && steps[i].status === 'running') {
                steps[i] = { ...steps[i], status: 'done', summary: chunk.summary };
                break;
              }
            }
            msg.toolSteps = steps;
            // 清空 content（第二轮 LLM 调用会产生新的回复）
            // 推进思考段落索引（下一轮的 thinking_delta 写入新段）
            msg.content = '';
            msg.currentSegmentIdx = (msg.currentSegmentIdx ?? 0) + 1;
            updated[placeholderIdx] = msg;
            return updated;
          });
        } else if (chunk.type === 'model_start') {
          setMessages((prev) => {
            const updated = [...prev];
            const msg = { ...updated[placeholderIdx] };
            msg.modelLabel = chunk.modelLabel;
            msg.providerName = chunk.providerName;
            msg.fallbackFrom = chunk.fallbackFrom;
            updated[placeholderIdx] = msg;
            return updated;
          });
        } else if (chunk.type === 'done') {
          const reply = chunk.message!;
          const initStatus: Record<string, 'pending'> = {};
          (reply.toolCalls || []).forEach((tc) => { initStatus[tc.id] = 'pending'; });
          setMessages((prev) => {
            const updated = [...prev];
            const existing = updated[placeholderIdx];
            updated[placeholderIdx] = {
              ...reply,
              toolStatus: initStatus,
              streaming: false,
              serverToolHint: undefined,
              toolSteps: existing.toolSteps,
              thinkingSegments: existing.thinkingSegments,
              renderSequence: existing.renderSequence,
            };
            return updated;
          });
          setSending(false);
        } else if (chunk.type === 'error') {
          setMessages((prev) => {
            const updated = [...prev];
            updated[placeholderIdx] = {
              role: 'assistant',
              content: `❌ 调用失败：${chunk.error}`,
              ts: new Date().toISOString(),
              streaming: false,
            };
            return updated;
          });
          setSending(false);
        }
      }
    );
  };

  const handleConfirm = async (msgIdx: number, tc: AiToolCall) => {
    if (tc.name !== 'create_memo') return;
    const args = (tc.arguments || {}) as AiCreateMemoArgs;
    const memo = aiArgsToMemo(args);
    await onConfirmCreate(memo);
    setMessages((prev) => prev.map((m, i) => {
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
      send();
    }
  };

  // 模型选择器菜单：按 Provider 分组
  const modelsByProvider = providers.map((p) => ({
    provider: p,
    items: models.filter((m) => m.providerId === p.id),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <aside className="ai-sidebar" onClick={(e) => e.stopPropagation()}>
        <div className="ai-chat-header">
          <h2>💬 AI 助手</h2>
          <div className="ai-chat-header-right">
            <button className="ai-icon-btn" onClick={() => { setMessages([]); }} title="新对话">＋</button>
            <button className="ai-icon-btn" onClick={() => setShowSettings(true)} title="Provider 配置">⚙️</button>
            <button className="ai-icon-btn" onClick={onClose} title="收起侧边栏">✕</button>
          </div>
        </div>

        {warning && (
          <div className="ai-chat-warning">
            <span>{warning}</span>
            <button className="ai-link-btn" onClick={() => setShowSettings(true)}>打开设置</button>
          </div>
        )}

        <div className="ai-chat-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="ai-chat-welcome">
              <div className="welcome-icon">🤖</div>
              <h3>嗨，我是你的备忘录助手</h3>
              <p>试试这样说：</p>
              <ul>
                <li>"明天下午3点提醒我开周会"</li>
                <li>"每个工作日早上9点提醒我打卡"</li>
                <li>"下周一记得交报告，加个标签：工作"</li>
              </ul>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`ai-msg ai-msg-${msg.role}`}>
              <div className="ai-msg-bubble">
                {msg.fallbackFrom && !msg.streaming && (
                  <div className="ai-fallback-tip">
                    ℹ️ 「{msg.fallbackFrom}」不可用，已自动切换到「{msg.modelLabel}」
                  </div>
                )}
                {/* 按时间顺序交错渲染思考和工具调用 */}
                {msg.renderSequence && msg.renderSequence.map((block, bi) => {
                  if (block.type === 'thinking') {
                    const seg = msg.thinkingSegments?.[block.segmentIdx];
                    if (!seg) return null;
                    const totalSegs = msg.thinkingSegments?.length || 1;
                    const isLast = block.segmentIdx === totalSegs - 1;
                    const isCurrentlyStreaming = !!msg.streaming && isLast;
                    const label = totalSegs > 1
                      ? `🧠 思考过程 (${block.segmentIdx + 1}/${totalSegs})${isCurrentlyStreaming ? '…' : ''}`
                      : `🧠 思考过程${isCurrentlyStreaming ? '…' : ''}`;
                    return (
                      <details key={`t-${bi}`} className="ai-thinking" open={isCurrentlyStreaming}>
                        <summary>{label}</summary>
                        <pre>{seg}</pre>
                      </details>
                    );
                  }
                  if (block.type === 'tool_step') {
                    const step = msg.toolSteps?.[block.stepIdx];
                    if (!step) return null;
                    return (
                      <details key={`s-${bi}`} className={`ai-tool-step status-${step.status}`} open={step.status === 'running'}>
                        <summary>
                          <span className="ai-tool-step-icon">
                            {step.status === 'running' && '⏳'}
                            {step.status === 'done' && '✅'}
                            {step.status === 'error' && '❌'}
                          </span>
                          <span className="ai-tool-step-label">{step.label}</span>
                          {step.summary && <span className="ai-tool-step-summary">{step.summary}</span>}
                        </summary>
                        <div className="ai-tool-step-detail">
                          <code>{step.name}</code>
                          {step.summary && <span> · {step.summary}</span>}
                        </div>
                      </details>
                    );
                  }
                  return null;
                })}
                {/* 兼容无 renderSequence 的旧/简单消息 */}
                {!msg.renderSequence && msg.toolSteps && msg.toolSteps.length > 0 && (
                  <div className="ai-tool-steps">
                    {msg.toolSteps.map((step, si) => (
                      <details key={si} className={`ai-tool-step status-${step.status}`} open={step.status === 'running'}>
                        <summary>
                          <span className="ai-tool-step-icon">
                            {step.status === 'running' && '⏳'}
                            {step.status === 'done' && '✅'}
                            {step.status === 'error' && '❌'}
                          </span>
                          <span className="ai-tool-step-label">{step.label}</span>
                          {step.summary && <span className="ai-tool-step-summary">{step.summary}</span>}
                        </summary>
                        <div className="ai-tool-step-detail">
                          <code>{step.name}</code>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
                {!msg.renderSequence && !msg.thinkingSegments && msg.thinking && (
                  <details className="ai-thinking" open={!!msg.streaming}>
                    <summary>🧠 思考过程{msg.streaming && '…'}</summary>
                    <pre>{msg.thinking}</pre>
                  </details>
                )}
                {msg.content && <MarkdownView content={msg.content} className="ai-msg-text" />}
                {msg.streaming && !msg.content && !msg.thinking && !msg.serverToolHint && (
                  <div className="ai-typing">
                    <span></span><span></span><span></span>
                  </div>
                )}
                {(msg.toolCalls || []).map((tc) => {
                  if (tc.name !== 'create_memo') {
                    return (
                      <div key={tc.id} className="ai-tool-unknown">
                        ⚠️ 暂不支持的工具调用：{tc.name}
                      </div>
                    );
                  }
                  const status = (msg.toolStatus && msg.toolStatus[tc.id]) || 'pending';
                  return (
                    <AiPreviewCard
                      key={tc.id}
                      args={tc.arguments as AiCreateMemoArgs}
                      status={status}
                      onConfirm={() => handleConfirm(idx, tc)}
                      onEdit={() => handleEdit(tc)}
                    />
                  );
                })}
                {msg.modelLabel && msg.role === 'assistant' && !msg.streaming && !msg.fallbackFrom && (
                  <div className="ai-msg-meta">via {msg.modelLabel}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="ai-composer-wrap">
          <div className="ai-composer">
            <textarea
              ref={textareaRef}
              className="ai-composer-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={usable === false ? '请先配置可用的模型…' : '输入消息，Enter 发送，Shift+Enter 换行'}
              disabled={sending}
              rows={1}
            />
            <div className="ai-composer-toolbar">
              <button
                className="ai-composer-model"
                onClick={() => setShowModelMenu((v) => !v)}
                title="切换模型"
              >
                <span className="ai-composer-model-label">{selectedLabel}</span>
                <span className="ai-composer-model-caret">▾</span>
              </button>
              <button
                className="ai-composer-send"
                onClick={send}
                disabled={sending || !input.trim()}
                title="发送 (Enter)"
                aria-label="发送"
              >
                {sending ? (
                  <span className="ai-composer-send-loading">…</span>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="13 6 19 12 13 18"></polyline>
                  </svg>
                )}
              </button>
            </div>
            {showModelMenu && (
              <>
                <div className="ai-model-menu-mask" onClick={() => setShowModelMenu(false)} />
                <div className="ai-model-menu">
                  <div
                    className={`ai-model-menu-item ${modelChoice === 'auto' ? 'selected' : ''}`}
                    onClick={() => handleSelectModel('auto')}
                  >
                    <span>🤖 Auto</span>
                    <span className="hint">按全局优先级自动降级</span>
                  </div>
                  <div className="ai-model-menu-divider" />
                  {modelsByProvider.length === 0 && (
                    <div className="ai-model-menu-empty">暂无模型，前往 ⚙️ 设置添加</div>
                  )}
                  {modelsByProvider.map((g) => (
                    <div key={g.provider.id}>
                      <div className="ai-model-menu-group">{g.provider.name}</div>
                      {g.items.map((m) => {
                        const display = m.displayName || m.name;
                        return (
                          <div
                            key={m.id}
                            className={`ai-model-menu-item ${modelChoice === m.id ? 'selected' : ''} ${!m.enabled ? 'disabled' : ''}`}
                            onClick={() => m.enabled && handleSelectModel(m.id)}
                          >
                            <span className="ai-menu-item-main">
                              <span className="ai-menu-item-name">{display}</span>
                              {m.thinking && <span className="ai-thinking-badge">🧠</span>}
                              {m.displayName && <span className="ai-menu-item-id"><code>{m.name}</code></span>}
                            </span>
                            {!m.enabled && <span className="hint">已禁用</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {showSettings && (
        <AiProviderSettings onClose={async () => {
          setShowSettings(false);
          await refresh();
        }} />
      )}
    </>
  );
}
