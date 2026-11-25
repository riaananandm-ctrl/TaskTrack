'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExamBoostCard } from '@/components/exam-boost-card';
import { Spotlight } from '@/components/fx/spotlight';
import { Aurora } from '@/components/fx/aurora';
import {
  format,
  isToday,
  isTomorrow,
  isThisWeek,
  parseISO,
  addDays,
  startOfDay,
  differenceInCalendarDays,
} from 'date-fns';
import {
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Calendar as CalendarIcon,
  Bell,
  BookOpen,
  GraduationCap,
  ArrowRight,
  CalendarDays,
  RotateCw,
  X,
} from 'lucide-react';
import { Task, Subject, Reminder } from '@/lib/types';
import { ScheduledStudySession } from '@/lib/study-schedule';
import { getDeadlineStatus } from '@/lib/deadline-status';
import { cn } from '@/lib/utils';
import { TaskCard } from '@/components/task-card';
import { TaskDialog } from '@/components/task-dialog';
import { XpStreakWidget } from '@/components/xp-streak-widget';
import { ManageBacHelpButton } from '@/components/managebac-help';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DueTodayIcon, UpcomingIcon, DoneIcon, StudyIcon, CalendarCheckIcon, OverdueIcon } from '@/components/brand-icons';
import { Skeleton } from '@/components/ui/skeleton';
import { InviteFriendCard } from '@/components/invite-friend-card';

const BANNER_KEY = 'tasktrack:managebac-banner-dismissed';

export interface DashboardData {
  tasks: Task[];
  subjects: Subject[];
  reminders: Reminder[];
  studySessions: ScheduledStudySession[];
  managebacConnected: boolean;
}

interface DashboardViewProps {
  data: DashboardData;
  firstName: string;
  /** Called after a task is created, edited, completed or deleted. Should refresh quietly. */
  onChanged: () => void;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Today", "Tomorrow" or "Thu, Nov 13" for grouping deadlines by day. */
function dayLabel(date: Date) {
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEE, MMM d');
}

/** Subject colours are stored as hex; fall back to the primary colour when they're not. */
function tint(colour: string | null | undefined, alpha: string) {
  return colour && /^#[0-9a-f]{6}$/i.test(colour) ? `${colour}${alpha}` : undefined;
}

function SectionHeading({
  icon: Icon,
  iconClass,
  title,
  count,
  action,
}: {
  icon: typeof Clock;
  iconClass: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3 gap-2">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Icon className={cn('w-4 h-4', iconClass)} aria-hidden />
        {title}
        {count !== undefined && count > 0 && (
          <span className="ml-0.5 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}

export function DashboardView({ data, firstName, onChanged }: DashboardViewProps) {
  const { tasks, subjects, reminders, studySessions, managebacConnected } = data;
  const [dialogOpen, setDialogOpen] = useState(false);
  // Start hidden so the banner never flashes in for students who already dismissed it.
  const [bannerDismissed, setBannerDismissed] = useState(true);

  useEffect(() => {
    try {
      setBannerDismissed(localStorage.getItem(BANNER_KEY) === 'true');
    } catch {
      setBannerDismissed(false);
    }
  }, []);

  const dismissBanner = () => {
    setBannerDismissed(true);
    try {
      localStorage.setItem(BANNER_KEY, 'true');
    } catch {
      // localStorage may be blocked.
    }
  };

  const today = new Date();
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const activeTasks = tasks.filter((t) => getDeadlineStatus(t) !== 'completed');
  const overdue = activeTasks.filter((t) => getDeadlineStatus(t) === 'overdue');
  const dueToday = activeTasks.filter(
    (t) => t.due_date && isToday(parseISO(t.due_date)) && getDeadlineStatus(t) !== 'overdue'
  );

  // Next 7 days, starting tomorrow. Today's tasks have their own section, so they
  // are left out here instead of being shown twice.
  const upcomingWeek = activeTasks
    .filter((t) => {
      if (!t.due_date || getDeadlineStatus(t) !== 'upcoming') return false;
      const days = differenceInCalendarDays(parseISO(t.due_date), today);
      return days >= 1 && days <= 7;
    })
    .sort((a, b) => parseISO(a.due_date!).getTime() - parseISO(b.due_date!).getTime());

  const upcomingGroups = upcomingWeek.slice(0, 6).reduce<{ label: string; tasks: Task[] }[]>((groups, task) => {
    const label = dayLabel(parseISO(task.due_date!));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.tasks.push(task);
    else groups.push({ label, tasks: [task] });
    return groups;
  }, []);

  const completedThisWeek = tasks.filter(
    (t) => t.status === 'completed' && t.completed_at && isThisWeek(parseISO(t.completed_at), { weekStartsOn: 1 })
  ).length;

  const nextStudySession = studySessions[0] ?? null;
  const nextReminder = reminders[0] ?? null;

  const subjectWorkload = subjects
    .map((s) => ({ subject: s, count: activeTasks.filter((t) => t.subject_id === s.id).length }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxWorkload = Math.max(1, ...subjectWorkload.map((s) => s.count));

  const weekStrip = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(today), i)).map((date) => ({
    date,
    count: activeTasks.filter((t) => t.due_date && differenceInCalendarDays(parseISO(t.due_date), date) === 0).length,
  }));

  // A one-line status that changes with the student's day instead of a fixed tagline.
  const status = (() => {
    if (overdue.length > 0 && dueToday.length > 0)
      return `${plural(dueToday.length, 'task', 'tasks')} due today, plus ${overdue.length} overdue.`;
    if (overdue.length > 0) return `Nothing due today, but ${plural(overdue.length, 'task needs', 'tasks need')} catching up.`;
    if (dueToday.length > 0) return `${plural(dueToday.length, 'task', 'tasks')} due today. You've got this.`;
    if (upcomingWeek.length > 0) return `Nothing due today. ${plural(upcomingWeek.length, 'deadline', 'deadlines')} coming up this week.`;
    return 'Nothing due this week. A good time to get ahead.';
  })();

  const summaryCards = [
    { label: 'Due today', value: dueToday.length, Icon: DueTodayIcon, href: '/app/tasks' },
    { label: 'Next 7 days', value: upcomingWeek.length, Icon: UpcomingIcon, href: '/app/calendar' },
    { label: 'Done this week', value: completedThisWeek, Icon: DoneIcon, href: '/app/tasks' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome header */}
      <Spotlight className="gradient-hero overflow-hidden rounded-2xl p-6 sm:p-8 text-white shadow-lg-soft" color="rgba(127, 178, 255, 0.22)" size={420}>
        <Aurora className="opacity-60" />
        {/* Decorative check mark echoing the logo */}
        <svg
          className="pointer-events-none absolute -right-6 -bottom-10 h-48 w-48 text-white/[0.06] sm:h-56 sm:w-56"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
        <div className="relative flex flex-col sm:flex-row sm:items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-200/90">
              {format(today, 'EEEE, MMMM d')}
            </p>
            <h1 className="mt-2 text-2xl sm:text-4xl font-bold tracking-tight">
              {greeting}, {firstName}
            </h1>
            <p className="mt-2 text-sm sm:text-base text-blue-100/90">{status}</p>
          </div>
          <Button
            onClick={() => setDialogOpen(true)}
            size="lg"
            className="flex-shrink-0 w-full sm:w-auto bg-white text-navy-900 shadow-lg shadow-navy-900/30 hover:bg-sky-50 hover:shadow-navy-900/30"
          >
            <Plus className="w-4 h-4 mr-1" /> New task
          </Button>
        </div>
      </Spotlight>

      {!managebacConnected && !bannerDismissed && (
        <Card className="p-4 border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/20">
          <div className="flex flex-wrap items-center gap-3">
            <CalendarCheckIcon size={34} />
            <div className="flex-1 min-w-[12rem]">
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                Step 1: connect ManageBac
              </p>
              <p className="text-xs text-blue-700/80 dark:text-blue-400/80">
                Takes about a minute. Your deadlines then come in on their own, and TaskTrack AI knows every task.
              </p>
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <Link href="/starter">
                <Button size="sm">Connect ManageBac</Button>
              </Link>
              <ManageBacHelpButton label="Need help?" variant="ghost" className="text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/50" />
              <button
                onClick={dismissBanner}
                className="tap-target p-1.5 rounded-lg text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                aria-label="Dismiss ManageBac banner"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </Card>
      )}

      <ExamBoostCard />

      <Link href="/app/leaderboard" aria-label="Open the leaderboard" className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
        <XpStreakWidget />
      </Link>

      {overdue.length > 0 && (
        <Card className="p-4 border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20">
          <div className="flex items-center gap-3">
            <OverdueIcon size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                {overdue.length} {overdue.length === 1 ? 'task is' : 'tasks are'} overdue
              </p>
              <p className="text-xs text-red-700/80 dark:text-red-400/80 truncate">
                {overdue.slice(0, 2).map((t) => t.title).join(', ')}
                {overdue.length > 2 ? ` and ${overdue.length - 2} more` : ''}
              </p>
            </div>
            <Link href="/app/tasks" className="flex-shrink-0">
              <Button variant="outline" size="sm">Review</Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summaryCards.map((stat) => (
          <Link key={stat.label} href={stat.href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="p-4 h-full transition-all group-hover:shadow-card group-hover:-translate-y-0.5">
              <div className="flex items-center gap-3">
                <stat.Icon size={32} />
                <div className="min-w-0">
                  <p className="text-2xl font-bold leading-tight tabular-nums">{stat.value}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{stat.label}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}

        <Link href="/app/study-sessions" className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="p-4 h-full transition-all group-hover:shadow-card group-hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
              <StudyIcon size={32} />
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight truncate">
                  {nextStudySession ? dayLabel(parseISO(nextStudySession.scheduled_for)) : 'Not scheduled'}
                </p>
                <p className="text-xs text-muted-foreground leading-snug">
                  {nextStudySession ? `Study session · ${format(parseISO(nextStudySession.scheduled_for), 'h:mm a')}` : 'Next study session'}
                </p>
              </div>
            </div>
          </Card>
        </Link>
      </div>

      <InviteFriendCard />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          <section>
            <SectionHeading
              icon={Clock}
              iconClass="text-orange-500"
              title="Today’s tasks"
              count={dueToday.length}
              action={
                <Link href="/app/tasks">
                  <Button variant="ghost" size="sm">View all</Button>
                </Link>
              }
            />
            {dueToday.length === 0 ? (
              <Card className="p-8 text-center border-dashed">
                <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500" aria-hidden />
                </div>
                <p className="text-sm font-medium">You&rsquo;re all caught up.</p>
                <p className="text-xs text-muted-foreground mt-1">No tasks due today.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {dueToday.map((task) => (
                  <TaskCard key={task.id} task={task} onChanged={onChanged} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeading
              icon={CalendarDays}
              iconClass="text-blue-500"
              title="Coming up"
              count={upcomingWeek.length}
              action={
                <Link href="/app/calendar">
                  <Button variant="ghost" size="sm">
                    Open calendar <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </Link>
              }
            />
            {upcomingGroups.length === 0 ? (
              <Card className="p-8 text-center border-dashed">
                <p className="text-sm font-medium">Nothing due in the next 7 days.</p>
                <p className="text-xs text-muted-foreground mt-1">Add a due date to a task to see it here.</p>
              </Card>
            ) : (
              <div className="space-y-4">
                {upcomingGroups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                    <div className="space-y-2">
                      {group.tasks.map((task) => (
                        <TaskCard key={task.id} task={task} onChanged={onChanged} />
                      ))}
                    </div>
                  </div>
                ))}
                {upcomingWeek.length > 6 && (
                  <Link href="/app/calendar" className="block text-center text-sm font-medium text-primary hover:underline">
                    See {upcomingWeek.length - 6} more in Calendar
                  </Link>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <section>
            <SectionHeading
              icon={CalendarIcon}
              iconClass="text-primary"
              title="This week"
              action={
                <Link href="/app/calendar" className="text-xs font-medium text-primary hover:underline">
                  Calendar
                </Link>
              }
            />
            <Card className="p-3">
              <div className="grid grid-cols-7 gap-1">
                {weekStrip.map(({ date, count }) => {
                  const isTodayCell = isToday(date);
                  return (
                    <Link
                      key={date.toISOString()}
                      href="/app/calendar"
                      aria-label={`${format(date, 'EEEE, MMMM d')}: ${count === 0 ? 'nothing due' : plural(count, 'task', 'tasks') + ' due'}`}
                      title={count === 0 ? 'Nothing due' : `${plural(count, 'task', 'tasks')} due`}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg py-2 transition-colors',
                        isTodayCell ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                      )}
                    >
                      <span className={cn('text-[10px] uppercase', isTodayCell ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                        {format(date, 'EEEEE')}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{format(date, 'd')}</span>
                      <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                        {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                          <span key={i} className={cn('w-1.5 h-1.5 rounded-full', isTodayCell ? 'bg-primary-foreground' : 'bg-primary')} />
                        ))}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Card>
          </section>

          <section>
            <SectionHeading icon={Bell} iconClass="text-primary" title="Reminders" />
            <Card className="p-4 space-y-3">
              {nextReminder ? (
                <div className="rounded-lg bg-primary/5 border border-primary/15 p-3">
                  <p className="text-xs font-medium text-primary uppercase tracking-wide">Next reminder</p>
                  <p className="text-sm font-semibold mt-1">{nextReminder.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {dayLabel(new Date(nextReminder.scheduled_for))}, {format(new Date(nextReminder.scheduled_for), 'h:mm a')}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">No upcoming reminders.</p>
              )}
              {reminders.slice(1, 4).map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary/60 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {dayLabel(new Date(r.scheduled_for))}, {format(new Date(r.scheduled_for), 'h:mm a')}
                    </p>
                  </div>
                </div>
              ))}
              <Link href="/app/notifications">
                <Button variant="ghost" size="sm" className="w-full">View all reminders</Button>
              </Link>
            </Card>
          </section>

          <section>
            <SectionHeading icon={GraduationCap} iconClass="text-sky-600" title="Study sessions" />
            <Card className="p-4 space-y-3">
              {studySessions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Nothing scheduled. Build a plan in Study Sessions.
                </p>
              ) : (
                studySessions.slice(0, 4).map((s) => (
                  <div key={s.id} className="flex items-start gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full bg-sky-500 mt-1.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{s.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {dayLabel(parseISO(s.scheduled_for))}, {format(parseISO(s.scheduled_for), 'h:mm a')}
                        {s.duration_minutes ? ` · ${s.duration_minutes} min` : ''}
                      </p>
                    </div>
                  </div>
                ))
              )}
              <Link href="/app/study-sessions">
                <Button variant="ghost" size="sm" className="w-full">Open Study Sessions</Button>
              </Link>
            </Card>
          </section>

          <section>
            <SectionHeading icon={BookOpen} iconClass="text-primary" title="Subject workload" />
            {subjectWorkload.length === 0 ? (
              <Card className="p-6 text-center border-dashed">
                <p className="text-sm text-muted-foreground mb-3">No subjects with active tasks.</p>
                <Link href="/app/subjects">
                  <Button variant="outline" size="sm">Add your first subject</Button>
                </Link>
              </Card>
            ) : (
              <Card className="p-4 space-y-3.5">
                {subjectWorkload.map(({ subject, count }) => (
                  <div key={subject.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-primary" style={{ background: tint(subject.colour, '') }} />
                        <span className="font-medium truncate">{subject.name}</span>
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground tabular-nums flex-shrink-0">
                        {plural(count, 'task', 'tasks')}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${(count / maxWorkload) * 100}%`, background: tint(subject.colour, '') }}
                      />
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </div>
      </div>

      <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} subjects={subjects} onSaved={onChanged} />
    </div>
  );
}

/** Placeholder shaped like the dashboard, shown on first load instead of a blank page. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your dashboard">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-2">
          <Skeleton className="h-6 w-40 mb-3" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="space-y-2">
          <Skeleton className="h-6 w-28 mb-3" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/** Shown when the dashboard data can't be loaded, instead of silently showing empty lists. */
export function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center mx-auto mb-3">
        <AlertCircle className="w-6 h-6 text-red-600" aria-hidden />
      </div>
      <p className="font-semibold">We couldn&rsquo;t load your dashboard</p>
      <p className="text-sm text-muted-foreground mt-1">Check your connection and try again.</p>
      <Button onClick={onRetry} variant="outline" className="mt-4">
        <RotateCw className="w-4 h-4 mr-1.5" /> Try again
      </Button>
    </Card>
  );
}
