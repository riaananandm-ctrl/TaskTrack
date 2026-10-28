'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles, Plus, Search, Play, Pencil, Archive, Trash2, ArchiveRestore,
  MoreVertical, Loader2, BookOpen, Clock, CheckCircle2, Layers, CalendarDays,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { StudySessionPanel } from '@/components/study-session-panel';
import {
  listSessions, createSession, createSessionForSubject, renameSession,
  setSessionStatus, deleteSession, findActiveSessionForTask,
  type StudySession, type SessionStatus,
} from '@/lib/study-sessions';
import { format, parseISO, isValid } from 'date-fns';
import { CATEGORY_LABELS, type TaskCategory } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Filter = 'all' | 'active' | 'completed' | 'archived';
type GroupBy = 'recent' | 'task' | 'subject';

interface TaskOption {
  id: string;
  title: string;
  subject?: { name: string } | null;
}

export default function StudySessionsPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('recent');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<StudySession | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<StudySession | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<StudySession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listSessions();
      setSessions(rows);
      setLoadError(null);
    } catch {
      setLoadError('Your study sessions could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openPicker = async () => {
    setPickerOpen(true);
    setError(null);
    if (tasks.length > 0) return;
    setTasksLoading(true);
    const { data } = await supabase
      .from('tasks')
      .select('id, title, subject:subjects(name)')
      .eq('is_archived', false)
      .order('title');
    setTasks((data ?? []) as unknown as TaskOption[]);
    setTasksLoading(false);
  };

  const startForTask = async (task: TaskOption | null) => {
    if (!user) return;
    setStarting(true);
    setError(null);
    try {
      const session = task
        ? await createSession({ id: task.id, title: task.title })
        : await createSessionForSubject('General study session');
      setPickerOpen(false);
      await load();
      setActive(session);
    } catch {
      setError('A new session could not be started. Please try again.');
    } finally {
      setStarting(false);
    }
  };

  /** Continue the task's active session, or start one if none exists yet. */
  const continueTask = async (taskId: string, fallbackTitle: string) => {
    setError(null);
    try {
      const existing = await findActiveSessionForTask(taskId);
      if (existing) {
        setActive(existing);
        return;
      }
      const session = await createSession({ id: taskId, title: fallbackTitle });
      await load();
      setActive(session);
    } catch {
      setError('That session could not be opened. Please try again.');
    }
  };

  const startNewForSession = async (session: StudySession) => {
    setError(null);
    try {
      const created = session.task_id
        ? await createSession({ id: session.task_id, title: session.task?.title || session.title })
        : await createSessionForSubject(session.title);
      await load();
      setActive(created);
    } catch {
      setError('A new session could not be started. Please try again.');
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await renameSession(renameTarget.id, renameValue.trim());
      setRenameTarget(null);
      await load();
    } catch {
      setError('The session could not be renamed. Please try again.');
    }
  };

  const handleStatus = async (session: StudySession, status: SessionStatus) => {
    try {
      await setSessionStatus(session.id, status);
      await load();
    } catch {
      setError('The session status could not be updated. Please try again.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSession(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch {
      setError('The session could not be deleted. Please try again.');
    }
  };

  const counts = useMemo(() => ({
    all: sessions.length,
    active: sessions.filter((s) => s.status === 'active').length,
    completed: sessions.filter((s) => s.status === 'completed').length,
    archived: sessions.filter((s) => s.status === 'archived').length,
  }), [sessions]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sessions.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (!term) return true;
      return (
        s.title.toLowerCase().includes(term) ||
        (s.task?.subject?.name ?? '').toLowerCase().includes(term) ||
        (s.task?.description ?? '').toLowerCase().includes(term)
      );
    });
  }, [sessions, filter, search]);

  const groups = useMemo(() => {
    if (groupBy === 'recent') return [{ key: 'recent', label: null, items: visible }];
    const map = new Map<string, StudySession[]>();
    visible.forEach((s) => {
      const key = groupBy === 'task'
        ? (s.task?.title || 'No linked task')
        : (s.task?.subject?.name || 'General');
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, items]) => ({ key, label: key, items }));
  }, [visible, groupBy]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Study Sessions</h1>
          <p className="text-muted-foreground mt-1">
            Every conversation is saved, so you can pick up where you left off.
          </p>
        </div>
        <Button onClick={openPicker} className="gap-2">
          <Plus className="w-4 h-4" /> New Session
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">Recent ({counts.all})</TabsTrigger>
            <TabsTrigger value="active">Active ({counts.active})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({counts.completed})</TabsTrigger>
            <TabsTrigger value="archived">Archived ({counts.archived})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex-1 flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sessions..."
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-card">
            {([
              { id: 'recent', label: 'Recent' },
              { id: 'task', label: 'By task' },
              { id: 'subject', label: 'By subject' },
            ] as const).map((option) => (
              <button
                key={option.id}
                onClick={() => setGroupBy(option.id)}
                className={cn(
                  'text-xs px-2.5 py-1.5 rounded-md font-medium transition-colors',
                  groupBy === option.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="flex items-center justify-center rounded-xl bg-white p-2 shadow-soft dark:bg-slate-800">
            <Logo size={36} showText={false} />
          </div>
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button variant="outline" className="mt-4" onClick={() => { setLoading(true); load(); }}>
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mx-auto mb-4">
            <Logo size={32} showText={false} />
          </div>
          <h3 className="font-semibold">No study sessions yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            {search || filter !== 'all'
              ? 'No sessions match this filter or search.'
              : 'Start a session from any task to begin studying with TaskTrack.'}
          </p>
          <Button onClick={openPicker} className="mt-5 gap-2">
            <Plus className="w-4 h-4" /> Start Study Session
          </Button>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.key} className="space-y-3">
              {group.label !== null && (
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{group.label}</h2>
                  <span className="text-xs text-muted-foreground">({group.items.length})</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {group.items.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onOpen={() => setActive(s)}
                    onRename={() => { setRenameTarget(s); setRenameValue(s.title); }}
                    onStatus={handleStatus}
                    onDelete={() => setDeleteTarget(s)}
                    onNewForTask={() => startNewForSession(s)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (
        <StudySessionPanel
          session={active}
          open={!!active}
          onClose={() => setActive(null)}
          onActivity={load}
          onStatusChange={(updated) => {
            setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            setActive(updated);
          }}
          onNewSession={() => startNewForSession(active)}
        />
      )}

      {/* Task picker */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Start a study session</DialogTitle>
            <DialogDescription>
              Pick a task and I&rsquo;ll use its subject, description, due date and duration
              automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              onClick={() => startForTask(null)}
              disabled={starting}
              className="w-full text-left p-3 rounded-lg border border-border bg-card hover:border-primary/40 transition-colors disabled:opacity-50"
            >
              <p className="text-sm font-medium">General session</p>
              <p className="text-xs text-muted-foreground">No specific task — just ask me anything</p>
            </button>

            {tasksLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                You have no tasks yet. Create a task first, or start a general session.
              </p>
            ) : (
              tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => startForTask(t)}
                  disabled={starting}
                  className="w-full text-left p-3 rounded-lg border border-border bg-card hover:border-primary/40 transition-colors disabled:opacity-50"
                >
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.subject?.name || 'No subject'}</p>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Session name"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete session</DialogTitle>
            <DialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; and all of its messages will be permanently
              removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionCard({
  session, onOpen, onRename, onStatus, onDelete, onNewForTask,
}: {
  session: StudySession;
  onOpen: () => void;
  onRename: () => void;
  onStatus: (session: StudySession, status: SessionStatus) => void;
  onDelete: () => void;
  onNewForTask: () => void;
}) {
  const task = session.task;
  const updated = parseISO(session.updated_at);
  const updatedLabel = isValid(updated) ? format(updated, 'd MMM, HH:mm') : '';
  const due = task?.due_date ? parseISO(task.due_date) : null;
  const dueLabel = due && isValid(due) ? format(due, 'd MMMM yyyy') : null;
  const subjectColour = task?.subject?.colour || '#2563EB';

  // The task title is read live from the linked task, so editing a task
  // immediately updates its session cards. Falls back to the stored title.
  const taskTitle = task?.title || session.title;
  const heading = task ? `${taskTitle} Study Session` : taskTitle;
  const category = task
    ? CATEGORY_LABELS[task.category as TaskCategory] ?? task.category
    : null;

  const statusStyle: Record<SessionStatus, string> = {
    active: 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300',
    completed: 'bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300',
    archived: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="group rounded-xl border border-border bg-card p-4 hover:shadow-soft transition-shadow flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-navy-700 dark:text-sky-400">
            Study Session
          </p>
          <p className="text-sm font-semibold mt-0.5 line-clamp-2">{heading}</p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded hover:bg-accent transition-colors flex-shrink-0">
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>
              <Play className="w-3.5 h-3.5 mr-2" /> Continue session
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="w-3.5 h-3.5 mr-2" /> Rename
            </DropdownMenuItem>
            {session.status === 'completed' ? (
              <DropdownMenuItem onClick={() => onStatus(session, 'active')}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Reopen
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onStatus(session, 'completed')}>
                <CheckCircle2 className="w-3.5 h-3.5 mr-2" /> Mark complete
              </DropdownMenuItem>
            )}
            {session.status === 'archived' ? (
              <DropdownMenuItem onClick={() => onStatus(session, 'active')}>
                <ArchiveRestore className="w-3.5 h-3.5 mr-2" /> Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onStatus(session, 'archived')}>
                <Archive className="w-3.5 h-3.5 mr-2" /> Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
        {task?.description?.trim() ? task.description : 'No task description added yet.'}
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-3 text-[11px] text-muted-foreground">
        {category && <span>{category}</span>}
        {category && (task?.subject?.name || dueLabel) && <span aria-hidden>·</span>}
        {task?.subject?.name && (
          <span className="inline-flex items-center gap-1" style={{ color: subjectColour }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: subjectColour }} />
            {task.subject.name}
          </span>
        )}
        {task?.subject?.name && dueLabel && <span aria-hidden>·</span>}
        {dueLabel && (
          <span className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3" /> {dueLabel}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-muted-foreground">
        {task?.estimated_minutes ? (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" /> {task.estimated_minutes} minutes
          </span>
        ) : null}
        <span className="flex items-center gap-1">
          <BookOpen className="w-3 h-3" />
          {session.message_count} {session.message_count === 1 ? 'message' : 'messages'}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border">
        <span className={cn('text-[11px] px-2 py-0.5 rounded-full font-medium capitalize', statusStyle[session.status])}>
          {session.status}
        </span>
        {updatedLabel && (
          <span className="text-[11px] text-muted-foreground">Last activity {updatedLabel}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-3">
        <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={onOpen}>
          <Play className="w-3.5 h-3.5" /> Continue Session
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" onClick={onNewForTask}>
          <Plus className="w-3.5 h-3.5" /> New Session
        </Button>
        <button
          onClick={() =>
            onStatus(session, session.status === 'archived' ? 'active' : 'archived')
          }
          className="p-2 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title={session.status === 'archived' ? 'Restore session' : 'Archive session'}
          aria-label={session.status === 'archived' ? 'Restore session' : 'Archive session'}
        >
          {session.status === 'archived' ? (
            <ArchiveRestore className="w-3.5 h-3.5" />
          ) : (
            <Archive className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={onDelete}
          className="p-2 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          title="Delete session"
          aria-label="Delete session"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
