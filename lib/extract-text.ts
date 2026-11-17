/**
 * Reads the text out of a student's file in the browser, so it can be graded.
 * The file is never uploaded or stored: only the extracted text goes into the
 * AI Grader form, exactly as if the student had pasted it.
 *
 * Supported: Word (.docx), PDF (with selectable text), and plain text (.txt, .md).
 * Google Docs: File → Download → Microsoft Word (.docx) or PDF.
 */

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const ACCEPT = '.docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

export class ExtractError extends Error {}

export function fileKind(name: string): 'docx' | 'pdf' | 'text' | 'doc' | 'other' {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'docx') return 'docx';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'txt' || ext === 'md') return 'text';
  if (ext === 'doc') return 'doc';
  return 'other';
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Turns Word's document.xml into plain text: one line per paragraph, tabs and breaks kept. */
export function docxXmlToText(xml: string): string {
  const body = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, ''); // tracked deletions aren't part of the text
  const token = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>/g;
  const lines = body.split(/<\/w:p>/).map((p) => {
    let line = '';
    for (const m of Array.from(p.matchAll(token))) {
      if (m[1] !== undefined) line += m[1];
      else if (m[0].startsWith('<w:tab')) line += '\t';
      else line += '\n';
    }
    return decodeEntities(line);
  });
  return tidy(lines.join('\n'));
}

/** Collapses runs of blank lines and trailing spaces. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * PDF lines are visual wraps, so join them back into paragraphs. An empty line, or a
 * short line ending in sentence punctuation followed by a new line, starts a new paragraph.
 */
export function joinPdfLines(lines: string[]): string {
  const paras: string[] = [];
  let cur = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (cur) paras.push(cur);
      cur = '';
      continue;
    }
    if (cur.endsWith('-') && /^[a-z]/.test(line)) cur = cur.slice(0, -1) + line; // hyphenated word split across lines
    else cur = cur ? `${cur} ${line}` : line;
    if (raw.length < 40 && /[.!?:]$/.test(line)) {
      paras.push(cur);
      cur = '';
    }
  }
  if (cur) paras.push(cur);
  return paras.join('\n\n');
}

async function readDocx(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new ExtractError('This Word file couldn’t be opened. It may be damaged. Try saving it again as .docx.');
  }
  const doc = zip.file('word/document.xml');
  if (!doc) throw new ExtractError('This doesn’t look like a Word document. Save it as .docx and try again.');
  return docxXmlToText(await doc.async('string'));
}

async function readPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'PasswordException') throw new ExtractError('This PDF is password-protected. Remove the password and try again.');
    throw new ExtractError('This PDF couldn’t be opened. It may be damaged.');
  }
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const out: string[] = [];
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      if (typeof item.str !== 'string') continue;
      line += item.str;
      if (item.hasEOL) {
        out.push(line);
        line = '';
      }
    }
    if (line) out.push(line);
    pages.push(joinPdfLines(out));
  }
  const text = tidy(pages.join('\n\n'));
  if (text.replace(/\s/g, '').length < 20) {
    throw new ExtractError('This PDF has no selectable text. It looks like a scan or photo, which can’t be read yet.');
  }
  return text;
}

/** Extracts the text from a supported file. Throws ExtractError with a student-friendly message. */
export async function extractText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new ExtractError('That file is over 15 MB. Try a smaller copy.');
  const kind = fileKind(file.name);
  if (kind === 'doc') throw new ExtractError('Old .doc files aren’t supported. Open it in Word or Google Docs and save it as .docx.');
  if (kind === 'other') throw new ExtractError('Upload a Word (.docx), PDF or text file. For Google Docs: File → Download → .docx.');
  const text = kind === 'docx' ? await readDocx(file) : kind === 'pdf' ? await readPdf(file) : tidy(await file.text());
  if (!text.trim()) throw new ExtractError('No text was found in that file.');
  return text;
}
