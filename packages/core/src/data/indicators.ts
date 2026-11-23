/**
 * Technical analysis indicators: pure functions over a price series, and their
 * spec form (`layer.transform`). Each transform keeps every row and field of the
 * table and adds columns; the first rows, where a window is not full yet, hold
 * NaN (a line starts where its indicator does). Rows are read in table order:
 * sort by date first if the source is not ordered.
 */
import { Table, type ColumnType } from './table';

export type IndicatorSpec =
  | {
      /** Simple moving average of `field` over `period` rows. Outputs `as` (default `sma`). */
      type: 'sma';
      field: string;
      /** Window, in rows. Default 20. */
      period?: number;
      as?: string;
      /** One independent series per group (several tickers in one table). */
      groupby?: string[];
    }
  | {
      /**
       * Exponential moving average of `field` (weight 2 / (period + 1) on the latest row),
       * seeded with the simple average of the first `period` rows. Outputs `as` (default `ema`).
       */
      type: 'ema';
      field: string;
      /** Default 20. */
      period?: number;
      as?: string;
      groupby?: string[];
    }
  | {
      /**
       * Bollinger bands of `field`: `middle` (moving average over `period` rows), `upper` and
       * `lower` (`k` standard deviations of the same window above and below).
       */
      type: 'bollinger';
      field: string;
      /** Default 20. */
      period?: number;
      /** Width of the bands, in standard deviations. Default 2. */
      k?: number;
      /** Rename the three outputs. */
      as?: { middle?: string; upper?: string; lower?: string };
      groupby?: string[];
    }
  | {
      /**
       * Relative strength index of `field` (Wilder's smoothing), from 0 to 100: above 70 the
       * price ran up fast, under 30 it fell fast. Outputs `as` (default `rsi`).
       */
      type: 'rsi';
      field: string;
      /** Default 14. */
      period?: number;
      as?: string;
      groupby?: string[];
    }
  | {
      /**
       * Moving average convergence / divergence of `field`: `macd` (fast EMA minus slow EMA),
       * `signal` (EMA of that line) and `histogram` (their difference).
       */
      type: 'macd';
      field: string;
      /** Default 12. */
      fast?: number;
      /** Default 26. */
      slow?: number;
      /** Default 9. */
      signal?: number;
      /** Rename the three outputs. */
      as?: { macd?: string; signal?: string; histogram?: string };
      groupby?: string[];
    }
  | {
      /**
       * Heikin-Ashi candles: averaged prices that smooth the noise of a trend. The four fields
       * are replaced in place (the same `candlestick` encoding then draws them), unless `as`
       * names other outputs.
       */
      type: 'heikinAshi';
      open: string;
      high: string;
      low: string;
      close: string;
      as?: { open?: string; high?: string; low?: string; close?: string };
      groupby?: string[];
    };

type Series = ArrayLike<number>;

const span = (period: number | undefined, fallback: number) => Math.max(1, Math.round(period ?? fallback));

/** Simple moving average: NaN until `period` values are in. */
export function sma(values: Series, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the simple average of the first `period` values. */
export function ema(values: Series, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (n < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) out[i] = prev = values[i] * k + prev * (1 - k);
  return out;
}

/** Bollinger bands: moving average, and `k` population standard deviations of the window around it. */
export function bollinger(values: Series, period = 20, k = 2): { middle: Float64Array; upper: Float64Array; lower: Float64Array } {
  const n = values.length;
  const middle = sma(values, period);
  const upper = new Float64Array(n).fill(NaN);
  const lower = new Float64Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let ss = 0;
    for (let j = i - period + 1; j <= i; j++) ss += (values[j] - middle[i]) ** 2;
    const sd = Math.sqrt(ss / period);
    upper[i] = middle[i] + k * sd;
    lower[i] = middle[i] - k * sd;
  }
  return { middle, upper, lower };
}

/** Relative strength index with Wilder's smoothing: defined from row `period` on. */
export function rsi(values: Series, period = 14): Float64Array {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  if (n <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const index = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = index();
  for (let i = period + 1; i < n; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = index();
  }
  return out;
}

/** MACD line (fast EMA - slow EMA), its signal line (EMA of the MACD) and their difference. */
export function macd(values: Series, fast = 12, slow = 26, signal = 9): { macd: Float64Array; signal: Float64Array; histogram: Float64Array } {
  const n = values.length;
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = new Float64Array(n).fill(NaN);
  const start = Math.max(fast, slow) - 1;
  for (let i = start; i < n; i++) line[i] = f[i] - s[i];
  const sig = new Float64Array(n).fill(NaN);
  if (n > start) sig.set(ema(line.subarray(start), signal), start);
  const histogram = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) histogram[i] = line[i] - sig[i];
  return { macd: line, signal: sig, histogram };
}

/**
 * Heikin-Ashi candles: close = mean of the four prices; open = middle of the previous
 * Heikin-Ashi body; high and low stretched to include both.
 */
export function heikinAshi(open: Series, high: Series, low: Series, close: Series): { open: Float64Array; high: Float64Array; low: Float64Array; close: Float64Array } {
  const n = close.length;
  const o = new Float64Array(n);
  const h = new Float64Array(n);
  const l = new Float64Array(n);
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    c[i] = (open[i] + high[i] + low[i] + close[i]) / 4;
    o[i] = i === 0 ? (open[0] + close[0]) / 2 : (o[i - 1] + c[i - 1]) / 2;
    h[i] = Math.max(high[i], o[i], c[i]);
    l[i] = Math.min(low[i], o[i], c[i]);
  }
  return { open: o, high: h, low: l, close: c };
}

function numeric(table: Table, field: string): Float64Array {
  const c = table.column(field);
  if (c.type === 'string') throw new Error(`futurCharts: transform field "${field}" must be numeric.`);
  return c.values as Float64Array;
}

/** Row indices of each group, in table order (one group of every row without `fields`). */
function groupRows(table: Table, fields: string[] | undefined): number[][] {
  if (!fields?.length) return [Array.from({ length: table.length }, (_, i) => i)];
  const cols = fields.map((f) => table.column(f).values);
  const out = new Map<string, number[]>();
  for (let i = 0; i < table.length; i++) {
    const id = cols.map((c) => c[i]).join('\u0000');
    let g = out.get(id);
    if (!g) out.set(id, (g = []));
    g.push(i);
  }
  return [...out.values()];
}

/**
 * Run `compute` on each group's rows that have every input (a missing price is
 * skipped, its outputs stay NaN), and write the results back at their rows.
 */
function perGroup(table: Table, groupby: string[] | undefined, inputs: string[], outputs: string[], compute: (...series: Float64Array[]) => Float64Array[]): Table {
  const ins = inputs.map((f) => numeric(table, f));
  const outs = outputs.map(() => new Float64Array(table.length).fill(NaN));
  for (const group of groupRows(table, groupby)) {
    const rows = group.filter((r) => ins.every((v) => !Number.isNaN(v[r])));
    const res = compute(...ins.map((v) => Float64Array.from(rows, (r) => v[r])));
    res.forEach((values, k) => rows.forEach((r, j) => (outs[k][r] = values[j])));
  }
  const columns: Record<string, Float64Array | string[]> = {};
  const types: Record<string, ColumnType> = {};
  for (const f of table.fields) {
    const c = table.column(f);
    columns[f] = c.values;
    types[f] = c.type;
  }
  outputs.forEach((name, k) => {
    columns[name] = outs[k];
    // An output that replaces a field keeps its type; a new one is a number.
    types[name] = table.has(name) && table.column(name).type !== 'string' ? table.column(name).type : 'number';
  });
  return Table.from({ columns }, types);
}

export function applyIndicator(table: Table, t: IndicatorSpec): Table {
  switch (t.type) {
    case 'sma':
      return perGroup(table, t.groupby, [t.field], [t.as ?? 'sma'], (v) => [sma(v, span(t.period, 20))]);
    case 'ema':
      return perGroup(table, t.groupby, [t.field], [t.as ?? 'ema'], (v) => [ema(v, span(t.period, 20))]);
    case 'bollinger':
      return perGroup(table, t.groupby, [t.field], [t.as?.middle ?? 'middle', t.as?.upper ?? 'upper', t.as?.lower ?? 'lower'], (v) => {
        const b = bollinger(v, span(t.period, 20), t.k ?? 2);
        return [b.middle, b.upper, b.lower];
      });
    case 'rsi':
      return perGroup(table, t.groupby, [t.field], [t.as ?? 'rsi'], (v) => [rsi(v, span(t.period, 14))]);
    case 'macd':
      return perGroup(table, t.groupby, [t.field], [t.as?.macd ?? 'macd', t.as?.signal ?? 'signal', t.as?.histogram ?? 'histogram'], (v) => {
        const m = macd(v, span(t.fast, 12), span(t.slow, 26), span(t.signal, 9));
        return [m.macd, m.signal, m.histogram];
      });
    case 'heikinAshi':
      return perGroup(
        table,
        t.groupby,
        [t.open, t.high, t.low, t.close],
        [t.as?.open ?? t.open, t.as?.high ?? t.high, t.as?.low ?? t.low, t.as?.close ?? t.close],
        (o, h, l, c) => {
          const ha = heikinAshi(o, h, l, c);
          return [ha.open, ha.high, ha.low, ha.close];
        },
      );
  }
}
