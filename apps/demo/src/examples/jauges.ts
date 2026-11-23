import type { Family } from './index';

// Quarterly sales against target, with each region's own thresholds (k€).
const regionSales = [
  { region: 'Île-de-France', sales: 482, goal: 450, low: 300, mid: 420, high: 540 },
  { region: 'Auvergne-Rhône-Alpes', sales: 268, goal: 310, low: 200, mid: 290, high: 360 },
  { region: 'Occitanie', sales: 214, goal: 220, low: 140, mid: 200, high: 260 },
  { region: 'Nouvelle-Aquitaine', sales: 131, goal: 190, low: 120, mid: 175, high: 230 },
  { region: 'Bretagne', sales: 156, goal: 140, low: 90, mid: 130, high: 170 },
];

// Share of tickets answered within the agreed time, per support team (%).
const slaByTeam = [
  { team: 'Niveau 1', sla: 96.4, goal: 95 },
  { team: 'Niveau 2', sla: 91.2, goal: 92 },
  { team: 'Facturation', sla: 88.5, goal: 92 },
  { team: 'Technique', sla: 78.9, goal: 90 },
  { team: 'Grands comptes', sla: 98.1, goal: 97 },
  { team: 'Astreinte', sla: 84.3, goal: 85 },
];

// Pallets stored against capacity, per warehouse.
const warehouses = [
  { site: 'Lyon', pallets: 8420, capacity: 12000 },
  { site: 'Lille', pallets: 5630, capacity: 6000 },
  { site: 'Nantes', pallets: 2150, capacity: 7500 },
  { site: 'Toulouse', pallets: 4480, capacity: 9000 },
];

// Tank levels (%), colored by alert threshold.
const tanks = [
  { tank: 'Cuve A', level: 82 },
  { tank: 'Cuve B', level: 47 },
  { tank: 'Cuve C', level: 14 },
];

// A day of activity against personal goals.
const dailyActivity = [
  { goal: 'Bouger (kcal)', done: 438, target: 600 },
  { goal: 'Exercice (min)', done: 41, target: 30 },
  { goal: 'Debout (h)', done: 9, target: 12 },
  { goal: 'Sommeil (h)', done: 6.5, target: 8 },
];

// Processor load of a few servers (%).
const serverLoad = [
  { host: 'api-01', cpu: 38 },
  { host: 'api-02', cpu: 64 },
  { host: 'worker-01', cpu: 91 },
  { host: 'worker-02', cpu: 77 },
  { host: 'db-primaire', cpu: 52 },
  { host: 'cache', cpu: 12 },
];

const LEVELS = [
  { to: 60, color: '#1baf7a' },
  { to: 85, color: '#eda100' },
  { to: 100, color: '#e34948' },
];

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Indicateurs',
    entries: [
      {
        title: 'Puces à plages qualitatives',
        caption: 'bullet · mesure, objectif (trait) et trois plages par ligne (style.rangeFields) · une échelle par ligne',
        wide: true,
        spec: {
          title: 'Ventes du trimestre face à l’objectif',
          subtitle: 'Trait : objectif · plages : insuffisant, correct, bon',
          data: regionSales,
          fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } }, goal: { label: 'Objectif' } },
          layers: [
            {
              mark: 'bullet',
              encode: { key: 'region', value: 'sales', target: 'goal' },
              style: { rangeFields: ['low', 'mid', 'high'], rangeLabels: ['Insuffisant', 'Correct', 'Bon', 'Excellent'] },
            },
          ],
        },
      },
      {
        title: 'Puces sur une échelle commune',
        caption: 'bullet · style.ranges et style.shared : mêmes seuils et même axe pour toutes les lignes · style.tinted',
        spec: {
          title: 'Respect du délai de réponse',
          subtitle: 'Part des tickets traités dans le délai convenu',
          data: slaByTeam,
          fields: { sla: { label: 'Dans le délai', format: { decimals: 1, suffix: ' %' } }, goal: { label: 'Engagement' } },
          layers: [
            {
              mark: 'bullet',
              encode: { key: 'team', value: 'sla', target: 'goal' },
              style: { ranges: [80, 90, 100], rangeLabels: ['Critique', 'À surveiller', 'Conforme'], shared: true, tinted: true },
            },
          ],
        },
      },
      {
        title: 'Jauges à remplissage',
        caption: 'liquid · une jauge par ligne, remplie à valeur / encode.target · chiffre lisible sur le liquide comme sur le fond',
        wide: true,
        spec: {
          title: 'Remplissage des entrepôts',
          subtitle: 'Palettes stockées sur la capacité du site',
          data: warehouses,
          fields: { pallets: { label: 'Palettes' }, capacity: { label: 'Capacité' } },
          layers: [{ mark: 'liquid', encode: { key: 'site', value: 'pallets', target: 'capacity', color: 'site' } }],
        },
      },
      {
        title: 'Jauges liquides à seuils',
        caption: 'liquid · style.container: "rounded" · style.zones : la couleur suit le niveau',
        spec: {
          title: 'Niveau des cuves',
          subtitle: 'Alerte sous 20 %, vigilance sous 50 %',
          data: tanks,
          fields: { level: { label: 'Niveau', format: { suffix: ' %' } } },
          layers: [
            {
              mark: 'liquid',
              encode: { key: 'tank', value: 'level' },
              style: { container: 'rounded', zones: [{ to: 20, color: '#e34948' }, { to: 50, color: '#eda100' }, { to: 100, color: '#2a78d6' }] },
            },
          ],
        },
      },
      {
        title: 'Anneaux d’activité',
        caption: 'activity · un anneau par objectif (encode.target), piste teintée, bouts arrondis · second tour au-delà de 100 %',
        spec: {
          title: 'Objectifs du jour',
          subtitle: 'Réalisé sur l’objectif personnel',
          data: dailyActivity,
          fields: { done: { label: 'Réalisé' }, target: { label: 'Objectif' } },
          layers: [{ mark: 'activity', encode: { key: 'goal', value: 'done', target: 'target' } }],
        },
      },
      {
        title: 'Anneau d’objectif',
        caption: 'activity · un seul anneau : la part réalisée au centre · style.max pour l’objectif',
        spec: {
          title: 'Objectif de collecte',
          subtitle: '148 k€ réunis sur 200 k€',
          data: [{ campaign: 'Campagne d’hiver', raised: 148 }],
          fields: { raised: { label: 'Collecté', format: { suffix: ' k€' } } },
          layers: [{ mark: 'activity', encode: { key: 'campaign', value: 'raised' }, style: { max: 200, innerRadius: 0.72 } }],
        },
      },
      {
        title: 'Compteur à segments',
        caption: 'led · segments allumés jusqu’à la valeur · style.zones : chaque segment prend la couleur de son niveau',
        spec: {
          title: 'Charge des serveurs',
          subtitle: 'Processeur, moyenne sur 5 minutes',
          data: serverLoad,
          fields: { cpu: { label: 'Processeur', format: { suffix: ' %' } } },
          layers: [{ mark: 'led', encode: { key: 'host', value: 'cpu' }, style: { zones: LEVELS } }],
        },
      },
    ],
  },
];
