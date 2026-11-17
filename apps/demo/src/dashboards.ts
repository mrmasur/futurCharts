import type { ChartSpec } from '@futurcharts/core';
import { countriesGeo, dataFlow, delays, journeys, responseTimes, supportFlow } from './library';

/** A card on a dashboard: where it sits, what it draws, how it filters the others. */
export interface Card {
  id: string;
  title: string;
  subtitle?: string;
  /** Columns out of 12. */
  span: number;
  height: 'xs' | 's' | 'm' | 'l';
  spec: ChartSpec;
  /** Several small charts side by side (KPI tiles). */
  tiles?: ChartSpec[];
  /** Clicking a mark sets this filter. */
  filter?: keyof Filters;
  /** Show the hand-placed positions under a diagram. */
  showLayout?: boolean;
  /** No card header (KPI tiles carry their own titles). */
  bare?: boolean;
  note?: string;
}

export interface Filters {
  period: 30 | 90 | 365;
  channel?: string;
  country?: string;
  category?: string;
}

export interface Dashboard {
  id: string;
  title: string;
  subtitle: string;
  /** Has the period and dimension filters in the header. */
  filters?: boolean;
  cards(f: Filters): Card[];
}

// ------------------------------------------------------------ sales data set

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const r = rng(2027);
const DAY = 86400000;

export const COUNTRIES: [string, number, number, number][] = [
  ['France', 2.4, 46.6, 1.0], ['Allemagne', 10.4, 51.2, 1.15], ['Espagne', -3.7, 40.3, 0.6], ['Italie', 12.6, 42.9, 0.55],
  ['Royaume-Uni', -1.6, 52.8, 0.8], ['Pays-Bas', 5.4, 52.2, 0.35], ['Belgique', 4.6, 50.6, 0.25], ['Suisse', 8.2, 46.8, 0.3],
  ['Pologne', 19.2, 52.1, 0.3], ['Suède', 15.4, 61.0, 0.2],
];
export const CHANNELS: [string, number, number][] = [
  ['Organique', 1.0, 0.032], ['Payant', 0.75, 0.026], ['Email', 0.4, 0.061], ['Partenaires', 0.22, 0.038], ['Direct', 0.3, 0.052],
];
export const CATEGORIES: [string, number, number][] = [
  ['Ordinateurs', 0.55, 820], ['Téléphonie', 0.9, 410], ['Maison', 1.0, 160], ['Loisirs', 0.7, 95],
];

const END = new Date(2026, 10, 15).getTime();
const DAYS = 365;
const N = DAYS * COUNTRIES.length * CHANNELS.length * CATEGORIES.length;
/** One row per day × country × channel × category, in columns: what an analytics store would return. */
const sales = {
  day: new Int16Array(N),
  country: new Int8Array(N),
  channel: new Int8Array(N),
  category: new Int8Array(N),
  orders: new Float64Array(N),
  revenue: new Float64Array(N),
  visitors: new Float64Array(N),
};
{
  let i = 0;
  for (let d = 0; d < DAYS; d++) {
    const date = new Date(END - (DAYS - 1 - d) * DAY);
    const weekday = [0.75, 1.05, 1.0, 1.0, 1.05, 1.1, 0.85][date.getDay()];
    const season = 1 + 0.45 * Math.exp(-((date.getMonth() - 10.7) ** 2) / 1.1) + 0.12 * Math.sin((d / DAYS) * Math.PI * 2);
    const growth = 0.85 + (d / DAYS) * 0.3;
    for (let c = 0; c < COUNTRIES.length; c++) {
      for (let h = 0; h < CHANNELS.length; h++) {
        for (let k = 0; k < CATEGORIES.length; k++) {
          const orders = Math.max(0, 6 * COUNTRIES[c][3] * CHANNELS[h][1] * CATEGORIES[k][1] * weekday * season * growth * (0.7 + r() * 0.6));
          sales.day[i] = d;
          sales.country[i] = c;
          sales.channel[i] = h;
          sales.category[i] = k;
          sales.orders[i] = orders;
          sales.revenue[i] = orders * CATEGORIES[k][2] * (0.85 + r() * 0.3);
          sales.visitors[i] = orders / CHANNELS[h][2];
          i++;
        }
      }
    }
  }
}

const dateOf = (d: number) => new Date(END - (DAYS - 1 - d) * DAY);
// Per-day lookups computed once: aggregating 73 000 rows must not build a Date per row.
const DAY_MONTH = new Int32Array(DAYS);
const DAY_WEEKDAY = new Int8Array(DAYS);
const MONTH_START: Date[] = [];
const MONTH_LABEL: string[] = [];
{
  const fmt = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
  const index = new Map<number, number>();
  for (let d = 0; d < DAYS; d++) {
    const date = dateOf(d);
    const key = date.getFullYear() * 12 + date.getMonth();
    if (!index.has(key)) {
      index.set(key, MONTH_START.length);
      MONTH_START.push(new Date(date.getFullYear(), date.getMonth(), 1));
      MONTH_LABEL.push(fmt.format(date));
    }
    DAY_MONTH[d] = index.get(key)!;
    DAY_WEEKDAY[d] = (date.getDay() + 6) % 7;
  }
}

/** Rows that pass every filter except `skip` (a chart never filters itself: it highlights its own choice). */
function rows(f: Filters, skip?: keyof Filters, from = DAYS - f.period): (i: number) => boolean {
  const c = f.country && skip !== 'country' ? COUNTRIES.findIndex((x) => x[0] === f.country) : -1;
  const h = f.channel && skip !== 'channel' ? CHANNELS.findIndex((x) => x[0] === f.channel) : -1;
  const k = f.category && skip !== 'category' ? CATEGORIES.findIndex((x) => x[0] === f.category) : -1;
  return (i) => sales.day[i] >= from && (c < 0 || sales.country[i] === c) && (h < 0 || sales.channel[i] === h) && (k < 0 || sales.category[i] === k);
}

function sumBy(keep: (i: number) => boolean, key: (i: number) => number, size: number, value: Float64Array): Float64Array {
  const out = new Float64Array(size);
  for (let i = 0; i < N; i++) if (keep(i)) out[key(i)] += value[i];
  return out;
}

const euro = { style: 'currency', currency: 'EUR', decimals: 0 } as const;
const highlightOf = (value: string | undefined) => (value ? { values: [value], dim: 0.3 } : undefined);

function weekly(f: Filters, value: 'revenue' | 'orders' | 'basket' | 'conversion') {
  const keep = rows(f, undefined, DAYS - Math.max(f.period, 84));
  const weeks = Math.ceil(DAYS / 7);
  const wk = (i: number) => Math.floor((sales.day[i] - (DAYS % 7)) / 7);
  const rev = sumBy(keep, wk, weeks, sales.revenue);
  const ord = sumBy(keep, wk, weeks, sales.orders);
  const vis = sumBy(keep, wk, weeks, sales.visitors);
  const first = Math.floor((DAYS - Math.max(f.period, 84)) / 7) + 1;
  const out: { week: Date; v: number }[] = [];
  for (let w = first; w < weeks - 1; w++) {
    const v = value === 'revenue' ? rev[w] : value === 'orders' ? ord[w] : value === 'basket' ? rev[w] / (ord[w] || 1) : (ord[w] / (vis[w] || 1)) * 100;
    out.push({ week: dateOf(w * 7 + (DAYS % 7) + 6), v });
  }
  return out;
}

// ----------------------------------------------------------------- dashboards

export const sales_: Dashboard = {
  id: 'ventes',
  title: 'Ventes',
  subtitle: 'Cliquez une part, une bulle ou une barre pour filtrer tout le tableau de bord',
  filters: true,
  cards(f): Card[] {
    // Trend: daily revenue over the period.
    const keepAll = rows(f);
    const daily = sumBy(keepAll, (i) => sales.day[i], DAYS, sales.revenue);
    const trend = Array.from({ length: f.period }, (_, k) => {
      const d = DAYS - f.period + k;
      return { day: dateOf(d), revenue: daily[d] };
    });
    // By channel, country, category: filtered by the others only.
    const byChannel = sumBy(rows(f, 'channel'), (i) => sales.channel[i], CHANNELS.length, sales.revenue);
    const byCountry = sumBy(rows(f, 'country'), (i) => sales.country[i], COUNTRIES.length, sales.revenue);
    const byCategory = sumBy(rows(f, 'category'), (i) => sales.category[i], CATEGORIES.length, sales.revenue);
    // Monthly orders per channel.
    const months: { month: Date; channel: string; orders: number }[] = [];
    {
      const keep = rows(f, 'channel', 0);
      const acc = new Float64Array(MONTH_START.length * CHANNELS.length);
      for (let i = 0; i < N; i++) if (keep(i)) acc[DAY_MONTH[sales.day[i]] * CHANNELS.length + sales.channel[i]] += sales.orders[i];
      MONTH_START.forEach((month, m) => CHANNELS.forEach(([channel], h) => months.push({ month, channel, orders: Math.round(acc[m * CHANNELS.length + h]) })));
    }
    // Conversion funnel from the filtered totals.
    let visitors = 0;
    let orders = 0;
    for (let i = 0; i < N; i++) {
      if (!keepAll(i)) continue;
      visitors += sales.visitors[i];
      orders += sales.orders[i];
    }
    const funnel = [
      { stage: 'Visites', users: visitors },
      { stage: 'Fiche produit', users: visitors * 0.46 },
      { stage: 'Panier', users: visitors * 0.11 },
      { stage: 'Paiement', users: orders * 1.32 },
      { stage: 'Commande', users: orders },
    ].map((s) => ({ ...s, users: Math.round(s.users) }));
    // Orders by weekday and month.
    const heat: { weekday: string; month: string; orders: number }[] = [];
    {
      const names = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
      const keep = rows(f, undefined, 0);
      const acc = new Float64Array(MONTH_START.length * 7);
      for (let i = 0; i < N; i++) if (keep(i)) acc[DAY_MONTH[sales.day[i]] * 7 + DAY_WEEKDAY[sales.day[i]]] += sales.orders[i];
      MONTH_LABEL.forEach((month, m) => names.forEach((weekday, w) => heat.push({ weekday, month, orders: Math.round(acc[m * 7 + w] / 4.3) })));
    }

    const kpi = (title: string, value: 'revenue' | 'orders' | 'basket' | 'conversion', format: object, upIsGood = true): ChartSpec => ({
      title,
      data: weekly(f, value),
      fields: { v: { label: title, format } },
      layers: [{ mark: 'kpi', encode: { x: 'week', value: 'v' }, style: { upIsGood, size: 28 } }],
    });
    return [
      {
        id: 'kpis',
        title: 'Indicateurs de la semaine',
        subtitle: 'Dernière semaine complète, comparée à la précédente',
        bare: true,
        span: 12,
        height: 'xs',
        spec: { layers: [] },
        tiles: [
          kpi('Chiffre d’affaires', 'revenue', euro),
          kpi('Commandes', 'orders', { decimals: 0 }),
          kpi('Panier moyen', 'basket', euro),
          kpi('Taux de conversion', 'conversion', { decimals: 2, suffix: ' %' }),
        ],
      },
      {
        id: 'trend',
        title: 'Chiffre d’affaires quotidien',
        subtitle: `${f.period} derniers jours · molette pour zoomer`,
        span: 8,
        height: 'm',
        spec: {
          data: trend,
          fields: { revenue: { label: 'CA', format: euro } },
          layers: [
            { mark: 'area', encode: { x: 'day', y: 'revenue' }, style: { opacity: 0.1, line: false, curve: 'smooth' } },
            { mark: 'line', encode: { x: 'day', y: 'revenue' }, style: { curve: 'smooth' } },
          ],
          legend: false,
          interactions: { zoom: { axes: 'x' } },
        },
      },
      {
        id: 'channels',
        title: 'Par canal',
        subtitle: 'Part du chiffre d’affaires',
        span: 4,
        height: 'm',
        filter: 'channel',
        spec: {
          data: CHANNELS.map(([channel], h) => ({ channel, revenue: byChannel[h] })),
          // Compact, so the total fits in the hole of the ring.
          fields: { revenue: { label: 'Chiffre d’affaires', format: { style: 'compact', suffix: ' €' } } },
          layers: [{ mark: 'donut', encode: { key: 'channel', value: 'revenue' }, highlight: highlightOf(f.channel) }],
        },
      },
      {
        id: 'map',
        title: 'Ventes par pays',
        subtitle: 'Aire proportionnelle au chiffre d’affaires',
        span: 7,
        height: 'l',
        filter: 'country',
        spec: {
          projection: { type: 'mercator', bounds: [[-11, 35], [32, 64]] },
          fields: { revenue: { label: 'CA', format: euro }, lon: { label: 'Longitude' }, lat: { label: 'Latitude' } },
          layers: [
            { mark: 'geoshape', geo: countriesGeo, encode: {} },
            {
              mark: 'point',
              data: COUNTRIES.map(([country, lon, lat], c) => ({ country, lon, lat, revenue: byCountry[c] })),
              encode: { x: 'lon', y: 'lat', size: 'revenue' },
              style: { sizeRange: [10, 46], opacity: 0.85 },
              highlight: f.country ? { field: 'country', values: [f.country], dim: 0.3 } : undefined,
            },
          ],
          interactions: { tooltip: { mode: 'nearest' } },
        },
      },
      {
        id: 'categories',
        title: 'Par catégorie',
        subtitle: 'Chiffre d’affaires',
        span: 5,
        height: 'l',
        filter: 'category',
        spec: {
          data: CATEGORIES.map(([category], k) => ({ category, revenue: byCategory[k] })),
          fields: { revenue: { label: 'CA', format: { ...euro, style: 'compact', prefix: '', suffix: ' €' } } },
          layers: [
            {
              mark: 'bar',
              encode: { x: 'revenue', y: 'category' },
              transform: [{ type: 'sort', field: 'revenue', order: 'desc' }],
              style: { labels: true, thickness: 22 },
              highlight: highlightOf(f.category),
            },
          ],
        },
      },
      {
        id: 'monthly',
        title: 'Commandes par mois et canal',
        subtitle: '12 derniers mois',
        span: 6,
        height: 'm',
        spec: {
          data: months,
          fields: { orders: { label: 'Commandes' } },
          scales: { color: { domain: CHANNELS.map((c) => c[0]) } },
          layers: [{ mark: 'bar', encode: { x: 'month', y: 'orders', color: 'channel' }, stack: true, style: { radius: 2 }, highlight: f.channel ? { field: 'channel', values: [f.channel], dim: 0.25 } : undefined }],
        },
      },
      {
        id: 'funnel',
        title: 'Tunnel de conversion',
        subtitle: `${f.period} derniers jours`,
        span: 6,
        height: 'm',
        spec: { data: funnel, fields: { users: { label: 'Visiteurs' } }, layers: [{ mark: 'funnel', encode: { key: 'stage', value: 'users' } }] },
      },
      {
        id: 'heat',
        title: 'Commandes par jour de la semaine',
        subtitle: 'Moyenne par jour, 12 derniers mois',
        span: 12,
        height: 's',
        spec: { data: heat, fields: { orders: { label: 'Commandes' } }, layers: [{ mark: 'heatmap', encode: { x: 'month', y: 'weekday', color: 'orders' } }] },
      },
    ];
  },
};

const opsRng = rng(91);
const tickets = Array.from({ length: 180 }, (_, d) => {
  const date = new Date(END - (179 - d) * DAY);
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  return { date, tickets: Math.round((weekend ? 18 : 52) * (0.75 + opsRng() * 0.5) * (1 + (d / 180) * 0.25)) };
});
const weeklyOps = (key: 'tickets' | 'delay' | 'nps') =>
  Array.from({ length: 16 }, (_, w) => ({
    week: new Date(END - (15 - w) * 7 * DAY),
    v: key === 'tickets' ? Math.round(300 + w * 6 + opsRng() * 40) : key === 'delay' ? 6.2 - w * 0.12 + opsRng() * 0.6 : Math.round(38 + w * 0.6 + opsRng() * 4),
  }));

export const operations: Dashboard = {
  id: 'operations',
  title: 'Opérations',
  subtitle: 'Support client : volumes, délais et parcours des tickets',
  cards: (): Card[] => [
    {
      id: 'kpis',
      title: 'Indicateurs de la semaine',
      bare: true,
      span: 12,
      height: 'xs',
      spec: { layers: [] },
      tiles: [
        { title: 'Tickets ouverts', data: weeklyOps('tickets'), fields: { v: { label: 'Tickets' } }, layers: [{ mark: 'kpi', encode: { x: 'week', value: 'v' }, style: { upIsGood: false, size: 28 } }] },
        { title: 'Délai de résolution', data: weeklyOps('delay'), fields: { v: { label: 'Délai', format: { decimals: 1, suffix: ' h' } } }, layers: [{ mark: 'kpi', encode: { x: 'week', value: 'v' }, style: { upIsGood: false, size: 28 } }] },
        { title: 'NPS', data: weeklyOps('nps'), fields: { v: { label: 'NPS' } }, layers: [{ mark: 'kpi', encode: { x: 'week', value: 'v' }, style: { size: 28 } }] },
      ],
    },
    {
      id: 'flow',
      title: 'Parcours d’un ticket',
      subtitle: 'Volumes du mois · glissez les étapes pour réorganiser',
      span: 12,
      height: 'l',
      spec: { fields: { tickets: { label: 'Tickets' } }, layers: [{ mark: 'flow', graph: supportFlow, encode: { value: 'tickets' } }] },
    },
    {
      id: 'violin',
      title: 'Temps de première réponse',
      subtitle: 'Minutes, par équipe',
      span: 6,
      height: 'm',
      spec: { data: responseTimes, fields: { minutes: { label: 'Minutes', format: { decimals: 0 } } }, layers: [{ mark: 'violin', encode: { x: 'team', y: 'minutes' } }] },
    },
    {
      id: 'box',
      title: 'Délais de traitement',
      subtitle: 'Jours · boîte : quartiles · trait : médiane',
      span: 6,
      height: 'm',
      spec: {
        data: delays,
        fields: { days: { format: { decimals: 1 } } },
        scales: { color: { colors: { Moustaches: '$muted', Quartiles: '$1', Médiane: '$1' } } },
        legend: false,
        layers: [
          { mark: 'rule', name: 'Moustaches', encode: { x: 'team', y: 'lower', y2: 'upper' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { width: 1.25 } },
          { mark: 'bar', name: 'Quartiles', encode: { x: 'team', y: 'q1', y2: 'q3' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { radius: 3, maxWidth: 20, opacity: 0.16, stroke: '$1', strokeWidth: 1.5 } },
          { mark: 'tick', name: 'Médiane', encode: { x: 'team', y: 'median' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { width: 2.5, maxWidth: 20 } },
        ],
      },
    },
    {
      id: 'calendar',
      title: 'Tickets par jour',
      subtitle: '6 derniers mois',
      span: 12,
      height: 's',
      spec: { data: tickets, fields: { tickets: { label: 'Tickets' } }, layers: [{ mark: 'calendar', encode: { x: 'date', value: 'tickets' } }] },
    },
  ],
};

export const dataOps: Dashboard = {
  id: 'donnees',
  title: 'Données',
  subtitle: 'Chaînes de préparation et parcours des visiteurs',
  cards: (): Card[] => [
    {
      id: 'pipeline',
      title: 'Préparation des données de vente',
      subtitle: 'Glissez les étapes : la disposition s’enregistre en x / y dans le JSON',
      span: 12,
      height: 'l',
      showLayout: true,
      spec: { layers: [{ mark: 'flow', graph: dataFlow, encode: {} }] },
    },
    {
      id: 'sankey',
      title: 'Parcours des visiteurs',
      subtitle: 'De la source d’acquisition à l’abonnement',
      span: 12,
      height: 'm',
      spec: { data: journeys, fields: { users: { label: 'Visiteurs' } }, layers: [{ mark: 'sankey', encode: { source: 'source', target: 'target', value: 'users' } }] },
    },
  ],
};

export const DASHBOARDS: Dashboard[] = [sales_, operations, dataOps];
