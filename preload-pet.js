const { contextBridge, ipcRenderer } = require('electron');

// ==================== window.api（与主窗口一致，供复用 useAiChat 等 hook） ====================
contextBridge.exposeInMainWorld('api', {
  // AI Chat（useAiChat 依赖）
  aiGetConversations: () => ipcRenderer.invoke('ai-get-conversations'),
  aiSaveConversation: (conv) => ipcRenderer.invoke('ai-save-conversation', conv),
  aiGetConversation: (id) => ipcRenderer.invoke('ai-get-conversation', id),
  aiDeleteConversation: (id) => ipcRenderer.invoke('ai-delete-conversation', id),
  aiClearConversations: () => ipcRenderer.invoke('ai-clear-conversations'),
  aiHasUsableModel: () => ipcRenderer.invoke('ai-has-usable-model'),
  aiGetProviders: () => ipcRenderer.invoke('ai-get-providers'),
  aiGetModels: () => ipcRenderer.invoke('ai-get-models'),
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
    ipcRenderer.removeAllListeners('ai-chat-chunk');
  },
  // 备忘录操作（创建备忘录预览卡片确认时需要）
  addMemo: (memo) => ipcRenderer.invoke('add-memo', memo),
  getTags: () => ipcRenderer.invoke('get-tags'),
  onMemosChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('memos-changed', handler);
    return () => ipcRenderer.removeListener('memos-changed', handler);
  },
});

// ==================== window.petApi（桌宠专用） ====================
contextBridge.exposeInMainWorld('petApi', {
  // 状态
  getState: () => ipcRenderer.invoke('pet:get-state'),
  onStateUpdate: (callback) => {
    const handler = (_, state) => callback(state);
    ipcRenderer.on('pet:state-update', handler);
    return () => ipcRenderer.removeListener('pet:state-update', handler);
  },

  // 宠物列表与切换
  getPets: () => ipcRenderer.invoke('pet:get-pets'),
  setCurrentPet: (petId) => ipcRenderer.invoke('pet:set-current-pet', petId),
  getGifPath: (petId, state) => ipcRenderer.invoke('pet:get-gif-path', petId, state),

  // 拖拽操作
  startDrag: () => ipcRenderer.send('pet:start-drag'),
  moveWindow: (dx, dy) => ipcRenderer.send('pet:move-window', dx, dy),
  endDrag: () => ipcRenderer.send('pet:end-drag'),

  // 鼠标穿透控制
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('pet:set-ignore-mouse', ignore, options),

  // 显示/隐藏
  setVisible: (visible) => ipcRenderer.invoke('pet:set-visible', visible),

  // 对话框开关
  openChatDialog: (size) => ipcRenderer.send('pet:open-chat-dialog', size),
  closeChatDialog: () => ipcRenderer.send('pet:close-chat-dialog'),

  // 布局方向（宠物在窗口顶部还是底部）
  onLayoutDirection: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('pet:layout-direction', handler);
    return () => ipcRenderer.removeListener('pet:layout-direction', handler);
  },

  // Agent 状态
  setAgentState: (state) => ipcRenderer.send('pet:set-agent-state', state),

  // 通知主窗口刷新备忘录
  notifyMemosChanged: () => ipcRenderer.send('pet:notify-memos-changed'),

  // 提醒事件
  onReminder: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('pet:reminder', handler);
    return () => ipcRenderer.removeListener('pet:reminder', handler);
  },

  // 确认提醒（回到 idle）
  dismissReminder: () => ipcRenderer.send('pet:set-agent-state', 'idle'),

  // 完成备忘录
  completeMemo: (id) => ipcRenderer.invoke('toggle-complete', id),

  // 延后提醒（分钟）
  snoozeMemo: (id, minutes) => ipcRenderer.invoke('pet:snooze-memo', id, minutes),
});
