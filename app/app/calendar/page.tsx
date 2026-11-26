'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Task, Subject, Reminder, WeeklyPlan, CATEGORY_LABELS } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TaskDialog } from '@/components/task-dialog';
import { TaskCard } from '@/components/task-card';
import { useReminderPrompt } from '@/components/reminder-prompt';
import { StudySessionPanel } from '@/components/study-session-panel';
import { useStudySessionOpener } from '@/hooks/use-study-session';
import { listManageBacEvents, MANAGEBAC_SOURCE_LABEL, type ManageBacEvent } from '@/lib/managebac';
import {
  ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Clock, Bell, GraduationCap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  startOfDay, endOfDay, addDays, isSameDay, isSameMonth, parseISO, isToday,
  addWeeks, subWeeks, addMonths, subMonths,
} from 'date-fns';
import { getDeadlineStatus } from '@/lib/deadline-status';

type ViewType = 'month' | 'week' | 'agenda';

export default function CalendarPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [weeklyPlans, setWeeklyPlans] = useState<WeeklyPlan[]>([]);
  const [mbEvents, setMbEvents] = useState<ManageBacEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewType>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const { session: studySession, openForTask, close: closeStudySession, error: studyError } = useStudySessionOpener();
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const { onCreated, dialogs } = useReminderPrompt({ subjects, tasks });

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    if (!user) return;
    // A silent refresh keeps the calendar mounted, so an open Study Session panel
    // inside a task card is never unmounted while a reply is being saved.
    if (!options?.silent) setLoading(true);
    const [tasksRes, subjectsRes, remindersRes, plansRes] = await Promise.all([
      supabase.from('tasks').select('*, subject:subjects(*)').order('due_date', { nullsFirst: false }),
      supabase.from('subjects').select('*').eq('is_archived', false),
      supabase.from('reminders').select('*, task:tasks(*)').eq('is_enabled', true).order('scheduled_for'),
      supabase.from('weekly_plans').select('*, task:tasks(*)').order('planned_date'),
    ]);
    setTasks((tasksRes.data as unknown as Task[]) || []);
    setSubjects((subjectsRes.data as Subject[]) || []);
    setReminders((remindersRes.data as unknown as Reminder[]) || []);
    setWeeklyPlans((plansRes.data as unknown as WeeklyPlan[]) || []);
    setMbEvents(await listManageBacEvents());
    if (!options?.silent) setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterSubject !== 'all' && t.subject_id !== filterSubject) return false;
      if (filterCategory !== 'all' && t.category !== filterCategory) return false;
      if (filterStatus === 'active' && (getDeadlineStatus(t) === 'completed' || t.is_archived)) return false;
      if (filterStatus === 'completed' && getDeadlineStatus(t) !== 'completed') return false;
      if (filterStatus === 'overdue' && getDeadlineStatus(t) !== 'overdue') return false;
      return true;
    });
  }, [tasks, filterSubject, filterCategory, filterStatus]);

  const getTasksForDate = (date: Date) => {
    return filteredTasks.filter((t) => t.due_date && isSameDay(parseISO(t.due_date), date));
  };

  const getRemindersForDate = (date: Date) => {
    return reminders.filter((r) => isSameDay(new Date(r.scheduled_for), date));
  };

  const getPlansForDate = (date: Date) => {
    return weeklyPlans.filter((p) => p.planned_date && isSameDay(parseISO(p.planned_date), date));
  };

  // Imported ManageBac entries sit on the day of their due date, or their start date.
  const getMbEventsForDate = (date: Date) => {
    return mbEvents.filter((e) => {
      const when = e.due_at || e.start_at;
      return when ? isSameDay(parseISO(when), date) : false;
    });
  };

  const getTaskColor = (task: Task) => {
    const status = getDeadlineStatus(task);
    if (status === 'completed') return '#16A34A';
    if (status === 'overdue') return '#DC2626';
    return task.subject?.colour || '#2563EB';
  };

  // Month view
  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  // Week view
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  // Agenda view
  const agendaTasks = useMemo(() => {
    const start = startOfDay(currentDate);
    const end = addDays(start, 30);
    return filteredTasks
      .filter((t) => t.due_date)
      .filter((t) => {
        const due = parseISO(t.due_date!);
        return due >= start && due <= end;
      })
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  }, [filteredTasks, currentDate]);

  const navigate = (direction: number) => {
    if (view === 'month') setCurrentDate(direction > 0 ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    else if (view === 'week') setCurrentDate(direction > 0 ? addWeeks(currentDate, 1) : subWeeks(currentDate, 1));
    else setCurrentDate(direction > 0 ? addDays(currentDate, 7) : addDays(currentDate, -7));
  };

  const headerLabel = (() => {
    if (view === 'month') return format(currentDate, 'MMMM yyyy');
    if (view === 'week') return `${format(weekDays[0], 'MMM d')} – ${format(weekDays[6], 'MMM d, yyyy')}`;
    return format(currentDate, 'MMMM yyyy');
  })();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground mt-1">View tasks and reminders by date</p>
        </div>
        <Button onClick={() => { setSelectedDate(new Date()); setTaskDialogOpen(true); }} size="lg">
          <Plus className="w-4 h-4 mr-1" /> Add task
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={view} onValueChange={(v) => setView(v as ViewType)}>
          <TabsList>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="agenda">Agenda</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-medium min-w-[140px] text-center">{headerLabel}</span>
          <Button variant="outline" size="icon" onClick={() => navigate(1)}><ChevronRight className="w-4 h-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => { setCurrentDate(new Date()); setSelectedDate(new Date()); }}>Today</Button>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:w-auto xl:ml-auto">
          <Select value={filterSubject} onValueChange={setFilterSubject}>
            <SelectTrigger className="w-full md:w-[140px]"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-full md:w-[140px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="col-span-2 w-full sm:col-span-1 md:w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground">Loading calendar...</div>
      ) : (
        <>
          {/* Month View */}
          {view === 'month' && (
            <div className="space-y-3">
              {/* Desktop / tablet */}
              <div className="hidden sm:grid grid-cols-7 gap-1">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">{day}</div>
                ))}
                {monthDays.map((day) => {
                  const dayTasks = getTasksForDate(day);
                  const dayReminders = getRemindersForDate(day);
                  const inMonth = isSameMonth(day, currentDate);
                  const today = isToday(day);
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => setSelectedDate(day)}
                      className={cn(
                        'min-h-[80px] rounded-lg border p-1.5 text-left transition-all hover:shadow-soft',
                        !inMonth && 'opacity-40',
                        today ? 'border-primary border-2' : 'border-border',
                        selectedDate && isSameDay(day, selectedDate) && 'ring-2 ring-primary ring-offset-1'
                      )}
                    >
                      <div className={cn('text-xs font-medium mb-1', today && 'text-primary')}>{format(day, 'd')}</div>
                      <div className="space-y-0.5">
                        {dayTasks.slice(0, 3).map((t) => (
                          <div key={t.id} className="flex items-center gap-1 text-[10px] truncate">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: getTaskColor(t) }} />
                            <span className={cn('truncate', t.status === 'completed' && 'line-through opacity-60')}>{t.title}</span>
                          </div>
                        ))}
                        {dayReminders.slice(0, 1).map((r) => (
                          <div key={r.id} className="flex items-center gap-1 text-[10px] text-purple-600 truncate">
                            <Bell className="w-2.5 h-2.5 flex-shrink-0" />
                            <span className="truncate">{r.title}</span>
                          </div>
                        ))}
                        {getMbEventsForDate(day).slice(0, 1).map((e) => (
                          <div key={e.id} className="flex items-center gap-1 text-[10px] text-blue-600 truncate">
                            <CalendarIcon className="w-2.5 h-2.5 flex-shrink-0" />
                            <span className="truncate">{e.summary || 'ManageBac entry'}</span>
                          </div>
                        ))}
                        {dayTasks.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayTasks.length - 3} more</div>}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Mobile: agenda-first with date picker */}
              <div className="sm:hidden">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CalendarIcon className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{format(selectedDate || new Date(), 'EEEE, MMM d')}</span>
                  </div>
                  <div className="flex gap-1 overflow-x-auto pb-2">
                    {monthDays.filter((d) => isSameMonth(d, currentDate)).map((day) => {
                      const dayTasks = getTasksForDate(day);
                      const today = isToday(day);
                      const isSelected = selectedDate && isSameDay(day, selectedDate);
                      return (
                        <button
                          key={day.toISOString()}
                          onClick={() => setSelectedDate(day)}
                          className={cn(
                            'flex flex-col items-center min-w-[44px] py-2 rounded-lg border transition-all',
                            isSelected ? 'bg-primary text-primary-foreground border-primary' : today ? 'border-primary' : 'border-border'
                          )}
                        >
                          <span className="text-[10px]">{format(day, 'EEE')}</span>
                          <span className="text-sm font-bold">{format(day, 'd')}</span>
                          {dayTasks.length > 0 && <div className="w-1.5 h-1.5 rounded-full mt-0.5" style={{ background: isSelected ? '#fff' : getTaskColor(dayTasks[0]) }} />}
                        </button>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* Selected date tasks */}
              {selectedDate && (
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">{format(selectedDate, 'EEEE, MMMM d')}</h3>
                    <Button size="sm" variant="outline" onClick={() => { setTaskDialogOpen(true); }}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add
                    </Button>
                  </div>
                  {(() => {
                    const dayTasks = getTasksForDate(selectedDate);
                    const dayReminders = getRemindersForDate(selectedDate);
                    const dayMbEvents = getMbEventsForDate(selectedDate);
                    if (dayTasks.length === 0 && dayReminders.length === 0 && dayMbEvents.length === 0) {
                      return <p className="text-sm text-muted-foreground py-4 text-center">No tasks scheduled for this date.</p>;
                    }
                    return (
                      <div className="space-y-2">
                        {dayTasks.map((t) => <TaskCard key={t.id} task={t} onChanged={fetchData} />)}
                        {dayTasks.map((t) => (
                          <button
                            key={`study-${t.id}`}
                            onClick={() => openForTask(t)}
                            className="w-full flex items-center gap-2 p-2.5 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20 text-left hover:bg-sky-100/60 dark:hover:bg-sky-950/40 transition-colors"
                          >
                            <GraduationCap className="w-4 h-4 text-sky-500 flex-shrink-0" />
                            <span className="text-sm font-medium truncate">{t.title}</span>
                            <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">Study session</span>
                          </button>
                        ))}
                        {dayReminders.map((r) => (
                          <div key={r.id} className="flex items-center gap-2 p-3 rounded-lg border border-purple-200 dark:border-purple-900 bg-purple-50/50 dark:bg-purple-950/20">
                            <Bell className="w-4 h-4 text-purple-500" />
                            <div>
                              <p className="text-sm font-medium">{r.title}</p>
                              <p className="text-xs text-muted-foreground">{format(new Date(r.scheduled_for), 'h:mm a')}</p>
                            </div>
                          </div>
                        ))}
                        {dayMbEvents.map((e) => (
                          <div key={e.id} className="flex items-center gap-2 p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
                            <CalendarIcon className="w-4 h-4 text-blue-500" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{e.summary || 'ManageBac calendar entry'}</p>
                              <p className="text-xs text-muted-foreground">{MANAGEBAC_SOURCE_LABEL}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </Card>
              )}
            </div>
          )}

          {/* Week View */}
          {view === 'week' && (
            <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
              {weekDays.map((day) => {
                const dayTasks = getTasksForDate(day);
                const dayReminders = getRemindersForDate(day);
                const dayPlans = getPlansForDate(day);
                const today = isToday(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'rounded-lg border p-2 min-h-[150px]',
                      today ? 'border-primary border-2' : 'border-border'
                    )}
                  >
                    <div className="text-center mb-2">
                      <p className="text-xs text-muted-foreground">{format(day, 'EEE')}</p>
                      <p className={cn('text-lg font-bold', today && 'text-primary')}>{format(day, 'd')}</p>
                    </div>
                    <div className="space-y-1">
                      {dayTasks.map((t) => (
                        <button
                          key={t.id}
                          className="w-full text-left text-[11px] p-1.5 rounded border-l-2 truncate hover:shadow-soft transition-all"
                          style={{ borderLeftColor: getTaskColor(t), background: `${getTaskColor(t)}10` }}
                          onClick={() => openForTask(t)}
                          title="Open study session"
                        >
                          <p className={cn('font-medium truncate flex items-center gap-1', t.status === 'completed' && 'line-through opacity-60')}>
                            <GraduationCap className="w-3 h-3 flex-shrink-0 text-sky-500" />
                            <span className="truncate">{t.title}</span>
                          </p>
                          {t.due_time && <p className="text-[10px] text-muted-foreground">{t.due_time}</p>}
                        </button>
                      ))}
                      {dayPlans.map((p) => (
                        <div key={p.id} className="text-[11px] p-1.5 rounded border-l-2 border-sky-400 bg-sky-50/50 dark:bg-sky-950/20 truncate">
                          <p className="font-medium truncate">{p.task?.title || 'Planned task'}</p>
                          {p.start_time && <p className="text-[10px] text-muted-foreground">{p.start_time}</p>}
                        </div>
                      ))}
                      {dayReminders.map((r) => (
                        <div key={r.id} className="text-[11px] p-1.5 rounded border-l-2 border-purple-400 bg-purple-50/50 dark:bg-purple-950/20 truncate">
                          <p className="font-medium truncate">{r.title}</p>
                          <p className="text-[10px] text-muted-foreground">{format(new Date(r.scheduled_for), 'h:mm a')}</p>
                        </div>
                      ))}
                      {getMbEventsForDate(day).map((e) => (
                        <div key={e.id} className="text-[11px] p-1.5 rounded border-l-2 border-blue-400 bg-blue-50/50 dark:bg-blue-950/20 truncate">
                          <p className="font-medium truncate">{e.summary || 'ManageBac entry'}</p>
                          <p className="text-[10px] text-muted-foreground">{MANAGEBAC_SOURCE_LABEL}</p>
                        </div>
                      ))}
                      {dayTasks.length === 0 && dayReminders.length === 0 && dayPlans.length === 0 && getMbEventsForDate(day).length === 0 && (
                        <p className="text-[10px] text-muted-foreground text-center py-2">—</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Agenda View */}
          {view === 'agenda' && (
            <div className="space-y-2">
              {(() => {
                const start = startOfDay(currentDate);
                const end = addDays(start, 30);
                return mbEvents
                  .filter((e) => {
                    const when = e.due_at || e.start_at;
                    if (!when) return false;
                    const at = parseISO(when);
                    return at >= start && at <= end;
                  })
                  .map((e) => (
                    <div key={e.id} className="flex items-center gap-2 p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
                      <CalendarIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{e.summary || 'ManageBac calendar entry'}</p>
                        <p className="text-xs text-muted-foreground">
                          {MANAGEBAC_SOURCE_LABEL}
                          {e.due_at ? ` \u00b7 due ${format(parseISO(e.due_at), 'd MMM')}` : ''}
                        </p>
                      </div>
                    </div>
                  ));
              })()}
              {agendaTasks.length === 0 ? (
                <Card className="p-8 text-center">
                  <CalendarIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium">No tasks scheduled for this period</p>
                  <p className="text-xs text-muted-foreground mt-1">Tasks with due dates will appear here.</p>
                </Card>
              ) : (
                agendaTasks.map((task) => (
                  <div key={task.id} className="flex gap-3">
                    <div className="flex flex-col items-center pt-2 min-w-[60px]">
                      <span className="text-xs text-muted-foreground">{format(parseISO(task.due_date!), 'EEE')}</span>
                      <span className="text-xl font-bold">{format(parseISO(task.due_date!), 'd')}</span>
                      {task.due_time && <span className="text-xs text-muted-foreground">{task.due_time}</span>}
                    </div>
                    <div className="flex-1 space-y-2">
                      <TaskCard task={task} onChanged={fetchData} />
                      <button
                        onClick={() => openForTask(task)}
                        className="w-full flex items-center gap-2 p-2.5 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20 text-left hover:bg-sky-100/60 dark:hover:bg-sky-950/40 transition-colors"
                      >
                        <GraduationCap className="w-4 h-4 text-sky-500 flex-shrink-0" />
                        <span className="text-sm font-medium truncate">{task.title}</span>
                        <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">Start study session</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        subjects={subjects}
        defaultDueDate={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined}
        onSaved={() => fetchData()}
        onCreated={onCreated}
      />

      {dialogs}

      {studyError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {studyError}
        </div>
      )}

      {studySession && (
        <StudySessionPanel
          session={studySession}
          open={!!studySession}
          onClose={closeStudySession}
        />
      )}
    </div>
  );
}
