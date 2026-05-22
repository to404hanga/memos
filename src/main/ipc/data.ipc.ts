/**
 * 数据导入导出 IPC 处理器
 *
 * 导出功能（export-data）：
 * - 将所有备忘录、标签数据序列化为 JSON
 * - 收集关联的图片和附件文件
 * - 内容中的本地图片路径转换为相对路径
 * - 打包为 ZIP 文件（备忘录导出_YYYY-MM-DD.zip）
 * - ZIP 结构：folderName/memos.json + folderName/images/ + folderName/attachments/
 *
 * 导入功能（import-data）：
 * - 解压 ZIP 文件，定位 memos.json
 * - 提取图片/附件到 userData 对应目录（不覆盖已有文件）
 * - 导入标签（INSERT OR IGNORE 避免冲突）
 * - 导入备忘录（按 ID 去重，已存在则跳过）
 * - 还原图片路径为本地绝对路径
 * - 为新导入的备忘录注册提醒调度
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import AdmZip from 'adm-zip';
import { getDb, saveDb } from '../database';
import { getAllMemos, getMemoById, insertMemo, Memo } from '../database/memo.repo';
import { scheduleReminder } from '../scheduler';

export function registerDataIpc(mainWindow: BrowserWindow | null): void {
  ipcMain.handle('export-data', async () => {
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    if (!win) return { success: false };
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const folderName = `备忘录导出_${dateSuffix}`;
    const result = await dialog.showSaveDialog(win, {
      title: '导出备忘录',
      defaultPath: `${folderName}.zip`,
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { success: false };

    try {
      const zip = new AdmZip();
      const memos = getAllMemos();
      const db = getDb();
      const tags: any[] = [];
      const tagStmt = db.prepare('SELECT * FROM tags ORDER BY name');
      while (tagStmt.step()) tags.push(tagStmt.getAsObject());
      tagStmt.free();

      const imagesDir = path.join(app.getPath('userData'), 'images');
      const imageFiles = new Set<string>();
      const attachmentFiles = new Set<string>();

      const exportMemos = memos.map((m) => {
        let content = m.content || '';
        const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        content = content.replace(imgRegex, (match: string, alt: string, imgPath: string) => {
          if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) return match;
          const fileName = path.basename(imgPath);
          const fullPath = imgPath.startsWith('/') ? imgPath : path.join(imagesDir, fileName);
          if (fs.existsSync(fullPath)) {
            imageFiles.add(fullPath);
            return `![${alt}](images/${fileName})`;
          }
          return match;
        });
        const exportAttachments = (m.attachments || []).map((att: any) => {
          if (att.filePath && fs.existsSync(att.filePath)) {
            attachmentFiles.add(att.filePath);
            return { ...att, filePath: `attachments/${att.fileName}` };
          }
          return att;
        });
        return { ...m, content, attachments: exportAttachments };
      });

      zip.addFile(`${folderName}/memos.json`, Buffer.from(JSON.stringify({ memos: exportMemos, tags }, null, 2), 'utf-8'));
      imageFiles.forEach((imgPath) => {
        const fileName = path.basename(imgPath);
        zip.addLocalFile(imgPath, `${folderName}/images`, fileName);
      });
      attachmentFiles.forEach((attPath) => {
        const fileName = path.basename(attPath);
        zip.addLocalFile(attPath, `${folderName}/attachments`, fileName);
      });

      zip.writeZip(result.filePath);
      return { success: true, path: result.filePath, count: memos.length };
    } catch (err: any) {
      console.error('[导出] 失败:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('import-data', async () => {
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    if (!win) return { success: false };
    const result = await dialog.showOpenDialog(win, {
      title: '导入备忘录',
      properties: ['openFile'],
      filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false };

    try {
      const zip = new AdmZip(result.filePaths[0]);
      const entries = zip.getEntries();

      let prefix = '';
      const jsonEntry = entries.find((e) => e.entryName.endsWith('memos.json'));
      if (!jsonEntry) return { success: false, error: '无效的备忘录导出文件' };
      prefix = jsonEntry.entryName.replace('memos.json', '');

      const data = JSON.parse(jsonEntry.getData().toString('utf-8'));
      if (!data.memos || !Array.isArray(data.memos)) return { success: false, error: '数据格式错误' };

      const imagesDir = path.join(app.getPath('userData'), 'images');
      if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

      const imagePrefix = `${prefix}images/`;
      entries.filter((e) => e.entryName.startsWith(imagePrefix) && !e.isDirectory).forEach((entry) => {
        const fileName = path.basename(entry.entryName);
        const destPath = path.join(imagesDir, fileName);
        if (!fs.existsSync(destPath)) fs.writeFileSync(destPath, entry.getData());
      });

      const attachDir = path.join(app.getPath('userData'), 'attachments');
      if (!fs.existsSync(attachDir)) fs.mkdirSync(attachDir, { recursive: true });

      const attachPrefix = `${prefix}attachments/`;
      entries.filter((e) => e.entryName.startsWith(attachPrefix) && !e.isDirectory).forEach((entry) => {
        const fileName = path.basename(entry.entryName);
        const destPath = path.join(attachDir, fileName);
        if (!fs.existsSync(destPath)) fs.writeFileSync(destPath, entry.getData());
      });

      const db = getDb();
      let tagsImported = 0;
      if (data.tags && Array.isArray(data.tags)) {
        data.tags.forEach((tag: any) => {
          try {
            db.run('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)', [tag.id || uuidv4(), tag.name, tag.color || '#007aff']);
            tagsImported++;
          } catch (e) {}
        });
      }

      let imported = 0;
      let skipped = 0;
      data.memos.forEach((m: any) => {
        const existing = getMemoById(m.id);
        if (existing) { skipped++; return; }

        let content = m.content || '';
        const imgRegex = /!\[([^\]]*)\]\(images\/([^)]+)\)/g;
        content = content.replace(imgRegex, (match: string, alt: string, fileName: string) => {
          const localPath = path.join(imagesDir, fileName);
          if (fs.existsSync(localPath)) return `![${alt}](${localPath})`;
          return match;
        });

        const importAttachments = (m.attachments || []).map((att: any) => {
          if (att.filePath && att.filePath.startsWith('attachments/')) {
            return { ...att, filePath: path.join(attachDir, att.fileName) };
          }
          return att;
        });

        const newMemo: Memo = {
          id: m.id || uuidv4(),
          title: m.title,
          content,
          reminderTime: m.reminderTime || null,
          recurrence: m.recurrence || null,
          reminders: m.reminders || [],
          mutePeriods: m.mutePeriods || [],
          attachments: importAttachments,
          webhook: null,
          completed: m.completed || false,
          pinned: m.pinned || false,
          tags: m.tags || [],
          createdAt: m.createdAt || new Date().toISOString(),
          deletedAt: null,
        };
        insertMemo(newMemo);
        scheduleReminder(newMemo, mainWindow);
        imported++;
      });

      saveDb();
      return { success: true, imported, skipped, tagsImported };
    } catch (err: any) {
      console.error('[导入] 失败:', err);
      return { success: false, error: err.message };
    }
  });
}
