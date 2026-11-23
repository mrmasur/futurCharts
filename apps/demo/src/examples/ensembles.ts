import type { Family } from './index';

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// Customers of a subscription service: how they came, what they took, how the year ended.
const journeys = (() => {
  const channels = ['Site web', 'Boutique', 'Partenaire'];
  const plans = ['Essentiel', 'Confort', 'Premium'];
  const outcomes = ['Renouvelé', 'Monté en gamme', 'Résilié'];
  // Customers per channel and plan, then the share of each outcome per plan (shifted a little by channel).
  const volume = [
    [1840, 1260, 420],
    [620, 940, 510],
    [380, 450, 290],
  ];
  const split = [
    [0.56, 0.16, 0.28],
    [0.64, 0.19, 0.17],
    [0.83, 0, 0.17],
  ];
  const churnShift = [0.05, -0.04, 0.02];
  const rows: { canal: string; offre: string; issue: string; clients: number }[] = [];
  channels.forEach((canal, c) =>
    plans.forEach((offre, p) => {
      const churn = split[p][2] + churnShift[c];
      const up = split[p][1];
      const shares = [1 - churn - up, up, churn];
      outcomes.forEach((issue, o) => {
        const clients = Math.round(volume[c][p] * shares[o]);
        if (clients > 0) rows.push({ canal, offre, issue, clients });
      });
    }),
  );
  return rows;
})();

// One row per support ticket: nothing is counted beforehand.
const tickets = (() => {
  const r = rng(29);
  const pick = <T,>(items: T[], weights: number[]): T => {
    let x = r() * weights.reduce((a, w) => a + w, 0);
    for (let i = 0; i < items.length; i++) if ((x -= weights[i]) < 0) return items[i];
    return items[items.length - 1];
  };
  const rows: { priorite: string; canal: string; equipe: string; delai: string }[] = [];
  for (let i = 0; i < 480; i++) {
    const priorite = pick(['Basse', 'Normale', 'Haute'], [5, 8, 3]);
    const canal = pick(['E-mail', 'Chat', 'Téléphone'], priorite === 'Haute' ? [2, 3, 6] : [6, 5, 2]);
    const equipe = pick(['Niveau 1', 'Niveau 2', 'Facturation'], priorite === 'Haute' ? [2, 6, 2] : canal === 'E-mail' ? [5, 2, 4] : [7, 2, 1]);
    const delai = pick(['Dans les délais', 'En retard'], equipe === 'Niveau 2' ? [5, 4] : priorite === 'Haute' ? [6, 3] : [9, 1]);
    rows.push({ priorite, canal, equipe, delai });
  }
  return rows;
})();

// Skills listed by exactly these teams (a skill counted once, in its exact combination).
const sharedSkills = [
  { equipes: 'Data', competences: 34 },
  { equipes: 'Produit', competences: 27 },
  { equipes: 'Design', competences: 22 },
  { equipes: 'Marketing', competences: 19 },
  { equipes: 'Support', competences: 16 },
  { equipes: 'Finance', competences: 14 },
  { equipes: 'Data&Produit', competences: 18 },
  { equipes: 'Produit&Design', competences: 15 },
  { equipes: 'Data&Finance', competences: 12 },
  { equipes: 'Marketing&Produit', competences: 11 },
  { equipes: 'Support&Produit', competences: 9 },
  { equipes: 'Data&Marketing', competences: 8 },
  { equipes: 'Data&Produit&Design', competences: 7 },
  { equipes: 'Marketing&Design', competences: 6 },
  { equipes: 'Data&Produit&Marketing', competences: 5 },
  { equipes: 'Data&Produit&Finance', competences: 4 },
  { equipes: 'Support&Finance', competences: 3 },
  { equipes: 'Data&Produit&Design&Marketing', competences: 3 },
  { equipes: 'Data&Produit&Design&Marketing&Support&Finance', competences: 2 },
];

// One row per customer, with the channels they bought through.
const buyers = (() => {
  const r = rng(7);
  const channels: [string, number][] = [['Web', 0.62], ['Mobile', 0.48], ['Magasin', 0.3], ['Téléphone', 0.12], ['Place de marché', 0.2]];
  const rows: { client: string; canaux: string }[] = [];
  for (let i = 0; i < 900; i++) {
    const used = channels.filter(([, p]) => r() < p).map(([name]) => name);
    if (used.length) rows.push({ client: `C${String(i + 1).padStart(4, '0')}`, canaux: used.join('&') });
  }
  return rows;
})();

// Which module imports which, in a business intelligence application (names: layer.module).
const moduleLinks = (() => {
  const uses: Record<string, string> = {
    'interface.tableau': 'api.routes domaine.requetes interface.filtres outils.formats outils.dates',
    'interface.filtres': 'domaine.catalogue outils.dates',
    'interface.export': 'api.routes domaine.requetes outils.formats donnees.fichiers',
    'interface.partage': 'api.routes domaine.droits api.auth',
    'interface.recherche': 'domaine.catalogue api.cache',
    'interface.compte': 'api.auth domaine.droits outils.config',
    'api.routes': 'api.auth api.quotas domaine.requetes domaine.droits outils.erreurs outils.journal',
    'api.auth': 'domaine.droits outils.config outils.journal',
    'api.quotas': 'api.cache outils.config',
    'api.cache': 'outils.config outils.journal',
    'api.webhooks': 'domaine.alertes api.auth outils.erreurs',
    'domaine.requetes': 'domaine.modeles domaine.droits donnees.clickhouse donnees.elastic api.cache outils.erreurs',
    'domaine.modeles': 'domaine.catalogue donnees.dbt',
    'domaine.droits': 'outils.journal',
    'domaine.alertes': 'domaine.requetes domaine.planification outils.dates',
    'domaine.planification': 'outils.dates outils.journal',
    'domaine.catalogue': 'donnees.dbt donnees.migrations',
    'donnees.clickhouse': 'outils.config outils.erreurs outils.journal',
    'donnees.elastic': 'outils.config outils.erreurs outils.journal',
    'donnees.dbt': 'donnees.fichiers outils.config',
    'donnees.fichiers': 'outils.erreurs',
    'donnees.migrations': 'donnees.clickhouse outils.journal',
    'outils.formats': 'outils.dates',
    'outils.journal': 'outils.config',
  };
  return Object.entries(uses).flatMap(([module, list]) => list.split(' ').map((dependance) => ({ module, dependance })));
})();

// Messages exchanged between people over a quarter; teams are the groups.
const exchanges = (() => {
  const teams: Record<string, string[]> = {
    Direction: ['Élise', 'Karim'],
    Produit: ['Inès', 'Hugo', 'Maël', 'Sarah'],
    Données: ['Nora', 'Léo', 'Chloé', 'Yanis', 'Jade'],
    Ventes: ['Tom', 'Lina', 'Adam', 'Zoé'],
    Support: ['Rose', 'Noé', 'Emma'],
  };
  const nodes = Object.entries(teams).flatMap(([group, people]) => people.map((id) => ({ id, group })));
  const r = rng(53);
  const edges: { from: string; to: string; value: number }[] = [];
  nodes.forEach((a, i) =>
    nodes.forEach((b, j) => {
      if (j <= i) return;
      // People of one team talk a lot; Inès (product lead) talks to everyone.
      const p = a.group === b.group ? 0.75 : a.id === 'Inès' || b.id === 'Inès' ? 0.7 : a.group === 'Direction' || b.group === 'Direction' ? 0.3 : 0.12;
      if (r() < p) edges.push({ from: a.id, to: b.id, value: Math.round(20 + r() * (a.group === b.group ? 380 : 140)) });
    }),
  );
  return { nodes, edges };
})();

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Arbres et ensembles',
    entries: [
      {
        title: 'Parcours client par canal, offre et issue',
        caption: 'parsets · ensembles parallèles : une colonne par dimension de `path`, rubans colorés par la première, `value` pour la mesure',
        wide: true,
        spec: {
          title: 'Parcours des clients sur un an',
          subtitle: 'Du canal d’acquisition à l’issue du contrat, par offre',
          data: journeys,
          fields: { canal: { label: 'Canal' }, offre: { label: 'Offre' }, issue: { label: 'Issue' }, clients: { label: 'Clients' } },
          layers: [{ mark: 'parsets', encode: { path: ['canal', 'offre', 'issue'], value: 'clients' } }],
        },
      },
      {
        title: 'Ensembles parallèles : résiliations mises en avant',
        caption: 'parsets · `highlight` sur une catégorie de n’importe quelle colonne : son chemin ressort, le reste s’efface',
        spec: {
          title: 'D’où viennent les résiliations ?',
          subtitle: 'Résiliations selon l’offre et le canal',
          data: journeys,
          fields: { canal: { label: 'Canal' }, offre: { label: 'Offre' }, issue: { label: 'Issue' }, clients: { label: 'Clients' } },
          legend: false,
          layers: [
            {
              mark: 'parsets',
              encode: { path: ['issue', 'offre', 'canal'], value: 'clients' },
              highlight: { field: 'issue', values: ['Résilié'], color: '$8', dim: 0.3 },
            },
          ],
        },
      },
      {
        title: 'Tickets de support en ensembles parallèles',
        caption: 'parsets · sans `value`, les lignes sont comptées ; quatre dimensions, couleur choisie par `color`, catégories triées par taille',
        wide: true,
        spec: {
          title: 'Tickets de support du trimestre',
          subtitle: '480 tickets, colorés selon le respect du délai',
          data: tickets,
          fields: { priorite: { label: 'Priorité' }, canal: { label: 'Canal' }, equipe: { label: 'Équipe' }, delai: { label: 'Délai' } },
          scales: { color: { domain: ['Dans les délais', 'En retard'], colors: { 'Dans les délais': '$3', 'En retard': '$8' } } },
          layers: [
            {
              mark: 'parsets',
              encode: { path: ['priorite', 'canal', 'equipe', 'delai'], color: 'delai' },
              style: { categoryOrder: 'value', linkOpacity: 0.55 },
            },
          ],
        },
      },
      {
        title: 'Compétences partagées entre équipes (UpSet)',
        caption: 'upset · une colonne par intersection (clé « A&B »), barres triées par taille, taille de chaque ensemble à gauche',
        wide: true,
        spec: {
          title: 'Compétences partagées entre équipes',
          subtitle: 'Compétences propres à chaque combinaison d’équipes',
          data: sharedSkills,
          fields: { competences: { label: 'Compétences' } },
          layers: [{ mark: 'upset', encode: { key: 'equipes', value: 'competences' } }],
        },
      },
      {
        title: 'UpSet : combinaisons de canaux d’achat',
        caption: 'upset · une ligne par client, comptée ; `order: degree` range les intersections par nombre d’ensembles, `highlight` en fait ressortir une',
        spec: {
          title: 'Par quels canaux achètent nos clients ?',
          subtitle: 'En couleur : Web et Mobile, sans autre canal',
          data: buyers,
          layers: [
            {
              mark: 'upset',
              encode: { key: 'canaux' },
              style: { order: 'degree', maxIntersections: 16 },
              highlight: { values: ['Web&Mobile'], color: '$2', dim: 0.45 },
            },
          ],
        },
      },
    ],
  },
  {
    family: 'Flux',
    entries: [
      {
        title: 'Dépendances entre modules (faisceaux)',
        caption: 'bundle · feuilles en cercle groupées par le préfixe de leur nom (`couche.module`), liens regroupés en faisceaux ; cliquez un module',
        spec: {
          title: 'Dépendances entre modules',
          subtitle: 'Qui importe qui, par couche de l’application',
          data: moduleLinks,
          layers: [{ mark: 'bundle', encode: { source: 'module', target: 'dependance' } }],
        },
      },
      {
        title: 'Faisceaux : une personne mise en avant',
        caption: 'bundle · `layer.graph` (nœuds avec `group`, arêtes avec `value` pour l’épaisseur) et `highlight` sur un nœud : ses liens ressortent',
        spec: {
          title: 'Échanges entre équipes',
          subtitle: 'Messages du trimestre ; en avant, les échanges d’Inès',
          layers: [
            {
              mark: 'bundle',
              encode: {},
              graph: exchanges,
              style: { tension: 0.8 },
              highlight: { values: ['Inès'] },
            },
          ],
        },
      },
    ],
  },
];
