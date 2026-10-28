/**
 * A safe arithmetic expression evaluator for the calculator.
 * Supports +, -, *, /, ^, parentheses, and these functions:
 * sin, cos, tan, asin, acos, atan, sinh, cosh, tanh,
 * log (base 10), ln (natural log), sqrt, abs, exp,
 * factorial (!), pi, e, and implicit multiplication (2pi, 3(4+1)).
 *
 * No eval() is used. The expression is tokenized, converted to
 * postfix (Shunting Yard), then evaluated on a stack.
 */

export type TokenType = 'number' | 'op' | 'func' | 'lparen' | 'rparen' | 'comma' | 'const';

interface Token {
  type: TokenType;
  value: string;
}

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'log', 'ln', 'sqrt', 'abs', 'exp',
]);

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const PRECEDENCE: Record<string, number> = {
  '+': 1, '-': 1,
  '*': 2, '/': 2,
  '%': 2,
  '^': 3,
  '!': 4,
};

const RIGHT_ASSOC = new Set(['^', '!']);

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (ch === ' ' || ch === '\t') { i++; continue; }

    // Numbers: 123, 12.34, .5
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(expr[i + 1] ?? ''))) {
      let num = '';
      while (i < expr.length && (/\d/.test(expr[i]) || expr[i] === '.')) {
        num += expr[i++];
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Letters: function names or constants
    if (/[a-zA-Z]/.test(ch)) {
      let name = '';
      while (i < expr.length && /[a-zA-Z]/.test(expr[i])) {
        name += expr[i++];
      }
      name = name.toLowerCase();
      if (FUNCTIONS.has(name)) {
        tokens.push({ type: 'func', value: name });
      } else if (name in CONSTANTS) {
        tokens.push({ type: 'const', value: name });
      } else {
        throw new Error(`Unknown function or constant: ${name}`);
      }
      continue;
    }

    // Unary minus: a '-' at the start of the expression or right after '(', ',', or an operator
    if (ch === '-') {
      const prev = tokens[tokens.length - 1];
      const isUnary = !prev || prev.type === 'lparen' || prev.type === 'comma' || prev.type === 'op';
      if (isUnary) {
        tokens.push({ type: 'number', value: '0' });
        tokens.push({ type: 'op', value: '-' });
        i++;
        continue;
      }
    }

    // Operators
    if ('+-*/^%!'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    if (ch === '(') { tokens.push({ type: 'lparen', value: ch }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ch }); i++; continue; }
    if (ch === ',') { tokens.push({ type: 'comma', value: ch }); i++; continue; }

    throw new Error(`Unexpected character: ${ch}`);
  }

  return tokens;
}

/** Insert implicit multiplication tokens (2pi -> 2*pi, 3(4 -> 3*(4). */
function withImplicitMul(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    out.push(tokens[i]);
    const next = tokens[i + 1];
    if (!next) continue;
    const curr = tokens[i];
    const currIsValue = curr.type === 'number' || curr.type === 'const' || curr.type === 'rparen';
    const nextIsValueStart = next.type === 'func' || next.type === 'const' || next.type === 'lparen';
    if (currIsValue && nextIsValueStart) {
      out.push({ type: 'op', value: '*' });
    }
  }
  return out;
}

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'number':
      case 'const':
        output.push(token);
        break;
      case 'func':
        stack.push(token);
        break;
      case 'comma':
        while (stack.length && stack[stack.length - 1].type !== 'lparen') {
          output.push(stack.pop()!);
        }
        break;
      case 'op': {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.type === 'lparen') break;
          if (top.type === 'func') { output.push(stack.pop()!); continue; }
          if (top.type === 'op') {
            const topPrec = PRECEDENCE[top.value] ?? 0;
            const currPrec = PRECEDENCE[token.value] ?? 0;
            if (topPrec > currPrec || (topPrec === currPrec && !RIGHT_ASSOC.has(token.value))) {
              output.push(stack.pop()!);
              continue;
            }
          }
          break;
        }
        stack.push(token);
        break;
      }
      case 'lparen':
        stack.push(token);
        break;
      case 'rparen':
        while (stack.length && stack[stack.length - 1].type !== 'lparen') {
          output.push(stack.pop()!);
        }
        if (!stack.length) throw new Error('Mismatched parentheses');
        stack.pop(); // remove lparen
        // If a function is on top of the stack, pop it to output
        if (stack.length && stack[stack.length - 1].type === 'func') {
          output.push(stack.pop()!);
        }
        break;
    }
  }

  while (stack.length) {
    const t = stack.pop()!;
    if (t.type === 'lparen' || t.type === 'rparen') {
      throw new Error('Mismatched parentheses');
    }
    output.push(t);
  }

  return output;
}

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function applyFunc(name: string, arg: number): number {
  switch (name) {
    case 'sin': return Math.sin(arg);
    case 'cos': return Math.cos(arg);
    case 'tan': return Math.tan(arg);
    case 'asin': return Math.asin(arg);
    case 'acos': return Math.acos(arg);
    case 'atan': return Math.atan(arg);
    case 'sinh': return Math.sinh(arg);
    case 'cosh': return Math.cosh(arg);
    case 'tanh': return Math.tanh(arg);
    case 'log': return Math.log10(arg);
    case 'ln': return Math.log(arg);
    case 'sqrt': return Math.sqrt(arg);
    case 'abs': return Math.abs(arg);
    case 'exp': return Math.exp(arg);
    default: throw new Error(`Unknown function: ${name}`);
  }
}

function evalRPN(rpn: Token[]): number {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === 'number') {
      stack.push(parseFloat(token.value));
    } else if (token.type === 'const') {
      stack.push(CONSTANTS[token.value]);
    } else if (token.type === 'func') {
      const arg = stack.pop();
      if (arg === undefined) throw new Error('Missing argument');
      stack.push(applyFunc(token.value, arg));
    } else if (token.type === 'op') {
      if (token.value === '!') {
        const a = stack.pop();
        if (a === undefined) throw new Error('Missing operand');
        stack.push(factorial(a));
      } else {
        const b = stack.pop();
        const a = stack.pop();
        if (a === undefined || b === undefined) throw new Error('Missing operand');
        switch (token.value) {
          case '+': stack.push(a + b); break;
          case '-': stack.push(a - b); break;
          case '*': stack.push(a * b); break;
          case '/': stack.push(a / b); break;
          case '%': stack.push(a % b); break;
          case '^': stack.push(Math.pow(a, b)); break;
          default: throw new Error(`Unknown operator: ${token.value}`);
        }
      }
    }
  }

  if (stack.length !== 1) throw new Error('Invalid expression');
  return stack[0];
}

/** Evaluate a math expression string. Returns a number or throws. */
export function evaluateExpression(expr: string): number {
  if (!expr.trim()) throw new Error('Empty expression');
  const tokens = tokenize(expr);
  const withMul = withImplicitMul(tokens);
  const rpn = toRPN(withMul);
  return evalRPN(rpn);
}

/** Format a number for display, avoiding floating point noise. */
export function formatResult(n: number): string {
  if (!isFinite(n)) return n > 0 ? 'Infinity' : (n < 0 ? '-Infinity' : 'NaN');
  if (isNaN(n)) return 'Error';
  // Round to 10 significant digits to suppress FP noise, then trim
  const rounded = parseFloat(n.toPrecision(12));
  // Preserve full precision for irrational numbers like pi
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}
