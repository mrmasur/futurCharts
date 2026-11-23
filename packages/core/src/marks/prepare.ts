import type { Table } from '../data/table';
import type { FieldSpec, LayerSpec } from '../spec/types';

/** One series of a layer, in raw data units (before any scale). */
export interface SeriesData {
  /** Series identity: drives the color slot and the legend entry. */
  key: string;
  hidden: boolean;
  /** Raw x: number, epoch ms, or category index on a band scale. */
  x: Float64Array;
  /** Stacked extent; `y1` is the data end, `y0` the baseline end. */
  y0: Float64Array;
  y1: Float64Array;
  /** Unstacked y value. */
  value: Float64Array;
  /** Source row index in the layer table. */
  rows: Int32Array;
  colorValue?: Float64Array;
  sizeValue?: Float64Array;
  /** `breaks[j] = 1`: a missing value lies between points j - 1 and j (lines and areas break there). */
  breaks?: Uint8Array;
}

export interface LayerData {
  layer: LayerSpec;
  index: number;
  table: Table;
  series: SeriesData[];
  stacked: boolean;
  /** Values come with an explicit start (`y2` / `x2`): ranges, not bars from zero. */
  ranged: boolean;
  /** How stacks are offset. */
  stackMode: 'zero' | 'normalize' | 'center';
  /** `series`: one color per series. `continuous`: color from a numeric field. */
  colorMode: 'series' | 'continuous';
  colorExtent: [number, number];
  sizeExtent: [number, number];
}

export interface PrepareContext {
  band: boolean;
  /**
   * The band axis is an ordinal axis of dates (`scales.x.type: 'band'` over a time field): `categories`
   * already lists them in chronological order, and each series is drawn in that order.
   */
  dates?: boolean;
  /** Categories on y, values on x. */
  horizontal: boolean;
  /** Shared category -> index map of the x band scale (filled as layers are prepared). */
  categories: Map<string, number>;
  fields: Record<string, FieldSpec>;
  hidden: Set<string>;
}

function extent(values: Float64Array | undefined, rows: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  if (values) {
    for (const r of rows) {
      const v = values[r];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** Layer data of a standalone mark: no series, just the layer and its table. */
export function standaloneLayer(layer: LayerSpec, index: number, table: Table): LayerData {
  return { layer, index, table, series: [], stacked: false, ranged: false, stackMode: 'zero', colorMode: 'series', colorExtent: [0, 1], sizeExtent: [0, 1] };
}

export function prepareLayer(layer: LayerSpec, index: number, table: Table, ctx: PrepareContext): LayerData {
  const { encode } = layer;
  if (!encode.x || !encode.y) {
    throw new Error(`futurCharts: mark "${layer.mark}" (layer ${index}) needs both an x and a y encoding.`);
  }
  // Categories run along x, values along y — or the reverse for a horizontal chart.
  const catField = ctx.horizontal ? encode.y : encode.x;
  const valField = ctx.horizontal ? encode.x : encode.y;
  const val2Field = ctx.horizontal ? encode.x2 : encode.y2;
  const xCol = table.column(catField);
  const yCol = table.column(valField);
  if (yCol.type === 'string') {
    throw new Error(`futurCharts: field "${valField}" must be numeric (layer ${index}, mark "${layer.mark}").`);
  }
  const yVals = yCol.values as Float64Array;
  const y2Col = val2Field ? table.column(val2Field) : undefined;
  if (y2Col?.type === 'string') throw new Error(`futurCharts: field "${val2Field}" must be numeric (layer ${index}).`);
  const y2Vals = y2Col?.values as Float64Array | undefined;
  const colorCol = encode.color ? table.column(encode.color) : undefined;
  const sizeCol = encode.size ? table.column(encode.size) : undefined;
  const continuous = !!colorCol && colorCol.type !== 'string';

  const xOf = (i: number): number => {
    if (!ctx.band) return xCol.type === 'string' ? Number(xCol.values[i]) : (xCol.values[i] as number);
    // A row without a date has no place on an axis of dates.
    if (ctx.dates && !Number.isFinite(xCol.values[i] as number)) return NaN;
    const key = String(xCol.values[i]);
    let idx = ctx.categories.get(key);
    if (idx === undefined) {
      idx = ctx.categories.size;
      ctx.categories.set(key, idx);
    }
    return idx;
  };

  // Group rows into series, keeping first-appearance order.
  const defaultKey = layer.name ?? ctx.fields[valField]?.label ?? valField;
  const groups = new Map<string, number[]>();
  const xRaw = new Float64Array(table.length);
  const valid: number[] = [];
  // Rows with an x but no value: a line breaks there (unless `connectNulls`).
  const missing = new Map<string, number[]>();
  const keepGaps = !(layer.style as { connectNulls?: boolean } | undefined)?.connectNulls;
  for (let i = 0; i < table.length; i++) {
    const x = xOf(i);
    xRaw[i] = x;
    if (keepGaps && !Number.isNaN(x) && Number.isNaN(yVals[i])) {
      const key = colorCol && !continuous ? String(colorCol.values[i]) : defaultKey;
      let m = missing.get(key);
      if (!m) missing.set(key, (m = []));
      m.push(x);
    }
    if (Number.isNaN(x) || Number.isNaN(yVals[i]) || (y2Vals && Number.isNaN(y2Vals[i]))) continue;
    valid.push(i);
    const key = colorCol && !continuous ? String(colorCol.values[i]) : defaultKey;
    let rows = groups.get(key);
    if (!rows) groups.set(key, (rows = []));
    rows.push(i);
  }

  const ranged = !!y2Vals;
  const stacked = !!layer.stack && !ranged;
  const acc = new Map<number, { pos: number; neg: number }>();
  const series: SeriesData[] = [];
  for (const [key, rows] of groups) {
    if (!ctx.band || ctx.dates) rows.sort((a, b) => xRaw[a] - xRaw[b]);
    const n = rows.length;
    const hidden = ctx.hidden.has(key);
    const s: SeriesData = {
      key,
      hidden,
      x: new Float64Array(n),
      y0: new Float64Array(n),
      y1: new Float64Array(n),
      value: new Float64Array(n),
      rows: Int32Array.from(rows),
    };
    const gaps = missing.get(key);
    if (gaps) {
      s.breaks = new Uint8Array(n);
      for (let j = 1; j < n; j++) {
        const a = xRaw[rows[j - 1]];
        const b = xRaw[rows[j]];
        if (gaps.some((g) => g > a && g < b)) s.breaks[j] = 1;
      }
    }
    if (continuous) s.colorValue = new Float64Array(n);
    if (sizeCol && sizeCol.type !== 'string') s.sizeValue = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const r = rows[j];
      const v = yVals[r];
      s.x[j] = xRaw[r];
      s.value[j] = v;
      if (s.colorValue) s.colorValue[j] = colorCol!.values[r] as number;
      if (s.sizeValue) s.sizeValue[j] = sizeCol!.values[r] as number;
      if (stacked && !hidden) {
        let a = acc.get(xRaw[r]);
        if (!a) acc.set(xRaw[r], (a = { pos: 0, neg: 0 }));
        if (v >= 0) {
          s.y0[j] = a.pos;
          s.y1[j] = a.pos += v;
        } else {
          s.y0[j] = a.neg;
          s.y1[j] = a.neg += v;
        }
      } else {
        s.y0[j] = y2Vals ? y2Vals[r] : 0;
        s.y1[j] = v;
      }
    }
    series.push(s);
  }

  // Normalized and centered stacks: rescale or shift each stack once all series are in.
  const stackMode = layer.stack === 'normalize' || layer.stack === 'center' ? layer.stack : 'zero';
  if (stacked && stackMode !== 'zero') {
    for (const s of series) {
      if (s.hidden) continue;
      for (let j = 0; j < s.x.length; j++) {
        const a = acc.get(s.x[j])!;
        const total = a.pos - a.neg;
        if (stackMode === 'normalize') {
          const k = total > 0 ? 1 / total : 0;
          // Negative parts are stacked under the positive ones, all within [0, 1].
          s.y0[j] = (s.y0[j] - a.neg) * k;
          s.y1[j] = (s.y1[j] - a.neg) * k;
        } else {
          s.y0[j] -= (a.pos + a.neg) / 2;
          s.y1[j] -= (a.pos + a.neg) / 2;
        }
      }
    }
  }

  return {
    layer,
    index,
    table,
    series,
    stacked,
    ranged,
    stackMode,
    colorMode: continuous ? 'continuous' : 'series',
    colorExtent: extent(continuous ? (colorCol!.values as Float64Array) : undefined, valid),
    sizeExtent: extent(sizeCol && sizeCol.type !== 'string' ? (sizeCol.values as Float64Array) : undefined, valid),
  };
}
