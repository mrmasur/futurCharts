/**
 * Scatter plots for analysis: quadrant matrix, connected scatter and scatter with marginal
 * histograms. Standalone marks drawn with the shared primitives; the layout helpers at the top
 * are pure (tested without a renderer).
 */
import { LAYOUTS, SHAPES } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale, niceDomain, niceStep, type Scale, type Tick } from '../scale/scales';
import type { Table } from '../data/table';
import { mix, parseColor, toCss, withAlpha } from '../util/color';
import { categoriesOf, need } from './charts';
import { dashed, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { fillText } from '../theme/texts';

// ------------------------------------------------------------------ helpers

/** Median of the finite values (NaN when there is none). */
export function median(values: ArrayLike<number>): number {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) v.push(values[i]);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Quadrant of a point, in reading order: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
 * A value on a threshold counts as above it.
 */
export function quadrantOf(x: number, y: number, xt: number, yt: number): 0 | 1 | 2 | 3 {
  return ((y >= yt ? 0 : 2) + (x >= xt ? 1 : 0)) as 0 | 1 | 2 | 3;
}

/**
 * Arrow head on the segment (x0, y0) → (x1, y1): a triangle in scale space, `size` px long,
 * centered at `at` along the segment and pointing to its end. Angles are right on screen
 * whatever the aspect of the plot (`pixel`). Null when the segment is too short to carry it.
 */
export function arrowHead(x0: number, y0: number, x1: number, y1: number, pixel: [number, number], size: number, at = 0.5): [number, number][] | null {
  const dx = (x1 - x0) / pixel[0];
  const dy = (y1 - y0) / pixel[1];
  const L = Math.hypot(dx, dy);
  if (!(L >= size * 2.4)) return null;
  const ux = dx / L;
  const uy = dy / L;
  const cx = (x0 + (x1 - x0) * at) / pixel[0];
  const cy = (y0 + (y1 - y0) * at) / pixel[1];
  const h = size / 2;
  const w = size * 0.42;
  const px = (a: number, b: number): [number, number] => [(cx + ux * a - uy * b) * pixel[0], (cy + uy * a + ux * b) * pixel[1]];
  return [px(h, 0), px(-h, w), px(-h, -w)];
}

/** Classes of a marginal histogram: round edges covering [lo, hi], about `target` of them. */
export function marginalBins(lo: number, hi: number, target: number): { start: number; step: number; count: number } {
  if (!(hi > lo)) return { start: lo, step: 1, count: 1 };
  const step = niceStep(hi - lo, Math.max(1, target));
  const start = Math.floor(lo / step + 1e-9) * step;
  const count = Math.max(1, Math.ceil((hi - start) / step - 1e-9));
  return { start, step, count };
}

/** Class of a value: classes are closed on the left, the last one also holds the upper edge. */
export function binIndex(v: number, bins: { start: number; step: number; count: number }): number {
  const i = Math.floor((v - bins.start) / bins.step + 1e-9);
  return i < 0 || !Number.isFinite(v) ? -1 : i >= bins.count ? (v <= bins.start + bins.step * bins.count + 1e-9 ? bins.count - 1 : -1) : i;
}

/** The steps of a trajectory worth naming: first, last, and the extremes along x and y. */
export function keySteps(xs: ArrayLike<number>, ys: ArrayLike<number>): number[] {
  const n = xs.length;
  if (!n) return [];
  const arg = (v: ArrayLike<number>, sign: number) => {
    let b = 0;
    for (let i = 1; i < n; i++) if ((v[i] - v[b]) * sign > 0) b = i;
    return b;
  };
  return [...new Set([0, n - 1, arg(xs, 1), arg(xs, -1), arg(ys, 1), arg(ys, -1)])];
}

export interface LabelItem {
  /** Anchor, px (y down). */
  x: number;
  y: number;
  /** Radius of the point the label names, px. */
  r: number;
  /** Size of the text, px. */
  w: number;
  h: number;
}
export interface LabelSpot {
  dx: number;
  dy: number;
  align: 'left' | 'right' | 'center';
  baseline: 'middle' | 'top' | 'bottom';
  /** [x0, y0, x1, y1], px. */
  box: [number, number, number, number];
}
type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * A place for each label around its point (right, left, above, below, then the diagonals): the
 * first that stays inside `bounds` and touches neither another point, an obstacle nor a label
 * already placed. Null for a label that fits nowhere. Items are served in the order given.
 */
export function placeLabels(items: LabelItem[], bounds: Box, obstacles: Box[] = [], pad = 3): (LabelSpot | null)[] {
  const taken: Box[] = [...obstacles];
  const dots: Box[] = items.map((p) => [p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r]);
  return items.map((p, i) => {
    const g = p.r + pad;
    const d = g * 0.72;
    const spots: Omit<LabelSpot, 'box'>[] = [
      { dx: g, dy: 0, align: 'left', baseline: 'middle' },
      { dx: -g, dy: 0, align: 'right', baseline: 'middle' },
      { dx: 0, dy: -g, align: 'center', baseline: 'bottom' },
      { dx: 0, dy: g, align: 'center', baseline: 'top' },
      { dx: d, dy: -d, align: 'left', baseline: 'bottom' },
      { dx: d, dy: d, align: 'left', baseline: 'top' },
      { dx: -d, dy: -d, align: 'right', baseline: 'bottom' },
      { dx: -d, dy: d, align: 'right', baseline: 'top' },
    ];
    for (const s of spots) {
      const ax = p.x + s.dx;
      const ay = p.y + s.dy;
      const x0 = s.align === 'left' ? ax : s.align === 'right' ? ax - p.w : ax - p.w / 2;
      const y0 = s.baseline === 'top' ? ay : s.baseline === 'bottom' ? ay - p.h : ay - p.h / 2;
      const box: Box = [x0, y0, x0 + p.w, y0 + p.h];
      if (box[0] < bounds[0] || box[1] < bounds[1] || box[2] > bounds[2] || box[3] > bounds[3]) continue;
      if (taken.some((t) => overlaps(box, t))) continue;
      if (dots.some((t, k) => k !== i && overlaps(box, t))) continue;
      taken.push(box);
      return { ...s, box };
    }
    return null;
  });
}

/**
 * A linear scale that only fills the first `share` of the plot: the rest is left to a marginal
 * panel. Ticks stop where the data panel ends.
 */
export class PanelScale implements Scale {
  readonly type = 'linear';
  readonly band = 0;
  constructor(readonly inner: LinearScale, readonly share: number) {}
  norm(v: number): number {
    return this.inner.norm(v) * this.share;
  }
  invert(t: number): number {
    return this.inner.invert(t / this.share);
  }
  ticks(t0: number, t1: number, count: number): Tick[] {
    const a = Math.max(0, t0 / this.share);
    const b = Math.min(1, t1 / this.share);
    if (!(b > a)) return [];
    return this.inner.ticks(a, b, count).map((t) => ({ t: t.t * this.share, label: t.label }));
  }
  format(v: number): string {
    return this.inner.format(v);
  }
}

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;

function batch(ctx: BuildContext, kind: 'point' | 'line' | 'mesh' | 'rect', data: number[] | Float32Array) {
  const b = ctx.renderer.createBatch(kind);
  const a = data instanceof Float32Array ? data : new Float32Array(data);
  b.update(a, a.length / LAYOUTS[kind].stride);
  return b;
}

function numbers(table: Table, f: string): Float64Array {
  const c = table.column(f);
  if (c.type === 'string') throw new Error(`futurCharts: field "${f}" must be numeric.`);
  return c.values as Float64Array;
}

function extent(v: ArrayLike<number>, also: number[] = []): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const see = (x: number) => {
    if (!Number.isFinite(x)) return;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  };
  for (let i = 0; i < v.length; i++) see(v[i]);
  also.forEach(see);
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** A nice domain with air on both sides; the air never invents a negative range. */
function padded(lo: number, hi: number, pad: number): [number, number] {
  const p = (hi - lo) * pad;
  const [d0, d1] = niceDomain(lo - p, hi + p, 6);
  return [lo >= 0 ? Math.max(0, d0) : d0, hi <= 0 ? Math.min(0, d1) : d1];
}

interface Dot {
  x: number;
  y: number;
  size: number;
  fill: RGBA;
  stroke?: RGBA;
  strokeWidth?: number;
}

function pointData(points: Dot[]): Float32Array {
  const out = new Float32Array(points.length * LAYOUTS.point.stride);
  points.forEach((p, i) => {
    const s = p.stroke ?? [0, 0, 0, 0];
    out.set([p.x, p.y, p.size, SHAPES.circle, p.fill[0], p.fill[1], p.fill[2], p.fill[3], s[0], s[1], s[2], s[3], p.strokeWidth ?? 0], i * LAYOUTS.point.stride);
  });
  return out;
}

function nearest<T extends { x: number; y: number }>(points: T[], tx: number, ty: number, pixel: [number, number], reach: (p: T) => number): T | undefined {
  let best: T | undefined;
  let bd = Infinity;
  for (const p of points) {
    const d = Math.hypot((p.x - tx) / pixel[0], (p.y - ty) / pixel[1]);
    if (d < reach(p) && d < bd) [best, bd] = [p, d];
  }
  return best;
}

interface Group {
  key: string;
  rows: number[];
  color: RGBA;
}

/** Rows split by the `color` field (one group without it). Groups hidden in the legend are left out of `groups`. */
function groupsOf(ctx: BuildContext, valid: (row: number) => boolean, fallbackKey: string): { groups: Group[]; legend: { key: string; color: RGBA }[]; grouped: boolean } {
  const { layer, table } = ctx.data;
  const cf = layer.encode.color;
  const col = cf ? table.column(cf) : undefined;
  if (!col || col.type !== 'string') {
    const rows: number[] = [];
    for (let i = 0; i < table.length; i++) if (valid(i)) rows.push(i);
    const key = layer.name ?? fallbackKey;
    const color = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(key);
    return { groups: [{ key, rows, color }], legend: [], grouped: false };
  }
  const keys = categoriesOf(table, cf!);
  const by = new Map<string, number[]>(keys.map((k) => [k, []]));
  for (let i = 0; i < table.length; i++) if (valid(i)) by.get(String(col.values[i]))!.push(i);
  const legend = keys.map((key) => ({ key, color: ctx.categorical(key) }));
  const groups = legend.filter((g) => !ctx.hidden.has(g.key) && by.get(g.key)!.length).map((g) => ({ ...g, rows: by.get(g.key)! }));
  return { groups, legend, grouped: true };
}

const fontOf = (ctx: BuildContext, size: number, weight: number) => `${weight} ${size}px ${ctx.theme.font.family}`;
/** Scale space → px (y down). */
const toPx = (ctx: BuildContext, x: number, y: number): [number, number] => [x / ctx.pixel[0], (1 - y) / ctx.pixel[1]];

// ----------------------------------------------------------------- quadrant

function quadrantThresholds(style: Record<string, any> | undefined, xs: ArrayLike<number>, ys: ArrayLike<number>): [number, number] {
  const pick = (v: unknown, values: ArrayLike<number>) => (typeof v === 'number' && Number.isFinite(v) ? v : median(values));
  return [pick(style?.xThreshold, xs), pick(style?.yThreshold, ys)];
}

/**
 * `quadrant`: a cloud of points (bubbles with `size`) split in four zones by a threshold on each
 * axis (`style.xThreshold` / `yThreshold`, the medians by default). Each zone is tinted and named
 * in its corner (`style.quadrants`), points take the color of their zone, `key` names them.
 */
export const quadrant: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales({ layer, table, fields, style }) {
    const xf = need(layer, 'x', 'quadrant');
    const yf = need(layer, 'y', 'quadrant');
    const xs = numbers(table, xf);
    const ys = numbers(table, yf);
    const [xt, yt] = quadrantThresholds(style ?? layer.style, xs, ys);
    const [a0, a1] = padded(...extent(xs, [xt]), 0.1);
    const [b0, b1] = padded(...extent(ys, [yt]), 0.1);
    return { x: new LinearScale(a0, a1, fields[xf]?.format), y: new LinearScale(b0, b1, fields[yf]?.format), axes: { x: true, y: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = layer.encode.x!;
    const yf = layer.encode.y!;
    const sf = layer.encode.size;
    const kf = layer.encode.key;
    const xs = numbers(table, xf);
    const ys = numbers(table, yf);
    const ss = sf ? numbers(table, sf) : undefined;
    const names = kf ? table.column(kf).values : undefined;
    const [xt, yt] = quadrantThresholds(style, xs, ys);
    const tx = Math.min(1, Math.max(0, ctx.x.norm(xt)));
    const ty = Math.min(1, Math.max(0, ctx.y.norm(yt)));
    const zoneNames: string[] = [0, 1, 2, 3].map((q) => String((Array.isArray(style.quadrants) ? style.quadrants[q] : undefined) ?? ''));
    const zoneColors = zoneNames.map((n, q) => ctx.categorical(n || fillText(ctx.theme.texts.quadrantN, { n: q + 1 })));
    const [W, H] = [1 / ctx.pixel[0], 1 / ctx.pixel[1]];
    const narrow = W < 300;

    // Zones, then the two thresholds over them.
    const rects: number[] = [];
    const zones: Box[] = [[0, ty, tx, 1], [tx, ty, 1, 1], [0, 0, tx, ty], [tx, 0, 1, ty]];
    zones.forEach((z, q) => pushRect(rects, { x0: z[0], y0: z[1], x1: z[2], y1: z[3], fill: withAlpha(zoneColors[q], style.tint) }));
    const lines: number[] = [];
    const rule = dashed(lines, [4, 4], ctx.pixel, withAlpha(parseColor(theme.text.muted), 0.9), 1);
    rule.segment(tx, 0, tx, 1);
    rule.reset();
    rule.segment(0, ty, 1, ty);

    // Zone names in the outer corners.
    const labels: MarkLabel[] = [];
    const obstacles: Box[] = [];
    const ink = parseColor(theme.text.primary);
    const nameSize = narrow ? 10 : 11.5;
    // Point labels stay off the two thresholds.
    obstacles.push([tx * W - 1, 0, tx * W + 1, H], [0, (1 - ty) * H - 1, W, (1 - ty) * H + 1]);
    zoneNames.forEach((name, q) => {
      if (!name) return;
      const left = q % 2 === 0;
      const top = q < 2;
      const room = (left ? tx : 1 - tx) * W - 14;
      if (room < 24) return;
      const w = Math.min(room, textWidth(name, fontOf(ctx, nameSize, 700)));
      const x0 = left ? 7 : W - 7 - w;
      const y0 = top ? 6 : H - 6 - nameSize - 2;
      obstacles.push([x0 - 2, y0 - 2, x0 + w + 2, y0 + nameSize + 4]);
      labels.push({
        tx: left ? 0 : 1, ty: top ? 1 : 0, text: name, color: toCss(mix(zoneColors[q], ink, 0.3)), size: nameSize, weight: 700,
        align: left ? 'left' : 'right', baseline: top ? 'top' : 'bottom', dx: left ? 7 : -7, dy: top ? 6 : -6, maxWidth: room, free: true,
      });
    });

    // Points, largest first so that small ones stay on top.
    const s1 = extent(ss ?? [])[1];
    const range = (Array.isArray(style.sizeRange) ? style.sizeRange : [8, 34]) as [number, number];
    const shrink = narrow ? 0.7 : 1;
    const sizeOf = (row: number) => {
      if (!ss) return style.size * (narrow ? 0.85 : 1);
      const t = s1 > 0 ? Math.sqrt(Math.max(0, ss[row]) / s1) : 1;
      return (range[0] + (range[1] - range[0]) * t) * shrink;
    };
    type P = Dot & { row: number; q: number };
    const dots: P[] = [];
    for (let row = 0; row < table.length; row++) {
      if (!Number.isFinite(xs[row]) || !Number.isFinite(ys[row]) || (ss && !Number.isFinite(ss[row]))) continue;
      const q = quadrantOf(xs[row], ys[row], xt, yt);
      const c = ctx.paint(zoneColors[q], row);
      dots.push({ x: ctx.x.norm(xs[row]), y: ctx.y.norm(ys[row]), size: sizeOf(row), fill: withAlpha(c, c[3] * style.opacity), stroke: ctx.surface, strokeWidth: 1, row, q });
    }
    dots.sort((a, b) => b.size - a.size);

    if (style.labels && names) {
      const size = narrow ? 10 : 11;
      const font = fontOf(ctx, size, 500);
      const items: LabelItem[] = dots.map((p) => {
        const [x, y] = toPx(ctx, p.x, p.y);
        return { x, y, r: p.size / 2, w: textWidth(String(names[p.row]), font) + 2, h: size + 3 };
      });
      placeLabels(items, [0, 0, W, H], obstacles).forEach((spot, i) => {
        if (!spot) return;
        const p = dots[i];
        labels.push({ tx: p.x, ty: p.y, text: String(names[p.row]), color: theme.text.primary, size, weight: 500, align: spot.align, baseline: spot.baseline, dx: spot.dx, dy: spot.dy, free: true });
      });
    }

    const data = pointData(dots);
    const draws: MarkDraw[] = [
      { batch: batch(ctx, 'rect', rects), enter: 'fade' },
      { batch: batch(ctx, 'line', lines), enter: 'fade' },
      { batch: batch(ctx, 'point', data), data, keys: dots.map((p) => (names ? String(names[p.row]) : String(p.row))) },
    ];
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend: [],
      pick(px, py): ShapeHit | null {
        const p = nearest(dots, px, py, ctx.pixel, (d) => Math.max(8, d.size / 2 + 3));
        if (!p) return null;
        const rows = [
          { label: fieldLabel(ctx, xf), value: ctx.format(xs[p.row], xf) },
          { label: fieldLabel(ctx, yf), value: ctx.format(ys[p.row], yf) },
        ];
        if (ss && sf) rows.push({ label: fieldLabel(ctx, sf), value: ctx.format(ss[p.row], sf) });
        const zone = zoneNames[p.q];
        return { title: names ? (zone ? `${names[p.row]} · ${zone}` : String(names[p.row])) : zone || fieldLabel(ctx, yf), rows };
      },
    };
  },
};

// ---------------------------------------------------------------- connected

/**
 * `connected`: the path of an entity in the x / y plane, step after step (`time` orders the
 * steps when it is a number or a date; a text keeps the order of the rows). Segments carry an
 * arrow, the tint deepens with time, key steps are named. One path per `color`.
 */
export const connected: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'line',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'connected');
    const yf = need(layer, 'y', 'connected');
    const [a0, a1] = padded(...extent(numbers(table, xf)), 0.08);
    const [b0, b1] = padded(...extent(numbers(table, yf)), 0.08);
    return { x: new LinearScale(a0, a1, fields[xf]?.format), y: new LinearScale(b0, b1, fields[yf]?.format), axes: { x: true, y: true }, grid: { x: true, y: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = layer.encode.x!;
    const yf = layer.encode.y!;
    const tf = layer.encode.time;
    const xs = numbers(table, xf);
    const ys = numbers(table, yf);
    const tcol = tf ? table.column(tf) : undefined;
    const ordered = tcol && tcol.type !== 'string';
    const stepName = (row: number) => (!tcol ? String(row + 1) : tcol.type === 'string' ? String(tcol.values[row]) : ctx.format(tcol.values[row] as number, tf));
    const { groups, legend, grouped } = groupsOf(ctx, (r) => Number.isFinite(xs[r]) && Number.isFinite(ys[r]), fieldLabel(ctx, yf));
    const [W, H] = [1 / ctx.pixel[0], 1 / ctx.pixel[1]];
    const narrow = W < 300;

    const lines: number[] = [];
    const mesh: number[] = [];
    type P = Dot & { row: number; group: string; named: boolean; end: boolean };
    const dots: P[] = [];
    // Small boxes along the paths, px: labels are kept off the lines.
    const pathBoxes: Box[] = [];
    for (const g of groups) {
      const rows = ordered ? [...g.rows].sort((a, b) => (tcol!.values[a] as number) - (tcol!.values[b] as number)) : g.rows;
      const n = rows.length;
      const base = ctx.paint(g.color, rows[0]);
      const pale = mix(base, ctx.surface, 0.68);
      const at = (i: number) => mix(pale, base, n > 1 ? i / (n - 1) : 1);
      const px = rows.map((r) => ctx.x.norm(xs[r]));
      const py = rows.map((r) => ctx.y.norm(ys[r]));
      for (let i = 0; i + 1 < n; i++) {
        const c = at(i + 0.5);
        pushSegment(lines, px[i], py[i], px[i + 1], py[i + 1], c, style.width);
        const [ax, ay] = toPx(ctx, px[i], py[i]);
        const [bx, by] = toPx(ctx, px[i + 1], py[i + 1]);
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 5);
        for (let k = 1; k < steps; k++) {
          const [mx, my] = [ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps];
          pathBoxes.push([mx - 2, my - 2, mx + 2, my + 2]);
        }
        const head = style.arrows ? arrowHead(px[i], py[i], px[i + 1], py[i + 1], ctx.pixel, style.arrowSize * (narrow ? 0.85 : 1)) : null;
        if (head) for (const v of head) pushVertex(mesh, v[0], v[1], c);
      }
      const named = new Set(style.labels ? keySteps(rows.map((r) => xs[r]), rows.map((r) => ys[r])) : []);
      rows.forEach((row, i) => {
        const end = i === 0 || i === n - 1;
        dots.push({
          x: px[i], y: py[i], size: style.size + (end ? 3 : 0), fill: i === 0 && n > 1 ? ctx.surface : at(i), stroke: i === 0 && n > 1 ? at(0.5) : ctx.surface,
          strokeWidth: i === 0 && n > 1 ? 2 : 1, row, group: g.key, named: named.has(i), end,
        });
      });
    }

    const labels: MarkLabel[] = [];
    if (style.labels) {
      const size = narrow ? 10 : 11;
      const font = fontOf(ctx, size, 600);
      // Ends first: they win the room over the extremes.
      const order = dots.map((_, i) => i).sort((a, b) => Number(dots[b].end) - Number(dots[a].end));
      const items: LabelItem[] = order.map((i) => {
        const p = dots[i];
        const [x, y] = toPx(ctx, p.x, p.y);
        // A step that is not named is only an obstacle: its text has no size.
        return { x, y, r: p.size / 2 + 1, w: p.named ? textWidth(stepName(p.row), font) + 2 : 1e9, h: size + 3 };
      });
      placeLabels(items, [0, 0, W, H], pathBoxes, 4).forEach((spot, k) => {
        const p = dots[order[k]];
        if (!spot || !p.named) return;
        labels.push({
          tx: p.x, ty: p.y, text: stepName(p.row), color: p.end ? theme.text.primary : theme.text.secondary, size, weight: p.end ? 700 : 500,
          align: spot.align, baseline: spot.baseline, dx: spot.dx, dy: spot.dy, free: true, series: grouped ? p.group : undefined,
        });
      });
    }

    const draws: MarkDraw[] = [];
    if (lines.length) draws.push({ batch: batch(ctx, 'line', lines) });
    if (mesh.length) draws.push({ batch: batch(ctx, 'mesh', mesh), enter: 'fade' });
    const data = pointData(dots);
    draws.push({ batch: batch(ctx, 'point', data), data, keys: dots.map((p) => `${p.group}#${stepName(p.row)}`), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(px, py): ShapeHit | null {
        const p = nearest(dots, px, py, ctx.pixel, () => 12);
        if (!p) return null;
        return {
          title: grouped ? `${p.group} · ${stepName(p.row)}` : stepName(p.row),
          rows: [
            { label: fieldLabel(ctx, xf), value: ctx.format(xs[p.row], xf) },
            { label: fieldLabel(ctx, yf), value: ctx.format(ys[p.row], yf) },
          ],
        };
      },
    };
  },
};

// ----------------------------------------------------------------- marginal

const shareOf = (style: Record<string, any> | undefined, size?: { width: number; height: number }) => {
  const s = typeof style?.share === 'number' ? style.share : 0.2;
  // A small chart keeps more of its room for the cloud.
  return 1 - Math.min(0.45, Math.max(0.05, size && Math.min(size.width, size.height) < 300 ? s * 0.85 : s));
};

/**
 * `marginal`: a cloud of points with the histogram of `x` above it and the histogram of `y` on
 * its right, classes aligned on the axes. With `color`, points are tinted and bars stacked by group.
 */
export const marginal: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales({ layer, table, fields, style, size }) {
    const xf = need(layer, 'x', 'marginal');
    const yf = need(layer, 'y', 'marginal');
    const f = shareOf(style ?? layer.style, size);
    const [a0, a1] = padded(...extent(numbers(table, xf)), 0.04);
    const [b0, b1] = padded(...extent(numbers(table, yf)), 0.04);
    return {
      x: new PanelScale(new LinearScale(a0, a1, fields[xf]?.format), f),
      y: new PanelScale(new LinearScale(b0, b1, fields[yf]?.format), f),
      axes: { x: true, y: true },
    };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = layer.encode.x!;
    const yf = layer.encode.y!;
    const xs = numbers(table, xf);
    const ys = numbers(table, yf);
    const f = ctx.x instanceof PanelScale ? ctx.x.share : 1;
    const { groups, legend, grouped } = groupsOf(ctx, (r) => Number.isFinite(xs[r]) && Number.isFinite(ys[r]), fieldLabel(ctx, yf));
    const [px, py] = ctx.pixel;
    const narrow = 1 / px < 300;

    // Our own grid: the chart's would run under the histograms.
    const lines: number[] = [];
    const gridOf = (g: { visible: boolean; color: string; width: number }, scale: Scale, vertical: boolean) => {
      if (!g.visible) return;
      const c = parseColor(g.color);
      // Same counts as the chart's axes, so the grid falls on their ticks.
      const n = vertical ? Math.min(12, Math.max(2, Math.round(1 / px / 90))) : Math.min(10, Math.max(2, Math.round(1 / py / 56)));
      for (const t of scale.ticks(0, 1, n)) {
        if (vertical) pushSegment(lines, t.t, 0, t.t, f, c, g.width);
        else pushSegment(lines, 0, t.t, f, t.t, c, g.width);
      }
    };
    gridOf(theme.grid.x, ctx.x, true);
    gridOf(theme.grid.y, ctx.y, false);

    // Histograms: classes on round values of each axis, bars stacked by group.
    const target = Math.max(4, Math.round(style.bins * (narrow ? 0.6 : 1)));
    const xb = marginalBins(ctx.x.invert(0), ctx.x.invert(f), target);
    const yb = marginalBins(ctx.y.invert(0), ctx.y.invert(f), target);
    const count = (bins: typeof xb, values: Float64Array) =>
      groups.map((g) => {
        const out = new Array<number>(bins.count).fill(0);
        for (const r of g.rows) {
          const i = binIndex(values[r], bins);
          if (i >= 0) out[i]++;
        }
        return out;
      });
    const xc = count(xb, xs);
    const yc = count(yb, ys);
    const tallest = (c: number[][], n: number) => Math.max(1, ...Array.from({ length: n }, (_, i) => c.reduce((a, g) => a + g[i], 0)));
    const xMax = tallest(xc, xb.count);
    const yMax = tallest(yc, yb.count);
    const rects: number[] = [];
    const gapX = 6 * px;
    const gapY = 6 * py;
    const clamp = (v: number) => Math.min(f, Math.max(0, v));
    const r = Math.min(2, style.radius);
    for (let i = 0; i < xb.count; i++) {
      let acc = 0;
      const x0 = clamp(ctx.x.norm(xb.start + i * xb.step));
      const x1 = clamp(ctx.x.norm(xb.start + (i + 1) * xb.step));
      groups.forEach((g, gi) => {
        const n = xc[gi][i];
        if (!n || x1 <= x0) return;
        const y0 = f + gapY + ((1 - f - gapY) * acc) / xMax;
        acc += n;
        const y1 = f + gapY + ((1 - f - gapY) * acc) / xMax;
        const last = !xc.slice(gi + 1).some((c) => c[i] > 0);
        pushRect(rects, { x0, y0, x1, y1, fill: withAlpha(g.color, style.fillOpacity), gap: style.gap, radii: last ? [r, r, 0, 0] : undefined, axis: 0 });
      });
    }
    for (let i = 0; i < yb.count; i++) {
      let acc = 0;
      const y0 = clamp(ctx.y.norm(yb.start + i * yb.step));
      const y1 = clamp(ctx.y.norm(yb.start + (i + 1) * yb.step));
      groups.forEach((g, gi) => {
        const n = yc[gi][i];
        if (!n || y1 <= y0) return;
        const x0 = f + gapX + ((1 - f - gapX) * acc) / yMax;
        acc += n;
        const x1 = f + gapX + ((1 - f - gapX) * acc) / yMax;
        const last = !yc.slice(gi + 1).some((c) => c[i] > 0);
        pushRect(rects, { x0, y0, x1, y1, fill: withAlpha(g.color, style.fillOpacity), gap: style.gap, radii: last ? [0, r, r, 0] : undefined, axis: 1 });
      });
    }
    // Baselines of both histograms.
    const axisInk = withAlpha(parseColor(theme.text.muted), 0.55);
    pushSegment(lines, 0, f + gapY, f, f + gapY, axisInk, 1);
    pushSegment(lines, f + gapX, 0, f + gapX, f, axisInk, 1);

    type P = Dot & { row: number; group: string };
    const dots: P[] = [];
    const size = style.size * (narrow ? 0.8 : 1);
    for (const g of groups) {
      for (const row of g.rows) {
        const c = ctx.paint(g.color, row);
        dots.push({ x: ctx.x.norm(xs[row]), y: ctx.y.norm(ys[row]), size, fill: withAlpha(c, c[3] * style.opacity), row, group: g.key });
      }
    }
    // Highest count of each histogram, at the end of its panel: gives the bars a scale.
    const labels: MarkLabel[] = [];
    if (style.labels && !narrow) {
      const int = new Intl.NumberFormat();
      labels.push({ tx: f, ty: 1, text: fillText(ctx.theme.texts.max, { value: int.format(xMax) }), color: theme.text.muted, size: 10, align: 'left', baseline: 'top', dx: 8, dy: 0, free: true });
    }

    const data = pointData(dots);
    const draws: MarkDraw[] = [
      { batch: batch(ctx, 'line', lines), enter: 'fade' },
      { batch: batch(ctx, 'rect', rects) },
      { batch: batch(ctx, 'point', data), data, keys: dots.map((p) => String(p.row)) },
    ];
    const int = new Intl.NumberFormat();
    const binHit = (field: string, bins: typeof xb, counts: number[][], i: number): ShapeHit | null => {
      if (i < 0 || i >= bins.count) return null;
      const a = bins.start + i * bins.step;
      const rows = groups.map((g, gi) => ({ label: grouped ? g.key : ctx.theme.texts.observations, value: int.format(counts[gi][i]) })).filter((row) => !grouped || row.value !== '0');
      if (grouped && groups.length > 1) rows.push({ label: ctx.theme.texts.total, value: int.format(counts.reduce((s, c) => s + c[i], 0)) });
      return { title: fillText(ctx.theme.texts.labelValue, { label: fieldLabel(ctx, field), value: `${ctx.format(a, field)} – ${ctx.format(a + bins.step, field)}` }), rows };
    };
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        if (tx > f && ty > f) return null;
        if (ty > f) return binHit(xf, xb, xc, binIndex(ctx.x.invert(tx), xb));
        if (tx > f) return binHit(yf, yb, yc, binIndex(ctx.y.invert(ty), yb));
        const p = nearest(dots, tx, ty, ctx.pixel, () => Math.max(8, size));
        if (!p) return null;
        return {
          title: grouped ? p.group : fieldLabel(ctx, yf),
          rows: [
            { label: fieldLabel(ctx, xf), value: ctx.format(xs[p.row], xf) },
            { label: fieldLabel(ctx, yf), value: ctx.format(ys[p.row], yf) },
          ],
        };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const SCATTER_MARKS: Record<string, MarkDefinition> = { quadrant, connected, marginal };
