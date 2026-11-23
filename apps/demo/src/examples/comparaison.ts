import type { Family } from './index';

const ANSWERS = ['Pas du tout d’accord', 'Plutôt pas d’accord', 'Ni l’un ni l’autre', 'Plutôt d’accord', 'Tout à fait d’accord'];

// Internal survey, 640 answers per statement: counts per answer, from the most unfavourable.
const surveyCounts: [string, number[]][] = [
  ['Mon travail a du sens', [19, 58, 96, 275, 192]],
  ['Mon équipe s’entraide', [26, 51, 77, 262, 224]],
  ['Mes objectifs sont clairs', [45, 109, 122, 243, 121]],
  ['Ma charge est soutenable', [83, 173, 128, 192, 64]],
  ['Je vois des perspectives', [102, 166, 147, 160, 65]],
  ['Ma rémunération est juste', [128, 198, 134, 141, 39]],
];
const survey = surveyCounts.flatMap(([statement, counts]) => counts.map((answers, i) => ({ statement, answer: ANSWERS[i], answers })));

// After-sales survey on a four-level scale (no neutral answer), per contact channel.
const SATISFACTION = ['Très insatisfait', 'Insatisfait', 'Satisfait', 'Très satisfait'];
const channelCounts: [string, number[]][] = [
  ['Boutique', [14, 38, 211, 187]],
  ['Téléphone', [52, 96, 198, 104]],
  ['Chat en ligne', [31, 77, 224, 118]],
  ['Courriel', [68, 121, 187, 74]],
  ['Application', [22, 49, 236, 143]],
];
const channels = channelCounts.flatMap(([channel, counts]) => counts.map((answers, i) => ({ channel, answer: SATISFACTION[i], answers })));

// Net present value of a project (M€) when one assumption takes its low or its high value; base case 12,4 M€.
const sensitivity = [
  { driver: 'Prix de vente', low: 6.1, high: 18.9 },
  { driver: 'Volumes vendus', low: 7.8, high: 16.2 },
  { driver: 'Coût des matières', low: 15.3, high: 9.2 },
  { driver: 'Taux d’actualisation', low: 14.6, high: 10.5 },
  { driver: 'Délai de mise en service', low: 13.5, high: 10.1 },
  { driver: 'Coûts fixes', low: 13.4, high: 11.3 },
  { driver: 'Taux de change', low: 11.6, high: 13.1 },
];

// Customers of two loyalty programmes by age band (thousands).
const ageBands = ['18–24', '25–34', '35–44', '45–54', '55–64', '65 et plus'];
const classic = [41, 96, 128, 117, 84, 52];
const premium = [18, 74, 109, 83, 47, 21];
const programmes = ageBands.flatMap((age, i) => [
  { age, programme: 'Carte Classique', customers: classic[i] },
  { age, programme: 'Carte Premium', customers: premium[i] },
]);

// Consulting offers: average daily rate (€) and days sold over the year.
const offers = [
  { offer: 'Audit', rate: 1380, days: 420, family: 'Conseil' },
  { offer: 'Stratégie data', rate: 1520, days: 260, family: 'Conseil' },
  { offer: 'Intégration', rate: 870, days: 2350, family: 'Réalisation' },
  { offer: 'Développement', rate: 780, days: 3100, family: 'Réalisation' },
  { offer: 'Formation', rate: 1150, days: 310, family: 'Services' },
  { offer: 'Support', rate: 540, days: 1650, family: 'Services' },
  { offer: 'Infogérance', rate: 610, days: 1980, family: 'Services' },
];

// Hourly labour cost (€) and hours worked (millions) per workshop.
const workshops = [
  { site: 'Usinage', cost: 41.5, hours: 1.9 },
  { site: 'Fonderie', cost: 38.2, hours: 0.7 },
  { site: 'Assemblage', cost: 29.8, hours: 4.6 },
  { site: 'Peinture', cost: 33.4, hours: 1.1 },
  { site: 'Contrôle qualité', cost: 44.9, hours: 0.4 },
  { site: 'Logistique', cost: 26.3, hours: 2.8 },
  { site: 'Maintenance', cost: 47.2, hours: 0.5 },
  { site: 'Emballage', cost: 23.6, hours: 1.6 },
];

// Revenue per shop (k€), this quarter and the previous one.
const shops = [
  { shop: 'Lyon Part-Dieu', revenue: 842, before: 791 },
  { shop: 'Paris Rivoli', revenue: 816, before: 874 },
  { shop: 'Bordeaux', revenue: 655, before: 548 },
  { shop: 'Lille', revenue: 601, before: 612 },
  { shop: 'Nantes', revenue: 574, before: 472 },
  { shop: 'Marseille', revenue: 529, before: 586 },
  { shop: 'Toulouse', revenue: 498, before: 501 },
  { shop: 'Strasbourg', revenue: 377, before: 329 },
];

// Subscriptions signed against the yearly goal, per sales team.
const teams = [
  { team: 'Grands comptes', signed: 318, goal: 300 },
  { team: 'PME Nord', signed: 264, goal: 320 },
  { team: 'PME Sud', signed: 241, goal: 230 },
  { team: 'Secteur public', signed: 176, goal: 240 },
  { team: 'Partenaires', signed: 152, goal: 140 },
  { team: 'International', signed: 97, goal: 160 },
];

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Comparaison',
    entries: [
      {
        title: 'Enquête de satisfaction (Likert)',
        caption: 'likert · une ligne par question, centrée sur le milieu de la réponse neutre · parts dans les segments, totaux défavorable / favorable',
        wide: true,
        spec: {
          title: 'Baromètre interne 2026',
          subtitle: '640 réponses par affirmation',
          data: survey,
          fields: { answers: { label: 'Réponses' } },
          layers: [{ mark: 'likert', encode: { key: 'statement', color: 'answer', value: 'answers' }, style: { answers: ANSWERS } }],
          // Five long answers would fill a phone's screen: the captions under the rows say which side is which.
          responsive: [{ maxWidth: 420, maxHeight: 320, spec: { legend: false } }],
        },
      },
      {
        title: 'Likert : réponse neutre à part',
        caption: 'likert · style.neutral: "aside" : la réponse neutre sort de la pile et s’aligne dans sa propre colonne · style.sorted',
        spec: {
          title: 'Baromètre interne 2026',
          subtitle: 'Trié par part d’avis favorables',
          data: survey,
          fields: { answers: { label: 'Réponses' } },
          layers: [
            {
              mark: 'likert',
              encode: { key: 'statement', color: 'answer', value: 'answers' },
              style: { answers: ANSWERS, neutral: 'aside', sorted: true, negative: '$8', positive: '$3' },
            },
          ],
          responsive: [{ maxWidth: 420, maxHeight: 320, spec: { legend: false } }],
        },
      },
      {
        title: 'Likert à quatre niveaux',
        caption: 'likert · échelle paire, sans réponse neutre : la pile se partage exactement au milieu',
        spec: {
          title: 'Satisfaction après un contact',
          subtitle: 'Par canal, premier semestre',
          data: channels,
          fields: { answers: { label: 'Réponses' } },
          layers: [
            {
              mark: 'likert',
              encode: { key: 'channel', color: 'answer', value: 'answers' },
              style: { answers: SATISFACTION, negativeLabel: 'Insatisfaits', positiveLabel: 'Satisfaits' },
            },
          ],
        },
      },
      {
        title: 'Tornade : analyse de sensibilité',
        caption: 'tornado · style.base : résultat avec l’hypothèse basse (x) et haute (x2) autour du cas de base · trié par amplitude',
        wide: true,
        spec: {
          title: 'Sensibilité de la valeur du projet',
          subtitle: 'Valeur actuelle nette selon chaque hypothèse',
          data: sensitivity,
          fields: {
            low: { label: 'Hypothèse basse', format: { decimals: 1, suffix: ' M€' } },
            high: { label: 'Hypothèse haute', format: { decimals: 1, suffix: ' M€' } },
          },
          scales: { color: { domain: ['Hypothèse basse', 'Hypothèse haute'], colors: { 'Hypothèse basse': '$2', 'Hypothèse haute': '$1' } } },
          layers: [{ mark: 'tornado', encode: { key: 'driver', x: 'low', x2: 'high' }, style: { base: 12.4 } }],
        },
      },
      {
        title: 'Papillon : deux populations comparées',
        caption: 'tornado · deux séries (color) de part et d’autre des libellés, écrits au milieu · style.sorted: false garde l’ordre des tranches',
        spec: {
          title: 'Clients par tranche d’âge',
          subtitle: 'En milliers, par programme de fidélité',
          data: programmes,
          fields: { customers: { label: 'Clients', format: { suffix: ' k' } }, age: { label: 'Âge' } },
          layers: [{ mark: 'tornado', encode: { key: 'age', color: 'programme', value: 'customers' }, style: { sorted: false } }],
        },
      },
      {
        title: 'Barres à largeur variable',
        caption: 'variwide · hauteur = une mesure (value), largeur = une autre (size) : la surface est leur produit · noms décalés sous les barres étroites',
        wide: true,
        spec: {
          title: 'Coût du travail par atelier',
          subtitle: 'Coût horaire × heures travaillées',
          data: workshops,
          fields: {
            cost: { label: 'Coût horaire', format: { decimals: 1, suffix: ' €' } },
            hours: { label: 'Heures travaillées', format: { decimals: 1, suffix: ' M h' } },
          },
          layers: [{ mark: 'variwide', encode: { key: 'site', value: 'cost', size: 'hours' } }],
        },
      },
      {
        title: 'Largeur variable par famille',
        caption: 'variwide · encode.color regroupe les barres par famille (légende) · style.sorted trie par hauteur',
        spec: {
          title: 'Offres de service',
          subtitle: 'Taux journalier × jours vendus',
          data: offers,
          fields: {
            rate: { label: 'Taux journalier', format: { suffix: ' €' } },
            days: { label: 'Jours vendus', format: { suffix: ' j' } },
          },
          layers: [{ mark: 'variwide', encode: { key: 'offer', value: 'rate', size: 'days', color: 'family' }, style: { sorted: true } }],
        },
      },
      {
        title: 'Classement avant / après',
        caption: 'barRank · rang et places gagnées ou perdues, barre actuelle, trait de la période précédente (encode.previous), variation colorée',
        wide: true,
        spec: {
          title: 'Chiffre d’affaires par boutique',
          subtitle: 'Troisième trimestre, face au précédent',
          data: shops,
          fields: {
            revenue: { label: 'Chiffre d’affaires', format: { suffix: ' k€' } },
            before: { label: 'Trimestre précédent', format: { suffix: ' k€' } },
          },
          layers: [{ mark: 'barRank', encode: { key: 'shop', value: 'revenue', previous: 'before' } }],
        },
      },
      {
        title: 'Réalisé dans l’objectif (bar-in-bar)',
        caption: 'barInBar · barre fine (value) dans une barre large et pâle (encode.target) · part atteinte en bout de ligne',
        spec: {
          title: 'Abonnements signés',
          subtitle: 'Face à l’objectif annuel de chaque équipe',
          data: teams,
          fields: { signed: { label: 'Signés' }, goal: { label: 'Objectif' } },
          layers: [{ mark: 'barInBar', encode: { key: 'team', value: 'signed', target: 'goal' } }],
        },
      },
    ],
  },
];
