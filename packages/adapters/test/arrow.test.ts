import { describe, expect, it } from 'vitest';
import * as arrow from 'apache-arrow';
import { tableFromIPC, tableToIPC } from 'apache-arrow';
import { Table } from '@futurcharts/core';
import { fromArrow } from '../src';

const decimal = (v: bigint | null) => (v === null ? null : new Uint32Array(new BigInt64Array([BigInt.asIntN(64, v), v < 0n ? -1n : 0n]).buffer));
const vec = <T extends arrow.DataType>(type: T, values: unknown[]) => arrow.vectorFromArray(values, type);
const T0 = Date.UTC(2026, 10, 1);
const DAY = 86400000;

/** What a ClickHouse query `SELECT day, plan, mrr, seats, margin, active … FORMAT Arrow` would hold. */
function sample(): arrow.Table {
  return new arrow.Table({
    day: vec(new arrow.TimestampSecond(), [T0, T0 + DAY, T0 + 2 * DAY, null]),
    plan: vec(new arrow.Dictionary(new arrow.Utf8(), new arrow.Int8()), ['Pro', 'Team', 'Pro', null]),
    mrr: arrow.makeVector(new Float64Array([1200.5, 800, 1310.25, 0])),
    seats: vec(new arrow.Int64(), [12n, null, 14n, 3n]),
    margin: vec(new arrow.Decimal(3, 9, 128), [decimal(312n), decimal(-45n), null, decimal(1000n)]),
    active: vec(new arrow.Bool(), [true, false, null, true]),
  });
}

function check(r: ReturnType<typeof fromArrow>): void {
  expect(r.length).toBe(4);
  expect(Object.keys(r.data.columns)).toEqual(['day', 'plan', 'mrr', 'seats', 'margin', 'active']);
  expect(r.fields).toEqual({
    day: { type: 'time' },
    plan: { type: 'string' },
    mrr: { type: 'number' },
    seats: { type: 'number' },
    margin: { type: 'number' },
    active: { type: 'string' },
  });
  expect(Array.from(r.data.columns.day as Float64Array)).toEqual([T0, T0 + DAY, T0 + 2 * DAY, NaN]);
  expect(r.data.columns.plan).toEqual(['Pro', 'Team', 'Pro', '']);
  expect(Array.from(r.data.columns.mrr as Float64Array)).toEqual([1200.5, 800, 1310.25, 0]);
  expect(Array.from(r.data.columns.seats as Float64Array)).toEqual([12, NaN, 14, 3]);
  expect(Array.from(r.data.columns.margin as Float64Array)).toEqual([0.312, -0.045, NaN, 1]);
  expect(r.data.columns.active).toEqual(['true', 'false', '', 'true']);
  // The result loads straight into a chart table, with `day` as a time column.
  const types = Object.fromEntries(Object.entries(r.fields).map(([k, f]) => [k, f.type]));
  const t = Table.from(r.data, types);
  expect(t.column('day').type).toBe('time');
  expect(t.column('mrr').values).toBe(r.data.columns.mrr);
}

describe('arrow', () => {
  it('converts a decoded table, Float64 without copy', () => {
    const t = sample();
    const r = fromArrow(t);
    check(r);
    expect((r.data.columns.mrr as Float64Array).buffer).toBe((t.getChild('mrr')!.toArray() as Float64Array).buffer);
  });

  it('decodes IPC bytes, file and stream formats, with the decoder it is given', () => {
    const file = tableToIPC(sample(), 'file');
    const stream = tableToIPC(sample(), 'stream');
    check(fromArrow(file, { tableFromIPC }));
    check(fromArrow(stream, { tableFromIPC }));
    // An ArrayBuffer, as `await response.arrayBuffer()` gives.
    const buffer = stream.buffer.slice(stream.byteOffset, stream.byteOffset + stream.byteLength) as ArrayBuffer;
    const r = fromArrow(buffer, { tableFromIPC });
    check(r);
    // Float64 values are read in place, inside the bytes received.
    expect((r.data.columns.mrr as Float64Array).buffer).toBe(buffer);
  });

  it('asks for the decoder when bytes come without one, and refuses anything else', () => {
    expect(() => fromArrow(tableToIPC(sample()))).toThrow(/tableFromIPC/);
    expect(() => fromArrow({ rows: [] } as never)).toThrow(/Arrow table/);
  });

  it('reads label, description and format in the field metadata', () => {
    const schema = new arrow.Schema([
      new arrow.Field('rate', new arrow.Float64(), true, new Map([['label', 'Taux de marge'], ['description', 'Marge / CA'], ['format', '{"style":"percent","decimals":1}']])),
      new arrow.Field('note', new arrow.Utf8(), true, new Map([['format', 'pas du JSON']])),
    ]);
    const built = new arrow.Table({ rate: arrow.makeVector(new Float64Array([0.25, 0.5])), note: vec(new arrow.Utf8(), ['a', 'b']) });
    const t = new arrow.Table(schema, built.batches[0].data.children.map((d) => d) as never);
    const r = fromArrow(tableFromIPC(tableToIPC(new arrow.Table(schema, new arrow.RecordBatch(schema, built.batches[0].data)), 'stream')));
    expect(t).toBeDefined();
    expect(r.fields.rate).toEqual({ type: 'number', label: 'Taux de marge', description: 'Marge / CA', format: { style: 'percent', decimals: 1 } });
    expect(r.fields.note).toEqual({ type: 'string' });
  });

  it('reads an empty result, with its types', () => {
    const empty = new arrow.Table({ day: vec(new arrow.TimestampMillisecond(), []), plan: vec(new arrow.Utf8(), []), mrr: vec(new arrow.Float64(), []) });
    for (const format of ['file', 'stream'] as const) {
      const r = fromArrow(tableToIPC(empty, format), { tableFromIPC });
      expect(r.length).toBe(0);
      expect(r.fields).toEqual({ day: { type: 'time' }, plan: { type: 'string' }, mrr: { type: 'number' } });
      expect(r.data.columns.mrr).toHaveLength(0);
      expect(r.data.columns.plan).toEqual([]);
    }
  });

  it('decodes and converts a million rows in about a second', () => {
    const n = 1_000_000;
    const value = new Float64Array(n);
    const count = new Int32Array(n);
    const at = new BigInt64Array(n);
    for (let i = 0; i < n; i++) {
      value[i] = Math.cos(i / 500);
      count[i] = i % 31;
      at[i] = BigInt(1_700_000_000 + i * 60);
    }
    const bytes = tableToIPC(
      new arrow.Table({
        value: arrow.makeVector(value),
        count: arrow.makeVector(count),
        at: arrow.makeVector({ type: new arrow.TimestampSecond(), data: at } as never),
        region: vec(new arrow.Dictionary(new arrow.Utf8(), new arrow.Int8()), Array.from({ length: n }, (_, i) => ['Nord', 'Sud', 'Est', 'Ouest'][i % 4])),
      }),
      'stream',
    );
    const start = performance.now();
    const r = fromArrow(bytes, { tableFromIPC });
    const elapsed = performance.now() - start;
    expect(r.length).toBe(n);
    expect(r.data.columns.value[n - 1]).toBe(value[n - 1]);
    expect(r.data.columns.count[n - 1]).toBe((n - 1) % 31);
    expect(r.data.columns.at[n - 1]).toBe((1_700_000_000 + (n - 1) * 60) * 1000);
    expect(r.data.columns.region[n - 1]).toBe('Ouest');
    expect(elapsed).toBeLessThan(1500);
    console.log(`fromArrow, 1 000 000 lignes × 4 colonnes : ${elapsed.toFixed(0)} ms`);
  });
});
