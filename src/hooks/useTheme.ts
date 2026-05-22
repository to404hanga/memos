import { useState, useEffect } from 'react';

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
