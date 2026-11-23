import { describe, expect, it } from 'vitest';
import { layoutFlow } from '../src/marks/flowLayout';
import { layoutLanes, routeOrthogonal } from '../src/marks/flowRoute';

const box = (id: string) => ({ id, w: 100, h: 40 });

describe('flow layout', () => {
  const nodes = ['start', 'check', 'retry', 'ok', 'end', 'cancel'].map(box);
  const edges = [
    { from: 'start', to: 'check' },
    { from: 'check', to: 'ok' },
    { from: 'check', to: 'retry' },
    { from: 'retry', to: 'check' }, // loop
    { from: 'retry', to: 'cancel' },
    { from: 'ok', to: 'end' },
    { from: 'end', to: 'end' }, // self-loop
  ];
  const l = layoutFlow(nodes, edges, { direction: 'TB', rankGap: 40, nodeGap: 20 });

  it('ranks every forward edge downwards, loops included', () => {
    for (const [i, e] of edges.entries()) {
      if (e.from === e.to) continue;
      const a = l.nodes.get(e.from)!;
      const b = l.nodes.get(e.to)!;
      if (l.edges[i].back) expect(a.rank).toBeGreaterThan(b.rank);
      else expect(a.rank).toBeLessThan(b.rank);
    }
    expect(l.edges.filter((e) => e.back).length).toBe(1);
    expect(l.edges[6].self).toBe(true);
  });

  it('keeps boxes of a rank apart', () => {
    const byRank = new Map<number, { x: number; w: number }[]>();
    for (const n of l.nodes.values()) byRank.set(n.rank, [...(byRank.get(n.rank) ?? []), n]);
    for (const row of byRank.values()) {
      row.sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) expect(row[i].x - row[i - 1].x).toBeGreaterThanOrEqual((row[i].w + row[i - 1].w) / 2 + 20 - 1e-6);
    }
  });

  it('routes arrows from the source box to the target box, against the flow for loops', () => {
    const loop = l.edges[3];
    const from = l.nodes.get('retry')!;
    const to = l.nodes.get('check')!;
    const [x0, y0] = loop.points[0];
    const [x1, y1] = loop.points[loop.points.length - 1];
    expect(y0).toBeCloseTo(from.y - from.h / 2);
    expect(y1).toBeCloseTo(to.y + to.h / 2);
    expect(Math.abs(x0 - from.x)).toBeLessThan(from.w / 2);
    expect(Math.abs(x1 - to.x)).toBeLessThan(to.w / 2);
  });

  it('lays out left to right with the same ranks', () => {
    const lr = layoutFlow(nodes, edges, { direction: 'LR', rankGap: 40, nodeGap: 20 });
    expect(lr.nodes.get('end')!.x).toBeGreaterThan(lr.nodes.get('start')!.x);
    expect(lr.width).toBeGreaterThan(lr.height);
  });
});

describe('swimlanes and orthogonal routing', () => {
  const lane: Record<string, string> = { start: 'A', check: 'B', retry: 'A', ok: 'C', end: 'C', cancel: 'B', far: 'A' };
  const nodes = Object.keys(lane).map((id) => ({ ...box(id), lane: lane[id] }));
  const edges = [
    { from: 'start', to: 'check' },
    { from: 'check', to: 'ok' },
    { from: 'check', to: 'retry' },
    { from: 'retry', to: 'check' }, // loop
    { from: 'retry', to: 'cancel' },
    { from: 'ok', to: 'end' },
    { from: 'start', to: 'far' },
    { from: 'start', to: 'end' }, // long edge
    { from: 'far', to: 'end' },
    { from: 'end', to: 'end' }, // self-loop
  ];

  /** Does the run a-b pass through the inside of a box (1 px tolerance on its outline)? */
  const crosses = (a: [number, number], b: [number, number], n: { x: number; y: number; w: number; h: number }) =>
    Math.max(a[0], b[0]) > n.x - n.w / 2 + 1 && Math.min(a[0], b[0]) < n.x + n.w / 2 - 1 &&
    Math.max(a[1], b[1]) > n.y - n.h / 2 + 1 && Math.min(a[1], b[1]) < n.y + n.h / 2 - 1;

  for (const direction of ['LR', 'TB'] as const) {
    for (const withLanes of [true, false]) {
      describe(`${direction}${withLanes ? ', lanes' : ''}`, () => {
        const laned = withLanes ? layoutLanes(nodes, edges, { direction, rankGap: 56, nodeGap: 28, order: ['C', 'A'] }) : undefined;
        const l = laned ?? layoutFlow(nodes, edges, { direction, rankGap: 56, nodeGap: 28 });
        const routes = routeOrthogonal(l.nodes, edges, {
          direction,
          bounds: laned ? [6, (direction === 'TB' ? laned.width : laned.height) - 6] : undefined,
        });

        if (laned) {
          it('orders lanes as asked, then by appearance, and keeps every node inside its lane', () => {
            expect(laned.lanes.map((x) => x.name)).toEqual(['C', 'A', 'B']);
            for (const n of nodes) {
              const p = laned.nodes.get(n.id)!;
              const band = laned.lanes.find((x) => x.name === n.lane)!;
              const [c, half] = direction === 'TB' ? [p.x, p.w / 2] : [p.y, p.h / 2];
              expect(c - half).toBeGreaterThanOrEqual(band.start);
              expect(c + half).toBeLessThanOrEqual(band.start + band.size);
              // Clear of the header strip.
              expect(direction === 'TB' ? p.y - p.h / 2 : p.x - p.w / 2).toBeGreaterThan(laned.header);
            }
          });
          it('keeps boxes of a lane apart', () => {
            const list = [...laned.nodes.values()];
            for (const a of list) for (const b of list) if (a !== b) expect(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2).toBe(true);
          });
        }

        it('draws only horizontal and vertical runs', () => {
          for (const r of routes) for (let k = 0; k < r.length - 1; k++) expect(Math.min(Math.abs(r[k][0] - r[k + 1][0]), Math.abs(r[k][1] - r[k + 1][1]))).toBeLessThan(1e-6);
        });

        it('never runs through a box', () => {
          for (const [i, r] of routes.entries()) {
            expect(r.length).toBeGreaterThanOrEqual(2);
            for (let k = 0; k < r.length - 1; k++) for (const [id, n] of l.nodes) expect(crosses(r[k], r[k + 1], n), `edge ${i} through ${id}`).toBe(false);
          }
        });

        it('leaves the source on its far side and enters the target on its near side', () => {
          for (const [i, e] of edges.entries()) {
            if (e.from === e.to) continue;
            const a = l.nodes.get(e.from)!;
            const b = l.nodes.get(e.to)!;
            const [p0, p1] = [routes[i][0], routes[i][routes[i].length - 1]];
            if (direction === 'TB') {
              expect(p0[1]).toBeCloseTo(a.y + a.h / 2);
              expect(p1[1]).toBeCloseTo(b.y - b.h / 2);
            } else {
              expect(p0[0]).toBeCloseTo(a.x + a.w / 2);
              expect(p1[0]).toBeCloseTo(b.x - b.w / 2);
            }
          }
        });

        it('gives each link its own port on a box', () => {
          const seen = new Map<string, number[]>();
          for (const [i, e] of edges.entries()) {
            if (e.from === e.to) continue;
            const c = direction === 'TB' ? 0 : 1;
            for (const [key, v] of [[`out:${e.from}`, routes[i][0][c]], [`in:${e.to}`, routes[i][routes[i].length - 1][c]]] as const) {
              for (const other of seen.get(key) ?? []) expect(Math.abs(other - v)).toBeGreaterThan(4);
              seen.set(key, [...(seen.get(key) ?? []), v]);
            }
          }
        });
      });
    }
  }
});
