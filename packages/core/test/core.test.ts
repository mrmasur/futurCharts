import { describe, expect, it } from 'vitest';
import { Table } from '../src/data/table';
import { ensureBuiltinMarks } from '../src/marks/builtin';
import { curvePoints } from '../src/marks/curve';
import { getMark, registerMark } from '../src/marks/registry';
import { prepareLayer } from '../src/marks/prepare';
import { LAYOUTS } from '../src/render/layouts';
import { BandScale, LinearScale, LogScale, TimeScale, niceDomain, withFormatter } from '../src/scale/scales';
import { chart } from '../src/spec/builder';
import { resolveTheme } from '../src/theme/theme';
import { parseColor } from '../src/util/color';

describe('scales', () => {
  it('withFormatter rewrites the labels and nothing else', () => {
    const base = new LinearScale(0, 0.3);
    const s = withFormatter(base, (v) => `${v} Go`);
    expect(s.type).toBe('linear');
    expect(s.norm(0.15)).toBeCloseTo(0.5);
    expect(s.format(2)).toBe('2 Go');
    const ticks = s.ticks(0, 1, 3);
    expect(ticks.map((t) => t.t)).toEqual(base.ticks(0, 1, 3).map((t) => t.t));
    // 3 × 0.1 is 0.30000000000000004: the label must not show it.
    expect(ticks.map((t) => t.label)).toEqual(['0 Go', '0.1 Go', '0.2 Go', '0.3 Go']);
    const log = withFormatter(new LogScale(1, 1000), (v) => `${v} ms`);
    expect(log.ticks(0, 1, 4).map((t) => t.label)).toEqual(['1 ms', '10 ms', '100 ms', '1000 ms']);
  });

  it('nice domain rounds outwards', () => {
    expect(niceDomain(3, 97)).toEqual([0, 100]);
  });
  it('linear ticks are round and never "-0"', () => {
    const labels = new LinearScale(0, 80000).ticks(0, 1, 5).map((t) => t.label);
    expect(labels[0]).toBe('0');
    expect(labels.length).toBeGreaterThanOrEqual(4);
  });
  it('linear ticks follow the visible (zoomed) range', () => {
    const ticks = new LinearScale(0, 100).ticks(0.4, 0.6, 5);
    expect(ticks.every((t) => t.t >= 0.4 - 1e-9 && t.t <= 0.6 + 1e-9)).toBe(true);
  });
  it('band scale centers categories inside [0, 1]', () => {
    const s = new BandScale(['a', 'b', 'c']);
    expect(s.norm(0)).toBeGreaterThan(0);
    expect(s.norm(2)).toBeLessThan(1);
    expect(s.norm(1)).toBeCloseTo(0.5);
    expect(s.invert(s.norm(2))).toBe(2);
  });
  it('time scale yields several ticks over 45 days', () => {
    const d0 = new Date(2026, 4, 1).getTime();
    const ticks = new TimeScale(d0, d0 + 45 * 86400000).ticks(0, 1, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
  });
});

describe('data', () => {
  it('infers column types from rows', () => {
    const t = Table.from([{ d: new Date(0), n: 1, s: 'x' }]);
    expect(t.column('d').type).toBe('time');
    expect(t.column('n').type).toBe('number');
    expect(t.column('s').type).toBe('string');
  });
  it('keeps Float64Array columns without copying', () => {
    const v = new Float64Array([1, 2, 3]);
    expect(Table.from({ columns: { v } }).column('v').values).toBe(v);
  });
  it('names the available fields when one is missing', () => {
    expect(() => Table.from([{ a: 1 }]).column('b')).toThrow(/Available: a/);
  });
});

describe('prepare', () => {
  const rows = [
    { m: 'jan', c: 'A', v: 1 },
    { m: 'jan', c: 'B', v: 2 },
    { m: 'feb', c: 'A', v: 3 },
    { m: 'feb', c: 'B', v: 4 },
  ];
  const ctx = () => ({ band: true, categories: new Map<string, number>(), fields: {}, hidden: new Set<string>() });
  it('splits into series and stacks', () => {
    const d = prepareLayer({ mark: 'bar', encode: { x: 'm', y: 'v', color: 'c' }, stack: true }, 0, Table.from(rows), ctx());
    expect(d.series.map((s) => s.key)).toEqual(['A', 'B']);
    expect([...d.series[1].y0]).toEqual([1, 3]);
    expect([...d.series[1].y1]).toEqual([3, 7]);
  });
  it('hidden series do not take part in the stack', () => {
    const c = ctx();
    c.hidden.add('A');
    const d = prepareLayer({ mark: 'bar', encode: { x: 'm', y: 'v', color: 'c' }, stack: true }, 0, Table.from(rows), c);
    expect([...d.series[1].y0]).toEqual([0, 0]);
  });
});

describe('curves', () => {
  it('smooth curve passes through the data and never overshoots', () => {
    const p = curvePoints([0, 1, 2, 3], [0, 10, 10, 0], 'smooth');
    expect(Math.max(...p.y)).toBeLessThanOrEqual(10 + 1e-6);
    expect(Math.min(...p.y)).toBeGreaterThanOrEqual(-1e-6);
    expect(p.y[10]).toBeCloseTo(10);
  });
});

describe('spec & theme', () => {
  it('builder output is plain JSON', () => {
    const spec = chart([{ x: 1, y: 2 }]).title('t').line({ x: 'x', y: 'y' }).style({ width: 3 }).toSpec();
    expect(JSON.parse(JSON.stringify(spec))).toEqual(spec);
    expect(spec.layers[0]).toMatchObject({ mark: 'line', style: { width: 3 } });
  });
  it('theme overrides merge deeply over the base', () => {
    const t = resolveTheme({ extends: 'dark', marks: { bar: { radius: 0 } } });
    expect(t.marks.bar.radius).toBe(0);
    expect(t.marks.bar.gap).toBe(2);
    expect(t.background).toBe('#1a1a19');
  });
  it('parses hex and rgba colors', () => {
    expect(parseColor('#ff0000')).toEqual([1, 0, 0, 1]);
    expect(parseColor('rgba(0, 0, 255, 0.5)')).toEqual([0, 0, 1, 0.5]);
  });
});

describe('render layouts', () => {
  it('stride matches the attribute sizes (the contract every backend relies on)', () => {
    for (const l of Object.values(LAYOUTS)) {
      expect(l.attributes.reduce((n, a) => n + a.size, 0)).toBe(l.stride);
    }
  });
});

describe('marks registry', () => {
  it('built-in marks are registered on demand and never override an app mark', () => {
    const custom = { build: () => ({ draws: [], hit: {} as never }) };
    registerMark('bar', custom);
    ensureBuiltinMarks();
    expect(getMark('bar')).toBe(custom);
    expect(getMark('line').symbol).toBe('line');
  });
});
