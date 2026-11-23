import type { Family } from './index';

/** Seeded generator: the same data at every load (the gallery is also the visual test suite). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const pad = (n: number) => String(n).padStart(2, '0');
const month = (year: number, m: number) => `${year + Math.floor(m / 12)}-${pad((m % 12) + 1)}-01`;
const DAY = 86400000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Actual against budget, 24 months: ahead in 2025, a weak spring 2026, then a recovery.
const budget = (() => {
  const r = rng(7);
  return Array.from({ length: 24 }, (_, m) => {
    const season = 1 + 0.12 * Math.sin(((m % 12) - 2) * (Math.PI / 6));
    const plan = (420 + 9 * m) * season;
    const drift = m < 9 ? 0.06 : m < 17 ? -0.09 + 0.012 * (m - 13) ** 2 * 0.3 : 0.05;
    return { month: month(2025, m), actual: Math.round(plan * (1 + drift + (r() - 0.5) * 0.07)), budget: Math.round(plan) };
  });
})();

// Weekly visits, this year against the last: a slow start, then a campaign in spring.
const visits = (() => {
  const r = rng(21);
  const start = Date.UTC(2026, 0, 5);
  return Array.from({ length: 40 }, (_, w) => {
    const base = 18 + 5 * Math.sin((w - 6) * 0.16) + w * 0.08;
    const lift = w < 10 ? -2.6 + w * 0.12 : w < 26 ? 3.2 * Math.sin(((w - 10) / 16) * Math.PI) : -1.4 + (w - 26) * 0.2;
    return { week: day(start + w * 7 * DAY), current: Math.round((base + lift + (r() - 0.5) * 1.6) * 10) / 10, previous: Math.round((base + (r() - 0.5) * 1.2) * 10) / 10 };
  });
})();

// 18 months of orders, then 9 months of forecast as quantiles (long format: one row per level).
const orders = (() => {
  const r = rng(5);
  const rows: { month: string; orders: number; level: string }[] = [];
  let last = 0;
  for (let m = 0; m < 18; m++) {
    last = Math.round(1180 + 26 * m + 90 * Math.sin(m * 0.7) + (r() - 0.5) * 80);
    rows.push({ month: month(2025, m), orders: last, level: '' });
  }
  for (let h = 1; h <= 9; h++) {
    const median = last + 24 * h + 60 * Math.sin((17 + h) * 0.7) - 60 * Math.sin(17 * 0.7) * Math.exp(-h / 3);
    const spread = 46 * Math.sqrt(h);
    for (const [level, z] of [['p10', -1.28], ['p25', -0.67], ['p50', 0], ['p75', 0.67], ['p90', 1.28]] as const) {
      rows.push({ month: month(2025, 17 + h), orders: Math.round(median + z * spread * (z > 0 ? 1.15 : 1)), level });
    }
  }
  return rows;
})();

// A stock level: 16 weeks observed, then 150 simulated paths over 12 weeks (the mark computes the quantiles).
const stock = (() => {
  const r = rng(13);
  const gauss = () => r() + r() + r() + r() - 2;
  const start = Date.UTC(2026, 5, 1);
  const rows: { week: string; stock: number }[] = [];
  let level = 820;
  for (let w = 0; w < 16; w++) {
    level += -14 + gauss() * 22;
    rows.push({ week: day(start + w * 7 * DAY), stock: Math.round(level) });
  }
  for (let p = 0; p < 150; p++) {
    let v = level;
    const trend = -14 + gauss() * 6;
    for (let w = 16; w < 28; w++) {
      v += trend + gauss() * 24;
      rows.push({ week: day(start + w * 7 * DAY), stock: Math.round(v) });
    }
  }
  return rows;
})();

// Eight years of monthly sales: summer peak, December rush, growth stronger in autumn.
const seasonal = (() => {
  const r = rng(31);
  const shape = [0.82, 0.78, 0.9, 0.98, 1.06, 1.18, 1.3, 1.24, 1.02, 0.96, 1.04, 1.36];
  const rows: { month: string; sales: number }[] = [];
  for (let y = 0; y < 8; y++) {
    for (let m = 0; m < 12; m++) {
      const growth = 1 + y * (m >= 8 && m <= 10 ? 0.075 : m >= 5 && m <= 7 ? 0.012 : 0.04);
      rows.push({ month: month(2019 + y, m), sales: Math.round(240 * shape[m] * growth * (1 + (r() - 0.5) * 0.08)) });
    }
  }
  return rows;
})();

// Twelve weeks of daily orders for two channels: shops live on Saturdays, the web on Sundays and Mondays.
const weekdays = (() => {
  const r = rng(17);
  const start = Date.UTC(2026, 7, 31);
  const shop = [0.7, 0.8, 0.95, 0.9, 1.15, 1.6, 0.25];
  const web = [1.2, 0.95, 0.9, 0.92, 0.85, 0.9, 1.35];
  const rows: { day: string; channel: string; orders: number }[] = [];
  for (let d = 0; d < 84; d++) {
    const w = Math.floor(d / 7);
    rows.push({ day: day(start + d * DAY), channel: 'Boutiques', orders: Math.round(310 * shop[d % 7] * (1 - w * 0.006) * (1 + (r() - 0.5) * 0.14)) });
    rows.push({ day: day(start + d * DAY), channel: 'En ligne', orders: Math.round(240 * web[d % 7] * (1 + w * 0.028) * (1 + (r() - 0.5) * 0.14)) });
  }
  return rows;
})();

// Twelve months of revenue for eight product lines, each with its own story.
const lines = (() => {
  const r = rng(9);
  const defs: [string, number, (m: number) => number][] = [
    ['Vélos électriques', 412, (m) => 1 + m * 0.045],
    ['Vélos de route', 268, (m) => 1 + 0.18 * Math.sin((m - 2) * 0.55)],
    ['VTT', 231, (m) => 1 + 0.1 * Math.sin((m - 3) * 0.55) + m * 0.008],
    ['Vélos enfants', 96, (m) => 1 + (m > 8 ? (m - 8) * 0.22 : 0)],
    ['Casques', 74, (m) => 1 + m * 0.02],
    ['Antivols', 58, (m) => 1 - m * 0.024],
    ['Textile', 122, (m) => 1 - 0.2 * Math.cos(m * 0.52) - m * 0.012],
    ['Atelier', 143, (m) => 1 + 0.06 * Math.sin(m * 1.1) + m * 0.012],
  ];
  const rows: { product: string; month: string; revenue: number }[] = [];
  for (const [product, base, f] of defs) {
    for (let m = 0; m < 12; m++) rows.push({ product, month: month(2026, m), revenue: Math.round(base * f(m) * (1 + (r() - 0.5) * 0.09) * 10) / 10 });
  }
  return rows;
})();

// Market shares of six makers over seven years: two overtakes and a newcomer.
const makers = (() => {
  const r = rng(27);
  const defs: [string, number, number][] = [
    ['Alto', 31, -2.1],
    ['Borée', 24, 0.4],
    ['Cime', 17, 2.6],
    ['Delta', 14, -0.9],
    ['Éole', 9, 0.3],
    ['Flux', 2, 2.4],
  ];
  const rows: { year: string; maker: string; units: number }[] = [];
  for (let y = 0; y < 7; y++) {
    for (const [maker, base, slope] of defs) {
      rows.push({ year: `${2020 + y}-01-01`, maker, units: Math.max(1, Math.round((base + slope * y) * (1 + (r() - 0.5) * 0.1) * 10) / 10) });
    }
  }
  return rows;
})();

export const FAMILIES: Family[] = [
  {
    family: 'Évolution',
    entries: [
      {
        title: 'Réel et budget : écart coloré',
        caption: 'difference · y contre y2 · aire verte quand le réel dépasse le budget, rouge sinon, coupée exactement aux croisements',
        spec: {
          title: 'Chiffre d’affaires réel et budget',
          subtitle: 'En k€ par mois',
          data: budget,
          fields: { month: { type: 'time' }, actual: { label: 'Réel', format: { suffix: ' k€' } }, budget: { label: 'Budget', format: { suffix: ' k€' } } },
          axes: { y: { format: {} } },
          layers: [{ mark: 'difference', encode: { x: 'month', y: 'actual', y2: 'budget' }, style: { positiveLabel: 'Au-dessus du budget', negativeLabel: 'En dessous' } }],
        },
      },
      {
        title: 'Cette année face à l’an dernier',
        caption: 'difference · courbes lissées (curve) · couleurs de l’écart choisies dans la palette (positive, negative)',
        spec: {
          title: 'Visites hebdomadaires',
          subtitle: 'En milliers, par semaine',
          data: visits,
          fields: { week: { type: 'time' }, current: { label: '2026', format: { decimals: 1 } }, previous: { label: '2025', format: { decimals: 1 } } },
          scales: { y: { zero: false } },
          layers: [
            {
              mark: 'difference',
              encode: { x: 'week', y: 'current', y2: 'previous' },
              style: { curve: 'smooth', positive: '$1', negative: '$2', opacity: 0.34, referenceDash: [], positiveLabel: 'Avance', negativeLabel: 'Retard' },
            },
          ],
        },
      },
      {
        title: 'Prévision en éventail',
        caption: 'fan · quantiles p10 à p90 par ligne (encode.key) · historique en trait plein, médiane en pointillé, bandes de plus en plus claires',
        spec: {
          title: 'Commandes : historique et prévision',
          subtitle: 'Par mois · médiane et intervalles',
          data: orders,
          fields: { month: { type: 'time' }, orders: { label: 'Commandes', format: { decimals: 0 } } },
          scales: { y: { zero: false } },
          annotations: [{ x: '2026-06-01', text: 'Prévision' }],
          layers: [{ mark: 'fan', encode: { x: 'month', y: 'orders', key: 'level' } }],
        },
      },
      {
        title: 'Éventail calculé sur des simulations',
        caption: 'fan · 150 trajectoires simulées par semaine, quantiles calculés par la marque (style.quantiles) · seuil en annotation',
        spec: {
          title: 'Stock projeté',
          subtitle: 'En palettes · 150 simulations',
          data: stock,
          fields: { week: { type: 'time' }, stock: { label: 'Stock', format: { decimals: 0 } } },
          scales: { y: { zero: false, domain: [200, 900] } },
          annotations: [{ y: 350, text: 'Seuil de réassort', color: '$2' }],
          responsive: [{ maxWidth: 420, spec: { legend: false } }],
          layers: [{ mark: 'fan', encode: { x: 'week', y: 'stock' }, style: { quantiles: [0.025, 0.1, 0.25, 0.75, 0.9, 0.975], color: '$3', curve: 'smooth' } }],
        },
      },
      {
        title: 'Saisonnalité par mois (cycle plot)',
        caption: 'cycle · un panneau par mois, 2019 à 2026 dans chacun · trait horizontal : la moyenne du mois',
        wide: true,
        spec: {
          title: 'Ventes mensuelles, 2019 à 2026',
          subtitle: 'En k€ · trait sombre : moyenne du mois',
          data: seasonal,
          fields: { month: { type: 'time' }, sales: { label: 'Ventes', format: { suffix: ' k€' } } },
          layers: [{ mark: 'cycle', encode: { x: 'month', y: 'sales' } }],
        },
      },
      {
        title: 'Saisonnalité par jour de semaine',
        caption: 'cycle · period: weekday · deux séries (encode.color), une moyenne par série et par jour',
        spec: {
          title: 'Commandes par jour de la semaine',
          subtitle: 'Douze semaines, automne 2026',
          data: weekdays,
          fields: { day: { type: 'time' }, orders: { label: 'Commandes', format: { decimals: 0 } } },
          layers: [{ mark: 'cycle', encode: { x: 'day', y: 'orders', color: 'channel' }, style: { period: 'weekday', zero: true } }],
        },
      },
      {
        title: 'Tableau à sparklines',
        caption: 'sparktable · une ligne par produit : dernière valeur, variation sur un mois, mini-courbe sur douze mois, barre de comparaison',
        wide: true,
        spec: {
          title: 'Chiffre d’affaires par gamme',
          subtitle: 'Décembre 2026 · tendance sur douze mois',
          data: lines,
          fields: { month: { type: 'time' }, product: { label: 'Gamme' }, revenue: { label: 'CA (k€)', format: { decimals: 1 } } },
          layers: [{ mark: 'sparktable', encode: { key: 'product', x: 'month', y: 'revenue' }, style: { spark: 'area' } }],
        },
      },
      {
        title: 'Tableau à mini-barres trié',
        caption: 'sparktable · spark: bar · variation depuis le début de la période (change: first) · lignes triées par variation (sortBy)',
        spec: {
          title: 'Progression des gammes',
          subtitle: 'De janvier à décembre 2026',
          data: lines,
          fields: { month: { type: 'time' }, product: { label: 'Gamme' }, revenue: { label: 'CA (k€)', format: { decimals: 1 } } },
          layers: [{ mark: 'sparktable', encode: { key: 'product', x: 'month', y: 'revenue' }, style: { spark: 'bar', change: 'first', sortBy: 'change', show: ['spark', 'change', 'value'], color: '$3' } }],
        },
      },
      {
        title: 'Classement en rubans (bump area)',
        caption: 'bumpArea · un ruban par constructeur, épaisseur selon les ventes, trié du plus grand au plus petit à chaque année',
        wide: true,
        spec: {
          title: 'Ventes par constructeur',
          subtitle: 'En milliers d’unités, du premier au dernier',
          data: makers,
          fields: { year: { type: 'time' }, units: { label: 'Unités (milliers)', format: { decimals: 1 } } },
          legend: false,
          layers: [{ mark: 'bumpArea', encode: { x: 'year', key: 'maker', y: 'units' } }],
        },
      },
    ],
  },
];
