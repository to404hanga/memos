/**
 * 提醒调度器（单 Timer 策略）
 *
 * 采用"最近一次提醒"策略：
 * - 只维护一个全局 setTimeout，指向最近的下一次提醒时间
 * - timer 触发时，扫描所有到期/过期的提醒，批量通知
 * - 处理完后计算下一个最近的提醒时间，重新注册 timer
 * - 新增/更新/删除备忘录时调用 reschedule() 重新计算
 * - 系统唤醒时自动检查是否有错过的提醒
 *
 * 复杂度从 O(n) 个定时器降为 O(1)
 */
import { Memo, getAllMemos, getMemoById, updateMemoInDb } from '../database/memo.repo';
import { updateReminderTime } from '../database/memo.repo';
import { Notification, BrowserWindow, powerMonitor } from 'electron';
import { sendWebhook } from '../webhook';

let globalTimer: NodeJS.Timeout | null = null;
let nextFireTime: number | null = null;
let mainWindowRef: BrowserWindow | null = null;

// ===== 中国法定假日和调休日历 =====
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
    '2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11',
    '2026-02-14', '2026-02-15', '2026-04-26', '2026-05-09', '2026-09-19', '2026-10-10',
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

// ===== 计算单条提醒的下次触发时间 =====

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
    const dayOfWeek = recurrence.dayOfWeek ?? 1;
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

/** 计算一条备忘录中所有提醒的下次触发时间列表 */
function getMemoNextFireTimes(memo: Memo): { time: Date; reminder: any; index: number }[] {
  if (memo.completed) return [];

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

  const results: { time: Date; reminder: any; index: number }[] = [];

  reminders.forEach((rem: any, idx: number) => {
    let targetDate: Date | null;

    if (rem.type === 'once') {
      if (!rem.time) return;
      targetDate = new Date(rem.time);
      if (isInMutePeriod(targetDate)) return;
    } else {
      targetDate = getNextOccurrence(rem);
      if (!targetDate) return;
      // 跳过静默期
      let attempts = 0;
      while (isInMutePeriod(targetDate) && attempts < 60) {
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(rem.hour || 0, rem.minute || 0, 0, 0);
        attempts++;
      }
      if (attempts >= 60) return;
      // 校验周期条件
      if (rem.type === 'workday') {
        let extra = 0;
        while (!isWorkday(targetDate) && extra < 30) {
          targetDate.setDate(targetDate.getDate() + 1);
          targetDate.setHours(rem.hour || 0, rem.minute || 0, 0, 0);
          extra++;
        }
      } else if (rem.type === 'weekly' && rem.dayOfWeek !== undefined) {
        let extra = 0;
        while (targetDate.getDay() !== rem.dayOfWeek && extra < 7) {
          targetDate.setDate(targetDate.getDate() + 1);
          targetDate.setHours(rem.hour || 0, rem.minute || 0, 0, 0);
          extra++;
        }
      } else if (rem.type === 'monthly' && rem.dayOfMonth !== undefined) {
        if (targetDate.getDate() !== rem.dayOfMonth) {
          targetDate.setMonth(targetDate.getMonth() + 1);
          targetDate.setDate(rem.dayOfMonth);
          targetDate.setHours(rem.hour || 0, rem.minute || 0, 0, 0);
          if (targetDate.getDate() !== rem.dayOfMonth) {
            targetDate.setDate(0);
          }
        }
      }
    }

    if (targetDate && targetDate.getTime() > 0) {
      results.push({ time: targetDate, reminder: rem, index: idx });
    }
  });

  return results;
}

// ===== 触发提醒通知 =====

function fireReminder(memo: Memo, rem: any): void {
  console.log(`[提醒] 触发: "${memo.title}" (${rem.type})`);

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
      mainWindowRef && mainWindowRef.show();
    });
    notification.show();
  }

  // 桌宠提醒：切换为 jumping 动画 + 发送提醒数据给宠物窗口
  try {
    const { getPetStateMachine, getPetWindow } = require('../pet');
    const sm = getPetStateMachine();
    const petWin = getPetWindow();
    if (sm && petWin && !petWin.isDestroyed()) {
      sm.transition('reminder', `⏰ ${memo.title}`);
      petWin.webContents.send('pet:reminder', {
        id: memo.id,
        title: memo.title,
        content: memo.content || '',
      });
    }
  } catch {}

  // 通知主窗口刷新备忘录列表（但不弹窗）
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('memos-changed');
  }

  sendWebhook(memo, rem.type).catch(() => {});
}

// ===== 核心调度逻辑 =====

/**
 * 扫描所有备忘录，触发已到期的提醒，注册下一个最近的 timer
 */
function tick(): void {
  globalTimer = null;
  nextFireTime = null;

  const now = Date.now();
  const memos = getAllMemos();
  let earliest: number | null = null;

  for (const memo of memos) {
    const fireTimes = getMemoNextFireTimes(memo);
    for (const { time, reminder } of fireTimes) {
      const t = time.getTime();
      if (t <= now) {
        // 已到期：立即触发
        fireReminder(memo, reminder);
      } else {
        // 未来：记录最近的
        if (earliest === null || t < earliest) {
          earliest = t;
        }
      }
    }
  }

  // 注册下一个 timer
  if (earliest !== null) {
    const delay = Math.max(earliest - Date.now(), 500); // 至少 500ms 防止忙循环
    nextFireTime = earliest;
    globalTimer = setTimeout(tick, delay);
    console.log(`[调度器] 下次提醒在 ${new Date(earliest).toLocaleString()}（${Math.round(delay / 1000)}s 后）`);
  } else {
    console.log('[调度器] 无待触发的提醒');
  }
}

/**
 * 重新计算调度（新增/更新/删除备忘录后调用）
 * 如果新的最近时间比当前 timer 更早，则重置 timer
 */
export function reschedule(): void {
  const now = Date.now();
  const memos = getAllMemos();
  let earliest: number | null = null;

  for (const memo of memos) {
    const fireTimes = getMemoNextFireTimes(memo);
    for (const { time } of fireTimes) {
      const t = time.getTime();
      if (t > now && (earliest === null || t < earliest)) {
        earliest = t;
      }
    }
  }

  // 如果新的最近时间比当前 timer 更早（或当前无 timer），重置
  if (earliest !== null && (nextFireTime === null || earliest < nextFireTime)) {
    if (globalTimer) {
      clearTimeout(globalTimer);
      globalTimer = null;
    }
    const delay = Math.max(earliest - Date.now(), 500);
    nextFireTime = earliest;
    globalTimer = setTimeout(tick, delay);
    console.log(`[调度器] 重新调度: 下次提醒在 ${new Date(earliest).toLocaleString()}（${Math.round(delay / 1000)}s 后）`);
  } else if (earliest === null && globalTimer) {
    // 无任何提醒了，清除 timer
    clearTimeout(globalTimer);
    globalTimer = null;
    nextFireTime = null;
  }
}

// ===== 兼容旧 API =====

/** 注册/更新某条备忘录的提醒（兼容旧调用，内部触发 reschedule） */
export function scheduleReminder(memo: Memo, mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow;
  // 更新 reminderTime 字段（供前端展示）
  const fireTimes = getMemoNextFireTimes(memo);
  if (fireTimes.length > 0) {
    const nearest = fireTimes.reduce((a, b) => a.time < b.time ? a : b);
    updateReminderTime(memo.id, nearest.time.toISOString());
  }
  reschedule();
}

/** 清除某条备忘录的提醒（兼容旧调用） */
export function clearMemoTimers(memoId: string): void {
  // 单 timer 策略下无需按 memo 清除，reschedule 会自然跳过已完成/已删除的
  reschedule();
}

/** 应用启动时初始化调度器 */
export function loadAllReminders(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow;

  // 首次 tick：触发所有过期的 + 注册下一个 timer
  tick();

  // 监听系统唤醒事件，唤醒后立即检查
  powerMonitor.on('resume', () => {
    console.log('[调度器] 系统唤醒，重新检查提醒');
    if (globalTimer) {
      clearTimeout(globalTimer);
      globalTimer = null;
    }
    tick();
  });
}
