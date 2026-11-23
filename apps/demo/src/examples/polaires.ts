import type { Family } from './index';

/** Seeded generator: the examples never change from one load to the next. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Roughly normal noise from a seeded generator. */
const gauss = (r: () => number) => r() + r() + r() + r() - 2;
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const DAY = 86400000;
/** Distance between two hours around the clock. */
const around = (h: number, to: number) => Math.min(Math.abs(h - to), 24 - Math.abs(h - to));

// Four years of daily mean temperatures: a seasonal wave, a slow drift and weather noise.
const temperatures = (() => {
  const r = rng(41);
  const start = Date.UTC(2022, 0, 1);
  const days = Math.round((Date.UTC(2026, 0, 1) - start) / DAY);
  let weather = 0;
  return Array.from({ length: days }, (_, d) => {
    // Weather comes in spells: today looks like yesterday.
    weather = weather * 0.82 + gauss(r) * 1.7;
    const season = -9.6 * Math.cos(((d - 18) / 365.25) * 2 * Math.PI);
    return { day: start + d * DAY, temp: round(12.4 + season + weather + d * 0.0006) };
  });
})();

// Eight years of monthly orders: more in spring and before Christmas, growing year after year.
const monthlyOrders = (() => {
  const r = rng(7);
  return Array.from({ length: 96 }, (_, m) => {
    const month = m % 12;
    const season = 1 + 0.28 * Math.sin(((month - 2) / 12) * 2 * Math.PI) + (month === 10 ? 0.35 : month === 11 ? 0.6 : 0);
    const orders = Math.round((820 + m * 9) * season * (0.94 + r() * 0.12));
    const basket = round(54 + 9 * Math.cos(((month - 11) / 12) * 2 * Math.PI) + m * 0.08 + gauss(r) * 1.6);
    return { month: Date.UTC(2018, m, 1), orders, basket };
  });
})();

// Electricity demand by hour of the day, one curve per season (GW).
const hourlyLoad = (() => {
  const r = rng(19);
  const seasons: [string, number, number][] = [['Hiver', 62, 1], ['Mi-saison', 48, 0.7], ['Été', 41, 0.5]];
  return seasons.flatMap(([season, base, peak]) =>
    Array.from({ length: 24 }, (_, hour) => {
      const morning = 9 * Math.exp(-(around(hour, 8.5) ** 2) / 7);
      const evening = 12 * peak * Math.exp(-(around(hour, 19) ** 2) / 5);
      const night = -11 * Math.exp(-(around(hour, 3.5) ** 2) / 14);
      return { hour, season, load: round(base + morning + evening + night + gauss(r) * 0.5) };
    }),
  );
})();

// Visitors per month, two years: straight chords and a dot per month.
const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const monthlyVisitors = (() => {
  const r = rng(23);
  return [2024, 2025].flatMap((year, y) =>
    MONTHS.map((month, m) => ({
      month,
      year: String(year),
      visitors: Math.round((31 + y * 5 + 19 * Math.exp(-((m - 6.4) ** 2) / 5) + 6 * Math.exp(-((m - 3.3) ** 2) / 1.5) + gauss(r) * 1.4) * 1000),
    })),
  );
})();

// Wind measures: prevailing westerlies, strong; a weaker north-easterly regime.
const wind = (() => {
  const r = rng(5);
  return Array.from({ length: 260 }, (_, i) => {
    const west = r() < 0.62;
    const dir = (((west ? 255 : 40) + gauss(r) * (west ? 48 : 34)) % 360 + 360) % 360;
    const speed = Math.max(2, (west ? 36 : 19) + gauss(r) * (west ? 24 : 12));
    const gust = speed * (1.25 + r() * 0.5);
    return { id: `Mesure ${i + 1}`, dir: round(dir, 0), speed: round(speed), gust: round(gust), regime: west ? 'Flux d’ouest' : 'Bise de nord-est' };
  });
})();

// Support contacts by hour and channel: the stream swells in the morning and after lunch.
const contacts = (() => {
  const r = rng(13);
  const channels: [string, number, number, number][] = [['Téléphone', 46, 10.5, 15.5], ['Chat', 30, 11.5, 21], ['Email', 22, 9, 14], ['Réseaux sociaux', 12, 13, 21.5]];
  return channels.flatMap(([channel, level, a, b]) =>
    Array.from({ length: 24 }, (_, hour) => ({
      hour,
      channel,
      contacts: Math.max(1, Math.round(level * (0.08 + Math.exp(-((hour - a) ** 2) / 9) + 0.8 * Math.exp(-((hour - b) ** 2) / 7)) + r() * 2)),
    })),
  );
})();

// Renewable electricity by month and source (TWh): solar in summer, wind in winter, hydro in spring.
const production = (() => {
  const r = rng(29);
  const sources: [string, (m: number) => number][] = [
    ['Hydraulique', (m) => 5.2 + 2.4 * Math.cos(((m - 4) / 12) * 2 * Math.PI)],
    ['Éolien', (m) => 4.4 + 2.6 * Math.cos(((m - 0.5) / 12) * 2 * Math.PI)],
    ['Solaire', (m) => 2.9 - 2.3 * Math.cos(((m - 0.2) / 12) * 2 * Math.PI)],
    ['Bioénergies', (m) => 1.1 + 0.2 * Math.cos((m / 12) * 2 * Math.PI)],
  ];
  return sources.flatMap(([source, of]) => MONTHS.map((month, m) => ({ month, source, twh: round(Math.max(0.2, of(m) + gauss(r) * 0.3)) })));
})();

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Matrices et polaires',
    entries: [
      {
        title: 'Spirale des températures',
        caption: 'spiral · un tour par an, une case par jour : les saisons s’alignent en secteurs, les années se comparent d’un anneau à l’autre',
        spec: {
          title: 'Température moyenne quotidienne',
          subtitle: '2022 à 2025, un tour par an, du centre vers l’extérieur',
          data: temperatures,
          fields: { day: { type: 'time', label: 'Jour' }, temp: { label: 'Température', format: { suffix: ' °C', decimals: 1 } } },
          layers: [{ mark: 'spiral', encode: { x: 'day', value: 'temp' }, style: { turn: 'year' } }],
        },
      },
      {
        title: 'Spirale des commandes mensuelles',
        caption: 'spiral · une tuile par mois ; couleur : panier moyen, épaisseur (encode.size) : nombre de commandes',
        spec: {
          title: 'Commandes par mois',
          subtitle: 'Épaisseur : volume · couleur : panier moyen',
          data: monthlyOrders,
          fields: {
            month: { type: 'time', label: 'Mois' },
            orders: { label: 'Commandes' },
            basket: { label: 'Panier moyen', format: { suffix: ' €', decimals: 0 } },
          },
          layers: [{ mark: 'spiral', encode: { x: 'month', value: 'basket', size: 'orders' }, style: { turn: 'year', innerRadius: 0.24, gap: 2 } }],
        },
      },
      {
        title: 'Consommation électrique par heure (polaire)',
        caption: 'polarLine · l’angle est l’heure (cycle de 24 h déduit des données), le rayon la puissance ; smooth et fillOpacity',
        spec: {
          title: 'Consommation électrique sur 24 heures',
          subtitle: 'Puissance appelée moyenne par saison, en GW',
          data: hourlyLoad,
          fields: { hour: { label: 'Heure', format: { suffix: ' h' } }, load: { label: 'Puissance', format: { suffix: ' GW' } } },
          layers: [{ mark: 'polarLine', encode: { x: 'hour', y: 'load', color: 'season' }, style: { fillOpacity: 0.1 } }],
        },
      },
      {
        title: 'Fréquentation mensuelle (polaire)',
        caption: 'polarLine · catégories autour du cercle, cordes droites (smooth: false) et un point par mois',
        spec: {
          title: 'Visiteurs par mois',
          subtitle: 'Deux saisons comparées sur le même cadran',
          data: monthlyVisitors,
          fields: { visitors: { label: 'Visiteurs' } },
          layers: [{ mark: 'polarLine', encode: { x: 'month', y: 'visitors', color: 'year' }, style: { smooth: false, points: true } }],
        },
      },
      {
        title: 'Vent : direction et force',
        caption: 'polarScatter · une mesure par point : angle = direction, rayon = vitesse, taille = rafale ; style.compass nomme les caps',
        spec: {
          title: 'Mesures de vent',
          subtitle: 'Rayon : vitesse en km/h · taille : rafale',
          data: wind,
          fields: {
            dir: { label: 'Direction', format: { suffix: '°' } },
            speed: { label: 'Vitesse', format: { suffix: ' km/h' } },
            gust: { label: 'Rafale', format: { suffix: ' km/h' } },
          },
          layers: [
            {
              mark: 'polarScatter',
              encode: { angle: 'dir', y: 'speed', size: 'gust', color: 'regime', key: 'id' },
              style: { angleMax: 360, compass: true, sizeRange: [4, 16] },
            },
          ],
        },
      },
      {
        title: 'Flux radial des contacts',
        caption: 'radialArea · stack: "center" : les canaux empilés autour d’un anneau médian, sur un cadran de 24 heures',
        spec: {
          title: 'Contacts du support sur 24 heures',
          subtitle: 'Par canal · l’épaisseur suit le volume',
          data: contacts,
          fields: { hour: { label: 'Heure', format: { suffix: ' h' } }, contacts: { label: 'Contacts' } },
          layers: [{ mark: 'radialArea', stack: 'center', encode: { x: 'hour', y: 'contacts', color: 'channel' }, style: { innerRadius: 0.3 } }],
        },
      },
      {
        title: 'Aires radiales empilées',
        caption: 'radialArea · séries empilées depuis le centre, anneaux gradués ; le total se lit sur le bord extérieur',
        spec: {
          title: 'Production d’électricité renouvelable',
          subtitle: 'Par mois et par filière, en TWh',
          data: production,
          fields: { twh: { label: 'Production', format: { suffix: ' TWh' } } },
          layers: [{ mark: 'radialArea', encode: { x: 'month', y: 'twh', color: 'source' } }],
        },
      },
    ],
  },
];
