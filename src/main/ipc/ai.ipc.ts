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
