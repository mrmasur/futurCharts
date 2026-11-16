import type { FieldSpec } from '@futurcharts/core';

export type Cell = number | string | null;

/**
 * What every adapter returns: columnar data ready for `spec.data`, and the
 * field catalog it could infer, ready for `spec.fields`.
 */
export interface AdapterResult {
  data: { columns: Record<string, Cell[] | Float64Array> };
  fields: Record<string, FieldSpec>;
  /** Number of rows. */
  length: number;
}

/**
 * Merge field catalogs field by field, later sources winning per property.
 * Typical use: types inferred from the query result, then labels and formats
 * from the dbt catalog on top.
 */
export function mergeFields(...sources: (Record<string, FieldSpec> | undefined)[]): Record<string, FieldSpec> {
  const out: Record<string, FieldSpec> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [name, f] of Object.entries(src)) {
      const defined = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
      out[name] = { ...out[name], ...defined };
    }
  }
  return out;
}

/** Pivot row objects into columns, keeping first-seen column order; missing cells become null. */
export function rowsToColumns(rows: Record<string, Cell>[]): Record<string, Cell[]> {
  const columns: Record<string, Cell[]> = {};
  rows.forEach((row, i) => {
    for (const key of Object.keys(row)) {
      if (!columns[key]) columns[key] = new Array<Cell>(rows.length).fill(null);
      columns[key][i] = row[key];
    }
  });
  return columns;
}
