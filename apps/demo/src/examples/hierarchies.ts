import type { Family } from './index';

/** Budget of a fictional region, in millions of euros: mission, programme, amount. */
const budget: [string, string, number][] = [
  ['Éducation', 'Lycées', 412], ['Éducation', 'Apprentissage', 268], ['Éducation', 'Enseignement supérieur', 154],
  ['Éducation', 'Numérique éducatif', 73], ['Éducation', 'Orientation', 41], ['Éducation', 'Restauration scolaire', 96],
  ['Transports', 'Trains régionaux', 538], ['Transports', 'Cars interurbains', 187], ['Transports', 'Routes', 142],
  ['Transports', 'Vélo', 38], ['Transports', 'Ports et aéroports', 64], ['Transports', 'Tarification', 85],
  ['Économie', 'Aides aux entreprises', 176], ['Économie', 'Innovation', 118], ['Économie', 'Tourisme', 57],
  ['Économie', 'Agriculture', 92], ['Économie', 'Artisanat', 34],
  ['Environnement', 'Rénovation énergétique', 131], ['Environnement', 'Biodiversité', 46], ['Environnement', 'Eau', 62],
  ['Environnement', 'Déchets', 29], ['Environnement', 'Énergies renouvelables', 88],
  ['Culture et sport', 'Spectacle vivant', 58], ['Culture et sport', 'Patrimoine', 44], ['Culture et sport', 'Clubs sportifs', 37],
  ['Culture et sport', 'Équipements', 71], ['Culture et sport', 'Cinéma', 19],
  ['Santé et solidarité', 'Formations sanitaires', 124], ['Santé et solidarité', 'Maisons de santé', 48],
  ['Santé et solidarité', 'Handicap', 33], ['Santé et solidarité', 'Jeunesse', 52],
];
const budgetRows = budget.map(([mission, programme, montant]) => ({ mission, programme, montant }));

/** Yearly spending of a fictional company, in thousands of euros: category, line, amount. */
const spending: [string, string, number][] = [
  ['Personnel', 'Salaires', 2840], ['Personnel', 'Charges sociales', 1190], ['Personnel', 'Formation', 96],
  ['Personnel', 'Recrutement', 74], ['Personnel', 'Intérim', 212], ['Personnel', 'Mutuelle', 138],
  ['Informatique', 'Hébergement cloud', 486], ['Informatique', 'Licences logicielles', 324], ['Informatique', 'Matériel', 158],
  ['Informatique', 'Sécurité', 92], ['Informatique', 'Télécoms', 61],
  ['Locaux', 'Loyers', 540], ['Locaux', 'Énergie', 118], ['Locaux', 'Entretien', 67], ['Locaux', 'Assurances', 49],
  ['Commercial', 'Publicité en ligne', 298], ['Commercial', 'Salons', 134], ['Commercial', 'Déplacements', 176],
  ['Commercial', 'Commissions', 221], ['Commercial', 'Études de marché', 58],
  ['Prestataires', 'Conseil', 187], ['Prestataires', 'Juridique', 83], ['Prestataires', 'Comptabilité', 64],
  ['Prestataires', 'Traduction', 22],
  ['Divers', 'Fournitures', 31], ['Divers', 'Frais bancaires', 27], ['Divers', 'Dons et mécénat', 40],
];
const spendingRows = spending.map(([poste, ligne, montant]) => ({ poste, ligne, montant }));

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Parts et hiérarchies',
    entries: [
      {
        title: 'Budget par mission (Voronoï)',
        caption: 'voronoi · une cellule par programme, d’aire proportionnelle à son budget, regroupées par mission ; style.gap et style.groupGap règlent les liserés, style.iterations la précision des aires',
        spec: {
          title: 'Budget régional par mission',
          subtitle: 'Millions d’euros par programme, 2026',
          data: budgetRows,
          fields: { montant: { label: 'Budget', format: { suffix: ' M€', decimals: 0 } }, mission: { label: 'Mission' } },
          // On a phone the circle names its missions itself: the legend gives its room back.
          responsive: [{ maxWidth: 420, maxHeight: 320, spec: { legend: false } }],
          layers: [{ mark: 'voronoi', encode: { path: ['mission', 'programme'], value: 'montant' } }],
        },
      },
    ],
  },
  {
    family: 'Arbres et ensembles',
    entries: [
      {
        title: 'Dépenses par poste (arbre indenté)',
        caption: 'indentedTree · une ligne par nœud, sous-totaux et barre de part ; cliquez un poste pour le replier ou le déplier (style.expand : "first", "all" ou "none"), les lignes en trop sont comptées en bas',
        spec: {
          title: 'Dépenses annuelles par poste',
          subtitle: 'Milliers d’euros, exercice 2026',
          data: spendingRows,
          fields: { montant: { label: 'Dépenses', format: { suffix: ' k€', decimals: 0 } } },
          layers: [{ mark: 'indentedTree', encode: { path: ['poste', 'ligne'], value: 'montant' } }],
        },
      },
      {
        title: 'Arbre indenté replié',
        caption: 'indentedTree · style.expand: "none" : seuls les postes et leurs sous-totaux, à déplier au clic ; style.sorted: false garde l’ordre des données',
        spec: {
          title: 'Budget régional, missions repliées',
          subtitle: 'Millions d’euros, cliquez pour le détail',
          data: budgetRows,
          fields: { montant: { label: 'Budget', format: { suffix: ' M€', decimals: 0 } } },
          layers: [{ mark: 'indentedTree', encode: { path: ['mission', 'programme'], value: 'montant' }, style: { expand: 'none', sorted: false, rowHeight: 30 } }],
        },
      },
    ],
  },
];
