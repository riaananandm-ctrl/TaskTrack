import React from 'react';

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const italicMatch = remaining.match(/\*(.+?)\*/);
    const codeMatch = remaining.match(/`(.+?)`/);

    const matches = [
      { match: boldMatch, type: 'bold', delimiter: '**' },
      { match: italicMatch, type: 'italic', delimiter: '*' },
      { match: codeMatch, type: 'code', delimiter: '`' },
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

export function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let keyIdx = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = [...listItems];
    const type = listType;
    blocks.push(
      type === 'ol' ? (
        <ol key={`list-${keyIdx++}`} className="ml-5 space-y-1 list-decimal list-inside">
          {items.map((item, i) => (
            <li key={i} className="text-sm leading-relaxed">{renderInline(item, `ol-${keyIdx}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`list-${keyIdx++}`} className="ml-1 space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-sm leading-relaxed flex gap-2">
              <span className="text-primary flex-shrink-0 mt-0.5">•</span>
              <span>{renderInline(item, `ul-${keyIdx}-${i}`)}</span>
            </li>
          ))}
        </ul>
      )
    );
    listItems = [];
    listType = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      flushList();
      continue;
    }

    const ulMatch = trimmed.match(/^[-*]\s+(.+)/);
    const olMatch = trimmed.match(/^\d+\.\s+(.+)/);
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);

    if (ulMatch) {
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(ulMatch[1]);
      continue;
    }

    if (olMatch) {
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(olMatch[1]);
      continue;
    }

    flushList();

    if (headingMatch) {
      blocks.push(
        <p key={`h-${keyIdx++}`} className="font-semibold text-sm text-foreground mt-1">
          {renderInline(headingMatch[1], `h-${keyIdx}`)}
        </p>
      );
      continue;
    }

    blocks.push(
      <p key={`p-${keyIdx++}`} className="text-sm leading-relaxed">
        {renderInline(trimmed, `p-${keyIdx}`)}
      </p>
    );
  }

  flushList();

  return <div className="space-y-2">{blocks}</div>;
}
