import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AIChatDialog } from './AIChatDialog';

interface PetState {
  currentState: string;
  currentPet: string;
  visible: boolean;
  bubbleMessage?: string;
}

interface ReminderData {
  id: string;
  title: string;
  content: string;
}

export const PetRenderer: React.FC = () => {
  const [petState, setPetState] = useState<PetState>({
    currentState: 'idle',
    currentPet: '',
    visible: true,
  });
  const [gifSrc, setGifSrc] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [reminders, setReminders] = useState<ReminderData[]>([]);
  const dragOffset = useRef({ x: 0, y: 0 });
  const clickStartTime = useRef(0);
  const clickStartPos = useRef({ x: 0, y: 0 });

  // 监听主进程推送的状态变化
  useEffect(() => {
    const cleanup = (window as any).petApi.onStateUpdate((state: PetState) => {
      setPetState(state);
    });
    (window as any).petApi.getState().then((state: PetState) => {
      if (state) setPetState(state);
    });
    return cleanup;
  }, []);

  // 监听提醒事件
  useEffect(() => {
    const cleanup = (window as any).petApi.onReminder((data: ReminderData) => {
      setReminders(prev => [...prev, data]);
      // 提醒弹窗需要取消鼠标穿透
      (window as any).petApi.setIgnoreMouseEvents(false);
    });
    return cleanup;
  }, []);

  // 当宠物或状态变化时，获取对应 GIF 路径
  useEffect(() => {
    if (!petState.currentPet) return;

    (window as any).petApi.getGifPath(petState.currentPet, petState.currentState)
      .then((filePath: string | null) => {
        if (filePath) {
          setGifSrc(`local-file://${filePath}?t=${Date.now()}`);
        }
      });
  }, [petState.currentPet, petState.currentState]);

  // 对话框/提醒弹窗开关时调整窗口大小
  const isExpanded = showChat || reminders.length > 0;
  useEffect(() => {
    if (showChat) {
      (window as any).petApi.openChatDialog({ width: 420, height: 600 });
    } else if (reminders.length > 0) {
      (window as any).petApi.openChatDialog({ width: 260, height: 360 });
    } else {
      (window as any).petApi.closeChatDialog();
    }
  }, [showChat, reminders.length > 0]);

  const handleDismissReminder = useCallback(() => {
    // 知道了 = 标记为已完成
    reminders.forEach(r => {
      (window as any).petApi.completeMemo(r.id);
    });
    setReminders([]);
    (window as any).petApi.dismissReminder();
    (window as any).petApi.notifyMemosChanged();
    if (!showChat) {
      (window as any).petApi.setIgnoreMouseEvents(true, { forward: true });
    }
  }, [showChat, reminders]);

  const handleSnoozeReminder = useCallback(() => {
    // 5分钟后再提醒
    reminders.forEach(r => {
      (window as any).petApi.snoozeMemo(r.id, 5);
    });
    setReminders([]);
    (window as any).petApi.dismissReminder();
    (window as any).petApi.notifyMemosChanged();
    if (!showChat) {
      (window as any).petApi.setIgnoreMouseEvents(true, { forward: true });
    }
  }, [showChat, reminders]);

  // 鼠标进入宠物区域 → 取消穿透
  const handleMouseEnter = useCallback(() => {
    if (!isDragging) {
      (window as any).petApi.setIgnoreMouseEvents(false);
    }
  }, [isDragging]);

  // 鼠标离开宠物区域 → 恢复穿透
  const handleMouseLeave = useCallback(() => {
    if (!isDragging && !isExpanded) {
      (window as any).petApi.setIgnoreMouseEvents(true, { forward: true });
    }
  }, [isDragging, isExpanded]);

  // 拖拽开始
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    clickStartTime.current = Date.now();
    clickStartPos.current = { x: e.screenX, y: e.screenY };
    setIsDragging(true);
    dragOffset.current = { x: e.screenX, y: e.screenY };
    (window as any).petApi.startDrag();
  }, []);

  // 拖拽移动
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      const dx = e.screenX - dragOffset.current.x;
      const dy = e.screenY - dragOffset.current.y;
      dragOffset.current = { x: e.screenX, y: e.screenY };
      (window as any).petApi.moveWindow(dx, dy);
    };

    const handleUp = (e: MouseEvent) => {
      setIsDragging(false);
      (window as any).petApi.endDrag();

      const elapsed = Date.now() - clickStartTime.current;
      const dist = Math.sqrt(
        Math.pow(e.screenX - clickStartPos.current.x, 2) +
        Math.pow(e.screenY - clickStartPos.current.y, 2)
      );
      if (elapsed < 200 && dist < 5) {
        // 如果有提醒弹窗，点击关闭提醒
        if (reminders.length > 0) {
          handleDismissReminder();
        } else {
          setShowChat(prev => !prev);
        }
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, reminders.length, handleDismissReminder]);

  const handleCloseChat = useCallback(() => {
    setShowChat(false);
  }, []);

  if (!petState.visible) return null;

  return (
    <div className={`pet-container ${isExpanded ? 'pet-container-expanded' : ''}`}>
      {/* AI 对话框 */}
      {showChat && reminders.length === 0 && <AIChatDialog onClose={handleCloseChat} />}

      {/* 提醒弹窗 */}
      {reminders.length > 0 && (
        <div className="pet-reminder-popup" onClick={(e) => e.stopPropagation()}>
          <div className="pet-reminder-icon">⏰</div>
          <div className="pet-reminder-title">提醒时间到！</div>
          <div className="pet-reminder-list">
            {reminders.map((r, i) => (
              <div key={`${r.id}-${i}`} className="pet-reminder-item">
                <span className="pet-reminder-bullet">•</span>
                <div className="pet-reminder-info">
                  <span className="pet-reminder-name">{r.title}</span>
                  {r.content && <span className="pet-reminder-content">{r.content}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="pet-reminder-buttons">
            <button className="pet-reminder-btn pet-reminder-snooze" onClick={handleSnoozeReminder}>5分钟后</button>
            <button className="pet-reminder-btn pet-reminder-done" onClick={handleDismissReminder}>完成</button>
          </div>
        </div>
      )}

      {/* 气泡通知（仅在无弹窗时显示） */}
      {!isExpanded && petState.bubbleMessage && (
        <div className="pet-bubble">
          {petState.bubbleMessage}
        </div>
      )}

      {/* 宠物动画 */}
      <img
        className="pet-animation"
        src={gifSrc}
        alt={petState.currentState}
        draggable={false}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
      />
    </div>
  );
};
