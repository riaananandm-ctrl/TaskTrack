'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Task, Subject, Reminder } from '@/lib/types';
import { TaskCard } from '@/components/task-card';
import { TaskDialog } from '@/components/task-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { format, isToday, isThisWeek, parseISO, addDays, startOfDay, differenceInCalendarDays } from 'date-fns';
import { getDeadlineStatus } from '@/lib/deadline-status';
import {
  Plus,
  ListTodo,
  Clock,
  CheckCircle2,
  AlertCircle,
  Calendar as CalendarIcon,
  Bell,
  BookOpen,
  GraduationCap,
  ArrowRight,
  CalendarDays,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { listUpcomingStudySessions, ScheduledStudySession } from '@/lib/study-schedule';
import { XpStreakWidget } from '@/components/xp-streak-widget';
import { ManageBacHelpButton } from '@/components/managebac-help';

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [studySessions, setStudySessions] = useState<ScheduledStudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [managebacConnected, setManagebacConnected] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    if (!user) return;
    // A silent refresh keeps the current list mounted, so an open Study Session panel
    // inside a task card is never unmounted while a reply is being saved.
    if (!options?.silent) setLoading(true);

    const [tasksRes, subjectsRes, remindersRes, sessionsRes, mbRes] = await Promise.all([
      supabase.from('tasks').select('*, subject:subjects(*)').eq('is_archived', false).order('due_date', { nullsFirst: false }),
      supabase.from('subjects').select('*').eq('is_archived', false),
      supabase.from('reminders').select('*, task:tasks(*)').eq('is_enabled', true).gte('scheduled_for', new Date().toISOString()).order('scheduled_for').limit(5),
      listUpcomingStudySessions().catch(() => [] as ScheduledStudySession[]),
      supabase.from('managebac_calendar_connections').select('user_id').maybeSingle(),
    ]);

    setTasks((tasksRes.data as unknown as Task[]) || []);
    setSubjects((subjectsRes.data as Subject[]) || []);
    setReminders((remindersRes.data as unknown as Reminder[]) || []);
    setStudySessions(sessionsRes || []);
    setManagebacConnected(!!mbRes.data);
    if (!options?.silent) setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    try {
      setBannerDismissed(localStorage.getItem('tasktrack:managebac-banner-dismissed') === 'true');
    } catch {
      // localStorage may be blocked.
    }
  }, []);

  const dismissBanner = () => {
    setBannerDismissed(true);
    try {
      localStorage.setItem('tasktrack:managebac-banner-dismissed', 'true');
    } catch {
      // localStorage may be blocked.
    }
  };

  const today = new Date();
  const greeting = (() => {
    const h = today.getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const firstName = profile?.full_name?.split(' ')[0] || 'there';

  const activeTasks = tasks.filter((t) => getDeadlineStatus(t) !== 'completed');

  const dueToday = activeTasks.filter((t) => t.due_date && isToday(parseISO(t.due_date)));

  const upcoming = activeTasks.filter((t) => getDeadlineStatus(t) === 'upcoming' && t.due_date && parseISO(t.due_date) <= addDays(today, 7));

  const completedThisWeek = tasks.filter(
    (t) => t.status === 'completed' && t.completed_at && isThisWeek(parseISO(t.completed_at), { weekStartsOn: 1 })
  );

  const overdue = activeTasks.filter((t) => getDeadlineStatus(t) === 'overdue');

  // Upcoming = due today or later and not overdue. Overdue tasks live in the red banner above.
  const upcomingDeadlines = activeTasks
    .filter((t) => t.due_date && getDeadlineStatus(t) === 'upcoming')
    .sort((a, b) => parseISO(a.due_date!).getTime() - parseISO(b.due_date!).getTime())
    .slice(0, 6);

  const nextStudySession = studySessions[0] ?? null;
  const upcomingStudySessions = studySessions.slice(0, 4);
  const nextReminder = reminders[0] ?? null;

  const subjectWorkload = subjects
    .map((s) => ({ subject: s, count: activeTasks.filter((t) => t.subject_id === s.id).length }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);

  // The next seven days, used for the deadline preview strip that links to Calendar.
  const weekStrip = Array.from({ length: 7 }, (_, i) => addDays(startOfDay(today), i)).map((date) => ({
    date,
    count: activeTasks.filter((t) => t.due_date && differenceInCalendarDays(parseISO(t.due_date), date) === 0).length,
  }));

  const summaryCards = [
    { label: 'Due today', value: dueToday.length, icon: Clock, accent: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30', href: '/app/tasks' },
    { label: 'Upcoming', value: upcoming.length, icon: ListTodo, accent: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', href: '/app/tasks' },
    { label: 'Completed this week', value: completedThisWeek.length, icon: CheckCircle2, accent: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', href: '/app/tasks' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-muted-foreground">Loading your dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="text-muted-foreground mt-1">
            Here&rsquo;s what needs your attention today &middot; {format(today, 'EEEE, MMMM d')}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} size="lg" className="flex-shrink-0">
          <Plus className="w-4 h-4 mr-1" /> New task
        </Button>
      </div>

      <XpStreakWidget />

      {!managebacConnected && !bannerDismissed && (
        <Card className="p-4 border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/50 flex items-center justify-center flex-shrink-0">
              <CalendarIcon className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                You haven&rsquo;t connected ManageBac yet.
              </p>
              <p className="text-xs text-blue-700/80 dark:text-blue-400/80">
                Connect now to see all your deadlines in one place.
              </p>
            </div>
            <Link href="/starter" className="flex-shrink-0">
              <Button size="sm">Connect ManageBac</Button>
            </Link>
            <ManageBacHelpButton label="Need help?" variant="ghost" className="text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/50 flex-shrink-0" />
            <button
              onClick={dismissBanner}
              className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </Card>
      )}

      {overdue.length > 0 && (
        <Card className="p-4 border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/50 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-5 h-5 text-red-600" />
            </div>
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
          <Link key={stat.label} href={stat.href}>
            <Card className="p-4 h-full transition-shadow hover:shadow-card">
              <div className="flex items-center gap-3">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', stat.bg)}>
                  <stat.icon className={cn('w-5 h-5', stat.accent)} />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold leading-tight">{stat.value}</p>
                  <p className="text-xs text-muted-foreground truncate">{stat.label}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}

        <Link href="/app/study-sessions">
          <Card className="p-4 h-full transition-shadow hover:shadow-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-5 h-5 text-sky-600" />
              </div>
              <div className="min-w-0">
                {nextStudySession ? (
                  <>
                    <p className="text-sm font-bold leading-tight">{format(parseISO(nextStudySession.scheduled_for), 'EEE, MMM d')}</p>
                    <p className="text-xs text-muted-foreground">Next study session</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-bold leading-tight">Not scheduled</p>
                    <p className="text-xs text-muted-foreground">Next study session</p>
                  </>
                )}
              </div>
            </div>
          </Card>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Today's tasks */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" /> Today&rsquo;s tasks
              </h2>
              <Link href="/app/tasks">
                <Button variant="ghost" size="sm">View all</Button>
              </Link>
            </div>
            {dueToday.length === 0 ? (
              <Card className="p-8 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-medium">You&rsquo;re all caught up.</p>
                <p className="text-xs text-muted-foreground mt-1">No tasks due today.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {dueToday.map((task) => (
                  <TaskCard key={task.id} task={task} onChanged={fetchData} />
                ))}
              </div>
            )}
          </section>

          {/* Upcoming deadlines */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-blue-500" /> Upcoming deadlines
              </h2>
              <Link href="/app/calendar">
                <Button variant="ghost" size="sm">
                  Open calendar <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </Link>
            </div>
            {upcomingDeadlines.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-sm font-medium">No upcoming deadlines.</p>
                <p className="text-xs text-muted-foreground mt-1">Add a due date to a task to see it here.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {upcomingDeadlines.map((task) => (
                  <TaskCard key={task.id} task={task} onChanged={fetchData} />
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Deadline preview */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-primary" /> This week
              </h2>
              <Link href="/app/calendar" className="text-xs font-medium text-primary hover:underline">
                Calendar
              </Link>
            </div>
            <Card className="p-4">
              <div className="grid grid-cols-7 gap-1">
                {weekStrip.map(({ date, count }) => {
                  const isTodayCell = isToday(date);
                  return (
                    <div key={date.toISOString()} className="flex flex-col items-center gap-1">
                      <span className="text-[10px] uppercase text-muted-foreground">{format(date, 'EEEEE')}</span>
                      <div
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold transition-colors',
                          isTodayCell ? 'bg-primary text-primary-foreground' : count > 0 ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'text-muted-foreground'
                        )}
                      >
                        {format(date, 'd')}
                      </div>
                      <span className={cn('w-1.5 h-1.5 rounded-full', count > 0 ? 'bg-primary' : 'bg-transparent')} />
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          {/* Reminders */}
          <section>
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <Bell className="w-4 h-4 text-primary" /> Reminders
            </h2>
            <Card className="p-4 space-y-3">
              {nextReminder ? (
                <div className="rounded-lg bg-primary/5 border border-primary/15 p-3">
                  <p className="text-xs font-medium text-primary uppercase tracking-wide">Next reminder</p>
                  <p className="text-sm font-semibold mt-1">{nextReminder.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(nextReminder.scheduled_for), 'EEE, MMM d, h:mm a')}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">No upcoming reminders.</p>
              )}
              {reminders.slice(nextReminder ? 1 : 0, 4).map((r) => (
                <div key={r.id} className="flex items-start gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary/60 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(r.scheduled_for), 'EEE, MMM d, h:mm a')}
                    </p>
                  </div>
                </div>
              ))}
              <Link href="/app/notifications">
                <Button variant="ghost" size="sm" className="w-full">View all reminders</Button>
              </Link>
            </Card>
          </section>

          {/* Upcoming study sessions */}
          <section>
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <GraduationCap className="w-4 h-4 text-sky-600" /> Study sessions
            </h2>
            <Card className="p-4 space-y-3">
              {upcomingStudySessions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Nothing scheduled. Build a plan in Study Sessions.
                </p>
              ) : (
                upcomingStudySessions.map((s) => (
                  <div key={s.id} className="flex items-start gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full bg-sky-500 mt-1.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{s.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(s.scheduled_for), 'EEE, MMM d, h:mm a')}
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

          {/* Subject workload */}
          <section>
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">
              <BookOpen className="w-4 h-4 text-primary" /> Subject workload
            </h2>
            {subjectWorkload.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-sm text-muted-foreground mb-3">No subjects with active tasks.</p>
                <Link href="/app/subjects">
                  <Button variant="outline" size="sm">Add your first subject</Button>
                </Link>
              </Card>
            ) : (
              <Card className="p-4 space-y-3">
                {subjectWorkload.map(({ subject, count }) => (
                  <div key={subject.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${subject.colour}15` }}>
                      <BookOpen className="w-4 h-4" style={{ color: subject.colour }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{subject.name}</p>
                    </div>
                    <span className="text-sm font-bold text-muted-foreground">{count}</span>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </div>
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        subjects={subjects}
        onSaved={() => fetchData()}
      />
    </div>
  );
}
