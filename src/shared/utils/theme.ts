export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bt_theme_mode';

export function getStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode;
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch (e) {
    // Fallback if localStorage access is restricted
  }
  return 'light';
}

export function getResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): 'light' | 'dark' {
  const resolved = getResolvedTheme(mode);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }

    const favicon = document.getElementById('app-favicon') as HTMLLinkElement | null;
    if (favicon) {
      favicon.href = resolved === 'dark' ? '/tree-white.png' : '/tree.png';
    }
  }
  return resolved;
}

export function setStoredTheme(mode: ThemeMode): 'light' | 'dark' {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (e) {}
  }
  return applyTheme(mode);
}

export function toggleTheme(): 'light' | 'dark' {
  const current = getStoredTheme();
  const resolved = getResolvedTheme(current);
  const next: ThemeMode = resolved === 'dark' ? 'light' : 'dark';
  setStoredTheme(next);
  return next;
}

export function initTheme(): ThemeMode {
  const mode = getStoredTheme();
  applyTheme(mode);

  if (typeof window !== 'undefined' && window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      const current = getStoredTheme();
      if (current === 'system') {
        applyTheme('system');
      }
    };
    if (mql.addEventListener) {
      mql.addEventListener('change', listener);
    } else if ((mql as any).addListener) {
      (mql as any).addListener(listener);
    }
  }

  return mode;
}
