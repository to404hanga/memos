import { useState, useRef, useEffect, useCallback } from 'react';

export interface SpeechSegment {
  id: string;
  raw: string;
  polished: string;
  status: 'polishing' | 'done' | 'error';
}

export function useVoiceInput(onTextCommit: (text: string) => void) {
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [partialText, setPartialText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  
  const segmentsRef = useRef<SpeechSegment[]>([]);
  const baseTextRef = useRef('');

  // 这里的 baseTextRef 其实在解耦后不太需要了，因为我们可以直接 append 到父组件的 input
  // 但为了保持逻辑连贯，我们可以记录开始录音时的前文快照

  useEffect(() => {
    let unsubAsr: (() => void) | undefined;
    let unsubPolish: (() => void) | undefined;

    if (window.api?.onAsrProgress) {
      unsubAsr = window.api.onAsrProgress((progress) => {
        if (progress.type === 'partial') {
          setPartialText(progress.text);
        } else if (progress.type === 'final' && progress.segmentId) {
          setPartialText('');
          const newSeg: SpeechSegment = {
            id: progress.segmentId,
            raw: progress.text,
            polished: '',
            status: 'polishing'
          };
          segmentsRef.current = [...segmentsRef.current, newSeg];
          setSegments(segmentsRef.current);

          // 触发润色
          const previousText = segmentsRef.current
            .slice(0, -1)
            .map(s => s.polished || s.raw)
            .join('')
            .slice(-50);

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
        const segIdx = segmentsRef.current.findIndex(s => s.id === chunk.streamId);
        if (segIdx === -1) return;

        const updatedSegments = [...segmentsRef.current];
        const seg = { ...updatedSegments[segIdx] };

        if (chunk.type === 'chunk' && chunk.content) {
          const content = seg.polished ? chunk.content : chunk.content.replace(/^\s+/, '');
          seg.polished += content;
        } else if (chunk.type === 'done') {
          seg.status = 'done';
          // 当一段话彻底润色完成后，将其提交给父组件并从 segments 中移除
          onTextCommit(seg.polished || seg.raw);
          updatedSegments.splice(segIdx, 1);
        } else if (chunk.type === 'error') {
          seg.status = 'error';
          onTextCommit(seg.raw);
          updatedSegments.splice(segIdx, 1);
        }

        segmentsRef.current = updatedSegments;
        setSegments(updatedSegments);
      });
    }

    return () => {
      unsubAsr?.();
      unsubPolish?.();
    };
  }, [onTextCommit]);

  return {
    segments,
    partialText,
    isRecording,
    setIsRecording,
    isPolishing: segments.length > 0
  };
}
