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
