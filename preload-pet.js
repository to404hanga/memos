const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  // 获取当前状态（含 currentPet）
  getState: () => ipcRenderer.invoke('pet:get-state'),

  // 监听状态更新
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
});
