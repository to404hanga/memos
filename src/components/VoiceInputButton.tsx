/**
 * VoiceInputButton - 语音输入按钮组件
 *
 * 录音在主进程的隐藏窗口中进行（避免渲染进程 crash）
 * 渲染进程只负责 UI 和 IPC 调用
 */
import React, { useCallback, useState, useRef, useEffect } from 'react';

type VoiceState = 'idle' | 'recording' | 'processing';

interface Props {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceInputButton({ onTranscribed, disabled }: Props): React.ReactElement {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const onTranscribedRef = useRef(onTranscribed);
  onTranscribedRef.current = onTranscribed;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);

    try {
      // 先请求权限
      if (window.api?.asrRequestMicPermission) {
        const perm = await window.api.asrRequestMicPermission();
        if (!perm.granted) {
          setError('麦克风权限被拒绝');
          return;
        }
      }

      // 通过主进程开始录音
      const res = await window.api.asrStartRecording();
      if (!res.success) {
        setError(res.error || '录音启动失败');
        return;
      }

      startTimeRef.current = Date.now();
      setDuration(0);
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setDuration(elapsed);
        if (elapsed >= 60) {
          stopAndRecognize();
        }
      }, 250);

      setVoiceState('recording');
    } catch (err: any) {
      setError(err.message || '录音启动失败');
    }
  }, []);

  const stopAndRecognize = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setVoiceState('processing');

    try {
      const result = await window.api.asrStopRecording();
      if (result.success && result.text) {
        onTranscribedRef.current(result.text);
      } else {
        setError(result.error || '识别失败');
      }
    } catch (err: any) {
      setError(err.message || '识别失败');
    }

    setVoiceState('idle');
    setDuration(0);
  }, []);

  // 用 ref 让 timer 能调到最新 stopAndRecognize
  const stopRef = useRef(stopAndRecognize);
  stopRef.current = stopAndRecognize;

  const handleClick = useCallback(() => {
    if (voiceState === 'recording') {
      stopRef.current();
    } else if (voiceState === 'idle') {
      startRecording();
    }
  }, [voiceState, startRecording]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  let btnClass = 'ai-voice-btn';
  if (voiceState === 'recording') btnClass += ' recording';
  if (voiceState === 'processing') btnClass += ' processing';

  return (
    <div className="ai-voice-input-wrap">
      <button
        className={btnClass}
        onClick={handleClick}
        disabled={disabled || voiceState === 'processing'}
        title={voiceState === 'recording' ? '点击停止录音' : voiceState === 'processing' ? '识别中...' : '语音输入'}
      >
        {voiceState === 'processing' ? (
          <span className="ai-voice-spinner" />
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>
      {voiceState === 'recording' && (
        <span className="ai-voice-duration">{formatDuration(duration)}</span>
      )}
      {error && (
        <span className="ai-voice-error" title={error} onClick={() => setError(null)}>!</span>
      )}
    </div>
  );
}
