/**
 * Layered layout for flow diagrams (Sugiyama style), cycles included:
 *   1. break cycles: edges that close a loop are reversed for the layout only;
 *   2. rank nodes by longest path, so every edge points one way;
 *   3. split long edges with dummy nodes, so they route around boxes;
 *   4. order each layer by barycenters to cut crossings;
 *   5. place nodes along each layer, pulled towards their neighbors.
 * Everything is in pixels, in the final orientation.
 */

export interface FlowLayoutNode {
  id: string;
  w: number;
  h: number;
}

export interface FlowLayoutEdge {
  from: string;
  to: string;
}

export interface PlacedNode {
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
}

export interface PlacedEdge {
  /** Index in the input edges. */
  index: number;
  /** Polyline from the source box to the target box (empty for self-loops). */
  points: [number, number][];
  /** The edge closes a loop: it runs against the flow. */
  back: boolean;
  self: boolean;
}

export interface FlowLayout {
  nodes: Map<string, PlacedNode>;
  edges: PlacedEdge[];
  width: number;
  height: number;
}

interface LNode {
  id: string;
  dummy: boolean;
  main: number;
  cross: number;
  rank: number;
  pos: number;
  preds: LNode[];
  succs: LNode[];
}

export function layoutFlow(
  nodesIn: FlowLayoutNode[],
  edgesIn: FlowLayoutEdge[],
  options: { direction: 'TB' | 'LR'; rankGap: number; nodeGap: number; margin?: number },
): FlowLayout {
  const TB = options.direction !== 'LR';
  const margin = options.margin ?? 16;
  const size = new Map(nodesIn.map((n) => [n.id, n]));
  const ids = nodesIn.map((n) => n.id);

  // 1. Cycle breaking: a depth-first walk from the roots; an edge back to a node still on the stack closes a loop.
  const out = new Map<string, number[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  edgesIn.forEach((e, i) => {
    if (!size.has(e.from) || !size.has(e.to) || e.from === e.to) return;
    out.get(e.from)!.push(i);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  });
  const back = new Set<number>();
  const state = new Map<string, 0 | 1 | 2>(ids.map((id) => [id, 0]));
  const roots = [...ids.filter((id) => indeg.get(id) === 0), ...ids];
  for (const root of roots) {
    if (state.get(root) !== 0) continue;
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const edges = out.get(top[0])!;
      if (top[1] >= edges.length) {
        state.set(top[0], 2);
        stack.pop();
        continue;
      }
      const i = edges[top[1]++];
      const to = edgesIn[i].to;
      const s = state.get(to);
      if (s === 1) back.add(i);
      else if (s === 0) {
        state.set(to, 1);
        stack.push([to, 0]);
      }
    }
  }
  // Layout edges: back edges reversed, self-loops left out.
  const dag: { u: string; v: string; index: number }[] = [];
  edgesIn.forEach((e, i) => {
    if (!size.has(e.from) || !size.has(e.to) || e.from === e.to) return;
    dag.push(back.has(i) ? { u: e.to, v: e.from, index: i } : { u: e.from, v: e.to, index: i });
  });

  // 2. Ranks by longest path (Kahn order).
  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  const din = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of dag) din.set(e.v, din.get(e.v)! + 1);
  const queue = ids.filter((id) => din.get(id) === 0);
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    for (const e of dag) {
      if (e.u !== u) continue;
      rank.set(e.v, Math.max(rank.get(e.v)!, rank.get(u)! + 1));
      din.set(e.v, din.get(e.v)! - 1);
      if (din.get(e.v) === 0) queue.push(e.v);
    }
  }

  // 3. Layered graph with dummies on long edges.
  const mainOf = (id: string) => (TB ? size.get(id)!.h : size.get(id)!.w);
  const crossOf = (id: string) => (TB ? size.get(id)!.w : size.get(id)!.h);
  const lnodes = new Map<string, LNode>();
  for (const id of ids) lnodes.set(id, { id, dummy: false, main: mainOf(id), cross: crossOf(id), rank: rank.get(id)!, pos: 0, preds: [], succs: [] });
  const chains = new Map<number, LNode[]>();
  for (const e of dag) {
    const chain = [lnodes.get(e.u)!];
    for (let r = rank.get(e.u)! + 1; r < rank.get(e.v)!; r++) {
      const d: LNode = { id: `\u0000${e.index}:${r}`, dummy: true, main: 0, cross: 6, rank: r, pos: 0, preds: [], succs: [] };
      lnodes.set(d.id, d);
      chain.push(d);
    }
    chain.push(lnodes.get(e.v)!);
    for (let k = 0; k < chain.length - 1; k++) {
      chain[k].succs.push(chain[k + 1]);
      chain[k + 1].preds.push(chain[k]);
    }
    chains.set(e.index, chain);
  }
  const maxRank = Math.max(0, ...[...lnodes.values()].map((n) => n.rank));
  const layers: LNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of lnodes.values()) layers[n.rank].push(n);

  // 4. Barycenter ordering, alternating downward and upward sweeps.
  const index = () => layers.forEach((l) => l.forEach((n, i) => (n.pos = i)));
  index();
  const bary = (n: LNode, side: LNode[]) => (side.length ? side.reduce((a, m) => a + m.pos, 0) / side.length : n.pos);
  for (let it = 0; it < 12; it++) {
    const down = it % 2 === 0;
    const order = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of order) {
      const keys = new Map(layer.map((n) => [n, bary(n, down ? n.preds : n.succs)]));
      layer.sort((a, b) => keys.get(a)! - keys.get(b)! || a.pos - b.pos);
      layer.forEach((n, i) => (n.pos = i));
    }
  }

  // 5. Positions. Along the flow: one band per rank, as thick as its biggest box.
  const bandSize = layers.map((l) => Math.max(0, ...l.map((n) => n.main)));
  const bandCenter: number[] = [];
  let acc = margin;
  bandSize.forEach((s, r) => {
    bandCenter.push(acc + s / 2);
    acc += s + options.rankGap;
  });
  // Across the flow: packed, then pulled towards neighbors while keeping order and spacing.
  const gap = (a: LNode, b: LNode) => (a.dummy || b.dummy ? options.nodeGap / 2 : options.nodeGap) + (a.cross + b.cross) / 2;
  const centerOf = new Map<LNode, number>();
  for (const l of layers) {
    let x = 0;
    l.forEach((n, i) => {
      if (i > 0) x += gap(l[i - 1], n);
      centerOf.set(n, x);
    });
  }
  const settle = (l: LNode[], want: number[]) => {
    const n = l.length;
    const fwd = [...want];
    for (let i = 1; i < n; i++) fwd[i] = Math.max(fwd[i], fwd[i - 1] + gap(l[i - 1], l[i]));
    const bwd = [...want];
    for (let i = n - 2; i >= 0; i--) bwd[i] = Math.min(bwd[i], bwd[i + 1] - gap(l[i], l[i + 1]));
    const mid = want.map((_, i) => (fwd[i] + bwd[i]) / 2);
    for (let i = 1; i < n; i++) mid[i] = Math.max(mid[i], mid[i - 1] + gap(l[i - 1], l[i]));
    l.forEach((node, i) => centerOf.set(node, mid[i]));
  };
  for (let it = 0; it < 16; it++) {
    const down = it % 2 === 0;
    const order = down ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const l of order) {
      const want = l.map((n) => {
        const side = down ? n.preds : n.succs;
        return side.length ? side.reduce((a, m) => a + centerOf.get(m)!, 0) / side.length : centerOf.get(n)!;
      });
      settle(l, want);
    }
  }
  let minC = Infinity;
  let maxC = -Infinity;
  for (const [n, c] of centerOf) {
    minC = Math.min(minC, c - n.cross / 2);
    maxC = Math.max(maxC, c + n.cross / 2);
  }
  const shift = margin - minC;
  const crossExtent = maxC - minC + 2 * margin;
  const mainExtent = acc - options.rankGap + margin;
  const at = (main: number, cross: number): [number, number] => (TB ? [cross, main] : [main, cross]);

  const nodes = new Map<string, PlacedNode>();
  for (const id of ids) {
    const n = lnodes.get(id)!;
    const [x, y] = at(bandCenter[n.rank], centerOf.get(n)! + shift);
    nodes.set(id, { x, y, w: size.get(id)!.w, h: size.get(id)!.h, rank: n.rank });
  }
  const edges: PlacedEdge[] = edgesIn.map((e, index) => ({ index, points: [], back: back.has(index), self: e.from === e.to }));
  for (const [i, chain] of chains) {
    const pts: [number, number][] = chain.map((n, k) => {
      const c = centerOf.get(n)! + shift;
      const m = bandCenter[n.rank];
      // Leave the source on its far side, enter the target on its near side.
      if (k === 0) return at(m + n.main / 2, c);
      if (k === chain.length - 1) return at(m - n.main / 2, c);
      return at(m, c);
    });
    if (back.has(i)) {
      // A loop runs beside the forward path, not on top of it.
      const off = Math.min(18, options.nodeGap / 2);
      edges[i].points = pts.reverse().map(([x, y]) => (TB ? [x + off, y] : [x, y + off]) as [number, number]);
    } else edges[i].points = pts;
  }
  const [width, height] = TB ? [crossExtent, mainExtent] : [mainExtent, crossExtent];
  return { nodes, edges, width, height };
}
