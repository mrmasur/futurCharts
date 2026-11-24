/**
 * Polar coordinates: a time series wound into a spiral, lines and areas around
 * a round graduated grid, a polar scatter plot and stacked radial areas.
 * Angles run clockwise from 12 o'clock, like the `arc` primitive.
 */
import { LAYOUTS, SHAPES } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale, niceStep } from '../scale/scales';
import type { Table } from '../data/table';
import { parseColor, withAlpha } from '../util/color';
import { categoriesOf, need, totals, valueColor } from './charts';
import { pushArc, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { fillText } from '../theme/texts';
import type { Theme } from '../theme/theme';

const TAU = Math.PI * 2;
const DAY = 86400000;

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;

function batch(ctx: BuildContext, kind: 'point' | 'line' | 'mesh' | 'arc', data: number[]) {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

function numbers(table: Table, f: string): Float64Array {
  const c = table.column(f);
  if (c.type === 'string') throw new Error(`futurCharts: field "${f}" must be numeric.`);
  return c.values as Float64Array;
}

function extent(v: ArrayLike<number>): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

// ------------------------------------------------------------ pure geometry

/**
 * What one turn of a numeric angle field is worth. `angleMax` > 0 says it
 * (0 to `angleMax`). Otherwise evenly spaced values make a cycle of their own
 * (hours 0–23 → 24, months 1–12 → 12 from 1, bearings every 22.5° → 360), free
 * values within 0–360 are degrees, within 0–24 hours; anything else is an open range.
 */
export function polarPeriod(values: ArrayLike<number>, angleMax = 0): { origin: number; period: number; cyclic: boolean } {
  if (angleMax > 0) return { origin: 0, period: angleMax, cyclic: true };
  const set = new Set<number>();
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) set.add(values[i]);
  const d = [...set].sort((a, b) => a - b);
  if (d.length === 0) return { origin: 0, period: 1, cyclic: true };
  if (d.length >= 3) {
    const s = (d[d.length - 1] - d[0]) / (d.length - 1);
    let even = true;
    for (let i = 1; i < d.length && even; i++) even = Math.abs(d[i] - d[i - 1] - s) <= 1e-6 * Math.abs(s);
    if (even) return { origin: d[0], period: s * d.length, cyclic: true };
  }
  const lo = d[0];
  const hi = d[d.length - 1];
  if (lo >= 0 && hi <= 360 && hi > 24) return { origin: 0, period: 360, cyclic: true };
  if (lo >= 0 && hi <= 24 && hi > 12) return { origin: 0, period: 24, cyclic: true };
  return { origin: lo, period: hi - lo || 1, cyclic: false };
}

/**
 * How many graduations to put around a cycle of `period` units when at most
 * `max` fit: a count that cuts the period into whole steps (24 h → 12, 8, 6, 4…).
 */
export function angleTickCount(period: number, max: number): number {
  const whole = (n: number) => Math.abs(period / n - Math.round(period / n)) < 1e-9;
  for (const n of [24, 12, 8, 6, 4, 3, 2]) if (n <= max && n <= period + 1e-9 && whole(n)) return n;
  // A prime cycle (7 days): all of it or nothing finer than quarters.
  if (Number.isInteger(period) && period <= max) return period;
  return max >= 4 ? 4 : 2;
}

/**
 * Sample a curve given in polar coordinates (`angle` ascending within one turn,
 * radians) into unit-space points (x right, y up). `closed` joins the last point
 * to the first across 12 o'clock. `smooth` bends the radius between the points
 * (a monotone cubic: no overshoot), otherwise the points are joined by straight
 * chords. Two curves over the same angles get the same number of samples, so a
 * band between them can be meshed sample by sample.
 */
export function polarPath(
  angle: ArrayLike<number>,
  radius: ArrayLike<number>,
  opts: { closed?: boolean; smooth?: boolean } = {},
): { x: number[]; y: number[] } {
  const n = angle.length;
  const x: number[] = [];
  const y: number[] = [];
  const put = (a: number, r: number) => {
    const rr = Math.max(0, r);
    x.push(Math.sin(a) * rr);
    y.push(Math.cos(a) * rr);
  };
  if (n === 0) return { x, y };
  const closed = !!opts.closed && n > 2;
  if (!opts.smooth || n < 3) {
    for (let i = 0; i < n; i++) put(angle[i], radius[i]);
    if (closed) put(angle[0], radius[0]);
    return { x, y };
  }
  const segs = closed ? n : n - 1;
  const a = (i: number) => (i >= n ? angle[i - n] + TAU : i < 0 ? angle[i + n] - TAU : angle[i]);
  const r = (i: number) => radius[((i % n) + n) % n];
  // Slope of each segment, then tangents limited so the radius never overshoots its neighbours.
  const slope = (i: number) => {
    const h = a(i + 1) - a(i);
    return h > 0 ? (r(i + 1) - r(i)) / h : 0;
  };
  const tangent = (i: number) => {
    if (!closed && (i === 0 || i === n - 1)) return slope(i === 0 ? 0 : n - 2);
    const d0 = slope(i - 1);
    const d1 = slope(i);
    if (d0 * d1 <= 0) return 0;
    const m = (d0 + d1) / 2;
    const cap = 3 * Math.min(Math.abs(d0), Math.abs(d1));
    return Math.sign(m) * Math.min(Math.abs(m), cap);
  };
  for (let i = 0; i < segs; i++) {
    const a0 = a(i);
    const h = a(i + 1) - a0;
    const r0 = r(i);
    const r1 = r(i + 1);
    const m0 = tangent(i);
    const m1 = tangent((i + 1) % n);
    const sub = Math.max(2, Math.ceil(h / (TAU / 144)));
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      put(a0 + h * t, (2 * t3 - 3 * t2 + 1) * r0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * r1 + (t3 - t2) * h * m1);
    }
  }
  put(a(segs), r(segs));
  return { x, y };
}

export type SpiralTurn = 'year' | 'week' | 'day';

/** Position of each date in turns, counted from the start of the period (year, Monday, midnight; UTC) holding the earliest one. */
export function spiralTurns(t: ArrayLike<number>, turn: SpiralTurn): Float64Array {
  const out = new Float64Array(t.length);
  const [t0] = extent(t);
  if (turn === 'year') {
    const y0 = new Date(t0).getUTCFullYear();
    for (let i = 0; i < t.length; i++) {
      const y = new Date(t[i]).getUTCFullYear();
      const s = Date.UTC(y, 0, 1);
      out[i] = y - y0 + (t[i] - s) / (Date.UTC(y + 1, 0, 1) - s);
    }
    return out;
  }
  const day = Math.floor(t0 / DAY);
  // 1970-01-01 was a Thursday: Monday is 3 days before.
  const start = (turn === 'week' ? day - ((((day + 3) % 7) + 7) % 7) : day) * DAY;
  const len = turn === 'week' ? 7 * DAY : DAY;
  for (let i = 0; i < t.length; i++) out[i] = (t[i] - start) / len;
  return out;
}

export interface SpiralLayout {
  /** Share of a turn one datum covers. */
  span: number;
  /** Radial thickness of one turn (unit radius 1). */
  band: number;
  /** Start angle of each datum (radians within one turn) and radius of the middle of its band. */
  angle: Float64Array;
  radius: Float64Array;
}

/**
 * An Archimedean spiral from `inner` (center side, first datum) to radius 1:
 * each datum is a ring sector `span` of a turn wide, and a sector sits exactly
 * one `band` further out than the one a turn earlier.
 */
export function spiralLayout(pos: ArrayLike<number>, inner: number, span?: number): SpiralLayout {
  const n = pos.length;
  let dp = span ?? 0;
  if (!(dp > 0)) {
    const sorted = Array.from(pos).filter(Number.isFinite).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) if (sorted[i] > sorted[i - 1]) gaps.push(sorted[i] - sorted[i - 1]);
    gaps.sort((a, b) => a - b);
    dp = gaps.length ? gaps[gaps.length >> 1] : 1 / 12;
  }
  let last = 0;
  for (let i = 0; i < n; i++) if (Number.isFinite(pos[i])) last = Math.max(last, pos[i]);
  const band = (1 - inner) / (last + dp / 2 + 1);
  const angle = new Float64Array(n);
  const radius = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    angle[i] = (((pos[i] % 1) + 1) % 1) * TAU;
    radius[i] = inner + band * (pos[i] + dp / 2 + 0.5);
  }
  return { span: dp, band, angle, radius };
}

// ------------------------------------------------------------- shared frame

interface Frame {
  cx: number;
  cy: number;
  /** Scale-space length of one unit radius along x (what the `arc` primitive expects). */
  unit: number;
  /** The unit radius in px. */
  px: number;
  at(a: number, r: number): [number, number];
  polar(tx: number, ty: number): { a: number; r: number };
}

function frameOf(ctx: BuildContext): Frame {
  const unit = ctx.x.norm(1) - ctx.x.norm(0);
  return {
    cx: ctx.x.norm(0),
    cy: ctx.y.norm(0),
    unit,
    px: unit / ctx.pixel[0],
    at: (a, r) => [ctx.x.norm(Math.sin(a) * r), ctx.y.norm(Math.cos(a) * r)],
    polar(tx, ty) {
      const x = ctx.x.invert(tx);
      const y = ctx.y.invert(ty);
      return { a: (Math.atan2(x, y) + TAU) % TAU, r: Math.hypot(x, y) };
    },
  };
}

const polarScales = (mx: number, my: number) => () => ({ x: new LinearScale(-mx, mx), y: new LinearScale(-my, my), aspect: mx / my });

function circle(lines: number[], f: Frame, r: number, color: RGBA, width = 1): void {
  const S = 96;
  for (let k = 0; k < S; k++) {
    const [ax, ay] = f.at((TAU * k) / S, r);
    const [bx, by] = f.at((TAU * (k + 1)) / S, r);
    pushSegment(lines, ax, ay, bx, by, color, width);
  }
}

/** A label just outside the circle at angle `a`, anchored so that it grows away from it. */
function around(f: Frame, a: number, text: string, color: string, size: number, r = 1.07): MarkLabel {
  const sx = Math.sin(a);
  const sy = Math.cos(a);
  const [tx, ty] = f.at(a, r);
  return {
    tx, ty, text, color, size,
    align: Math.abs(sx) < 0.2 ? 'center' : sx > 0 ? 'left' : 'right',
    baseline: Math.abs(sy) < 0.2 ? 'middle' : sy > 0 ? 'bottom' : 'top',
  };
}

interface AngleTick {
  a: number;
  text: string;
}

/** The densest set of graduations whose labels fit around the circle. */
function fitting(ctx: BuildContext, f: Frame, sets: AngleTick[][], size: number): AngleTick[] {
  const font = `500 ${size}px ${ctx.theme.font.family}`;
  for (const set of sets) {
    const widest = Math.max(1, ...set.map((t) => textWidth(t.text, font)));
    if (set.length * (widest + 12) <= TAU * f.px * 1.07) return set;
  }
  return sets[sets.length - 1] ?? [];
}

interface AngleAxis {
  /** Angle keys in drawing order (clockwise), as the strings `totals` produces. */
  keys: string[];
  angleOf(key: string): number;
  label(key: string): string;
  ticks: AngleTick[];
  /** The last key comes back to the first. */
  cyclic: boolean;
}

/** The angle axis of `field`: categories evenly spread around the circle, or a numeric cycle. */
function angleAxis(ctx: BuildContext, f: Frame, field: string, size: number): AngleAxis {
  const { table } = ctx.data;
  const col = table.column(field);
  const { style } = ctx;
  if (col.type === 'string') {
    const keys = categoriesOf(table, field);
    const n = Math.max(1, keys.length);
    const index = new Map(keys.map((k, i) => [k, i]));
    const all = keys.map((k, i) => ({ a: (TAU * i) / n, text: k }));
    const sets = [1, 2, 3, 4, 6, 8, 12].filter((e) => e === 1 || n / e >= 3).map((e) => all.filter((_, i) => i % e === 0));
    return { keys, angleOf: (k) => (TAU * (index.get(k) ?? 0)) / n, label: (k) => k, ticks: fitting(ctx, f, sets, size), cyclic: true };
  }
  const values = col.values as Float64Array;
  const { origin, period, cyclic } = polarPeriod(values, style.angleMax);
  const keys = categoriesOf(table, field).filter((k) => Number.isFinite(Number(k)));
  const turn = (v: number) => (((v - origin) / period) % 1 + 1) % 1;
  // On a cycle, order by angle: 350° comes before 10° only if it does around the circle.
  if (cyclic) keys.sort((p, q) => turn(Number(p)) - turn(Number(q)));
  const text = (v: number, n: number) => {
    if (style.compass && Math.abs(period - 360) < 1e-9 && (n === 4 || n === 8)) return ctx.theme.texts.compass[(Math.round(((v - origin) / 360) * 8) + 8) % 8] ?? '';
    return ctx.format(v, field);
  };
  const sets: AngleTick[][] = [];
  // Twelve graduations at most: every hour of a day or every 15° would crowd the rim.
  for (const max of [12, 8, 6, 4, 3, 2]) {
    const n = angleTickCount(period, max);
    if (sets.some((s) => s.length === n)) continue;
    sets.push(Array.from({ length: n }, (_, i) => ({ a: (TAU * i) / n, text: text(origin + (period * i) / n, n) })));
  }
  // The compass reads best with its eight points, then four: never 12 or 24 bearings in degrees.
  const usable = style.compass && Math.abs(period - 360) < 1e-9 ? sets.filter((s) => s.length === 8 || s.length === 4) : sets;
  return {
    keys,
    // An open range stops short of a full turn, so that its two ends do not meet.
    angleOf: (k) => (cyclic ? turn(Number(k)) : ((Number(k) - origin) / period) * 0.92) * TAU,
    label: (k) => ctx.format(Number(k), field),
    ticks: cyclic ? fitting(ctx, f, usable.length ? usable : sets, size) : [],
    cyclic,
  };
}

interface RadialAxis {
  lo: number;
  hi: number;
  /** Graduated values, from the first above `lo` to `hi`. */
  rings: number[];
}

/** A radial axis from zero (or the lowest negative value) to a round value above `max`. */
function radialAxis(min: number, max: number, levels: number): RadialAxis {
  const lo0 = Math.min(0, min);
  const hi0 = max > lo0 ? max : lo0 + 1;
  const step = niceStep(hi0 - lo0, Math.max(1, levels));
  const lo = Math.floor(lo0 / step + 1e-9) * step;
  const hi = Math.ceil(hi0 / step - 1e-9) * step;
  const rings: number[] = [];
  for (let v = lo + step; v <= hi + step * 1e-6; v += step) rings.push(v);
  return { lo, hi, rings };
}

/**
 * Fewer rings when the circle is small (`px`: its radius): one in two or three,
 * always counting from the outermost, so the axis itself never changes with the size.
 */
export function thinRings<T>(rings: T[], px: number): T[] {
  const max = px < 80 ? 2 : px < 120 ? 3 : Infinity;
  const every = Math.max(1, Math.ceil(rings.length / max));
  return rings.filter((_, i) => (rings.length - 1 - i) % every === 0);
}

/** Round grid: one circle per ring, one spoke per graduation, the names around and the ring values up 12 o'clock. */
function drawGrid(
  ctx: BuildContext,
  f: Frame,
  o: {
    rings: { r: number; text?: string }[];
    ticks: AngleTick[];
    inner: number;
    size: number;
    lines: number[];
    labels: MarkLabel[];
    names: boolean;
    /** Angle of the ray the ring values run along (default 12 o'clock). */
    ray?: number;
    /** The ring values sit on fills: give them a pill of the surface color. */
    pill?: boolean;
  },
): void {
  const { theme } = ctx;
  const grid = parseColor(theme.grid.y.color);
  for (const ring of o.rings) circle(o.lines, f, ring.r, grid);
  if (o.inner > 0) circle(o.lines, f, o.inner, grid);
  for (const t of o.ticks) {
    const [ax, ay] = f.at(t.a, o.inner);
    const [bx, by] = f.at(t.a, 1);
    pushSegment(o.lines, ax, ay, bx, by, grid, 1);
  }
  if (!o.names) return;
  for (const t of o.ticks) o.labels.push(around(f, t.a, t.text, theme.text.secondary, o.size));
  // Ring values run up a spoke; the outermost one would sit on the name at its end.
  const outer = Math.max(...o.rings.map((g) => g.r));
  for (const ring of o.rings) {
    if (!ring.text || ring.r >= outer - 1e-9) continue;
    const [tx, ty] = f.at(o.ray ?? 0, ring.r);
    if (o.pill) o.labels.push({ tx, ty, text: ring.text, align: 'center', baseline: 'middle', size: o.size - 1, color: theme.text.secondary, background: theme.background });
    else o.labels.push({ tx, ty, text: ring.text, align: 'left', baseline: 'bottom', dx: 4, dy: -2, size: o.size - 1, color: theme.text.muted });
  }
}

/** Series of a layer as a matrix over the angle keys (NaN where a series has no value). */
function matrix(ctx: BuildContext, af: string, vf: string, sf: string | undefined, keys: string[]) {
  const data = totals(ctx.data.table, af, vf, sf);
  const names = [...new Set(data.map((d) => d.group))];
  const index = new Map(keys.map((k, i) => [k, i]));
  const series = names.map((name) => ({ name, values: new Float64Array(keys.length).fill(NaN), row: -1 }));
  for (const d of data) {
    const s = series[names.indexOf(d.group)];
    const k = index.get(d.key);
    if (k === undefined) continue;
    s.values[k] = d.value;
    if (s.row < 0) s.row = d.row;
  }
  return series;
}

/** Vertex nearest to the pointer, within `reach` px. */
function nearest<T extends { x: number; y: number }>(ctx: BuildContext, items: T[], tx: number, ty: number, reach: (v: T) => number): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const v of items) {
    const d = Math.hypot((v.x - tx) / ctx.pixel[0], (v.y - ty) / ctx.pixel[1]);
    if (d <= reach(v) && d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/**
 * The spoke with the fewest data around it, 12 o'clock when it is as quiet as
 * any other: ring values written along it are not buried under the dots.
 */
export function quietRay(spokes: number[], angles: number[]): number {
  if (spokes.length < 2) return 0;
  const reach = Math.PI / spokes.length;
  const away = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);
  let best = spokes[0];
  let least = Infinity;
  for (const s of spokes) {
    let count = 0;
    for (const a of angles) if (away(a, s) < reach) count++;
    if (count < least) [best, least] = [s, count];
  }
  return best;
}

// ------------------------------------------------------------------- spiral

const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334].map((d) => d / 365);

/** Graduations of one turn: where the separators go and what to write between (or on) them. */
function spiralTicks(turn: SpiralTurn | 'count', count: number, texts: Theme['texts']): { lines: number[]; sets: AngleTick[][] } {
  if (turn === 'year') {
    const short = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
    const narrow = new Intl.DateTimeFormat(undefined, { month: 'narrow', timeZone: 'UTC' });
    const mid = (m: number) => ((monthStarts[m] + (monthStarts[m + 1] ?? 1)) / 2) * TAU;
    const names = (f: Intl.DateTimeFormat) => monthStarts.map((_, m) => ({ a: mid(m), text: f.format(Date.UTC(2001, m, 15)).replace(/\.$/, '') }));
    const s = names(short);
    return { lines: monthStarts.map((m) => m * TAU), sets: [s, names(narrow), s.filter((_, m) => m % 3 === 0)] };
  }
  if (turn === 'week') {
    const f = (width: 'short' | 'narrow') => {
      const fmt = new Intl.DateTimeFormat(undefined, { weekday: width, timeZone: 'UTC' });
      // 2001-01-01 was a Monday.
      return Array.from({ length: 7 }, (_, d) => ({ a: ((d + 0.5) / 7) * TAU, text: fmt.format(Date.UTC(2001, 0, 1 + d)).replace(/\.$/, '') }));
    };
    return { lines: Array.from({ length: 7 }, (_, d) => (d / 7) * TAU), sets: [f('short'), f('narrow')] };
  }
  if (turn === 'day') {
    const set = (n: number) => Array.from({ length: n }, (_, i) => ({ a: (i / n) * TAU, text: fillText(texts.hours, { n: (24 / n) * i }) }));
    return { lines: Array.from({ length: 8 }, (_, i) => (i / 8) * TAU), sets: [set(12), set(8), set(4)] };
  }
  const n = Math.max(1, Math.round(count));
  const all = Array.from({ length: n }, (_, i) => ({ a: ((i + 0.5) / n) * TAU, text: String(i + 1) }));
  const sets = [1, 2, 3, 4, 5, 6, 10, 12].filter((e) => e === 1 || n / e >= 3).map((e) => all.filter((_, i) => i % e === 0));
  return { lines: n <= 31 ? Array.from({ length: n }, (_, i) => (i / n) * TAU) : [], sets };
}

/**
 * `spiral`: a series wound around the center, one turn per period (`style.turn`:
 * a year, a week, a day of the `x` dates, or `turnCount` rows), the first datum
 * at the center. `value` colors each segment; `size` thins the ribbon. The same
 * moment of every period lines up on one ray: seasons show as sectors.
 */
export const spiral: MarkDefinition = {
  standalone: true,
  // Labels, separators and segment joints depend on the size in px.
  sizeDependent: true,
  symbol: 'square',
  scales: polarScales(1.26, 1.16),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = need(layer, 'x', 'spiral');
    const vf = layer.encode.value ?? layer.encode.color ?? need(layer, 'y', 'spiral');
    const zf = layer.encode.size;
    const xcol = table.column(xf);
    const vals = numbers(table, vf);
    const sizes = zf ? numbers(table, zf) : undefined;
    const f = frameOf(ctx);

    // Rows in order along the spiral.
    const temporal = xcol.type === 'time' && !(style.turnCount > 0);
    let rows = Array.from({ length: table.length }, (_, i) => i).filter((i) => Number.isFinite(vals[i]));
    if (xcol.type !== 'string') {
      const xs = xcol.values as Float64Array;
      rows = rows.filter((i) => Number.isFinite(xs[i])).sort((a, b) => xs[a] - xs[b]);
    }
    let unit: SpiralTurn | 'count' = 'count';
    let pos: Float64Array;
    let span: number | undefined;
    if (temporal) {
      const ts = Float64Array.from(rows, (i) => (xcol.values as Float64Array)[i]);
      const [t0, t1] = extent(ts);
      const by: SpiralTurn = style.turn === 'year' || style.turn === 'week' || style.turn === 'day' ? style.turn : t1 - t0 >= 550 * DAY ? 'year' : t1 - t0 >= 14 * DAY ? 'week' : 'day';
      unit = by;
      pos = spiralTurns(ts, by);
    } else {
      const per = style.turnCount > 0 ? style.turnCount : 12;
      pos = Float64Array.from(rows, (_, k) => k / per);
      span = 1 / per;
    }
    const inner = Math.min(0.8, Math.max(0, style.innerRadius));
    const L = spiralLayout(pos, inner, span);
    const [lo, hi] = extent(vals);
    const [s0, s1] = sizes ? extent(sizes) : [0, 1];
    const bandPx = L.band * f.px;
    const gapPx = Math.min(style.gap, bandPx * 0.4);
    // Narrow segments make one continuous ribbon; wide ones are tiles with a gap all around.
    const tiles = L.span * TAU * (inner + (1 - inner) * 0.5) * f.px >= 9;

    const arcs: number[] = [];
    const keys: string[] = [];
    const fills: RGBA[] = [];
    rows.forEach((row, k) => {
      const fill = ctx.paint(valueColor(ctx, vals[row], lo, hi, !!style.diverging), row);
      fills.push(fill);
      const share = sizes ? 0.22 + 0.78 * (s1 > s0 ? (sizes[row] - s0) / (s1 - s0) : 1) : 1;
      const half = (L.band * (Number.isFinite(share) ? share : 1)) / 2;
      const rc = L.radius[k];
      const a0 = L.angle[k];
      if (tiles) {
        pushArc(arcs, f.cx, f.cy, (rc - half) * f.unit, (rc + half) * f.unit, a0, a0 + L.span * TAU, gapPx, fill, Math.min(3, bandPx / 4));
      } else {
        // A hair of overlap hides the antialiased joint between two neighbours.
        const g = (gapPx / 2 / f.px) * (sizes ? 0 : 1);
        const over = 0.8 / Math.max(1, rc * f.px);
        pushArc(arcs, f.cx, f.cy, Math.max(0, rc - half + g) * f.unit, (rc + half - g) * f.unit, a0, a0 + L.span * TAU + over, 0, fill);
      }
      keys.push(String(xcol.values[row]));
    });
    const data = new Float32Array(arcs);
    const arcBatch = ctx.renderer.createBatch('arc');
    arcBatch.update(data, rows.length);
    const draws: MarkDraw[] = [{ batch: arcBatch, data, keys }];

    const labels: MarkLabel[] = [];
    const turns = Math.max(1, Math.ceil(Math.max(0, ...pos) + L.span / 2));
    if (style.labels) {
      const size = f.px < 110 ? 9 : 11;
      const T = spiralTicks(unit, style.turnCount > 0 ? style.turnCount : 12, ctx.theme.texts);
      // Period separators, drawn over the ribbon in the surface color.
      const sep = withAlpha(ctx.surface, 0.5);
      const lines: number[] = [];
      for (const a of T.lines) {
        const [ax, ay] = f.at(a, inner + L.band * 0.5);
        const [bx, by] = f.at(a, 1.015);
        pushSegment(lines, ax, ay, bx, by, sep, 1);
      }
      if (lines.length) draws.push({ batch: batch(ctx, 'line', lines), enter: 'fade' });
      for (const t of fitting(ctx, f, T.sets, size)) labels.push(around(f, t.a, t.text, theme.text.secondary, size, 1.06));

      // Each turn named where it starts, up the 12 o'clock ray.
      const name = (k: number): string => {
        if (!temporal) return '';
        const t0 = (xcol.values as Float64Array)[rows[0]];
        if (unit === 'year') return String(new Date(t0).getUTCFullYear() + k);
        const start = spiralTurns([t0], unit as SpiralTurn)[0];
        const len = unit === 'week' ? 7 * DAY : DAY;
        return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(t0 - start * len + k * len);
      };
      const tsize = Math.max(9, Math.min(11, Math.floor(bandPx - 3)));
      const every = Math.max(1, Math.ceil((tsize + 5) / Math.max(bandPx, 0.01)));
      const first = rows.length ? Math.floor(pos[0] + 1e-9) : 0;
      for (let k = turns - 1; k >= first; k -= every) {
        const text = name(k);
        if (!text) break;
        // The segment under the start of turn k: its fill decides the ink.
        const at = pos.findIndex((p) => p >= k - 1e-9);
        if (at < 0) continue;
        const [tx, ty] = f.at(0, inner + L.band * (k + 0.5 + L.span / 2));
        if (bandPx >= tsize + 3 && !sizes && !tiles) labels.push({ tx, ty, text, on: fills[at], align: 'left', baseline: 'middle', dx: 4, size: tsize, weight: 650 });
        else labels.push({ tx, ty, text, color: theme.text.primary, align: 'right', baseline: 'middle', dx: -3, size: 9, weight: 650, background: theme.background });
      }
      // In the hole: what the colors measure, from the lowest value to the highest.
      if (inner * f.px * 2 >= 68) {
        labels.push({ tx: f.cx, ty: f.cy, text: fieldLabel(ctx, vf), color: theme.text.muted, size: 10, align: 'center', baseline: 'bottom', dy: -1 });
        labels.push({ tx: f.cx, ty: f.cy, text: `${ctx.format(lo, vf)} – ${ctx.format(hi, vf)}`, color: theme.text.primary, size: 10, weight: 650, align: 'center', baseline: 'top', dy: 2 });
      }
    }

    const dateFmt = new Intl.DateTimeFormat(undefined, unit === 'day' ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const { a, r } = f.polar(tx, ty);
        const frac = a / TAU;
        // The turn whose band holds this radius at this angle.
        const k = Math.floor((r - inner) / L.band - frac);
        const q = k + frac;
        if (k < 0) return null;
        let i = -1;
        for (let j = 0; j < pos.length; j++) {
          if (pos[j] <= q + 1e-9 && q < pos[j] + L.span) i = j;
          if (pos[j] > q) break;
        }
        if (i < 0) return null;
        const row = rows[i];
        const title = xcol.type === 'time' ? dateFmt.format(xcol.values[row] as number) : xcol.type === 'string' ? String(xcol.values[row]) : ctx.format(xcol.values[row] as number, xf);
        const out = [{ label: fieldLabel(ctx, vf), value: ctx.format(vals[row], vf) }];
        if (zf && sizes) out.push({ label: fieldLabel(ctx, zf), value: ctx.format(sizes[row], zf) });
        return { title, rows: out };
      },
    };
  },
};

// --------------------------------------------------------------- polar line

/**
 * `polarLine`: curves around a round grid. `x` is the angle (categories spread
 * evenly, or a numeric cycle: hours, bearings, months), `y` the radius, `color`
 * the series. `fillOpacity` > 0 fills them down to the center.
 */
export const polarLine: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'line',
  scales: polarScales(1.3, 1.19),
  build(ctx) {
    const { layer } = ctx.data;
    const { style } = ctx;
    const af = layer.encode.angle ?? need(layer, 'x', 'polarLine');
    const vf = layer.encode.value ?? need(layer, 'y', 'polarLine');
    const sf = layer.encode.color;
    const f = frameOf(ctx);
    const size = f.px < 110 ? 10 : 11;
    const axis = angleAxis(ctx, f, af, size);
    const series = matrix(ctx, af, vf, sf, axis.keys);
    const all = series.flatMap((s) => Array.from(s.values).filter(Number.isFinite));
    const R = radialAxis(Math.min(0, ...all), Math.max(0, ...all), style.levels);
    const rad = (v: number) => (v - R.lo) / (R.hi - R.lo);
    const closed = !!style.closed && axis.cyclic;

    const lines: number[] = [];
    const mesh: number[] = [];
    const points: number[] = [];
    const keys: string[] = [];
    const labels: MarkLabel[] = [];
    drawGrid(ctx, f, { rings: thinRings(R.rings, f.px).map((v) => ({ r: rad(v), text: ctx.format(v, vf) })), ticks: axis.ticks, inner: 0, size, lines, labels, names: style.labels !== false });

    const vertices: { x: number; y: number; series: string; key: string; value: number }[] = [];
    const name = (s: string) => (sf ? s : fieldLabel(ctx, vf));
    for (const s of series) {
      if (sf && ctx.hidden.has(s.name)) continue;
      const color = ctx.paint(ctx.categorical(name(s.name)), s.row < 0 ? undefined : s.row);
      const idx = axis.keys.map((_, i) => i).filter((i) => Number.isFinite(s.values[i]));
      if (!idx.length) continue;
      const path = polarPath(idx.map((i) => axis.angleOf(axis.keys[i])), idx.map((i) => rad(s.values[i])), { closed, smooth: !!style.smooth });
      const px = path.x.map((x) => ctx.x.norm(x));
      const py = path.y.map((y) => ctx.y.norm(y));
      if (style.fillOpacity > 0) {
        const fill = withAlpha(color, style.fillOpacity);
        for (let k = 0; k + 1 < px.length; k++) {
          pushVertex(mesh, f.cx, f.cy, fill);
          pushVertex(mesh, px[k], py[k], fill);
          pushVertex(mesh, px[k + 1], py[k + 1], fill);
        }
      }
      for (let k = 0; k + 1 < px.length; k++) pushSegment(lines, px[k], py[k], px[k + 1], py[k + 1], color, style.width);
      for (const i of idx) {
        const [x, y] = f.at(axis.angleOf(axis.keys[i]), Math.max(0, rad(s.values[i])));
        vertices.push({ x, y, series: s.name, key: axis.keys[i], value: s.values[i] });
        if (style.points) {
          points.push(x, y, style.width * 2 + 3, SHAPES.circle, color[0], color[1], color[2], color[3], ctx.surface[0], ctx.surface[1], ctx.surface[2], 1, 1.5);
          keys.push(`${s.name}|${axis.keys[i]}`);
        }
      }
    }
    const draws: MarkDraw[] = [];
    if (mesh.length) draws.push({ batch: batch(ctx, 'mesh', mesh) });
    draws.push({ batch: batch(ctx, 'line', lines) });
    if (points.length) draws.push({ batch: batch(ctx, 'point', points), data: new Float32Array(points), keys, enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend: sf ? series.map((s) => ({ key: s.name, color: ctx.categorical(s.name) })) : [],
      pick(tx, ty): ShapeHit | null {
        const v = nearest(ctx, vertices, tx, ty, () => 16);
        if (!v) return null;
        const at = `${fieldLabel(ctx, af)} ${axis.label(v.key)}`;
        return { title: sf ? `${v.series} · ${axis.label(v.key)}` : at, rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(v.value, vf) }] };
      },
    };
  },
};

// ------------------------------------------------------------ polar scatter

/**
 * `polarScatter`: one dot per row at angle `x` (or `angle`: a numeric cycle such
 * as a bearing, or categories) and radius `y`; `size` and `color` as on `point`.
 */
export const polarScatter: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales: polarScales(1.3, 1.19),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const af = layer.encode.angle ?? need(layer, 'x', 'polarScatter');
    const rf = need(layer, 'y', 'polarScatter');
    const zf = layer.encode.size;
    const cf = layer.encode.color;
    const kf = layer.encode.key;
    const f = frameOf(ctx);
    const size = f.px < 110 ? 10 : 11;
    const axis = angleAxis(ctx, f, af, size);
    const acol = table.column(af);
    const rs = numbers(table, rf);
    const zs = zf ? numbers(table, zf) : undefined;
    const ccol = cf ? table.column(cf) : undefined;
    const numericColor = !!ccol && ccol.type !== 'string';
    const [c0, c1] = numericColor ? extent(ccol!.values as Float64Array) : [0, 1];
    const [z0, z1] = zs ? extent(zs) : [0, 1];
    const [rmin, rmax] = extent(rs);
    const R = radialAxis(rmin, rmax, style.levels);
    const rad = (v: number) => (v - R.lo) / (R.hi - R.lo);
    // Dots shrink with the circle, so that a small chart is not one blot.
    const k = Math.min(1, Math.max(0.55, f.px / 150));
    const [d0, d1] = style.sizeRange as [number, number];
    const diameter = (i: number) => (zs ? (d0 + (d1 - d0) * Math.sqrt(z1 > z0 ? Math.max(0, (zs[i] - z0) / (z1 - z0)) : 0.5)) * k : style.size * k);

    const lines: number[] = [];
    const labels: MarkLabel[] = [];
    const legendKeys: string[] = [];
    const dots: { x: number; y: number; d: number; row: number; c: RGBA; a: number }[] = [];
    for (let i = 0; i < table.length; i++) {
      if (!Number.isFinite(rs[i]) || (acol.type !== 'string' && !Number.isFinite(acol.values[i] as number))) continue;
      let c: RGBA;
      if (!ccol) c = ctx.categorical(fieldLabel(ctx, rf));
      else if (numericColor) {
        const v = ccol.values[i] as number;
        if (!Number.isFinite(v)) continue;
        c = ctx.ramp(c1 > c0 ? (v - c0) / (c1 - c0) : 0.5);
      } else {
        const g = String(ccol.values[i]);
        if (!legendKeys.includes(g)) legendKeys.push(g);
        if (ctx.hidden.has(g)) continue;
        c = ctx.categorical(g);
      }
      const a = axis.angleOf(String(acol.values[i]));
      const [x, y] = f.at(a, Math.max(0, rad(rs[i])));
      dots.push({ x, y, d: diameter(i), row: i, c: ctx.paint(c, i), a });
    }
    drawGrid(ctx, f, {
      rings: thinRings(R.rings, f.px).map((v) => ({ r: rad(v), text: ctx.format(v, rf) })),
      ticks: axis.ticks, inner: 0, size, lines, labels, names: style.labels !== false,
      ray: quietRay(axis.ticks.map((t) => t.a), dots.map((p) => p.a)),
    });
    // Large dots first: a small one is never hidden under a large one.
    dots.sort((p, q) => q.d - p.d);
    const out: number[] = [];
    const s = ctx.surface;
    for (const p of dots) out.push(p.x, p.y, p.d, SHAPES.circle, p.c[0], p.c[1], p.c[2], p.c[3] * style.opacity, s[0], s[1], s[2], 0.9, 0.75);
    const data = new Float32Array(out);
    const b = ctx.renderer.createBatch('point');
    b.update(data, dots.length);
    const value = (field: string, row: number) => {
      const col = table.column(field);
      return col.type === 'string' ? String(col.values[row]) : ctx.format(col.values[row] as number, field);
    };
    return {
      draws: [{ batch: batch(ctx, 'line', lines) }, { batch: b, data, keys: dots.map((p) => (kf ? String(table.column(kf).values[p.row]) : String(p.row))), enter: 'fade' }],
      hit: emptyHit(),
      labels,
      legend: legendKeys.map((key) => ({ key, color: ctx.categorical(key) })),
      pick(tx, ty): ShapeHit | null {
        // Smallest first: `dots` is sorted large to small, and the last match under the pointer wins.
        let best: (typeof dots)[number] | undefined;
        for (const p of dots) if (Math.hypot((p.x - tx) / ctx.pixel[0], (p.y - ty) / ctx.pixel[1]) <= p.d / 2 + 3) best = p;
        if (!best) return null;
        const rows = [af, rf, zf, cf].filter((x, i, a): x is string => !!x && a.indexOf(x) === i).map((x) => ({ label: fieldLabel(ctx, x), value: value(x, best!.row) }));
        const title = kf ? value(kf, best.row) : cf && !numericColor ? value(cf, best.row) : fieldLabel(ctx, rf);
        return { title, rows };
      },
    };
  },
};

// -------------------------------------------------------------- radial area

/**
 * `radialArea`: the series of `color` stacked outwards around the circle, `x`
 * the angle (as on `polarLine`), `y` the measure. `layer.stack`: `'center'`
 * balances the stack around a middle ring (radial stream), `'normalize'` fills
 * the ring to 100 %.
 */
export const radialArea: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: polarScales(1.3, 1.19),
  build(ctx) {
    const { layer } = ctx.data;
    const { style } = ctx;
    const af = layer.encode.angle ?? need(layer, 'x', 'radialArea');
    const vf = layer.encode.value ?? need(layer, 'y', 'radialArea');
    const sf = layer.encode.color;
    const mode = layer.stack === 'center' ? 'center' : layer.stack === 'normalize' ? 'normalize' : 'zero';
    const f = frameOf(ctx);
    const size = f.px < 110 ? 10 : 11;
    const axis = angleAxis(ctx, f, af, size);
    const all = matrix(ctx, af, vf, sf, axis.keys);
    const name = (s: string) => (sf ? s : fieldLabel(ctx, vf));
    const shown = all.filter((s) => !(sf && ctx.hidden.has(s.name)));
    const n = axis.keys.length;
    const val = (s: (typeof all)[number], k: number) => (Number.isFinite(s.values[k]) ? Math.max(0, s.values[k]) : 0);
    const sums = Float64Array.from({ length: n }, (_, k) => shown.reduce((a, s) => a + val(s, k), 0));
    const top = Math.max(1e-9, ...sums);
    const inner = Math.min(0.8, Math.max(0, mode === 'center' ? Math.max(style.innerRadius, 0.12) : style.innerRadius));
    const levels = Math.max(1, Math.round(style.levels));
    const R = mode === 'zero' ? radialAxis(0, top, levels) : { lo: 0, hi: mode === 'normalize' ? 1 : top, rings: [] as number[] };
    const rad = (v: number) => inner + (1 - inner) * (v / R.hi);
    /** Where the stack starts at angle key k, and how much a value is worth there. */
    const base = (k: number) => (mode === 'center' ? (top - sums[k]) / 2 : 0);
    const gain = (k: number) => (mode === 'normalize' ? (sums[k] > 0 ? 1 / sums[k] : 0) : 1);

    const lines: number[] = [];
    const mesh: number[] = [];
    const edges: number[] = [];
    const labels: MarkLabel[] = [];
    const rings: { r: number; text?: string }[] =
      mode === 'zero'
        ? thinRings(R.rings, f.px).map((v) => ({ r: rad(v), text: ctx.format(v, vf) }))
        : mode === 'normalize'
          ? thinRings(Array.from({ length: levels }, (_, l) => (l + 1) / levels), f.px).map((v) => ({ r: rad(v), text: `${Math.round(v * 100)} %` }))
          : [{ r: 1 }];
    drawGrid(ctx, f, { rings, ticks: axis.ticks, inner, size, lines, labels, names: style.labels !== false, pill: true });
    // The same grid again over the bands, faintly, in the surface color: the rings stay readable through the fills.
    const over: number[] = [];
    if (mode !== 'center') drawGrid(ctx, f, { rings, ticks: axis.ticks, inner, size, lines: over, labels: [], names: false });
    const veil = withAlpha(ctx.surface, 0.28);
    for (let k = 0; k < over.length; k += LAYOUTS.line.stride) over.splice(k + 4, 4, veil[0], veil[1], veil[2], veil[3]);

    const angles = axis.keys.map((k) => axis.angleOf(k));
    const closed = axis.cyclic;
    const cum = new Float64Array(n);
    for (let k = 0; k < n; k++) cum[k] = base(k);
    /** Radii of the stack boundaries at each key, innermost first: bands[j] to bands[j + 1] is series j. */
    const bounds: Float64Array[] = [Float64Array.from(cum, (v) => rad(v))];
    let lower = polarPath(angles, bounds[0], { closed, smooth: !!style.smooth });
    const X = (v: number) => ctx.x.norm(v);
    const Y = (v: number) => ctx.y.norm(v);
    const rim = (p: { x: number[]; y: number[] }, color: RGBA) => {
      if (!(style.width > 0)) return;
      for (let k = 0; k + 1 < p.x.length; k++) pushSegment(edges, X(p.x[k]), Y(p.y[k]), X(p.x[k + 1]), Y(p.y[k + 1]), color, style.width);
    };
    shown.forEach((s, j) => {
      for (let k = 0; k < n; k++) cum[k] += val(s, k) * gain(k);
      const r = Float64Array.from(cum, (v) => rad(v));
      bounds.push(r);
      const upper = polarPath(angles, r, { closed, smooth: !!style.smooth });
      const color = ctx.paint(ctx.categorical(name(s.name)), s.row < 0 ? undefined : s.row);
      const fill = withAlpha(color, style.opacity);
      for (let k = 0; k + 1 < upper.x.length; k++) {
        pushVertex(mesh, X(lower.x[k]), Y(lower.y[k]), fill);
        pushVertex(mesh, X(upper.x[k]), Y(upper.y[k]), fill);
        pushVertex(mesh, X(upper.x[k + 1]), Y(upper.y[k + 1]), fill);
        pushVertex(mesh, X(lower.x[k]), Y(lower.y[k]), fill);
        pushVertex(mesh, X(upper.x[k + 1]), Y(upper.y[k + 1]), fill);
        pushVertex(mesh, X(lower.x[k + 1]), Y(lower.y[k + 1]), fill);
      }
      // A separator in the surface color between two bands; the stack's own two edges in their band's color (a clean antialiased rim).
      if (j === 0 && (mode === 'center' || inner > 0)) rim(lower, color);
      rim(upper, j === shown.length - 1 ? color : ctx.surface);
      lower = upper;
    });
    const draws: MarkDraw[] = [{ batch: batch(ctx, 'line', lines) }];
    if (mesh.length) draws.push({ batch: batch(ctx, 'mesh', mesh) });
    if (over.length && mesh.length) draws.push({ batch: batch(ctx, 'line', over), enter: 'fade' });
    if (edges.length) draws.push({ batch: batch(ctx, 'line', edges) });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend: sf ? all.map((s) => ({ key: s.name, color: ctx.categorical(s.name) })) : [],
      pick(tx, ty): ShapeHit | null {
        if (n === 0) return null;
        const { a, r } = f.polar(tx, ty);
        // The two keys around this angle, and how far between them.
        let i0 = n - 1;
        for (let k = 0; k < n; k++) if (angles[k] <= a) i0 = k;
        if (a < angles[0]) i0 = n - 1;
        const i1 = (i0 + 1) % n;
        const a0 = angles[i0] > a ? angles[i0] - TAU : angles[i0];
        const a1 = angles[i1] <= a0 ? angles[i1] + TAU : angles[i1];
        if (!closed && (a < angles[0] || a > angles[n - 1])) return null;
        const t = a1 > a0 ? Math.min(1, Math.max(0, (a - a0) / (a1 - a0))) : 0;
        const at = (b: Float64Array) => b[i0] + (b[i1] - b[i0]) * t;
        const j = shown.findIndex((_, s) => r >= at(bounds[s]) && r <= at(bounds[s + 1]));
        if (j < 0) return null;
        const k = t < 0.5 ? i0 : i1;
        const v = val(shown[j], k);
        const rows = [{ label: fieldLabel(ctx, vf), value: ctx.format(v, vf) }];
        if (sums[k] > 0 && shown.length > 1) rows.push({ label: ctx.theme.texts.share, value: `${Math.round((v / sums[k]) * 100)} %` });
        return { title: sf ? `${shown[j].name} · ${axis.label(axis.keys[k])}` : axis.label(axis.keys[k]), rows };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const POLAR_MARKS: Record<string, MarkDefinition> = { spiral, polarLine, polarScatter, radialArea };
