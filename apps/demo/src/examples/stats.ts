import type { Family } from './index';

/** Seeded generator: the same data at every load (the gallery is also the visual test suite). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Standard normal draws from a seeded generator (Box-Muller). */
function normal(seed: number) {
  const r = rng(seed);
  return () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}
const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;

// 140 support calls: most last a few minutes, a few drag on (log-normal).
const calls = (() => {
  const z = normal(11);
  return Array.from({ length: 140 }, () => ({ duration: round(Math.exp(1.7 + 0.42 * z())) }));
})();

// Age at sign-up for two offers: two humps that a single histogram would blur.
const signups = (() => {
  const z = normal(23);
  const rows: { age: number; offer: string }[] = [];
  for (let i = 0; i < 110; i++) rows.push({ age: Math.max(18, Math.round(24 + 3.2 * z())), offer: 'Offre Étudiant' });
  for (let i = 0; i < 150; i++) rows.push({ age: Math.max(18, Math.round(41 + 6.5 * z())), offer: 'Offre Famille' });
  return rows;
})();

// Delivery times of three carriers: different medians, and a longer tail for the slowest.
const deliveries = (() => {
  const z = normal(5);
  const rows: { days: number; carrier: string }[] = [];
  for (const [carrier, median, spread] of [['Colibri Express', 2.1, 0.3], ['TransNord', 3.2, 0.28], ['Fret du Sud', 4.6, 0.4]] as const) {
    for (let i = 0; i < 160; i++) rows.push({ days: round(median * Math.exp(spread * z())), carrier });
  }
  return rows;
})();

// 400 API calls: a log-normal body, and one request in twenty stuck behind a cold cache.
const latency = (() => {
  const z = normal(42);
  const r = rng(43);
  return Array.from({ length: 400 }, () => ({ ms: Math.round(180 * Math.exp(0.38 * z()) + (r() < 0.05 ? 350 + 300 * r() : 0)) }));
})();

// Weights of 500 g bags off a filling line: a textbook normal sample.
const bags = (() => {
  const z = normal(8);
  return Array.from({ length: 120 }, () => ({ weight: round(502 + 3.6 * z()) }));
})();

// Basket amounts: right-skewed, so the points bend away from the normal line.
const baskets = (() => {
  const z = normal(17);
  return Array.from({ length: 150 }, () => ({ amount: round(Math.exp(3.7 + 0.55 * z()), 2) }));
})();

// The same commute, morning and evening: the evening is slower, and more so on bad days.
const commute = (() => {
  const z = normal(31);
  return Array.from({ length: 110 }, () => ({ morning: round(27 * Math.exp(0.16 * z())), evening: round(30 * Math.exp(0.24 * z())) }));
})();

/** `n` correlated draws around (mx, my). */
function cloud(seed: number, n: number, mx: number, my: number, sx: number, sy: number, rho: number) {
  const z = normal(seed);
  return Array.from({ length: n }, () => {
    const a = z();
    const b = rho * a + Math.sqrt(1 - rho * rho) * z();
    return [mx + sx * a, my + sy * b] as const;
  });
}

// Web sessions: quick visits and long explorations, two populations in one cloud.
const sessions = [...cloud(3, 190, 3.2, 4.2, 1.0, 1.3, 0.35), ...cloud(4, 230, 10.5, 13.5, 2.3, 3.0, 0.7)]
  .filter(([m, p]) => m > 0.3 && p > 0.5)
  .map(([m, p]) => ({ minutes: round(m), pages: round(p) }));

// Three customer segments: how often they buy against how much they spend each time.
const segments = (
  [
    ['Occasionnels', 51, 150, 2.4, 38, 0.9, 9, 0.2],
    ['Fidèles', 52, 150, 7.6, 52, 1.5, 11, 0.55],
    ['Grands comptes', 53, 150, 5.0, 104, 1.2, 15, -0.45],
  ] as const
).flatMap(([segment, seed, n, mx, my, sx, sy, rho]) =>
  cloud(seed, n, mx, my, sx, sy, rho)
    .filter(([f, b]) => f > 0.2 && b > 5)
    .map(([f, b]) => ({ frequency: round(f), basket: round(b), segment })),
);

// Time to close a ticket in four teams: a tight one, a skewed one, a two-speed one, a slow one.
const tickets = (() => {
  const z = normal(61);
  const r = rng(62);
  const rows: { team: string; hours: number }[] = [];
  const add = (team: string, draw: () => number) => {
    for (let i = 0; i < 90; i++) rows.push({ team, hours: Math.max(0.5, round(draw())) });
  };
  add('Paiements', () => 9 + 1.8 * z());
  add('Livraison', () => 6 * Math.exp(0.5 * z()));
  add('Compte client', () => (r() < 0.55 ? 5 + 1.3 * z() : 15 + 2.2 * z()));
  add('Technique', () => 17 + 4 * z());
  return rows;
})();

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Distribution',
    entries: [
      {
        title: 'Diagramme à points empilés',
        caption: 'dotplot · un point par observation, empilés là où les valeurs se touchent (Wilkinson) ; la taille s’adapte',
        spec: {
          title: 'Durée des appels au support',
          subtitle: '140 appels, un point par appel',
          data: calls,
          fields: { duration: { label: 'Durée', format: { suffix: ' min' } } },
          axes: { x: { title: 'Durée de l’appel' } },
          layers: [{ mark: 'dotplot', encode: { x: 'duration' } }],
        },
      },
      {
        title: 'Points empilés par groupe',
        caption: 'dotplot + color · chaque pile se lit comme une barre empilée, les groupes restent ensemble',
        spec: {
          title: 'Âge à l’inscription',
          subtitle: '260 clients, deux offres',
          data: signups,
          fields: { age: { label: 'Âge', format: { suffix: ' ans' } } },
          layers: [{ mark: 'dotplot', encode: { x: 'age', color: 'offer' } }],
        },
      },
      {
        title: 'Fonction de répartition (ECDF)',
        caption: 'ecdf · part des observations sous chaque valeur, une courbe par groupe ; médianes projetées sur les axes',
        spec: {
          title: 'Délais de livraison par transporteur',
          subtitle: 'Part des colis livrés en moins de x jours',
          data: deliveries,
          fields: { days: { label: 'Délai', format: { suffix: ' j' } } },
          axes: { x: { title: 'Délai de livraison' }, y: { title: 'Part des colis' } },
          layers: [{ mark: 'ecdf', encode: { x: 'days', color: 'carrier' } }],
        },
      },
      {
        title: 'ECDF et quantiles',
        caption: 'ecdf · style.quantiles : médiane et 90e centile lus directement sur les axes',
        spec: {
          title: 'Temps de réponse de l’API',
          subtitle: '400 requêtes : médiane et p90',
          data: latency,
          fields: { ms: { label: 'Temps de réponse', format: { suffix: ' ms' } } },
          axes: { x: { title: 'Temps de réponse' }, y: { title: 'Part des requêtes' } },
          layers: [{ mark: 'ecdf', encode: { x: 'ms' }, style: { quantiles: [0.5, 0.9] } }],
        },
      },
      {
        title: 'Diagramme quantile-quantile',
        caption: 'qq · l’échantillon contre la loi normale : droite des quartiles et bande de confiance à 95 %',
        spec: {
          title: 'Poids des sachets de 500 g',
          subtitle: 'Les points suivent la droite : loi normale',
          data: bags,
          fields: { weight: { label: 'Poids', format: { suffix: ' g' } } },
          axes: { x: { title: 'Quantiles de la loi normale (écarts-types)' }, y: { title: 'Poids mesuré' } },
          layers: [{ mark: 'qq', encode: { x: 'weight' } }],
        },
      },
      {
        title: 'Quantile-quantile d’une loi asymétrique',
        caption: 'qq · la courbure sort de la bande : la distribution n’est pas normale',
        spec: {
          title: 'Montant des paniers',
          subtitle: 'La courbure trahit une longue traîne',
          data: baskets,
          fields: { amount: { label: 'Panier', format: { style: 'currency', currency: 'EUR' } } },
          axes: { x: { title: 'Quantiles de la loi normale (écarts-types)' }, y: { title: 'Montant du panier' } },
          layers: [{ mark: 'qq', encode: { x: 'amount' }, style: { color: '$2', referenceDash: [5, 4] } }],
        },
      },
      {
        title: 'Quantile-quantile de deux échantillons',
        caption: 'qq avec x et y · quantiles de deux séries l’une contre l’autre, la diagonale marque l’égalité',
        spec: {
          title: 'Trajet du matin contre trajet du soir',
          subtitle: 'Au-dessus de la diagonale : le soir est plus long',
          data: commute,
          fields: { morning: { label: 'Matin', format: { suffix: ' min' } }, evening: { label: 'Soir', format: { suffix: ' min' } } },
          axes: { x: { title: 'Quantiles du matin' }, y: { title: 'Quantiles du soir' } },
          layers: [{ mark: 'qq', encode: { x: 'morning', y: 'evening' }, style: { color: '$3', referenceDash: [5, 4] } }],
        },
      },
      {
        title: 'Densité 2D en courbes de niveau',
        caption: 'contour · estimation par noyau sur une grille, bandes de niveau remplies (marching squares), points par-dessus',
        spec: {
          title: 'Sessions : durée et pages vues',
          subtitle: 'Deux populations : visites éclair et explorations',
          data: sessions,
          fields: { minutes: { label: 'Durée', format: { suffix: ' min' } }, pages: { label: 'Pages vues' } },
          axes: { x: { title: 'Durée de la session' }, y: { title: 'Pages vues' } },
          layers: [{ mark: 'contour', encode: { x: 'minutes', y: 'pages' } }],
        },
      },
      {
        title: 'Densités 2D par groupe',
        caption: 'contour + color · un jeu de bandes par groupe, en couches translucides',
        spec: {
          title: 'Fréquence d’achat et panier moyen',
          subtitle: 'Trois segments de clientèle',
          data: segments,
          fields: { frequency: { label: 'Achats par an' }, basket: { label: 'Panier moyen', format: { style: 'currency', currency: 'EUR', decimals: 0 } } },
          axes: { x: { title: 'Achats par an' }, y: { title: 'Panier moyen' } },
          layers: [{ mark: 'contour', encode: { x: 'frequency', y: 'basket', color: 'segment' }, style: { levels: 5, opacity: 0.7, size: 3 } }],
        },
      },
      {
        title: 'Nuage de pluie (raincloud)',
        caption: 'raincloud · par catégorie : densité en demi-violon, boîte à moustaches et chaque observation en point',
        spec: {
          title: 'Temps de résolution des tickets',
          subtitle: 'Forme, résumé et données brutes par équipe',
          data: tickets,
          fields: { hours: { label: 'Temps de résolution', format: { suffix: ' h' } } },
          axes: { x: { title: 'Temps de résolution' } },
          layers: [{ mark: 'raincloud', encode: { x: 'hours', key: 'team' } }],
        },
      },
    ],
  },
];
