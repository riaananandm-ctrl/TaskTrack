'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';

export type Theme = 'light' | 'dark' | 'system';

/** Namespaced key holding the choice on this device. */
export const THEME_STORAGE_KEY = 'tasktrack-theme';

interface ThemeContextType {
  /** The choice the student made: light, dark, or follow the system. */
  theme: Theme;
  /** What is actually shown right now: light or dark. */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
});

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

/** The one place that puts the theme on the document. */
function applyTheme(theme: Theme): 'light' | 'dark' {
  const resolved = resolve(theme);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readLocalTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Single source of truth for the theme. Applies the choice immediately, persists
 * it for the signed-in student in their own settings row (and mirrors it locally),
 * and follows the operating system only while "System" is selected.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  // Initialise from this device, and follow the OS while "System" is chosen.
  useEffect(() => {
    const initial = readLocalTheme();
    setThemeState(initial);
    setResolvedTheme(applyTheme(initial));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      setThemeState((current) => {
        if (current === 'system') setResolvedTheme(applyTheme('system'));
        return current;
      });
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // A signed-in student's stored preference is the source of truth.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('theme')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!active) return;
      const stored = (data as { theme?: string } | null)?.theme;
      if (isTheme(stored)) {
        setThemeState(stored);
        setResolvedTheme(applyTheme(stored));
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, stored);
        } catch {
          // Storage may be blocked; the theme still applies for this view.
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      setResolvedTheme(applyTheme(next));
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore blocked storage.
      }
      if (user) {
        void supabase
          .from('user_settings')
          .upsert({ user_id: user.id, theme: next }, { onConflict: 'user_id' });
      }
    },
    [user]
  );

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
