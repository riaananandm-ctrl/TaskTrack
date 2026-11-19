/**
 * Pure helpers for the live Google Doc: markdown -> HTML that Google Docs imports well,
 * and the academic-honesty guard. No Deno or network code here, so tests can import it.
 */

// ---- Markdown -> HTML for Google Docs ----

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<span style="font-family:Courier New">$1</span>');
}

function listText(s: string): string {
  // "[ ] item" / "[x] item" become tick boxes Google Docs shows as text.
  return inline(s.replace(/^\[ \]\s*/, '☐ ').replace(/^\[[xX]\]\s*/, '☑ '));
}

function tableCells(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  // Open lists, outermost first, with the indent they started at.
  const lists: { kind: 'ul' | 'ol'; indent: number }[] = [];
  const closeLists = (toDepth = 0) => {
    while (lists.length > toDepth) out.push(`</li></${lists.pop()!.kind}>`);
  };
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const item = line.match(/^(\s*)(?:([-*•])|(\d+)[.)])\s+(.*)$/);

    // A pipe table: header row, then a |---|---| row.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1] || '') && (lines[i + 1] || '').includes('-')) {
      closeLists();
      const head = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(tableCells(lines[i++]));
      i--;
      const cell = (tag: string, c: string) => `<${tag} style="border:1px solid #999;padding:4px 8px">${inline(c)}</${tag}>`;
      out.push(
        '<table style="border-collapse:collapse">' +
          `<tr>${head.map((c) => cell('th', c)).join('')}</tr>` +
          rows.map((r) => `<tr>${head.map((_, j) => cell('td', r[j] ?? '')).join('')}</tr>`).join('') +
          '</table>'
      );
    } else if (heading) {
      closeLists();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item) {
      const indent = item[1].replace(/\t/g, '    ').length;
      const kind: 'ul' | 'ol' = item[2] ? 'ul' : 'ol';
      // Pop lists that are deeper than this item.
      while (lists.length && indent < lists[lists.length - 1].indent) closeLists(lists.length - 1);
      const top = lists[lists.length - 1];
      if (!top || indent > top.indent) {
        if (top) out.push(''); // nested list goes inside the open <li>
        out.push(`<${kind}><li>${listText(item[4])}`);
        lists.push({ kind, indent });
      } else if (top.kind !== kind) {
        closeLists(lists.length - 1);
        out.push(`<${kind}><li>${listText(item[4])}`);
        lists.push({ kind, indent });
      } else {
        out.push(`</li><li>${listText(item[4])}`);
      }
    } else if (/^\s*>/.test(line)) {
      closeLists();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      i--;
      out.push(
        `<p style="margin-left:24pt;border-left:3px solid #999;padding-left:8pt;font-style:italic">${quote
          .map(inline)
          .join('<br>')}</p>`
      );
    } else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeLists();
      out.push('<hr>');
    } else if (!line.trim()) {
      closeLists();
    } else {
      closeLists();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeLists();
  return `<html><head><meta charset="utf-8"></head><body>${out.join('\n')}</body></html>`;
}

/** Drops headings left with nothing under them and repeated dividers. */
export function tidySections(md: string): string {
  // Repeat so a heading whose only child section was empty also goes.
  let prev = md.replace(/\r/g, '');
  for (let pass = 0; pass < 4; pass++) {
    const next = tidyOnce(prev);
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

function tidyOnce(md: string): string {
  const lines = md.split('\n');
  const isHr = (l: string) => /^\s*(---|\*\*\*|___)\s*$/.test(l);
  const level = (l: string) => (l.match(/^(#{1,6})\s+\S/) || [])[1]?.length ?? 0;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lv = level(lines[i]);
    if (lv > 1) {
      let j = i + 1;
      while (j < lines.length && (!lines[j].trim() || isHr(lines[j]))) j++;
      const next = j < lines.length ? level(lines[j]) : 1;
      if (next && next <= lv) continue; // empty section
    }
    if (isHr(lines[i])) {
      let k = out.length - 1;
      while (k >= 0 && !out[k].trim()) k--;
      if (k < 0 || isHr(out[k])) continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---- Academic honesty guard ----

const GRADED_WORK =
  /\b(essay|internal assessment|extended essay|\bIA\b|\bEE\b|TOK|lab report|coursework|summative|formative|criterion [a-d]|portfolio|commentary|written (task|assignment|piece)|writing (task|assessment|summative))/i;

export function isGradedWriting(taskText: string): boolean {
  return GRADED_WORK.test(taskText);
}

const MODEL_ANSWER_HEADING =
  /\b(model|sample|exemplar)\b|worked[\s-]+example|\b(example|finished|full)\b[^\n]*\b(answer|paragraph|essay|response|draft|text|piece|introduction|conclusion)s?\b/i;
export const INTEGRITY_NOTE =
  "TaskTrack helps you plan and improve your own writing; it won't write the graded piece.";

/**
 * For graded writing, removes any section that is a ready-made answer ("Example Paragraph",
 * "Model answer", "Sample essay"…) and any quoted block of two or more sentences, in case the
 * AI ignores the prompt. The student's own sections are not touched unless they carry one of
 * those headings.
 */
export function stripModelAnswers(md: string): { md: string; removed: boolean } {
  const lines = md.replace(/\r/g, '').split('\n');
  const kept: string[] = [];
  let removed = false;
  let skipUntilLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (skipUntilLevel) {
      if (h && h[1].length <= skipUntilLevel) skipUntilLevel = 0;
      else continue;
    }
    if (h && h[1].length > 1 && MODEL_ANSWER_HEADING.test(h[2])) {
      skipUntilLevel = h[1].length;
      removed = true;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const block: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) block.push(lines[i++]);
      i--;
      const sentences = block.join(' ').replace(/^\s*>\s?/gm, '').split(/[.!?¡¿]+\s/).filter((s) => s.trim().length > 12);
      if (sentences.length >= 2) {
        removed = true;
        continue;
      }
      kept.push(...block);
      continue;
    }
    kept.push(line);
  }
  let out = tidySections(kept.join('\n'));
  if (removed && !out.includes(INTEGRITY_NOTE)) out += `\n\n---\n\n*${INTEGRITY_NOTE}*`;
  return { md: out, removed };
}
