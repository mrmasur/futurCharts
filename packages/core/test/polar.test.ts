import { describe, expect, it } from 'vitest';
import { angleTickCount, polarPath, polarPeriod, quietRay, spiralLayout, spiralTurns, thinRings } from '../src/marks/polar';

const TAU = Math.PI * 2;

describe('polar angle axis', () => {
  it('reads the cycle of evenly spaced values', () => {
    expect(polarPeriod(Array.from({ length: 24 }, (_, h) => h))).toEqual({ origin: 0, period: 24, cyclic: true });
    expect(polarPeriod([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toEqual({ origin: 1, period: 12, cyclic: true });
    const bearings = polarPeriod(Array.from({ length: 16 }, (_, k) => k * 22.5));
    expect(bearings.period).toBeCloseTo(360);
    expect(bearings.cyclic).toBe(true);
  });

  it('takes free values as degrees or hours, and anything else as an open range', () => {
    expect(polarPeriod([12, 187.5, 301, 359])).toEqual({ origin: 0, period: 360, cyclic: true });
    expect(polarPeriod([0.5, 13.2, 23.9, 7])).toEqual({ origin: 0, period: 24, cyclic: true });
    expect(polarPeriod([-40, 3, 900, 77])).toEqual({ origin: -40, period: 940, cyclic: false });
    expect(polarPeriod([10, 20], 100)).toEqual({ origin: 0, period: 100, cyclic: true });
  });

  it('cuts a cycle into whole steps', () => {
    expect(angleTickCount(24, 24)).toBe(24);
    expect(angleTickCount(24, 10)).toBe(8);
    expect(angleTickCount(24, 5)).toBe(4);
    expect(angleTickCount(360, 12)).toBe(12);
    expect(angleTickCount(360, 9)).toBe(8);
    expect(angleTickCount(12, 7)).toBe(6);
    // A week has no finer whole division than its seven days.
    expect(angleTickCount(7, 12)).toBe(7);
  });
});

describe('polar path', () => {
  const angles = Array.from({ length: 12 }, (_, k) => (TAU * k) / 12);

  it('keeps a constant radius on a circle when smoothed, and closes on its first point', () => {
    const p = polarPath(angles, angles.map(() => 0.7), { closed: true, smooth: true });
    expect(p.x.length).toBeGreaterThan(100);
    for (let i = 0; i < p.x.length; i++) expect(Math.hypot(p.x[i], p.y[i])).toBeCloseTo(0.7, 9);
    expect(p.x[p.x.length - 1]).toBeCloseTo(p.x[0], 9);
    expect(p.y[p.y.length - 1]).toBeCloseTo(p.y[0], 9);
    // Clockwise from 12 o'clock.
    expect(p.x[0]).toBeCloseTo(0);
    expect(p.y[0]).toBeCloseTo(0.7);
    expect(p.x[1]).toBeGreaterThan(0);
  });

  it('never overshoots the data when smoothed', () => {
    const radii = [0.2, 0.9, 0.3, 0.3, 1, 0.1, 0.5, 0.5, 0.5, 0.8, 0.25, 0.6];
    const p = polarPath(angles, radii, { closed: true, smooth: true });
    for (let i = 0; i < p.x.length; i++) {
      const r = Math.hypot(p.x[i], p.y[i]);
      expect(r).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(r).toBeLessThanOrEqual(1 + 1e-9);
    }
    // It goes through every data point.
    radii.forEach((r, k) => {
      const hit = p.x.some((x, i) => Math.abs(x - Math.sin(angles[k]) * r) < 1e-9 && Math.abs(p.y[i] - Math.cos(angles[k]) * r) < 1e-9);
      expect(hit).toBe(true);
    });
  });

  it('joins points with chords when not smoothed, open or closed', () => {
    const radii = angles.map((_, k) => 0.4 + 0.05 * k);
    expect(polarPath(angles, radii).x.length).toBe(12);
    expect(polarPath(angles, radii, { closed: true }).x.length).toBe(13);
  });

  it('samples two curves over the same angles alike (bands are meshed sample by sample)', () => {
    const a = polarPath(angles, angles.map((_, k) => 0.2 + 0.02 * k), { closed: true, smooth: true });
    const b = polarPath(angles, angles.map((_, k) => 0.9 - 0.03 * (k % 4)), { closed: true, smooth: true });
    expect(a.x.length).toBe(b.x.length);
    // Same ray, sample for sample.
    for (let i = 0; i < a.x.length; i += 7) expect(Math.atan2(a.x[i], a.y[i])).toBeCloseTo(Math.atan2(b.x[i], b.y[i]), 9);
  });
});

describe('spiral', () => {
  it('counts turns from the start of the first year, month for month', () => {
    const t = [Date.UTC(2022, 0, 1), Date.UTC(2022, 6, 2, 12), Date.UTC(2023, 0, 1), Date.UTC(2024, 11, 31)];
    const p = spiralTurns(t, 'year');
    expect(p[0]).toBe(0);
    expect(p[1]).toBeCloseTo(0.5, 6);
    expect(p[2]).toBe(1);
    // 2024 is a leap year: its last day starts 365 / 366 of the way round.
    expect(p[3]).toBeCloseTo(2 + 365 / 366, 9);
  });

  it('starts weeks on Monday and days at midnight (UTC)', () => {
    // 2025-11-05 is a Wednesday.
    const w = spiralTurns([Date.UTC(2025, 10, 5), Date.UTC(2025, 10, 10)], 'week');
    expect(w[0]).toBeCloseTo(2 / 7, 9);
    expect(w[1]).toBeCloseTo(1, 9);
    const d = spiralTurns([Date.UTC(2025, 10, 5, 6), Date.UTC(2025, 10, 6, 18)], 'day');
    expect(d[0]).toBeCloseTo(0.25, 9);
    expect(d[1]).toBeCloseTo(1.75, 9);
  });

  it('stacks the turns without overlap, from the inner radius to the rim', () => {
    const per = 30;
    const pos = Array.from({ length: per * 4 }, (_, k) => k / per);
    const L = spiralLayout(pos, 0.2);
    expect(L.span).toBeCloseTo(1 / per, 9);
    // The first band starts at the inner radius, the last one ends on the unit circle.
    expect(L.radius[0] - L.band / 2).toBeCloseTo(0.2 + (L.band * L.span) / 2, 9);
    expect(L.radius[pos.length - 1] + L.band / 2).toBeCloseTo(1, 9);
    for (let k = 0; k + per < pos.length; k++) {
      // Same ray one turn later, exactly one band further out.
      expect(L.angle[k + per]).toBeCloseTo(L.angle[k], 9);
      expect(L.radius[k + per] - L.radius[k]).toBeCloseTo(L.band, 9);
    }
    for (let k = 0; k < pos.length; k++) {
      expect(L.angle[k]).toBeGreaterThanOrEqual(0);
      expect(L.angle[k]).toBeLessThan(TAU);
    }
  });

  it('measures the span of a datum on the usual gap, so missing data leaves a hole', () => {
    const pos = [0, 0.1, 0.2, 0.3, 0.7, 0.8, 0.9, 1.0];
    expect(spiralLayout(pos, 0).span).toBeCloseTo(0.1, 9);
    expect(spiralLayout([0.4], 0.1).span).toBeCloseTo(1 / 12, 9);
  });
});

describe('polar grid', () => {
  it('keeps the outermost ring whatever the size', () => {
    const rings = [20, 40, 60, 80];
    expect(thinRings(rings, 200)).toEqual(rings);
    expect(thinRings(rings, 100)).toEqual([40, 80]);
    expect(thinRings(rings, 60)).toEqual([40, 80]);
    expect(thinRings([10, 20, 30, 40, 50], 60)).toEqual([20, 50]);
  });

  it('writes the ring values along the spoke with the fewest data', () => {
    const spokes = Array.from({ length: 8 }, (_, k) => (TAU * k) / 8);
    // Everything blows from the west and the north: the quiet side is the south-east.
    const data = [4.5, 4.7, 4.8, 5, 5.3, 5.6, 6, 6.2, 0.1, 0.4, 0.8, 1.2, 1.6, 3.2, 3.6];
    expect(quietRay(spokes, data)).toBeCloseTo((TAU * 3) / 8, 9);
    // Nothing anywhere: 12 o'clock.
    expect(quietRay(spokes, [])).toBe(0);
  });
});
