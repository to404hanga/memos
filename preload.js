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
  onReminder: (callback) => {
    ipcRenderer.on('reminder-triggered', (_, data) => callback(data));
  },
});
