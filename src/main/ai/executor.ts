/**
 * AI 服务端工具执行模块
 *
 * 负责执行 AI 调用的服务端工具（list_memos, complete_memo, delete_memo, update_memo），
 * 包括模糊查询、多条匹配时返回候选列表等逻辑。
 */
import { BrowserWindow } from 'electron';
import { getAllMemos, getMemoById, updateMemoInDb, Memo, invalidateCache } from '../database/memo.repo';
import { getTagNames, addTag } from '../database/settings.repo';
import { scheduleReminder, clearMemoTimers } from '../scheduler';
import { saveDb, getDb } from '../database';

/**
 * 通过 ID 或标题关键词查找备忘录
 * @returns 找到唯一匹配返回 { found }，多条返回 { ambiguous, candidates }，未找到返回 { error }
 */
function findMemoByQuery(query: string): { found: Memo } | { ambiguous: true; candidates: Memo[] } | { error: string } {
  if (!query) return { error: '缺少 query 参数' };

  const byId = getMemoById(query);
  if (byId) return { found: byId };

  const all = getAllMemos();
  const keyword = query.toLowerCase();
  const matches = all.filter((m) => (m.title || '').toLowerCase().includes(keyword));

  if (matches.length === 0) return { error: `未找到包含「${query}」的备忘录` };
  if (matches.length === 1) return { found: matches[0] };
  return { ambiguous: true, candidates: matches.slice(0, 10) };
}

export function executeServerTool(name: string, args: any, mainWindow: BrowserWindow | null): any {
  if (name === 'list_memos') {
    const all = getAllMemos();
    const status = args && args.status;
    const keyword = args && typeof args.keyword === 'string' ? args.keyword.trim() : '';
    const keywords: string[] = args && Array.isArray(args.keywords) ? args.keywords.map((k: any) => String(k).trim().toLowerCase()).filter(Boolean) : [];
    const tag = args && typeof args.tag === 'string' ? args.tag.trim() : '';
    const dateFrom = args && typeof args.dateFrom === 'string' ? args.dateFrom.trim() : '';
    const dateTo = args && typeof args.dateTo === 'string' ? args.dateTo.trim() : '';

    let filtered = all;

    // 状态过滤
    if (!status || status === 'active') filtered = filtered.filter((m) => !m.completed);
    else if (status === 'completed') filtered = filtered.filter((m) => m.completed);

    // 关键词过滤：keyword 按空格拆分取 AND 交集
    if (keyword) {
      const andKeywords = keyword.toLowerCase().split(/\s+/).filter(Boolean);
      filtered = filtered.filter((m) => {
        const title = (m.title || '').toLowerCase();
        const content = (m.content || '').toLowerCase();
        return andKeywords.every((k) => title.includes(k) || content.includes(k));
      });
    }

    // keywords 数组：OR 并集匹配
    if (keywords.length > 0) {
      filtered = filtered.filter((m) => {
        const title = (m.title || '').toLowerCase();
        const content = (m.content || '').toLowerCase();
        return keywords.some((k) => title.includes(k) || content.includes(k));
      });
    }

    // 标签过滤
    if (tag) {
      filtered = filtered.filter((m) => Array.isArray(m.tags) && m.tags.includes(tag));
    }

    // 时间范围过滤
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      if (!isNaN(from)) {
        filtered = filtered.filter((m) => new Date(m.createdAt).getTime() >= from);
      }
    }
    if (dateTo) {
      let toDate = new Date(dateTo);
      if (!isNaN(toDate.getTime())) {
        if (dateTo.length <= 10) {
          toDate = new Date(dateTo + 'T23:59:59');
        }
        filtered = filtered.filter((m) => new Date(m.createdAt).getTime() <= toDate.getTime());
      }
    }

    const items = filtered.map((m) => {
      const contentExcerpt = (m.content || '')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/[#*`>\-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
      let reminderTimeLocal: string | undefined;
      if (m.reminderTime) {
        try {
          reminderTimeLocal = new Date(m.reminderTime).toLocaleString('zh-CN', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
          });
        } catch (e) { reminderTimeLocal = m.reminderTime; }
      }
      return {
        id: m.id, title: m.title,
        contentExcerpt: contentExcerpt || undefined,
        reminderTime: reminderTimeLocal || undefined,
        tags: m.tags && m.tags.length ? m.tags : undefined,
        completed: m.completed, pinned: m.pinned || undefined,
      };
    });
    return { count: items.length, items };
  }

  if (name === 'complete_memo') {
    const query = (args && args.query || '').trim();
    const undo = args && args.undo;
    const lookup = findMemoByQuery(query);

    if ('error' in lookup) return { error: lookup.error };
    if ('ambiguous' in lookup) {
      return {
        ambiguous: true,
        message: `找到 ${lookup.candidates.length} 条匹配，请用户确认具体是哪一条：`,
        candidates: lookup.candidates.map((m) => ({ id: m.id, title: m.title, completed: m.completed })),
      };
    }

    const target = lookup.found;
    const newState = undo ? false : true;
    if (target.completed === newState) {
      return { success: true, message: `「${target.title}」已经是${newState ? '已完成' : '未完成'}状态` };
    }
    target.completed = newState;
    updateMemoInDb(target);
    if (newState) clearMemoTimers(target.id);
    else scheduleReminder(target, mainWindow);
    return { success: true, message: `已将「${target.title}」标记为${newState ? '已完成 ✅' : '未完成'}` };
  }

  if (name === 'delete_memo') {
    const query = (args && args.query || '').trim();
    const lookup = findMemoByQuery(query);

    if ('error' in lookup) return { error: lookup.error };
    if ('ambiguous' in lookup) {
      return {
        ambiguous: true,
        message: `找到 ${lookup.candidates.length} 条匹配，请用户确认具体删除哪一条：`,
        candidates: lookup.candidates.map((m) => ({ id: m.id, title: m.title })),
      };
    }

    const target = lookup.found;
    const db = getDb();
    db.run('UPDATE memos SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), target.id]);
    invalidateCache();
    saveDb();
    clearMemoTimers(target.id);
    return { success: true, message: `已将「${target.title}」移入回收站 🗑️` };
  }

  if (name === 'update_memo') {
    const query = (args && args.query || '').trim();
    const lookup = findMemoByQuery(query);

    if ('error' in lookup) return { error: lookup.error };
    if ('ambiguous' in lookup) {
      return {
        ambiguous: true,
        message: `找到 ${lookup.candidates.length} 条匹配，请用户确认修改哪一条：`,
        candidates: lookup.candidates.map((m) => ({ id: m.id, title: m.title })),
      };
    }

    const target = lookup.found;
    const changes: string[] = [];
    if (typeof args.title === 'string') { target.title = args.title; changes.push('标题'); }
    if (typeof args.content === 'string') { target.content = args.content; changes.push('内容'); }
    if (Array.isArray(args.tags)) { target.tags = args.tags; changes.push('标签'); }
    else if (Array.isArray(args.addTags) && args.addTags.length > 0) {
      const existing = new Set(target.tags || []);
      args.addTags.forEach((t: string) => existing.add(t));
      target.tags = Array.from(existing);
      changes.push(`添加标签: ${args.addTags.join(', ')}`);
    } else if (Array.isArray(args.removeTags) && args.removeTags.length > 0) {
      const toRemove = new Set(args.removeTags);
      target.tags = (target.tags || []).filter((t: string) => !toRemove.has(t));
      changes.push(`移除标签: ${args.removeTags.join(', ')}`);
    }
    if ('reminderTime' in args) {
      if (args.reminderTime === '' || args.reminderTime === null) {
        target.reminderTime = null;
        target.reminders = target.reminders.filter((r: any) => r.type !== 'once');
        changes.push('清除提醒时间');
      } else if (typeof args.reminderTime === 'string') {
        target.reminderTime = args.reminderTime;
        const onceIdx = target.reminders.findIndex((r: any) => r.type === 'once');
        if (onceIdx >= 0) target.reminders[onceIdx].time = args.reminderTime;
        else target.reminders.push({ type: 'once', time: args.reminderTime });
        changes.push('提醒时间');
      }
    }
    if ('recurrence' in args) {
      if (args.recurrence === null) {
        target.recurrence = null;
        target.reminders = target.reminders.filter((r: any) => r.type === 'once');
        changes.push('清除周期提醒');
      } else if (args.recurrence && args.recurrence.type) {
        target.recurrence = args.recurrence;
        const periodicIdx = target.reminders.findIndex((r: any) => r.type !== 'once');
        if (periodicIdx >= 0) target.reminders[periodicIdx] = args.recurrence;
        else target.reminders.push(args.recurrence);
        changes.push('周期提醒');
      }
    }

    if (changes.length === 0) {
      return { success: true, message: `未指定任何修改字段，「${target.title}」保持不变` };
    }

    // 自动在 tags 表中创建不存在的新标签
    if (Array.isArray(target.tags) && target.tags.length > 0) {
      const existingTagNames = new Set(getTagNames());
      for (const tagName of target.tags) {
        if (tagName && !existingTagNames.has(tagName)) {
          addTag({ name: tagName });
        }
      }
    }

    updateMemoInDb(target);
    scheduleReminder(target, mainWindow);
    return { success: true, message: `已更新「${target.title}」的${changes.join('、')} ✏️` };
  }

  return { error: `未知工具: ${name}` };
}
