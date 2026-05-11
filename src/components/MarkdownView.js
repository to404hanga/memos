import React, { useMemo } from 'react';
import { marked } from 'marked';

// 配置 marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

// 自定义渲染器：将本地图片路径转为 file:// 协议
const renderer = new marked.Renderer();
const originalImage = renderer.image.bind(renderer);
renderer.image = function ({ href, title, text }) {
  // 支持本地绝对路径
  let src = href;
  if (src && !src.startsWith('http') && !src.startsWith('file://') && !src.startsWith('data:')) {
    src = `file://${src}`;
  }
  return `<img src="${src}" alt="${text || ''}" title="${title || ''}" style="max-width:100%;border-radius:8px;margin:6px 0;" />`;
};
marked.use({ renderer });

export default function MarkdownView({ content, className }) {
  const html = useMemo(() => {
    if (!content) return '';
    return marked.parse(content);
  }, [content]);

  return (
    <div
      className={`markdown-body ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
