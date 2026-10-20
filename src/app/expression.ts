/**
 * A small expression language for the working behind each result.
 *
 * One parse both evaluates a formula and lays it out for display, so the
 * equation a reader sees is the one that was computed. Numbers, names, the
 * four operators, ^ for powers, parentheses, and a few functions.
 */

export type Token =
  | { readonly kind: 'number'; readonly text: string; readonly value: number }
  | { readonly kind: 'name'; readonly text: string }
  | { readonly kind: 'function'; readonly text: Fn }
  | { readonly kind: 'op'; readonly text: '+' | '-' | '*' | '/' | '^' | '(' | ')' };

const FUNCTIONS = {
  sqrt: Math.sqrt,
  ln: Math.log,
  atan: Math.atan,
  cos: Math.cos,
  sin: Math.sin,
} as const;
type Fn = keyof typeof FUNCTIONS;

/** Names every formula may use without listing them. */
const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI };

const PATTERN = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|([-+*/^()]))/y;

export function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  PATTERN.lastIndex = 0;
  while (PATTERN.lastIndex < formula.length) {
    const start = PATTERN.lastIndex;
    const m = PATTERN.exec(formula);
    if (!m) {
      if (formula.slice(start).trim() === '') break;
      throw new SyntaxError(`Unexpected "${formula.slice(start)}" in ${formula}`);
    }
    if (m[1] !== undefined) tokens.push({ kind: 'number', text: m[1], value: Number(m[1]) });
    else if (m[2] !== undefined) {
      tokens.push(m[2] in FUNCTIONS ? { kind: 'function', text: m[2] as Fn } : { kind: 'name', text: m[2] });
    } else tokens.push({ kind: 'op', text: m[3] as Extract<Token, { kind: 'op' }>['text'] });
  }
  return tokens;
}

/** The formula's value, with each name looked up in `values`. Throws on a name it doesn't know. */
export function evaluate(formula: string, values: Readonly<Record<string, number>>): number {
  const tokens = tokenize(formula);
  let i = 0;
  const peek = () => tokens[i];
  const expect = (text: string) => {
    const t = tokens[i++];
    if (t?.text !== text) throw new SyntaxError(`Expected "${text}" in ${formula}`);
  };

  // expression = term (("+" | "-") term)*
  const expression = (): number => {
    let value = term();
    for (let t = peek(); t?.kind === 'op' && (t.text === '+' || t.text === '-'); t = peek()) {
      i++;
      value = t.text === '+' ? value + term() : value - term();
    }
    return value;
  };
  // term = unary (("*" | "/") unary)*
  const term = (): number => {
    let value = unary();
    for (let t = peek(); t?.kind === 'op' && (t.text === '*' || t.text === '/'); t = peek()) {
      i++;
      value = t.text === '*' ? value * unary() : value / unary();
    }
    return value;
  };
  // unary = "-" unary | power: so -2 ^ 2 is -4, as on paper
  const unary = (): number => {
    if (peek()?.text === '-') {
      i++;
      return -unary();
    }
    return power();
  };
  // power = primary ("^" unary)?: right-associative, and 2 ^ -1 allowed
  const power = (): number => {
    const base = primary();
    if (peek()?.text !== '^') return base;
    i++;
    return Math.pow(base, unary());
  };
  const primary = (): number => {
    const t = tokens[i++];
    if (!t) throw new SyntaxError(`Unexpected end of ${formula}`);
    if (t.kind === 'number') return t.value;
    if (t.kind === 'name') {
      const value = values[t.text] ?? CONSTANTS[t.text];
      if (value === undefined) throw new ReferenceError(`No value for "${t.text}" in ${formula}`);
      return value;
    }
    if (t.kind === 'function') {
      expect('(');
      const value = FUNCTIONS[t.text](expression());
      expect(')');
      return value;
    }
    if (t.text === '(') {
      const value = expression();
      expect(')');
      return value;
    }
    throw new SyntaxError(`Unexpected "${t.text}" in ${formula}`);
  };

  const value = expression();
  if (i !== tokens.length) throw new SyntaxError(`Unexpected "${tokens[i]?.text}" in ${formula}`);
  return value;
}

export function isConstant(name: string): boolean {
  return name in CONSTANTS;
}
