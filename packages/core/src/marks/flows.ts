/** Sankey, sunburst and calendar: standalone marks built on the same primitives as the others. */
import type { Table } from '../data/table';
import type { RGBA } from '../render/types';
import { BandScale, LinearScale } from '../scale/scales';
import { mix, parseColor, withAlpha } from '../util/color';
import { batches, need, share } from './charts';
import { Tween } from './animate';
import { pushArc, pushRect, pushVertex } from './primitives';
import { emptyHit, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';

const TAU = Math.PI * 2;
const DAY = 86400000;

// ------------------------------------------------------------------- sankey

interface SNode {
  name: string;
  depth: number;
  col: number;
  value: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  out: SLink[];
  in: SLink[];
}

interface SLink {
  source: SNode;
  target: SNode;
  value: number;
  width: number;
  /** Top of the ribbon at the source and at the target. */
  sy: number;
  ty: number;
}

/**
 * Sankey layout in pixels (y down): columns by longest path, sinks pushed to
 * the right, then a few relaxation passes that pull each node towards the
 * nodes it connects to, without overlaps.
 */
export function sankeyLayout(
  flows: { source: string; target: string; value: number }[],
  W: number,
  H: number,
  nodeWidth: number,
  pad: number,
): { nodes: SNode[]; links: SLink[] } {
  const nodes = new Map<string, SNode>();
  const node = (name: string) => {
    let n = nodes.get(name);
    if (!n) nodes.set(name, (n = { name, depth: 0, col: 0, value: 0, x0: 0, x1: 0, y0: 0, y1: 0, out: [], in: [] }));
    return n;
  };
  const merged = new Map<string, SLink>();
  for (const f of flows) {
    if (!(f.value > 0) || f.source === f.target) continue;
    const id = `${f.source}\u0000${f.target}`;
    const l = merged.get(id);
    if (l) l.value += f.value;
    else merged.set(id, { source: node(f.source), target: node(f.target), value: f.value, width: 0, sy: 0, ty: 0 });
  }
  const links = [...merged.values()];
  for (const l of links) {
    l.source.out.push(l);
    l.target.in.push(l);
  }
  const list = [...nodes.values()];
  // Longest path from the sources; bounded so a cycle cannot loop forever.
  for (let k = 0; k < list.length; k++) {
    let changed = false;
    for (const l of links) {
      if (l.target.depth < l.source.depth + 1) {
        l.target.depth = l.source.depth + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const maxDepth = Math.max(0, ...list.map((n) => n.depth));
  const columns: SNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const n of list) {
    n.col = n.out.length ? n.depth : maxDepth;
    n.value = Math.max(
      n.in.reduce((a, l) => a + l.value, 0),
      n.out.reduce((a, l) => a + l.value, 0),
    );
    columns[n.col].push(n);
  }
  const step = maxDepth > 0 ? (W - nodeWidth) / maxDepth : 0;
  const ky = Math.min(...columns.filter((c) => c.length).map((c) => (H - (c.length - 1) * pad) / c.reduce((a, n) => a + n.value, 0)));
  for (const c of columns) {
    let y = 0;
    for (const n of c) {
      n.x0 = n.col * step;
      n.x1 = n.x0 + nodeWidth;
      n.y0 = y;
      n.y1 = y + n.value * ky;
      y = n.y1 + pad;
    }
  }
  for (const l of links) l.width = l.value * ky;

  const center = (n: SNode) => (n.y0 + n.y1) / 2;
  const resolve = (c: SNode[]) => {
    c.sort((a, b) => a.y0 - b.y0);
    let y = 0;
    for (const n of c) {
      const dy = Math.max(0, y - n.y0);
      n.y0 += dy;
      n.y1 += dy;
      y = n.y1 + pad;
    }
    // Overflow at the bottom: push back up.
    let bottom = H;
    for (let i = c.length - 1; i >= 0; i--) {
      const n = c[i];
      const dy = Math.max(0, n.y1 - bottom);
      n.y0 -= dy;
      n.y1 -= dy;
      bottom = n.y0 - pad;
    }
  };
  for (let iter = 0, alpha = 0.9; iter < 8; iter++, alpha *= 0.85) {
    for (const c of iter % 2 ? [...columns].reverse() : columns) {
      for (const n of c) {
        const peers = iter % 2 ? n.out.map((l) => [l.target, l.value] as const) : n.in.map((l) => [l.source, l.value] as const);
        const total = peers.reduce((a, [, v]) => a + v, 0);
        if (!total) continue;
        const target = peers.reduce((a, [p, v]) => a + center(p) * v, 0) / total;
        const dy = (target - center(n)) * alpha;
        n.y0 += dy;
        n.y1 += dy;
      }
      resolve(c);
    }
  }
  // Ribbons leave and enter each node in the order of the nodes they reach.
  for (const n of list) {
    let y = n.y0;
    for (const l of [...n.out].sort((a, b) => a.target.y0 - b.target.y0)) {
      l.sy = y;
      y += l.width;
    }
    y = n.y0;
    for (const l of [...n.in].sort((a, b) => a.source.y0 - b.source.y0)) {
      l.ty = y;
      y += l.width;
    }
  }
  return { nodes: list, links };
}

/** `sankey`: flows from `source` to `target`, sized by `value`. */
export const sankey: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const sf = need(layer, 'source', 'sankey');
    const tf = need(layer, 'target', 'sankey');
    const vf = layer.encode.value ?? need(layer, 'y', 'sankey');
    const src = table.column(sf).values;
    const dst = table.column(tf).values;
    const val = table.column(vf).values as Float64Array;
    const flows = Array.from({ length: table.length }, (_, i) => ({ source: String(src[i]), target: String(dst[i]), value: val[i], row: i }));
    const W = 1 / ctx.pixel[0];
    const H = 1 / ctx.pixel[1];
    const { nodes, links } = sankeyLayout(flows, W, H, style.nodeWidth, style.nodePadding);
    const tx = (x: number) => x / W;
    const ty = (y: number) => 1 - y / H;
    const baseOf = new Map(nodes.map((n) => [n.name, ctx.categorical(n.name)]));
    // A node takes the style of its first outgoing flow, or of its first incoming one.
    const nodeRow = (name: string) => flows.find((f) => f.source === name)?.row ?? flows.find((f) => f.target === name)?.row;
    const colorOf = new Map(nodes.map((n) => [n.name, ctx.paint(baseOf.get(n.name)!, nodeRow(n.name))]));
    const linkRow = (l: SLink) => flows.find((f) => f.source === l.source.name && f.target === l.target.name)?.row;

    const mesh: number[] = [];
    const ribbons: { link: SLink; xs: Float64Array; top: Float64Array; bottom: Float64Array }[] = [];
    const STEPS = 32;
    for (const l of links) {
      const x0 = l.source.x1;
      const x1 = l.target.x0;
      const xm = (x0 + x1) / 2;
      const xs = new Float64Array(STEPS + 1);
      const top = new Float64Array(STEPS + 1);
      const bottom = new Float64Array(STEPS + 1);
      for (let k = 0; k <= STEPS; k++) {
        const t = k / STEPS;
        const u = 1 - t;
        // Cubic Bézier with horizontal tangents at both ends.
        xs[k] = u * u * u * x0 + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * x1;
        const w = 3 * u * t * t + t * t * t;
        top[k] = l.sy + (l.ty - l.sy) * w;
        bottom[k] = top[k] + l.width;
      }
      const row = linkRow(l);
      const c0 = withAlpha(ctx.paint(baseOf.get(l.source.name)!, row), style.linkOpacity);
      const c1 = withAlpha(ctx.paint(baseOf.get(l.target.name)!, row), style.linkOpacity);
      for (let k = 0; k < STEPS; k++) {
        const ca = mix(c0, c1, k / STEPS);
        const cb = mix(c0, c1, (k + 1) / STEPS);
        pushVertex(mesh, tx(xs[k]), ty(top[k]), ca);
        pushVertex(mesh, tx(xs[k + 1]), ty(top[k + 1]), cb);
        pushVertex(mesh, tx(xs[k + 1]), ty(bottom[k + 1]), cb);
        pushVertex(mesh, tx(xs[k]), ty(top[k]), ca);
        pushVertex(mesh, tx(xs[k + 1]), ty(bottom[k + 1]), cb);
        pushVertex(mesh, tx(xs[k]), ty(bottom[k]), ca);
      }
      ribbons.push({ link: l, xs, top, bottom });
    }

    const rects: number[] = [];
    const labels: MarkLabel[] = [];
    const lastCol = Math.max(0, ...nodes.map((n) => n.col));
    const r = style.radius;
    for (const n of nodes) {
      pushRect(rects, { x0: tx(n.x0), y0: ty(n.y1), x1: tx(n.x1), y1: ty(n.y0), fill: colorOf.get(n.name)!, radii: [r, r, r, r] });
      if (style.labels && n.y1 - n.y0 >= 8) {
        const right = n.col < lastCol;
        labels.push({
          tx: tx(right ? n.x1 : n.x0), ty: ty((n.y0 + n.y1) / 2), text: `${n.name}  ${ctx.format(n.value, vf)}`,
          align: right ? 'left' : 'right', baseline: 'middle', dx: right ? 6 : -6, color: ctx.theme.text.primary, size: 12,
        });
      }
    }
    const label = ctx.fields[vf]?.label ?? vf;
    return {
      draws: [...batches(ctx, [], mesh, []), ...batches(ctx, rects, [], [], false)],
      hit: emptyHit(),
      labels,
      pick(px, py): ShapeHit | null {
        const x = px * W;
        const y = (1 - py) * H;
        const n = nodes.find((m) => x >= m.x0 && x <= m.x1 && y >= m.y0 && y <= m.y1);
        if (n) {
          const incoming = n.in.reduce((a, l) => a + l.value, 0);
          const outgoing = n.out.reduce((a, l) => a + l.value, 0);
          const rows = [{ label, value: ctx.format(n.value, vf) }];
          if (incoming && outgoing) rows.push({ label: 'Sortant', value: share(outgoing, incoming) });
          return { title: n.name, rows };
        }
        // Topmost ribbon under the pointer (the last drawn).
        for (let i = ribbons.length - 1; i >= 0; i--) {
          const rb = ribbons[i];
          if (x < rb.xs[0] || x > rb.xs[rb.xs.length - 1]) continue;
          let k = 0;
          while (k < rb.xs.length - 2 && rb.xs[k + 1] < x) k++;
          const f = (x - rb.xs[k]) / (rb.xs[k + 1] - rb.xs[k] || 1);
          const top = rb.top[k] + (rb.top[k + 1] - rb.top[k]) * f;
          if (y >= top && y <= top + rb.link.width) {
            const l = rb.link;
            return {
              title: `${l.source.name} → ${l.target.name}`,
              rows: [
                { label, value: ctx.format(l.value, vf) },
                { label: `Part de ${l.source.name}`, value: share(l.value, l.source.value) },
              ],
            };
          }
        }
        return null;
      },
    };
  },
};

// ----------------------------------------------------------------- sunburst

interface SunNode {
  name: string;
  path: string[];
  value: number;
  depth: number;
  children: Map<string, SunNode>;
  parent?: SunNode;
  /** Angles in the full, unzoomed tree. */
  a0: number;
  a1: number;
  color: RGBA;
  /** Color before overrides; inner levels derive from it. */
  base: RGBA;
  /** First source row, for overrides and highlights. */
  row: number;
  /** Index into the tween (4 values: a0, a1, r0, r1). */
  slot: number;
}

/**
 * `sunburst`: a hierarchy (`path`, outermost level first) as nested rings,
 * sized by `value`. Click a segment to zoom into it (animated), click the
 * center to go back up. The focus survives resizes and data refreshes.
 */
export const sunburst: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(-1, 1), y: new LinearScale(-1, 1), aspect: 1 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const path = layer.encode.path;
    if (!path?.length) throw new Error('futurCharts: mark "sunburst" needs encode.path (a list of fields).');
    const vf = layer.encode.value ?? need(layer, 'y', 'sunburst');
    const levels = path.map((f) => table.column(f).values);
    const values = table.column(vf).values as Float64Array;
    const root: SunNode = { name: '', path: [], value: 0, depth: 0, children: new Map(), a0: 0, a1: TAU, color: ctx.surface, base: ctx.surface, row: -1, slot: -1 };
    const topNames: string[] = [];
    for (let i = 0; i < table.length; i++) {
      const v = values[i];
      if (!(v > 0)) continue;
      const top = String(levels[0][i]);
      if (!topNames.includes(top)) topNames.push(top);
      if (ctx.hidden.has(top)) continue;
      let n = root;
      n.value += v;
      for (let d = 0; d < path.length; d++) {
        const name = String(levels[d][i]);
        let c = n.children.get(name);
        if (!c) {
          c = { name, path: [...n.path, name], value: 0, depth: d + 1, children: new Map(), parent: n, a0: 0, a1: 0, color: ctx.surface, base: ctx.surface, row: i, slot: -1 };
          n.children.set(name, c);
        }
        c.value += v;
        n = c;
      }
    }
    const D = path.length;
    // Color slots follow the entities in data order, never their rank: register them before sorting.
    const legend = topNames.map((n) => ({ key: n, color: ctx.categorical(n) }));
    const all: SunNode[] = [];
    const layout = (n: SunNode) => {
      let a = n.a0;
      // Biggest first, like the slices of a pie.
      for (const c of [...n.children.values()].sort((p, q) => q.value - p.value)) {
        c.a0 = a;
        c.a1 = a + ((n.a1 - n.a0) * c.value) / (n.value || 1);
        a = c.a1;
        // Inner levels take their branch's hue, lighter with depth.
        c.base = c.depth === 1 ? ctx.categorical(c.name) : mix(n.base, ctx.surface, 0.24);
        c.color = ctx.paint(c.base, c.row);
        c.slot = all.length;
        all.push(c);
        layout(c);
      }
    };
    layout(root);

    const R = 0.98;
    const hole = R * style.innerRadius;
    const find = (p: string[]) => {
      let n: SunNode | undefined = root;
      for (const k of p) n = n?.children.get(k);
      return n ?? root;
    };
    let focus = find((ctx.state.focus as string[] | undefined) ?? []);

    /** Geometry of every segment when `f` fills the circle: its subtree spread over 360°, ancestors folded into the hole. */
    const target = (f: SunNode): Float64Array => {
      const out = new Float64Array(all.length * 4);
      const rings = Math.max(1, D - f.depth);
      const span = f.a1 - f.a0 || 1;
      for (const n of all) {
        const a0 = Math.min(TAU, Math.max(0, ((n.a0 - f.a0) / span) * TAU));
        const a1 = Math.min(TAU, Math.max(0, ((n.a1 - f.a0) / span) * TAU));
        const dd = n.depth - f.depth;
        const r0 = dd <= 0 ? hole : hole + ((R - hole) * (dd - 1)) / rings;
        const r1 = dd <= 0 ? hole : hole + ((R - hole) * dd) / rings;
        out.set([a0, a1, r0, r1], n.slot * 4);
      }
      return out;
    };
    const tween = new Tween(target(focus));
    const cx = ctx.x.norm(0);
    const cy = ctx.y.norm(0);
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const batch = ctx.renderer.createBatch('arc');
    const labels: MarkLabel[] = [];

    const write = () => {
      const g = tween.current;
      const out: number[] = [];
      for (const n of all) {
        const k = n.slot * 4;
        pushArc(out, cx, cy, g[k + 2] * unit, g[k + 3] * unit, g[k], g[k + 1], style.gap, n.color);
      }
      batch.update(new Float32Array(out), all.length);
    };
    const placeLabels = () => {
      labels.length = 0;
      if (tween.moving) return; // no text while segments move
      const g = tween.current;
      const at = (a: number, r: number): [number, number] => [ctx.x.norm(Math.sin(a) * r), ctx.y.norm(Math.cos(a) * r)];
      if (style.labels) {
        for (const n of all) {
          const k = n.slot * 4;
          const [a0, a1, ri, ro] = [g[k], g[k + 1], g[k + 2], g[k + 3]];
          const sweep = a1 - a0;
          if (sweep <= 0.01 || ro - ri <= 0.001) continue;
          const mid = (a0 + a1) / 2;
          const rm = (ri + ro) / 2;
          // Room along the arc (chord) and across the ring, projected on the screen axes.
          const along = Math.sin(Math.min(sweep / 2, Math.PI / 2)) * rm * 0.92;
          const across = ((ro - ri) / 2) * 0.92;
          const sx = Math.abs(Math.sin(mid));
          const sy = Math.abs(Math.cos(mid));
          const hw = Math.max(along * sy, across * sx) + Math.min(along * sy, across * sx) * 0.4;
          const hh = Math.max(along * sx, across * sy) * 0.6;
          const [lx, ly] = at(mid, rm);
          const px = Math.sin(mid) * rm;
          const py = Math.cos(mid) * rm;
          labels.push({
            tx: lx, ty: ly, text: n.name, on: n.color, align: 'center', baseline: 'middle', size: 11, weight: n.depth - focus.depth === 1 ? 600 : 500,
            box: [ctx.x.norm(px - hw), ctx.y.norm(py - hh), ctx.x.norm(px + hw), ctx.y.norm(py + hh)],
          });
        }
      }
      // Center: the focus and its total, only if they fit in the hole.
      const box: [number, number, number, number] = [ctx.x.norm(-hole * 0.9), ctx.y.norm(-hole * 0.6), ctx.x.norm(hole * 0.9), ctx.y.norm(hole * 0.6)];
      if (focus !== root) labels.push({ tx: cx, ty: cy, text: focus.name, color: theme.text.primary, size: 13, weight: 650, align: 'center', baseline: 'bottom', dy: -1, box });
      labels.push({
        tx: cx, ty: cy, text: ctx.format(focus.value, vf), color: focus === root ? theme.text.primary : theme.text.secondary,
        size: focus === root ? 14 : 12, weight: focus === root ? 650 : 500, align: 'center', baseline: focus === root ? 'middle' : 'top', dy: focus === root ? 0 : 3, box,
      });
    };
    write();
    placeLabels();

    const polar = (tx: number, ty: number) => {
      const x = ctx.x.invert(tx);
      const y = ctx.y.invert(ty);
      return { r: Math.hypot(x, y), a: (Math.atan2(x, y) + TAU) % TAU };
    };
    const hit = (tx: number, ty: number) => {
      const { r, a } = polar(tx, ty);
      const g = tween.current;
      return all.find((n) => {
        const k = n.slot * 4;
        return a >= g[k] && a < g[k + 1] && r >= g[k + 2] && r < g[k + 3] && g[k + 3] - g[k + 2] > 1e-6;
      });
    };
    const label = ctx.fields[vf]?.label ?? vf;
    return {
      draws: [{ batch }],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const { r } = polar(tx, ty);
        if (r < hole) return focus === root ? null : { title: `↑ ${focus.parent && focus.parent !== root ? focus.parent.name : 'Tout afficher'}`, rows: [] };
        const n = hit(tx, ty);
        if (!n) return null;
        const rows = [
          { label, value: ctx.format(n.value, vf) },
          { label: 'Part du total', value: share(n.value, root.value) },
        ];
        if (n.parent && n.parent !== root) rows.push({ label: `Part de ${n.parent.name}`, value: share(n.value, n.parent.value) });
        return { title: n.path.join(' › '), rows };
      },
      click(tx, ty) {
        const { r } = polar(tx, ty);
        let next: SunNode | undefined;
        if (r < hole) next = focus === root ? undefined : (focus.parent ?? root);
        else {
          const n = hit(tx, ty);
          // A leaf zooms on its parent; clicking the focus' own ring again does nothing new.
          if (n) next = n.children.size ? n : (n.parent ?? root);
        }
        if (!next || next === focus) return undefined;
        focus = next;
        ctx.state.focus = focus.path;
        tween.go(target(focus), performance.now());
        placeLabels();
        return focus.path;
      },
      muted: () => (focus === root ? [] : topNames.filter((n) => n !== focus.path[0])),
      animate(now) {
        if (!tween.moving) return false;
        const more = tween.step(now);
        write();
        if (!more) placeLabels();
        // One more frame after the last step, so the labels get drawn.
        return true;
      },
    };
  },
};

// ----------------------------------------------------------------- calendar

/** Days since the epoch of the local calendar date (DST-proof). */
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
const fromDayNumber = (n: number) => {
  const u = new Date(n * DAY);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
};

interface CalendarModel {
  first: number;
  weeks: number;
  values: Map<number, number>;
  /** First source row of each day. */
  rows: Map<number, number>;
  lo: number;
  hi: number;
  weekLabels: string[];
  dayLabels: string[];
}

function calendarModel(table: Table, dateField: string, valueField: string): CalendarModel {
  const dates = table.column(dateField).values;
  const vals = table.column(valueField).values as Float64Array;
  const values = new Map<number, number>();
  const rows = new Map<number, number>();
  for (let i = 0; i < table.length; i++) {
    const t = typeof dates[i] === 'number' ? (dates[i] as number) : Date.parse(String(dates[i]));
    if (Number.isNaN(t) || Number.isNaN(vals[i])) continue;
    const n = dayNumber(new Date(t));
    values.set(n, (values.get(n) ?? 0) + vals[i]);
    if (!rows.has(n)) rows.set(n, i);
  }
  const days = [...values.keys()];
  const start = days.length ? Math.min(...days) : dayNumber(new Date());
  const end = days.length ? Math.max(...days) : start;
  // Weeks start on Monday.
  const first = start - ((fromDayNumber(start).getDay() + 6) % 7);
  const weeks = Math.floor((end - first) / 7) + 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values.values()) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const month = new Intl.DateTimeFormat(undefined, { month: 'short' });
  const weekLabels = Array.from({ length: weeks }, (_, w) => {
    // A month is named on the week that holds its 1st.
    for (let d = 0; d < 7; d++) {
      const date = fromDayNumber(first + w * 7 + d);
      if (date.getDate() === 1) return month.format(date);
    }
    return w === 0 ? month.format(fromDayNumber(first + 6)) : '';
  });
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const dayLabels = Array.from({ length: 7 }, (_, d) => weekday.format(fromDayNumber(first + d)));
  return { first, weeks, values, rows, lo, hi, weekLabels, dayLabels };
}

/** `calendar`: one square per day (`x`: date), weeks as columns, colored by `value` (or `color`). */
export const calendar: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales({ layer, table }) {
    const m = calendarModel(table, need(layer, 'x', 'calendar'), layer.encode.value ?? need(layer, 'color', 'calendar'));
    return {
      x: new BandScale(m.weekLabels, 0, 0),
      y: new BandScale(m.dayLabels, 0, 0, true),
      // Square cells.
      aspect: m.weeks / 7,
      axes: { x: true, y: true },
    };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const vf = layer.encode.value ?? layer.encode.color!;
    const m = calendarModel(table, layer.encode.x!, vf);
    const xs = ctx.x as BandScale;
    const ys = ctx.y as BandScale;
    const empty = parseColor(style.empty === 'auto' ? theme.grid.y.color : style.empty);
    const gx = (style.gap / 2) * ctx.pixel[0];
    const gy = (style.gap / 2) * ctx.pixel[1];
    const rects: number[] = [];
    const lastDay = m.first + m.weeks * 7 - 1;
    const maxKnown = Math.max(...m.values.keys());
    const minKnown = Math.min(...m.values.keys());
    for (let n = m.first; n <= lastDay; n++) {
      if (n < minKnown || n > maxKnown) continue;
      const w = Math.floor((n - m.first) / 7);
      const d = (n - m.first) % 7;
      const v = m.values.get(n);
      const fill = v === undefined ? empty : ctx.paint(ctx.ramp(m.hi > m.lo ? (v - m.lo) / (m.hi - m.lo) : 0.5), m.rows.get(n));
      const cx = xs.norm(w);
      const cy = ys.norm(d);
      const r = style.radius;
      pushRect(rects, { x0: cx - xs.band / 2 + gx, y0: cy - ys.band / 2 + gy, x1: cx + xs.band / 2 - gx, y1: cy + ys.band / 2 - gy, fill, radii: [r, r, r, r] });
    }
    const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const label = ctx.fields[vf]?.label ?? vf;
    return {
      draws: batches(ctx, rects, [], [], false),
      hit: emptyHit(),
      pick(tx, ty): ShapeHit | null {
        const w = xs.invert(tx);
        const d = ys.invert(ty);
        if (Math.abs(xs.norm(w) - tx) > xs.band / 2 || Math.abs(ys.norm(d) - ty) > ys.band / 2) return null;
        const n = m.first + w * 7 + d;
        if (n < minKnown || n > maxKnown) return null;
        const v = m.values.get(n);
        return { title: longDate.format(fromDayNumber(n)), rows: [{ label, value: v === undefined ? '–' : ctx.format(v, vf) }] };
      },
    };
  },
};

export const FLOW_MARKS: Record<string, MarkDefinition> = { sankey, sunburst, calendar };
