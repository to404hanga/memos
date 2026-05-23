/**
 * AI 消息列表渲染组件
 *
 * 负责渲染对话中的所有消息，包括：
 * - 思考过程展示（多段支持）
 * - 服务端工具调用步骤
 * - 文本内容（Markdown）
 * - 创建备忘录预览卡片
 * - 复制按钮
 */
import React from 'react';
import AiPreviewCard, { aiArgsToMemo } from './AiPreviewCard';
import MarkdownView from './MarkdownView';
import type { AiCreateMemoArgs, AiToolCall, MemoFormData } from '../../types/global';

/** 服务端工具执行步骤 */
interface ToolStep {
  name: string;
  label: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
}

type RenderBlock =
  | { type: 'thinking'; segmentIdx: number }
  | { type: 'tool_step'; stepIdx: number };

interface DisplayMessage {
  role: string;
  content: string;
  thinking?: string;
  toolCalls?: AiToolCall[];
  toolStatus?: Record<string, 'pending' | 'created' | 'editing'>;
  streaming?: boolean;
  serverToolHint?: string;
  toolSteps?: ToolStep[];
  thinkingSegments?: string[];
  currentSegmentIdx?: number;
  renderSequence?: RenderBlock[];
  modelLabel?: string;
  providerName?: string;
  fallbackFrom?: string;
  ts?: string;
}

interface Props {
  messages: DisplayMessage[];
  onConfirmCreate: (msgIdx: number, tc: AiToolCall) => void;
  onEditDraft: (tc: AiToolCall) => void;
}

export default function AiMessageList({ messages, onConfirmCreate, onEditDraft }: Props): React.ReactElement {
  return (
    <>
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
                  onConfirm={() => onConfirmCreate(idx, tc)}
                  onEdit={() => onEditDraft(tc)}
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
    </>
  );
}
