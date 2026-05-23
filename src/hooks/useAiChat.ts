/**
 * AI 聊天状态管理 Hook
 *
 * 封装对话的核心逻辑：
 * - 消息状态管理
 * - 流式发送与接收
 * - 对话历史（新建/切换/保存/删除）
 * - 模型选择与上下文计算
 * - 中断响应
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { AiConversationMeta, AiMessage, AiModel, AiProvider } from '../../types/global';

/** 服务端工具执行步骤 */
export interface ToolStep {
  name: string;
  label: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

export type RenderBlock =
  | { type: 'thinking'; segmentIdx: number }
  | { type: 'tool_step'; stepIdx: number };

export interface DisplayMessage extends AiMessage {
  toolStatus?: Record<string, 'pending' | 'created' | 'editing'>;
  streaming?: boolean;
  serverToolHint?: string;
  toolSteps?: ToolStep[];
  thinkingSegments?: string[];
  currentSegmentIdx?: number;
  renderSequence?: RenderBlock[];
}

export type ModelChoice = 'auto' | string;

export interface ContextInfo {
  usedK: number;
  maxK: number;
  ratio: number;
  color: string;
}

export function useAiChat() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachedMemos, setAttachedMemos] = useState<Array<{ id: string; title: string; content?: string; tags?: string[] }>>([]);
  const [sending, setSending] = useState(false);
  const [usable, setUsable] = useState<boolean | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [conversations, setConversations] = useState<AiConversationMeta[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<ModelChoice>(() => {
    return (localStorage.getItem('ai-model-choice') as ModelChoice) || 'auto';
  });

  const activeStreamId = useRef<string | null>(null);

  const newConvId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const loadConversations = useCallback(async () => {
    const list = await window.api.aiGetConversations();
    setConversations(list);
  }, []);

  const saveCurrentConversation = useCallback(async (msgs: DisplayMessage[], convId: string | null) => {
    if (!msgs.length) return;
    const id = convId || newConvId();
    const firstUser = msgs.find((m) => m.role === 'user');
    const title = firstUser ? firstUser.content.slice(0, 20) : '新对话';
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
  }, []);

  const switchConversation = useCallback(async (id: string) => {
    if (messages.length > 0 && currentConvId) {
      await saveCurrentConversation(messages, currentConvId);
    }
    const conv = await window.api.aiGetConversation(id);
    if (conv) {
      setMessages(conv.messages as DisplayMessage[]);
      setCurrentConvId(id);
    }
  }, [messages, currentConvId, saveCurrentConversation]);

  const startNewConversation = useCallback(async () => {
    if (messages.length > 0 && currentConvId) {
      await saveCurrentConversation(messages, currentConvId);
    }
    setMessages([]);
    setCurrentConvId(null);
  }, [messages, currentConvId, saveCurrentConversation]);

  const deleteConversation = useCallback(async (id: string) => {
    await window.api.aiDeleteConversation(id);
    if (currentConvId === id) {
      setMessages([]);
      setCurrentConvId(null);
    }
    await loadConversations();
  }, [currentConvId, loadConversations]);

  const clearAllConversations = useCallback(async () => {
    if (!confirm('确认清空所有对话历史？')) return;
    await window.api.aiClearConversations();
    setMessages([]);
    setCurrentConvId(null);
    await loadConversations();
  }, [loadConversations]);

  const refresh = useCallback(async () => {
    const ok = await window.api.aiHasUsableModel();
    setUsable(ok);
    setWarning(ok ? null : 'AI 当前不可用：未配置任何启用的模型，或当前离线且无本地模型。');

    const [ps, ms] = await Promise.all([window.api.aiGetProviders(), window.api.aiGetModels()]);
    setProviders(ps);
    setModels(ms);
    await loadConversations();

    if (modelChoice !== 'auto') {
      const stillValid = ms.find((m) => m.id === modelChoice && m.enabled);
      if (!stillValid) {
        setModelChoice('auto');
        localStorage.removeItem('ai-model-choice');
      }
    }
  }, [modelChoice, loadConversations]);

  useEffect(() => { refresh(); }, []);

  const handleSelectModel = useCallback((choice: ModelChoice) => {
    setModelChoice(choice);
    if (choice === 'auto') localStorage.removeItem('ai-model-choice');
    else localStorage.setItem('ai-model-choice', choice);
  }, []);

  // 当前模型标签
  const selectedLabel = (() => {
    if (modelChoice === 'auto') return '🤖 Auto';
    const m = models.find((x) => x.id === modelChoice);
    if (!m) return '🤖 Auto';
    const p = providers.find((x) => x.id === m.providerId);
    const display = m.displayName || m.name;
    return `📌 ${p?.name || '?'} / ${display}`;
  })();

  const autoModelTitle = (() => {
    if (modelChoice !== 'auto') return '切换模型';
    const sorted = [...models].filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
    const first = sorted[0];
    if (first) {
      const p = providers.find((x) => x.id === first.providerId);
      return `当前模型: ${p?.name || '?'} / ${first.displayName || first.name}`;
    }
    return '无可用模型';
  })();

  // 上下文用量
  const contextInfo: ContextInfo = (() => {
    const DEFAULT_CONTEXT_K = 128;
    let maxK = 0;
    if (modelChoice === 'auto') {
      const sorted = [...models].filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
      maxK = sorted[0]?.maxContext || DEFAULT_CONTEXT_K;
    } else {
      const m = models.find((x) => x.id === modelChoice);
      maxK = m?.maxContext || DEFAULT_CONTEXT_K;
    }
    const effectiveMaxK = Math.max(maxK - 20, 0);
    const usedChars = messages.reduce((sum, m) => {
      let len = (m.content || '').length;
      if (m.toolCalls) len += JSON.stringify(m.toolCalls).length;
      return sum + len;
    }, 0);
    const usedK = Math.round(usedChars / 1024);
    const ratio = maxK > 0 ? Math.min(usedK / maxK, 1) : 0;
    const warnK = Math.max(effectiveMaxK - 13, 0);
    const color = (effectiveMaxK > 0 && usedK >= effectiveMaxK) ? '#ff3b30'
      : (warnK > 0 && usedK >= warnK) ? '#ff9500'
      : 'var(--accent)';
    return { usedK, maxK, ratio, color };
  })();

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachedMemos.length === 0) || sending) return;
    setInput('');

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

    const wireMessages: AiMessage[] = next.map((m) => {
      const msg: any = { role: m.role, content: m.content, ts: m.ts };
      if (m.toolCalls && m.toolCalls.length > 0) msg.toolCalls = m.toolCalls;
      return msg as AiMessage;
    });

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

    // 流式批量 flush：delta 累积在 buffer 中，每 FLUSH_INTERVAL 合并写入 state
    const FLUSH_INTERVAL = 80; // ms
    const streamBuffer = { contentDelta: '', thinkingDelta: '', dirty: false };
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushBuffer = () => {
      flushTimer = null;
      if (!streamBuffer.dirty) return;
      const { contentDelta, thinkingDelta } = streamBuffer;
      streamBuffer.contentDelta = '';
      streamBuffer.thinkingDelta = '';
      streamBuffer.dirty = false;

      setMessages((prev) => {
        const updated = [...prev];
        const msg = { ...updated[placeholderIdx] };

        if (thinkingDelta) {
          const segments = [...(msg.thinkingSegments || [])];
          const idx = msg.currentSegmentIdx ?? 0;
          const isNew = segments.length <= idx;
          if (isNew) segments.push('');
          segments[idx] = (segments[idx] || '') + thinkingDelta;
          msg.thinkingSegments = segments;
          msg.thinking = segments.join('\n');
          if (isNew) {
            const seq = [...(msg.renderSequence || [])];
            seq.push({ type: 'thinking', segmentIdx: idx });
            msg.renderSequence = seq;
          }
        }

        if (contentDelta) {
          msg.content = (msg.content || '') + contentDelta;
        }

        updated[placeholderIdx] = msg;
        return updated;
      });
    };

    const scheduleFlush = () => {
      if (!flushTimer) {
        flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL);
      }
    };

    window.api.aiChatStream(
      {
        messages: wireMessages,
        modelId: modelChoice === 'auto' ? undefined : modelChoice,
        streamId: sid,
      },
      (chunk) => {
        if (activeStreamId.current !== sid) return;
        if (chunk.type === 'thinking_delta') {
          streamBuffer.thinkingDelta += (chunk.text || '');
          streamBuffer.dirty = true;
          scheduleFlush();
        } else if (chunk.type === 'content_delta') {
          streamBuffer.contentDelta += (chunk.text || '');
          streamBuffer.dirty = true;
          scheduleFlush();
        } else if (chunk.type === 'server_tool') {
          // 非 delta 事件：先 flush 缓冲，再立即应用
          flushBuffer();
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
            const seq = [...(msg.renderSequence || [])];
            seq.push({ type: 'tool_step', stepIdx });
            msg.renderSequence = seq;
            updated[placeholderIdx] = msg;
            return updated;
          });
        } else if (chunk.type === 'server_tool_done') {
          flushBuffer();
          setMessages((prev) => {
            const updated = [...prev];
            const msg = { ...updated[placeholderIdx] };
            const steps = [...(msg.toolSteps || [])];
            for (let i = steps.length - 1; i >= 0; i--) {
              if (steps[i].name === chunk.name && steps[i].status === 'running') {
                steps[i] = { ...steps[i], status: 'done', summary: chunk.summary };
                break;
              }
            }
            msg.toolSteps = steps;
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
          // 最终 flush + 清理 timer
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
          flushBuffer();
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
          setMessages((latest) => {
            const id = currentConvId || newConvId();
            setCurrentConvId(id);
            saveCurrentConversation(latest, id).then(loadConversations);
            return latest;
          });
        } else if (chunk.type === 'error') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
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
  }, [input, attachedMemos, sending, messages, modelChoice, currentConvId, saveCurrentConversation, loadConversations]);

  const handleAbort = useCallback(() => {
    if (!sending) return;
    activeStreamId.current = null;
    window.api.aiChatStreamOff('');
    setSending(false);
    setMessages((prev) => prev.map((m) =>
      m.streaming ? { ...m, streaming: false, content: m.content + '\n\n_(已打断)_' } : m
    ));
  }, [sending]);

  return {
    messages, setMessages,
    input, setInput,
    attachedMemos, setAttachedMemos,
    sending, usable, warning,
    providers, models,
    conversations, currentConvId,
    modelChoice, selectedLabel, autoModelTitle, contextInfo,
    handleSelectModel,
    send, handleAbort,
    switchConversation, startNewConversation, deleteConversation, clearAllConversations,
    loadConversations, refresh,
  };
}
