import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AIChatDialog } from './AIChatDialog';

// 状态到 GIF 文件名的映射
const STATE_GIF_MAP: Record<string, string> = {
  idle: 'idle.gif',
  reminder: 'jumping.gif',
  ai_working: 'running.gif',
  all_done: 'waving.gif',
  overdue: 'failed.gif',
  sleeping: 'waiting.gif',
  review: 'review.gif',
  failed: 'failed.gif',
  running_left: 'running-left.gif',
  running_right: 'running-right.gif',
};

interface PetState {
  currentState: string;
  currentPet: string;
  visible: boolean;
  bubbleMessage?: string;
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

  // 对话框开关时调整窗口大小
  useEffect(() => {
    if (showChat) {
      (window as any).petApi.openChatDialog();
    } else {
      (window as any).petApi.closeChatDialog();
    }
  }, [showChat]);

  // 鼠标进入宠物区域 → 取消穿透
  const handleMouseEnter = useCallback(() => {
    if (!isDragging) {
      (window as any).petApi.setIgnoreMouseEvents(false);
    }
  }, [isDragging]);

  // 鼠标离开宠物区域 → 恢复穿透（仅当对话框关闭时）
  const handleMouseLeave = useCallback(() => {
    if (!isDragging && !showChat) {
      (window as any).petApi.setIgnoreMouseEvents(true, { forward: true });
    }
  }, [isDragging, showChat]);

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

      // 判断是否为点击（非拖拽）：时间 < 200ms 且位移 < 5px
      const elapsed = Date.now() - clickStartTime.current;
      const dist = Math.sqrt(
        Math.pow(e.screenX - clickStartPos.current.x, 2) +
        Math.pow(e.screenY - clickStartPos.current.y, 2)
      );
      if (elapsed < 200 && dist < 5) {
        setShowChat(prev => !prev);
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  const handleCloseChat = useCallback(() => {
    setShowChat(false);
  }, []);

  if (!petState.visible) return null;

  return (
    <div className={`pet-container ${showChat ? 'pet-container-expanded' : ''}`}>
      {/* AI 对话框 */}
      {showChat && <AIChatDialog onClose={handleCloseChat} />}

      {/* 气泡通知 */}
      {!showChat && petState.bubbleMessage && (
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
