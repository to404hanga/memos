/**
 * 附件管理子组件
 *
 * 负责附件的展示、添加、打开和移除操作。
 */
import React from 'react';
import type { Attachment } from '../../types/global';

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
    ppt: '📽️', pptx: '📽️', txt: '📃', md: '📃', csv: '📊',
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    mp3: '🎵', wav: '🎵', flac: '🎵', mp4: '🎬', avi: '🎬', mov: '🎬',
    js: '💻', ts: '💻', py: '💻', java: '💻', html: '🌐', css: '🎨',
    json: '📋', xml: '📋', yaml: '📋', yml: '📋',
  };
  return iconMap[ext] || '📎';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Props {
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
}

export default function AttachmentManager({ attachments, onAttachmentsChange }: Props): React.ReactElement {
  const handleAdd = async () => {
    const result = await window.api.selectAttachment();
    if (result) onAttachmentsChange([...attachments, result]);
  };

  return (
    <div className="form-group">
      <div className="content-label-row">
        <label>附件</label>
        <button type="button" className="tag-add-btn" onClick={handleAdd}>+ 添加附件</button>
      </div>
      {attachments.length === 0 && (
        <p className="no-reminders">暂无附件，可拖拽文件到编辑区或点击「+ 添加附件」</p>
      )}
      {attachments.length > 0 && (
        <div className="attachments-list">
          {attachments.map((att, idx) => (
            <div key={idx} className="attachment-item">
              <span className="attachment-icon">{getFileIcon(att.originalName)}</span>
              <div className="attachment-info">
                <span className="attachment-name" title={att.originalName}>{att.originalName}</span>
                <span className="attachment-size">{formatFileSize(att.size)}</span>
              </div>
              <button type="button" className="attachment-open" onClick={() => window.api.openAttachment(att.filePath)} title="打开文件">📂</button>
              <button type="button" className="rem-delete" onClick={() => onAttachmentsChange(attachments.filter((_, i) => i !== idx))} title="移除">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
