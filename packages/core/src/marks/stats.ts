/**
 * Distribution marks: stacked dot plot, empirical cumulative distribution, quantile-quantile
 * plot, 2D density in filled contours and raincloud. Standalone marks (their second axis is
 * computed, not read from the data), drawn with the shared primitives; the statistics are in
 * `statsMath.ts`.
 */
import { LAYOUTS, SHAPES } from '../render/layouts';
import type { RGBA } from '../render/types';
import { BandScale, LinearScale, niceDomain } from '../scale/scales';
import type { Table } from '../data/table';
import { parseColor, withAlpha } from '../util/color';
import { contourSegments } from './advanced';
import { categoriesOf, need } from './charts';
import { dashed, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit } from './registry';
import {
  boxStats,
  contourFill,
  density2d,
  dotStacks,
  ecdf,
  ecdfAt,
  ecdfQuantile,
  kde1d,
  normalQuantile,
  qqBand,
  qqNormal,
  qqTwoSample,
  quantileSorted,
  sampleGrid,
  scott,
  silverman,
  type Ecdf,
  type QQPoint,
} from './statsMath';

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

function extent(v: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** A nice domain with a little air on both sides, so marks at the extremes are not cut by the frame. */
function paddedDomain(lo: number, hi: number, pad: number, count = 6): [number, number] {
  const p = (hi - lo) * pad;
  const [d0, d1] = niceDomain(lo - p, hi + p, count);
  // The air never invents a negative range for a measure that has none (durations, amounts).
  return [lo >= 0 ? Math.max(0, d0) : d0, hi <= 0 ? Math.min(0, d1) : d1];
}

interface Group {
  key: string;
  /** Source rows with a usable value. */
  rows: number[];
  color: RGBA;
}

/**
 * Rows split by the `color` field (one group when there is none). Hidden groups (legend) are
 * left out of `groups` but stay in `legend`.
 */
function groupsOf(ctx: BuildContext, valid: (row: number) => boolean, fallbackKey: string): { groups: Group[]; legend: { key: string; color: RGBA }[]; grouped: boolean } {
  const { layer, table } = ctx.data;
  const cf = layer.encode.color;
  const col = cf ? table.column(cf) : undefined;
  if (!col || col.type !== 'string') {
    const rows: number[] = [];
    for (let i = 0; i < table.length; i++) if (valid(i)) rows.push(i);
    const color = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(layer.name ?? fallbackKey);
    return { groups: [{ key: layer.name ?? fallbackKey, rows, color }], legend: [], grouped: false };
  }
  const keys = categoriesOf(table, cf!);
  const by = new Map<string, number[]>(keys.map((k) => [k, []]));
  for (let i = 0; i < table.length; i++) if (valid(i)) by.get(String(col.values[i]))!.push(i);
  const legend = keys.map((key) => ({ key, color: ctx.categorical(key) }));
  const groups = legend.filter((g) => !ctx.hidden.has(g.key) && by.get(g.key)!.length).map((g) => ({ ...g, rows: by.get(g.key)! }));
  return { groups, legend, grouped: true };
}

const percent = (v: number, digits = 0) => new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: digits }).format(v);
const integer = (v: number) => new Intl.NumberFormat().format(v);

function pointData(points: { x: number; y: number; size: number; fill: RGBA; stroke?: RGBA; strokeWidth?: number }[]): Float32Array {
  const out = new Float32Array(points.length * LAYOUTS.point.stride);
  points.forEach((p, i) => {
    const s = p.stroke ?? [0, 0, 0, 0];
    out.set([p.x, p.y, p.size, SHAPES.circle, p.fill[0], p.fill[1], p.fill[2], p.fill[3], s[0], s[1], s[2], s[3], p.strokeWidth ?? 0], i * LAYOUTS.point.stride);
  });
  return out;
}

/** The nearest of `points` (scale space) to the pointer, within `reach` px. */
function nearest<T extends { x: number; y: number }>(points: T[], tx: number, ty: number, pixel: [number, number], reach: number): T | undefined {
  let best: T | undefined;
  let bd = reach;
  for (const p of points) {
    const d = Math.hypot((p.x - tx) / pixel[0], (p.y - ty) / pixel[1]);
    if (d < bd) [best, bd] = [p, d];
  }
  return best;
}

// ----------------------------------------------------------------- dotplot

/**
 * `dotplot`: one dot per row along `x`, piled where values fall within a dot's width of each
 * other (Wilkinson). `color` (a category) tints the dots and keeps each group together in a
 * pile. The dots shrink until the tallest pile fits the height.
 */
export const dotplot: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'dotplot');
    const [lo, hi] = extent(numbers(table, xf));
    const [d0, d1] = paddedDomain(lo, hi, 0.03);
    return { x: new LinearScale(d0, d1, fields[xf]?.format), y: new LinearScale(0, 1), axes: { x: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const xf = layer.encode.x!;
    const xs = numbers(table, xf);
    const { groups, legend, grouped } = groupsOf(ctx, (r) => Number.isFinite(xs[r]), fieldLabel(ctx, xf));
    const rows: number[] = [];
    const groupOf = new Map<number, number>();
    groups.forEach((g, gi) => {
      for (const r of g.rows) {
        rows.push(r);
        groupOf.set(r, gi);
      }
    });
    const values = rows.map((r) => xs[r]);
    const [px, py] = ctx.pixel;
    const d0 = ctx.x.invert(0);
    const span = ctx.x.invert(1) - d0;
    const height = (1 / py) * 0.96 - 3;
    // The largest dot whose tallest pile still fits; at the smallest size, piles are squeezed instead.
    const smallest = Math.max(1.5, Math.min(style.minSize, style.size));
    let d = Math.max(smallest, style.size);
    let stacks = dotStacks(values, d * px * span, style.binning, d0);
    const tallest = () => stacks.reduce((a, s) => Math.max(a, s.members.length), 1);
    while (d > smallest && tallest() * d > height) {
      d = Math.max(smallest, d - 0.5);
      stacks = dotStacks(values, d * px * span, style.binning, d0);
    }
    const step = Math.min(d, height / tallest());
    const size = Math.max(1.5, d - Math.min(style.gap, d * 0.25));
    const dots: { x: number; y: number; row: number; pile: number; fill: RGBA; size: number }[] = [];
    for (const s of stacks) {
      // Groups stay together in a pile, in legend order: the pile reads as a stacked bar.
      const members = s.members.map((i) => rows[i]).sort((a, b) => groupOf.get(a)! - groupOf.get(b)! || xs[a] - xs[b]);
      members.forEach((row, k) => {
        const c = ctx.paint(groups[groupOf.get(row)!].color, row);
        dots.push({ x: ctx.x.norm(s.x), y: (3 + (k + 0.5) * step) * py, row, pile: members.length, fill: withAlpha(c, style.opacity), size });
      });
    }
    const data = pointData(dots);
    return {
      draws: [{ batch: batch(ctx, 'point', data), data, keys: dots.map((p) => String(p.row)) }],
      hit: emptyHit(),
      legend,
      pick(tx, ty): ShapeHit | null {
        const p = nearest(dots, tx, ty, ctx.pixel, Math.max(6, d));
        if (!p) return null;
        return {
          title: grouped ? groups[groupOf.get(p.row)!].key : fieldLabel(ctx, xf),
          rows: [
            { label: fieldLabel(ctx, xf), value: ctx.format(xs[p.row], xf) },
            { label: 'Dans la pile', value: integer(p.pile) },
          ],
        };
      },
    };
  },
};

// -------------------------------------------------------------------- ecdf

const quantileName = (q: number) => (q === 0.5 ? 'Médiane' : q === 0.25 ? 'Q1' : q === 0.75 ? 'Q3' : `p${Math.round(q * 1000) / 10}`);

/**
 * `ecdf`: the empirical cumulative distribution of `x` as a staircase (the share of rows at or
 * below each value), one curve per `color`. `style.quantiles` are projected on both axes.
 */
export const ecdfMark: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'line',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'ecdf');
    const [lo, hi] = extent(numbers(table, xf));
    const [d0, d1] = paddedDomain(lo, hi, 0.02);
    return { x: new LinearScale(d0, d1, fields[xf]?.format), y: new LinearScale(0, 1, { style: 'percent' }), axes: { x: true, y: true }, grid: { y: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = layer.encode.x!;
    const xs = numbers(table, xf);
    const { groups, legend, grouped } = groupsOf(ctx, (r) => Number.isFinite(xs[r]), fieldLabel(ctx, xf));
    const curves: { g: (typeof groups)[number]; e: Ecdf; color: RGBA }[] = groups
      .map((g) => ({ g, e: ecdf(g.rows.map((r) => xs[r])), color: ctx.paint(g.color, g.rows[0]) }))
      .filter((c) => c.e.n > 0);
    const lines: number[] = [];
    const guides: number[] = [];
    const dots: Parameters<typeof pointData>[0] = [];
    const labels: MarkLabel[] = [];
    const muted = withAlpha(parseColor(theme.text.muted), 0.7);
    const quantiles: number[] = (Array.isArray(style.quantiles) ? (style.quantiles as number[]) : []).filter((q) => q > 0 && q < 1);

    // Guides first (under the curves): a level across to the furthest curve, a drop to the x axis per curve.
    quantiles.forEach((q, qi) => {
      const at = curves.map((c) => ecdfQuantile(c.e, q));
      if (!at.length) return;
      const reach = Math.max(...at.map((v) => ctx.x.norm(v)));
      dashed(guides, [4, 4], ctx.pixel, muted, 1).segment(0, q, reach, q);
      // The name sits over the level, left of every curve (they only rise to the right of their quantile): only when there is room.
      const name = quantileName(q);
      if (style.labels && Math.min(...at.map((v) => ctx.x.norm(v))) / ctx.pixel[0] > name.length * 6.5 + 14) {
        labels.push({ tx: 0, ty: q, text: name, color: theme.text.secondary, size: 10.5, weight: 600, align: 'left', baseline: 'bottom', dx: 5, dy: -4 });
      }
      curves.forEach((c, ci) => {
        const x = ctx.x.norm(at[ci]);
        dashed(guides, [4, 4], ctx.pixel, withAlpha(c.color, 0.85), 1.25).segment(x, 0, x, q);
        dots.push({ x, y: q, size: 7, fill: c.color, stroke: ctx.surface, strokeWidth: 1.5 });
        if (style.labels) {
          // Values at the foot of each drop; a second quantile sits one line higher, so close values stay readable.
          labels.push({
            tx: x, ty: 0, text: ctx.format(at[ci], xf), color: theme.text.primary, size: 10.5, weight: 600,
            align: 'left', baseline: 'bottom', dx: 5, dy: -4 - (qi % 2) * 18, background: theme.background, series: grouped ? c.g.key : undefined,
          });
        }
      });
    });

    for (const c of curves) {
      const { x, p } = c.e;
      const w = style.width;
      let prev = 0;
      pushSegment(lines, 0, 0, ctx.x.norm(x[0]), 0, c.color, w);
      for (let i = 0; i < x.length; i++) {
        const tx = ctx.x.norm(x[i]);
        pushSegment(lines, tx, prev, tx, p[i], c.color, w);
        pushSegment(lines, tx, p[i], i + 1 < x.length ? ctx.x.norm(x[i + 1]) : 1, p[i], c.color, w);
        if (style.points) dots.push({ x: tx, y: p[i], size: w + 3, fill: c.color });
        prev = p[i];
      }
    }
    const draws: MarkDraw[] = [];
    if (guides.length) draws.push({ batch: batch(ctx, 'line', guides), enter: 'fade' });
    if (lines.length) draws.push({ batch: batch(ctx, 'line', lines) });
    if (dots.length) draws.push({ batch: batch(ctx, 'point', pointData(dots)), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(tx): ShapeHit | null {
        if (!curves.length) return null;
        const v = ctx.x.invert(tx);
        return {
          title: `${fieldLabel(ctx, xf)} ≤ ${ctx.format(v, xf)}`,
          rows: curves.map((c) => ({ label: grouped ? c.g.key : 'Part des observations', value: percent(ecdfAt(c.e, v), 1) })),
        };
      },
    };
  },
};

// ---------------------------------------------------------------------- qq

/**
 * `qq`: quantile-quantile plot. `x` alone: the sample against the normal law (z-scores along
 * x), one cloud per `color`, with the line through the quartiles and a confidence band.
 * `x` and `y`: the quantiles of two samples against each other, with the line of equality.
 */
export const qq: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'qq');
    const yf = layer.encode.y;
    const xs = numbers(table, xf);
    if (yf) {
      const ys = numbers(table, yf);
      const [a0, a1] = paddedDomain(...extent(xs), 0.04);
      const [b0, b1] = paddedDomain(...extent(ys), 0.04);
      return { x: new LinearScale(a0, a1, fields[xf]?.format), y: new LinearScale(b0, b1, fields[yf]?.format), axes: { x: true, y: true }, grid: { y: true } };
    }
    // The largest group decides how far the z-scores go.
    let n = 0;
    const cf = layer.encode.color;
    if (cf && table.column(cf).type === 'string') {
      const counts = new Map<string, number>();
      const c = table.column(cf).values;
      for (let i = 0; i < table.length; i++) if (Number.isFinite(xs[i])) counts.set(String(c[i]), (counts.get(String(c[i])) ?? 0) + 1);
      n = Math.max(0, ...counts.values());
    } else {
      for (let i = 0; i < table.length; i++) if (Number.isFinite(xs[i])) n++;
    }
    const z = Math.max(1, normalQuantile(1 - 0.5 / Math.max(2, n))) * 1.06;
    const half = Math.ceil(z * 2) / 2;
    const [y0, y1] = paddedDomain(...extent(xs), 0.05);
    return { x: new LinearScale(-half, half, { decimals: 1 }), y: new LinearScale(y0, y1, fields[xf]?.format), axes: { x: true, y: true }, grid: { y: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = layer.encode.x!;
    const yf = layer.encode.y;
    const xs = numbers(table, xf);
    const ys = yf ? numbers(table, yf) : undefined;
    const mesh: number[] = [];
    const lines: number[] = [];
    const dots: { x: number; y: number; size: number; fill: RGBA; stroke: RGBA; strokeWidth: number; q: QQPoint; rank: number; n: number; group: string }[] = [];
    const keys: string[] = [];
    const [d0, d1] = [ctx.x.invert(0), ctx.x.invert(1)];
    const auto = style.referenceColor === 'auto';
    const dash: number[] = Array.isArray(style.referenceDash) ? style.referenceDash : [];
    let legend: { key: string; color: RGBA }[] = [];
    let grouped = false;
    const addPoints = (points: QQPoint[], color: RGBA, group: string) => {
      points.forEach((q, i) => {
        const c = q.index >= 0 ? ctx.paint(color, q.index) : color;
        dots.push({
          x: ctx.x.norm(q.theoretical), y: ctx.y.norm(q.sample), size: style.size, fill: withAlpha(c, c[3] * style.opacity),
          stroke: ctx.surface, strokeWidth: 0.75, q, rank: i + 1, n: points.length, group,
        });
        keys.push(q.index >= 0 ? String(q.index) : `${group}#${i}`);
      });
    };
    if (ys) {
      const color = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(layer.name ?? fieldLabel(ctx, yf!));
      const points = qqTwoSample(xs, ys);
      // Equal distributions fall on y = x.
      const lo = Math.max(d0, ctx.y.invert(0));
      const hi = Math.min(d1, ctx.y.invert(1));
      if (hi > lo) {
        const ink = auto ? withAlpha(parseColor(theme.text.secondary), 0.9) : parseColor(style.referenceColor);
        dashed(lines, dash, ctx.pixel, ink, style.referenceWidth).segment(ctx.x.norm(lo), ctx.y.norm(lo), ctx.x.norm(hi), ctx.y.norm(hi));
      }
      addPoints(points, color, '');
    } else {
      const g = groupsOf(ctx, (r) => Number.isFinite(xs[r]), fieldLabel(ctx, xf));
      legend = g.legend;
      grouped = g.grouped;
      for (const group of g.groups) {
        const fit = qqNormal(group.rows.map((r) => xs[r]));
        if (!fit.n) continue;
        const points = fit.points.map((p) => ({ ...p, index: group.rows[p.index] }));
        const color = ctx.paint(group.color, group.rows[0]);
        const line = (z: number) => ctx.y.norm(fit.intercept + fit.slope * z);
        if (style.band && fit.n > 2) {
          // Between the extreme plotting positions only: further out the band has no meaning.
          const z0 = points[0].theoretical;
          const z1 = points[points.length - 1].theoretical;
          const S = 48;
          const fill = withAlpha(color, 0.14);
          let prev: [number, number, number] | undefined;
          for (let k = 0; k <= S; k++) {
            const z = z0 + ((z1 - z0) * k) / S;
            const h = qqBand(z, fit.slope, fit.n, style.level);
            const at: [number, number, number] = [ctx.x.norm(z), ctx.y.norm(fit.intercept + fit.slope * z - h), ctx.y.norm(fit.intercept + fit.slope * z + h)];
            if (prev) {
              pushVertex(mesh, prev[0], prev[1], fill);
              pushVertex(mesh, prev[0], prev[2], fill);
              pushVertex(mesh, at[0], at[2], fill);
              pushVertex(mesh, prev[0], prev[1], fill);
              pushVertex(mesh, at[0], at[2], fill);
              pushVertex(mesh, at[0], at[1], fill);
            }
            prev = at;
          }
        }
        // One group: a neutral line under colored points. Several: each line in its group's color.
        const ink = !auto ? parseColor(style.referenceColor) : grouped ? color : withAlpha(parseColor(theme.text.secondary), 0.9);
        dashed(lines, dash, ctx.pixel, ink, style.referenceWidth).segment(0, line(d0), 1, line(d1));
        addPoints(points, group.color, group.key);
      }
    }
    const draws: MarkDraw[] = [];
    if (mesh.length) draws.push({ batch: batch(ctx, 'mesh', mesh), enter: 'fade' });
    if (lines.length) draws.push({ batch: batch(ctx, 'line', lines) });
    const data = pointData(dots);
    draws.push({ batch: batch(ctx, 'point', data), data, keys });
    const z = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return {
      draws,
      hit: emptyHit(),
      legend,
      pick(tx, ty): ShapeHit | null {
        const p = nearest(dots, tx, ty, ctx.pixel, Math.max(8, style.size));
        if (!p) return null;
        const title = `Rang ${integer(p.rank)} sur ${integer(p.n)}`;
        if (ys) {
          return { title, rows: [{ label: fieldLabel(ctx, xf), value: ctx.format(p.q.theoretical, xf) }, { label: fieldLabel(ctx, yf!), value: ctx.format(p.q.sample, yf) }] };
        }
        const rows = [{ label: fieldLabel(ctx, xf), value: ctx.format(p.q.sample, xf) }, { label: 'Quantile normal', value: z.format(p.q.theoretical) }];
        return { title: grouped ? `${p.group} · ${title.toLowerCase()}` : title, rows };
      },
    };
  },
};

// ----------------------------------------------------------------- contour

/**
 * `contour`: 2D density of a cloud of points (`x`, `y`), estimated with a Gaussian kernel on a
 * grid and drawn as filled bands between iso-density levels (marching squares). One set of
 * bands per `color` category; the points themselves on top with `style.points`.
 */
export const contour: MarkDefinition = {
  standalone: true,
  // Only the points depend on the size (they thin out on a small chart): the bands are in scale space.
  sizeDependent: (layer) => layer.style?.points !== false,
  symbol: 'square',
  scales({ layer, table, fields, style }) {
    const xf = need(layer, 'x', 'contour');
    const yf = need(layer, 'y', 'contour');
    const xs = numbers(table, xf);
    const ys = numbers(table, yf);
    let [x0, x1] = paddedDomain(...extent(xs), 0.1);
    let [y0, y1] = paddedDomain(...extent(ys), 0.1);
    // A domain held at 0 would cut the outer band flat along the axis: where that band reaches the
    // edge, the domain goes on below 0, as far as the kernel spreads.
    const st = (style ?? layer.style ?? {}) as { levels?: number; smoothing?: number };
    const levels = Math.max(1, Math.min(24, Math.round(st.levels ?? 6)));
    const smoothing = (st.smoothing ?? 1) > 0 ? (st.smoothing ?? 1) : 1;
    const cf = layer.encode.color;
    const cv = cf ? table.column(cf).values : undefined;
    const groups = new Map<string, number[]>();
    for (let r = 0; r < table.length; r++) {
      if (!Number.isFinite(xs[r] + ys[r])) continue;
      const k = cv ? String(cv[r]) : '';
      groups.get(k)?.push(r) ?? groups.set(k, [r]);
    }
    const NX = 96, NY = 72;
    let nx0 = x0, ny0 = y0;
    for (const rows of groups.values()) {
      if (rows.length < 3 || (x0 !== 0 && y0 !== 0)) continue;
      const vx = rows.map((r) => xs[r]);
      const vy = rows.map((r) => ys[r]);
      const hx = Math.max(scott(vx) * smoothing, ((x1 - x0) / (NX - 1)) * 1.5);
      const hy = Math.max(scott(vy) * smoothing, ((y1 - y0) / (NY - 1)) * 1.5);
      // On a frame widened by the kernel's reach, where does the outer band end?
      const ex0 = x0 === 0 ? x0 - 4 * hx : x0;
      const ey0 = y0 === 0 ? y0 - 4 * hy : y0;
      const g = density2d(vx, vy, { x0: ex0, x1, y0: ey0, y1 }, NX, NY, hx, hy);
      let max = 0;
      for (const v of g) if (v > max) max = v;
      const level = max / (levels + 1);
      if (!(level > 0)) continue;
      let left = NX, bottom = NY;
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++)
          if (g[j * NX + i] >= level) (left = Math.min(left, i)), (bottom = Math.min(bottom, j));
      const xEdge = ex0 + (left * (x1 - ex0)) / (NX - 1);
      const yEdge = ey0 + (bottom * (y1 - ey0)) / (NY - 1);
      if (xEdge < x0) nx0 = Math.min(nx0, xEdge - 0.25 * hx);
      if (yEdge < y0) ny0 = Math.min(ny0, yEdge - 0.25 * hy);
    }
    if (nx0 < x0) x0 = niceDomain(nx0, x1, 12)[0];
    if (ny0 < y0) y0 = niceDomain(ny0, y1, 12)[0];
    return { x: new LinearScale(x0, x1, fields[xf]?.format), y: new LinearScale(y0, y1, fields[yf]?.format), axes: { x: true, y: true }, grid: { y: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = layer.encode.x!;
    const yf = layer.encode.y!;
    const xs = numbers(table, xf);
    const ys = numbers(table, yf);
    const { groups, legend, grouped } = groupsOf(ctx, (r) => Number.isFinite(xs[r] + ys[r]), fieldLabel(ctx, yf));
    const NX = 96;
    const NY = 72;
    const box = { x0: ctx.x.invert(0), x1: ctx.x.invert(1), y0: ctx.y.invert(0), y1: ctx.y.invert(1) };
    const levels = Math.max(1, Math.min(24, Math.round(style.levels)));
    const smoothing = style.smoothing > 0 ? style.smoothing : 1;
    const mesh: number[] = [];
    const lines: number[] = [];
    const dots: { x: number; y: number; size: number; fill: RGBA; stroke: RGBA; strokeWidth: number; row: number; group: string }[] = [];
    const fields2: { key: string; g: Float64Array; max: number; n: number }[] = [];
    const gx = (f: number) => f / (NX - 1);
    const gy = (f: number) => f / (NY - 1);
    const ink = parseColor(theme.text.primary);
    for (const group of groups) {
      if (group.rows.length < 3) continue;
      const vx = group.rows.map((r) => xs[r]);
      const vy = group.rows.map((r) => ys[r]);
      // Never finer than the grid can show.
      const hx = Math.max(scott(vx) * smoothing, ((box.x1 - box.x0) / (NX - 1)) * 1.5);
      const hy = Math.max(scott(vy) * smoothing, ((box.y1 - box.y0) / (NY - 1)) * 1.5);
      const g = density2d(vx, vy, box, NX, NY, hx, hy);
      let max = 0;
      for (const v of g) if (v > max) max = v;
      if (!(max > 0)) continue;
      fields2.push({ key: group.key, g, max, n: group.rows.length });
      const base = ctx.paint(group.color, group.rows[0]);
      // Several groups: translucent layers of one hue, which add up to `opacity` at the summit.
      const layerAlpha = 1 - Math.pow(1 - Math.min(0.98, style.opacity), 1 / levels);
      for (let k = 1; k <= levels; k++) {
        const level = (max * k) / (levels + 1);
        const fill = grouped || layer.style?.color ? withAlpha(base, base[3] * layerAlpha) : withAlpha(ctx.ramp(levels > 1 ? (k - 1) / (levels - 1) : 0.5), style.opacity);
        const tri = contourFill(g, NX, NY, level);
        for (let t = 0; t < tri.length; t += 2) pushVertex(mesh, gx(tri[t]), gy(tri[t + 1]), fill);
        if (style.lines) {
          const stroke = grouped || layer.style?.color ? withAlpha(base, 0.75) : ctx.ramp(Math.min(1, (k + 0.6) / Math.max(1, levels - 1)));
          const segs = contourSegments(g, NX, NY, level);
          for (let s = 0; s < segs.length; s += 4) pushSegment(lines, gx(segs[s]), gy(segs[s + 1]), gx(segs[s + 2]), gy(segs[s + 3]), stroke, 1);
        }
      }
    }
    if (style.points) {
      // Dots sized for the room each one has: on a phone they shrink, so the bands stay the subject.
      const count = groups.reduce((a, g) => a + g.rows.length, 0);
      const room = Math.sqrt(1 / (ctx.pixel[0] * ctx.pixel[1] * Math.max(1, count)));
      const size = Math.max(1.75, Math.min(style.size, (style.size * room) / 16));
      const outline = size >= 2.5 ? 0.5 : 0;
      for (const group of groups) {
        for (const r of group.rows) {
          const c = grouped || layer.style?.color ? ctx.paint(group.color, r) : ctx.paint(ink, r);
          dots.push({ x: ctx.x.norm(xs[r]), y: ctx.y.norm(ys[r]), size, fill: withAlpha(c, c[3] * (grouped ? 0.8 : 0.45)), stroke: withAlpha(ctx.surface, grouped ? 0.7 : 0.45), strokeWidth: outline, row: r, group: group.key });
        }
      }
    }
    const draws: MarkDraw[] = [];
    if (mesh.length) draws.push({ batch: batch(ctx, 'mesh', mesh), enter: 'fade' });
    if (lines.length) draws.push({ batch: batch(ctx, 'line', lines), enter: 'fade' });
    if (dots.length) {
      const data = pointData(dots);
      draws.push({ batch: batch(ctx, 'point', data), data, keys: dots.map((p) => String(p.row)), enter: 'fade' });
    }
    return {
      draws,
      hit: emptyHit(),
      legend,
      pick(tx, ty): ShapeHit | null {
        const p = nearest(dots, tx, ty, ctx.pixel, 6);
        if (p) {
          return {
            title: grouped ? p.group : 'Observation',
            rows: [{ label: fieldLabel(ctx, xf), value: ctx.format(xs[p.row], xf) }, { label: fieldLabel(ctx, yf), value: ctx.format(ys[p.row], yf) }],
          };
        }
        // Otherwise the densest group here, as a share of its own summit.
        let best: { key: string; t: number; n: number } | undefined;
        for (const f of fields2) {
          const t = sampleGrid(f.g, NX, NY, tx * (NX - 1), ty * (NY - 1)) / f.max;
          if (!best || t > best.t) best = { key: f.key, t, n: f.n };
        }
        if (!best || best.t < 1 / (levels + 1)) return null;
        return {
          title: grouped ? best.key : `${ctx.format(ctx.x.invert(tx), xf)} · ${ctx.format(ctx.y.invert(ty), yf)}`,
          rows: [{ label: 'Densité (part du sommet)', value: percent(best.t) }, { label: 'Observations', value: integer(best.n) }],
        };
      },
    };
  },
};

// --------------------------------------------------------------- raincloud

/** A stable pseudo-random number in [0, 1) from a row index: the rain keeps its place from one build to the next. */
const scatter = (row: number) => {
  const v = Math.sin((row + 1) * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * `raincloud`: for each `key` category, the density of `x` as a half violin (the cloud), a slim
 * box plot under it and every row as a dot scattered below (the rain). Shape, summary and
 * raw data at once.
 */
export const raincloud: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'raincloud');
    const [d0, d1] = paddedDomain(...extent(numbers(table, xf)), 0.04);
    const x = new LinearScale(d0, d1, fields[xf]?.format);
    if (!layer.encode.key) return { x, y: new LinearScale(0, 1), axes: { x: true }, grid: { x: true } };
    return { x, y: new BandScale(categoriesOf(table, layer.encode.key), 0.06, 0.03, true), axes: { x: true, y: true }, grid: { x: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = layer.encode.x!;
    const kf = layer.encode.key;
    const xs = numbers(table, xf);
    const keys = kf ? table.column(kf).values : undefined;
    const band = ctx.y instanceof BandScale ? ctx.y : undefined;
    const cats = band ? band.categories : [layer.name ?? fieldLabel(ctx, xf)];
    const py = ctx.pixel[1];
    const mesh: number[] = [];
    const lines: number[] = [];
    const rects: number[] = [];
    const dots: { x: number; y: number; size: number; fill: RGBA; row: number }[] = [];
    const [d0, d1] = [ctx.x.invert(0), ctx.x.invert(1)];
    const S = 96;
    const single = layer.style?.color ? parseColor(layer.style.color) : undefined;
    const ink = parseColor(theme.text.primary);
    const summaries = cats.map((cat, ci) => {
      const rows: number[] = [];
      for (let i = 0; i < table.length; i++) if (Number.isFinite(xs[i]) && (!keys || String(keys[i]) === cat)) rows.push(i);
      if (!rows.length) return undefined;
      const center = band ? band.norm(ci) : 0.5;
      const h = band ? band.band : 0.94;
      const sorted = rows.map((r) => xs[r]).sort((a, b) => a - b);
      const color = ctx.paint(single ?? ctx.categorical(cat), rows[0]);
      // From the top of the band down: the cloud, the box, the rain.
      const base = center + h * 0.02;
      const top = center + h * 0.45;
      const boxH = Math.min(h * 0.1, 9 * py);
      const boxY = base - Math.max(h * 0.09, boxH / 2 + 3 * py);
      const rainTop = boxY - boxH / 2 - 3 * py;
      const rainBottom = center - h * 0.47;

      if (sorted.length > 1) {
        const bw = style.bandwidth > 0 ? style.bandwidth : silverman(sorted);
        const lo = Math.max(d0, sorted[0] - 1.5 * bw);
        const hi = Math.min(d1, sorted[sorted.length - 1] + 1.5 * bw);
        const grid = Array.from({ length: S }, (_, i) => lo + ((hi - lo) * i) / (S - 1));
        const dens = kde1d(sorted, grid, bw);
        const max = Math.max(...dens, 1e-300);
        const fill = withAlpha(color, color[3] * style.opacity);
        const y = (k: number) => base + (dens[k] / max) * (top - base);
        for (let k = 0; k < S - 1; k++) {
          const xa = ctx.x.norm(grid[k]);
          const xb = ctx.x.norm(grid[k + 1]);
          pushVertex(mesh, xa, base, fill);
          pushVertex(mesh, xa, y(k), fill);
          pushVertex(mesh, xb, y(k + 1), fill);
          pushVertex(mesh, xa, base, fill);
          pushVertex(mesh, xb, y(k + 1), fill);
          pushVertex(mesh, xb, base, fill);
          pushSegment(lines, xa, y(k), xb, y(k + 1), color, 1.5);
        }
        pushSegment(lines, ctx.x.norm(lo), base, ctx.x.norm(hi), base, color, 1.5);
      }

      const b = boxStats(sorted);
      if (style.box) {
        pushSegment(lines, ctx.x.norm(b.low), boxY, ctx.x.norm(b.q1), boxY, color, 1.5);
        pushSegment(lines, ctx.x.norm(b.q3), boxY, ctx.x.norm(b.high), boxY, color, 1.5);
        pushRect(rects, { x0: ctx.x.norm(b.q1), y0: boxY - boxH / 2, x1: ctx.x.norm(b.q3), y1: boxY + boxH / 2, fill: ctx.surface, stroke: color, strokeWidth: 1.5, radii: [2, 2, 2, 2], axis: 1 });
      }

      if (style.points) {
        const fill = withAlpha(color, color[3] * 0.6);
        const from = style.box ? rainTop : base - 4 * py;
        const room = Math.max(0, from - rainBottom - style.size * py);
        for (const r of rows) {
          dots.push({ x: ctx.x.norm(xs[r]), y: from - (style.size / 2) * py - scatter(r) * room * Math.min(1, Math.max(0, style.jitter)), size: style.size, fill: ctx.paint(fill, r), row: r });
        }
      }
      return { cat, b, center, h, boxY, boxH, mean: sorted.reduce((a, v) => a + v, 0) / sorted.length, sorted };
    });
    const draws: MarkDraw[] = [];
    if (mesh.length) draws.push({ batch: batch(ctx, 'mesh', mesh) });
    if (dots.length) {
      const data = pointData(dots);
      draws.push({ batch: batch(ctx, 'point', data), data, keys: dots.map((p) => String(p.row)), enter: 'fade' });
    }
    if (rects.length) draws.push({ batch: batch(ctx, 'rect', rects), enter: 'fade' });
    if (lines.length) draws.push({ batch: batch(ctx, 'line', lines) });
    // The median over the box, drawn last so nothing covers it.
    const medians: number[] = [];
    for (const s of summaries) {
      if (!s || !style.box) continue;
      const m = ctx.x.norm(s.b.median);
      pushSegment(medians, m, s.boxY - s.boxH / 2 - 2 * py, m, s.boxY + s.boxH / 2 + 2 * py, ink, 2);
    }
    if (medians.length) draws.push({ batch: batch(ctx, 'line', medians), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      pick(tx, ty): ShapeHit | null {
        const p = nearest(dots, tx, ty, ctx.pixel, 5);
        const s = summaries.find((c) => c && Math.abs(ty - c.center) <= c.h / 2);
        if (!s) return null;
        if (p && Math.abs(p.y - s.center) <= s.h / 2) return { title: s.cat, rows: [{ label: fieldLabel(ctx, xf), value: ctx.format(xs[p.row], xf) }] };
        return {
          title: s.cat,
          rows: [
            { label: 'Effectif', value: integer(s.b.n) },
            { label: 'Médiane', value: ctx.format(s.b.median, xf) },
            { label: 'Moyenne', value: ctx.format(s.mean, xf) },
            { label: 'Q1 – Q3', value: `${ctx.format(s.b.q1, xf)} – ${ctx.format(s.b.q3, xf)}` },
            { label: 'Min – max', value: `${ctx.format(s.sorted[0], xf)} – ${ctx.format(quantileSorted(s.sorted, 1), xf)}` },
          ],
        };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const STATS_MARKS: Record<string, MarkDefinition> = { dotplot, ecdf: ecdfMark, qq, contour, raincloud };
