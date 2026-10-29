'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  ListTodo,
  Calendar,
  BookOpen,
  Bell,
  Settings,
  Plus,
  Sparkles,
  LogOut,
  ChevronRight,
  CalendarClock,
  GraduationCap,
  Layers,
  Ruler,
  Menu,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

/** localStorage key for the remembered desktop sidebar preference. */
const SIDEBAR_PREF_KEY = 'tasktrack.sidebar.collapsed';

/**
 * Sidebar destinations. Settings and Integrations are deliberately not here: they live
 * in the profile box at the bottom, which is where people look for them.
 */
const NAV_ITEMS = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/tasks', label: 'My Tasks', icon: ListTodo },
  { href: '/app/calendar', label: 'Calendar', icon: Calendar },
  { href: '/app/subjects', label: 'Subjects', icon: BookOpen },
  { href: '/app/tools', label: 'Tools', icon: Ruler },
  { href: '/app/planning', label: 'Planning', icon: CalendarClock },
  { href: '/app/study-sessions', label: 'Study Sessions', icon: GraduationCap },
  { href: '/app/review', label: 'Review', icon: Layers },
  { href: '/app/notifications', label: 'Notifications', icon: Bell },
];

/** Count unread, enabled reminders for the current student. Shared by both navs. */
function useUnreadReminders(): number {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const fetchUnread = async () => {
      if (!user) return;
      const { count } = await supabase
        .from('reminders')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
        .eq('is_enabled', true);
      setUnreadCount(count || 0);
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [user]);

  return unreadCount;
}

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  return (name || email || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * The full sidebar body: logo, destinations, premium card, profile box. Rendered
 * unchanged in both the persistent desktop sidebar and the mobile drawer.
 */
function SidebarBody({
  pathname,
  unreadCount,
  onNavigate,
}: {
  pathname: string;
  unreadCount: number;
  onNavigate?: () => void;
}) {
  const { user, profile, signOut } = useAuth();
  const initials = initialsOf(profile?.full_name, user?.email);

  return (
    <>
      <div className="p-5 border-b border-white/10">
        <Link href="/app" onClick={onNavigate}>
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 p-2.5 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              )}
            >
              <item.icon className={cn('w-4 h-4', isActive ? 'text-sky-300' : 'text-slate-400')} />
              <span className="flex-1">{item.label}</span>
              {item.label === 'Notifications' && unreadCount > 0 && (
                <span className="bg-sky-400 text-navy-800 text-xs font-semibold px-1.5 min-w-[20px] h-5 flex items-center justify-center rounded-md">
                  {unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Premium card */}
      <div className="p-3">
        <Link href="/app/premium" onClick={onNavigate}>
          <div className="rounded-lg border border-white/15 bg-white/5 p-3.5 cursor-pointer hover:bg-white/10 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-3.5 h-3.5 text-sky-300" />
              <span className="text-xs font-semibold text-white">Upgrade to Premium</span>
            </div>
            <p className="text-xs font-bold text-sky-200 mb-0.5">₹699 for 3 months</p>
            <div className="flex items-center text-[11px] text-slate-300 font-medium">
              Coming soon <ChevronRight className="w-3 h-3" />
            </div>
          </div>
        </Link>
      </div>

      {/* Profile box: settings and sign out live here */}
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-white/5 transition-colors">
          <Avatar className="w-8 h-8 flex-shrink-0">
            <AvatarFallback className="bg-sky-400 text-navy-800 text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate text-white">{profile?.full_name || 'User'}</p>
            <p className="text-[11px] text-slate-400 truncate">{user?.email}</p>
          </div>
          <Link
            href="/app/settings"
            onClick={onNavigate}
            className={cn(
              'p-1.5 rounded-md transition-colors flex-shrink-0',
              pathname.startsWith('/app/settings')
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white'
            )}
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </Link>
          <button
            onClick={() => {
              onNavigate?.();
              signOut();
            }}
            className="p-1.5 rounded-md text-slate-400 hover:bg-white/5 hover:text-white transition-colors flex-shrink-0"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}

/** Three-line toggle button, visually identical across desktop and mobile. */
function HamburgerButton({
  expanded,
  onToggle,
  label,
  ariaControls,
}: {
  expanded: boolean;
  onToggle: () => void;
  label: string;
  ariaControls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={ariaControls}
      aria-label={label}
      title={label}
      className="p-2 rounded-md border border-border bg-card text-foreground hover:bg-accent hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <Menu className="w-5 h-5" aria-hidden="true" />
    </button>
  );
}

/**
 * Persistent desktop sidebar, shown from the large breakpoint up. Fully collapsible:
 * the toggle hides the entire rail (nav, premium card, profile) and the content
 * expands into the freed space. The preference is remembered across visits.
 */
export function AppSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const unreadCount = useUnreadReminders();

  return (
    <aside
      id="app-sidebar"
      aria-label="Sidebar"
      aria-hidden={collapsed}
      className={cn(
        'hidden lg:flex flex-col w-56 bg-navy-800 dark:bg-navy-800 h-screen sticky top-0 flex-shrink-0',
        collapsed && 'hidden'
      )}
    >
      <SidebarBody pathname={pathname} unreadCount={unreadCount} />
      <span className="sr-only" aria-live="polite">
        {collapsed ? 'Sidebar hidden' : 'Sidebar shown'}
      </span>
      <button onClick={onToggle} className="sr-only">
        {collapsed ? 'Show sidebar' : 'Hide sidebar'}
      </button>
    </aside>
  );
}

/**
 * App-wide top bar. On desktop it hosts the hamburger at the far left (fixed position
 * whether the sidebar is open or closed); on mobile it is the existing top bar and the
 * hamburger opens a closed-by-default drawer.
 */
export function AppTopBar({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenAccount,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** Opens the account panel that holds Settings and sign out (mobile). */
  onOpenAccount: () => void;
}) {
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const unreadCount = useUnreadReminders();
  const initials = initialsOf(profile?.full_name, user?.email);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Close the drawer on Escape and on route change; lock nothing else.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  const desktopToggle = (
    <HamburgerButton
      expanded={!sidebarCollapsed}
      onToggle={onToggleSidebar}
      label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      ariaControls="app-sidebar"
    />
  );

  return (
    <>
      {/* Desktop top bar: hamburger pinned at top-left over the page, content reserves space via layout */}
      <div className="hidden lg:flex sticky top-0 z-30 h-12 items-center gap-3 px-4 bg-background border-b border-border">
        <div className="w-14 flex justify-center flex-shrink-0">{desktopToggle}</div>
        <div className="flex-1" />
        {unreadCount > 0 && (
          <Link
            href="/app/notifications"
            className="relative p-2 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label={`Notifications, ${unreadCount} unread`}
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
              {unreadCount}
            </span>
          </Link>
        )}
      </div>

      {/* Mobile top bar: brand + notifications + account, with hamburger at the left */}
      <div className="lg:hidden sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-border px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {desktopToggle}
          <Link href="/app" className="flex items-center">
            <Logo size={28} />
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href="/app/notifications"
            className="relative p-2.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Link>
          <button
            onClick={onOpenAccount}
            className="p-1 rounded-full hover:bg-accent transition-colors"
            aria-label="Account and settings"
            aria-haspopup="dialog"
          >
            <Avatar className="w-8 h-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </button>
        </div>
      </div>

      {/* Mobile drawer: closed by default, full sidebar content, keyboard dismissible */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div className="absolute inset-0 bg-black/50" onClick={closeDrawer} aria-hidden="true" />
          <div
            ref={drawerRef}
            className="relative w-72 max-w-[85%] h-full bg-navy-800 dark:bg-navy-800 flex flex-col overflow-y-auto animate-slide-up"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
              <span className="text-sm font-semibold text-white">Menu</span>
              <button
                onClick={closeDrawer}
                className="p-2 rounded-md text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col flex-1">
              <SidebarBody
                pathname={pathname}
                unreadCount={unreadCount}
                onNavigate={closeDrawer}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
