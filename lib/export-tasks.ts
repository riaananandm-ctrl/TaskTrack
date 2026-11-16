import { supabase } from '@/lib/supabase/client';

/**
 * Download every task the signed-in student owns as a CSV file that opens in
 * Excel, Numbers or Google Sheets. Row-level security limits the query to the
 * student's own tasks. Returns how many tasks were exported.
 */
export async function downloadTasksCsv(): Promise<number> {
  const { data, error } = await supabase
    .from('tasks')
    .select('title, description, category, due_date, due_time, priority, status, estimated_minutes, notes, external_link, is_archived, completed_at, created_at, subject:subjects(name)')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(5000);
  if (error) throw new Error('We couldn’t load your tasks. Please try again.');

  const header = [
    'Title', 'Subject', 'Category', 'Due date', 'Due time', 'Priority', 'Status',
    'Estimated minutes', 'Description', 'Notes', 'Link', 'Archived', 'Completed at', 'Created at',
  ];
  const rows = (data ?? []).map((t) => {
    const subject = (t as { subject?: { name?: string } | { name?: string }[] | null }).subject;
    const subjectName = Array.isArray(subject) ? subject[0]?.name : subject?.name;
    return [
      t.title, subjectName ?? '', label(t.category), t.due_date ?? '', t.due_time ?? '', label(t.priority),
      label(t.status), t.estimated_minutes ?? '', t.description ?? '', t.notes ?? '', t.external_link ?? '',
      t.is_archived ? 'Yes' : 'No', t.completed_at ?? '', t.created_at ?? '',
    ];
  });

  // The byte-order mark makes Excel read accents and emoji correctly.
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const date = new Date().toISOString().slice(0, 10);
  saveFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `tasktrack-tasks-${date}.csv`);
  return rows.length;
}

/** "summative_assessment" → "Summative assessment". */
function label(value: string | null | undefined): string {
  if (!value) return '';
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Quote a CSV cell, and stop spreadsheet apps from running text that looks like a formula. */
function cell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Hand a file to the browser's normal download. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
