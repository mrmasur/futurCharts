// Responses shaped exactly like what the servers return, generated locally so
// the demo needs no backend. In an app these come from your API.

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Elasticsearch search response for:
 *   aggs: { day: { date_histogram }, aggs: { service: { terms }, aggs: { latency_ms: { avg } } } }
 */
export function esLatencyResponse() {
  const r = rng(11);
  const start = Date.UTC(2026, 9, 1);
  const services = [['checkout', 180], ['search', 95], ['catalog', 60]] as const;
  const buckets = [];
  for (let d = 0; d < 30; d++) {
    const key = start + d * 86400000;
    buckets.push({
      key_as_string: new Date(key).toISOString(),
      key,
      doc_count: 30000 + Math.round(r() * 8000),
      service: {
        doc_count_error_upper_bound: 0,
        sum_other_doc_count: 0,
        buckets: services.map(([name, base]) => ({
          key: name,
          doc_count: 9000 + Math.round(r() * 3000),
          latency_ms: { value: base * (0.85 + r() * 0.3) + (name === 'checkout' && d > 20 ? 70 : 0) },
        })),
      },
    });
  }
  return { took: 42, timed_out: false, hits: { total: { value: 10000, relation: 'gte' }, hits: [] }, aggregations: { day: { buckets } } };
}

/** ClickHouse HTTP response for a `... FORMAT JSONCompact` query. */
export function clickHouseMrrResponse() {
  const r = rng(3);
  const data: (string | number)[][] = [];
  const plans = [['Starter', 18000, 250], ['Pro', 42000, 1400], ['Entreprise', 61000, 2600]] as const;
  for (let m = 0; m < 12; m++) {
    for (const [plan, base, growth] of plans) {
      const mrr = base + growth * m + r() * base * 0.06;
      data.push([`2026-${pad(m + 1)}-01`, plan, Math.round(mrr * 100) / 100, String(Math.round(mrr / 49))]);
    }
  }
  return {
    meta: [
      { name: 'month', type: 'Date' },
      { name: 'plan', type: 'LowCardinality(String)' },
      { name: 'mrr', type: 'Decimal(18, 2)' },
      { name: 'customers', type: 'UInt64' },
    ],
    data,
    rows: data.length,
    statistics: { elapsed: 0.004, rows_read: 81234, bytes_read: 1299744 },
  };
}

/** The part of a dbt manifest.json the adapter reads. */
export const dbtManifest = {
  semantic_models: {
    'semantic_model.analytics.subscriptions': {
      name: 'subscriptions',
      dimensions: [
        { name: 'month', type: 'time', label: 'Mois', type_params: { time_granularity: 'month' } },
        { name: 'plan', type: 'categorical', label: 'Offre', description: 'Offre souscrite par le client.' },
      ],
      measures: [
        {
          name: 'mrr',
          agg: 'sum',
          label: 'Revenu récurrent mensuel',
          description: 'Somme des abonnements actifs, hors taxes.',
          config: { meta: { format: { style: 'currency', currency: 'EUR', decimals: 0 } } },
        },
        { name: 'customers', agg: 'count_distinct', label: 'Clients' },
      ],
    },
  },
  metrics: {},
};
