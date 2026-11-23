import type { ChartSpec } from '@futurcharts/core';
import type { Family } from './index';

/**
 * Examples of what the chart itself offers every mark: an ordinal axis of dates, stacked
 * charts sharing the edges of their plots, the legend's color ramp, labels turned or cut.
 */

// Deterministic data: a seeded generator, never the clock.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const round2 = (v: number) => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ sessions

type Session = { date: Date; open: number; high: number; low: number; close: number; volume: number; change: number };

/** Trading sessions from the 2nd of February 2026: no week-ends, and Easter Monday closed. */
function sessions(count: number): Session[] {
  const r = rng(29);
  const out: Session[] = [];
  let price = 86;
  for (let day = 0; out.length < count; day++) {
    const date = new Date(2026, 1, 2 + day);
    const closed = date.getDay() === 0 || date.getDay() === 6 || (date.getMonth() === 3 && date.getDate() === 6);
    if (closed) continue;
    const i = out.length;
    const drift = 0.0006 + 0.003 * Math.sin((i / count) * Math.PI * 2.4 + 0.4);
    const open = price * (1 + gauss(r) * 0.003);
    const close = open * (1 + drift + gauss(r) * 0.012);
    const high = Math.max(open, close) * (1 + Math.abs(gauss(r)) * 0.005);
    const low = Math.min(open, close) * (1 - Math.abs(gauss(r)) * 0.005);
    const volume = Math.round(900 * (0.6 + r() * 0.8) * (1 + (Math.abs(close - open) / open) * 30));
    out.push({ date, open: round2(open), high: round2(high), low: round2(low), close: round2(close), volume, change: round2(close - open) });
    price = close;
  }
  return out;
}
const cassiopee = sessions(64);
const sessionFields: ChartSpec['fields'] = {
  date: { label: 'Séance', type: 'time' },
  high: { label: 'Haut → bas', format: { suffix: ' €', decimals: 2 } },
  close: { label: 'Clôture', format: { suffix: ' €', decimals: 2 } },
  sma: { label: 'Moyenne 10 séances', format: { suffix: ' €', decimals: 2 } },
  volume: { label: 'Volume', format: { suffix: ' k', decimals: 0 } },
};

// --------------------------------------------------------------------- shops

const cities = ['Lyon', 'Lille', 'Nantes', 'Rennes', 'Nice', 'Metz', 'Dijon', 'Tours', 'Brest', 'Reims', 'Caen', 'Pau'];
const shops = (() => {
  const r = rng(11);
  return Array.from({ length: 54 }, (_, i) => {
    const surface = Math.round(180 + r() * 1400);
    const satisfaction = round2(6.1 + r() * 3.4);
    // Larger shops sell more; the satisfied ones a little more still.
    const revenue = Math.round((surface * (2.1 + r() * 1.5) + (satisfaction - 6) * 260) / 10) / 100;
    return { shop: `${cities[i % cities.length]} ${Math.floor(i / cities.length) + 1}`, surface, revenue, satisfaction };
  });
})();

const hours = ['8 h', '10 h', '12 h', '14 h', '16 h', '18 h', '20 h'];
const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const waits = days.flatMap((day, d) =>
  hours.map((hour, h) => ({
    day,
    hour,
    // Minutes of waiting: a lunch peak and a late one, heavier on Saturdays.
    minutes: Math.round((3 + 9 * Math.exp(-((h - 2.2) ** 2) / 1.6) + 6 * Math.exp(-((h - 5) ** 2) / 1.2) + (d === 5 ? 5 : d * 0.5) + ((d * 7 + h * 3) % 4)) * 10) / 10,
  })),
);

// ------------------------------------------------------------------- modules

const layersOf: Record<string, string[]> = {
  interface: ['tableau-de-bord', 'requetes', 'partage', 'alertes', 'connexion', 'preferences'],
  metier: ['catalogue', 'droits', 'planification', 'facturation', 'notifications', 'export'],
  donnees: ['clickhouse', 'elasticsearch', 'dbt', 'cache', 'audit'],
  socle: ['configuration', 'traces', 'files', 'chiffrement'],
};
const moduleNames = Object.entries(layersOf).flatMap(([layer, list]) => list.map((m) => `${layer}.${m}`));
const imports = (() => {
  const r = rng(5);
  const out: { module: string; dependance: string }[] = [];
  const order = Object.keys(layersOf);
  for (const from of moduleNames) {
    const depth = order.indexOf(from.split('.')[0]);
    // A module imports from its own layer and from the ones below it.
    const below = moduleNames.filter((m) => m !== from && order.indexOf(m.split('.')[0]) >= depth);
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n && below.length; k++) {
      const to = below[Math.floor(r() * below.length)];
      if (!out.some((l) => l.module === from && l.dependance === to)) out.push({ module: from, dependance: to });
    }
  }
  return out;
})();

// ------------------------------------------------------------------- budgets

const budgets = [
  { poste: 'Hébergement et infrastructure cloud', pole: 'Technique', montant: 412 },
  { poste: 'Licences des outils de développement', pole: 'Technique', montant: 96 },
  { poste: 'Sécurité et audits de conformité', pole: 'Technique', montant: 138 },
  { poste: 'Supervision', pole: 'Technique', montant: 44 },
  { poste: 'Campagnes d’acquisition en ligne', pole: 'Commercial', montant: 286 },
  { poste: 'Salons et événements professionnels', pole: 'Commercial', montant: 152 },
  { poste: 'Programme de parrainage', pole: 'Commercial', montant: 58 },
  { poste: 'Formation continue des équipes', pole: 'Ressources', montant: 124 },
  { poste: 'Recrutement et cabinets spécialisés', pole: 'Ressources', montant: 178 },
  { poste: 'Locaux', pole: 'Ressources', montant: 205 },
  { poste: 'Déplacements', pole: 'Ressources', montant: 37 },
];

export const FAMILIES: Family[] = [
  {
    family: 'Bourse',
    entries: [
      {
        title: 'Séances sans week-ends, panneaux alignés',
        caption:
          'scales.x.type « band » sur des dates : un axe par séance (ni week-ends ni jours fériés), gradué par quinzaine ou par mois selon la place · interactions.sync : les deux tracés partagent leurs bords gauche et droit · légende des chandeliers en deux tons, volumes en $up / $down',
        wide: true,
        stack: [270, 150],
        tiles: [
          {
            title: 'Cassiopée Santé · cours en €',
            data: cassiopee,
            fields: sessionFields,
            axes: { y: { format: { decimals: 0 } } },
            layers: [
              { mark: 'candlestick', name: 'Cours', encode: { x: 'date', y: 'high', y2: 'low', open: 'open', close: 'close' } },
              { mark: 'line', name: 'Moyenne 10 séances', encode: { x: 'date', y: 'sma' }, transform: [{ type: 'sma', field: 'close', period: 10 }], style: { color: '$1', width: 1.75 } },
            ],
            scales: { x: { type: 'band' }, y: { zero: false } },
            // A closed day takes no room: its line falls between the two sessions around it.
            annotations: [{ x: '2026-04-06', text: 'Lundi de Pâques', color: '$muted' }],
            interactions: { sync: 'seances' },
          },
          {
            title: 'Milliers de titres échangés',
            data: cassiopee,
            fields: sessionFields,
            legend: false,
            layers: [
              {
                mark: 'bar',
                encode: { x: 'date', y: 'volume' },
                style: { color: '$up', radius: 0, gap: 0, maxWidth: 0, opacity: 0.85 },
                overrides: [{ when: { field: 'change', lt: 0 }, style: { color: '$down' } }],
              },
            ],
            scales: { x: { type: 'band' } },
            axes: { y: { tickCount: 3, format: { decimals: 0 } } },
            interactions: { sync: 'seances' },
          },
        ],
      },
    ],
  },
  {
    family: 'Corrélation',
    entries: [
      {
        title: 'Nuage et légende de dégradé',
        caption: 'point · couleur portée par un champ numérique : avec legend « true », la rampe du thème et ses deux bornes remplacent les entrées par valeur',
        spec: {
          title: 'Surface, chiffre d’affaires et satisfaction',
          subtitle: '54 magasins · la couleur suit la note de satisfaction',
          data: shops,
          fields: {
            surface: { label: 'Surface de vente', format: { suffix: ' m²', decimals: 0 } },
            revenue: { label: 'Chiffre d’affaires', format: { suffix: ' M€', decimals: 1 } },
            satisfaction: { label: 'Satisfaction', format: { suffix: ' / 10', decimals: 1 } },
          },
          legend: true,
          layers: [{ mark: 'point', encode: { x: 'surface', y: 'revenue', color: 'satisfaction' }, style: { size: 11, opacity: 0.9 } }],
          axes: { x: { title: 'Surface de vente' }, y: { title: 'Chiffre d’affaires' } },
        },
      },
    ],
  },
  {
    family: 'Matrices et polaires',
    entries: [
      {
        title: 'Carte de chaleur et sa rampe',
        caption: 'heatmap · style.colorLegend : la marque fournit sa rampe (BuiltMark.legendRamp), la légende en donne les deux bornes',
        spec: {
          title: 'Attente en caisse',
          subtitle: 'Minutes d’attente moyennes, par jour et par heure',
          data: waits,
          fields: { minutes: { label: 'Attente', format: { suffix: ' min', decimals: 1 } } },
          layers: [{ mark: 'heatmap', encode: { x: 'hour', y: 'day', value: 'minutes' }, style: { colorLegend: true } }],
        },
      },
    ],
  },
  {
    family: 'Arbres et ensembles',
    entries: [
      {
        title: 'Faisceaux aux noms rayonnants',
        caption: 'bundle · style.radialLabels : chaque feuille porte son nom le long du rayon (MarkLabel.rotate), coupé par « … » au-delà de la place (maxWidth) ; survolez un module pour faire ressortir ses liens',
        spec: {
          title: 'Imports entre modules',
          subtitle: 'Chaque module importe de sa couche et des couches plus basses',
          data: imports,
          layers: [{ mark: 'bundle', encode: { source: 'module', target: 'dependance' }, style: { radialLabels: true } }],
        },
      },
    ],
  },
  {
    family: 'Parts et hiérarchies',
    entries: [
      {
        title: 'Treemap aux libellés coupés',
        caption: 'treemap · style.ellipsis : un libellé trop long pour sa tuile est coupé par « … » au lieu de disparaître ; le sous-titre, trop long pour un téléphone, finit lui aussi par « … » ; couleurs toutes fixées par scales.color.colors, légende comprise',
        spec: {
          title: 'Budget de fonctionnement par poste',
          subtitle: 'En milliers d’euros, exercice 2026, hors masse salariale et amortissements',
          data: budgets,
          fields: { montant: { label: 'Budget', format: { suffix: ' k€', decimals: 0 } } },
          // Every color given by name, no `domain`: the legend still lists the three groups.
          scales: { color: { colors: { Technique: '$1', Commercial: '$4', Ressources: '$3' } } },
          layers: [{ mark: 'treemap', encode: { key: 'poste', value: 'montant', color: 'pole' }, style: { ellipsis: true } }],
        },
      },
    ],
  },
];
