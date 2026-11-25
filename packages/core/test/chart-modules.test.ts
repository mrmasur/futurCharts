import { opaqueSurfaceOf } from '../src/chart/build';
import { describe, expect, it } from 'vitest';
import { gridLines } from '../src/chart/axes';
import { projectionScales } from '../src/chart/cartesian';
import { marksClip } from '../src/chart/frame';
import { inPlot } from '../src/chart/hover';
import { previousInstances } from '../src/chart/morph';
import { dragWindow, navHandleAt } from '../src/chart/navigator';
import { compileOverrides } from '../src/chart/overrides';
import { applyResponsive, mergeSpec, sameMarks } from '../src/chart/responsive';
import { insidePolygon, lassoPolygon } from '../src/chart/selection';
import { tooltipPosition } from '../src/chart/tooltip';
import type { Layout, Zoom } from '../src/chart/types';
import { clampPan, panBy, visibleX, wheelZooms, zoomAt, zoomConfig } from '../src/chart/zoom';
import { Table } from '../src/data/table';
import type { ChartSpec } from '../src/spec/types';
import { resolveTheme } from '../src/theme/theme';

/** A 400 × 200 plot at (50, 20), unzoomed: scale space [0, 1] maps onto it, y up. */
const layout = (zoom: Zoom = { kx: 1, ky: 1, tx: 0, ty: 0 }): Layout => {
  const view = { x: 50, y: 20, width: 400, height: 200 };
  return {
    plot: view,
    view,
    titleY: 0,
    legendY: 0,
    xTicks: [{ t: 0, label: '0' }, { t: 0.5, label: '5' }, { t: 1, label: '10' }, { t: 2, label: '20' }],
    yTicks: [{ t: 0, label: '0' }, { t: 1, label: '1' }],
    ticks2: [],
    transform: { sx: zoom.kx * view.width, ox: view.x + zoom.tx * view.width, sy: -zoom.ky * view.height, oy: view.y + view.height - zoom.ty * view.height },
  };
};

const spec = (over: Partial<ChartSpec> = {}): ChartSpec => ({
  data: [{ a: 'x', v: 1 }],
  layers: [{ mark: 'bar', encode: { x: 'a', y: 'v' }, style: { color: 'red' } }],
  ...over,
});

describe('chart/responsive', () => {
  it('merges a layer field by field and replaces the data', () => {
    const out = mergeSpec(spec({ title: 'T' }), { layers: [{ mark: 'line', encode: { y: 'w' } } as never], data: [{ a: 'y', v: 2 }], legend: false });
    expect(out.layers[0].mark).toBe('line');
    expect(out.layers[0].encode).toEqual({ x: 'a', y: 'w' });
    expect(out.layers[0].style).toEqual({ color: 'red' });
    expect(out.data).toEqual([{ a: 'y', v: 2 }]);
    expect(out.title).toBe('T');
    expect(out.legend).toBe(false);
  });

  it('applies the rules matching the size, in order, and names them', () => {
    const base = spec({ title: 'A', responsive: [{ maxWidth: 400, spec: { title: 'B' } }, { maxWidth: 300, spec: { title: 'C' } }, { minHeight: 500, spec: { subtitle: 'tall' } }] });
    expect(applyResponsive(base, 800, 300)).toMatchObject({ key: '', spec: { title: 'A' } });
    expect(applyResponsive(base, 350, 300)).toMatchObject({ key: '0', spec: { title: 'B' } });
    const narrow = applyResponsive(base, 250, 600);
    expect(narrow.key).toBe('0,1,2');
    expect(narrow.spec.title).toBe('C');
    expect(narrow.spec.subtitle).toBe('tall');
  });

  it('compares the marks layer by layer', () => {
    expect(sameMarks(spec(), spec({ title: 'x' }))).toBe(true);
    expect(sameMarks(spec(), spec({ layers: [{ mark: 'line', encode: {} }] }))).toBe(false);
    expect(sameMarks(spec(), spec({ layers: [] }))).toBe(false);
  });
});

describe('chart/overrides', () => {
  const table = Table.from([{ k: 'a', v: 1 }, { k: 'b', v: 5 }, { k: 'c', v: 9 }]);

  it('none: no lookup', () => {
    expect(compileOverrides({ mark: 'bar', encode: { x: 'k', y: 'v' } }, table, false)).toBeUndefined();
  });

  it('a highlight colors its values and dims the others', () => {
    const f = compileOverrides({ mark: 'bar', encode: { x: 'k', y: 'v' }, highlight: { values: ['b'], color: '#f00' } }, table, false)!;
    expect(f(1)).toEqual({ color: '#f00' });
    expect(f(0)).toEqual({ opacity: 0.25 });
  });

  it('the first matching override wins; conditions combine', () => {
    const f = compileOverrides(
      {
        mark: 'bar',
        encode: { x: 'k', y: 'v' },
        overrides: [
          { when: [{ field: 'v', gt: 2 }, { field: 'v', lt: 6 }], style: { color: 'mid' } },
          { when: { field: 'v', gte: 9 }, style: { color: 'high' } },
        ],
      },
      table,
      false,
    )!;
    expect(f(0)).toBeUndefined();
    expect(f(1)).toEqual({ color: 'mid' });
    expect(f(2)).toEqual({ color: 'high' });
  });
});

describe('chart/morph', () => {
  it('a kept instance starts where it was, a new one from nothing', () => {
    const stride = 3;
    const old = { keys: ['a', 'b'], data: Float32Array.from([1, 1, 1, 2, 2, 2]), kind: 'point' };
    const now = Float32Array.from([5, 5, 5, 7, 7, 7]);
    const { prev, moved } = previousInstances('point', stride, ['b', 'c'], now, old);
    expect(moved).toBe(true);
    // `b` from its old place, `c` (new point) from size zero.
    expect(Array.from(prev)).toEqual([2, 2, 2, 7, 7, 0]);
  });

  it('nothing moved: no transition', () => {
    const old = { keys: ['a'], data: Float32Array.from([1, 2]), kind: 'point' };
    expect(previousInstances('point', 2, ['a'], Float32Array.from([1, 2]), old).moved).toBe(false);
  });
});

describe('chart/zoom', () => {
  it('the wheel zooms always by default, only with Ctrl or Cmd under `wheel: modifier`', () => {
    const always: ChartSpec = { layers: [], interactions: { zoom: { axes: 'x' } } };
    const modifier: ChartSpec = { layers: [], interactions: { zoom: { axes: 'x', wheel: 'modifier' } } };
    expect(wheelZooms(always, {})).toBe(true);
    expect(wheelZooms({ layers: [], interactions: { zoom: true } }, {})).toBe(true);
    expect(wheelZooms(modifier, {})).toBe(false);
    expect(wheelZooms(modifier, { ctrlKey: true })).toBe(true);
    expect(wheelZooms(modifier, { metaKey: true })).toBe(true);
  });

  it('a wheel zoom keeps the point under the pointer in place', () => {
    const z: Zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
    const view = { x: 50, y: 20, width: 400, height: 200 };
    zoomAt(z, { axes: 'x', max: 200 }, { x: 150, y: 100 }, view, 2);
    expect(z.kx).toBe(2);
    expect(z.ky).toBe(1);
    // 150 px is a quarter of the view: the datum at 0.25 stays there.
    expect(0.25 * z.kx + z.tx).toBeCloseTo(0.25);
    expect(visibleX(z)).toEqual([0.125, 0.625]);
  });

  it('zoom stays between 1 and its maximum', () => {
    const z: Zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
    zoomAt(z, { axes: 'xy', max: 3 }, { x: 50, y: 220 }, { x: 50, y: 20, width: 400, height: 200 }, 10);
    expect([z.kx, z.ky]).toEqual([3, 3]);
    zoomAt(z, { axes: 'xy', max: 3 }, { x: 50, y: 220 }, { x: 50, y: 20, width: 400, height: 200 }, 0.01);
    expect([z.kx, z.ky]).toEqual([1, 1]);
  });

  it('panning stops at the ends of the data', () => {
    const z: Zoom = { kx: 2, ky: 1, tx: 0, ty: 0 };
    panBy(z, { axes: 'x', max: 200 }, -1000, 50, { width: 400, height: 200 });
    expect(z.ty).toBe(0);
    clampPan(z);
    expect(z.tx).toBe(-1);
    panBy(z, { axes: 'x', max: 200 }, 5000, 0, { width: 400, height: 200 });
    clampPan(z);
    expect(z.tx).toBe(0);
  });

  it('reads interactions.zoom; a diagram opened zoomed in can be panned', () => {
    const z: Zoom = { kx: 2.5, ky: 1, tx: 0, ty: 0 };
    expect(zoomConfig(spec(), undefined, z)).toBeNull();
    expect(zoomConfig(spec(), 900, z)).toEqual({ axes: 'xy', max: 2.5 });
    expect(zoomConfig(spec({ interactions: { zoom: true } }), undefined, z)).toEqual({ axes: 'x', max: 200 });
    expect(zoomConfig(spec({ interactions: { zoom: { axes: 'xy', max: 8 } } }), undefined, z)).toEqual({ axes: 'xy', max: 8 });
  });
});

describe('chart/navigator', () => {
  const L = layout();
  it('grabs an edge, the window, or draws a new one', () => {
    expect(navHandleAt({ x: 50 + 0.2 * 400 + 5, y: 50 }, L, [0.2, 0.6])).toBe('w');
    expect(navHandleAt({ x: 50 + 0.6 * 400 - 3, y: 50 }, L, [0.2, 0.6])).toBe('e');
    expect(navHandleAt({ x: 250, y: 50 }, L, [0.2, 0.6])).toBe('move');
    expect(navHandleAt({ x: 400, y: 50 }, L, [0.2, 0.6])).toBe('new');
    // Everything shows: a drag inside draws a new window.
    expect(navHandleAt({ x: 250, y: 50 }, L, [0, 1])).toBe('new');
  });

  it('moves the window inside [0, 1] and swaps crossed edges', () => {
    // Moved by 0.4: stops at the right end.
    const [a, b] = dragWindow({ mode: 'move', x: 0.5, start: [0.2, 0.6] }, 0.95);
    expect(a).toBeCloseTo(0.6);
    expect(b).toBeCloseTo(1);
    // Moved back past the left end: stops there, same width.
    const [c, d] = dragWindow({ mode: 'move', x: 0.5, start: [0.2, 0.6] }, 0);
    expect(c).toBe(0);
    expect(d).toBeCloseTo(0.4);
    expect(dragWindow({ mode: 'w', x: 0.2, start: [0.2, 0.6] }, 0.8)).toEqual([0.6, 0.8]);
    expect(dragWindow({ mode: 'e', x: 0.6, start: [0.2, 0.6] }, 0.1)).toEqual([0.1, 0.2]);
  });
});

describe('chart/selection', () => {
  it('a rectangle becomes its four corners; a click is no selection', () => {
    expect(lassoPolygon({ points: [{ x: 0, y: 0 }, { x: 10, y: 5 }], additive: false, rect: true })).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ]);
    expect(lassoPolygon({ points: [{ x: 0, y: 0 }, { x: 2, y: 2 }], additive: false, rect: true })).toBeNull();
    expect(lassoPolygon({ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], additive: false, rect: false })).toBeNull();
  });

  it('tests points against a polygon', () => {
    const px = [0, 10, 10, 0];
    const py = [0, 0, 10, 10];
    expect(insidePolygon(5, 5, px, py)).toBe(true);
    expect(insidePolygon(15, 5, px, py)).toBe(false);
    // A triangle: the corner opposite its long side is outside.
    expect(insidePolygon(9, 1, [0, 10, 0], [0, 10, 10])).toBe(false);
    expect(insidePolygon(1, 9, [0, 10, 0], [0, 10, 10])).toBe(true);
  });
});

describe('chart/hover, tooltip, frame, axes', () => {
  it('inPlot, with a margin', () => {
    const plot = { x: 10, y: 10, width: 100, height: 50 };
    expect(inPlot(plot, { x: 10, y: 10 })).toBe(true);
    expect(inPlot(plot, { x: 5, y: 30 })).toBe(false);
    expect(inPlot(plot, { x: 5, y: 30 }, 8)).toBe(true);
    expect(inPlot(undefined, { x: 20, y: 20 })).toBe(false);
  });

  it('the tooltip flips to stay inside the chart', () => {
    expect(tooltipPosition({ x: 100, y: 100 }, 80, 40, 600, 300)).toEqual({ x: 114, y: 50 });
    // Too close to the right edge: on the left of the pointer.
    expect(tooltipPosition({ x: 560, y: 100 }, 80, 40, 600, 300)).toEqual({ x: 466, y: 50 });
    // Too close to the top: below the pointer.
    expect(tooltipPosition({ x: 100, y: 20 }, 80, 40, 600, 300)).toEqual({ x: 114, y: 34 });
  });

  it('marks are clipped a little past the plot, a map at the edge of the world', () => {
    expect(marksClip(layout(), false, false)).toEqual({ x: 44, y: 14, width: 412, height: 212 });
    expect(marksClip(layout(), true, false)).toEqual({ x: 50, y: 20, width: 400, height: 200 });
    // Zoomed ×2 on the left half: the world's right edge is past the plot, its left edge on it.
    expect(marksClip(layout({ kx: 2, ky: 2, tx: 0, ty: 0 }), true, true)).toEqual({ x: 50, y: 20, width: 400, height: 200 });
    // Zoomed out of the world (not reachable by the user, but the clip holds): it stops at the world.
    expect(marksClip(layout({ kx: 0.5, ky: 0.5, tx: 0, ty: 0 }), true, true)).toEqual({ x: 50, y: 120, width: 200, height: 100 });
  });

  it('grid lines at the graduations inside the plot only', () => {
    const theme = resolveTheme(undefined);
    const rows = gridLines(theme, layout(), true, false);
    // Two horizontal lines, 9 numbers each: y = 220 (t 0) and y = 20 (t 1).
    expect(rows.length).toBe(18);
    expect([rows[1], rows[3], rows[10], rows[12]]).toEqual([220, 220, 20, 20]);
    const columns = gridLines(theme, layout(), false, true);
    // t = 2 falls outside the plot.
    expect(columns.length).toBe(27);
    expect([columns[0], columns[9], columns[18]]).toEqual([50, 250, 450]);
  });

  it('map scales keep the aspect ratio of the projection', () => {
    const eq = projectionScales({ type: 'equirectangular', bounds: [[-10, 40], [10, 50]] });
    expect(eq.aspect).toBe(2);
    expect(eq.x.norm(0)).toBe(0.5);
    const merc = projectionScales({});
    expect(merc.aspect).toBeGreaterThan(1);
  });
});

describe('chart/build', () => {
  it('a transparent background blends with white on a light theme, with a dark surface under light ink', () => {
    expect(opaqueSurfaceOf({ background: '#102030', text: { primary: '#fff', secondary: '#fff', muted: '#fff' } })[0]).toBeCloseTo(16 / 255);
    expect(opaqueSurfaceOf({ background: 'transparent', text: { primary: '#343741', secondary: '#000', muted: '#000' } })).toEqual([1, 1, 1, 1]);
    const dark = opaqueSurfaceOf({ background: 'transparent', text: { primary: '#CAD3E2', secondary: '#000', muted: '#000' } });
    expect(dark[0]).toBeLessThan(0.2);
    expect(dark[3]).toBe(1);
  });
});
