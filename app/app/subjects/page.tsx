'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Subject, Task, SUBJECT_COLORS, SUBJECT_ICONS } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, BookOpen, Pencil, Archive, Trash2, MoreVertical, ArrowLeft, CheckCircle2, Clock, AlertCircle, RotateCcw, Sparkles } from 'lucide-react';
import { SubjectPicker } from '@/components/subject-picker';
import { cn } from '@/lib/utils';
import { validateSubjectName, SUBJECT_MAX_WORDS, SUBJECT_MAX_CHARS } from '@/lib/subject-validation';
import { TaskCard } from '@/components/task-card';
import { TaskDialog } from '@/components/task-dialog';
import { isOverdue, isDueToday } from '@/lib/task-utils';
import { parseISO, isPast } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SubjectIcon } from '@/lib/subject-icons';


function getIcon(name: string) {
  return SubjectIcon(name);
}

export default function SubjectsPage() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('active');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [deleteSubject, setDeleteSubject] = useState<Subject | null>(null);
  const [deleteMode, setDeleteMode] = useState<'archive' | 'delete'>('archive');
  const [detailSubject, setDetailSubject] = useState<Subject | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [subjectsRes, tasksRes] = await Promise.all([
      supabase.from('subjects').select('*').order('name'),
      supabase.from('tasks').select('*, subject:subjects(*)').eq('is_archived', false),
    ]);
    setSubjects((subjectsRes.data as Subject[]) || []);
    setTasks((tasksRes.data as unknown as Task[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredSubjects = subjects.filter((s) => {
    if (tab === 'active' && s.is_archived) return false;
    if (tab === 'archived' && !s.is_archived) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const getSubjectStats = (subjectId: string) => {
    const subjectTasks = tasks.filter((t) => t.subject_id === subjectId);
    const active = subjectTasks.filter((t) => t.status !== 'completed').length;
    const completed = subjectTasks.filter((t) => t.status === 'completed').length;
    const upcoming = subjectTasks
      .filter((t) => t.due_date && t.status !== 'completed')
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))[0];
    const overdueCount = subjectTasks.filter((t) => isOverdue(t)).length;
    return { active, completed, upcoming, overdueCount };
  };

  const handleEdit = (subject: Subject) => {
    setEditingSubject(subject);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingSubject(null);
    setDialogOpen(true);
  };

  const archiveSubject = async (subject: Subject) => {
    await supabase.from('subjects').update({ is_archived: true }).eq('id', subject.id);
    fetchData();
  };

  const restoreSubject = async (subject: Subject) => {
    await supabase.from('subjects').update({ is_archived: false }).eq('id', subject.id);
    fetchData();
  };

  const confirmDelete = async () => {
    if (!deleteSubject) return;
    if (deleteMode === 'archive') {
      await archiveSubject(deleteSubject);
    } else {
      // Move tasks to no subject, then delete
      await supabase.from('tasks').update({ subject_id: null }).eq('subject_id', deleteSubject.id);
      await supabase.from('subjects').delete().eq('id', deleteSubject.id);
      fetchData();
    }
    setDeleteSubject(null);
  };

  // Subject detail view
  if (detailSubject) {
    const detailTasks = tasks.filter((t) => t.subject_id === detailSubject.id);
    const upcomingTasks = detailTasks
      .filter((t) => t.due_date && t.status !== 'completed' && !isPast(parseISO(t.due_date)))
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    const completedTasks = detailTasks.filter((t) => t.status === 'completed');
    const overdueTasks = detailTasks.filter((t) => isOverdue(t));
    const Icon = getIcon(detailSubject.icon);

    return (
      <div className="space-y-6 animate-fade-in">
        <button onClick={() => setDetailSubject(null)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to subjects
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: `${detailSubject.colour}15` }}>
              <Icon className="w-7 h-7" style={{ color: detailSubject.colour }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{detailSubject.name}</h1>
              <p className="text-sm text-muted-foreground">
                {detailSubject.teacher_name && `Teacher: ${detailSubject.teacher_name}`}
                {detailSubject.teacher_name && detailSubject.room && ' · '}
                {detailSubject.room && `Room: ${detailSubject.room}`}
                {!detailSubject.teacher_name && !detailSubject.room && 'No additional details'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleEdit(detailSubject)}>
              <Pencil className="w-4 h-4 mr-1" /> Edit
            </Button>
            <Button onClick={() => setTaskDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Add task
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{upcomingTasks.length}</p>
            <p className="text-xs text-muted-foreground">Upcoming</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{completedTasks.length}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-red-600">{overdueTasks.length}</p>
            <p className="text-xs text-muted-foreground">Overdue</p>
          </Card>
        </div>

        {upcomingTasks.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Upcoming tasks</h2>
            <div className="space-y-2">
              {upcomingTasks.map((t) => (
                <TaskCard key={t.id} task={t} onChanged={fetchData} />
              ))}
            </div>
          </div>
        )}

        {overdueTasks.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3 text-red-600">Overdue</h2>
            <div className="space-y-2">
              {overdueTasks.map((t) => (
                <TaskCard key={t.id} task={t} onChanged={fetchData} />
              ))}
            </div>
          </div>
        )}

        {completedTasks.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">Completed</h2>
            <div className="space-y-2">
              {completedTasks.map((t) => (
                <TaskCard key={t.id} task={t} onChanged={fetchData} />
              ))}
            </div>
          </div>
        )}

        {detailTasks.length === 0 && (
          <Card className="p-8 text-center">
            <BookOpen className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium">No tasks for this subject yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add a task to get started.</p>
          </Card>
        )}

        <TaskDialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen} subjects={subjects} defaultDueDate={undefined} onSaved={fetchData} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Subjects</h1>
          <p className="text-sm text-muted-foreground mt-1">{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPickerOpen(true)} size="lg" variant="outline">
            <Sparkles className="w-4 h-4 mr-1" /> Pick subjects & sort tasks
          </Button>
          <Button onClick={handleNew} size="lg">
            <Plus className="w-4 h-4 mr-1" /> Add subject
          </Button>
        </div>
      </div>

      <Dialog open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) fetchData(); }}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pick your subjects</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Choose the subjects you take. TaskTrack AI then files your unsorted tasks under the right subject using each task’s title and description.
          </p>
          <SubjectPicker compact onDone={() => fetchData()} />
        </DialogContent>
      </Dialog>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search subjects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="text-center py-20 text-muted-foreground">Loading subjects...</div>
      ) : filteredSubjects.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            {tab === 'archived' ? 'No archived subjects' : 'You have no subjects yet'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {tab === 'archived' ? 'Archived subjects will appear here.' : 'Add your first subject to organise your tasks.'}
          </p>
          {tab === 'active' && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setPickerOpen(true)}><Sparkles className="w-4 h-4 mr-1" /> Pick subjects & sort tasks</Button>
              <Button variant="outline" onClick={handleNew}><Plus className="w-4 h-4 mr-1" /> Add subject</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredSubjects.map((subject) => {
            const stats = getSubjectStats(subject.id);
            const Icon = getIcon(subject.icon);
            return (
              <Card key={subject.id} className="p-4 group hover:shadow-card transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => setDetailSubject(subject)}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${subject.colour}15` }}>
                      <Icon className="w-5 h-5" style={{ color: subject.colour }} />
                    </div>
                    <div>
                      <p className="font-semibold">{subject.name}</p>
                      {subject.teacher_name && <p className="text-xs text-muted-foreground">{subject.teacher_name}</p>}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="tap-target opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 p-1 rounded hover:bg-accent transition-all">
                        <MoreVertical className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setDetailSubject(subject)}>
                        <BookOpen className="w-3.5 h-3.5 mr-2" /> Open
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleEdit(subject)}>
                        <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      {subject.is_archived ? (
                        <DropdownMenuItem onClick={() => restoreSubject(subject)}>
                          <RotateCcw className="w-3.5 h-3.5 mr-2" /> Restore
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => archiveSubject(subject)}>
                          <Archive className="w-3.5 h-3.5 mr-2" /> Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => { setDeleteSubject(subject); setDeleteMode('archive'); }} className="text-destructive">
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 py-2">
                    <p className="text-lg font-bold text-blue-600">{stats.active}</p>
                    <p className="text-[10px] text-muted-foreground">Active</p>
                  </div>
                  <div className="rounded-lg bg-green-50 dark:bg-green-950/30 py-2">
                    <p className="text-lg font-bold text-green-600">{stats.completed}</p>
                    <p className="text-[10px] text-muted-foreground">Done</p>
                  </div>
                  <div className="rounded-lg bg-red-50 dark:bg-red-950/30 py-2">
                    <p className="text-lg font-bold text-red-600">{stats.overdueCount}</p>
                    <p className="text-[10px] text-muted-foreground">Overdue</p>
                  </div>
                </div>

                {stats.upcoming && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    Next: {stats.upcoming.title}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <SubjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        subject={editingSubject}
        onSaved={fetchData}
      />

      <AlertDialog open={!!deleteSubject} onOpenChange={(open) => { if (!open) setDeleteSubject(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete subject?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteSubject && getSubjectStats(deleteSubject.id).active > 0
                ? `This subject has ${getSubjectStats(deleteSubject.id).active} active task(s). Choose what to do with them.`
                : 'This subject has no active tasks. It will be permanently deleted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteSubject && getSubjectStats(deleteSubject.id).active > 0 && (
            <div className="space-y-2 py-2">
              <Label>What should happen to the tasks?</Label>
              <Select value={deleteMode} onValueChange={(v) => setDeleteMode(v as 'archive' | 'delete')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="archive">Archive subject (keep tasks)</SelectItem>
                  <SelectItem value="delete">Delete subject (move tasks to &ldquo;No subject&rdquo;)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteMode === 'archive' ? 'Archive' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SubjectDialog({
  open,
  onOpenChange,
  subject,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: Subject | null;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    colour: SUBJECT_COLORS[0],
    icon: 'BookOpen',
    teacher_name: '',
    room: '',
  });
  const validation = validateSubjectName(formData.name);
  const showWordError = formData.name.length > 0 && !validation.ok && validation.wordCount > SUBJECT_MAX_WORDS;

  useEffect(() => {
    if (subject) {
      setFormData({
        name: subject.name,
        colour: subject.colour,
        icon: subject.icon,
        teacher_name: subject.teacher_name || '',
        room: subject.room || '',
      });
    } else {
      setFormData({ name: '', colour: SUBJECT_COLORS[0], icon: 'BookOpen', teacher_name: '', room: '' });
    }
    setError(null);
  }, [subject, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setLoading(true);

    const subjectCheck = validateSubjectName(formData.name);
    if (!subjectCheck.ok) {
      setError(subjectCheck.error);
      setLoading(false);
      return;
    }

    const payload = {
      name: subjectCheck.normalized,
      colour: formData.colour,
      icon: formData.icon,
      teacher_name: formData.teacher_name || null,
      room: formData.room || null,
    };

    let result;
    if (subject) {
      result = await supabase.from('subjects').update(payload).eq('id', subject.id);
    } else {
      result = await supabase.from('subjects').insert({ ...payload, user_id: user.id });
    }

    if (result.error) {
      console.error('Failed to save subject', result.error);
      setError('We could not save this subject. Please check the details and try again.');
      setLoading(false);
      return;
    }

    setLoading(false);
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{subject ? 'Edit subject' : 'New subject'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="name">Subject name *</Label>
              {formData.name.length > 0 && (
                <span className={cn(
                  'text-xs',
                  validation.wordCount > SUBJECT_MAX_WORDS ? 'text-destructive' : 'text-muted-foreground'
                )}>
                  {validation.wordCount}/{SUBJECT_MAX_WORDS} words
                </span>
              )}
            </div>
            <Input
              id="name"
              required
              placeholder="e.g. Mathematics"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              maxLength={SUBJECT_MAX_CHARS}
            />
            {showWordError && (
              <p className="text-xs text-destructive">{validation.error}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {SUBJECT_COLORS.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  onClick={() => setFormData({ ...formData, colour })}
                  className={cn(
                    'w-8 h-8 rounded-full transition-all',
                    formData.colour === colour ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'
                  )}
                  style={{ background: colour }}
                  aria-label={`Select colour ${colour}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="grid grid-cols-8 gap-1.5 max-h-32 overflow-y-auto p-1 rounded-lg border border-border">
              {SUBJECT_ICONS.map((iconName) => {
                const Icon = getIcon(iconName);
                return (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => setFormData({ ...formData, icon: iconName })}
                    className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center transition-all',
                      formData.icon === iconName ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
                    )}
                    aria-label={`Select icon ${iconName}`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="teacher_name">Teacher (optional)</Label>
              <Input id="teacher_name" placeholder="e.g. Mr Smith" value={formData.teacher_name} onChange={(e) => setFormData({ ...formData, teacher_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="room">Room (optional)</Label>
              <Input id="room" placeholder="e.g. Room 204" value={formData.room} onChange={(e) => setFormData({ ...formData, room: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <span className="w-4 h-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              {subject ? 'Save changes' : 'Create subject'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
