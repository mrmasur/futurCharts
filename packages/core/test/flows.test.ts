import { Tween } from '../src/marks/animate';
import { Table } from '../src/data/table';
import { apportion } from '../src/marks/extra';
import { prepareLayer } from '../src/marks/prepare';
import { darkTheme, lightTheme, themeColor } from '../src/theme/theme';
import { describe, expect, it } from 'vitest';
import { sankeyLayout } from '../src/marks/flows';

describe('sankey layout', () => {
  const flows = [
    { source: 'A', target: 'X', value: 30 },
    { source: 'B', target: 'X', value: 10 },
    { source: 'X', target: 'Y', value: 25 },
    { source: 'X', target: 'Z', value: 15 },
    { source: 'A', target: 'Z', value: 5 },
  ];
  const { nodes, links } = sankeyLayout(flows, 600, 300, 10, 12);
  const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));

  it('places nodes in columns by longest path, sinks on the right', () => {
    expect(byName.A.col).toBe(0);
    expect(byName.X.col).toBe(1);
    expect(byName.Y.col).toBe(2);
    // Z is reached directly from A, but as a sink it goes to the last column.
    expect(byName.Z.col).toBe(2);
  });

  it('keeps nodes inside the area and apart within a column', () => {
    for (const n of nodes) {
      expect(n.y0).toBeGreaterThanOrEqual(-1e-6);
      expect(n.y1).toBeLessThanOrEqual(300 + 1e-6);
    }
    const col = nodes.filter((n) => n.col === 2).sort((a, b) => a.y0 - b.y0);
    expect(col[1].y0 - col[0].y1).toBeGreaterThanOrEqual(12 - 1e-6);
  });

  it('gives every node the larger of its inflow and outflow, and ribbons fill it', () => {
    expect(byName.X.value).toBe(40);
    const ky = (byName.X.y1 - byName.X.y0) / 40;
    const out = links.filter((l) => l.source.name === 'X').reduce((a, l) => a + l.width, 0);
    expect(out).toBeCloseTo(40 * ky);
  });
});


describe('waffle apportion', () => {
  it('always gives exactly the number of cells, by largest remainder', () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(apportion([47, 14, 19, 11, 9], 100)).toEqual([47, 14, 19, 11, 9]);
    expect(apportion([0, 0], 100)).toEqual([0, 0]);
  });
});

describe('stack modes', () => {
  const rows = [
    { x: 'a', k: 'p', v: 1 }, { x: 'a', k: 'q', v: 3 },
    { x: 'b', k: 'p', v: 2 }, { x: 'b', k: 'q', v: 2 },
  ];
  const ctx = () => ({ band: true, horizontal: false, categories: new Map<string, number>(), fields: {}, hidden: new Set<string>() });
  it('normalize fills each stack to 1', () => {
    const d = prepareLayer({ mark: 'bar', encode: { x: 'x', y: 'v', color: 'k' }, stack: 'normalize' }, 0, Table.from(rows), ctx());
    expect([...d.series[1].y1]).toEqual([1, 1]);
    expect([...d.series[0].y1]).toEqual([0.25, 0.5]);
  });
  it('center puts each stack around zero', () => {
    const d = prepareLayer({ mark: 'area', encode: { x: 'x', y: 'v', color: 'k' }, stack: 'center' }, 0, Table.from(rows), ctx());
    expect([...d.series[0].y0]).toEqual([-2, -2]);
    expect([...d.series[1].y1]).toEqual([2, 2]);
  });
});

describe('theme color tokens', () => {
  it('resolve against the theme and leave plain colors alone', () => {
    expect(themeColor(lightTheme, '$ink')).toBe(lightTheme.text.primary);
    expect(themeColor(darkTheme, '$ink')).toBe(darkTheme.text.primary);
    expect(themeColor(lightTheme, '$2')).toBe(lightTheme.palette.categorical[1]);
    expect(themeColor(lightTheme, '#123456')).toBe('#123456');
  });
});


describe('tween', () => {
  it('moves from the current state to the target and lands on it exactly', () => {
    const t = new Tween(Float64Array.from([0, 10]));
    t.go(Float64Array.from([1, 20]), 0, 100);
    expect(t.moving).toBe(true);
    expect(t.step(50)).toBe(true);
    expect(t.current[0]).toBeCloseTo(0.5);
    expect(t.step(100)).toBe(false);
    expect([...t.current]).toEqual([1, 20]);
    expect(t.moving).toBe(false);
  });
  it('restarts from where it is when retargeted mid-way', () => {
    const t = new Tween(Float64Array.from([0]));
    t.go(Float64Array.from([10]), 0, 100);
    t.step(50);
    t.go(Float64Array.from([0]), 50, 100);
    expect(t.current[0]).toBeCloseTo(5);
  });
});
