import { describe, expect, it } from 'vitest';
import { Table } from '../src/data/table';
import { applyTransform } from '../src/data/transforms';
import { squarify } from '../src/marks/charts';

const col = (t: Table, f: string) => Array.from(t.column(f).values as ArrayLike<number | string>);

describe('transforms', () => {
  it('bin counts every value once, with empty bins kept per group', () => {
    const t = Table.from([
      { v: 1, g: 'a' }, { v: 2, g: 'a' }, { v: 9, g: 'a' }, { v: 5, g: 'b' },
    ]);
    const out = applyTransform(t, { type: 'bin', field: 'v', step: 5, groupby: ['g'] });
    expect(col(out, 'bin_start')).toEqual([0, 5, 0, 5]);
    expect(col(out, 'count')).toEqual([2, 1, 0, 1]);
    expect(col(out, 'g')).toEqual(['a', 'a', 'b', 'b']);
  });

  it('aggregate supports sum, mean, count and median', () => {
    const t = Table.from([{ k: 'x', v: 1 }, { k: 'x', v: 3 }, { k: 'y', v: 10 }]);
    const out = applyTransform(t, {
      type: 'aggregate',
      groupby: ['k'],
      ops: [{ op: 'sum', field: 'v', as: 'sum' }, { op: 'mean', field: 'v', as: 'mean' }, { op: 'count', as: 'n' }, { op: 'median', field: 'v', as: 'med' }],
    });
    expect(col(out, 'sum')).toEqual([4, 10]);
    expect(col(out, 'mean')).toEqual([2, 10]);
    expect(col(out, 'n')).toEqual([2, 1]);
    expect(col(out, 'med')).toEqual([2, 10]);
  });

  it('boxplot quartiles and Tukey whiskers exclude outliers', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8, 100].map((v) => ({ v }));
    const out = applyTransform(Table.from(rows), { type: 'boxplot', field: 'v' });
    expect(col(out, 'median')).toEqual([5]);
    expect(col(out, 'q1')).toEqual([3]);
    expect(col(out, 'q3')).toEqual([7]);
    expect(col(out, 'upper')).toEqual([8]);
    expect(col(out, 'lower')).toEqual([1]);
  });

  it('waterfall keeps a running total, resets on totals and appends the final total', () => {
    const t = Table.from([{ s: 'A', v: 10 }, { s: 'B', v: -4 }, { s: 'Sub', v: 0 }, { s: 'C', v: 2 }]);
    const out = applyTransform(t, { type: 'waterfall', field: 'v', label: 's', totals: ['Sub'], total: 'End' });
    expect(col(out, 'start')).toEqual([0, 10, 0, 6, 0]);
    expect(col(out, 'end')).toEqual([10, 6, 6, 8, 8]);
    expect(col(out, 'kind')).toEqual(['increase', 'decrease', 'total', 'increase', 'total']);
  });

  it('sort orders rows and keeps every column', () => {
    const out = applyTransform(Table.from([{ k: 'a', v: 2 }, { k: 'b', v: 9 }, { k: 'c', v: 5 }]), { type: 'sort', field: 'v', order: 'desc' });
    expect(col(out, 'k')).toEqual(['b', 'c', 'a']);
  });

  it('regression fits a straight line exactly', () => {
    const rows = [0, 1, 2, 3].map((x) => ({ x, y: 2 * x + 1 }));
    const out = applyTransform(Table.from(rows), { type: 'regression', x: 'x', y: 'y' });
    expect(col(out, 'x')).toEqual([0, 3]);
    expect(col(out, 'y')).toEqual([1, 7]);
  });
});

describe('squarify', () => {
  it('tiles the box exactly, with areas proportional to values', () => {
    const items = [6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ value, id: i }));
    const tiles = squarify(items, { x: 0, y: 0, w: 6, h: 4 });
    const area = tiles.reduce((a, t) => a + t.w * t.h, 0);
    expect(area).toBeCloseTo(24);
    for (const t of tiles) expect(t.w * t.h).toBeCloseTo(t.value);
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(6 + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(4 + 1e-9);
    }
  });
});
