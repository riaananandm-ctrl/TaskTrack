'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Task, Subject, TaskStatus, Priority, TaskCategory } from '@/lib/types';
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS } from '@/lib/types';
import { TaskCard } from '@/components/task-card';
import { TaskDialog } from '@/components/task-dialog';
import { useReminderPrompt } from '@/components/reminder-prompt';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, SlidersHorizontal, ListTodo } from 'lucide-react';
import { parseISO } from 'date-fns';
import { getDeadlineStatus } from '@/lib/deadline-status';

type SortBy = 'due_date' | 'priority' | 'created_at' | 'alphabetical' | 'subject';
type FilterStatus = 'all' | 'active' | 'completed' | 'overdue' | 'archived';

export default function TasksPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [search, setSearch] = useState('');
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('active');
  const [sortBy, setSortBy] = useState<SortBy>('due_date');
  const [showFilters, setShowFilters] = useState(false);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    if (!user) return;
    // A silent refresh keeps the current list mounted, so an open Study Session panel
    // inside a task card is never unmounted while a reply is being saved.
    if (!options?.silent) setLoading(true);
    const [tasksRes, subjectsRes] = await Promise.all([
      supabase.from('tasks').select('*, subject:subjects(*)').order('created_at', { ascending: false }),
      supabase.from('subjects').select('*').eq('is_archived', false),
    ]);
    setTasks((tasksRes.data as unknown as Task[]) || []);
    setSubjects((subjectsRes.data as Subject[]) || []);
    if (!options?.silent) setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setEditingTask(null);
      setDialogOpen(true);
    }
  }, [searchParams]);

  // Tapping a study notification opens `/app/tasks?task=<id>`. Once tasks have
  // loaded, open that task's editor. The param is cleared so closing the dialog does
  // not immediately reopen it.
  const deepLinkedRef = useRef<string | null>(null);
  useEffect(() => {
    const taskId = searchParams.get('task');
    if (!taskId || tasks.length === 0 || deepLinkedRef.current === taskId) return;
    const match = tasks.find((t) => t.id === taskId);
    if (!match) return;
    deepLinkedRef.current = taskId;
    setEditingTask(match);
    setDialogOpen(true);
  }, [searchParams, tasks]);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.notes?.toLowerCase().includes(q) ||
        t.subject?.name.toLowerCase().includes(q) ||
        CATEGORY_LABELS[t.category].toLowerCase().includes(q)
      );
    }

    // Status filter
    switch (filterStatus) {
      case 'active':
        result = result.filter((t) => !t.is_archived && getDeadlineStatus(t) !== 'completed');
        break;
      case 'completed':
        result = result.filter((t) => !t.is_archived && getDeadlineStatus(t) === 'completed');
        break;
      case 'overdue':
        result = result.filter((t) => !t.is_archived && getDeadlineStatus(t) === 'overdue');
        break;
      case 'archived':
        result = result.filter((t) => t.is_archived);
        break;
    }

    // Subject filter
    if (filterSubject !== 'all') {
      result = result.filter((t) => t.subject_id === filterSubject);
    }

    // Category filter
    if (filterCategory !== 'all') {
      result = result.filter((t) => t.category === filterCategory);
    }

    // Priority filter
    if (filterPriority !== 'all') {
      result = result.filter((t) => t.priority === filterPriority);
    }

    // Sort
    switch (sortBy) {
      case 'due_date':
        result.sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return parseISO(a.due_date).getTime() - parseISO(b.due_date).getTime();
        });
        break;
      case 'priority':
        const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
        result.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
        break;
      case 'created_at':
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'alphabetical':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'subject':
        result.sort((a, b) => (a.subject?.name || 'zzz').localeCompare(b.subject?.name || 'zzz'));
        break;
    }

    return result;
  }, [tasks, search, filterStatus, filterSubject, filterCategory, filterPriority, sortBy]);

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingTask(null);
    setDialogOpen(true);
  };

  const { onCreated, dialogs } = useReminderPrompt({ subjects, tasks });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={handleNew} size="lg">
          <Plus className="w-4 h-4 mr-1" /> New task
        </Button>
      </div>

      {/* Search and filters */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search tasks, subjects, notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            onClick={() => setShowFilters(!showFilters)}
            size="icon"
            aria-label="Filters"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
        </div>

        {/* Status tabs */}
        <Tabs value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="overdue">Overdue</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Expanded filters */}
        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-lg border border-border bg-card animate-fade-in">
            <Select value={filterSubject} onValueChange={setFilterSubject}>
              <SelectTrigger><SelectValue placeholder="Subject" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {Object.entries(PRIORITY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
              <SelectTrigger><SelectValue placeholder="Sort by" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="due_date">Due date</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="created_at">Recently created</SelectItem>
                <SelectItem value="alphabetical">Alphabetical</SelectItem>
                <SelectItem value="subject">Subject</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="text-center py-20 text-muted-foreground">Loading tasks...</div>
      ) : filteredTasks.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <ListTodo className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No tasks found</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {search || filterSubject !== 'all' || filterCategory !== 'all' || filterPriority !== 'all'
              ? 'Try adjusting your filters.'
              : 'Create your first task to get started.'}
          </p>
          <Button onClick={handleNew}>
            <Plus className="w-4 h-4 mr-1" /> New task
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredTasks.map((task) => (
            <TaskCard key={task.id} task={task} onEdit={handleEdit} onChanged={fetchData} />
          ))}
        </div>
      )}

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        subjects={subjects}
        onSaved={() => fetchData()}
        onCreated={onCreated}
      />

      {dialogs}
    </div>
  );
}
