import { describe, expect, it } from 'vitest';
import {
  boxStats,
  contourFill,
  density2d,
  dotStacks,
  ecdf,
  ecdfAt,
  ecdfQuantile,
  kde1d,
  normalCdf,
  normalQuantile,
  qqBand,
  qqNormal,
  qqTwoSample,
  quantileSorted,
  sampleGrid,
  scott,
  silverman,
} from '../src/marks/statsMath';

describe('normal law', () => {
  it('inverts the cumulative distribution at known quantiles', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.75)).toBeCloseTo(0.67449, 5);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 5);
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
  });
  it('cdf and quantile are inverse of each other', () => {
    for (const p of [0.01, 0.2, 0.5, 0.8, 0.99]) expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
  });
});

describe('quantiles and box', () => {
  it('interpolates between ranks', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(quantileSorted(s, 0.5)).toBe(5);
    expect(quantileSorted(s, 0.25)).toBe(3);
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([], 0.5)).toBeNaN();
  });
  it('stops the whiskers at the last value within 1.5 IQR', () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 40]);
    expect(b.median).toBe(5.5);
    expect(b.q1).toBe(3.25);
    expect(b.q3).toBe(7.75);
    expect(b.low).toBe(1);
    expect(b.high).toBe(9); // 40 is beyond 7.75 + 1.5 * 4.5
    expect(b.n).toBe(10);
  });
});

describe('dotStacks', () => {
  it('piles values within one dot width, centered on what they hold', () => {
    const s = dotStacks([1, 1.2, 1.9, 3.5, 3.6, 10], 1);
    expect(s.map((p) => p.members.length)).toEqual([3, 2, 1]);
    expect(s[0].x).toBeCloseTo(1.45);
    expect(s[1].x).toBeCloseTo(3.55);
    expect(s[2].x).toBe(10);
  });
  it('keeps every observation exactly once, whatever the input order', () => {
    const v = [5, 1, NaN, 3, 3, 2, 8, 1];
    const s = dotStacks(v, 0.5);
    const all = s.flatMap((p) => p.members).sort((a, b) => a - b);
    expect(all).toEqual([0, 1, 3, 4, 5, 6, 7]);
  });
  it('never lets two piles overlap, and keeps a pile within a width of its values', () => {
    // 1.0 and 2.0 pile at 1.5; 2.01 alone would stand 0.51 away: it is pushed to 2.5.
    const s = dotStacks([1, 2, 2.01], 1);
    expect(s.map((p) => p.x)).toEqual([1.5, 2.5]);
    const v = Array.from({ length: 200 }, (_, i) => Math.sin(i * 12.3) * 10 + i * 0.01);
    const w = 0.7;
    const piles = dotStacks(v, w);
    for (let i = 1; i < piles.length; i++) expect(piles[i].x - piles[i - 1].x).toBeGreaterThanOrEqual(w - 1e-9);
    for (const p of piles) for (const m of p.members) expect(Math.abs(v[m] - p.x)).toBeLessThanOrEqual(w + 1e-9);
  });
  it('histodot uses fixed bins', () => {
    const s = dotStacks([0.1, 0.9, 1.1, 2.5], 1, 'histodot', 0);
    expect(s.map((p) => p.x)).toEqual([0.5, 1.5, 2.5]);
    expect(s.map((p) => p.members.length)).toEqual([2, 1, 1]);
  });
  it('a zero width piles only equal values', () => {
    expect(dotStacks([2, 1, 2], 0).map((p) => [p.x, p.members.length])).toEqual([[1, 1], [2, 2]]);
  });
});

describe('ecdf', () => {
  const e = ecdf([3, 1, 2, 2, NaN]);
  it('steps by 1 / n at each observation, ties merged', () => {
    expect(e.n).toBe(4);
    expect(e.x).toEqual([1, 2, 3]);
    expect(e.p).toEqual([0.25, 0.75, 1]);
  });
  it('is right-continuous', () => {
    expect(ecdfAt(e, 0.99)).toBe(0);
    expect(ecdfAt(e, 1)).toBe(0.25);
    expect(ecdfAt(e, 2.5)).toBe(0.75);
    expect(ecdfAt(e, 99)).toBe(1);
  });
  it('reads a quantile where the staircase reaches it', () => {
    expect(ecdfQuantile(e, 0.5)).toBe(2);
    expect(ecdfQuantile(e, 0.25)).toBe(1);
    expect(ecdfQuantile(e, 0.9)).toBe(3);
  });
});

describe('qq', () => {
  it('puts exact normal quantiles on a line of slope sd and intercept mean', () => {
    const n = 99;
    const v = Array.from({ length: n }, (_, i) => 10 + 2 * normalQuantile((i + 0.5) / n));
    // Shuffled input: the fit sorts it and remembers where each value came from.
    const shuffled = v.map((_, i) => v[(i * 37) % n]);
    const fit = qqNormal(shuffled);
    expect(fit.n).toBe(n);
    expect(fit.slope).toBeCloseTo(2, 3);
    expect(fit.intercept).toBeCloseTo(10, 6);
    for (const p of fit.points) {
      expect(p.sample).toBeCloseTo(10 + 2 * p.theoretical, 9);
      expect(shuffled[p.index]).toBe(p.sample);
    }
    expect(fit.points[0].theoretical).toBeCloseTo(normalQuantile(0.5 / n), 12);
  });
  it('band: 1.96 standard errors of the median at the center, wider in the tails', () => {
    // se of the sample median of a normal law: sd * sqrt(pi / 2n).
    expect(qqBand(0, 2, 100, 0.95)).toBeCloseTo(1.959964 * 2 * Math.sqrt(Math.PI / 200), 4);
    expect(qqBand(2, 2, 100)).toBeGreaterThan(qqBand(0, 2, 100));
    expect(qqBand(0, 2, 400)).toBeCloseTo(qqBand(0, 2, 100) / 2, 9);
  });
  it('two samples: a shifted copy sits parallel to the diagonal', () => {
    const a = [5, 1, 3, 2, 4];
    const pts = qqTwoSample(a, a.map((v) => v + 10));
    expect(pts.map((p) => p.theoretical)).toEqual([1, 2, 3, 4, 5]);
    expect(pts.map((p) => p.sample)).toEqual([11, 12, 13, 14, 15]);
    // Unequal sizes: as many points as the smaller sample, quantiles of the larger interpolated.
    const mixed = qqTwoSample([1, 2, 3], [0, 10, 20, 30, 40, 50]);
    expect(mixed).toHaveLength(3);
    expect(mixed[1].theoretical).toBe(2);
    expect(mixed[1].sample).toBeCloseTo(25);
  });
});

describe('densities', () => {
  it('1D kernel density integrates to 1 and peaks at a lone point', () => {
    const xs = Array.from({ length: 401 }, (_, i) => -10 + i * 0.05);
    const d = kde1d([0], xs, 1);
    expect(d[200]).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 9);
    expect(d.reduce((a, v) => a + v, 0) * 0.05).toBeCloseTo(1, 4);
  });
  it('rules of thumb', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    // sd = 2.7386, IQR / 1.34 = 2.985: Silverman takes the smaller.
    expect(silverman(s)).toBeCloseTo(0.9 * Math.sqrt(7.5) * Math.pow(9, -0.2), 9);
    expect(scott(s)).toBeCloseTo(Math.sqrt(7.5) * Math.pow(9, -1 / 6), 9);
  });
  it('2D density of one point is the product of two Gaussians', () => {
    const box = { x0: -5, x1: 5, y0: -5, y1: 5 };
    const n = 101;
    const g = density2d([0], [0], box, n, n, 1, 0.5);
    const at = (x: number, y: number) => g[Math.round((y + 5) * 10) * n + Math.round((x + 5) * 10)];
    expect(at(0, 0)).toBeCloseTo(1 / (2 * Math.PI * 0.5), 9);
    expect(at(1, 0)).toBeCloseTo(Math.exp(-0.5) / (2 * Math.PI * 0.5), 9);
    expect(at(0, 0.5)).toBeCloseTo(Math.exp(-0.5) / (2 * Math.PI * 0.5), 9);
    let sum = 0;
    for (const v of g) sum += v;
    expect(sum * 0.1 * 0.1).toBeCloseTo(1, 3);
  });
  it('2D density of many points still integrates to 1, off-grid points included', () => {
    const xs = Array.from({ length: 300 }, (_, i) => Math.sin(i * 1.7) * 1.5 + 0.013);
    const ys = Array.from({ length: 300 }, (_, i) => Math.cos(i * 0.9) * 1.2 - 0.007);
    const g = density2d(xs, ys, { x0: -6, x1: 6, y0: -6, y1: 6 }, 121, 121, 0.6, 0.6);
    let sum = 0;
    for (const v of g) sum += v;
    expect(sum * 0.1 * 0.1).toBeCloseTo(1, 2);
    expect(sampleGrid(g, 121, 121, 60, 60)).toBeGreaterThan(sampleGrid(g, 121, 121, 5, 5));
  });
});

describe('contourFill', () => {
  const area = (t: number[]) => {
    let a = 0;
    for (let i = 0; i < t.length; i += 6) a += Math.abs((t[i + 2] - t[i]) * (t[i + 5] - t[i + 1]) - (t[i + 4] - t[i]) * (t[i + 3] - t[i + 1])) / 2;
    return a;
  };
  it('covers the whole grid below the minimum and nothing above the maximum', () => {
    const g = [0, 1, 2, 1, 2, 3, 2, 3, 4];
    expect(area(contourFill(g, 3, 3, -1))).toBeCloseTo(4);
    expect(contourFill(g, 3, 3, 5)).toEqual([]);
  });
  it('cuts a ramp at the right place', () => {
    // value = x on a 3 x 2 grid: at or above 0.5 means x from 0.5 to 2, over a height of 1.
    const g = [0, 1, 2, 0, 1, 2];
    expect(area(contourFill(g, 3, 2, 0.5))).toBeCloseTo(1.5);
    expect(area(contourFill(g, 3, 2, 1.25))).toBeCloseTo(0.75);
  });
  it('a single high corner gives a triangle, a saddle keeps its high corners joined', () => {
    // One cell, corner (0,0) at 1, others at 0, level 0.5: a right triangle of legs 0.5.
    expect(area(contourFill([1, 0, 0, 0], 2, 2, 0.5))).toBeCloseTo(0.125);
    // Saddle: (0,0) and (1,1) high: the square minus two corner triangles.
    expect(area(contourFill([1, 0, 0, 1], 2, 2, 0.5))).toBeCloseTo(0.75);
  });
  it('the area of a cone section matches the disc it should be', () => {
    const n = 81;
    const g = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = 40 - Math.hypot(i - 40, j - 40);
    // Above 20: a disc of radius 20.
    expect(area(contourFill(g, n, n, 20))).toBeCloseTo(Math.PI * 400, -1);
  });
});
