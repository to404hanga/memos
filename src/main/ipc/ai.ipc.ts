/**
 * AI 相关 IPC 处理器
 *
 * 注册所有 AI 功能的 IPC 通信：
 *
 * Provider/Model 管理（ipcMain.handle）：
 * - ai-get-providers, ai-save-provider, ai-delete-provider
 * - ai-get-models, ai-save-model, ai-delete-model, ai-toggle-model, ai-reorder-models
 * - ai-has-usable-model: 检查是否有可用模型（考虑网络状态）
 * - ai-test-model: 发送测试请求验证连接
 * - ai-ollama-models: 获取 Ollama 本地已安装模型
 *
 * Prompt 模板（ipcMain.handle）：
 * - ai-get-prompt-template, ai-set-prompt-template
 *
 * AI 对话（混合模式）：
 * - ai-chat-stream（ipcMain.on）: 流式对话，通过 event.sender.send 推送 chunk
 * - ai-chat（ipcMain.handle）: 非流式对话，一次性返回完整结果
 *
 * 对话历史（ipcMain.handle）：
 * - ai-get-conversations, ai-get-conversation, ai-save-conversation
 * - ai-delete-conversation, ai-clear-conversations
 *
 * 注意：流式对话使用 ipcMain.on 而非 handle，因为需要多次发送中间结果。
 */
import { ipcMain, BrowserWindow, net } from 'electron';
import { getAllProviders, saveProvider, deleteProvider, getAllModels, saveModel, deleteModel, setModelEnabled, reorderModels, getProviderById, getEnabledModelsOrdered, isLocalUrl } from '../database/ai.repo';
import { getSetting, setSetting, getConversations, getConversation, saveConversation, deleteConversation, clearConversations } from '../database/settings.repo';
import { callLLM, testModel, getOllamaModels } from '../ai';

export function registerAiIpc(mainWindow: BrowserWindow | null): void {
  // Provider CRUD
  ipcMain.handle('ai-get-providers', () => getAllProviders());
  ipcMain.handle('ai-save-provider', (_, input: any) => saveProvider(input));
  ipcMain.handle('ai-delete-provider', (_, id: string) => deleteProvider(id));

  // Model CRUD
  ipcMain.handle('ai-get-models', () => getAllModels());
  ipcMain.handle('ai-save-model', (_, input: any) => saveModel(input));
  ipcMain.handle('ai-delete-model', (_, id: string) => deleteModel(id));
  ipcMain.handle('ai-toggle-model', (_, id: string, enabled: boolean) => setModelEnabled(id, !!enabled));
  ipcMain.handle('ai-reorder-models', (_, sortedIds: string[]) => {
    reorderModels(sortedIds || []);
    return true;
  });

  ipcMain.handle('ai-has-usable-model', () => {
    const online = net.isOnline();
    const models = getEnabledModelsOrdered();
    return models.some((m) => {
      const p = getProviderById(m.providerId);
      return p && (online || isLocalUrl(p.baseUrl));
    });
  });

  ipcMain.handle('ai-test-model', async (_, providerInput: any, modelName: string, thinking: boolean) => {
    return testModel(providerInput, modelName, thinking);
  });

  ipcMain.handle('ai-ollama-models', async (_, baseUrl: string) => {
    return getOllamaModels(baseUrl);
  });

  // Prompt Template
  ipcMain.handle('ai-get-prompt-template', () => getSetting('ai_prompt_template'));
  ipcMain.handle('ai-set-prompt-template', (_, template: string) => {
    setSetting('ai_prompt_template', template || '');
    return true;
  });

  // 流式润色 (ASR 后处理)
  ipcMain.on('ai-polish-stream', async (event, args: { text: string; streamId: string }) => {
    const { text, streamId } = args;
    const online = net.isOnline();
    if (!text || !text.trim()) {
      event.sender.send('ai-polish-chunk', { streamId, type: 'done', content: '' });
      return;
    }

    const prompt = `你是一个专业的备忘录文本润色助手。请整理以下语音识别文本，去除 '啊'、'那个' 等无意义的语气词，修正语法错误，保持原意不变，直接输出结果，不要解释。待润色文本：\n${text}`;
    const messages = [{ role: 'user', content: prompt }];

    const emit = (chunk: any) => {
      if (event.sender.isDestroyed()) return;
      // 注意：callLLM 的 onDelta 吐出的字段名是 text
      if (chunk.type === 'content_delta' && chunk.text) {
        event.sender.send('ai-polish-chunk', { streamId, type: 'chunk', content: chunk.text });
      }
    };

    try {
      // 这里的 modelId 不传会使用 Auto 模式，或可由前端指定
      const r = await callLLM(messages, online, { onDelta: emit }, mainWindow);
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai-polish-chunk', { streamId, type: 'done' });
      }
    } catch (err: any) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ai-polish-chunk', { streamId, type: 'error', error: err.message || String(err) });
      }
    }
  });

  // 流式 AI Chat
  ipcMain.on('ai-chat-stream', async (event, args: any) => {
    const online = net.isOnline();
    const messages = (args && args.messages) || [];
    const modelId = args && args.modelId;
    const streamId = args && args.streamId || Date.now().toString();

    const emit = (chunk: any) => {
      if (event.sender.isDestroyed()) return;
      event.sender.send('ai-chat-chunk', { streamId, ...chunk });
    };

    try {
      const r = await callLLM(messages, online, { modelId, onDelta: (delta: any) => emit(delta) }, mainWindow);
      emit({
        type: 'done',
        message: {
          role: 'assistant', content: r.content || '', toolCalls: r.toolCalls || [],
          thinking: r.thinking, providerName: r.providerName, modelName: r.modelName,
          modelLabel: r.modelLabel, fallbackFrom: r.fallbackFrom, ts: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      emit({ type: 'error', error: err.message || String(err) });
    }
  });

  // 非流式 ai-chat
  ipcMain.handle('ai-chat', async (_, args: any) => {
    const online = net.isOnline();
    const messages = Array.isArray(args) ? args : (args && args.messages) || [];
    const modelId = !Array.isArray(args) && args ? args.modelId : undefined;
    try {
      const r = await callLLM(messages, online, { modelId }, mainWindow);
      return {
        message: {
          role: 'assistant', content: r.content || '', toolCalls: r.toolCalls || [],
          thinking: r.thinking, providerName: r.providerName, modelName: r.modelName,
          modelLabel: r.modelLabel, fallbackFrom: r.fallbackFrom, ts: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      return { message: { role: 'assistant', content: '', ts: new Date().toISOString() }, error: err.message || String(err) };
    }
  });

  // AI 对话历史
  ipcMain.handle('ai-get-conversations', () => getConversations());
  ipcMain.handle('ai-get-conversation', (_, id: string) => getConversation(id));
  ipcMain.handle('ai-save-conversation', (_, conv: any) => saveConversation(conv));
  ipcMain.handle('ai-delete-conversation', (_, id: string) => deleteConversation(id));
  ipcMain.handle('ai-clear-conversations', () => clearConversations());
}
