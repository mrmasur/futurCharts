import { describe, expect, it } from 'vitest';
import { cyclePanels, cyclePart, differenceAreas, fanBands, parseLevel, quantile, sparkColumns, splitSegment } from '../src/marks/series';
import { bumpLayout } from '../src/marks/seriesBump';

/** Signed area of flat x, y triangles. */
function area(tri: number[]): number {
  let a = 0;
  for (let i = 0; i < tri.length; i += 6) {
    a += Math.abs((tri[i + 2] - tri[i]) * (tri[i + 5] - tri[i + 1]) - (tri[i + 4] - tri[i]) * (tri[i + 3] - tri[i + 1])) / 2;
  }
  return a;
}

describe('difference chart', () => {
  it('keeps a segment whole when the series do not cross', () => {
    const { pieces, crossing } = splitSegment(0, 3, 1, 1, 4, 2);
    expect(crossing).toBeUndefined();
    expect(pieces).toHaveLength(1);
    expect(pieces[0].sign).toBe(1);
    expect(area(pieces[0].tri)).toBeCloseTo(2);
  });

  it('cuts a segment exactly where the series cross', () => {
    // a goes 0 → 4, b stays at 1: they meet at x = 0.25.
    const { pieces, crossing } = splitSegment(0, 0, 1, 1, 4, 1);
    expect(crossing![0]).toBeCloseTo(0.25);
    expect(crossing![1]).toBeCloseTo(1);
    expect(pieces.map((p) => p.sign)).toEqual([-1, 1]);
    expect(area(pieces[0].tri)).toBeCloseTo(0.125);
    expect(area(pieces[1].tri)).toBeCloseTo(1.125);
    // Every vertex of a piece is on its own side of the other series: no two-tone triangle.
    for (const p of pieces) {
      for (let i = 0; i < p.tri.length; i += 2) {
        expect(p.tri[i]).toBeGreaterThanOrEqual(p.sign > 0 ? 0.25 - 1e-9 : 0);
        expect(p.tri[i]).toBeLessThanOrEqual(p.sign > 0 ? 1 : 0.25 + 1e-9);
      }
    }
  });

  it('splits a whole pair of series into the area above and the area below', () => {
    const x = [0, 1, 2, 3, 4];
    const a = [2, 4, 1, 1, 5];
    const b = [3, 3, 3, 1, 1];
    const d = differenceAreas(x, a, b);
    expect(d.crossings.map((c) => c[0])).toEqual([0.5, expect.closeTo(1 + 1 / 3, 6)]);
    for (const [, cy] of d.crossings) expect(cy).toBeCloseTo(3);
    // ∫|a − b| split by sign, computed by hand.
    expect(area(d.above)).toBeCloseTo(0.25 + 1 / 6 + 2);
    expect(area(d.below)).toBeCloseTo(0.25 + 2 / 3 + 1);
  });

  it('ignores a stretch where both series are equal, and a touch is not a crossing', () => {
    expect(splitSegment(0, 2, 2, 1, 2, 2).pieces).toHaveLength(0);
    const touch = splitSegment(0, 2, 2, 1, 3, 2);
    expect(touch.crossing).toBeUndefined();
    expect(touch.pieces[0].sign).toBe(1);
  });
});

describe('fan chart', () => {
  it('interpolates quantiles between neighbours', () => {
    const v = [10, 20, 30, 40, 50];
    expect(quantile(v, 0)).toBe(10);
    expect(quantile(v, 0.5)).toBe(30);
    expect(quantile(v, 1)).toBe(50);
    expect(quantile(v, 0.1)).toBeCloseTo(14);
    expect(quantile(v, 0.9)).toBeCloseTo(46);
    expect(quantile([7], 0.3)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('reads quantile levels however the table writes them', () => {
    expect(parseLevel(0.1)).toBe(0.1);
    expect(parseLevel(90)).toBe(0.9);
    expect(parseLevel('p25')).toBe(0.25);
    expect(parseLevel('97,5 %')).toBeCloseTo(0.975);
    expect(parseLevel('Médiane')).toBe(0.5);
    expect(parseLevel('')).toBeNaN();
    expect(parseLevel(null)).toBeNaN();
  });

  it('nests intervals from the widest in, leaving the median out', () => {
    expect(fanBands([0.5, 0.9, 0.25, 0.1, 0.75])).toEqual([[0.1, 0.9], [0.25, 0.75]]);
    expect(fanBands([0.05, 0.95])).toEqual([[0.05, 0.95]]);
    // An unpaired level in the middle has no interval.
    expect(fanBands([0.1, 0.3, 0.9])).toEqual([[0.1, 0.9]]);
    expect(fanBands([0.5])).toEqual([]);
  });
});

describe('cycle plot', () => {
  it('finds the panel and the position of a date', () => {
    expect(cyclePart(Date.UTC(2024, 2, 15), 'month')).toEqual({ index: 2, order: 2024 });
    expect(cyclePart(Date.UTC(2024, 10, 1), 'quarter')).toEqual({ index: 3, order: 2024 });
    // 2026-11-23 is a Monday, the 29th a Sunday of the same week.
    const monday = cyclePart(Date.UTC(2026, 10, 23), 'weekday');
    const sunday = cyclePart(Date.UTC(2026, 10, 29), 'weekday');
    expect(monday.index).toBe(0);
    expect(sunday.index).toBe(6);
    expect(sunday.order).toBe(monday.order);
    expect(cyclePart(Date.UTC(2026, 10, 30), 'weekday').order).toBe(monday.order + 1);
    expect(cyclePart(Date.UTC(2026, 10, 23, 14), 'hour').index).toBe(14);
  });

  it('lays one panel per period, each year at the same place in every panel', () => {
    const rows = [];
    for (const year of [2022, 2023, 2024]) for (let m = 0; m < 12; m++) rows.push({ period: m, order: year, value: (m + 1) * 10 + (year - 2022) });
    // A month missing one year keeps the others where they are.
    const data = rows.filter((r) => !(r.period === 5 && r.order === 2022));
    const { panels, orders, lo, hi } = cyclePanels(data);
    expect(panels.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(orders).toEqual([2022, 2023, 2024]);
    expect(panels[0].lines[0].points.map((p) => p.t)).toEqual([0, 0.5, 1]);
    expect(panels[5].lines[0].points.map((p) => p.t)).toEqual([0.5, 1]);
    expect(panels[0].lines[0].mean).toBeCloseTo(11);
    expect(panels[5].lines[0].mean).toBeCloseTo(61.5);
    expect([lo, hi]).toEqual([10, 122]);
  });

  it('sums or averages rows of the same period and position, per series', () => {
    const rows = [
      { period: 0, order: 1, value: 4, series: 'a' },
      { period: 0, order: 1, value: 6, series: 'a' },
      { period: 0, order: 1, value: 1, series: 'b' },
      { period: 0, order: 2, value: NaN, series: 'a' },
    ];
    expect(cyclePanels(rows).panels[0].lines.map((l) => [l.key, l.points[0].value])).toEqual([['a', 10], ['b', 1]]);
    expect(cyclePanels(rows, 'mean').panels[0].lines[0].points[0].value).toBe(5);
    // A lone position sits in the middle of its panel.
    expect(cyclePanels(rows).panels[0].lines[0].points[0].t).toBe(0.5);
  });
});

describe('sparkline table', () => {
  const needs = { name: 130, value: 70, change: 76 };

  it('fills the width with aligned columns, in the order asked for', () => {
    const cols = sparkColumns(760, needs, ['value', 'change', 'spark', 'bar']);
    expect(cols.map((c) => c.id)).toEqual(['name', 'value', 'change', 'spark', 'bar']);
    expect(cols[0].x0).toBe(0);
    expect(cols[cols.length - 1].x1).toBeCloseTo(760);
    for (let i = 1; i < cols.length; i++) expect(cols[i].x0).toBeCloseTo(cols[i - 1].x1);
    const w = Object.fromEntries(cols.map((c) => [c.id, c.x1 - c.x0]));
    expect(w.value).toBe(70);
    expect(w.change).toBe(76);
    expect(w.spark).toBeGreaterThan(w.bar);
    expect(w.spark).toBeLessThanOrEqual(260);
    expect(w.name).toBeGreaterThanOrEqual(130);
  });

  it('gives up the bar, then the change, on a narrow screen', () => {
    expect(sparkColumns(311, needs, ['value', 'change', 'spark', 'bar']).map((c) => c.id)).toEqual(['name', 'value', 'change', 'spark']);
    expect(sparkColumns(240, needs, ['value', 'change', 'spark', 'bar']).map((c) => c.id)).toEqual(['name', 'value', 'spark']);
    for (const width of [240, 311, 420]) {
      const cols = sparkColumns(width, needs, ['value', 'change', 'spark', 'bar']);
      expect(cols[cols.length - 1].x1).toBeLessThanOrEqual(width + 1e-9);
      for (const c of cols) expect(c.x1 - c.x0).toBeGreaterThan(40);
    }
  });
});

describe('bump area', () => {
  it('stacks each step from the largest down, on one value scale', () => {
    const values = [
      [30, 20, 10],
      [10, 40, NaN],
    ];
    const gap = 0.05;
    const l = bumpLayout(values, gap);
    expect(l.rank).toEqual([[1, 2, 3], [2, 1, NaN]]);
    // The fullest step (60 + two gaps) fills the height.
    const unit = (1 - 2 * gap) / 60;
    expect(l.y1[0][0]).toBeCloseTo(1);
    expect(l.y0[0][2]).toBeCloseTo(0);
    values.forEach((step, s) => {
      step.forEach((v, e) => {
        if (Number.isNaN(v)) expect(l.y0[s][e]).toBeNaN();
        else expect(l.y1[s][e] - l.y0[s][e]).toBeCloseTo(v * unit);
      });
    });
    // The second step is shorter: centered, its largest on top, a gap between the two.
    expect(l.y1[1][1] + l.y0[1][0]).toBeCloseTo(1);
    expect(l.y0[1][1] - l.y1[1][0]).toBeCloseTo(gap);
  });
});
