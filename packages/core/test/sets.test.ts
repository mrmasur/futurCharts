import { describe, expect, it } from 'vitest';
import { parsetsLayout, type ParsetsRow } from '../src/marks/sets';
import { bundleLayout } from '../src/marks/setsBundle';
import { setNames, upsetData, upsetLayout } from '../src/marks/setsUpset';

describe('parallel sets layout', () => {
  const rows: ParsetsRow[] = [
    { cats: ['Web', 'Basic', 'Kept'], color: 'Web', value: 30, row: 0 },
    { cats: ['Web', 'Basic', 'Lost'], color: 'Web', value: 10, row: 1 },
    { cats: ['Web', 'Pro', 'Kept'], color: 'Web', value: 20, row: 2 },
    { cats: ['Shop', 'Basic', 'Kept'], color: 'Shop', value: 15, row: 3 },
    { cats: ['Shop', 'Pro', 'Lost'], color: 'Shop', value: 25, row: 4 },
    { cats: ['Shop', 'Pro', 'Lost'], color: 'Shop', value: 5, row: 5 },
  ];
  const lay = parsetsLayout(rows, 600, 300, { nodeWidth: 12, nodePadding: 10 });

  it('gives every column the same total, at the same scale', () => {
    expect(lay.total).toBe(105);
    expect(lay.columns).toHaveLength(3);
    const heights = lay.columns.map((c) => c.cats.reduce((a, e) => a + (e.y1 - e.y0), 0));
    expect(heights[1]).toBeCloseTo(heights[0], 6);
    expect(heights[2]).toBeCloseTo(heights[0], 6);
    expect(lay.columns[0].cats.map((c) => [c.name, c.value])).toEqual([['Web', 60], ['Shop', 45]]);
    expect(lay.columns[2].cats.map((c) => [c.name, c.value])).toEqual([['Kept', 65], ['Lost', 40]]);
  });

  it('keeps categories apart and inside the box', () => {
    for (const col of lay.columns) {
      col.cats.forEach((c, i) => {
        expect(c.y0).toBeGreaterThanOrEqual(-1e-9);
        expect(c.y1).toBeLessThanOrEqual(300 + 1e-9);
        if (i) expect(c.y0).toBeGreaterThan(col.cats[i - 1].y1);
      });
    }
    expect(lay.columns[0].x0).toBe(0);
    expect(lay.columns[2].x1).toBeCloseTo(600, 6);
  });

  it('merges identical combinations and stacks the bands without gap or overlap', () => {
    // 5 distinct combinations, between 2 pairs of columns.
    expect(lay.ribbons).toHaveLength(10);
    for (let d = 0; d < 2; d++) {
      const bands = lay.ribbons.filter((r) => r.col === d);
      lay.columns[d].cats.forEach((cat, s) => {
        const mine = bands.filter((b) => b.source === s).sort((a, b) => a.sy - b.sy);
        let y = cat.y0;
        for (const b of mine) {
          expect(b.sy).toBeCloseTo(y, 6);
          y += b.height;
        }
        expect(y).toBeCloseTo(cat.y1, 6);
      });
      lay.columns[d + 1].cats.forEach((cat, t) => {
        const mine = bands.filter((b) => b.target === t).sort((a, b) => a.ty - b.ty);
        let y = cat.y0;
        for (const b of mine) {
          expect(b.ty).toBeCloseTo(y, 6);
          y += b.height;
        }
        expect(y).toBeCloseTo(cat.y1, 6);
      });
    }
  });

  it('keeps the bands of one pair of categories together on both sides', () => {
    const more: ParsetsRow[] = [
      { cats: ['a', 'x'], color: 'red', value: 1, row: 0 },
      { cats: ['b', 'x'], color: 'red', value: 1, row: 1 },
      { cats: ['a', 'x'], color: 'blue', value: 1, row: 2 },
      { cats: ['a', 'y'], color: 'red', value: 1, row: 3 },
    ];
    const l = parsetsLayout(more, 100, 100, { nodeWidth: 10, nodePadding: 0 });
    const pair = l.ribbons.filter((r) => r.source === 0 && r.target === 0);
    expect(pair.map((p) => p.color)).toEqual(['red', 'blue']);
    expect(pair[1].sy).toBeCloseTo(pair[0].sy + pair[0].height, 6);
    expect(pair[1].ty).toBeCloseTo(pair[0].ty + pair[0].height, 6);
  });

  it('sorts categories by size on demand and leaves room for margins', () => {
    const l = parsetsLayout(rows, 600, 300, { nodeWidth: 12, nodePadding: 10, sort: 'value', top: 20, left: 50, right: 40 });
    expect(l.columns[1].cats.map((c) => c.name)).toEqual(['Basic', 'Pro']);
    expect(l.columns[2].cats.map((c) => c.name)).toEqual(['Kept', 'Lost']);
    expect(l.columns[0].x0).toBe(50);
    expect(l.columns[2].x1).toBeCloseTo(560, 6);
    expect(Math.min(...l.columns.flatMap((c) => c.cats.map((e) => e.y0)))).toBeGreaterThanOrEqual(20);
  });
});

describe('upset data', () => {
  it('reads the key syntax of venn', () => {
    expect(setNames('A&B')).toEqual(['A', 'B']);
    expect(setNames('A ∩ B, C')).toEqual(['A', 'B', 'C']);
    expect(setNames('A&A')).toEqual(['A']);
  });

  it('sums distinct intersections into set sizes, largest first', () => {
    const keys = ['A', 'B', 'A&B', 'B&A', 'C&A&B', 'C'];
    const d = upsetData(keys, [10, 4, 3, 2, 1, 0]);
    expect(d.sets).toEqual([{ name: 'A', size: 16 }, { name: 'B', size: 10 }, { name: 'C', size: 1 }]);
    expect(d.combos.map((c) => [c.key, c.value])).toEqual([['A', 10], ['A&B', 5], ['B', 4], ['A&B&C', 1]]);
    expect(d.combos[3].members).toEqual([0, 1, 2]);
    expect(d.total).toBe(20);
  });

  it('counts rows when there is no value', () => {
    const d = upsetData(['A&B', 'A', 'A&B', 'B', 'A&B'], undefined, { sort: 'degree' });
    expect(d.combos.map((c) => [c.key, c.value])).toEqual([['A', 1], ['B', 1], ['A&B', 3]]);
    expect(d.sets).toEqual([{ name: 'A', size: 4 }, { name: 'B', size: 4 }]);
  });

  it('turns inclusive sizes (venn data) into exclusive ones', () => {
    // 100 in A, 80 in B, 60 in C; 30 in A and B, 20 in A and C, 10 in B and C; 5 in all three.
    const d = upsetData(['A', 'B', 'C', 'A&B', 'A&C', 'B&C', 'A&B&C'], [100, 80, 60, 30, 20, 10, 5], { mode: 'inclusive', sort: 'data', sortSets: 'data' });
    const value = Object.fromEntries(d.combos.map((c) => [c.key, c.value]));
    expect(value).toEqual({ A: 55, B: 45, C: 35, 'A&B': 25, 'A&C': 15, 'B&C': 5, 'A&B&C': 5 });
    expect(d.sets.map((s) => s.size)).toEqual([100, 80, 60]);
    expect(d.total).toBe(185);
  });
});

describe('upset layout', () => {
  it('shares the width between set bars, names and columns', () => {
    const g = upsetLayout(5, 12, 700, 360, 80, 140);
    expect(g.shown).toBe(12);
    expect(g.matrixLeft - g.barsLeft).toBeCloseTo(220, 6);
    expect(g.matrixRight).toBeLessThanOrEqual(700 + 1e-9);
    expect(g.colWidth).toBeLessThanOrEqual(46);
    expect(g.matrixTop + g.rowHeight * 5).toBeCloseTo(358, 6);
    expect(g.barBottom).toBeLessThan(g.matrixTop);
    expect(g.barTop).toBeLessThan(g.barBottom);
  });
  it('drops the columns that do not fit a narrow chart', () => {
    const g = upsetLayout(6, 40, 320, 200, 70, 44);
    expect(g.shown).toBeLessThan(40);
    expect(g.colWidth).toBeGreaterThanOrEqual(13);
    expect(g.matrixRight).toBeLessThanOrEqual(320 + 1e-9);
    expect(upsetLayout(6, 40, 320, 200, 70, 44, 5).shown).toBe(5);
  });
});

describe('edge bundling layout', () => {
  const nodes = [
    { id: 'a1', path: ['A'] }, { id: 'a2', path: ['A'] }, { id: 'a3', path: ['A'] },
    { id: 'b1', path: ['B'] }, { id: 'b2', path: ['B'] },
    { id: 'c1', path: ['C', 'x'] }, { id: 'c2', path: ['C', 'y'] },
  ];
  const lay = bundleLayout(nodes, { tension: 0.85, groupGap: 1 });

  it('puts leaves around the circle in hierarchy order, groups apart', () => {
    expect(lay.leaves.map((l) => l.id)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c2']);
    const step = lay.leaves[0].a1 - lay.leaves[0].a0;
    // 7 leaves + 3 gaps between groups + half a gap between the sub-groups of C.
    expect(step).toBeCloseTo((Math.PI * 2) / 10.5, 9);
    expect(lay.leaves[1].a0).toBeCloseTo(lay.leaves[0].a1, 9);
    expect(lay.leaves[3].a0 - lay.leaves[2].a1).toBeCloseTo(step, 9);
    expect(lay.leaves[6].a0 - lay.leaves[5].a1).toBeCloseTo(step / 2, 9);
    expect(lay.leaves[0].a0).toBeCloseTo(step / 2, 9);
    expect(lay.leaves[6].a1).toBeCloseTo(Math.PI * 2 - step / 2, 9);
    expect(lay.leaves[5].top).toBe('C');
  });

  it('draws a link from leaf to leaf, inside the circle', () => {
    const c = lay.curve('a1', 'b2');
    const n = c.length / 2;
    const a = lay.leaves[0].angle;
    const b = lay.leaves[4].angle;
    expect(c[0]).toBeCloseTo(Math.sin(a), 9);
    expect(c[1]).toBeCloseTo(Math.cos(a), 9);
    expect(c[2 * n - 2]).toBeCloseTo(Math.sin(b), 9);
    expect(c[2 * n - 1]).toBeCloseTo(Math.cos(b), 9);
    for (let i = 0; i < n; i++) expect(Math.hypot(c[2 * i], c[2 * i + 1])).toBeLessThanOrEqual(1 + 1e-9);
    expect(lay.curve('a1', 'nope')).toHaveLength(0);
  });

  it('bends more with more tension', () => {
    const middle = (tension: number) => {
      const c = bundleLayout(nodes, { tension }).curve('a1', 'a3');
      const m = Math.floor(c.length / 4) * 2;
      return Math.hypot(c[m], c[m + 1]);
    };
    // Without tension, the chord between the two leaves; bundled, it dips towards the group node.
    expect(middle(0)).toBeCloseTo(Math.cos(lay.leaves[1].angle - lay.leaves[0].angle), 6);
    expect(middle(1)).toBeLessThan(middle(0.5));
    expect(middle(0.5)).toBeLessThan(middle(0));
  });

  it('accepts a flat list (no group): no gap, links through the center', () => {
    const flat = bundleLayout([{ id: 'p', path: [] }, { id: 'q', path: [] }, { id: 'r', path: [] }, { id: 's', path: [] }]);
    expect(flat.leaves[1].a0).toBeCloseTo(flat.leaves[0].a1, 9);
    expect(flat.leaves[0].a0).toBe(0);
    const c = flat.curve('p', 'r');
    const m = Math.floor(c.length / 4) * 2;
    expect(Math.hypot(c[m], c[m + 1])).toBeLessThan(0.5);
  });
});
