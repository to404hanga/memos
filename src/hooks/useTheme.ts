/**
 * 主题管理 Hook
 *
 * 管理应用的主题模式切换，支持三种模式：
 * - auto: 跟随系统偏好（通过 prefers-color-scheme 媒体查询）
 * - light: 强制浅色模式
 * - dark: 强制深色模式
 *
 * 主题偏好通过 localStorage 持久化，切换时会更新 HTML 根元素的 data-theme 属性，
 * CSS 变量（定义在 variables.css）会根据该属性自动切换。
 */
import { useState, useEffect } from 'react';

/** 主题模式类型 */
type ThemeMode = 'auto' | 'light' | 'dark';

export function useTheme() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('theme') as ThemeMode) || 'auto';
  });

  useEffect(() => {
    const applyTheme = () => {
      let dark = false;
      if (themeMode === 'dark') dark = true;
      else if (themeMode === 'auto') dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    applyTheme();
    localStorage.setItem('theme', themeMode);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [themeMode]);

  return { themeMode, setThemeMode };
}
