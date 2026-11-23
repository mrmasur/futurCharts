import { describe, expect, it } from 'vitest';
import { layerExtents, linearValueDomain, type ExtentLayer } from '../src/chart/domains';
import { Table } from '../src/data/table';
import { applyTransform, applyTransforms } from '../src/data/transforms';
import type { SeriesData } from '../src/marks/prepare';

const col = (t: Table, f: string) => Array.from(t.column(f).values as ArrayLike<number | string>);

const series = (x: number[], y: number[], y0?: number[], hidden = false): SeriesData => ({
  key: 's',
  hidden,
  x: Float64Array.from(x),
  y0: Float64Array.from(y0 ?? x.map(() => 0)),
  y1: Float64Array.from(y),
  value: Float64Array.from(y),
  rows: Int32Array.from(x.map((_, i) => i)),
});

const layer = (s: SeriesData[], def: ExtentLayer['def'] = {}, flags: { stacked?: boolean; ranged?: boolean } = {}): ExtentLayer => ({
  data: { series: s, stacked: !!flags.stacked, ranged: !!flags.ranged },
  def,
});

describe('pareto transform', () => {
  const t = Table.from([
    { cause: 'a', n: 10 },
    { cause: 'b', n: 60 },
    { cause: 'c', n: 30 },
  ]);

  it('sorts largest first and accumulates the share of the total', () => {
    const out = applyTransform(t, { type: 'pareto', field: 'n' });
    expect(col(out, 'cause')).toEqual(['b', 'c', 'a']);
    expect(col(out, 'n')).toEqual([60, 30, 10]);
    expect(col(out, 'share')).toEqual([0.6, 0.3, 0.1]);
    expect(col(out, 'cumulative')).toEqual([0.6, 0.9, 1]);
  });

  it('renames the cumulative column with `as`', () => {
    const out = applyTransform(t, { type: 'pareto', field: 'n', as: 'cum' });
    expect(out.has('cumulative')).toBe(false);
    expect(col(out, 'cum')).toEqual([0.6, 0.9, 1]);
  });

  it('keeps the data order of equal values and ends on exactly 1', () => {
    const rows = [0.1, 0.2, 0.1, 0.3, 0.1, 0.2].map((n, i) => ({ k: `k${i}`, n }));
    const out = applyTransform(Table.from(rows), { type: 'pareto', field: 'n' });
    expect(col(out, 'k')).toEqual(['k3', 'k1', 'k5', 'k0', 'k2', 'k4']);
    const cum = col(out, 'cumulative') as number[];
    expect(cum[cum.length - 1]).toBe(1);
    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThanOrEqual(cum[i - 1]);
  });

  it('puts rows without a value last, without moving the cumulative', () => {
    const out = applyTransform(Table.from([{ k: 'a', n: null }, { k: 'b', n: 1 }, { k: 'c', n: 3 }]), { type: 'pareto', field: 'n' });
    expect(col(out, 'k')).toEqual(['c', 'b', 'a']);
    expect(col(out, 'cumulative')).toEqual([0.75, 1, 1]);
  });

  it('handles an empty table and a zero total', () => {
    expect(applyTransform(Table.from({ columns: { k: [], n: [] } }, { n: 'number' }), { type: 'pareto', field: 'n' }).length).toBe(0);
    const zero = applyTransform(Table.from([{ k: 'a', n: 0 }, { k: 'b', n: 0 }]), { type: 'pareto', field: 'n' });
    expect(col(zero, 'cumulative')).toEqual([0, 0]);
  });

  it('chains after an aggregate', () => {
    const raw = Table.from([{ c: 'x', v: 1 }, { c: 'y', v: 5 }, { c: 'x', v: 2 }, { c: 'z', v: 2 }]);
    const out = applyTransforms(raw, [
      { type: 'aggregate', groupby: ['c'], ops: [{ op: 'sum', field: 'v', as: 'total' }] },
      { type: 'pareto', field: 'total' },
    ]);
    expect(col(out, 'c')).toEqual(['y', 'x', 'z']);
    expect(col(out, 'cumulative')).toEqual([0.5, 0.8, 1]);
  });
});

describe('domains of a dual-axis chart', () => {
  const bars = layer([series([0, 1, 2], [100, 400, 250])], { baseline: true, banded: true });
  const line = layer([series([0, 1, 2], [0.2, 0.35, 0.3])]);

  it('without a secondary axis, every layer feeds the one value extent', () => {
    const e = layerExtents([bars, line]);
    expect([e.c0, e.c1]).toEqual([0, 2]);
    expect([e.primary.v0, e.primary.v1]).toEqual([0, 400]);
    expect(e.primary.baseline).toBe(true);
    expect(e.secondary.v0).toBeGreaterThan(e.secondary.v1); // empty
    expect(e.banded).toBe(true);
    expect(e.step).toBe(1);
  });

  it('a layer on the secondary axis has its own extent and leaves the primary alone', () => {
    const e = layerExtents([bars, line], (i) => i === 1);
    expect([e.primary.v0, e.primary.v1]).toEqual([0, 400]);
    expect([e.secondary.v0, e.secondary.v1]).toEqual([0.2, 0.35]);
    // The bars' zero baseline belongs to their axis only.
    expect(e.primary.baseline).toBe(true);
    expect(e.secondary.baseline).toBe(false);
    // The category axis is shared by both.
    expect([e.c0, e.c1]).toEqual([0, 2]);
  });

  it('lines read y1 only, bars and ranges span y0 too; hidden series do not count', () => {
    const ranged = layer([series([0, 1], [8, 9], [5, 2])], {}, { ranged: true });
    const stackedLine = layer([series([0, 1], [8, 9], [5, 2])]);
    expect(layerExtents([ranged]).primary).toMatchObject({ v0: 2, v1: 9, baseline: false });
    expect(layerExtents([stackedLine]).primary).toMatchObject({ v0: 8, v1: 9 });
    const hidden = layerExtents([layer([series([0, 1], [50, 60], undefined, true)]), line]);
    expect([hidden.primary.v0, hidden.primary.v1]).toEqual([0.2, 0.35]);
  });

  it('a linear value domain includes zero for a baseline, then rounds', () => {
    const o = { spec: {}, baseline: true, outsideLabels: false, horizontal: false, normalized: false };
    expect(linearValueDomain(120, 430, o)).toEqual([0, 500]);
    // Without a baseline (a line on the secondary axis), the domain hugs the data: no zero pulled in.
    const [lo, hi] = linearValueDomain(0.21, 0.35, { ...o, baseline: false });
    expect(lo).toBeCloseTo(0.2);
    expect(hi).toBeCloseTo(0.36);
    expect(linearValueDomain(120, 430, { ...o, baseline: false })).toEqual([100, 450]);
  });

  it('spec options win: zero, nice off, an explicit side of the domain', () => {
    const o = { baseline: false, outsideLabels: false, horizontal: false, normalized: false };
    expect(linearValueDomain(120, 430, { ...o, spec: { zero: true } })).toEqual([0, 500]);
    expect(linearValueDomain(120, 430, { ...o, spec: { nice: false } })).toEqual([120, 430]);
    expect(linearValueDomain(120, 430, { ...o, spec: { domain: [0, null] } })).toEqual([0, 450]);
    expect(linearValueDomain(0.2, 0.35, { ...o, spec: { domain: [0, 1] } })).toEqual([0, 1]);
    expect(linearValueDomain(-3, 430, { ...o, baseline: true, spec: { zero: false, nice: false } })).toEqual([-3, 430]);
  });

  it('a 100 % stack is [0, 1]; outside labels get room past the longest bar', () => {
    const o = { spec: {}, baseline: true, outsideLabels: false, horizontal: false, normalized: true };
    expect(linearValueDomain(0, 0.97, o)).toEqual([0, 1]);
    const padded = linearValueDomain(0, 100, { ...o, normalized: false, outsideLabels: true, spec: { nice: false } });
    expect(padded).toEqual([0, 108]);
    const horizontal = linearValueDomain(0, 100, { ...o, normalized: false, outsideLabels: true, horizontal: true, spec: { nice: false } });
    expect(horizontal[1]).toBeCloseTo(114);
  });
});
