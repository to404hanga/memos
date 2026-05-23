/**
 * AI 对话循环与 Provider 调度模块
 *
 * 负责：
 * - 系统提示词构建（buildSystemPrompt）
 * - 模型调用统一入口（invokeModel）
 * - 多轮工具循环（runConversation）
 * - 多 Provider 自动降级（callLLM）
 * - 模型测试与 Ollama 模型列表获取
 */
import { BrowserWindow } from 'electron';
import { AiProvider, AiModel, getProviderById, getModelById, getEnabledModelsOrdered, updateModelRuntime, isLocalUrl } from '../database/ai.repo';
import { getTagNames, getSetting } from '../database/settings.repo';
import { callOpenAi, callAnthropic, callOllama, OnDelta, LLMResult } from './providers';
import { httpJson } from './http';
import { AI_TOOLS_OPENAI, AI_TOOLS_ANTHROPIC, CLIENT_TOOLS, SERVER_TOOLS } from './tools';
import { executeServerTool } from './executor';
import { compressMessages } from './compact';

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
    '- list_memos：查询用户已有的待办列表。支持多关键词搜索（keyword 空格分隔取交集，keywords 数组取并集），可按标签、状态、时间范围筛选',
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
    '11. 搜索技巧：若单个关键词搜不到结果，尝试用 keywords 数组传入同义词/近义词/相关词扩展搜索',
    '12. 时间范围查询：用户说"这个月"/"上周"/"最近三天"等，转为 dateFrom/dateTo 参数',
  ].join('\n');
}

// ===== 模型调用统一入口 =====
async function invokeModel(provider: AiProvider, model: AiModel, messages: any[], onDelta?: OnDelta): Promise<LLMResult> {
  const systemPrompt = buildSystemPrompt();
  const compressed = model.maxContext
    ? await compressMessages(messages, model.maxContext, provider, model)
    : messages;
  if (provider.type === 'anthropic') {
    return callAnthropic(provider, model, compressed, AI_TOOLS_ANTHROPIC, systemPrompt, onDelta);
  }
  if (provider.type === 'ollama') {
    return callOllama(provider, model, compressed, AI_TOOLS_OPENAI.map((t) => t.function), systemPrompt, onDelta);
  }
  return callOpenAi(provider, model, compressed, AI_TOOLS_OPENAI, systemPrompt, onDelta);
}

function modelLabel(provider: AiProvider, model: AiModel): string {
  return `${provider.name} / ${model.displayName || model.name}`;
}

// ===== 多轮工具循环 =====
const MAX_TOOL_LOOPS = 4;

/**
 * 多轮工具调用对话循环
 *
 * 流程：发送消息给模型 → 模型返回工具调用 → 执行服务端工具 → 将结果追加到上下文 → 再次发送给模型
 * 最多循环 MAX_TOOL_LOOPS 轮，直到模型不再调用服务端工具为止。
 *
 * 工具分类：
 * - 服务端工具（SERVER_TOOLS）：在主进程直接执行，结果反馈给模型继续对话
 * - 客户端工具（CLIENT_TOOLS）：返回给前端处理（如 create_memo 生成预览卡片）
 * - 未知工具：归为客户端工具返回
 */
async function runConversation(provider: AiProvider, model: AiModel, initialMessages: any[], onDelta: OnDelta | undefined, mainWindow: BrowserWindow | null): Promise<LLMResult & { providerName?: string; modelName?: string; modelLabel?: string; fallbackFrom?: string }> {
  let working = [...initialMessages];
  const allClientCalls: any[] = [];  // 累积所有需要前端处理的工具调用
  let lastTextContent = '';           // 模型最后一次回复的文本内容
  let thinkingAccum: string | undefined;  // 累积多轮的思考内容

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    // 包装 onDelta 回调，注入当前循环轮次
    const wrappedDelta: OnDelta | undefined = onDelta ? (chunk) => onDelta({ ...chunk, loop }) : undefined;
    const r = await invokeModel(provider, model, working, wrappedDelta);
    if (r.thinking) thinkingAccum = (thinkingAccum || '') + r.thinking;
    lastTextContent = r.content || '';
    const calls = r.toolCalls || [];

    // 按类型分拣工具调用
    const serverCalls = calls.filter((tc) => SERVER_TOOLS.has(tc.name));
    const clientCalls = calls.filter((tc) => CLIENT_TOOLS.has(tc.name));
    const unknownCalls = calls.filter((tc) => !SERVER_TOOLS.has(tc.name) && !CLIENT_TOOLS.has(tc.name));

    allClientCalls.push(...clientCalls);

    // 无服务端工具调用 → 对话结束，返回结果
    if (serverCalls.length === 0) {
      allClientCalls.push(...unknownCalls);
      return { content: lastTextContent, toolCalls: allClientCalls, thinking: thinkingAccum };
    }

    // 执行所有服务端工具
    const toolResults = serverCalls.map((tc) => {
      let result: any;
      try { result = executeServerTool(tc.name, tc.arguments || {}, mainWindow); }
      catch (e: any) { result = { error: (e && e.message) || String(e) }; }
      return { call: tc, result };
    });

    // 通知前端：工具开始执行
    if (onDelta) {
      serverCalls.forEach((tc) => {
        onDelta({ type: 'server_tool', name: tc.name, arguments: tc.arguments || {}, loop });
      });
    }

    // 将 assistant 回复和工具执行结果追加到上下文，供下一轮模型调用
    working.push({ role: 'assistant', content: lastTextContent, toolCalls: serverCalls });
    toolResults.forEach(({ call, result }) => {
      working.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: JSON.stringify(result) });
    });

    // 通知前端：工具执行完成 + 摘要
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

    // 如果有写操作（完成/删除/更新），通知前端刷新列表
    const hasMutation = serverCalls.some((tc) => tc.name === 'complete_memo' || tc.name === 'delete_memo' || tc.name === 'update_memo');
    if (hasMutation && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('memos-changed');
    }
  }

  // 达到最大循环次数仍未结束
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
