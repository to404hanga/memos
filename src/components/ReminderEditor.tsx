/**
 * 多提醒配置编辑器子组件
 *
 * 支持单次/每天/工作日/每周/每月提醒类型，
 * 以及静默期（不提醒的日期范围）管理。
 */
import React from 'react';
import type { Recurrence, MutePeriod } from '../../types/global';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
type RecurrenceType = 'once' | 'daily' | 'workday' | 'weekly' | 'monthly';

function toLocalDatetime(isoStr: string): string {
  const d = new Date(isoStr);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

interface Props {
  reminders: Recurrence[];
  mutePeriods: MutePeriod[];
  onRemindersChange: (reminders: Recurrence[]) => void;
  onMutePeriodsChange: (periods: MutePeriod[]) => void;
}

export default function ReminderEditor({ reminders, mutePeriods, onRemindersChange, onMutePeriodsChange }: Props): React.ReactElement {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localNow = new Date(now.getTime() - offset * 60000);
  const minDatetime = localNow.toISOString().slice(0, 16);

  const addReminder = () => {
    onRemindersChange([...reminders, { type: 'once', time: '' }]);
  };

  const removeReminder = (index: number) => {
    onRemindersChange(reminders.filter((_, i) => i !== index));
  };

  const updateReminder = (index: number, updated: Recurrence) => {
    const newReminders = [...reminders];
    newReminders[index] = updated;
    onRemindersChange(newReminders);
  };

  return (
    <>
      <div className="form-group">
        <div className="content-label-row">
          <label>提醒</label>
          <button type="button" className="tag-add-btn" onClick={addReminder}>+ 添加提醒</button>
        </div>
        {reminders.length === 0 && (
          <p className="no-reminders">暂无提醒，点击「+ 添加提醒」设置</p>
        )}
        <div className="reminders-list">
          {reminders.map((rem, idx) => (
            <div key={idx} className="reminder-row">
              <select
                className="rec-select"
                value={rem.type}
                onChange={(e) => {
                  const type = e.target.value as RecurrenceType;
                  if (type === 'once') {
                    updateReminder(idx, { type: 'once', time: '' });
                  } else {
                    updateReminder(idx, { type, hour: rem.hour ?? 9, minute: rem.minute ?? 0, dayOfWeek: rem.dayOfWeek ?? 1, dayOfMonth: rem.dayOfMonth ?? 1 });
                  }
                }}
              >
                <option value="once">单次</option>
                <option value="daily">每天</option>
                <option value="workday">每个工作日</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
              </select>

              {rem.type === 'once' && (
                <input
                  type="datetime-local"
                  className="rem-datetime"
                  value={rem.time ? toLocalDatetime(rem.time) : ''}
                  min={minDatetime}
                  onChange={(e) => updateReminder(idx, { ...rem, time: e.target.value ? new Date(e.target.value).toISOString() : '' })}
                />
              )}

              {rem.type === 'weekly' && (
                <select
                  className="rec-select"
                  value={rem.dayOfWeek ?? 1}
                  onChange={(e) => updateReminder(idx, { ...rem, dayOfWeek: Number(e.target.value) })}
                >
                  {WEEKDAYS.map((name, i) => (
                    <option key={i} value={i}>{name}</option>
                  ))}
                </select>
              )}

              {rem.type === 'monthly' && (
                <select
                  className="rec-select"
                  value={rem.dayOfMonth ?? 1}
                  onChange={(e) => updateReminder(idx, { ...rem, dayOfMonth: Number(e.target.value) })}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{d}号</option>
                  ))}
                </select>
              )}

              {rem.type !== 'once' && (
                <div className="time-picker">
                  <select
                    className="rec-select"
                    value={rem.hour ?? 9}
                    onChange={(e) => updateReminder(idx, { ...rem, hour: Number(e.target.value) })}
                  >
                    {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                    ))}
                  </select>
                  <span className="time-sep">:</span>
                  <select
                    className="rec-select"
                    value={rem.minute ?? 0}
                    onChange={(e) => updateReminder(idx, { ...rem, minute: Number(e.target.value) })}
                  >
                    {Array.from({ length: 60 }, (_, i) => i).map((m) => (
                      <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              )}

              <button type="button" className="rem-delete" onClick={() => removeReminder(idx)} title="删除此提醒">✕</button>
            </div>
          ))}
        </div>
      </div>

      {reminders.length > 0 && (
        <div className="form-group">
          <div className="content-label-row">
            <label>静默期（不提醒的日期范围）</label>
            <button type="button" className="tag-add-btn" onClick={() => onMutePeriodsChange([...mutePeriods, { from: '', to: '' }])}>+ 添加</button>
          </div>
          {mutePeriods.length === 0 && (
            <p className="no-reminders">未设置静默期</p>
          )}
          <div className="reminders-list">
            {mutePeriods.map((period, idx) => (
              <div key={idx} className="reminder-row mute-row">
                <span className="mute-label">从</span>
                <input
                  type="date"
                  className="rem-datetime"
                  value={period.from}
                  onChange={(e) => {
                    const newPeriods = [...mutePeriods];
                    newPeriods[idx] = { ...newPeriods[idx], from: e.target.value };
                    onMutePeriodsChange(newPeriods);
                  }}
                />
                <span className="mute-label">至</span>
                <input
                  type="date"
                  className="rem-datetime"
                  value={period.to}
                  min={period.from || undefined}
                  onChange={(e) => {
                    const newPeriods = [...mutePeriods];
                    newPeriods[idx] = { ...newPeriods[idx], to: e.target.value };
                    onMutePeriodsChange(newPeriods);
                  }}
                />
                <button type="button" className="rem-delete" onClick={() => onMutePeriodsChange(mutePeriods.filter((_, i) => i !== idx))}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
