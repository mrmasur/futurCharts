/**
 * Packed bubbles, arc diagram, pyramid and vector field, drawn with the shared primitives.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import { withAlpha } from '../util/color';
import { batches, need, share, totals } from './charts';
import { packCircles } from './more';
import { pushArc, pushRect, pushSegment, pushVertex } from './primitives';
import { slotWidth } from './builtin';
import { parseColor } from '../util/color';
import { buildHit, emptyHit, type BuildContext, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';

const TAU = Math.PI * 2;
const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;

function batch(ctx: BuildContext, kind: 'arc' | 'point' | 'line' | 'mesh', data: number[]) {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

// ----------------------------------------------------------- packed bubbles

/**
 * `bubbles`: one circle per `key`, area by `value`, packed together. With
 * `encode.color`, each group is packed apart, then the groups are packed.
 */
export const bubbles: MarkDefinition = {
  standalone: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(-1, 1), y: new LinearScale(-1, 1), aspect: 1 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const kf = need(layer, 'key', 'bubbles');
    const vf = layer.encode.value ?? need(layer, 'y', 'bubbles');
    const gf = layer.encode.color;
    const items = totals(table, kf, vf, gf).filter((d) => d.value > 0);
    const groupNames = [...new Set(items.map((d) => d.group))];
    const legend = gf ? groupNames.map((g) => ({ key: g, color: ctx.categorical(g) })) : [];
    const shown = items.filter((d) => !ctx.hidden.has(d.group));
    const groups = groupNames.filter((g) => !ctx.hidden.has(g)).map((g) => {
      const members = shown.filter((d) => d.group === g);
      const p = packCircles(members.map((d) => Math.sqrt(d.value)));
      return { name: g, members, p, x: 0, y: 0, r: p.r };
    });
    // Groups around each other, a little apart.
    const outer = packCircles(groups.map((g) => g.r * (gf ? 1.08 : 1)));
    groups.forEach((g, i) => {
      g.x = outer.x[i];
      g.y = outer.y[i];
    });
    const s = 0.97 / (outer.r || 1);
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const gapUnits = style.gap * ctx.pixel[0] / (unit || 1);
    const circles: { x: number; y: number; r: number; d: (typeof items)[number]; color: RGBA }[] = [];
    for (const g of groups) {
      g.members.forEach((d, i) => {
        const base = gf ? legend.find((l) => l.key === g.name)!.color : ctx.categorical(d.key);
        circles.push({
          x: (g.x + g.p.x[i]) * s,
          y: (g.y + g.p.y[i]) * s,
          r: Math.max(0, Math.sqrt(d.value) * s - gapUnits / 2),
          d,
          color: ctx.paint(base, d.row),
        });
      });
    }
    const arcs: number[] = [];
    const labels: MarkLabel[] = [];
    for (const c of circles) {
      const fill = withAlpha(c.color, c.color[3] * style.opacity);
      pushArc(arcs, ctx.x.norm(c.x), ctx.y.norm(c.y), 0, c.r * unit, 0, TAU, 0, fill);
      if (!style.labels) continue;
      const h = c.r * 0.8;
      const box: [number, number, number, number] = [ctx.x.norm(c.x - h), ctx.y.norm(c.y - h * 0.6), ctx.x.norm(c.x + h), ctx.y.norm(c.y + h * 0.6)];
      labels.push({ tx: ctx.x.norm(c.x), ty: ctx.y.norm(c.y), text: c.d.key, on: fill, size: 11, weight: 600, align: 'center', baseline: 'bottom', dy: 1, box });
      labels.push({ tx: ctx.x.norm(c.x), ty: ctx.y.norm(c.y), text: ctx.format(c.d.value, vf), on: fill, size: 10, align: 'center', baseline: 'top', dy: 2, box });
    }
    const total = shown.reduce((a, d) => a + d.value, 0);
    return {
      draws: [{ batch: batch(ctx, 'arc', arcs) }],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const c = circles.find((q) => Math.hypot(q.x - x, q.y - y) <= q.r);
        if (!c) return null;
        const rows = [{ label: fieldLabel(ctx, vf), value: ctx.format(c.d.value, vf) }, { label: 'Part du total', value: share(c.d.value, total) }];
        if (gf) rows.unshift({ label: fieldLabel(ctx, gf), value: c.d.group });
        return { title: c.d.key, rows };
      },
    };
  },
};

// -------------------------------------------------------------- arc diagram

/**
 * `arcDiagram`: nodes (`source`, `target`) on a line in order of appearance,
 * each link a half circle above it, as thick as its `value`.
 */
export const arcDiagram: MarkDefinition = {
  standalone: true,
  symbol: 'circle',
  // Half circles need x and y at the same scale: the span between the outermost nodes is the width.
  scales: () => ({ x: new LinearScale(-0.03, 1.03), y: new LinearScale(-0.16, 0.53), aspect: 1.06 / 0.69 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const sf = need(layer, 'source', 'arcDiagram');
    const tf = need(layer, 'target', 'arcDiagram');
    const vf = layer.encode.value;
    const src = table.column(sf).values;
    const dst = table.column(tf).values;
    const val = vf ? (table.column(vf).values as Float64Array) : undefined;
    const names: string[] = [];
    const index = new Map<string, number>();
    const add = (n: string) => {
      if (!index.has(n)) {
        index.set(n, names.length);
        names.push(n);
      }
      return index.get(n)!;
    };
    const links: { a: number; b: number; v: number; row: number }[] = [];
    for (let i = 0; i < table.length; i++) {
      const v = val ? val[i] : 1;
      if (!(v > 0)) continue;
      links.push({ a: add(String(src[i])), b: add(String(dst[i])), v, row: i });
    }
    const flow = new Float64Array(names.length);
    for (const l of links) {
      flow[l.a] += l.v;
      flow[l.b] += l.v;
    }
    const n = names.length;
    const xOf = (i: number) => (n === 1 ? 0.5 : i / (n - 1));
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const pxUnit = ctx.pixel[0] / (unit || 1);
    const vmax = Math.max(...links.map((l) => l.v), 1);
    const fmax = Math.max(...flow, 1);
    const legend = names.map((k) => ({ key: k, color: ctx.categorical(k) }));
    const arcs: number[] = [];
    const dots: number[] = [];
    const labels: MarkLabel[] = [];
    const geo = links.map((l) => {
      const x0 = xOf(Math.min(l.a, l.b));
      const x1 = xOf(Math.max(l.a, l.b));
      const cx = (x0 + x1) / 2;
      const r = (x1 - x0) / 2;
      // Width by value, at least a hairline, in scale units.
      const w = Math.max(1, (style.maxWidth * l.v) / vmax) * pxUnit;
      return { ...l, cx, r, w };
    });
    // Widest arcs first, so the narrow ones stay on top.
    for (const g of [...geo].sort((p, q) => q.r - p.r)) {
      const c = ctx.paint(legend[g.a].color, g.row);
      pushArc(arcs, ctx.x.norm(g.cx), ctx.y.norm(0), Math.max(0, g.r - g.w / 2) * unit, (g.r + g.w / 2) * unit, -Math.PI / 2, Math.PI / 2, 0, withAlpha(c, c[3] * style.opacity));
    }
    const surface = ctx.surface;
    names.forEach((name, i) => {
      const c = legend[i].color;
      const size = style.nodeSize * (0.6 + 0.8 * Math.sqrt(flow[i] / fmax));
      dots.push(ctx.x.norm(xOf(i)), ctx.y.norm(0), size, 0, c[0], c[1], c[2], c[3], surface[0], surface[1], surface[2], 1, 2);
      labels.push({ tx: ctx.x.norm(xOf(i)), ty: ctx.y.norm(0), text: name, color: theme.text.secondary, size: 11, align: 'center', baseline: 'top', dy: 10 + (n > 9 && i % 2 ? 14 : 0) });
    });
    return {
      draws: [{ batch: batch(ctx, 'arc', arcs) }, { batch: batch(ctx, 'point', dots) }],
      hit: emptyHit(),
      labels,
      legend: [],
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        if (Math.abs(y) < 0.03) {
          const i = names.findIndex((_, k) => Math.abs(xOf(k) - x) < 0.02);
          if (i >= 0) return { title: names[i], rows: [{ label: vf ? fieldLabel(ctx, vf) : 'Liens', value: ctx.format(flow[i], vf) }] };
        }
        if (y < 0) return null;
        const g = geo.filter((q) => Math.abs(Math.hypot(x - q.cx, y) - q.r) <= Math.max(q.w / 2, 4 * pxUnit)).sort((p, q) => p.w - q.w)[0];
        if (!g) return null;
        return { title: `${names[g.a]} → ${names[g.b]}`, rows: [{ label: vf ? fieldLabel(ctx, vf) : 'Lien', value: ctx.format(g.v, vf) }] };
      },
    };
  },
};

// ------------------------------------------------------------------ pyramid

/** `pyramid`: stages (`key`) stacked in a triangle, apex first, each as tall as its `value`. */
export const pyramid: MarkDefinition = {
  standalone: true,
  // The gap between stages is in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'pyramid');
    const vf = layer.encode.value ?? need(layer, 'y', 'pyramid');
    const all = totals(table, kf, vf).filter((d) => d.value > 0);
    const legend = all.map((d) => ({ key: d.key, color: ctx.categorical(d.key) }));
    const stages = all.filter((d) => !ctx.hidden.has(d.key));
    const total = stages.reduce((a, d) => a + d.value, 0) || 1;
    const [px, py] = ctx.pixel;
    // The triangle keeps a pleasant shape: base about as wide as it is tall, room on the right for labels.
    const H = 1 - 8 * py;
    const base = Math.min(0.56, (H / py) * 0.95 * px);
    const cx = style.labels ? 0.02 + base / 2 + 0.04 : 0.5;
    const half = (y: number) => (base / 2) * ((1 - y) / H); // y measured down from the apex (scale space)
    const gap = style.gap * py;
    const mesh: number[] = [];
    const labels: MarkLabel[] = [];
    const bands: { y0: number; y1: number; d: (typeof all)[number] }[] = [];
    let top = 1;
    let lastLabel = 1 + 30 * py;
    for (const d of stages) {
      const h = (H * d.value) / total;
      const y1 = top;
      const y0 = top - h;
      top = y0;
      const a = y1 - (bands.length ? gap / 2 : 0);
      const b = y0 + gap / 2;
      const c = ctx.paint(legend.find((l) => l.key === d.key)!.color, d.row);
      if (a > b) {
        const ha = half(a), hb = half(b);
        pushVertex(mesh, cx - ha, a, c);
        pushVertex(mesh, cx + ha, a, c);
        pushVertex(mesh, cx + hb, b, c);
        pushVertex(mesh, cx - ha, a, c);
        pushVertex(mesh, cx + hb, b, c);
        pushVertex(mesh, cx - hb, b, c);
      }
      bands.push({ y0, y1, d });
      if (style.labels) {
        // Thin stages near the apex: each label at least 30 px below the previous one.
        const ym = Math.min((y0 + y1) / 2, lastLabel - 30 * py);
        lastLabel = ym;
        labels.push({ tx: cx + half((y0 + y1) / 2), ty: ym, text: d.key, color: theme.text.primary, size: 12, weight: 600, align: 'left', baseline: 'bottom', dx: 12, dy: 1 });
        labels.push({ tx: cx + half((y0 + y1) / 2), ty: ym, text: `${ctx.format(d.value, vf)} · ${share(d.value, total)}`, color: theme.text.secondary, size: 11, align: 'left', baseline: 'top', dx: 12, dy: 2 });
      }
    }
    return {
      draws: batches(ctx, [], mesh, [], false),
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const b = bands.find((q) => ty >= q.y0 && ty <= q.y1);
        if (!b || Math.abs(tx - cx) > half(ty)) return null;
        return { title: b.d.key, rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(b.d.value, vf) }, { label: 'Part', value: share(b.d.value, total) }] };
      },
    };
  },
};

// ------------------------------------------------------------- vector field

/**
 * `vector`: an arrow at each (x, y), pointing along `encode.angle` (degrees,
 * clockwise from up), as long as `encode.size` maps to (`sizeRange`, px).
 * Color by a numeric `encode.color` to read the magnitude twice.
 */
export const vector: MarkDefinition = {
  symbol: 'line',
  // Arrow lengths are in px.
  sizeDependent: true,
  build(ctx) {
    const { style, data } = ctx;
    const af = data.layer.encode.angle;
    const angles = af ? (data.table.column(af).values as Float64Array) : undefined;
    const [px, py] = ctx.pixel;
    const out: number[] = [];
    for (const s of data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const deg = angles ? angles[s.rows[i]] : 0;
        if (!Number.isFinite(deg)) continue;
        const a = (deg * Math.PI) / 180;
        const len = s.sizeValue ? ctx.size(s, i) * 1.2 : (style.size ?? 8) * 2;
        const [x, y] = ctx.pos(ctx.x.norm(s.x[i]), ctx.y.norm(s.y1[i]));
        // Centered on the point; screen y points up in scale space.
        const dx = Math.sin(a) * len;
        const dy = Math.cos(a) * len;
        const x0 = x - (dx / 2) * px, y0 = y - (dy / 2) * py;
        const x1 = x + (dx / 2) * px, y1 = y + (dy / 2) * py;
        const c = ctx.color(s, i);
        pushSegment(out, x0, y0, x1, y1, c, style.width);
        // Arrow head: two short strokes back from the tip.
        for (const side of [-1, 1]) {
          const b = a + Math.PI + side * 0.5;
          pushSegment(out, x1, y1, x1 + Math.sin(b) * style.head * px, y1 + Math.cos(b) * style.head * py, c, style.width);
        }
      }
    }
    return { draws: [{ batch: batch(ctx, 'line', out) }], hit: buildHit(ctx) };
  },
};

// -------------------------------------------------------------- candlestick

/**
 * `candlestick`: one price bar per x, from `y2` (low) to `y` (high), body from
 * `encode.open` to `encode.close`, colored by direction. `style.ohlc` for ticks.
 */
export const candlestick: MarkDefinition = {
  banded: true,
  symbol: 'square',
  build(ctx) {
    const { style, data, theme } = ctx;
    const enc = data.layer.encode;
    const of = enc.open ?? need(data.layer, 'open', 'candlestick');
    const cf = enc.close ?? need(data.layer, 'close', 'candlestick');
    const open = data.table.column(of).values as Float64Array;
    const close = data.table.column(cf).values as Float64Array;
    const up = parseColor(style.rising === 'auto' ? theme.marks.kpi.good : style.rising);
    const down = parseColor(style.falling === 'auto' ? theme.marks.kpi.bad : style.falling);
    const slot = slotWidth(ctx);
    const [px] = ctx.pixel;
    const half = Math.max(px, (slot * style.body) / 2);
    const rects: number[] = [];
    const lines: number[] = [];
    for (const s of data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const r = s.rows[i];
        const o = open[r];
        const c = close[r];
        if (!Number.isFinite(o + c)) continue;
        const col = ctx.paint(c >= o ? up : down, r);
        const x = ctx.x.norm(s.x[i]);
        const [ax, ay] = ctx.pos(x, ctx.y.norm(s.y0[i]));
        const [bx, by] = ctx.pos(x, ctx.y.norm(s.y1[i]));
        pushSegment(lines, ax, ay, bx, by, col, style.wick);
        const yo = ctx.y.norm(o);
        const yc = ctx.y.norm(c);
        if (style.ohlc) {
          // Open on the left, close on the right.
          pushSegment(lines, x - half, yo, x, yo, col, style.wick);
          pushSegment(lines, x, yc, x + half, yc, col, style.wick);
        } else {
          pushRect(rects, { x0: x - half, y0: Math.min(yo, yc), x1: x + half, y1: Math.max(yo, yc) + 0.0001, fill: col, radii: [1, 1, 1, 1] });
        }
      }
    }
    const draws = batches(ctx, rects, [], [], true);
    draws.unshift({ batch: batch(ctx, 'line', lines) });
    return { draws, hit: buildHit(ctx) };
  },
};

// -------------------------------------------------------------------- route

/**
 * `route`: a curve from (x, y) to (`x2`, `y2`) — on a map, longitude and
 * latitude. Bent to the right of its direction so that a return trip shows apart.
 */
export const route: MarkDefinition = {
  symbol: 'line',
  // Widths are in px.
  sizeDependent: true,
  build(ctx) {
    const { style, data } = ctx;
    const x2f = need(data.layer, 'x2', 'route');
    const y2f = need(data.layer, 'y2', 'route');
    const x2 = data.table.column(x2f).values as Float64Array;
    const y2 = data.table.column(y2f).values as Float64Array;
    const [px, py] = ctx.pixel;
    const lines: number[] = [];
    const dots: number[] = [];
    for (const s of data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const r = s.rows[i];
        if (!Number.isFinite(x2[r] + y2[r])) continue;
        const [ax, ay] = ctx.pos(ctx.x.norm(s.x[i]), ctx.y.norm(s.value[i]));
        const [bx, by] = ctx.pos(ctx.x.norm(x2[r]), ctx.y.norm(y2[r]));
        // Quadratic curve, control point off the middle, measured in px so the bend looks the same in any shape.
        const dx = (bx - ax) / px;
        const dy = (by - ay) / py;
        const len = Math.hypot(dx, dy) || 1;
        const cx = (ax + bx) / 2 + (dy / len) * len * style.curvature * px;
        const cy = (ay + by) / 2 - (dx / len) * len * style.curvature * py;
        const c = ctx.color(s, i);
        const col = withAlpha(c, c[3] * style.opacity);
        const w = s.sizeValue ? Math.max(1, ctx.size(s, i) / 4) : 1.5;
        const steps = Math.max(8, Math.min(48, Math.round(len / 12)));
        let lx = ax, ly = ay;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const u = 1 - t;
          const x = u * u * ax + 2 * u * t * cx + t * t * bx;
          const y = u * u * ay + 2 * u * t * cy + t * t * by;
          pushSegment(lines, lx, ly, x, y, col, w);
          lx = x;
          ly = y;
        }
        if (style.ends) {
          const sf = ctx.surface;
          dots.push(ax, ay, 5, 0, c[0], c[1], c[2], c[3], sf[0], sf[1], sf[2], 1, 1.5);
          dots.push(bx, by, 7, 0, c[0], c[1], c[2], c[3], sf[0], sf[1], sf[2], 1, 1.5);
        }
      }
    }
    const draws = [{ batch: batch(ctx, 'line', lines) }];
    if (dots.length) draws.push({ batch: batch(ctx, 'point', dots) });
    return { draws, hit: buildHit(ctx) };
  },
};

export const CATALOG_MARKS: Record<string, MarkDefinition> = { bubbles, arcDiagram, pyramid, vector, candlestick, route };
