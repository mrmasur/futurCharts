import { describe, expect, it } from 'vitest';
import { buildTree, circlePolygon, fitRows, indentedRows, pathKey, pointInPolygon, polygonArea, voronoiCells } from '../src/marks/hierarchyLayout';

/** Deterministic values, uneven on purpose (ratio of about 1 to 12). */
const sample = (n: number, k: number) => Array.from({ length: n }, (_, i) => 4 + ((i * 37 + k * 11) % 23) * 2 + (i % 3 === 0 ? 20 : 0));

describe('voronoi treemap', () => {
  const circle = circlePolygon(0, 0, 1);

  it('gives each value a cell of proportional area', () => {
    for (const n of [2, 3, 6, 9, 14]) {
      const values = sample(n, n);
      const total = values.reduce((a, b) => a + b, 0);
      const { cells, error } = voronoiCells(values, circle, 120);
      const area = polygonArea(circle);
      const worst = Math.max(...cells.map((c, i) => Math.abs(polygonArea(c) / area - values[i] / total) / (values[i] / total)));
      expect(worst).toBeLessThan(0.08);
      expect(error).toBeCloseTo(worst, 6);
      // The cells tile the circle.
      expect(cells.reduce((a, c) => a + polygonArea(c), 0)).toBeCloseTo(area, 6);
    }
  });

  it('stays under 8 % of error over two nested levels', () => {
    const groups = [sample(7, 1), sample(5, 2), sample(8, 3), sample(4, 4), sample(6, 5), sample(3, 6)];
    const sums = groups.map((g) => g.reduce((a, b) => a + b, 0));
    const total = sums.reduce((a, b) => a + b, 0);
    const area = polygonArea(circle);
    const top = voronoiCells(sums, circle, 120);
    groups.forEach((g, gi) => {
      const inner = voronoiCells(g, top.cells[gi], 120, gi + 2);
      inner.cells.forEach((c, i) => {
        const want = (g[i] / total) * area;
        expect(Math.abs(polygonArea(c) - want) / want).toBeLessThan(0.08);
        // Every leaf stays inside its parent.
        for (const [x, y] of c) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-9);
      });
    });
  });

  it('is deterministic and skips empty values', () => {
    const a = voronoiCells([5, 0, 3, 8], circle, 60);
    const b = voronoiCells([5, 0, 3, 8], circle, 60);
    expect(a.cells).toEqual(b.cells);
    expect(a.cells[1]).toEqual([]);
    expect(a.cells[0].length).toBeGreaterThan(2);
    expect(voronoiCells([4], circle).cells[0]).toHaveLength(circle.length);
    expect(pointInPolygon(circle, 0, 0)).toBe(true);
    expect(pointInPolygon(circle, 1.2, 0)).toBe(false);
  });
});

describe('indented tree', () => {
  const rows = [
    ['Ops', 'Cloud', 40],
    ['Ops', 'Licences', 25],
    ['Sales', 'Events', 30],
    ['Sales', 'Ads', 50],
    ['Sales', 'Travel', 10],
    ['Admin', '', 12],
    ['Admin', 'Void', 0],
  ] as const;
  const root = buildTree([rows.map((r) => r[0]), rows.map((r) => r[1])], rows.map((r) => r[2]));
  const names = (list: ReturnType<typeof indentedRows>) => list.map((r) => `${'  '.repeat(r.node.depth - 1)}${r.node.name}`);

  it('sums the leaves into subtotals', () => {
    expect(root.value).toBe(167);
    expect(root.children.map((c) => [c.name, c.value])).toEqual([['Ops', 65], ['Sales', 90], ['Admin', 12]]);
    // An empty level ends the branch; a row without value is left out.
    expect(root.children[2].children).toHaveLength(0);
  });

  it('lists a node, then its children, largest first', () => {
    expect(names(indentedRows(root, 'all'))).toEqual(['Sales', '  Ads', '  Events', '  Travel', 'Ops', '  Cloud', '  Licences', 'Admin']);
    expect(names(indentedRows(root, 'none'))).toEqual(['Sales', 'Ops', 'Admin']);
    expect(names(indentedRows(root, 'first'))).toEqual(['Sales', '  Ads', '  Events', '  Travel', 'Ops', 'Admin']);
    expect(names(indentedRows(root, 'all', {}, false))[0]).toBe('Ops');
  });

  it('folds and unfolds the nodes the reader clicked', () => {
    const toggled = { [pathKey(['Sales'])]: false, [pathKey(['Ops'])]: true };
    const list = indentedRows(root, 'first', toggled);
    expect(names(list)).toEqual(['Sales', 'Ops', '  Cloud', '  Licences', 'Admin']);
    expect(list.map((r) => r.open)).toEqual([false, true, false, false, false]);
    expect(list[2].top.name).toBe('Ops');
    // A leaf never opens.
    expect(indentedRows(root, 'all', { [pathKey(['Admin'])]: true }).find((r) => r.node.name === 'Admin')!.open).toBe(false);
  });

  it('cuts what does not fit and counts the rest', () => {
    const list = indentedRows(root, 'all');
    expect(fitRows(list, 8)).toEqual({ rows: list, more: 0 });
    const cut = fitRows(list, 5);
    expect(cut.rows).toHaveLength(4);
    expect(cut.more).toBe(4);
  });
});
