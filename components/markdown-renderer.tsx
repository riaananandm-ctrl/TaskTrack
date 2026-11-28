import React from 'react';

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/\*(.+?)\*/);
    const codeMatch = remaining.match(/`(.+?)`/);
    // Only https links are turned into anchors, so nothing else (javascript: and so on) is clickable.
    const linkMatch = remaining.match(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/);

    const matches = [
      { match: boldMatch, type: 'bold', delimiter: '**' },
      { match: italicMatch, type: 'italic', delimiter: '*' },
      { match: codeMatch, type: 'code', delimiter: '`' },
      { match: linkMatch, type: 'link', delimiter: '' },
    ].filter((m) => m.match !== null && m.match.index !== undefined);

    if (matches.length === 0) {
      nodes.push(remaining);
      break;
    }

    matches.sort((a, b) => (a.match!.index! - b.match!.index!));
    const first = matches[0];
    const idx = first.match!.index!;
    const fullMatch = first.match![0];
    const inner = first.match![1];

    if (idx > 0) {
      nodes.push(remaining.slice(0, idx));
    }

    if (first.type === 'bold') {
      nodes.push(<strong key={`${keyPrefix}-${keyIdx++}`} className="font-semibold text-foreground">{inner}</strong>);
    } else if (first.type === 'italic') {
      nodes.push(<em key={`${keyPrefix}-${keyIdx++}`} className="italic">{inner}</em>);
    } else if (first.type === 'link') {
      nodes.push(
        <a
          key={`${keyPrefix}-${keyIdx++}`}
          href={first.match![2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
        >
          {inner}
        </a>
      );
    } else if (first.type === 'code') {
      nodes.push(
        <code key={`${keyPrefix}-${keyIdx++}`} className="px-1.5 py-0.5 rounded bg-muted text-foreground text-[0.85em] font-mono">
          {inner}
        </code>
      );
    }

    remaining = remaining.slice(idx + fullMatch.length);
  }

  return nodes;
}

export type MarkdownBlock =
  | { type: 'p'; text: string }
  | { type: 'heading'; text: string }
  | { type: 'hr' }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: { value: number; text: string }[] }
  | { type: 'table'; header: string[]; rows: string[][] };

/** Answer options under a quiz question, e.g. "A) Silicon" or "b. Arsenic". */
const OPTION_LINE = /^[A-Ha-h][).]\s+/;
const TABLE_SEPARATOR = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

/**
 * Split markdown into blocks. Numbered lists keep the numbers the AI wrote, and a
 * quiz whose questions are separated by answer options ("1. …", "A) …", "2. …")
 * keeps counting instead of restarting at 1 for every question.
 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.split('\n');
  const blocks: MarkdownBlock[] = [];
  let list: MarkdownBlock & { type: 'ul' | 'ol' } | null = null;
  // Last number used in a numbered list; 0 once the list has clearly ended.
  let lastOl = 0;

  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed === '') {
      flushList();
      continue;
    }

    // Table: a row of cells followed by a |---|---| separator line.
    if (trimmed.startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1].trim())) {
      flushList();
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      i--;
      blocks.push({ type: 'table', header, rows });
      lastOl = 0;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      blocks.push({ type: 'hr' });
      lastOl = 0;
      continue;
    }

    const ulMatch = trimmed.match(/^[-*]\s+(.+)/);
    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)/);

    if (ulMatch) {
      if (list && list.type !== 'ul') flushList();
      if (!list) list = { type: 'ul', items: [] };
      (list as { items: string[] }).items.push(ulMatch[1]);
      continue;
    }

    if (olMatch) {
      if (list && list.type !== 'ol') flushList();
      if (!list) list = { type: 'ol', items: [] };
      const written = parseInt(olMatch[1], 10);
      // Keep counting when the AI restarts at 1 (or repeats a number) mid-list.
      const value = lastOl > 0 && written <= lastOl ? lastOl + 1 : written;
      (list as { items: { value: number; text: string }[] }).items.push({ value, text: olMatch[2] });
      lastOl = value;
      continue;
    }

    flushList();

    if (headingMatch) {
      blocks.push({ type: 'heading', text: headingMatch[1] });
      lastOl = 0;
      continue;
    }

    // Answer options belong to the question above, so the numbering carries on.
    if (!OPTION_LINE.test(trimmed)) lastOl = 0;
    blocks.push({ type: 'p', text: trimmed });
  }

  flushList();
  return blocks;
}

export function MarkdownRenderer({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content).map((block, b) => {
    const key = `b-${b}`;
    switch (block.type) {
      case 'heading':
        return (
          <p key={key} className="font-semibold text-sm text-foreground mt-1">
            {renderInline(block.text, key)}
          </p>
        );
      case 'hr':
        return <hr key={key} className="border-border" />;
      case 'ul':
        return (
          <ul key={key} className="ml-1 space-y-1">
            {block.items.map((item, i) => (
              <li key={i} className="text-sm leading-relaxed flex gap-2">
                <span className="text-primary flex-shrink-0 mt-0.5">•</span>
                <span>{renderInline(item, `${key}-${i}`)}</span>
              </li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={key} className="ml-5 space-y-1 list-decimal list-outside">
            {block.items.map((item, i) => (
              <li key={i} value={item.value} className="text-sm leading-relaxed pl-1">
                {renderInline(item.text, `${key}-${i}`)}
              </li>
            ))}
          </ol>
        );
      case 'table':
        return (
          <div key={key} className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-muted/60">
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={c} className="px-3 py-2 text-left font-semibold text-foreground border-b border-border">
                      {renderInline(cell, `${key}-h${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-b border-border last:border-b-0">
                    {row.map((cell, c) => (
                      <td key={c} className="px-3 py-2 align-top">
                        {renderInline(cell, `${key}-${r}-${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return (
          <p key={key} className="text-sm leading-relaxed">
            {renderInline(block.text, key)}
          </p>
        );
    }
  });

  return <div className="space-y-2">{blocks}</div>;
}
