/**
 * Swimlanes and orthogonal routing for flow diagrams, on top of `layoutFlow`.
 *
 * - `layoutLanes`: same ranks as the layered layout, but every node stays inside the band of
 *   its lane (horizontal bands when the flow runs left to right, vertical ones top to bottom).
 * - `routeOrthogonal`: links as horizontal / vertical runs. Every link leaves its source on the
 *   far side (along the flow) and enters its target on the near side; it turns in the gap
 *   between two ranks (one track per link) and crosses ranks along a corridor clear of every box.
 *
 * Everything is in pixels, in the final orientation, like `layoutFlow`.
 */
import { layoutFlow, type FlowLayout, type FlowLayoutEdge, type FlowLayoutNode, type PlacedNode } from './flowLayout';

export interface FlowLane {
  name: string;
  /** Extent across the flow (y in `LR`, x in `TB`). */
  start: number;
  size: number;
}

export interface LaneLayout extends FlowLayout {
  lanes: FlowLane[];
  /** Size of the header strip, at the start of the flow axis. */
  header: number;
}

export function layoutLanes(
  nodesIn: (FlowLayoutNode & { lane?: string })[],
  edgesIn: FlowLayoutEdge[],
  options: { direction: 'TB' | 'LR'; rankGap: number; nodeGap: number; order?: string[]; header?: number; pad?: number },
): LaneLayout {
  const TB = options.direction !== 'LR';
  const pad = options.pad ?? 20;
  const header = options.header ?? 30;
  // Ranks, loops and a first order across the flow come from the layered layout.
  const base = layoutFlow(nodesIn, edgesIn, options);
  const laneOf = new Map(nodesIn.map((n) => [n.id, n.lane ?? '']));
  const present = new Set(laneOf.values());
  const names = [...new Set([...(options.order ?? []).filter((l) => present.has(l)), ...nodesIn.map((n) => n.lane ?? '')])];

  const ranks = Math.max(0, ...[...base.nodes.values()].map((n) => n.rank)) + 1;
  const mainOf = (p: PlacedNode) => (TB ? p.h : p.w);
  const crossOf = (p: PlacedNode) => (TB ? p.w : p.h);
  const bandSize = Array.from({ length: ranks }, () => 0);
  for (const p of base.nodes.values()) bandSize[p.rank] = Math.max(bandSize[p.rank], mainOf(p));
  const bandCenter: number[] = [];
  let acc = header + pad + 4;
  for (const s of bandSize) {
    bandCenter.push(acc + s / 2);
    acc += s + options.rankGap;
  }
  const mainExtent = acc - options.rankGap + pad + 4;

  const nodes = new Map<string, PlacedNode>();
  const lanes: FlowLane[] = [];
  let start = 0;
  for (const name of names) {
    // One stack per rank, in the order the layered layout found.
    const stacks: { id: string; p: PlacedNode }[][] = Array.from({ length: ranks }, () => []);
    for (const n of nodesIn) if (laneOf.get(n.id) === name) stacks[base.nodes.get(n.id)!.rank].push({ id: n.id, p: base.nodes.get(n.id)! });
    const extent = (s: { p: PlacedNode }[]) => s.reduce((a, m) => a + crossOf(m.p), 0) + Math.max(0, s.length - 1) * options.nodeGap;
    const size = Math.max(64, ...stacks.map(extent)) + 2 * pad;
    for (const [r, stack] of stacks.entries()) {
      stack.sort((a, b) => (TB ? a.p.x - b.p.x : a.p.y - b.p.y));
      let c = start + size / 2 - extent(stack) / 2;
      for (const { id, p } of stack) {
        const cross = c + crossOf(p) / 2;
        nodes.set(id, { ...p, x: TB ? cross : bandCenter[r], y: TB ? bandCenter[r] : cross });
        c += crossOf(p) + options.nodeGap;
      }
    }
    lanes.push({ name, start, size });
    start += size;
  }

  // Straight routes (used when the routing stays curved): far side of the source to near side of the target.
  const off = Math.min(18, options.nodeGap / 2);
  const edges = base.edges.map((e) => {
    const a = nodes.get(edgesIn[e.index].from);
    const b = nodes.get(edgesIn[e.index].to);
    if (!a || !b || e.self) return { ...e, points: [] as [number, number][] };
    const dir = e.back ? -1 : 1;
    const o = e.back ? off : 0;
    const points: [number, number][] = TB
      ? [[a.x + o, a.y + (dir * a.h) / 2], [b.x + o, b.y - (dir * b.h) / 2]]
      : [[a.x + (dir * a.w) / 2, a.y + o], [b.x - (dir * b.w) / 2, b.y + o]];
    return { ...e, points };
  });
  const [width, height] = TB ? [start, mainExtent] : [mainExtent, start];
  return { nodes, edges, width, height, lanes, header };
}

export interface RouteOptions {
  direction: 'TB' | 'LR';
  /** Closest a run along the flow may pass by a box, px. Default 12. */
  clearance?: number;
  /** Corridors stay inside this extent across the flow (the lanes). */
  bounds?: [number, number];
  /** How far inside its bounding box the outline of a node is, at `offset` px from its center across the flow (diamonds, pills). */
  inset?: (id: string, side: 'in' | 'out', offset: number) => number;
}

interface Box {
  id: string;
  m: number;
  c: number;
  hm: number;
  hc: number;
  rank: number;
}

/** One polyline of corners per edge (empty when an end is missing). */
export function routeOrthogonal(nodes: Map<string, PlacedNode>, edges: FlowLayoutEdge[], options: RouteOptions): [number, number][][] {
  const TB = options.direction !== 'LR';
  const clear = options.clearance ?? 12;
  const xy = (m: number, c: number): [number, number] => (TB ? [c, m] : [m, c]);
  // Ranks, compacted so that gaps are numbered without holes.
  const rankList = [...new Set([...nodes.values()].map((n) => n.rank))].sort((a, b) => a - b);
  const boxes = new Map<string, Box>();
  for (const [id, p] of nodes) {
    boxes.set(id, TB
      ? { id, m: p.y, c: p.x, hm: p.h / 2, hc: p.w / 2, rank: rankList.indexOf(p.rank) }
      : { id, m: p.x, c: p.y, hm: p.w / 2, hc: p.h / 2, rank: rankList.indexOf(p.rank) });
  }
  const R = rankList.length;
  const bandLo = Array.from({ length: R }, () => Infinity);
  const bandHi = Array.from({ length: R }, () => -Infinity);
  for (const b of boxes.values()) {
    bandLo[b.rank] = Math.min(bandLo[b.rank], b.m - b.hm);
    bandHi[b.rank] = Math.max(bandHi[b.rank], b.m + b.hm);
  }

  interface Link {
    i: number;
    u: Box;
    v: Box;
    outGap: number;
    inGap: number;
    cu: number;
    cv: number;
    corridor?: number;
    t1: number;
    t2: number;
  }
  const links: Link[] = [];
  edges.forEach((e, i) => {
    const u = boxes.get(e.from);
    const v = boxes.get(e.to);
    if (!u || !v || u === v) return;
    links.push({ i, u, v, outGap: u.rank + 1, inGap: v.rank, cu: u.c, cv: v.c, t1: 0, t2: 0 });
  });

  // A corridor: a line along the flow that passes clear of every box of the ranks it crosses.
  let used: { c: number; lo: number; hi: number }[] = [];
  const span = (l: Link): [number, number] => [Math.min(l.outGap, l.inGap), Math.max(l.outGap, l.inGap)];
  const obstacles = (l: Link) => {
    const [lo, hi] = span(l);
    return [...boxes.values()].filter((b) => b.rank >= lo && b.rank < hi);
  };
  const isFree = (c: number, obs: Box[], bounded: boolean) =>
    obs.every((b) => c <= b.c - b.hc - clear + 0.01 || c >= b.c + b.hc + clear - 0.01) &&
    (!bounded || !options.bounds || (c >= options.bounds[0] && c <= options.bounds[1]));
  const choose = (l: Link): number => {
    const obs = obstacles(l);
    const [lo, hi] = span(l);
    const cands: { c: number; cost: number }[] = [];
    for (const c0 of [l.cu, l.cv, ...obs.flatMap((b) => [b.c - b.hc - clear, b.c + b.hc + clear])]) {
      for (let k = -4; k <= 4; k++) {
        const c = c0 + k * 8;
        cands.push({ c, cost: Math.abs(c - l.cu) + Math.abs(c - l.cv) + Math.abs(k) * 0.01 });
      }
    }
    cands.sort((a, b) => a.cost - b.cost);
    const taken = (c: number) => used.some((s) => Math.abs(s.c - c) < 7.5 && s.lo < hi && lo < s.hi);
    const pick =
      cands.find((k) => isFree(k.c, obs, true) && !taken(k.c)) ??
      cands.find((k) => isFree(k.c, obs, true)) ??
      cands.find((k) => isFree(k.c, obs, false)) ?? { c: l.cu };
    used.push({ c: pick.c, lo, hi });
    return pick.c;
  };

  // First pass from box centers, to know which way each link turns; ports are then spread in that order.
  for (const l of links) if (l.outGap !== l.inGap) l.corridor = choose(l);
  const outs = new Map<Box, Link[]>();
  const ins = new Map<Box, Link[]>();
  for (const l of links) {
    outs.set(l.u, [...(outs.get(l.u) ?? []), l]);
    ins.set(l.v, [...(ins.get(l.v) ?? []), l]);
  }
  const spread = (box: Box, list: Link[], key: (l: Link) => number, set: (l: Link, c: number) => void) => {
    const sorted = [...list].sort((a, b) => key(a) - key(b) || a.i - b.i);
    const step = Math.min(16, (2 * box.hc - 16) / sorted.length);
    sorted.forEach((l, k) => set(l, box.c + (k - (sorted.length - 1) / 2) * step));
  };
  for (const [box, list] of outs) spread(box, list, (l) => l.corridor ?? l.v.c, (l, c) => (l.cu = c));
  for (const [box, list] of ins) spread(box, list, (l) => l.corridor ?? l.u.c, (l, c) => (l.cv = c));

  // Second pass with the real ports. A lone port slides to face the other end when that makes the link straight.
  used = [];
  const single = (map: Map<Box, Link[]>, b: Box) => map.get(b)!.length === 1;
  const within = (c: number, b: Box) => Math.abs(c - b.c) <= b.hc - 8;
  for (const l of links) {
    const obs = l.outGap === l.inGap ? [] : obstacles(l);
    if (single(ins, l.v) && within(l.cu, l.v) && isFree(l.cu, obs, true)) l.cv = l.cu;
    else if (single(outs, l.u) && within(l.cv, l.u) && isFree(l.cv, obs, true)) l.cu = l.cv;
    l.corridor = l.outGap === l.inGap ? undefined : choose(l);
  }

  // Tracks: in each gap, runs across the flow that overlap take different lines.
  const gaps = new Map<number, { l: Link; which: 't1' | 't2'; lo: number; hi: number }[]>();
  const addRun = (g: number, l: Link, which: 't1' | 't2', a: number, b: number) => {
    gaps.set(g, [...(gaps.get(g) ?? []), { l, which, lo: Math.min(a, b), hi: Math.max(a, b) }]);
  };
  for (const l of links) {
    if (l.corridor === undefined) addRun(l.outGap, l, 't1', l.cu, l.cv);
    else {
      addRun(l.outGap, l, 't1', l.cu, l.corridor);
      addRun(l.inGap, l, 't2', l.corridor, l.cv);
    }
  }
  for (const [g, runs] of gaps) {
    const real = runs.filter((r) => r.hi - r.lo > 0.5).sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    const ends: number[] = [];
    const track = new Map<(typeof runs)[number], number>();
    for (const r of real) {
      let k = ends.findIndex((end) => end + 6 < r.lo);
      if (k < 0) k = ends.length;
      ends[k] = r.hi;
      track.set(r, k);
    }
    const K = Math.max(1, ends.length);
    for (const r of runs) {
      const k = track.get(r) ?? 0;
      let m: number;
      if (g <= 0) m = bandLo[0] - 18 - 12 * k;
      else if (g >= R) m = bandHi[R - 1] + 18 + 12 * k;
      else {
        const a = bandHi[g - 1];
        const b = bandLo[g];
        m = (a + b) / 2 + (k - (K - 1) / 2) * Math.min(12, (b - a) / (K + 1));
      }
      r.l[r.which] = m;
    }
  }

  const inset = options.inset ?? (() => 0);
  const routes: [number, number][][] = edges.map(() => []);
  for (const l of links) {
    const p0: [number, number] = [l.u.m + l.u.hm - inset(l.u.id, 'out', l.cu - l.u.c), l.cu];
    const p1: [number, number] = [l.v.m - l.v.hm + inset(l.v.id, 'in', l.cv - l.v.c), l.cv];
    const mc: [number, number][] =
      l.corridor === undefined
        ? [p0, [l.t1, l.cu], [l.t1, l.cv], p1]
        : [p0, [l.t1, l.cu], [l.t1, l.corridor], [l.t2, l.corridor], [l.t2, l.cv], p1];
    routes[l.i] = simplify(mc).map(([m, c]) => xy(m, c));
  }
  // A step linked to itself: a small square loop on its side.
  edges.forEach((e, i) => {
    const b = boxes.get(e.from);
    if (!b || e.from !== e.to) return;
    const edge = b.c + b.hc;
    routes[i] = [xy(b.m + b.hm / 2, edge), xy(b.m + b.hm / 2, edge + 16), xy(b.m - b.hm / 2, edge + 16), xy(b.m - b.hm / 2, edge)];
  });
  return routes;
}

/** Drop repeated points and the middle of three aligned ones. */
function simplify(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01) continue;
    const before = out[out.length - 2];
    if (before && last && ((Math.abs(before[0] - last[0]) < 0.01 && Math.abs(last[0] - p[0]) < 0.01) || (Math.abs(before[1] - last[1]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Shift nodes and routes so that everything fits with a margin, and grow the drawing to hold them. */
export function fitRoutes(layout: FlowLayout, routes: [number, number][][], min: [number, number], margin = 16): void {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of routes) {
    for (const [x, y] of r) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x0 === Infinity) return;
  const dx = Math.max(0, min[0] - x0);
  const dy = Math.max(0, min[1] - y0);
  if (dx || dy) {
    for (const p of layout.nodes.values()) {
      p.x += dx;
      p.y += dy;
    }
    for (const r of routes) for (const p of r) (p[0] += dx), (p[1] += dy);
  }
  layout.width = Math.max(layout.width + dx, x1 + dx + margin);
  layout.height = Math.max(layout.height + dy, y1 + dy + margin);
}

/** Round every corner of a polyline (radius in px, never more than half a run). A point is added mid-way on the last run, for arrowheads. */
export function roundCorners(points: [number, number][], radius = 8): [number, number][] {
  if (points.length < 3) return points.length === 2 ? [points[0], [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2], points[1]] : points;
  const out: [number, number][] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [a, p, b] = [points[i - 1], points[i], points[i + 1]];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(radius, la / 2, lb / 2);
    if (r < 0.5) {
      out.push(p);
      continue;
    }
    const s: [number, number] = [p[0] + ((a[0] - p[0]) / la) * r, p[1] + ((a[1] - p[1]) / la) * r];
    const e: [number, number] = [p[0] + ((b[0] - p[0]) / lb) * r, p[1] + ((b[1] - p[1]) / lb) * r];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]);
    }
  }
  const last = points[points.length - 1];
  const prev = out[out.length - 1];
  out.push([(prev[0] + last[0]) / 2, (prev[1] + last[1]) / 2], last);
  return out;
}

/** Middle of the longest run of a route: where its label sits. Runs whose middle is close to a point of `avoid` (other labels) come last. */
export function labelAnchor(points: [number, number][], avoid: [number, number][] = []): [number, number] {
  let best: [number, number] = points[0];
  let top = -Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const mid: [number, number] = [(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2];
    const near = avoid.some((a) => Math.abs(a[0] - mid[0]) < 48 && Math.abs(a[1] - mid[1]) < 24);
    const score = Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]) - (near ? 1e6 : 0);
    if (score > top) {
      top = score;
      best = mid;
    }
  }
  return best;
}
