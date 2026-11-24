/**
 * Price charts that drop the time axis: `renko` (bricks) and `kagi` (a line that
 * only turns on a real reversal). Both keep price moves and forget how long they took,
 * so the x axis counts bricks or lines; its labels give the date each one was drawn.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale, niceDomain, niceStep, type Scale, type Tick } from '../scale/scales';
import type { Table } from '../data/table';
import type { FieldSpec, LayerSpec } from '../spec/types';
import { lightTheme } from '../theme/theme';
import { parseColor } from '../util/color';
import { need } from './charts';
import { pushRect, pushSegment } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkDraw, type ShapeHit } from './registry';

// ------------------------------------------------------------------ layouts

export interface RenkoBrick {
  /** Price the brick starts from and ends at (`to` > `from` for a rising brick). */
  from: number;
  to: number;
  /** Row whose price completed the brick, and row of the previous brick (the move's start). */
  row: number;
  start: number;
}

/**
 * Renko bricks of a price series: a new brick each time the price moves one
 * `brick` past the last one, in either direction (so a reversal needs two bricks
 * of travel from the last brick's far end). Levels sit on multiples of `brick`.
 */
/** At most this many bricks between the lowest and the highest price. */
export const MAX_BRICKS = 2000;

export function renkoBricks(close: ArrayLike<number>, brick: number): RenkoBrick[] {
  const out: RenkoBrick[] = [];
  if (!(brick > 0)) return out;
  // A fixed brick on prices far larger than expected would make millions of bricks: cap their number.
  let lo0 = Infinity;
  let hi0 = -Infinity;
  for (let i = 0; i < close.length; i++) {
    const p = close[i];
    if (p < lo0) lo0 = p;
    if (p > hi0) hi0 = p;
  }
  if (hi0 > lo0 && (hi0 - lo0) / brick > MAX_BRICKS) brick = (hi0 - lo0) / MAX_BRICKS;
  let base = NaN;
  // Bottom and top of the last brick, in bricks from the base (equal until the first brick).
  let lo = 0;
  let hi = 0;
  let last = 0;
  const eps = 1e-9;
  for (let i = 0; i < close.length; i++) {
    const p = close[i];
    if (!Number.isFinite(p)) continue;
    if (Number.isNaN(base)) {
      base = Math.round(p / brick) * brick;
      last = i;
      continue;
    }
    const q = (p - base) / brick;
    const before = out.length;
    while (q >= hi + 1 - eps) {
      out.push({ from: base + hi * brick, to: base + (hi + 1) * brick, row: i, start: last });
      lo = hi;
      hi += 1;
    }
    while (q <= lo - 1 + eps) {
      out.push({ from: base + lo * brick, to: base + (lo - 1) * brick, row: i, start: last });
      hi = lo;
      lo -= 1;
    }
    if (out.length > before) last = i;
  }
  return out;
}

export interface KagiLine {
  /** Price the vertical line starts from and ends at. */
  from: number;
  to: number;
  /** Row of the line's end, and row where it started (the previous line's end). */
  row: number;
  start: number;
  /** The line cut where its thickness changes: thick (`yang`) above the previous high, thin (yin) under the previous low. */
  parts: { from: number; to: number; yang: boolean }[];
}

/**
 * Kagi lines of a price series: the current line follows the price as long as
 * it keeps going, and a new line starts in the other direction only once the
 * price has come back by `reversal`. A rising line turns thick (yang) when it
 * passes the previous high; a falling one turns thin (yin) under the previous low.
 */
export function kagiLines(close: ArrayLike<number>, reversal: number): KagiLine[] {
  const lines: KagiLine[] = [];
  if (!(reversal > 0)) return lines;
  let base = NaN;
  let first = 0;
  let cur: KagiLine | undefined;
  const eps = 1e-9;
  for (let i = 0; i < close.length; i++) {
    const p = close[i];
    if (!Number.isFinite(p)) continue;
    if (Number.isNaN(base)) {
      base = p;
      first = i;
      continue;
    }
    if (!cur) {
      if (Math.abs(p - base) >= reversal - eps) cur = { from: base, to: p, row: i, start: first, parts: [] };
      continue;
    }
    const up = cur.to > cur.from;
    if (up ? p > cur.to : p < cur.to) {
      cur.to = p;
      cur.row = i;
    } else if (Math.abs(p - cur.to) >= reversal - eps) {
      lines.push(cur);
      cur = { from: cur.to, to: p, row: i, start: cur.row, parts: [] };
    }
  }
  if (cur) lines.push(cur);
  let yang = lines.length > 0 && lines[0].to > lines[0].from;
  lines.forEach((l, k) => {
    const up = l.to > l.from;
    // The previous turning point on the same side: where the previous line started.
    const level = k > 0 ? lines[k - 1].from : NaN;
    if (k > 0 && up !== yang && (up ? l.to > level : l.to < level)) {
      l.parts = [{ from: l.from, to: level, yang }, { from: level, to: l.to, yang: up }];
      yang = up;
    } else {
      l.parts = [{ from: l.from, to: l.to, yang }];
    }
  });
  return lines;
}

// ------------------------------------------------------------------ helpers

/** An axis of drawn items (bricks, lines): position = index, label = what `label` says of it. */
class IndexScale implements Scale {
  readonly type = 'linear';
  readonly band = 0;
  private n: number;
  constructor(count: number, private label: (i: number) => string) {
    this.n = Math.max(1, count);
  }
  norm(v: number): number {
    return (v + 0.5) / this.n;
  }
  invert(t: number): number {
    return t * this.n - 0.5;
  }
  ticks(t0: number, t1: number, count: number): Tick[] {
    const lo = Math.max(0, Math.ceil(this.invert(Math.min(t0, t1)) - 1e-9));
    const hi = Math.min(this.n - 1, Math.floor(this.invert(Math.max(t0, t1)) + 1e-9));
    const step = Math.max(1, Math.round(niceStep(Math.max(1, hi - lo), Math.max(1, count))));
    const out: Tick[] = [];
    let previous = '';
    for (let i = Math.ceil(lo / step) * step; i <= hi; i += step) {
      const label = this.label(i);
      // Several bricks drawn the same day: the date is written once.
      if (label === previous) continue;
      previous = label;
      out.push({ t: this.norm(i), label });
    }
    return out;
  }
  format(v: number): string {
    return this.label(Math.max(0, Math.min(this.n - 1, Math.round(v))));
  }
}

function numbers(table: Table, field: string): Float64Array {
  const c = table.column(field);
  if (c.type === 'string') throw new Error(`futurCharts: field "${field}" must be numeric.`);
  return c.values as Float64Array;
}

function range(values: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** How rows are named on the axis and in tooltips: their date (or their x value). */
function rowLabels(table: Table, layer: LayerSpec, fields: Record<string, FieldSpec>): { short: (row: number) => string; long: (row: number) => string } {
  const xf = layer.encode.x;
  if (!xf) return { short: (r) => String(r + 1), long: (r) => String(r + 1) };
  const col = table.column(xf);
  if (col.type !== 'time') {
    const f = (r: number) => (col.type === 'string' ? String(col.values[r]) : new LinearScale(0, 1, fields[xf]?.format).format(col.values[r] as number));
    return { short: f, long: f };
  }
  const short = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  const long = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return { short: (r) => short.format(col.values[r] as number), long: (r) => long.format(col.values[r] as number) };
}

function directionColors(ctx: BuildContext): { up: RGBA; down: RGBA } {
  const { style, theme } = ctx;
  return {
    up: parseColor(style.rising === 'auto' ? theme.marks.kpi.good : style.rising),
    down: parseColor(style.falling === 'auto' ? theme.marks.kpi.bad : style.falling),
  };
}

function batchOf(ctx: BuildContext, kind: 'rect' | 'line', data: number[]): MarkDraw['batch'] {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

/** The y scale of a price drawing: the extent, rounded, with the field's format. */
function priceScale(lo: number, hi: number, layer: LayerSpec, fields: Record<string, FieldSpec>): LinearScale {
  const [d0, d1] = niceDomain(lo, hi, 5);
  return new LinearScale(d0, d1, fields[layer.encode.y ?? '']?.format);
}

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;
const span = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);

// -------------------------------------------------------------------- renko

function renkoOf(layer: LayerSpec, table: Table): { bricks: RenkoBrick[]; brick: number } {
  const prices = numbers(table, need(layer, 'y', 'renko'));
  const [lo, hi] = range(prices);
  const asked = (layer.style?.brick as number | undefined) ?? lightTheme.marks.renko.brick;
  const brick = asked > 0 ? asked : niceStep(hi - lo || 1, 15);
  return { bricks: renkoBricks(prices, brick), brick };
}

/**
 * `renko`: the price `y` (a close) as bricks of a fixed height, `style.brick`
 * (0: chosen from the price range). A brick is added only when the price has moved
 * by a whole brick: flat periods vanish, trends show as stairs. `x` dates the bricks.
 */
export const renko: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales({ layer, table, fields }) {
    const { bricks, brick } = renkoOf(layer, table);
    const labels = rowLabels(table, layer, fields);
    const levels = bricks.flatMap((b) => [b.from, b.to]);
    const [lo, hi] = levels.length ? range(levels) : range(numbers(table, layer.encode.y!));
    return {
      x: new IndexScale(bricks.length, (i) => (bricks[i] ? labels.short(bricks[i].row) : '')),
      y: priceScale(lo - brick / 2, hi + brick / 2, layer, fields),
      axes: { x: true, y: true },
      grid: { y: true },
    };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const yf = layer.encode.y!;
    const { bricks } = renkoOf(layer, table);
    const { up, down } = directionColors(ctx);
    const labels = rowLabels(table, layer, ctx.fields);
    const rects: number[] = [];
    const keys: string[] = [];
    const r = style.radius;
    bricks.forEach((b, i) => {
      const fill = ctx.paint(b.to > b.from ? up : down, b.row);
      pushRect(rects, {
        x0: ctx.x.norm(i - 0.5),
        x1: ctx.x.norm(i + 0.5),
        y0: ctx.y.norm(Math.min(b.from, b.to)),
        y1: ctx.y.norm(Math.max(b.from, b.to)),
        fill,
        radii: [r, r, r, r],
        gap: style.gap,
      });
      keys.push(String(i));
    });
    const data = new Float32Array(rects);
    const draws: MarkDraw[] = rects.length ? [{ batch: batchOf(ctx, 'rect', rects), pixelSnap: true, data, keys }] : [];
    return {
      draws,
      hit: emptyHit(),
      pick(tx, ty): ShapeHit | null {
        const b = bricks[Math.round(ctx.x.invert(tx))];
        if (!b) return null;
        const v = ctx.y.invert(ty);
        // Half a brick of tolerance around the brick: thin bricks stay easy to point at.
        const slack = Math.abs(b.to - b.from) / 2;
        if (v < Math.min(b.from, b.to) - slack || v > Math.max(b.from, b.to) + slack) return null;
        return {
          title: span(labels.long(b.start), labels.long(b.row)),
          rows: [{ label: fieldLabel(ctx, yf), value: `${ctx.format(b.from, yf)} → ${ctx.format(b.to, yf)}` }],
        };
      },
    };
  },
};

// --------------------------------------------------------------------- kagi

function kagiOf(layer: LayerSpec, table: Table): { lines: KagiLine[]; lo: number; hi: number } {
  const prices = numbers(table, need(layer, 'y', 'kagi'));
  const [lo, hi] = range(prices);
  const asked = (layer.style?.reversal as number | undefined) ?? lightTheme.marks.kagi.reversal;
  return { lines: kagiLines(prices, asked > 0 ? asked : niceStep(hi - lo || 1, 12)), lo, hi };
}

/**
 * `kagi`: the price `y` (a close) as one line that goes up or down and only turns
 * when the price comes back by `style.reversal` (0: chosen from the price range).
 * Thick (yang) above the previous high, thin (yin) under the previous low: the
 * thickness says who leads, buyers or sellers. `x` dates the lines.
 */
export const kagi: MarkDefinition = {
  standalone: true,
  symbol: 'line',
  scales({ layer, table, fields }) {
    const { lines, lo, hi } = kagiOf(layer, table);
    const labels = rowLabels(table, layer, fields);
    const pad = (hi - lo) * 0.04;
    return {
      x: new IndexScale(lines.length, (i) => (lines[i] ? labels.short(lines[i].start) : '')),
      y: priceScale(lo - pad, hi + pad, layer, fields),
      axes: { x: true, y: true },
      grid: { y: true },
    };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const yf = layer.encode.y!;
    const { lines } = kagiOf(layer, table);
    const { up, down } = directionColors(ctx);
    const labels = rowLabels(table, layer, ctx.fields);
    const out: number[] = [];
    const paint = (yang: boolean, row: number): [RGBA, number] => [ctx.paint(yang ? up : down, row), yang ? style.yang : style.yin];
    lines.forEach((l, i) => {
      const x = ctx.x.norm(i);
      for (const p of l.parts) {
        const [color, width] = paint(p.yang, l.row);
        pushSegment(out, x, ctx.y.norm(p.from), x, ctx.y.norm(p.to), color, width);
      }
      // The shoulder (or waist) that joins this line to the next one, in the state the line ended in.
      if (i < lines.length - 1) {
        const [color, width] = paint(l.parts[l.parts.length - 1].yang, l.row);
        const y = ctx.y.norm(l.to);
        pushSegment(out, x, y, ctx.x.norm(i + 1), y, color, width);
      }
    });
    return {
      draws: out.length ? [{ batch: batchOf(ctx, 'line', out) }] : [],
      hit: emptyHit(),
      pick(tx): ShapeHit | null {
        const l = lines[Math.round(ctx.x.invert(tx))];
        if (!l) return null;
        return {
          title: span(labels.long(l.start), labels.long(l.row)),
          rows: [{ label: fieldLabel(ctx, yf), value: `${ctx.format(l.from, yf)} → ${ctx.format(l.to, yf)}` }],
        };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const STOCK_MARKS: Record<string, MarkDefinition> = { renko, kagi };
