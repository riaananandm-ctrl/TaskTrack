'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Reminder, Task, UserSettings, REMINDER_TYPE_LABELS, REPEAT_LABELS } from '@/lib/types';
import { SNOOZE_OPTIONS, snoozeTime } from '@/lib/reminder-utils';
import { ReminderDialog } from '@/components/reminder-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Bell, Plus, Clock, CheckCheck, Trash2, Pencil, BellOff, AlertCircle, Loader2, Settings as SettingsIcon, Sparkles, AlarmClock,
} from 'lucide-react';
import { format, isPast, isToday, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { StudySessionPanel } from '@/components/study-session-panel';
import { useStudySessionOpener } from '@/hooks/use-study-session';

export default function NotificationsPage() {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('upcoming');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snoozeOpenId, setSnoozeOpenId] = useState<string | null>(null);
  const { session: studySession, openForTask, close: closeStudySession, error: studyError } = useStudySessionOpener();

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [remindersRes, tasksRes, settingsRes] = await Promise.all([
      supabase.from('reminders').select('*, task:tasks(*)').order('scheduled_for'),
      supabase.from('tasks').select('*').eq('is_archived', false).order('title'),
      supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
    ]);
    setReminders((remindersRes.data as unknown as Reminder[]) || []);
    setTasks((tasksRes.data as Task[]) || []);
    setSettings(settingsRes.data as UserSettings | null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // A scheduled study session or reminder is upcoming while its time is still ahead.
  // Past items fall to Overdue, which is why the two filters share one time boundary.
  const upcoming = reminders.filter((r) => new Date(r.scheduled_for).getTime() >= Date.now());
  const unread = reminders.filter((r) => !r.is_read && r.is_enabled);
  const read = reminders.filter((r) => r.is_read);
  const overdueReminders = reminders.filter(
    (r) => r.is_enabled && new Date(r.scheduled_for).getTime() < Date.now()
  );

  const filteredReminders = (() => {
    switch (tab) {
      case 'upcoming': return upcoming;
      case 'unread': return unread;
      case 'read': return read;
      case 'overdue': return overdueReminders;
      default: return reminders;
    }
  })();

  const markAsRead = async (id: string) => {
    await supabase.from('reminders').update({ is_read: true }).eq('id', id);
    fetchData();
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase.from('reminders').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    fetchData();
  };

  const toggleEnabled = async (reminder: Reminder) => {
    await supabase.from('reminders').update({ is_enabled: !reminder.is_enabled }).eq('id', reminder.id);
    fetchData();
  };

  const [snoozingId, setSnoozingId] = useState<string | null>(null);

  /**
   * Snooze moves the reminder into the future and clears the push claim so the
   * notification sweep can pick it up again at the new time. In-app sound and
   * read state are left untouched: snoozing is not dismissing.
   */
  const snoozeReminder = async (reminder: Reminder, minutes: number) => {
    const next = snoozeTime(minutes);
    if (!next || snoozingId) return;
    setSnoozingId(reminder.id);
    const { error } = await supabase
      .from('reminders')
      .update({
        scheduled_for: next.toISOString(),
        push_sent_at: null,
        push_claimed_at: null,
        push_attempts: 0,
      })
      .eq('id', reminder.id);
    setSnoozingId(null);
    if (!error) fetchData();
  };

  const deleteReminder = async (id: string) => {
    await supabase.from('reminders').delete().eq('id', id);
    fetchData();
  };

  const handleEdit = (reminder: Reminder) => {
    setEditingReminder(reminder);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingReminder(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {unread.length} unread · {upcoming.length} upcoming
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon className="w-4 h-4 mr-1" /> Preferences
          </Button>
          <Button onClick={handleNew} size="lg">
            <Plus className="w-4 h-4 mr-1" /> New reminder
          </Button>
        </div>
      </div>

      {/* Quick actions */}
      {unread.length > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={markAllRead}>
            <CheckCheck className="w-3.5 h-3.5 mr-1" /> Mark all as read
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="unread">Unread ({unread.length})</TabsTrigger>
          <TabsTrigger value="overdue">Overdue ({overdueReminders.length})</TabsTrigger>
          <TabsTrigger value="read">History ({read.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground">Loading reminders...</div>
      ) : filteredReminders.length === 0 ? (
        <Card className="p-8 text-center">
          <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">
            {tab === 'upcoming' && 'No upcoming reminders.'}
            {tab === 'unread' && 'No unread notifications.'}
            {tab === 'overdue' && 'No overdue reminders.'}
            {tab === 'read' && 'No notification history yet.'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {tab === 'upcoming' && 'Create a reminder to get notified about tasks.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredReminders.map((reminder) => {
            const isOverdueItem = isPast(new Date(reminder.scheduled_for)) && !isToday(new Date(reminder.scheduled_for));
            // Scheduled study sessions are ordinary reminders with their own type, so they
            // reuse this card and gain a few fields that only matter for a study sitting.
            const isStudySession = reminder.reminder_type === 'study_session';
            const sessionStatus = !reminder.is_enabled
              ? 'Completed'
              : new Date(reminder.scheduled_for).getTime() < Date.now()
                ? 'Overdue'
                : 'Scheduled';
            return (
              <Card
                key={reminder.id}
                className={cn(
                  'p-4 transition-all',
                  !reminder.is_read && reminder.is_enabled && 'border-l-4 border-l-primary',
                  isOverdueItem && reminder.is_enabled && 'border-l-4 border-l-red-500',
                  !reminder.is_enabled && 'opacity-60'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                    isOverdueItem ? 'bg-red-50 dark:bg-red-950/30' : 'bg-blue-50 dark:bg-blue-950/30'
                  )}>
                    {isOverdueItem ? <AlertCircle className="w-4 h-4 text-red-500" /> : <Bell className="w-4 h-4 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {isStudySession ? reminder.task?.title || reminder.title : reminder.title}
                        </p>
                        {reminder.message && (
                          <p className="text-xs text-muted-foreground mt-0.5">{reminder.message}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(reminder.scheduled_for), 'EEE, MMM d, h:mm a')}
                          </span>
                          {isStudySession && reminder.task?.estimated_minutes ? (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {reminder.task.estimated_minutes} min
                            </span>
                          ) : null}
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {isStudySession ? sessionStatus : REMINDER_TYPE_LABELS[reminder.reminder_type]}
                          </span>
                          {!isStudySession && reminder.repeat_rule !== 'none' && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {REPEAT_LABELS[reminder.repeat_rule]}
                            </span>
                          )}
                          {!isStudySession && reminder.task && (
                            <span className="text-xs text-primary">→ {reminder.task.title}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {!reminder.is_read && reminder.is_enabled && (
                          <button onClick={() => markAsRead(reminder.id)} className="tap-target p-1.5 rounded hover:bg-accent" aria-label="Mark as read">
                            <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                        )}
                        {!isStudySession && reminder.is_enabled && (
                          <div className="relative">
                            <button
                              onClick={() => setSnoozeOpenId(snoozeOpenId === reminder.id ? null : reminder.id)}
                              className="tap-target p-1.5 rounded hover:bg-accent"
                              aria-label="Snooze reminder"
                              aria-expanded={snoozeOpenId === reminder.id}
                              disabled={snoozingId !== null}
                            >
                              <AlarmClock className={cn('w-3.5 h-3.5 text-muted-foreground', snoozingId === reminder.id && 'animate-pulse')} />
                            </button>
                            {snoozeOpenId === reminder.id && (
                              <div className="absolute right-0 top-8 z-10 w-36 rounded-lg border border-border bg-popover shadow-lg py-1 animate-scale-in">
                                {SNOOZE_OPTIONS.map((option) => (
                                  <button
                                    key={option.minutes}
                                    onClick={() => {
                                      setSnoozeOpenId(null);
                                      snoozeReminder(reminder, option.minutes);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <button onClick={() => toggleEnabled(reminder)} className="tap-target p-1.5 rounded hover:bg-accent" aria-label="Toggle reminder">
                          {reminder.is_enabled ? <Bell className="w-3.5 h-3.5 text-primary" /> : <BellOff className="w-3.5 h-3.5 text-muted-foreground" />}
                        </button>
                        <button onClick={() => handleEdit(reminder)} className="tap-target p-1.5 rounded hover:bg-accent" aria-label="Edit reminder">
                          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <button onClick={() => deleteReminder(reminder.id)} className="tap-target p-1.5 rounded hover:bg-accent" aria-label="Delete reminder">
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      </div>
                    </div>
                    {reminder.task && (
                      <button
                        onClick={() => openForTask(reminder.task ?? { title: reminder.title })}
                        className="mt-2 flex items-center gap-1 text-xs text-navy-600 hover:text-navy-700 font-medium transition-colors"
                      >
                        <Sparkles className="w-3 h-3" />
                        {isStudySession ? 'Open Study Session' : 'Create Study Session'}
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ReminderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reminder={editingReminder}
        tasks={tasks}
        onSaved={fetchData}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSaved={fetchData}
      />

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

function SettingsDialog({
  open, onOpenChange, settings, onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: UserSettings | null;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    task_reminders_enabled: true,
    overdue_reminders_enabled: true,
    daily_summary_enabled: false,
    weekly_summary_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    preferred_reminder_time: '08:00',
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        task_reminders_enabled: settings.task_reminders_enabled,
        overdue_reminders_enabled: settings.overdue_reminders_enabled,
        daily_summary_enabled: settings.daily_summary_enabled,
        weekly_summary_enabled: settings.weekly_summary_enabled,
        quiet_hours_start: settings.quiet_hours_start,
        quiet_hours_end: settings.quiet_hours_end,
        preferred_reminder_time: settings.preferred_reminder_time,
      });
    }
  }, [settings, open]);

  const handleSave = async () => {
    if (!user) return;
    setLoading(true);
    await supabase.from('user_settings').upsert({ ...formData, user_id: user.id }, { onConflict: 'user_id' });
    setLoading(false);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Notification preferences</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {[
            { key: 'task_reminders_enabled', label: 'Task reminders', desc: 'Get reminded when tasks are due' },
            { key: 'overdue_reminders_enabled', label: 'Overdue reminders', desc: 'Get notified about overdue tasks' },
            { key: 'daily_summary_enabled', label: 'Daily summary', desc: 'A daily overview of what is due' },
            { key: 'weekly_summary_enabled', label: 'Weekly summary', desc: 'A weekly planning reminder' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between p-3 rounded-lg border border-border">
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <Switch
                checked={formData[item.key as keyof typeof formData] as boolean}
                onCheckedChange={(v) => setFormData({ ...formData, [item.key]: v })}
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="quiet_start">Quiet hours start</Label>
              <Input id="quiet_start" type="time" value={formData.quiet_hours_start} onChange={(e) => setFormData({ ...formData, quiet_hours_start: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quiet_end">Quiet hours end</Label>
              <Input id="quiet_end" type="time" value={formData.quiet_hours_end} onChange={(e) => setFormData({ ...formData, quiet_hours_end: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="preferred_time">Default reminder time</Label>
            <Input id="preferred_time" type="time" value={formData.preferred_reminder_time} onChange={(e) => setFormData({ ...formData, preferred_reminder_time: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save preferences
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
