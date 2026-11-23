import { describe, expect, it } from 'vitest';
import { bollinger, ema, heikinAshi, macd, rsi, sma } from '../src/data/indicators';
import { Table } from '../src/data/table';
import { applyTransforms } from '../src/data/transforms';
import { kagiLines, renkoBricks } from '../src/marks/stock';

const close = (a: ArrayLike<number>, b: number[], digits = 9) => {
  expect(a.length).toBe(b.length);
  b.forEach((v, i) => (Number.isNaN(v) ? expect(a[i]).toBeNaN() : expect(a[i]).toBeCloseTo(v, digits)));
};

describe('indicators', () => {
  it('sma: the mean of the last `period` values, nothing before the window is full', () => {
    close(sma([1, 2, 3, 4, 5], 3), [NaN, NaN, 2, 3, 4]);
    close(sma([4, 8], 5), [NaN, NaN]);
  });

  it('ema: seeded with the simple mean, then weight 2 / (period + 1) on the latest value', () => {
    // k = 0.5; seed (2 + 4 + 6) / 3 = 4; then 8·½ + 4·½ = 6; 12·½ + 6·½ = 9; 10·½ + 9·½ = 9.5
    close(ema([2, 4, 6, 8, 12, 10], 3), [NaN, NaN, 4, 6, 9, 9.5]);
  });

  it('bollinger: k population standard deviations around the moving average', () => {
    // Mean 5, squared deviations 9 + 1 + 1 + 1 + 0 + 0 + 4 + 16 = 32, variance 4, sd 2.
    const b = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    expect(b.middle[7]).toBeCloseTo(5);
    expect(b.upper[7]).toBeCloseTo(9);
    expect(b.lower[7]).toBeCloseTo(1);
    expect(b.upper[6]).toBeNaN();
    // A flat series has bands of no width.
    const flat = bollinger([3, 3, 3], 2);
    close(flat.upper, [NaN, 3, 3]);
    close(flat.lower, [NaN, 3, 3]);
  });

  it('rsi: Wilder smoothing of gains and losses', () => {
    // Changes +1 -1 +2 -1 +2, period 3.
    // Row 3: gain 3/3 = 1, loss 1/3, RS 3 → 75.
    // Row 4: gain (1·2 + 0)/3 = 2/3, loss (1/3·2 + 1)/3 = 5/9, RS 1.2 → 100 − 100/2.2.
    // Row 5: gain (2/3·2 + 2)/3 = 10/9, loss (5/9·2)/3 = 10/27, RS 3 → 75.
    close(rsi([10, 11, 10, 12, 11, 13], 3), [NaN, NaN, NaN, 75, 100 - 100 / 2.2, 75]);
    // Only gains: 100; no move at all: 50.
    expect(rsi([1, 2, 3, 4], 2)[3]).toBe(100);
    expect(rsi([5, 5, 5, 5], 2)[3]).toBe(50);
  });

  it('macd: fast EMA minus slow EMA, its signal line and their difference', () => {
    // fast 2 (k = 2/3): –, 1.5, 2.5, 3.5, 4.5, 6.1667 · slow 3 (k = 1/2): –, –, 2, 3, 4, 5.5
    // macd: 0.5, 0.5, 0.5, 0.6667 from row 2 · signal 2: seed 0.5 at row 3, 0.5, 0.6667·⅔ + 0.5·⅓ = 0.6111
    const m = macd([1, 2, 3, 4, 5, 7], 2, 3, 2);
    close(m.macd, [NaN, NaN, 0.5, 0.5, 0.5, 2 / 3]);
    close(m.signal, [NaN, NaN, NaN, 0.5, 0.5, 11 / 18]);
    close(m.histogram, [NaN, NaN, NaN, 0, 0, 2 / 3 - 11 / 18]);
  });

  it('heikinAshi: averaged close, open in the middle of the previous body', () => {
    const ha = heikinAshi([10, 11, 12], [12, 13, 12], [9, 10, 8], [11, 12, 9]);
    close(ha.close, [10.5, 11.5, 10.25]);
    close(ha.open, [10.5, 10.5, 11]);
    close(ha.high, [12, 13, 12]);
    close(ha.low, [9, 10, 8]);
  });
});

describe('indicator transforms', () => {
  const rows = [
    { date: '2026-01-05', ticker: 'A', price: 1 },
    { date: '2026-01-05', ticker: 'B', price: 10 },
    { date: '2026-01-06', ticker: 'A', price: 3 },
    { date: '2026-01-06', ticker: 'B', price: 30 },
    { date: '2026-01-07', ticker: 'A', price: null },
    { date: '2026-01-07', ticker: 'B', price: 20 },
    { date: '2026-01-08', ticker: 'A', price: 5 },
  ];
  const table = Table.from(rows, { date: 'time' });

  it('keep every row and field, and add their columns', () => {
    const t = applyTransforms(table, [{ type: 'sma', field: 'price', period: 2, as: 'mm2', groupby: ['ticker'] }]);
    expect(t.length).toBe(7);
    expect(t.fields).toEqual(['date', 'ticker', 'price', 'mm2']);
    expect(t.column('date').type).toBe('time');
    expect(t.column('ticker').values[1]).toBe('B');
    // A: 1, 3, (missing, skipped), 5 → –, 2, –, 4 · B: 10, 30, 20 → –, 20, 25
    close(t.column('mm2').values as Float64Array, [NaN, NaN, 2, 20, NaN, 25, 4]);
  });

  it('chain: an average of an indicator, default output names', () => {
    const t = applyTransforms(Table.from({ columns: { v: [1, 2, 3, 4, 5, 7] } }), [
      { type: 'macd', field: 'v', fast: 2, slow: 3, signal: 2 },
      { type: 'ema', field: 'v', period: 3 },
      { type: 'rsi', field: 'v', period: 2 },
      { type: 'bollinger', field: 'v', period: 2, k: 1 },
    ]);
    expect(t.fields).toEqual(['v', 'macd', 'signal', 'histogram', 'ema', 'rsi', 'middle', 'upper', 'lower']);
    expect((t.column('rsi').values as Float64Array)[5]).toBe(100);
    // Window (5, 7): mean 6, sd 1.
    expect((t.column('upper').values as Float64Array)[5]).toBeCloseTo(7);
    expect((t.column('lower').values as Float64Array)[5]).toBeCloseTo(5);
  });

  it('heikinAshi replaces the four prices in place, or writes to `as`', () => {
    const ohlc = Table.from({ columns: { o: [10, 11], h: [12, 13], l: [9, 10], c: [11, 12] } });
    const inPlace = applyTransforms(ohlc, [{ type: 'heikinAshi', open: 'o', high: 'h', low: 'l', close: 'c' }]);
    expect(inPlace.fields).toEqual(['o', 'h', 'l', 'c']);
    close(inPlace.column('c').values as Float64Array, [10.5, 11.5]);
    close(inPlace.column('o').values as Float64Array, [10.5, 10.5]);
    const named = applyTransforms(ohlc, [{ type: 'heikinAshi', open: 'o', high: 'h', low: 'l', close: 'c', as: { close: 'hc' } }]);
    close(named.column('c').values as Float64Array, [11, 12]);
    close(named.column('hc').values as Float64Array, [10.5, 11.5]);
  });
});

describe('renko', () => {
  it('adds a brick per whole brick of travel, and reverses one brick under the last one', () => {
    const bricks = renkoBricks([100, 101.5, 104.2, 103, 99.9, 97.5, 102.1], 2);
    expect(bricks.map((b) => [b.from, b.to, b.row])).toEqual([
      [100, 102, 2],
      [102, 104, 2],
      // 103 is inside the last brick; 99.9 is a brick under its bottom (102).
      [102, 100, 4],
      [100, 98, 5],
      // Up again: a brick above the top (100) of the last falling brick.
      [100, 102, 6],
    ]);
    expect(bricks.map((b) => b.start)).toEqual([0, 0, 2, 4, 5]);
  });

  it('draws nothing while the price stays within a brick', () => {
    expect(renkoBricks([50, 50.4, 49.7, 50.9], 1)).toEqual([]);
    expect(renkoBricks([50, 60], 0)).toEqual([]);
  });

  it('keeps levels on multiples of the brick and skips missing prices', () => {
    const bricks = renkoBricks([NaN, 10.4, NaN, 13.1], 1);
    expect(bricks.map((b) => [b.from, b.to])).toEqual([[10, 11], [11, 12], [12, 13]]);
  });
});

describe('kagi', () => {
  const lines = kagiLines([100, 103, 106, 104, 101, 103, 108, 110, 107, 102, 99], 4);

  it('turns only when the price comes back by the reversal amount', () => {
    expect(lines.map((l) => [l.from, l.to, l.start, l.row])).toEqual([
      [100, 106, 0, 2],
      [106, 101, 2, 4],
      [101, 110, 4, 7],
      [110, 99, 7, 10],
    ]);
  });

  it('goes thin under the previous low, and thick above the previous high', () => {
    // First line up: yang. The fall to 101 stays above the start (100): still yang.
    expect(lines[0].parts).toEqual([{ from: 100, to: 106, yang: true }]);
    expect(lines[1].parts).toEqual([{ from: 106, to: 101, yang: true }]);
    expect(lines[2].parts).toEqual([{ from: 101, to: 110, yang: true }]);
    // The last fall crosses the previous low (101): yin from there.
    expect(lines[3].parts).toEqual([{ from: 110, to: 101, yang: true }, { from: 101, to: 99, yang: false }]);
    // And back: a yin rise turns yang where it passes the previous high.
    const back = kagiLines([50, 40, 45, 38, 47], 4);
    expect(back.map((l) => l.parts)).toEqual([
      [{ from: 50, to: 40, yang: false }],
      [{ from: 40, to: 45, yang: false }],
      [{ from: 45, to: 38, yang: false }],
      [{ from: 38, to: 45, yang: false }, { from: 45, to: 47, yang: true }],
    ]);
  });

  it('draws nothing under the reversal amount', () => {
    expect(kagiLines([10, 11, 9, 10], 5)).toEqual([]);
  });
});
