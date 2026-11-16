import { fieldsFromDbt, fromClickHouse, fromEsAggregations, mergeFields } from '@futurcharts/adapters';
import { Chart, chart, type ChartSpec } from '@futurcharts/core';
import { clickHouseMrrResponse, dbtManifest, esLatencyResponse } from './fixtures';

// Deterministic pseudo-random data, so the demo looks the same on every load.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const DAY = 86400000;
const start = new Date(2026, 4, 1).getTime();

// 1. Daily revenue per country — rows, as an API would return them.
const revenue: Record<string, unknown>[] = [];
{
  const r = rng(7);
  for (const [country, base, trend] of [['France', 42000, 60], ['Allemagne', 36000, 95], ['Espagne', 21000, 40], ['Italie', 17000, 20]] as const) {
    let v: number = base;
    for (let d = 0; d < 180; d++) {
      v += trend + gauss(r) * base * 0.03;
      const weekly = 1 + 0.12 * Math.sin((d / 7) * 2 * Math.PI);
      revenue.push({ date: new Date(start + d * DAY), country, revenue: Math.max(0, v * weekly) });
    }
  }
}

// 2 & 3. Categorical data.
const quarters = ['T1 2026', 'T2 2026', 'T3 2026', 'T4 2026'];
const byProduct: Record<string, unknown>[] = [];
{
  const r = rng(21);
  for (const q of quarters) for (const [p, b] of [['Starter', 120], ['Pro', 210], ['Entreprise', 160]] as const) {
    byProduct.push({ quarter: q, product: p, sales: Math.round(b * (0.8 + r() * 0.6)) });
  }
}
const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const byChannel: Record<string, unknown>[] = [];
{
  const r = rng(33);
  for (const [mi, m] of months.entries()) for (const [c, b] of [['Organique', 5200], ['Payant', 3400], ['Email', 1800], ['Partenaires', 900]] as const) {
    byChannel.push({ month: m, channel: c, signups: Math.round(b * (0.7 + mi * 0.04 + r() * 0.4)) });
  }
}

// 4. Sessions per device — columnar, the native input format.
const sessions = { day: [] as Date[], device: [] as string[], sessions: [] as number[] };
{
  const r = rng(5);
  for (const [device, base] of [['Ordinateur', 8200], ['Mobile', 6100], ['Tablette', 1500]] as const) {
    let v: number = base;
    for (let d = 0; d < 45; d++) {
      v = Math.max(base * 0.5, v + gauss(r) * base * 0.06 + base * 0.004);
      sessions.day.push(new Date(start + d * DAY));
      sessions.device.push(device);
      sessions.sessions.push(Math.round(v));
    }
  }
}

// 5. 200 000 points in typed arrays.
const N = 200_000;
const scatter = { latency: new Float64Array(N), throughput: new Float64Array(N), cluster: new Array<string>(N) };
{
  const r = rng(99);
  const clusters = [['eu-west', 120, 5200, 28, 700], ['us-east', 210, 3600, 45, 600], ['ap-south', 330, 2100, 60, 450]] as const;
  for (let i = 0; i < N; i++) {
    const [name, mx, my, sx, sy] = clusters[i % 3];
    scatter.latency[i] = mx + gauss(r) * sx;
    scatter.throughput[i] = my + gauss(r) * sy;
    scatter.cluster[i] = name;
  }
}

// 6. A raw JSON spec with a fully custom theme: this is what a BI app would store.
const targets = months.map((m, i) => ({ month: m, actual: 310 + i * 22 + ((i * 37) % 60) - 30, target: 300 + i * 26 }));
const branded: ChartSpec = {
  title: 'Réalisé vs objectif',
  subtitle: 'Spec JSON brute, thème entièrement redéfini',
  data: targets,
  fields: { actual: { label: 'Réalisé', format: { suffix: ' k€' } }, target: { label: 'Objectif', format: { suffix: ' k€' } } },
  theme: {
    extends: 'dark',
    background: '#10131c',
    font: { family: '"Avenir Next", "Segoe UI", system-ui, sans-serif' },
    palette: { categorical: ['#7c5cff', '#22d3ee'] },
    title: { size: 16, weight: 700 },
    grid: { y: { color: '#232838' }, x: { visible: true, color: '#1a1e2b' } },
    axis: { line: { color: '#343b52' }, label: { color: '#8b93ad' } },
    marks: { bar: { radius: 10, maxWidth: 22 }, line: { width: 2.5, curve: 'smooth' }, point: { size: 9, shape: 'diamond' } },
    tooltip: { background: '#1a1f2e', radius: 12 },
  },
  layers: [
    { mark: 'bar', encode: { x: 'month', y: 'actual' } },
    { mark: 'line', encode: { x: 'month', y: 'target' } },
    { mark: 'point', encode: { x: 'month', y: 'target' }, style: { stroke: '#10131c' } },
  ],
};

// 7 & 8. Server responses going through the adapters.
const es = fromEsAggregations(esLatencyResponse());
const ch = fromClickHouse(clickHouseMrrResponse());

const specs: { spec: (theme: string) => ChartSpec; wide?: boolean }[] = [
  {
    wide: true,
    spec: (theme) =>
      chart(revenue)
        .title('Chiffre d’affaires quotidien', 'Par pays · 180 jours')
        .fields({ revenue: { label: 'CA', format: { style: 'currency', currency: 'EUR', decimals: 0 } } })
        .line({ x: 'date', y: 'revenue', color: 'country' })
        .interactions({ zoom: { axes: 'x' } })
        .theme(theme)
        .toSpec(),
  },
  {
    spec: (theme) =>
      chart(byProduct).title('Ventes par offre', 'Barres groupées').bar({ x: 'quarter', y: 'sales', color: 'product' }).theme(theme).toSpec(),
  },
  {
    spec: (theme) =>
      chart(byChannel)
        .title('Inscriptions par canal', 'Barres empilées')
        .bar({ x: 'month', y: 'signups', color: 'channel' }, { stack: true })
        .theme(theme)
        .toSpec(),
  },
  {
    spec: (theme) =>
      chart({ columns: sessions })
        .title('Sessions par appareil', 'Aires empilées, courbe lissée')
        .area({ x: 'day', y: 'sessions', color: 'device' }, { stack: true, style: { curve: 'smooth' } })
        .theme(theme)
        .toSpec(),
  },
  {
    spec: (theme) =>
      chart({ columns: scatter })
        .title('Latence vs débit', `${N.toLocaleString('fr-FR')} points · zoom sur les deux axes`)
        .fields({ latency: { label: 'Latence (ms)' }, throughput: { label: 'Débit (req/s)' } })
        .point({ x: 'latency', y: 'throughput', color: 'cluster' }, { style: { size: 2.5, strokeWidth: 0, opacity: 0.35 } })
        .axis('x', { title: 'Latence (ms)' })
        .axis('y', { title: 'Débit (req/s)' })
        .interactions({ zoom: { axes: 'xy' } })
        .theme(theme)
        .toSpec(),
  },
  { spec: () => branded },
  {
    // Elasticsearch: date_histogram > terms > avg, flattened by the adapter.
    spec: (theme) =>
      chart(es.data)
        .title('Latence moyenne par service', 'Depuis une réponse d’agrégations Elasticsearch')
        .fields(mergeFields(es.fields, { latency_ms: { label: 'Latence', format: { suffix: ' ms', decimals: 0 } } }))
        .line({ x: 'day', y: 'latency_ms', color: 'service' }, { style: { curve: 'smooth' } })
        .point({ x: 'day', y: 'latency_ms', color: 'service' }, { style: { size: 5, strokeWidth: 1 } })
        .theme(theme)
        .toSpec(),
  },
  {
    // ClickHouse result typed by its `meta`, labelled and formatted by the dbt semantic model.
    spec: (theme) =>
      chart(ch.data)
        .title('Revenu récurrent mensuel par offre', 'Réponse ClickHouse · libellés et formats issus de dbt')
        .fields(mergeFields(ch.fields, fieldsFromDbt(dbtManifest, { semanticModel: 'subscriptions' })))
        .bar({ x: 'month', y: 'mrr', color: 'plan' }, { stack: true })
        .theme(theme)
        .toSpec(),
  },
];

const grid = document.getElementById('grid')!;
const charts: { chart: Chart; spec: (theme: string) => ChartSpec }[] = [];
let theme = 'light';

for (const entry of specs) {
  const card = document.createElement('div');
  card.className = 'card' + (entry.wide ? ' wide' : '');
  grid.appendChild(card);
  const c = await Chart.create(card, entry.spec(theme));
  charts.push({ chart: c, spec: entry.spec });
}

const button = document.getElementById('theme')!;
button.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  button.textContent = theme === 'light' ? 'Thème sombre' : 'Thème clair';
  for (const c of charts) c.chart.update(c.spec(theme));
});

// Handy while developing: inspect charts from the console.
(window as any).charts = charts.map((c) => c.chart);
