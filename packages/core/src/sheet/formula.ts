/**
 * Spreadsheet formulas: `=A1*2`, `=SUM(B1:B10)`, `=IF(C2>100; "haut"; "bas")`.
 * Columns are letters (A = first column), rows are 1-based. Function names are
 * accepted in English and in French (SOMME, MOYENNE, SI…); `;` and `,` both
 * separate arguments, and a decimal comma is read as a decimal point.
 * Another sheet of a workbook: `Budget!B2`, `'Ventes 2026'!A1:A12`.
 * Dates are day numbers (as in spreadsheets: 1 = 31/12/1899), so `=B2-A2` counts days.
 */

export type CellValue = number | string | boolean | null;

/** Errors read like the spreadsheet ones. */
export class FormulaError extends Error {}

export interface FormulaContext {
  /** Value of a cell (already computed when it holds a formula). */
  get(col: number, row: number): CellValue;
  cols: number;
  rows: number;
  /** Another sheet of the workbook, by name. */
  sheet?(name: string): FormulaContext | undefined;
}

const DAY = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);
/** Day number of a date (UTC calendar day), as spreadsheets count them. */
export const toSerial = (y: number, m: number, d: number): number => Math.round((Date.UTC(y, m, d) - EPOCH) / DAY);
export const fromSerial = (n: number): Date => new Date(EPOCH + Math.round(n) * DAY);
/** `2026-11-18` (or a full ISO date-time) → day number; undefined when it is not a date. */
export function isoToSerial(v: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? toSerial(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}
export function serialToIso(n: number): string {
  return fromSerial(n).toISOString().slice(0, 10);
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; col: number; row: number; sheet?: string }
  | { t: 'range'; c0: number; r0: number; c1: number; r1: number; sheet?: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string };

export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnName(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  // `1,5` is a decimal only when `;` separates the arguments (French style); otherwise `,` separates them.
  const numberRe = src.includes(';') ? /^\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?/ : /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
  const ref = /^\$?([A-Za-z]{1,3})\$?(\d+)/;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError('#ERREUR');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const num = numberRe.exec(src.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0].replace(',', '.')) });
      i += num[0].length;
      continue;
    }
    // An optional sheet name in front of a reference: `Budget!` or `'Ventes 2026'!`.
    const prefix = /^(?:'([^']+)'|([A-Za-zÀ-ÿ_][\wÀ-ÿ.]*))!/.exec(src.slice(i));
    const at = prefix ? i + prefix[0].length : i;
    const r = ref.exec(src.slice(at));
    if (r && !/^[A-Za-z(]/.test(src.slice(at + r[0].length))) {
      const sheet = prefix ? (prefix[1] ?? prefix[2]) : undefined;
      const col = columnIndex(r[1]);
      const row = Number(r[2]) - 1;
      i = at + r[0].length;
      const r2 = src[i] === ':' ? ref.exec(src.slice(i + 1)) : null;
      if (r2) {
        out.push({ t: 'range', c0: col, r0: row, c1: columnIndex(r2[1]), r1: Number(r2[2]) - 1, sheet });
        i += 1 + r2[0].length;
      } else out.push({ t: 'ref', col, row, sheet });
      continue;
    }
    if (prefix) throw new FormulaError('#REF!');
    const name = /^[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ_0-9.]*/.exec(src.slice(i));
    if (name) {
      out.push({ t: 'name', v: name[0].toUpperCase() });
      i += name[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/^()<>=;,&%'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
      continue;
    }
    throw new FormulaError('#ERREUR');
  }
  return out;
}

const num = (v: CellValue): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  if (Number.isNaN(n)) throw new FormulaError('#VALEUR!');
  return n;
};

const numbersOf = (vs: CellValue[]): number[] => vs.filter((v) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))).map(num);

const FUNCTIONS: Record<string, (args: CellValue[][]) => CellValue> = {
  SUM: (a) => numbersOf(a.flat()).reduce((s, x) => s + x, 0),
  AVERAGE: (a) => {
    const n = numbersOf(a.flat());
    if (!n.length) throw new FormulaError('#DIV/0!');
    return n.reduce((s, x) => s + x, 0) / n.length;
  },
  MIN: (a) => Math.min(...numbersOf(a.flat())),
  MAX: (a) => Math.max(...numbersOf(a.flat())),
  COUNT: (a) => numbersOf(a.flat()).length,
  COUNTA: (a) => a.flat().filter((v) => v !== null && v !== '').length,
  ROUND: (a) => {
    const d = a[1] ? num(a[1][0]) : 0;
    const k = Math.pow(10, d);
    return Math.round(num(a[0][0]) * k) / k;
  },
  ABS: (a) => Math.abs(num(a[0][0])),
  SQRT: (a) => Math.sqrt(num(a[0][0])),
  IF: (a) => (truthy(a[0][0]) ? (a[1]?.[0] ?? true) : (a[2]?.[0] ?? false)),
  AND: (a) => a.flat().every(truthy),
  OR: (a) => a.flat().some(truthy),
  NOT: (a) => !truthy(a[0][0]),
  CONCAT: (a) => a.flat().map((v) => (v === null ? '' : String(v))).join(''),
  TODAY: () => {
    const d = new Date();
    return toSerial(d.getFullYear(), d.getMonth(), d.getDate());
  },
  DATE: (a) => toSerial(num(a[0][0]), num(a[1][0]) - 1, num(a[2][0])),
  YEAR: (a) => fromSerial(num(a[0][0])).getUTCFullYear(),
  MONTH: (a) => fromSerial(num(a[0][0])).getUTCMonth() + 1,
  DAY: (a) => fromSerial(num(a[0][0])).getUTCDate(),
  WEEKDAY: (a) => fromSerial(num(a[0][0])).getUTCDay() + 1,
  DAYS: (a) => Math.round(num(a[0][0]) - num(a[1][0])),
};
const ALIASES: Record<string, string> = {
  SOMME: 'SUM', MOYENNE: 'AVERAGE', AVG: 'AVERAGE', NB: 'COUNT', NBVAL: 'COUNTA', ARRONDI: 'ROUND', SI: 'IF', ET: 'AND', OU: 'OR', NON: 'NOT',
  RACINE: 'SQRT', CONCATENER: 'CONCAT', 'CONCATÉNER': 'CONCAT',
  AUJOURDHUI: 'TODAY', "AUJOURD'HUI": 'TODAY', ANNEE: 'YEAR', 'ANNÉE': 'YEAR', MOIS: 'MONTH', JOUR: 'DAY', JOURSEM: 'WEEKDAY', JOURS: 'DAYS',
};

function truthy(v: CellValue): boolean {
  if (typeof v === 'string') return v !== '' && v.toUpperCase() !== 'FAUX' && v.toUpperCase() !== 'FALSE';
  return !!v;
}

/** Evaluate a formula (without its leading `=`). Throws a FormulaError with the code to show. */
export function evaluate(src: string, ctx: FormulaContext): CellValue {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
  const target = (sheet?: string): FormulaContext => {
    if (!sheet) return ctx;
    const other = ctx.sheet?.(sheet);
    if (!other) throw new FormulaError('#REF!');
    return other;
  };
  const cell = (col: number, row: number, sheet?: string): CellValue => {
    const c = target(sheet);
    if (col < 0 || row < 0 || col >= c.cols || row >= c.rows) throw new FormulaError('#REF!');
    return c.get(col, row);
  };
  const rangeValues = (t: Extract<Token, { t: 'range' }>): CellValue[] => {
    const out: CellValue[] = [];
    for (let r = Math.min(t.r0, t.r1); r <= Math.max(t.r0, t.r1); r++) for (let c = Math.min(t.c0, t.c1); c <= Math.max(t.c0, t.c1); c++) out.push(cell(c, r, t.sheet));
    return out;
  };

  // comparison < concatenation < additive < multiplicative < power < unary < primary
  const comparison = (): CellValue => {
    let a = concat();
    for (;;) {
      const t = peek();
      if (t?.t !== 'op' || !['=', '<>', '<', '>', '<=', '>='].includes(t.v)) return a;
      p++;
      const b = concat();
      const [x, y] = typeof a === 'number' || typeof b === 'number' ? [num(a), num(b)] : [String(a ?? ''), String(b ?? '')];
      a = t.v === '=' ? x === y : t.v === '<>' ? x !== y : t.v === '<' ? x < y : t.v === '>' ? x > y : t.v === '<=' ? x <= y : x >= y;
    }
  };
  const concat = (): CellValue => {
    let a = additive();
    while (isOp('&')) {
      p++;
      a = String(a ?? '') + String(additive() ?? '');
    }
    return a;
  };
  const additive = (): CellValue => {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[p++] as { v: string }).v;
      const b = term();
      a = op === '+' ? num(a) + num(b) : num(a) - num(b);
    }
    return a;
  };
  const term = (): CellValue => {
    let a = power();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[p++] as { v: string }).v;
      const b = num(power());
      if (op === '/' && b === 0) throw new FormulaError('#DIV/0!');
      a = op === '*' ? num(a) * b : num(a) / b;
    }
    return a;
  };
  const power = (): CellValue => {
    const a = unary();
    if (isOp('^')) {
      p++;
      return Math.pow(num(a), num(power()));
    }
    return a;
  };
  const unary = (): CellValue => {
    if (isOp('-')) {
      p++;
      return -num(unary());
    }
    if (isOp('+')) {
      p++;
      return num(unary());
    }
    const v = primary();
    if (isOp('%')) {
      p++;
      return num(v) / 100;
    }
    return v;
  };
  const args = (): CellValue[][] => {
    const out: CellValue[][] = [];
    if (isOp(')')) return out;
    for (;;) {
      const t = peek();
      if (t?.t === 'range' && (tokens[p + 1]?.t !== 'op' || [';', ',', ')'].includes((tokens[p + 1] as { v: string }).v))) {
        p++;
        out.push(rangeValues(t));
      } else out.push([comparison()]);
      if (isOp(';') || isOp(',')) {
        p++;
        continue;
      }
      return out;
    }
  };
  const primary = (): CellValue => {
    const t = tokens[p++];
    if (!t) throw new FormulaError('#ERREUR');
    if (t.t === 'num' || t.t === 'str') return t.v;
    if (t.t === 'ref') return cell(t.col, t.row, t.sheet);
    if (t.t === 'range') throw new FormulaError('#VALEUR!');
    if (t.t === 'name') {
      if (t.v === 'TRUE' || t.v === 'VRAI') return true;
      if (t.v === 'FALSE' || t.v === 'FAUX') return false;
      const fn = FUNCTIONS[ALIASES[t.v] ?? t.v];
      if (!fn || !isOp('(')) throw new FormulaError('#NOM?');
      p++;
      const a = args();
      if (!isOp(')')) throw new FormulaError('#ERREUR');
      p++;
      return fn(a);
    }
    if (t.v === '(') {
      const v = comparison();
      if (!isOp(')')) throw new FormulaError('#ERREUR');
      p++;
      return v;
    }
    throw new FormulaError('#ERREUR');
  };
  const v = comparison();
  if (p < tokens.length) throw new FormulaError('#ERREUR');
  return typeof v === 'number' && !Number.isFinite(v) ? (() => { throw new FormulaError('#NOMBRE!'); })() : v;
}
