/**
 * Local test harness for the PDF extractor and the extraction limits.
 * Run: node scripts/test-pdf-extract.mjs
 * Synthetic PDFs are generated in-memory: plain, flate-compressed, encrypted,
 * image-only (scanned-like), and corrupt. No network, no database.
 */
import { extractPdfPages, pdfPagesToChunks } from '../supabase/functions/documents-worker/pdf-extract.ts';

function latin1(s) {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

async function deflate(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

/** Build a valid multi-page PDF with the given per-page content-stream bytes. */
async function buildPdf(pageStreams, { compress = false, encrypt = false } = {}) {
  const objects = [];
  let nextNum = 1;
  const pageObjNums = [];
  const contentObjNums = [];

  const catalogNum = nextNum++;
  const pagesNum = nextNum++;

  for (const stream of pageStreams) {
    const contentNum = nextNum++;
    contentObjNums.push(contentNum);
    const payload = compress ? await deflate(stream) : latin1(stream);
    const filter = compress ? '/Filter /FlateDecode ' : '';
    objects.push({
      num: contentNum,
      body: `<< ${filter}/Length ${payload.length} >>\nstream\n`,
      stream: payload,
    });
  }

  const kids = contentObjNums
    .map((_, i) => {
      const pageNum = nextNum++;
      pageObjNums.push(pageNum);
      return { pageNum, contentNum: contentObjNums[i] };
    });

  objects.push({
    num: catalogNum,
    body: `<< /Type /Catalog /Pages ${pagesNum} 0 R >>\nendobj\n`,
    stream: null,
  });

  const kidsRefs = kids.map((k) => `${k.pageNum} 0 R`).join(' ');
  objects.push({
    num: pagesNum,
    body: `<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${kids.length} >>\nendobj\n`,
    stream: null,
  });

  for (const k of kids) {
    objects.push({
      num: k.pageNum,
      body: `<< /Type /Page /Parent ${pagesNum} 0 R /Contents ${k.contentNum} 0 R /Resources << >> >>\nendobj\n`,
      stream: null,
    });
  }

  if (encrypt) {
    const encNum = nextNum++;
    objects.push({
      num: encNum,
      body: `<< /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -1 >>\nendobj\n`,
      stream: null,
    });
    objects[0] = objects[0]; // catalog stays first
    // Point trailer at it by adding /Encrypt to catalog dict textually below.
    const catalog = objects.find((o) => o.num === catalogNum);
    catalog.body = `<< /Type /Catalog /Pages ${pagesNum} 0 R /Encrypt ${encNum} 0 R >>\nendobj\n`;
  }

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (const obj of objects) {
    offsets[obj.num] = out.length;
    out += `${obj.num} 0 obj\n${obj.body}`;
    if (obj.stream) {
      out += obj.stream.map ? String.fromCharCode(...obj.stream) : obj.stream;
      out += '\nendstream\nendobj\n';
    } else {
      // body already ends with endobj
    }
  }
  const xrefStart = out.length;
  const maxNum = objects.length + 1;
  out += `xref\n0 ${maxNum}\n0000000000 65535 f \n`;
  for (let n = 1; n < maxNum; n += 1) {
    out += `${pad(offsets[n] ?? 0, 10)} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${maxNum} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return latin1(out);
}

const assert = (cond, name) => {
  if (!cond) { console.error('FAIL:', name); process.exitCode = 1; }
  else console.log('PASS:', name);
};

// --- 1. Plain multi-page PDF: text + real page numbers ---
{
  const pdf = await buildPdf([
    'BT /F1 12 Tf 72 720 Td (Chapter 1: Photosynthesis) Tj T* (Light energy becomes sugar.) Tj ET',
    'BT /F1 12 Tf 72 720 Td (Chapter 2: Respiration) Tj T* (Sugar releases energy.) Tj ET',
  ]);
  const res = await extractPdfPages(pdf);
  assert(res.ok, 'plain pdf parses');
  if (res.ok) {
    assert(res.pages.length === 2, 'two pages found');
    assert(res.pages[0].page === 1 && res.pages[1].page === 2, 'page numbers are 1-based sequential');
    assert(res.pages[0].text.includes('Photosynthesis'), 'page 1 text extracted');
    assert(res.pages[1].text.includes('Respiration'), 'page 2 text extracted');
    const chunks = pdfPagesToChunks(res.pages, 40);
    assert(chunks.length >= 2, 'chunks produced');
    assert(chunks.some((c) => c.p === 1) && chunks.some((c) => c.p === 2), 'chunks carry real page refs');
  }
}

// --- 2. Flate-compressed content streams ---
{
  const pdf = await buildPdf(
    ['BT /F1 12 Tf 72 700 Td (Compressed page text about mitosis) Tj ET'],
    { compress: true }
  );
  const res = await extractPdfPages(pdf);
  assert(res.ok, 'flate pdf parses');
  if (res.ok) assert(res.pages[0].text.includes('mitosis'), 'flate text extracted');
}

// --- 3. Encrypted PDF: specific error ---
{
  const pdf = await buildPdf(['BT (secret) Tj ET'], { encrypt: true });
  const res = await extractPdfPages(pdf);
  assert(!res.ok && res.code === 'ENCRYPTED_PDF', 'encrypted PDF rejected with ENCRYPTED_PDF');
}

// --- 4. Scanned-like (image-only, no text ops): specific error ---
{
  const pdf = await buildPdf(['q 100 0 0 100 50 50 cm /Im0 Do Q']);
  const res = await extractPdfPages(pdf);
  assert(!res.ok && res.code === 'SCANNED_PDF_NO_TEXT', 'image-only PDF rejected with SCANNED_PDF_NO_TEXT');
}

// --- 5. Corrupt / not a PDF ---
{
  const res = await extractPdfPages(latin1('this is not a pdf at all'));
  assert(!res.ok && res.code === 'CORRUPT_PDF', 'garbage rejected with CORRUPT_PDF');
}

// --- 6. Word/document-style text with TJ arrays and escapes ---
{
  const pdf = await buildPdf([
    'BT /F1 12 Tf 72 720 Td [(TJ array) -250 (with kerning)] TJ T* (escapes \\(nested\\) work) Tj ET',
  ]);
  const res = await extractPdfPages(pdf);
  assert(res.ok, 'TJ/escape pdf parses');
  if (res.ok) {
    assert(res.pages[0].text.includes('TJ array'), 'TJ array text extracted');
    assert(res.pages[0].text.includes('kerning'), 'TJ second element extracted');
    assert(res.pages[0].text.includes('(nested)'), 'escaped parens extracted');
  }
}

// --- 7. Size ceiling ---
{
  const big = new Uint8Array(30_000_000);
  big[0] = 0x25; big[1] = 0x50; // "%P"
  const res = await extractPdfPages(big);
  assert(!res.ok && res.code === 'PDF_TOO_LARGE', 'oversize input rejected with PDF_TOO_LARGE');
}

// --- 8. Runtime: 20-page flate PDF extraction time and chunk counts ---
{
  const pages = [];
  for (let i = 0; i < 20; i += 1) {
    const line = `Page ${i + 1} discusses topic ${i + 1} with substantial text. `;
    pages.push(`BT /F1 12 Tf 72 720 Td (${line.repeat(30)}) Tj ET`);
  }
  const pdf = await buildPdf(pages, { compress: true });
  const t0 = Date.now();
  const res = await extractPdfPages(pdf);
  const ms = Date.now() - t0;
  assert(res.ok, '20-page flate pdf parses');
  if (res.ok) {
    const chunks = pdfPagesToChunks(res.pages);
    console.log(`20 pages, ${pdf.length} bytes: ${ms} ms, ${chunks.length} chunks, ${res.pages.reduce((s, p) => s + p.text.length, 0)} chars`);
    assert(ms < 5000, `extraction under 5s (${ms} ms)`);
  }
}

console.log(process.exitCode ? 'SOME TESTS FAILED' : 'ALL TESTS PASSED');
