/**
 * AI 聊天侧边栏组件
 *
 * 应用的核心 AI 交互界面，以侧边栏形式展示，功能包括：
 * - 流式对话：实时展示 AI 的思考过程和回复内容
 * - 多轮工具调用：AI 可执行服务端工具（查询/创建/修改/删除备忘录），展示执行步骤
 * - 模型选择：支持 Auto 模式（按优先级降级）或手动指定模型
 * - 上下文环形指示器：实时显示对话上下文使用量占比
 * - 对话历史管理：新建/切换/删除/清空对话
 * - 中断响应：允许用户中途打断 AI 回复
 * - 预览卡片：AI 创建备忘录时展示预览，用户确认后执行
 * - Provider 设置入口：快捷进入 AI 配置面板
 */
import React, { useEffect, useRef, useState } from 'react';
import AiPreviewCard, { aiArgsToMemo } from './AiPreviewCard';
import AiProviderSettings from './AiProviderSettings';
import MarkdownView from './MarkdownView';
import type { AiConversationMeta, AiCreateMemoArgs, AiMessage, AiModel, AiProvider, AiToolCall, MemoFormData } from '../../types/global';

/** 组件属性 */
interface Props {
  /** 关闭侧边栏回调 */
  onClose: () => void;
  /** 确认创建备忘录回调（用户点击预览卡片的"创建"按钮） */
  onConfirmCreate: (memo: MemoFormData) => Promise<void> | void;
  /** 编辑草稿回调（用户点击预览卡片的"修改"按钮，跳转到表单编辑） */
  onEditDraft: (memo: MemoFormData) => void;
  /** 外部附加的备忘录（如右键菜单"发送到 AI"），以标签卡片形式展示 */
  attachedMemo?: { id: string; title: string; content?: string; tags?: string[] } | null;
  /** 配合 attachedMemo 使用，每次变化时重新触发附加 */
  attachKey?: number;
}

/** 服务端工具执行步骤 */
interface ToolStep {
  /** 工具名称 */
  name: string;
  /** 工具中文标签（如"查询备忘录"） */
  label: string;
  /** 执行状态 */
  status: 'running' | 'done' | 'error';
  /** 执行摘要（如"找到 5 条"） */
  summary?: string;
}

/**
 * 渲染块类型
 * 用于按时间顺序交错展示"思考过程"和"工具调用步骤"
 */
type RenderBlock =
  | { type: 'thinking'; segmentIdx: number }
  | { type: 'tool_step'; stepIdx: number };

/**
 * 扩展的消息类型（仅前端展示用）
 * 在 AiMessage 基础上增加了流式状态、工具执行状态等 UI 相关字段
 */
interface DisplayMessage extends AiMessage {
  /** 各 create_memo 工具调用的操作状态 */
  toolStatus?: Record<string, 'pending' | 'created' | 'editing'>;
  /** 是否正在流式接收中 */
  streaming?: boolean;
  /** 服务端工具执行提示文本（已弃用） */
  serverToolHint?: string;
  /** 服务端工具执行步骤列表 */
  toolSteps?: ToolStep[];
  /** 多段思考内容数组（多轮工具调用时会产生多段思考） */
  thinkingSegments?: string[];
  /** 当前写入的思考段索引 */
  currentSegmentIdx?: number;
  /** 按时间顺序记录的渲染块序列（思考和工具步骤交错排列） */
  renderSequence?: RenderBlock[];
}

/** 模型选择：'auto' 表示自动降级模式，string 为具体 modelId */
type ModelChoice = 'auto' | string;

export default function AiSidebar({ onClose, onConfirmCreate, onEditDraft, attachedMemo, attachKey }: Props): React.ReactElement {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachedMemos, setAttachedMemos] = useState<Array<{ id: string; title: string; content?: string; tags?: string[] }>>([]);
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [usable, setUsable] = useState<boolean | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const activeStreamId = useRef<string | null>(null);
  const [modelChoice, setModelChoice] = useState<ModelChoice>(() => {
    return (localStorage.getItem('ai-model-choice') as ModelChoice) || 'auto';
  });
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState<AiConversationMeta[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 生成新对话 ID
  const newConvId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // 加载历史列表
  const loadConversations = async () => {
    const list = await window.api.aiGetConversations();
    setConversations(list);
  };

  // 保存当前对话到 DB
  const saveCurrentConversation = async (msgs: DisplayMessage[], convId: string | null) => {
    if (!msgs.length) return;
    const id = convId || newConvId();
    // 标题取第一条用户消息前 20 字
    const firstUser = msgs.find((m) => m.role === 'user');
    const title = firstUser ? firstUser.content.slice(0, 20) : '新对话';
    // 只保存 role/content/toolCalls/thinking/modelLabel/fallbackFrom/ts（精简）
    const toSave = msgs.map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      thinking: m.thinking,
      modelLabel: m.modelLabel,
      fallbackFrom: m.fallbackFrom,
      ts: m.ts,
    }));
    await window.api.aiSaveConversation({ id, title, messages: toSave as AiMessage[] });
    if (!convId) setCurrentConvId(id);
    return id;
  };

  // 切换到历史对话
  const switchConversation = async (id: string) => {
    // 先保存当前（如果有内容）
    if (messages.length > 0 && currentConvId) {
      await saveCurrentConversation(messages, currentConvId);
    }
    const conv = await window.api.aiGetConversation(id);
    if (conv) {
      setMessages(conv.messages as DisplayMessage[]);
      setCurrentConvId(id);
    }
    setShowHistory(false);
  };

  // 新对话
  const startNewConversation = async () => {
    if (messages.length > 0 && currentConvId) {
      await saveCurrentConversation(messages, currentConvId);
    }
    setMessages([]);
    setCurrentConvId(null);
    setShowHistory(false);
  };

  // 删除对话
  const deleteConversation = async (id: string) => {
    await window.api.aiDeleteConversation(id);
    if (currentConvId === id) {
      setMessages([]);
      setCurrentConvId(null);
    }
    await loadConversations();
  };

  // textarea 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  // 外部附加备忘录（如右键菜单"发送到 AI"）
  useEffect(() => {
    if (attachedMemo) {
      setAttachedMemos((prev) => {
        // 避免重复附加同一条
        if (prev.some((m) => m.id === attachedMemo.id)) return prev;
        return [...prev, attachedMemo];
      });
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [attachedMemo, attachKey]);

  const refresh = async () => {
    const ok = await window.api.aiHasUsableModel();
    setUsable(ok);
    setWarning(ok ? null : 'AI 当前不可用：未配置任何启用的模型，或当前离线且无本地模型。');

    const [ps, ms] = await Promise.all([window.api.aiGetProviders(), window.api.aiGetModels()]);
    setProviders(ps);
    setModels(ms);
    await loadConversations();

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
      return '🤖 Auto';
    }
    const m = models.find((x) => x.id === modelChoice);
    if (!m) return '🤖 Auto';
    const p = providers.find((x) => x.id === m.providerId);
    const display = m.displayName || m.name;
    return `📌 ${p?.name || '?'} / ${display}`;
  })();

  // Auto 模式悬停时显示当前使用的模型
  const autoModelTitle = (() => {
    if (modelChoice !== 'auto') return '切换模型';
    const sorted = [...models].filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
    const first = sorted[0];
    if (first) {
      const p = providers.find((x) => x.id === first.providerId);
      const display = first.displayName || first.name;
      return `当前模型: ${p?.name || '?'} / ${display}`;
    }
    return '无可用模型';
  })();

  // 上下文使用量计算（有效窗口 = maxContext - 20K 输出预留）
  const contextInfo = (() => {
    let maxK = 0;
    if (modelChoice === 'auto') {
      const sorted = [...models].filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
      maxK = sorted[0]?.maxContext || 0;
    } else {
      const m = models.find((x) => x.id === modelChoice);
      maxK = m?.maxContext || 0;
    }
    const effectiveMaxK = Math.max(maxK - 20, 0); // 预留 20K 给输出
    const usedChars = messages.reduce((sum, m) => {
      let len = (m.content || '').length;
      if (m.toolCalls) len += JSON.stringify(m.toolCalls).length;
      return sum + len;
    }, 0);
    const usedK = Math.round(usedChars / 1024);
    const ratio = effectiveMaxK > 0 ? Math.min(usedK / effectiveMaxK, 1) : 0;
    return { usedK, maxK: effectiveMaxK, ratio };
  })();

  const send = async () => {
    const text = input.trim();
    if ((!text && attachedMemos.length === 0) || sending) return;
    setInput('');

    // 构造用户消息：将附加的备忘录信息作为上下文拼入
    let content = text;
    if (attachedMemos.length > 0) {
      const memoContext = attachedMemos.map((m) => {
        const parts = [`[备忘录: ${m.title}]`];
        if (m.content) parts.push(m.content.slice(0, 300));
        if (m.tags && m.tags.length) parts.push(`标签: ${m.tags.join('、')}`);
        return parts.join('\n');
      }).join('\n---\n');
      content = text ? `${memoContext}\n\n${text}` : memoContext;
    }
    setAttachedMemos([]);

    const userMsg: DisplayMessage = { role: 'user', content, ts: new Date().toISOString() };
    const next = [...messages, userMsg];
    setMessages(next);
    setSending(true);

    // 构造发送给模型的消息，保留 toolCalls 但排除 thinking
    const wireMessages: AiMessage[] = next.map((m) => {
      const msg: any = { role: m.role, content: m.content, ts: m.ts };
      if (m.toolCalls && m.toolCalls.length > 0) msg.toolCalls = m.toolCalls;
      return msg as AiMessage;
    });

    // 插入一个 streaming placeholder
    const placeholderIdx = next.length;
    setMessages((prev) => [...prev, {
      role: 'assistant',
      content: '',
      thinking: '',
      ts: new Date().toISOString(),
      streaming: true,
    }]);

    const sid = Date.now().toString() + Math.random().toString(36).slice(2);
    activeStreamId.current = sid;

    const streamId = window.api.aiChatStream(
      {
        messages: wireMessages,
        modelId: modelChoice === 'auto' ? undefined : modelChoice,
        streamId: sid,
      },
      (chunk) => {
        // 如果已打断，忽略后续 chunk
        if (activeStreamId.current !== sid) return;
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
            update_memo: '修改备忘录',
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
          activeStreamId.current = null;
          setSending(false);
          // 自动保存对话
          setMessages((latest) => {
            const id = currentConvId || newConvId();
            setCurrentConvId(id);
            saveCurrentConversation(latest, id).then(loadConversations);
            return latest;
          });
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
          activeStreamId.current = null;
          setSending(false);
        }
      }
    );
  };

  const handleAbort = () => {
    if (!sending) return;
    activeStreamId.current = null;
    window.api.aiChatStreamOff('');
    setSending(false);
    // 把当前 streaming 消息标记为结束
    setMessages((prev) => prev.map((m) =>
      m.streaming ? { ...m, streaming: false, content: m.content + '\n\n_(已打断)_' } : m
    ));
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
            <button className="ai-icon-btn" onClick={startNewConversation} title="新对话">＋</button>
            <button className="ai-icon-btn" onClick={() => { setShowHistory((v) => !v); loadConversations(); }} title="历史对话">🕓</button>
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

        {showHistory && (
          <div className="ai-history-panel">
            <div className="ai-history-header">
              <span>对话历史</span>
              {conversations.length > 0 && (
                <button className="ai-history-clear" onClick={async () => {
                  if (!confirm('确认清空所有对话历史？')) return;
                  await window.api.aiClearConversations();
                  setMessages([]);
                  setCurrentConvId(null);
                  await loadConversations();
                }}>清空全部</button>
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
                  onClick={() => switchConversation(c.id)}
                >
                  <div className="ai-history-item-title">{c.title || '新对话'}</div>
                  <div className="ai-history-item-time">
                    {new Date(c.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <button
                    className="ai-history-item-del"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                    title="删除"
                  >✕</button>
                </div>
              ))}
            </div>
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
              {!msg.streaming && msg.content && (
                <div className={`ai-msg-actions ${msg.role === 'user' ? 'align-right' : 'align-left'}`}>
                  <button
                    className="ai-msg-action-btn"
                    title="复制"
                    onClick={(e) => {
                      const btn = e.currentTarget;
                      const text = msg.content || '';
                      navigator.clipboard.writeText(text).then(() => {
                        btn.textContent = '✓';
                        setTimeout(() => { btn.textContent = '📋'; }, 1500);
                      }).catch(() => {
                        btn.textContent = '✓';
                        setTimeout(() => { btn.textContent = '📋'; }, 1500);
                      });
                    }}
                  >📋</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="ai-composer-wrap">
          <div className="ai-composer">
            {attachedMemos.length > 0 && (
              <div className="ai-attached-memos">
                {attachedMemos.map((m) => (
                  <div key={m.id} className="ai-attached-chip">
                    <span className="ai-attached-chip-icon">📝</span>
                    <span className="ai-attached-chip-title">{m.title}</span>
                    <button
                      className="ai-attached-chip-remove"
                      onClick={() => setAttachedMemos((prev) => prev.filter((x) => x.id !== m.id))}
                      title="移除"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
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
                title={autoModelTitle}
              >
                <span className="ai-composer-model-label">{selectedLabel}</span>
                <span className="ai-composer-model-caret">▾</span>
              </button>
              {sending ? (
                <button
                  className="ai-composer-send abort"
                  onClick={handleAbort}
                  title="打断 (Stop)"
                  aria-label="打断"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <div className="ai-composer-right">
                  {contextInfo.maxK > 0 && (
                    <div className="ai-context-ring" title={`上下文 ${contextInfo.usedK}K / ${contextInfo.maxK}K`}>
                      <svg viewBox="0 0 24 24" width="32" height="32">
                        <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border-input)" strokeWidth="2" />
                        <circle
                          cx="12" cy="12" r="9" fill="none"
                          stroke={contextInfo.ratio > 0.85 ? '#ff3b30' : contextInfo.ratio > 0.6 ? '#ff9500' : 'var(--accent)'}
                          strokeWidth="2"
                          strokeDasharray={`${contextInfo.ratio * 56.5} 56.5`}
                          strokeLinecap="round"
                          transform="rotate(-90 12 12)"
                        />
                      </svg>
                    </div>
                  )}
                  <button
                    className="ai-composer-send"
                    onClick={send}
                    disabled={!input.trim() && attachedMemos.length === 0}
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
