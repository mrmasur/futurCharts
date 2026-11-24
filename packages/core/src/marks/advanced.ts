/**
 * Ridgeline, beeswarm, tile map, pictorial (unit) chart, interpolated surface
 * with contours and horizon chart: standalone marks drawn with the shared primitives.
 */
import { LAYOUTS, SHAPES, type PointShape } from '../render/layouts';
import type { RGBA } from '../render/types';
import { BandScale, LinearScale, TimeScale, niceDomain } from '../scale/scales';
import type { Table } from '../data/table';
import { mix, parseColor, withAlpha } from '../util/color';
import { batches, categoriesOf, need, share, totals, valueColor } from './charts';
import { pushArc } from './primitives';
import { pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;

function batch(ctx: BuildContext, kind: 'point' | 'line' | 'mesh' | 'rect' | 'arc', data: number[]) {
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
    if (Number.isNaN(x)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

const quantile = (s: number[], q: number) => {
  if (!s.length) return NaN;
  const p = (s.length - 1) * q;
  const i = Math.floor(p);
  return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (p - i);
};

/** Gaussian kernel density of `v` at `xs` (Silverman bandwidth unless given). */
function kde(v: number[], xs: number[], bw?: number): number[] {
  const n = v.length;
  const mean = v.reduce((a, x) => a + x, 0) / n;
  const sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1)) || 1;
  const h = bw || 1.06 * sd * Math.pow(n, -0.2);
  const k = 1 / (Math.sqrt(2 * Math.PI) * n * h);
  return xs.map((x) => {
    let d = 0;
    for (const xi of v) d += Math.exp(-0.5 * ((x - xi) / h) ** 2);
    return d * k;
  });
}

// ---------------------------------------------------------------- ridgeline

/** `ridgeline`: one density curve per `key` (of the `x` values), stacked and overlapping. */
export const ridgeline: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'ridgeline');
    const [lo, hi] = extent(numbers(table, xf));
    const pad = (hi - lo) * 0.08;
    const [d0, d1] = niceDomain(lo - pad, hi + pad, 6);
    return { x: new LinearScale(d0, d1, fields[xf]?.format), y: new LinearScale(0, 1), axes: { x: true }, grid: { x: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'ridgeline');
    const xf = layer.encode.x!;
    const keys = table.column(kf).values;
    const xs = numbers(table, xf);
    const groups = categoriesOf(table, kf).filter((g) => !ctx.hidden.has(g));
    const n = groups.length;
    const [d0, d1] = [ctx.x.invert(0), ctx.x.invert(1)];
    const S = 120;
    const grid = Array.from({ length: S }, (_, i) => d0 + ((d1 - d0) * i) / (S - 1));
    const data = groups.map((g) => {
      const v: number[] = [];
      let row = -1;
      for (let i = 0; i < table.length; i++) {
        if (String(keys[i]) !== g || Number.isNaN(xs[i])) continue;
        v.push(xs[i]);
        if (row < 0) row = i;
      }
      v.sort((a, b) => a - b);
      return { g, v, row, d: v.length > 1 ? kde(v, grid, style.bandwidth || undefined) : grid.map(() => 0) };
    });
    const max = Math.max(...data.flatMap((d) => d.d), 1e-12);
    // Rows: the last at the bottom, every peak reaching `overlap` rows up.
    const rowH = 1 / Math.max(1, n - 1 + style.overlap);
    const base = (i: number) => (n - 1 - i) * rowH;
    const mesh: number[] = [];
    const lines: number[] = [];
    const labels: MarkLabel[] = [];
    const single = layer.style?.color ? parseColor(layer.style.color) : undefined;
    const surface = ctx.surface;
    data.forEach((d, i) => {
      const c0 = single ?? (layer.encode.color ? ctx.categorical(d.g) : ctx.ramp(0.25 + (0.7 * i) / Math.max(1, n - 1)));
      const c = ctx.paint(c0, d.row >= 0 ? d.row : undefined);
      const fill = withAlpha(c, c[3] * style.opacity);
      const y0 = base(i);
      const top = (k: number) => y0 + (d.d[k] / max) * style.overlap * rowH;
      for (let k = 0; k < S - 1; k++) {
        const xa = ctx.x.norm(grid[k]);
        const xb = ctx.x.norm(grid[k + 1]);
        pushVertex(mesh, xa, y0, fill);
        pushVertex(mesh, xa, top(k), fill);
        pushVertex(mesh, xb, top(k + 1), fill);
        pushVertex(mesh, xa, y0, fill);
        pushVertex(mesh, xb, top(k + 1), fill);
        pushVertex(mesh, xb, y0, fill);
      }
      // Outline in the surface color first (separates the ridges), then the ink line.
      for (let k = 0; k < S - 1; k++) {
        const xa = ctx.x.norm(grid[k]);
        const xb = ctx.x.norm(grid[k + 1]);
        pushSegment(lines, xa, top(k), xb, top(k + 1), c, 1.5);
      }
      pushSegment(lines, 0, y0, 1, y0, withAlpha(surface, 1), 1);
      labels.push({ tx: 0, ty: y0, text: d.g, color: theme.text.primary, size: 11, weight: 600, align: 'left', baseline: 'bottom', dx: 4, dy: -3, background: theme.background });
    });
    // Each ridge drawn on its own pair (fill then line) would need one batch per ridge; one fill and one line batch keep it cheap.
    const draws = batches(ctx, [], mesh, [], false);
    draws.push({ batch: batch(ctx, 'line', lines) });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend: layer.encode.color ? groups.map((g) => ({ key: g, color: ctx.categorical(g) })) : [],
      pick(tx, ty): ShapeHit | null {
        // The ridge whose baseline is just below the pointer.
        const i = n - 1 - Math.floor(ty / rowH);
        const d = data[Math.max(0, Math.min(n - 1, i))];
        if (!d || !d.v.length) return null;
        const mean = d.v.reduce((a, x) => a + x, 0) / d.v.length;
        return {
          title: d.g,
          rows: [
            { label: 'Effectif', value: String(d.v.length) },
            { label: 'Médiane', value: ctx.format(quantile(d.v, 0.5), xf) },
            { label: 'Moyenne', value: ctx.format(mean, xf) },
            { label: 'Q1 – Q3', value: `${ctx.format(quantile(d.v, 0.25), xf)} – ${ctx.format(quantile(d.v, 0.75), xf)}` },
          ],
        };
      },
    };
  },
};

// ---------------------------------------------------------------- beeswarm

/**
 * `beeswarm`: one dot per row along `x`, pushed sideways just enough not to
 * overlap; one swarm per `key` category when given. `color` as on `point`.
 */
export const beeswarm: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'beeswarm');
    const [lo, hi] = extent(numbers(table, xf));
    const [d0, d1] = niceDomain(lo, hi, 6);
    const x = new LinearScale(d0, d1, fields[xf]?.format);
    if (!layer.encode.key) return { x, y: new LinearScale(0, 1), axes: { x: true }, grid: { x: true } };
    return { x, y: new BandScale(categoriesOf(table, layer.encode.key), 0.08, 0.04, true), axes: { x: true, y: true }, grid: { x: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const xf = layer.encode.x!;
    const kf = layer.encode.key;
    const cf = layer.encode.color;
    const xs = numbers(table, xf);
    const keys = kf ? table.column(kf).values : undefined;
    const ccol = cf ? table.column(cf) : undefined;
    const numericColor = !!ccol && ccol.type !== 'string';
    const [c0, c1] = numericColor ? extent(ccol!.values as Float64Array) : [0, 1];
    const [px, py] = ctx.pixel;
    const band = ctx.y instanceof BandScale ? ctx.y : undefined;
    const cats = band ? band.categories : [''];
    const d = style.size;
    const placed: { x: number; y: number; row: number; c: RGBA }[] = [];
    const legendKeys: string[] = [];
    for (const [ci, cat] of cats.entries()) {
      const center = band ? band.norm(ci) : 0.5;
      const half = (band ? band.band / 2 : 0.48) / py;
      const rows: number[] = [];
      for (let i = 0; i < table.length; i++) if (!Number.isNaN(xs[i]) && (!keys || String(keys[i]) === cat)) rows.push(i);
      rows.sort((a, b) => xs[a] - xs[b]);
      // Greedy: each dot takes the free offset closest to the center line.
      const done: { x: number; y: number }[] = [];
      let lo = 0;
      for (const r of rows) {
        const x = ctx.x.norm(xs[r]) / px;
        while (lo < done.length && done[lo].x < x - d) lo++;
        const near = done.slice(lo);
        let best = 0;
        for (let k = 0; k < 400; k++) {
          const off = k === 0 ? 0 : Math.ceil(k / 2) * (k % 2 ? 1 : -1) * (d * 0.25);
          if (Math.abs(off) > half - d / 2) {
            best = NaN;
            break;
          }
          if (near.every((p) => (p.x - x) ** 2 + (p.y - off) ** 2 >= (d * 0.98) ** 2)) {
            best = off;
            break;
          }
        }
        if (Number.isNaN(best)) best = ((r * 7919) % 100) / 100 * (half - d / 2) * 2 - (half - d / 2);
        done.push({ x, y: best });
        let col: RGBA;
        if (!ccol) col = ctx.categorical(kf ? cat : fieldLabel(ctx, xf));
        else if (numericColor) col = ctx.ramp(c1 > c0 ? ((ccol.values[r] as number) - c0) / (c1 - c0) : 0.5);
        else {
          const g = String(ccol.values[r]);
          if (!legendKeys.includes(g)) legendKeys.push(g);
          col = ctx.categorical(g);
        }
        placed.push({ x: x * px, y: center + best * py, row: r, c: ctx.paint(col, r) });
      }
    }
    const out: number[] = [];
    const surface = ctx.surface;
    for (const p of placed) out.push(p.x, p.y, d, SHAPES.circle, p.c[0], p.c[1], p.c[2], p.c[3] * style.opacity, surface[0], surface[1], surface[2], 1, 0.75);
    return {
      draws: [{ batch: batch(ctx, 'point', out), enter: 'fade' }],
      hit: emptyHit(),
      labels: [],
      legend: legendKeys.map((k) => ({ key: k, color: ctx.categorical(k) })),
      pick(tx, ty): ShapeHit | null {
        let best: (typeof placed)[number] | undefined;
        let bd = d;
        for (const p of placed) {
          const dist = Math.hypot((p.x - tx) / px, (p.y - ty) / py);
          if (dist < bd) [best, bd] = [p, dist];
        }
        if (!best) return null;
        const row = table.row(best.row);
        const label = style.label;
        const title = label ? String(row[label]) : kf ? String(row[kf]) : fieldLabel(ctx, xf);
        const rows = [{ label: fieldLabel(ctx, xf), value: ctx.format(xs[best.row], xf) }];
        if (cf) rows.push({ label: fieldLabel(ctx, cf), value: numericColor ? ctx.format(row[cf] as number, cf) : String(row[cf]) });
        return { title, rows };
      },
    };
  },
};

// ------------------------------------------------------------------ tilemap

/**
 * `tilemap`: one tile per row at grid column `x` and row `y` (row 0 on top),
 * hexagons (odd rows shifted, `style.hex`) or squares. `key` is the label,
 * `color` a numeric field (sequential) or a category.
 */
export const tilemap: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales({ layer, table }) {
    const [c0, c1] = extent(numbers(table, need(layer, 'x', 'tilemap')));
    const [r0, r1] = extent(numbers(table, need(layer, 'y', 'tilemap')));
    const hex = (layer.style as { hex?: boolean } | undefined)?.hex !== false;
    const rowStep = hex ? Math.sqrt(3) / 2 : 1;
    const x0 = c0 - 0.6, x1 = c1 + (hex ? 1.1 : 0.6);
    const y0 = -(r1 * rowStep) - 0.65, y1 = -(r0 * rowStep) + 0.65;
    return { x: new LinearScale(x0, x1), y: new LinearScale(y0, y1), aspect: (x1 - x0) / (y1 - y0) };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const cols = numbers(table, layer.encode.x!);
    const rows = numbers(table, layer.encode.y!);
    const kf = layer.encode.key;
    const cf = layer.encode.color ?? layer.encode.value;
    const ccol = cf ? table.column(cf) : undefined;
    const numeric = !!ccol && ccol.type !== 'string';
    const [v0, v1] = numeric ? extent(ccol!.values as Float64Array) : [0, 1];
    const hex = style.hex;
    const rowStep = hex ? Math.sqrt(3) / 2 : 1;
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const gap = style.gap * ctx.pixel[0] / (unit || 1);
    const mesh: number[] = [];
    const labels: MarkLabel[] = [];
    const tiles: { cx: number; cy: number; row: number }[] = [];
    const legendKeys: string[] = [];
    for (let i = 0; i < table.length; i++) {
      if (Number.isNaN(cols[i] + rows[i])) continue;
      const cx = cols[i] + (hex && Math.abs(rows[i]) % 2 === 1 ? 0.5 : 0);
      const cy = -rows[i] * rowStep;
      let base: RGBA;
      if (!ccol) base = ctx.categorical(fieldLabel(ctx, layer.encode.x!));
      else if (numeric) base = Number.isNaN(ccol.values[i] as number) ? parseColor(theme.grid.y.color) : ctx.ramp(v1 > v0 ? ((ccol.values[i] as number) - v0) / (v1 - v0) : 0.5);
      else {
        const g = String(ccol.values[i]);
        if (!legendKeys.includes(g)) legendKeys.push(g);
        base = ctx.categorical(g);
      }
      const fill = ctx.paint(base, i);
      const X = (x: number) => ctx.x.norm(x);
      const Y = (y: number) => ctx.y.norm(y);
      if (hex) {
        // Pointy-top hexagon of width 1, shrunk by the gap.
        const R = 1 / Math.sqrt(3) - gap / Math.sqrt(3);
        const pts = Array.from({ length: 6 }, (_, k) => {
          const a = (Math.PI / 3) * k + Math.PI / 6;
          return [X(cx + Math.cos(a) * R), Y(cy + Math.sin(a) * R)] as const;
        });
        for (let k = 0; k < 6; k++) {
          pushVertex(mesh, X(cx), Y(cy), fill);
          pushVertex(mesh, pts[k][0], pts[k][1], fill);
          pushVertex(mesh, pts[(k + 1) % 6][0], pts[(k + 1) % 6][1], fill);
        }
      } else {
        const h = 0.5 - gap / 2;
        pushVertex(mesh, X(cx - h), Y(cy - h), fill);
        pushVertex(mesh, X(cx + h), Y(cy - h), fill);
        pushVertex(mesh, X(cx + h), Y(cy + h), fill);
        pushVertex(mesh, X(cx - h), Y(cy - h), fill);
        pushVertex(mesh, X(cx + h), Y(cy + h), fill);
        pushVertex(mesh, X(cx - h), Y(cy + h), fill);
      }
      tiles.push({ cx, cy, row: i });
      if (style.labels && kf) {
        const b = 0.42;
        labels.push({ tx: X(cx), ty: Y(cy), text: String(table.column(kf).values[i]), on: fill, size: 11, weight: 600, align: 'center', baseline: 'middle', box: [X(cx - b), Y(cy - b * 0.6), X(cx + b), Y(cy + b * 0.6)] });
      }
    }
    return {
      draws: batches(ctx, [], mesh, [], false),
      hit: emptyHit(),
      labels,
      legend: legendKeys.map((k) => ({ key: k, color: ctx.categorical(k) })),
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const t = tiles.find((q) => Math.hypot(q.cx - x, q.cy - y) <= 0.5);
        if (!t) return null;
        const row = table.row(t.row);
        return {
          title: kf ? String(row[kf]) : `${row[layer.encode.x!]}, ${row[layer.encode.y!]}`,
          rows: cf ? [{ label: fieldLabel(ctx, cf), value: numeric ? ctx.format(row[cf] as number, cf) : String(row[cf]) }] : [],
        };
      },
    };
  },
};

// ---------------------------------------------------------------- pictorial

/** `pictorial`: one row of symbols per `key`, each worth `style.unit` of `value`; the last one partly filled. */
export const pictorial: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'pictorial');
    const vf = layer.encode.value ?? need(layer, 'x', 'pictorial');
    const items = totals(table, kf, vf).filter((d) => d.value > 0);
    // At most a few hundred symbols per row: a bigger value makes each symbol worth more (the caption says how much).
    const top = Math.max(0, ...items.map((d) => d.value));
    const unit = Math.max(style.unit > 0 ? style.unit : 1, top / 200);
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const nameW = Math.max(...items.map((d) => textWidth(d.key, `600 12px ${theme.font.family}`)), 0) + 18;
    const valueW = 64;
    const maxN = Math.max(1, ...items.map((d) => Math.ceil(d.value / unit)));
    const rowH = Math.min(46, H / Math.max(1, items.length));
    const step = Math.min(rowH * 0.9, (W - nameW - valueW) / maxN);
    const size = step * (1 - style.gap);
    const shape = SHAPES[style.icon as PointShape] ?? SHAPES.circle;
    const track = parseColor(theme.grid.y.color);
    const out: number[] = [];
    const labels: MarkLabel[] = [];
    const surface = ctx.surface;
    const base = layer.style?.color ? parseColor(layer.style.color) : undefined;
    items.forEach((d, i) => {
      const cy = 1 - (i + 0.5) * rowH * py;
      const n = d.value / unit;
      const c = ctx.paint(base ?? (layer.encode.color ? ctx.categorical(d.key) : ctx.categorical(fieldLabel(ctx, vf))), d.row);
      labels.push({ tx: 0, ty: cy, text: d.key, color: theme.text.primary, size: 12, weight: 600, align: 'left', baseline: 'middle' });
      for (let k = 0; k < Math.ceil(n); k++) {
        const x = (nameW + (k + 0.5) * step) * px;
        const frac = Math.min(1, n - k);
        // A partial symbol: its share drawn in full color over a light one.
        if (frac < 0.999) out.push(x, cy, size, shape, track[0], track[1], track[2], track[3], 0, 0, 0, 0, 0);
        out.push(x, cy, size * (frac < 0.999 ? Math.sqrt(frac) : 1), shape, c[0], c[1], c[2], c[3], surface[0], surface[1], surface[2], 0, 0);
      }
      labels.push({ tx: (nameW + Math.ceil(n) * step) * px, ty: cy, text: ctx.format(d.value, vf), color: theme.text.secondary, size: 11, align: 'left', baseline: 'middle', dx: 8 });
    });
    labels.push({ tx: 1, ty: 0, text: `1 symbole = ${ctx.format(unit, vf)}`, color: theme.text.muted, size: 10, align: 'right', baseline: 'bottom', dy: -2 });
    return {
      draws: [{ batch: batch(ctx, 'point', out), enter: 'fade' }],
      hit: emptyHit(),
      labels,
      legend: layer.encode.color ? items.map((d) => ({ key: d.key, color: ctx.categorical(d.key) })) : [],
      pick(tx, ty): ShapeHit | null {
        const i = Math.floor((1 - ty) / py / rowH);
        const d = items[i];
        if (!d) return null;
        const total = items.reduce((a, q) => a + q.value, 0);
        return { title: d.key, rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(d.value, vf) }, { label: 'Part', value: share(d.value, total) }] };
      },
    };
  },
};

// ------------------------------------------------------------------ surface

/** Segments where a grid crosses `level` (marching squares), in grid coordinates. */
export function contourSegments(g: Float64Array, nx: number, ny: number, level: number): number[] {
  const out: number[] = [];
  const at = (i: number, j: number) => g[j * nx + i];
  const lerp = (a: number, b: number) => (level - a) / (b - a);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      if (Number.isNaN(a + b + c + d)) continue;
      const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      // Edge crossing points: bottom (a-b), right (b-c), top (d-c), left (a-d).
      const e = [
        [i + lerp(a, b), j],
        [i + 1, j + lerp(b, c)],
        [i + lerp(d, c), j + 1],
        [i, j + lerp(a, d)],
      ];
      const pairs: Record<number, number[][]> = {
        1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]],
        8: [[2, 3]], 9: [[2, 0]], 10: [[0, 3], [1, 2]], 11: [[2, 1]], 12: [[1, 3]], 13: [[1, 0]], 14: [[0, 3]],
      };
      for (const [p, q] of pairs[idx]) out.push(e[p][0], e[p][1], e[q][0], e[q][1]);
    }
  }
  return out;
}

/**
 * `surface`: a regular grid of `value` at (`x`, `y`), drawn as a smooth color
 * field (the GPU blends between grid points) with `style.contours` iso-lines.
 */
export const surface: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'surface');
    const yf = need(layer, 'y', 'surface');
    const [x0, x1] = extent(numbers(table, xf));
    const [y0, y1] = extent(numbers(table, yf));
    return { x: new LinearScale(x0, x1, fields[xf]?.format), y: new LinearScale(y0, y1, fields[yf]?.format), axes: { x: true, y: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = layer.encode.x!;
    const yf = layer.encode.y!;
    const vf = layer.encode.value ?? layer.encode.color ?? need(layer, 'value', 'surface');
    const xs = numbers(table, xf);
    const ys = numbers(table, yf);
    const vs = numbers(table, vf);
    const ux = [...new Set(Array.from(xs))].filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    const uy = [...new Set(Array.from(ys))].filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    const nx = ux.length, ny = uy.length;
    const ix = new Map(ux.map((v, i) => [v, i]));
    const iy = new Map(uy.map((v, i) => [v, i]));
    const g = new Float64Array(nx * ny).fill(NaN);
    for (let r = 0; r < table.length; r++) {
      const i = ix.get(xs[r]);
      const j = iy.get(ys[r]);
      if (i !== undefined && j !== undefined) g[j * nx + i] = vs[r];
    }
    const [lo, hi] = extent(g);
    const t = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
    // Grid positions follow the actual coordinates (they may be unevenly spaced).
    const PX = (i: number) => ctx.x.norm(ux[Math.min(nx - 1, Math.max(0, i))]);
    const PY = (j: number) => ctx.y.norm(uy[Math.min(ny - 1, Math.max(0, j))]);
    const mesh: number[] = [];
    const color = (i: number, j: number) => ctx.ramp(t(g[j * nx + i]));
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = g[j * nx + i], b = g[j * nx + i + 1], c = g[(j + 1) * nx + i + 1], d = g[(j + 1) * nx + i];
        if (Number.isNaN(a + b + c + d)) continue;
        pushVertex(mesh, PX(i), PY(j), color(i, j));
        pushVertex(mesh, PX(i + 1), PY(j), color(i + 1, j));
        pushVertex(mesh, PX(i + 1), PY(j + 1), color(i + 1, j + 1));
        pushVertex(mesh, PX(i), PY(j), color(i, j));
        pushVertex(mesh, PX(i + 1), PY(j + 1), color(i + 1, j + 1));
        pushVertex(mesh, PX(i), PY(j + 1), color(i, j + 1));
      }
    }
    const lines: number[] = [];
    const labels: MarkLabel[] = [];
    const levels = Math.max(0, Math.round(style.contours));
    const ink = style.contourColor === 'auto' ? withAlpha(parseColor(theme.text.primary), 0.4) : parseColor(style.contourColor);
    // Grid coordinates (fractional) to scale space, through the real positions.
    const gx = (f: number) => {
      const i = Math.min(nx - 2, Math.max(0, Math.floor(f)));
      return PX(i) + (PX(i + 1) - PX(i)) * (f - i);
    };
    const gy = (f: number) => {
      const j = Math.min(ny - 2, Math.max(0, Math.floor(f)));
      return PY(j) + (PY(j + 1) - PY(j)) * (f - j);
    };
    const halo = `rgba(${Math.round(ctx.surface[0] * 255)},${Math.round(ctx.surface[1] * 255)},${Math.round(ctx.surface[2] * 255)},0.75)`;
    for (let k = 1; k <= levels; k++) {
      const level = lo + ((hi - lo) * k) / (levels + 1);
      const segs = contourSegments(g, nx, ny, level);
      for (let s = 0; s < segs.length; s += 4) pushSegment(lines, gx(segs[s]), gy(segs[s + 1]), gx(segs[s + 2]), gy(segs[s + 3]), ink, k % 2 ? 1 : 1.5);
      // One label per level, on its longest-lived stretch: the middle segment.
      if (segs.length && k % 2 === 0) {
        // Spread the labels of successive levels along their lines, so they do not pile up.
        const m = Math.floor(((segs.length / 4) * (0.15 + ((k * 0.382) % 0.7)))) * 4;
        labels.push({ tx: gx(segs[m]), ty: gy(segs[m + 1]), text: ctx.format(level, vf), color: theme.text.primary, size: 10, weight: 600, align: 'center', baseline: 'middle', background: halo });
      }
    }
    const draws = batches(ctx, [], mesh, [], false);
    if (lines.length) draws.push({ batch: batch(ctx, 'line', lines) });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const i = ux.reduce((b, v, k) => (Math.abs(v - x) < Math.abs(ux[b] - x) ? k : b), 0);
        const j = uy.reduce((b, v, k) => (Math.abs(v - y) < Math.abs(uy[b] - y) ? k : b), 0);
        const v = g[j * nx + i];
        if (Number.isNaN(v)) return null;
        return {
          title: `${fieldLabel(ctx, xf)} ${ctx.format(ux[i], xf)} · ${fieldLabel(ctx, yf)} ${ctx.format(uy[j], yf)}`,
          rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(v, vf) }],
        };
      },
    };
  },
};

// ------------------------------------------------------------------ horizon

/**
 * `horizon`: one thin row per `key`, the `y` series folded into `style.bands`
 * layers of growing intensity (negative values in the opposite hue). Many
 * series compared in little height.
 */
export const horizon: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales({ layer, table, fields }) {
    const xf = need(layer, 'x', 'horizon');
    const col = table.column(xf);
    const [x0, x1] = extent(col.values as Float64Array);
    return { x: col.type === 'time' ? new TimeScale(x0, x1) : new LinearScale(x0, x1, fields[xf]?.format), y: new LinearScale(0, 1), axes: { x: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'horizon');
    const xf = layer.encode.x!;
    const yf = layer.encode.y ?? need(layer, 'value', 'horizon');
    const keys = table.column(kf).values;
    const xs = table.column(xf).values as Float64Array;
    const ys = numbers(table, yf);
    const series = categoriesOf(table, kf).filter((k) => !ctx.hidden.has(k));
    const B = Math.max(1, Math.round(style.bands));
    const maxAbs = Math.max(...Array.from(ys).filter((v) => !Number.isNaN(v)).map(Math.abs), 1e-12);
    const step = maxAbs / B;
    const n = series.length;
    const rowH = 1 / Math.max(1, n);
    const gap = style.gap * ctx.pixel[1];
    const pos = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(fieldLabel(ctx, yf));
    const neg = parseColor(theme.marks.kpi.bad);
    const mesh: number[] = [];
    const labels: MarkLabel[] = [];
    const data = series.map((s, si) => {
      const idx: number[] = [];
      for (let i = 0; i < table.length; i++) if (String(keys[i]) === s && !Number.isNaN(ys[i])) idx.push(i);
      idx.sort((a, b) => xs[a] - xs[b]);
      return { s, si, idx };
    });
    for (const { s, si, idx } of data) {
      const y0 = 1 - (si + 1) * rowH + gap / 2;
      const h = rowH - gap;
      for (let b = 0; b < B; b++) {
        // Darker for each band further from zero.
        const k = (b + 1) / B;
        const cp = mix(ctx.surface, pos, 0.25 + 0.75 * k);
        const cn = mix(ctx.surface, neg, 0.25 + 0.75 * k);
        for (let q = 0; q < idx.length - 1; q++) {
          const ra = idx[q], rb = idx[q + 1];
          const xa = ctx.x.norm(xs[ra]), xb = ctx.x.norm(xs[rb]);
          for (const sign of [1, -1]) {
            const fa = Math.max(0, Math.min(1, (sign * ys[ra] - b * step) / step));
            const fb = Math.max(0, Math.min(1, (sign * ys[rb] - b * step) / step));
            if (fa <= 0 && fb <= 0) continue;
            const c = ctx.paint(sign > 0 ? cp : cn, ra);
            pushVertex(mesh, xa, y0, c);
            pushVertex(mesh, xa, y0 + fa * h, c);
            pushVertex(mesh, xb, y0 + fb * h, c);
            pushVertex(mesh, xa, y0, c);
            pushVertex(mesh, xb, y0 + fb * h, c);
            pushVertex(mesh, xb, y0, c);
          }
        }
      }
      labels.push({ tx: 0, ty: y0 + h, text: s, color: theme.text.primary, size: 11, weight: 600, align: 'left', baseline: 'top', dx: 4, dy: 3, background: theme.background });
    }
    return {
      draws: batches(ctx, [], mesh, [], false),
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const si = Math.floor((1 - ty) / rowH);
        const d = data[si];
        if (!d || !d.idx.length) return null;
        const x = ctx.x.invert(tx);
        const r = d.idx.reduce((b, i) => (Math.abs(xs[i] - x) < Math.abs(xs[b] - x) ? i : b), d.idx[0]);
        const col = table.column(xf);
        return {
          title: d.s,
          rows: [
            { label: fieldLabel(ctx, xf), value: col.type === 'time' ? new Date(xs[r]).toLocaleDateString() : ctx.format(xs[r], xf) },
            { label: fieldLabel(ctx, yf), value: ctx.format(ys[r], yf) },
          ],
        };
      },
    };
  },
};

// ------------------------------------------------------------- polar heatmap

/**
 * `polarHeatmap`: a heatmap on rings: `x` categories around the circle (hours,
 * months), `y` categories from the center out (days, years), colored by `value`.
 */
export const polarHeatmap: MarkDefinition = {
  standalone: true,
  // Which labels fit depends on the size in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(-1.16, 1.16), y: new LinearScale(-1.16, 1.16), aspect: 1 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = need(layer, 'x', 'polarHeatmap');
    const yf = need(layer, 'y', 'polarHeatmap');
    const vf = layer.encode.value ?? need(layer, 'color', 'polarHeatmap');
    const xc = categoriesOf(table, xf);
    const yc = categoriesOf(table, yf);
    const xv = table.column(xf).values;
    const yv = table.column(yf).values;
    const vals = numbers(table, vf);
    const [lo, hi] = extent(vals);
    const r0 = style.innerRadius;
    const ring = (1 - r0) / Math.max(1, yc.length);
    const step = (Math.PI * 2) / Math.max(1, xc.length);
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const [cx, cy] = [ctx.x.norm(0), ctx.y.norm(0)];
    const arcs: number[] = [];
    const labels: MarkLabel[] = [];
    const cells = new Map<string, number>();
    for (let i = 0; i < table.length; i++) {
      const a = xc.indexOf(String(xv[i]));
      const b = yc.indexOf(String(yv[i]));
      if (a < 0 || b < 0 || Number.isNaN(vals[i])) continue;
      cells.set(`${a}|${b}`, i);
      const fill = ctx.paint(valueColor(ctx, vals[i], lo, hi, false), i);
      pushArc(arcs, cx, cy, (r0 + ring * b) * unit, (r0 + ring * (b + 1)) * unit, a * step, (a + 1) * step, style.gap, fill, 2);
    }
    // Categories around the outside; rings named along 12 o'clock. Small, only as many as fit:
    // one in k (a label needs its height for a ring, its width around the circle), none when even that fails.
    const px = unit / ctx.pixel[0];
    const size = px < 140 ? 9 : 10;
    const ringPx = ring * px;
    // A ring label is its text plus the pill behind it (2.5 px above and below).
    const ringEvery = Math.ceil((size + 6) / Math.max(ringPx, 0.01));
    const longest = Math.max(...xc.map((n) => textWidth(n, `${size}px ${theme.font.family}`)), 1);
    const arcPx = step * 1.08 * px;
    const aroundEvery = Math.ceil((longest + 6) / Math.max(arcPx, 0.01));
    const ringsNamed = ringEvery <= Math.max(2, yc.length / 2);
    if (aroundEvery <= Math.max(2, xc.length / 4)) {
      xc.forEach((name, a) => {
        if (a % aroundEvery) return;
        const m = (a + 0.5) * step;
        // The ring names run up the left of 12 o'clock: no category label there to collide with.
        if (ringsNamed && m > Math.PI * 2 - 0.5) return;
        labels.push({ tx: ctx.x.norm(Math.sin(m) * 1.08), ty: ctx.y.norm(Math.cos(m) * 1.08), text: name, color: theme.text.muted, size, align: 'center', baseline: 'middle' });
      });
    }
    // In the hole: what the colors measure, from the lowest value to the highest.
    if (r0 * px * 2 >= 64) {
      labels.push({ tx: ctx.x.norm(0), ty: ctx.y.norm(0), text: fieldLabel(ctx, vf), color: theme.text.muted, size, align: 'center', baseline: 'bottom', dy: -1 });
      labels.push({ tx: ctx.x.norm(0), ty: ctx.y.norm(0), text: `${ctx.format(lo, vf)} – ${ctx.format(hi, vf)}`, color: theme.text.primary, size, weight: 650, align: 'center', baseline: 'top', dy: 2 });
    }
    if (ringsNamed) {
      yc.forEach((name, b) => {
        if (b % ringEvery) return;
        const r = r0 + ring * (b + 0.5);
        labels.push({ tx: ctx.x.norm(0), ty: ctx.y.norm(r), text: name, color: theme.text.secondary, size, weight: 600, align: 'right', baseline: 'middle', dx: -4, background: theme.background });
      });
    }
    return {
      draws: [{ batch: batch(ctx, 'arc', arcs) }],
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const r = Math.hypot(x, y);
        if (r < r0 || r > 1) return null;
        const a = Math.floor((((Math.atan2(x, y) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / step);
        const b = Math.floor((r - r0) / ring);
        const row = cells.get(`${a}|${b}`);
        if (row === undefined) return null;
        return { title: `${xc[a]} · ${yc[b]}`, rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(vals[row], vf) }] };
      },
    };
  },
};

// -------------------------------------------------------- scatter matrix

/**
 * `splom`: every pair of the `path` fields as a small scatter plot, the
 * distribution of each field on the diagonal; `color` as on `point`.
 */
export const splom: MarkDefinition = {
  standalone: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const fields = layer.encode.path;
    if (!fields?.length) throw new Error('futurCharts: mark "splom" needs encode.path (the fields to compare).');
    const n = fields.length;
    const cols = fields.map((f) => numbers(table, f));
    const ext = cols.map((c) => {
      const [lo, hi] = extent(c);
      const pad = (hi - lo) * 0.06 || 1;
      return [lo - pad, hi + pad] as [number, number];
    });
    const gf = layer.encode.color;
    const groups = gf ? table.column(gf).values : undefined;
    const legendKeys: string[] = [];
    const color = (i: number): RGBA => {
      if (!groups) return ctx.paint(ctx.categorical(fieldLabel(ctx, fields[0])), i);
      const g = String(groups[i]);
      if (!legendKeys.includes(g)) legendKeys.push(g);
      return ctx.paint(ctx.categorical(g), i);
    };
    // Room for the field names: left column and bottom row.
    const [px, py] = ctx.pixel;
    // The names sit on the diagonal: no room needed along the edges.
    const left = 0;
    const bottom = 0;
    const cw = (1 - left) / n;
    const ch = (1 - bottom) / n;
    const gap = 6;
    const cell = (i: number, j: number) => ({ x0: left + j * cw + gap * px, x1: left + (j + 1) * cw - gap * px, y0: 1 - (i + 1) * ch + gap * py, y1: 1 - i * ch - gap * py });
    const pts: number[] = [];
    const rects: number[] = [];
    const labels: MarkLabel[] = [];
    const frame = parseColor(theme.grid.y.color);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const b = cell(i, j);
        pushRect(rects, { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, fill: withAlpha(frame, 0.25), radii: [3, 3, 3, 3] });
        if (i === j) {
          // Histogram of the field.
          const v = cols[i];
          const [lo, hi] = ext[i];
          const counts = new Array(style.bins).fill(0);
          for (const x of v) if (!Number.isNaN(x)) counts[Math.min(style.bins - 1, Math.floor(((x - lo) / (hi - lo)) * style.bins))]++;
          const max = Math.max(...counts, 1);
          const bw = (b.x1 - b.x0) / style.bins;
          const c = ctx.categorical(fieldLabel(ctx, fields[0]));
          counts.forEach((k, q) => {
            if (!k) return;
            pushRect(rects, { x0: b.x0 + q * bw, y0: b.y0, x1: b.x0 + (q + 1) * bw, y1: b.y0 + ((b.y1 - b.y0) * k) / max * 0.85, fill: withAlpha(c, 0.75), gap: 1, axis: 0 });
          });
          labels.push({ tx: b.x0, ty: b.y1, text: fieldLabel(ctx, fields[i]), color: theme.text.primary, size: 11, weight: 650, align: 'left', baseline: 'top', dx: 5, dy: 4, box: [b.x0, b.y0, b.x1, b.y1] });
          continue;
        }
        const xs = cols[j], ys = cols[i];
        const [x0, x1] = ext[j], [y0, y1] = ext[i];
        for (let r = 0; r < table.length; r++) {
          if (Number.isNaN(xs[r] + ys[r])) continue;
          const c = color(r);
          pts.push(b.x0 + ((xs[r] - x0) / (x1 - x0)) * (b.x1 - b.x0), b.y0 + ((ys[r] - y0) / (y1 - y0)) * (b.y1 - b.y0), style.size, 0, c[0], c[1], c[2], c[3] * style.opacity, 0, 0, 0, 0, 0);
        }
      }
    }
    const draws = batches(ctx, rects, [], [], false);
    draws.push({ batch: batch(ctx, 'point', pts), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend: legendKeys.map((k) => ({ key: k, color: ctx.categorical(k) })),
      pick(tx, ty): ShapeHit | null {
        const j = Math.floor((tx - left) / cw);
        const i = Math.floor((1 - ty) / ch);
        if (i < 0 || j < 0 || i >= n || j >= n || i === j) return null;
        const b = cell(i, j);
        const [x0, x1] = ext[j], [y0, y1] = ext[i];
        let best = -1, bd = 8;
        for (let r = 0; r < table.length; r++) {
          const x = b.x0 + ((cols[j][r] - x0) / (x1 - x0)) * (b.x1 - b.x0);
          const y = b.y0 + ((cols[i][r] - y0) / (y1 - y0)) * (b.y1 - b.y0);
          const d = Math.hypot((x - tx) / px, (y - ty) / py);
          if (d < bd) [best, bd] = [r, d];
        }
        if (best < 0) return null;
        const rows = fields.map((f, k) => ({ label: fieldLabel(ctx, f), value: ctx.format(cols[k][best], f) }));
        return { title: gf ? String(groups![best]) : `Ligne ${best + 1}`, rows };
      },
    };
  },
};

// -------------------------------------------------------------- 3D scatter

/**
 * `scatter3d`: points in a box (`x`, `y`, `z`), seen in perspective. Drag to
 * turn it; until then it spins slowly (`style.spin`). The projection is done on
 * the CPU each frame and the dots drawn by the GPU, back to front.
 */
export const scatter3d: MarkDefinition = {
  standalone: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(-1.25, 1.25), y: new LinearScale(-1.15, 1.15), aspect: 2.5 / 2.3 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = need(layer, 'x', 'scatter3d'), yf = need(layer, 'y', 'scatter3d'), zf = need(layer, 'z', 'scatter3d');
    const X = numbers(table, xf), Y = numbers(table, yf), Z = numbers(table, zf);
    const ex = extent(X), ey = extent(Y), ez = extent(Z);
    const norm = (v: number, [lo, hi]: [number, number]) => (hi > lo ? ((v - lo) / (hi - lo)) * 2 - 1 : 0);
    const gf = layer.encode.color;
    const gcol = gf ? table.column(gf) : undefined;
    const numericColor = !!gcol && gcol.type !== 'string';
    const [c0, c1] = numericColor ? extent(gcol!.values as Float64Array) : [0, 1];
    const legendKeys: string[] = [];
    const pts = Array.from({ length: table.length }, (_, i) => {
      let c: RGBA;
      if (!gcol) c = ctx.ramp(0.25 + 0.7 * ((norm(Z[i], ez) + 1) / 2));
      else if (numericColor) c = ctx.ramp(c1 > c0 ? ((gcol.values[i] as number) - c0) / (c1 - c0) : 0.5);
      else {
        const g = String(gcol.values[i]);
        if (!legendKeys.includes(g)) legendKeys.push(g);
        c = ctx.categorical(g);
      }
      return { x: norm(X[i], ex), y: norm(Y[i], ey), z: norm(Z[i], ez), c: ctx.paint(c, i), row: i, ok: !Number.isNaN(X[i] + Y[i] + Z[i]) };
    }).filter((p) => p.ok);
    let yaw = (ctx.state.yaw as number | undefined) ?? -0.7;
    let pitch = (ctx.state.pitch as number | undefined) ?? 0.42;
    let spinning = style.spin && ctx.state.yaw === undefined;
    let last = 0;
    const scale = 0.5;
    // Project a point of the [-1, 1]³ box: turn (yaw around the vertical axis, then pitch), then perspective.
    const project = (x: number, y: number, z: number) => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      // Perspective: 1 at the center of the box, larger in front; `scale` keeps the nearest corner in the frame.
      const p = Math.max(2, style.perspective);
      const k = p / (p + z2);
      return { sx: ctx.x.norm(x1 * k * scale), sy: ctx.y.norm(y2 * k * scale), depth: z2, k };
    };
    const dots = ctx.renderer.createBatch('point');
    const lines = ctx.renderer.createBatch('line');
    const labels: MarkLabel[] = [];
    let shown: { sx: number; sy: number; i: number; size: number }[] = [];
    const grid = parseColor(theme.grid.y.color);
    const axis = parseColor(theme.axis.line.color);
    const render = () => {
      // Box: the floor grid and the back edges.
      const seg: number[] = [];
      const edge = (a: number[], b: number[], c: RGBA, w: number) => {
        const p = project(a[0], a[1], a[2]);
        const q = project(b[0], b[1], b[2]);
        pushSegment(seg, p.sx, p.sy, q.sx, q.sy, c, w);
      };
      for (let k = -1; k <= 1.0001; k += 0.5) {
        edge([k, -1, -1], [k, -1, 1], grid, 1);
        edge([-1, -1, k], [1, -1, k], grid, 1);
      }
      const corners = [-1, 1];
      for (const a of corners) for (const b of corners) {
        edge([a, -1, b], [a, 1, b], withAlpha(axis, 0.35), 1);
        edge([a, 1, -1], [a, 1, 1], withAlpha(axis, 0.2), 1);
        edge([-1, 1, a], [1, 1, a], withAlpha(axis, 0.2), 1);
      }
      lines.update(new Float32Array(seg), seg.length / LAYOUTS.line.stride);
      const proj = pts.map((p, i) => ({ ...project(p.x, p.y, p.z), i }));
      // Back to front, so near dots cover far ones.
      proj.sort((a, b) => b.depth - a.depth);
      const out: number[] = [];
      const sf = ctx.surface;
      shown = [];
      for (const p of proj) {
        const c = pts[p.i].c;
        const size = style.size * p.k;
        out.push(p.sx, p.sy, size, 0, c[0], c[1], c[2], c[3] * style.opacity, sf[0], sf[1], sf[2], 0.8, 0.75);
        shown.push({ sx: p.sx, sy: p.sy, i: p.i, size });
      }
      dots.update(new Float32Array(out), proj.length);
      // Axis names at the far ends of three edges.
      labels.length = 0;
      const name = (pos: number[], text: string) => {
        const p = project(pos[0], pos[1], pos[2]);
        labels.push({ tx: p.sx, ty: p.sy, text, color: theme.text.muted, size: 11, weight: 600, align: 'center', baseline: 'middle', background: theme.background });
      };
      name([1.18, -1, -1], fieldLabel(ctx, xf));
      name([-1, 1.12, -1], fieldLabel(ctx, yf));
      name([-1, -1, 1.18], fieldLabel(ctx, zf));
    };
    render();
    let dragFrom: { tx: number; ty: number; yaw: number; pitch: number } | undefined;
    return {
      draws: [{ batch: lines, enter: 'fade' }, { batch: dots, enter: 'fade' }],
      hit: emptyHit(),
      labels,
      legend: legendKeys.map((k) => ({ key: k, color: ctx.categorical(k) })),
      animate(now) {
        if (!spinning) return false;
        if (last) yaw += (now - last) * 0.00025;
        last = now;
        render();
        return true;
      },
      drag: {
        start(tx, ty) {
          spinning = false;
          dragFrom = { tx, ty, yaw, pitch };
          return true;
        },
        move(tx, ty) {
          if (!dragFrom) return;
          yaw = dragFrom.yaw + (tx - dragFrom.tx) * 4;
          pitch = Math.max(-1.4, Math.min(1.4, dragFrom.pitch - (ty - dragFrom.ty) * 4));
          ctx.state.yaw = yaw;
          ctx.state.pitch = pitch;
          render();
        },
        end() {
          dragFrom = undefined;
          return {};
        },
      },
      pick(tx, ty): ShapeHit | null {
        // The nearest dot on top (the list is back to front).
        for (let k = shown.length - 1; k >= 0; k--) {
          const p = shown[k];
          if (Math.hypot((p.sx - tx) / ctx.pixel[0], (p.sy - ty) / ctx.pixel[1]) <= p.size / 2 + 2) {
            const r = pts[p.i].row;
            const row = table.row(r);
            return {
              title: gf && !numericColor ? String(row[gf]) : `Point ${r + 1}`,
              rows: [xf, yf, zf].map((f) => ({ label: fieldLabel(ctx, f), value: ctx.format(row[f] as number, f) })),
            };
          }
        }
        return null;
      },
    };
  },
};

// -------------------------------------------------------------------- globe

type Ring = [number, number][];
function ringsOf(geo: unknown): Ring[] {
  const out: Ring[] = [];
  const walk = (g: any) => {
    if (!g) return;
    if (g.type === 'FeatureCollection') g.features.forEach((f: any) => walk(f.geometry));
    else if (g.type === 'Feature') walk(g.geometry);
    else if (g.type === 'Polygon') g.coordinates.forEach((r: Ring) => out.push(r));
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((p: Ring[]) => p.forEach((r) => out.push(r)));
  };
  walk(geo);
  return out;
}

/**
 * `globe`: the Earth in orthographic projection: country outlines from
 * `layer.geo`, points at (`x` longitude, `y` latitude), and great-circle routes
 * to (`x2`, `y2`). Drag to turn it; it spins on its own until then.
 */
export const globe: MarkDefinition = {
  standalone: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(-1.06, 1.06), y: new LinearScale(-1.06, 1.06), aspect: 1 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const rings = ringsOf(layer.geo);
    const xf = layer.encode.x, yf = layer.encode.y;
    const lon = xf ? numbers(table, xf) : undefined;
    const lat = yf ? numbers(table, yf) : undefined;
    const lon2 = layer.encode.x2 ? numbers(table, layer.encode.x2) : undefined;
    const lat2 = layer.encode.y2 ? numbers(table, layer.encode.y2) : undefined;
    const gf = layer.encode.color;
    const legendKeys: string[] = [];
    const colors = Array.from({ length: table.length }, (_, i) => {
      if (!gf) return ctx.paint(ctx.categorical(fieldLabel(ctx, xf ?? 'globe')), i);
      const g = String(table.column(gf).values[i]);
      if (!legendKeys.includes(g)) legendKeys.push(g);
      return ctx.paint(ctx.categorical(g), i);
    });
    const D = Math.PI / 180;
    let lambda = (ctx.state.lambda as number | undefined) ?? -10;
    let phi = (ctx.state.phi as number | undefined) ?? 25;
    let spinning = style.spin && ctx.state.lambda === undefined;
    let last = 0;
    const R = 1;
    /** Orthographic projection; `v` > 0 on the visible hemisphere. */
    const project = (lo: number, la: number) => {
      const l = (lo - lambda) * D, p = la * D, p0 = phi * D;
      const cp = Math.cos(p);
      const v = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * cp * Math.cos(l);
      return { x: ctx.x.norm(R * cp * Math.sin(l)), y: ctx.y.norm(R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * cp * Math.cos(l))), v };
    };
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    // The sea: a hint of the first palette color over the surface.
    const ocean = style.ocean === 'auto' ? mix(ctx.surface, parseColor(theme.palette.categorical[0]), 0.08) : parseColor(style.ocean);
    const landInk = parseColor(style.land === 'auto' ? theme.axis.line.color : style.land);
    const disc = ctx.renderer.createBatch('arc');
    disc.update(new Float32Array([ctx.x.norm(0), ctx.y.norm(0), 0, R * unit, 0, Math.PI * 2, 0, 0, ocean[0], ocean[1], ocean[2], 1]), 1);
    const lines = ctx.renderer.createBatch('line');
    const dots = ctx.renderer.createBatch('point');
    let shown: { x: number; y: number; i: number }[] = [];
    const render = () => {
      const seg: number[] = [];
      // A polyline on the sphere: only the stretches on the visible side.
      const path = (pts: Ring, c: RGBA, w: number) => {
        let prev = project(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) {
          const cur = project(pts[k][0], pts[k][1]);
          if (prev.v > 0 && cur.v > 0) pushSegment(seg, prev.x, prev.y, cur.x, cur.y, c, w);
          prev = cur;
        }
      };
      if (style.graticule) {
        const g = withAlpha(parseColor(theme.grid.y.color), 0.9);
        for (let lo = -180; lo < 180; lo += 30) path(Array.from({ length: 37 }, (_, k) => [lo, -90 + k * 5] as [number, number]), g, 0.75);
        for (let la = -60; la <= 60; la += 30) path(Array.from({ length: 73 }, (_, k) => [-180 + k * 5, la] as [number, number]), g, 0.75);
      }
      for (const ring of rings) path(ring, landInk, 0.9);
      // Routes: great circles (spherical interpolation), on the visible side.
      if (lon && lat && lon2 && lat2) {
        for (let i = 0; i < table.length; i++) {
          const a = [lon[i] * D, lat[i] * D], b = [lon2[i] * D, lat2[i] * D];
          if (a.some(Number.isNaN) || b.some(Number.isNaN)) continue;
          const va = [Math.cos(a[1]) * Math.cos(a[0]), Math.cos(a[1]) * Math.sin(a[0]), Math.sin(a[1])];
          const vb = [Math.cos(b[1]) * Math.cos(b[0]), Math.cos(b[1]) * Math.sin(b[0]), Math.sin(b[1])];
          const w = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
          const steps = Math.max(8, Math.round(w * 30));
          const pts: Ring = [];
          for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            const s0 = w > 1e-6 ? Math.sin((1 - t) * w) / Math.sin(w) : 1 - t;
            const s1 = w > 1e-6 ? Math.sin(t * w) / Math.sin(w) : t;
            const v = va.map((q, j) => q * s0 + vb[j] * s1);
            pts.push([Math.atan2(v[1], v[0]) / D, Math.atan2(v[2], Math.hypot(v[0], v[1])) / D]);
          }
          path(pts, withAlpha(colors[i], 0.75), 1.6);
        }
      }
      lines.update(new Float32Array(seg), seg.length / LAYOUTS.line.stride);
      const out: number[] = [];
      shown = [];
      const sf = ctx.surface;
      if (lon && lat) {
        for (let i = 0; i < table.length; i++) {
          const p = project(lon[i], lat[i]);
          if (!(p.v > 0)) continue;
          const c = colors[i];
          out.push(p.x, p.y, style.size, 0, c[0], c[1], c[2], c[3], sf[0], sf[1], sf[2], 1, 1.5);
          shown.push({ x: p.x, y: p.y, i });
        }
      }
      dots.update(new Float32Array(out), shown.length);
    };
    render();
    let from: { tx: number; ty: number; lambda: number; phi: number } | undefined;
    return {
      draws: [{ batch: disc, enter: 'fade' }, { batch: lines, enter: 'fade' }, { batch: dots, enter: 'fade' }],
      hit: emptyHit(),
      labels: [],
      legend: legendKeys.map((k) => ({ key: k, color: ctx.categorical(k) })),
      animate(now) {
        if (!spinning) return false;
        if (last) lambda -= (now - last) * 0.006;
        last = now;
        render();
        return true;
      },
      drag: {
        start(tx, ty) {
          if (Math.hypot(ctx.x.invert(tx), ctx.y.invert(ty)) > R) return false;
          spinning = false;
          from = { tx, ty, lambda, phi };
          return true;
        },
        move(tx, ty) {
          if (!from) return;
          lambda = from.lambda - (tx - from.tx) * 180;
          phi = Math.max(-80, Math.min(80, from.phi - (ty - from.ty) * 180));
          ctx.state.lambda = lambda;
          ctx.state.phi = phi;
          render();
        },
        end() {
          from = undefined;
          return {};
        },
      },
      pick(tx, ty): ShapeHit | null {
        const hit = shown.find((p) => Math.hypot((p.x - tx) / ctx.pixel[0], (p.y - ty) / ctx.pixel[1]) <= style.size / 2 + 3);
        if (!hit) return null;
        const row = table.row(hit.i);
        const title = layer.encode.key ? String(row[layer.encode.key]) : gf ? String(row[gf]) : `${row[xf!]}, ${row[yf!]}`;
        return { title, rows: gf ? [{ label: fieldLabel(ctx, gf), value: String(row[gf]) }] : [] };
      },
    };
  },
};

export const ADVANCED_MARKS: Record<string, MarkDefinition> = { ridgeline, beeswarm, tilemap, pictorial, surface, horizon, polarHeatmap, splom, scatter3d, globe };
