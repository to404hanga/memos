/**
 * VoiceInputButton - 语音输入按钮组件
 *
 * 录音在主进程的隐藏窗口中进行（避免渲染进程 crash）
 * 渲染进程只负责 UI 和 IPC 调用
 *
 * 首次使用时引导用户下载模型，显示下载进度
 */
import React, { useCallback, useState, useRef, useEffect } from 'react';

type VoiceState = 'idle' | 'recording' | 'processing';
type ModelState = 'unknown' | 'not_downloaded' | 'downloading' | 'ready';

interface Props {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceInputButton({ onTranscribed, disabled }: Props): React.ReactElement {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<ModelState>('unknown');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const onTranscribedRef = useRef(onTranscribed);
  onTranscribedRef.current = onTranscribed;
  const unsubProgressRef = useRef<(() => void) | null>(null);

  // 初始化时检查模型状态
  useEffect(() => {
    if (window.api?.asrGetStatus) {
      window.api.asrGetStatus().then((status) => {
        if (status === 'ready' || status === 'idle') {
          setModelState('ready');
        } else if (status === 'downloading') {
          setModelState('downloading');
        } else {
          setModelState('not_downloaded');
        }
      }).catch(() => setModelState('not_downloaded'));
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (unsubProgressRef.current) unsubProgressRef.current();
    };
  }, []);

  // 下载模型
  const handleDownload = useCallback(async () => {
    setShowDownloadPrompt(false);
    setModelState('downloading');
    setDownloadPercent(0);

    // 监听下载进度
    if (window.api?.onAsrDownloadProgress) {
      unsubProgressRef.current = window.api.onAsrDownloadProgress((progress) => {
        setDownloadPercent(progress.percent);
      });
    }

    try {
      const res = await window.api.asrDownload();
      if (res.success) {
        setModelState('ready');
      } else {
        setError(res.error || '下载失败');
        setModelState('not_downloaded');
      }
    } catch (err: any) {
      setError(err.message || '下载失败');
      setModelState('not_downloaded');
    }

    if (unsubProgressRef.current) {
      unsubProgressRef.current();
      unsubProgressRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);

    // 检查模型是否已下载
    if (modelState === 'not_downloaded') {
      setShowDownloadPrompt(true);
      return;
    }
    if (modelState === 'downloading') {
      setError('模型下载中，请等待完成');
      return;
    }

    try {
      // 请求麦克风权限
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
      timerRef.current = setInterval(async () => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setDuration(elapsed);

        // 最大时长限制
        if (elapsed >= 60) {
          stopRef.current();
          return;
        }

        // VAD: 检查是否静音超时自动停止
        if (elapsed >= 2 && window.api?.asrCheckVadStopped) {
          try {
            const { stopped } = await window.api.asrCheckVadStopped();
            if (stopped) {
              stopRef.current();
            }
          } catch {}
        }
      }, 300);

      setVoiceState('recording');
    } catch (err: any) {
      setError(err.message || '录音启动失败');
    }
  }, [modelState]);

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
  if (modelState === 'downloading') btnClass += ' downloading';

  return (
    <div className="ai-voice-input-wrap">
      <button
        className={btnClass}
        onClick={handleClick}
        disabled={disabled || voiceState === 'processing' || modelState === 'downloading'}
        title={
          modelState === 'downloading' ? `模型下载中 ${downloadPercent}%` :
          voiceState === 'recording' ? '点击停止录音' :
          voiceState === 'processing' ? '识别中...' :
          modelState === 'not_downloaded' ? '点击下载语音模型' :
          '语音输入'
        }
      >
        {voiceState === 'processing' || modelState === 'downloading' ? (
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

      {/* 录音时长 */}
      {voiceState === 'recording' && (
        <span className="ai-voice-duration">{formatDuration(duration)}</span>
      )}

      {/* 下载进度 */}
      {modelState === 'downloading' && (
        <span className="ai-voice-duration">{downloadPercent}%</span>
      )}

      {/* 错误提示 */}
      {error && (
        <span className="ai-voice-error" title={error} onClick={() => setError(null)}>!</span>
      )}

      {/* 首次使用引导弹窗 */}
      {showDownloadPrompt && (
        <div className="ai-voice-download-prompt">
          <div className="ai-voice-download-prompt-content">
            <p>需要下载语音识别模型 (~600MB) 才能使用语音输入功能</p>
            <div className="ai-voice-download-prompt-actions">
              <button onClick={() => setShowDownloadPrompt(false)}>取消</button>
              <button className="primary" onClick={handleDownload}>开始下载</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
