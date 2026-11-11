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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabase/client';
import { safeHttpUrl } from '@/lib/safe-url';
import { useAuth } from '@/lib/auth-context';
import {
  Task,
  Subject,
  Priority,
  TaskStatus,
  TaskCategory,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from '@/lib/types';
import { Loader2, AlertCircle } from 'lucide-react';
import { autoPriority, matchAutoPriority } from '@/lib/auto-priority';

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  subjects: Subject[];
  defaultDueDate?: string;
  onSaved?: () => void;
  onCreated?: (task: { id: string; title: string; subject_id: string | null; due_date: string | null; due_time: string | null }) => void;
}

export function TaskDialog({
  open,
  onOpenChange,
  task,
  subjects,
  defaultDueDate,
  onSaved,
  onCreated,
}: TaskDialogProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the student picks a priority themselves, the title keywords stop changing it.
  const [priorityTouched, setPriorityTouched] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    subject_id: '',
    description: '',
    category: 'homework' as TaskCategory,
    due_date: '',
    due_time: '',
    priority: 'medium' as Priority,
    status: 'not_started' as TaskStatus,
    estimated_minutes: '',
    notes: '',
    external_link: '',
  });

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || '',
        subject_id: task.subject_id || '',
        description: task.description || '',
        category: task.category || 'homework',
        due_date: task.due_date || '',
        due_time: task.due_time || '',
        priority: task.priority || 'medium',
        status: task.status || 'not_started',
        estimated_minutes: task.estimated_minutes?.toString() || '',
        notes: task.notes || '',
        external_link: task.external_link || '',
      });
    } else {
      setFormData({
        title: '',
        subject_id: '',
        description: '',
        category: 'homework',
        due_date: defaultDueDate || '',
        due_time: '',
        priority: 'medium',
        status: 'not_started',
        estimated_minutes: '',
        notes: '',
        external_link: '',
      });
    }
    setError(null);
    setPriorityTouched(false);
  }, [task, open, defaultDueDate]);

  // New tasks only: existing tasks keep whatever priority they already have.
  const autoPriorityActive = !task && !priorityTouched;
  const autoRule = autoPriorityActive ? matchAutoPriority(formData.title) : null;

  const handleTitleChange = (title: string) => {
    setFormData((prev) => ({
      ...prev,
      title,
      priority: autoPriorityActive ? autoPriority(title) : prev.priority,
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setLoading(true);

    if (formData.external_link.trim() && !safeHttpUrl(formData.external_link)) {
      setError('Links must start with http:// or https://');
      setLoading(false);
      return;
    }

    const payload = {
      title: formData.title,
      subject_id: formData.subject_id || null,
      description: formData.description || null,
      category: formData.category,
      due_date: formData.due_date || null,
      due_time: formData.due_time || null,
      priority: formData.priority,
      status: formData.status,
      estimated_minutes: formData.estimated_minutes ? parseInt(formData.estimated_minutes) : null,
      notes: formData.notes || null,
      external_link: safeHttpUrl(formData.external_link),
    };

    let result;
    if (task) {
      result = await supabase.from('tasks').update(payload).eq('id', task.id);
    } else {
      result = await supabase
        .from('tasks')
        .insert({ ...payload, user_id: user.id })
        .select('id, title, subject_id, due_date, due_time')
        .maybeSingle();
    }

    if (result.error) {
      console.error('Failed to save task', result.error);
      setError('We could not save this task. Please check the details and try again.');
      setLoading(false);
      return;
    }

    setLoading(false);

    if (!task) {
      const created = (result.data as { id: string; title: string; subject_id: string | null; due_date: string | null; due_time: string | null } | null)
        || {
          id: '',
          title: payload.title,
          subject_id: payload.subject_id,
          due_date: payload.due_date,
          due_time: payload.due_time,
        };
      // Hand the created task to the parent before closing so the
      // "add a reminder?" prompt always opens in the same interaction.
      onCreated?.(created);
    }

    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit task' : 'New task'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">Task title *</Label>
            <Input
              id="title"
              required
              placeholder="e.g. Complete chapter 5 exercises"
              value={formData.title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Select
                value={formData.subject_id || '__none__'}
                onValueChange={(v) => setFormData({ ...formData, subject_id: v === '__none__' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No subject" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No subject</SelectItem>
                  {subjects.filter((s) => !s.is_archived).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.colour }} />
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select
                value={formData.category}
                onValueChange={(v) => setFormData({ ...formData, category: v as TaskCategory })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="due_date">Due date</Label>
              <Input
                id="due_date"
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due_time">Due time</Label>
              <Input
                id="due_time"
                type="time"
                value={formData.due_time}
                onChange={(e) => setFormData({ ...formData, due_time: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={formData.priority}
                onValueChange={(v) => {
                  setPriorityTouched(true);
                  setFormData({ ...formData, priority: v as Priority });
                }}
              >
                <SelectTrigger id="priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {autoRule && (
                <p className="text-xs text-muted-foreground">
                  Set automatically: title mentions &ldquo;{autoRule.keyword}&rdquo;
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(v) => setFormData({ ...formData, status: v as TaskStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="estimated_minutes">Estimated duration (minutes)</Label>
            <Input
              id="estimated_minutes"
              type="number"
              min="0"
              placeholder="e.g. 30"
              value={formData.estimated_minutes}
              onChange={(e) => setFormData({ ...formData, estimated_minutes: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="What needs to be done?"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Additional notes..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="external_link">Link (optional)</Label>
            <Input
              id="external_link"
              type="url"
              placeholder="https://..."
              value={formData.external_link}
              onChange={(e) => setFormData({ ...formData, external_link: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {task ? 'Save changes' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
