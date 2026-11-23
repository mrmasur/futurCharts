import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import type { Family } from './index';

// Natural Earth countries (public domain), shipped as TopoJSON by world-atlas. The `geoshape`
// mark itself is registered by library.ts (`registerGeo`).
const countriesGeo = feature(world as any, (world as any).objects.countries) as unknown;

/** Seeded generator: the examples never change from one load to the next. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const gauss = (r: () => number) => r() + r() + r() + r() - 2;

// Population by country, millions (rounded orders of magnitude). `name` is the Natural Earth
// name, used to find the country's place on the map.
const POPULATION: [name: string, pays: string, code: string, continent: string, millions: number][] = [
  ['China', 'Chine', 'CHN', 'Asie', 1410], ['India', 'Inde', 'IND', 'Asie', 1440], ['Indonesia', 'Indonésie', 'IDN', 'Asie', 280],
  ['Pakistan', 'Pakistan', 'PAK', 'Asie', 245], ['Bangladesh', 'Bangladesh', 'BGD', 'Asie', 174], ['Japan', 'Japon', 'JPN', 'Asie', 123],
  ['Philippines', 'Philippines', 'PHL', 'Asie', 116], ['Vietnam', 'Viêt Nam', 'VNM', 'Asie', 100], ['Iran', 'Iran', 'IRN', 'Asie', 90],
  ['Turkey', 'Turquie', 'TUR', 'Asie', 86], ['Thailand', 'Thaïlande', 'THA', 'Asie', 72], ['Myanmar', 'Birmanie', 'MMR', 'Asie', 55],
  ['South Korea', 'Corée du Sud', 'KOR', 'Asie', 52], ['Iraq', 'Irak', 'IRQ', 'Asie', 46], ['Afghanistan', 'Afghanistan', 'AFG', 'Asie', 42],
  ['Saudi Arabia', 'Arabie saoudite', 'SAU', 'Asie', 37], ['Uzbekistan', 'Ouzbékistan', 'UZB', 'Asie', 36], ['Malaysia', 'Malaisie', 'MYS', 'Asie', 35],
  ['Yemen', 'Yémen', 'YEM', 'Asie', 35], ['Nepal', 'Népal', 'NPL', 'Asie', 31], ['North Korea', 'Corée du Nord', 'PRK', 'Asie', 26],
  ['Syria', 'Syrie', 'SYR', 'Asie', 24], ['Taiwan', 'Taïwan', 'TWN', 'Asie', 23], ['Sri Lanka', 'Sri Lanka', 'LKA', 'Asie', 22],
  ['Kazakhstan', 'Kazakhstan', 'KAZ', 'Asie', 20], ['Cambodia', 'Cambodge', 'KHM', 'Asie', 17],
  ['Nigeria', 'Nigeria', 'NGA', 'Afrique', 228], ['Ethiopia', 'Éthiopie', 'ETH', 'Afrique', 129], ['Egypt', 'Égypte', 'EGY', 'Afrique', 114],
  ['Dem. Rep. Congo', 'RD Congo', 'COD', 'Afrique', 106], ['Tanzania', 'Tanzanie', 'TZA', 'Afrique', 67], ['South Africa', 'Afrique du Sud', 'ZAF', 'Afrique', 61],
  ['Kenya', 'Kenya', 'KEN', 'Afrique', 55], ['Uganda', 'Ouganda', 'UGA', 'Afrique', 49], ['Sudan', 'Soudan', 'SDN', 'Afrique', 48],
  ['Algeria', 'Algérie', 'DZA', 'Afrique', 46], ['Morocco', 'Maroc', 'MAR', 'Afrique', 38], ['Angola', 'Angola', 'AGO', 'Afrique', 37],
  ['Ghana', 'Ghana', 'GHA', 'Afrique', 34], ['Mozambique', 'Mozambique', 'MOZ', 'Afrique', 34], ['Madagascar', 'Madagascar', 'MDG', 'Afrique', 31],
  ["Côte d'Ivoire", 'Côte d’Ivoire', 'CIV', 'Afrique', 29], ['Cameroon', 'Cameroun', 'CMR', 'Afrique', 29], ['Niger', 'Niger', 'NER', 'Afrique', 27],
  ['Mali', 'Mali', 'MLI', 'Afrique', 24], ['Burkina Faso', 'Burkina Faso', 'BFA', 'Afrique', 23], ['Zambia', 'Zambie', 'ZMB', 'Afrique', 21],
  ['Chad', 'Tchad', 'TCD', 'Afrique', 19], ['Senegal', 'Sénégal', 'SEN', 'Afrique', 18], ['Somalia', 'Somalie', 'SOM', 'Afrique', 18],
  ['Zimbabwe', 'Zimbabwe', 'ZWE', 'Afrique', 17], ['Tunisia', 'Tunisie', 'TUN', 'Afrique', 12],
  ['Russia', 'Russie', 'RUS', 'Europe', 144], ['Germany', 'Allemagne', 'DEU', 'Europe', 84], ['United Kingdom', 'Royaume-Uni', 'GBR', 'Europe', 68],
  ['France', 'France', 'FRA', 'Europe', 68], ['Italy', 'Italie', 'ITA', 'Europe', 59], ['Spain', 'Espagne', 'ESP', 'Europe', 48],
  ['Ukraine', 'Ukraine', 'UKR', 'Europe', 37], ['Poland', 'Pologne', 'POL', 'Europe', 37], ['Romania', 'Roumanie', 'ROU', 'Europe', 19],
  ['Netherlands', 'Pays-Bas', 'NLD', 'Europe', 18], ['Belgium', 'Belgique', 'BEL', 'Europe', 12], ['Sweden', 'Suède', 'SWE', 'Europe', 11],
  ['Czechia', 'Tchéquie', 'CZE', 'Europe', 11], ['Greece', 'Grèce', 'GRC', 'Europe', 10], ['Portugal', 'Portugal', 'PRT', 'Europe', 10],
  ['Hungary', 'Hongrie', 'HUN', 'Europe', 10], ['Switzerland', 'Suisse', 'CHE', 'Europe', 9], ['Austria', 'Autriche', 'AUT', 'Europe', 9],
  ['United States of America', 'États-Unis', 'USA', 'Amériques', 335], ['Brazil', 'Brésil', 'BRA', 'Amériques', 216], ['Mexico', 'Mexique', 'MEX', 'Amériques', 129],
  ['Colombia', 'Colombie', 'COL', 'Amériques', 52], ['Argentina', 'Argentine', 'ARG', 'Amériques', 46], ['Canada', 'Canada', 'CAN', 'Amériques', 40],
  ['Peru', 'Pérou', 'PER', 'Amériques', 34], ['Venezuela', 'Venezuela', 'VEN', 'Amériques', 28], ['Chile', 'Chili', 'CHL', 'Amériques', 20],
  ['Ecuador', 'Équateur', 'ECU', 'Amériques', 18], ['Guatemala', 'Guatemala', 'GTM', 'Amériques', 18], ['Bolivia', 'Bolivie', 'BOL', 'Amériques', 12],
  ['Cuba', 'Cuba', 'CUB', 'Amériques', 11],
  ['Australia', 'Australie', 'AUS', 'Océanie', 27], ['Papua New Guinea', 'Papouasie', 'PNG', 'Océanie', 10], ['New Zealand', 'Nouvelle-Zélande', 'NZL', 'Océanie', 5],
];
const population = POPULATION.map(([name, pays, code, continent, millions]) => ({ name, pays, code, continent, millions }));

// Europe: population (millions) and GDP per head (thousands of euros, rounded).
const EUROPE: [name: string, pays: string, code: string, millions: number, pib: number][] = [
  ['Germany', 'Allemagne', 'DE', 84, 48], ['France', 'France', 'FR', 68, 41], ['United Kingdom', 'Royaume-Uni', 'UK', 68, 44],
  ['Italy', 'Italie', 'IT', 59, 35], ['Spain', 'Espagne', 'ES', 48, 30], ['Poland', 'Pologne', 'PL', 37, 20],
  ['Romania', 'Roumanie', 'RO', 19, 17], ['Netherlands', 'Pays-Bas', 'NL', 18, 58], ['Belgium', 'Belgique', 'BE', 12, 50],
  ['Czechia', 'Tchéquie', 'CZ', 11, 29], ['Sweden', 'Suède', 'SE', 11, 52], ['Portugal', 'Portugal', 'PT', 10, 25],
  ['Greece', 'Grèce', 'GR', 10, 21], ['Hungary', 'Hongrie', 'HU', 10, 20], ['Austria', 'Autriche', 'AT', 9, 52],
  ['Switzerland', 'Suisse', 'CH', 9, 92], ['Bulgaria', 'Bulgarie', 'BG', 6.5, 15], ['Denmark', 'Danemark', 'DK', 6, 64],
  ['Finland', 'Finlande', 'FI', 5.6, 49], ['Norway', 'Norvège', 'NO', 5.5, 80], ['Ireland', 'Irlande', 'IE', 5.3, 95],
  ['Slovakia', 'Slovaquie', 'SK', 5.4, 23], ['Croatia', 'Croatie', 'HR', 3.9, 20], ['Lithuania', 'Lituanie', 'LT', 2.9, 25],
  ['Serbia', 'Serbie', 'RS', 6.6, 11], ['Belarus', 'Biélorussie', 'BY', 9.2, 7], ['Ukraine', 'Ukraine', 'UA', 37, 5],
];
const europe = EUROPE.map(([name, pays, code, millions, pib]) => ({ name, pays, code, millions, pib }));

// Sales by channel in sixteen cities (k€): the online share differs from one region to the next.
const CHANNELS = ['Magasins', 'En ligne', 'Partenaires'];
const HUBS: [city: string, lon: number, lat: number, size: number, online: number][] = [
  ['New York', -74.0, 40.71, 1.0, 0.42], ['Los Angeles', -118.24, 34.05, 0.62, 0.48], ['Mexico', -99.13, 19.43, 0.4, 0.22],
  ['São Paulo', -46.63, -23.55, 0.55, 0.27], ['Santiago', -70.67, -33.45, 0.26, 0.2], ['Paris', 2.35, 48.86, 0.82, 0.36],
  ['Moscou', 37.62, 55.76, 0.3, 0.3], ['Le Caire', 31.24, 30.04, 0.24, 0.14], ['Lagos', 3.38, 6.52, 0.2, 0.12],
  ['Johannesburg', 28.05, -26.2, 0.22, 0.18], ['Dubaï', 55.27, 25.2, 0.38, 0.33], ['Delhi', 77.21, 28.61, 0.5, 0.3],
  ['Hong Kong', 114.17, 22.32, 0.9, 0.58], ['Tokyo', 139.69, 35.69, 0.7, 0.4], ['Singapour', 103.82, 1.35, 0.36, 0.5],
  ['Sydney', 151.21, -33.87, 0.3, 0.38],
];
const channelSales = (() => {
  const r = rng(23);
  return HUBS.flatMap(([city, lon, lat, size, online]) => {
    const total = 400 + size * 2600;
    const partners = 0.1 + r() * 0.14;
    const shares = [1 - online - partners, online, partners];
    return CHANNELS.map((channel, c) => ({ city, lon, lat, channel, sales: Math.round(total * shares[c]) }));
  });
})();

// Electricity generated in a year, by source (TWh, rounded orders of magnitude).
const SOURCES = ['Nucléaire', 'Fossile', 'Hydraulique', 'Éolien et solaire'];
const POWER: [pays: string, lon: number, lat: number, twh: number[]][] = [
  ['France', 2.4, 46.6, [335, 30, 60, 75]], ['Allemagne', 10.3, 51.0, [0, 230, 20, 200]], ['Espagne', -3.7, 40.0, [55, 70, 30, 105]],
  ['Italie', 12.4, 42.9, [0, 150, 40, 55]], ['Royaume-Uni', -1.6, 53.2, [40, 100, 5, 110]], ['Pologne', 19.6, 52.2, [0, 125, 3, 37]],
  ['Suède', 16.2, 60.2, [48, 2, 66, 40]], ['Norvège', 8.6, 60.6, [0, 2, 136, 15]], ['Pays-Bas', 5.6, 52.6, [4, 60, 0, 55]],
  ['Suisse', 8.2, 46.7, [23, 1, 37, 5]], ['Autriche', 14.6, 47.6, [0, 10, 42, 15]], ['Finlande', 25.8, 62.2, [33, 8, 15, 15]],
  ['Roumanie', 25.0, 45.8, [11, 18, 18, 10]], ['Tchéquie', 15.4, 49.9, [30, 32, 3, 4]], ['Portugal', -8.1, 39.6, [0, 10, 12, 22]],
  ['Grèce', 22.2, 39.4, [0, 25, 4, 20]],
];
const power = POWER.flatMap(([pays, lon, lat, twh]) => SOURCES.map((source, s) => ({ pays, lon, lat, source, twh: twh[s] })));

// The largest urban areas of the world, millions of inhabitants (rounded).
const AGGLOMERATIONS: [ville: string, lon: number, lat: number, continent: string, millions: number][] = [
  ['Tokyo', 139.69, 35.69, 'Asie', 37.0], ['Delhi', 77.21, 28.61, 'Asie', 33.8], ['Shanghai', 121.47, 31.23, 'Asie', 29.9],
  ['Dacca', 90.41, 23.81, 'Asie', 23.9], ['São Paulo', -46.63, -23.55, 'Amériques', 22.8], ['Le Caire', 31.24, 30.04, 'Afrique', 22.6],
  ['Mexico', -99.13, 19.43, 'Amériques', 22.5], ['Pékin', 116.4, 39.9, 'Asie', 22.2], ['Bombay', 72.88, 19.08, 'Asie', 21.7],
  ['Osaka', 135.5, 34.69, 'Asie', 19.0], ['New York', -74.0, 40.71, 'Amériques', 18.9], ['Chongqing', 106.55, 29.56, 'Asie', 17.8],
  ['Karachi', 67.01, 24.86, 'Asie', 17.6], ['Kinshasa', 15.31, -4.32, 'Afrique', 17.0], ['Lagos', 3.38, 6.52, 'Afrique', 16.5],
  ['Istanbul', 28.98, 41.01, 'Europe', 16.0], ['Buenos Aires', -58.38, -34.6, 'Amériques', 15.6], ['Calcutta', 88.36, 22.57, 'Asie', 15.6],
  ['Manille', 120.98, 14.6, 'Asie', 14.9], ['Canton', 113.26, 23.13, 'Asie', 14.3], ['Tianjin', 117.2, 39.13, 'Asie', 14.2],
  ['Lahore', 74.34, 31.55, 'Asie', 14.1], ['Rio de Janeiro', -43.17, -22.91, 'Amériques', 13.8], ['Bangalore', 77.59, 12.97, 'Asie', 13.6],
  ['Shenzhen', 114.06, 22.54, 'Asie', 13.1], ['Moscou', 37.62, 55.76, 'Europe', 12.7], ['Los Angeles', -118.24, 34.05, 'Amériques', 12.5],
  ['Madras', 80.27, 13.08, 'Asie', 11.8], ['Bogota', -74.07, 4.71, 'Amériques', 11.5], ['Jakarta', 106.85, -6.21, 'Asie', 11.4],
  ['Paris', 2.35, 48.86, 'Europe', 11.3], ['Lima', -77.04, -12.05, 'Amériques', 11.2], ['Bangkok', 100.5, 13.76, 'Asie', 11.1],
  ['Hyderabad', 78.49, 17.39, 'Asie', 10.8], ['Séoul', 126.98, 37.57, 'Asie', 10.0], ['Londres', -0.13, 51.51, 'Europe', 9.7],
  ['Chengdu', 104.07, 30.57, 'Asie', 9.7], ['Hô Chi Minh-Ville', 106.63, 10.82, 'Asie', 9.6], ['Nagoya', 136.91, 35.18, 'Asie', 9.6],
  ['Téhéran', 51.39, 35.69, 'Asie', 9.5], ['Luanda', 13.23, -8.84, 'Afrique', 9.3], ['Chicago', -87.63, 41.88, 'Amériques', 9.0],
  ['Kuala Lumpur', 101.69, 3.14, 'Asie', 8.8], ['Bagdad', 44.37, 33.31, 'Asie', 7.9], ['Dar es Salam', 39.28, -6.79, 'Afrique', 7.8],
  ['Riyad', 46.68, 24.71, 'Asie', 7.8], ['Santiago', -70.67, -33.45, 'Amériques', 6.9], ['Madrid', -3.7, 40.42, 'Europe', 6.8],
  ['Khartoum', 32.56, 15.5, 'Afrique', 6.5], ['Toronto', -79.38, 43.65, 'Amériques', 6.4], ['Johannesburg', 28.05, -26.2, 'Afrique', 6.2],
  ['Singapour', 103.82, 1.35, 'Asie', 6.1], ['Abidjan', -4.03, 5.36, 'Afrique', 5.9], ['Nairobi', 36.82, -1.29, 'Afrique', 5.5],
  ['Sydney', 151.21, -33.87, 'Océanie', 5.2], ['Melbourne', 144.96, -37.81, 'Océanie', 5.1],
];
const agglomerations = AGGLOMERATIONS.map(([ville, lon, lat, continent, millions]) => ({ ville, lon, lat, continent, millions }));

// French cities: inhabitants of the commune, thousands (rounded).
const COMMUNES: [ville: string, lon: number, lat: number, milliers: number][] = [
  ['Paris', 2.35, 48.86, 2100], ['Marseille', 5.37, 43.3, 873], ['Lyon', 4.84, 45.76, 522], ['Toulouse', 1.44, 43.6, 504],
  ['Nice', 7.26, 43.7, 348], ['Nantes', -1.55, 47.22, 323], ['Montpellier', 3.88, 43.61, 302], ['Strasbourg', 7.75, 48.58, 291],
  ['Bordeaux', -0.58, 44.84, 262], ['Lille', 3.06, 50.63, 236], ['Rennes', -1.68, 48.11, 225], ['Toulon', 5.93, 43.12, 180],
  ['Reims', 4.03, 49.26, 179], ['Saint-Étienne', 4.39, 45.44, 173], ['Le Havre', 0.11, 49.49, 166], ['Dijon', 5.04, 47.32, 159],
  ['Grenoble', 5.72, 45.19, 157], ['Angers', -0.55, 47.47, 157], ['Nîmes', 4.36, 43.84, 148], ['Clermont-Ferrand', 3.09, 45.78, 147],
  ['Le Mans', 0.2, 48.0, 145], ['Aix-en-Provence', 5.45, 43.53, 147], ['Brest', -4.49, 48.39, 140], ['Tours', 0.69, 47.39, 138],
  ['Amiens', 2.3, 49.89, 134], ['Limoges', 1.26, 45.83, 130], ['Metz', 6.18, 49.12, 120], ['Perpignan', 2.9, 42.7, 120],
  ['Besançon', 6.02, 47.24, 119], ['Orléans', 1.91, 47.9, 117], ['Rouen', 1.1, 49.44, 114], ['Mulhouse', 7.34, 47.75, 106],
  ['Caen', -0.37, 49.18, 108], ['Nancy', 6.18, 48.69, 104], ['Avignon', 4.81, 43.95, 91], ['Poitiers', 0.34, 46.58, 90],
  ['Pau', -0.37, 43.3, 77], ['La Rochelle', -1.15, 46.16, 79], ['Bayonne', -1.47, 43.49, 53], ['Ajaccio', 8.74, 41.93, 73],
];
const communes = COMMUNES.map(([ville, lon, lat, milliers]) => ({ ville, lon, lat, milliers }));

// Revenue of ten regional hubs over three years (M€): growth differs from one hub to the next.
const YEARS = ['2023', '2024', '2025'];
const REGIONS: [region: string, lon: number, lat: number, base: number, growth: number][] = [
  ['Amérique du Nord', -100, 40, 410, 0.06], ['Amérique latine', -58, -16, 150, 0.14], ['Europe', 9, 49, 380, 0.03],
  ['Afrique', 20, 3, 70, 0.3], ['Moyen-Orient', 47, 25, 120, 0.18], ['Inde', 78, 21, 140, 0.28],
  ['Chine', 106, 34, 330, -0.07], ['Asie du Sud-Est', 112, 0, 160, 0.2], ['Japon', 139, 37, 190, -0.02], ['Océanie', 134, -26, 80, 0.09],
];
const regionRevenue = REGIONS.flatMap(([region, lon, lat, base, growth]) =>
  YEARS.map((year, y) => ({ region, lon, lat, year, revenue: Math.round(base * (1 + growth) ** y) })),
);

// Deliveries: thousands of drop points scattered around French cities, more around the large ones.
const deliveries = (() => {
  const r = rng(61);
  const lon: number[] = [];
  const lat: number[] = [];
  for (const [, x, y, milliers] of COMMUNES) {
    const n = Math.round(60 + Math.sqrt(milliers) * 22);
    const spread = 0.16 + Math.sqrt(milliers) / 160;
    for (let i = 0; i < n; i++) {
      lon.push(x + gauss(r) * spread * 1.4);
      lat.push(y + gauss(r) * spread);
    }
  }
  return { lon: Float64Array.from(lon), lat: Float64Array.from(lat) };
})();

const FRANCE: [[number, number], [number, number]] = [[-9.5, 41.2], [14, 51.6]];
const EUROPE_BOUNDS: [[number, number], [number, number]] = [[-13, 34.5], [45, 67]];

/** Gallery examples of this family: `family` is the gallery section (an existing one, or a new one). */
export const FAMILIES: Family[] = [
  {
    family: 'Cartes',
    entries: [
      {
        title: 'Cartogramme de Dorling : population',
        caption: 'dorling · un cercle par pays, aire selon la population, placé près de son centroïde (jointure de key sur layer.geo) et écarté de ses voisins ; label et shortLabel pour le nom',
        wide: true,
        spec: {
          title: 'Où vivent les habitants de la planète',
          subtitle: 'Population par pays, en millions',
          data: population,
          fields: { millions: { label: 'Population', format: { suffix: ' M' } }, continent: { label: 'Continent' } },
          layers: [{ mark: 'dorling', geo: countriesGeo, encode: { key: 'name', value: 'millions', color: 'continent' }, style: { label: 'pays', shortLabel: 'code' } }],
        },
      },
      {
        title: 'Dorling sur fond de carte : Europe',
        caption: 'dorling sous projection · par-dessus un calque geoshape, couleur selon une mesure (rampe séquentielle), values: false',
        spec: {
          title: 'Population et richesse en Europe',
          subtitle: 'Aire : habitants · couleur : PIB par habitant',
          data: europe,
          projection: { type: 'mercator', bounds: EUROPE_BOUNDS },
          fields: { millions: { label: 'Population', format: { suffix: ' M' } }, pib: { label: 'PIB par habitant', format: { suffix: ' k€' } } },
          layers: [
            { mark: 'geoshape', geo: countriesGeo, encode: {} },
            { mark: 'dorling', geo: countriesGeo, encode: { key: 'name', value: 'millions', color: 'pib' }, style: { label: 'pays', shortLabel: 'code', values: false, coverage: 0.22, opacity: 0.94 } },
          ],
        },
      },
      {
        title: 'Camemberts sur une carte',
        caption: 'mapPie · un camembert par ville (x longitude, y latitude), aire selon le total, parts selon le canal ; liseré de la couleur du fond',
        wide: true,
        spec: {
          title: 'Ventes par canal',
          subtitle: 'Seize villes, en k€ : la part du en ligne varie',
          data: channelSales,
          projection: { type: 'mercator', bounds: [[-150, -50], [170, 68]] },
          fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
          layers: [
            { mark: 'geoshape', geo: countriesGeo, encode: {} },
            { mark: 'mapPie', encode: { x: 'lon', y: 'lat', key: 'city', color: 'channel', value: 'sales' } },
          ],
        },
      },
      {
        title: 'Anneaux sur une carte : mix électrique',
        caption: 'mapPie · style.innerRadius : des anneaux, taille selon la production du pays',
        spec: {
          title: 'D’où vient l’électricité',
          subtitle: 'Production annuelle par source, en TWh',
          data: power,
          projection: { type: 'mercator', bounds: EUROPE_BOUNDS },
          fields: { twh: { label: 'Production', format: { suffix: ' TWh' } } },
          layers: [
            { mark: 'geoshape', geo: countriesGeo, encode: {} },
            { mark: 'mapPie', encode: { x: 'lon', y: 'lat', key: 'pays', color: 'source', value: 'twh' }, style: { innerRadius: 0.5, sizeRange: [18, 46] } },
          ],
        },
      },
      {
        title: 'Carte à pics',
        caption: 'spike · un triangle effilé par agglomération, hauteur selon la population : lisible là où des bulles se recouvriraient (Asie) ; les plus hauts sont nommés',
        wide: true,
        spec: {
          title: 'Les plus grandes agglomérations',
          subtitle: 'Habitants, en millions',
          data: agglomerations,
          projection: { type: 'mercator', bounds: [[-150, -50], [170, 68]] },
          fields: { millions: { label: 'Population', format: { suffix: ' M', decimals: 1 } }, continent: { label: 'Continent' } },
          layers: [
            { mark: 'geoshape', geo: countriesGeo, encode: {} },
            { mark: 'spike', encode: { x: 'lon', y: 'lat', key: 'ville', value: 'millions', color: 'continent' } },
          ],
        },
      },
      {
        title: 'Pics : villes de France',
        caption: 'spike · une seule couleur, projection.bounds sur la France ; style.height, width et top (nombre de noms)',
        spec: {
          title: 'Quarante villes françaises',
          subtitle: 'Habitants de la commune, en milliers',
          data: communes,
          projection: { type: 'mercator', bounds: FRANCE },
          fields: { milliers: { label: 'Habitants', format: { suffix: ' k' } } },
          layers: [
            { mark: 'geoshape', geo: countriesGeo, encode: {} },
            { mark: 'spike', encode: { x: 'lon', y: 'lat', key: 'ville', value: 'milliers' }, style: { height: 96, width: 10, top: 8 } },
          ],
        },
      },
      {
        title: 'Barres sur une carte',
        caption: 'mapBars · un petit histogramme par région (une colonne par année), toutes sur la même échelle',
        wide: true,
        spec: {
          title: 'Chiffre d’affaires par région',
          subtitle: 'Trois exercices, en M€',
          data: regionRevenue,
          projection: { type: 'mercator', bounds: [[-150, -50], [170, 68]] },
          fields: { revenue: { label: 'CA', format: { suffix: ' M€' } } },
          layers: [
            { mark: 'geoshape', geo: countriesGeo, encode: {} },
            { mark: 'mapBars', encode: { x: 'lon', y: 'lat', key: 'region', color: 'year', value: 'revenue' } },
          ],
        },
      },
      {
        title: 'Densité en hexagones sur une carte',
        caption: 'hexbin sous projection · des milliers de points comptés par hexagone, par-dessus un calque geoshape',
        spec: {
          title: 'Points de livraison',
          subtitle: `${deliveries.lon.length.toLocaleString('fr-FR')} adresses, comptées par hexagone`,
          projection: { type: 'mercator', bounds: FRANCE },
          fields: { lon: { label: 'Longitude', format: { decimals: 1, suffix: '°' } }, lat: { label: 'Latitude', format: { decimals: 1, suffix: '°' } } },
          layers: [
            { mark: 'geoshape', geo: countriesGeo, encode: {} },
            { mark: 'hexbin', data: { columns: deliveries }, encode: { x: 'lon', y: 'lat' }, style: { radius: 7 } },
          ],
        },
      },
    ],
  },
];
