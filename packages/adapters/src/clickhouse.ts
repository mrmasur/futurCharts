import type { ColumnType, FieldSpec } from '@futurcharts/core';
import type { AdapterResult, Cell } from './common';

type Json = Record<string, any>;

export interface ClickHouseOptions {
  /**
   * How to read Date / DateTime strings, which carry no offset.
   * `local` (default) keeps the wall-clock digits ClickHouse returned, so the
   * chart shows exactly what the query shows. `utc` reads them as UTC.
   */
  timezone?: 'local' | 'utc';
}

/** Strip `Nullable(...)` and `LowCardinality(...)` wrappers. */
export function unwrapClickHouseType(type: string): string {
  let t = type.trim();
  for (;;) {
    const m = /^(Nullable|LowCardinality)\((.*)\)$/.exec(t);
    if (!m) return t;
    t = m[2].trim();
  }
}

export function clickHouseColumnType(type: string): ColumnType {
  const t = unwrapClickHouseType(type);
  if (/^(U?Int\d+|Float\d+|Decimal\d*)\b/.test(t)) return 'number';
  if (/^(Date|Date32|DateTime|DateTime64)\b/.test(t)) return 'time';
  return 'string';
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?/;

function parseDate(value: unknown, utc: boolean): number {
  if (typeof value === 'number') return value * 1000; // date_time_output_format = unix_timestamp
  const m = typeof value === 'string' ? DATE.exec(value) : null;
  if (!m) return NaN;
  const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
  const parts: [number, number, number, number, number, number, number] = [+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms];
  return utc ? Date.UTC(...parts) : new Date(...parts).getTime();
}

/**
 * Convert a ClickHouse HTTP response into columns. Supported output formats,
 * all of which carry `meta`:
 *   - `JSON`                     data: [{ col: value }]
 *   - `JSONCompact`              data: [[value, ...]]
 *   - `JSONColumnsWithMetadata`  data: { col: [values] }
 *
 * Numbers and dates land in Float64Array, the chart's native storage. 64-bit
 * integers arrive as strings and are converted to doubles: exact up to 2^53.
 */
export function fromClickHouse(response: Json, options: ClickHouseOptions = {}): AdapterResult {
  const meta: { name: string; type: string }[] | undefined = response.meta;
  if (!Array.isArray(meta)) {
    throw new Error('futurCharts: ClickHouse response has no "meta". Use FORMAT JSON, JSONCompact or JSONColumnsWithMetadata.');
  }
  const utc = options.timezone === 'utc';
  const data = response.data ?? [];
  const columnar = !Array.isArray(data);
  const length: number = columnar ? ((Object.values(data)[0] as unknown[] | undefined)?.length ?? 0) : data.length;
  const compact = !columnar && length > 0 && Array.isArray(data[0]);

  const columns: Record<string, Cell[] | Float64Array> = {};
  const fields: Record<string, FieldSpec> = {};
  meta.forEach((col, j) => {
    const type = clickHouseColumnType(col.type);
    fields[col.name] = { type };
    const get = (i: number): unknown => (columnar ? data[col.name]?.[i] : compact ? data[i][j] : data[i][col.name]);
    if (type === 'string') {
      const out = new Array<Cell>(length);
      for (let i = 0; i < length; i++) {
        const v = get(i);
        out[i] = v === null || v === undefined ? null : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
      columns[col.name] = out;
      return;
    }
    const out = new Float64Array(length);
    for (let i = 0; i < length; i++) {
      const v = get(i);
      out[i] = v === null || v === undefined ? NaN : type === 'time' ? parseDate(v, utc) : Number(v);
    }
    columns[col.name] = out;
  });
  return { data: { columns }, fields, length };
}
