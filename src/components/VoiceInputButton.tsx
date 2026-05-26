import React, { useCallback, useState, useRef, useEffect } from 'react';

type VoiceState = 'idle' | 'recording';
type ModelState = 'unknown' | 'not_downloaded' | 'downloading' | 'ready';

interface SpeechSegment {
  id: string;
  raw: string;
  polished: string;
  status: 'polishing' | 'done' | 'error';
}

interface Props {
  currentInput: string;
  onTextUpdate: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceInputButton({ currentInput, onTextUpdate, disabled }: Props): React.ReactElement {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<ModelState>('unknown');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const unsubProgressRef = useRef<(() => void) | null>(null);

  // 流式状态引用
  const baseTextRef = useRef<string>(''); // 开始录音前的文本
  const partialTextRef = useRef<string>(''); // 当前正在说的未成句的片段
  const segmentsRef = useRef<SpeechSegment[]>([]); // 已成句并进入润色的分段

  // 触发重渲染的 dummy state
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  // 计算并更新给父组件的文本
  const updateComposedText = useCallback(() => {
    let text = baseTextRef.current;
    
    // 拼接已确定的片段（优先使用 polished 结果）
    const segsText = segmentsRef.current
      .map(s => s.polished || s.raw)
      .filter(Boolean)
      .join(''); // 取消了默认加空格，因为中文排版通常不需要，标点符号由 LLM 控制
    
    if (segsText) text += segsText;
    
    // 拼接当前正在说的 partial text
    if (partialTextRef.current) {
      text += partialTextRef.current;
    }
    
    onTextUpdate(text);
  }, [onTextUpdate]);

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

  // 监听 ASR 和 AI 润色流
  useEffect(() => {
    let unsubAsr: (() => void) | undefined;
    let unsubPolish: (() => void) | undefined;

    if (window.api?.onAsrProgress) {
      unsubAsr = window.api.onAsrProgress((progress) => {
        if (progress.type === 'partial') {
          partialTextRef.current = progress.text;
          updateComposedText();
        } else if (progress.type === 'final' && progress.segmentId) {
          partialTextRef.current = '';
          const newSeg: SpeechSegment = {
            id: progress.segmentId,
            raw: progress.text,
            polished: '',
            status: 'polishing'
          };
          segmentsRef.current.push(newSeg);
          updateComposedText();
          forceUpdate(); // 触发 UI 更新显示 "润色中..."

          // 提取上下文（如果有 baseText 或者之前的段落），只取最后 50 个字作为参考
          let previousText = baseTextRef.current;
          const segsText = segmentsRef.current
            .slice(0, -1) // 排除当前这一段
            .map(s => s.polished || s.raw)
            .filter(Boolean)
            .join(' ');
          
          if (segsText) previousText += (previousText ? ' ' : '') + segsText;
          previousText = previousText.slice(-50); // 避免上下文过长

          // 触发 LLM 润色，带上上下文
          window.api.aiPolishStream({ 
            text: progress.text, 
            streamId: progress.segmentId,
            previousText
          });
        }
      });
    }

    if (window.api?.onAiPolishChunk) {
      unsubPolish = window.api.onAiPolishChunk((chunk) => {
        const seg = segmentsRef.current.find(s => s.id === chunk.streamId);
        if (!seg) return;

        if (chunk.type === 'chunk' && chunk.content) {
          // 清理可能存在的前导空白或换行
          const content = seg.polished ? chunk.content : chunk.content.replace(/^\s+/, '');
          seg.polished += content;
        } else if (chunk.type === 'done') {
          seg.status = 'done';
          forceUpdate(); // 强制重渲染以清除 "润色中..."
        } else if (chunk.type === 'error') {
          seg.status = 'error';
          seg.polished = seg.raw; // 发生错误则回退为原始文本
          forceUpdate(); // 强制重渲染
        }
        updateComposedText();
      });
    }

    return () => {
      if (unsubAsr) unsubAsr();
      if (unsubPolish) unsubPolish();
    };
  }, [updateComposedText]);

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
    setError(null);
    if (modelState === 'not_downloaded') { setShowDownloadPrompt(true); return; }
    if (modelState === 'downloading') { setError('模型下载中，请等待完成'); return; }

    try {
      if (window.api?.asrRequestMicPermission) {
        const perm = await window.api.asrRequestMicPermission();
        if (!perm.granted) { setError('麦克风权限被拒绝'); return; }
      }

      baseTextRef.current = currentInput;
      partialTextRef.current = '';
      segmentsRef.current = [];

      const res = await window.api.asrStartRecording();
      if (!res.success) { setError(res.error || '录音启动失败'); return; }

      startTimeRef.current = Date.now();
      setDuration(0);
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setDuration(elapsed);
        if (elapsed >= 300) stopRef.current(); // 最大限制 5 分钟
      }, 1000);

      setVoiceState('recording');
    } catch (err: any) {
      setError(err.message || '录音启动失败');
    }
  }, [modelState, currentInput]);

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

      {/* 状态指示（显示录音中或润色中） */}
      {(voiceState === 'recording' || segmentsRef.current.some(s => s.status === 'polishing')) && (
        <span className="ai-voice-duration">
          {voiceState === 'recording' ? formatDuration(duration) : '润色中...'}
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
