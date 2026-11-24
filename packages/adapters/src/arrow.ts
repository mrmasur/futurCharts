import { Table } from '@futurcharts/core';
import type { ArrowTableLike, FieldSpec } from '@futurcharts/core';
import type { AdapterResult, Cell } from './common';

export interface ArrowOptions {
  /**
   * Decoder of Arrow IPC bytes, needed only when the input is bytes: pass `tableFromIPC` from
   * `apache-arrow` (an optional peer dependency, never imported by this package).
   */
  tableFromIPC?: (bytes: Uint8Array) => ArrowTableLike;
}

function isBytes(input: unknown): input is ArrayBuffer | Uint8Array {
  return input instanceof ArrayBuffer || input instanceof Uint8Array;
}

/** `format` in the field metadata: a `FormatSpec` as JSON (`{"style":"percent"}`). Anything else is ignored. */
function parseFormat(text: string | undefined): FieldSpec['format'] | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert Apache Arrow data into columns: either a decoded table (`tableFromIPC(...)`, `tableFromArrays(...)`)
 * or IPC bytes, file or stream format, as ClickHouse returns for `FORMAT Arrow` / `FORMAT ArrowStream`
 * (then give the decoder: `fromArrow(bytes, { tableFromIPC })`).
 *
 * Types come from the Arrow schema (see `ArrowTableLike` in the core for the conversion of each type):
 * Float64 columns without null are the Arrow buffers themselves, not copies. The catalog also takes
 * `label`, `description` and `format` (a `FormatSpec` as JSON) from the metadata of each field when present.
 */
export function fromArrow(input: ArrowTableLike | ArrayBuffer | Uint8Array, options: ArrowOptions = {}): AdapterResult {
  let source: ArrowTableLike;
  if (isBytes(input)) {
    if (!options.tableFromIPC) {
      throw new Error('futurCharts: fromArrow received bytes but no decoder. Pass it: fromArrow(bytes, { tableFromIPC }) with tableFromIPC from "apache-arrow".');
    }
    source = options.tableFromIPC(input instanceof Uint8Array ? input : new Uint8Array(input));
  } else {
    source = input;
  }
  if (!source || typeof source.getChild !== 'function' || !Array.isArray(source.schema?.fields)) {
    throw new Error('futurCharts: fromArrow expects an Arrow table (schema.fields, getChild) or Arrow IPC bytes.');
  }
  const table = Table.from(source);
  const columns: Record<string, Cell[] | Float64Array> = {};
  const fields: Record<string, FieldSpec> = {};
  for (const field of source.schema.fields) {
    if (!table.has(field.name) || columns[field.name]) continue;
    const column = table.column(field.name);
    columns[field.name] = column.values;
    const spec: FieldSpec = { type: column.type };
    const meta = field.metadata;
    if (meta && typeof meta.get === 'function') {
      const label = meta.get('label');
      const description = meta.get('description') ?? meta.get('comment');
      const format = parseFormat(meta.get('format'));
      if (label) spec.label = label;
      if (description) spec.description = description;
      if (format) spec.format = format;
    }
    fields[field.name] = spec;
  }
  return { data: { columns }, fields, length: table.length };
}
