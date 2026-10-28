'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Task, WeeklyPlan } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  ChevronLeft, ChevronRight, Plus, Clock, AlertTriangle, Trash2, Calendar as CalendarIcon, X, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  format, startOfWeek, addDays, isSameDay, parseISO, differenceInCalendarDays,
} from 'date-fns';
import { TaskDialog } from '@/components/task-dialog';
import { TaskCard } from '@/components/task-card';
import { useReminderPrompt } from '@/components/reminder-prompt';
import { StudySessionPanel } from '@/components/study-session-panel';
import { useStudySessionOpener } from '@/hooks/use-study-session';
import { combineDateTime } from '@/lib/reminder-utils';
import { completeStudySessionsForTask } from '@/lib/study-schedule';
import { getDeadlineStatus } from '@/lib/deadline-status';
import { GraduationCap } from 'lucide-react';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_DAILY_MINUTES = 360; // 6 hours default available time

export default function PlanningPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plans, setPlans] = useState<WeeklyPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planTaskId, setPlanTaskId] = useState<string>('');
  const [planDate, setPlanDate] = useState<string>('');
  const [planStartTime, setPlanStartTime] = useState('15:00');
  const [planDuration, setPlanDuration] = useState('30');
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<WeeklyPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const { session: studySession, openForTask, close: closeStudySession, error: studyError } = useStudySessionOpener();

  const { onCreated, dialogs } = useReminderPrompt({ subjects: [], tasks });

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [tasksRes, plansRes] = await Promise.all([
      supabase.from('tasks').select('*, subject:subjects(*)').eq('is_archived', false).order('due_date', { nullsFirst: false }),
      supabase.from('weekly_plans').select('*, task:tasks(*, subject:subjects(*))').order('planned_date'),
    ]);
    setTasks((tasksRes.data as unknown as Task[]) || []);
    setPlans((plansRes.data as unknown as WeeklyPlan[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = weekDays[6];

  const weekPlans = plans.filter((p) => {
    const d = parseISO(p.planned_date);
    return d >= weekStart && d <= weekEnd;
  });

  const unplannedTasks = tasks.filter((t) =>
    getDeadlineStatus(t) !== 'completed' &&
    !plans.some((p) => p.task_id === t.id)
  );

  const getPlansForDay = (day: Date) => {
    return weekPlans.filter((p) => isSameDay(parseISO(p.planned_date), day));
  };

  const getDayMinutes = (day: Date) => {
    return getPlansForDay(day).reduce((total, plan) => {
      if (plan.start_time && plan.end_time) {
        const [sh, sm] = plan.start_time.split(':').map(Number);
        const [eh, em] = plan.end_time.split(':').map(Number);
        return total + (eh * 60 + em) - (sh * 60 + sm);
      }
      return total + (plan.task?.estimated_minutes || 30);
    }, 0);
  };

  const totalWeekMinutes = weekDays.reduce((total, day) => total + getDayMinutes(day), 0);

  const handleOpenPlan = (taskId: string, date?: string) => {
    setEditingPlan(null);
    setPlanTaskId(taskId);
    setPlanDate(date || format(weekStart, 'yyyy-MM-dd'));
    setPlanStartTime('15:00');
    setPlanDuration('30');
    setPlanError(null);
    setPlanDialogOpen(true);
  };

  const handleEditPlan = (plan: WeeklyPlan) => {
    setEditingPlan(plan);
    setPlanTaskId(plan.task_id);
    setPlanDate(plan.planned_date);
    setPlanStartTime(plan.start_time || '15:00');
    if (plan.start_time && plan.end_time) {
      const [sh, sm] = plan.start_time.split(':').map(Number);
      const [eh, em] = plan.end_time.split(':').map(Number);
      setPlanDuration(String((eh * 60 + em) - (sh * 60 + sm)));
    } else {
      setPlanDuration('30');
    }
    setPlanError(null);
    setPlanDialogOpen(true);
  };

  const handleSavePlan = async () => {
    if (!user || !planTaskId || !planDate) return;
    setPlanError(null);

    const startAt = combineDateTime(planDate, planStartTime);
    if (!startAt) {
      setPlanError('Please choose a valid study session date and time.');
      return;
    }
    if (startAt.getTime() <= Date.now()) {
      setPlanError('Study session time must be in the future. Please choose a later date or time.');
      return;
    }

    const [h, m] = planStartTime.split(':').map(Number);
    const startTotal = h * 60 + m;
    const endTotal = startTotal + parseInt(planDuration);
    const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;

    if (editingPlan) {
      await supabase.from('weekly_plans').update({
        planned_date: planDate,
        start_time: planStartTime,
        end_time: endTime,
      }).eq('id', editingPlan.id);
    } else {
      await supabase.from('weekly_plans').insert({
        user_id: user.id,
        task_id: planTaskId,
        planned_date: planDate,
        start_time: planStartTime,
        end_time: endTime,
      });
    }
    setPlanDialogOpen(false);
    fetchData();
  };

  const removePlan = async (planId: string) => {
    await supabase.from('weekly_plans').delete().eq('id', planId);
    fetchData();
  };

  const movePlan = async (plan: WeeklyPlan, newDate: string) => {
    await supabase.from('weekly_plans').update({ planned_date: newDate }).eq('id', plan.id);
    fetchData();
  };

  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  const completeTask = async (taskId: string) => {
    if (completingTaskId) return;
    setCompletingTaskId(taskId);
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'completed' as const, completed_at: new Date().toISOString() } : t));
    try {
      const { error } = await supabase.from('tasks').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', taskId);
      if (error) throw error;
      await completeStudySessionsForTask(taskId);
      fetchData();
    } catch {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: t.status === 'completed' ? 'not_started' as const : t.status, completed_at: null } : t));
    } finally {
      setCompletingTaskId(null);
    }
  };

  const navigateWeek = (direction: number) => {
    setWeekStart((prev) => addDays(prev, direction * 7));
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plan My Week</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')} · {Math.floor(totalWeekMinutes / 60)}h {totalWeekMinutes % 60}m total
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => navigateWeek(-1)}><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>This week</Button>
          <Button variant="outline" size="icon" onClick={() => navigateWeek(1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground">Loading your plan...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Week columns */}
          <div className="lg:col-span-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
              {weekDays.map((day, i) => {
                const dayPlans = getPlansForDay(day);
                const dayMinutes = getDayMinutes(day);
                const isOverloaded = dayMinutes > MAX_DAILY_MINUTES;
                const isToday = isSameDay(day, new Date());

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'rounded-lg border p-2 min-h-[200px]',
                      isToday ? 'border-primary border-2' : 'border-border',
                      isOverloaded && 'border-red-300 dark:border-red-900'
                    )}
                  >
                    <div className="text-center mb-2 pb-2 border-b border-border">
                      <p className="text-xs text-muted-foreground">{DAY_SHORT[i]}</p>
                      <p className={cn('text-lg font-bold', isToday && 'text-primary')}>{format(day, 'd')}</p>
                      {dayMinutes > 0 && (
                        <p className={cn('text-[10px] mt-0.5', isOverloaded ? 'text-red-600 font-medium' : 'text-muted-foreground')}>
                          {Math.floor(dayMinutes / 60)}h {dayMinutes % 60}m
                        </p>
                      )}
                    </div>

                    {isOverloaded && (
                      <div className="flex items-center gap-1 text-[10px] text-red-600 mb-1 px-1">
                        <AlertTriangle className="w-3 h-3" />
                        Overloaded
                      </div>
                    )}

                    <div className="space-y-1.5">
                      {dayPlans.map((plan) => (
                        <div
                          key={plan.id}
                          className="group relative p-2 rounded border-l-2 bg-card hover:shadow-soft transition-all"
                          style={{ borderLeftColor: plan.task?.subject?.colour || '#2563EB' }}
                        >
                          <p className="text-xs font-medium truncate">{plan.task?.title || 'Task'}</p>
                          {plan.start_time && (
                            <p className="text-[10px] text-muted-foreground">{plan.start_time}{plan.end_time && ` – ${plan.end_time}`}</p>
                          )}
                          {plan.task && (
                            <button
                              onClick={() => openForTask(plan.task!)}
                              className="flex items-center gap-1 mt-1 text-[10px] text-sky-600 dark:text-sky-400 hover:underline"
                            >
                              <GraduationCap className="w-3 h-3" /> Study session
                            </button>
                          )}
                          <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleEditPlan(plan)}
                              className="p-0.5 rounded hover:bg-accent"
                              aria-label="Edit plan"
                            >
                              <Clock className="w-3 h-3 text-muted-foreground" />
                            </button>
                            <button
                              type="button"
                              onClick={() => completePlan(plan)}
                              disabled={completingTaskId === plan.task_id}
                              className="p-0.5 rounded hover:bg-accent disabled:opacity-50"
                              aria-label="Complete task"
                            >
                              <CheckCircle2 className="w-3 h-3 text-green-500" />
                            </button>
                            <button
                              onClick={() => removePlan(plan.id)}
                              className="p-0.5 rounded hover:bg-accent"
                              aria-label="Remove from plan"
                            >
                              <X className="w-3 h-3 text-destructive" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {dayPlans.length === 0 && (
                        <button
                          onClick={() => handleOpenPlan('', format(day, 'yyyy-MM-dd'))}
                          className="w-full py-2 text-[10px] text-muted-foreground hover:text-primary hover:bg-accent/50 rounded transition-colors"
                        >
                          + Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {weekPlans.length === 0 && (
              <Card className="p-8 text-center mt-4">
                <CalendarIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium">You have no planned tasks this week.</p>
                <p className="text-xs text-muted-foreground mt-1">Add tasks from the unplanned list to start planning.</p>
              </Card>
            )}
          </div>

          {/* Unplanned tasks */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Unplanned tasks</h2>
              <Button size="sm" variant="outline" onClick={() => setTaskDialogOpen(true)}>
                <Plus className="w-3 h-3 mr-1" /> New
              </Button>
            </div>
            {unplannedTasks.length === 0 ? (
              <Card className="p-4 text-center">
                <CheckCircle2 className="w-6 h-6 text-green-500 mx-auto mb-1" />
                <p className="text-xs text-muted-foreground">All tasks are planned!</p>
              </Card>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {unplannedTasks.map((task) => (
                  <Card key={task.id} className="p-3 group">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {task.due_date && (
                        <span className="text-[10px] text-muted-foreground">
                          Due {format(parseISO(task.due_date), 'MMM d')}
                        </span>
                      )}
                      {task.estimated_minutes && (
                        <span className="text-[10px] text-muted-foreground">{task.estimated_minutes}m</span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full mt-2 h-7 text-xs"
                      onClick={() => handleOpenPlan(task.id, format(weekStart, 'yyyy-MM-dd'))}
                    >
                      <Plus className="w-3 h-3 mr-1" /> Plan this task
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Plan dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPlan ? 'Edit plan' : 'Plan a task'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {planError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {planError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="plan_task">Task *</Label>
              <Select value={planTaskId} onValueChange={setPlanTaskId} disabled={!!editingPlan}>
                <SelectTrigger><SelectValue placeholder="Select a task" /></SelectTrigger>
                <SelectContent>
                  {tasks.filter((t) => getDeadlineStatus(t) !== 'completed').map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="plan_date">Day</Label>
                <Select value={planDate} onValueChange={setPlanDate}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {weekDays.map((day, i) => (
                      <SelectItem key={i} value={format(day, 'yyyy-MM-dd')}>
                        {DAY_NAMES[i]} ({format(day, 'MMM d')})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan_start">Start time</Label>
                <Input id="plan_start" type="time" value={planStartTime} onChange={(e) => setPlanStartTime(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan_duration">Duration (minutes)</Label>
              <Select value={planDuration} onValueChange={setPlanDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                    <SelectItem key={m} value={String(m)}>{m} min ({Math.floor(m / 60)}h {m % 60}m)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePlan} disabled={!planTaskId || !planDate}>
              {editingPlan ? 'Save changes' : 'Add to plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        subjects={[]}
        onSaved={fetchData}
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

  function completePlan(plan: WeeklyPlan) {
    if (plan.task_id) completeTask(plan.task_id);
  }
}
