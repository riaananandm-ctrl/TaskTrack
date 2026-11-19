import { describe, expect, it } from 'vitest';
import {
  INTEGRITY_NOTE,
  isGradedWriting,
  markdownToHtml,
  stripModelAnswers,
  tidySections,
} from '../supabase/functions/google-docs/format';

describe('markdownToHtml', () => {
  it('turns pipe tables into real tables', () => {
    const html = markdownToHtml('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table');
    expect(html).toContain('>A</th>');
    expect(html).toContain('>2</td>');
    expect(html).not.toContain('|');
  });

  it('nests indented bullets inside their parent item', () => {
    const html = markdownToHtml('- Nouns\n  - el aula\n  - la mochila\n- Verbs');
    expect(html.replace(/\s+/g, '')).toBe(
      '<html><head><metacharset="utf-8"></head><body><ul><li>Nouns<ul><li>elaula</li><li>lamochila</li></ul></li><li>Verbs</li></ul></body></html>'
    );
  });

  it('renders quotes, tick boxes and escapes html', () => {
    const html = markdownToHtml('> a <b> quote\n\n- [ ] todo\n- [x] done');
    expect(html).toContain('border-left');
    expect(html).toContain('a &lt;b&gt; quote');
    expect(html).toContain('☐ todo');
    expect(html).toContain('☑ done');
  });
});

describe('academic honesty guard', () => {
  it('spots graded writing tasks', () => {
    expect(isGradedWriting('Title: Criterion D - Writing Summative')).toBe(true);
    expect(isGradedWriting('Title: History IA draft')).toBe(true);
    expect(isGradedWriting('Title: Unit 3 vocab quiz')).toBe(false);
  });

  it('removes model answer sections and long quoted answers', () => {
    const md = [
      '# Task',
      '## Outline',
      '- intro idea',
      '## Example Paragraph (model)',
      'Yo llego a la escuela a las ocho. En el aula estudio.',
      '## Mini-Worked Example',
      '> Yo llego a la escuela a las ocho. En el aula estudio español cada día.',
      '## Checklist',
      '- [ ] six vocab items',
    ].join('\n');
    const { md: out, removed } = stripModelAnswers(md);
    expect(removed).toBe(true);
    expect(out).not.toMatch(/Yo llego/);
    expect(out).not.toMatch(/Example Paragraph|Worked Example/);
    expect(out).toContain('## Outline');
    expect(out).toContain('## Checklist');
    expect(out).toContain(INTEGRITY_NOTE);
  });

  it('keeps short quotes and normal notes untouched', () => {
    const md = '# T\n## Notes\n> Short quote\n- point';
    expect(stripModelAnswers(md)).toEqual({ md, removed: false });
  });
});

describe('tidySections', () => {
  it('drops empty sections and repeated dividers', () => {
    const out = tidySections('# A\n## Keep\ntext\n---\n## Empty\n---\n### Also empty\n## Last\nx');
    expect(out).toBe('# A\n## Keep\ntext\n---\n## Last\nx');
  });
});
