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
}

export interface LayerData {
  layer: LayerSpec;
  index: number;
  table: Table;
  series: SeriesData[];
  stacked: boolean;
  /** `series`: one color per series. `continuous`: color from a numeric field. */
  colorMode: 'series' | 'continuous';
  colorExtent: [number, number];
  sizeExtent: [number, number];
}

export interface PrepareContext {
  band: boolean;
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

export function prepareLayer(layer: LayerSpec, index: number, table: Table, ctx: PrepareContext): LayerData {
  const { encode } = layer;
  const xCol = table.column(encode.x);
  const yCol = table.column(encode.y);
  if (yCol.type === 'string') {
    throw new Error(`futurCharts: y field "${encode.y}" must be numeric (layer ${index}, mark "${layer.mark}").`);
  }
  const yVals = yCol.values as Float64Array;
  const colorCol = encode.color ? table.column(encode.color) : undefined;
  const sizeCol = encode.size ? table.column(encode.size) : undefined;
  const continuous = !!colorCol && colorCol.type !== 'string';

  const xOf = (i: number): number => {
    if (!ctx.band) return xCol.type === 'string' ? Number(xCol.values[i]) : (xCol.values[i] as number);
    const key = String(xCol.values[i]);
    let idx = ctx.categories.get(key);
    if (idx === undefined) {
      idx = ctx.categories.size;
      ctx.categories.set(key, idx);
    }
    return idx;
  };

  // Group rows into series, keeping first-appearance order.
  const defaultKey = layer.name ?? ctx.fields[encode.y]?.label ?? encode.y;
  const groups = new Map<string, number[]>();
  const xRaw = new Float64Array(table.length);
  const valid: number[] = [];
  for (let i = 0; i < table.length; i++) {
    const x = xOf(i);
    xRaw[i] = x;
    if (Number.isNaN(x) || Number.isNaN(yVals[i])) continue;
    valid.push(i);
    const key = colorCol && !continuous ? String(colorCol.values[i]) : defaultKey;
    let rows = groups.get(key);
    if (!rows) groups.set(key, (rows = []));
    rows.push(i);
  }

  const stacked = !!layer.stack;
  const acc = new Map<number, { pos: number; neg: number }>();
  const series: SeriesData[] = [];
  for (const [key, rows] of groups) {
    if (!ctx.band) rows.sort((a, b) => xRaw[a] - xRaw[b]);
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
        s.y0[j] = 0;
        s.y1[j] = v;
      }
    }
    series.push(s);
  }

  return {
    layer,
    index,
    table,
    series,
    stacked,
    colorMode: continuous ? 'continuous' : 'series',
    colorExtent: extent(continuous ? (colorCol!.values as Float64Array) : undefined, valid),
    sizeExtent: extent(sizeCol && sizeCol.type !== 'string' ? (sizeCol.values as Float64Array) : undefined, valid),
  };
}
