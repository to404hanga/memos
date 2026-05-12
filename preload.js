const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getMemos: () => ipcRenderer.invoke('get-memos'),
  searchMemos: (keyword) => ipcRenderer.invoke('search-memos', keyword),
  addMemo: (memo) => ipcRenderer.invoke('add-memo', memo),
  updateMemo: (memo) => ipcRenderer.invoke('update-memo', memo),
  deleteMemo: (id) => ipcRenderer.invoke('delete-memo', id),
  toggleComplete: (id) => ipcRenderer.invoke('toggle-complete', id),
  togglePin: (id) => ipcRenderer.invoke('toggle-pin', id),
  selectImage: () => ipcRenderer.invoke('select-image'),
  saveDroppedImage: (filePath) => ipcRenderer.invoke('save-dropped-image', filePath),
  getImagePath: (fileName) => ipcRenderer.invoke('get-image-path', fileName),
  getTags: () => ipcRenderer.invoke('get-tags'),
  addTag: (tag) => ipcRenderer.invoke('add-tag', tag),
  updateTag: (tag) => ipcRenderer.invoke('update-tag', tag),
  deleteTag: (id) => ipcRenderer.invoke('delete-tag', id),
  onReminder: (callback) => {
    ipcRenderer.on('reminder-triggered', (_, data) => callback(data));
  },
});
