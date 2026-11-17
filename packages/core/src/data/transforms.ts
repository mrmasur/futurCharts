import { niceStep } from '../scale/scales';
import { Table, type ColumnType } from './table';

export type AggregateOp = 'count' | 'sum' | 'mean' | 'min' | 'max' | 'median';

/**
 * Presentation transforms, applied to a layer's table before it is drawn.
 * They are part of the spec, so they stay serializable. Heavy aggregation
 * belongs in the database: these exist for shaping what the chart shows
 * (binning a distribution, box-plot statistics, a running total).
 */
export type TransformSpec =
  | {
      /** Histogram bins: one row per bin (and per group), zero counts included. Outputs `bin_start`, `bin_end`, `bin_mid`, `count`. */
      type: 'bin';
      field: string;
      /** Target number of bins (rounded to a nice step). Default 20. */
      maxbins?: number;
      /** Exact bin width; overrides `maxbins`. */
      step?: number;
      groupby?: string[];
    }
  | {
      type: 'aggregate';
      groupby?: string[];
      ops: { op: AggregateOp; field?: string; as: string }[];
    }
  | {
      /** Per group: `lower`, `q1`, `median`, `q3`, `upper` (Tukey whiskers, 1.5 × IQR), `mean`, `count`. */
      type: 'boxplot';
      field: string;
      groupby?: string[];
    }
  | {
      /**
       * Running total for a waterfall: adds `start`, `end` and `kind`
       * (`increase`, `decrease` or `total`). Rows whose label is in `totals`
       * show the running total instead of adding to it.
       */
      type: 'waterfall';
      field: string;
      label: string;
      totals?: string[];
      /** Append a final total row with this label. */
      total?: string;
      /** Rename the three kinds (they become legend entries). */
      kinds?: { increase?: string; decrease?: string; total?: string };
    }
  | { type: 'sort'; field: string; order?: 'asc' | 'desc' }
  | {
      /** Least-squares line through (x, y): two rows at the ends of the x range. */
      type: 'regression';
      x: string;
      y: string;
      groupby?: string[];
    };

type Cell = number | string;

function cell(table: Table, field: string, i: number): Cell {
  const c = table.column(field);
  return c.values[i] as Cell;
}

function numeric(table: Table, field: string): Float64Array {
  const c = table.column(field);
  if (c.type === 'string') throw new Error(`futurCharts: transform field "${field}" must be numeric.`);
  return c.values as Float64Array;
}

/** Group rows by the values of `fields`, in first-seen order. */
function groups(table: Table, fields: string[] = []): { keys: Cell[]; rows: number[] }[] {
  const out = new Map<string, { keys: Cell[]; rows: number[] }>();
  for (let i = 0; i < table.length; i++) {
    const keys = fields.map((f) => cell(table, f, i));
    const id = keys.join('\u0000');
    let g = out.get(id);
    if (!g) out.set(id, (g = { keys, rows: [] }));
    g.rows.push(i);
  }
  if (table.length === 0 && fields.length === 0) return [];
  return [...out.values()];
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (h - lo);
}

/** Build a table from column arrays, keeping the source types of carried-over fields. */
function output(source: Table, columns: Record<string, Cell[]>): Table {
  const types: Record<string, ColumnType> = {};
  for (const name of Object.keys(columns)) {
    if (source.has(name)) types[name] = source.column(name).type;
  }
  return Table.from({ columns }, types);
}

function aggregate(values: number[], op: AggregateOp): number {
  const v = values.filter((x) => !Number.isNaN(x));
  switch (op) {
    case 'count':
      return values.length;
    case 'sum':
      return v.reduce((a, b) => a + b, 0);
    case 'mean':
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
    case 'min':
      return v.length ? Math.min(...v) : NaN;
    case 'max':
      return v.length ? Math.max(...v) : NaN;
    case 'median':
      return quantile(v.sort((a, b) => a - b), 0.5);
  }
}

export function applyTransform(table: Table, t: TransformSpec): Table {
  switch (t.type) {
    case 'bin': {
      const values = numeric(table, t.field);
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of values) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (lo > hi) return output(table, { bin_start: [], bin_end: [], bin_mid: [], count: [] });
      const step = t.step ?? niceStep(hi - lo || 1, t.maxbins ?? 20);
      const start = Math.floor(lo / step) * step;
      const n = Math.max(1, Math.floor((hi - start) / step) + 1);
      const cols: Record<string, Cell[]> = Object.fromEntries((t.groupby ?? []).map((f) => [f, []]));
      Object.assign(cols, { bin_start: [], bin_end: [], bin_mid: [], count: [] });
      for (const g of groups(table, t.groupby)) {
        const counts = new Array<number>(n).fill(0);
        for (const r of g.rows) {
          const v = values[r];
          if (!Number.isNaN(v)) counts[Math.min(n - 1, Math.floor((v - start) / step))]++;
        }
        for (let b = 0; b < n; b++) {
          (t.groupby ?? []).forEach((f, k) => cols[f].push(g.keys[k]));
          const s = start + b * step;
          cols.bin_start.push(s);
          cols.bin_end.push(s + step);
          cols.bin_mid.push(s + step / 2);
          cols.count.push(counts[b]);
        }
      }
      return output(table, cols);
    }
    case 'aggregate': {
      const cols: Record<string, Cell[]> = Object.fromEntries((t.groupby ?? []).map((f) => [f, []]));
      for (const o of t.ops) cols[o.as] = [];
      for (const g of groups(table, t.groupby)) {
        (t.groupby ?? []).forEach((f, k) => cols[f].push(g.keys[k]));
        for (const o of t.ops) {
          const values = o.field ? numeric(table, o.field) : undefined;
          cols[o.as].push(aggregate(g.rows.map((r) => (values ? values[r] : 1)), o.op));
        }
      }
      return output(table, cols);
    }
    case 'boxplot': {
      const values = numeric(table, t.field);
      const names = ['lower', 'q1', 'median', 'q3', 'upper', 'mean', 'count'];
      const cols: Record<string, Cell[]> = Object.fromEntries([...(t.groupby ?? []), ...names].map((f) => [f, []]));
      for (const g of groups(table, t.groupby)) {
        const v = g.rows.map((r) => values[r]).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
        const q1 = quantile(v, 0.25);
        const q3 = quantile(v, 0.75);
        const iqr = q3 - q1;
        const lower = v.find((x) => x >= q1 - 1.5 * iqr) ?? NaN;
        const upper = [...v].reverse().find((x) => x <= q3 + 1.5 * iqr) ?? NaN;
        (t.groupby ?? []).forEach((f, k) => cols[f].push(g.keys[k]));
        const stats = [lower, q1, quantile(v, 0.5), q3, upper, aggregate(v, 'mean'), v.length];
        names.forEach((n, k) => cols[n].push(stats[k]));
      }
      return output(table, cols);
    }
    case 'waterfall': {
      const values = numeric(table, t.field);
      const totals = new Set(t.totals ?? []);
      const kind = { increase: 'increase', decrease: 'decrease', total: 'total', ...t.kinds };
      const cols: Record<string, Cell[]> = { [t.label]: [], [t.field]: [], start: [], end: [], kind: [] };
      let running = 0;
      const push = (label: Cell, value: number, start: number, end: number, k: string) => {
        cols[t.label].push(label);
        cols[t.field].push(value);
        cols.start.push(start);
        cols.end.push(end);
        cols.kind.push(k);
      };
      for (let i = 0; i < table.length; i++) {
        const label = cell(table, t.label, i);
        const v = values[i];
        if (totals.has(String(label))) {
          push(label, running, 0, running, kind.total);
        } else {
          push(label, v, running, running + v, v >= 0 ? kind.increase : kind.decrease);
          running += v;
        }
      }
      if (t.total) push(t.total, running, 0, running, kind.total);
      return output(table, cols);
    }
    case 'sort': {
      const c = table.column(t.field);
      const dir = t.order === 'desc' ? -1 : 1;
      const order = Array.from({ length: table.length }, (_, i) => i).sort((a, b) => {
        const va = c.values[a];
        const vb = c.values[b];
        return (typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb))) * dir;
      });
      const cols: Record<string, Cell[]> = {};
      for (const f of table.fields) cols[f] = order.map((i) => table.column(f).values[i] as Cell);
      return output(table, cols);
    }
    case 'regression': {
      const xs = numeric(table, t.x);
      const ys = numeric(table, t.y);
      const cols: Record<string, Cell[]> = Object.fromEntries([...(t.groupby ?? []), t.x, t.y].map((f) => [f, []]));
      for (const g of groups(table, t.groupby)) {
        let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, lo = Infinity, hi = -Infinity;
        for (const r of g.rows) {
          const x = xs[r];
          const y = ys[r];
          if (Number.isNaN(x) || Number.isNaN(y)) continue;
          n++;
          sx += x;
          sy += y;
          sxx += x * x;
          sxy += x * y;
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
        const den = n * sxx - sx * sx;
        if (n < 2 || den === 0) continue;
        const slope = (n * sxy - sx * sy) / den;
        const icept = (sy - slope * sx) / n;
        for (const x of [lo, hi]) {
          (t.groupby ?? []).forEach((f, k) => cols[f].push(g.keys[k]));
          cols[t.x].push(x);
          cols[t.y].push(icept + slope * x);
        }
      }
      return output(table, cols);
    }
  }
}

export function applyTransforms(table: Table, transforms: TransformSpec[] | undefined): Table {
  return (transforms ?? []).reduce(applyTransform, table);
}
