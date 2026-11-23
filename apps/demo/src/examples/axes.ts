import type { Family } from './index';

// Complaints by cause, in the order they were entered: the `pareto` transform sorts them.
const complaints = [
  { cause: 'Notice', count: 24 },
  { cause: 'Retard', count: 168 },
  { cause: 'Emballage', count: 17 },
  { cause: 'Taille', count: 51 },
  { cause: 'Colis abîmé', count: 112 },
  { cause: 'Autre', count: 7 },
  { cause: 'Facturation', count: 36 },
  { cause: 'Erreur', count: 74 },
  { cause: 'SAV', count: 11 },
];

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

// Revenue with a summer dip and a strong year end; the margin rate erodes when volumes peak.
const business = MONTHS.map((month, i) => {
  const revenue = Math.round(290 + 70 * Math.sin((i - 2) / 1.9) + (i > 8 ? 45 * (i - 8) : 0) + (i % 3) * 9);
  const margin = Math.round((0.34 - 0.05 * Math.sin((i - 1) / 1.7) - (i > 9 ? 0.03 * (i - 9) : 0)) * 1000) / 1000;
  return { month, revenue, margin };
});

// A temperate climate: wet autumn, dry and warm summer.
const RAIN = [62, 51, 58, 71, 84, 76, 54, 61, 88, 104, 93, 68];
const TEMP = [3.4, 4.8, 8.6, 11.9, 16.1, 19.8, 22.4, 21.9, 17.6, 12.8, 7.3, 4.1];
const climate = MONTHS.map((month, i) => ({ month, rain: RAIN[i], temp: TEMP[i] }));

// Support teams: tickets handled (a volume) and satisfaction (a score out of 5).
const teams = [
  { team: 'Facturation', tickets: 1840, score: 4.1 },
  { team: 'Livraison', tickets: 1520, score: 3.6 },
  { team: 'Technique', tickets: 1310, score: 4.4 },
  { team: 'Compte client', tickets: 940, score: 4.6 },
  { team: 'Retours', tickets: 720, score: 3.9 },
  { team: 'Partenaires', tickets: 380, score: 4.3 },
];

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Combinaisons',
    entries: [
      {
        title: 'Diagramme de Pareto',
        caption: 'bar + line sur l’axe secondaire · transform pareto (tri décroissant, cumul en %) · annotation lue sur le second axe',
        spec: {
          title: 'Réclamations par cause',
          subtitle: 'Trois causes font 71 % des 500 réclamations',
          data: complaints,
          fields: {
            cause: { label: 'Cause' },
            count: { label: 'Réclamations' },
            cumulative: { label: 'Cumul', format: { style: 'percent', decimals: 1 } },
          },
          layers: [
            { mark: 'bar', encode: { x: 'cause', y: 'count' }, transform: [{ type: 'pareto', field: 'count' }], style: { radius: 3 } },
            {
              mark: 'line',
              axis: 'secondary',
              encode: { x: 'cause', y: 'cumulative' },
              transform: [{ type: 'pareto', field: 'count' }],
              style: { color: '$2', width: 2.5, markers: true },
            },
          ],
          // 100 % faces the total: the curve ends level with the sum of the bars.
          scales: { y: { domain: [0, 500] }, secondary: { domain: [0, 1] } },
          axes: {
            y: { title: 'Réclamations' },
            secondary: { title: 'Part cumulée', format: { style: 'percent' }, color: '$2' },
          },
          annotations: [{ y: 0.8, axis: 'secondary', text: 'Seuil de 80 %', color: '$muted' }],
        },
      },
      {
        title: 'Double axe : chiffre d’affaires et marge',
        caption: 'bar en k€ sur l’axe de gauche, line en % sur axes.secondary · chaque valeur garde son format dans l’infobulle',
        spec: {
          title: 'Chiffre d’affaires et taux de marge',
          subtitle: 'Par mois, exercice 2025',
          data: business,
          fields: {
            month: { label: 'Mois' },
            revenue: { label: 'Chiffre d’affaires', format: { suffix: ' k€' } },
            margin: { label: 'Taux de marge', format: { style: 'percent', decimals: 1 } },
          },
          layers: [
            { mark: 'bar', encode: { x: 'month', y: 'revenue' }, style: { radius: 3 } },
            { mark: 'line', axis: 'secondary', encode: { x: 'month', y: 'margin' }, style: { color: '$4', width: 2.5, markers: true, curve: 'smooth' } },
          ],
          scales: { y: { domain: [0, 500] }, secondary: { domain: [0, 0.5] } },
          axes: {
            y: { title: 'Chiffre d’affaires' },
            secondary: { title: 'Taux de marge', format: { style: 'percent' }, color: '$4' },
          },
          interactions: { zoom: true },
        },
      },
      {
        title: 'Températures et précipitations',
        caption: 'climatogramme · bar (pluie, mm) et line (température, °C) sur deux axes de valeurs indépendants',
        spec: {
          title: 'Climat de la station',
          subtitle: 'Normales mensuelles de pluie et de température',
          data: climate,
          fields: {
            month: { label: 'Mois' },
            rain: { label: 'Précipitations', format: { suffix: ' mm' } },
            temp: { label: 'Température', format: { suffix: ' °C', decimals: 1 } },
          },
          layers: [
            { mark: 'bar', encode: { x: 'month', y: 'rain' }, style: { color: '$1', radius: 3, opacity: 0.85 } },
            { mark: 'line', axis: 'secondary', encode: { x: 'month', y: 'temp' }, style: { color: '$3', width: 2.5, curve: 'smooth', markers: true } },
          ],
          scales: { y: { domain: [0, 120] }, secondary: { domain: [0, 30] } },
          axes: {
            y: { title: 'Précipitations (mm)', format: {} },
            secondary: { title: 'Température (°C)', format: { suffix: '°' }, color: '$3' },
          },
        },
      },
      {
        title: 'Double axe horizontal',
        caption: 'barres horizontales et point sur l’axe secondaire, dessiné en haut · deux unités sans rapport sur les mêmes lignes',
        spec: {
          title: 'Tickets traités et satisfaction',
          subtitle: 'Par équipe du support, sur 30 jours',
          data: teams,
          fields: {
            team: { label: 'Équipe' },
            tickets: { label: 'Tickets traités' },
            score: { label: 'Satisfaction', format: { decimals: 1, suffix: ' / 5' } },
          },
          layers: [
            { mark: 'bar', encode: { x: 'tickets', y: 'team' }, style: { radius: 3, opacity: 0.85 } },
            { mark: 'point', axis: 'secondary', encode: { x: 'score', y: 'team' }, style: { color: '$4', size: 11 } },
          ],
          scales: { x: { domain: [0, 2000] }, secondary: { domain: [0, 5] } },
          axes: {
            x: { title: 'Tickets traités' },
            secondary: { title: 'Satisfaction (sur 5)', format: {}, color: '$4' },
          },
        },
      },
    ],
  },
];
