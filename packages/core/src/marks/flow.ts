/**
 * `flow`: a whole process — sources, steps, joins, branches, loops — from
 * `layer.graph`. Two looks: `pipeline` (default: small colored glyphs, thin
 * curves, labels underneath, lots of air) and `boxes` (boxes and arrows).
 * Laid out in pixels by `layoutFlow`, then fitted to the chart (text scales
 * with it, and with the zoom).
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import type { FlowEdge, FlowNode, FlowShape, LayerSpec } from '../spec/types';
import { lightTheme, themeColor } from '../theme/theme';
import { mix, parseColor, toCss, withAlpha } from '../util/color';
import { layoutFlow, type FlowLayout } from './flowLayout';
import { fitRoutes, labelAnchor, layoutLanes, roundCorners, routeOrthogonal, type FlowLane } from './flowRoute';
import { pushArc, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type BuiltMark, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';

const SHAPE_NAMES: Record<FlowShape, string> = {
  step: 'Étape',
  start: 'Début',
  end: 'Fin',
  decision: 'Décision',
  io: 'Entrée / sortie',
  subprocess: 'Sous-processus',
};
/** Default palette slot per shape, when nodes carry no group. */
const SHAPE_SLOT: Record<FlowShape, number> = { step: 0, start: 2, end: 2, decision: 3, io: 4, subprocess: 6 };

let measurer: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, size: number, family: string, weight = 600): number {
  if (measurer === undefined) measurer = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * size * 0.56;
  measurer.font = `${weight} ${size}px ${family}`;
  return measurer.measureText(text).width;
}

// ---------------------------------------------------------------- pipeline

/** Height of a pipeline node: glyph row, then two lines of text. */
const PIPE_H = 62;
/** Glyph row: centered this far from the top of the node. */
const GLYPH_Y = 13;

function glyphWidth(shape: FlowShape): number {
  return { start: 24, step: 58, decision: 34, io: 26, subprocess: 58, end: 36 }[shape];
}

/** Second line under a node: its description, else nothing (values are formatted at build time). */
function subText(n: FlowNode): string | undefined {
  return n.description ?? (n.value !== undefined ? String(n.value) : undefined);
}

interface Model {
  nodes: FlowNode[];
  edges: FlowEdge[];
  layout: FlowLayout;
  /** Some positions come from the spec: links are routed directly between glyphs. */
  manual?: boolean;
  /** Swimlanes (boxes look, `style.lanes`): bands across the flow, and the size of their header strip. */
  lanes?: FlowLane[];
  header?: number;
  /** Orthogonal routes (boxes look, `style.routing: 'orthogonal'`): corners of each link. */
  routes?: [number, number][][];
}

/** How far inside its bounding box the outline of a shape is, `offset` px from its center across the flow. */
function outlineInset(shape: FlowShape, side: 'in' | 'out', offset: number, w: number, h: number, TB: boolean): number {
  const [main, cross] = TB ? [h, w] : [w, h];
  if (shape === 'decision') return (main / 2) * Math.min(1, Math.abs(offset) / (cross / 2));
  if (shape === 'start' || shape === 'end') {
    // A pill: half circles on its short sides.
    const r = Math.min(w, h) / 2;
    const d = TB ? Math.max(0, Math.abs(offset) - (w / 2 - r)) : Math.abs(offset);
    return r - Math.sqrt(Math.max(0, r * r - d * d));
  }
  if (shape === 'io' && !TB) {
    const t = (offset + h / 2) / h;
    return 14 * (side === 'out' ? t : 1 - t);
  }
  return 0;
}

/** Grow (or shift) the drawing area so every node fits with a margin. */
function fitBounds(layout: FlowLayout, margin = 16): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of layout.nodes.values()) {
    x0 = Math.min(x0, p.x - p.w / 2);
    y0 = Math.min(y0, p.y - p.h / 2);
    x1 = Math.max(x1, p.x + p.w / 2);
    y1 = Math.max(y1, p.y + p.h / 2);
  }
  const dx = margin - x0;
  const dy = margin - y0;
  for (const p of layout.nodes.values()) {
    p.x += dx;
    p.y += dy;
  }
  layout.width = x1 - x0 + 2 * margin;
  layout.height = y1 - y0 + 2 * margin;
}

/** Layout depends on the layer only: computed once for `scales()` and reused by `build()`. */
const cache = new WeakMap<LayerSpec, Model>();

function model(layer: LayerSpec, style: { direction?: string; rankGap?: number; nodeGap?: number; fontSize?: number } = {}): Model {
  const hit = cache.get(layer);
  if (hit) return hit;
  const graph = layer.graph;
  if (!graph) throw new Error('futurCharts: mark "flow" needs layer.graph = { nodes, edges }.');
  const d = lightTheme.marks.flow;
  const s = { ...d, ...layer.style, ...style } as typeof d;
  const family = lightTheme.font.family;
  const nodes = graph.nodes;
  if (s.variant !== 'boxes') {
    // Pipeline: a glyph on top, the name and one line of detail under it; every node the same height so links stay level.
    const sized = nodes.map((n) => {
      const shape = n.shape ?? 'step';
      const sub = subText(n);
      const w = Math.max(64, glyphWidth(shape) + 16, textWidth(n.label ?? n.id, 11, family, 500) + 12, sub ? textWidth(sub, 10, family, 400) + 12 : 0);
      return { id: n.id, w, h: PIPE_H };
    });
    const layout = layoutFlow(sized, graph.edges, { direction: s.direction, rankGap: 34, nodeGap: 22 });
    // Positions written in the spec win over the automatic placement.
    let manual = false;
    for (const n of nodes) {
      const p = layout.nodes.get(n.id)!;
      if (n.x !== undefined) (p.x = n.x), (manual = true);
      if (n.y !== undefined) (p.y = n.y), (manual = true);
    }
    if (manual) fitBounds(layout);
    const m = { nodes, edges: graph.edges, layout, manual };
    cache.set(layer, m);
    return m;
  }
  const sized = nodes.map((n) => {
    const shape = n.shape ?? 'step';
    let w = Math.min(260, Math.max(96, textWidth(n.label ?? n.id, s.fontSize, family) + 32));
    let h = (shape === 'start' || shape === 'end' ? 40 : 44) + (n.value !== undefined ? 16 : 0);
    if (shape === 'decision') {
      w = Math.max(w + 48, 128);
      h = Math.max(h + 22, 66);
    }
    if (shape === 'io') w += 24;
    return { id: n.id, w, h };
  });
  const options = { direction: s.direction, rankGap: s.rankGap, nodeGap: s.nodeGap };
  if (!s.lanes && s.routing !== 'orthogonal') {
    const m = { nodes, edges: graph.edges, layout: layoutFlow(sized, graph.edges, options) };
    cache.set(layer, m);
    return m;
  }
  const TB = s.direction !== 'LR';
  const laned = s.lanes ? layoutLanes(sized.map((n, i) => ({ ...n, lane: nodes[i].group })), graph.edges, { ...options, order: s.laneOrder }) : undefined;
  const layout = laned ?? layoutFlow(sized, graph.edges, options);
  const m: Model = { nodes, edges: graph.edges, layout, lanes: laned?.lanes, header: laned?.header };
  if (s.routing === 'orthogonal') {
    const shapes = new Map(nodes.map((n) => [n.id, n.shape ?? 'step']));
    m.routes = routeOrthogonal(layout.nodes, graph.edges, {
      direction: s.direction,
      bounds: laned && laned.lanes.length ? [laned.lanes[0].start + 6, (TB ? laned.width : laned.height) - 6] : undefined,
      inset: (id, side, offset) => {
        const p = layout.nodes.get(id)!;
        return outlineInset(shapes.get(id)!, side, offset, p.w, p.h, TB);
      },
    });
    // Loops that go round the first or last rank need room; lanes keep their header clear.
    const head = (laned?.header ?? 0) + (laned ? 8 : 16);
    const side = laned ? 0 : 16;
    fitRoutes(layout, m.routes, TB ? [side, head] : [head, side], laned ? 8 : 16);
  }
  cache.set(layer, m);
  return m;
}

/** Samples of one cubic Bézier. */
function bezier(p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number], steps = 28): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
  return out;
}

/** A rounded path through `points`: each corner is a short curve, straight runs stay straight. */
function smooth(points: [number, number][], TB: boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = Math.min(30, seg / 2);
    // First and last legs follow the flow; the middle ones follow their own direction.
    const dirA: [number, number] = i === 0 ? (TB ? [0, 1] : [1, 0]) : [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
    const dirB: [number, number] = i === points.length - 2 ? (TB ? [0, 1] : [1, 0]) : [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
    const part = bezier(a, [a[0] + dirA[0] * t, a[1] + dirA[1] * t], [b[0] - dirB[0] * t, b[1] - dirB[1] * t], b, 16);
    out.push(...(i === 0 ? part : part.slice(1)));
  }
  return out;
}

/** Sample a path through `points` with tangents along the flow, so arrows leave and enter boxes straight. */
function sampleEdge(points: [number, number][], TB: boolean): [number, number][] {
  const out: [number, number][] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const c1: [number, number] = TB ? [x0, (y0 + y1) / 2] : [(x0 + x1) / 2, y0];
    const c2: [number, number] = TB ? [x1, (y0 + y1) / 2] : [(x0 + x1) / 2, y1];
    for (let k = 1; k <= 14; k++) {
      const t = k / 14;
      const u = 1 - t;
      out.push([
        u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * x1,
        u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * y1,
      ]);
    }
  }
  return out;
}

export const flow: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  scales({ layer }) {
    const { layout } = model(layer);
    // Below this share of its design size the text gets hard to read: pan instead of shrinking further.
    const floor = (layer.style?.variant ?? 'pipeline') === 'boxes' ? 0.85 : 0.75;
    return { x: new LinearScale(0, 1), y: new LinearScale(0, 1), aspect: layout.width / layout.height, minWidth: layout.width * floor };
  },
  build(ctx: BuildContext) {
    const { layer } = ctx.data;
    if (ctx.style.variant !== 'boxes') return buildPipeline(ctx, layer, model(layer));
    const { style, theme } = ctx;
    const { nodes, edges, layout, lanes, header = 0, routes } = model(layer);
    const TB = style.direction !== 'LR';
    const W = layout.width;
    const H = layout.height;
    const tx = (x: number) => x / W;
    const ty = (y: number) => 1 - y / H;
    const fs = 1 / W;

    // Colors: by group when nodes have groups (and a legend), else by shape.
    const groups = [...new Set(nodes.map((n) => n.group).filter((g): g is string => !!g))];
    // Lanes already name the groups: no legend then (colors are still taken, in the same order).
    const legend = groups.map((g) => ({ key: g, color: ctx.categorical(g) })).filter(() => !lanes);
    const palette = theme.palette.categorical.map(parseColor);
    const colorOf = (n: FlowNode): RGBA =>
      n.color ? parseColor(themeColor(theme, n.color)) : n.group ? ctx.categorical(n.group) : palette[SHAPE_SLOT[n.shape ?? 'step'] % palette.length];

    // Highlight: by node id or label; an arrow stays lit when both its ends are.
    const hl = layer.highlight;
    const lit = (n: FlowNode) => !hl || hl.values.map(String).includes(n.id) || hl.values.map(String).includes(n.label ?? '');
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const dim = hl?.dim ?? 0.25;
    const fade = (c: RGBA, on: boolean): RGBA => (on ? c : withAlpha(c, dim));

    const rects: number[] = [];
    const mesh: number[] = [];
    const lines: number[] = [];
    const labels: MarkLabel[] = [];
    const muted = parseColor(themeColor(theme, style.edge === 'auto' ? '$muted' : style.edge));
    const maxValue = Math.max(0, ...edges.map((e) => e.value ?? 0));

    // Swimlanes: one band per group under everything, every other one tinted, and a header strip with its name.
    const laneRects: number[] = [];
    const inkTone = parseColor(theme.text.primary);
    const laneFill = (k: number): RGBA => mix(ctx.surface, inkTone, k % 2 ? 0.045 : 0);
    const laneAt = (x: number, y: number) => (lanes ? lanes.findIndex((l) => (TB ? x : y) >= l.start && (TB ? x : y) < l.start + l.size) : -1);
    if (lanes) {
      const rule = withAlpha(inkTone, 0.14);
      lanes.forEach((l, k) => {
        const [bx0, by0, bx1, by1] = TB ? [l.start, 0, l.start + l.size, H] : [0, l.start, W, l.start + l.size];
        if (k % 2) pushRect(laneRects, { x0: tx(bx0), y0: ty(by1), x1: tx(bx1), y1: ty(by0), fill: laneFill(k) });
        const [hx0, hy0, hx1, hy1] = TB ? [bx0, 0, bx1, header] : [0, by0, header, by1];
        pushRect(laneRects, { x0: tx(hx0), y0: ty(hy1), x1: tx(hx1), y1: ty(hy0), fill: mix(ctx.surface, inkTone, 0.09) });
        if (k > 0) {
          if (TB) pushSegment(lines, tx(bx0), ty(0), tx(bx0), ty(H), rule, 1);
          else pushSegment(lines, tx(0), ty(by0), tx(W), ty(by0), rule, 1);
        }
        labels.push({
          tx: tx((hx0 + hx1) / 2), ty: ty((hy0 + hy1) / 2), text: l.name, color: theme.text.secondary, size: 12, weight: 600,
          align: 'center', baseline: 'middle', rotate: TB ? 0 : -90, maxWidth: l.size - 8, fontScale: fs, free: true,
        });
      });
      if (TB) pushSegment(lines, tx(0), ty(header), tx(W), ty(header), rule, 1);
      else pushSegment(lines, tx(header), ty(0), tx(header), ty(H), rule, 1);
    }

    // Orthogonal links: each label on a straight run, the links with the fewest runs choosing first.
    const anchors = new Map<number, [number, number]>();
    if (routes) {
      const labelled = edges.map((e, i) => i).filter((i) => edges[i].label && routes[i]?.length);
      for (const i of labelled.sort((a, b) => routes[a].length - routes[b].length || a - b)) anchors.set(i, labelAnchor(routes[i], [...anchors.values()]));
    }

    // Arrows first, so boxes sit on top of them.
    const sampled: { e: FlowEdge; pts: [number, number][] }[] = [];
    for (const placed of layout.edges) {
      const e = edges[placed.index];
      const a = layout.nodes.get(e.from);
      const b = layout.nodes.get(e.to);
      if (!a || !b) continue;
      let pts: [number, number][];
      const corners = routes?.[placed.index];
      if (corners?.length) {
        pts = roundCorners(corners, 7);
        // Dashes are cut per piece of the path: straight runs need short pieces.
        if (e.dashed) pts = pts.flatMap((p, k) => {
          if (k === 0) return [p];
          const q = pts[k - 1];
          const n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 3);
          return Array.from({ length: n }, (_, j) => [q[0] + ((p[0] - q[0]) * (j + 1)) / n, q[1] + ((p[1] - q[1]) * (j + 1)) / n] as [number, number]);
        });
      } else if (placed.self) {
        // A small loop on the outer side of the box.
        const [x0, y0] = TB ? [a.x + a.w / 2, a.y - 8] : [a.x + 8, a.y + a.h / 2];
        const [x1, y1] = TB ? [a.x + a.w / 2, a.y + 8] : [a.x - 8, a.y + a.h / 2];
        const bulge = 34;
        pts = [];
        for (let k = 0; k <= 24; k++) {
          const t = k / 24;
          const u = 1 - t;
          const c1 = TB ? [x0 + bulge, y0 - 14] : [x0 + 14, y0 + bulge];
          const c2 = TB ? [x1 + bulge, y1 + 14] : [x1 - 14, y1 + bulge];
          pts.push([
            u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * x1,
            u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * y1,
          ]);
        }
      } else {
        pts = sampleEdge(placed.points, TB);
      }
      const on = lit(byId.get(e.from)!) && lit(byId.get(e.to)!);
      const width = e.value !== undefined && maxValue > 0 ? style.edgeWidth + 5 * (e.value / maxValue) : style.edgeWidth;
      const color = fade(muted, on);
      // Stop the line where the arrowhead starts.
      const headLen = 8 + width;
      const end = pts[pts.length - 1];
      const prev = pts[Math.max(0, pts.length - 3)];
      const dx = end[0] - prev[0];
      const dy = end[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const body = pts.slice(0, -1).concat([[end[0] - ux * headLen * 0.8, end[1] - uy * headLen * 0.8]]);
      let run = 0;
      for (let k = 0; k < body.length - 1; k++) {
        const seg = Math.hypot(body[k + 1][0] - body[k][0], body[k + 1][1] - body[k][1]);
        // Dashes every 6 px along the path.
        if (!e.dashed || Math.floor(run / 6) % 2 === 0) {
          pushSegment(lines, tx(body[k][0]), ty(body[k][1]), tx(body[k + 1][0]), ty(body[k + 1][1]), color, width);
        }
        run += seg;
      }
      const half = 4 + width / 2;
      const bx = end[0] - ux * headLen;
      const by = end[1] - uy * headLen;
      pushVertex(mesh, tx(end[0]), ty(end[1]), color);
      pushVertex(mesh, tx(bx - uy * half), ty(by + ux * half), color);
      pushVertex(mesh, tx(bx + uy * half), ty(by - ux * half), color);
      if (e.label) {
        // Orthogonal: on the longest straight run. Curved: half-way along.
        const mid = anchors.get(placed.index) ?? pts[Math.floor(pts.length / 2)];
        const under = lanes ? laneFill(Math.max(0, laneAt(mid[0], mid[1]))) : ctx.surface;
        labels.push({
          tx: tx(mid[0]), ty: ty(mid[1]), text: e.label, align: 'center', baseline: 'middle', size: 11, weight: 600,
          color: on ? theme.text.secondary : toCss(withAlpha(parseColor(theme.text.muted), dim)),
          background: toCss(withAlpha(under, on ? 1 : dim)), fontScale: fs,
        });
      }
      sampled.push({ e, pts });
    }

    const r = style.radius;
    for (const n of nodes) {
      const p = layout.nodes.get(n.id)!;
      const shape = n.shape ?? 'step';
      const on = lit(n);
      const base = colorOf(n);
      const stroke = fade(base, on);
      const fill = fade(mix(ctx.surface, base, shape === 'start' || shape === 'end' ? style.tint * 2 : style.tint), on);
      const [x0, y0, x1, y1] = [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2];
      const outline = (pts: [number, number][]) => {
        for (let k = 0; k < pts.length; k++) {
          const a = pts[k];
          const b = pts[(k + 1) % pts.length];
          pushSegment(lines, tx(a[0]), ty(a[1]), tx(b[0]), ty(b[1]), stroke, 1.5);
        }
      };
      const polygon = (pts: [number, number][]) => {
        for (let k = 1; k < pts.length - 1; k++) {
          pushVertex(mesh, tx(pts[0][0]), ty(pts[0][1]), fill);
          pushVertex(mesh, tx(pts[k][0]), ty(pts[k][1]), fill);
          pushVertex(mesh, tx(pts[k + 1][0]), ty(pts[k + 1][1]), fill);
        }
        outline(pts);
      };
      if (shape === 'decision') {
        polygon([[p.x, y0], [x1, p.y], [p.x, y1], [x0, p.y]]);
      } else if (shape === 'io') {
        const k = 14;
        polygon([[x0 + k, y0], [x1, y0], [x1 - k, y1], [x0, y1]]);
      } else {
        const radius = shape === 'start' || shape === 'end' ? 999 : r;
        pushRect(rects, { x0: tx(x0), y0: ty(y1), x1: tx(x1), y1: ty(y0), fill, stroke, strokeWidth: 1.5, radii: [radius, radius, radius, radius] });
        if (shape === 'subprocess') {
          pushSegment(lines, tx(x0 + 9), ty(y0), tx(x0 + 9), ty(y1), stroke, 1.25);
          pushSegment(lines, tx(x1 - 9), ty(y0), tx(x1 - 9), ty(y1), stroke, 1.25);
        }
      }
      const ink = on ? theme.text.primary : toCss(withAlpha(parseColor(theme.text.primary), Math.max(dim, 0.35)));
      const hasValue = n.value !== undefined;
      labels.push({ tx: tx(p.x), ty: ty(p.y), text: n.label ?? n.id, color: ink, size: style.fontSize, weight: 600, align: 'center', baseline: 'middle', dy: hasValue ? -8 : 0, fontScale: fs });
      if (hasValue) {
        labels.push({ tx: tx(p.x), ty: ty(p.y), text: ctx.format(n.value!, layer.encode.value), color: on ? theme.text.secondary : ink, size: 11, align: 'center', baseline: 'middle', dy: 10, fontScale: fs });
      }
    }

    // Boxes over arrows: rects (rounded boxes) then the mesh holds arrowheads and polygon boxes.
    const draws = [];
    if (lanes) {
      const laneBatch = ctx.renderer.createBatch('rect');
      laneBatch.update(new Float32Array(laneRects), laneRects.length / LAYOUTS.rect.stride);
      draws.push({ batch: laneBatch, enter: 'fade' as const });
    }
    const lineBatch = ctx.renderer.createBatch('line');
    lineBatch.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
    const meshBatch = ctx.renderer.createBatch('mesh');
    meshBatch.update(new Float32Array(mesh), mesh.length / LAYOUTS.mesh.stride);
    const rectBatch = ctx.renderer.createBatch('rect');
    rectBatch.update(new Float32Array(rects), rects.length / LAYOUTS.rect.stride);
    draws.push({ batch: meshBatch, enter: 'fade' as const }, { batch: lineBatch, enter: 'fade' as const }, { batch: rectBatch, enter: 'fade' as const });

    const nodeAt = (x: number, y: number) =>
      nodes.find((n) => {
        const p = layout.nodes.get(n.id)!;
        return Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2;
      });
    const name = (id: string) => byId.get(id)?.label ?? id;
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(px, py): ShapeHit | null {
        const x = px * W;
        const y = (1 - py) * H;
        const n = nodeAt(x, y);
        if (n) {
          const rows = [{ label: 'Type', value: SHAPE_NAMES[n.shape ?? 'step'] }];
          if (n.value !== undefined) rows.push({ label: ctx.fields[layer.encode.value ?? '']?.label ?? 'Valeur', value: ctx.format(n.value, layer.encode.value) });
          const ins = edges.filter((e) => e.to === n.id).length;
          const outs = edges.filter((e) => e.from === n.id).length;
          rows.push({ label: 'Entrées / sorties', value: `${ins} / ${outs}` });
          if (n.group) rows.push({ label: 'Groupe', value: n.group });
          if (n.description) rows.push({ label: 'Note', value: n.description });
          return { title: n.label ?? n.id, rows };
        }
        // The closest arrow within a few pixels.
        let best: { e: FlowEdge; d: number } | undefined;
        for (const s of sampled) {
          for (const [sx, sy] of s.pts) {
            const d = Math.hypot(sx - x, sy - y);
            if (d < 7 && (!best || d < best.d)) best = { e: s.e, d };
          }
        }
        if (!best) return null;
        const e = best.e;
        const rows: { label: string; value: string }[] = [];
        if (e.label) rows.push({ label: 'Condition', value: e.label });
        if (e.value !== undefined) rows.push({ label: ctx.fields[layer.encode.value ?? '']?.label ?? 'Volume', value: ctx.format(e.value, layer.encode.value) });
        return { title: `${name(e.from)} → ${name(e.to)}`, rows };
      },
      click(px, py) {
        // A box click reports the step (to filter other charts); the diagram itself does not change.
        const n = nodeAt(px * W, (1 - py) * H);
        return n ? [n.id] : undefined;
      },
    };
  },
};

/**
 * Pipeline look: inputs as filled discs, cleaning steps as colored bars,
 * joins as overlapping rings (in the colors of what they join), unions as
 * stacked tiles, outputs as dark tiles. Thin gray curves, no arrowheads (the
 * flow reads left to right), labels under each glyph.
 */
function buildPipeline(ctx: BuildContext, layer: LayerSpec, m: Model): ReturnType<MarkDefinition['build']> {
  const { style, theme } = ctx;
  const { nodes, edges, layout } = m;
  const TB = style.direction === 'TB';
  const W = layout.width;
  const H = layout.height;
  const tx = (x: number) => x / W;
  const ty = (y: number) => 1 - y / H;
  const unit = 1 / W;
  const fs = 1 / W;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ink = parseColor(theme.text.primary);

  // Positions moved by hand in this chart (kept across rebuilds) on top of the layout.
  const moved = (ctx.state.positions as Record<string, { x: number; y: number }> | undefined) ?? {};
  ctx.state.positions = moved;
  // A position written in the spec (for instance saved from a \`layout\` event) replaces a hand move.
  for (const n of nodes) if (n.x !== undefined || n.y !== undefined) delete moved[n.id];
  const at = (id: string) => {
    const p = layout.nodes.get(id)!;
    const o = moved[id];
    return o ? { ...p, x: o.x, y: o.y } : p;
  };

  // Colors flow downstream: each source takes the next palette color, steps inherit
  // from what feeds them, joins and unions start a new color. Groups win when given.
  const order = [...nodes].sort((a, b) => {
    const pa = layout.nodes.get(a.id)!;
    const pb = layout.nodes.get(b.id)!;
    return pa.rank - pb.rank || (TB ? pa.x - pb.x : pa.y - pb.y);
  });
  const groups = [...new Set(nodes.map((n) => n.group).filter((g): g is string => !!g))];
  const legend = groups.map((g) => ({ key: g, color: ctx.categorical(g) }));
  const palette = theme.palette.categorical.map(parseColor);
  let next = 0;
  const colorOf = new Map<string, RGBA>();
  const inputs = (id: string) =>
    edges
      .filter((e, i) => e.to === id && !layout.edges[i].back && e.from !== id)
      .map((e) => e.from)
      .sort((a, b) => (TB ? layout.nodes.get(a)!.x - layout.nodes.get(b)!.x : layout.nodes.get(a)!.y - layout.nodes.get(b)!.y));
  for (const n of order) {
    const shape = n.shape ?? 'step';
    let c: RGBA;
    if (n.color) c = parseColor(themeColor(theme, n.color));
    else if (n.group) c = ctx.categorical(n.group);
    else if (shape === 'end') c = ink;
    else {
      const from = inputs(n.id);
      const inherit = (shape === 'step' || shape === 'subprocess') && from.length > 0 && colorOf.has(from[0]);
      c = inherit ? colorOf.get(from[0])! : palette[next++ % palette.length];
    }
    colorOf.set(n.id, c);
  }

  const hl = layer.highlight;
  const lit = (n: FlowNode) => !hl || hl.values.map(String).includes(n.id) || hl.values.map(String).includes(n.label ?? '');
  const dim = hl?.dim ?? 0.25;
  const fade = (c: RGBA, on: boolean): RGBA => (on ? c : withAlpha(c, dim));
  const link = withAlpha(parseColor(themeColor(theme, style.edge === 'auto' ? '$muted' : style.edge)), 0.55);
  const maxValue = Math.max(0, ...edges.map((e) => e.value ?? 0));
  const shift = GLYPH_Y - PIPE_H / 2;

  /** Glyph center of a node, and its half extent along the flow. */
  const glyph = (id: string) => {
    const p = at(id);
    const half = TB ? 12 : glyphWidth(byId.get(id)?.shape ?? 'step') / 2;
    return { x: p.x, y: p.y - p.h / 2 + GLYPH_Y, half };
  };

  const batches = {
    line: ctx.renderer.createBatch('line'),
    mesh: ctx.renderer.createBatch('mesh'),
    arc: ctx.renderer.createBatch('arc'),
    rect: ctx.renderer.createBatch('rect'),
  };
  const labels: MarkLabel[] = [];
  let sampled: { e: FlowEdge; pts: [number, number][] }[] = [];

  /** Route of one link. Automatic layout: through its waypoints. Hand-placed: straight from glyph to glyph. */
  const route = (i: number): [number, number][] => {
    const placed = layout.edges[i];
    const e = edges[i];
    const a = glyph(e.from);
    const b = glyph(e.to);
    if (placed.self) {
      const r = 14;
      const pts: [number, number][] = [];
      for (let k = 0; k <= 32; k++) {
        const t = Math.PI * 0.15 + (Math.PI * 1.7 * k) / 32;
        pts.push([a.x + Math.sin(t) * r, a.y - 12 - r + Math.cos(t) * r * 0.8]);
      }
      return pts;
    }
    // Links touching a hand-placed step are redrawn; the others keep their automatic route.
    if (m.manual || moved[e.from] || moved[e.to]) {
      const [x0, y0] = TB ? [a.x, a.y + 16] : [a.x + a.half + 5, a.y];
      const [x1, y1] = TB ? [b.x, b.y - 16] : [b.x - b.half - 5, b.y];
      const along = TB ? y1 - y0 : x1 - x0;
      const across = TB ? x1 - x0 : y1 - y0;
      if (along < 44) {
        const pa = at(e.from);
        const pb = at(e.to);
        if (Math.abs(across) > 44) {
          // Not enough room ahead but rows apart: a rounded Z between the two rows.
          const mid = TB ? (x0 + x1) / 2 : (y0 + y1) / 2;
          return TB
            ? smooth([[x0, y0], [mid, y0 + 22], [mid, y1 - 22], [x1, y1]], TB)
            : smooth([[x0, y0], [x0 + 22, mid], [x1 - 22, mid], [x1, y1]], TB);
        }
        // Same row, going back: around under (or beside) both steps.
        if (TB) {
          const side = Math.max(pa.x + pa.w / 2, pb.x + pb.w / 2) + 14;
          return smooth([[x0, y0], [side, y0 + 24], [side, y1 - 24], [x1, y1]], TB);
        }
        const below = Math.max(pa.y + pa.h / 2, pb.y + pb.h / 2) + 10;
        return smooth([[x0, y0], [x0 + 26, below], [x1 - 26, below], [x1, y1]], TB);
      }
      // Leave and enter along the flow, with handles never shorter than 36 px:
      // a step placed right under another still gets a soft curve, not a straight drop.
      const t = Math.max(36, Math.abs(along) / 2, Math.abs(across) * 0.35);
      return bezier([x0, y0], TB ? [x0, y0 + t] : [x0 + t, y0], TB ? [x1, y1 - t] : [x1 - t, y1], [x1, y1]);
    }
    let p = placed.points.map(([x, y]) => (TB ? [x, y] : [x, y + shift]) as [number, number]);
    if (placed.back && !TB) p = p.map(([x, y], k) => (k === 0 || k === p.length - 1 ? [x, y] : [x, y + PIPE_H * 0.55]) as [number, number]);
    if (TB) {
      p[0] = [a.x, a.y + 16];
      p[p.length - 1] = [b.x, b.y - 16];
    } else {
      const dir = placed.back ? -1 : 1;
      p[0] = [a.x + dir * (a.half + 5), a.y];
      p[p.length - 1] = [b.x - dir * (b.half + 5), b.y];
    }
    return sampleEdge(p, TB);
  };

  /** Build every vertex from the current positions: once, then on each drag step. */
  const render = () => {
    const lines: number[] = [];
    const mesh: number[] = [];
    const arcs: number[] = [];
    const rects: number[] = [];
    labels.length = 0;
    sampled = [];
    layout.edges.forEach((placed, i) => {
      const e = edges[i];
      if (!byId.has(e.from) || !byId.has(e.to)) return;
      const pts = route(i);
      const on = lit(byId.get(e.from)!) && lit(byId.get(e.to)!);
      const width = e.value !== undefined && maxValue > 0 ? 1.25 + 4 * (e.value / maxValue) : 1.25;
      const color = fade(link, on);
      let run = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const seg = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
        if (!e.dashed || Math.floor(run / 5) % 2 === 0) pushSegment(lines, tx(pts[k][0]), ty(pts[k][1]), tx(pts[k + 1][0]), ty(pts[k + 1][1]), color, width);
        run += seg;
      }
      // Only links that run backwards need an arrowhead: everything else reads left to right.
      const handPlaced = m.manual || !!moved[e.from] || !!moved[e.to];
      const backwards = placed.self || (handPlaced ? (TB ? glyph(e.to).y <= glyph(e.from).y : glyph(e.to).x <= glyph(e.from).x) : placed.back);
      if (backwards) {
        const end = pts[pts.length - 1];
        const prev = pts[Math.max(0, pts.length - 3)];
        const len = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
        const ux = (end[0] - prev[0]) / len;
        const uy = (end[1] - prev[1]) / len;
        const bx = end[0] - ux * 6;
        const by = end[1] - uy * 6;
        pushVertex(mesh, tx(end[0]), ty(end[1]), color);
        pushVertex(mesh, tx(bx - uy * 3.5), ty(by + ux * 3.5), color);
        pushVertex(mesh, tx(bx + uy * 3.5), ty(by - ux * 3.5), color);
      }
      if (e.label) {
        const mid = pts[Math.floor(pts.length / 2)];
        labels.push({
          tx: tx(mid[0]), ty: ty(mid[1]), text: e.label, size: 10, weight: 500, align: 'center', baseline: 'middle',
          color: on ? theme.text.secondary : toCss(withAlpha(parseColor(theme.text.muted), dim)),
          background: toCss(withAlpha(ctx.surface, on ? 1 : dim)), fontScale: fs,
        });
      }
      sampled.push({ e, pts });
    });

    const ring = (x: number, y: number, r0: number, r1: number, c: RGBA) => pushArc(arcs, tx(x), ty(y), r0 * unit, r1 * unit, 0, Math.PI * 2, 0, c);
    for (const n of nodes) {
      const p = at(n.id);
      const g = glyph(n.id);
      const shape = n.shape ?? 'step';
      const on = lit(n);
      const c = fade(colorOf.get(n.id)!, on);
      switch (shape) {
        case 'start':
          // A disc with a thin surface ring inside: an input.
          ring(g.x, g.y, 0, 11, c);
          ring(g.x, g.y, 5.5, 7, fade(ctx.surface, on));
          break;
        case 'step':
          pushRect(rects, { x0: tx(g.x - 29), y0: ty(g.y + 3), x1: tx(g.x + 29), y1: ty(g.y - 3), fill: c, radii: [999, 999, 999, 999] });
          break;
        case 'subprocess':
          pushRect(rects, { x0: tx(g.x - 29), y0: ty(g.y + 5), x1: tx(g.x + 29), y1: ty(g.y + 1), fill: c, radii: [999, 999, 999, 999] });
          pushRect(rects, { x0: tx(g.x - 29), y0: ty(g.y - 1), x1: tx(g.x + 29), y1: ty(g.y - 5), fill: c, radii: [999, 999, 999, 999] });
          break;
        case 'decision': {
          // Two overlapping rings, in the colors of the first two inputs (a join, a merge, a choice).
          const from = inputs(n.id);
          const left = fade(from[0] ? colorOf.get(from[0])! : colorOf.get(n.id)!, on);
          const right = fade(from[1] ? colorOf.get(from[1])! : colorOf.get(n.id)!, on);
          ring(g.x - 6, g.y, 0, 10.5, withAlpha(left, left[3] * 0.18));
          ring(g.x + 6, g.y, 0, 10.5, withAlpha(right, right[3] * 0.18));
          ring(g.x - 6, g.y, 8.5, 10.5, left);
          ring(g.x + 6, g.y, 8.5, 10.5, right);
          break;
        }
        case 'io':
          // Stacked tiles: a union of several inputs.
          for (const [dx, dy, a] of [[-4, -4, 0.45], [0, 0, 0.7], [4, 4, 1]] as const) {
            pushRect(rects, { x0: tx(g.x + dx - 8), y0: ty(g.y + dy + 8), x1: tx(g.x + dx + 8), y1: ty(g.y + dy - 8), fill: withAlpha(c, c[3] * a), radii: [3, 3, 3, 3] });
          }
          break;
        case 'end': {
          // A dark tile and a small play mark: an output.
          pushRect(rects, { x0: tx(g.x - 18), y0: ty(g.y + 10), x1: tx(g.x + 2), y1: ty(g.y - 10), fill: c, radii: [4, 4, 4, 4] });
          ring(g.x - 8, g.y, 3, 4.5, fade(ctx.surface, on));
          const t = fade(parseColor(theme.text.muted), on);
          pushSegment(lines, tx(g.x + 9), ty(g.y - 5), tx(g.x + 9), ty(g.y + 5), t, 1.25);
          pushSegment(lines, tx(g.x + 9), ty(g.y - 5), tx(g.x + 17), ty(g.y), t, 1.25);
          pushSegment(lines, tx(g.x + 9), ty(g.y + 5), tx(g.x + 17), ty(g.y), t, 1.25);
          break;
        }
      }
      const text = on ? theme.text.primary : toCss(withAlpha(ink, Math.max(dim, 0.35)));
      const top = p.y - p.h / 2 + 30;
      labels.push({ tx: tx(p.x), ty: ty(top), text: n.label ?? n.id, size: 11, weight: 500, color: text, align: 'center', baseline: 'top', fontScale: fs });
      const sub = n.description ?? (n.value !== undefined ? ctx.format(n.value, layer.encode.value) : undefined);
      if (sub) labels.push({ tx: tx(p.x), ty: ty(top), text: sub, size: 10, color: on ? theme.text.muted : text, align: 'center', baseline: 'top', dy: 14, fontScale: fs });
    }
    for (const [kind, data] of [['line', lines], ['mesh', mesh], ['arc', arcs], ['rect', rects]] as const) {
      batches[kind].update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
    }
  };
  render();

  const nodeAt = (x: number, y: number) =>
    [...nodes].reverse().find((n) => {
      const p = at(n.id);
      return Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2;
    });
  const name = (id: string) => byId.get(id)?.label ?? id;
  const editable = ctx.style.editable !== false;
  let dragging: { id: string; dx: number; dy: number } | undefined;
  return {
    draws: [batches.line, batches.mesh, batches.arc, batches.rect].map((batch) => ({ batch, enter: 'fade' as const })),
    hit: emptyHit(),
    labels,
    legend,
    pick(px, py): ShapeHit | null {
      const x = px * W;
      const y = (1 - py) * H;
      const n = nodeAt(x, y);
      if (n) {
        const rows = [{ label: 'Type', value: PIPE_NAMES[n.shape ?? 'step'] }];
        if (n.value !== undefined) rows.push({ label: ctx.fields[layer.encode.value ?? '']?.label ?? 'Valeur', value: ctx.format(n.value, layer.encode.value) });
        const ins = edges.filter((e) => e.to === n.id).map((e) => name(e.from));
        if (ins.length) rows.push({ label: 'Depuis', value: ins.join(', ') });
        if (n.group) rows.push({ label: 'Groupe', value: n.group });
        return { title: n.label ?? n.id, rows };
      }
      let best: { e: FlowEdge; d: number } | undefined;
      for (const s of sampled) {
        for (const [sx, sy] of s.pts) {
          const d = Math.hypot(sx - x, sy - y);
          if (d < 6 && (!best || d < best.d)) best = { e: s.e, d };
        }
      }
      if (!best) return null;
      const e = best.e;
      const rows: { label: string; value: string }[] = [];
      if (e.label) rows.push({ label: 'Condition', value: e.label });
      if (e.value !== undefined) rows.push({ label: ctx.fields[layer.encode.value ?? '']?.label ?? 'Volume', value: ctx.format(e.value, layer.encode.value) });
      return { title: `${name(e.from)} → ${name(e.to)}`, rows };
    },
    click(px, py) {
      const n = nodeAt(px * W, (1 - py) * H);
      return n ? [n.id] : undefined;
    },
    drag: editable
      ? {
          start(px, py) {
            const n = nodeAt(px * W, (1 - py) * H);
            if (!n) return false;
            const p = at(n.id);
            dragging = { id: n.id, dx: p.x - px * W, dy: p.y - (1 - py) * H };
            return true;
          },
          move(px, py) {
            if (!dragging) return;
            const p = layout.nodes.get(dragging.id)!;
            // Snapped to a 4 px grid, kept inside the drawing.
            const snap = (v: number) => Math.round(v / 4) * 4;
            const x = Math.min(W - p.w / 2, Math.max(p.w / 2, snap(px * W + dragging.dx)));
            const y = Math.min(H - p.h / 2, Math.max(p.h / 2, snap((1 - py) * H + dragging.dy)));
            moved[dragging.id] = { x, y };
            render();
          },
          end() {
            dragging = undefined;
            // Every node's position, ready to be written back as `x` / `y` in the spec.
            const positions: Record<string, { x: number; y: number }> = {};
            for (const n of nodes) {
              const p = at(n.id);
              positions[n.id] = { x: Math.round(p.x), y: Math.round(p.y) };
            }
            return positions;
          },
        }
      : undefined,
  };
}

/** Pipeline vocabulary: the same shapes, named for data flows. */
const PIPE_NAMES: Record<FlowShape, string> = {
  start: 'Source',
  step: 'Étape',
  subprocess: 'Sous-flux',
  decision: 'Jointure / choix',
  io: 'Union',
  end: 'Sortie',
};
