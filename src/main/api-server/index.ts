import * as http from 'http';
import { v4 as uuidv4 } from 'uuid';
import { getDb, saveDb } from '../database';
import { getAllMemos, getTrashMemos, getMemoById, insertMemo, updateMemoInDb, searchMemos, Memo } from '../database/memo.repo';
import { scheduleReminder, clearMemoTimers } from '../scheduler';
import { BrowserWindow } from 'electron';

const CLI_PORT = 19527;

export function startCliServer(mainWindow: BrowserWindow | null, token?: string): void {
  const routes: Record<string, (body?: any, query?: any) => any> = {
    'GET /api/memos': () => getAllMemos(),
    'GET /api/trash': () => getTrashMemos(),
    'GET /api/tags': () => {
      const db = getDb();
      const stmt = db.prepare('SELECT * FROM tags ORDER BY name');
      const rows: any[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    'POST /api/memos': (body: any) => {
      const newMemo: Memo = {
        id: uuidv4(),
        title: body.title,
        content: body.content || '',
        reminderTime: body.reminderTime || null,
        recurrence: body.recurrence || null,
        reminders: body.reminders || [],
        mutePeriods: body.mutePeriods || [],
        attachments: body.attachments || [],
        webhook: body.webhook || null,
        completed: false,
        pinned: false,
        tags: body.tags || [],
        createdAt: new Date().toISOString(),
        deletedAt: null,
      };
      insertMemo(newMemo);
      scheduleReminder(newMemo, mainWindow);
      return newMemo;
    },
    'PUT /api/memos': (body: any) => {
      const existing = getMemoById(body.id);
      if (!existing) return { error: 'not found' };
      const merged = { ...existing, ...body };
      updateMemoInDb(merged);
      scheduleReminder(merged, mainWindow);
      return merged;
    },
    'DELETE /api/memos': (body: any) => {
      const db = getDb();
      db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), body.id]);
      saveDb();
      clearMemoTimers(body.id);
      return { success: true };
    },
    'POST /api/memos/complete': (body: any) => {
      const memo = getMemoById(body.id);
      if (!memo) return { error: 'not found' };
      memo.completed = !memo.completed;
      updateMemoInDb(memo);
      if (memo.completed) clearMemoTimers(body.id);
      else scheduleReminder(memo, mainWindow);
      return memo;
    },
    'POST /api/memos/pin': (body: any) => {
      const memo = getMemoById(body.id);
      if (!memo) return { error: 'not found' };
      memo.pinned = !memo.pinned;
      updateMemoInDb(memo);
      return memo;
    },
    'POST /api/memos/restore': (body: any) => {
      const db = getDb();
      db.run('UPDATE memos SET deleted_at = NULL WHERE id = ?', [body.id]);
      saveDb();
      const memo = getMemoById(body.id);
      if (memo) scheduleReminder(memo, mainWindow);
      return memo;
    },
    'DELETE /api/memos/permanent': (body: any) => {
      const db = getDb();
      db.run('DELETE FROM memos WHERE id = ?', [body.id]);
      saveDb();
      return { success: true };
    },
    'DELETE /api/trash': () => {
      const db = getDb();
      db.run('DELETE FROM memos WHERE deleted_at IS NOT NULL');
      saveDb();
      return { success: true };
    },
    'GET /api/search': (_: any, query: any) => {
      return searchMemos(query.q || '');
    },
    'POST /api/tags': (body: any) => {
      const db = getDb();
      const id = uuidv4();
      db.run('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)', [id, body.name, body.color || '#007aff']);
      saveDb();
      return { id, name: body.name, color: body.color || '#007aff' };
    },
    'DELETE /api/tags': (body: any) => {
      const db = getDb();
      db.run('DELETE FROM tags WHERE id = ?', [body.id]);
      saveDb();
      return { success: true };
    },
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost:${CLI_PORT}`);
    const routeKey = `${req.method} ${url.pathname}`;

    res.setHeader('Content-Type', 'application/json');

    if (routeKey === 'GET /api/ping') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // Token 校验
    if (token) {
      const authHeader = req.headers['authorization'] || '';
      const reqToken = authHeader.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
      if (reqToken !== token) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }

    const handler = routes[routeKey];
    if (!handler) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    if (req.method === 'GET') {
      const query = Object.fromEntries(url.searchParams);
      const result = handler(null, query);
      res.end(JSON.stringify(result));
    } else {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        let body: any = {};
        try { body = JSON.parse(data); } catch (e) {}
        const result = handler(body);
        res.end(JSON.stringify(result));
      });
    }
  });

  server.listen(CLI_PORT, '127.0.0.1', () => {
    console.log(`[CLI Server] 监听 http://127.0.0.1:${CLI_PORT}`);
  });
  server.on('error', (err: any) => {
    console.error(`[CLI Server] 启动失败: ${err.message}`);
  });
}
