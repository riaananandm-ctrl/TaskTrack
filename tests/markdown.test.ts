import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from '../components/markdown-renderer';

describe('parseMarkdownBlocks', () => {
  it('keeps quiz numbering across answer options', () => {
    const quiz = [
      '1. Which group contains the noble gases?',
      'A) Group 1',
      'B) Group 18',
      '1. Moving across a period, the atomic radius:',
      'A) Increases',
      'B) Decreases',
      '3. Which of these is not a metalloid?',
      'A) Silicon',
    ].join('\n');
    const values = parseMarkdownBlocks(quiz)
      .filter((b) => b.type === 'ol')
      .flatMap((b) => (b.type === 'ol' ? b.items.map((item) => item.value) : []));
    expect(values).toEqual([1, 2, 3]);
  });

  it('keeps the numbers of an ordinary list', () => {
    const blocks = parseMarkdownBlocks('1. One\n2. Two\n3. Three');
    expect(blocks).toEqual([
      { type: 'ol', items: [{ value: 1, text: 'One' }, { value: 2, text: 'Two' }, { value: 3, text: 'Three' }] },
    ]);
  });

  it('starts a new list at 1 after a normal paragraph', () => {
    const blocks = parseMarkdownBlocks('1. First\n2. Second\nNow the next steps:\n1. Again');
    const last = blocks[blocks.length - 1];
    expect(last).toEqual({ type: 'ol', items: [{ value: 1, text: 'Again' }] });
  });

  it('parses a table', () => {
    const md = [
      '| Question | Your answer | Correct? |',
      '|----------|-------------|----------|',
      '| 1 | **B** | ✓ |',
      '| 2 | C | ✓ |',
      '',
      '**Score:** 2/2',
    ].join('\n');
    const blocks = parseMarkdownBlocks(md);
    expect(blocks[0]).toEqual({
      type: 'table',
      header: ['Question', 'Your answer', 'Correct?'],
      rows: [['1', '**B**', '✓'], ['2', 'C', '✓']],
    });
    expect(blocks[1]).toEqual({ type: 'p', text: '**Score:** 2/2' });
  });

  it('treats --- as a divider, not text', () => {
    expect(parseMarkdownBlocks('Above\n---\nBelow')).toEqual([
      { type: 'p', text: 'Above' },
      { type: 'hr' },
      { type: 'p', text: 'Below' },
    ]);
  });

  it('leaves a line with pipes but no separator as text', () => {
    expect(parseMarkdownBlocks('| not a table |')).toEqual([{ type: 'p', text: '| not a table |' }]);
  });
});
