import { describe, expect, it } from 'vitest';
import {
  butterflyColumns,
  likertColors,
  likertRow,
  rankItems,
  rowBands,
  rowTable,
  staggerLabels,
  tornadoAmplitude,
  tornadoOrder,
  variwideColumns,
} from '../src/marks/compareLayout';
import { COMPARE_MARKS } from '../src/marks/compare';
import type { RGBA } from '../src/render/types';

describe('rows of bars', () => {
  it('center the rows that do not need the whole height', () => {
    const b = rowBands({ height: 400, rows: 4, maxThickness: 24, spacing: 16 });
    expect(b.rowH).toBe(40);
    expect(b.thickness).toBe(24);
    expect(b.top).toBe(120);
    expect(b.barTop).toBe(8);
  });
  it('never overflow the box, title strip, footer and header included', () => {
    for (const rows of [3, 9, 20]) {
      const b = rowBands({ height: 180, rows, above: 22, below: 18, header: 17, maxThickness: 26 });
      expect(b.top).toBeGreaterThanOrEqual(22);
      expect(b.top + b.rowH * rows).toBeLessThanOrEqual(180 - 18 + 1e-9);
      expect(b.barTop).toBeGreaterThanOrEqual(17);
      expect(b.barTop + b.thickness).toBeLessThanOrEqual(Math.max(b.rowH, 17 + 2) + 1e-9);
    }
  });
  it('shrink the space between rows before the bars', () => {
    const roomy = rowBands({ height: 400, rows: 10, maxThickness: 24, spacing: 16 });
    const tight = rowBands({ height: 280, rows: 10, maxThickness: 24, spacing: 16 });
    expect(roomy.thickness).toBe(24);
    expect(tight.rowH).toBe(28);
    expect(tight.thickness).toBeGreaterThan(18);
  });
});

describe('table of rows', () => {
  const base = { height: 320, rows: 6, nameWidth: 150, maxThickness: 24 };
  it('puts the names beside the bars on a wide chart', () => {
    const t = rowTable({ ...base, width: 760, lead: 30, after: 90 });
    expect(t.stacked).toBe(false);
    expect([t.x0, t.x1]).toEqual([180, 670]);
    expect(t.nameWidth).toBe(150);
  });
  it('puts them above the bars when the bars would be too short', () => {
    const t = rowTable({ ...base, width: 311, after: 90 });
    expect(t.stacked).toBe(true);
    expect([t.x0, t.x1]).toEqual([0, 311]);
    expect(t.bands.barTop).toBeGreaterThanOrEqual(17);
  });
  it('goes back beside the bars, with a narrower name column, rather than draw hairlines', () => {
    const t = rowTable({ ...base, width: 311, height: 130, rows: 7, after: 80 });
    expect(t.stacked).toBe(false);
    expect(t.nameWidth).toBeLessThan(150);
    expect(t.x1 - t.x0).toBeGreaterThanOrEqual(60);
    expect(t.bands.thickness).toBeGreaterThanOrEqual(7);
  });
});

describe('likert', () => {
  it('centers an odd scale on the middle of the neutral answer', () => {
    const r = likertRow([10, 20, 20, 30, 20]);
    expect(r.total).toBe(100);
    expect(r.segments.map((s) => s.level)).toEqual([0, 1, 2, 3, 4]);
    expect(r.segments.map((s) => +s.from.toFixed(4))).toEqual([-0.4, -0.3, -0.1, 0.1, 0.4]);
    expect(r.segments[4].to).toBeCloseTo(0.6);
    expect(r.left).toBeCloseTo(0.4);
    expect(r.right).toBeCloseTo(0.6);
    expect(r.negative).toBeCloseTo(0.3);
    expect(r.positive).toBeCloseTo(0.5);
    expect(r.neutral).toBeCloseTo(0.2);
  });
  it('splits an even scale exactly in the middle', () => {
    const r = likertRow([5, 15, 50, 30]);
    expect(r.neutral).toBe(0);
    expect(r.segments.map((s) => s.level)).toEqual([0, 1, 2, 3]);
    expect(r.segments[1].to).toBe(0);
    expect(r.segments[2].from).toBe(0);
    expect(r.left).toBeCloseTo(0.2);
    expect(r.right).toBeCloseTo(0.8);
  });
  it('takes the neutral answer out of the stack when it is set aside', () => {
    const r = likertRow([10, 20, 20, 30, 20], 'aside');
    expect(r.segments.map((s) => s.level)).toEqual([0, 1, 3, 4]);
    expect(r.left).toBeCloseTo(0.3);
    expect(r.right).toBeCloseTo(0.5);
    expect(r.neutral).toBeCloseTo(0.2);
  });
  it('keeps segments contiguous and their widths equal to the shares', () => {
    const r = likertRow([7, 0, 13, 41, 9, 22, 8]);
    for (let i = 1; i < r.segments.length; i++) expect(r.segments[i].from).toBeCloseTo(r.segments[i - 1].to);
    for (const s of r.segments) expect(s.to - s.from).toBeCloseTo(s.share);
    expect(r.negative + r.neutral + r.positive).toBeCloseTo(1);
  });
  it('keeps the shares of the remaining answers when one is hidden', () => {
    const r = likertRow([10, 20, 20, 30, 20], 'center', [true]);
    expect(r.negative).toBeCloseTo(0.2);
    expect(r.left).toBeCloseTo(0.3);
    expect(r.positive).toBeCloseTo(0.5);
  });
  it('survives rows without answers and bad values', () => {
    expect(likertRow([0, 0, 0]).total).toBe(0);
    expect(likertRow([NaN, -4, 6]).positive).toBe(1);
    expect(likertRow([]).segments).toEqual([]);
  });
  it('fades the colors towards the middle of the scale', () => {
    const neg: RGBA = [1, 0, 0, 1];
    const pos: RGBA = [0, 0, 1, 1];
    const grey: RGBA = [0.5, 0.5, 0.5, 1];
    const white: RGBA = [1, 1, 1, 1];
    const c = likertColors(5, neg, pos, grey, white);
    expect(c[0]).toEqual(neg);
    expect(c[4]).toEqual(pos);
    expect(c[2]).toEqual(grey);
    // The mild answers sit between the full hue and the surface.
    expect(c[1][1]).toBeGreaterThan(0.3);
    expect(c[1][1]).toBeLessThan(0.8);
    expect(c[3][0]).toBeCloseTo(c[1][1]);
    expect(likertColors(4, neg, pos, grey, white).map((x) => x[3])).toEqual([1, 1, 1, 1]);
    expect(likertColors(2, neg, pos, grey, white)).toEqual([neg, pos]);
  });
});

describe('tornado', () => {
  it('measures a butterfly row by the sum of both sides', () => {
    expect(tornadoAmplitude({ left: 30, right: 12 })).toBe(42);
    expect(tornadoAmplitude({ left: NaN, right: 12 })).toBe(12);
  });
  it('measures a sensitivity row by the span around the base', () => {
    expect(tornadoAmplitude({ left: 6, right: 19 }, 12)).toBe(13);
    // Both outcomes on the same side of the base: the span still starts at the base.
    expect(tornadoAmplitude({ left: 14, right: 19 }, 12)).toBe(7);
    expect(tornadoAmplitude({ left: 15, right: 9 }, 12)).toBe(6);
  });
  it('sorts from the widest row down and keeps the order of equal rows', () => {
    const rows = [
      { key: 'a', left: 11, right: 13 },
      { key: 'b', left: 6, right: 19 },
      { key: 'c', left: 13, right: 11 },
      { key: 'd', left: 15, right: 9 },
    ];
    expect(tornadoOrder(rows, 12).map((r) => r.key)).toEqual(['b', 'd', 'a', 'c']);
    expect(tornadoOrder(rows).map((r) => r.key)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('gives both sides the same reach around the names', () => {
    const c = butterflyColumns({ width: 760, nameWidth: 100, valueWidth: 40 });
    expect(c.stacked).toBe(false);
    expect(c.leftEnd - 40).toBeCloseTo(c.side);
    expect(760 - 40 - c.rightStart).toBeCloseTo(c.side);
    expect(c.rightStart - c.leftEnd).toBe(100);
  });
  it('moves the names above the bars when the sides get too short', () => {
    const c = butterflyColumns({ width: 300, nameWidth: 180, valueWidth: 44 });
    expect(c.stacked).toBe(true);
    expect(c.rightStart - c.leftEnd).toBeLessThan(6);
    expect(c.leftEnd - 44).toBeCloseTo(300 - 44 - c.rightStart);
  });
});

describe('variwide', () => {
  it('shares the width in proportion, gaps included', () => {
    const c = variwideColumns([1, 3, 2], 620, 10);
    expect(c[0]).toEqual({ x0: 0, x1: 100 });
    expect(c[1]).toEqual({ x0: 110, x1: 410 });
    expect(c[2].x0).toBe(420);
    expect(c[2].x1).toBeCloseTo(620);
  });
  it('gives no room to missing or negative widths', () => {
    const c = variwideColumns([2, NaN, -1, 2], 210, 10);
    expect(c[1].x1 - c[1].x0).toBe(0);
    expect(c[2].x1 - c[2].x0).toBe(0);
    expect(c[3].x1).toBeCloseTo(210);
  });
  it('drops a name on the next line when it would run into its neighbour', () => {
    const p = staggerLabels(
      [
        { center: 50, width: 60 },
        { center: 90, width: 60 },
        { center: 110, width: 60 },
        { center: 300, width: 60 },
      ],
      { levels: 2, min: 0, max: 400 },
    );
    expect(p.map((q) => q.level)).toEqual([0, 1, -1, 0]);
  });
  it('keeps names inside the chart', () => {
    const p = staggerLabels(
      [
        { center: 5, width: 80 },
        { center: 395, width: 80 },
      ],
      { levels: 2, min: 0, max: 400 },
    );
    expect(p[0]).toEqual({ level: 0, x: 40 });
    expect(p[1]).toEqual({ level: 0, x: 360 });
    expect(staggerLabels([{ center: 10, width: 500 }], { levels: 2, min: 0, max: 400 })[0].level).toBe(-1);
  });
});

describe('ranking', () => {
  const items = [
    { key: 'Lyon', value: 842, previous: 791, row: 0 },
    { key: 'Paris', value: 816, previous: 874, row: 1 },
    { key: 'Nantes', value: 574, previous: 472, row: 2 },
    { key: 'Lille', value: 601, previous: 612, row: 3 },
    { key: 'Brest', value: 120, previous: NaN, row: 4 },
  ];
  it('ranks by value and counts the places moved', () => {
    const r = rankItems(items);
    expect(r.map((d) => d.key)).toEqual(['Lyon', 'Paris', 'Lille', 'Nantes', 'Brest']);
    expect(r.map((d) => d.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(r.map((d) => d.move)).toEqual([1, -1, 0, 0, NaN]);
    expect(r[0].change).toBeCloseTo(51 / 791);
    expect(r[1].change).toBeCloseTo(-58 / 874);
  });
  it('marks a newcomer and leaves out rows without a value', () => {
    const r = rankItems([...items, { key: 'Fermé', value: NaN, previous: 500, row: 5 }]);
    expect(r).toHaveLength(5);
    expect(r[4].previousRank).toBeNaN();
    expect(r[4].change).toBeNaN();
    // The closed shop still held a rank before: the others moved up past it.
    expect(r.find((d) => d.key === 'Nantes')!.move).toBe(1);
  });
});

describe('comparison marks', () => {
  it('are standalone, rebuilt on resize, and registered under their spec names', () => {
    expect(Object.keys(COMPARE_MARKS).sort()).toEqual(['barInBar', 'barRank', 'likert', 'tornado', 'variwide']);
    for (const def of Object.values(COMPARE_MARKS)) {
      expect(def.standalone).toBe(true);
      expect(def.sizeDependent).toBe(true);
      expect(def.scales).toBeTypeOf('function');
    }
  });
});
