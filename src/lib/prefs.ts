import { useCallback, useEffect, useState } from 'react';

// Per-device display preferences: theme and density. Kept in localStorage and applied as
// data-theme / data-density on <html>, which index.css keys its tokens off.
export type Theme = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

const THEME_KEY = 'agenda.theme';
const DENSITY_KEY = 'agenda.density';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable; the choice just won't be remembered
  }
}

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

export function applyPrefs(theme: Theme = read(THEME_KEY, ['light', 'dark', 'system'], 'system'), density: Density = read(DENSITY_KEY, ['comfortable', 'compact'], 'comfortable')) {
  const root = document.documentElement;
  root.dataset.theme = theme === 'system' ? (systemDark() ? 'dark' : 'light') : theme;
  root.dataset.density = density;
}

export function usePrefs() {
  const [theme, setThemeState] = useState<Theme>(() => read(THEME_KEY, ['light', 'dark', 'system'], 'system'));
  const [density, setDensityState] = useState<Density>(() => read(DENSITY_KEY, ['comfortable', 'compact'], 'comfortable'));

  useEffect(() => {
    applyPrefs(theme, density);
    if (theme !== 'system') return;
    // Follow the OS when it switches between light and dark.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyPrefs(theme, density);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, density]);

  const setTheme = useCallback((t: Theme) => {
    write(THEME_KEY, t);
    setThemeState(t);
  }, []);
  const setDensity = useCallback((d: Density) => {
    write(DENSITY_KEY, d);
    setDensityState(d);
  }, []);

  return { theme, density, setTheme, setDensity };
}
