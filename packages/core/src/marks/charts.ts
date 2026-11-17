/**
 * Standalone marks: charts that are not positioned on two data axes, or that
 * bring their own (heatmap, funnel). Each declares its coordinate system
 * through `scales()` and draws with the same primitives as every other mark,
 * so a WebGPU backend renders them unchanged.
 */
import type { Table } from '../data/table';
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { BandScale, LinearScale, niceDomain } from '../scale/scales';
import type { LayerSpec } from '../spec/types';
import { parseColor, withAlpha } from '../util/color';
import { Tween } from './animate';
import { pushArc, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type BuiltMark, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';

const TAU = Math.PI * 2;

/** Distinct values of a field, in first-seen order (sorted when numeric). */
export function categoriesOf(table: Table, field: string): string[] {
  const c = table.column(field);
  const seen = new Map<string, number>();
  for (let i = 0; i < table.length; i++) {
    const key = String(c.values[i]);
    if (!seen.has(key)) seen.set(key, c.type === 'string' ? seen.size : (c.values[i] as number));
  }
  const keys = [...seen.keys()];
  return c.type === 'string' ? keys : keys.sort((a, b) => seen.get(a)! - seen.get(b)!);
}

export function need(layer: LayerSpec, channel: Exclude<keyof LayerSpec['encode'], 'path'>, mark: string): string {
  const f = layer.encode[channel];
  if (!f) throw new Error(`futurCharts: mark "${mark}" needs an encode.${String(channel)} field.`);
  return f;
}

/** Sum `value` per `key` (and per `group`), in first-seen order. `row`: the first source row, for overrides. */
export function totals(table: Table, key: string, value: string, group?: string): { key: string; group: string; value: number; row: number }[] {
  const k = table.column(key).values;
  const v = table.column(value).values as Float64Array;
  const g = group ? table.column(group).values : undefined;
  const out = new Map<string, { key: string; group: string; value: number; row: number }>();
  for (let i = 0; i < table.length; i++) {
    if (Number.isNaN(v[i])) continue;
    const kk = String(k[i]);
    const gg = g ? String(g[i]) : '';
    const id = `${gg}\u0000${kk}`;
    const e = out.get(id);
    if (e) e.value += v[i];
    else out.set(id, { key: kk, group: gg, value: v[i], row: i });
  }
  return [...out.values()];
}

export function batches(ctx: BuildContext, rects: number[], mesh: number[], lines: number[], pixelSnap = true): BuiltMark['draws'] {
  const draws: BuiltMark['draws'] = [];
  if (mesh.length) {
    const b = ctx.renderer.createBatch('mesh');
    b.update(new Float32Array(mesh), mesh.length / LAYOUTS.mesh.stride);
    draws.push({ batch: b });
  }
  if (rects.length) {
    const b = ctx.renderer.createBatch('rect');
    b.update(new Float32Array(rects), rects.length / LAYOUTS.rect.stride);
    draws.push({ batch: b, pixelSnap });
  }
  if (lines.length) {
    const b = ctx.renderer.createBatch('line');
    b.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
    draws.push({ batch: b });
  }
  return draws;
}

export const share = (v: number, total: number) =>
  total > 0 ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: v / total < 0.1 ? 1 : 0 }).format(v / total) : '–';

// ------------------------------------------------------------------ heatmap

/** `heatmap`: x and y are categories, `color` (or `value`) the measure. */
export const heatmap: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales({ layer, table }) {
    return {
      x: new BandScale(categoriesOf(table, need(layer, 'x', 'heatmap')), 0, 0),
      y: new BandScale(categoriesOf(table, need(layer, 'y', 'heatmap')), 0, 0, true),
      axes: { x: true, y: true },
    };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const xs = ctx.x as BandScale;
    const ys = ctx.y as BandScale;
    const vf = layer.encode.value ?? need(layer, 'color', 'heatmap');
    const values = table.column(vf).values as Float64Array;
    const xIndex = new Map(xs.categories.map((c, i) => [c, i]));
    const yIndex = new Map(ys.categories.map((c, i) => [c, i]));
    const xv = table.column(layer.encode.x!).values;
    const yv = table.column(layer.encode.y!).values;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const rects: number[] = [];
    const labels: MarkLabel[] = [];
    const cells = new Map<string, number>();
    const gx = (style.gap / 2) * ctx.pixel[0];
    const gy = (style.gap / 2) * ctx.pixel[1];
    for (let i = 0; i < table.length; i++) {
      const xi = xIndex.get(String(xv[i]));
      const yi = yIndex.get(String(yv[i]));
      if (xi === undefined || yi === undefined || Number.isNaN(values[i])) continue;
      cells.set(`${xi}|${yi}`, i);
      const cx = xs.norm(xi);
      const cy = ys.norm(yi);
      const fill = ctx.paint(ctx.ramp(hi > lo ? (values[i] - lo) / (hi - lo) : 0.5), i);
      const box: [number, number, number, number] = [cx - xs.band / 2 + gx, cy - ys.band / 2 + gy, cx + xs.band / 2 - gx, cy + ys.band / 2 - gy];
      const r = style.radius;
      pushRect(rects, { x0: box[0], y0: box[1], x1: box[2], y1: box[3], fill, radii: [r, r, r, r] });
      if (style.labels) labels.push({ tx: cx, ty: cy, text: ctx.format(values[i], vf), on: fill, align: 'center', baseline: 'middle', box });
    }
    const label = ctx.fields[vf]?.label ?? vf;
    return {
      draws: batches(ctx, rects, [], [], false),
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const xi = xs.invert(tx);
        const yi = ys.invert(ty);
        if (Math.abs(xs.norm(xi) - tx) > xs.band / 2 || Math.abs(ys.norm(yi) - ty) > ys.band / 2) return null;
        const row = cells.get(`${xi}|${yi}`);
        if (row === undefined) return null;
        return { title: `${xs.categories[xi]} · ${ys.categories[yi]}`, rows: [{ label, value: ctx.format(values[row], vf) }] };
      },
    };
  },
};

// --------------------------------------------------------------- pie, donut

function arcMark(defaultInner: number): MarkDefinition {
  return {
    standalone: true,
    themeKey: 'arc',
    symbol: 'square',
    scales: () => ({ x: new LinearScale(-1, 1), y: new LinearScale(-1, 1), aspect: 1 }),
    build(ctx) {
      const { layer, table } = ctx.data;
      const { style, theme } = ctx;
      const kf = layer.encode.key ?? need(layer, 'color', 'pie');
      const vf = layer.encode.value ?? need(layer, 'y', 'pie');
      const all = totals(table, kf, vf).filter((d) => d.value > 0);
      const legend = all.map((d) => ({ key: d.key, color: ctx.categorical(d.key) }));
      const slices = all.filter((d) => !ctx.hidden.has(d.key));
      const total = slices.reduce((a, d) => a + d.value, 0);
      const inner = layer.style?.innerRadius ?? (layer.mark === 'donut' ? defaultInner : style.innerRadius);
      // Room around the circle for a slice pulled out.
      const R = 0.92;
      const PULL = 0.06;
      const r0 = R * inner;
      const colors = slices.map((d) => ctx.paint(legend.find((l) => l.key === d.key)!.color, d.row));
      const bounds = (() => {
        let a = 0;
        return slices.map((d) => {
          const a0 = a;
          a += (d.value / (total || 1)) * TAU;
          return [a0, a] as const;
        });
      })();

      let focus = ctx.state.focus as string | undefined;
      if (focus !== undefined && !slices.some((d) => d.key === focus)) focus = undefined;
      /** Per slice: pull-out distance and opacity. The focused slice comes out, the others fade. */
      const target = () => {
        const out = new Float64Array(slices.length * 2);
        slices.forEach((d, i) => out.set([focus === d.key ? PULL : 0, focus === undefined || focus === d.key ? 1 : 0.35], i * 2));
        return out;
      };
      const tween = new Tween(target());
      const unit = ctx.x.norm(1) - ctx.x.norm(0);
      const at = (a: number, r: number): [number, number] => [ctx.x.norm(Math.sin(a) * r), ctx.y.norm(Math.cos(a) * r)];
      const batch = ctx.renderer.createBatch('arc');
      const write = () => {
        const g = tween.current;
        const out: number[] = [];
        slices.forEach((_, i) => {
          const [a0, a1] = bounds[i];
          const mid = (a0 + a1) / 2;
          const [cx, cy] = at(mid, g[i * 2]);
          const c = colors[i];
          pushArc(out, cx, cy, r0 * unit, R * unit, a0, a1, slices.length > 1 ? style.gap : 0, [c[0], c[1], c[2], c[3] * g[i * 2 + 1]]);
        });
        batch.update(new Float32Array(out), slices.length);
      };
      const labels: MarkLabel[] = [];
      const placeLabels = () => {
        labels.length = 0;
        if (tween.moving) return;
        const g = tween.current;
        slices.forEach((d, i) => {
          const [a0, a1] = bounds[i];
          const sweep = a1 - a0;
          if (!style.labels || sweep < 0.3) return;
          const mid = (a0 + a1) / 2;
          const off = g[i * 2];
          const rm = r0 > 0 ? (R + r0) / 2 : R * 0.62;
          const half = Math.min((R - r0) / 2, Math.sin(Math.min(sweep / 2, Math.PI / 2)) * rm) * 0.9;
          const px = Math.sin(mid) * (rm + off);
          const py = Math.cos(mid) * (rm + off);
          labels.push({
            tx: ctx.x.norm(px), ty: ctx.y.norm(py), text: share(d.value, total), on: colors[i], align: 'center', baseline: 'middle', weight: 600,
            box: [ctx.x.norm(px - half), ctx.y.norm(py - half), ctx.x.norm(px + half), ctx.y.norm(py + half)],
          });
        });
        if (r0 > 0.3 && style.center) {
          const [cx, cy] = at(0, 0);
          const f = focus === undefined ? undefined : slices.find((d) => d.key === focus);
          const box: [number, number, number, number] = [ctx.x.norm(-r0 * 0.85), ctx.y.norm(-r0 * 0.7), ctx.x.norm(r0 * 0.85), ctx.y.norm(r0 * 0.7)];
          labels.push({ tx: cx, ty: cy, text: ctx.format(f ? f.value : total, vf), color: theme.text.primary, size: 24, weight: 650, align: 'center', baseline: 'bottom', dy: 4, box });
          labels.push({ tx: cx, ty: cy, text: f ? `${f.key} · ${share(f.value, total)}` : (ctx.fields[vf]?.label ?? vf), align: 'center', baseline: 'top', dy: 8, size: 12, box });
        }
      };
      write();
      placeLabels();

      const polar = (tx: number, ty: number) => {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        return { x, y, r: Math.hypot(x, y) };
      };
      const hit = (tx: number, ty: number) => {
        const { x, y } = polar(tx, ty);
        const g = tween.current;
        for (let i = 0; i < slices.length; i++) {
          const [a0, a1] = bounds[i];
          const mid = (a0 + a1) / 2;
          // Undo the pull-out before testing.
          const px = x - Math.sin(mid) * g[i * 2];
          const py = y - Math.cos(mid) * g[i * 2];
          const r = Math.hypot(px, py);
          const a = (Math.atan2(px, py) + TAU) % TAU;
          if (r >= r0 && r <= R && a >= a0 && a < a1) return i;
        }
        return -1;
      };
      return {
        draws: [{ batch }],
        hit: emptyHit(),
        labels,
        legend,
        pick(tx, ty): ShapeHit | null {
          const i = hit(tx, ty);
          if (i < 0) return focus !== undefined && polar(tx, ty).r < r0 ? { title: '↑ Toutes les parts', rows: [] } : null;
          const d = slices[i];
          return {
            title: d.key,
            rows: [
              { label: ctx.fields[vf]?.label ?? vf, value: ctx.format(d.value, vf) },
              { label: 'Part', value: share(d.value, total) },
            ],
          };
        },
        click(tx, ty) {
          const i = hit(tx, ty);
          const next = i < 0 ? undefined : focus === slices[i].key ? undefined : slices[i].key;
          if (next === focus) return undefined;
          focus = next;
          ctx.state.focus = focus;
          tween.go(target(), performance.now());
          placeLabels();
          return focus === undefined ? [] : [focus];
        },
        muted: () => (focus === undefined ? [] : slices.filter((d) => d.key !== focus).map((d) => d.key)),
        animate(now) {
          if (!tween.moving) return false;
          const more = tween.step(now);
          write();
          if (!more) placeLabels();
          return true;
        },
      };
    },
  };
}

export const pie = arcMark(0);
export const donut = arcMark(0.62);

// -------------------------------------------------------------------- gauge

/** `gauge`: one value on a half circle, between `style.min` and `style.max`, with an optional `style.target`. */
export const gauge: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(-1.08, 1.08), y: new LinearScale(-0.3, 1.06), aspect: 2.16 / 1.36 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const vf = layer.encode.value ?? need(layer, 'y', 'gauge');
    const value = table.length ? (table.column(vf).values[0] as number) : NaN;
    const t = Math.min(1, Math.max(0, (value - style.min) / (style.max - style.min || 1)));
    const R = 1;
    const r0 = R * (1 - style.thickness);
    const at = (a: number, r: number): [number, number] => [ctx.x.norm(Math.sin(a) * r), ctx.y.norm(Math.cos(a) * r)];
    const track = parseColor(style.track === 'auto' ? ctx.theme.grid.y.color : style.track);
    const base = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(ctx.fields[vf]?.label ?? vf);
    const fill = ctx.paint(base, table.length ? 0 : undefined);
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const [cx, cy] = at(0, 0);
    const start = -Math.PI / 2;
    const arcs: number[] = [];
    pushArc(arcs, cx, cy, r0 * unit, R * unit, start, Math.PI / 2, 0, track);
    if (t > 0) pushArc(arcs, cx, cy, r0 * unit, R * unit, start, start + Math.PI * t, 0, fill);
    const arcBatch = ctx.renderer.createBatch('arc');
    arcBatch.update(new Float32Array(arcs), arcs.length / LAYOUTS.arc.stride);
    const lines: number[] = [];
    if (Number.isFinite(style.target)) {
      const ta = start + Math.PI * Math.min(1, Math.max(0, (style.target - style.min) / (style.max - style.min || 1)));
      const [ax, ay] = at(ta, r0 - 0.05);
      const [bx, by] = at(ta, R + 0.05);
      pushSegment(lines, ax, ay, bx, by, parseColor(ctx.theme.text.primary), 2.5);
    }
    const labels: MarkLabel[] = [
      { tx: cx, ty: cy, text: ctx.format(value, vf), color: ctx.theme.text.primary, size: 30, weight: 650, align: 'center', baseline: 'bottom', dy: -2 },
      { tx: cx, ty: cy, text: ctx.fields[vf]?.label ?? vf, align: 'center', baseline: 'top', dy: 6, size: 12 },
      { tx: ctx.x.norm(-(R + r0) / 2), ty: cy, text: ctx.format(style.min, vf), align: 'center', baseline: 'top', dy: 6 },
      { tx: ctx.x.norm((R + r0) / 2), ty: cy, text: ctx.format(style.max, vf), align: 'center', baseline: 'top', dy: 6 },
    ];
    return { draws: [{ batch: arcBatch }, ...batches(ctx, [], [], lines)], hit: emptyHit(), labels };
  },
};

// ------------------------------------------------------------------ treemap

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap (Bruls, Huizing, van Wijk): tiles as close to squares as possible. */
export function squarify<T extends { value: number }>(items: T[], box: Box): (T & Box)[] {
  const out: (T & Box)[] = [];
  const sorted = items.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  let rest = { ...box };
  let remaining = sorted.reduce((a, d) => a + d.value, 0);
  let i = 0;
  while (i < sorted.length && remaining > 0) {
    const side = Math.min(rest.w, rest.h);
    const scale = (rest.w * rest.h) / remaining;
    const row: T[] = [];
    let rowSum = 0;
    let worst = Infinity;
    while (i < sorted.length) {
      const d = sorted[i];
      const sum = rowSum + d.value;
      const area = sum * scale;
      const thick = area / side;
      let max = 0;
      let min = Infinity;
      for (const r of [...row, d]) {
        const len = (r.value * scale) / thick;
        max = Math.max(max, Math.max(len / thick, thick / len));
        min = Math.min(min, len);
      }
      if (max > worst) break;
      worst = max;
      row.push(d);
      rowSum = sum;
      i++;
    }
    const thick = (rowSum * scale) / side;
    let offset = 0;
    for (const d of row) {
      const len = (d.value * scale) / thick;
      if (rest.w >= rest.h) out.push({ ...d, x: rest.x, y: rest.y + offset, w: thick, h: len });
      else out.push({ ...d, x: rest.x + offset, y: rest.y, w: len, h: thick });
      offset += len;
    }
    if (rest.w >= rest.h) rest = { x: rest.x + thick, y: rest.y, w: rest.w - thick, h: rest.h };
    else rest = { x: rest.x, y: rest.y + thick, w: rest.w, h: rest.h - thick };
    remaining -= rowSum;
  }
  return out;
}

/** `treemap`: tiles sized by `value`, one per `key`, grouped and colored by `color`. */
export const treemap: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const kf = need(layer, 'key', 'treemap');
    const vf = layer.encode.value ?? need(layer, 'y', 'treemap');
    const gf = layer.encode.color;
    const leaves = totals(table, kf, vf, gf).filter((d) => !ctx.hidden.has(d.group));
    const total = leaves.reduce((a, d) => a + d.value, 0);
    // Lay out in pixels so tiles come out square on screen, then convert to scale space.
    const W = 1 / ctx.pixel[0];
    const H = 1 / ctx.pixel[1];
    const toScale = (b: Box): [number, number, number, number] => [b.x / W, 1 - (b.y + b.h) / H, (b.x + b.w) / W, 1 - b.y / H];
    const groupNames = [...new Set(totals(table, kf, vf, gf).map((d) => d.group))];
    const legend = gf ? groupNames.map((g) => ({ key: g, color: ctx.categorical(g) })) : [];
    const colorOf = (d: { key: string; group: string }) =>
      gf ? legend.find((l) => l.key === d.group)!.color : ctx.categorical(ctx.fields[vf]?.label ?? vf);
    const groups = gf
      ? groupNames.filter((g) => !ctx.hidden.has(g)).map((g) => ({ group: g, value: leaves.filter((d) => d.group === g).reduce((a, d) => a + d.value, 0) }))
      : [{ group: '', value: total }];

    const rects: number[] = [];
    const labels: MarkLabel[] = [];
    const tiles: { box: [number, number, number, number]; d: (typeof leaves)[number] }[] = [];
    const g2 = style.gap;
    const r = style.radius;
    for (const g of squarify(groups, { x: 0, y: 0, w: W, h: H })) {
      const header = gf && g.h > style.header * 3 && g.w > 60 ? style.header : 0;
      if (header) {
        labels.push({ tx: (g.x + 4) / W, ty: 1 - g.y / H, text: g.group, align: 'left', baseline: 'top', dy: 4, weight: 600, color: ctx.theme.text.primary, size: 12 });
      }
      const inner = { x: g.x, y: g.y + header, w: g.w, h: g.h - header };
      const items = leaves.filter((d) => d.group === g.group);
      for (const t of squarify(items, inner)) {
        const b = { x: t.x + g2 / 2, y: t.y + g2 / 2, w: Math.max(0, t.w - g2), h: Math.max(0, t.h - g2) };
        const box = toScale(b);
        const fill = ctx.paint(colorOf(t), t.row);
        pushRect(rects, { x0: box[0], y0: box[1], x1: box[2], y1: box[3], fill, radii: [r, r, r, r] });
        tiles.push({ box, d: t });
        if (style.labels) {
          labels.push({ tx: box[0], ty: box[3], text: t.key, on: fill, align: 'left', baseline: 'top', dx: 8, dy: 8, weight: 600, size: 12, box });
          labels.push({ tx: box[0], ty: box[3], text: ctx.format(t.value, vf), on: fill, align: 'left', baseline: 'top', dx: 8, dy: 25, size: 11, box });
        }
      }
    }
    return {
      draws: batches(ctx, rects, [], [], false),
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const t = tiles.find(({ box }) => tx >= box[0] && tx <= box[2] && ty >= box[1] && ty <= box[3]);
        if (!t) return null;
        const rows = [
          { label: ctx.fields[vf]?.label ?? vf, value: ctx.format(t.d.value, vf) },
          { label: 'Part', value: share(t.d.value, total) },
        ];
        if (gf) rows.unshift({ label: ctx.fields[gf]?.label ?? 'Groupe', value: t.d.group });
        return { title: t.d.key, rows };
      },
    };
  },
};

// ------------------------------------------------------------------- funnel

/** `funnel`: one centered bar per stage (`key`), width by `value`, with conversion rates. */
export const funnel: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales({ layer, table }) {
    const vf = layer.encode.value ?? need(layer, 'x', 'funnel');
    const max = Math.max(0, ...(table.column(vf).values as Float64Array));
    return {
      x: new LinearScale(-max / 2, max / 2),
      y: new BandScale(categoriesOf(table, need(layer, 'key', 'funnel')), 0.32, 0.05, true),
      axes: { y: true },
    };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const ys = ctx.y as BandScale;
    const kf = layer.encode.key!;
    const vf = layer.encode.value ?? layer.encode.x!;
    const stages = totals(table, kf, vf);
    const color = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(ctx.fields[vf]?.label ?? vf);
    const connector = withAlpha(color, style.connector);
    const rects: number[] = [];
    const mesh: number[] = [];
    const labels: MarkLabel[] = [];
    const first = stages[0]?.value ?? 0;
    const r = style.radius;
    const boxes = stages.map((s) => {
      const cy = ys.norm(ys.categories.indexOf(s.key));
      return [ctx.x.norm(-s.value / 2), cy - ys.band / 2, ctx.x.norm(s.value / 2), cy + ys.band / 2] as [number, number, number, number];
    });
    stages.forEach((s, i) => {
      const box = boxes[i];
      const fill = ctx.paint(color, s.row);
      pushRect(rects, { x0: box[0], y0: box[1], x1: box[2], y1: box[3], fill, radii: [r, r, r, r] });
      if (i > 0) {
        // Trapezoid from the bottom of the previous stage to the top of this one.
        const p = boxes[i - 1];
        const c = connector;
        pushVertex(mesh, p[0], p[1], c);
        pushVertex(mesh, p[2], p[1], c);
        pushVertex(mesh, box[2], box[3], c);
        pushVertex(mesh, p[0], p[1], c);
        pushVertex(mesh, box[2], box[3], c);
        pushVertex(mesh, box[0], box[3], c);
      }
      if (style.labels) {
        const text = `${ctx.format(s.value, vf)} · ${share(s.value, first)}`;
        const cy = (box[1] + box[3]) / 2;
        labels.push({
          tx: 0.5, ty: cy, text, on: fill, align: 'center', baseline: 'middle', weight: 600, box,
          fallback: { tx: box[2], ty: cy, text, align: 'left', baseline: 'middle', dx: 8 },
        });
      }
    });
    return {
      draws: batches(ctx, rects, mesh, []),
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const i = stages.findIndex((_, k) => ty >= boxes[k][1] && ty <= boxes[k][3]);
        if (i < 0 || tx < boxes[i][0] || tx > boxes[i][2]) return null;
        const s = stages[i];
        const rows = [
          { label: ctx.fields[vf]?.label ?? vf, value: ctx.format(s.value, vf) },
          { label: 'Depuis le début', value: share(s.value, first) },
        ];
        if (i > 0) rows.push({ label: 'Depuis l’étape précédente', value: share(s.value, stages[i - 1].value) });
        return { title: s.key, rows };
      },
    };
  },
};

// -------------------------------------------------------------------- radar

/** `radar`: one spoke per `key`, one polygon per `color` series. */
export const radar: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(-1.36, 1.36), y: new LinearScale(-1.2, 1.2), aspect: 2.72 / 2.4 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'radar');
    const vf = layer.encode.value ?? need(layer, 'y', 'radar');
    const sf = layer.encode.color;
    const axes = categoriesOf(table, kf);
    const data = totals(table, kf, vf, sf);
    const seriesNames = [...new Set(data.map((d) => d.group))];
    const legend = sf ? seriesNames.map((s) => ({ key: s, color: ctx.categorical(s) })) : [];
    const max = niceDomain(0, Math.max(0, ...data.map((d) => d.value)) || 1, style.levels)[1];
    const n = axes.length;
    const at = (k: number, r: number): [number, number] => {
      const a = (TAU * k) / n;
      return [ctx.x.norm(Math.sin(a) * r), ctx.y.norm(Math.cos(a) * r)];
    };
    const grid = parseColor(theme.grid.y.color);
    const lines: number[] = [];
    const mesh: number[] = [];
    const labels: MarkLabel[] = [];
    for (let l = 1; l <= style.levels; l++) {
      const r = l / style.levels;
      for (let k = 0; k < n; k++) {
        const [ax, ay] = at(k, r);
        const [bx, by] = at(k + 1, r);
        pushSegment(lines, ax, ay, bx, by, grid, 1);
      }
      // The outermost level sits where the first axis name goes: leave it unlabelled.
      if (l < style.levels) {
        const [lx, ly] = at(0, r);
        labels.push({ tx: lx, ty: ly, text: ctx.format((max * l) / style.levels, vf), align: 'left', baseline: 'bottom', dx: 4, dy: -2, size: 10, color: theme.text.muted });
      }
    }
    axes.forEach((name, k) => {
      const [cx, cy] = at(0, 0);
      const [ox, oy] = at(k, 1);
      pushSegment(lines, cx, cy, ox, oy, grid, 1);
      const a = (TAU * k) / n;
      const sx = Math.sin(a);
      const cyy = Math.cos(a);
      const [lx, ly] = at(k, 1.06);
      labels.push({
        tx: lx, ty: ly, text: name, color: theme.text.secondary, size: 12,
        align: Math.abs(sx) < 0.2 ? 'center' : sx > 0 ? 'left' : 'right',
        baseline: Math.abs(cyy) < 0.2 ? 'middle' : cyy > 0 ? 'bottom' : 'top',
      });
    });
    const vertices: { x: number; y: number; series: string; axis: string; value: number }[] = [];
    const strokes: number[] = [];
    const points: number[] = [];
    const surface = ctx.surface;
    for (const name of seriesNames) {
      if (ctx.hidden.has(name)) continue;
      const color = ctx.paint(sf ? ctx.categorical(name) : ctx.categorical(ctx.fields[vf]?.label ?? vf), data.find((d) => d.group === name)?.row);
      const fill = withAlpha(color, style.fillOpacity);
      const ring = axes.map((axis, k) => {
        const v = data.find((d) => d.group === name && d.key === axis)?.value ?? 0;
        const p = at(k, v / max);
        vertices.push({ x: p[0], y: p[1], series: name, axis, value: v });
        return p;
      });
      const [cx, cy] = at(0, 0);
      ring.forEach((p, k) => {
        const q = ring[(k + 1) % n];
        pushVertex(mesh, cx, cy, fill);
        pushVertex(mesh, p[0], p[1], fill);
        pushVertex(mesh, q[0], q[1], fill);
        pushSegment(strokes, p[0], p[1], q[0], q[1], color, style.width);
        if (style.points) {
          points.push(p[0], p[1], 7, 0, color[0], color[1], color[2], color[3], surface[0], surface[1], surface[2], surface[3], 1.5);
        }
      });
    }
    const draws = batches(ctx, [], mesh, [...lines, ...strokes]);
    if (points.length) {
      const b = ctx.renderer.createBatch('point');
      b.update(new Float32Array(points), points.length / LAYOUTS.point.stride);
      draws.push({ batch: b });
    }
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        let best: (typeof vertices)[number] | undefined;
        let bestD = 14 * 14;
        for (const v of vertices) {
          const dx = (v.x - tx) / ctx.pixel[0];
          const dy = (v.y - ty) / ctx.pixel[1];
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = v;
          }
        }
        if (!best) return null;
        return { title: sf ? `${best.series} · ${best.axis}` : best.axis, rows: [{ label: ctx.fields[vf]?.label ?? vf, value: ctx.format(best.value, vf) }] };
      },
    };
  },
};

export const STANDALONE_MARKS: Record<string, MarkDefinition> = { heatmap, pie, donut, gauge, treemap, funnel, radar };

