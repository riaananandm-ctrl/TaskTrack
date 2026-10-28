/**
 * Minimal PDF text-layer extractor with real page references.
 *
 * Parses the PDF object structure directly (no external parser): finds page
 * objects, resolves their order through the /Pages tree, inflates
 * FlateDecode content streams, and interprets the text-showing operators
 * (Tj, TJ, ', ") per page. Pure web-standard APIs only, so it runs unchanged
 * in the Deno edge runtime and under Node for local tests.
 *
 * Deliberate limits, verified by tests:
 *  - Text-layer PDFs only. A PDF whose pages carry no selectable text
 *    (scans, images) is reported as SCANNED_PDF_NO_TEXT, never guessed at.
 *  - Encrypted PDFs are detected via /Encrypt and rejected up front.
 *  - Not a real PDF / damaged structure is CORRUPT_PDF.
 *  - Inputs above MAX_PARSE_BYTES are rejected as PDF_TOO_LARGE rather than
 *    risking the worker's memory.
 */

export type PdfExtractResult =
  | { ok: true; pages: Array<{ page: number; text: string }> }
  | {
      ok: false;
      code:
        | 'ENCRYPTED_PDF'
        | 'CORRUPT_PDF'
        | 'SCANNED_PDF_NO_TEXT'
        | 'PDF_TOO_LARGE'
        | 'UNREADABLE_TEXT';
    };

/** Parsing ceiling for the raw PDF structure (bytes). */
export const MAX_PARSE_BYTES = 20_000_000;

/** Workers decode binary structure in latin1 so offsets and keywords align. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    // PDF FlateDecode is zlib (header 0x78). Some producers emit raw deflate
    // without the zlib wrapper, so fall back to that.
    let stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    try {
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      stream = new Blob([data as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    }
  } catch {
    return null;
  }
}

interface PdfObject {
  num: number;
  dict: string; // latin1 dictionary text (<< ... >>)
  body: string; // latin1 object body
}

/**
 * Parse objects bounded by "N G obj" ... "endobj". Objects appear in ascending
 * byte order, so each object's true extent ends where the NEXT object begins;
 * "endobj" can be missing in damaged files and binary stream data may itself
 * contain text that looks like an object header. Both are handled by scanning
 * headers in order and treating each object's data as running to the next
 * header (or end of file) rather than trusting "endobj" blindly.
 */
function parseObjects(raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const headerRe = /(\d+)\s+(\d+)\s+obj\b/g;
  const starts: Array<{ num: number; index: number; headerLen: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(raw)) !== null) {
    starts.push({ num: Number(match[1]), index: match.index, headerLen: match[0].length });
    if (starts.length > 200_000) break;
  }
  for (let i = 0; i < starts.length; i += 1) {
    const { num, index, headerLen } = starts[i];
    const nextStart = i + 1 < starts.length ? starts[i + 1].index : raw.length;
    const body = raw.slice(index + headerLen, nextStart);
    const dictStart = body.indexOf('<<');
    const dictEnd = body.lastIndexOf('>>');
    const dict = dictStart !== -1 && dictEnd > dictStart ? body.slice(dictStart, dictEnd + 2) : '';
    objects.set(num, { num, dict, body });
  }
  return objects;
}

/** Page order via the /Pages tree; falls back to object order. */
function orderedPageNums(objects: Map<number, PdfObject>): number[] {
  const pagesObjs = [...objects.values()].filter(
    (o) => /\/Type\s*\/Pages\b/.test(o.dict) && !/\/Type\s*\/Page\b/.test(o.dict)
  );
  const pageObjs = [...objects.values()].filter(
    (o) => /\/Type\s*\/Page\b/.test(o.dict) && !/\/Type\s*\/Pages\b/.test(o.dict)
  );
  if (pageObjs.length === 0) return [];

  const kidsOf = new Map<number, number[]>();
  const referenced = new Set<number>();
  for (const o of pagesObjs) {
    const kids: number[] = [];
    const kidsMatch = /\/Kids\s*\[([^\]]*)\]/.exec(o.dict);
    if (kidsMatch) {
      const refRe = /(\d+)\s+\d+\s+R/g;
      let ref: RegExpExecArray | null;
      while ((ref = refRe.exec(kidsMatch[1])) !== null) {
        kids.push(Number(ref[1]));
        referenced.add(Number(ref[1]));
      }
    }
    kidsOf.set(o.num, kids);
  }

  const root = pagesObjs.find((o) => !referenced.has(o.num));
  const ordered: number[] = [];
  const seen = new Set<number>();
  const walk = (num: number, depth: number) => {
    if (depth > 64 || seen.has(num)) return;
    seen.add(num);
    const kids = kidsOf.get(num);
    if (kids) {
      for (const kid of kids) walk(kid, depth + 1);
      return;
    }
    const obj = objects.get(num);
    if (obj && /\/Type\s*\/Page\b/.test(obj.dict) && !/\/Type\s*\/Pages\b/.test(obj.dict)) {
      ordered.push(num);
    }
  };
  if (root) walk(root.num, 0);
  // Any page object the tree missed (malformed /Pages) still appears, in object order.
  if (ordered.length < pageObjs.length) {
    for (const o of pageObjs) {
      if (!ordered.includes(o.num)) ordered.push(o.num);
    }
  }
  return ordered;
}

/** Content stream object numbers for one page, in order. */
function contentRefs(pageDict: string): number[] {
  const refs: number[] = [];
  const single = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(pageDict);
  if (single) {
    refs.push(Number(single[1]));
    return refs;
  }
  const array = /\/Contents\s*\[([^\]]*)\]/.exec(pageDict);
  if (array) {
    const refRe = /(\d+)\s+\d+\s+R/g;
    let ref: RegExpExecArray | null;
    while ((ref = refRe.exec(array[1])) !== null) refs.push(Number(ref[1]));
  }
  return refs;
}

/** Raw stream bytes of an object (between `stream` and `endstream`). */
function streamBytes(raw: string, objects: Map<number, PdfObject>, obj: PdfObject): Uint8Array | null {
  const streamStart = obj.body.indexOf('stream');
  if (streamStart === -1) return null;
  let dataStart = streamStart + 'stream'.length;
  if (obj.body[dataStart] === '\r') dataStart += 1;
  if (obj.body[dataStart] === '\n') dataStart += 1;
  const end = obj.body.indexOf('endstream', dataStart);
  if (end === -1) return null;
  let slice = obj.body.slice(dataStart, end);

  // /Length may be a direct integer OR an indirect reference ("3 0 R"), which is
  // the common form in real producers (pdf-lib, Apple, InDesign). Distinguish
  // the two in one match: a trailing "N 0 R" means the value is the object
  // number of the length object, not the length itself.
  const lenMatch = /\/Length\s+(\d+)(?:\s+\d+\s+R)?/.exec(obj.dict);
  if (lenMatch) {
    const isIndirect = /\/Length\s+\d+\s+\d+\s+R/.test(obj.dict);
    if (isIndirect) {
      const lenObj = objects.get(Number(lenMatch[1]));
      const lenVal = lenObj ? /^\s*(\d+)/.exec(lenObj.body) : null;
      if (lenVal) {
        slice = slice.slice(0, Number(lenVal[1]));
      } else {
        // Unresolvable length: a trailing newline before endstream still breaks
        // zlib, so trim a single trailing EOL conservatively.
        slice = slice.replace(/\r?$/, '');
      }
    } else {
      slice = slice.slice(0, Number(lenMatch[1]));
    }
  } else {
    slice = slice.replace(/\r?$/, '');
  }

  const bytes = new Uint8Array(slice.length);
  for (let i = 0; i < slice.length; i += 1) bytes[i] = slice.charCodeAt(i) & 0xff;
  return bytes;
}

/** Decode a PDF literal string body (between unescaped parens) to text. */
function decodeLiteral(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) {
      const next = body[i + 1];
      if (next === 'n') { out += '\n'; i += 1; }
      else if (next === 'r') { out += '\n'; i += 1; }
      else if (next === 't') { out += '\t'; i += 1; }
      else if (next === 'b' || next === 'f') { i += 1; }
      else if (next >= '0' && next <= '7') {
        // Up to three octal digits.
        let oct = next;
        i += 1;
        while (oct.length < 3 && i < body.length && body[i] >= '0' && body[i] <= '7') {
          oct += body[i];
          i += 1;
        }
        i -= 1;
        out += String.fromCharCode(parseInt(oct, 8));
      } else { out += next; i += 1; }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Decode a hex string body to text (latin1 semantics). */
function decodeHex(body: string): string {
  const clean = body.replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

interface EncodingMap {
  /** byte code -> unicode string (subset fonts map 1-2 byte codes) */
  single: Map<number, string>;
  /** 2-byte code prefix -> unicode ( Identity to-Unicode ranges) */
  twoByte: Map<number, string>;
  /** true when the font's strings are raw 2-byte UCS-2 (no CMap needed) */
  identity: boolean;
}

function emptyEncoding(): EncodingMap {
  return { single: new Map(), twoByte: new Map(), identity: false };
}

/**
 * Parse a ToUnicode CMap stream (bfchar + bfrange sections) into a byte-code
 * to unicode mapping. Handles <01> <0044> pairs and <start> <end> <begin|
dstStart> ranges; malformed sections are skipped rather than fatal.
 */
function parseCMap(text: string, enc: EncodingMap): void {
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  let sec: RegExpExecArray | null;
  while ((sec = bfchar.exec(text)) !== null) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let pair: RegExpExecArray | null;
    while ((pair = pairRe.exec(sec[1])) !== null) {
      const code = parseInt(pair[1], 16);
      const hex = pair[2];
      let uni = '';
      for (let i = 0; i + 3 < hex.length + 1 && i + 3 <= hex.length; i += 4) {
        const cp = parseInt(hex.slice(i, i + 4), 16);
        if (Number.isNaN(cp)) continue;
        uni += String.fromCharCode(cp);
      }
      if (pair[1].length <= 2) enc.single.set(code, uni);
      else enc.twoByte.set(code, uni);
    }
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;  while ((sec = bfrange.exec(text)) !== null) {
    // Range forms: <lo> <hi> <dst> or <lo> <hi> [<map1> <map2> ...]
    const rangeRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g;
    let range: RegExpExecArray | null;
    while ((range = rangeRe.exec(sec[1])) !== null) {
      const lo = parseInt(range[1], 16);
      const hi = parseInt(range[2], 16);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi - lo > 65535) continue;
      const dst = range[3];
      if (dst.startsWith('[')) {
        const items = dst.slice(1, -1).match(/<[0-9a-fA-F]+>/g) ?? [];
        for (let i = 0; i < items.length && lo + i <= hi; i += 1) {
          const hex = items[i].slice(1, -1);
          let uni = '';
          for (let j = 0; j + 4 <= hex.length; j += 4) {
            uni += String.fromCharCode(parseInt(hex.slice(j, j + 4), 16));
          }
          if (range[1].length <= 2) enc.single.set(lo + i, uni);
          else enc.twoByte.set(lo + i, uni);
        }
      } else {
        const hex = dst.slice(1, -1);
        const base = parseInt(hex.slice(0, 4), 16);
        for (let c = lo; c <= hi; c += 1) {
          const target = String.fromCharCode(base + (c - lo));
          if (range[1].length <= 2) enc.single.set(c, target);
          else enc.twoByte.set(c, target);
        }
      }
    }
  }
}

const TEXT_OPS = new Set(['Tj', 'TJ', "'", '"']);
const NEWLINE_OPS = new Set(['TD', 'T*', 'ET']);

/**
 * Interpret one decoded content stream: append shown strings to the page text,
 * with line breaks on positioning operators. Handles nested parens, escapes,
 * hex strings and TJ arrays with kerning numbers. When an encoding map is
 * provided, shown string bytes are translated through it (subset fonts).
 */
function textFromContent(content: string, enc: EncodingMap | null): string {
  let text = '';
  const operands: Array<{ kind: 'str'; value: string } | { kind: 'gap'; value: string }> = [];

  const applyMap = (raw: string): string => {
    if (!enc) return raw;
    // A populated CMap wins over the raw-identity interpretation: Identity-H
    // fonts usually carry a ToUnicode CMap mapping 2-byte glyph codes.
    if (enc.single.size === 0 && enc.twoByte.size === 0) {
      if (enc.identity) {
        // 2-byte UCS-2 big-endian.
        let out = '';
        for (let i = 0; i + 1 < raw.length; i += 2) {
          out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
        }
        return out;
      }
      return raw;
    }
    let out = '';
    for (let i = 0; i < raw.length; ) {
      const two = i + 1 < raw.length ? (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1) : -1;
      if (two !== -1 && enc.twoByte.has(two)) {
        out += enc.twoByte.get(two);
        i += 2;
        continue;
      }
      const one = raw.charCodeAt(i);
      if (enc.single.has(one)) {
        out += enc.single.get(one);
        i += 1;
        continue;
      }
      // No mapping: keep the latin1 char only when it is printable; subset
      // fonts leave control bytes that would pollute extraction otherwise.
      if (one >= 32 || one === 10 || one === 13 || one === 9) out += raw[i];
      i += 1;
    }
    return out;
  };

  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '(') {
      // Balanced literal string with escapes.
      let depth = 1;
      let j = i + 1;
      let body = '';
      while (j < content.length && depth > 0) {
        const c = content[j];
        if (c === '\\') { body += c + (content[j + 1] ?? ''); j += 2; continue; }
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
        body += c;
        j += 1;
      }
      operands.push({ kind: 'str', value: decodeLiteral(body) });
      i = j + 1;
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i);
      if (end !== -1) {
        operands.push({ kind: 'str', value: decodeHex(content.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '/' || ch === '[' || ch === ']' || ch === '<') { i += 1; continue; }
    if (ch === '>' ) { i += 1; continue; }

    // Number? Collect as a TJ kerning gap.
    if (/[0-9.+-]/.test(ch)) {
      let j = i;
      while (j < content.length && /[0-9.+-]/.test(content[j])) j += 1;
      operands.push({ kind: 'gap', value: content.slice(i, j) });
      i = j;
      continue;
    }

    // Identifier token?
    if (/[A-Za-z'"*]/.test(ch)) {
      let j = i;
      while (j < content.length && /[A-Za-z0-9'"*]/.test(content[j])) j += 1;
      const op = content.slice(i, j);
      i = j;
      if (TEXT_OPS.has(op)) {
        // TJ: interleave strings and numeric gaps (large negative gaps are word
        // spaces in many producers).
        if (op === 'TJ') {
          for (const operand of operands) {
            if (operand.kind === 'str') {
              text += applyMap(operand.value);
            } else if (Number(operand.value) < -180 && !text.endsWith(' ') && !text.endsWith('\n')) {
              text += ' ';
            }
          }
        } else if (op === "'" || op === '"') {
          const last = operands[operands.length - 1];
          text += '\n' + (last && last.kind === 'str' ? applyMap(last.value) : '');
        } else {
          for (let k = operands.length - 1; k >= 0; k -= 1) {
            if (operands[k].kind === 'str') {
              text += applyMap((operands[k] as { kind: 'str'; value: string }).value);
              break;
            }
          }
        }
        operands.length = 0;
        continue;
      }
      if (NEWLINE_OPS.has(op)) {
        if (text.length > 0 && !text.endsWith('\n')) text += '\n';
        operands.length = 0;
        continue;
      }
      if (op === 'Td') {
        // Horizontal-only moves (dy = 0) stay on the same line; vertical moves
        // start a new one. The last two numeric operands before Td are tx ty.
        const nums = operands.filter((o) => o.kind === 'gap').map((o) => Number(o.value));
        const dy = nums.length >= 2 ? nums[nums.length - 1] : 0;
        if (Math.abs(dy) > 0.01 && text.length > 0 && !text.endsWith('\n')) text += '\n';
        operands.length = 0;
        continue;
      }
      if (op === 'Tf') {
        // Font switch: /F1 16.1 Tf. The current font's name is the operand.
        operands.length = 0;
      } else if (op === 'Tc' || op === 'Tw' || op === 'Tz' || op === 'TL' || op === 'Ts') {
        operands.length = 0;
      }
      continue;
    }
    // Whitespace and anything else just pass.
    i += 1;
  }
  return text;
}

/** Decode one content stream object (FlateDecode or plain) to text ops. */
async function decodedStream(raw: string, objects: Map<number, PdfObject>, num: number): Promise<string | null> {
  const obj = objects.get(num);
  if (!obj) return null;
  const bytes = streamBytes(raw, objects, obj);
  if (!bytes) return null;
  if (/\/FlateDecode/.test(obj.dict)) {
    const inflated = await inflate(bytes);
    if (!inflated) return null;
    return latin1(inflated);
  }
  if (/DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|LZWDecode|RunLengthDecode|ASCII85Decode|ASCIIHexDecode/.test(obj.dict)) {
    return null; // image/encoded streams carry no extractable text ops here
  }
  return latin1(bytes);
}

/**
 * Build encodings for every font referenced by a page's /Resources. CMap
 * streams are usually FlateDecode, so each is inflated asynchronously here and
 * parsed into a code-to-unicode map keyed by font name (e.g. /F1).
 */
async function buildPageEncodings(
  raw: string,
  objects: Map<number, PdfObject>,
  pageObj: PdfObject
): Promise<Map<string, EncodingMap>> {
  const encodings = new Map<string, EncodingMap>();
  const resMatch = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(pageObj.dict);
  let resDict = pageObj.dict;
  if (resMatch) {
    const resObj = objects.get(Number(resMatch[1]));
    if (resObj) resDict = resObj.body;
  }
  // Font entries live in /Font << /F1 12 0 R ... >> (direct dict or indirect).
  let fontDictText = '';
  const fontInline = /\/Font\s*<<(.*?)>>/s.exec(resDict);
  if (fontInline) {
    fontDictText = fontInline[1];
  } else {
    const fontRef = /\/Font\s+(\d+)\s+\d+\s+R/.exec(resDict);
    if (fontRef) {
      const fontObj = objects.get(Number(fontRef[1]));
      if (fontObj) fontDictText = fontObj.body;
    }
  }
  const nameRe = /(\/\w+)\s+(\d+)\s+\d+\s+R/g;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = nameRe.exec(fontDictText)) !== null) {
    const fontName = nameMatch[1];
    const fontNum = Number(nameMatch[2]);
    if (encodings.has(fontName)) continue;
    const fontObj = objects.get(fontNum);
    if (!fontObj) { encodings.set(fontName, emptyEncoding()); continue; }

    const enc = emptyEncoding();
    // Identity 2-byte encodings are common for fully embedded fonts.
    if (/\/Encoding\s*\/Identity-H/.test(fontObj.dict)) enc.identity = true;

    const tuRef = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontObj.dict);
    if (tuRef) {
      const cmapObj = objects.get(Number(tuRef[1]));
      if (cmapObj) {
        const cmapBytes = streamBytes(raw, objects, cmapObj);
        if (cmapBytes) {
          let cmapText: string | null;
          if (/FlateDecode/.test(cmapObj.dict)) {
            cmapText = cmapBytes.length > 0 ? latin1((await inflate(cmapBytes)) ?? new Uint8Array()) : null;
          } else {
            cmapText = latin1(cmapBytes);
          }
          if (cmapText) parseCMap(cmapText, enc);
        }
      }
    }
    encodings.set(fontName, enc);
  }
  return encodings;
}

/**
 * Strip characters that are never legitimate body text: control bytes a
 * mis-decoded CMap can emit (U+0000-U+0008, U+000B-U+001F). U+0000 in
 * particular cannot be stored in Postgres jsonb and made finalization throw.
 */
function sanitizeExtracted(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

export async function extractPdfPages(bytes: Uint8Array): Promise<PdfExtractResult> {
  if (bytes.length > MAX_PARSE_BYTES) return { ok: false, code: 'PDF_TOO_LARGE' };

  const header = latin1(bytes.subarray(0, Math.min(bytes.length, 1024)));
  if (!header.includes('%PDF-')) return { ok: false, code: 'CORRUPT_PDF' };

  const raw = latin1(bytes);
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(raw)) return { ok: false, code: 'ENCRYPTED_PDF' };

  const objects = parseObjects(raw);
  const pageNums = orderedPageNums(objects);
  if (pageNums.length === 0) return { ok: false, code: 'CORRUPT_PDF' };

  const pages: Array<{ page: number; text: string }> = [];
  let sawAnyTextOps = false;
  for (let p = 0; p < pageNums.length; p += 1) {
    const pageObj = objects.get(pageNums[p]);
    if (!pageObj) continue;
    const refs = contentRefs(pageObj.dict);
    const encodings = await buildPageEncodings(raw, objects, pageObj);
    let pageText = '';
    for (const ref of refs) {
      const content = await decodedStream(raw, objects, ref);
      if (content) {
        if (/\bTj\b|\bTJ\b/.test(content)) sawAnyTextOps = true;
        // Track the current font so strings decode through the right CMap.
        let currentFont: EncodingMap | null = null;
        const parts: string[] = [];
        const fontSwitch = /\s(\/\w+)\s+[\d.]+\s+Tf(?![a-z])/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = fontSwitch.exec(content)) !== null) {
          const seg = content.slice(last, m.index);
          if (seg) parts.push(textFromContent(seg, currentFont));
          currentFont = encodings.get(m[1]) ?? currentFont;
          last = m.index + m[0].length;
        }
        const tail = content.slice(last);
        if (tail) parts.push(textFromContent(tail, currentFont));
        pageText += parts.join('');
      }
    }
    pages.push({ page: p + 1, text: pageText.replace(/[ \t]+\n/g, '\n').trim() });
  }

  const sanitized: Array<{ page: number; text: string }> = pages.map((p) => ({
    page: p.page,
    text: sanitizeExtracted(p.text),
  }));

  if (sanitized.every((p) => p.text.length === 0)) {
    // A PDF with real text operators whose bytes we could not map is a custom
    // encoding problem, not a scan — say so instead of claiming a scan.
    if (sawAnyTextOps) return { ok: false, code: 'CORRUPT_PDF' };
    return { ok: false, code: 'SCANNED_PDF_NO_TEXT' };
  }

  // Unreadability gate: if a large share of the surviving characters are
  // combining-mark/control debris typical of a mis-decoded subset font, the
  // text is not usable — fail instead of storing mojibake as Ready.
  const total = sanitized.reduce((sum, p) => sum + p.text.length, 0);
  const clean = sanitized.reduce(
    (sum, p) =>
      sum +
      [...p.text].filter((ch) => {
        const cp = ch.codePointAt(0)!;
        return (cp >= 0x20 && cp < 0xd7ff) || (cp > 0xe000 && cp <= 0x2fff) || cp >= 0x3040;
      }).length,
    0
  );
  if (total > 0 && clean / total < 0.6) {
    return { ok: false, code: 'UNREADABLE_TEXT' };
  }

  return { ok: true, pages: sanitized };
}

/** Split page texts into database chunks with real page numbers (1-based). */
export function pdfPagesToChunks(
  pages: Array<{ page: number; text: string }>,
  chunkSize = 4000
): Array<{ c: string; p: number }> {
  const chunks: Array<{ c: string; p: number }> = [];
  for (const p of pages) {
    if (!p.text) continue;
    for (let i = 0; i < p.text.length; i += chunkSize) {
      const piece = p.text.slice(i, i + chunkSize).trim();
      if (piece) chunks.push({ c: piece, p: p.page });
    }
  }
  return chunks.slice(0, 2000);
}
