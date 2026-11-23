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

// Sales by region: revenue, margin, change against last year, share of the target, satisfaction.
const regions = [
  { region: 'Île-de-France', revenue: 4820, margin: 0.312, change: 0.084, target: 1.06, rating: 4, status: 'En avance' },
  { region: 'Auvergne-Rhône-Alpes', revenue: 3140, margin: 0.274, change: 0.052, target: 1.01, rating: 4, status: 'Conforme' },
  { region: 'Occitanie', revenue: 2210, margin: 0.238, change: 0.121, target: 1.09, rating: 5, status: 'En avance' },
  { region: 'Nouvelle-Aquitaine', revenue: 2060, margin: 0.251, change: -0.034, target: 0.93, rating: 3, status: 'À surveiller' },
  { region: 'Hauts-de-France', revenue: 1890, margin: 0.196, change: -0.071, target: 0.86, rating: 2, status: 'En retard' },
  { region: 'Provence-Alpes-Côte d’Azur', revenue: 1760, margin: 0.289, change: 0.027, target: 0.99, rating: 4, status: 'Conforme' },
  { region: 'Grand Est', revenue: 1540, margin: 0.214, change: 0.008, target: 0.97, rating: 3, status: 'Conforme' },
  { region: 'Pays de la Loire', revenue: 1320, margin: 0.262, change: 0.063, target: 1.03, rating: 4, status: 'En avance' },
  { region: 'Bretagne', revenue: 1180, margin: 0.247, change: -0.012, target: 0.95, rating: 3, status: 'À surveiller' },
  { region: 'Normandie', revenue: 940, margin: 0.183, change: -0.096, target: 0.81, rating: 2, status: 'En retard' },
];

// Project portfolio: progress, budget gap (negative: under budget), confidence of the steering committee.
const projects = (() => {
  const r = rng(31);
  const names = ['Refonte du site', 'Migration ClickHouse', 'Appli mobile v3', 'Catalogue dbt', 'Portail partenaires', 'Tarification dynamique', 'Entrepôt temps réel', 'Paiement fractionné', 'Recherche sémantique', 'Tableau de bord RSE', 'Authentification unique', 'Archivage légal', 'Support multilingue', 'API publique v2'];
  const owners = ['C. Morel', 'L. Haddad', 'S. Petit', 'A. N’Diaye', 'M. Roux', 'J. Lemaire', 'P. Girard'];
  return names.map((project, i) => {
    const progress = Math.round((0.15 + r() * 0.85) * 100) / 100;
    const gap = Math.round((r() - 0.42) * 46);
    const status = progress > 0.97 ? 'Terminé' : gap > 12 ? 'En retard' : gap > 4 ? 'À risque' : 'En cours';
    return { project, owner: owners[i % owners.length], status, progress, gap, confidence: Math.max(1, Math.min(5, Math.round(4.6 - Math.max(0, gap) / 7 + (r() - 0.5)))) };
  });
})();

// Requests passed from one team to another over a quarter, teams gathered by department.
const handoffs = (() => {
  const r = rng(11);
  const teams: [string, string][] = [
    ['Acquisition', 'Marketing'], ['Contenu', 'Marketing'], ['CRM', 'Marketing'],
    ['Web', 'Produit'], ['Mobile', 'Produit'], ['Design', 'Produit'], ['Paiement', 'Produit'],
    ['Plateforme', 'Technique'], ['Données', 'Technique'], ['Sécurité', 'Technique'],
    ['Support', 'Service client'], ['Facturation', 'Service client'],
  ];
  const rows: { from: string; to: string; dept: string; requests: number }[] = [];
  for (const [from, dept] of teams) {
    for (const [to, other] of teams) {
      if (from === to) continue;
      // Teams of a department work together; everyone leans on the platform and on data.
      const affinity = dept === other ? 0.75 : to === 'Plateforme' || to === 'Données' ? 0.55 : from === 'Support' && other === 'Produit' ? 0.6 : 0.16;
      const draw = r();
      if (draw > affinity + 0.2) continue;
      rows.push({ from, to, dept, requests: Math.max(1, Math.round(affinity * 70 * (0.35 + r()))) });
    }
  }
  return rows;
})();

// Trips between the districts of a bike-share network: no groups, sorted by traffic.
const trips = (() => {
  const r = rng(47);
  const places = ['Gare', 'Centre', 'Campus', 'Port', 'Hôpital', 'Stade', 'Halles', 'Parc'];
  const pull = [1, 0.9, 0.7, 0.45, 0.4, 0.3, 0.55, 0.35];
  const rows: { from: string; to: string; trips: number }[] = [];
  places.forEach((from, i) => {
    places.forEach((to, j) => {
      const base = i === j ? 0.18 : 1 / (1 + Math.abs(i - j) * 0.35);
      rows.push({ from, to, trips: Math.round(1900 * pull[i] * pull[j] * base * (0.6 + 0.8 * r())) });
    });
  });
  return rows;
})();

// Support tickets sorted by a classifier, against the category the agents finally gave them.
const tickets = (() => {
  const classes = ['Facturation', 'Livraison', 'Technique', 'Compte', 'Autre'];
  const counts = [
    [412, 9, 6, 31, 12],
    [14, 538, 11, 4, 23],
    [5, 16, 367, 38, 19],
    [36, 3, 44, 251, 16],
    [21, 27, 24, 18, 96],
  ];
  return classes.flatMap((actual, a) => classes.map((predicted, p) => ({ actual, predicted, count: counts[a][p] })));
})();

// Fraud detection, one row per reviewed payment (the mark counts the rows).
const payments = (() => {
  const r = rng(73);
  return Array.from({ length: 640 }, () => {
    const fraud = r() < 0.14;
    const flagged = fraud ? r() < 0.82 : r() < 0.06;
    return { actual: fraud ? 'Fraude' : 'Légitime', predicted: flagged ? 'Fraude' : 'Légitime' };
  });
})();

// Orders per day in October 2026: quiet Sundays, a promotion in the third week, one day without data.
const october = (() => {
  const r = rng(5);
  const rows: { day: string; orders: number }[] = [];
  for (let d = 1; d <= 31; d++) {
    if (d === 12) continue;
    const weekday = new Date(2026, 9, d).getDay();
    const base = weekday === 0 ? 120 : weekday === 6 ? 210 : 310;
    const promo = d >= 19 && d <= 23 ? 1.55 : 1;
    rows.push({ day: `2026-10-${pad(d)}`, orders: Math.round(base * promo * (0.85 + 0.3 * r())) });
  }
  return rows;
})();

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Tableaux',
    entries: [
      {
        title: 'Tableau de bord commercial par région',
        caption: 'table · barres, teinte, variation ▲▼, note et pastille de statut par colonne ; tri, total, colonnes abandonnées sur petit écran',
        wide: true,
        spec: {
          title: 'Ventes par région',
          subtitle: '2026, en milliers d’euros',
          data: regions,
          fields: {
            region: { label: 'Région' },
            revenue: { label: 'CA', format: { decimals: 0 } },
            margin: { label: 'Marge', format: { style: 'percent', decimals: 1 } },
            change: { label: 'Sur un an', format: { style: 'percent', decimals: 1 } },
            target: { label: 'Objectif', format: { style: 'percent', decimals: 0 } },
            rating: { label: 'Satisfaction' },
            status: { label: 'Statut' },
          },
          layers: [
            {
              mark: 'table',
              encode: {},
              style: {
                orderBy: 'revenue',
                descending: true,
                total: true,
                cols: [
                  { field: 'region' },
                  { field: 'revenue', type: 'bar', priority: 1 },
                  { field: 'change', type: 'change', priority: 2 },
                  { field: 'margin', type: 'heat', total: 'mean', priority: 3 },
                  { field: 'status', type: 'status', colors: { 'En avance': 'good', Conforme: '$1', 'À surveiller': 'warn', 'En retard': 'bad' }, priority: 4 },
                  { field: 'target', type: 'number', total: 'mean', priority: 6 },
                  { field: 'rating', type: 'rating', priority: 5 },
                ],
              },
            },
          ],
        },
      },
      {
        title: 'Suivi des projets (statuts et notes)',
        caption: 'table · rang, pastilles de statut, avancement en barre, écart autour de zéro, note en étoiles ; lignes zébrées, « + n lignes » quand la place manque',
        wide: true,
        spec: {
          title: 'Portefeuille de projets',
          subtitle: 'Avancement et écart de budget',
          data: projects,
          fields: {
            project: { label: 'Projet' },
            owner: { label: 'Responsable' },
            status: { label: 'Statut' },
            progress: { label: 'Avancement', format: { style: 'percent', decimals: 0 } },
            gap: { label: 'Écart budget', format: { suffix: ' k€', decimals: 0 } },
            confidence: { label: 'Confiance' },
          },
          layers: [
            {
              mark: 'table',
              encode: {},
              style: {
                orderBy: 'progress',
                descending: true,
                zebra: true,
                rowHeight: 30,
                cols: [
                  { type: 'rank', priority: 7 },
                  { field: 'project', priority: 0 },
                  { field: 'owner', priority: 6 },
                  { field: 'status', type: 'status', colors: { Terminé: 'good', 'En cours': '$1', 'À risque': 'warn', 'En retard': 'bad' }, priority: 1 },
                  { field: 'progress', type: 'bar', priority: 2 },
                  { field: 'gap', type: 'bar', downIsGood: true, priority: 4 },
                  { field: 'confidence', type: 'rating', shape: 'stars', priority: 5 },
                ],
              },
            },
          ],
        },
      },
      {
        title: 'Calendrier du mois',
        caption: 'calendarMonth · un mois en grille de semaines : numéro du jour, valeur et teinte par case',
        spec: {
          title: 'Commandes par jour',
          subtitle: 'Octobre 2026',
          data: october,
          fields: { day: { type: 'time', label: 'Jour' }, orders: { label: 'Commandes', format: { decimals: 0 } } },
          layers: [{ mark: 'calendarMonth', encode: { x: 'day', value: 'orders' } }],
        },
      },
    ],
  },
  {
    family: 'Matrices et polaires',
    entries: [
      {
        title: 'Flux entre équipes (matrice)',
        caption: 'matrix · source en lignes, cible en colonnes, cases teintées ; équipes regroupées par direction, totaux émis et reçus dans les marges',
        wide: true,
        spec: {
          title: 'Demandes entre équipes',
          subtitle: '3ᵉ trimestre 2026, par direction',
          data: handoffs,
          fields: { from: { label: 'De' }, to: { label: 'Vers' }, dept: { label: 'Direction' }, requests: { label: 'Demandes', format: { decimals: 0 } } },
          layers: [{ mark: 'matrix', encode: { source: 'from', target: 'to', value: 'requests', group: 'dept' } }],
        },
      },
      {
        title: 'Matrice origine-destination',
        caption: 'matrix · sans groupes, lignes triées par trafic total (`ordering: total`), sans totaux en marge',
        spec: {
          title: 'Trajets en vélo partagé',
          subtitle: 'Départs en lignes, arrivées en colonnes',
          data: trips,
          fields: { from: { label: 'Départ' }, to: { label: 'Arrivée' }, trips: { label: 'Trajets', format: { style: 'compact' } } },
          layers: [{ mark: 'matrix', encode: { source: 'from', target: 'to', value: 'trips' }, style: { ordering: 'total', totals: false } }],
        },
      },
      {
        title: 'Matrice de confusion',
        caption: 'confusion · effectif et part par case, diagonale mise en avant, rappel et précision par classe, exactitude dans le coin',
        spec: {
          title: 'Tri automatique des tickets',
          subtitle: 'Catégorie prédite contre catégorie réelle',
          data: tickets,
          fields: { actual: { label: 'Réel' }, predicted: { label: 'Prédit' }, count: { label: 'Tickets', format: { decimals: 0 } } },
          layers: [{ mark: 'confusion', encode: { y: 'actual', x: 'predicted', value: 'count' } }],
        },
      },
      {
        title: 'Matrice de confusion binaire',
        caption: 'confusion · deux classes comptées ligne à ligne (sans `value`), parts rapportées au total (`normalize: total`)',
        spec: {
          title: 'Détection de fraude',
          subtitle: '640 paiements contrôlés',
          data: payments,
          fields: { actual: { label: 'Réel' }, predicted: { label: 'Prédit' } },
          layers: [{ mark: 'confusion', encode: { y: 'actual', x: 'predicted' }, style: { normalize: 'total' } }],
        },
      },
    ],
  },
];
