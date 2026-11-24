/**
 * BI tables drawn on the GPU: `table` (formatted data table), and, in `tablesMatrix.ts`,
 * `matrix`, `confusion` and `calendarMonth`. Laid out in px (`ctx.pixel`), text as labels.
 */
import type { RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import { themeColor, type TableColumn } from '../theme/theme';
import { mix, parseColor, toCss, withAlpha } from '../util/color';
import { valueColor } from './charts';
import { pushRect, pushSegment } from './primitives';
import { emptyHit, type BuiltMark, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { ellipsis, tableColumns, tableRows, type ColumnNeed } from './tablesLayout';
import { batchOf, calendarMonth, confusion, matrix } from './tablesMatrix';
import { fillText } from '../theme/texts';

type Kind = NonNullable<TableColumn['type']>;

export function pushDot(out: number[], x: number, y: number, size: number, fill: RGBA): void {
  out.push(x, y, size, 0, fill[0], fill[1], fill[2], fill[3], 0, 0, 0, 0, 0);
}

interface Col {
  spec: TableColumn;
  kind: Kind;
  field?: string;
  label: string;
  align: 'left' | 'right' | 'center';
  /** Numeric values (NaN for text columns). */
  num?: Float64Array;
  text(row: number, position: number): string;
  lo: number;
  hi: number;
  /** Value of the total row (NaN: none). */
  total: number;
  /** Widest value text, px (bar columns keep their figures aligned). */
  valueW: number;
}

/**
 * `table`: one line per data row, columns described in `style.cols`. Cells are text, formatted
 * numbers, bars around zero, shaded backgrounds, colored changes, status dots, ratings or ranks.
 * Rows that do not fit give way to "+ n lignes"; on a narrow screen the least important columns go
 * (their values stay in the tooltip).
 */
export const table: MarkDefinition = {
  standalone: true,
  // Laid out in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table: data } = ctx.data;
    const { style, theme } = ctx;
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (v: number) => v * px;
    const Y = (v: number) => 1 - v * py;
    const family = theme.font.family;
    const compact = W < 420;
    const pad = compact ? 12 : 20;
    const cellFont = `12px ${family}`;
    const boldFont = `600 12px ${family}`;
    const headFont = `600 11px ${family}`;
    const dates = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const specs: TableColumn[] = (style.cols as TableColumn[]).length ? style.cols : data.fields.map((field) => ({ field }));

    const accent = parseColor(layer.style?.color ?? theme.palette.categorical[0]);
    const tone = (v: string | undefined, fallback: string) => parseColor(!v || v === 'auto' ? fallback : v);
    const good = tone(style.good, theme.marks.kpi.good);
    const bad = tone(style.bad, theme.marks.kpi.bad);
    const warn = parseColor(style.warn);
    const muted = parseColor(theme.text.muted);
    const grid = parseColor(theme.grid.y.color);
    const ink = theme.text.primary;

    // Row order.
    const order = Array.from({ length: data.length }, (_, i) => i);
    if (style.orderBy && data.has(style.orderBy)) {
      const c = data.column(style.orderBy);
      const dir = style.descending ? -1 : 1;
      order.sort((a, b) => {
        const [u, v] = [c.values[a], c.values[b]];
        if (typeof u === 'string' || typeof v === 'string') return dir * String(u).localeCompare(String(v)) || a - b;
        // Missing values last, whatever the direction.
        if (Number.isNaN(u) || Number.isNaN(v)) return Number.isNaN(u) ? (Number.isNaN(v) ? a - b : 1) : -1;
        return dir * (u - v) || a - b;
      });
    }

    const statusSlots = new Map<string, number>();
    const statusColor = (c: Col, value: string): RGBA => {
      const named = c.spec.colors?.[value];
      if (named === 'good') return good;
      if (named === 'bad') return bad;
      if (named === 'warn') return warn;
      if (named) return parseColor(themeColor(theme, named));
      if (!statusSlots.has(value)) statusSlots.set(value, statusSlots.size);
      return parseColor(theme.palette.categorical[statusSlots.get(value)! % theme.palette.categorical.length]);
    };

    const cols: Col[] = specs.map((spec) => {
      const field = spec.field && data.has(spec.field) ? spec.field : undefined;
      const column = field ? data.column(field) : undefined;
      const kind: Kind = !field ? 'rank' : (spec.type ?? (column!.type === 'string' ? 'text' : 'number'));
      const num = column && column.type !== 'string' ? (column.values as Float64Array) : undefined;
      const max = Math.max(1, Math.round(spec.max ?? 5));
      const raw = (row: number): string => {
        const v = column!.values[row];
        if (typeof v === 'string') return v;
        if (Number.isNaN(v)) return '–';
        return column!.type === 'time' ? dates.format(v) : ctx.format(v, field);
      };
      const text = (row: number, position: number): string => {
        if (kind === 'rank') return String(position + 1);
        if (kind === 'change') {
          const v = num ? num[row] : NaN;
          return Number.isNaN(v) ? '–' : `${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${ctx.format(Math.abs(v), field)}`;
        }
        if (kind === 'rating') {
          const v = num ? Math.max(0, Math.min(max, Math.round(num[row]))) : 0;
          return spec.shape === 'stars' ? '★'.repeat(v) + '☆'.repeat(max - v) : '';
        }
        return raw(row);
      };
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      let count = 0;
      if (num) {
        for (const v of num) {
          if (Number.isNaN(v)) continue;
          [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
          sum += v;
          count++;
        }
      }
      const how = spec.total ?? (kind === 'number' || kind === 'bar' || kind === 'heat' ? 'sum' : 'none');
      return {
        spec,
        kind,
        field,
        label: spec.label ?? (field ? (ctx.fields[field]?.label ?? field) : '#'),
        align: spec.align ?? (kind === 'number' || kind === 'change' ? 'right' : kind === 'heat' || kind === 'rank' ? 'center' : 'left'),
        num,
        text,
        lo,
        hi,
        total: !num || !count || how === 'none' || column!.type === 'time' ? NaN : how === 'mean' ? sum / count : sum,
        valueW: 0,
      };
    });

    // Rows first (which ones are shown decides the widths), then the columns.
    const headH = style.headers ? 28 : 0;
    const rowsFit = tableRows(H, order.length, { header: headH, rowHeight: style.rowHeight, total: style.total });
    const shown = order.slice(0, rowsFit.shown);
    const rowH = rowsFit.rowH;
    const widest = (texts: string[], font: string) => Math.max(0, ...texts.map((t) => textWidth(t, font)));
    const totalText = (c: Col) => (Number.isNaN(c.total) ? '' : ctx.format(c.total, c.field));
    // The column that names the row: the first one that is not a rank.
    const lead = Math.max(0, cols.findIndex((c) => c.kind !== 'rank'));
    const needs: ColumnNeed[] = cols.map((c, ci) => {
      const head = style.headers ? textWidth(c.label, headFont) : 0;
      const texts = shown.map((r, p) => c.text(r, p));
      if (style.total) texts.push(ci === lead ? style.totalLabel : totalText(c));
      const max = Math.max(1, Math.round(c.spec.max ?? 5));
      let min: number;
      let cap: number | undefined;
      if (c.kind === 'bar') {
        c.valueW = widest(texts, cellFont);
        min = Math.max(head, c.valueW + 8 + (compact ? 40 : 56)) + pad;
        cap = min + 110;
      } else if (c.kind === 'rating' && c.spec.shape !== 'stars') min = Math.max(head, max * 11 - 3) + pad;
      else if (c.kind === 'status') min = Math.max(head, widest(texts, cellFont) + 14) + pad;
      else if (c.kind === 'heat') min = Math.max(head, widest(texts, boldFont)) + pad + 4;
      else if (c.kind === 'text') {
        // Long text is cut with an ellipsis rather than pushing the figures out.
        const room = ci === lead ? Math.max(96, W * 0.4) : Math.max(72, W * 0.26);
        min = Math.min(room, Math.max(head, widest(texts, ci === lead ? boldFont : cellFont)) + pad);
      } else min = Math.max(head, widest(texts, boldFont)) + pad;
      const fixed = c.spec.width !== undefined;
      return { min: fixed ? c.spec.width! : min, priority: c.spec.priority ?? ci, cap: fixed ? undefined : cap, fixed };
    });
    const slots = tableColumns(W, needs);

    const fills: number[] = [];
    const bars: number[] = [];
    const barKeys: string[] = [];
    const rules: number[] = [];
    const dots: number[] = [];
    const labels: MarkLabel[] = [];
    const zebra = withAlpha(muted, 0.06);
    const track = mix(ctx.surface, muted, 0.22);
    const inner = (s: { x0: number; x1: number }) => [s.x0 + pad / 2, s.x1 - pad / 2] as const;
    const anchor = (c: Col, s: { x0: number; x1: number }) => {
      const [a, b] = inner(s);
      return c.align === 'right' ? b : c.align === 'center' ? (a + b) / 2 : a;
    };
    const name = (row: number, position: number) => cols[lead]?.text(row, position) ?? String(position + 1);

    if (style.headers) {
      for (const s of slots) {
        const c = cols[s.index];
        const [a, b] = inner(s);
        const text = ellipsis(c.label, b - a + 2, (t) => textWidth(t, headFont));
        if (text) labels.push({ tx: X(anchor(c, s)), ty: Y(headH / 2), text, color: theme.text.muted, size: 11, weight: 600, align: c.align, baseline: 'middle' });
      }
      pushSegment(rules, 0, Y(headH), 1, Y(headH), grid, 1);
    }

    const drawRow = (row: number | undefined, position: number, y0: number) => {
      const ym = y0 + rowH / 2;
      const isTotal = row === undefined;
      for (const s of slots) {
        const c = cols[s.index];
        const first = s.index === lead;
        const [a, b] = inner(s);
        const weight = isTotal || first ? 600 : 500;
        const font = `${weight} 12px ${family}`;
        const plain = (text: string, color: string = ink) => {
          const t = ellipsis(text, b - a + 2, (v) => textWidth(v, font));
          if (t) labels.push({ tx: X(anchor(c, s)), ty: Y(ym), text: t, color, size: 12, weight, align: c.align, baseline: 'middle' });
        };
        if (isTotal) {
          if (first) plain(style.totalLabel);
          else if (c.kind === 'bar') labels.push({ tx: X(a + c.valueW), ty: Y(ym), text: totalText(c), color: ink, size: 12, weight, align: 'right', baseline: 'middle' });
          else if (!Number.isNaN(c.total)) plain(totalText(c));
          continue;
        }
        const v = c.num ? c.num[row] : NaN;
        const text = c.text(row, position);
        if (c.kind === 'bar') {
          labels.push({ tx: X(a + c.valueW), ty: Y(ym), text, color: ink, size: 12, weight, align: 'right', baseline: 'middle' });
          if (Number.isNaN(v)) continue;
          const [d0, d1] = [Math.min(0, c.lo), Math.max(0, c.hi)];
          const [bx0, bx1] = [a + c.valueW + 8, b];
          const at = (u: number) => bx0 + (d1 > d0 ? (u - d0) / (d1 - d0) : 0) * (bx1 - bx0);
          const h = Math.min(12, rowH * 0.46);
          const r = Math.min(3, h / 2);
          // A bar never thinner than a hairline, so a small value still shows.
          const [u0, u1] = [Math.min(at(0), at(v)), Math.max(at(0), at(v))];
          pushRect(bars, { x0: X(u0), y0: Y(ym + h / 2), x1: X(Math.max(u1, u0 + (v === 0 ? 0 : 1.5))), y1: Y(ym - h / 2), fill: ctx.paint(c.spec.downIsGood ? (v > 0 ? bad : good) : v < 0 ? bad : accent, row), radii: v < 0 ? [r, 0, 0, r] : [0, r, r, 0] });
          barKeys.push(`${name(row, position)}|${c.field}`);
          // Zero, when bars go both ways.
          if (d0 < 0) pushSegment(rules, X(at(0)), Y(y0 + 3), X(at(0)), Y(y0 + rowH - 3), withAlpha(muted, 0.6), 1);
        } else if (c.kind === 'heat') {
          if (Number.isNaN(v)) {
            plain(text, theme.text.muted);
            continue;
          }
          const lit = c.spec.diverging ? valueColor(ctx, v, c.lo, c.hi, true) : ctx.ramp(0.08 + 0.85 * (c.hi > c.lo ? (v - c.lo) / (c.hi - c.lo) : 0.5));
          const fill = ctx.paint(lit, row);
          const box: [number, number, number, number] = [X(s.x0 + 2), Y(y0 + rowH - 2), X(s.x1 - 2), Y(y0 + 2)];
          pushRect(fills, { x0: box[0], y0: box[1], x1: box[2], y1: box[3], fill, radii: [3, 3, 3, 3] });
          labels.push({ tx: X((s.x0 + s.x1) / 2), ty: Y(ym), text, on: fill, size: 12, weight: 600, align: 'center', baseline: 'middle' });
        } else if (c.kind === 'change') {
          const up = v > 0 === (c.spec.downIsGood ? !style.upIsGood : style.upIsGood);
          plain(text, Number.isNaN(v) || v === 0 ? theme.text.muted : toCss(up ? good : bad));
        } else if (c.kind === 'status') {
          const color = ctx.paint(statusColor(c, text), row);
          const t = ellipsis(text, b - a - 12, (u) => textWidth(u, font));
          pushDot(dots, X(a + 4), Y(ym), 8, color);
          if (t) labels.push({ tx: X(a + 14), ty: Y(ym), text: t, color: ink, size: 12, weight, align: 'left', baseline: 'middle' });
        } else if (c.kind === 'rating') {
          if (c.spec.shape === 'stars') plain(text, toCss(warn));
          else {
            const max = Math.max(1, Math.round(c.spec.max ?? 5));
            const full = Number.isNaN(v) ? 0 : Math.max(0, Math.min(max, Math.round(v)));
            const x0 = c.align === 'right' ? b - (max * 11 - 3) : c.align === 'center' ? (a + b) / 2 - (max * 11 - 3) / 2 : a;
            for (let k = 0; k < max; k++) pushDot(dots, X(x0 + 4 + k * 11), Y(ym), 8, k < full ? ctx.paint(accent, row) : track);
          }
        } else plain(text, c.kind === 'rank' ? theme.text.muted : ink);
      }
    };

    shown.forEach((row, p) => {
      const y0 = headH + p * rowH;
      if (style.zebra) {
        if (p % 2 === 1) pushRect(fills, { x0: 0, y0: Y(y0 + rowH), x1: 1, y1: Y(y0), fill: zebra });
      } else if (p > 0) pushSegment(rules, 0, Y(y0), 1, Y(y0), withAlpha(grid, grid[3] * 0.7), 1);
    });
    // Zebra first: the shaded cells sit on top of it.
    shown.forEach((row, p) => drawRow(row, p, headH + p * rowH));
    let y = headH + shown.length * rowH;
    if (rowsFit.more > 0) {
      pushSegment(rules, 0, Y(y), 1, Y(y), withAlpha(grid, grid[3] * 0.7), 1);
      labels.push({ tx: X(pad / 2), ty: Y(y + 9), text: fillText(rowsFit.more > 1 ? ctx.theme.texts.moreRows : ctx.theme.texts.moreRow, { n: rowsFit.more }), color: theme.text.muted, size: 11, weight: 500, align: 'left', baseline: 'middle' });
      y += 18;
    }
    const totalY = y;
    if (style.total && shown.length) {
      pushSegment(rules, 0, Y(y), 1, Y(y), withAlpha(muted, 0.75), 1.5);
      drawRow(undefined, shown.length, y);
      y += rowH;
    } else pushSegment(rules, 0, Y(y), 1, Y(y), grid, 1);

    const draws: BuiltMark['draws'] = [];
    if (fills.length) draws.push({ batch: batchOf(ctx, 'rect', fills), enter: 'fade' });
    if (bars.length) {
      const buffer = new Float32Array(bars);
      const b = ctx.renderer.createBatch('rect');
      b.update(buffer, barKeys.length);
      // Same row, same column: the bar slides to its new length when the data changes.
      draws.push({ batch: b, data: buffer, keys: barKeys });
    }
    draws.push({ batch: batchOf(ctx, 'line', rules), enter: 'fade' });
    if (dots.length) draws.push({ batch: batchOf(ctx, 'point', dots), enter: 'fade' });

    const describe = (c: Col, row: number, position: number): string => {
      if (c.kind === 'rating') return c.num && !Number.isNaN(c.num[row]) ? `${ctx.format(c.num[row], c.field)} / ${Math.max(1, Math.round(c.spec.max ?? 5))}` : '–';
      if (c.kind === 'change') {
        const v = c.num ? c.num[row] : NaN;
        return Number.isNaN(v) ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${ctx.format(Math.abs(v), c.field)}`;
      }
      return c.text(row, position);
    };
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const yy = (1 - ty) / py;
        if (style.total && yy >= totalY && yy < totalY + rowH) {
          const rows = cols.filter((c, i) => i !== lead && !Number.isNaN(c.total)).map((c) => ({ label: c.label, value: totalText(c) }));
          return rows.length ? { title: style.totalLabel, rows } : null;
        }
        const p = Math.floor((yy - headH) / rowH);
        if (yy < headH || p < 0 || p >= shown.length) return null;
        // Every column, the ones given up on a narrow screen included.
        return { title: name(shown[p], p), rows: cols.filter((c, i) => i !== lead && c.kind !== 'rank').map((c) => ({ label: c.label, value: describe(c, shown[p], p) })) };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const TABLES_MARKS: Record<string, MarkDefinition> = { table, matrix, confusion, calendarMonth };
