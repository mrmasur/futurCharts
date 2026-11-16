import type { ColumnType, FieldSpec } from '@futurcharts/core';
import { rowsToColumns, type AdapterResult, type Cell } from './common';

type Json = Record<string, any>;

export interface EsAggregationOptions {
  /**
   * Which bucket aggregation to follow at each depth, when a level has several
   * siblings. By default the first one found is followed.
   */
  path?: string[];
  /** Column name for the bucket document count, or `false` to drop it. Default `doc_count`. */
  docCount?: string | false;
  /** Force field types, e.g. composite date_histogram sources (`{ day: 'time' }`). */
  types?: Record<string, ColumnType>;
  /**
   * How date_histogram keys are read. `wall-clock` (default) keeps the digits of
   * `key_as_string`, so a daily bucket shows as midnight whatever the viewer's
   * time zone — the chart reads like the query. `instant` keeps the exact epoch.
   */
  time?: 'wall-clock' | 'instant';
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/;

/** Epoch ms of the local time showing the same digits as an ISO string (its offset is ignored). */
function wallClock(iso: string): number {
  const m = ISO.exec(iso);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), +(m[7] ?? '0').padEnd(3, '0')).getTime();
}

const RESERVED = new Set(['key', 'key_as_string', 'doc_count', 'doc_count_error_upper_bound', 'from', 'to', 'from_as_string', 'to_as_string', 'meta']);

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBucketAgg = (v: unknown): v is Json => isObject(v) && 'buckets' in v;
/** filter / nested / global / missing…: one bucket holding sub-aggregations. */
const isSingleBucket = (v: unknown): v is Json => isObject(v) && 'doc_count' in v && !('buckets' in v) && !('value' in v);

/** Columns contributed by one metric aggregation. */
function metricCells(name: string, agg: Json, out: Record<string, Cell>): void {
  if ('value' in agg) {
    out[name] = agg.value ?? null;
    return;
  }
  if ('values' in agg) {
    // percentiles / percentile_ranks: keyed object, or [{ key, value }] with `keyed: false`.
    const entries: [string, unknown][] = Array.isArray(agg.values)
      ? agg.values.map((e: Json) => [String(e.key), e.value])
      : Object.entries(agg.values);
    for (const [k, v] of entries) {
      if (!k.endsWith('_as_string')) out[`${name}.${k}`] = (v as number) ?? null;
    }
    return;
  }
  // stats / extended_stats: several numeric properties.
  for (const [k, v] of Object.entries(agg)) {
    if (typeof v === 'number' || v === null) out[`${name}.${k}`] = v as number | null;
  }
}

interface Level {
  buckets: Map<string, Json>;
  metrics: Record<string, Cell>;
}

/** Split one aggregation level into bucket aggs and metric values, looking through single-bucket wrappers. */
function scan(node: Json, level: Level = { buckets: new Map(), metrics: {} }): Level {
  for (const [name, agg] of Object.entries(node)) {
    if (RESERVED.has(name) || !isObject(agg)) continue;
    if (isBucketAgg(agg)) level.buckets.set(name, agg);
    else if (isSingleBucket(agg)) scan(agg, level);
    else metricCells(name, agg, level.metrics);
  }
  return level;
}

/**
 * Flatten an aggregation response into one row per innermost bucket.
 *
 * Each bucket aggregation becomes a dimension column named after the
 * aggregation; each metric becomes a measure column. Accepts the whole search
 * response or its `aggregations` object.
 */
export function fromEsAggregations(response: Json, options: EsAggregationOptions = {}): AdapterResult {
  const aggs: Json = response.aggregations ?? response.aggs ?? response;
  const docCount = options.docCount === undefined ? 'doc_count' : options.docCount;
  const rows: Record<string, Cell>[] = [];
  const fields: Record<string, FieldSpec> = {};

  const walk = (node: Json, dims: Record<string, Cell>, depth: number, count: number | null): void => {
    const level = scan(node);
    const wanted = options.path?.[depth];
    const name = wanted ?? level.buckets.keys().next().value;
    const agg = name !== undefined ? level.buckets.get(name) : undefined;
    if (wanted && !agg) {
      throw new Error(`futurCharts: no bucket aggregation "${wanted}" at depth ${depth}. Found: ${[...level.buckets.keys()].join(', ') || 'none'}`);
    }
    if (!agg || name === undefined) {
      // Innermost level: emit the row.
      const row = { ...dims, ...level.metrics };
      if (docCount && count !== null) row[docCount] = count;
      rows.push(row);
      return;
    }
    // `buckets` is an array, or an object keyed by bucket name (filters, `keyed: true`).
    const buckets: [string | null, Json][] = Array.isArray(agg.buckets)
      ? agg.buckets.map((b: Json) => [null, b])
      : Object.entries(agg.buckets as Json);
    for (const [keyed, bucket] of buckets) {
      const next = { ...dims };
      const key = keyed ?? bucket.key;
      if (isObject(key)) {
        // composite: the key is an object with one entry per source.
        for (const [k, v] of Object.entries(key)) next[k] = v as Cell;
      } else {
        next[name] = key ?? null;
        // date_histogram: numeric epoch-ms key with a formatted twin.
        if (typeof key === 'number' && typeof bucket.key_as_string === 'string' && !Number.isNaN(Date.parse(bucket.key_as_string))) {
          fields[name] = { type: 'time' };
          if (options.time !== 'instant') {
            const local = wallClock(bucket.key_as_string);
            if (!Number.isNaN(local)) next[name] = local;
          }
        }
      }
      walk(bucket, next, depth + 1, bucket.doc_count ?? null);
    }
  };
  walk(aggs, {}, 0, null);

  for (const [name, type] of Object.entries(options.types ?? {})) fields[name] = { ...fields[name], type };
  return { data: { columns: rowsToColumns(rows) }, fields, length: rows.length };
}

/** Raw documents: one row per hit, from `_source` (and `fields`, first value of each). */
export function fromEsHits(response: Json): AdapterResult {
  const hits: Json[] = response.hits?.hits ?? [];
  const rows = hits.map((hit) => {
    const row: Record<string, Cell> = {};
    for (const [k, v] of Object.entries(hit._source ?? {})) {
      row[k] = typeof v === 'number' || typeof v === 'string' ? v : v === null || v === undefined ? null : typeof v === 'boolean' ? String(v) : JSON.stringify(v);
    }
    for (const [k, v] of Object.entries(hit.fields ?? {})) {
      const first = Array.isArray(v) ? v[0] : v;
      row[k] = typeof first === 'number' || typeof first === 'string' ? first : first === null || first === undefined ? null : String(first);
    }
    return row;
  });
  return { data: { columns: rowsToColumns(rows) }, fields: {}, length: rows.length };
}

const ES_NUMBER = /^(long|integer|short|byte|double|float|half_float|scaled_float|unsigned_long|counter_|aggregate_metric_double)/;
const ES_TIME = /^(date|date_nanos|datetime)$/;

/**
 * Tabular responses: ES|QL (`{ columns, values }`) and the SQL API
 * (`{ columns, rows }`). Column types come from the response itself.
 */
export function fromEsTable(response: Json): AdapterResult {
  const meta: { name: string; type: string }[] = response.columns ?? [];
  const values: unknown[][] = response.values ?? response.rows ?? [];
  const columns: Record<string, Cell[]> = {};
  const fields: Record<string, FieldSpec> = {};
  meta.forEach((col, j) => {
    const type: ColumnType = ES_TIME.test(col.type) ? 'time' : ES_NUMBER.test(col.type) ? 'number' : 'string';
    fields[col.name] = { type };
    columns[col.name] = values.map((row) => {
      const v = row[j];
      if (v === null || v === undefined) return null;
      // Multi-valued fields come back as arrays: keep the first value.
      const one = Array.isArray(v) ? v[0] : v;
      return typeof one === 'number' || typeof one === 'string' ? one : String(one);
    });
  });
  return { data: { columns }, fields, length: values.length };
}
