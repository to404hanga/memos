import React from 'react';
import { createRoot } from 'react-dom/client';
import { PetRenderer } from './PetRenderer';
import '../styles.css';
import './styles.css';

// 宠物窗口强制暗色主题
document.documentElement.setAttribute('data-theme', 'dark');

const container = document.getElementById('pet-root');
if (container) {
  const root = createRoot(container);
  root.render(<PetRenderer />);
}
