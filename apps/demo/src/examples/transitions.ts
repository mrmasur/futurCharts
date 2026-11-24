import type { Family } from './index';

const pad = (n: number) => String(n).padStart(2, '0');
const month = (year: number, m: number) => `${year + Math.floor(m / 12)}-${pad((m % 12) + 1)}-01`;
/** A fixed wobble per (series, position): the same data at every load (the gallery is also the visual test suite). */
const wobble = (i: number, k: number) => ((i * 37 + k * 101) % 23) / 23 - 0.5;

const PLANS = ['Essentiel', 'Équipe', 'Entreprise'];
/** Monthly subscriptions per plan, `count` points every `step` months from `from`. */
const subscriptions = (from: number, count: number, step: number, plans: string[], lift: number) =>
  plans.flatMap((plan) => {
    const k = PLANS.indexOf(plan);
    return Array.from({ length: count }, (_, i) => {
      const m = from + i * step;
      const season = 1 + 0.16 * Math.sin((m + k * 3) * (Math.PI / 6));
      return { month: month(2025, m), plan, subscriptions: Math.round((180 + 110 * k + (9 - 3 * k) * m * lift) * season * (1 + wobble(m, k) * 0.12)) };
    });
  });

// The same curves over three windows: neither the same months nor the same number of points.
const curveStates = [
  { label: '2025', data: subscriptions(0, 12, 1, PLANS, 1) },
  { label: '18 mois', data: subscriptions(0, 18, 1, PLANS, 1.6) },
  { label: 'Par trimestre', data: subscriptions(0, 8, 3, PLANS, 1.6) },
];

const SOURCES = ['Solaire', 'Éolien', 'Hydraulique', 'Biomasse'];
/** Energy produced per source and month, for one scenario. */
const energy = (scenario: number, plans: string[], gain: number) =>
  plans.flatMap((source) => {
    const k = SOURCES.indexOf(source);
    return Array.from({ length: 12 }, (_, m) => {
      const season = k === 0 ? 1 + 0.55 * Math.sin((m - 3) * (Math.PI / 6)) : k === 1 ? 1 - 0.3 * Math.sin((m - 3) * (Math.PI / 6)) : 1 + 0.1 * Math.cos(m * (Math.PI / 6));
      const growth = 1 + gain * (k === 0 ? 0.9 : k === 1 ? 0.5 : 0.05);
      return { month: month(2026, m), source, energy: Math.round((60 + 22 * (3 - k)) * season * growth * (1 + wobble(m, k + scenario) * 0.1)) };
    });
  });

const areaStates = [
  { label: 'Tendance', data: energy(0, SOURCES, 0) },
  { label: 'Scénario médian', data: energy(1, SOURCES, 0.6) },
  { label: 'Scénario haut', data: energy(2, SOURCES, 1.3) },
];

const TEAMS = ['Nord', 'Sud', 'Est', 'Ouest'];
/** Tickets closed per team and week; `weeks` first weeks only. */
const tickets = (teams: string[], weeks: number) =>
  teams.flatMap((team) => {
    const k = TEAMS.indexOf(team);
    return Array.from({ length: weeks }, (_, w) => ({ week: `S${w + 1}`, team, closed: Math.round(42 + 14 * k + 6 * Math.sin((w + k * 2) * 0.9) * (k + 1) + wobble(w, k) * 10) }));
  });

const exitStates = [
  { label: 'Quatre équipes', data: tickets(TEAMS, 10) },
  { label: 'Sans Est ni Ouest', data: tickets(['Nord', 'Sud'], 10) },
  { label: 'Six semaines', data: tickets(['Nord', 'Sud', 'Ouest'], 6) },
];

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Transitions',
    entries: [
      {
        title: 'Transition entre deux états (courbes)',
        caption: 'line · chaque courbe se déforme vers son nouvel état, même quand ni les dates ni le nombre de points ne sont les mêmes : les deux tracés sont rééchantillonnés une fois, puis interpolés sur le GPU',
        states: curveStates,
        spec: {
          title: 'Abonnements par offre',
          subtitle: 'Changez de période avec les boutons ci-dessus',
          data: curveStates[0].data,
          fields: { month: { label: 'Mois' }, subscriptions: { label: 'Abonnements' } },
          layers: [{ mark: 'line', encode: { x: 'month', y: 'subscriptions', color: 'plan' }, style: { curve: 'smooth', width: 2.5 } }],
        },
      },
      {
        title: 'Transition entre deux états (aires empilées)',
        caption: 'area empilée · chaque bande glisse vers sa nouvelle épaisseur et sa nouvelle base, sommet par sommet, sur le GPU',
        states: areaStates,
        spec: {
          title: 'Production d’énergie renouvelable',
          subtitle: 'GWh par mois · changez de scénario avec les boutons ci-dessus',
          data: areaStates[0].data,
          fields: { month: { label: 'Mois' }, energy: { label: 'Production', format: { suffix: ' GWh', decimals: 0 } } },
          layers: [{ mark: 'area', encode: { x: 'month', y: 'energy', color: 'source' }, stack: true, style: { curve: 'smooth' } }],
        },
      },
      {
        title: 'Sortie animée : séries qui disparaissent',
        caption: 'line avec repères · une série ou des semaines retirées s’estompent au lieu de disparaître d’un coup ; une série qui revient est révélée comme à l’entrée',
        states: exitStates,
        spec: {
          title: 'Tickets clos par équipe',
          subtitle: 'Retirez des équipes ou des semaines avec les boutons ci-dessus',
          data: exitStates[0].data,
          fields: { week: { label: 'Semaine' }, closed: { label: 'Tickets clos' } },
          scales: { y: { domain: [0, 140] } },
          layers: [{ mark: 'line', encode: { x: 'week', y: 'closed', color: 'team' }, style: { markers: true, width: 2.5 } }],
        },
      },
    ],
  },
];
