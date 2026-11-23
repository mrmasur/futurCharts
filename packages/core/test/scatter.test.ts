import { describe, expect, it } from 'vitest';
import { LinearScale } from '../src/scale/scales';
import { arrowHead, binIndex, keySteps, marginalBins, median, PanelScale, placeLabels, quadrantOf } from '../src/marks/scatter';

describe('quadrant', () => {
  it('takes the median as default threshold', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([NaN, 7])).toBe(7);
    expect(median([])).toBeNaN();
  });
  it('assigns points in reading order, a value on a threshold going to the high side', () => {
    expect(quadrantOf(1, 9, 5, 5)).toBe(0); // top-left
    expect(quadrantOf(9, 9, 5, 5)).toBe(1); // top-right
    expect(quadrantOf(1, 1, 5, 5)).toBe(2); // bottom-left
    expect(quadrantOf(9, 1, 5, 5)).toBe(3); // bottom-right
    expect(quadrantOf(5, 5, 5, 5)).toBe(1);
    expect(quadrantOf(5, 4.99, 5, 5)).toBe(3);
  });
});

describe('placeLabels', () => {
  const overlap = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  it('keeps labels apart, inside the bounds and off the other points', () => {
    const items = [
      { x: 100, y: 100, r: 6, w: 60, h: 14 },
      { x: 112, y: 100, r: 6, w: 60, h: 14 },
      { x: 100, y: 112, r: 6, w: 60, h: 14 },
      { x: 195, y: 50, r: 4, w: 40, h: 14 },
    ];
    const spots = placeLabels(items, [0, 0, 200, 200]);
    const boxes = spots.filter((s) => s !== null).map((s) => s!.box);
    expect(boxes.length).toBe(4);
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i][0]).toBeGreaterThanOrEqual(0);
      expect(boxes[i][2]).toBeLessThanOrEqual(200);
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    }
    // The point near the right edge is labelled on its left.
    expect(spots[3]!.align).toBe('right');
  });
  it('gives up on a label that fits nowhere, and avoids obstacles', () => {
    expect(placeLabels([{ x: 10, y: 10, r: 4, w: 80, h: 14 }], [0, 0, 40, 40])).toEqual([null]);
    const [s] = placeLabels([{ x: 50, y: 50, r: 4, w: 30, h: 12 }], [0, 0, 200, 100], [[55, 40, 120, 60]]);
    expect(s!.align).toBe('right');
  });
});

describe('arrowHead', () => {
  it('points along the segment with right angles on screen', () => {
    // 200 x 100 px plot: one unit of x is twice as many px as one unit of y.
    const pixel: [number, number] = [1 / 200, 1 / 100];
    const head = arrowHead(0.2, 0.5, 0.6, 0.5, pixel, 10)!;
    const px = head.map(([x, y]) => [x / pixel[0], y / pixel[1]]);
    expect(px[0][0]).toBeCloseTo(85); // tip, half a head past the middle (80 px)
    expect(px[0][1]).toBeCloseTo(50);
    expect(px[1][0]).toBeCloseTo(75);
    expect(px[2][0]).toBeCloseTo(75);
    expect(px[1][1] + px[2][1]).toBeCloseTo(100); // symmetric around the segment
    expect(Math.abs(px[1][1] - px[2][1])).toBeCloseTo(8.4);
  });
  it('follows a diagonal and turns with the direction', () => {
    const pixel: [number, number] = [1 / 100, 1 / 100];
    const up = arrowHead(0, 0, 1, 1, pixel, 10)!;
    const down = arrowHead(1, 1, 0, 0, pixel, 10)!;
    expect(up[0][0]).toBeGreaterThan(0.5);
    expect(up[0][1]).toBeGreaterThan(0.5);
    expect(down[0][0]).toBeLessThan(0.5);
    // The base is perpendicular to the segment.
    const base = [up[1][0] - up[2][0], up[1][1] - up[2][1]];
    expect(base[0] + base[1]).toBeCloseTo(0);
  });
  it('leaves short segments bare', () => {
    expect(arrowHead(0.5, 0.5, 0.51, 0.5, [1 / 200, 1 / 100], 10)).toBeNull();
    expect(arrowHead(0.5, 0.5, 0.5, 0.5, [1 / 200, 1 / 100], 10)).toBeNull();
  });
});

describe('keySteps', () => {
  it('names the ends and the extremes once each', () => {
    const xs = [3, 5, 9, 4, 1, 2];
    const ys = [2, 8, 4, 0, 3, 3];
    expect(keySteps(xs, ys).sort()).toEqual([0, 1, 2, 3, 4, 5].filter((i) => [0, 5, 2, 4, 1, 3].includes(i)));
    expect(keySteps([1, 2, 3], [1, 2, 3])).toEqual([0, 2]);
    expect(keySteps([], [])).toEqual([]);
  });
});

describe('marginal histograms', () => {
  it('cuts classes on round values covering the axis', () => {
    const b = marginalBins(0, 100, 20);
    expect(b).toEqual({ start: 0, step: 5, count: 20 });
    const c = marginalBins(3, 47, 10);
    expect(c.step).toBe(5);
    expect(c.start).toBe(0);
    expect(c.start + c.step * c.count).toBeGreaterThanOrEqual(47);
  });
  it('puts a value in one class, the upper edge in the last one', () => {
    const b = marginalBins(0, 100, 20);
    expect(binIndex(0, b)).toBe(0);
    expect(binIndex(4.99, b)).toBe(0);
    expect(binIndex(5, b)).toBe(1);
    expect(binIndex(100, b)).toBe(19);
    expect(binIndex(101, b)).toBe(-1);
    expect(binIndex(-1, b)).toBe(-1);
    expect(binIndex(NaN, b)).toBe(-1);
    const counts = new Array(b.count).fill(0);
    for (const v of [1, 2, 7, 7.5, 99, 100]) counts[binIndex(v, b)]++;
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBe(2);
    expect(counts[19]).toBe(2);
  });
  it('keeps the data panel on the first share of the plot', () => {
    const s = new PanelScale(new LinearScale(0, 100), 0.8);
    expect(s.norm(100)).toBeCloseTo(0.8);
    expect(s.invert(0.4)).toBeCloseTo(50);
    const ticks = s.ticks(0, 1, 6);
    expect(ticks.length).toBeGreaterThan(2);
    expect(Math.max(...ticks.map((t) => t.t))).toBeLessThanOrEqual(0.8 + 1e-9);
  });
});
