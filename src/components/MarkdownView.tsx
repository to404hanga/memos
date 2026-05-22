/**
 * Markdown 渲染组件
 *
 * 将 Markdown 文本安全地渲染为 HTML：
 * - 使用 marked 库解析 Markdown（支持 GFM 和软换行）
 * - 使用 DOMPurify 进行 XSS 防护清洗
 * - 自定义图片渲染器：自动为本地路径添加 file:// 协议前缀
 * - 通过 useMemo 缓存渲染结果，避免不必要的重新解析
 *
 * 在以下场景中使用：
 * - MemoForm 预览面板
 * - MemoItem 展开详情
 * - AiChatModal AI 回复内容渲染
 */
import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

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
    const raw = marked.parse(content) as string;
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['img'],
      ADD_ATTR: ['src', 'alt', 'title', 'style'],
    });
  }, [content]);

  return (
    <div
      className={`markdown-body ${className || ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
