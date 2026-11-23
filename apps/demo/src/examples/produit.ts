import type { Family } from './index';

// --- Retention: nine monthly cohorts of sign-ups, followed month after month until September.
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.'];
const SIGNUPS = [1840, 1620, 2110, 1975, 2260, 2480, 2050, 1890, 2390];
/** Typical retention curve: a sharp first drop, then a slow erosion. */
const CURVE = [1, 0.61, 0.47, 0.4, 0.355, 0.325, 0.305, 0.29, 0.28];
const retention = MONTHS.flatMap((month, c) =>
  CURVE.slice(0, MONTHS.length - c).map((base, p) => ({
    cohorte: `${month} 2026`,
    mois: p,
    // Onboarding redone in April: later cohorts keep a few more points. A small wobble per cell.
    actifs: Math.round(SIGNUPS[c] * (p === 0 ? 1 : Math.min(0.95, base + (c >= 3 ? 0.045 : 0) + (((c * 7 + p * 5) % 9) - 4) * 0.006))),
  })),
);

// --- Revenue by region, customer segment and product line.
const REGIONS: [string, number][] = [['Île-de-France', 1.9], ['Auvergne-Rhône-Alpes', 1.25], ['Occitanie', 0.9], ['Nouvelle-Aquitaine', 0.8], ['Grand Est', 0.62], ['Bretagne', 0.5]];
const SEGMENTS: [string, number][] = [['Grands comptes', 1.5], ['PME', 1.1], ['Indépendants', 0.55], ['Secteur public', 0.4]];
const PRODUCTS: [string, number][] = [['Abonnements', 1.6], ['Services', 0.9], ['Formation', 0.45], ['Matériel', 0.3]];
const revenue = REGIONS.flatMap(([region, r], i) =>
  SEGMENTS.flatMap(([segment, s], j) =>
    PRODUCTS.map(([produit, p], k) => ({
      region,
      segment,
      produit,
      ca: Math.round(r * s * p * 118000 * (0.8 + (((i * 5 + j * 3 + k * 7) % 11) / 10) * 0.45)),
    })),
  ),
);

// --- Sign-up funnel per acquisition channel.
const STEPS = ['Visite', 'Inscription', 'Activation', 'Essai', 'Abonnement'];
const CHANNELS: [string, number[]][] = [
  ['Organique', [48200, 14900, 9100, 4350, 2180]],
  ['Publicité', [61500, 11700, 5150, 2420, 890]],
  ['Parrainage', [17800, 8900, 6400, 3900, 2340]],
];
const funnel = CHANNELS.flatMap(([canal, counts]) => STEPS.map((etape, i) => ({ etape, canal, personnes: counts[i] })));

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Analyse produit',
    entries: [
      {
        title: 'Rétention par cohorte',
        caption: 'cohort · une ligne par mois d’inscription, une colonne par mois écoulé ; taux déduits du mois 0, ligne moyenne pondérée (average), taille de la cohorte (sizes)',
        wide: true,
        spec: {
          title: 'Rétention par cohorte',
          subtitle: 'Part des inscrits encore actifs, par mois',
          fields: { cohorte: { label: 'Cohorte' }, mois: { label: 'Mois écoulés' }, actifs: { label: 'Actifs' } },
          data: retention,
          layers: [{ mark: 'cohort', encode: { y: 'cohorte', x: 'mois', value: 'actifs' } }],
        },
      },
      {
        title: 'Arbre de décomposition du chiffre d’affaires',
        caption: 'decomposition · région, segment puis produit en colonnes ; le plus grand nœud de chaque niveau est déployé, un clic déploie une autre branche (expanded pour la choisir dans la spec)',
        wide: true,
        spec: {
          title: 'Décomposition du chiffre d’affaires',
          subtitle: 'Par région, segment et produit',
          fields: {
            region: { label: 'Région' },
            segment: { label: 'Segment' },
            produit: { label: 'Produit' },
            ca: { label: 'Chiffre d’affaires', format: { style: 'compact', suffix: ' €' } },
          },
          data: revenue,
          layers: [{ mark: 'decomposition', encode: { path: ['region', 'segment', 'produit'], value: 'ca' } }],
        },
      },
      {
        title: 'Entonnoir comparé par canal',
        caption: 'funnelCompare · une barre centrée par canal et par étape, taux de passage entre les étapes, perte en clair, plus forte perte en rouge ; overall ajoute la conversion globale',
        wide: true,
        spec: {
          title: 'Entonnoir d’inscription par canal',
          subtitle: 'De la visite à l’abonnement, 3ᵉ trimestre',
          fields: { etape: { label: 'Étape' }, canal: { label: 'Canal' }, personnes: { label: 'Personnes' } },
          data: funnel,
          layers: [{ mark: 'funnelCompare', encode: { key: 'etape', color: 'canal', value: 'personnes' } }],
          // Three columns are too many for a phone: the two main channels.
          responsive: [{ maxWidth: 420, spec: { data: funnel.filter((d) => d.canal !== 'Parrainage') } }],
        },
      },
    ],
  },
];
