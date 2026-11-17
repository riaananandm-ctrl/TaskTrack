'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Flame, CalendarClock, Layers, ArrowRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { isDpYear } from '@/lib/ib-grades';
import { GradesTab } from '@/components/ib/grades-tab';
import { ExamsTab, countdownLabel } from '@/components/ib/exams-tab';
import { ProjectsTab } from '@/components/ib/projects-tab';
import { daysBetween } from '@/lib/revision-plan';
import { getMyStreak, listExams, listRevisionSessions, localToday, type Exam, type MyStreak } from '@/lib/ib-data';

const TABS = ['grades', 'exams', 'projects'] as const;
type Tab = (typeof TABS)[number];

/**
 * IB Hub: grades, exam countdown + revision timetable, and IA/EE checkpoints in
 * one place, so the sidebar only gains a single item.
 */
export default function IbHubPage() {
  const router = useRouter();
  const { profile } = useAuth();
  // IA & EE are Diploma (Grade 11-12) work, so younger students see them as "later", not as a to-do.
  const dp = isDpYear(profile?.year_group);
  const [tab, setTab] = useState<Tab>('grades');
  const [stripVersion, setStripVersion] = useState(0);
  const [subjects, setSubjects] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (TABS as readonly string[]).includes(t)) setTab(t as Tab);
    supabase
      .from('subjects')
      .select('id, name')
      .eq('is_archived', false)
      .order('name')
      .then(({ data }) => setSubjects((data ?? []) as { id: string; name: string }[]));
  }, []);

  const changeTab = (v: string) => {
    setTab(v as Tab);
    router.replace(`/app/ib?tab=${v}`, { scroll: false });
  };

  const names = subjects.map((s) => s.name);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">IB Hub</h1>
        <p className="text-muted-foreground mt-1">Your grades, exams and big projects in one place.</p>
      </div>

      <TodayStrip version={stripVersion} onOpenExams={() => changeTab('exams')} />

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className="grid w-full grid-cols-3 sm:inline-grid sm:w-auto">
          <TabsTrigger value="grades">Grades</TabsTrigger>
          <TabsTrigger value="exams">Exams</TabsTrigger>
          <TabsTrigger value="projects">
            IA &amp; EE
            {dp === false && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">DP</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="grades" className="mt-4"><GradesTab subjectNames={names} defaultProgramme={dp ? 'DP' : 'MYP'} /></TabsContent>
        <TabsContent value="exams" className="mt-4"><ExamsTab subjectNames={names} onChanged={() => setStripVersion((v) => v + 1)} /></TabsContent>
        <TabsContent value="projects" className="mt-4 space-y-4">
          {dp === false && (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              The IA and Extended Essay are part of the IB Diploma (Grades 11–12). You don’t need this yet, but you’re welcome to plan ahead.
            </p>
          )}
          <ProjectsTab subjects={subjects} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TodayStrip({ onOpenExams, version }: { onOpenExams: () => void; version: number }) {
  const [streak, setStreak] = useState<MyStreak | null>(null);
  const [nextExam, setNextExam] = useState<Exam | null>(null);
  const [todayCount, setTodayCount] = useState(0);
  const today = localToday();

  const load = useCallback(async () => {
    const [s, exams, sessions] = await Promise.all([
      getMyStreak().catch(() => null),
      listExams().catch(() => [] as Exam[]),
      listRevisionSessions().catch(() => []),
    ]);
    setStreak(s);
    setNextExam(exams.find((e) => e.exam_date >= today) ?? null);
    setTodayCount(sessions.filter((x) => x.session_date === today && !x.done).length);
  }, [today]);

  useEffect(() => {
    load();
  }, [load, version]);

  const tile = 'flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-accent/50';

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className={tile.replace(' hover:bg-accent/50', '')}>
        <Flame className="w-5 h-5 text-orange-500 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{streak ? `${streak.current_streak}-day streak` : 'Study streak'}</p>
          <p className="text-xs text-muted-foreground truncate">
            {streak?.studied_today ? 'You’ve studied today ✓' : 'Finish a task or review cards today'}
          </p>
        </div>
      </div>
      <button type="button" onClick={onOpenExams} className={tile}>
        <CalendarClock className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">
            {nextExam ? `${nextExam.subject_name} ${countdownLabel(daysBetween(today, nextExam.exam_date))}` : 'No exams added'}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {todayCount ? `${todayCount} revision session${todayCount === 1 ? '' : 's'} today` : nextExam ? 'No revision planned today' : 'Add your exam dates'}
          </p>
        </div>
      </button>
      <Link href="/app/review" className={tile}>
        <Layers className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Daily review</p>
          <p className="text-xs text-muted-foreground truncate">5 minutes of flashcards, weakest first</p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground" />
      </Link>
    </div>
  );
}
