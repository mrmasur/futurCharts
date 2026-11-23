/** Hierarchical edge bundling: leaves on a circle, links bent towards their common ancestors. */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import { mix, parseColor, withAlpha } from '../util/color';
import { pushArc, pushSegment } from './primitives';
import { emptyHit, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';

const TAU = Math.PI * 2;

export interface BundleNode {
  id: string;
  /** Ancestors, outermost first (`['core', 'render']`). Empty: the node hangs from the root. */
  path: string[];
}

export interface BundleLeaf extends BundleNode {
  /** Clockwise from 12 o'clock, radians: middle and edges of its cell on the circle. */
  angle: number;
  a0: number;
  a1: number;
  /** Top-level group ('' when it has none). */
  top: string;
}

interface TreeNode {
  name: string;
  depth: number;
  parent?: TreeNode;
  children: TreeNode[];
  leaf?: BundleLeaf;
  /** Position in the unit disc (x right, y up). */
  x: number;
  y: number;
  height: number;
  first: number;
  last: number;
}

export interface BundleLayout {
  leaves: BundleLeaf[];
  /** Polyline `[x0, y0, x1, y1, …]` in the unit disc (x right, y up) from leaf `a` to leaf `b`. */
  curve(a: string, b: string): Float64Array;
}

/**
 * Leaves in hierarchy order around the circle (a gap between top-level groups,
 * half a gap between sub-groups); inner nodes at the mean angle of their leaves,
 * closer to the center the higher they are. A link follows the tree from one
 * leaf up to the common ancestor and down to the other, as a B-spline pulled
 * towards the straight line by `1 - tension`.
 */
export function bundleLayout(nodes: BundleNode[], opt: { tension?: number; groupGap?: number; steps?: number } = {}): BundleLayout {
  const tension = Math.max(0, Math.min(1, opt.tension ?? 0.85));
  const groupGap = opt.groupGap ?? 1;
  const steps = opt.steps ?? 8;
  const root: TreeNode = { name: '', depth: 0, children: [], x: 0, y: 0, height: 0, first: 0, last: 0 };
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) {
    if (byId.has(n.id)) continue;
    let at = root;
    for (const p of n.path) {
      let c = at.children.find((e) => !e.leaf && e.name === p);
      if (!c) at.children.push((c = { name: p, depth: at.depth + 1, parent: at, children: [], x: 0, y: 0, height: 0, first: 0, last: 0 }));
      at = c;
    }
    const leaf: TreeNode = { name: n.id, depth: at.depth + 1, parent: at, children: [], x: 0, y: 0, height: 0, first: 0, last: 0 };
    leaf.leaf = { id: n.id, path: n.path, angle: 0, a0: 0, a1: 0, top: n.path[0] ?? '' };
    at.children.push(leaf);
    byId.set(n.id, leaf);
  }
  const order: TreeNode[] = [];
  const walk = (t: TreeNode) => {
    if (t.leaf) return void order.push(t);
    t.children.forEach(walk);
  };
  walk(root);
  const count = order.length;
  // Slots: one per leaf, plus the gaps where the group changes (around the whole circle).
  const gapAfter = order.map((t, i) => {
    const next = order[(i + 1) % count].leaf!;
    const cur = t.leaf!;
    if (count < 2) return 0;
    if (cur.top !== next.top) return groupGap;
    return cur.path.join('\u0000') !== next.path.join('\u0000') ? groupGap / 2 : 0;
  });
  const slots = count + gapAfter.reduce((a, g) => a + g, 0);
  const step = slots > 0 ? TAU / slots : 0;
  // The gap between the last group and the first one sits at 12 o'clock.
  let a = ((gapAfter[count - 1] ?? 0) / 2) * step;
  order.forEach((t, i) => {
    const leaf = t.leaf!;
    leaf.a0 = a;
    leaf.a1 = a + step;
    leaf.angle = a + step / 2;
    t.x = Math.sin(leaf.angle);
    t.y = Math.cos(leaf.angle);
    t.first = t.last = leaf.angle;
    a += step * (1 + gapAfter[i]);
  });
  const place = (t: TreeNode): void => {
    if (t.leaf) return;
    t.children.forEach(place);
    t.height = 1 + Math.max(0, ...t.children.map((c) => c.height));
    t.first = Math.min(...t.children.map((c) => c.first));
    t.last = Math.max(...t.children.map((c) => c.last));
    const mid = (t.first + t.last) / 2;
    const r = t.depth / (t.depth + t.height);
    t.x = Math.sin(mid) * r;
    t.y = Math.cos(mid) * r;
  };
  if (count) place(root);

  const curve = (ia: string, ib: string): Float64Array => {
    const na = byId.get(ia);
    const nb = byId.get(ib);
    if (!na || !nb) return new Float64Array(0);
    const up: TreeNode[] = [];
    const seen = new Set<TreeNode>();
    for (let t: TreeNode | undefined = na; t; t = t.parent) {
      up.push(t);
      seen.add(t);
    }
    const down: TreeNode[] = [];
    let lca: TreeNode | undefined = nb;
    for (; lca && !seen.has(lca); lca = lca.parent) down.push(lca);
    let ctrl = [...up.slice(0, up.indexOf(lca!) + 1), ...down.reverse()];
    // Through the root, the common ancestor is left out: bundles run from group to group, not all through the center.
    if (lca === root && ctrl.length > 3) ctrl = ctrl.filter((t) => t !== root);
    const n = ctrl.length - 1;
    const pts = ctrl.map((t, i) => {
      const u = n > 0 ? i / n : 0;
      return [
        tension * t.x + (1 - tension) * (na.x + (nb.x - na.x) * u),
        tension * t.y + (1 - tension) * (na.y + (nb.y - na.y) * u),
      ] as [number, number];
    });
    // Uniform cubic B-spline, clamped at both ends by repeating them.
    const p = [pts[0], pts[0], ...pts, pts[n], pts[n]];
    const spans = p.length - 3;
    const out = new Float64Array((spans * steps + 1) * 2);
    let k = 0;
    for (let s = 0; s < spans; s++) {
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        const b0 = (1 - t) ** 3 / 6;
        const b1 = (3 * t ** 3 - 6 * t * t + 4) / 6;
        const b2 = (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6;
        const b3 = t ** 3 / 6;
        out[k++] = b0 * p[s][0] + b1 * p[s + 1][0] + b2 * p[s + 2][0] + b3 * p[s + 3][0];
        out[k++] = b0 * p[s][1] + b1 * p[s + 1][1] + b2 * p[s + 2][1] + b3 * p[s + 3][1];
      }
    }
    out[k++] = pts[n][0];
    out[k++] = pts[n][1];
    return out;
  };
  return { leaves: order.map((t) => t.leaf!), curve };
}

/** Shorten a text to `max` px with an ellipsis. */
function fit(text: string, max: number, font: string): string {
  if (textWidth(text, font) <= max) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, font) > max) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * `bundle`: hierarchical edge bundling. Links from `source` to `target` (rows)
 * or from `layer.graph`; leaves grouped by `color` (the group of a row's source),
 * by a node's `group`, or by the prefixes of dotted names (`core.render.batch`).
 * Hover a leaf to bring out its links, click it to keep them; `highlight` does the same from the spec.
 */
export const bundle: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const sep: string = style.separator;
    const split = (s: string) => (sep ? s.split(sep).filter(Boolean) : [s]);
    const sf = layer.encode.source;
    const tf = layer.encode.target;
    const vf = layer.encode.value;

    // Nodes and links, from the graph or from the rows.
    const nodes: (BundleNode & { label: string })[] = [];
    const known = new Map<string, (typeof nodes)[number]>();
    const add = (id: string, group?: string, label?: string) => {
      const e = known.get(id);
      if (e) {
        if (group && !e.path.length) e.path = split(group);
        return;
      }
      const parts = split(id);
      const n = { id, path: group ? split(group) : parts.slice(0, -1), label: label ?? (group ? id : (parts[parts.length - 1] ?? id)) };
      known.set(id, n);
      nodes.push(n);
    };
    const links: { a: string; b: string; value: number; row?: number }[] = [];
    if (layer.graph) {
      for (const n of layer.graph.nodes) add(n.id, n.group, n.label);
      for (const e of layer.graph.edges) {
        add(e.from);
        add(e.to);
        links.push({ a: e.from, b: e.to, value: e.value ?? NaN });
      }
    } else {
      if (!sf || !tf) throw new Error('futurCharts: mark "bundle" needs encode.source and encode.target, or layer.graph.');
      const src = table.column(sf).values;
      const dst = table.column(tf).values;
      const grp = layer.encode.color && table.has(layer.encode.color) ? table.column(layer.encode.color).values : undefined;
      const val = vf ? (table.column(vf).values as Float64Array) : undefined;
      // Sources first: a row tells the group of its source.
      for (let i = 0; i < table.length; i++) add(String(src[i]), grp ? String(grp[i]) : undefined);
      for (let i = 0; i < table.length; i++) {
        add(String(dst[i]));
        links.push({ a: String(src[i]), b: String(dst[i]), value: val ? val[i] : NaN, row: i });
      }
    }
    const tops: string[] = [];
    for (const n of nodes) if (n.path[0] && !tops.includes(n.path[0])) tops.push(n.path[0]);
    const legend = tops.map((k) => ({ key: k, color: ctx.categorical(k) }));
    const shownNodes = nodes.filter((n) => !ctx.hidden.has(n.path[0] ?? ''));
    const lay = bundleLayout(shownNodes, { tension: style.tension, groupGap: style.groupGap });
    const leafOf = new Map(lay.leaves.map((l) => [l.id, l]));
    const shownLinks = links.filter((l) => l.a !== l.b && leafOf.has(l.a) && leafOf.has(l.b));
    const single = parseColor(layer.style?.color ?? theme.palette.categorical[0]);
    const colorOf = (id: string): RGBA => {
      const top = leafOf.get(id)!.top;
      return top ? ctx.categorical(top) : single;
    };
    const outOf = new Map<string, number>();
    const inOf = new Map<string, number>();
    for (const l of shownLinks) {
      outOf.set(l.a, (outOf.get(l.a) ?? 0) + 1);
      inOf.set(l.b, (inOf.get(l.b) ?? 0) + 1);
    }
    const degree = (id: string) => (outOf.get(id) ?? 0) + (inOf.get(id) ?? 0);

    // Geometry in px (y down): the circle leaves room for the names on both sides.
    const W = 1 / ctx.pixel[0];
    const H = 1 / ctx.pixel[1];
    const tx = (x: number) => x / W;
    const ty = (y: number) => 1 - y / H;
    const cx = W / 2;
    const cy = H / 2;
    const size = 11;
    const lineH = size + 2;
    const font = `500 ${size}px ${theme.font.family}`;
    const ring: number = style.nodeSize;
    const widest = style.labels ? Math.min(120, Math.max(0, ...lay.leaves.map((l) => textWidth(known.get(l.id)!.label, font)))) : 0;
    const half = Math.min(W, H) / 2;
    // Names along the radius (`radialLabels`): every leaf has its own, cut to the room left around the circle.
    // A small chart keeps the names on its sides: turned and cut to a few letters, they would say nothing.
    const radial = !!style.labels && !!style.radialLabels && half >= 120;
    const radialRoom = radial ? Math.min(widest, 110, half * 0.4) : 0;
    // Too low for names all around: the circle takes the height, and only the most connected leaves on its sides are named.
    const compact = style.labels && !radial && H / 2 - ring - 10 - lineH < 84;
    const sideRoom = compact ? Math.min(widest, 64) : widest;
    const R = Math.max(
      half * 0.5,
      radial ? half - ring - 12 - radialRoom : !style.labels ? half - ring - 6 : Math.min(H / 2 - ring - (compact ? 5 : 10 + lineH), W / 2 - sideRoom - ring - 16),
    );
    const Rl = R + 2 + ring + 6;
    const labelRoom = W / 2 - Rl - 4;

    // Names: one side each, moved away from the equator where they would overlap.
    interface Name { id: string; text: string; right: boolean; x: number; y: number; moved: boolean }
    const names: Name[] = [];
    if (style.labels && !radial && labelRoom > 24) {
      const gap = compact ? lineH * 1.5 : lineH;
      const capacity = Math.max(1, Math.floor(compact ? (2 * R) / gap : Math.min(H - 8, 2 * Rl + 2 * lineH) / gap));
      for (const right of [true, false]) {
        let side = lay.leaves.filter((l) => Math.sin(l.angle) >= 0 === right && (!compact || Math.abs(Math.cos(l.angle)) < 0.9));
        if (side.length > capacity) {
          // Too many for the height: the most connected keep their name.
          const keep = new Set([...side].sort((p, q) => degree(q.id) - degree(p.id)).slice(0, capacity).map((l) => l.id));
          side = side.filter((l) => keep.has(l.id));
        }
        const items = side.map((l) => ({ l, ideal: cy - Math.cos(l.angle) * Rl, y: 0 })).sort((p, q) => p.ideal - q.ideal);
        const upper = items.filter((i) => i.ideal < cy).reverse();
        const lower = items.filter((i) => i.ideal >= cy);
        upper.forEach((it, i) => (it.y = i ? Math.min(it.ideal, upper[i - 1].y - gap) : it.ideal));
        lower.forEach((it, i) => (it.y = i ? Math.max(it.ideal, lower[i - 1].y + gap) : Math.max(it.ideal, upper[0] ? upper[0].y + gap : -Infinity)));
        // Back inside the chart.
        const lo = size / 2 + 2;
        const hi = H - size / 2 - 2;
        for (let i = upper.length - 1; i >= 0; i--) upper[i].y = Math.max(upper[i].y, i === upper.length - 1 ? lo : upper[i + 1].y + gap);
        for (let i = lower.length - 1; i >= 0; i--) lower[i].y = Math.min(lower[i].y, i === lower.length - 1 ? hi : lower[i + 1].y - gap);
        for (const it of items) {
          const dy = it.y - cy;
          const dx = Math.abs(dy) < Rl ? Math.sqrt(Rl * Rl - dy * dy) : 0;
          const x = cx + (right ? 1 : -1) * Math.max(dx, 4);
          names.push({ id: it.l.id, text: fit(known.get(it.l.id)!.label, labelRoom + (Rl - Math.max(dx, 4)), font), right, x, y: it.y, moved: Math.abs(it.y - it.ideal) > 4 });
        }
      }
    }

    // Focus: a clicked leaf, or the spec's highlight when it names nodes.
    const hl = layer.highlight;
    const byNode = !!hl && (!hl.field || hl.field === sf || hl.field === tf || hl.field === 'id');
    const dim = byNode ? (hl!.dim ?? style.dim) : style.dim;
    let focus = ctx.state.focus as string | undefined;
    if (focus !== undefined && !leafOf.has(focus)) focus = undefined;
    // The leaf under the pointer: its links come out for as long as it stays there, over a clicked focus too.
    let hovered: string | undefined;
    const focusSet = (): Set<string> | undefined => {
      if (hovered !== undefined) return new Set([hovered]);
      if (focus !== undefined) return new Set([focus]);
      if (!byNode) return undefined;
      const s = new Set(hl!.values.map(String).filter((v) => leafOf.has(v)));
      return s.size ? s : undefined;
    };
    const vmax = Math.max(0, ...shownLinks.map((l) => (l.value > 0 ? l.value : 0)));
    const widthOf = (v: number) => style.linkWidth * (vmax > 0 && v > 0 ? 0.7 + 1.5 * Math.sqrt(v / vmax) : 1);
    const curves = shownLinks.map((l) => lay.curve(l.a, l.b));
    const muted = parseColor(theme.text.muted);

    const lineBatch = ctx.renderer.createBatch('line');
    const arcBatch = ctx.renderer.createBatch('arc');
    const arcDraw: MarkDraw = { batch: arcBatch, keys: lay.leaves.map((l) => l.id), data: new Float32Array(0) };
    const labels: MarkLabel[] = [];
    const write = () => {
      const fs = focusSet();
      const litLink = (l: (typeof shownLinks)[number]) => !fs || fs.has(l.a) || fs.has(l.b);
      const lit = new Set<string>(fs ?? []);
      if (fs) for (const l of shownLinks) if (litLink(l)) lit.add(l.a).add(l.b);
      const lines: number[] = [];
      for (const n of names) {
        if (!n.moved) continue;
        const l = leafOf.get(n.id)!;
        const r0 = R + 2 + ring + 2;
        pushSegment(lines, tx(cx + Math.sin(l.angle) * r0), ty(cy - Math.cos(l.angle) * r0), tx(n.x + (n.right ? -2 : 2)), ty(n.y), withAlpha(muted, 0.6), 1);
      }
      // Faded links first, the lit ones on top.
      for (const pass of [false, true]) {
        shownLinks.forEach((l, i) => {
          const on = litLink(l);
          if (on !== pass) return;
          const pts = curves[i];
          const segs = pts.length / 2 - 1;
          // The spec's own overrides apply when the highlight is not about nodes.
          const paint = (c: RGBA) => (byNode ? (on && fs && hl!.color && focus === undefined && hovered === undefined ? parseColor(hl!.color) : c) : ctx.paint(c, l.row));
          const c0 = paint(colorOf(l.a));
          const c1 = paint(colorOf(l.b));
          const alpha = !fs ? style.opacity : on ? Math.min(1, style.opacity + 0.35) : style.opacity * dim;
          const w = widthOf(l.value) + (fs && on ? 0.4 : 0);
          for (let s = 0; s < segs; s++) {
            // Blended with the surface rather than translucent: round caps would add up at every joint of a curve.
            const c = mix(ctx.surface, mix(c0, c1, (s + 0.5) / segs), alpha);
            pushSegment(lines, tx(cx + pts[s * 2] * R), ty(cy - pts[s * 2 + 1] * R), tx(cx + pts[s * 2 + 2] * R), ty(cy - pts[s * 2 + 3] * R), c, w);
          }
        });
      }
      lineBatch.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
      const arcs: number[] = [];
      for (const l of lay.leaves) {
        const c = colorOf(l.id);
        pushArc(arcs, tx(cx), ty(cy), (R + 2) / W, (R + 2 + ring) / W, l.a0, l.a1, 1, fs && !lit.has(l.id) ? withAlpha(c, Math.max(dim, 0.25)) : c, Math.min(2, ring / 2));
      }
      arcDraw.data = new Float32Array(arcs);
      arcBatch.update(arcDraw.data, arcs.length / LAYOUTS.arc.stride);
      labels.length = 0;
      for (const n of names) {
        const strong = fs?.has(n.id);
        labels.push({
          tx: tx(n.x), ty: ty(n.y), text: n.text, size, align: n.right ? 'left' : 'right', baseline: 'middle',
          weight: strong ? 700 : 500,
          color: !fs ? theme.text.secondary : lit.has(n.id) ? theme.text.primary : theme.text.muted,
        });
      }
      if (radial) {
        // Where the leaves are too close for every name, the most connected ones are placed first and stay.
        for (const l of [...lay.leaves].sort((p, q) => degree(q.id) - degree(p.id))) {
          const right = Math.sin(l.angle) >= 0;
          const deg = (l.angle * 180) / Math.PI;
          labels.push({
            tx: tx(cx + Math.sin(l.angle) * Rl), ty: ty(cy - Math.cos(l.angle) * Rl), text: known.get(l.id)!.label, size,
            // Read from the circle outwards on the right, towards it on the left: never upside down.
            rotate: right ? deg - 90 : deg + 90, align: right ? 'left' : 'right', baseline: 'middle', maxWidth: radialRoom,
            weight: fs?.has(l.id) ? 700 : 500,
            color: !fs ? theme.text.secondary : lit.has(l.id) ? theme.text.primary : theme.text.muted,
          });
        }
      }
      // The focused names first: they win where two names collide.
      if (fs) labels.sort((p, q) => Number(q.weight === 700) - Number(p.weight === 700));
    };
    write();

    const leafAt = (px: number, py: number): BundleLeaf | undefined => {
      const x = px * W - cx;
      const y = cy - (1 - py) * H;
      const r = Math.hypot(x, y);
      if (r < R - 6 || r > Rl + (radial ? radialRoom : names.length ? widest : 6)) return undefined;
      const a = (Math.atan2(x, y) + TAU) % TAU;
      return lay.leaves.find((l) => a >= l.a0 && a <= l.a1);
    };
    return {
      draws: [{ batch: lineBatch }, arcDraw],
      hit: emptyHit(),
      labels,
      legend,
      pick(px, py): ShapeHit | null {
        const l = leafAt(px, py);
        if (!l) return null;
        const rows = [
          { label: 'Liens sortants', value: String(outOf.get(l.id) ?? 0) },
          { label: 'Liens entrants', value: String(inOf.get(l.id) ?? 0) },
        ];
        if (l.path.length) rows.unshift({ label: 'Groupe', value: l.path.join(' › ') });
        return { title: known.get(l.id)!.label, rows };
      },
      hover(at) {
        const next = at ? leafAt(at.tx, at.ty)?.id : undefined;
        if (next === hovered) return false;
        hovered = next;
        write();
        return true;
      },
      click(px, py) {
        const l = leafAt(px, py);
        const next = l && l.id !== focus ? l.id : undefined;
        if (next === focus) return undefined;
        focus = next;
        ctx.state.focus = focus;
        write();
        return focus === undefined ? [] : [focus];
      },
    };
  },
};
