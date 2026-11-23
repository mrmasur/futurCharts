/**
 * Time series for BI: difference chart, fan chart, cycle plot and sparkline table.
 * `difference` and `fan` are cartesian (the chart's x / y, axes and zoom); `cycle` and
 * `sparktable` bring their own layout. Everything is drawn with the shared primitives.
 */
import type { Table } from '../data/table';
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { BandScale, LinearScale, niceDomain } from '../scale/scales';
import type { FieldSpec, LayerSpec } from '../spec/types';
import { mix, parseColor, withAlpha } from '../util/color';
import { need } from './charts';
import { curvePoints, type Polyline } from './curve';
import type { SeriesData } from './prepare';
import { dashed, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type BuiltMark, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { bumpArea } from './seriesBump';

const DAY = 86400000;

function batchOf(ctx: BuildContext, kind: 'rect' | 'line' | 'mesh' | 'point', data: number[]) {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

const labelOf = (fields: Record<string, FieldSpec>, f: string) => fields[f]?.label ?? f;
const auto = (v: string | undefined, fallback: string) => parseColor(!v || v === 'auto' ? fallback : v);
const percent = (v: number, digits = 1) =>
  new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');

/** Runs of consecutive points with no missing value between them: `[start, end)`. */
function runsOf(s: SeriesData): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let j = 1; j <= s.x.length; j++) {
    if (j === s.x.length || s.breaks?.[j]) {
      out.push([start, j]);
      start = j;
    }
  }
  return out;
}

/** Append a polyline (category / value space) as segments, dashed if asked. */
function polyline(ctx: BuildContext, out: number[], line: Polyline, color: RGBA, width: number, dash?: number[]): void {
  const pen = dash?.length ? dashed(out, dash, ctx.pixel, color, width) : undefined;
  for (let i = 0; i < line.x.length - 1; i++) {
    const [ax, ay] = ctx.pos(line.x[i], line.y[i]);
    const [bx, by] = ctx.pos(line.x[i + 1], line.y[i + 1]);
    if (pen) pen.segment(ax, ay, bx, by);
    else pushSegment(out, ax, ay, bx, by, color, width);
  }
}

// --------------------------------------------------------------- difference

export interface DifferencePiece {
  /** 1: the first series is above the second over this piece, -1: below. */
  sign: 1 | -1;
  /** Triangles as flat x, y pairs. */
  tri: number[];
}

/**
 * The area between two series over one segment, cut where they cross: each piece
 * lies entirely on one side, so it takes one color (no two-tone triangle).
 */
export function splitSegment(x0: number, a0: number, b0: number, x1: number, a1: number, b1: number): { pieces: DifferencePiece[]; crossing?: [number, number] } {
  const d0 = a0 - b0;
  const d1 = a1 - b1;
  if (d0 === 0 && d1 === 0) return { pieces: [] };
  if (d0 * d1 >= 0) {
    return { pieces: [{ sign: d0 + d1 > 0 ? 1 : -1, tri: [x0, a0, x1, a1, x1, b1, x0, a0, x1, b1, x0, b0] }] };
  }
  const t = d0 / (d0 - d1);
  const xc = x0 + (x1 - x0) * t;
  const yc = a0 + (a1 - a0) * t;
  return {
    pieces: [
      { sign: d0 > 0 ? 1 : -1, tri: [x0, a0, xc, yc, x0, b0] },
      { sign: d1 > 0 ? 1 : -1, tri: [xc, yc, x1, a1, x1, b1] },
    ],
    crossing: [xc, yc],
  };
}

/** The whole area between two polylines sharing their x: triangles above, triangles below, and the crossings. */
export function differenceAreas(x: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): { above: number[]; below: number[]; crossings: [number, number][] } {
  const above: number[] = [];
  const below: number[] = [];
  const crossings: [number, number][] = [];
  for (let i = 0; i < x.length - 1; i++) {
    const { pieces, crossing } = splitSegment(x[i], a[i], b[i], x[i + 1], a[i + 1], b[i + 1]);
    for (const p of pieces) (p.sign > 0 ? above : below).push(...p.tri);
    if (crossing) crossings.push(crossing);
  }
  return { above, below, crossings };
}

/**
 * `difference`: two series over the same x (`y` against `y2`: actual and budget, this
 * year and the last), the area between them colored by which one is on top.
 */
export const difference: MarkDefinition = {
  symbol: 'line',
  // The reference line is dashed in px.
  sizeDependent: (layer) => (layer.style as { referenceDash?: number[] } | undefined)?.referenceDash?.length !== 0,
  build(ctx) {
    const { style, theme, data } = ctx;
    const enc = data.layer.encode;
    const f1 = (ctx.horizontal ? enc.x : enc.y)!;
    const f2 = ctx.horizontal ? enc.x2 : enc.y2;
    if (!data.ranged || !f2) throw new Error('futurCharts: mark "difference" needs the second series in encode.y2.');
    const refName = labelOf(ctx.fields, f2);
    const refColor = auto(style.referenceColor, theme.text.muted);
    const positive = auto(style.positive, theme.marks.kpi.good);
    const negative = auto(style.negative, theme.marks.kpi.bad);
    // Legend entries are listed in color-slot order: taking a slot is what lists them.
    const legend: { key: string; color: RGBA }[] = [];
    const entry = (key: string, color: RGBA) => {
      if (!key) return;
      ctx.categorical(key);
      legend.push({ key, color });
    };
    entry(refName, refColor);
    entry(style.positiveLabel, mix(ctx.surface, positive, 0.25 + 0.75 * style.opacity));
    entry(style.negativeLabel, mix(ctx.surface, negative, 0.25 + 0.75 * style.opacity));

    const mesh: number[] = [];
    const lines: number[] = [];
    const shown: { s: SeriesData; x: Float32Array }[] = [];
    for (const s of data.series) {
      if (s.hidden || s.x.length === 0) continue;
      const n = s.x.length;
      const x = new Float32Array(n);
      const a = new Float32Array(n);
      const b = new Float32Array(n);
      // On a reversed axis, "above" in data is "below" in scale space.
      let dir = 1;
      for (let i = 0; i < n; i++) {
        x[i] = ctx.x.norm(s.x[i]);
        a[i] = ctx.y.norm(s.y1[i]);
        b[i] = ctx.y.norm(s.y0[i]);
        if (dir === 1 && (a[i] - b[i]) * (s.y1[i] - s.y0[i]) < 0) dir = -1;
      }
      shown.push({ s, x });
      const color = ctx.color(s, 0);
      const own = data.layer.series?.[s.key];
      for (const [r0, r1] of runsOf(s)) {
        const len = r1 - r0;
        if (len < 2) {
          const [px, py] = ctx.pos(x[r0], a[r0]);
          pushSegment(lines, px, py, px, py, color, Math.max(style.width, 4));
          continue;
        }
        const ca = curvePoints(x.subarray(r0, r1), a.subarray(r0, r1), style.curve);
        const cb = curvePoints(x.subarray(r0, r1), b.subarray(r0, r1), style.curve);
        // Curve samples per datum, to give each piece the row it comes from (overrides, highlight).
        const per = (ca.x.length - 1) / (len - 1);
        for (let k = 0; k < ca.x.length - 1; k++) {
          const row = s.rows[r0 + Math.min(len - 1, Math.floor(k / per))];
          for (const piece of splitSegment(ca.x[k], ca.y[k], cb.y[k], ca.x[k + 1], ca.y[k + 1], cb.y[k + 1]).pieces) {
            const fill = ctx.paint(withAlpha(piece.sign * dir > 0 ? positive : negative, style.opacity), row);
            for (let j = 0; j < piece.tri.length; j += 2) {
              const [px, py] = ctx.pos(piece.tri[j], piece.tri[j + 1]);
              pushVertex(mesh, px, py, fill);
            }
          }
        }
        if (!ctx.hidden.has(refName)) polyline(ctx, lines, cb, refColor, style.referenceWidth, style.referenceDash);
        polyline(ctx, lines, ca, color, own?.width ?? style.width, own?.dash);
      }
    }
    const draws: BuiltMark['draws'] = [{ batch: batchOf(ctx, 'mesh', mesh) }, { batch: batchOf(ctx, 'line', lines) }];
    return {
      draws,
      hit: emptyHit(),
      legend,
      pick(tx, ty): ShapeHit | null {
        const c = ctx.horizontal ? ty : tx;
        let best: { s: SeriesData; i: number } | undefined;
        let bd = Infinity;
        for (const { s, x } of shown) {
          for (let i = 0; i < x.length; i++) {
            const d = Math.abs(x[i] - c);
            if (d < bd) [bd, best] = [d, { s, i }];
          }
        }
        if (!best) return null;
        const { s, i } = best;
        const gap = s.y1[i] - s.y0[i];
        const rel = s.y0[i] !== 0 ? ` (${sign(gap)}${percent(Math.abs(gap / s.y0[i]))})` : '';
        return {
          title: ctx.x.format(s.x[i]),
          rows: [
            { label: s.key, value: ctx.format(s.y1[i], f1) },
            { label: refName, value: ctx.format(s.y0[i], f2) },
            { label: 'Écart', value: `${sign(gap)}${ctx.format(Math.abs(gap), f1)}${rel}` },
          ],
        };
      },
    };
  },
};

// ---------------------------------------------------------------------- fan

/** Quantile `p` (0–1) of sorted values, linearly interpolated between neighbours. */
export function quantile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const i = Math.floor(h);
  return i + 1 < n ? sorted[i] + (sorted[i + 1] - sorted[i]) * (h - i) : sorted[i];
}

/** A quantile level from what a forecast table holds: 0.1, 10, "p10", "90 %", "median". NaN when it is none. */
export function parseLevel(v: unknown): number {
  if (typeof v === 'number') return v > 1 ? v / 100 : v < 0 ? NaN : v;
  if (typeof v !== 'string') return NaN;
  if (/^m[ée]dian/i.test(v.trim())) return 0.5;
  const m = /(\d+(?:[.,]\d+)?)/.exec(v);
  if (!m) return NaN;
  const n = Number(m[1].replace(',', '.'));
  return n > 1 ? n / 100 : n;
}

/** Nested intervals from quantile levels, widest first: [0.1, 0.25, 0.5, 0.75, 0.9] gives [0.1, 0.9] then [0.25, 0.75]. */
export function fanBands(levels: number[]): [number, number][] {
  const l = [...new Set(levels.filter((v) => v >= 0 && v <= 1 && Math.abs(v - 0.5) > 1e-9).map((v) => Math.round(v * 1e6) / 1e6))].sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0, j = l.length - 1; i < j; i++, j--) out.push([l[i], l[j]]);
  return out;
}

interface FanStep {
  x: number;
  row: number;
  /** The actual value, or the median of a forecast. */
  value: number;
  lo: number[];
  hi: number[];
  /** A copy of the last actual point, where the fan starts from zero width. */
  anchor?: boolean;
}

const bandName = ([lo, hi]: [number, number]) => `Intervalle ${Math.round((hi - lo) * 100)} %`;

/**
 * `fan`: a forecast as nested quantile bands around its median, after the history
 * in a solid line. Quantiles come ready (`encode.key`: the level of each row) or are
 * computed from several `y` per `x` (simulated paths, `style.quantiles`).
 */
export const fan: MarkDefinition = {
  symbol: 'line',
  // The median is dashed in px.
  sizeDependent: (layer) => (layer.style as { medianDash?: number[] } | undefined)?.medianDash?.length !== 0,
  build(ctx) {
    const { style, data } = ctx;
    const vf = (ctx.horizontal ? data.layer.encode.x : data.layer.encode.y)!;
    const kf = data.layer.encode.key;
    const keyCol = kf ? data.table.column(kf).values : undefined;
    const id = (level: number) => Math.round(level * 1e6);

    // The bands are the same along the whole forecast: from the levels found (or asked for).
    const levels: number[] = [];
    if (keyCol) {
      for (const s of data.series) for (const r of s.rows) levels.push(parseLevel(keyCol[r]));
    } else levels.push(...(style.quantiles as number[]).map(parseLevel));
    let bands = fanBands(levels.filter((v) => !Number.isNaN(v)));

    const all = data.series.filter((s) => !s.hidden && s.x.length > 0).map((s) => {
      const groups = new Map<number, number[]>();
      for (let i = 0; i < s.x.length; i++) {
        const g = groups.get(s.x[i]);
        if (g) g.push(i);
        else groups.set(s.x[i], [i]);
      }
      const history: FanStep[] = [];
      const forecast: FanStep[] = [];
      for (const [x, g] of groups) {
        let q: (level: number) => number;
        if (keyCol) {
          const at = new Map<number, number>();
          for (const i of g) {
            const level = parseLevel(keyCol[s.rows[i]]);
            if (Number.isNaN(level)) history.push({ x, row: s.rows[i], value: s.value[i], lo: [], hi: [] });
            else at.set(id(level), s.value[i]);
          }
          if (!at.size) continue;
          q = (level) => at.get(id(level)) ?? NaN;
        } else {
          if (g.length < 2) {
            history.push({ x, row: s.rows[g[0]], value: s.value[g[0]], lo: [], hi: [] });
            continue;
          }
          const sorted = g.map((i) => s.value[i]).sort((p, r) => p - r);
          q = (level) => quantile(sorted, level);
        }
        const lo = bands.map((b) => q(b[0]));
        const hi = bands.map((b) => q(b[1]));
        // Without a median row, the middle of the narrowest interval stands for it.
        let median = q(0.5);
        if (Number.isNaN(median) && bands.length) median = (lo[bands.length - 1] + hi[bands.length - 1]) / 2;
        forecast.push({ x, row: s.rows[g[0]], value: median, lo, hi });
      }
      const order = (p: FanStep, r: FanStep) => p.x - r.x;
      return { s, history: history.sort(order), forecast: forecast.sort(order) };
    });

    // A band with a hole somewhere is left out rather than drawn in pieces.
    const complete = bands.map((_, k) => all.every((d) => d.forecast.every((f) => Number.isFinite(f.lo[k]) && Number.isFinite(f.hi[k]))));
    for (const d of all) {
      for (const f of d.forecast) {
        f.lo = f.lo.filter((_, k) => complete[k]);
        f.hi = f.hi.filter((_, k) => complete[k]);
      }
    }
    bands = bands.filter((_, k) => complete[k]);
    const B = bands.length;
    const names = bands.map(bandName);
    const alpha = (k: number) => (style.opacity * (k + 1)) / B;

    const mesh: number[] = [];
    const lines: number[] = [];
    const dots: number[] = [];
    const first = all[0] ? ctx.color(all[0].s, 0) : parseColor(ctx.theme.palette.categorical[0]);
    const legend = names.map((key, k) => {
      ctx.categorical(key);
      return { key, color: mix(ctx.surface, first, alpha(k)) };
    });

    for (const d of all) {
      const base = ctx.color(d.s, 0);
      const own = data.layer.series?.[d.s.key];
      const curve = (steps: FanStep[], y: (f: FanStep) => number) =>
        curvePoints(steps.map((f) => ctx.x.norm(f.x)), steps.map((f) => ctx.y.norm(y(f))), style.curve);
      const last = d.history[d.history.length - 1];
      const steps = [...d.forecast];
      if (style.anchor && last && steps.length && last.x < steps[0].x) {
        steps.unshift({ ...last, lo: bands.map(() => last.value), hi: bands.map(() => last.value), anchor: true });
      }
      if (steps.length > 1) {
        const between = (p: Polyline, q: Polyline, c: RGBA) => {
          for (let i = 0; i < p.x.length - 1; i++) {
            const quad = [p.x[i], p.y[i], p.x[i + 1], p.y[i + 1], q.x[i + 1], q.y[i + 1], p.x[i], p.y[i], q.x[i + 1], q.y[i + 1], q.x[i], q.y[i]];
            for (let j = 0; j < 12; j += 2) {
              const [px, py] = ctx.pos(quad[j], quad[j + 1]);
              pushVertex(mesh, px, py, c);
            }
          }
        };
        const lo = bands.map((_, k) => curve(steps, (f) => f.lo[k]));
        const hi = bands.map((_, k) => curve(steps, (f) => f.hi[k]));
        // Rings rather than overlapping layers: each one has exactly the opacity of its interval.
        for (let k = 0; k < B; k++) {
          if (ctx.hidden.has(names[k])) continue;
          const c = ctx.paint(withAlpha(base, alpha(k)), steps[steps.length - 1].row);
          if (k < B - 1) {
            between(lo[k], lo[k + 1], c);
            between(hi[k + 1], hi[k], c);
          } else between(lo[k], hi[k], c);
        }
      }
      if (d.history.length > 1) polyline(ctx, lines, curve(d.history, (f) => f.value), base, own?.width ?? style.width);
      if (steps.length > 1 && steps.every((f) => Number.isFinite(f.value))) {
        polyline(ctx, lines, curve(steps, (f) => f.value), base, style.medianWidth, style.medianDash);
      }
      // Where the history hands over to the forecast.
      if (last && steps.length) {
        const [px, py] = ctx.pos(ctx.x.norm(last.x), ctx.y.norm(last.value));
        const s = ctx.surface;
        dots.push(px, py, Math.max(7, style.width * 3.5), 0, base[0], base[1], base[2], base[3], s[0], s[1], s[2], 1, 2);
      }
    }

    const draws: BuiltMark['draws'] = [{ batch: batchOf(ctx, 'mesh', mesh), enter: 'fade' }, { batch: batchOf(ctx, 'line', lines) }];
    if (dots.length) draws.push({ batch: batchOf(ctx, 'point', dots) });
    return {
      draws,
      hit: emptyHit(),
      legend,
      pick(tx, ty): ShapeHit | null {
        const c = ctx.horizontal ? ty : tx;
        const v = ctx.horizontal ? tx : ty;
        let best: { s: SeriesData; f: FanStep; forecast: boolean } | undefined;
        let bd = Infinity;
        for (const d of all) {
          for (const [list, forecast] of [[d.history, false], [d.forecast, true]] as const) {
            for (const f of list) {
              // Closest date first; between several series, the closest value.
              const dist = Math.abs(ctx.x.norm(f.x) - c) + Math.abs(ctx.y.norm(f.value) - v) * 1e-3;
              if (dist < bd) [bd, best] = [dist, { s: d.s, f, forecast }];
            }
          }
        }
        if (!best) return null;
        const { s, f, forecast } = best;
        const title = all.length > 1 ? `${s.key} · ${ctx.x.format(f.x)}` : ctx.x.format(f.x);
        if (!forecast) return { title, rows: [{ label: s.key, value: ctx.format(f.value, vf) }] };
        return {
          title,
          rows: [
            { label: 'Médiane', value: ctx.format(f.value, vf) },
            ...bands.map((_, k) => ({ label: names[k], value: `${ctx.format(f.lo[k], vf)} – ${ctx.format(f.hi[k], vf)}` })).reverse(),
          ],
        };
      },
    };
  },
};

// -------------------------------------------------------------------- cycle

export type CyclePeriod = 'month' | 'quarter' | 'weekday' | 'hour';

/** Which panel a date falls in (`index`) and where it sits in that panel (`order`: year, week or day number). */
export function cyclePart(ms: number, period: CyclePeriod): { index: number; order: number } {
  const d = new Date(ms);
  const day = Math.floor(ms / DAY);
  if (period === 'quarter') return { index: Math.floor(d.getUTCMonth() / 3), order: d.getUTCFullYear() };
  // Weeks start on Monday; 1970-01-01 was a Thursday.
  if (period === 'weekday') return { index: (d.getUTCDay() + 6) % 7, order: Math.floor((day + 3) / 7) };
  if (period === 'hour') return { index: d.getUTCHours(), order: day };
  return { index: d.getUTCMonth(), order: d.getUTCFullYear() };
}

export interface CyclePoint {
  order: number;
  /** Position across the panel, 0–1: the same `order` is at the same place in every panel. */
  t: number;
  value: number;
  /** First source row. */
  row: number;
}

export interface CycleLine {
  key: string;
  points: CyclePoint[];
  mean: number;
}

export interface CyclePanel {
  index: number;
  lines: CycleLine[];
}

/**
 * Sub-series of a cycle plot: one panel per period, and in each panel one line per
 * series through its values in `order`, with their mean. Rows of the same period,
 * order and series are summed (or averaged).
 */
export function cyclePanels(
  rows: { period: number; order: number; value: number; series?: string; row?: number }[],
  aggregate: 'sum' | 'mean' = 'sum',
): { panels: CyclePanel[]; orders: number[]; series: string[]; lo: number; hi: number } {
  const cells = new Map<string, { period: number; order: number; series: string; sum: number; n: number; row: number }>();
  const series: string[] = [];
  rows.forEach((r, i) => {
    if (!Number.isFinite(r.value) || !Number.isFinite(r.period) || !Number.isFinite(r.order)) return;
    const key = r.series ?? '';
    if (!series.includes(key)) series.push(key);
    const id = `${r.period}\u0000${r.order}\u0000${key}`;
    const c = cells.get(id);
    if (c) {
      c.sum += r.value;
      c.n++;
    } else cells.set(id, { period: r.period, order: r.order, series: key, sum: r.value, n: 1, row: r.row ?? i });
  });
  const orders = [...new Set([...cells.values()].map((c) => c.order))].sort((a, b) => a - b);
  const rank = new Map(orders.map((o, i) => [o, i]));
  const byPeriod = new Map<number, Map<string, CyclePoint[]>>();
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of cells.values()) {
    const value = aggregate === 'mean' ? c.sum / c.n : c.sum;
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
    let p = byPeriod.get(c.period);
    if (!p) byPeriod.set(c.period, (p = new Map()));
    let l = p.get(c.series);
    if (!l) p.set(c.series, (l = []));
    l.push({ order: c.order, t: orders.length > 1 ? rank.get(c.order)! / (orders.length - 1) : 0.5, value, row: c.row });
  }
  const panels = [...byPeriod.keys()].sort((a, b) => a - b).map((index) => ({
    index,
    lines: series.filter((k) => byPeriod.get(index)!.has(k)).map((key) => {
      const points = byPeriod.get(index)!.get(key)!.sort((a, b) => a.order - b.order);
      return { key, points, mean: points.reduce((a, p) => a + p.value, 0) / points.length };
    }),
  }));
  return { panels, orders, series, lo, hi };
}

const dateLabel = (ms: number, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(ms);

/** Read a cycle plot's layer: its panels, and how to name periods and positions. */
function cycleModel(layer: LayerSpec, table: Table) {
  const xf = need(layer, 'x', 'cycle');
  const vf = layer.encode.y ?? need(layer, 'value', 'cycle');
  const xcol = table.column(xf);
  const vals = table.column(vf).values as Float64Array;
  const scol = layer.encode.color ? table.column(layer.encode.color).values : undefined;
  const style = (layer.style ?? {}) as { period?: CyclePeriod; aggregate?: 'sum' | 'mean' };
  const rows: { period: number; order: number; value: number; series?: string; row: number }[] = [];
  let periodLabel: (index: number, form: 'narrow' | 'short' | 'long') => string;
  let orderLabel: (order: number) => string;
  if (xcol.type === 'time') {
    const period = style.period ?? 'month';
    for (let i = 0; i < table.length; i++) {
      const p = cyclePart(xcol.values[i] as number, period);
      rows.push({ period: p.index, order: p.order, value: vals[i], series: scol ? String(scol[i]) : undefined, row: i });
    }
    periodLabel =
      period === 'month' ? (i, form) => dateLabel(Date.UTC(2021, i, 1), { month: form })
      // 2021-02-01 was a Monday.
      : period === 'weekday' ? (i, form) => dateLabel(Date.UTC(2021, 1, 1 + i), { weekday: form })
      : period === 'quarter' ? (i) => `T${i + 1}`
      : (i, form) => (form === 'narrow' ? String(i) : `${i} h`);
    orderLabel =
      period === 'weekday' ? (o) => `semaine du ${dateLabel((o * 7 - 3) * DAY, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : period === 'hour' ? (o) => dateLabel(o * DAY, { day: 'numeric', month: 'short', year: 'numeric' })
      : (o) => String(o);
  } else {
    // Periods given as categories: `key` says where each value sits in its panel (the year).
    const of = need(layer, 'key', 'cycle');
    const ocol = table.column(of);
    const periods: string[] = [];
    const orders: string[] = [];
    const indexIn = (list: string[], v: string) => {
      const i = list.indexOf(v);
      return i >= 0 ? i : list.push(v) - 1;
    };
    for (let i = 0; i < table.length; i++) {
      const order = ocol.type === 'string' ? indexIn(orders, String(ocol.values[i])) : (ocol.values[i] as number);
      rows.push({ period: indexIn(periods, String(xcol.values[i])), order, value: vals[i], series: scol ? String(scol[i]) : undefined, row: i });
    }
    periodLabel = (i, form) => (form === 'narrow' ? (periods[i] ?? '').slice(0, 1).toUpperCase() : (periods[i] ?? ''));
    orderLabel = ocol.type === 'string' ? (o) => orders[o] ?? '' : ocol.type === 'time' ? (o) => dateLabel(o, { day: 'numeric', month: 'short', year: 'numeric' }) : (o) => String(o);
  }
  return { ...cyclePanels(rows, style.aggregate ?? 'sum'), periodLabel, orderLabel, vf };
}

/**
 * `cycle`: a cycle plot. One small panel per period (month, weekday…) side by side on
 * one value axis; in each, the values of that period year after year, and their mean
 * as a horizontal line. Seasonality reads across the means, the trend inside each panel.
 */
export const cycle: MarkDefinition = {
  standalone: true,
  // Period names shorten and dots shrink with the panels.
  sizeDependent: true,
  symbol: 'line',
  scales({ layer, table, fields, size }) {
    const m = cycleModel(layer, table);
    const zero = (layer.style as { zero?: boolean } | undefined)?.zero;
    let [lo, hi] = m.lo <= m.hi ? [m.lo, m.hi] : [0, 1];
    if (zero) [lo, hi] = [Math.min(0, lo), Math.max(0, hi)];
    [lo, hi] = niceDomain(lo, hi, 5);
    // Short names when they fit a panel, their initial otherwise.
    const slot = (size ? Math.max(120, size.width - 70) : 800) / Math.max(1, m.panels.length);
    const longest = Math.max(0, ...m.panels.map((p) => textWidth(m.periodLabel(p.index, 'short'), '11px sans-serif')));
    const form = longest + 6 > slot ? 'narrow' : 'short';
    return {
      x: new BandScale(m.panels.map((p) => m.periodLabel(p.index, form)), 0.14, 0.07),
      y: new LinearScale(lo, hi, fields[m.vf]?.format),
      axes: { x: true, y: true },
      grid: { y: true },
    };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const m = cycleModel(layer, table);
    const multi = !!layer.encode.color;
    const valueLabel = labelOf(ctx.fields, m.vf);
    const colorOf = (key: string) => (multi ? ctx.categorical(key) : layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(valueLabel));
    const legend = multi ? m.series.map((key) => ({ key, color: colorOf(key) })) : undefined;
    const band = ctx.x.band;
    const half = (band / 2) * (1 - Math.max(0, Math.min(0.9, style.inset)));
    const card = withAlpha(parseColor(theme.text.muted), 0.07);
    const rects: number[] = [];
    const lines: number[] = [];
    const dots: number[] = [];
    const s = ctx.surface;
    // Narrow panels (a phone): thinner lines and smaller dots, or the panel is all ink.
    const tight = Math.max(0.6, Math.min(1, band / ctx.pixel[0] / 40));
    const width = style.width * tight;
    const at = (pi: number, p: CyclePoint): [number, number] => [ctx.x.norm(pi) - half + 2 * half * p.t, ctx.y.norm(p.value)];
    m.panels.forEach((panel, pi) => {
      const cx = ctx.x.norm(pi);
      if (style.panels) pushRect(rects, { x0: cx - band / 2, y0: 0, x1: cx + band / 2, y1: 1, fill: card, radii: [4, 4, 4, 4] });
      for (const line of panel.lines) {
        if (ctx.hidden.has(line.key)) continue;
        const color = ctx.paint(colorOf(line.key), line.points[0].row);
        const meanColor = multi ? withAlpha(color, color[3] * 0.6) : auto(style.meanColor, theme.text.primary);
        const my = ctx.y.norm(line.mean);
        if (style.mean) pushSegment(lines, cx - half, my, cx + half, my, meanColor, style.meanWidth * tight);
        for (let i = 0; i < line.points.length - 1; i++) {
          const [ax, ay] = at(pi, line.points[i]);
          const [bx, by] = at(pi, line.points[i + 1]);
          pushSegment(lines, ax, ay, bx, by, color, width);
        }
        // The latest value of each panel: where the period stands now.
        const [ex, ey] = at(pi, line.points[line.points.length - 1]);
        if (style.points) dots.push(ex, ey, Math.max(4.5, style.width * 3 * tight), 0, color[0], color[1], color[2], color[3], s[0], s[1], s[2], 1, 1.5);
      }
    });
    const draws: BuiltMark['draws'] = [];
    if (rects.length) draws.push({ batch: batchOf(ctx, 'rect', rects), enter: 'fade' });
    draws.push({ batch: batchOf(ctx, 'line', lines) });
    if (dots.length) draws.push({ batch: batchOf(ctx, 'point', dots) });
    return {
      draws,
      hit: emptyHit(),
      legend,
      pick(tx, ty): ShapeHit | null {
        const pi = ctx.x.invert(tx);
        const panel = m.panels[pi];
        if (!panel || Math.abs(tx - ctx.x.norm(pi)) > band / 2) return null;
        let best: { line: CycleLine; p: CyclePoint } | undefined;
        let bd = Infinity;
        for (const line of panel.lines) {
          if (ctx.hidden.has(line.key)) continue;
          for (const p of line.points) {
            const [px, py] = at(pi, p);
            const d = Math.abs(px - tx) + Math.abs(py - ty) * 1e-3 * band;
            if (d < bd) [bd, best] = [d, { line, p }];
          }
        }
        if (!best) return null;
        const { line, p } = best;
        const name = m.periodLabel(panel.index, 'long');
        const gap = p.value - line.mean;
        return {
          title: `${name} · ${m.orderLabel(p.order)}`,
          rows: [
            { label: multi ? line.key : valueLabel, value: ctx.format(p.value, m.vf) },
            { label: `Moyenne (${name})`, value: ctx.format(line.mean, m.vf) },
            { label: 'Écart à la moyenne', value: `${sign(gap)}${ctx.format(Math.abs(gap), m.vf)}` },
          ],
        };
      },
    };
  },
};

// --------------------------------------------------------------- sparktable

export type SparkColumn = 'value' | 'change' | 'spark' | 'bar';

/**
 * Columns of a sparkline table across `width` px: the name, then the columns asked
 * for, in order. Figures keep the width they need; the sparkline and the bar share
 * what is left. Too narrow, the table gives up the bar, then the change, then the sparkline.
 */
export function sparkColumns(
  width: number,
  needs: { name: number; value: number; change: number },
  show: SparkColumn[],
): { id: 'name' | SparkColumn; x0: number; x1: number }[] {
  let cols = [...new Set(show)];
  const min = (c: SparkColumn) => (c === 'value' ? needs.value : c === 'change' ? needs.change : c === 'spark' ? 56 : 48);
  const total = () => cols.reduce((a, c) => a + min(c), 0);
  const minName = Math.min(needs.name, Math.max(64, width * 0.3));
  for (const drop of ['bar', 'change', 'spark'] as const) {
    if (minName + total() <= width) break;
    cols = cols.filter((c) => c !== drop);
  }
  const w = new Map<SparkColumn, number>(cols.map((c) => [c, min(c)]));
  let name = Math.max(0, Math.min(needs.name, width - total()));
  let left = Math.max(0, width - name - total());
  // The flexible columns grow first (the sparkline faster), up to a size that still reads as "small".
  const grow: [SparkColumn, number, number][] = [['spark', 3, 260], ['bar', 2, 180]];
  const flexible = grow.filter(([c]) => w.has(c));
  const weights = flexible.reduce((a, [, k]) => a + k, 0);
  for (const [c, k, cap] of flexible) {
    const add = Math.min(cap - w.get(c)!, (left * k) / weights);
    if (add > 0) w.set(c, w.get(c)! + add);
  }
  left = Math.max(0, width - name - [...w.values()].reduce((a, v) => a + v, 0));
  // Whatever remains widens the name column: the figures stay aligned on the right edge.
  name += left;
  const out: { id: 'name' | SparkColumn; x0: number; x1: number }[] = [{ id: 'name', x0: 0, x1: name }];
  let x = name;
  for (const c of cols) {
    out.push({ id: c, x0: x, x1: x + w.get(c)! });
    x += w.get(c)!;
  }
  return out;
}

interface SparkRow {
  name: string;
  /** First source row. */
  row: number;
  x: (number | string)[];
  values: number[];
  last: number;
  /** Relative change of the last value (NaN when there is nothing to compare it with). */
  change: number;
}

/**
 * `sparktable`: one row per `key`: its name, latest `y`, change, a sparkline of the
 * whole series (along `x`) and a bar comparing the latest values between rows.
 */
export const sparktable: MarkDefinition = {
  standalone: true,
  // Laid out in px.
  sizeDependent: true,
  symbol: 'line',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'sparktable');
    const vf = layer.encode.y ?? need(layer, 'value', 'sparktable');
    const xf = layer.encode.x;
    const keys = table.column(kf).values;
    const vals = table.column(vf).values as Float64Array;
    const xcol = xf ? table.column(xf) : undefined;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < table.length; i++) {
      if (Number.isNaN(vals[i])) continue;
      const k = String(keys[i]);
      const g = groups.get(k);
      if (g) g.push(i);
      else groups.set(k, [i]);
    }
    let rows: SparkRow[] = [...groups].map(([name, idx]) => {
      if (xcol && xcol.type !== 'string') idx.sort((a, b) => (xcol.values[a] as number) - (xcol.values[b] as number));
      const values = idx.map((i) => vals[i]);
      const last = values[values.length - 1];
      const base = style.change === 'first' ? values[0] : values[values.length - 2];
      return {
        name,
        row: idx[0],
        x: idx.map((i, j) => (xcol ? xcol.values[i] : j + 1)),
        values,
        last,
        change: values.length > 1 && base !== 0 ? (last - base) / Math.abs(base) : NaN,
      };
    });
    if (style.sortBy === 'value') rows.sort((a, b) => b.last - a.last);
    else if (style.sortBy === 'change') rows.sort((a, b) => (Number.isNaN(b.change) ? -Infinity : b.change) - (Number.isNaN(a.change) ? -Infinity : a.change));

    // Layout in px, then scale space (y down from the top).
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (v: number) => v * px;
    const Y = (v: number) => 1 - v * py;
    const family = theme.font.family;
    const headH = style.headers ? 26 : 0;
    // Rows that would be squeezed under a readable height are left out (the first ones stay).
    rows = rows.slice(0, Math.max(1, Math.floor((H - headH) / 18)));
    const R = rows.length;
    const rowH = Math.min(style.rowHeight, (H - headH) / Math.max(1, R));
    const valueText = rows.map((r) => ctx.format(r.last, vf));
    const changeText = rows.map((r) => (Number.isNaN(r.change) ? '–' : `${r.change > 0 ? '▲' : r.change < 0 ? '▼' : '='} ${percent(Math.abs(r.change))}`));
    const valueLabel = labelOf(ctx.fields, vf);
    const headers: Record<'name' | SparkColumn, string> = {
      name: ctx.fields[kf]?.label ?? '',
      value: valueLabel,
      change: 'Variation',
      spark: 'Tendance',
      bar: 'Comparaison',
    };
    const widest = (texts: string[], font: string) => Math.max(0, ...texts.map((t) => textWidth(t, font)));
    const cols = sparkColumns(
      W,
      {
        name: widest(rows.map((r) => r.name), `600 12px ${family}`) + 22,
        value: Math.max(widest(valueText, `600 12px ${family}`), style.headers ? textWidth(headers.value, `600 11px ${family}`) : 0) + 18,
        change: Math.max(widest(changeText, `600 11px ${family}`), style.headers ? textWidth(headers.change, `600 11px ${family}`) : 0) + 18,
      },
      style.show as SparkColumn[],
    );

    const rects: number[] = [];
    const bars: number[] = [];
    const barKeys: string[] = [];
    const mesh: number[] = [];
    const lines: number[] = [];
    const rules: number[] = [];
    const labels: MarkLabel[] = [];
    const grid = parseColor(theme.grid.y.color);
    const ink = theme.text.primary;
    const accent = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(valueLabel);
    const good = auto(style.good, theme.marks.kpi.good);
    const bad = auto(style.bad, theme.marks.kpi.bad);
    const css = (c: RGBA) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
    const maxAbs = Math.max(1e-12, ...rows.map((r) => Math.abs(r.last)));
    let allLo = Infinity;
    let allHi = -Infinity;
    for (const r of rows) for (const v of r.values) [allLo, allHi] = [Math.min(allLo, v), Math.max(allHi, v)];

    if (style.headers) {
      for (const c of cols) {
        const right = c.id === 'value' || c.id === 'change';
        const centered = c.id === 'spark' || c.id === 'bar';
        labels.push({
          tx: X(right ? c.x1 - 9 : centered ? (c.x0 + c.x1) / 2 : c.x0 + 2), ty: Y(headH / 2), text: headers[c.id], color: theme.text.muted, size: 11, weight: 600,
          align: right ? 'right' : centered ? 'center' : 'left', baseline: 'middle', box: [X(c.x0 - 4), Y(headH + 2), X(c.x1 + 4), Y(-2)],
        });
      }
      pushSegment(rules, 0, Y(headH), 1, Y(headH), grid, 1);
    }
    // Where each sparkline point is, for the tooltip.
    const sparkAt: { x0: number; x1: number } | undefined = (() => {
      const c = cols.find((k) => k.id === 'spark');
      return c && { x0: c.x0 + 10, x1: c.x1 - 10 };
    })();
    rows.forEach((r, ri) => {
      const y0 = headH + ri * rowH;
      const ym = y0 + rowH / 2;
      if (ri > 0) pushSegment(rules, 0, Y(y0), 1, Y(y0), withAlpha(grid, grid[3] * 0.7), 1);
      const color = ctx.paint(accent, r.row);
      for (const c of cols) {
        if (c.id === 'name') {
          labels.push({ tx: X(c.x0 + 2), ty: Y(ym), text: r.name, color: ink, size: 12, weight: 600, align: 'left', baseline: 'middle', box: [X(c.x0 - 4), Y(y0 + rowH + 2), X(c.x1), Y(y0 - 2)] });
        } else if (c.id === 'value') {
          labels.push({ tx: X(c.x1 - 9), ty: Y(ym), text: valueText[ri], color: ink, size: 12, weight: 600, align: 'right', baseline: 'middle' });
        } else if (c.id === 'change') {
          const tone = Number.isNaN(r.change) || r.change === 0 ? theme.text.muted : css(r.change > 0 === style.upIsGood ? good : bad);
          labels.push({ tx: X(c.x1 - 9), ty: Y(ym), text: changeText[ri], color: tone, size: 11, weight: 600, align: 'right', baseline: 'middle' });
        } else if (c.id === 'spark' && r.values.length > 1) {
          const n = r.values.length;
          const lo = style.sharedScale ? allLo : Math.min(...r.values);
          const hi = style.sharedScale ? allHi : Math.max(...r.values);
          const pad = Math.min(6, rowH * 0.2);
          const sx = (i: number) => X(sparkAt!.x0 + ((sparkAt!.x1 - sparkAt!.x0) * i) / (n - 1));
          const sy = (v: number) => Y(y0 + rowH - pad - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (rowH - 2 * pad));
          const floor = Y(y0 + rowH - pad);
          if (style.spark === 'bar') {
            // Columns from zero when values change sign; otherwise from the side they all sit on (the smallest keeps a stub).
            const stub = Math.min(2, rowH * 0.08) * py;
            const zero = lo <= 0 && hi >= 0 ? sy(0) : lo > 0 ? floor - stub : Y(y0 + pad) + stub;
            const step = (sparkAt!.x1 - sparkAt!.x0) / (n - 1);
            const bw = X(Math.max(1, Math.min(6, step * 0.7)) / 2);
            r.values.forEach((v, i) => {
              const top = sy(v);
              pushRect(rects, { x0: sx(i) - bw, y0: Math.min(zero, top), x1: sx(i) + bw, y1: Math.max(zero, top), fill: i === n - 1 ? color : withAlpha(color, color[3] * 0.55) });
            });
          } else {
            const wash = withAlpha(color, color[3] * 0.12);
            for (let i = 0; i < n - 1; i++) {
              const [ax, ay, bx, by] = [sx(i), sy(r.values[i]), sx(i + 1), sy(r.values[i + 1])];
              pushSegment(lines, ax, ay, bx, by, color, 1.5);
              if (style.spark === 'area') {
                for (const [vx, vy] of [[ax, ay], [bx, by], [bx, floor], [ax, ay], [bx, floor], [ax, floor]]) pushVertex(mesh, vx, vy, wash);
              }
            }
            // The latest value, the one the figures of the row are about.
            pushSegment(lines, sx(n - 1), sy(r.last), sx(n - 1), sy(r.last), color, 5);
          }
        } else if (c.id === 'bar') {
          const h = Math.min(10, rowH * 0.42);
          const [bx0, bx1] = [c.x0 + 10, c.x1 - 10];
          const rr = Math.min(3, h / 2);
          pushRect(rects, { x0: X(bx0), y0: Y(ym + h / 2), x1: X(bx1), y1: Y(ym - h / 2), fill: withAlpha(grid, grid[3] * 0.8), radii: [rr, rr, rr, rr] });
          pushRect(bars, { x0: X(bx0), y0: Y(ym + h / 2), x1: X(bx0 + (bx1 - bx0) * (Math.abs(r.last) / maxAbs)), y1: Y(ym - h / 2), fill: r.last < 0 ? ctx.paint(bad, r.row) : color, radii: [rr, rr, rr, rr] });
          barKeys.push(r.name);
        }
      }
    });
    const draws: BuiltMark['draws'] = [];
    if (mesh.length) draws.push({ batch: batchOf(ctx, 'mesh', mesh), enter: 'fade' });
    if (rects.length) draws.push({ batch: batchOf(ctx, 'rect', rects), enter: 'fade' });
    if (bars.length) {
      const data = new Float32Array(bars);
      const b = ctx.renderer.createBatch('rect');
      b.update(data, barKeys.length);
      // Same entity, same bar: it slides to its new length when the data changes.
      draws.push({ batch: b, data, keys: barKeys });
    }
    draws.push({ batch: batchOf(ctx, 'line', rules), enter: 'fade' });
    if (lines.length) draws.push({ batch: batchOf(ctx, 'line', lines) });
    const xLabel = (v: number | string) => (xcol?.type === 'time' ? dateLabel(v as number, { day: 'numeric', month: 'short', year: 'numeric' }) : String(v));
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const x = tx / px;
        const y = (1 - ty) / py;
        const r = rows[Math.floor((y - headH) / rowH)];
        if (!r || y < headH) return null;
        if (sparkAt && x >= sparkAt.x0 - 10 && x <= sparkAt.x1 + 10 && r.values.length > 1) {
          const n = r.values.length;
          const i = Math.max(0, Math.min(n - 1, Math.round(((x - sparkAt.x0) / (sparkAt.x1 - sparkAt.x0)) * (n - 1))));
          return { title: `${r.name} · ${xLabel(r.x[i])}`, rows: [{ label: valueLabel, value: ctx.format(r.values[i], vf) }] };
        }
        return {
          title: r.name,
          rows: [
            { label: valueLabel, value: ctx.format(r.last, vf) },
            { label: style.change === 'first' ? 'Depuis le début' : 'Variation', value: Number.isNaN(r.change) ? '–' : `${sign(r.change)}${percent(Math.abs(r.change))}` },
            { label: 'Minimum', value: ctx.format(Math.min(...r.values), vf) },
            { label: 'Maximum', value: ctx.format(Math.max(...r.values), vf) },
          ],
        };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const SERIES_MARKS: Record<string, MarkDefinition> = { difference, fan, cycle, sparktable, bumpArea };
