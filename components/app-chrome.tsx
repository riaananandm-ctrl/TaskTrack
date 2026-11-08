'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { rememberLastRoute } from '@/lib/last-route';
import { AppSidebar, AppTopBar } from '@/components/app-shell';
import { AccountSheet } from '@/components/account-sheet';
import { PriorityAlertBanner } from '@/components/priority-alert-banner';
import { ReminderSoundWatcher } from '@/components/reminder-sound-watcher';

/** localStorage key for the remembered desktop sidebar preference. */
const SIDEBAR_PREF_KEY = 'tasktrack.sidebar.collapsed';

function readSidebarPref(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * App frame: owns the desktop sidebar collapse state (persisted) and renders the
 * top bar. The hamburger sits in a reserved slot at the top-left and stays in the
 * same screen position whether the sidebar is open or closed.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false); // SSR-safe default; hydrated below
  const [accountOpen, setAccountOpen] = useState(false);

  // Record the last valid in-app route on every navigation, so a reopened tab or a
  // fresh PWA launch can resume here. Session storage only — path strings, never
  // tokens or user content.
  useEffect(() => {
    rememberLastRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    setCollapsed(readSidebarPref());
  }, []);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_PREF_KEY, next ? '1' : '0');
      } catch {
        // Storage unavailable (private mode); the session state still works.
      }
      return next;
    });
  };

  return (
    <>
      <ReminderSoundWatcher />
      <div className="min-h-screen flex bg-background">
        <AppSidebar collapsed={collapsed} onToggle={toggleSidebar} />
        <div className="flex-1 flex flex-col min-w-0">
          <AppTopBar
            sidebarCollapsed={collapsed}
            onToggleSidebar={toggleSidebar}
            onOpenAccount={() => setAccountOpen(true)}
          />
          <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-28 lg:pb-8 max-w-7xl mx-auto w-full">
            <PriorityAlertBanner />
            {children}
          </main>
        </div>
      </div>
      <AccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
    </>
  );
}
