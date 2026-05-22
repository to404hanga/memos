/**
 * React 应用入口文件
 *
 * 使用 React 18 的 createRoot API 将应用挂载到 #root DOM 节点。
 * 同时引入全局样式文件。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
