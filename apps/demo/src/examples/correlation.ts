import type { Family } from './index';

/** Seeded generator (mulberry32): the examples never change between two runs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// Product portfolio: relative market share, yearly growth, revenue.
const products = (() => {
  const r = rng(41);
  const names = ['Atlas', 'Boréal', 'Cobalt', 'Delta', 'Écume', 'Fjord', 'Granit', 'Halo', 'Iris', 'Jade', 'Kiosque', 'Lagune', 'Mistral', 'Nacre'];
  // One anchor per zone, spread around it: every zone holds a few products.
  const anchors: [number, number][] = [[9, 19], [31, 17], [8, 3], [33, 4]];
  return names.map((product, i) => {
    const [sx, gy] = anchors[i % 4];
    return {
      product,
      share: round(Math.max(2, sx + (r() - 0.5) * 13)),
      growth: round(gy + (r() - 0.5) * 9),
      revenue: Math.round(180 + r() * r() * 2400),
    };
  });
})();

// Backlog of initiatives: effort in person-days, expected impact out of 10.
const initiatives = [
  { name: 'Paiement en un clic', effort: 8, impact: 8.6 },
  { name: 'Relance de panier', effort: 5, impact: 7.4 },
  { name: 'Mode sombre', effort: 13, impact: 3.1 },
  { name: 'Refonte du catalogue', effort: 55, impact: 9.1 },
  { name: 'Recherche vocale', effort: 48, impact: 3.8 },
  { name: 'Programme de fidélité', effort: 42, impact: 7.8 },
  { name: 'Export PDF', effort: 6, impact: 2.4 },
  { name: 'Avis clients', effort: 16, impact: 6.6 },
  { name: 'Application tablette', effort: 60, impact: 5.2 },
  { name: 'Suivi de livraison', effort: 21, impact: 8.0 },
  { name: 'Widgets météo', effort: 34, impact: 1.6 },
  { name: 'Connexion sociale', effort: 11, impact: 5.0 },
];

// Unemployment and inflation of a fictional economy: a loop, as in the textbooks.
const cycle = (() => {
  const r = rng(7);
  const out: { year: string; unemployment: number; inflation: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 15) * Math.PI * 2.35 + 0.5;
    const drift = i * 0.07;
    out.push({
      year: String(2008 + i),
      unemployment: round(7.6 + Math.cos(a) * (2.4 - drift) + (r() - 0.5) * 0.35),
      inflation: round(2.7 + Math.sin(a) * (1.9 + drift * 0.6) + (r() - 0.5) * 0.3),
    });
  }
  return out;
})();

// Sessions of an online shop: time spent and basket, by channel.
const sessions = (() => {
  const r = rng(2026);
  const normal = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const channels: [string, number, number, number, number, number][] = [
    ['Ordinateur', 100, 14, 4, 86, 22],
    ['Mobile', 120, 7, 2.6, 48, 15],
    ['Tablette', 60, 11, 3, 66, 16],
  ];
  const out: { channel: string; minutes: number; basket: number }[] = [];
  for (const [channel, n, m, sd, b, bsd] of channels) {
    for (let i = 0; i < n; i++) {
      const z = normal();
      out.push({ channel, minutes: round(Math.max(0.5, m + z * sd)), basket: Math.round(Math.max(6, b + (z * 0.55 + normal() * 0.83) * bsd)) });
    }
  }
  return out;
})();

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Corrélation',
    entries: [
      {
        title: 'Matrice à quadrants : portefeuille de produits',
        caption: 'quadrant · bulles (size) réparties par deux seuils (style.xThreshold, yThreshold), zones nommées par style.quadrants',
        spec: {
          title: 'Portefeuille de produits',
          subtitle: 'Part de marché, croissance et chiffre d’affaires',
          axes: { x: { title: 'Part de marché relative' }, y: { title: 'Croissance annuelle' } },
          data: products,
          fields: {
            share: { label: 'Part de marché relative', format: { decimals: 0, suffix: ' %' } },
            growth: { label: 'Croissance annuelle', format: { decimals: 0, suffix: ' %' } },
            revenue: { label: 'Chiffre d’affaires', format: { suffix: ' k€' } },
          },
          layers: [
            {
              mark: 'quadrant',
              encode: { x: 'share', y: 'growth', size: 'revenue', key: 'product' },
              style: { xThreshold: 20, yThreshold: 10, quadrants: ['Paris d’avenir', 'Locomotives', 'À arbitrer', 'Valeurs sûres'] },
            },
          ],
        },
      },
      {
        title: 'Effort et impact',
        caption: 'quadrant · sans seuil donné, les médianes séparent les zones ; chaque point est nommé là où il reste de la place',
        spec: {
          title: 'Que faire en premier ?',
          subtitle: 'Initiatives du trimestre, seuils aux médianes',
          axes: { x: { title: 'Effort (jours-personne)' }, y: { title: 'Impact attendu (sur 10)' } },
          data: initiatives,
          fields: {
            effort: { label: 'Effort (jours-personne)', format: { decimals: 0 } },
            impact: { label: 'Impact attendu (sur 10)', format: { decimals: 0 } },
          },
          scales: { color: { domain: ['Grands projets', 'À éviter', 'Gains rapides', 'Petits plus'] } },
          layers: [
            {
              mark: 'quadrant',
              encode: { x: 'effort', y: 'impact', key: 'name' },
              style: { quadrants: ['Gains rapides', 'Grands projets', 'Petits plus', 'À éviter'], size: 11 },
            },
          ],
        },
      },
      {
        title: 'Nuage connecté : chômage et inflation',
        caption: 'connected · trajectoire dans l’ordre de encode.time, flèches de sens, teinte qui fonce avec le temps, étapes clés nommées',
        spec: {
          title: 'Chômage et inflation, 2008 – 2023',
          subtitle: 'Économie fictive, une étape par année',
          axes: { x: { title: 'Taux de chômage' }, y: { title: 'Inflation' } },
          data: cycle,
          fields: {
            unemployment: { label: 'Taux de chômage', format: { decimals: 1, suffix: ' %' } },
            inflation: { label: 'Inflation', format: { decimals: 1, suffix: ' %' } },
            year: { label: 'Année' },
          },
          layers: [{ mark: 'connected', name: 'Trajectoire', encode: { x: 'unemployment', y: 'inflation', time: 'year' } }],
        },
      },
      {
        title: 'Nuage et distributions marginales',
        caption: 'marginal · histogrammes de x en haut et de y à droite, alignés sur les axes et empilés par color ; style.bins, style.share',
        spec: {
          title: 'Temps passé et panier, par appareil',
          subtitle: '280 sessions avec achat',
          axes: { x: { title: 'Durée de la session (min)' }, y: { title: 'Panier' } },
          data: sessions,
          fields: {
            minutes: { label: 'Durée de la session (min)', format: { decimals: 0 } },
            basket: { label: 'Panier', format: { decimals: 0, suffix: ' €' } },
          },
          layers: [{ mark: 'marginal', encode: { x: 'minutes', y: 'basket', color: 'channel' } }],
        },
      },
    ],
  },
];
