import { describe, expect, it } from 'vitest';
import {
  activityLayout,
  activityRings,
  bandShades,
  bulletDomain,
  contrast,
  gridCells,
  halfHeight,
  liquidFigure,
  liquidSurface,
  litSegments,
  readableInk,
  rowsLayout,
  zoneColor,
} from '../src/marks/gauges';
import type { RGBA } from '../src/render/types';

describe('rows of indicators', () => {
  const base = { height: 300, rows: 5, nameWidth: 120, valueWidth: 50 };
  it('put names and values beside the bars on a wide chart', () => {
    const L = rowsLayout({ ...base, width: 700 });
    expect(L.stacked).toBe(false);
    expect([L.x0, L.x1]).toEqual([120, 650]);
    expect(L.header).toBe(0);
  });
  it('put them above the bars when the bars would be too short', () => {
    const L = rowsLayout({ ...base, width: 311 });
    expect(L.stacked).toBe(true);
    expect([L.x0, L.x1]).toEqual([0, 311]);
    expect(L.barTop).toBeGreaterThanOrEqual(L.header);
  });
  it('keep every row inside the box, bar and ticks included', () => {
    for (const width of [311, 700]) {
      const L = rowsLayout({ ...base, width, below: 15, footer: 18 });
      expect(L.top).toBeGreaterThanOrEqual(0);
      expect(L.top + L.rowH * 5).toBeLessThanOrEqual(300 - 18 + 1e-9);
      expect(L.barTop + L.thickness + 15).toBeLessThanOrEqual(L.rowH + 1e-9);
    }
  });
  it('go back beside the bars when a line of text above each would leave hairlines', () => {
    const L = rowsLayout({ width: 311, height: 170, rows: 6, nameWidth: 111, valueWidth: 62, footer: 18 });
    expect(L.stacked).toBe(false);
    expect(L.thickness).toBeGreaterThanOrEqual(9);
    expect(L.x1 - L.x0).toBeGreaterThanOrEqual(90);
  });
  it('thin the bars rather than overflow when rows are many', () => {
    const L = rowsLayout({ ...base, width: 700, rows: 12, height: 190 });
    expect(L.rowH * 12).toBeLessThanOrEqual(190 + 1e-9);
    expect(L.thickness).toBeGreaterThanOrEqual(5);
    expect(L.thickness).toBeLessThan(26);
  });
});

describe('bullet', () => {
  it('ends the scale on the last range when everything fits under it', () => {
    expect(bulletDomain(82, 90, [60, 85, 100])).toEqual([0, 100]);
  });
  it('goes past the ranges to a round number when the value exceeds them', () => {
    const [lo, hi] = bulletDomain(131, 90, [60, 85, 100]);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThanOrEqual(131);
  });
  it('covers value and target without ranges, and negative values', () => {
    expect(bulletDomain(40, 72, [])[1]).toBeGreaterThanOrEqual(72);
    const [lo, hi] = bulletDomain(-12, 30, []);
    expect(lo).toBeLessThanOrEqual(-12);
    expect(hi).toBeGreaterThanOrEqual(30);
  });
  it('shades the ranges from the strongest (poor) to the lightest (good)', () => {
    const s = bandShades(3);
    expect(s).toHaveLength(3);
    expect(s[0]).toBeGreaterThan(s[1]);
    expect(s[1]).toBeGreaterThan(s[2]);
    expect(bandShades(1)).toHaveLength(1);
  });
});

describe('zones and segments', () => {
  const zones = [{ to: 100, color: 'red' }, { to: 60, color: 'green' }, { to: 85, color: 'orange' }];
  it('pick the zone a value falls in, whatever their order', () => {
    expect(zoneColor(zones, 12)).toBe('green');
    expect(zoneColor(zones, 60)).toBe('green');
    expect(zoneColor(zones, 61)).toBe('orange');
    expect(zoneColor(zones, 140)).toBe('red');
    expect(zoneColor([], 5)).toBeUndefined();
  });
  it('light at least one segment for a small value, and all only when full', () => {
    expect(litSegments(0, 0, 100, 20)).toBe(0);
    expect(litSegments(1, 0, 100, 20)).toBe(1);
    expect(litSegments(50, 0, 100, 20)).toBe(10);
    expect(litSegments(99, 0, 100, 20)).toBe(19);
    expect(litSegments(100, 0, 100, 20)).toBe(20);
    expect(litSegments(250, 0, 100, 20)).toBe(20);
  });
});

describe('liquid', () => {
  it('lays several gauges side by side in a wide box, in a grid in a square one', () => {
    expect(gridCells(4, 760, 300, 24).columns).toBe(4);
    expect(gridCells(4, 300, 300, 24).columns).toBe(2);
    expect(gridCells(1, 300, 200, 24)).toMatchObject({ columns: 1, rows: 1, size: 176 });
  });
  it('never makes a cell larger than its share of the box', () => {
    for (const [n, w, h] of [[3, 311, 190], [5, 768, 330], [7, 343, 400]] as const) {
      const g = gridCells(n, w, h, 24);
      expect(g.columns * g.rows).toBeGreaterThanOrEqual(n);
      expect(g.size * g.columns + 12 * (g.columns - 1)).toBeLessThanOrEqual(w + 1e-9);
      expect((g.size + 24) * g.rows + 12 * (g.rows - 1)).toBeLessThanOrEqual(h + 1e-9);
    }
  });
  it('is empty at 0 and full at 100 %, waved in between', () => {
    const wave = { amplitude: 0.04, waves: 1.4, phase: 0.3 };
    for (const x of [-1, -0.4, 0, 0.7, 1]) {
      expect(liquidSurface(0, x, wave)).toBe(0);
      expect(liquidSurface(1, x, wave)).toBe(1);
      expect(Math.abs(liquidSurface(0.5, x, wave) - 0.5)).toBeLessThanOrEqual(0.04 + 1e-12);
    }
    const heights = [-1, -0.5, 0, 0.5, 1].map((x) => liquidSurface(0.5, x, wave));
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.02);
  });
  it('follows the container: a circle, or a square with round corners', () => {
    expect(halfHeight('circle', 10, 0, 0)).toBe(10);
    expect(halfHeight('circle', 10, 0, 6)).toBeCloseTo(8);
    expect(halfHeight('circle', 10, 0, 10)).toBe(0);
    expect(halfHeight('rounded', 10, 4, 0)).toBe(10);
    expect(halfHeight('rounded', 10, 4, 6)).toBe(10);
    expect(halfHeight('rounded', 10, 4, 8)).toBeCloseTo(6 + Math.sqrt(12));
    expect(halfHeight('rounded', 10, 4, 12)).toBe(0);
  });
  it('picks an ink that reads on everything the figure crosses', () => {
    const paper: RGBA = [0.99, 0.99, 0.98, 1];
    const night: RGBA = [0.1, 0.1, 0.1, 1];
    const blue: RGBA = [0.16, 0.47, 0.84, 1];
    const isDark = (c: RGBA) => c[0] < 0.5;
    // Half on a light background, half on the liquid: never white.
    expect(isDark(readableInk([paper, blue]))).toBe(true);
    expect(isDark(readableInk([paper]))).toBe(true);
    // On a dark theme, half on the background: never black.
    expect(isDark(readableInk([night, blue]))).toBe(false);
    for (const set of [[paper, blue], [night, blue]]) {
      const ink = readableInk(set);
      for (const bg of set) expect(contrast(ink, bg)).toBeGreaterThanOrEqual(3);
    }
    // Alone on a saturated fill: white, as every label drawn on a fill.
    expect(isDark(readableInk([blue]))).toBe(false);
  });
  it('keeps the figure centered when an ink reads on what it crosses, moves it otherwise', () => {
    const night: RGBA = [0.1, 0.1, 0.1, 1];
    const paper: RGBA = [0.99, 0.99, 0.98, 1];
    const blue: RGBA = [0.16, 0.47, 0.84, 1];
    const amber: RGBA = [0.93, 0.63, 0, 1];
    const base = { radius: 100, size: 44, amplitude: 0.035 };
    // Well under or over the figure: one background only.
    expect(liquidFigure({ ...base, share: 0.9, liquid: blue, empty: paper })).toMatchObject({ dy: 0, ink: [1, 1, 1, 1] });
    expect(liquidFigure({ ...base, share: 0.1, liquid: blue, empty: paper }).ink[0]).toBeLessThan(0.5);
    // Half full on a light theme: dark ink reads on both.
    expect(liquidFigure({ ...base, share: 0.5, liquid: amber, empty: paper })).toMatchObject({ dy: 0, moved: false });
    // Half full, amber on a dark theme: nothing reads on both, the figure goes into the liquid (below)…
    const down = liquidFigure({ ...base, share: 0.55, liquid: amber, empty: night });
    expect(down.moved).toBe(true);
    expect(down.dy).toBeGreaterThan(22);
    expect(down.dy + 22).toBeLessThan(100);
    expect(contrast(down.ink, amber)).toBeGreaterThanOrEqual(3);
    // …or into the empty part (above) when that is the larger one.
    const up = liquidFigure({ ...base, share: 0.45, liquid: amber, empty: night });
    expect(up.dy).toBeLessThan(-22);
    expect(contrast(up.ink, night)).toBeGreaterThanOrEqual(3);
  });
});

describe('activity rings', () => {
  it('nest from the outside in without touching', () => {
    const rings = activityRings(3, 100, 0.4, 0.2);
    expect(rings[0].outer).toBe(100);
    for (let i = 1; i < rings.length; i++) expect(rings[i].outer).toBeLessThan(rings[i - 1].inner);
    expect(rings[2].inner).toBeGreaterThanOrEqual(40);
    for (const r of rings) expect(r.outer - r.inner).toBeCloseTo(16);
  });
  it('sit beside their list on a wide chart, above it on a tall one', () => {
    const wide = activityLayout(760, 330, 4, true);
    expect(wide.list?.side).toBe(true);
    expect(wide.cx + wide.r).toBeLessThanOrEqual(wide.list!.x);
    expect(wide.list!.x + wide.list!.width).toBeLessThanOrEqual(760);
    const tall = activityLayout(343, 400, 4, true);
    expect(tall.list?.side).toBe(false);
    expect(tall.cy + tall.r).toBeLessThanOrEqual(tall.list!.y);
    expect(tall.list!.y + tall.list!.rowH * 4).toBeLessThanOrEqual(400);
  });
  it('drop the list rather than shrink the rings to nothing', () => {
    const small = activityLayout(160, 150, 4, true);
    expect(small.list).toBeUndefined();
    expect(small.r).toBe(75);
    expect(activityLayout(400, 300, 3, false).list).toBeUndefined();
  });
});
