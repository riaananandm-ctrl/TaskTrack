'use client';

import { useState, useEffect, FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import {
  Reminder,
  Task,
  ReminderType,
  RepeatRule,
  REMINDER_TYPE_LABELS,
  REPEAT_LABELS,
} from '@/lib/types';
import { Loader2, AlertCircle, Plus, X, Bell, CalendarClock } from 'lucide-react';
import { format } from 'date-fns';
import {
  ReminderTimeSuggestion,
  validateReminderTime,
  suggestReminderTimes,
} from '@/lib/reminder-utils';

const NO_TASK = '__none__';

export interface ReminderPrefill {
  title: string;
  taskId?: string | null;
  subjectName?: string | null;
  dueDate?: string | null;
  suggestions?: ReminderTimeSuggestion[];
}

interface ReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reminder?: Reminder | null;
  tasks: Task[];
  prefill?: ReminderPrefill | null;
  onSaved?: () => void;
}

export function ReminderDialog({
  open,
  onOpenChange,
  reminder,
  tasks,
  prefill,
  onSaved,
}: ReminderDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    task_id: '',
    reminder_type: 'task_due' as ReminderType,
    date: '',
    time: '08:00',
    repeat_rule: 'none' as RepeatRule,
    is_enabled: true,
  });
  const [suggestions, setSuggestions] = useState<ReminderTimeSuggestion[]>([]);

  const isSuggestMode = !!prefill && !reminder;

  useEffect(() => {
    if (!open) return;

    if (reminder) {
      const dt = new Date(reminder.scheduled_for);
      setFormData({
        title: reminder.title,
        message: reminder.message || '',
        task_id: reminder.task_id || '',
        reminder_type: reminder.reminder_type,
        date: format(dt, 'yyyy-MM-dd'),
        time: format(dt, 'HH:mm'),
        repeat_rule: reminder.repeat_rule,
        is_enabled: reminder.is_enabled,
      });
      setSuggestions([]);
    } else if (prefill) {
      const subjectLine = prefill.subjectName ? `Subject: ${prefill.subjectName}` : '';
      setFormData({
        title: prefill.title,
        message: subjectLine,
        task_id: prefill.taskId || '',
        reminder_type: 'task_due',
        date: prefill.dueDate || format(new Date(), 'yyyy-MM-dd'),
        time: '08:00',
        repeat_rule: 'none',
        is_enabled: true,
      });
      setSuggestions(prefill.suggestions || []);
    } else {
      setFormData({
        title: '', message: '', task_id: '', reminder_type: 'task_due',
        date: format(new Date(), 'yyyy-MM-dd'), time: '08:00',
        repeat_rule: 'none', is_enabled: true,
      });
      setSuggestions([]);
    }
    setError(null);
    setFieldErrors({});
  }, [reminder, prefill, open]);

  const updateSuggestion = (index: number, patch: Partial<ReminderTimeSuggestion>) => {
    setSuggestions((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    setFieldErrors((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const removeSuggestion = (index: number) => {
    setSuggestions((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors({});
  };

  const addSuggestion = () => {
    const next = suggestReminderTimes(
      prefill?.dueDate || formData.date || null,
      '23:59',
      1,
      new Date()
    )[0];
    setSuggestions((prev) => [...prev, next]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);

    if (isSuggestMode) {
      if (suggestions.length === 0) {
        setError('Add at least one reminder.');
        return;
      }
      const errors: Record<number, string> = {};
      suggestions.forEach((s, i) => {
        const msg = validateReminderTime(s.date, s.time);
        if (msg) errors[i] = msg;
      });
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setError('Some reminder times are in the past. Adjust them before saving.');
        return;
      }

      setLoading(true);
      const payloads = suggestions.map((s) => ({
        user_id: user.id,
        title: formData.title,
        message: formData.message || null,
        task_id: formData.task_id || null,
        reminder_type: formData.reminder_type,
        scheduled_for: new Date(`${s.date}T${s.time}`).toISOString(),
        repeat_rule: formData.repeat_rule,
        is_enabled: formData.is_enabled,
        is_read: false,
      }));

      const { error: insertError } = await supabase.from('reminders').insert(payloads);
      setLoading(false);
      if (insertError) {
        setError(insertError.message);
        return;
      }
      onOpenChange(false);
      onSaved?.();
      return;
    }

    const timeError = validateReminderTime(formData.date, formData.time);
    if (timeError) {
      setError(timeError);
      return;
    }

    setLoading(true);
    const scheduledFor = new Date(`${formData.date}T${formData.time}`).toISOString();

    const payload = {
      title: formData.title,
      message: formData.message || null,
      task_id: formData.task_id || null,
      reminder_type: formData.reminder_type,
      scheduled_for: scheduledFor,
      repeat_rule: formData.repeat_rule,
      is_enabled: formData.is_enabled,
      is_read: false,
    };

    let result;
    if (reminder) {
      result = await supabase.from('reminders').update(payload).eq('id', reminder.id);
    } else {
      result = await supabase.from('reminders').insert({ ...payload, user_id: user.id });
    }

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {reminder ? 'Edit reminder' : isSuggestMode ? 'Add reminders for this task' : 'New reminder'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reminder-title">Title *</Label>
            <Input id="reminder-title" required placeholder="e.g. Science homework due tomorrow" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
          </div>

          {!isSuggestMode && (
            <div className="space-y-2">
              <Label htmlFor="reminder-message">Message (optional)</Label>
              <Textarea id="reminder-message" placeholder="Reminder details..." value={formData.message} onChange={(e) => setFormData({ ...formData, message: e.target.value })} rows={2} />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reminder-task">Connected task (optional)</Label>
            <Select value={formData.task_id || NO_TASK} onValueChange={(v) => setFormData({ ...formData, task_id: v === NO_TASK ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="No connected task" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TASK}>No connected task</SelectItem>
                {tasks.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reminder-type">Reminder type</Label>
            <Select value={formData.reminder_type} onValueChange={(v) => setFormData({ ...formData, reminder_type: v as ReminderType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(REMINDER_TYPE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {isSuggestMode ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" />
                <Label>Suggested times</Label>
                <span className="text-xs text-muted-foreground">({suggestions.length})</span>
              </div>
              {suggestions.length === 0 && (
                <p className="text-xs text-muted-foreground">No reminders yet — add one below.</p>
              )}
              {suggestions.map((s, i) => (
                <div key={i} className="space-y-1.5 p-2.5 rounded-lg border border-border bg-card">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <Input
                      type="date"
                      value={s.date}
                      onChange={(e) => updateSuggestion(i, { date: e.target.value })}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="time"
                      value={s.time}
                      onChange={(e) => updateSuggestion(i, { time: e.target.value })}
                      className="h-8 text-xs w-[110px]"
                    />
                    <button
                      type="button"
                      onClick={() => removeSuggestion(i)}
                      className="p-1 rounded hover:bg-accent flex-shrink-0"
                      aria-label="Remove reminder"
                    >
                      <X className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  </div>
                  {fieldErrors[i] && (
                    <p className="text-[11px] text-destructive pl-5">{fieldErrors[i]}</p>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addSuggestion} className="w-full">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add another reminder
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="reminder-date">Date *</Label>
                  <Input id="reminder-date" type="date" required value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reminder-time">Time *</Label>
                  <Input id="reminder-time" type="time" required value={formData.time} onChange={(e) => setFormData({ ...formData, time: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reminder-repeat">Repeat</Label>
                <Select value={formData.repeat_rule} onValueChange={(v) => setFormData({ ...formData, repeat_rule: v as RepeatRule })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(REPEAT_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <Label htmlFor="reminder-enabled">Enabled</Label>
            <Switch checked={formData.is_enabled} onCheckedChange={(v) => setFormData({ ...formData, is_enabled: v })} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {reminder ? 'Save changes' : isSuggestMode ? `Add ${suggestions.length} reminder${suggestions.length !== 1 ? 's' : ''}` : 'Create reminder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
