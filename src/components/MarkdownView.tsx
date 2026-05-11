import React, { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

const renderer = new marked.Renderer();
renderer.image = function ({ href, title, text }) {
  let src = href;
  if (src && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
    src = `file://${src}`;
  }
  return `<img src="${src}" alt="${text || ''}" title="${title || ''}" style="max-width:100%;border-radius:8px;margin:6px 0;" />`;
};
marked.use({ renderer });

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export default function MarkdownView({ content, className }: MarkdownViewProps): React.ReactElement {
  const html = useMemo(() => {
    if (!content) return '';
    return marked.parse(content) as string;
  }, [content]);

  return (
    <div
      className={`markdown-body ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
