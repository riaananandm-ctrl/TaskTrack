/**
 * A lightweight spreadsheet formula engine.
 *
 * Supports cell references (A1, B12), ranges (A1:A5), and these functions:
 * SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS, SQRT, POWER, IF.
 *
 * Operators: + - * / and parentheses. No eval() is used.
 */

export type CellValue = string | number | null;

export interface SheetData {
  [key: string]: CellValue;
}

const COL_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function colLabel(index: number): string {
  if (index < 26) return COL_LABELS[index];
  return colLabel(Math.floor(index / 26) - 1) + COL_LABELS[index % 26];
}

export function cellKey(col: number, row: number): string {
  return `${colLabel(col)}${row + 1}`;
}

export function parseCellKey(key: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(key.toUpperCase());
  if (!m) return null;
  const col = m[1].split('').reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  const row = parseInt(m[2], 10) - 1;
  return { col, row };
}

const FUNCTIONS = new Set([
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'ROUND', 'ABS', 'SQRT', 'POWER', 'IF',
]);

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '-') {
      const prev = tokens[tokens.length - 1];
      const isUnary = !prev || prev === '(' || prev === ',' || ['+','-','*','/','^'].includes(prev);
      if (isUnary) { tokens.push('0'); tokens.push('-'); i++; continue; }
    }
    if (/[A-Za-z0-9.]/.test(ch)) {
      let tok = '';
      while (i < expr.length && /[A-Za-z0-9.]/.test(expr[i])) { tok += expr[i++]; }
      if (expr[i] === '.') { tok += expr[i++]; }
      while (i < expr.length && /[A-Za-z0-9]/.test(expr[i])) { tok += expr[i++]; }
      tokens.push(tok);
    } else if (ch === '"' || ch === "'") {
      let str = ch;
      i++;
      while (i < expr.length && expr[i] !== ch) { str += expr[i++]; }
      str += ch;
      i++;
      tokens.push(str);
    } else {
      tokens.push(ch);
      i++;
    }
  }
  return tokens;
}

function toRPN(tokens: string[]): string[] {
  const output: string[] = [];
  const stack: string[] = [];
  const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };

  for (const tok of tokens) {
    if (/^-?\d/.test(tok) || /^["']/.test(tok)) {
      output.push(tok);
    } else if (/^[A-Za-z]+\d+$/.test(tok)) {
      output.push(tok.toUpperCase());
    } else if (FUNCTIONS.has(tok.toUpperCase())) {
      stack.push(tok.toUpperCase());
    } else if (tok === '(' || tok === ',') {
      stack.push(tok);
    } else if (tok === ')') {
      while (stack.length && stack[stack.length - 1] !== '(') {
        output.push(stack.pop()!);
      }
      stack.pop();
      if (stack.length && FUNCTIONS.has(stack[stack.length - 1])) {
        output.push(stack.pop()!);
      }
    } else if (PREC[tok] !== undefined) {
      while (stack.length && PREC[stack[stack.length - 1]] !== undefined && PREC[stack[stack.length - 1]] >= PREC[tok]) {
        output.push(stack.pop()!);
      }
      stack.push(tok);
    }
  }
  while (stack.length) output.push(stack.pop()!);
  return output;
}

function resolveCell(key: string, data: SheetData, visited: Set<string>): number {
  if (visited.has(key)) return 0;
  const val = data[key];
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

function resolveRange(start: string, end: string, data: SheetData, visited: Set<string>): number[] {
  const s = parseCellKey(start);
  const e = parseCellKey(end);
  if (!s || !e) return [];
  const vals: number[] = [];
  for (let r = Math.min(s.row, e.row); r <= Math.max(s.row, e.row); r++) {
    for (let c = Math.min(s.col, e.col); c <= Math.max(s.col, e.col); c++) {
      vals.push(resolveCell(cellKey(c, r), data, visited));
    }
  }
  return vals;
}

function applyFunc(name: string, args: number[]): number {
  switch (name) {
    case 'SUM': return args.reduce((a, b) => a + b, 0);
    case 'AVERAGE': return args.length ? args.reduce((a, b) => a + b, 0) / args.length : 0;
    case 'MIN': return args.length ? Math.min(...args) : 0;
    case 'MAX': return args.length ? Math.max(...args) : 0;
    case 'COUNT': return args.filter((a) => !isNaN(a)).length;
    case 'ROUND': return args.length >= 2 ? Math.round(args[0] * Math.pow(10, args[1])) / Math.pow(10, args[1]) : Math.round(args[0] ?? 0);
    case 'ABS': return Math.abs(args[0] ?? 0);
    case 'SQRT': return Math.sqrt(args[0] ?? 0);
    case 'POWER': return Math.pow(args[0] ?? 0, args[1] ?? 0);
    default: return NaN;
  }
}

/**
 * Evaluate a formula string against the sheet data.
 * A formula starts with '='. Returns the computed value.
 */
export function evaluateFormula(formula: string, data: SheetData, visited: Set<string> = new Set()): number {
  let expr = formula.trim();
  if (expr.startsWith('=')) expr = expr.slice(1).trim();
  if (!expr) return 0;

  try {
    // Handle ranges: convert A1:B3 into a SUM-like array token
    const rangePattern = /([A-Z]+\d+):([A-Z]+\d+)/g;
    expr = expr.replace(rangePattern, (match) => {
      const [start, end] = match.split(':');
      const vals = resolveRange(start, end, data, visited);
      return `(${vals.join(',')})`;
    });

    const tokens = tokenize(expr);
    const rpn = toRPN(tokens);
    const stack: (number | string)[] = [];

    for (const tok of rpn) {
      if (/^-?\d/.test(tok)) {
        stack.push(parseFloat(tok));
      } else if (/^["']/.test(tok)) {
        stack.push(tok.slice(1, -1));
      } else if (/^[A-Z]+\d+$/.test(tok)) {
        stack.push(resolveCell(tok, data, visited));
      } else if (FUNCTIONS.has(tok)) {
        const args: number[] = [];
        while (stack.length && typeof stack[stack.length - 1] === 'number') {
          args.unshift(stack.pop() as number);
        }
        stack.push(applyFunc(tok, args));
      } else if (['+', '-', '*', '/', '^'].includes(tok)) {
        const b = stack.pop() as number;
        const a = stack.pop() as number;
        if (a === undefined || b === undefined) return 0;
        switch (tok) {
          case '+': stack.push(a + b); break;
          case '-': stack.push(a - b); break;
          case '*': stack.push(a * b); break;
          case '/': stack.push(a / b); break;
          case '^': stack.push(Math.pow(a, b)); break;
        }
      }
    }

    const result = stack[0];
    return typeof result === 'number' ? result : 0;
  } catch {
    return 0;
  }
}

/** Get the display value of a cell (formula result or raw value). */
export function getDisplayValue(key: string, data: SheetData): string {
  const val = data[key];
  if (val == null || val === '') return '';
  const str = String(val);
  if (str.startsWith('=')) {
    const result = evaluateFormula(str, data);
    return String(parseFloat(result.toFixed(10)));
  }
  return str;
}

/** Check if a cell value is a formula. */
export function isFormula(val: CellValue): boolean {
  return typeof val === 'string' && val.trim().startsWith('=');
}
