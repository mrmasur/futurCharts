export type ColumnType = 'number' | 'time' | 'string';

export interface Column {
  name: string;
  type: ColumnType;
  /** Numbers and timestamps (epoch ms) are typed arrays; strings are plain arrays. */
  values: Float64Array | string[];
}

export type Row = Record<string, unknown>;
export type ColumnInput = ArrayLike<number | string | Date | null | undefined>;

/** Type of an Arrow field, read by its shape (`apache-arrow`'s `DataType`): no import of the library. */
export interface ArrowTypeLike {
  /** Arrow's `Type` enum: 2 Int, 3 Float, 5 Utf8, 6 Bool, 7 Decimal, 8 Date, 10 Timestamp, -1 Dictionary… */
  typeId: number;
  /** Timestamp: 0 s, 1 ms, 2 µs, 3 ns. Date: 0 days, 1 ms. */
  unit?: number;
  /** Decimal: 128 or 256. */
  bitWidth?: number;
  /** Decimal: digits after the point. */
  scale?: number;
  /** Float: 0 half, 1 single, 2 double. */
  precision?: number;
  /** Dictionary: type of the decoded values. */
  dictionary?: ArrowTypeLike;
}

export interface ArrowFieldLike {
  name: string;
  type: ArrowTypeLike;
  /** Field metadata (`label`, `description`, `format`), read by `fromArrow` in `@futurcharts/adapters`. */
  metadata?: Map<string, string>;
}

/** One Arrow column (`apache-arrow`'s `Vector`). */
export interface ArrowVectorLike {
  length: number;
  nullCount: number;
  /** Decoded value of a row, `null` for a null. */
  get(index: number): unknown;
  /** Every value: a typed array for numbers (the Arrow buffer itself when the column is one chunk), a plain array otherwise. */
  toArray(): unknown;
}

/**
 * An Apache Arrow table, recognised by its shape so that the core depends on nothing: a `Table` of
 * `apache-arrow` (what `tableFromIPC` returns for a ClickHouse `FORMAT Arrow` / `ArrowStream` response) fits.
 *
 * How columns are read:
 * - Float64 without null: the Arrow buffer is used as is, no copy. Other integers and floats, Int64 / UInt64
 *   (exact up to 2^53) and Decimal128 / 256 (as doubles) are converted once; nulls become `NaN`.
 * - Date32, Date64 and Timestamp (s, ms, µs, ns) become epoch milliseconds, type `time`. A timestamp is an
 *   instant: it is drawn in the browser's time zone, like a `Date`.
 * - Utf8, LargeUtf8 and dictionaries of strings become strings; a null is the empty string.
 * - Booleans become the strings `true` / `false` (a category, as with rows); declare the field
 *   `type: 'number'` in the catalog to get 0 / 1 instead.
 * - Anything else (lists, structs, binary…) is written as text.
 * A type declared in `spec.fields` wins over the Arrow type.
 */
export interface ArrowTableLike {
  schema: { fields: ArrowFieldLike[] };
  numRows?: number;
  getChild(name: string): ArrowVectorLike | null;
}

/**
 * Chart input. Columnar is the native form (what ClickHouse/Arrow produce);
 * rows are accepted for convenience and converted once.
 */
export type DataInput = Row[] | { columns: Record<string, ColumnInput> } | Table | ArrowTableLike;

function infer(sample: unknown): ColumnType {
  if (sample instanceof Date) return 'time';
  if (typeof sample === 'number' || typeof sample === 'bigint') return 'number';
  return 'string';
}

function build(name: string, n: number, get: (i: number) => unknown, forced?: ColumnType): Column {
  let type = forced;
  if (!type) {
    // A column with no value at all (no rows, or only holes) is numeric: an empty string column would
    // stop every mark that needs a number, while an empty numeric one simply draws nothing.
    type = 'number';
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

export function isArrowTable(input: unknown): input is ArrowTableLike {
  const t = input as ArrowTableLike | null;
  return !!t && typeof t === 'object' && typeof t.getChild === 'function' && Array.isArray(t.schema?.fields);
}

/** Arrow `Type` ids used below. */
const A_INT = 2, A_FLOAT = 3, A_UTF8 = 5, A_BOOL = 6, A_DECIMAL = 7, A_DATE = 8, A_TIME = 9, A_TIMESTAMP = 10, A_DURATION = 18, A_LARGE_UTF8 = 20, A_DICTIONARY = -1, A_NULL = 1;

type ArrowKind = 'number' | 'decimal' | 'date' | 'timestamp' | 'bool' | 'string';

function arrowKind(type: ArrowTypeLike): ArrowKind {
  switch (type.typeId) {
    case A_DICTIONARY:
      return type.dictionary ? arrowKind(type.dictionary) : 'string';
    case A_INT:
    case A_FLOAT:
    case A_TIME:
    case A_DURATION:
    case A_NULL:
      return 'number';
    case A_DECIMAL:
      return 'decimal';
    case A_DATE:
      return 'date';
    case A_TIMESTAMP:
      return 'timestamp';
    case A_BOOL:
      return 'bool';
    case A_UTF8:
    case A_LARGE_UTF8:
    default:
      return 'string';
  }
}

const isBigArray = (a: unknown): a is BigInt64Array | BigUint64Array => a instanceof BigInt64Array || a instanceof BigUint64Array;
const isNumberArray = (a: unknown): a is ArrayLike<number> => ArrayBuffer.isView(a) && !(a instanceof DataView) && !isBigArray(a);

/** A decoded Arrow value as a number: bigint, Date, null and booleans included. */
function toNumber(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (v instanceof Date) return v.getTime();
  return Number(v);
}

/** Decimal128 / 256: little-endian 32-bit words, two's complement, `stride` words per value. */
function decimals(words: Uint32Array, n: number, stride: number, scale: number): Float64Array {
  const out = new Float64Array(n);
  const div = 10 ** scale;
  for (let i = 0; i < n; i++) {
    const at = i * stride;
    const negative = words[at + stride - 1] >>> 31 === 1;
    let v = 0;
    // A negative value is -(~x + 1): summing the inverted words keeps the precision of small magnitudes.
    for (let k = stride - 1; k >= 0; k--) v = v * 4294967296 + (negative ? ~words[at + k] >>> 0 : words[at + k]);
    out[i] = (negative ? -(v + 1) : v) / div;
  }
  return out;
}

function arrowNumbers(vec: ArrowVectorLike, type: ArrowTypeLike, kind: ArrowKind, n: number): Float64Array {
  const raw = vec.toArray();
  const value = type.typeId === A_DICTIONARY && type.dictionary ? type.dictionary : type;
  let out: Float64Array | undefined;
  if (kind === 'number') {
    const half = value.typeId === A_FLOAT && value.precision === 0; // Float16 comes out as raw bits
    if (raw instanceof Float64Array) {
      if (vec.nullCount === 0) return raw; // zero copy
      out = Float64Array.from(raw);
    } else if (isNumberArray(raw) && !half) out = Float64Array.from(raw);
    else if (isBigArray(raw)) {
      out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = Number(raw[i]);
    }
  } else if (kind === 'decimal' && raw instanceof Uint32Array && value.bitWidth && raw.length === n * (value.bitWidth / 32)) {
    out = decimals(raw, n, value.bitWidth / 32, value.scale ?? 0);
  } else if (kind === 'timestamp' && isBigArray(raw)) {
    out = new Float64Array(n);
    const unit = value.unit ?? 1;
    if (unit === 0) for (let i = 0; i < n; i++) out[i] = Number(raw[i]) * 1000;
    else if (unit === 1) for (let i = 0; i < n; i++) out[i] = Number(raw[i]);
    else if (unit === 2) for (let i = 0; i < n; i++) out[i] = Number(raw[i]) / 1000;
    // Nanoseconds leave the exact range of a double after 104 days: divide as integers first.
    else for (let i = 0; i < n; i++) out[i] = Number(raw[i] / 1000000n);
  } else if (Array.isArray(raw) && raw.length === n) {
    // Already decoded, nulls included (dates, dictionaries).
    out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = toNumber(raw[i]);
    return out;
  }
  if (!out) {
    // Unknown layout (another version of the library): one decoded value at a time.
    out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = toNumber(vec.get(i));
    return out;
  }
  if (vec.nullCount > 0) for (let i = 0; i < n; i++) if (vec.get(i) === null) out[i] = NaN;
  return out;
}

function arrowColumn(name: string, vec: ArrowVectorLike, type: ArrowTypeLike, n: number, forced?: ColumnType): Column {
  const kind = arrowKind(type);
  const natural: ColumnType = kind === 'date' || kind === 'timestamp' ? 'time' : kind === 'bool' || kind === 'string' ? 'string' : 'number';
  if (forced && forced !== natural) {
    if (forced !== 'string' && kind !== 'string' && kind !== 'bool') return { name, type: forced, values: arrowNumbers(vec, type, kind, n) };
    return build(name, n, (i) => { const v = vec.get(i); return typeof v === 'bigint' || typeof v === 'boolean' ? Number(v) : v; }, forced);
  }
  if (natural !== 'string') return { name, type: natural, values: arrowNumbers(vec, type, kind, n) };
  const raw = vec.toArray();
  const values = new Array<string>(n);
  if (Array.isArray(raw) && raw.length === n) {
    for (let i = 0; i < n; i++) values[i] = raw[i] === null || raw[i] === undefined ? '' : typeof raw[i] === 'string' ? raw[i] : String(raw[i]);
  } else {
    for (let i = 0; i < n; i++) {
      const v = vec.get(i);
      values[i] = v === null || v === undefined ? '' : String(v);
    }
  }
  return { name, type: 'string', values };
}

/** An Arrow table is converted once: a chart reads its data again at every update. */
const arrowCache = new WeakMap<object, { key: string; table: Table }>();

export class Table {
  private constructor(
    readonly length: number,
    private cols: Map<string, Column>,
    private hints: Record<string, ColumnType | undefined> = {},
  ) {}

  static from(input: DataInput | ArrowTableLike, types: Record<string, ColumnType | undefined> = {}): Table {
    if (input instanceof Table) return input;
    const cols = new Map<string, Column>();
    if (isArrowTable(input)) {
      const key = input.schema.fields.map((f) => `${f.name}:${types[f.name] ?? ''}`).join('|');
      const cached = arrowCache.get(input);
      if (cached && cached.key === key) return cached.table;
      let n = input.numRows ?? -1;
      for (const field of input.schema.fields) {
        const vec = input.getChild(field.name);
        if (!vec || cols.has(field.name)) continue;
        if (n < 0) n = vec.length;
        cols.set(field.name, arrowColumn(field.name, vec, field.type, n, types[field.name]));
      }
      const table = new Table(Math.max(n, 0), cols, types);
      arrowCache.set(input, { key, table });
      return table;
    }
    if (Array.isArray(input)) {
      const names = new Set<string>();
      for (let i = 0; i < Math.min(input.length, 50); i++) for (const k of Object.keys(input[i])) names.add(k);
      for (const name of names) cols.set(name, build(name, input.length, (i) => input[i][name], types[name]));
      return new Table(input.length, cols, types);
    }
    let n = 0;
    for (const [name, arr] of Object.entries(input.columns)) {
      n = Math.max(n, arr.length);
      if (arr instanceof Float64Array && types[name] !== 'string') {
        // Used as is, also when the catalog says `number` or `time` (epoch ms): what the adapters return.
        cols.set(name, { name, type: types[name] ?? 'number', values: arr });
      } else {
        cols.set(name, build(name, arr.length, (i) => arr[i], types[name]));
      }
    }
    return new Table(n, cols, types);
  }

  has(name: string): boolean {
    return this.cols.has(name);
  }

  column(name: string): Column {
    let c = this.cols.get(name);
    // No rows means no field names to read them from: a query that came back empty (a filter that
    // matches nothing) is not an error, every field is simply empty. Its type comes from the catalog.
    if (!c && this.length === 0) {
      c = this.hints[name] === 'string' ? { name, type: 'string', values: [] } : { name, type: this.hints[name] ?? 'number', values: new Float64Array(0) };
      this.cols.set(name, c);
    }
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
