/**
 * 本地 HTTP API 服务（CLI 接入点）
 *
 * 在 127.0.0.1:19527 启动一个轻量级 HTTP 服务，供外部 CLI 工具访问。
 * 每次应用启动时生成随机 Token 写入 .cli-token 文件，CLI 读取后用于鉴权。
 *
 * 安全机制：
 * - 仅监听 127.0.0.1（不暴露到外网）
 * - Bearer Token 鉴权（Authorization 头或 ?token= 查询参数）
 * - GET /api/ping 不需要鉴权（用于探测服务是否存活）
 *
 * 支持的路由：
 * - GET /api/memos: 获取所有备忘录
 * - GET /api/trash: 获取回收站
 * - GET /api/tags: 获取标签列表
 * - GET /api/search?q=: 搜索备忘录
 * - POST /api/memos: 创建备忘录
 * - PUT /api/memos: 更新备忘录
 * - DELETE /api/memos: 软删除备忘录
 * - POST /api/memos/complete: 切换完成状态
 * - POST /api/memos/pin: 切换置顶状态
 * - POST /api/memos/restore: 从回收站恢复
 * - DELETE /api/memos/permanent: 永久删除
 * - DELETE /api/trash: 清空回收站
 * - POST /api/tags: 创建标签
 * - DELETE /api/tags: 删除标签
 */
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
      if (!body || !body.title || typeof body.title !== 'string' || !body.title.trim()) {
        return { error: 'title 为必填字段' };
      }
      const newMemo: Memo = {
        id: uuidv4(),
        title: body.title.trim(),
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
      if (!body || !body.id) return { error: 'id 为必填字段' };
      const existing = getMemoById(body.id);
      if (!existing) return { error: 'not found' };
      // 白名单：仅允许修改以下字段
      const allowed = ['title', 'content', 'reminderTime', 'recurrence', 'reminders', 'mutePeriods', 'attachments', 'webhook', 'completed', 'pinned', 'tags'];
      for (const key of allowed) {
        if (key in body) {
          (existing as any)[key] = body[key];
        }
      }
      updateMemoInDb(existing);
      scheduleReminder(existing, mainWindow);
      return existing;
    },
    'DELETE /api/memos': (body: any) => {
      if (!body || !body.id) return { error: 'id 为必填字段' };
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
      if (!body || !body.id) return { error: 'id 为必填字段' };
      if (body.confirm !== true) return { error: '永久删除需要 confirm: true 确认' };
      const db = getDb();
      db.run('DELETE FROM memos WHERE id = ?', [body.id]);
      saveDb();
      return { success: true };
    },
    'DELETE /api/trash': (body: any) => {
      if (!body || body.confirm !== true) return { error: '清空回收站需要 confirm: true 确认' };
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
      try {
        const result = handler(null, query);
        res.end(JSON.stringify(result));
      } catch (err: any) {
        console.error(`[CLI Server] ${routeKey} 错误:`, err.message || err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
      }
    } else {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        let body: any = {};
        try { body = JSON.parse(data); } catch (e) {}
        try {
          const result = handler(body);
          res.end(JSON.stringify(result));
        } catch (err: any) {
          console.error(`[CLI Server] ${routeKey} 错误:`, err.message || err);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
        }
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
