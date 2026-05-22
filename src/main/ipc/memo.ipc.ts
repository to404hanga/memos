import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDb } from '../database';
import { getAllMemos, getTrashMemos, getMemoById, insertMemo, updateMemoInDb, searchMemos, Memo } from '../database/memo.repo';
import { getTags, addTag, updateTag, deleteTag } from '../database/settings.repo';
import { scheduleReminder, clearMemoTimers } from '../scheduler';
import { testWebhook } from '../webhook';

export function registerMemoIpc(mainWindow: BrowserWindow | null): void {
  ipcMain.handle('get-memos', () => getAllMemos());

  ipcMain.handle('search-memos', (_, keyword: string) => searchMemos(keyword));

  ipcMain.handle('select-image', async () => {
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const srcPath = result.filePaths[0];
    const ext = path.extname(srcPath);
    const fileName = `${uuidv4()}${ext}`;

    const imagesDir = path.join(app.getPath('userData'), 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const destPath = path.join(imagesDir, fileName);
    fs.copyFileSync(srcPath, destPath);
    return { fileName, filePath: destPath };
  });

  ipcMain.handle('save-dropped-image', (_, srcPath: string) => {
    const ext = path.extname(srcPath).toLowerCase();
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
    if (!allowed.includes(ext)) return null;

    const fileName = `${uuidv4()}${ext}`;
    const imagesDir = path.join(app.getPath('userData'), 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const destPath = path.join(imagesDir, fileName);
    fs.copyFileSync(srcPath, destPath);
    return { fileName, filePath: destPath };
  });

  ipcMain.handle('get-image-path', (_, fileName: string) => {
    return path.join(app.getPath('userData'), 'images', fileName);
  });

  ipcMain.handle('select-attachment', async () => {
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: '所有文件', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const srcPath = result.filePaths[0];
    const originalName = path.basename(srcPath);
    const ext = path.extname(srcPath);
    const fileName = `${uuidv4()}${ext}`;
    const stats = fs.statSync(srcPath);

    const attachDir = path.join(app.getPath('userData'), 'attachments');
    if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

    const destPath = path.join(attachDir, fileName);
    fs.copyFileSync(srcPath, destPath);
    return { fileName, originalName, size: stats.size, filePath: destPath };
  });

  ipcMain.handle('save-dropped-file', (_, srcPath: string) => {
    if (!fs.existsSync(srcPath)) return null;
    const originalName = path.basename(srcPath);
    const ext = path.extname(srcPath);
    const fileName = `${uuidv4()}${ext}`;
    const stats = fs.statSync(srcPath);

    const attachDir = path.join(app.getPath('userData'), 'attachments');
    if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

    const destPath = path.join(attachDir, fileName);
    fs.copyFileSync(srcPath, destPath);
    return { fileName, originalName, size: stats.size, filePath: destPath };
  });

  ipcMain.handle('open-attachment', (_, filePath: string) => {
    const { shell } = require('electron');
    shell.openPath(filePath);
  });

  ipcMain.handle('add-memo', (_, memo: any) => {
    const newMemo: Memo = {
      id: uuidv4(),
      title: memo.title,
      content: memo.content || '',
      reminderTime: memo.reminderTime || null,
      recurrence: memo.recurrence || null,
      reminders: memo.reminders || [],
      mutePeriods: memo.mutePeriods || [],
      attachments: memo.attachments || [],
      webhook: memo.webhook || null,
      completed: false,
      pinned: false,
      tags: memo.tags || [],
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    insertMemo(newMemo);
    scheduleReminder(newMemo, mainWindow);
    return newMemo;
  });

  ipcMain.handle('update-memo', (_, updatedMemo: any) => {
    const existing = getMemoById(updatedMemo.id);
    if (!existing) return null;
    const merged = { ...existing, ...updatedMemo };
    updateMemoInDb(merged);
    scheduleReminder(merged, mainWindow);
    return merged;
  });

  ipcMain.handle('delete-memo', (_, id: string) => {
    const db = getDb();
    db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    saveDb();
    clearMemoTimers(id);
    return true;
  });

  ipcMain.handle('get-trash', () => getTrashMemos());

  ipcMain.handle('restore-memo', (_, id: string) => {
    const db = getDb();
    db.run('UPDATE memos SET deleted_at = NULL WHERE id = ?', [id]);
    saveDb();
    const memo = getMemoById(id);
    if (memo) scheduleReminder(memo, mainWindow);
    return memo;
  });

  ipcMain.handle('permanent-delete', (_, id: string) => {
    const db = getDb();
    db.run('DELETE FROM memos WHERE id = ?', [id]);
    saveDb();
    return true;
  });

  ipcMain.handle('empty-trash', () => {
    const db = getDb();
    db.run('DELETE FROM memos WHERE deleted_at IS NOT NULL');
    saveDb();
    return true;
  });

  ipcMain.handle('toggle-complete', (_, id: string) => {
    const memo = getMemoById(id);
    if (!memo) return null;
    memo.completed = !memo.completed;
    updateMemoInDb(memo);
    if (memo.completed) clearMemoTimers(id);
    else scheduleReminder(memo, mainWindow);
    return memo;
  });

  ipcMain.handle('toggle-pin', (_, id: string) => {
    const memo = getMemoById(id);
    if (!memo) return null;
    memo.pinned = !memo.pinned;
    updateMemoInDb(memo);
    return memo;
  });

  // 标签管理
  ipcMain.handle('get-tags', () => getTags());
  ipcMain.handle('add-tag', (_, tag: any) => addTag(tag));
  ipcMain.handle('update-tag', (_, tag: any) => updateTag(tag));
  ipcMain.handle('delete-tag', (_, id: string) => deleteTag(id, getAllMemos));

  // Webhook 测试
  ipcMain.handle('test-webhook', async (_, url: string, content: string, memoData: any) => {
    return testWebhook(url, content, memoData);
  });
}
