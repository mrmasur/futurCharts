/** Stat tile (KPI), waffle and polar bars (rose): standalone marks. */
import { LAYOUTS } from '../render/layouts';
import { LinearScale } from '../scale/scales';
import { parseColor, withAlpha } from '../util/color';
import { batches, categoriesOf, need, share, totals } from './charts';
import { pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------- kpi

/**
 * `kpi`: the latest `value` in big, its change against the previous row, and
 * a sparkline of the whole series (ordered by `x` when given).
 */
export const kpi: MarkDefinition = {
  standalone: true,
  symbol: 'line',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const vf = layer.encode.value ?? need(layer, 'y', 'kpi');
    const xf = layer.encode.x;
    const vals = table.column(vf).values as Float64Array;
    const order = Array.from({ length: table.length }, (_, i) => i).filter((i) => !Number.isNaN(vals[i]));
    const xcol = xf ? table.column(xf) : undefined;
    if (xcol && xcol.type !== 'string') order.sort((a, b) => (xcol.values[a] as number) - (xcol.values[b] as number));
    const series = order.map((i) => vals[i]);
    const last = series[series.length - 1] ?? NaN;
    const prev = series[series.length - 2] ?? NaN;
    const labels: MarkLabel[] = [
      { tx: 0, ty: 1, text: ctx.format(last, vf), color: theme.text.primary, size: style.size, weight: 650, align: 'left', baseline: 'top', dx: 2 },
    ];
    if (Number.isFinite(prev) && prev !== 0) {
      const d = (last - prev) / Math.abs(prev);
      const pct = new Intl.NumberFormat(undefined, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(d));
      // Color = direction × whether up is good; the arrow keeps it readable without color.
      const color = d === 0 ? theme.text.muted : d > 0 === style.upIsGood ? style.good : style.bad;
      labels.push({
        tx: 0, ty: 1, text: `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${pct}  vs précédent`, color, size: 13, weight: 600,
        align: 'left', baseline: 'top', dx: 2, dy: style.size + 10,
      });
    }

    const draws = [];
    const n = series.length;
    const top = 0.42;
    const bottom = 0.02;
    let pts: [number, number][] = [];
    if (style.sparkline && n > 1) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of series) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      const accent = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(ctx.fields[vf]?.label ?? vf);
      pts = series.map((v, i) => [0.01 + (0.98 * i) / (n - 1), bottom + (top - bottom) * (hi > lo ? (v - lo) / (hi - lo) : 0.5)]);
      const lines: number[] = [];
      const mesh: number[] = [];
      const wash = withAlpha(accent, 0.1);
      for (let i = 0; i < n - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        pushSegment(lines, ax, ay, bx, by, accent, 2);
        pushVertex(mesh, ax, ay, wash);
        pushVertex(mesh, bx, by, wash);
        pushVertex(mesh, bx, bottom, wash);
        pushVertex(mesh, ax, ay, wash);
        pushVertex(mesh, bx, bottom, wash);
        pushVertex(mesh, ax, bottom, wash);
      }
      draws.push(...batches(ctx, [], mesh, lines));
      const [ex, ey] = pts[n - 1];
      const dot = ctx.renderer.createBatch('point');
      const s = ctx.surface;
      dot.update(new Float32Array([ex, ey, 8, 0, ...accent, s[0], s[1], s[2], s[3], 2]), 1);
      draws.push({ batch: dot });
    }
    const xFormat = (i: number) => {
      if (!xcol) return `#${i + 1}`;
      const v = xcol.values[order[i]];
      return xcol.type === 'time' ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(v as number) : String(v);
    };
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        if (!pts.length || ty > top + 0.06) return null;
        const i = Math.max(0, Math.min(n - 1, Math.round(((tx - 0.01) / 0.98) * (n - 1))));
        return { title: xFormat(i), rows: [{ label: ctx.fields[vf]?.label ?? vf, value: ctx.format(series[i], vf) }] };
      },
    };
  },
};

// ------------------------------------------------------------------- waffle

/** Largest remainder: integer cells that add up to `total`, as close as possible to the shares. */
export function apportion(values: number[], total: number): number[] {
  const sum = values.reduce((a, v) => a + v, 0);
  if (sum <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, v) => a + v, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    out[i]++;
  }
  return out;
}

/** `waffle`: a grid of squares (100 by default), shared between `key` values by `value`. */
export const waffle: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: ({ layer }) => {
    const rows = (layer.style?.rows as number | undefined) ?? 10;
    const columns = (layer.style?.columns as number | undefined) ?? 10;
    return { x: new LinearScale(0, columns), y: new LinearScale(0, rows), aspect: columns / rows };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const kf = layer.encode.key ?? need(layer, 'color', 'waffle');
    const vf = layer.encode.value ?? need(layer, 'y', 'waffle');
    const all = totals(table, kf, vf).filter((d) => d.value > 0);
    const legend = all.map((d) => ({ key: d.key, color: ctx.categorical(d.key) }));
    const shown = all.filter((d) => !ctx.hidden.has(d.key));
    const cells = style.rows * style.columns;
    const counts = apportion(shown.map((d) => d.value), cells);
    const total = shown.reduce((a, d) => a + d.value, 0);
    const owner: number[] = [];
    counts.forEach((c, i) => {
      for (let k = 0; k < c; k++) owner.push(i);
    });
    const rects: number[] = [];
    const gx = (style.gap / 2) * ctx.pixel[0];
    const gy = (style.gap / 2) * ctx.pixel[1];
    const r = style.radius;
    owner.forEach((o, k) => {
      const col = k % style.columns;
      const row = Math.floor(k / style.columns);
      const x0 = ctx.x.norm(col);
      const x1 = ctx.x.norm(col + 1);
      // Fill from the top-left, row by row.
      const y1 = ctx.y.norm(style.rows - row);
      const y0 = ctx.y.norm(style.rows - row - 1);
      const fill = legend.find((l) => l.key === shown[o].key)!.color;
      pushRect(rects, { x0: x0 + gx, y0: y0 + gy, x1: x1 - gx, y1: y1 - gy, fill, radii: [r, r, r, r] });
    });
    return {
      draws: batches(ctx, rects, [], [], false),
      hit: emptyHit(),
      legend,
      pick(tx, ty): ShapeHit | null {
        const col = Math.floor(ctx.x.invert(tx));
        const row = style.rows - 1 - Math.floor(ctx.y.invert(ty));
        if (col < 0 || col >= style.columns || row < 0 || row >= style.rows) return null;
        const o = owner[row * style.columns + col];
        if (o === undefined) return null;
        const d = shown[o];
        return {
          title: d.key,
          rows: [
            { label: ctx.fields[vf]?.label ?? vf, value: ctx.format(d.value, vf) },
            { label: 'Part', value: share(d.value, total) },
          ],
        };
      },
    };
  },
};

// --------------------------------------------------------------------- rose

/**
 * `rose`: one wedge per `key` around the circle, its area proportional to
 * `value`; with `color`, the series are stacked outwards in each wedge.
 */
export const rose: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(-1.32, 1.32), y: new LinearScale(-1.22, 1.22), aspect: 2.64 / 2.44 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'rose');
    const vf = layer.encode.value ?? need(layer, 'y', 'rose');
    const sf = layer.encode.color;
    const cats = categoriesOf(table, kf);
    const data = totals(table, kf, vf, sf);
    const seriesNames = [...new Set(data.map((d) => d.group))];
    const legend = (sf ? seriesNames : cats).map((k) => ({ key: k, color: ctx.categorical(k) }));
    const visible = (sf ? seriesNames : cats).filter((k) => !ctx.hidden.has(k));
    const stackTotal = (cat: string) =>
      data.filter((d) => d.key === cat && (sf ? visible.includes(d.group) : visible.includes(cat))).reduce((a, d) => a + d.value, 0);
    const max = Math.max(1e-9, ...cats.map(stackTotal));
    const R = 1;
    const r0 = style.innerRadius;
    // Area-proportional: the eye reads the wedge's surface, so radius grows with √value.
    const rad = (v: number) => r0 + (R - r0) * Math.sqrt(Math.max(0, v) / max);
    const at = (a: number, r: number): [number, number] => [ctx.x.norm(Math.sin(a) * r), ctx.y.norm(Math.cos(a) * r)];
    const step = TAU / Math.max(1, cats.length);
    const grid = parseColor(theme.grid.y.color);
    const gridLines: number[] = [];
    for (let l = 1; l <= style.levels; l++) {
      const r = rad((max * l) / style.levels);
      for (let k = 0; k < 120; k++) {
        const [ax, ay] = at((TAU * k) / 120, r);
        const [bx, by] = at((TAU * (k + 1)) / 120, r);
        pushSegment(gridLines, ax, ay, bx, by, grid, 1);
      }
    }
    const mesh: number[] = [];
    const lines: number[] = [];
    const labels: MarkLabel[] = [];
    const wedges: { cat: string; series: string; r0: number; r1: number; a0: number; a1: number; value: number }[] = [];
    cats.forEach((cat, k) => {
      const a0 = k * step;
      const a1 = a0 + step;
      let cum = 0;
      const parts = sf ? seriesNames.filter((s) => visible.includes(s)) : visible.includes(cat) ? [''] : [];
      for (const s of parts) {
        const v = data.find((d) => d.key === cat && d.group === s)?.value ?? 0;
        if (v <= 0) continue;
        const ri = rad(cum);
        const ro = rad(cum + v);
        const color = ctx.categorical(sf ? s : cat);
        const steps = Math.max(2, Math.ceil(step / (Math.PI / 90)));
        for (let j = 0; j < steps; j++) {
          const t0 = a0 + (step * j) / steps;
          const t1 = a0 + (step * (j + 1)) / steps;
          const [ox0, oy0] = at(t0, ro);
          const [ox1, oy1] = at(t1, ro);
          const [ix0, iy0] = at(t0, ri);
          const [ix1, iy1] = at(t1, ri);
          pushVertex(mesh, ox0, oy0, color);
          pushVertex(mesh, ox1, oy1, color);
          pushVertex(mesh, ix0, iy0, color);
          pushVertex(mesh, ix0, iy0, color);
          pushVertex(mesh, ox1, oy1, color);
          pushVertex(mesh, ix1, iy1, color);
        }
        wedges.push({ cat, series: s, r0: ri, r1: ro, a0, a1, value: v });
        cum += v;
      }
      if (style.gap > 0) {
        const [sx0, sy0] = at(a0, r0);
        const [sx1, sy1] = at(a0, R + 0.02);
        pushSegment(lines, sx0, sy0, sx1, sy1, ctx.surface, style.gap);
      }
      if (style.labels) {
        const mid = a0 + step / 2;
        const sx = Math.sin(mid);
        const cy = Math.cos(mid);
        const [lx, ly] = at(mid, R + 0.07);
        labels.push({
          tx: lx, ty: ly, text: cat, color: theme.text.secondary, size: 11,
          align: Math.abs(sx) < 0.2 ? 'center' : sx > 0 ? 'left' : 'right',
          baseline: Math.abs(cy) < 0.2 ? 'middle' : cy > 0 ? 'bottom' : 'top',
        });
      }
    });
    const gridBatch = ctx.renderer.createBatch('line');
    gridBatch.update(new Float32Array(gridLines), gridLines.length / LAYOUTS.line.stride);
    return {
      draws: [{ batch: gridBatch }, ...batches(ctx, [], mesh, lines)],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const r = Math.hypot(x, y);
        const a = (Math.atan2(x, y) + TAU) % TAU;
        const w = wedges.find((m) => a >= m.a0 && a < m.a1 && r >= m.r0 && r <= m.r1);
        if (!w) return null;
        const rows = [{ label: ctx.fields[vf]?.label ?? vf, value: ctx.format(w.value, vf) }];
        if (sf) rows.push({ label: 'Total', value: ctx.format(stackTotal(w.cat), vf) });
        return { title: sf ? `${w.cat} · ${w.series}` : w.cat, rows };
      },
    };
  },
};

export const EXTRA_MARKS: Record<string, MarkDefinition> = { kpi, waffle, rose };
