export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'archived';
export type TaskCategory =
  | 'homework'
  | 'classwork'
  | 'project'
  | 'quiz'
  | 'test'
  | 'presentation'
  | 'reading'
  | 'summative_assessment'
  | 'formative_assessment'
  | 'final_exam'
  | 'mock_exam'
  | 'other';

export type ReminderType =
  | 'task_due'
  | 'start_task'
  | 'custom'
  | 'daily_summary'
  | 'weekly_planning'
  | 'overdue'
  | 'study_session'
  | 'announcement';

export type RepeatRule = 'none' | 'daily' | 'weekdays' | 'weekly' | 'custom';

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  year_group: string | null;
  school_name: string | null;
  timezone: string;
  onboarding_completed: boolean;
  plan: 'free' | 'pro' | 'max';
  plan_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subject {
  id: string;
  user_id: string;
  name: string;
  colour: string;
  icon: string;
  teacher_name: string | null;
  room: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  subject_id: string | null;
  title: string;
  description: string | null;
  category: TaskCategory;
  due_date: string | null;
  due_time: string | null;
  priority: Priority;
  status: TaskStatus;
  estimated_minutes: number | null;
  remaining_minutes: number | null;
  notes: string | null;
  external_link: string | null;
  is_archived: boolean;
  completed_at: string | null;
  external_source: string | null;
  external_uid: string | null;
  /** When the student first opened this task. NULL means it is new to them. */
  seen_at?: string | null;
  created_at: string;
  updated_at: string;
  subject?: Subject | null;
}

export interface Reminder {
  id: string;
  user_id: string;
  task_id: string | null;
  title: string;
  message: string | null;
  reminder_type: ReminderType;
  scheduled_for: string;
  repeat_rule: RepeatRule;
  is_enabled: boolean;
  is_read: boolean;
  created_at: string;
  updated_at: string;
  task?: Task | null;
}

export interface WeeklyPlan {
  id: string;
  user_id: string;
  task_id: string;
  planned_date: string;
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
  task?: Task | null;
}

export interface UserSettings {
  id: string;
  user_id: string;
  task_reminders_enabled: boolean;
  overdue_reminders_enabled: boolean;
  daily_summary_enabled: boolean;
  weekly_summary_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  preferred_reminder_time: string;
  theme: string;
  compact_view: boolean;
  font_family: string;
  created_at: string;
  updated_at: string;
}

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_COLORS: Record<Priority, string> = {
  low: '#64748B',
  medium: '#2563EB',
  high: '#F59E0B',
  urgent: '#DC2626',
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  archived: 'Archived',
};

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  homework: 'Homework',
  classwork: 'Classwork',
  project: 'Project',
  quiz: 'Quiz',
  test: 'Test',
  presentation: 'Presentation',
  reading: 'Reading',
  summative_assessment: 'Summative Assessment',
  formative_assessment: 'Formative Assessment',
  final_exam: 'Final Exam',
  mock_exam: 'Mock Exam',
  other: 'Other',
};

export const REMINDER_TYPE_LABELS: Record<ReminderType, string> = {
  task_due: 'Task due reminder',
  start_task: 'Start task reminder',
  custom: 'Custom reminder',
  daily_summary: 'Daily summary',
  weekly_planning: 'Weekly planning reminder',
  overdue: 'Overdue task reminder',
  study_session: 'Scheduled study session',
  announcement: 'From TaskTrack',
};

export const REPEAT_LABELS: Record<RepeatRule, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  custom: 'Custom',
};

export const SUBJECT_COLORS = [
  '#2563EB',
  '#38BDF8',
  '#16A34A',
  '#F59E0B',
  '#DC2626',
  '#8B5CF6',
  '#EC4899',
  '#0EA5E9',
  '#14B8A6',
  '#F97316',
  '#6366F1',
  '#84CC16',
];

export const SUBJECT_ICONS = [
  'BookOpen',
  'Calculator',
  'FlaskConical',
  'Globe',
  'Languages',
  'PenTool',
  'Palette',
  'Music',
  'Code',
  'Dumbbell',
  'Brain',
  'Heart',
  'Camera',
  'Microscope',
  'Ruler',
  'Library',
];

export const YEAR_GROUPS = [
  'Year 7',
  'Year 8',
  'Year 9',
  'Year 10',
  'Year 11',
  'Year 12 (IB DP Year 1)',
  'Year 13 (IB DP Year 2)',
  'MYP Year 1',
  'MYP Year 2',
  'MYP Year 3',
  'MYP Year 4',
  'MYP Year 5',
  'Grade 9',
  'Grade 10',
  'Grade 11',
  'Grade 12',
  'Other',
];

export const DEFAULT_SUBJECTS = [
  { name: 'Mathematics', colour: '#2563EB', icon: 'Calculator' },
  { name: 'Science', colour: '#16A34A', icon: 'FlaskConical' },
  { name: 'Humanities', colour: '#F59E0B', icon: 'Globe' },
  { name: 'Spanish', colour: '#DC2626', icon: 'Languages' },
  { name: 'English', colour: '#8B5CF6', icon: 'BookOpen' },
  { name: 'Design', colour: '#0EA5E9', icon: 'Palette' },
  { name: 'Music', colour: '#EC4899', icon: 'Music' },
];
