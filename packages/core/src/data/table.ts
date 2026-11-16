export type ColumnType = 'number' | 'time' | 'string';

export interface Column {
  name: string;
  type: ColumnType;
  /** Numbers and timestamps (epoch ms) are typed arrays; strings are plain arrays. */
  values: Float64Array | string[];
}

export type Row = Record<string, unknown>;
export type ColumnInput = ArrayLike<number | string | Date | null | undefined>;

/**
 * Chart input. Columnar is the native form (what ClickHouse/Arrow produce);
 * rows are accepted for convenience and converted once.
 */
export type DataInput = Row[] | { columns: Record<string, ColumnInput> } | Table;

function infer(sample: unknown): ColumnType {
  if (sample instanceof Date) return 'time';
  if (typeof sample === 'number' || typeof sample === 'bigint') return 'number';
  return 'string';
}

function build(name: string, n: number, get: (i: number) => unknown, forced?: ColumnType): Column {
  let type = forced;
  if (!type) {
    type = 'string';
    for (let i = 0; i < n; i++) {
      const v = get(i);
      if (v !== null && v !== undefined) {
        type = infer(v);
        break;
      }
    }
  }
  if (type === 'string') {
    const values = new Array<string>(n);
    for (let i = 0; i < n; i++) {
      const v = get(i);
      values[i] = v === null || v === undefined ? '' : String(v);
    }
    return { name, type, values };
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = get(i);
    if (v === null || v === undefined || v === '') values[i] = NaN;
    else if (v instanceof Date) values[i] = v.getTime();
    else if (type === 'time' && typeof v === 'string') values[i] = Date.parse(v);
    else values[i] = Number(v);
  }
  return { name, type, values };
}

export class Table {
  private constructor(readonly length: number, private cols: Map<string, Column>) {}

  static from(input: DataInput, types: Record<string, ColumnType | undefined> = {}): Table {
    if (input instanceof Table) return input;
    const cols = new Map<string, Column>();
    if (Array.isArray(input)) {
      const names = new Set<string>();
      for (let i = 0; i < Math.min(input.length, 50); i++) for (const k of Object.keys(input[i])) names.add(k);
      for (const name of names) cols.set(name, build(name, input.length, (i) => input[i][name], types[name]));
      return new Table(input.length, cols);
    }
    let n = 0;
    for (const [name, arr] of Object.entries(input.columns)) {
      n = Math.max(n, arr.length);
      if (arr instanceof Float64Array && !types[name]) {
        cols.set(name, { name, type: 'number', values: arr });
      } else {
        cols.set(name, build(name, arr.length, (i) => arr[i], types[name]));
      }
    }
    return new Table(n, cols);
  }

  has(name: string): boolean {
    return this.cols.has(name);
  }

  column(name: string): Column {
    const c = this.cols.get(name);
    if (!c) {
      throw new Error(`futurCharts: unknown field "${name}". Available: ${[...this.cols.keys()].join(', ')}`);
    }
    return c;
  }

  get fields(): string[] {
    return [...this.cols.keys()];
  }

  /** One row as an object (tooltips, events). */
  row(i: number): Row {
    const out: Row = {};
    for (const c of this.cols.values()) {
      const v = c.values[i];
      out[c.name] = c.type === 'time' ? new Date(v as number) : v;
    }
    return out;
  }
}
