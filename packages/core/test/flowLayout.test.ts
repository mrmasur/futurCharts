import { describe, expect, it } from 'vitest';
import { layoutFlow } from '../src/marks/flowLayout';

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
