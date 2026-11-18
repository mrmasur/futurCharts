/**
 * The data side of a sheet, without any DOM: cells, typed columns, formulas
 * (across sheets of a workbook), merged ranges and cell styles. A workbook
 * keeps one model per sheet; only the visible one has a view.
 */
import { numberFormatter, type FormatSpec } from '../util/format';
import { columnIndex, columnName, evaluate, fromSerial, FormulaError, isoToSerial, serialToIso, toSerial, type CellValue, type FormulaContext } from './formula';

export interface SheetColumn {
  key: string;
  /** Header text. Default: the key. */
  label?: string;
  /** px. Default 110 (number), 120 (date) or 140 (text). */
  width?: number;
  /** `number` and `date` cells parse what is typed. Default: from the data. */
  type?: 'number' | 'text' | 'date';
  format?: FormatSpec;
  /** How a `date` column shows its dates. Default: day, month, year. */
  dateFormat?: Intl.DateTimeFormatOptions;
  align?: 'left' | 'center' | 'right';
  /** Default: the sheet's `editable`. */
  editable?: boolean;
  /** Shade each cell by its value (the theme's sequential ramp). */
  heat?: boolean;
  /** A bar inside each cell, as long as the value. */
  bar?: boolean;
  /** Totals row: how this column sums up. Default `sum` for numbers when `totals` is on. */
  total?: 'sum' | 'average' | 'min' | 'max' | 'count' | 'none';
}

/** Restyle the cells that match (first matching rule wins). */
export interface SheetRule {
  /** Column key; all columns when absent. */
  column?: string;
  when: { gt?: number; gte?: number; lt?: number; lte?: number; equals?: CellValue; contains?: string; error?: boolean };
  style: { background?: string; color?: string; bold?: boolean };
}

/** Formatting of one cell, set from the toolbar or in the spec. */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right';
}

export interface SheetSpec {
  /** Sheet name (its tab in a workbook, and `Name!A1` in formulas). */
  name?: string;
  /** One object per row. A string starting with `=` is a formula. Dates as `YYYY-MM-DD`. */
  rows: Record<string, CellValue>[];
  /** Default: one column per key of the first row. */
  columns?: SheetColumn[];
  title?: string;
  theme?: import('../theme/theme').ThemeSpec;
  /** px. Default 30. */
  rowHeight?: number;
  /** Row heights set by hand (row index → px), as reported by the `resize` event. */
  rowHeights?: Record<number, number>;
  /** Columns that stay in view when scrolling sideways. Default 1. */
  frozenColumns?: number;
  /** Row numbers on the left (and the A, B, C… letters above). Default true. */
  headers?: boolean;
  /** Default true. */
  editable?: boolean;
  /** A totals row pinned at the bottom. */
  totals?: boolean;
  /** Alternate row shading. Default true. */
  zebra?: boolean;
  /** Formula bar above the grid. Default true. */
  formulaBar?: boolean;
  /** Formatting buttons (merge, bold, italic, alignment, colors) in the formula bar. Default: when editable. */
  toolbar?: boolean;
  /** Sum, average and count of the selection, under the grid. Default true. */
  statusBar?: boolean;
  /** px. Default 13. */
  fontSize?: number;
  sort?: { column: string; order: 'asc' | 'desc' };
  rules?: SheetRule[];
  /** Merged ranges, as `A1:C1` (rows counted from the first data row). Ignored while sorted. */
  merges?: string[];
  /** Formatting per cell, by reference (`B2`). */
  cells?: Record<string, CellStyle>;
}

export interface Merge {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

export type ResolvedColumn = SheetColumn & Required<Pick<SheetColumn, 'key' | 'label' | 'width' | 'type' | 'align'>>;

const parseRange = (ref: string): Merge | undefined => {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(ref.trim());
  if (!m) return undefined;
  const c0 = columnIndex(m[1]);
  const r0 = Number(m[2]) - 1;
  const c1 = m[3] ? columnIndex(m[3]) : c0;
  const r1 = m[4] ? Number(m[4]) - 1 : r0;
  return { c0: Math.min(c0, c1), r0: Math.min(r0, r1), c1: Math.max(c0, c1), r1: Math.max(r0, r1) };
};
export const rangeRef = (m: Merge) => `${columnName(m.c0)}${m.r0 + 1}:${columnName(m.c1)}${m.r1 + 1}`;
export const cellRef = (c: number, r: number) => `${columnName(c)}${r + 1}`;

/** `18/11/2026`, `18/11`, `2026-11-18`, `18.11.2026` → `2026-11-18`; undefined otherwise. */
export function parseDate(text: string): string | undefined {
  const t = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return serialToIso(toSerial(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(t);
  if (!m) return undefined;
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear();
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return serialToIso(toSerial(year, month - 1, day));
}

/** What a typed text becomes: a number (decimal comma, spaces, % accepted), a date, a formula, text, or nothing. */
export function parseInput(text: string, type: 'number' | 'text' | 'date'): CellValue {
  const t = text.trim();
  if (t === '') return null;
  if (t.startsWith('=')) return t;
  if (type === 'date') return parseDate(t) ?? t;
  if (type === 'number' || /^[-+]?[\d\s.,]+%?$/.test(t)) {
    const pct = t.endsWith('%');
    const n = Number(t.replace(/%$/, '').replace(/[\s  ]/g, '').replace(',', '.'));
    if (!Number.isNaN(n)) return pct ? n / 100 : n;
  }
  return t;
}

export class SheetModel {
  spec!: SheetSpec;
  rows: Record<string, CellValue>[] = [];
  cols: ResolvedColumn[] = [];
  heights: number[] = [];
  merges: Merge[] = [];
  cells: Record<string, CellStyle> = {};
  private cache = new Map<number, CellValue | FormulaError>();
  private evaluating = new Set<number>();

  /** `resolve`: the other sheets of the workbook, for `Name!A1`. */
  constructor(spec: SheetSpec, public resolve?: (name: string) => SheetModel | undefined) {
    this.setSpec(spec);
  }

  get name(): string {
    return this.spec.name ?? '';
  }

  setSpec(spec: SheetSpec): void {
    this.spec = spec;
    this.rows = spec.rows.map((r) => ({ ...r }));
    const sample = this.rows.find((r) => r) ?? {};
    const defs: SheetColumn[] = spec.columns ?? Object.keys(sample).map((key) => ({ key }));
    this.cols = defs.map((c) => {
      const type =
        c.type ??
        (this.rows.some((r) => typeof r[c.key] === 'number') ? 'number' : this.rows.some((r) => typeof r[c.key] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r[c.key] as string)) ? 'date' : 'text');
      return {
        ...c,
        label: c.label ?? c.key,
        type,
        width: c.width ?? (type === 'number' ? 110 : type === 'date' ? 120 : 140),
        align: c.align ?? (type === 'text' ? 'left' : 'right'),
      };
    });
    const h = spec.rowHeight ?? 30;
    this.heights = this.rows.map((_, i) => spec.rowHeights?.[i] ?? h);
    this.merges = (spec.merges ?? []).map(parseRange).filter((m): m is Merge => !!m && (m.c1 > m.c0 || m.r1 > m.r0));
    this.cells = { ...(spec.cells ?? {}) };
    this.invalidate();
  }

  /** The spec as it is now: cells, widths, heights, merges, formatting. */
  getSpec(): SheetSpec {
    const rowHeights: Record<number, number> = {};
    const h = this.spec.rowHeight ?? 30;
    this.heights.forEach((v, i) => v !== h && (rowHeights[i] = v));
    return {
      ...this.spec,
      rows: this.rows.map((r) => ({ ...r })),
      columns: this.cols.map((c) => ({ ...c })),
      rowHeights,
      merges: this.merges.map(rangeRef),
      cells: { ...this.cells },
    };
  }

  invalidate(): void {
    this.cache.clear();
  }

  /** What other sheets' formulas see of this one. */
  context(): FormulaContext {
    return {
      cols: this.cols.length,
      rows: this.rows.length,
      get: (c, r) => {
        const v = this.computed(c, r);
        if (v instanceof FormulaError) throw v;
        return v;
      },
      sheet: (name) => this.resolve?.(name)?.context(),
    };
  }

  raw(c: number, r: number): CellValue {
    return this.rows[r]?.[this.cols[c]?.key] ?? null;
  }

  /** A cell's value: its formula computed, a date as its day number (errors as FormulaError). */
  computed(c: number, r: number): CellValue | FormulaError {
    const id = r * 4096 + c;
    const hit = this.cache.get(id);
    if (hit !== undefined) return hit;
    const raw = this.raw(c, r);
    let out: CellValue | FormulaError = raw;
    if (typeof raw === 'string' && raw.startsWith('=')) {
      if (this.evaluating.has(id)) return new FormulaError('#CYCLE!');
      this.evaluating.add(id);
      try {
        out = evaluate(raw.slice(1), this.context());
      } catch (e) {
        out = e instanceof FormulaError ? e : new FormulaError('#ERREUR');
      }
      this.evaluating.delete(id);
    } else if (typeof raw === 'string' && this.cols[c]?.type === 'date') {
      out = isoToSerial(raw) ?? raw;
    }
    this.cache.set(id, out);
    return out;
  }

  valueOrError(c: number, r: number): CellValue {
    const v = this.computed(c, r);
    return v instanceof FormulaError ? v.message : v;
  }

  numeric(c: number, r: number): number | undefined {
    const v = this.computed(c, r);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }

  display(c: number, r: number): string {
    const v = this.computed(c, r);
    if (v instanceof FormulaError) return v.message;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'VRAI' : 'FAUX';
    const col = this.cols[c];
    if (typeof v === 'number' && col.type === 'date') return this.formatDate(col, v);
    if (typeof v === 'number') return numberFormatter(col.format)(v);
    return String(v);
  }

  private formatDate(col: ResolvedColumn, serial: number): string {
    return new Intl.DateTimeFormat(undefined, { ...(col.dateFormat ?? { day: '2-digit', month: '2-digit', year: 'numeric' }), timeZone: 'UTC' }).format(fromSerial(serial));
  }

  /** Raw content as typed in the cell editor (formula, number with a decimal comma, date as dd/mm/yyyy). */
  editText(c: number, r: number): string {
    const raw = this.raw(c, r);
    if (raw === null) return '';
    if (typeof raw === 'number') return String(raw).replace('.', ',');
    if (this.cols[c]?.type === 'date' && typeof raw === 'string' && !raw.startsWith('=')) {
      // Always day/month/year here, whatever the locale: it is how typed dates are read back.
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    }
    return String(raw);
  }

  /** Writes cells; returns what they held before (for undo). */
  write(changes: { row: number; key: string; value: CellValue }[]): { row: number; key: string; value: CellValue }[] {
    const before: { row: number; key: string; value: CellValue }[] = [];
    for (const ch of changes) {
      if (!this.rows[ch.row]) continue;
      const previous = this.rows[ch.row][ch.key] ?? null;
      if (previous === ch.value) continue;
      before.push({ row: ch.row, key: ch.key, value: previous });
      this.rows[ch.row][ch.key] = ch.value;
    }
    return before;
  }

  // ------------------------------------------------------- merges, styles

  /** The merge covering a cell (data row), if any. */
  mergeAt(c: number, r: number): Merge | undefined {
    return this.merges.find((m) => c >= m.c0 && c <= m.c1 && r >= m.r0 && r <= m.r1);
  }

  /** Merge a range: it replaces the merges it overlaps. A single cell unmerges. */
  merge(range: Merge): void {
    const overlaps = (m: Merge) => !(m.c1 < range.c0 || m.c0 > range.c1 || m.r1 < range.r0 || m.r0 > range.r1);
    this.merges = this.merges.filter((m) => !overlaps(m));
    if (range.c1 > range.c0 || range.r1 > range.r0) this.merges.push({ ...range });
  }

  unmerge(range: Merge): void {
    this.merges = this.merges.filter((m) => m.c1 < range.c0 || m.c0 > range.c1 || m.r1 < range.r0 || m.r0 > range.r1);
  }

  styleOf(c: number, r: number): CellStyle | undefined {
    return this.cells[cellRef(c, r)];
  }

  /** Apply (or clear, with `null`) formatting on every cell of a range. */
  setStyle(range: Merge, patch: CellStyle | null): void {
    for (let r = range.r0; r <= range.r1; r++) {
      for (let c = range.c0; c <= range.c1; c++) {
        const ref = cellRef(c, r);
        if (patch === null) {
          delete this.cells[ref];
          continue;
        }
        const next = { ...this.cells[ref], ...patch };
        for (const k of Object.keys(next) as (keyof CellStyle)[]) if (next[k] === undefined || next[k] === false) delete next[k];
        if (Object.keys(next).length) this.cells[ref] = next;
        else delete this.cells[ref];
      }
    }
  }
}
