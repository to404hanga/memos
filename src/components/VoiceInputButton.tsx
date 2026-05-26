import React, { useCallback, useState, useRef, useEffect } from 'react';

type VoiceState = 'idle' | 'recording';
type ModelState = 'unknown' | 'not_downloaded' | 'downloading' | 'ready';

interface Props {
  onRecordingStateChange?: (recording: boolean) => void;
  disabled?: boolean;
}

export default function VoiceInputButton({ onRecordingStateChange, disabled }: Props): React.ReactElement {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<ModelState>('unknown');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const unsubProgressRef = useRef<(() => void) | null>(null);

  // 状态同步给父组件
  useEffect(() => {
    onRecordingStateChange?.(voiceState === 'recording');
  }, [voiceState, onRecordingStateChange]);

  // 初始化检查模型
  useEffect(() => {
    if (window.api?.asrGetStatus) {
      window.api.asrGetStatus().then((status) => {
        if (status === 'ready' || status === 'idle') setModelState('ready');
        else if (status === 'downloading') setModelState('downloading');
        else setModelState('not_downloaded');
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

    if (window.api?.onAsrDownloadProgress) {
      unsubProgressRef.current = window.api.onAsrDownloadProgress((p) => setDownloadPercent(p.percent));
    }

    try {
      const res = await window.api.asrDownload();
      if (res.success) setModelState('ready');
      else { setError(res.error || '下载失败'); setModelState('not_downloaded'); }
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
    if (voiceState === 'recording') return;
    setError(null);
    if (modelState === 'not_downloaded') { setShowDownloadPrompt(true); return; }
    if (modelState === 'downloading') { setError('模型下载中，请等待完成'); return; }

    try {
      if (window.api?.asrRequestMicPermission) {
        const perm = await window.api.asrRequestMicPermission();
        if (!perm.granted) { setError('麦克风权限被拒绝'); return; }
      }

      const res = await window.api.asrStartRecording();
      if (!res.success) { setError(res.error || '录音启动失败'); return; }

      setVoiceState('recording');
      
      startTimeRef.current = Date.now();
      setDuration(0);
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setDuration(elapsed);
        if (elapsed >= 300) stopRef.current();
      }, 1000);
    } catch (err: any) {
      setError(err.message || '录音启动失败');
      setVoiceState('idle');
    }
  }, [modelState, voiceState]);

  const stopAndRecognize = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      await window.api.asrStopRecording();
    } catch (err: any) {
      setError(err.message || '停止失败');
    }

    setVoiceState('idle');
    setDuration(0);
  }, []);

  const stopRef = useRef(stopAndRecognize);
  stopRef.current = stopAndRecognize;

  const handleClick = useCallback(() => {
    if (voiceState === 'recording') stopRef.current();
    else if (voiceState === 'idle') startRecording();
  }, [voiceState, startRecording]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  let btnClass = 'ai-voice-btn';
  if (voiceState === 'recording') btnClass += ' recording';
  if (modelState === 'downloading') btnClass += ' downloading';

  return (
    <div className="ai-voice-input-wrap">
      <button
        className={btnClass}
        onClick={handleClick}
        disabled={disabled || modelState === 'downloading'}
        title={
          modelState === 'downloading' ? `模型下载中 ${downloadPercent}%` :
          voiceState === 'recording' ? '点击停止录音' :
          modelState === 'not_downloaded' ? '点击下载语音模型' :
          '语音输入'
        }
      >
        {modelState === 'downloading' ? (
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

      {/* 状态指示（仅录音中显示时长） */}
      {voiceState === 'recording' && (
        <span className="ai-voice-duration">
          <span className="ai-voice-dot" />
          {formatDuration(duration)}
        </span>
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
