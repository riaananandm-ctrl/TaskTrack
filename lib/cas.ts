import { supabase } from '@/lib/supabase/client';

/** Shared CAS (Creativity, Activity, Service) types, rules and AI calls. */

export const STRANDS = ['creativity', 'activity', 'service'] as const;
export type Strand = (typeof STRANDS)[number];

export const STRAND_LABEL: Record<Strand, string> = {
  creativity: 'Creativity',
  activity: 'Activity',
  service: 'Service',
};

/** The seven IB CAS learning outcomes. */
export const CAS_OUTCOMES: { id: number; short: string; full: string }[] = [
  { id: 1, short: 'Strengths and growth', full: 'Identify own strengths and develop areas for growth' },
  { id: 2, short: 'Challenges and skills', full: 'Demonstrate that challenges have been undertaken, developing new skills' },
  { id: 3, short: 'Initiative and planning', full: 'Demonstrate how to initiate and plan a CAS experience' },
  { id: 4, short: 'Collaboration', full: 'Demonstrate the skills and recognise the benefits of working collaboratively' },
  { id: 5, short: 'Perseverance and commitment', full: 'Show commitment to and perseverance in CAS experiences' },
  { id: 6, short: 'Global significance', full: 'Demonstrate engagement with issues of global significance' },
  { id: 7, short: 'Ethics', full: 'Recognise and consider the ethics of choices and actions' },
];

export type VerificationStatus = 'pending' | 'confirmed' | 'queried';

export interface CasProfile {
  id: string;
  start_date: string | null;
  end_date: string | null;
  supervisor_name: string | null;
  supervisor_email: string | null;
  target_hours_creativity: number;
  target_hours_activity: number;
  target_hours_service: number;
}

export interface CasExperience {
  id: string;
  title: string;
  description: string | null;
  strands: Strand[];
  start_date: string;
  end_date: string | null;
  hours: number;
  supervisor_name: string | null;
  supervisor_email: string | null;
  evidence_url: string | null;
  verification_status: VerificationStatus;
  created_at: string;
}

export interface CasReflection {
  id: string;
  experience_id: string;
  what_i_did: string | null;
  what_i_learned: string | null;
  outcome_evidence: string | null;
  outcomes: number[];
  ai_flags: unknown;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_TARGETS: Record<Strand, number> = { creativity: 50, activity: 50, service: 50 };

export function targetsOf(profile: Pick<CasProfile, 'target_hours_creativity' | 'target_hours_activity' | 'target_hours_service'> | null) {
  if (!profile) return { ...DEFAULT_TARGETS };
  return {
    creativity: profile.target_hours_creativity,
    activity: profile.target_hours_activity,
    service: profile.target_hours_service,
  };
}

/**
 * Hours per strand. An experience that covers two strands counts its full hours
 * toward each of them (a 3-hour beach clean-up for Service + Activity adds 3 to both),
 * which is how CAS coordinators read strand balance.
 */
export function hoursByStrand(experiences: Pick<CasExperience, 'strands' | 'hours'>[]): Record<Strand, number> {
  const totals: Record<Strand, number> = { creativity: 0, activity: 0, service: 0 };
  for (const e of experiences) {
    const hours = Number(e.hours) || 0;
    for (const s of Array.from(new Set(e.strands))) {
      if (s in totals) totals[s as Strand] += hours;
    }
  }
  for (const s of STRANDS) totals[s] = Math.round(totals[s] * 100) / 100;
  return totals;
}

/** Total logged hours, each experience counted once. */
export function totalHours(experiences: Pick<CasExperience, 'hours'>[]): number {
  return Math.round(experiences.reduce((sum, e) => sum + (Number(e.hours) || 0), 0) * 100) / 100;
}

/** Outcomes with at least one reflection evidencing them. */
export function evidencedOutcomes(reflections: Pick<CasReflection, 'outcomes'>[]): Set<number> {
  const set = new Set<number>();
  for (const r of reflections) for (const id of r.outcomes ?? []) if (id >= 1 && id <= 7) set.add(id);
  return set;
}

/** Strands under 50% of target while the CAS end date is within 90 days (or already past). */
export function strandsAtRisk(
  totals: Record<Strand, number>,
  targets: Record<Strand, number>,
  endDate: string | null,
  today: Date = new Date(),
): Strand[] {
  if (!endDate) return [];
  const end = new Date(`${endDate}T23:59:59`);
  const days = (end.getTime() - today.getTime()) / 86_400_000;
  if (days > 90) return [];
  return STRANDS.filter((s) => targets[s] > 0 && totals[s] < targets[s] * 0.5);
}

export function daysUntil(date: string, today: Date = new Date()): number {
  const end = new Date(`${date}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export const EVIDENCE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
};
export const EVIDENCE_MAX_BYTES = 10_000_000;

/** Upload one evidence file to the student's own folder. Returns the storage path. */
export async function uploadEvidence(userId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const contentType = EVIDENCE_TYPES[ext];
  if (!contentType) throw new Error('Evidence must be a photo (JPG, PNG, WebP, HEIC) or a PDF.');
  if (file.size > EVIDENCE_MAX_BYTES) throw new Error('Evidence files can be up to 10 MB.');
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('cas-evidence').upload(path, file, { contentType, upsert: false });
  if (error) throw new Error('The evidence file could not be uploaded. Please try again.');
  return `storage:${path}`;
}

/** A short-lived link to view stored evidence, or the URL itself for a pasted link. */
export async function evidenceLink(evidence: string | null): Promise<string | null> {
  if (!evidence) return null;
  if (!evidence.startsWith('storage:')) return /^https?:\/\//i.test(evidence) ? evidence : null;
  const { data } = await supabase.storage.from('cas-evidence').createSignedUrl(evidence.slice(8), 60 * 30);
  return data?.signedUrl ?? null;
}

// --- AI -----------------------------------------------------------------------------

export interface OutcomeSuggestion {
  id: number;
  confidence: number;
  reason: string;
}

export type CasAiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function callCasAi<T>(body: Record<string, unknown>): Promise<CasAiResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('cas-ai', { body });
    if (error || !data) return { ok: false, code: 'UNAVAILABLE', message: 'CAS AI is not available right now.' };
    if (!data.ok) return { ok: false, code: data.error?.code ?? 'UNAVAILABLE', message: data.error?.message ?? 'CAS AI is not available right now.' };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, code: 'UNAVAILABLE', message: 'CAS AI is not available right now.' };
  }
}

type ReflectionFields = Pick<CasReflection, 'what_i_did' | 'what_i_learned' | 'outcome_evidence'>;

export function suggestOutcomes(reflection: ReflectionFields) {
  return callCasAi<{ outcomes: OutcomeSuggestion[] }>({ action: 'outcomes', reflection });
}
