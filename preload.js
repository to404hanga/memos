const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getMemos: () => ipcRenderer.invoke('get-memos'),
  searchMemos: (keyword) => ipcRenderer.invoke('search-memos', keyword),
  addMemo: (memo) => ipcRenderer.invoke('add-memo', memo),
  updateMemo: (memo) => ipcRenderer.invoke('update-memo', memo),
  deleteMemo: (id) => ipcRenderer.invoke('delete-memo', id),
  getTrash: () => ipcRenderer.invoke('get-trash'),
  restoreMemo: (id) => ipcRenderer.invoke('restore-memo', id),
  permanentDelete: (id) => ipcRenderer.invoke('permanent-delete', id),
  emptyTrash: () => ipcRenderer.invoke('empty-trash'),
  toggleComplete: (id) => ipcRenderer.invoke('toggle-complete', id),
  togglePin: (id) => ipcRenderer.invoke('toggle-pin', id),
  selectImage: () => ipcRenderer.invoke('select-image'),
  saveDroppedImage: (filePath) => ipcRenderer.invoke('save-dropped-image', filePath),
  getImagePath: (fileName) => ipcRenderer.invoke('get-image-path', fileName),
  selectAttachment: () => ipcRenderer.invoke('select-attachment'),
  saveDroppedFile: (filePath) => ipcRenderer.invoke('save-dropped-file', filePath),
  openAttachment: (filePath) => ipcRenderer.invoke('open-attachment', filePath),
  getTags: () => ipcRenderer.invoke('get-tags'),
  addTag: (tag) => ipcRenderer.invoke('add-tag', tag),
  updateTag: (tag) => ipcRenderer.invoke('update-tag', tag),
  deleteTag: (id) => ipcRenderer.invoke('delete-tag', id),
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),
  testWebhook: (url, content, memo) => ipcRenderer.invoke('test-webhook', url, content, memo),
  // AI Providers
  aiGetProviders: () => ipcRenderer.invoke('ai-get-providers'),
  aiSaveProvider: (provider) => ipcRenderer.invoke('ai-save-provider', provider),
  aiDeleteProvider: (id) => ipcRenderer.invoke('ai-delete-provider', id),
  // AI Models
  aiGetModels: () => ipcRenderer.invoke('ai-get-models'),
  aiSaveModel: (model) => ipcRenderer.invoke('ai-save-model', model),
  aiDeleteModel: (id) => ipcRenderer.invoke('ai-delete-model', id),
  aiToggleModel: (id, enabled) => ipcRenderer.invoke('ai-toggle-model', id, enabled),
  aiReorderModels: (sortedIds) => ipcRenderer.invoke('ai-reorder-models', sortedIds),
  aiTestModel: (provider, modelName, thinking) => ipcRenderer.invoke('ai-test-model', provider, modelName, thinking),
  aiOllamaModels: (baseUrl) => ipcRenderer.invoke('ai-ollama-models', baseUrl),
  aiGetPromptTemplate: () => ipcRenderer.invoke('ai-get-prompt-template'),
  aiSetPromptTemplate: (template) => ipcRenderer.invoke('ai-set-prompt-template', template),
  aiHasUsableModel: () => ipcRenderer.invoke('ai-has-usable-model'),
  // AI Chat
  aiChat: (args) => ipcRenderer.invoke('ai-chat', args),
  aiChatStream: (args, onChunk) => {
    const streamId = args.streamId || Date.now().toString();
    const handler = (_, chunk) => {
      if (chunk.streamId !== streamId) return;
      onChunk(chunk);
      if (chunk.type === 'done' || chunk.type === 'error') {
        ipcRenderer.removeListener('ai-chat-chunk', handler);
      }
    };
    ipcRenderer.on('ai-chat-chunk', handler);
    ipcRenderer.send('ai-chat-stream', { ...args, streamId });
    return streamId;
  },
  aiChatStreamOff: (streamId) => {
    // 用于清理（组件卸载时）
    ipcRenderer.removeAllListeners('ai-chat-chunk');
  },
  // AI Conversations
  aiGetConversations: () => ipcRenderer.invoke('ai-get-conversations'),
  aiGetConversation: (id) => ipcRenderer.invoke('ai-get-conversation', id),
  aiSaveConversation: (conv) => ipcRenderer.invoke('ai-save-conversation', conv),
  aiDeleteConversation: (id) => ipcRenderer.invoke('ai-delete-conversation', id),
  aiClearConversations: () => ipcRenderer.invoke('ai-clear-conversations'),
  // ASR 语音识别
  asrGetStatus: () => ipcRenderer.invoke('asr:status'),
  asrRequestMicPermission: () => ipcRenderer.invoke('asr:request-mic-permission'),
  asrStartRecording: () => ipcRenderer.invoke('asr:start-recording'),
  asrStopRecording: () => ipcRenderer.invoke('asr:stop-recording'),
  asrCancelRecording: () => ipcRenderer.invoke('asr:cancel-recording'),
  asrCheckVadStopped: () => ipcRenderer.invoke('asr:check-vad-stopped'),
  asrRecognize: (audioBuffer) => ipcRenderer.invoke('asr:recognize', audioBuffer),
  asrPreload: () => ipcRenderer.invoke('asr:preload'),
  asrDownload: () => ipcRenderer.invoke('asr:download'),
  asrCancelDownload: () => ipcRenderer.invoke('asr:cancel-download'),
  onAsrDownloadProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    ipcRenderer.on('asr:download-progress', handler);
    return () => ipcRenderer.removeListener('asr:download-progress', handler);
  },
  onReminder: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('reminder-triggered', handler);
    return () => ipcRenderer.removeListener('reminder-triggered', handler);
  },
  onMemosChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('memos-changed', handler);
    return () => ipcRenderer.removeListener('memos-changed', handler);
  },
});
