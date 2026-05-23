/**
 * AI 上下文压缩模块
 *
 * 三层压缩策略：
 * - 第1层：简单摘要（快速，保留头尾 + 中间概括）
 * - 第2层：Full Compact（结构化摘要，含分析和要点提取）
 * - 第3层：截断（兜底，从最旧消息开始丢弃）
 */
import { AiProvider, AiModel } from '../database/ai.repo';
import { callOpenAi, callAnthropic, callOllama } from './providers';

// 输出预留和压缩缓冲（单位：字符，按 1 token ≈ 4 chars 估算）
const OUTPUT_RESERVE_CHARS = 20000 * 4;  // 20K tokens
const COMPRESS_BUFFER_CHARS = 13000 * 4; // 13K tokens
const MAX_PTL_RETRIES = 3;

function calcTotalChars(messages: any[]): number {
  return messages.reduce((sum, m) => sum + JSON.stringify(m).length, 0);
}

// 简单截断（最终兜底）
function truncateMessages(messages: any[], maxContextK?: number): any[] {
  if (!maxContextK || maxContextK <= 0) return messages;
  const maxChars = maxContextK * 1024 - OUTPUT_RESERVE_CHARS;
  if (maxChars <= 0) return messages;
  let totalChars = 0;
  const result: any[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgLen = JSON.stringify(msg).length;
    if (totalChars + msgLen > maxChars && result.length > 0) break;
    totalChars += msgLen;
    result.unshift(msg);
  }
  return result;
}

// 预处理：去除图片/附件内容，降低压缩请求的 token 消耗
function stripForCompact(messages: any[]): any[] {
  return messages.map((m) => {
    let content = m.content || '';
    content = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '[image]');
    if (content.length > 8000) {
      content = content.slice(0, 4000) + '\n...[内容已截断]...\n' + content.slice(-2000);
    }
    return { ...m, content };
  });
}

// Full Compact 摘要 Prompt
const FULL_COMPACT_SYSTEM = `你是一个对话摘要专家。你的任务是将对话历史压缩为结构化摘要。

CRITICAL: 仅输出纯文本。不要调用任何工具。
你的回复必须包含一个 <analysis> 块和一个 <summary> 块。`;

const FULL_COMPACT_USER_TEMPLATE = `请将以下对话历史压缩为结构化摘要。

要求：
1. 先在 <analysis> 中进行思考（这部分之后会被删除）
2. 然后在 <summary> 中输出最终摘要

摘要格式：
<summary>
1. 用户请求与意图:
   [详细描述用户的所有请求和意图]

2. 关键技术概念:
   - [概念1]
   - [概念2]

3. 已完成的操作:
   - [操作1及结果]
   - [操作2及结果]

4. 错误与修复:
   - [错误描述]: [修复方式]

5. 所有用户消息摘要:
   - [逐条概括用户发送的消息]

6. 待办事项:
   - [尚未完成的任务]

7. 当前工作状态:
   [精确描述当前进展]
</summary>

以下是需要压缩的对话历史：

`;

// 后处理：提取 summary，删除 analysis
function formatCompactSummary(raw: string): string {
  let result = raw.replace(/<analysis>[\s\S]*?<\/analysis>/g, '');
  const match = result.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match) {
    result = `[对话摘要]\n${match[1].trim()}\n[摘要结束]`;
  } else {
    result = `[对话摘要]\n${result.trim()}\n[摘要结束]`;
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

// 调用 LLM 生成摘要的统一方法
async function callForSummary(provider: AiProvider, model: AiModel, messages: any[], systemPrompt: string): Promise<any> {
  if (provider.type === 'anthropic') {
    return callAnthropic(provider, model, messages, [], systemPrompt);
  }
  if (provider.type === 'ollama') {
    return callOllama(provider, model, messages, [], systemPrompt);
  }
  return callOpenAi(provider, model, messages, [], systemPrompt);
}

// Full Compact 主流程
async function fullCompact(
  messages: any[], provider: AiProvider, model: AiModel, maxContextK: number
): Promise<any[]> {
  const keepHead = 2;
  const keepTail = 2;

  if (messages.length < keepHead + keepTail + 1) {
    return truncateMessages(messages, maxContextK);
  }

  const head = messages.slice(0, keepHead);
  const tail = messages.slice(-keepTail);
  const toCompress = messages.slice(keepHead, -keepTail);

  if (toCompress.length === 0) return messages;

  const stripped = stripForCompact(toCompress);

  const conversationText = stripped.map((m) => {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
    let text = `[${role}]: ${m.content || ''}`;
    if (m.toolCalls && m.toolCalls.length > 0) {
      text += `\n  [工具调用: ${m.toolCalls.map((tc: any) => `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`).join(', ')}]`;
    }
    if (m.toolCallId) {
      text += ` (tool_call_id: ${m.toolCallId})`;
    }
    return text;
  }).join('\n\n');

  const compactPrompt = [
    { role: 'user', content: FULL_COMPACT_USER_TEMPLATE + conversationText },
  ];

  let retries = 0;
  let currentPrompt = compactPrompt;

  while (retries <= MAX_PTL_RETRIES) {
    try {
      const result = await callForSummary(provider, model, currentPrompt, FULL_COMPACT_SYSTEM);

      const summary = formatCompactSummary(result.content || '');
      if (!summary || summary.length < 50) {
        throw new Error('摘要内容过短');
      }

      const summaryMsg = { role: 'user', content: summary };
      const compressedResult = [...head, summaryMsg, ...tail];

      const compressedChars = calcTotalChars(compressedResult);
      const effectiveMax = maxContextK * 1024 - OUTPUT_RESERVE_CHARS;
      if (compressedChars > effectiveMax) {
        return truncateMessages(compressedResult, maxContextK);
      }

      console.log(`[Compact] Full Compact 成功: ${toCompress.length} 条消息 → 摘要 ${summary.length} 字符`);
      return compressedResult;
    } catch (err: any) {
      const errMsg = err.message || String(err);
      if (errMsg.includes('too long') || errMsg.includes('too many tokens') || errMsg.includes('context_length')) {
        retries++;
        if (retries > MAX_PTL_RETRIES) break;
        const dropCount = Math.max(1, Math.floor(stripped.length * 0.2));
        const trimmed = stripped.slice(dropCount);
        const trimmedText = trimmed.map((m) => {
          const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Tool';
          return `[${role}]: ${m.content || ''}`;
        }).join('\n\n');
        currentPrompt = [{ role: 'user', content: FULL_COMPACT_USER_TEMPLATE + trimmedText }];
        console.warn(`[Compact] PTL 重试 ${retries}/${MAX_PTL_RETRIES}，裁剪 ${dropCount} 条`);
        continue;
      }
      throw err;
    }
  }

  throw new Error('Full Compact 失败：压缩请求超过上下文限制');
}

/**
 * 去除消息中的 thinking 字段（thinking 不应发送回模型，也不应计入压缩）
 */
function stripThinking(messages: any[]): any[] {
  return messages.map((m) => {
    if (!m.thinking && !m.thinkingSegments) return m;
    const { thinking, thinkingSegments, currentSegmentIdx, renderSequence, ...rest } = m;
    return rest;
  });
}

/**
 * 智能压缩主入口
 * 预处理：去除 thinking 块 → 第1层：简单摘要 → 第2层：Full Compact → 第3层：截断
 */
export async function compressMessages(
  messages: any[], maxContextK: number,
  provider: AiProvider, model: AiModel
): Promise<any[]> {
  // 预处理：去除 thinking 块，减少无效 token 占用
  const cleaned = stripThinking(messages);

  const effectiveMaxChars = maxContextK * 1024 - OUTPUT_RESERVE_CHARS;
  const compressThreshold = effectiveMaxChars - COMPRESS_BUFFER_CHARS;

  if (compressThreshold <= 0) return truncateMessages(cleaned, maxContextK);

  const totalChars = calcTotalChars(cleaned);
  if (totalChars <= compressThreshold) return cleaned;

  console.log(`[Compact] 触发压缩: ${Math.round(totalChars / 1024)}K > 阈值 ${Math.round(compressThreshold / 1024)}K`);

  if (cleaned.length < 5) return truncateMessages(cleaned, maxContextK);

  // 第1层：简单摘要
  try {
    const keepHead = 2;
    const keepTail = 2;
    const head = cleaned.slice(0, keepHead);
    const tail = cleaned.slice(-keepTail);
    const middle = cleaned.slice(keepHead, -keepTail);

    if (middle.length === 0) return truncateMessages(cleaned, maxContextK);

    const middleText = middle.map((m) => {
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '工具';
      let text = `[${role}] ${m.content || ''}`;
      if (m.toolCalls && m.toolCalls.length > 0) {
        text += ` [调用工具: ${m.toolCalls.map((tc: any) => tc.name).join(', ')}]`;
      }
      return text;
    }).join('\n');

    const summaryPrompt = [
      { role: 'user', content: `请将以下对话历史压缩为简洁的摘要（保留关键信息、用户意图、已完成的操作），用中文，不超过 500 字：\n\n${middleText}` },
    ];

    const sysPrompt = '你是一个对话摘要助手，将对话压缩为简洁摘要。不要调用任何工具，仅输出纯文本。';
    const result = await callForSummary(provider, model, summaryPrompt, sysPrompt);

    const summary = result.content || '';
    if (summary.length >= 50) {
      const summaryMsg = { role: 'user', content: `[以下是之前对话的摘要]\n${summary}\n[摘要结束，以下是最近的对话]` };
      const compressed = [...head, summaryMsg, ...tail];
      if (calcTotalChars(compressed) <= effectiveMaxChars) {
        console.log(`[Compact] 简单摘要成功: ${middle.length} 条 → ${summary.length} 字符`);
        return compressed;
      }
    }
    console.warn('[Compact] 简单摘要后仍超限，回退到 Full Compact');
  } catch (e) {
    console.warn('[Compact] 简单摘要失败，回退到 Full Compact:', e);
  }

  // 第2层：Full Compact
  try {
    return await fullCompact(cleaned, provider, model, maxContextK);
  } catch (e) {
    console.warn('[Compact] Full Compact 失败，回退到截断:', e);
  }

  // 第3层：截断
  return truncateMessages(cleaned, maxContextK);
}
