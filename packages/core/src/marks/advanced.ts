/**
 * Ridgeline, beeswarm, tile map, pictorial (unit) chart, interpolated surface
 * with contours and horizon chart: standalone marks drawn with the shared primitives.
 */
import { LAYOUTS, SHAPES, type PointShape } from '../render/layouts';
import type { RGBA } from '../render/types';
import { BandScale, LinearScale, TimeScale, niceDomain } from '../scale/scales';
import type { Table } from '../data/table';
import { mix, parseColor, withAlpha } from '../util/color';
import { batches, categoriesOf, need, share, totals } from './charts';
import { pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;

function batch(ctx: BuildContext, kind: 'point' | 'line' | 'mesh' | 'rect', data: number[]) {
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
    const unit = style.unit > 0 ? style.unit : 1;
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

export const ADVANCED_MARKS: Record<string, MarkDefinition> = { ridgeline, beeswarm, tilemap, pictorial, surface, horizon };
