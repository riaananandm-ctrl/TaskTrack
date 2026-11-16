/**
 * Spreadsheet formula engine, built on the shared safe parser in math-expr (no eval).
 *
 * Formulas start with "=" and support cell references (A1), ranges (A1:B5),
 * + - * / ^ %, comparisons, and SUM, AVERAGE, MIN, MAX, COUNT, MEDIAN, ROUND, ABS,
 * SQRT, POWER, IF, plus the maths functions (sin, ln, log, ...). Formulas can use
 * other formula cells; circular references show #CYCLE.
 */

import { parse, evaluate, ExprError, formatNumber } from '@/lib/math-expr';

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

class CycleError extends Error {}

/** Numeric value of a cell, evaluating formulas recursively. Blank and text count as 0. */
function cellNumber(key: string, data: SheetData, visiting: Set<string>): number {
  const val = data[key];
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return val;
  if (isFormula(val)) {
    if (visiting.has(key)) throw new CycleError();
    visiting.add(key);
    try {
      return evaluateFormulaStrict(String(val), data, visiting);
    } finally {
      visiting.delete(key);
    }
  }
  const n = Number(String(val).trim());
  return Number.isFinite(n) && String(val).trim() !== "" ? n : 0;
}

/** Only numbers (typed or computed) inside a range count, like a real spreadsheet. */
function rangeNumbers(from: string, to: string, data: SheetData, visiting: Set<string>): number[] {
  const s = parseCellKey(from);
  const e = parseCellKey(to);
  if (!s || !e) return [];
  const out: number[] = [];
  for (let r = Math.min(s.row, e.row); r <= Math.max(s.row, e.row); r++) {
    for (let c = Math.min(s.col, e.col); c <= Math.max(s.col, e.col); c++) {
      const key = cellKey(c, r);
      const val = data[key];
      if (val == null || val === '') continue;
      if (typeof val === 'number' || isFormula(val) || Number.isFinite(Number(String(val).trim()))) {
        out.push(cellNumber(key, data, visiting));
      }
    }
  }
  return out;
}

function evaluateFormulaStrict(formula: string, data: SheetData, visiting: Set<string>): number {
  const expr = formula.trim().replace(/^=/, '');
  if (!expr.trim()) return 0;
  const ast = parse(expr, { cells: true });
  return evaluate(ast, {
    get: (name) => (parseCellKey(name) ? cellNumber(name.toUpperCase(), data, visiting) : undefined),
    range: (from, to) => rangeNumbers(from, to, data, visiting),
  });
}

/** Evaluate a formula. Returns NaN when it cannot be computed. */
export function evaluateFormula(formula: string, data: SheetData): number {
  try {
    return evaluateFormulaStrict(formula, data, new Set());
  } catch {
    return NaN;
  }
}

/** What a cell shows: the formula result (or an error code), or the raw value. */
export function getDisplayValue(key: string, data: SheetData): string {
  const val = data[key];
  if (val == null || val === '') return '';
  if (!isFormula(val)) return String(val);
  try {
    const result = evaluateFormulaStrict(String(val), data, new Set([key]));
    if (!Number.isFinite(result)) return Number.isNaN(result) ? '#NUM!' : '#DIV/0!';
    return formatNumber(result);
  } catch (err) {
    if (err instanceof CycleError) return '#CYCLE!';
    if (err instanceof ExprError && /Unknown function/.test(err.message)) return '#NAME?';
    return '#ERROR!';
  }
}

/** Check if a cell value is a formula. */
export function isFormula(val: CellValue): boolean {
  return typeof val === 'string' && val.trim().startsWith('=');
}

/** True when a display value is an error code. */
export function isErrorDisplay(display: string): boolean {
  return display.startsWith('#');
}
