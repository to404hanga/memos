/**
 * 提醒调度器
 *
 * 负责备忘录提醒的定时触发，核心特性：
 *
 * 1. 多提醒支持：一个备忘录可设置多个不同类型的提醒，每个独立调度
 *
 * 2. 周期提醒类型：
 *    - once: 单次提醒（到时触发后不再重复）
 *    - daily: 每天指定时间
 *    - workday: 工作日（跳过周末和法定假日）
 *    - weekly: 每周指定星期几
 *    - monthly: 每月指定日期
 *
 * 3. 中国法定假日日历：
 *    - holidays: 法定假日集合（元旦/春节/清明/五一/端午/中秋/国庆）
 *    - workdays: 调休补班日集合
 *    - isWorkday(): 综合判断某天是否为工作日
 *    - 覆盖 2025-2027 年数据
 *
 * 4. 静默期处理：
 *    - 周期提醒在静默期内会自动跳过（向后推迟，最多 60 天）
 *    - 单次提醒在静默期内直接跳过不触发
 *
 * 5. 触发行为：
 *    - 系统通知（Notification）
 *    - 主窗口弹窗（IPC 推送 reminder-triggered 事件）
 *    - 企微 Webhook 推送（如已配置）
 *    - 周期提醒触发后自动重新调度下一次
 *
 * 6. 定时器管理：
 *    - activeTimers Map 维护每个备忘录的定时器列表
 *    - scheduleReminder: 注册提醒（先清除旧定时器）
 *    - clearMemoTimers: 清除指定备忘录的所有定时器
 *    - loadAllReminders: 应用启动时为所有未完成备忘录注册提醒
 */
import { Memo, getAllMemos, getMemoById, updateMemoInDb } from '../database/memo.repo';
import { updateReminderTime } from '../database/memo.repo';
import { Notification, BrowserWindow } from 'electron';
import { sendWebhook } from '../webhook';

const activeTimers = new Map<string, NodeJS.Timeout[]>();

// 中国法定假日和调休日历
const cnCalendar = {
  holidays: new Set([
    // 2025
    '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04',
    '2025-04-04', '2025-04-05', '2025-04-06', '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05',
    '2025-05-31', '2025-06-01', '2025-06-02', '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
    // 2026
    '2026-01-01', '2026-01-02', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
    '2026-04-05', '2026-04-06', '2026-04-07', '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21', '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
    // 2027
    '2027-01-01', '2027-01-02', '2027-01-03', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12',
    '2027-04-05', '2027-04-06', '2027-04-07', '2027-05-01', '2027-05-02', '2027-05-03',
    '2027-06-14', '2027-09-25', '2027-09-26', '2027-09-27',
    '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04', '2027-10-05', '2027-10-06', '2027-10-07',
  ]),
  workdays: new Set([
    // 2025 调休补班
    '2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11',
    // 2026 调休补班
    '2026-02-14', '2026-02-15', '2026-04-26', '2026-05-09', '2026-09-19', '2026-10-10',
    // 2027 调休补班
    '2027-02-20', '2027-10-09',
  ]),
};

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWorkday(date: Date): boolean {
  const key = formatDateKey(date);
  if (cnCalendar.workdays.has(key)) return true;
  if (cnCalendar.holidays.has(key)) return false;
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function getNextOccurrence(recurrence: any): Date | null {
  if (!recurrence || recurrence.type === 'once') return null;

  const now = new Date();
  const { type, hour, minute } = recurrence;

  if (type === 'daily') {
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  if (type === 'workday') {
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    for (let i = 0; i < 30; i++) {
      if (isWorkday(next)) return next;
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (type === 'weekly') {
    const dayOfWeek = recurrence.dayOfWeek ?? 1; // 默认周一
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    const currentDay = now.getDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
      daysUntil += 7;
    }
    next.setDate(next.getDate() + daysUntil);
    return next;
  }

  if (type === 'monthly') {
    const dayOfMonth = recurrence.dayOfMonth;
    const next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, minute, 0, 0);
    if (next <= now) {
      next.setMonth(next.getMonth() + 1);
    }
    if (next.getDate() !== dayOfMonth) {
      next.setDate(0);
    }
    return next;
  }

  return null;
}

export function clearMemoTimers(memoId: string): void {
  const timers = activeTimers.get(memoId);
  if (timers) {
    timers.forEach((t) => clearTimeout(t));
    activeTimers.delete(memoId);
  }
}

export function scheduleReminder(memo: Memo, mainWindow: BrowserWindow | null): void {
  clearMemoTimers(memo.id);
  if (memo.completed) return;

  const mutePeriods = memo.mutePeriods || [];

  function isInMutePeriod(date: Date): boolean {
    const dateKey = formatDateKey(date);
    return mutePeriods.some((p: any) => dateKey >= p.from && dateKey <= p.to);
  }

  const reminders = [...(memo.reminders || [])];
  if (reminders.length === 0) {
    if (memo.recurrence && memo.recurrence.type !== 'once') {
      reminders.push(memo.recurrence);
    } else if (memo.reminderTime) {
      reminders.push({ type: 'once', time: memo.reminderTime });
    }
  }

  if (reminders.length === 0) return;

  const timers: NodeJS.Timeout[] = [];
  let nearestTime: Date | null = null;

  reminders.forEach((rem: any, idx: number) => {
    let targetDate: Date | null;

    if (rem.type === 'once') {
      if (!rem.time) return;
      targetDate = new Date(rem.time);
      if (isInMutePeriod(targetDate)) {
        console.log(`[提醒] "${memo.title}" #${idx + 1} 在静默期内，跳过`);
        return;
      }
    } else {
      targetDate = getNextOccurrence(rem);
      if (!targetDate) return;
      let attempts = 0;
      while (isInMutePeriod(targetDate) && attempts < 60) {
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(rem.hour || 0, rem.minute || 0, 0, 0);
        attempts++;
      }
      if (attempts >= 60) return;
    }

    const now = new Date();
    const delay = targetDate!.getTime() - now.getTime();

    if (delay > 0 && (!nearestTime || targetDate! < nearestTime)) {
      nearestTime = targetDate;
    }

    const typeLabel = rem.type !== 'once' ? ` (${rem.type})` : '';
    console.log(`[提醒] "${memo.title}" #${idx + 1} 计划于 ${targetDate!.toLocaleString()}，延迟 ${Math.round(delay / 1000)}s${typeLabel}`);

    if (delay <= 0) {
      console.log(`[提醒] "${memo.title}" #${idx + 1} 已过期，跳过`);
      return;
    }

    const timer = setTimeout(() => {
      console.log(`[提醒] 触发: "${memo.title}" #${idx + 1}`);

      if (Notification.isSupported()) {
        const recLabel = rem.type !== 'once' ? ' 🔁' : '';
        const notification = new Notification({
          title: `⏰ 备忘录提醒${recLabel}`,
          body: memo.title,
          subtitle: memo.content || '',
          silent: false,
          urgency: 'critical',
        });
        notification.on('click', () => {
          mainWindow && mainWindow.show();
        });
        notification.show();
      }

      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('reminder-triggered', {
          id: memo.id,
          title: memo.title,
          content: memo.content,
        });
      }

      sendWebhook(memo, rem.type).catch(() => {});

      if (rem.type !== 'once') {
        const freshMemo = getMemoById(memo.id);
        if (freshMemo && !freshMemo.completed) {
          scheduleReminder(freshMemo, mainWindow);
        }
      }
    }, delay);

    timers.push(timer);
  });

  if (timers.length > 0) {
    activeTimers.set(memo.id, timers);
  }

  if (nearestTime) {
    updateReminderTime(memo.id, (nearestTime as Date).toISOString());
  }
}

export function loadAllReminders(mainWindow: BrowserWindow | null): void {
  const memos = getAllMemos();
  memos.forEach((memo) => scheduleReminder(memo, mainWindow));
}
