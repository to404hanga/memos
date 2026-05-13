import React, { useState, useMemo } from 'react';
import type { Memo } from '../../types/global';

interface CalendarViewProps {
  memos: Memo[];
  onEdit: (memo: Memo) => void;
  onToggle: (id: string) => void;
}

function formatKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const todayKey = formatKey(new Date());

export default function CalendarView({ memos, onEdit, onToggle }: CalendarViewProps): React.ReactElement {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const days: { date: Date; isCurrentMonth: boolean; key: string }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthDays - i);
      days.push({ date: d, isCurrentMonth: false, key: formatKey(d) });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      days.push({ date: d, isCurrentMonth: true, key: formatKey(d) });
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push({ date: d, isCurrentMonth: false, key: formatKey(d) });
    }

    return days;
  }, [year, month]);

  const memosByDate = useMemo(() => {
    const map: Record<string, Memo[]> = {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const isMutedForMemo = (key: string, memo: Memo): boolean => {
      if (!memo.mutePeriods || memo.mutePeriods.length === 0) return false;
      return memo.mutePeriods.some((p) => key >= p.from && key <= p.to);
    };

    const addToDate = (key: string, memo: Memo) => {
      if (isMutedForMemo(key, memo)) return;
      if (!map[key]) map[key] = [];
      if (!map[key].some((m) => m.id === memo.id)) {
        map[key].push(memo);
      }
    };

    memos.forEach((m) => {
      if (m.completed) return;

      const reminders = m.reminders || [];
      // 兼容旧数据
      if (reminders.length === 0 && m.reminderTime) {
        const key = formatKey(new Date(m.reminderTime));
        addToDate(key, m);
        return;
      }

      reminders.forEach((rem) => {
        if (rem.type === 'once' && rem.time) {
          const key = formatKey(new Date(rem.time));
          addToDate(key, m);
        } else if (rem.type === 'daily' || rem.type === 'workday') {
          for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            if (rem.type === 'workday') {
              const day = date.getDay();
              if (day === 0 || day === 6) continue;
            }
            addToDate(formatKey(date), m);
          }
        } else if (rem.type === 'weekly' && rem.dayOfWeek !== undefined) {
          for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month, d);
            if (date.getDay() === rem.dayOfWeek) {
              addToDate(formatKey(date), m);
            }
          }
        } else if (rem.type === 'monthly' && rem.dayOfMonth !== undefined) {
          if (rem.dayOfMonth <= daysInMonth) {
            const key = formatKey(new Date(year, month, rem.dayOfMonth));
            addToDate(key, m);
          }
        }
      });
    });

    // 已完成的只标记 reminderTime 那一天
    memos.forEach((m) => {
      if (m.completed && m.reminderTime) {
        const key = formatKey(new Date(m.reminderTime));
        addToDate(key, m);
      }
    });

    return map;
  }, [memos, year, month]);

  const goToPrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const goToNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => { setCurrentDate(new Date()); setSelectedDate(todayKey); };

  const selectedMemos = memosByDate[selectedDate] || [];
  const selectedDateObj = new Date(selectedDate + 'T00:00');
  const selectedLabel = selectedDateObj.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

  const monthLabel = currentDate.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });

  return (
    <div className="calendar-view">
      <div className="cal-left">
        <div className="calendar-header">
          <button className="cal-nav-btn" onClick={goToPrevMonth}>‹</button>
          <span className="cal-month-label">{monthLabel}</span>
          <button className="cal-nav-btn" onClick={goToNextMonth}>›</button>
          <button className="cal-today-btn" onClick={goToToday}>今天</button>
        </div>

        <div className="calendar-grid">
          <div className="cal-weekdays">
            {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
              <div key={d} className="cal-weekday">{d}</div>
            ))}
          </div>
          <div className="cal-days">
            {calendarDays.map(({ date, isCurrentMonth, key }) => {
              const hasMemos = !!memosByDate[key];
              const isToday = key === todayKey;
              const isSelected = key === selectedDate;
              const memoCount = memosByDate[key]?.length || 0;

              return (
                <div
                  key={key}
                  className={`cal-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasMemos ? 'has-memos' : ''}`}
                  onClick={() => setSelectedDate(key)}
                >
                  <span className="cal-day-num">{date.getDate()}</span>
                  {hasMemos && (
                    <div className="cal-dots">
                      {memoCount <= 3 ? (
                        Array.from({ length: memoCount }).map((_, i) => (
                          <span key={i} className="cal-dot" />
                        ))
                      ) : (
                        <>
                          <span className="cal-dot" />
                          <span className="cal-dot" />
                          <span className="cal-dot-more">+{memoCount - 2}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="cal-right">
        <div className="cal-detail-header">
          <span className="cal-detail-date">{selectedLabel}</span>
          <span className="cal-detail-count">
            {selectedMemos.length > 0 ? `${selectedMemos.length} 项待办` : ''}
          </span>
        </div>

        {selectedMemos.length > 0 ? (
          <div className="cal-detail-list">
            {selectedMemos.map((memo) => (
              <div key={memo.id} className="cal-detail-item" onClick={() => onEdit(memo)}>
                <div
                  className={`cal-detail-check ${memo.completed ? 'checked' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggle(memo.id); }}
                >
                  {memo.completed && '✓'}
                </div>
                <div className="cal-detail-content">
                  <span className={`cal-detail-title ${memo.completed ? 'done' : ''}`}>{memo.title}</span>
                  {memo.reminderTime && (
                    <span className="cal-detail-time">
                      {new Date(memo.reminderTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="cal-empty-placeholder">
            <div className="cal-empty-icon">📅</div>
            <p className="cal-empty-title">暂无待办</p>
            <p className="cal-empty-sub">这一天没有安排，享受轻松时光</p>
          </div>
        )}
      </div>
    </div>
  );
}
