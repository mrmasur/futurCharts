import { describe, expect, it } from 'vitest';
import { Table } from '@futurcharts/core';
import { clickHouseMrrResponse, dbtManifest, esLatencyResponse } from '../../../apps/demo/src/fixtures';
import { clickHouseColumnType, fieldsFromDbt, fromClickHouse, fromEsAggregations, fromEsHits, fromEsTable, mergeFields, sqlColumnType } from '../src';

describe('elasticsearch aggregations', () => {
  it('flattens nested buckets to one row per innermost bucket', () => {
    const r = fromEsAggregations(esLatencyResponse());
    expect(r.length).toBe(30 * 3);
    expect(Object.keys(r.data.columns)).toEqual(['day', 'service', 'latency_ms', 'doc_count']);
    expect(r.fields.day).toEqual({ type: 'time' });
    // Daily UTC buckets read as local midnight by default, and as the exact instant on request.
    expect(r.data.columns.day[0]).toBe(new Date(2026, 9, 1).getTime());
    expect(fromEsAggregations(esLatencyResponse(), { time: 'instant' }).data.columns.day[0]).toBe(Date.UTC(2026, 9, 1));
    expect(r.data.columns.service.slice(0, 3)).toEqual(['checkout', 'search', 'catalog']);
    // The result loads straight into a chart table, with `day` as a time column.
    const types = Object.fromEntries(Object.entries(r.fields).map(([k, f]) => [k, f.type]));
    const t = Table.from(r.data, types);
    expect(t.column('day').type).toBe('time');
    expect(t.column('latency_ms').type).toBe('number');
  });

  it('handles keyed buckets, single-bucket wrappers, stats and percentiles', () => {
    const r = fromEsAggregations({
      errors_only: {
        doc_count: 12,
        by_status: {
          buckets: {
            client: { doc_count: 8, size: { count: 8, min: 1, max: 9, avg: 4, sum: 32 }, p: { values: { '50.0': 3, '95.0': 8 } } },
            server: { doc_count: 4, size: { count: 4, min: 2, max: 6, avg: 4, sum: 16 }, p: { values: { '50.0': 4, '95.0': 6 } } },
          },
        },
      },
    });
    expect(r.data.columns.by_status).toEqual(['client', 'server']);
    expect(r.data.columns['size.avg']).toEqual([4, 4]);
    expect(r.data.columns['p.95.0']).toEqual([8, 6]);
    expect(r.data.columns.doc_count).toEqual([8, 4]);
  });

  it('spreads composite keys into one column per source', () => {
    const r = fromEsAggregations(
      { c: { after_key: { day: 2, country: 'FR' }, buckets: [{ key: { day: 1, country: 'FR' }, doc_count: 3, total: { value: 10 } }] } },
      { types: { day: 'time' }, docCount: false },
    );
    expect(r.data.columns).toEqual({ day: [1], country: ['FR'], total: [10] });
    expect(r.fields.day.type).toBe('time');
  });

  it('follows the requested path between sibling bucket aggregations', () => {
    const aggs = { a: { buckets: [{ key: 'x', doc_count: 1 }] }, b: { buckets: [{ key: 'y', doc_count: 2 }] } };
    expect(fromEsAggregations(aggs, { path: ['b'] }).data.columns.b).toEqual(['y']);
    expect(() => fromEsAggregations(aggs, { path: ['nope'] })).toThrow(/Found: a, b/);
  });

  it('returns a single row for metrics without buckets', () => {
    expect(fromEsAggregations({ total: { value: 5 } }).data.columns).toEqual({ total: [5] });
  });
});

describe('elasticsearch hits and tables', () => {
  it('reads _source of hits', () => {
    const r = fromEsHits({ hits: { hits: [{ _source: { a: 1, b: 'x', c: { d: 1 } } }, { _source: { a: 2 } }] } });
    expect(r.data.columns).toEqual({ a: [1, 2], b: ['x', null], c: ['{"d":1}', null] });
  });
  it('reads ES|QL and SQL responses with their column types', () => {
    const esql = fromEsTable({ columns: [{ name: '@timestamp', type: 'date' }, { name: 'n', type: 'long' }, { name: 'host', type: 'keyword' }], values: [['2026-10-01T00:00:00.000Z', 3, 'a']] });
    expect(esql.fields).toEqual({ '@timestamp': { type: 'time' }, n: { type: 'number' }, host: { type: 'string' } });
    expect(fromEsTable({ columns: [{ name: 'n', type: 'integer' }], rows: [[1], [2]] }).data.columns.n).toEqual([1, 2]);
  });
});

describe('clickhouse', () => {
  it('maps types through Nullable and LowCardinality', () => {
    expect(clickHouseColumnType('Nullable(Float64)')).toBe('number');
    expect(clickHouseColumnType('LowCardinality(Nullable(String))')).toBe('string');
    expect(clickHouseColumnType("DateTime64(3, 'Europe/Paris')")).toBe('time');
    expect(clickHouseColumnType('Decimal(18, 2)')).toBe('number');
    expect(clickHouseColumnType('UUID')).toBe('string');
  });

  it('reads JSONCompact into typed arrays, including quoted 64-bit integers', () => {
    const r = fromClickHouse(clickHouseMrrResponse());
    expect(r.length).toBe(36);
    expect(r.data.columns.mrr).toBeInstanceOf(Float64Array);
    expect(r.data.columns.customers).toBeInstanceOf(Float64Array);
    expect(Number.isFinite((r.data.columns.customers as Float64Array)[0])).toBe(true);
    expect(r.data.columns.plan[0]).toBe('Starter');
    // Dates keep their wall-clock digits: 2026-01-01 is midnight local time.
    expect((r.data.columns.month as Float64Array)[0]).toBe(new Date(2026, 0, 1).getTime());
  });

  it('reads the JSON and JSONColumnsWithMetadata layouts identically', () => {
    const meta = [{ name: 't', type: "DateTime('UTC')" }, { name: 'v', type: 'Nullable(Float64)' }];
    const rows = fromClickHouse({ meta, data: [{ t: '2026-03-04 05:06:07', v: 1.5 }, { t: '2026-03-05 00:00:00', v: null }] }, { timezone: 'utc' });
    const cols = fromClickHouse({ meta, data: { t: ['2026-03-04 05:06:07', '2026-03-05 00:00:00'], v: [1.5, null] } }, { timezone: 'utc' });
    expect(rows.data.columns).toEqual(cols.data.columns);
    expect((rows.data.columns.t as Float64Array)[0]).toBe(Date.UTC(2026, 2, 4, 5, 6, 7));
    expect(Number.isNaN((rows.data.columns.v as Float64Array)[1])).toBe(true);
  });

  it('explains which formats work when meta is missing', () => {
    expect(() => fromClickHouse({ data: [] })).toThrow(/FORMAT JSON/);
  });
});

describe('dbt', () => {
  it('maps SQL types', () => {
    expect(sqlColumnType('TIMESTAMP_NTZ')).toBe('time');
    expect(sqlColumnType('Nullable(Float64)')).toBe('number');
    expect(sqlColumnType('varchar(32)')).toBe('string');
    expect(sqlColumnType(undefined)).toBeUndefined();
  });

  it('builds fields from a semantic model, with labels and meta formats', () => {
    const f = fieldsFromDbt(dbtManifest, { semanticModel: 'subscriptions' });
    expect(f.month).toEqual({ type: 'time', label: 'Mois' });
    expect(f.plan.type).toBe('string');
    expect(f.mrr).toMatchObject({ type: 'number', label: 'Revenu récurrent mensuel', format: { style: 'currency', currency: 'EUR' } });
  });

  it('builds fields from model columns', () => {
    const manifest = { nodes: { 'model.shop.orders': { name: 'orders', resource_type: 'model', columns: { amount: { name: 'amount', data_type: 'numeric(12,2)', description: 'TTC', meta: { label: 'Montant' } }, id: { name: 'id' } } } } };
    expect(fieldsFromDbt(manifest, { model: 'orders' })).toEqual({ amount: { type: 'number', label: 'Montant', description: 'TTC' }, id: {} });
    expect(() => fieldsFromDbt(manifest, { model: 'nope' })).toThrow(/not found/);
  });

  it('mergeFields combines catalogs per property', () => {
    const merged = mergeFields({ mrr: { type: 'number' } }, { mrr: { label: 'MRR', type: undefined } });
    expect(merged).toEqual({ mrr: { type: 'number', label: 'MRR' } });
  });
});
