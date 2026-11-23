/**
 * Radial bars, icicle and flame chart, parliament, Venn diagram, word cloud,
 * timeline and tree: standalone marks drawn with the shared primitives.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import type { Table } from '../data/table';
import { mix, parseColor, toCss, withAlpha } from '../util/color';
import { Tween } from './animate';
import { batches, need, share, totals } from './charts';
import { pushArc, pushRect, pushSegment } from './primitives';
import { emptyHit, fieldWithRole, type BuildContext, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';

const TAU = Math.PI * 2;

let measurer: CanvasRenderingContext2D | null | undefined;
/** Width of a text in px (falls back to an estimate outside a browser). */
export function textWidth(text: string, font: string): number {
  if (measurer === undefined) measurer = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 7;
  measurer.font = font;
  return measurer.measureText(text).width;
}

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;

/** A batch from raw instances, or nothing when empty. */
function batch(ctx: BuildContext, kind: 'arc' | 'point' | 'rect' | 'line', data: number[]) {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

// --------------------------------------------------------------- radial bar

/** `radialBar`: one ring per `key`, its arc as long as `value` (longest = `endAngle`). */
export const radialBar: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(-1.02, 1.02), y: new LinearScale(-1.02, 1.02), aspect: 1 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'radialBar');
    const vf = layer.encode.value ?? need(layer, 'y', 'radialBar');
    const items = totals(table, kf, vf);
    const max = Math.max(...items.map((d) => d.value), 0) || 1;
    const sweep = (Math.min(360, Math.max(30, style.endAngle)) * Math.PI) / 180;
    const R = 0.98;
    const r0 = R * style.innerRadius;
    const ring = (R - r0) / Math.max(1, items.length);
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const base = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(fieldLabel(ctx, vf));
    const track = style.track === 'auto' ? parseColor(theme.grid.y.color) : parseColor(style.track);
    const arcs: number[] = [];
    const labels: MarkLabel[] = [];
    const rings = items.map((d, i) => {
      // The first item on the outside.
      const outer = R - i * ring;
      const inner = outer - ring * (1 - style.gap);
      const a1 = (Math.max(0, d.value) / max) * sweep;
      return { ...d, inner, outer, a1 };
    });
    for (const g of rings) pushArc(arcs, ctx.x.norm(0), ctx.y.norm(0), g.inner * unit, g.outer * unit, 0, sweep, 0, track);
    for (const g of rings) {
      const fill = layer.encode.color ? ctx.paint(ctx.categorical(g.key), g.row) : ctx.paint(base, g.row);
      pushArc(arcs, ctx.x.norm(0), ctx.y.norm(0), g.inner * unit, g.outer * unit, 0, g.a1, 0, fill);
      if (!style.labels) continue;
      const mid = (g.inner + g.outer) / 2;
      // Name just before 12 o'clock, value at the end of the bar.
      labels.push({ tx: ctx.x.norm(0), ty: ctx.y.norm(mid), text: g.key, align: 'right', baseline: 'middle', dx: -8, size: 11, weight: 600, color: theme.text.secondary });
      // The value just past the end of the bar, on the track, in ink (never white on the light track).
      const text = ctx.format(g.value, vf);
      const ink = style.labelColor === 'auto' ? theme.text.primary : style.labelColor;
      const room = textWidth(text, `600 10px ${theme.font.family}`) * ctx.pixel[0] / (unit || 1) + 0.03;
      const a = Math.min(sweep, g.a1 + room / (2 * mid) + 0.03);
      const fits = g.a1 + room / mid < sweep;
      // No room left on the track (the longest bar): inside the start of the bar, where the ring runs
      // level with the text, in a contrasting ink.
      const at = fits ? a : room / (2 * mid) + 0.03;
      const [ex, ey] = [Math.sin(at) * mid, Math.cos(at) * mid];
      const pos = { tx: ctx.x.norm(ex), ty: ctx.y.norm(ey), text, align: 'center' as const, baseline: 'middle' as const, size: 10, weight: 600 };
      if (fits || style.labelColor !== 'auto') labels.push({ ...pos, color: ink });
      else {
        // Inside the bar, in white: only if it fits in the ring (a thin ring, a thumbnail: left out,
        // the value stays in the tooltip). A white label must never spill onto the light background.
        const halfW = room / 2 + 6 * ctx.pixel[0];
        const halfH = ((g.outer - g.inner) / 2) * (ctx.y.norm(1) - ctx.y.norm(0));
        labels.push({ ...pos, on: fill, box: [pos.tx - halfW, pos.ty - halfH, pos.tx + halfW, pos.ty + halfH] });
      }
    }
    return {
      draws: [{ batch: batch(ctx, 'arc', arcs) }],
      hit: emptyHit(),
      labels,
      legend: layer.encode.color ? rings.map((g) => ({ key: g.key, color: ctx.categorical(g.key) })) : [],
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const r = Math.hypot(x, y);
        const g = rings.find((q) => r >= q.inner && r <= q.outer);
        if (!g) return null;
        return { title: g.key, rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(g.value, vf) }, { label: 'Part du maximum', value: share(g.value, max) }] };
      },
    };
  },
};

// ------------------------------------------------------- icicle / flame chart

interface PNode {
  name: string;
  path: string[];
  value: number;
  row: number;
  depth: number;
  children: PNode[];
  /** Unit extent along the breadth. */
  a: number;
  b: number;
  color: RGBA;
}

/**
 * Colors of a hierarchy: one hue per node of the first level that branches
 * (a single root, like `main` in a profile, stays neutral), lighter further down.
 */
function paintHierarchy(ctx: BuildContext, full: PNode, root: PNode): { key: string; color: RGBA }[] {
  let level = full.children;
  while (level.length === 1 && level[0].children.length) level = level[0].children;
  const keys = [...new Set(level.map((n) => n.name))];
  const legend = keys.map((k) => ({ key: k, color: ctx.categorical(k) }));
  const depth = level[0]?.depth ?? 1;
  const neutral = mix(ctx.surface, parseColor(ctx.theme.text.muted), 0.55);
  const walk = (n: PNode, parent: RGBA) => {
    for (const c of n.children) {
      c.color = c.depth < depth ? neutral : c.depth === depth ? legend.find((l) => l.key === c.name)!.color : mix(parent, ctx.surface, 0.16);
      walk(c, c.color);
    }
  };
  walk(root, neutral);
  root.color = neutral;
  return legend;
}

/** Build a hierarchy from `path` levels and `value` (rows are leaves). Rows with a hidden value at any level are left out. */
function hierarchy(ctx: BuildContext, table: Table, path: string[], vf: string | undefined, skipHidden = true): { root: PNode; tops: string[] } {
  const levels = path.map((f) => table.column(f).values);
  const values = vf ? (table.column(vf).values as Float64Array) : undefined;
  const root: PNode = { name: '', path: [], value: 0, row: -1, depth: 0, children: [], a: 0, b: 1, color: ctx.surface };
  const tops: string[] = [];
  for (let i = 0; i < table.length; i++) {
    const v = values ? values[i] : 1;
    if (!(v > 0)) continue;
    const top = String(levels[0][i]);
    if (!tops.includes(top)) tops.push(top);
    if (skipHidden && levels.some((l) => ctx.hidden.has(String(l[i])))) continue;
    let n = root;
    n.value += v;
    for (let d = 0; d < path.length; d++) {
      const raw = levels[d][i];
      // An empty level ends the branch early (a manager without a team).
      if (raw === '' || raw === undefined) break;
      const name = String(raw);
      let c = n.children.find((m) => m.name === name);
      if (!c) {
        c = { name, path: [...n.path, name], value: 0, row: i, depth: d + 1, children: [], a: 0, b: 0, color: ctx.surface };
        n.children.push(c);
      }
      c.value += v;
      n = c;
    }
  }
  return { root, tops };
}

/** `icicle`: a hierarchy in rows, each node as wide as its value. Orientation BT gives a flame chart. */
export const icicle: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const path = layer.encode.path;
    if (!path?.length) throw new Error('futurCharts: mark "icicle" needs encode.path (a list of fields).');
    const vf = layer.encode.value ?? layer.encode.y;
    const { root } = hierarchy(ctx, table, path, vf);
    const legend = paintHierarchy(ctx, hierarchy(ctx, table, path, vf, false).root, root);
    const all: PNode[] = [];
    let depth = 0;
    const lay = (n: PNode) => {
      let a = n.a;
      const total = n.children.reduce((s, c) => s + c.value, 0) || 1;
      for (const c of n.children) {
        c.a = a;
        c.b = a + ((n.b - n.a) * c.value) / total;
        a = c.b;
        depth = Math.max(depth, c.depth);
        all.push(c);
        lay(c);
      }
    };
    lay(root);
    const LR = style.orientation === 'LR';
    const BT = style.orientation === 'BT';
    // Focus: the node filling the width (click to zoom in, click its row again to go back up).
    let focus = all.find((n) => n.path.join('\u0000') === ctx.state.focus) ?? root;
    const tween = new Tween(Float64Array.of(focus.a, focus.b));
    const rects = ctx.renderer.createBatch('rect');
    const labels: MarkLabel[] = [];
    const row = 1 / Math.max(1, depth);
    /** Scale-space box of a node, for the current zoom window. */
    const boxOf = (n: PNode): [number, number, number, number] | null => {
      const [w0, w1] = tween.current;
      const span = w1 - w0 || 1;
      // Ancestors of the focus span the whole breadth.
      const above = n.depth < focus.depth && focus.path.slice(0, n.depth).join('\u0000') === n.path.join('\u0000');
      const a = above ? 0 : (n.a - w0) / span;
      const b = above ? 1 : (n.b - w0) / span;
      if (b <= 0 || a >= 1 || b - a <= 0) return null;
      const d0 = (n.depth - 1) * row;
      const d1 = n.depth * row;
      const ca = Math.max(0, a), cb = Math.min(1, b);
      if (LR) return [d0, 1 - cb, d1, 1 - ca];
      return BT ? [ca, d0, cb, d1] : [ca, 1 - d1, cb, 1 - d0];
    };
    const render = () => {
      const out: number[] = [];
      labels.length = 0;
      for (const n of all) {
        const box = boxOf(n);
        if (!box) continue;
        const fill = ctx.paint(n.color, n.row);
        pushRect(out, { x0: box[0], y0: box[1], x1: box[2], y1: box[3], fill, radii: [style.radius, style.radius, style.radius, style.radius], gap: style.gap, axis: 0 });
        if (!style.labels || tween.moving) continue;
        const [px, py] = ctx.pixel;
        if ((box[2] - box[0]) / px < 40 || (box[3] - box[1]) / py < 16) continue;
        const text = n.name;
        labels.push({
          tx: box[0], ty: (box[1] + box[3]) / 2, text, on: fill, align: 'left', baseline: 'middle', dx: 7, size: 11, weight: 600,
          box: [box[0], box[1], box[2], box[3]],
        });
      }
      rects.update(new Float32Array(out), out.length / LAYOUTS.rect.stride);
    };
    render();
    const nodeAt = (tx: number, ty: number) => {
      for (const n of all) {
        const b = boxOf(n);
        if (b && tx >= b[0] && tx <= b[2] && ty >= b[1] && ty <= b[3]) return n;
      }
      return undefined;
    };
    return {
      draws: [{ batch: rects, pixelSnap: false }],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const n = nodeAt(tx, ty);
        if (!n) return null;
        return {
          title: n.path.join(' › '),
          rows: [
            ...(vf ? [{ label: fieldLabel(ctx, vf), value: ctx.format(n.value, vf) }] : []),
            { label: 'Part du total', value: share(n.value, root.value) },
          ],
        };
      },
      click(tx, ty) {
        const n = nodeAt(tx, ty);
        // Clicking the focus (or above it) goes back up one level.
        const next = !n ? root : n === focus || n.depth < focus.depth ? (all.find((p) => p.path.join('\u0000') === n.path.slice(0, -1).join('\u0000')) ?? root) : n;
        if (next === focus) return undefined;
        focus = next;
        ctx.state.focus = focus.path.join('\u0000');
        tween.go(Float64Array.of(focus.a, focus.b), performance.now());
        render();
        return focus.path;
      },
      animate(now) {
        if (!tween.moving) return false;
        tween.step(now);
        render();
        return true;
      },
    };
  },
};

// --------------------------------------------------------------- parliament

/** `parliament`: one dot per seat on a half circle, parties in blocks from left to right. */
export const parliament: MarkDefinition = {
  standalone: true,
  // Dot sizes are in px.
  sizeDependent: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(-1.04, 1.04), y: new LinearScale(-0.08, 1.04), aspect: 2.08 / 1.12 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'parliament');
    const vf = layer.encode.value ?? need(layer, 'y', 'parliament');
    const all = totals(table, kf, vf).filter((d) => d.value > 0);
    const legend = all.map((d) => ({ key: d.key, color: ctx.categorical(d.key) }));
    const parties = all.filter((d) => !ctx.hidden.has(d.key)).map((d) => ({ ...d, seats: Math.round(d.value) }));
    const N = parties.reduce((a, d) => a + d.seats, 0);
    const ri = Math.min(0.9, Math.max(0, style.innerRadius));
    // Fewest rows whose seats, spaced one row-width apart, hold everyone.
    let rows = 1;
    const capacity = (R: number) => Array.from({ length: R }, (_, k) => Math.floor((Math.PI * (ri + ((1 - ri) * (k + 0.5)) / R)) / ((1 - ri) / R)));
    while (rows < 60 && capacity(rows).reduce((a, c) => a + c, 0) < N) rows++;
    const cap = capacity(rows);
    const capTotal = cap.reduce((a, c) => a + c, 0);
    // Seats per row in proportion to its length (largest remainder).
    const exact = cap.map((c) => (c / capTotal) * N);
    const perRow = exact.map(Math.floor);
    let left = N - perRow.reduce((a, c) => a + c, 0);
    exact.map((e, k) => [e - Math.floor(e), k] as const).sort((a, b) => b[0] - a[0]).forEach(([, k]) => left-- > 0 && perRow[k]++);
    const seats: { x: number; y: number; angle: number }[] = [];
    perRow.forEach((n, k) => {
      const r = ri + ((1 - ri) * (k + 0.5)) / rows;
      for (let j = 0; j < n; j++) {
        const angle = n === 1 ? Math.PI / 2 : Math.PI * (1 - j / (n - 1));
        seats.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r, angle });
      }
    });
    // Left to right: the first party takes the leftmost wedge.
    seats.sort((a, b) => b.angle - a.angle);
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const diameter = Math.max(2, (((1 - ri) / rows) * unit * 0.82) / ctx.pixel[0]);
    const out: number[] = [];
    const owner: number[] = [];
    let s = 0;
    parties.forEach((p, pi) => {
      const c = ctx.paint(legend.find((l) => l.key === p.key)!.color, p.row);
      for (let j = 0; j < p.seats && s < seats.length; j++, s++) {
        out.push(ctx.x.norm(seats[s].x), ctx.y.norm(seats[s].y), diameter, 0, c[0], c[1], c[2], c[3], 0, 0, 0, 0, 0);
        owner.push(pi);
      }
    });
    const labels: MarkLabel[] = [];
    if (style.center) {
      labels.push({ tx: ctx.x.norm(0), ty: ctx.y.norm(0), text: ctx.format(N, vf), color: theme.text.primary, size: 26, weight: 650, align: 'center', baseline: 'bottom', dy: -2 });
      labels.push({ tx: ctx.x.norm(0), ty: ctx.y.norm(0), text: fieldLabel(ctx, vf), align: 'center', baseline: 'top', dy: 2, size: 11 });
    }
    return {
      draws: [{ batch: batch(ctx, 'point', out) }],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        let best = -1;
        let bd = ((1 - ri) / rows) * 0.7;
        seats.forEach((p, i) => {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bd && i < owner.length) [best, bd] = [i, d];
        });
        if (best < 0) return null;
        const p = parties[owner[best]];
        return { title: p.key, rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(p.seats, vf) }, { label: 'Part', value: share(p.seats, N) }] };
      },
    };
  },
};

// --------------------------------------------------------------------- venn

/** Area of the lens where two circles (radii a, b, centers d apart) overlap. */
export function lens(a: number, b: number, d: number): number {
  if (d >= a + b) return 0;
  if (d <= Math.abs(a - b)) return Math.PI * Math.min(a, b) ** 2;
  const x = (d * d + a * a - b * b) / (2 * d);
  const y = Math.sqrt(Math.max(0, a * a - x * x));
  return a * a * Math.acos(x / a) + b * b * Math.acos((d - x) / b) - d * y;
}

/** Distance between centers for which two circles overlap by `area`. */
function distanceFor(a: number, b: number, area: number): number {
  if (area <= 0) return a + b + 0.05 * Math.min(a, b);
  let lo = Math.abs(a - b);
  let hi = a + b;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (lens(a, b, mid) > area) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * `venn`: `key` names a set (`A`) or an intersection (`A&B`, `A&B&C`), `value`
 * its size. Two or three sets; circle areas follow the sets, overlaps follow the
 * pairwise intersections.
 */
export const venn: MarkDefinition = {
  standalone: true,
  symbol: 'circle',
  scales: ({ layer, table }) => {
    const box = vennLayout(table, layer.encode.key!, layer.encode.value ?? layer.encode.y!).box;
    return { x: new LinearScale(box[0], box[2]), y: new LinearScale(box[1], box[3]), aspect: (box[2] - box[0]) / (box[3] - box[1]) };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'venn');
    const vf = layer.encode.value ?? need(layer, 'y', 'venn');
    const { sets, circles, regions } = vennLayout(table, kf, vf);
    const legend = sets.map((s) => ({ key: s, color: ctx.categorical(s) }));
    const unit = ctx.x.norm(1) - ctx.x.norm(0);
    const arcs: number[] = [];
    const labels: MarkLabel[] = [];
    circles.forEach((c, i) => {
      const col = ctx.paint(legend[i].color, c.row);
      const [cx, cy] = [ctx.x.norm(c.x), ctx.y.norm(c.y)];
      pushArc(arcs, cx, cy, 0, c.r * unit, 0, TAU, 0, withAlpha(col, col[3] * style.opacity));
      pushArc(arcs, cx, cy, Math.max(0, c.r * unit - ctx.pixel[0] * 2), c.r * unit, 0, TAU, 0, col);
    });
    if (style.labels) {
      // Set names on the far side of each circle, values in each overlap.
      const gx = circles.reduce((a, c) => a + c.x, 0) / circles.length;
      const gy = circles.reduce((a, c) => a + c.y, 0) / circles.length;
      circles.forEach((c, i) => {
        const dx = c.x - gx, dy = c.y - gy;
        const l = Math.hypot(dx, dy) || 1;
        const k = circles.length === 1 ? 0 : c.r * 0.45;
        const [lx, ly] = [ctx.x.norm(c.x + (dx / l) * k), ctx.y.norm(c.y + (dy / l) * k)];
        labels.push({ tx: lx, ty: ly, text: sets[i], color: theme.text.primary, size: 13, weight: 650, align: 'center', baseline: 'bottom', dy: -1 });
        labels.push({ tx: lx, ty: ly, text: ctx.format(c.value, vf), color: theme.text.secondary, size: 11, align: 'center', baseline: 'top', dy: 2 });
      });
      for (const r of regions) {
        if (r.members.length < 2) continue;
        const ms = r.members.map((m) => circles[m]);
        let px: number, py: number;
        if (ms.length === 2) {
          // Middle of the lens, along the line between the centers.
          const [a, b] = ms;
          const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const t = (a.r + (d - b.r)) / 2 / d;
          px = a.x + (b.x - a.x) * t;
          py = a.y + (b.y - a.y) * t;
          // Pushed away from a third circle, so a pair label does not sit in the triple overlap.
          const other = circles.find((_, i) => !r.members.includes(i));
          if (other) {
            const ox = px - other.x, oy = py - other.y;
            const ol = Math.hypot(ox, oy) || 1;
            px += (ox / ol) * Math.min(a.r, b.r) * 0.25;
            py += (oy / ol) * Math.min(a.r, b.r) * 0.25;
          }
        } else {
          px = ms.reduce((s, c) => s + c.x, 0) / ms.length;
          py = ms.reduce((s, c) => s + c.y, 0) / ms.length;
        }
        labels.push({ tx: ctx.x.norm(px), ty: ctx.y.norm(py), text: ctx.format(r.value, vf), color: theme.text.primary, size: 11, weight: 600, align: 'center', baseline: 'middle' });
      }
    }
    return {
      draws: [{ batch: batch(ctx, 'arc', arcs) }],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const inside = circles.map((c, i) => (Math.hypot(x - c.x, y - c.y) <= c.r ? i : -1)).filter((i) => i >= 0);
        if (!inside.length) return null;
        const exact = regions.find((r) => r.members.length === inside.length && r.members.every((m) => inside.includes(m)));
        return {
          title: inside.map((i) => sets[i]).join(' ∩ '),
          rows: [{ label: fieldLabel(ctx, vf), value: exact ? ctx.format(exact.value, vf) : '–' }],
        };
      },
    };
  },
};

export function vennLayout(table: Table, kf: string, vf: string) {
  const keys = table.column(kf).values;
  const vals = table.column(vf).values as Float64Array;
  const regions: { members: number[]; value: number; row: number }[] = [];
  const sets: string[] = [];
  const parsed: { names: string[]; value: number; row: number }[] = [];
  for (let i = 0; i < table.length; i++) {
    const names = String(keys[i]).split(/\s*[&∩,]\s*/).filter(Boolean);
    if (!names.length || !(vals[i] >= 0)) continue;
    parsed.push({ names, value: vals[i], row: i });
    if (names.length === 1 && !sets.includes(names[0])) sets.push(names[0]);
  }
  for (const p of parsed) for (const n of p.names) if (!sets.includes(n)) sets.push(n);
  sets.splice(3);
  for (const p of parsed) {
    const members = p.names.map((n) => sets.indexOf(n));
    if (members.some((m) => m < 0)) continue;
    regions.push({ members, value: p.value, row: p.row });
  }
  const size = (members: number[]) => regions.find((r) => r.members.length === members.length && members.every((m) => r.members.includes(m)))?.value ?? 0;
  const circles = sets.map((_, i) => {
    const r = regions.find((q) => q.members.length === 1 && q.members[0] === i);
    const value = r?.value ?? 0;
    return { x: 0, y: 0, r: Math.sqrt(Math.max(value, 1e-9) / Math.PI), value, row: r?.row ?? 0 };
  });
  if (circles.length >= 2) {
    const d01 = distanceFor(circles[0].r, circles[1].r, size([0, 1]));
    circles[1].x = d01;
    if (circles.length === 3) {
      const d02 = distanceFor(circles[0].r, circles[2].r, size([0, 2]));
      const d12 = distanceFor(circles[1].r, circles[2].r, size([1, 2]));
      // Third center from the two distances (law of cosines), clamped when no triangle fits.
      const cos = Math.max(-1, Math.min(1, (d01 * d01 + d02 * d02 - d12 * d12) / (2 * d01 * d02)));
      circles[2].x = d02 * cos;
      circles[2].y = -d02 * Math.sqrt(1 - cos * cos);
    }
  }
  // Centered, in a unit-ish box.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of circles) {
    x0 = Math.min(x0, c.x - c.r); x1 = Math.max(x1, c.x + c.r);
    y0 = Math.min(y0, c.y - c.r); y1 = Math.max(y1, c.y + c.r);
  }
  const s = 2 / Math.max(x1 - x0, y1 - y0, 1e-9);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const c of circles) {
    c.x = (c.x - cx) * s;
    c.y = (c.y - cy) * s;
    c.r *= s;
  }
  const hw = ((x1 - x0) * s) / 2 + 0.06;
  const hh = ((y1 - y0) * s) / 2 + 0.06;
  return { sets, circles, regions, box: [-hw, -hh, hw, hh] as [number, number, number, number] };
}

// ---------------------------------------------------------------- word cloud

/** `wordcloud`: words (`key`) sized by `value`, spiralling out from the center, biggest first. */
export const wordcloud: MarkDefinition = {
  standalone: true,
  // Words are placed in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'wordcloud');
    const vf = layer.encode.value ?? need(layer, 'y', 'wordcloud');
    const gf = layer.encode.color;
    const words = totals(table, kf, vf, gf).filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const max = words[0]?.value ?? 1;
    const min = words[words.length - 1]?.value ?? 0;
    // Fewer, bigger words on a small chart.
    const fit = Math.min(1, Math.sqrt((W * H) / (640 * 360)));
    const placed: { x0: number; y0: number; x1: number; y1: number; w: (typeof words)[number]; size: number; color: RGBA }[] = [];
    const legend = gf ? [...new Set(words.map((w) => w.group))].map((g) => ({ key: g, color: ctx.categorical(g) })) : [];
    for (const w of words) {
      const t = max > min ? (w.value - min) / (max - min) : 1;
      const size = Math.max(9, (style.minSize + (style.maxSize - style.minSize) * Math.sqrt(t)) * fit);
      const tw = textWidth(w.key, `${style.weight} ${size}px ${theme.font.family}`) + 4;
      const th = size * 1.05;
      // Archimedean spiral, stretched to the chart's shape.
      let ok = false;
      for (let k = 0; k < 2400 && !ok; k++) {
        const a = k * 0.35;
        const r = 2.2 * a;
        const cx = W / 2 + Math.cos(a) * r * (W / H);
        const cy = H / 2 + Math.sin(a) * r;
        const box = { x0: cx - tw / 2, y0: cy - th / 2, x1: cx + tw / 2, y1: cy + th / 2 };
        if (box.x0 < 2 || box.y0 < 2 || box.x1 > W - 2 || box.y1 > H - 2) {
          if (r > Math.max(W, H)) break;
          continue;
        }
        if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
        const base = gf ? legend.find((l) => l.key === w.group)!.color : ctx.ramp(0.45 + 0.55 * t);
        placed.push({ ...box, w, size, color: ctx.paint(base, w.row) });
        ok = true;
      }
    }
    const labels: MarkLabel[] = placed.map((p) => ({
      tx: ((p.x0 + p.x1) / 2) * px,
      ty: 1 - ((p.y0 + p.y1) / 2) * py,
      text: p.w.key,
      color: toCss(p.color),
      size: p.size,
      weight: style.weight,
      align: 'center',
      baseline: 'middle',
    }));
    return {
      draws: [],
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = tx / px;
        const y = (1 - ty) / py;
        const p = placed.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
        if (!p) return null;
        return { title: p.w.key, rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(p.w.value, vf) }] };
      },
    };
  },
};

// ------------------------------------------------------------------ timeline

/** Indices 0..n-1 in an order that spreads them: ends first, then halves, quarters… */
function spreadOrder(n: number): number[] {
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const out = [0, n - 1];
  const seen = new Set(out);
  for (let parts = 2; out.length < n; parts *= 2) {
    for (let k = 1; k < parts; k += 2) {
      const i = Math.round(((n - 1) * k) / parts);
      if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
    if (parts > n * 2) for (let i = 0; i < n; i++) if (!seen.has(i)) out.push(i);
  }
  return out;
}

/**
 * `timeline`: events (`key`, optional `value` as a description) at dates (`x`)
 * on one line. Every event is a dot; those with room get a card (title, date),
 * on up to four levels above and below the line, the most important first
 * (`encode.size`, otherwise a spread across the whole span). The others stay
 * dots: the tooltip names the event under the pointer and its neighbours.
 */
export const timeline: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(-1, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'timeline');
    const xf = need(layer, 'x', 'timeline');
    const df = layer.encode.value;
    const gf = layer.encode.color;
    // Importance: the encoding, or the catalog's field with the `importance` role.
    const sf = layer.encode.size ?? fieldWithRole(ctx, 'importance');
    const xcol = table.column(xf);
    const keys = table.column(kf).values;
    const desc = df ? table.column(df).values : undefined;
    const groups = gf ? table.column(gf).values : undefined;
    const weight = sf ? (table.column(sf).values as Float64Array) : undefined;
    const rows = Array.from({ length: table.length }, (_, i) => i);
    if (xcol.type !== 'string') rows.sort((a, b) => (xcol.values[a] as number) - (xcol.values[b] as number));
    const fmt =
      xcol.type === 'time'
        ? (() => {
            const f = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
            return (v: number | string) => f.format(v as number);
          })()
        : (v: number | string) => (typeof v === 'number' ? ctx.format(v, xf) : v);
    const n = rows.length;
    const t0 = xcol.type === 'string' ? 0 : (xcol.values[rows[0]] as number);
    const t1 = xcol.type === 'string' ? 1 : (xcol.values[rows[n - 1]] as number);
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const margin = Math.min(0.07, 60 * px);
    // By date when asked, or when there are many events (even spacing would lie about time).
    const proportional = (style.proportional || n > 12) && xcol.type !== 'string' && t1 > t0;
    const at = (k: number) =>
      proportional ? margin + ((1 - 2 * margin) * ((xcol.values[rows[k]] as number) - t0)) / (t1 - t0) : n === 1 ? 0.5 : margin + ((1 - 2 * margin) * k) / (n - 1);
    const xs = rows.map((_, k) => at(k));

    // Cards: size in px, levels above and below (near, then far when the height allows).
    const family = theme.font.family;
    const cardH = desc ? 52 : 36;
    const near = Math.min(40, H * 0.07) + 4;
    const levels: { up: boolean; stem: number }[] = [];
    if (H / 2 - 8 >= near + cardH) levels.push({ up: true, stem: near }, { up: false, stem: near });
    const far = near + cardH + 8;
    if (H / 2 - 8 >= far + cardH) levels.push({ up: true, stem: far }, { up: false, stem: far });
    // Below the threshold, an event never gets a card: it stays a small dot.
    const min = Number.isFinite(style.minImportance) ? style.minImportance : -Infinity;
    const eligible = (k: number) => !weight || (weight[rows[k]] ?? 0) >= min;
    const order = (weight ? rows.map((_, k) => k).sort((a, b) => (weight[rows[b]] || 0) - (weight[rows[a]] || 0)) : spreadOrder(n)).filter(eligible);
    const widths = rows.map(
      (r) =>
        Math.max(
          textWidth(String(keys[r]), `650 12px ${family}`),
          textWidth(fmt(xcol.values[r] as number | string), `10px ${family}`),
          desc ? textWidth(String(desc[r]), `10px ${family}`) : 0,
        ) + 14,
    );
    // Links: the layer's `link`, or the catalog's field with the `link` role.
    const linkField = layer.link?.field ?? fieldWithRole(ctx, 'link');
    const links = linkField ? table.column(linkField).values : undefined;
    const axis = parseColor(theme.axis.line.color);
    const y0 = ctx.y.norm(0);
    const legend = groups ? [...new Set(rows.map((r) => String(groups[r])))].map((g) => ({ key: g, color: ctx.categorical(g) })) : [];
    const colorOf = rows.map((r) => ctx.paint(groups ? legend.find((l) => l.key === String(groups[r]))!.color : ctx.categorical(fieldLabel(ctx, kf)), r));
    const surface = theme.background;
    const lineBatch = ctx.renderer.createBatch('line');
    const dotBatch = ctx.renderer.createBatch('point');
    const labels: MarkLabel[] = [];
    /** Cards placed, in scale space, for clicks: event index and box. */
    let boxes: { k: number; x0: number; x1: number; y0: number; y1: number }[] = [];
    let span = 1;

    /** Place the cards for the visible part [v0, v1] of the time line (all of it, or a zoom). */
    const layout = (v0: number, v1: number) => {
      span = Math.max(1e-6, v1 - v0);
      const unitPx = W / span; // screen px per scale unit along x
      const taken: [number, number][][] = levels.map(() => []);
      const card = new Map<number, { level: number; cx: number }>();
      let placedCount = 0;
      let visible = 0;
      for (let k = 0; k < n; k++) if (xs[k] >= v0 && xs[k] <= v1) visible++;
      for (const k of order) {
        if (xs[k] < v0 || xs[k] > v1) continue;
        const wpx = widths[k];
        // Centered on its dot (screen px from the visible left edge), slid inwards at the edges.
        const sx = Math.max(wpx / 2 + 2, Math.min(W - wpx / 2 - 2, (xs[k] - v0) * unitPx));
        const sp: [number, number] = [sx - wpx / 2 - 6, sx + wpx / 2 + 6];
        for (let q = 0; q < levels.length; q++) {
          const l = (q + (placedCount % 2)) % levels.length;
          if (taken[l].some(([a, b]) => sp[0] < b && sp[1] > a)) continue;
          taken[l].push(sp);
          card.set(k, { level: l, cx: v0 + sx / unitPx });
          placedCount++;
          break;
        }
      }
      const lines: number[] = [];
      const dots: number[] = [];
      labels.length = 0;
      boxes = [];
      pushSegment(lines, Math.min(0.01, v0), y0, Math.max(0.99, v1), y0, axis, 2);
      rows.forEach((r, k) => {
        const x = xs[k];
        const c = colorOf[k];
        const placed = card.get(k);
        if (!placed) {
          dots.push(x, y0, Math.max(6, style.markerSize * 0.55), 0, c[0], c[1], c[2], c[3] * 0.85, ctx.surface[0], ctx.surface[1], ctx.surface[2], 1, 1.5);
          return;
        }
        const lv = levels[placed.level];
        const ty = y0 + (lv.up ? lv.stem : -lv.stem) * py;
        pushSegment(lines, x, y0, x, ty, withAlpha(c, 0.6), 1.25);
        dots.push(x, y0, style.markerSize, 0, c[0], c[1], c[2], c[3], ctx.surface[0], ctx.surface[1], ctx.surface[2], 1, 2);
        const cx = placed.cx;
        const title = String(keys[r]);
        const date = fmt(xcol.values[r] as number | string);
        // A linked event reads as one: its title in the accent color.
        const titleInk = links && links[r] ? toCss(c) : theme.text.primary;
        const halfW = (widths[k] / 2) / unitPx;
        if (lv.up) {
          if (desc) labels.push({ tx: cx, ty, text: String(desc[r]), color: theme.text.secondary, size: 10, align: 'center', baseline: 'bottom', dy: -4, background: surface });
          labels.push({ tx: cx, ty, text: title, color: titleInk, size: 12, weight: 650, align: 'center', baseline: 'bottom', dy: desc ? -20 : -4, background: surface });
          labels.push({ tx: cx, ty, text: date, color: theme.text.muted, size: 10, align: 'center', baseline: 'bottom', dy: desc ? -36 : -20 });
          boxes.push({ k, x0: cx - halfW, x1: cx + halfW, y0: ty, y1: ty + cardH * py });
        } else {
          labels.push({ tx: cx, ty, text: date, color: theme.text.muted, size: 10, align: 'center', baseline: 'top', dy: 4 });
          labels.push({ tx: cx, ty, text: title, color: titleInk, size: 12, weight: 650, align: 'center', baseline: 'top', dy: 18, background: surface });
          if (desc) labels.push({ tx: cx, ty, text: String(desc[r]), color: theme.text.secondary, size: 10, align: 'center', baseline: 'top', dy: 34, background: surface });
          boxes.push({ k, x0: cx - halfW, x1: cx + halfW, y0: ty - cardH * py, y1: ty });
        }
      });
      if (placedCount < visible) {
        // Say that more is there.
        labels.push({ tx: v1, ty: y0, text: `${visible - placedCount} autres : survolez les points`, color: theme.text.muted, size: 10, align: 'right', baseline: 'top', dx: -6, dy: H / 2 - 18, free: true });
      }
      lineBatch.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
      dotBatch.update(new Float32Array(dots), dots.length / LAYOUTS.point.stride);
    };
    layout(0, 1);

    /** The event under the pointer: its card, or the nearest dot on the line. */
    const eventAt = (tx: number, ty: number): number => {
      const b = boxes.find((q) => tx >= q.x0 && tx <= q.x1 && ty >= q.y0 && ty <= q.y1);
      if (b) return b.k;
      if (Math.abs(ty - y0) > 28 * py) return -1;
      let best = -1;
      for (let k = 0; k < n; k++) if (best < 0 || Math.abs(xs[k] - tx) < Math.abs(xs[best] - tx)) best = k;
      return best >= 0 && (Math.abs(xs[best] - tx) / span) / px <= 24 ? best : -1;
    };
    return {
      draws: [{ batch: lineBatch }, { batch: dotBatch }],
      hit: emptyHit(),
      labels,
      legend,
      view(x0, x1) {
        layout(Math.max(0, x0), Math.min(1, x1));
        return true;
      },
      link: links
        ? (tx, ty) => {
            const k = eventAt(tx, ty);
            const url = k >= 0 ? links[rows[k]] : undefined;
            return url ? { url: String(url), row: rows[k] } : undefined;
          }
        : undefined,
      pick(tx, ty): ShapeHit | null {
        // The event under the pointer, and the ones close around it (often hidden ones).
        const best = eventAt(tx, ty);
        if (best < 0) return null;
        const r = rows[best];
        const out = [{ label: fieldLabel(ctx, xf), value: fmt(xcol.values[r] as number | string) }];
        if (desc) out.push({ label: fieldLabel(ctx, df!), value: String(desc[r]) });
        const around = xs
          .map((x, k) => ({ k, d: Math.abs(x - xs[best]) / span / px }))
          .filter((q) => q.k !== best && q.d <= 40)
          .sort((a, b) => a.d - b.d)
          .slice(0, 4)
          .sort((a, b) => a.k - b.k);
        for (const q of around) out.push({ label: fmt(xcol.values[rows[q.k]] as number | string), value: String(keys[rows[q.k]]) });
        if (links && links[r]) out.push({ label: 'Lien', value: 'cliquer pour ouvrir' });
        return { title: String(keys[r]), rows: out };
      },
    };
  },
};

// ---------------------------------------------------------------------- tree

interface TNode extends PNode {
  /** Position: breadth and depth, 0..1. */
  u: number;
  v: number;
  parent?: TNode;
}

/**
 * `tree`: a hierarchy (`path`, outermost level first; rows are leaves) as a
 * tree. Dots and curved links (dendrogram), or boxes (org chart) with
 * `style.boxes`. Several top-level values hang from one root named after the value field.
 */
export const tree: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  // A radial tree keeps x and y at the same scale.
  scales: ({ layer }) =>
    (layer.style as { radial?: boolean } | undefined)?.radial
      ? { x: new LinearScale(-1, 1), y: new LinearScale(-1, 1), aspect: 1 }
      : { x: new LinearScale(0, 1), y: new LinearScale(0, 1) },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const path = layer.encode.path;
    if (!path?.length) throw new Error('futurCharts: mark "tree" needs encode.path (a list of fields).');
    const radial = style.radial && !style.boxes;
    const vf = layer.encode.value ?? layer.encode.y;
    const h = hierarchy(ctx, table, path, vf);
    const legend = paintHierarchy(ctx, hierarchy(ctx, table, path, vf, false).root, h.root);
    // One top-level value is the root itself.
    const single = h.root.children.length === 1;
    const root = (single ? h.root.children[0] : { ...h.root, name: vf ? fieldLabel(ctx, vf) : 'Total' }) as TNode;
    const nodes: TNode[] = [];
    let leaves = 0;
    let depth = 0;
    const walk = (n: TNode, d: number, parent?: TNode) => {
      n.parent = parent;
      n.v = d;
      depth = Math.max(depth, d);
      nodes.push(n);
      if (!n.children.length) n.u = leaves++;
      else {
        for (const c of n.children) walk(c as TNode, d + 1, n);
        n.u = (n.children[0] as TNode).u / 2 + (n.children[n.children.length - 1] as TNode).u / 2;
      }
    };
    walk(root, 0);
    const [px, py] = ctx.pixel;
    const LR = style.direction !== 'TB';
    // Grown the other way: right to left (LR) or bottom to top (TB).
    const flip = !!style.reverse;
    const boxes = style.boxes;
    // Boxes shrink to fit a small chart: across the leaves, and along the levels.
    const breadthPx = LR ? 1 / py : 1 / px;
    const depthPx = LR ? 1 / px : 1 / py;
    const bw0 = LR ? style.boxHeight : style.boxWidth;
    const bd0 = LR ? style.boxWidth : style.boxHeight;
    const fit = boxes ? Math.min(1, breadthPx / (leaves0(root) * (bw0 + 10)), depthPx / ((depthOf(root) + 1) * bd0 + depthOf(root) * 18)) : 1;
    const boxW = style.boxWidth * fit;
    const boxH = style.boxHeight * fit;
    const font = (size: number) => Math.max(8, size * Math.max(fit, 0.75));
    // Margins in px: room for leaf labels (dots) or half a box.
    const leafLabel = boxes ? 0 : Math.max(...nodes.filter((n) => !n.children.length).map((n) => textWidth(n.name, `12px ${theme.font.family}`)), 0) + 16;
    // Room before the root for its label (dots), or half a box.
    const rootLabel = textWidth(root.name, `650 12px ${theme.font.family}`);
    const m0 = boxes ? (LR ? boxW / 2 + 4 : boxH / 2 + 4) : LR ? Math.max(14, rootLabel / 2 + 6) : 24;
    const m1 = boxes ? m0 : LR ? leafLabel : 30;
    const side = boxes ? (LR ? boxH / 2 + 4 : boxW / 2 + 4) : 12;
    const dpx = LR ? px : py;
    const bpx = LR ? py : px;
    // Radial: depth is the radius, leaves spread over the full turn; room around for the labels.
    // The radius leaves room for the longest leaf name (11 px text, 8 px from its dot) around the circle.
    const unitR = ctx.x.norm(1) - ctx.x.norm(0);
    const leafPx = Math.max(...nodes.filter((n) => !n.children.length).map((n) => textWidth(n.name, `11px ${theme.font.family}`)), 0) + 14;
    const fitR = 1 - (leafPx * px) / (unitR || 1);
    // Too small for the names (a thumbnail): the tree takes the room, leaf names go to the tooltip.
    const leafNames = fitR >= 0.5;
    const R = leafNames ? Math.min(0.72, fitR) : 0.85;
    const polar = (n: TNode): [number, number] => [(leaves > 0 ? n.u / leaves : 0) * Math.PI * 2, depth ? (n.v / depth) * R : 0];
    const toXY = (a: number, r: number): [number, number] => [ctx.x.norm(Math.sin(a) * r), ctx.y.norm(Math.cos(a) * r)];
    const place = (n: TNode): [number, number] => {
      if (radial) return toXY(...polar(n));
      const d = m0 * dpx + (depth ? n.v / depth : 0.5) * (1 - (m0 + m1) * dpx);
      const b = side * bpx + (leaves > 1 ? n.u / (leaves - 1) : 0.5) * (1 - 2 * side * bpx);
      return LR ? [flip ? 1 - d : d, 1 - b] : [b, flip ? d : 1 - d];
    };
    const lines: number[] = [];
    const rects: number[] = [];
    const dots: number[] = [];
    const labels: MarkLabel[] = [];
    const link = parseColor(theme.axis.line.color);
    for (const n of nodes) {
      if (!n.parent) continue;
      const [ax, ay] = place(n.parent);
      const [bx, by] = place(n);
      if (boxes) {
        // Elbow links: down (or across) to the middle, along, then to the child.
        if (LR) {
          const mx = (ax + bx) / 2;
          pushSegment(lines, ax, ay, mx, ay, link, style.linkWidth);
          pushSegment(lines, mx, ay, mx, by, link, style.linkWidth);
          pushSegment(lines, mx, by, bx, by, link, style.linkWidth);
        } else {
          const my = (ay + by) / 2;
          pushSegment(lines, ax, ay, ax, my, link, style.linkWidth);
          pushSegment(lines, ax, my, bx, my, link, style.linkWidth);
          pushSegment(lines, bx, my, bx, by, link, style.linkWidth);
        }
        continue;
      }
      // Smooth S-curve from parent to child (in polar coordinates for a radial tree).
      let lx = ax, ly = ay;
      const [pa, pr] = polar(n.parent);
      const [ca, cr] = polar(n);
      for (let k = 1; k <= 16; k++) {
        const t = k / 16;
        const s = t * t * (3 - 2 * t);
        const [x, y] = radial
          ? toXY(pr === 0 ? ca : pa + (ca - pa) * s, pr + (cr - pr) * t)
          : [LR ? ax + (bx - ax) * t : ax + (bx - ax) * s, LR ? ay + (by - ay) * s : ay + (by - ay) * t];
        pushSegment(lines, lx, ly, x, y, withAlpha(n.color, 0.45), style.linkWidth);
        lx = x;
        ly = y;
      }
    }
    for (const n of nodes) {
      const [x, y] = place(n);
      const c = ctx.paint(n.color, n.row >= 0 ? n.row : undefined);
      const leaf = !n.children.length;
      if (boxes) {
        const hw = (boxW / 2) * px;
        const hh = (boxH / 2) * py;
        pushRect(rects, { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh, fill: mix(ctx.surface, c, 0.12), stroke: withAlpha(c, 0.55), strokeWidth: 1, radii: [8, 8, 8, 8] });
        // A colored edge on the left, like a badge.
        pushRect(rects, { x0: x - hw, y0: y - hh, x1: x - hw + 4 * px, y1: y + hh, fill: c, radii: [8, 0, 0, 8] });
        const box: [number, number, number, number] = [x - hw + 8 * px, y - hh, x + hw - 4 * px, y + hh];
        const sub = vf && n.value ? ctx.format(n.value, vf) : n.parent ? '' : undefined;
        labels.push({ tx: x + 2 * px, ty: y, text: n.name, color: theme.text.primary, size: font(12), weight: 650, align: 'center', baseline: sub ? 'bottom' : 'middle', dy: sub ? 1 : 0, box });
        if (sub) labels.push({ tx: x + 2 * px, ty: y, text: sub, color: theme.text.muted, size: font(10), align: 'center', baseline: 'top', dy: 3, box });
        continue;
      }
      const size = leaf ? style.nodeSize * 0.8 : style.nodeSize;
      dots.push(x, y, size, 0, c[0], c[1], c[2], c[3], ctx.surface[0], ctx.surface[1], ctx.surface[2], 1, 2);
      if (radial) {
        const [a] = polar(n);
        const right = Math.sin(a) >= 0;
        // Leaves outward, on the side they point to; inner nodes above their dot.
        if (leaf && !leafNames) continue;
        labels.push(
          leaf
            ? { tx: x, ty: y, text: n.name, align: right ? 'left' : 'right', baseline: 'middle', dx: right ? 8 : -8, size: 11, color: theme.text.secondary }
            : { tx: x, ty: y, text: n.name, align: 'center', baseline: 'bottom', dy: -7, size: 11, weight: 650, color: theme.text.primary, background: theme.background },
        );
      } else if (LR) {
        labels.push(
          leaf
            ? { tx: x, ty: y, text: n.name, align: flip ? 'right' : 'left', baseline: 'middle', dx: flip ? -9 : 9, size: 12, color: theme.text.secondary }
            : { tx: x, ty: y, text: n.name, align: 'center', baseline: 'bottom', dy: -8, size: 12, weight: 650, color: theme.text.primary, background: theme.background },
        );
      } else {
        labels.push(
          leaf
            ? { tx: x, ty: y, text: n.name, align: 'center', baseline: flip ? 'bottom' : 'top', dy: flip ? -9 : 9, size: 11, color: theme.text.secondary }
            : { tx: x, ty: y, text: n.name, align: 'left', baseline: 'bottom', dx: 7, dy: -5, size: 12, weight: 650, color: theme.text.primary, background: theme.background },
        );
      }
    }
    const draws = batches(ctx, rects, [], [], false);
    draws.unshift({ batch: batch(ctx, 'line', lines) });
    if (dots.length) draws.push({ batch: batch(ctx, 'point', dots) });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        let best: TNode | undefined;
        let bd = Infinity;
        for (const n of nodes) {
          const [x, y] = place(n);
          const dx = (tx - x) / px, dy = (ty - y) / py;
          const inside = boxes ? Math.abs(dx) <= boxW / 2 && Math.abs(dy) <= boxH / 2 : Math.hypot(dx, dy) < 12;
          if (inside && Math.hypot(dx, dy) < bd) [best, bd] = [n, Math.hypot(dx, dy)];
        }
        if (!best) return null;
        const rows = [];
        if (vf) rows.push({ label: fieldLabel(ctx, vf), value: ctx.format(best.value, vf) });
        if (best.children.length) rows.push({ label: 'Enfants', value: String(best.children.length) });
        return { title: best.path.length ? best.path.join(' › ') : best.name, rows };
      },
    };
  },
};

const leaves0 = (n: PNode): number => (n.children.length ? n.children.reduce((a, c) => a + leaves0(c), 0) : 1);
const depthOf = (n: PNode): number => (n.children.length ? 1 + Math.max(...n.children.map(depthOf)) : 0);

export const SHAPE_MARKS: Record<string, MarkDefinition> = { radialBar, icicle, parliament, venn, wordcloud, timeline, tree };
