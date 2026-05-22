import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { AiProvider, AiModel, getProviderById, getModelById, getEnabledModelsOrdered, updateModelRuntime, isLocalUrl } from '../database/ai.repo';
import { getAllMemos, getMemoById, updateMemoInDb, Memo } from '../database/memo.repo';
import { getTagNames, getSetting } from '../database/settings.repo';
import { scheduleReminder, clearMemoTimers } from '../scheduler';
import { callOpenAi, callAnthropic, callOllama, OnDelta, LLMResult } from './providers';
import { saveDb } from '../database';
import { getDb } from '../database';
import { httpJson } from './http';

// ===== Tool 定义 =====
const CLIENT_TOOLS = new Set(['create_memo']);
const SERVER_TOOLS = new Set(['list_memos', 'complete_memo', 'delete_memo', 'update_memo']);

export const AI_TOOLS_OPENAI = [
  {
    type: 'function',
    function: {
      name: 'create_memo',
      description: '创建一条新的备忘录/待办。仅生成预览卡片，由用户点击「✓ 创建」后才会真正写入数据库。所以可以放心调用，无需先反复确认。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '备忘录标题' },
          content: { type: 'string', description: '正文内容（Markdown）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          reminderTime: { type: 'string', description: 'ISO 8601 格式的提醒时间，如 2026-05-21T15:00:00+08:00' },
          recurrence: {
            type: 'object', description: '周期提醒配置。type=weekly 时必须提供 dayOfWeek；type=monthly 时必须提供 dayOfMonth',
            properties: {
              type: { type: 'string', enum: ['once', 'daily', 'workday', 'weekly', 'monthly'] },
              hour: { type: 'number', description: '提醒的小时（0-23）' },
              minute: { type: 'number', description: '提醒的分钟（0-59）' },
              dayOfWeek: { type: 'number', description: 'weekly 必填。0=周日, 1=周一, ..., 6=周六' },
              dayOfMonth: { type: 'number', description: 'monthly 必填。每月几号（1-31）' },
            },
            required: ['type', 'hour', 'minute'],
          },
          mutePeriods: {
            type: 'array',
            description: '静默期列表，在这些日期范围内不提醒',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string', description: '起始日期 YYYY-MM-DD' },
                to: { type: 'string', description: '结束日期 YYYY-MM-DD' },
              },
              required: ['from', 'to'],
            },
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_memos',
      description: '查询用户已有的备忘录/待办列表。可按关键词、标签、状态筛选。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '在标题或内容中搜索的关键词，可选' },
          tag: { type: 'string', description: '只返回包含此标签的备忘录，可选' },
          status: { type: 'string', enum: ['all', 'active', 'completed'], description: '过滤状态' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_memo',
      description: '标记一条备忘录为已完成（或取消完成）。接受标题的模糊关键词或精确 ID。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '备忘录的标题关键词或 ID' },
          undo: { type: 'boolean', description: '设为 true 则取消完成' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_memo',
      description: '删除一条备忘录（移入回收站）。接受标题的模糊关键词或精确 ID。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '备忘录的标题关键词或 ID' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_memo',
      description: '修改一条已有的备忘录。通过标题关键词或 ID 定位，然后更新指定字段。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '备忘录的标题关键词或精确 ID' },
          title: { type: 'string', description: '新标题（可选）' },
          content: { type: 'string', description: '新内容 Markdown（可选）' },
          tags: { type: 'array', items: { type: 'string' }, description: '新标签列表（可选）' },
          addTags: { type: 'array', items: { type: 'string' }, description: '追加标签' },
          removeTags: { type: 'array', items: { type: 'string' }, description: '移除指定标签' },
          reminderTime: { type: 'string', description: '新的提醒时间 ISO 8601' },
          recurrence: {
            type: 'object', description: '新的周期提醒配置',
            properties: {
              type: { type: 'string', enum: ['once', 'daily', 'workday', 'weekly', 'monthly'] },
              hour: { type: 'number' }, minute: { type: 'number' },
              dayOfWeek: { type: 'number' }, dayOfMonth: { type: 'number' },
            },
          },
        },
        required: ['query'],
      },
    },
  },
];

export const AI_TOOLS_ANTHROPIC = AI_TOOLS_OPENAI.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

// ===== 服务端工具执行 =====
function executeServerTool(name: string, args: any, mainWindow: BrowserWindow | null): any {
  if (name === 'list_memos') {
    const all = getAllMemos();
    const status = args && args.status;
    const keyword = args && typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
    const tag = args && typeof args.tag === 'string' ? args.tag.trim() : '';

    let filtered = all;
    if (!status || status === 'active') filtered = filtered.filter((m) => !m.completed);
    else if (status === 'completed') filtered = filtered.filter((m) => m.completed);

    if (keyword) {
      filtered = filtered.filter((m) =>
        (m.title || '').toLowerCase().includes(keyword) ||
        (m.content || '').toLowerCase().includes(keyword)
      );
    }
    if (tag) {
      filtered = filtered.filter((m) => Array.isArray(m.tags) && m.tags.includes(tag));
    }

    const items = filtered.map((m) => {
      const contentExcerpt = (m.content || '')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/[#*`>\-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      let reminderTimeLocal: string | undefined;
      if (m.reminderTime) {
        try {
          reminderTimeLocal = new Date(m.reminderTime).toLocaleString('zh-CN', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
          });
        } catch (e) { reminderTimeLocal = m.reminderTime; }
      }
      return {
        id: m.id, title: m.title,
        contentExcerpt: contentExcerpt || undefined,
        reminderTime: reminderTimeLocal || undefined,
        tags: m.tags && m.tags.length ? m.tags : undefined,
        completed: m.completed, pinned: m.pinned || undefined,
      };
    });
    return { count: items.length, items };
  }

  if (name === 'complete_memo') {
    const query = (args && args.query || '').trim();
    const undo = args && args.undo;
    if (!query) return { error: '缺少 query 参数' };

    const byId = getMemoById(query);
    if (byId) {
      const newState = undo ? false : true;
      if (byId.completed === newState) {
        return { success: true, message: `「${byId.title}」已经是${newState ? '已完成' : '未完成'}状态` };
      }
      byId.completed = newState;
      updateMemoInDb(byId);
      if (newState) clearMemoTimers(byId.id);
      else scheduleReminder(byId, mainWindow);
      return { success: true, message: `已将「${byId.title}」标记为${newState ? '已完成 ✅' : '未完成'}` };
    }

    const all = getAllMemos();
    const keyword = query.toLowerCase();
    const matches = all.filter((m) => (m.title || '').toLowerCase().includes(keyword));

    if (matches.length === 0) return { error: `未找到包含「${query}」的备忘录` };
    if (matches.length === 1) {
      const target = matches[0];
      const newState = undo ? false : true;
      if (target.completed === newState) {
        return { success: true, message: `「${target.title}」已经是${newState ? '已完成' : '未完成'}状态` };
      }
      target.completed = newState;
      updateMemoInDb(target);
      if (newState) clearMemoTimers(target.id);
      else scheduleReminder(target, mainWindow);
      return { success: true, message: `已将「${target.title}」标记为${newState ? '已完成 ✅' : '未完成'}` };
    }
    return {
      ambiguous: true,
      message: `找到 ${matches.length} 条匹配，请用户确认具体是哪一条：`,
      candidates: matches.slice(0, 10).map((m) => ({ id: m.id, title: m.title, completed: m.completed })),
    };
  }

  if (name === 'delete_memo') {
    const query = (args && args.query || '').trim();
    if (!query) return { error: '缺少 query 参数' };

    const byId = getMemoById(query);
    if (byId) {
      const db = getDb();
      db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), byId.id]);
      saveDb();
      clearMemoTimers(byId.id);
      return { success: true, message: `已将「${byId.title}」移入回收站 🗑️` };
    }

    const all = getAllMemos();
    const keyword = query.toLowerCase();
    const matches = all.filter((m) => (m.title || '').toLowerCase().includes(keyword));

    if (matches.length === 0) return { error: `未找到包含「${query}」的备忘录` };
    if (matches.length === 1) {
      const target = matches[0];
      const db = getDb();
      db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), target.id]);
      saveDb();
      clearMemoTimers(target.id);
      return { success: true, message: `已将「${target.title}」移入回收站 🗑️` };
    }
    return {
      ambiguous: true,
      message: `找到 ${matches.length} 条匹配，请用户确认具体删除哪一条：`,
      candidates: matches.slice(0, 10).map((m) => ({ id: m.id, title: m.title })),
    };
  }

  if (name === 'update_memo') {
    const query = (args && args.query || '').trim();
    if (!query) return { error: '缺少 query 参数' };

    let target = getMemoById(query);
    if (!target) {
      const all = getAllMemos();
      const keyword = query.toLowerCase();
      const matches = all.filter((m) => (m.title || '').toLowerCase().includes(keyword));
      if (matches.length === 0) return { error: `未找到包含「${query}」的备忘录` };
      if (matches.length > 1) {
        return {
          ambiguous: true,
          message: `找到 ${matches.length} 条匹配，请用户确认修改哪一条：`,
          candidates: matches.slice(0, 10).map((m) => ({ id: m.id, title: m.title })),
        };
      }
      target = matches[0];
    }

    const changes: string[] = [];
    if (typeof args.title === 'string') { target.title = args.title; changes.push('标题'); }
    if (typeof args.content === 'string') { target.content = args.content; changes.push('内容'); }
    if (Array.isArray(args.tags)) { target.tags = args.tags; changes.push('标签'); }
    else if (Array.isArray(args.addTags) && args.addTags.length > 0) {
      const existing = new Set(target.tags || []);
      args.addTags.forEach((t: string) => existing.add(t));
      target.tags = Array.from(existing);
      changes.push(`添加标签: ${args.addTags.join(', ')}`);
    } else if (Array.isArray(args.removeTags) && args.removeTags.length > 0) {
      const toRemove = new Set(args.removeTags);
      target.tags = (target.tags || []).filter((t: string) => !toRemove.has(t));
      changes.push(`移除标签: ${args.removeTags.join(', ')}`);
    }
    if ('reminderTime' in args) {
      if (args.reminderTime === '' || args.reminderTime === null) {
        target.reminderTime = null;
        target.reminders = target.reminders.filter((r: any) => r.type !== 'once');
        changes.push('清除提醒时间');
      } else if (typeof args.reminderTime === 'string') {
        target.reminderTime = args.reminderTime;
        const onceIdx = target.reminders.findIndex((r: any) => r.type === 'once');
        if (onceIdx >= 0) target.reminders[onceIdx].time = args.reminderTime;
        else target.reminders.push({ type: 'once', time: args.reminderTime });
        changes.push('提醒时间');
      }
    }
    if ('recurrence' in args) {
      if (args.recurrence === null) {
        target.recurrence = null;
        target.reminders = target.reminders.filter((r: any) => r.type === 'once');
        changes.push('清除周期提醒');
      } else if (args.recurrence && args.recurrence.type) {
        target.recurrence = args.recurrence;
        const periodicIdx = target.reminders.findIndex((r: any) => r.type !== 'once');
        if (periodicIdx >= 0) target.reminders[periodicIdx] = args.recurrence;
        else target.reminders.push(args.recurrence);
        changes.push('周期提醒');
      }
    }

    if (changes.length === 0) {
      return { success: true, message: `未指定任何修改字段，「${target.title}」保持不变` };
    }

    updateMemoInDb(target);
    scheduleReminder(target, mainWindow);
    return { success: true, message: `已更新「${target.title}」的${changes.join('、')} ✏️` };
  }

  return { error: `未知工具: ${name}` };
}

// ===== System Prompt =====
function buildSystemPrompt(): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tagNames = getTagNames();

  let customTemplate = getSetting('ai_prompt_template');

  const vars: Record<string, string> = {
    '{{NOW}}': now.toLocaleString('zh-CN', { hour12: false }),
    '{{NOW_ISO}}': now.toISOString(),
    '{{TIMEZONE}}': tz,
    '{{TAGS}}': tagNames.length ? tagNames.join('、') : '（暂无）',
  };

  if (customTemplate.trim()) {
    let result = customTemplate;
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(new RegExp(k.replace(/[{}]/g, '\\$&'), 'g'), v);
    }
    return result;
  }

  return [
    '你是一个智能备忘录助手，帮助用户管理待办事项。',
    `当前时间：${vars['{{NOW}}']}（ISO: ${vars['{{NOW_ISO}}']}）`,
    `用户时区：${tz}`,
    `用户已有标签：${vars['{{TAGS}}']}`,
    '',
    '可用工具：',
    '- create_memo：创建新待办，仅生成预览卡片，需用户点击「✓ 创建」才落库',
    '- list_memos：查询用户已有的待办列表',
    '- complete_memo：标记待办为已完成（或 undo 取消完成）',
    '- delete_memo：删除待办（移入回收站）',
    '- update_memo：修改待办的标题/内容/标签/提醒时间/周期',
    '',
    '规则：',
    '1. 用户用自然语言描述新任务时，调用 create_memo',
    '2. 用户询问待办时，先调用 list_memos 拿到数据再回复',
    '3. 用户说完成了某事，调用 complete_memo',
    '4. 用户说删掉某事，调用 delete_memo',
    '5. 用户说修改某事，调用 update_memo',
    '6. 如果返回 ambiguous，展示候选列表让用户确认',
    '7. 时间表达需转为具体时间',
    '8. 缺关键信息时主动询问',
    '9. 调用 create_memo 仅生成预览卡片，可放心调用',
    '10. 回复使用中文，简洁友好',
  ].join('\n');
}

// ===== 模型调用统一入口 =====
function invokeModel(provider: AiProvider, model: AiModel, messages: any[], onDelta?: OnDelta): Promise<LLMResult> {
  const systemPrompt = buildSystemPrompt();
  if (provider.type === 'anthropic') {
    return callAnthropic(provider, model, messages, AI_TOOLS_ANTHROPIC, systemPrompt, onDelta);
  }
  if (provider.type === 'ollama') {
    return callOllama(provider, model, messages, AI_TOOLS_OPENAI.map((t) => t.function), systemPrompt, onDelta);
  }
  return callOpenAi(provider, model, messages, AI_TOOLS_OPENAI, systemPrompt, onDelta);
}

function modelLabel(provider: AiProvider, model: AiModel): string {
  return `${provider.name} / ${model.displayName || model.name}`;
}

// ===== 多轮工具循环 =====
const MAX_TOOL_LOOPS = 4;

async function runConversation(provider: AiProvider, model: AiModel, initialMessages: any[], onDelta: OnDelta | undefined, mainWindow: BrowserWindow | null): Promise<LLMResult & { providerName?: string; modelName?: string; modelLabel?: string; fallbackFrom?: string }> {
  let working = [...initialMessages];
  const allClientCalls: any[] = [];
  let lastTextContent = '';
  let thinkingAccum: string | undefined;

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const wrappedDelta: OnDelta | undefined = onDelta ? (chunk) => onDelta({ ...chunk, loop }) : undefined;
    const r = await invokeModel(provider, model, working, wrappedDelta);
    if (r.thinking) thinkingAccum = (thinkingAccum || '') + r.thinking;
    lastTextContent = r.content || '';
    const calls = r.toolCalls || [];

    const serverCalls = calls.filter((tc) => SERVER_TOOLS.has(tc.name));
    const clientCalls = calls.filter((tc) => CLIENT_TOOLS.has(tc.name));
    const unknownCalls = calls.filter((tc) => !SERVER_TOOLS.has(tc.name) && !CLIENT_TOOLS.has(tc.name));

    allClientCalls.push(...clientCalls);

    if (serverCalls.length === 0) {
      allClientCalls.push(...unknownCalls);
      return { content: lastTextContent, toolCalls: allClientCalls, thinking: thinkingAccum };
    }

    const toolResults = serverCalls.map((tc) => {
      let result: any;
      try { result = executeServerTool(tc.name, tc.arguments || {}, mainWindow); }
      catch (e: any) { result = { error: (e && e.message) || String(e) }; }
      return { call: tc, result };
    });

    if (onDelta) {
      serverCalls.forEach((tc) => {
        onDelta({ type: 'server_tool', name: tc.name, arguments: tc.arguments || {}, loop });
      });
    }

    working.push({ role: 'assistant', content: lastTextContent, toolCalls: serverCalls });
    toolResults.forEach(({ call, result }) => {
      working.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: JSON.stringify(result) });
    });

    if (onDelta) {
      toolResults.forEach(({ call, result }) => {
        let summary = '';
        if (result && result.error) summary = `错误: ${result.error}`;
        else if (result && result.ambiguous) summary = `${result.candidates?.length || 0} 条候选`;
        else if (result && typeof result.count === 'number') summary = `找到 ${result.count} 条结果`;
        else if (result && result.success) summary = result.message || '执行完成';
        else summary = '执行完成';
        onDelta({ type: 'server_tool_done', name: call.name, summary, loop });
      });
    }

    const hasMutation = serverCalls.some((tc) => tc.name === 'complete_memo' || tc.name === 'delete_memo' || tc.name === 'update_memo');
    if (hasMutation && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memos-changed');
    }
  }

  return { content: lastTextContent || '（未能完成多轮工具调用，请重试）', toolCalls: allClientCalls, thinking: thinkingAccum };
}

// ===== 对外暴露的 LLM 调用 =====
export interface CallLLMOptions {
  modelId?: string;
  onDelta?: OnDelta;
}

export async function callLLM(messages: any[], online: boolean, options: CallLLMOptions, mainWindow: BrowserWindow | null): Promise<any> {
  const { onDelta, modelId } = options;

  if (modelId) {
    const m = getModelById(modelId);
    if (!m) throw new Error('指定的模型不存在');
    if (!m.enabled) throw new Error('指定的模型已禁用');
    const p = getProviderById(m.providerId);
    if (!p) throw new Error('该模型对应的 Provider 已被删除');
    if (!online && !isLocalUrl(p.baseUrl)) throw new Error('当前离线，且该模型不是本地 Provider');
    try {
      if (onDelta) onDelta({ type: 'model_start', providerName: p.name, modelLabel: modelLabel(p, m) });
      const r = await runConversation(p, m, messages, onDelta, mainWindow);
      updateModelRuntime(m.id, { lastError: null, lastUsedAt: new Date().toISOString() });
      return { ...r, providerName: p.name, modelName: m.name, modelLabel: modelLabel(p, m) };
    } catch (err: any) {
      const msg = (err && err.message) || String(err);
      updateModelRuntime(m.id, { lastError: msg });
      throw new Error(`${modelLabel(p, m)} 失败：${msg}`);
    }
  }

  // Auto 模式
  const allModels = getEnabledModelsOrdered();
  if (allModels.length === 0) throw new Error('未配置任何启用的模型');

  const candidates = allModels
    .map((m) => ({ m, p: getProviderById(m.providerId) }))
    .filter((x): x is { m: AiModel; p: AiProvider } => !!x.p && (online || isLocalUrl(x.p!.baseUrl)));

  if (candidates.length === 0) throw new Error('当前离线，未找到可用的本地模型');

  const primary = candidates[0];
  const errors: string[] = [];
  for (const { m, p } of candidates) {
    try {
      if (onDelta) onDelta({ type: 'model_start', providerName: p.name, modelLabel: modelLabel(p, m), fallbackFrom: m.id !== primary.m.id ? modelLabel(primary.p, primary.m) : undefined });
      const r = await runConversation(p, m, messages, onDelta, mainWindow);
      updateModelRuntime(m.id, { lastError: null, lastUsedAt: new Date().toISOString() });
      return {
        ...r, providerName: p.name, modelName: m.name, modelLabel: modelLabel(p, m),
        fallbackFrom: m.id !== primary.m.id ? modelLabel(primary.p, primary.m) : undefined,
      };
    } catch (err: any) {
      const msg = (err && err.message) || String(err);
      console.warn(`[AI] ${modelLabel(p, m)} 失败，降级到下一个: ${msg}`);
      updateModelRuntime(m.id, { lastError: msg });
      errors.push(`${modelLabel(p, m)}: ${msg}`);
      if (onDelta) onDelta({ type: 'model_failed', modelLabel: modelLabel(p, m), error: msg });
    }
  }
  throw new Error(`所有模型均不可用：\n${errors.join('\n')}`);
}

export async function testModel(providerInput: any, modelName: string, thinking: boolean): Promise<any> {
  const start = Date.now();
  const tempProvider: AiProvider = {
    id: providerInput.id || 'test', name: providerInput.name || 'test',
    type: providerInput.type, baseUrl: providerInput.baseUrl,
    apiKey: providerInput.apiKey || '', createdAt: new Date().toISOString(),
  };
  const tempModel: AiModel = {
    id: 'test-model', providerId: tempProvider.id, name: modelName,
    enabled: true, thinking: !!thinking, priority: 0, createdAt: new Date().toISOString(),
  };
  try {
    const r = await invokeModel(tempProvider, tempModel, [{ role: 'user', content: '你好，请回复"ok"两个字。' }]);
    return { success: true, latencyMs: Date.now() - start, modelEcho: (r.content || '').slice(0, 60) };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export async function getOllamaModels(baseUrl: string): Promise<any> {
  try {
    const url = (baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '') + '/api/tags';
    const { data } = await httpJson({ url, method: 'GET', timeoutMs: 5000 });
    const models = (data.models || []).map((m: any) => m.name || m.model).filter(Boolean);
    return { success: true, models };
  } catch (err: any) {
    return { success: false, error: err.message || String(err), models: [] };
  }
}
