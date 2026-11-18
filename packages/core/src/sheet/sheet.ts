/**
 * `Sheet`: an editable grid, for those who want the numbers themselves. Typed
 * columns with formats, formulas (`=SUM(B2:B9)`), column and row resizing,
 * sorting, frozen columns, a totals row, heat colors and data bars, conditional
 * rules, keyboard navigation, copy and paste with a spreadsheet, undo.
 *
 * It is DOM, not GPU: text editing, selection and the clipboard need real
 * elements. It shares the theme, the number formats and the colors of the charts.
 * Only the visible rows are in the DOM, so a sheet of 100 000 rows scrolls freely.
 */
import { resolveTheme, themeColor, type ThemeSpec } from '../theme/theme';
import { numberFormatter, type FormatSpec } from '../util/format';
import { luminance } from '../marks/primitives';
import { parseColor, sampleRamp, toCss, withAlpha } from '../util/color';
import { columnName, evaluate, FormulaError, type CellValue } from './formula';

export type { CellValue } from './formula';

export interface SheetColumn {
  key: string;
  /** Header text. Default: the key. */
  label?: string;
  /** px. Default 110 (number) or 140 (text). */
  width?: number;
  /** `number` cells parse what is typed as a number. Default: from the data. */
  type?: 'number' | 'text';
  format?: FormatSpec;
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

export interface SheetSpec {
  /** One object per row. A string starting with `=` is a formula. */
  rows: Record<string, CellValue>[];
  /** Default: one column per key of the first row. */
  columns?: SheetColumn[];
  title?: string;
  theme?: ThemeSpec;
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
  /** Sum, average and count of the selection, under the grid. Default true. */
  statusBar?: boolean;
  /** px. Default 13. */
  fontSize?: number;
  sort?: { column: string; order: 'asc' | 'desc' };
  rules?: SheetRule[];
}

export interface SheetEvents {
  change: { row: number; column: string; value: CellValue; previous: CellValue };
  resize: { columns: Record<string, number>; rows: Record<number, number> };
  select: { range: [number, number, number, number]; sum: number; count: number; average: number };
}

interface Range {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

const ROW_NUMBERS = 46;
const OVERSCAN = 6;

let measurer: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, font: string): number {
  if (measurer === undefined) measurer = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 7;
  measurer.font = font;
  return measurer.measureText(text).width;
}

/** What a typed text becomes: a number (decimal comma, spaces, % accepted), a formula, text, or nothing. */
export function parseInput(text: string, type: 'number' | 'text'): CellValue {
  const t = text.trim();
  if (t === '') return null;
  if (t.startsWith('=')) return t;
  if (type === 'number' || /^[-+]?[\d\s.,]+%?$/.test(t)) {
    const pct = t.endsWith('%');
    const n = Number(t.replace(/%$/, '').replace(/[\s  ]/g, '').replace(',', '.'));
    if (!Number.isNaN(n)) return pct ? n / 100 : n;
  }
  return t;
}

export class Sheet {
  private spec!: SheetSpec;
  private cols: (SheetColumn & Required<Pick<SheetColumn, 'key' | 'label' | 'width' | 'type' | 'align'>>)[] = [];
  private rows: Record<string, CellValue>[] = [];
  private heights: number[] = [];
  private tops: number[] = [];
  private order: number[] = [];
  private cache = new Map<number, CellValue | FormulaError>();
  private evaluating = new Set<number>();
  private sel: Range = { c0: 0, r0: 0, c1: 0, r1: 0 };
  private active = { c: 0, r: 0 };
  private undo: { row: number; key: string; value: CellValue }[][] = [];
  private listeners = new Map<keyof SheetEvents, Set<(p: any) => void>>();
  private frame = 0;

  private root!: HTMLDivElement;
  private bar!: HTMLDivElement;
  private refBox!: HTMLSpanElement;
  private formulaInput!: HTMLInputElement;
  private scroller!: HTMLDivElement;
  private header!: HTMLDivElement;
  private body!: HTMLDivElement;
  /** The visible rows, redrawn on scroll; the cell editor sits beside them so a redraw never takes it away. */
  private rowsEl!: HTMLDivElement;
  private footer!: HTMLDivElement;
  private status!: HTMLDivElement;
  private editor?: { input: HTMLInputElement; row: number; col: number };
  private colors = { bg: '#fff', ink: '#000', muted: '#666', grid: '#ddd', head: '#f6f6f6', accent: [0, 0, 1, 1] as number[], ramp: [] as number[][], bad: '#d03b3b' };
  private font = '';

  private constructor(private container: HTMLElement) {}

  static async create(container: HTMLElement, spec: SheetSpec): Promise<Sheet> {
    const s = new Sheet(container);
    s.mount();
    s.update(spec);
    return s;
  }

  // ------------------------------------------------------------------ public

  update(spec: SheetSpec): void {
    this.spec = spec;
    this.rows = spec.rows.map((r) => ({ ...r }));
    const sample = this.rows.find((r) => r) ?? {};
    const defs: SheetColumn[] = spec.columns ?? Object.keys(sample).map((key) => ({ key }));
    this.cols = defs.map((c) => {
      const type = c.type ?? (this.rows.some((r) => typeof r[c.key] === 'number') ? 'number' : 'text');
      return { ...c, label: c.label ?? c.key, type, width: c.width ?? (type === 'number' ? 110 : 140), align: c.align ?? (type === 'number' ? 'right' : 'left') };
    }) as typeof this.cols;
    const h = spec.rowHeight ?? 30;
    this.heights = this.rows.map((_, i) => spec.rowHeights?.[i] ?? h);
    this.applyTheme();
    this.invalidate();
    this.sortRows();
    this.clampSelection();
    this.layoutRows();
    this.renderAll();
  }

  /** The spec as it is now: edited cells, widths and heights set by hand, sort. */
  getSpec(): SheetSpec {
    const rowHeights: Record<number, number> = {};
    const h = this.spec.rowHeight ?? 30;
    this.heights.forEach((v, i) => v !== h && (rowHeights[i] = v));
    return { ...this.spec, rows: this.rows.map((r) => ({ ...r })), columns: this.cols.map((c) => ({ ...c })), rowHeights };
  }

  /** Rows with every formula replaced by its value. */
  getData(): Record<string, CellValue>[] {
    return this.rows.map((_, r) => Object.fromEntries(this.cols.map((c, ci) => [c.key, this.valueOrError(ci, r)])).valueOf() as Record<string, CellValue>);
  }

  setCell(row: number, column: string, value: CellValue): void {
    this.write([{ row, key: column, value }]);
  }

  on<K extends keyof SheetEvents>(type: K, handler: (payload: SheetEvents[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.root.remove();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ values

  private emit<K extends keyof SheetEvents>(type: K, payload: SheetEvents[K]): void {
    for (const h of this.listeners.get(type) ?? []) h(payload);
  }

  private invalidate(): void {
    this.cache.clear();
  }

  private raw(c: number, r: number): CellValue {
    return this.rows[r]?.[this.cols[c]?.key] ?? null;
  }

  /** A cell's value, its formula computed (errors as FormulaError). */
  private computed(c: number, r: number): CellValue | FormulaError {
    const id = r * 4096 + c;
    const hit = this.cache.get(id);
    if (hit !== undefined) return hit;
    const raw = this.raw(c, r);
    let out: CellValue | FormulaError = raw;
    if (typeof raw === 'string' && raw.startsWith('=')) {
      if (this.evaluating.has(id)) return new FormulaError('#CYCLE!');
      this.evaluating.add(id);
      try {
        out = evaluate(raw.slice(1), {
          cols: this.cols.length,
          rows: this.rows.length,
          get: (cc, rr) => {
            const v = this.computed(cc, rr);
            if (v instanceof FormulaError) throw v;
            return v;
          },
        });
      } catch (e) {
        out = e instanceof FormulaError ? e : new FormulaError('#ERREUR');
      }
      this.evaluating.delete(id);
    }
    this.cache.set(id, out);
    return out;
  }

  private valueOrError(c: number, r: number): CellValue {
    const v = this.computed(c, r);
    return v instanceof FormulaError ? v.message : v;
  }

  private numeric(c: number, r: number): number | undefined {
    const v = this.computed(c, r);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }

  private display(c: number, r: number): string {
    const v = this.computed(c, r);
    if (v instanceof FormulaError) return v.message;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'VRAI' : 'FAUX';
    if (typeof v === 'number') return numberFormatter(this.cols[c].format)(v);
    return String(v);
  }

  /** Writes cells (with undo), then redraws. */
  private write(changes: { row: number; key: string; value: CellValue }[], record = true): void {
    const before: { row: number; key: string; value: CellValue }[] = [];
    for (const ch of changes) {
      if (!this.rows[ch.row]) continue;
      const previous = this.rows[ch.row][ch.key] ?? null;
      if (previous === ch.value) continue;
      before.push({ row: ch.row, key: ch.key, value: previous });
      this.rows[ch.row][ch.key] = ch.value;
    }
    if (!before.length) return;
    if (record) {
      this.undo.push(before);
      if (this.undo.length > 200) this.undo.shift();
    }
    this.invalidate();
    for (const ch of changes) this.emit('change', { row: ch.row, column: ch.key, value: ch.value, previous: before.find((b) => b.row === ch.row && b.key === ch.key)?.value ?? null });
    this.renderBody();
    this.renderFooter();
    this.renderStatus();
  }

  // ------------------------------------------------------------------ layout

  private applyTheme(): void {
    const t = resolveTheme(this.spec.theme);
    const bg = t.background === 'transparent' ? '#ffffff' : t.background;
    const ink = parseColor(t.text.primary);
    this.colors = {
      bg,
      ink: t.text.primary,
      muted: t.text.muted,
      grid: t.grid.y.color,
      head: toCss(withAlpha(ink, 0.045)),
      accent: parseColor(themeColor(t, '$1')),
      ramp: t.palette.sequential.map(parseColor),
      bad: t.marks.kpi.bad,
    };
    const size = this.spec.fontSize ?? 13;
    this.font = `${size}px ${t.font.family}`;
    this.root.style.cssText = `display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;background:${bg};color:${t.text.primary};font:${this.font};font-variant-numeric:tabular-nums;border:1px solid ${this.colors.grid};border-radius:8px;overflow:hidden;`;
    this.bar.style.display = this.spec.formulaBar === false ? 'none' : 'flex';
    this.status.style.display = this.spec.statusBar === false ? 'none' : 'flex';
  }

  private sortRows(): void {
    this.order = this.rows.map((_, i) => i);
    const s = this.spec.sort;
    const c = s ? this.cols.findIndex((x) => x.key === s.column) : -1;
    if (c < 0) return;
    const dir = s!.order === 'desc' ? -1 : 1;
    this.order.sort((a, b) => {
      const x = this.computed(c, a);
      const y = this.computed(c, b);
      const nx = typeof x === 'number' ? x : NaN;
      const ny = typeof y === 'number' ? y : NaN;
      // Empty and non-numeric values go last, whatever the order.
      if (Number.isNaN(nx) || Number.isNaN(ny)) {
        if (!Number.isNaN(nx)) return -1;
        if (!Number.isNaN(ny)) return 1;
        return dir * String(x ?? '').localeCompare(String(y ?? ''));
      }
      return dir * (nx - ny);
    });
  }

  private layoutRows(): void {
    this.tops = new Array(this.order.length + 1);
    this.tops[0] = 0;
    this.order.forEach((r, v) => (this.tops[v + 1] = this.tops[v] + this.heights[r]));
  }

  private rowNumbers(): number {
    return this.spec.headers === false ? 0 : ROW_NUMBERS;
  }

  private totalWidth(): number {
    return this.rowNumbers() + this.cols.reduce((a, c) => a + c.width, 0);
  }

  /** Left offset of each frozen column (sticky), undefined for the others. */
  private stickyLeft(c: number): number | undefined {
    const frozen = this.spec.frozenColumns ?? 1;
    if (c >= frozen) return undefined;
    let x = this.rowNumbers();
    for (let i = 0; i < c; i++) x += this.cols[i].width;
    return x;
  }

  private clampSelection(): void {
    const C = Math.max(0, this.cols.length - 1);
    const R = Math.max(0, this.order.length - 1);
    const k = (v: number, m: number) => Math.max(0, Math.min(m, v));
    this.sel = { c0: k(this.sel.c0, C), r0: k(this.sel.r0, R), c1: k(this.sel.c1, C), r1: k(this.sel.r1, R) };
    this.active = { c: k(this.active.c, C), r: k(this.active.r, R) };
  }

  // ----------------------------------------------------------------- DOM

  private mount(): void {
    const root = (this.root = document.createElement('div'));
    root.className = 'fc-sheet';
    // Formula bar: the active cell's reference and its raw content (editable).
    this.bar = document.createElement('div');
    this.bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--fc-grid);flex:none;';
    this.refBox = document.createElement('span');
    this.refBox.style.cssText = 'min-width:44px;font-weight:600;opacity:.75;';
    this.formulaInput = document.createElement('input');
    this.formulaInput.style.cssText = 'flex:1;min-width:0;border:0;outline:none;background:transparent;color:inherit;font:inherit;padding:2px 4px;';
    this.formulaInput.setAttribute('aria-label', 'Contenu de la cellule');
    this.formulaInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.commitTo(this.active.c, this.active.r, this.formulaInput.value);
        this.scroller.focus();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.renderStatus();
        this.scroller.focus();
      }
    });
    this.bar.append(this.refBox, this.formulaInput);

    this.scroller = document.createElement('div');
    this.scroller.tabIndex = 0;
    this.scroller.style.cssText = 'position:relative;flex:1;min-height:0;overflow:auto;outline:none;';
    this.scroller.setAttribute('role', 'grid');
    const inner = document.createElement('div');
    inner.style.cssText = 'position:relative;';
    this.header = document.createElement('div');
    this.body = document.createElement('div');
    this.rowsEl = document.createElement('div');
    this.body.appendChild(this.rowsEl);
    this.footer = document.createElement('div');
    inner.append(this.header, this.body, this.footer);
    this.scroller.appendChild(inner);

    this.status = document.createElement('div');
    this.status.style.cssText = 'display:flex;gap:18px;justify-content:flex-end;padding:5px 10px;font-size:12px;flex:none;min-height:16px;';

    root.append(this.bar, this.scroller, this.status);
    this.container.appendChild(root);

    this.scroller.addEventListener('scroll', () => this.schedule());
    this.scroller.addEventListener('keydown', (e) => this.onKey(e));
    this.scroller.addEventListener('copy', (e) => this.onCopy(e));
    this.scroller.addEventListener('paste', (e) => this.onPaste(e));
    this.scroller.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.scroller.addEventListener('dblclick', (e) => {
      const cell = this.cellAt(e);
      if (cell) this.startEdit(cell.c, cell.r);
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.schedule()).observe(this.scroller);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderBody();
    });
  }

  private renderAll(): void {
    const total = this.totalWidth();
    this.root.style.setProperty('--fc-grid', this.colors.grid);
    for (const el of [this.header, this.body, this.footer]) el.style.width = `${total}px`;
    this.renderHeader();
    this.renderBody();
    this.renderFooter();
    this.renderStatus();
  }

  private cellCss(c: number | 'num', width: number, extra = ''): string {
    const left = c === 'num' ? (this.spec.headers === false ? undefined : 0) : this.stickyLeft(c);
    const sticky = left !== undefined ? `position:sticky;left:${left}px;z-index:1;` : '';
    return `${sticky}flex:none;width:${width}px;box-sizing:border-box;height:100%;display:flex;align-items:center;padding:0 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border-right:1px solid ${this.colors.grid};border-bottom:1px solid ${this.colors.grid};${extra}`;
  }

  private renderHeader(): void {
    const h = this.header;
    const headH = this.spec.headers === false ? 32 : 46;
    h.style.cssText = `position:sticky;top:0;z-index:3;display:flex;height:${headH}px;width:${this.totalWidth()}px;background:${this.colors.bg};`;
    h.replaceChildren();
    if (this.spec.headers !== false) {
      const corner = document.createElement('div');
      corner.style.cssText = this.cellCss('num', ROW_NUMBERS, `background:${this.colors.bg};background-image:linear-gradient(${this.colors.head},${this.colors.head});z-index:2;`);
      h.appendChild(corner);
    }
    const sort = this.spec.sort;
    this.cols.forEach((col, c) => {
      const cell = document.createElement('div');
      const left = this.stickyLeft(c);
      cell.style.cssText = this.cellCss(c, col.width, `position:${left !== undefined ? 'sticky' : 'relative'};flex-direction:column;align-items:${col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start'};justify-content:center;gap:1px;background:${this.colors.bg};background-image:linear-gradient(${this.colors.head},${this.colors.head});cursor:pointer;user-select:none;${left !== undefined ? 'z-index:2;' : ''}`);
      cell.dataset.col = String(c);
      cell.title = 'Cliquer pour trier';
      const arrow = sort?.column === col.key ? (sort.order === 'asc' ? ' ▲' : ' ▼') : '';
      if (this.spec.headers !== false) {
        const letter = document.createElement('span');
        letter.textContent = columnName(c);
        letter.style.cssText = `font-size:10px;color:${this.colors.muted};`;
        cell.appendChild(letter);
      }
      const label = document.createElement('span');
      label.textContent = col.label + arrow;
      label.style.cssText = 'font-weight:600;overflow:hidden;text-overflow:ellipsis;max-width:100%;';
      cell.appendChild(label);
      // Resize handle on the right edge; double-click fits the content.
      const handle = document.createElement('div');
      handle.dataset.resizeCol = String(c);
      handle.style.cssText = 'position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:3;';
      handle.title = 'Glisser pour élargir, double-clic pour ajuster';
      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.autofit(c);
      });
      cell.appendChild(handle);
      h.appendChild(cell);
    });
  }

  private renderBody(): void {
    const b = this.body;
    const n = this.order.length;
    const height = this.tops[n] ?? 0;
    b.style.cssText = `position:relative;height:${height}px;`;
    const view = this.scroller;
    const headH = this.header.offsetHeight || 46;
    const top = Math.max(0, view.scrollTop - headH);
    const bottom = top + view.clientHeight;
    // First and last visible rows (binary search on the row tops).
    const find = (y: number) => {
      let lo = 0, hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.tops[mid + 1] <= y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const first = Math.max(0, find(top) - OVERSCAN);
    const last = Math.min(n - 1, find(bottom) + OVERSCAN);
    const frag = document.createDocumentFragment();
    const stats = this.columnStats();
    const sel = this.normalized();
    for (let v = first; v <= last; v++) frag.appendChild(this.renderRow(v, stats, sel));
    this.rowsEl.replaceChildren(frag);
    if (this.editor && this.editor.row >= first && this.editor.row <= last) this.placeEditor();
  }

  /** Min and max of the heat / bar columns, for their color and length. */
  private columnStats(): Map<number, { lo: number; hi: number }> {
    const out = new Map<number, { lo: number; hi: number }>();
    this.cols.forEach((col, c) => {
      if (!col.heat && !col.bar) return;
      let lo = Infinity, hi = -Infinity;
      for (let r = 0; r < this.rows.length; r++) {
        const v = this.numeric(c, r);
        if (v === undefined) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (lo <= hi) out.set(c, { lo, hi });
    });
    return out;
  }

  private renderRow(v: number, stats: Map<number, { lo: number; hi: number }>, sel: Range): HTMLDivElement {
    const r = this.order[v];
    const row = document.createElement('div');
    const zebra = this.spec.zebra !== false && v % 2 === 1;
    const rowBg = zebra ? `linear-gradient(${this.colors.head},${this.colors.head})` : 'none';
    row.style.cssText = `position:absolute;left:0;top:${this.tops[v]}px;height:${this.heights[r]}px;display:flex;width:${this.totalWidth()}px;`;
    if (this.spec.headers !== false) {
      const num = document.createElement('div');
      const inSel = v >= sel.r0 && v <= sel.r1;
      num.style.cssText = this.cellCss('num', ROW_NUMBERS, `position:sticky;justify-content:flex-end;color:${this.colors.muted};font-size:11px;background:${this.colors.bg};background-image:linear-gradient(${inSel ? toCss(withAlpha(this.colors.accent as never, 0.16)) : this.colors.head},${inSel ? toCss(withAlpha(this.colors.accent as never, 0.16)) : this.colors.head});z-index:2;user-select:none;`);
      num.textContent = String(r + 1);
      const handle = document.createElement('div');
      handle.dataset.resizeRow = String(r);
      handle.style.cssText = 'position:absolute;left:0;bottom:-3px;width:100%;height:6px;cursor:row-resize;z-index:3;';
      handle.title = 'Glisser pour changer la hauteur';
      num.style.position = 'sticky';
      num.appendChild(handle);
      row.appendChild(num);
    }
    this.cols.forEach((col, c) => {
      const cell = document.createElement('div');
      const value = this.computed(c, r);
      const text = this.display(c, r);
      let bg = this.colors.bg;
      let image = rowBg;
      let color = this.colors.ink;
      let weight = 400;
      const n = typeof value === 'number' ? value : undefined;
      const st = stats.get(c);
      if (col.heat && n !== undefined && st) {
        const t = st.hi > st.lo ? (n - st.lo) / (st.hi - st.lo) : 0.5;
        const fill = sampleRamp(this.colors.ramp as never, 0.08 + 0.8 * t);
        bg = toCss(fill);
        image = 'none';
        color = luminance(fill) > 0.45 ? '#1a1a19' : '#ffffff';
      }
      if (col.bar && n !== undefined && st) {
        const max = Math.max(Math.abs(st.lo), Math.abs(st.hi)) || 1;
        const w = Math.round((Math.abs(n) / max) * 100);
        const c0 = n < 0 ? toCss(withAlpha(parseColor(this.colors.bad), 0.28)) : toCss(withAlpha(this.colors.accent as never, 0.28));
        image = `linear-gradient(90deg, ${c0} ${w}%, transparent ${w}%)${rowBg !== 'none' ? `, ${rowBg}` : ''}`;
      }
      const rule = this.rule(col.key, value);
      if (rule?.background) {
        bg = rule.background;
        image = 'none';
      }
      if (rule?.color) color = rule.color;
      if (rule?.bold) weight = 650;
      if (value instanceof FormulaError) color = this.colors.bad;
      const inSel = v >= sel.r0 && v <= sel.r1 && c >= sel.c0 && c <= sel.c1;
      const isActive = v === this.active.r && c === this.active.c;
      const overlay = inSel && !isActive ? `inset 0 0 0 9999px ${toCss(withAlpha(this.colors.accent as never, 0.12))}` : '';
      const ring = isActive ? `inset 0 0 0 2px ${toCss(this.colors.accent as never)}` : '';
      cell.style.cssText = this.cellCss(c, col.width, `justify-content:${col.align === 'right' ? 'flex-end' : col.align === 'center' ? 'center' : 'flex-start'};background:${bg};background-image:${image};color:${color};font-weight:${weight};box-shadow:${[overlay, ring].filter(Boolean).join(',') || 'none'};`);
      cell.dataset.col = String(c);
      cell.dataset.row = String(v);
      cell.textContent = text;
      row.appendChild(cell);
    });
    return row;
  }

  private rule(key: string, v: CellValue | FormulaError): SheetRule['style'] | undefined {
    for (const rule of this.spec.rules ?? []) {
      if (rule.column && rule.column !== key) continue;
      const w = rule.when;
      if (w.error) {
        if (v instanceof FormulaError) return rule.style;
        continue;
      }
      if (v instanceof FormulaError || v === null) continue;
      const n = typeof v === 'number' ? v : NaN;
      if (w.gt !== undefined && !(n > w.gt)) continue;
      if (w.gte !== undefined && !(n >= w.gte)) continue;
      if (w.lt !== undefined && !(n < w.lt)) continue;
      if (w.lte !== undefined && !(n <= w.lte)) continue;
      if (w.equals !== undefined && v !== w.equals) continue;
      if (w.contains !== undefined && !String(v).toLowerCase().includes(w.contains.toLowerCase())) continue;
      return rule.style;
    }
    return undefined;
  }

  private renderFooter(): void {
    const f = this.footer;
    if (!this.spec.totals) {
      f.replaceChildren();
      f.style.cssText = 'display:none;';
      return;
    }
    f.style.cssText = `position:sticky;bottom:0;z-index:3;display:flex;height:32px;width:${this.totalWidth()}px;background:${this.colors.bg};font-weight:650;border-top:2px solid ${this.colors.grid};`;
    f.replaceChildren();
    if (this.spec.headers !== false) {
      const num = document.createElement('div');
      num.style.cssText = this.cellCss('num', ROW_NUMBERS, `position:sticky;background:${this.colors.bg};z-index:2;font-size:11px;color:${this.colors.muted};justify-content:flex-end;`);
      num.textContent = 'Σ';
      f.appendChild(num);
    }
    const names: Record<string, string> = { sum: 'Somme', average: 'Moyenne', min: 'Min', max: 'Max', count: 'Nb' };
    this.cols.forEach((col, c) => {
      const cell = document.createElement('div');
      cell.style.cssText = this.cellCss(c, col.width, `justify-content:${col.align === 'right' ? 'flex-end' : 'flex-start'};background:${this.colors.bg};background-image:linear-gradient(${this.colors.head},${this.colors.head});`);
      const kind = col.total ?? (col.type === 'number' ? 'sum' : 'none');
      if (c === 0 && kind === 'none') cell.textContent = 'Total';
      else if (kind !== 'none') {
        const vals: number[] = [];
        for (let r = 0; r < this.rows.length; r++) {
          const v = this.numeric(c, r);
          if (v !== undefined) vals.push(v);
        }
        const value =
          kind === 'count' ? vals.length
          : !vals.length ? NaN
          : kind === 'sum' ? vals.reduce((a, x) => a + x, 0)
          : kind === 'average' ? vals.reduce((a, x) => a + x, 0) / vals.length
          : kind === 'min' ? Math.min(...vals)
          : Math.max(...vals);
        cell.textContent = kind === 'count' ? String(value) : numberFormatter(col.format)(value);
        cell.title = names[kind];
      }
      f.appendChild(cell);
    });
  }

  private renderStatus(): void {
    const { c, r } = this.active;
    const row = this.order[r];
    this.refBox.textContent = row === undefined ? '' : `${columnName(c)}${row + 1}`;
    const raw = row === undefined ? null : this.raw(c, row);
    if (document.activeElement !== this.formulaInput) this.formulaInput.value = raw === null ? '' : typeof raw === 'number' ? String(raw).replace('.', ',') : String(raw);
    this.formulaInput.readOnly = !this.editable(c);
    const s = this.normalized();
    const vals: number[] = [];
    for (let v = s.r0; v <= s.r1; v++) for (let cc = s.c0; cc <= s.c1; cc++) {
      const n = this.numeric(cc, this.order[v]);
      if (n !== undefined) vals.push(n);
    }
    const fmt = numberFormatter(this.cols[c]?.format);
    const sum = vals.reduce((a, x) => a + x, 0);
    const avg = vals.length ? sum / vals.length : NaN;
    this.status.style.color = this.colors.muted;
    this.status.replaceChildren();
    if (vals.length > 1) {
      for (const [k, v] of [['Somme', fmt(sum)], ['Moyenne', fmt(avg)], ['Nb', String(vals.length)]]) {
        const span = document.createElement('span');
        span.innerHTML = `${k} : <b style="color:${this.colors.ink}"></b>`;
        span.querySelector('b')!.textContent = v;
        this.status.appendChild(span);
      }
    }
    this.emit('select', { range: [s.c0, s.r0, s.c1, s.r1], sum, count: vals.length, average: avg });
  }

  // ------------------------------------------------------------- selection

  private normalized(): Range {
    const s = this.sel;
    return { c0: Math.min(s.c0, s.c1), r0: Math.min(s.r0, s.r1), c1: Math.max(s.c0, s.c1), r1: Math.max(s.r0, s.r1) };
  }

  private select(c: number, r: number, extend = false): void {
    const C = this.cols.length - 1;
    const R = this.order.length - 1;
    c = Math.max(0, Math.min(C, c));
    r = Math.max(0, Math.min(R, r));
    if (extend) {
      this.sel.c1 = c;
      this.sel.r1 = r;
    } else {
      this.sel = { c0: c, r0: r, c1: c, r1: r };
      this.active = { c, r };
    }
    this.scrollIntoView(extend ? c : this.active.c, extend ? r : this.active.r);
    this.renderBody();
    this.renderStatus();
  }

  private scrollIntoView(c: number, v: number): void {
    const s = this.scroller;
    const headH = this.header.offsetHeight;
    const footH = this.footer.offsetHeight;
    const y0 = this.tops[v] + headH;
    const y1 = this.tops[v + 1] + headH;
    if (y0 - headH < s.scrollTop) s.scrollTop = y0 - headH;
    else if (y1 + footH > s.scrollTop + s.clientHeight) s.scrollTop = y1 + footH - s.clientHeight;
    if (this.stickyLeft(c) !== undefined) return;
    let x0 = this.rowNumbers();
    for (let i = 0; i < c; i++) x0 += this.cols[i].width;
    const x1 = x0 + this.cols[c].width;
    let frozenW = this.rowNumbers();
    for (let i = 0; i < (this.spec.frozenColumns ?? 1) && i < this.cols.length; i++) frozenW += this.cols[i].width;
    if (x0 - frozenW < s.scrollLeft) s.scrollLeft = x0 - frozenW;
    else if (x1 > s.scrollLeft + s.clientWidth) s.scrollLeft = x1 - s.clientWidth;
  }

  private cellAt(e: MouseEvent): { c: number; r: number } | undefined {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (!el || !this.body.contains(el)) return undefined;
    return { c: Number(el.dataset.col), r: Number(el.dataset.row) };
  }

  // ------------------------------------------------------------------ input

  private editable(c: number): boolean {
    return this.cols[c]?.editable ?? this.spec.editable ?? true;
  }

  private onPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (this.editor && this.editor.input.contains(target)) return;
    if (target.dataset.resizeCol !== undefined) return this.dragColumn(e, Number(target.dataset.resizeCol));
    if (target.dataset.resizeRow !== undefined) return this.dragRow(e, Number(target.dataset.resizeRow));
    const head = target.closest<HTMLElement>('[data-col]');
    if (head && this.header.contains(head)) return this.toggleSort(Number(head.dataset.col));
    const cell = this.cellAt(e);
    if (!cell) return;
    this.finishEdit(true);
    e.preventDefault();
    this.scroller.focus({ preventScroll: true });
    this.select(cell.c, cell.r, e.shiftKey);
    // Drag to extend the selection.
    const move = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const over = el?.closest<HTMLElement>('[data-row]');
      if (over && this.body.contains(over)) {
        const c = Number(over.dataset.col);
        const r = Number(over.dataset.row);
        if (c !== this.sel.c1 || r !== this.sel.r1) this.select(c, r, true);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private toggleSort(c: number): void {
    const key = this.cols[c].key;
    const s = this.spec.sort;
    const next: SheetSpec['sort'] = !s || s.column !== key ? { column: key, order: 'asc' } : s.order === 'asc' ? { column: key, order: 'desc' } : undefined;
    this.spec = { ...this.spec, sort: next };
    this.sortRows();
    this.layoutRows();
    this.renderAll();
  }

  private dragColumn(e: PointerEvent, c: number): void {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = this.cols[c].width;
    const move = (ev: PointerEvent) => {
      this.cols[c].width = Math.max(36, Math.round(w0 + ev.clientX - x0));
      this.renderAll();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.emitResize();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private dragRow(e: PointerEvent, r: number): void {
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const h0 = this.heights[r];
    const move = (ev: PointerEvent) => {
      this.heights[r] = Math.max(18, Math.round(h0 + ev.clientY - y0));
      this.layoutRows();
      this.renderBody();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.emitResize();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Fit a column to its widest value (and its header). */
  private autofit(c: number): void {
    const col = this.cols[c];
    let w = textWidth(col.label, `600 ${this.font}`);
    for (let r = 0; r < this.rows.length; r++) w = Math.max(w, textWidth(this.display(c, r), this.font));
    col.width = Math.min(600, Math.max(48, Math.ceil(w + 22)));
    this.renderAll();
    this.emitResize();
  }

  private emitResize(): void {
    const spec = this.getSpec();
    this.emit('resize', { columns: Object.fromEntries(this.cols.map((c) => [c.key, c.width])), rows: spec.rowHeights ?? {} });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.editor) return;
    const mod = e.metaKey || e.ctrlKey;
    const { c, r } = this.active;
    const ext = e.shiftKey;
    const cur = ext ? { c: this.sel.c1, r: this.sel.r1 } : { c, r };
    const page = Math.max(1, Math.floor(this.scroller.clientHeight / (this.spec.rowHeight ?? 30)) - 1);
    const go = (dc: number, dr: number) => {
      e.preventDefault();
      this.select(cur.c + dc, cur.r + dr, ext);
    };
    switch (e.key) {
      case 'ArrowUp': return go(0, mod ? -cur.r : -1);
      case 'ArrowDown': return go(0, mod ? this.order.length : 1);
      case 'ArrowLeft': return go(mod ? -cur.c : -1, 0);
      case 'ArrowRight': return go(mod ? this.cols.length : 1, 0);
      case 'PageUp': return go(0, -page);
      case 'PageDown': return go(0, page);
      case 'Home': return go(-cur.c, mod ? -cur.r : 0);
      case 'End': return go(this.cols.length, mod ? this.order.length : 0);
      case 'Tab': return go(e.shiftKey ? -1 : 1, 0);
      case 'Enter':
      case 'F2':
        e.preventDefault();
        return this.startEdit(c, r);
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        const s = this.normalized();
        const changes = [];
        for (let v = s.r0; v <= s.r1; v++) for (let cc = s.c0; cc <= s.c1; cc++) if (this.editable(cc)) changes.push({ row: this.order[v], key: this.cols[cc].key, value: null });
        return this.write(changes);
      }
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      const last = this.undo.pop();
      if (last) this.write(last, false);
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.sel = { c0: 0, r0: 0, c1: this.cols.length - 1, r1: this.order.length - 1 };
      this.renderBody();
      this.renderStatus();
      return;
    }
    // Typing starts editing, replacing the content.
    if (!mod && !e.altKey && e.key.length === 1 && this.editable(c)) {
      e.preventDefault();
      this.startEdit(c, r, e.key);
    }
  }

  private startEdit(c: number, v: number, initial?: string): void {
    if (!this.editable(c) || this.order[v] === undefined) return;
    this.finishEdit(true);
    this.select(c, v);
    const raw = this.raw(c, this.order[v]);
    const input = document.createElement('input');
    input.value = initial ?? (raw === null ? '' : typeof raw === 'number' ? String(raw).replace('.', ',') : String(raw));
    input.style.cssText = `position:absolute;z-index:4;box-sizing:border-box;border:2px solid ${toCss(this.colors.accent as never)};outline:none;padding:0 6px;font:${this.font};color:${this.colors.ink};background:${this.colors.bg};text-align:${this.cols[c].align};`;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.finishEdit(true);
        this.select(c + (e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : 0), v + (e.key === 'Enter' ? (e.shiftKey ? -1 : 1) : 0));
        this.scroller.focus({ preventScroll: true });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finishEdit(false);
        this.scroller.focus({ preventScroll: true });
      }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => this.finishEdit(true));
    this.editor = { input, row: v, col: c };
    this.body.appendChild(input);
    this.placeEditor();
    input.focus();
    if (initial !== undefined) input.setSelectionRange(input.value.length, input.value.length);
    else input.select();
  }

  private placeEditor(): void {
    const ed = this.editor;
    if (!ed) return;
    const cell = this.rowsEl.querySelector<HTMLElement>(`[data-row="${ed.row}"][data-col="${ed.col}"]`);
    if (!cell) {
      // Scrolled out of view: parked aside, still focused, still editing.
      ed.input.style.left = '-9999px';
      return;
    }
    const box = cell.getBoundingClientRect();
    const host = this.body.getBoundingClientRect();
    Object.assign(ed.input.style, { left: `${box.left - host.left}px`, top: `${box.top - host.top}px`, width: `${Math.max(box.width, 80)}px`, height: `${box.height}px` });
    if (ed.input.parentElement !== this.body) this.body.appendChild(ed.input);
  }

  private finishEdit(commit: boolean): void {
    const ed = this.editor;
    if (!ed) return;
    this.editor = undefined;
    const text = ed.input.value;
    ed.input.remove();
    if (commit) this.commitTo(ed.col, ed.row, text);
    else this.renderBody();
  }

  private commitTo(c: number, v: number, text: string): void {
    const row = this.order[v];
    if (row === undefined || !this.editable(c)) return;
    this.write([{ row, key: this.cols[c].key, value: parseInput(text, this.cols[c].type) }]);
  }

  // -------------------------------------------------------------- clipboard

  /** The selection as tab-separated values, the way spreadsheets exchange it. */
  private onCopy(e: ClipboardEvent): void {
    if (this.editor) return;
    const s = this.normalized();
    const lines: string[] = [];
    for (let v = s.r0; v <= s.r1; v++) {
      const cells: string[] = [];
      for (let c = s.c0; c <= s.c1; c++) {
        const val = this.computed(c, this.order[v]);
        cells.push(val instanceof FormulaError ? val.message : val === null ? '' : typeof val === 'number' ? String(val) : String(val));
      }
      lines.push(cells.join('\t'));
    }
    e.clipboardData?.setData('text/plain', lines.join('\n'));
    e.preventDefault();
  }

  /** Paste a block from a spreadsheet, from the active cell (one value fills the whole selection). */
  private onPaste(e: ClipboardEvent): void {
    if (this.editor) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const grid = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const changes: { row: number; key: string; value: CellValue }[] = [];
    const s = this.normalized();
    if (grid.length === 1 && grid[0].length === 1) {
      for (let v = s.r0; v <= s.r1; v++) for (let c = s.c0; c <= s.c1; c++) if (this.editable(c)) changes.push({ row: this.order[v], key: this.cols[c].key, value: parseInput(grid[0][0], this.cols[c].type) });
    } else {
      grid.forEach((line, i) =>
        line.forEach((t, j) => {
          const v = s.r0 + i;
          const c = s.c0 + j;
          if (v < this.order.length && c < this.cols.length && this.editable(c)) changes.push({ row: this.order[v], key: this.cols[c].key, value: parseInput(t, this.cols[c].type) });
        }),
      );
      this.sel = { c0: s.c0, r0: s.r0, c1: Math.min(this.cols.length - 1, s.c0 + grid[0].length - 1), r1: Math.min(this.order.length - 1, s.r0 + grid.length - 1) };
    }
    this.write(changes);
  }
}

/** Same as `Sheet.create`. */
export function createSheet(container: HTMLElement, spec: SheetSpec): Promise<Sheet> {
  return Sheet.create(container, spec);
}
