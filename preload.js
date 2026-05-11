const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getMemos: () => ipcRenderer.invoke('get-memos'),
  addMemo: (memo) => ipcRenderer.invoke('add-memo', memo),
  updateMemo: (memo) => ipcRenderer.invoke('update-memo', memo),
  deleteMemo: (id) => ipcRenderer.invoke('delete-memo', id),
  toggleComplete: (id) => ipcRenderer.invoke('toggle-complete', id),
  selectImage: () => ipcRenderer.invoke('select-image'),
  getImagePath: (fileName) => ipcRenderer.invoke('get-image-path', fileName),
  onReminder: (callback) => {
    ipcRenderer.on('reminder-triggered', (_, data) => callback(data));
  },
});
