import type { Family } from './index';

// --- Operating profit bridge, in k€: from revenue to operating profit, two subtotals on the way.
const bridgeData = [
  { poste: 'Chiffre d’affaires', montant: 12480 },
  { poste: 'Achats consommés', montant: -5190 },
  { poste: 'Marge brute', montant: null },
  { poste: 'Charges de personnel', montant: -3260 },
  { poste: 'Charges externes', montant: -1140 },
  { poste: 'Impôts et taxes', montant: -215 },
  { poste: 'Autres produits', montant: 185 },
  { poste: 'Excédent brut d’exploitation', montant: null },
  { poste: 'Dotations aux amortissements', montant: -640 },
  { poste: 'Reprises de provisions', montant: 95 },
  { poste: 'Résultat d’exploitation', montant: null },
];

// --- Costs per department against budget, in k€ (above budget is bad news).
const DEPTS: [string, number, number][] = [
  ['Commerciale', 2140, 2050],
  ['Marketing', 1180, 1260],
  ['Recherche et développement', 1960, 1880],
  ['Production', 3420, 3510],
  ['Logistique', 860, 905],
  ['Finance', 540, 520],
  ['Ressources humaines', 410, 455],
  ['Systèmes d’information', 1020, 940],
];
const costs = DEPTS.map(([direction, reel, budget]) => ({ direction, reel, budget }));

// --- Monthly sales, in k€: nine months closed, three still on budget only.
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const SEASON = [0.86, 0.84, 0.97, 1.0, 1.04, 1.08, 0.95, 0.78, 1.05, 1.1, 1.12, 1.21];
const sales = MONTHS.map((mois, i) => {
  const budget = Math.round(1000 * SEASON[i] * 1.04);
  const past = i < 9;
  // Ahead of budget in spring, behind over the summer: a small deterministic swing per month.
  const swing = [0.02, -0.035, 0.041, 0.063, 0.028, -0.012, -0.058, -0.071, 0.017][i] ?? 0;
  return {
    mois,
    reel: past ? Math.round(budget * (1 + swing)) : null,
    budget,
    precedent: past ? Math.round(1000 * SEASON[i] * (0.97 + ((i * 5) % 7) * 0.006)) : null,
  };
});

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Pilotage',
    entries: [
      {
        title: 'Pont du résultat d’exploitation',
        caption: 'bridge · sous-totaux repartant de zéro (subtotals), traits de liaison, horizontal en petit',
        wide: true,
        spec: {
          title: 'Du chiffre d’affaires au résultat d’exploitation',
          subtitle: 'Exercice 2026, en milliers d’euros',
          data: bridgeData,
          fields: { montant: { label: 'Montant' } },
          layers: [
            {
              mark: 'bridge',
              encode: { key: 'poste', value: 'montant' },
              style: { subtotals: ['Chiffre d’affaires', 'Marge brute', 'Excédent brut d’exploitation', 'Résultat d’exploitation'] },
            },
          ],
          responsive: [{ maxWidth: 560, spec: { layers: [{ mark: 'bridge', encode: { key: 'poste', value: 'montant' }, style: { horizontal: true } }] } }],
        },
      },
      {
        title: 'Écarts au budget par direction',
        caption: 'variance · réel plein sur budget en contour, écart absolu et écart relatif, upIsGood: false (coûts)',
        wide: true,
        spec: {
          title: 'Coûts par direction : réel et budget',
          subtitle: 'Cumul à fin septembre, en k€',
          data: costs,
          fields: { reel: { label: 'Réel' }, budget: { label: 'Budget' } },
          layers: [
            {
              mark: 'variance',
              encode: { key: 'direction', value: 'reel', target: 'budget' },
              style: { upIsGood: false, total: true },
            },
          ],
          // Too narrow for three columns: the relative variance gives way.
          responsive: [{ maxWidth: 480, spec: { layers: [{ mark: 'variance', encode: { key: 'direction', value: 'reel', target: 'budget' }, style: { relative: false } }] } }],
        },
      },
      {
        title: 'Ventes mensuelles : réel, budget, année précédente',
        caption: 'periodBars · année précédente en gris, budget en contour, réel devant ; écart coloré au-dessus',
        wide: true,
        spec: {
          title: 'Ventes mensuelles 2026',
          subtitle: 'En k€, neuf mois clos',
          data: sales,
          fields: { reel: { label: 'Réel' }, budget: { label: 'Budget' }, precedent: { label: 'Année précédente' } },
          layers: [{ mark: 'periodBars', encode: { x: 'mois', value: 'reel', target: 'budget', previous: 'precedent' } }],
        },
      },
    ],
  },
];
