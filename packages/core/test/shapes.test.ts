import { describe, expect, it } from 'vitest';
import { annotationRaw } from '../src/chart/annotations';
import { Table } from '../src/data/table';
import { prepareLayer } from '../src/marks/prepare';
import { dashed } from '../src/marks/primitives';
import { lens, vennLayout } from '../src/marks/shapes';

const ctx = () => ({ band: false, horizontal: false, categories: new Map<string, number>(), fields: {}, hidden: new Set<string>() });

describe('missing values', () => {
  const rows = [
    { x: 1, y: 10 },
    { x: 2, y: null },
    { x: 3, y: 12 },
    { x: 4, y: 13 },
  ];
  it('break the line where a value is missing', () => {
    const d = prepareLayer({ mark: 'line', encode: { x: 'x', y: 'y' } }, 0, Table.from(rows), ctx());
    expect([...d.series[0].x]).toEqual([1, 3, 4]);
    expect([...d.series[0].breaks!]).toEqual([0, 1, 0]);
  });
  it('are joined over with connectNulls', () => {
    const d = prepareLayer({ mark: 'line', encode: { x: 'x', y: 'y' }, style: { connectNulls: true } }, 0, Table.from(rows), ctx());
    expect(d.series[0].breaks).toBeUndefined();
  });
});

describe('dashes', () => {
  it('cut a segment into on / off runs measured in px, carried across segments', () => {
    const out: number[] = [];
    // 1 scale unit = 100 px on both axes.
    const pen = dashed(out, [6, 4], [0.01, 0.01], [0, 0, 0, 1], 2);
    pen.segment(0, 0, 0.15, 0); // 15 px: dash 0-6, gap, dash 10-15 (cut)
    pen.segment(0.15, 0, 0.3, 0); // continues: 15-16 still on, then gap 16-20, dash 20-26…
    const dashes = [];
    for (let i = 0; i < out.length; i += 9) dashes.push([Math.round(out[i] * 100), Math.round(out[i + 2] * 100)]);
    expect(dashes).toEqual([[0, 6], [10, 15], [15, 16], [20, 26]]);
  });
});

describe('annotations', () => {
  it('read numbers, dates and categories', () => {
    const cats = new Map([['B', 1]]);
    expect(annotationRaw(12, false, cats)).toBe(12);
    expect(annotationRaw('2024-01-01T00:00:00Z', false, cats)).toBe(Date.UTC(2024, 0, 1));
    expect(annotationRaw('B', true, cats)).toBe(1);
    expect(annotationRaw('42', false, cats)).toBe(42);
  });
});

describe('venn', () => {
  it('overlaps circles by the intersection area', () => {
    const t = Table.from([
      { k: 'A', v: 100 },
      { k: 'B', v: 60 },
      { k: 'A&B', v: 20 },
    ]);
    const { circles, sets } = vennLayout(t, 'k', 'v');
    expect(sets).toEqual(['A', 'B']);
    const [a, b] = circles;
    // Areas keep their ratio, and the lens holds the intersection's share of A.
    expect((b.r / a.r) ** 2).toBeCloseTo(0.6, 3);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    expect(lens(a.r, b.r, d) / (Math.PI * a.r * a.r)).toBeCloseTo(0.2, 3);
  });
});

describe('density', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ v: 50 + ((i % 20) - 9.5) * 2 }));
  it('fits a normal law whose area is 1', async () => {
    const { applyTransforms } = await import('../src/data/transforms');
    const t = applyTransforms(Table.from(rows), [{ type: 'density', field: 'v', method: 'normal', steps: 400 }]);
    const x = t.column('v').values as Float64Array;
    const d = t.column('density').values as Float64Array;
    let area = 0;
    for (let i = 1; i < t.length; i++) area += ((d[i] + d[i - 1]) / 2) * (x[i] - x[i - 1]);
    expect(area).toBeCloseTo(0.997, 2);
    // Peak at the mean.
    expect(x[d.indexOf(Math.max(...d))]).toBeCloseTo(50, 0);
  });
  it('scales to counts with the histogram step', async () => {
    const { applyTransforms } = await import('../src/data/transforms');
    const a = applyTransforms(Table.from(rows), [{ type: 'density', field: 'v' }]);
    const b = applyTransforms(Table.from(rows), [{ type: 'density', field: 'v', step: 5 }]);
    const da = a.column('density').values as Float64Array;
    const db = b.column('density').values as Float64Array;
    expect(db[50] / da[50]).toBeCloseTo(200 * 5, 6);
  });
});

describe('sync groups', () => {
  it('reach every other member, not the sender, and forget members that leave', async () => {
    const { joinGroup, leaveGroup, broadcast } = await import('../src/chart/sync');
    const got: string[] = [];
    const member = (name: string) => ({ syncHover: (x: number | null) => got.push(`${name}:${x}`), syncRange: () => {} });
    const a = member('a'), b = member('b'), c = member('c');
    for (const m of [a, b, c]) joinGroup('g', m);
    broadcast('g', a, (m) => m.syncHover(5));
    expect(got.sort()).toEqual(['b:5', 'c:5']);
    leaveGroup('g', b);
    got.length = 0;
    broadcast('g', a, (m) => m.syncHover(null));
    expect(got).toEqual(['c:null']);
  });
});

describe('log scale', () => {
  it('keeps an explicit domain and adds 2 and 5 ticks over a short span', async () => {
    const { LogScale } = await import('../src/scale/scales');
    const s = new LogScale(1500, 30000, undefined, true);
    expect(s.norm(1500)).toBeCloseTo(0, 9);
    expect(s.norm(30000)).toBeCloseTo(1, 9);
    expect(s.ticks(0, 1).map((t) => Math.round(s.invert(t.t)))).toEqual([3000, 10000, 30000]);
    // Without exact, it widens to whole decades.
    const w = new LogScale(1500, 30000);
    expect(w.invert(0)).toBeCloseTo(1000, 6);
  });
});

describe('contours', () => {
  it('trace a closed ring around a peak, at the right level', async () => {
    const { contourSegments } = await import('../src/marks/advanced');
    const n = 21;
    const g = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = Math.hypot(i - 10, j - 10);
    const segs = contourSegments(g, n, n, 5);
    expect(segs.length).toBeGreaterThan(40);
    // Every crossing point lies on the circle of radius 5 (within interpolation error).
    for (let k = 0; k < segs.length; k += 2) expect(Math.abs(Math.hypot(segs[k] - 10, segs[k + 1] - 10) - 5)).toBeLessThan(0.1);
  });
});
