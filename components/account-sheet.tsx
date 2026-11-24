'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';
import { initialsOf } from '@/lib/initials';
import { cn } from '@/lib/utils';
import {
  Settings, Crown, Bell, LayoutDashboard, ListTodo, Calendar, BookOpen,
  CalendarClock, GraduationCap, LogOut, ChevronRight,
} from 'lucide-react';

/**
 * The profile panel. On phones and tablets it slides up from the bottom and on larger
 * screens it slides in from the side (see the responsive classes on SheetContent), so
 * the same panel feels native on every device.
 *
 * It holds Settings, the full navigation, and sign out. Anything the top bar already
 * shows (notifications, the brand) is intentionally left out to avoid duplication.
 */

interface AccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NAV_ITEMS = [
  { href: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/app/tasks', label: 'My Tasks', icon: ListTodo },
  { href: '/app/calendar', label: 'Calendar', icon: Calendar },
  { href: '/app/subjects', label: 'Subjects', icon: BookOpen },
  { href: '/app/planning', label: 'Planning', icon: CalendarClock },
  { href: '/app/study-sessions', label: 'Study Sessions', icon: GraduationCap },
  { href: '/app/notifications', label: 'Notifications', icon: Bell },
  { href: '/app/premium', label: 'Premium', icon: Crown },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

export function AccountSheet({ open, onOpenChange }: AccountSheetProps) {
  const { user, profile, signOut } = useAuth();
  const pathname = usePathname();

  const initials = initialsOf(profile?.full_name, user?.email);

  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[88vh] max-h-[88vh] rounded-t-2xl p-0 sm:mx-auto sm:max-w-lg"
      >
        {/* Grab handle, phones only */}
        <div className="lg:hidden flex justify-center pt-3">
          <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
        </div>

        <SheetHeader className="px-5 pt-4 pb-4 text-left border-b border-border">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12">
              <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base truncate">{profile?.full_name || 'Your account'}</SheetTitle>
              <SheetDescription className="truncate text-xs">{user?.email}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          <Link
            href="/app/settings"
            onClick={close}
            className="flex items-center gap-3 px-3 py-3 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors"
          >
            <span className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Settings className="w-4 h-4 text-primary" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold">Settings</span>
              <span className="block text-xs text-muted-foreground truncate">
                Profile, appearance, notifications, integrations
              </span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </Link>

          <div className="pt-2 pb-1 px-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Go to</p>
          </div>

          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/app' ? pathname === '/app' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <button
            onClick={() => { close(); signOut(); }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
