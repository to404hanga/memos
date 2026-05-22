import { v4 as uuidv4 } from 'uuid';
import { AiProvider, AiModel } from '../database/ai.repo';
import { httpJson, httpStream, joinUrl, safeJsonParse } from './http';

export type OnDelta = (chunk: any) => void;

export interface LLMResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: any }>;
  thinking?: string;
}

export async function callOpenAi(
  provider: AiProvider, model: AiModel, messages: any[], tools: any[],
  systemPrompt: string, onDelta?: OnDelta
): Promise<LLMResult> {
  const url = joinUrl(provider.baseUrl, '/chat/completions');

  const payloadMessages: any[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'tool') {
      payloadMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content || '' });
    } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      payloadMessages.push({
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc: any) => ({
          id: tc.id, type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
        })),
      });
    } else {
      payloadMessages.push({ role: m.role, content: m.content || '' });
    }
  }

  const body: any = {
    model: model.name, messages: payloadMessages, tools, tool_choice: 'auto', temperature: 0.3,
  };
  if (model.thinking) {
    body.reasoning_effort = 'medium';
    body.enable_thinking = true;
  }
  const headers = { Authorization: `Bearer ${provider.apiKey}` };

  if (!onDelta) {
    const { data } = await httpJson({ url, headers, body, timeoutMs: 30000 });
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error('响应格式异常：缺少 choices');
    const msg = choice.message || {};
    const toolCalls = (msg.tool_calls || []).map((tc: any) => ({
      id: tc.id || uuidv4(),
      name: tc.function && tc.function.name,
      arguments: safeJsonParse(tc.function && tc.function.arguments) || {},
    })).filter((tc: any) => tc.name);
    return { content: msg.content || '', toolCalls, thinking: msg.reasoning_content || msg.reasoning || undefined };
  }

  // 流式
  body.stream = true;
  let content = '';
  let thinking = '';
  const toolCallsAccum: Record<number, { id: string; name: string; argumentsRaw: string }> = {};

  await httpStream({
    url, headers, body, timeoutMs: 60000,
    onLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') return;
      let json: any;
      try { json = JSON.parse(dataStr); } catch { return; }
      const choice = json.choices && json.choices[0];
      if (!choice) return;
      const delta = choice.delta || {};

      const reasoningDelta = delta.reasoning_content || delta.reasoning;
      if (reasoningDelta) {
        thinking += reasoningDelta;
        onDelta({ type: 'thinking_delta', text: reasoningDelta });
      }
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onDelta({ type: 'content_delta', text: delta.content });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index != null ? tc.index : 0;
          if (!toolCallsAccum[idx]) {
            toolCallsAccum[idx] = { id: tc.id || uuidv4(), name: '', argumentsRaw: '' };
          }
          if (tc.id) toolCallsAccum[idx].id = tc.id;
          if (tc.function) {
            if (tc.function.name) toolCallsAccum[idx].name += tc.function.name;
            if (tc.function.arguments) toolCallsAccum[idx].argumentsRaw += tc.function.arguments;
          }
        }
      }
    },
  });

  const toolCalls = Object.values(toolCallsAccum)
    .filter((tc) => tc.name)
    .map((tc) => ({ id: tc.id, name: tc.name, arguments: safeJsonParse(tc.argumentsRaw) || {} }));

  return { content, toolCalls, thinking: thinking || undefined };
}

export async function callAnthropic(
  provider: AiProvider, model: AiModel, messages: any[], tools: any[],
  systemPrompt: string, onDelta?: OnDelta
): Promise<LLMResult> {
  const url = joinUrl(provider.baseUrl, '/messages');

  const claudeMessages: any[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      claudeMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '' }] });
    } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments || {} });
      }
      claudeMessages.push({ role: 'assistant', content: blocks });
    } else {
      claudeMessages.push({ role: m.role, content: m.content || '' });
    }
  }

  const body: any = { model: model.name, max_tokens: 2048, system: systemPrompt, messages: claudeMessages, tools };
  if (model.thinking) {
    body.thinking = { type: 'enabled', budget_tokens: 8000 };
  }
  const headers: Record<string, string> = { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' };

  if (!onDelta) {
    const { data } = await httpJson({ url, headers, body, timeoutMs: 30000 });
    let content = '';
    const toolCalls: any[] = [];
    let thinkingText: string | undefined;
    for (const block of data.content || []) {
      if (block.type === 'text') content += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id || uuidv4(), name: block.name, arguments: block.input || {} });
      } else if (block.type === 'thinking') {
        thinkingText = (thinkingText || '') + (block.thinking || '');
      }
    }
    return { content, toolCalls, thinking: thinkingText };
  }

  // 流式
  body.stream = true;
  let content = '';
  let thinking = '';
  const blocksAccum: Record<number, any> = {};

  await httpStream({
    url, headers, body, timeoutMs: 60000,
    onLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr) return;
      let json: any;
      try { json = JSON.parse(dataStr); } catch { return; }

      if (json.type === 'content_block_start') {
        const cb = json.content_block || {};
        blocksAccum[json.index] = { type: cb.type, id: cb.id, name: cb.name, text: '', thinking: '', argumentsRaw: '' };
      } else if (json.type === 'content_block_delta') {
        const block = blocksAccum[json.index];
        if (!block) return;
        const d = json.delta || {};
        if (d.type === 'text_delta' && d.text) {
          block.text += d.text; content += d.text;
          onDelta({ type: 'content_delta', text: d.text });
        } else if (d.type === 'thinking_delta' && d.thinking) {
          block.thinking += d.thinking; thinking += d.thinking;
          onDelta({ type: 'thinking_delta', text: d.thinking });
        } else if (d.type === 'input_json_delta' && d.partial_json) {
          block.argumentsRaw += d.partial_json;
        }
      }
    },
  });

  const toolCalls = Object.values(blocksAccum)
    .filter((b: any) => b.type === 'tool_use' && b.name)
    .map((b: any) => ({ id: b.id || uuidv4(), name: b.name, arguments: safeJsonParse(b.argumentsRaw) || {} }));

  return { content, toolCalls, thinking: thinking || undefined };
}

export async function callOllama(
  provider: AiProvider, model: AiModel, messages: any[], tools: any[],
  systemPrompt: string, onDelta?: OnDelta
): Promise<LLMResult> {
  const url = joinUrl(provider.baseUrl, '/api/chat');

  const ollamaMessages: any[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'tool') {
      ollamaMessages.push({ role: 'tool', content: m.content || '' });
    } else if (m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
      ollamaMessages.push({
        role: 'assistant', content: m.content || '',
        tool_calls: m.toolCalls.map((tc: any) => ({ function: { name: tc.name, arguments: tc.arguments || {} } })),
      });
    } else {
      ollamaMessages.push({ role: m.role, content: m.content || '' });
    }
  }

  const body: any = { model: model.name, messages: ollamaMessages, tools, options: { temperature: 0.3 } };
  if (model.thinking) body.think = true;

  if (!onDelta) {
    body.stream = false;
    const { data } = await httpJson({ url, body, timeoutMs: 60000 });
    const msg = data.message || {};
    const toolCalls = (msg.tool_calls || []).map((tc: any) => ({
      id: uuidv4(), name: tc.function && tc.function.name, arguments: (tc.function && tc.function.arguments) || {},
    })).filter((tc: any) => tc.name);
    return { content: msg.content || '', toolCalls, thinking: msg.thinking || undefined };
  }

  // 流式（NDJSON）
  body.stream = true;
  let content = '';
  let thinking = '';
  const toolCallsAccum: any[] = [];

  await httpStream({
    url, body, timeoutMs: 120000,
    onLine: (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let json: any;
      try { json = JSON.parse(trimmed); } catch { return; }
      const msg = json.message || {};
      if (typeof msg.content === 'string' && msg.content) {
        content += msg.content;
        onDelta({ type: 'content_delta', text: msg.content });
      }
      if (typeof msg.thinking === 'string' && msg.thinking) {
        thinking += msg.thinking;
        onDelta({ type: 'thinking_delta', text: msg.thinking });
      }
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          toolCallsAccum.push({ id: uuidv4(), name: tc.function && tc.function.name, arguments: (tc.function && tc.function.arguments) || {} });
        }
      }
    },
  });

  return { content, toolCalls: toolCallsAccum.filter((tc) => tc.name), thinking: thinking || undefined };
}
