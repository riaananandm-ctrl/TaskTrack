'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { initialsOf } from '@/lib/initials';
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
  ClipboardCheck,
  GraduationCap,
  Layers,
  Ruler,
  Menu,
  X,
  Inbox,
  Users,
  Target,
  Trophy,
  Bot,
} from 'lucide-react';
import { useNewTaskCount } from '@/lib/new-tasks';
import { hasUnseenRelease } from '@/lib/whats-new';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

/** localStorage key for the remembered desktop sidebar preference. */
const SIDEBAR_PREF_KEY = 'tasktrack.sidebar.collapsed';

/**
 * Sidebar destinations. Settings and Integrations are deliberately not here: they live
 * in the profile box at the bottom, which is where people look for them.
 */
const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/app/new', label: 'New Tasks', icon: Inbox },
      { href: '/app/tasks', label: 'My Tasks', icon: ListTodo },
      { href: '/app/calendar', label: 'Calendar', icon: Calendar },
      { href: '/app/subjects', label: 'Subjects', icon: BookOpen },
      { href: '/app/notifications', label: 'Notifications', icon: Bell },
      { href: '/app/whats-new', label: "What's new", icon: Sparkles },
    ],
  },
  {
    label: 'Study',
    items: [
      { href: '/app/ai', label: 'TaskTrack AI', icon: Bot },
      { href: '/app/ib', label: 'IB Hub', icon: Target },
      { href: '/app/planning', label: 'Planning', icon: CalendarClock },
      { href: '/app/study-sessions', label: 'Study Sessions', icon: GraduationCap },
      { href: '/app/group', label: 'Group Study', icon: Users },
      { href: '/app/grader', label: 'AI Grader', icon: ClipboardCheck },
      { href: '/app/review', label: 'Review', icon: Layers },
      { href: '/app/leaderboard', label: 'Leaderboard', icon: Trophy },
      { href: '/app/tools', label: 'Tools', icon: Ruler },
    ],
  },
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
  const newTaskCount = useNewTaskCount();
  const initials = initialsOf(profile?.full_name, user?.email);
  // Read after mount so server and client render the same markup.
  const [unseenRelease, setUnseenRelease] = useState(false);
  useEffect(() => {
    const update = () => setUnseenRelease(hasUnseenRelease());
    update();
    window.addEventListener('tasktrack:whatsnew-seen', update);
    return () => window.removeEventListener('tasktrack:whatsnew-seen', update);
  }, []);

  return (
    <>
      <div className="px-5 pt-5 pb-4">
        <Link href="/app" onClick={onNavigate} className="inline-block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
          <Logo tone="light" size={34} />
        </Link>
      </div>

      <nav className="flex-1 px-3 pb-3 space-y-5 overflow-y-auto" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400/80">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60',
                      isActive
                        ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sky-300" aria-hidden />
                    )}
                    <item.icon className={cn('w-4 h-4 transition-colors', isActive ? 'text-sky-300' : 'text-slate-400')} />
                    <span className="flex-1">{item.label}</span>
                    {item.label === 'Notifications' && unreadCount > 0 && (
                      <span className="bg-sky-400 text-navy-900 text-[11px] font-bold px-1.5 min-w-[20px] h-5 flex items-center justify-center rounded-full">
                        {unreadCount}
                      </span>
                    )}
                    {item.href === '/app/new' && newTaskCount > 0 && (
                      <span className="bg-[#5FD3C0] text-[#17264B] text-[11px] font-bold px-1.5 min-w-[20px] h-5 flex items-center justify-center rounded-full">
                        {newTaskCount > 99 ? '99+' : newTaskCount}
                      </span>
                    )}
                    {item.href === '/app/whats-new' && unseenRelease && (
                      <span className="bg-[#5FD3C0] text-[#17264B] text-[10px] font-bold uppercase px-1.5 h-5 flex items-center justify-center rounded-full">
                        New
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Premium card */}
      <div className="p-3">
        <Link href="/app/premium" onClick={onNavigate} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
          <div className="relative overflow-hidden rounded-xl border border-white/15 bg-gradient-to-br from-sky-400/20 via-white/5 to-blue-500/10 p-3.5 transition-colors hover:border-white/25">
            <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-sky-300/20 blur-2xl" aria-hidden />
            <div className="relative flex items-center gap-2 mb-1">
              <Sparkles className="w-3.5 h-3.5 text-sky-300" />
              <span className="text-xs font-semibold text-white">Upgrade your plan</span>
            </div>
            <p className="relative text-xs font-bold text-sky-200 mb-0.5">Premium ₹499 · Max ₹999</p>
            <div className="relative flex items-center text-[11px] text-slate-300 font-medium">
              Pay by UPI <ChevronRight className="w-3 h-3" />
            </div>
          </div>
        </Link>
      </div>

      {/* Profile box: settings and sign out live here */}
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-white/5 transition-colors">
          <Avatar className="w-8 h-8 flex-shrink-0 ring-2 ring-white/15">
            <AvatarFallback className="bg-gradient-to-br from-sky-300 to-blue-500 text-navy-900 text-xs font-bold">
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
      className="p-2 rounded-lg border border-border/80 bg-card text-foreground shadow-soft hover:bg-accent hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
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
        // `lg:flex` would override a plain `hidden`, so only add it while expanded.
        'flex-col w-60 bg-gradient-to-b from-navy-800 to-navy-900 border-r border-white/5 h-screen h-[100dvh] sticky top-0 flex-shrink-0 pb-[env(safe-area-inset-bottom)]',
        collapsed ? 'hidden' : 'hidden lg:flex'
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
      <div className="hidden lg:flex sticky top-0 z-30 h-14 items-center gap-3 px-4 bg-background/75 backdrop-blur-md border-b border-border/70">
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
      <div className="lg:hidden sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/70 px-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] h-[calc(3.5rem+env(safe-area-inset-top))] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HamburgerButton
            expanded={drawerOpen}
            onToggle={() => setDrawerOpen((open) => !open)}
            label={drawerOpen ? 'Close menu' : 'Open menu'}
            ariaControls="app-mobile-drawer"
          />
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
            className="tap-target p-1 rounded-full hover:bg-accent transition-colors"
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
          id="app-mobile-drawer"
          className="lg:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
        >
          <div className="absolute inset-0 bg-navy-900/50 backdrop-blur-[2px] animate-fade-in" onClick={closeDrawer} aria-hidden="true" />
          <div
            ref={drawerRef}
            className="relative w-72 max-w-[85%] h-full bg-gradient-to-b from-navy-800 to-navy-900 flex flex-col overflow-y-auto shadow-2xl pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-left duration-200"
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
