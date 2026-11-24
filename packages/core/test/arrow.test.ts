import { describe, expect, it } from 'vitest';
import * as arrow from 'apache-arrow';
import { Table } from '../src';

/** A 128-bit decimal as apache-arrow stores it: four little-endian 32-bit words. */
const decimal = (v: bigint | null) => (v === null ? null : new Uint32Array(new BigInt64Array([BigInt.asIntN(64, v), v < 0n ? -1n : 0n]).buffer));
const vec = <T extends arrow.DataType>(type: T, values: unknown[]) => arrow.vectorFromArray(values, type);
const DAY = 86400000;

describe('Table.from(Arrow table)', () => {
  it('uses a Float64 column without null as is, without copying', () => {
    const source = new Float64Array([1.5, 2.5, -3]);
    const t = arrow.tableFromArrays({ v: source });
    const col = Table.from(t).column('v');
    expect(col.type).toBe('number');
    expect(col.values).toBeInstanceOf(Float64Array);
    expect((col.values as Float64Array).buffer).toBe(source.buffer);
    expect(Array.from(col.values as Float64Array)).toEqual([1.5, 2.5, -3]);
  });

  it('converts integers, 64-bit integers, floats and decimals, nulls as NaN', () => {
    const t = new arrow.Table({
      i8: vec(new arrow.Int8(), [1, -2, null]),
      u16: vec(new arrow.Uint16(), [65535, 0, 7]),
      i32: arrow.makeVector(new Int32Array([1, -2, 3])),
      i64: vec(new arrow.Int64(), [9007199254740991n, null, -4n]),
      u64: vec(new arrow.Uint64(), [1n, 2n, 18446744073709551615n]),
      f16: vec(new arrow.Float16(), [1.5, null, -2]),
      f32: vec(new arrow.Float32(), [0.5, null, 4]),
      f64: vec(new arrow.Float64(), [0.1, null, 4]),
      dec: vec(new arrow.Decimal(2, 18, 128), [decimal(12345n), decimal(-250n), null]),
      big: vec(new arrow.Decimal(4, 38, 128), [decimal(-1n), decimal(123456789012345678n), decimal(0n)]),
    });
    const table = Table.from(t);
    expect(table.length).toBe(3);
    const values = (name: string) => {
      const c = table.column(name);
      expect(c.type).toBe('number');
      expect(c.values).toBeInstanceOf(Float64Array);
      return Array.from(c.values as Float64Array);
    };
    expect(values('i8')).toEqual([1, -2, NaN]);
    expect(values('u16')).toEqual([65535, 0, 7]);
    expect(values('i32')).toEqual([1, -2, 3]);
    expect(values('i64')).toEqual([9007199254740991, NaN, -4]);
    expect(values('u64')).toEqual([1, 2, 18446744073709551615]);
    expect(values('f16')).toEqual([1.5, NaN, -2]);
    expect(values('f32')).toEqual([0.5, NaN, 4]);
    expect(values('f64')).toEqual([0.1, NaN, 4]);
    expect(values('dec')).toEqual([123.45, -2.5, NaN]);
    expect(values('big')).toEqual([-0.0001, 12345678901234.5678, 0]);
  });

  it('reads dates and timestamps of every unit as epoch milliseconds', () => {
    const at = Date.UTC(2026, 10, 24, 8, 30, 15, 250);
    const t = new arrow.Table({
      d32: vec(new arrow.DateDay(), [new Date(Date.UTC(2026, 0, 1)), null, new Date(DAY)]),
      d64: vec(new arrow.DateMillisecond(), [new Date(at), null, new Date(0)]),
      s: vec(new arrow.TimestampSecond(), [at - 250, null, 0]),
      ms: vec(new arrow.TimestampMillisecond(), [at, null, 0]),
      us: vec(new arrow.TimestampMicrosecond(), [at, null, 0]),
      // Exact nanoseconds: beyond what a double holds, hence built from 64-bit integers.
      ns: arrow.makeVector({ type: new arrow.TimestampNanosecond(), data: new BigInt64Array([BigInt(at) * 1000000n + 999999n, -1n, 0n]) } as never),
      tz: vec(new arrow.Timestamp(arrow.TimeUnit.SECOND, 'Europe/Paris'), [at - 250, null, 0]),
    });
    const table = Table.from(t);
    const values = (name: string) => {
      const c = table.column(name);
      expect(c.type).toBe('time');
      return Array.from(c.values as Float64Array);
    };
    expect(values('d32')).toEqual([Date.UTC(2026, 0, 1), NaN, DAY]);
    expect(values('d64')).toEqual([at, NaN, 0]);
    expect(values('s')).toEqual([at - 250, NaN, 0]);
    expect(values('ms')).toEqual([at, NaN, 0]);
    expect(values('us')).toEqual([at, NaN, 0]);
    expect(values('ns')).toEqual([at, 0, 0]);
    expect(values('tz')).toEqual([at - 250, NaN, 0]);
    expect(table.row(0).ms).toEqual(new Date(at));
  });

  it('reads strings and dictionaries as strings, booleans as true / false', () => {
    const t = new arrow.Table({
      s: vec(new arrow.Utf8(), ['Nord', null, 'Été']),
      dict: vec(new arrow.Dictionary(new arrow.Utf8(), new arrow.Int32()), ['a', 'b', 'a']),
      holes: vec(new arrow.Dictionary(new arrow.Utf8(), new arrow.Int8()), ['a', null, 'a']),
      codes: vec(new arrow.Dictionary(new arrow.Int32(), new arrow.Int8()), [10, null, 30]),
      ok: vec(new arrow.Bool(), [true, false, null]),
    });
    const table = Table.from(t);
    expect(table.column('s')).toMatchObject({ type: 'string', values: ['Nord', '', 'Été'] });
    expect(table.column('dict')).toMatchObject({ type: 'string', values: ['a', 'b', 'a'] });
    expect(table.column('holes').values).toEqual(['a', '', 'a']);
    expect(table.column('codes').type).toBe('number');
    expect(Array.from(table.column('codes').values as Float64Array)).toEqual([10, NaN, 30]);
    expect(table.column('ok')).toMatchObject({ type: 'string', values: ['true', 'false', ''] });
    expect(table.fields).toEqual(['s', 'dict', 'holes', 'codes', 'ok']);
  });

  it('lets the field catalog override the Arrow type', () => {
    const t = new arrow.Table({
      ok: vec(new arrow.Bool(), [true, false, null]),
      at: vec(new arrow.Int64(), [1000n, null, 3000n]),
      code: arrow.makeVector(new Int32Array([75, 13, 69])),
    });
    const table = Table.from(t, { ok: 'number', at: 'time', code: 'string' });
    expect(Array.from(table.column('ok').values as Float64Array)).toEqual([1, 0, NaN]);
    expect(table.column('at').type).toBe('time');
    expect(Array.from(table.column('at').values as Float64Array)).toEqual([1000, NaN, 3000]);
    expect(table.column('code')).toMatchObject({ type: 'string', values: ['75', '13', '69'] });
  });

  it('reads a table of several record batches and an empty table', () => {
    const a = arrow.tableFromArrays({ v: new Float64Array([1, 2]), k: ['x', 'y'] });
    const b = arrow.tableFromArrays({ v: new Float64Array([3]), k: ['z'] });
    const both = Table.from(a.concat(b));
    expect(both.length).toBe(3);
    expect(Array.from(both.column('v').values as Float64Array)).toEqual([1, 2, 3]);
    expect(both.column('k').values).toEqual(['x', 'y', 'z']);

    const empty = Table.from(new arrow.Table({ v: vec(new arrow.Float64(), []), k: vec(new arrow.Utf8(), []), t: vec(new arrow.TimestampMillisecond(), []) }));
    expect(empty.length).toBe(0);
    expect(empty.column('v').values).toHaveLength(0);
    expect(empty.column('k')).toMatchObject({ type: 'string', values: [] });
    expect(empty.column('t').type).toBe('time');
    expect(Table.from(new arrow.Table()).length).toBe(0);
  });

  it('converts a table once, and a million rows in well under a second', () => {
    const n = 1_000_000;
    const value = new Float64Array(n);
    const count = new Int32Array(n);
    const at = new BigInt64Array(n);
    for (let i = 0; i < n; i++) {
      value[i] = Math.sin(i / 1000);
      count[i] = i % 977;
      at[i] = BigInt(1_700_000_000_000 + i * 1000);
    }
    const t = new arrow.Table({
      value: arrow.makeVector(value),
      count: arrow.makeVector(count),
      at: arrow.makeVector({ type: new arrow.TimestampMillisecond(), data: at } as never),
    });
    const start = performance.now();
    const table = Table.from(t);
    const elapsed = performance.now() - start;
    expect(table.length).toBe(n);
    expect((table.column('value').values as Float64Array).buffer).toBe(value.buffer);
    expect(table.column('count').values[n - 1]).toBe((n - 1) % 977);
    expect(table.column('at').type).toBe('time');
    expect(table.column('at').values[n - 1]).toBe(1_700_000_000_000 + (n - 1) * 1000);
    expect(elapsed).toBeLessThan(1000);
    expect(Table.from(t)).toBe(table);
  });

  it('is accepted by the DataInput type (a spec can carry it as is)', () => {
    const table = arrow.tableFromArrays({ v: new Float64Array([1, 2, 3]) });
    const data: import('../src').DataInput = table;
    expect(Table.from(data).length).toBe(3);
  });
});
