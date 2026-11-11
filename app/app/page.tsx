'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase/client';
import { Task, Subject, Reminder } from '@/lib/types';
import { listUpcomingStudySessions, ScheduledStudySession } from '@/lib/study-schedule';
import { DashboardView, DashboardSkeleton, DashboardError, DashboardData } from '@/components/dashboard-view';

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const hasLoaded = useRef(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    // Only the first load shows the skeleton. Every later refresh (completing a task,
    // adding one, study-session activity) updates in place, so the list never flashes,
    // the scroll position is kept and an open Study Session panel stays mounted.
    if (!hasLoaded.current) setFailed(false);

    try {
      const [tasksRes, subjectsRes, remindersRes, sessionsRes, mbRes] = await Promise.all([
        supabase.from('tasks').select('*, subject:subjects(*)').eq('is_archived', false).order('due_date', { nullsFirst: false }),
        supabase.from('subjects').select('*').eq('is_archived', false),
        supabase.from('reminders').select('*, task:tasks(*)').eq('is_enabled', true).gte('scheduled_for', new Date().toISOString()).order('scheduled_for').limit(5),
        listUpcomingStudySessions().catch(() => [] as ScheduledStudySession[]),
        supabase.from('managebac_calendar_connections').select('user_id').maybeSingle(),
      ]);

      // Tasks are the heart of the dashboard; without them an empty page would be misleading.
      if (tasksRes.error) throw tasksRes.error;

      setData({
        tasks: (tasksRes.data as unknown as Task[]) || [],
        subjects: (subjectsRes.data as Subject[]) || [],
        reminders: (remindersRes.data as unknown as Reminder[]) || [],
        studySessions: sessionsRes || [],
        managebacConnected: !!mbRes.data,
      });
      hasLoaded.current = true;
    } catch {
      // A failed background refresh keeps the data already on screen.
      if (!hasLoaded.current) setFailed(true);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const retry = () => {
    setFailed(false);
    fetchData();
  };

  if (failed) return <DashboardError onRetry={retry} />;
  if (!data) return <DashboardSkeleton />;

  return (
    <DashboardView
      data={data}
      firstName={profile?.full_name?.split(' ')[0] || 'there'}
      onChanged={() => fetchData()}
    />
  );
}
