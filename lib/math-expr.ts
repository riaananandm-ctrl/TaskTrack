/**
 * A small, safe math expression parser (no eval). Shared by the graphing calculator
 * and the spreadsheet.
 *
 * Grammar (precedence low → high):
 *   compare  := additive (('<' | '>' | '<=' | '>=' | '=' | '<>') additive)?
 *   additive := term (('+' | '-') term)*
 *   term     := unary (('*' | '/' | implicit) unary)*      e.g. 2x, 3(x+1), 2sin(x)
 *   unary    := ('-' | '+') unary | power
 *   power    := postfix ('^' unary)?                        right-associative
 *   postfix  := primary ('!' | '%')*
 *   primary  := number | name | name '(' args ')' | '(' expr ')' | '|' expr '|' | range
 */

export type Node =
  | { type: 'num'; value: number }
  | { type: 'var'; name: string }
  | { type: 'range'; from: string; to: string }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'unary'; op: '-'; arg: Node }
  | { type: 'bin'; op: string; left: Node; right: Node }
  | { type: 'post'; op: '!' | '%'; arg: Node };

export class ExprError extends Error {}

type Tok = { t: 'num' | 'name' | 'op' | 'cell'; v: string };

const CELL_RE = /^[A-Z]{1,2}[0-9]{1,4}$/;

function tokenize(src: string, cells: boolean): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√/g, 'sqrt');
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'e' || s[j] === 'E') {
        // Scientific notation like 1e5 or 2.5E-3 (only when digits follow).
        const m = /^[eE][+-]?[0-9]+/.exec(s.slice(j));
        if (m) j += m[0].length;
      }
      const raw = s.slice(i, j);
      if ((raw.match(/\./g) || []).length > 1) throw new ExprError(`Bad number "${raw}"`);
      out.push({ t: 'num', v: raw });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z_0-9]/.test(s[j])) j++;
      const word = s.slice(i, j);
      if (cells && CELL_RE.test(word.toUpperCase())) out.push({ t: 'cell', v: word.toUpperCase() });
      else out.push({ t: 'name', v: word });
      i = j;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '<>', '!='].includes(two)) { out.push({ t: 'op', v: two === '!=' ? '<>' : two }); i += 2; continue; }
    if ('+-*/^(),|!%<>=:'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new ExprError(`Unexpected "${ch}"`);
  }
  return out;
}

const FUNCS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'sec', 'csc', 'cot',
  'sqrt', 'cbrt', 'abs', 'ln', 'log', 'exp', 'floor', 'ceil', 'round', 'sign',
  'min', 'max', 'mod', 'nthroot',
  // spreadsheet functions (case-insensitive)
  'sum', 'average', 'avg', 'count', 'power', 'if', 'median',
]);

export function isFunctionName(name: string): boolean {
  return FUNCS.has(name.toLowerCase());
}

export function parse(src: string, opts: { cells?: boolean; fnNames?: Set<string> } = {}): Node {
  const toks = tokenize(src, !!opts.cells);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;
  const eat = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Expected "${v}"`);
    p++;
  };

  // Implicit multiplication starts when the next token begins a new factor.
  const startsFactor = () => {
    const t = peek();
    if (!t) return false;
    if (t.t === 'num' || t.t === 'name' || t.t === 'cell') return true;
    return t.t === 'op' && t.v === '(';
  };

  function compare(): Node {
    const left = additive();
    const t = peek();
    if (t?.t === 'op' && ['<', '>', '<=', '>=', '=', '<>'].includes(t.v)) {
      p++;
      return { type: 'bin', op: t.v, left, right: additive() };
    }
    return left;
  }
  function additive(): Node {
    let node = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      node = { type: 'bin', op, left: node, right: term() };
    }
    return node;
  }
  function term(): Node {
    let node = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = toks[p++].v;
        node = { type: 'bin', op, left: node, right: unary() };
      } else if (startsFactor()) {
        node = { type: 'bin', op: '*', left: node, right: power() };
      } else break;
    }
    return node;
  }
  function unary(): Node {
    if (isOp('-')) { p++; return { type: 'unary', op: '-', arg: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  function power(): Node {
    const base = postfix();
    if (isOp('^')) { p++; return { type: 'bin', op: '^', left: base, right: unary() }; }
    return base;
  }
  function postfix(): Node {
    let node = primary();
    while (isOp('!') || isOp('%')) {
      node = { type: 'post', op: toks[p++].v as '!' | '%', arg: node };
    }
    return node;
  }
  function primary(): Node {
    const t = peek();
    if (!t) throw new ExprError('Expression ends too early');
    if (t.t === 'num') { p++; return { type: 'num', value: parseFloat(t.v) }; }
    if (t.t === 'cell') {
      p++;
      if (isOp(':')) {
        p++;
        const end = peek();
        if (end?.t !== 'cell') throw new ExprError('Ranges look like A1:A5');
        p++;
        return { type: 'range', from: t.v, to: end.v };
      }
      return { type: 'var', name: t.v };
    }
    if (t.t === 'name') {
      p++;
      const userFn = opts.fnNames?.has(t.v) && isOp('(');
      if (isFunctionName(t.v) || userFn) {
        const name = userFn ? t.v : t.v.toLowerCase();
        // sin x and sin 2x work without brackets, like a calculator.
        if (!isOp('(')) return { type: 'call', name, args: [power()] };
        eat('(');
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(compare());
          while (isOp(',')) { p++; args.push(compare()); }
        }
        eat(')');
        return { type: 'call', name, args };
      }
      return { type: 'var', name: t.v };
    }
    if (isOp('(')) { p++; const inner = compare(); eat(')'); return inner; }
    if (isOp('|')) { p++; const inner = additive(); eat('|'); return { type: 'call', name: 'abs', args: [inner] }; }
    throw new ExprError(`Unexpected "${t.v}"`);
  }

  if (!toks.length) throw new ExprError('Empty expression');
  const node = compare();
  if (p < toks.length) throw new ExprError(`Unexpected "${toks[p].v}"`);
  return node;
}

export interface Scope {
  /** Look up a variable or cell. Return undefined if it does not exist. */
  get(name: string): number | undefined;
  /** Expand a range like A1:B3 into numbers (spreadsheet only). */
  range?(from: string, to: string): number[];
  /** User-defined functions like f(x) = x^2. */
  fn?(name: string): ((x: number) => number) | undefined;
  /** Angles in degrees instead of radians. */
  degrees?: boolean;
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return gamma(n + 1);
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function gamma(z: number): number {
  // Lanczos approximation.
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function evaluate(node: Node, scope: Scope): number {
  const ang = (v: number) => (scope.degrees ? (v * Math.PI) / 180 : v);
  const inv = (v: number) => (scope.degrees ? (v * 180) / Math.PI : v);
  const ev = (n: Node): number => evaluate(n, scope);
  const flat = (args: Node[]): number[] =>
    args.flatMap((a) => (a.type === 'range' ? (scope.range ? scope.range(a.from, a.to) : []) : [ev(a)]));

  switch (node.type) {
    case 'num':
      return node.value;
    case 'var': {
      const v = scope.get(node.name);
      if (v !== undefined) return v;
      const c = CONSTANTS[node.name.toLowerCase()];
      if (c !== undefined) return c;
      throw new ExprError(`Unknown "${node.name}"`);
    }
    case 'range': {
      const vals = scope.range ? scope.range(node.from, node.to) : [];
      return vals.reduce((a, b) => a + b, 0);
    }
    case 'unary':
      return -ev(node.arg);
    case 'post': {
      const v = ev(node.arg);
      return node.op === '!' ? factorial(v) : v / 100;
    }
    case 'bin': {
      const a = ev(node.left);
      const b = ev(node.right);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '^': return Math.pow(a, b);
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '=': return a === b ? 1 : 0;
        case '<>': return a !== b ? 1 : 0;
      }
      throw new ExprError(`Unknown operator ${node.op}`);
    }
    case 'call': {
      const user = scope.fn?.(node.name);
      if (user && node.args.length === 1) return user(ev(node.args[0]));
      const a = node.args;
      const x = () => (a.length ? ev(a[0]) : NaN);
      switch (node.name) {
        case 'sin': return Math.sin(ang(x()));
        case 'cos': return Math.cos(ang(x()));
        case 'tan': return Math.tan(ang(x()));
        case 'sec': return 1 / Math.cos(ang(x()));
        case 'csc': return 1 / Math.sin(ang(x()));
        case 'cot': return 1 / Math.tan(ang(x()));
        case 'asin': case 'arcsin': return inv(Math.asin(x()));
        case 'acos': case 'arccos': return inv(Math.acos(x()));
        case 'atan': case 'arctan': return inv(Math.atan(x()));
        case 'sinh': return Math.sinh(x());
        case 'cosh': return Math.cosh(x());
        case 'tanh': return Math.tanh(x());
        case 'sqrt': return Math.sqrt(x());
        case 'cbrt': return Math.cbrt(x());
        case 'nthroot': { const v = ev(a[0]); const n = ev(a[1]); return v < 0 && n % 2 === 1 ? -Math.pow(-v, 1 / n) : Math.pow(v, 1 / n); }
        case 'abs': return Math.abs(x());
        case 'ln': return Math.log(x());
        case 'log': return a.length >= 2 ? Math.log(ev(a[0])) / Math.log(ev(a[1])) : Math.log10(x());
        case 'exp': return Math.exp(x());
        case 'floor': return Math.floor(x());
        case 'ceil': return Math.ceil(x());
        case 'sign': return Math.sign(x());
        case 'round': {
          const digits = a.length >= 2 ? ev(a[1]) : 0;
          const f = Math.pow(10, digits);
          return Math.round(x() * f) / f;
        }
        case 'mod': { const m = ev(a[1]); return ((x() % m) + m) % m; }
        case 'power': return Math.pow(ev(a[0]), ev(a[1]));
        case 'if': return ev(a[0]) !== 0 ? (a[1] ? ev(a[1]) : 1) : (a[2] ? ev(a[2]) : 0);
        case 'min': { const v = flat(a); return v.length ? Math.min(...v) : 0; }
        case 'max': { const v = flat(a); return v.length ? Math.max(...v) : 0; }
        case 'sum': return flat(a).reduce((s, v) => s + v, 0);
        case 'average': case 'avg': { const v = flat(a); return v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0; }
        case 'count': return flat(a).length;
        case 'median': {
          const v = flat(a).sort((p, q) => p - q);
          if (!v.length) return 0;
          const mid = Math.floor(v.length / 2);
          return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
        }
      }
      throw new ExprError(`Unknown function ${node.name}`);
    }
  }
}

/** Names of free variables used in an expression (excluding constants and function names). */
export function freeVariables(node: Node, acc = new Set<string>()): Set<string> {
  switch (node.type) {
    case 'var':
      if (CONSTANTS[node.name.toLowerCase()] === undefined) acc.add(node.name);
      break;
    case 'unary': case 'post': freeVariables(node.arg, acc); break;
    case 'bin': freeVariables(node.left, acc); freeVariables(node.right, acc); break;
    case 'call': node.args.forEach((n) => freeVariables(n, acc)); break;
  }
  return acc;
}

/** Format a number for display: trims float noise, uses exponent for huge/tiny values. */
export function formatNumber(v: number): string {
  if (Number.isNaN(v)) return 'undefined';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e12 || abs < 1e-7) return v.toExponential(6).replace(/\.?0+e/, 'e');
  return String(parseFloat(v.toPrecision(12)));
}
