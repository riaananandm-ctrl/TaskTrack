'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getUserSettings, patchUserSettingsCache } from '@/lib/user-settings-cache';
import { useAuth } from '@/lib/auth-context';
import { DEFAULT_FONT_ID, isFontId } from '@/lib/fonts';

const FONT_STORAGE_KEY = 'tasktrack:font';

interface FontContextType {
  fontId: string;
  loading: boolean;
  setFont: (id: string) => Promise<void>;
  resetFont: () => Promise<void>;
}

const FontContext = createContext<FontContextType>({
  fontId: DEFAULT_FONT_ID,
  loading: true,
  setFont: async () => {},
  resetFont: async () => {},
});

function applyFont(id: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-font', id);
}

function readLocalFont(): string {
  if (typeof window === 'undefined') return DEFAULT_FONT_ID;
  try {
    const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
    return isFontId(stored) ? stored : DEFAULT_FONT_ID;
  } catch {
    return DEFAULT_FONT_ID;
  }
}

/**
 * Applies the chosen reading font across the whole app. Signed-in students store
 * the choice in their own settings row; the local mirror keeps it instant and
 * covers the signed-out pages.
 */
export function FontProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [fontId, setFontId] = useState<string>(DEFAULT_FONT_ID);
  const [loading, setLoading] = useState(true);

  const persistLocal = useCallback((id: string) => {
    try {
      window.localStorage.setItem(FONT_STORAGE_KEY, id);
    } catch {
      // Storage may be blocked; the font still applies for this page view.
    }
  }, []);

  // Initialise from the local mirror so the right font shows immediately.
  useEffect(() => {
    const initial = readLocalFont();
    setFontId(initial);
    applyFont(initial);
    setLoading(false);
  }, []);

  // Once signed in, the source of truth is the student's stored preference.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const data = await getUserSettings(user.id);
      if (!active) return;
      const stored = (data as { font_family?: string } | null)?.font_family;
      if (isFontId(stored)) {
        setFontId(stored);
        applyFont(stored);
        persistLocal(stored);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, persistLocal]);

  const setFont = useCallback(
    async (id: string) => {
      if (!isFontId(id)) return;
      setFontId(id);
      applyFont(id);
      persistLocal(id);
      if (user) {
        patchUserSettingsCache(user.id, { font_family: id });
        const { error } = await supabase
          .from('user_settings')
          .upsert({ user_id: user.id, font_family: id }, { onConflict: 'user_id' });
        if (error) throw error;
      }
    },
    [user, persistLocal]
  );

  const resetFont = useCallback(async () => {
    await setFont(DEFAULT_FONT_ID);
  }, [setFont]);

  return (
    <FontContext.Provider value={{ fontId, loading, setFont, resetFont }}>
      {children}
    </FontContext.Provider>
  );
}

export function useFont() {
  return useContext(FontContext);
}
