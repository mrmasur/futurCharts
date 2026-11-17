/**
 * Marimekko, chord diagram, circle packing, parallel coordinates, network and
 * hexagonal binning: standalone marks drawn with the shared primitives.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale, niceDomain } from '../scale/scales';
import type { FlowEdge, FlowNode, LayerSpec } from '../spec/types';
import { mix, parseColor, toCss, withAlpha } from '../util/color';
import { batches, categoriesOf, need, share, totals } from './charts';
import { pushArc, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';

const TAU = Math.PI * 2;
const pct = (v: number) => new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(v);

// ---------------------------------------------------------------- marimekko

/**
 * `marimekko`: one column per `x` category, as wide as its share of the total;
 * inside, one segment per `color` series, as tall as its share of the column.
 */
export const marimekko: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: () => ({
    x: new LinearScale(0, 1, { style: 'percent' }),
    y: new LinearScale(0, 1, { style: 'percent' }),
    axes: { x: true, y: true },
  }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const xf = need(layer, 'x', 'marimekko');
    const sf = need(layer, 'color', 'marimekko');
    const vf = layer.encode.value ?? need(layer, 'y', 'marimekko');
    const cells = totals(table, xf, vf, sf).filter((d) => d.value > 0 && !ctx.hidden.has(d.group));
    const cats = categoriesOf(table, xf);
    const series = [...new Set(totals(table, xf, vf, sf).map((d) => d.group))];
    const legend = series.map((s) => ({ key: s, color: ctx.categorical(s) }));
    const colTotal = new Map(cats.map((c) => [c, cells.filter((d) => d.key === c).reduce((a, d) => a + d.value, 0)]));
    const grand = [...colTotal.values()].reduce((a, v) => a + v, 0) || 1;
    const gx = ctx.pixel[0];
    const gy = ctx.pixel[1];
    const rects: number[] = [];
    const labels: MarkLabel[] = [];
    const boxes: { box: [number, number, number, number]; d: (typeof cells)[number] }[] = [];
    let x = 0;
    for (const c of cats) {
      const t = colTotal.get(c)!;
      if (!t) continue;
      const w = t / grand;
      let y = 0;
      let topColor: RGBA = ctx.surface;
      for (const s of series) {
        const d = cells.find((e) => e.key === c && e.group === s);
        if (!d) continue;
        const h = d.value / t;
        const fill = ctx.paint(legend.find((l) => l.key === s)!.color, d.row);
        const box: [number, number, number, number] = [x + gx, y + gy, x + w - gx, y + h - gy];
        pushRect(rects, { x0: box[0], y0: box[1], x1: box[2], y1: box[3], fill, radii: [2, 2, 2, 2] });
        labels.push({ tx: x + w / 2, ty: y + h / 2, text: pct(h), on: fill, align: 'center', baseline: 'middle', box });
        boxes.push({ box, d });
        topColor = fill;
        y += h;
      }
      // Column name at the top of the column, when it fits.
      labels.push({ tx: x + w / 2, ty: 1, text: c, on: topColor, weight: 600, align: 'center', baseline: 'top', dy: 6, box: [x, 0, x + w, 1] });
      x += w;
    }
    return {
      draws: batches(ctx, rects, [], [], false),
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const b = boxes.find(({ box }) => tx >= box[0] && tx <= box[2] && ty >= box[1] && ty <= box[3]);
        if (!b) return null;
        const t = colTotal.get(b.d.key)!;
        return {
          title: `${b.d.key} · ${b.d.group}`,
          rows: [
            { label: ctx.fields[vf]?.label ?? vf, value: ctx.format(b.d.value, vf) },
            { label: `Part de ${b.d.key}`, value: share(b.d.value, t) },
            { label: 'Part du total', value: share(b.d.value, grand) },
          ],
        };
      },
    };
  },
};

// -------------------------------------------------------------------- chord

/** `chord`: flows between entities around a circle (`source`, `target`, `value`). */
export const chord: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(-1.3, 1.3), y: new LinearScale(-1.2, 1.2), aspect: 2.6 / 2.4 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const sf = need(layer, 'source', 'chord');
    const tf = need(layer, 'target', 'chord');
    const vf = layer.encode.value ?? need(layer, 'y', 'chord');
    const src = table.column(sf).values;
    const dst = table.column(tf).values;
    const val = table.column(vf).values as Float64Array;
    const names: string[] = [];
    for (let i = 0; i < table.length; i++) for (const n of [String(src[i]), String(dst[i])]) if (!names.includes(n)) names.push(n);
    const legend = names.map((n) => ({ key: n, color: ctx.categorical(n) }));
    const flows: { s: number; t: number; v: number; row: number }[] = [];
    for (let i = 0; i < table.length; i++) {
      const s = names.indexOf(String(src[i]));
      const t = names.indexOf(String(dst[i]));
      if (s === t || !(val[i] > 0) || ctx.hidden.has(names[s]) || ctx.hidden.has(names[t])) continue;
      flows.push({ s, t, v: val[i], row: i });
    }
    const totalOf = names.map((_, k) => flows.reduce((a, f) => a + (f.s === k ? f.v : 0) + (f.t === k ? f.v : 0), 0));
    const sum = totalOf.reduce((a, v) => a + v, 0) || 1;
    const pad = 0.04;
    const k = (TAU - pad * names.length) / sum;
    const start: number[] = [];
    let a = 0;
    for (let i = 0; i < names.length; i++) {
      start.push(a);
      a += totalOf[i] * k + pad;
    }
    // Sub-arcs: each group lays out its outgoing flows, then its incoming ones.
    const cursor = [...start];
    const ends = flows.map(() => ({ s0: 0, s1: 0, t0: 0, t1: 0 }));
    flows.forEach((f, i) => {
      ends[i].s0 = cursor[f.s];
      cursor[f.s] += f.v * k;
      ends[i].s1 = cursor[f.s];
    });
    flows.forEach((f, i) => {
      ends[i].t0 = cursor[f.t];
      cursor[f.t] += f.v * k;
      ends[i].t1 = cursor[f.t];
    });
    const R = 0.92;
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const cx = ctx.x.norm(0);
    const cy = ctx.y.norm(0);
    const at = (ang: number, r: number): [number, number] => [ctx.x.norm(Math.sin(ang) * r), ctx.y.norm(Math.cos(ang) * r)];
    const arcs: number[] = [];
    names.forEach((n, i) => {
      if (!totalOf[i]) return;
      pushArc(arcs, cx, cy, (R + 0.03) * unit, (R + 0.1) * unit, start[i], start[i] + totalOf[i] * k, 0, ctx.paint(legend[i].color, flows.find((f) => f.s === i || f.t === i)?.row));
    });
    // Ribbons: a strip between two curves through the center.
    const mesh: number[] = [];
    const strips: [number, number][][] = [];
    const q = (p0: [number, number], p1: [number, number], t: number): [number, number] => [(1 - t) * (1 - t) * p0[0] + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + t * t * p1[1]];
    flows.forEach((f, i) => {
      const e = ends[i];
      const color = withAlpha(ctx.paint(legend[f.s].color, f.row), 0.62);
      const pA0 = [Math.sin(e.s0) * R, Math.cos(e.s0) * R] as [number, number];
      const pA1 = [Math.sin(e.t1) * R, Math.cos(e.t1) * R] as [number, number];
      const pB0 = [Math.sin(e.s1) * R, Math.cos(e.s1) * R] as [number, number];
      const pB1 = [Math.sin(e.t0) * R, Math.cos(e.t0) * R] as [number, number];
      const poly: [number, number][] = [];
      const STEPS = 24;
      for (let s = 0; s < STEPS; s++) {
        const a0 = q(pA0, pA1, s / STEPS);
        const a1 = q(pA0, pA1, (s + 1) / STEPS);
        const b0 = q(pB0, pB1, s / STEPS);
        const b1 = q(pB0, pB1, (s + 1) / STEPS);
        const P = (p: [number, number]) => [ctx.x.norm(p[0]), ctx.y.norm(p[1])] as [number, number];
        const [ax0, ay0] = P(a0);
        const [ax1, ay1] = P(a1);
        const [bx0, by0] = P(b0);
        const [bx1, by1] = P(b1);
        pushVertex(mesh, ax0, ay0, color);
        pushVertex(mesh, ax1, ay1, color);
        pushVertex(mesh, bx1, by1, color);
        pushVertex(mesh, ax0, ay0, color);
        pushVertex(mesh, bx1, by1, color);
        pushVertex(mesh, bx0, by0, color);
        poly.push(a0);
      }
      for (let s = STEPS; s >= 0; s--) poly.push(q(pB0, pB1, s / STEPS));
      strips.push(poly);
    });
    const labels: MarkLabel[] = names.map((n, i) => {
      const mid = start[i] + (totalOf[i] * k) / 2;
      const sx = Math.sin(mid);
      const sy = Math.cos(mid);
      const [lx, ly] = at(mid, R + 0.16);
      return {
        tx: lx, ty: ly, text: n, color: ctx.theme.text.secondary, size: 12,
        align: Math.abs(sx) < 0.2 ? 'center' : sx > 0 ? 'left' : 'right',
        baseline: Math.abs(sy) < 0.2 ? 'middle' : sy > 0 ? 'bottom' : 'top',
      } satisfies MarkLabel;
    });
    const inPoly = (poly: [number, number][], x: number, y: number) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (poly[i][1] > y !== poly[j][1] > y && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) inside = !inside;
      }
      return inside;
    };
    const arcBatch = ctx.renderer.createBatch('arc');
    arcBatch.update(new Float32Array(arcs), arcs.length / LAYOUTS.arc.stride);
    return {
      draws: [...batches(ctx, [], mesh, []), { batch: arcBatch }],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const r = Math.hypot(x, y);
        const ang = (Math.atan2(x, y) + TAU) % TAU;
        if (r >= R + 0.03 && r <= R + 0.1) {
          const i = names.findIndex((_, j) => ang >= start[j] && ang <= start[j] + totalOf[j] * k);
          if (i < 0) return null;
          const out = flows.filter((f) => f.s === i).reduce((s, f) => s + f.v, 0);
          const inn = flows.filter((f) => f.t === i).reduce((s, f) => s + f.v, 0);
          return { title: names[i], rows: [{ label: 'Sortant', value: ctx.format(out, vf) }, { label: 'Entrant', value: ctx.format(inn, vf) }] };
        }
        for (let i = strips.length - 1; i >= 0; i--) {
          if (!inPoly(strips[i], x, y)) continue;
          const f = flows[i];
          return { title: `${names[f.s]} → ${names[f.t]}`, rows: [{ label: ctx.fields[vf]?.label ?? vf, value: ctx.format(f.v, vf) }] };
        }
        return null;
      },
    };
  },
};

// --------------------------------------------------------------------- pack

interface PackNode {
  name: string;
  path: string[];
  value: number;
  row: number;
  depth: number;
  children: PackNode[];
  r: number;
  x: number;
  y: number;
  color: RGBA;
}

/**
 * Place circles of radii `rs` without overlap, as close to the center as possible
 * (tangent candidates against every pair, best one kept). Returns centers and the
 * radius of the circle around them.
 */
export function packCircles(rs: number[]): { x: number[]; y: number[]; r: number } {
  const n = rs.length;
  const order = rs.map((r, i) => [r, i] as const).sort((a, b) => b[0] - a[0]).map((d) => d[1]);
  const x = new Array<number>(n).fill(0);
  const y = new Array<number>(n).fill(0);
  const placed: number[] = [];
  const fits = (i: number, px: number, py: number) => placed.every((j) => Math.hypot(px - x[j], py - y[j]) >= rs[i] + rs[j] - 1e-9);
  for (const i of order) {
    if (placed.length === 0) {
      placed.push(i);
      continue;
    }
    if (placed.length === 1) {
      x[i] = rs[placed[0]] + rs[i];
      placed.push(i);
      continue;
    }
    let best: [number, number] | undefined;
    let bestD = Infinity;
    for (const a of placed) {
      for (const b of placed) {
        if (a >= b) continue;
        // Circles of radius ra + ri and rb + ri around a and b meet at the tangent positions.
        const ra = rs[a] + rs[i];
        const rb = rs[b] + rs[i];
        const dx = x[b] - x[a];
        const dy = y[b] - y[a];
        const d = Math.hypot(dx, dy);
        if (d > ra + rb || d < Math.abs(ra - rb) || d === 0) continue;
        const l = (ra * ra - rb * rb + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, ra * ra - l * l));
        const mx = x[a] + (dx * l) / d;
        const my = y[a] + (dy * l) / d;
        for (const sgn of [1, -1]) {
          const px = mx - (sgn * dy * h) / d;
          const py = my + (sgn * dx * h) / d;
          const dist = Math.hypot(px, py) + rs[i];
          if (dist < bestD && fits(i, px, py)) {
            bestD = dist;
            best = [px, py];
          }
        }
      }
    }
    if (!best) {
      // No tangent spot: put it outside everything, on the right.
      const far = Math.max(...placed.map((j) => Math.hypot(x[j], y[j]) + rs[j]));
      best = [far + rs[i], 0];
    }
    [x[i], y[i]] = best;
    placed.push(i);
  }
  // Center the group on its bounding circle.
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const w = rs[i] * rs[i];
    cx += x[i] * w;
    cy += y[i] * w;
    area += w;
  }
  cx /= area || 1;
  cy /= area || 1;
  let r = 0;
  for (let i = 0; i < n; i++) {
    x[i] -= cx;
    y[i] -= cy;
    r = Math.max(r, Math.hypot(x[i], y[i]) + rs[i]);
  }
  return { x, y, r };
}

/** `pack`: a hierarchy (`path`, outermost level first) as nested circles, leaves sized by `value`. */
export const pack: MarkDefinition = {
  standalone: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(-1, 1), y: new LinearScale(-1, 1), aspect: 1 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const path = layer.encode.path;
    if (!path?.length) throw new Error('futurCharts: mark "pack" needs encode.path (a list of fields).');
    const vf = layer.encode.value ?? need(layer, 'y', 'pack');
    const levels = path.map((f) => table.column(f).values);
    const values = table.column(vf).values as Float64Array;
    const root: PackNode = { name: '', path: [], value: 0, row: -1, depth: 0, children: [], r: 0, x: 0, y: 0, color: ctx.surface };
    const tops: string[] = [];
    for (let i = 0; i < table.length; i++) {
      if (!(values[i] > 0)) continue;
      const top = String(levels[0][i]);
      if (!tops.includes(top)) tops.push(top);
      if (ctx.hidden.has(top)) continue;
      let n = root;
      n.value += values[i];
      for (let d = 0; d < path.length; d++) {
        const name = String(levels[d][i]);
        let c = n.children.find((m) => m.name === name);
        if (!c) {
          c = { name, path: [...n.path, name], value: 0, row: i, depth: d + 1, children: [], r: 0, x: 0, y: 0, color: ctx.surface };
          n.children.push(c);
        }
        c.value += values[i];
        n = c;
      }
    }
    const legend = tops.map((t) => ({ key: t, color: ctx.categorical(t) }));
    // Bottom-up: leaves by area, parents around their packed children.
    const size = (n: PackNode): number => {
      if (!n.children.length) return (n.r = Math.sqrt(n.value));
      const rs = n.children.map(size);
      const p = packCircles(rs);
      n.children.forEach((c, i) => {
        c.x = p.x[i];
        c.y = p.y[i];
      });
      return (n.r = p.r * 1.06);
    };
    size(root);
    const scale = 0.98 / (root.r || 1);
    const all: PackNode[] = [];
    const place = (n: PackNode, ox: number, oy: number) => {
      for (const c of n.children) {
        c.x = ox + c.x * scale;
        c.y = oy + c.y * scale;
        c.r *= scale;
        const base = c.depth === 1 ? legend.find((l) => l.key === c.name)!.color : n.color;
        c.color = base;
        all.push(c);
        place(c, c.x, c.y);
      }
    };
    root.x = 0;
    root.y = 0;
    place(root, 0, 0);
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const arcs: number[] = [];
    const labels: MarkLabel[] = [];
    for (const n of all) {
      const leaf = !n.children.length;
      const c = ctx.paint(n.color, n.row);
      const fill = leaf ? mix(ctx.surface, c, 0.78) : withAlpha(c, c[3] * 0.1);
      const [cx, cy] = [ctx.x.norm(n.x), ctx.y.norm(n.y)];
      pushArc(arcs, cx, cy, 0, n.r * unit, 0, TAU, 0, fill);
      if (!leaf) pushArc(arcs, cx, cy, Math.max(0, n.r * unit - ctx.pixel[0] * 1.25), n.r * unit, 0, TAU, 0, withAlpha(c, c[3] * 0.5));
      const h = n.r * 0.72;
      if (leaf) {
        labels.push({ tx: cx, ty: cy, text: n.name, on: fill, size: 11, weight: 500, align: 'center', baseline: 'middle', box: [ctx.x.norm(n.x - h), ctx.y.norm(n.y - h * 0.5), ctx.x.norm(n.x + h), ctx.y.norm(n.y + h * 0.5)] });
      } else if (n.depth === 1) {
        labels.push({ tx: cx, ty: ctx.y.norm(n.y + n.r), text: n.name, color: ctx.theme.text.primary, size: 12, weight: 650, align: 'center', baseline: 'top', dy: 4, box: [ctx.x.norm(n.x - n.r), ctx.y.norm(n.y - n.r), ctx.x.norm(n.x + n.r), ctx.y.norm(n.y + n.r)] });
      }
    }
    const arcBatch = ctx.renderer.createBatch('arc');
    arcBatch.update(new Float32Array(arcs), arcs.length / LAYOUTS.arc.stride);
    return {
      draws: [{ batch: arcBatch }],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        // The deepest circle under the pointer.
        let hit: PackNode | undefined;
        for (const n of all) if (Math.hypot(x - n.x, y - n.y) <= n.r && (!hit || n.depth > hit.depth)) hit = n;
        if (!hit) return null;
        return {
          title: hit.path.join(' › '),
          rows: [
            { label: ctx.fields[vf]?.label ?? vf, value: ctx.format(hit.value, vf) },
            { label: 'Part du total', value: share(hit.value, root.value) },
          ],
        };
      },
    };
  },
};

// ----------------------------------------------------- parallel coordinates

/** `parallel`: one vertical axis per numeric field of `path`, one line per row, colored by `color`. */
export const parallel: MarkDefinition = {
  standalone: true,
  symbol: 'line',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const dims = layer.encode.path;
    if (!dims?.length) throw new Error('futurCharts: mark "parallel" needs encode.path (the numeric fields to compare).');
    const cf = layer.encode.color;
    const cols = dims.map((d) => table.column(d).values as Float64Array);
    const domains = cols.map((v) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of v) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      return niceDomain(lo, hi, 4);
    });
    const n = dims.length;
    const left = 0.06;
    const right = 0.94;
    const top = 0.9;
    const bottom = 0.06;
    const ax = (k: number) => left + ((right - left) * k) / Math.max(1, n - 1);
    const ay = (k: number, v: number) => bottom + ((top - bottom) * (v - domains[k][0])) / (domains[k][1] - domains[k][0] || 1);
    const ccol = cf ? table.column(cf) : undefined;
    const seriesNames = ccol && ccol.type === 'string' ? [...new Set(ccol.values as string[])] : [];
    const legend = seriesNames.map((s) => ({ key: s, color: ctx.categorical(s) }));
    let c0 = Infinity;
    let c1 = -Infinity;
    if (ccol && ccol.type !== 'string') for (const v of ccol.values as Float64Array) (c0 = Math.min(c0, v)), (c1 = Math.max(c1, v));
    const colorOf = (i: number): RGBA => {
      if (!ccol) return ctx.categorical(ctx.fields[dims[0]]?.label ?? dims[0]);
      if (ccol.type === 'string') return legend.find((l) => l.key === ccol.values[i])!.color;
      return ctx.ramp(c1 > c0 ? ((ccol.values[i] as number) - c0) / (c1 - c0) : 0.5);
    };
    const opacity = (layer.style?.opacity as number | undefined) ?? Math.max(0.12, Math.min(0.7, 18 / Math.sqrt(table.length)));
    const lines: number[] = [];
    const visible: number[] = [];
    for (let i = 0; i < table.length; i++) {
      if (ccol?.type === 'string' && ctx.hidden.has(String(ccol.values[i]))) continue;
      if (cols.some((v) => Number.isNaN(v[i]))) continue;
      visible.push(i);
      const c = ctx.paint(colorOf(i), i);
      const col = withAlpha(c, c[3] * opacity);
      for (let k = 0; k < n - 1; k++) pushSegment(lines, ax(k), ay(k, cols[k][i]), ax(k + 1), ay(k + 1, cols[k + 1][i]), col, 1.25);
    }
    // Axes drawn on top of the lines, with their name and range.
    const axes: number[] = [];
    const axisColor = parseColor(ctx.theme.axis.line.color);
    const labels: MarkLabel[] = [];
    dims.forEach((d, k) => {
      pushSegment(axes, ax(k), bottom, ax(k), top, axisColor, 1);
      labels.push({ tx: ax(k), ty: top, text: ctx.fields[d]?.label ?? d, color: ctx.theme.text.primary, weight: 600, size: 12, align: 'center', baseline: 'bottom', dy: -8 });
      for (const v of [domains[k][0], (domains[k][0] + domains[k][1]) / 2, domains[k][1]]) {
        labels.push({ tx: ax(k), ty: ay(k, v), text: ctx.format(v, d), color: ctx.theme.text.muted, size: 10, align: 'right', baseline: 'middle', dx: -5 });
      }
    });
    const draws = [...batches(ctx, [], [], lines), ...batches(ctx, [], [], axes)];
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        if (tx < left || tx > right) return null;
        const k = Math.min(n - 2, Math.floor(((tx - left) / (right - left)) * (n - 1)));
        const f = (tx - ax(k)) / (ax(k + 1) - ax(k) || 1);
        let best = -1;
        let bestD = 6 * ctx.pixel[1];
        for (const i of visible) {
          const y = ay(k, cols[k][i]) * (1 - f) + ay(k + 1, cols[k + 1][i]) * f;
          const d = Math.abs(y - ty);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best < 0) return null;
        const rows = dims.map((d, j) => ({ label: ctx.fields[d]?.label ?? d, value: ctx.format(cols[j][best], d) }));
        return { title: ccol ? String(ccol.values[best]) : `Ligne ${best + 1}`, rows };
      },
    };
  },
};

// ------------------------------------------------------------------ network

interface NetLayout {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

/** Force-directed placement (Fruchterman–Reingold), deterministic, in a W × H box. */
export function forceLayout(nodes: FlowNode[], edges: FlowEdge[], W = 900, H = 560, iterations = 360): NetLayout {
  const n = nodes.length;
  const idx = new Map(nodes.map((d, i) => [d.id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  nodes.forEach((_, i) => {
    // A golden-angle spiral: spread out, and the same every time.
    const a = i * 2.39996;
    const r = 18 * Math.sqrt(i + 1);
    x[i] = W / 2 + Math.cos(a) * r;
    y[i] = H / 2 + Math.sin(a) * r;
  });
  const links = edges.map((e) => [idx.get(e.from), idx.get(e.to)] as const).filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1]);
  const k = Math.sqrt((W * H) / Math.max(1, n)) * 0.55;
  let temp = W / 8;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j];
        let ey = y[i] - y[j];
        let d = Math.hypot(ex, ey);
        if (d < 0.01) (ex = 0.01 * (i - j)), (ey = 0.01), (d = 0.02);
        // Repulsion only between neighbors: far-off nodes (isolated ones) do not push
        // each other out of the picture.
        if (d > 3 * k) continue;
        const f = (k * k) / d;
        dx[i] += (ex / d) * f;
        dy[i] += (ey / d) * f;
        dx[j] -= (ex / d) * f;
        dy[j] -= (ey / d) * f;
      }
    }
    for (const [a, b] of links) {
      const ex = x[a] - x[b];
      const ey = y[a] - y[b];
      const d = Math.hypot(ex, ey) || 0.01;
      const f = (d * d) / k;
      dx[a] -= (ex / d) * f;
      dy[a] -= (ey / d) * f;
      dx[b] += (ex / d) * f;
      dy[b] += (ey / d) * f;
    }
    for (let i = 0; i < n; i++) {
      // A pull to the center, growing with the distance: isolated nodes stay close
      // to the rest instead of drifting away and squeezing everyone else when fitted.
      dx[i] += (W / 2 - x[i]) * 0.04;
      dy[i] += (H / 2 - y[i]) * 0.04;
      const d = Math.hypot(dx[i], dy[i]) || 1;
      x[i] += (dx[i] / d) * Math.min(d, temp);
      y[i] += (dy[i] / d) * Math.min(d, temp);
    }
    temp = Math.max(0.5, temp * 0.985);
  }
  // Fit the result into the box with a margin.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) (x0 = Math.min(x0, x[i])), (x1 = Math.max(x1, x[i])), (y0 = Math.min(y0, y[i])), (y1 = Math.max(y1, y[i]));
  const m = 60;
  const s = Math.min((W - 2 * m) / (x1 - x0 || 1), (H - 2 * m) / (y1 - y0 || 1));
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((d, i) => pos.set(d.id, { x: m + (x[i] - x0) * s + ((W - 2 * m) - (x1 - x0) * s) / 2, y: m + (y[i] - y0) * s + ((H - 2 * m) - (y1 - y0) * s) / 2 }));
  return { pos, width: W, height: H };
}

const netCache = new WeakMap<LayerSpec, NetLayout>();

/**
 * `network`: nodes and links from `layer.graph`, placed by forces. Node size by
 * `value`, color by `group`, link width by `value`. Nodes can be dragged; the
 * chart then emits `layout` with every position (save them as `x` / `y`).
 */
export const network: MarkDefinition = {
  standalone: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1), aspect: 900 / 560 }),
  build(ctx: BuildContext) {
    const { layer } = ctx.data;
    const graph = layer.graph;
    if (!graph) throw new Error('futurCharts: mark "network" needs layer.graph = { nodes, edges }.');
    const { nodes, edges } = graph;
    let lay = netCache.get(layer);
    if (!lay) netCache.set(layer, (lay = forceLayout(nodes, edges)));
    const W = lay.width;
    const H = lay.height;
    const moved = (ctx.state.positions as Record<string, { x: number; y: number }> | undefined) ?? {};
    ctx.state.positions = moved;
    const at = (id: string) => moved[id] ?? (nodes.find((n) => n.id === id)?.x !== undefined ? { x: nodes.find((n) => n.id === id)!.x!, y: nodes.find((n) => n.id === id)!.y ?? H / 2 } : lay!.pos.get(id)!);
    const groups = [...new Set(nodes.map((n) => n.group).filter((g): g is string => !!g))];
    const legend = groups.map((g) => ({ key: g, color: ctx.categorical(g) }));
    const maxV = Math.max(1, ...nodes.map((n) => n.value ?? 1));
    const radius = (n: FlowNode) => 6 + 16 * Math.sqrt((n.value ?? 1) / maxV);
    const maxE = Math.max(0, ...edges.map((e) => e.value ?? 0));
    const hl = layer.highlight;
    const lit = (n: FlowNode) => !hl || hl.values.map(String).includes(n.id) || hl.values.map(String).includes(n.label ?? '');
    const dim = hl?.dim ?? 0.25;
    const unit = 1 / W;
    const tx = (x: number) => x / W;
    const ty = (y: number) => 1 - y / H;
    const linkColor = withAlpha(parseColor(ctx.theme.text.muted), 0.45);
    const arcsB = ctx.renderer.createBatch('arc');
    const linesB = ctx.renderer.createBatch('line');
    const labels: MarkLabel[] = [];
    const render = () => {
      const lines: number[] = [];
      const arcs: number[] = [];
      labels.length = 0;
      for (const e of edges) {
        const a = nodes.find((n) => n.id === e.from);
        const b = nodes.find((n) => n.id === e.to);
        if (!a || !b || (a.group && ctx.hidden.has(a.group)) || (b.group && ctx.hidden.has(b.group))) continue;
        const pa = at(a.id);
        const pb = at(b.id);
        const on = lit(a) && lit(b);
        const w = e.value !== undefined && maxE > 0 ? 1 + 4 * (e.value / maxE) : 1.25;
        pushSegment(lines, tx(pa.x), ty(pa.y), tx(pb.x), ty(pb.y), on ? linkColor : withAlpha(linkColor, linkColor[3] * dim), w);
      }
      for (const n of nodes) {
        if (n.group && ctx.hidden.has(n.group)) continue;
        const p = at(n.id);
        const on = lit(n);
        const base = n.color ? parseColor(n.color) : n.group ? ctx.categorical(n.group) : ctx.categorical('Nœuds');
        const c = on ? base : withAlpha(base, base[3] * dim);
        const r = radius(n);
        // A surface ring keeps overlapping nodes apart.
        pushArc(arcs, tx(p.x), ty(p.y), 0, (r + 2) * unit, 0, TAU, 0, on ? ctx.surface : withAlpha(ctx.surface, dim));
        pushArc(arcs, tx(p.x), ty(p.y), 0, r * unit, 0, TAU, 0, c);
        if (r > 9 || nodes.length <= 30) {
          labels.push({ tx: tx(p.x), ty: ty(p.y + r), text: n.label ?? n.id, size: 11, weight: 500, align: 'center', baseline: 'top', dy: 4, color: on ? ctx.theme.text.primary : toCss(withAlpha(parseColor(ctx.theme.text.primary), dim)), fontScale: 1 / W });
        }
      }
      linesB.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
      arcsB.update(new Float32Array(arcs), arcs.length / LAYOUTS.arc.stride);
    };
    render();
    const nodeAt = (x: number, y: number) =>
      [...nodes].reverse().find((n) => {
        const p = at(n.id);
        return !(n.group && ctx.hidden.has(n.group)) && Math.hypot(x - p.x, y - p.y) <= radius(n) + 3;
      });
    let dragging: { id: string; dx: number; dy: number } | undefined;
    return {
      draws: [
        { batch: linesB, enter: 'fade' },
        { batch: arcsB, enter: 'fade' },
      ],
      hit: emptyHit(),
      labels,
      legend,
      pick(px, py): ShapeHit | null {
        const n = nodeAt(px * W, (1 - py) * H);
        if (!n) return null;
        const links = edges.filter((e) => e.from === n.id || e.to === n.id);
        const rows = [{ label: 'Liens', value: String(links.length) }];
        if (n.value !== undefined) rows.unshift({ label: ctx.fields[layer.encode.value ?? '']?.label ?? 'Valeur', value: ctx.format(n.value, layer.encode.value) });
        if (n.group) rows.push({ label: 'Groupe', value: n.group });
        return { title: n.label ?? n.id, rows };
      },
      click(px, py) {
        const n = nodeAt(px * W, (1 - py) * H);
        return n ? [n.id] : undefined;
      },
      drag: {
        start(px, py) {
          const n = nodeAt(px * W, (1 - py) * H);
          if (!n) return false;
          const p = at(n.id);
          dragging = { id: n.id, dx: p.x - px * W, dy: p.y - (1 - py) * H };
          return true;
        },
        move(px, py) {
          if (!dragging) return;
          moved[dragging.id] = {
            x: Math.min(W - 8, Math.max(8, px * W + dragging.dx)),
            y: Math.min(H - 8, Math.max(8, (1 - py) * H + dragging.dy)),
          };
          render();
        },
        end() {
          dragging = undefined;
          const positions: Record<string, { x: number; y: number }> = {};
          for (const n of nodes) {
            const p = at(n.id);
            positions[n.id] = { x: Math.round(p.x), y: Math.round(p.y) };
          }
          return positions;
        },
      },
    };
  },
};

// ------------------------------------------------------------------- hexbin

/**
 * `hexbin`: points (`x`, `y`) counted in hexagons of `style.radius` px; the
 * color says how many fall in each. Readable with hundreds of thousands of points.
 */
export const hexbin: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales({ layer, table, fields }) {
    const ext = (f: string) => {
      const v = table.column(f).values as Float64Array;
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of v) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      return niceDomain(lo, hi, 6);
    };
    const xf = need(layer, 'x', 'hexbin');
    const yf = need(layer, 'y', 'hexbin');
    const [x0, x1] = ext(xf);
    const [y0, y1] = ext(yf);
    return { x: new LinearScale(x0, x1, fields[xf]?.format), y: new LinearScale(y0, y1, fields[yf]?.format), axes: { x: true, y: true }, grid: { y: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const xf = layer.encode.x!;
    const yf = layer.encode.y!;
    const xs = table.column(xf).values as Float64Array;
    const ys = table.column(yf).values as Float64Array;
    const R = (layer.style?.radius as number | undefined) ?? 9;
    const [pxw, pxh] = ctx.pixel;
    const w = Math.sqrt(3) * R;
    const h = 1.5 * R;
    const bins = new Map<number, { q: number; r: number; n: number }>();
    for (let i = 0; i < table.length; i++) {
      // Pixel position, then axial hex coordinates rounded to the nearest hexagon.
      const px = ctx.x.norm(xs[i]) / pxw;
      const py = ctx.y.norm(ys[i]) / pxh;
      if (!Number.isFinite(px + py)) continue;
      const fq = (px * Math.sqrt(3)) / 3 / R - py / 3 / R;
      const fr = ((2 / 3) * py) / R;
      let q = Math.round(fq);
      let r = Math.round(fr);
      const s = Math.round(-fq - fr);
      const dq = Math.abs(q - fq);
      const dr = Math.abs(r - fr);
      const ds = Math.abs(s - (-fq - fr));
      if (dq > dr && dq > ds) q = -r - s;
      else if (dr > ds) r = -q - s;
      // Numeric key: string keys cost more than the binning itself on 100 000+ points.
      const key = (q + 32768) * 65536 + (r + 32768);
      const b = bins.get(key);
      if (b) b.n++;
      else bins.set(key, { q, r, n: 1 });
    }
    const max = Math.max(1, ...[...bins.values()].map((b) => b.n));
    const mesh: number[] = [];
    const centers: { x: number; y: number; n: number }[] = [];
    const inner = R - 0.75;
    for (const b of bins.values()) {
      const cxp = w * (b.q + b.r / 2);
      const cyp = h * b.r;
      const c = ctx.ramp(0.15 + 0.85 * Math.sqrt(b.n / max));
      const cx = cxp * pxw;
      const cy = cyp * pxh;
      centers.push({ x: cx, y: cy, n: b.n });
      for (let k = 0; k < 6; k++) {
        const a0 = (Math.PI / 3) * k + Math.PI / 6;
        const a1 = (Math.PI / 3) * (k + 1) + Math.PI / 6;
        pushVertex(mesh, cx, cy, c);
        pushVertex(mesh, cx + Math.cos(a0) * inner * pxw, cy + Math.sin(a0) * inner * pxh, c);
        pushVertex(mesh, cx + Math.cos(a1) * inner * pxw, cy + Math.sin(a1) * inner * pxh, c);
      }
    }
    return {
      draws: batches(ctx, [], mesh, []),
      hit: emptyHit(),
      pick(tx, ty): ShapeHit | null {
        let best: (typeof centers)[number] | undefined;
        let bestD = R * R;
        for (const c of centers) {
          const d = ((c.x - tx) / pxw) ** 2 + ((c.y - ty) / pxh) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (!best) return null;
        return {
          title: `${ctx.format(ctx.x.invert(best.x), xf)} · ${ctx.format(ctx.y.invert(best.y), yf)}`,
          rows: [{ label: 'Points', value: new Intl.NumberFormat().format(best.n) }],
        };
      },
    };
  },
};

export const MORE_MARKS: Record<string, MarkDefinition> = { marimekko, chord, pack, parallel, network, hexbin };

