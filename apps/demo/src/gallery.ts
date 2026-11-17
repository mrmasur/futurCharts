import { createChart, type ChartSpec, type ChartView, type FlowGraph } from '@futurcharts/core';
import { registerGeo } from '@futurcharts/geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';

registerGeo();
// Natural Earth countries (public domain), shipped as TopoJSON by world-atlas.
const countriesGeo = feature(world as any, (world as any).objects.countries) as unknown as { features: { properties: { name: string } }[] };

// Deterministic data, so the gallery looks the same on every load.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const DAY = 86400000;
const r = rng(42);

const countries = ['France', 'Allemagne', 'Espagne', 'Italie', 'Pays-Bas', 'Belgique', 'Suisse', 'Portugal', 'Suède', 'Pologne'];
const revenueByCountry = countries.map((country) => ({ country, revenue: Math.round(120 + r() * 880) }));

const segments = ['PME', 'ETI', 'Grands comptes'];
const pipeline = countries.slice(0, 6).flatMap((country) => segments.map((segment) => ({ country, segment, deals: Math.round(10 + r() * 60) })));

const t0 = new Date(2026, 0, 5).getTime();
const tasks = [
  ['Cadrage', 'Produit', 0, 10], ['Maquettes', 'Design', 7, 18], ['Spécifications', 'Produit', 12, 22], ['API', 'Tech', 20, 45],
  ['Front-end', 'Tech', 28, 55], ['Tests utilisateurs', 'Design', 50, 60], ['Recette', 'Tech', 56, 66], ['Lancement', 'Produit', 66, 70],
].map(([task, team, a, b]) => ({ task, team, start: new Date(t0 + (a as number) * DAY), end: new Date(t0 + (b as number) * DAY) }));

const pnl = [
  { step: 'Chiffre d’affaires', amount: 920 }, { step: 'Coût des ventes', amount: -310 }, { step: 'Marge brute', amount: 0 },
  { step: 'Marketing', amount: -140 }, { step: 'R&D', amount: -180 }, { step: 'Frais généraux', amount: -90 }, { step: 'Subventions', amount: 40 },
];

const durations: { duration: number; plan: string }[] = [];
for (let i = 0; i < 4000; i++) {
  const plan = i % 3 === 0 ? 'Mobile' : 'Ordinateur';
  durations.push({ duration: Math.max(1, (plan === 'Mobile' ? 95 : 140) + gauss(r) * 38), plan });
}

const delays: { team: string; days: number }[] = [];
for (const [team, mu, sd] of [['Support', 3, 1.2], ['Livraison', 6, 2.5], ['Facturation', 4, 1.5], ['Retours', 9, 3.5]] as const) {
  for (let i = 0; i < 300; i++) delays.push({ team, days: Math.max(0.2, mu + gauss(r) * sd + (r() < 0.03 ? 10 : 0)) });
}

const points: { spend: number; sales: number; channel: string }[] = [];
for (const [channel, k] of [['Réseaux sociaux', 2.1], ['Recherche', 3.2], ['Affichage', 1.4]] as const) {
  for (let i = 0; i < 60; i++) {
    const spend = 5 + r() * 95;
    points.push({ spend, sales: Math.max(0, spend * k + gauss(r) * 30 + 20), channel });
  }
}

const cities = [['Paris', 2.1, 48, 42], ['Lyon', 0.52, 31, 38], ['Marseille', 0.87, 22, 35], ['Toulouse', 0.5, 26, 47], ['Nice', 0.34, 14, 30], ['Nantes', 0.32, 19, 51], ['Lille', 0.23, 17, 44], ['Bordeaux', 0.26, 21, 49]]
  .map(([city, pop, stores, nps]) => ({ city, population: pop, stores, nps }));

const forecast = Array.from({ length: 60 }, (_, i) => {
  const mean = 100 + i * 1.6 + Math.sin(i / 5) * 8;
  const spread = 4 + i * 0.45;
  return { day: new Date(t0 + i * DAY), mean, lower: mean - spread, upper: mean + spread };
});

const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const traffic = days.flatMap((day, d) =>
  Array.from({ length: 24 }, (_, h) => ({
    day,
    hour: `${h}h`,
    visits: Math.round((d < 5 ? 1 : 0.6) * (40 + 400 * Math.exp(-((h - 11) ** 2) / 18) + 300 * Math.exp(-((h - 20) ** 2) / 8)) * (0.85 + r() * 0.3)),
  })),
);

const channels = [{ channel: 'Organique', visits: 48200 }, { channel: 'Payant', visits: 26100 }, { channel: 'Email', visits: 13400 }, { channel: 'Partenaires', visits: 7200 }, { channel: 'Direct', visits: 5100 }];
const devices = [{ device: 'Mobile', sessions: 61 }, { device: 'Ordinateur', sessions: 33 }, { device: 'Tablette', sessions: 6 }];

const catalog = [
  ['Ordinateurs', ['Portables', 'Fixes', 'Écrans', 'Accessoires']],
  ['Téléphonie', ['Smartphones', 'Coques', 'Chargeurs']],
  ['Maison', ['Cuisine', 'Aspirateurs', 'Éclairage', 'Climatisation', 'Domotique']],
  ['Loisirs', ['Consoles', 'Jeux', 'Casques']],
].flatMap(([category, items]) => (items as string[]).map((item) => ({ category: category as string, item, sales: Math.round(20 + r() ** 2 * 400) })));

const funnelData = [{ stage: 'Visites', users: 84000 }, { stage: 'Produit vu', users: 41000 }, { stage: 'Ajout au panier', users: 12800 }, { stage: 'Paiement', users: 6100 }, { stage: 'Commande', users: 4700 }];

const criteria = ['Prix', 'Qualité', 'Livraison', 'Service', 'Choix', 'Site web'];
const benchmark = ['Nous', 'Concurrent A', 'Concurrent B'].flatMap((brand, b) =>
  criteria.map((criterion, c) => ({ brand, criterion, score: Math.round(45 + ((b * 17 + c * 29) % 50) + r() * 5) })),
);

const stock = Array.from({ length: 40 }, (_, i) => ({ day: new Date(t0 + i * DAY), level: 120 - (i % 10) * 11 + (i % 10 === 0 ? 0 : 0) }));

const regions = ['Nord', 'Sud', 'Est', 'Ouest'];
const orders = regions.flatMap((region, k) => Array.from({ length: 40 }, () => ({ region, basket: Math.round(30 + k * 12 + Math.abs(gauss(r)) * 40) })));

const euro = { style: 'currency', currency: 'EUR', decimals: 0 } as const;

const journeys = [
  ['Organique', 'Inscription', 5200], ['Organique', 'Abandon', 9100], ['Payant', 'Inscription', 3900], ['Payant', 'Abandon', 6200],
  ['Email', 'Inscription', 2400], ['Email', 'Abandon', 1300], ['Partenaires', 'Inscription', 1100], ['Partenaires', 'Abandon', 900],
  ['Inscription', 'Essai', 8300], ['Inscription', 'Inactif', 4300], ['Essai', 'Abonné', 3600], ['Essai', 'Essai expiré', 4700],
].map(([source, target, users]) => ({ source, target, users }));

const geoSales = [
  ['Europe', 'France', ['Paris', 'Lyon', 'Lille']], ['Europe', 'Allemagne', ['Berlin', 'Munich']], ['Europe', 'Espagne', ['Madrid', 'Barcelone']],
  ['Amériques', 'États-Unis', ['New York', 'Chicago', 'Austin']], ['Amériques', 'Brésil', ['São Paulo', 'Rio']], ['Amériques', 'Canada', ['Toronto']],
  ['Asie', 'Japon', ['Tokyo', 'Osaka']], ['Asie', 'Inde', ['Mumbai', 'Delhi']],
].flatMap(([region, country, cities]) => (cities as string[]).map((city) => ({ region, country, city, sales: Math.round(40 + r() * 260) })));

const daily: { date: Date; orders: number }[] = [];
for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const season = 1 + 0.5 * Math.exp(-((d.getMonth() - 10.6) ** 2) / 1.2);
  if (r() < 0.02) continue; // a few days without data
  daily.push({ date: d, orders: Math.round((weekend ? 60 : 140) * season * (0.75 + r() * 0.5)) });
}
const kpiDays = Array.from({ length: 30 }, (_, i) => new Date(t0 + i * DAY));
const kpiRevenue = kpiDays.map((day, i) => ({ day, revenue: Math.round(41000 + i * 380 + Math.sin(i / 2.5) * 2600 + r() * 1500) }));
const kpiChurn = kpiDays.map((day, i) => ({ day, churn: 2.9 - i * 0.012 + Math.sin(i / 3) * 0.12 + r() * 0.1 + (i === 29 ? 0.35 : 0) }));
const kpiNps = kpiDays.map((day, i) => ({ day, nps: Math.round(38 + i * 0.25 + Math.sin(i / 4) * 2) }));

const shareBySegment = countries.slice(0, 7).flatMap((country) =>
  ['Mobile', 'Ordinateur', 'Tablette'].map((device, k) => ({ country, device, sessions: Math.round((k === 0 ? 50 : k === 1 ? 35 : 8) * (0.6 + r() * 0.8)) })),
);
const genres = ['Pop', 'Rock', 'Hip-hop', 'Électro', 'Jazz', 'Classique'];
const streams = Array.from({ length: 36 }, (_, m) => new Date(2023, m, 1)).flatMap((month, m) =>
  genres.map((genre, g) => ({ month, genre, plays: Math.max(1, 20 + 14 * Math.sin(m / 5 + g * 1.3) + g * 3 + r() * 6) })),
);
const teams = ['Lyon', 'Paris', 'Marseille', 'Lille', 'Nantes', 'Rennes'];
const rankings = Array.from({ length: 8 }, (_, w) => w).flatMap((week) => {
  const scores = teams.map((team, k) => ({ team, s: Math.sin(week / 2 + k * 1.7) * 3 + k * 0.4 + r() * 1.5 }));
  return scores.sort((a, b) => b.s - a.s).map((e, rank) => ({ week: `S${week + 1}`, team: e.team, rank: rank + 1 }));
});
const slope = ['Recherche', 'Réseaux sociaux', 'Email', 'Affiliation', 'Display'].flatMap((channel, k) => [
  { year: '2025', channel, roi: [4.2, 2.1, 5.8, 3.1, 1.4][k] },
  { year: '2026', channel, roi: [3.6, 3.4, 6.1, 2.2, 1.9][k] },
]);
const bullets = [
  { metric: 'Chiffre d’affaires', poor: 60, ok: 85, good: 110, value: 92, target: 100 },
  { metric: 'Marge', poor: 50, ok: 80, good: 110, value: 74, target: 90 },
  { metric: 'Nouveaux clients', poor: 40, ok: 75, good: 110, value: 103, target: 95 },
  { metric: 'Satisfaction', poor: 55, ok: 80, good: 110, value: 86, target: 85 },
];
const dumbbell = countries.slice(0, 8).map((country) => {
  const before = Math.round(30 + r() * 40);
  return { country, before, after: Math.max(10, Math.round(before + (r() - 0.35) * 30)) };
});
const ohlc: { date: Date; open: number; close: number; low: number; high: number; change: number }[] = [];
{
  let price = 120;
  for (let i = 0; i < 45; i++) {
    const open = price;
    const close = Math.max(60, open + gauss(r) * 3.2 + 0.25);
    const high = Math.max(open, close) + r() * 2.5;
    const low = Math.min(open, close) - r() * 2.5;
    ohlc.push({ date: new Date(t0 + i * DAY), open, close, low, high, change: close - open });
    price = close;
  }
}
const budgetShare = [{ poste: 'Salaires', amount: 47 }, { poste: 'Locaux', amount: 14 }, { poste: 'Marketing', amount: 19 }, { poste: 'Logiciels', amount: 11 }, { poste: 'Divers', amount: 9 }];
const windRose = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'].flatMap((dir, k) =>
  ['Faible', 'Modéré', 'Fort'].map((speed, j) => ({ dir, speed, hours: Math.round((j === 0 ? 30 : j === 1 ? 18 : 7) * (0.4 + Math.abs(Math.sin(k * 0.9 + 1)) * 1.2) + r() * 6) })),
);

// Maps: stores around large cities, revenue per country.
const worldCities: [string, number, number, string][] = [
  ['Paris', 2.35, 48.86, 'Europe'], ['Londres', -0.13, 51.51, 'Europe'], ['Berlin', 13.4, 52.52, 'Europe'], ['Madrid', -3.7, 40.42, 'Europe'],
  ['Rome', 12.5, 41.9, 'Europe'], ['Stockholm', 18.07, 59.33, 'Europe'], ['New York', -74.0, 40.71, 'Amériques'], ['Los Angeles', -118.24, 34.05, 'Amériques'],
  ['Chicago', -87.63, 41.88, 'Amériques'], ['Mexico', -99.13, 19.43, 'Amériques'], ['São Paulo', -46.63, -23.55, 'Amériques'], ['Buenos Aires', -58.38, -34.6, 'Amériques'],
  ['Lagos', 3.38, 6.52, 'Afrique'], ['Le Caire', 31.24, 30.04, 'Afrique'], ['Johannesburg', 28.05, -26.2, 'Afrique'], ['Nairobi', 36.82, -1.29, 'Afrique'],
  ['Tokyo', 139.69, 35.69, 'Asie-Pacifique'], ['Shanghai', 121.47, 31.23, 'Asie-Pacifique'], ['Delhi', 77.21, 28.61, 'Asie-Pacifique'], ['Singapour', 103.82, 1.35, 'Asie-Pacifique'],
  ['Séoul', 126.98, 37.57, 'Asie-Pacifique'], ['Sydney', 151.21, -33.87, 'Asie-Pacifique'], ['Dubaï', 55.27, 25.2, 'Asie-Pacifique'],
];
const storesN = worldCities.length * 90;
const worldStores = { lon: new Float64Array(storesN), lat: new Float64Array(storesN), revenue: new Float64Array(storesN), region: new Array<string>(storesN) };
{
  let i = 0;
  for (const [, lon, lat, region] of worldCities) {
    for (let k = 0; k < 90; k++, i++) {
      worldStores.lat[i] = lat + gauss(r) * 1.4;
      worldStores.lon[i] = lon + (gauss(r) * 1.4) / Math.cos((lat * Math.PI) / 180);
      worldStores.revenue[i] = Math.round(40 + Math.abs(gauss(r)) * 260);
      worldStores.region[i] = region;
    }
  }
}
const cityRevenue = worldCities.map(([city, lon, lat, region]) => ({ city, lon, lat, region, revenue: Math.round(200 + r() * 1800) }));
const countryScores = countriesGeo.features.map((f) => ({ country: f.properties.name, score: Math.round(20 + r() * 75) })).filter((_, i) => i % 9 !== 0);
const europeNames = ['France', 'Germany', 'Spain', 'Italy', 'Poland', 'Sweden', 'Norway', 'Finland', 'United Kingdom', 'Portugal', 'Netherlands', 'Belgium', 'Switzerland', 'Austria', 'Ireland', 'Denmark', 'Greece', 'Romania', 'Czechia', 'Hungary'];

// Small multiples and violins.
const monthsShort = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const salesByCountry = ['France', 'Allemagne', 'Espagne', 'Italie', 'Pays-Bas', 'Belgique'].flatMap((country, c) =>
  ['En ligne', 'Magasin'].flatMap((channel, k) =>
    monthsShort.map((month, m) => ({
      country, channel, month: new Date(2026, m, 1),
      sales: Math.round((k === 0 ? 60 + m * (4 + c) : 90 - m * (1 + c * 0.4)) * (1 + c * 0.15) + r() * 12),
    })),
  ),
);
const npsByTeam = ['Support', 'Livraison', 'Facturation', 'Retours'].flatMap((team, t) =>
  ['T1', 'T2', 'T3', 'T4'].map((quarter, q) => ({ team, quarter, nps: Math.round(30 + t * 6 + q * (3 - t) + r() * 8) })),
);
const responseTimes: { team: string; minutes: number }[] = [];
for (const [team, mu, sd, bimodal] of [['Support', 12, 4, false], ['Ventes', 25, 9, false], ['Technique', 40, 12, true], ['Facturation', 18, 3, false]] as const) {
  for (let i = 0; i < 400; i++) {
    const shift = bimodal && r() < 0.4 ? 35 : 0;
    responseTimes.push({ team, minutes: Math.max(1, mu + shift + gauss(r) * sd) });
  }
}

// Flow diagrams.
const dataFlow: FlowGraph = {
  nodes: [
    { id: 'web', label: 'Ventes web', shape: 'start', description: 'ClickHouse' },
    { id: 'shop', label: 'Ventes magasin', shape: 'start', description: 'PostgreSQL' },
    { id: 'union', label: 'Toutes les ventes', shape: 'io' },
    { id: 'cleanSales', label: 'Nettoyer les ventes' },
    { id: 'catalog', label: 'Catalogue', shape: 'start', description: 'API produits' },
    { id: 'cleanCatalog', label: 'Normaliser les SKU' },
    { id: 'join', label: 'Ventes × catalogue', shape: 'decision' },
    { id: 'margin', label: 'Calculer la marge' },
    { id: 'out', label: 'Entrepôt des ventes', shape: 'end' },
    { id: 'reviews', label: 'Avis clients', shape: 'start', description: 'Elasticsearch' },
    { id: 'sentiment', label: 'Analyse de sentiment', shape: 'subprocess' },
    { id: 'out2', label: 'Tableau des avis', shape: 'end' },
  ],
  edges: [
    { from: 'web', to: 'union' },
    { from: 'shop', to: 'union' },
    { from: 'union', to: 'cleanSales' },
    { from: 'catalog', to: 'cleanCatalog' },
    { from: 'cleanSales', to: 'join' },
    { from: 'cleanCatalog', to: 'join' },
    { from: 'join', to: 'margin' },
    { from: 'margin', to: 'out' },
    { from: 'reviews', to: 'sentiment' },
    { from: 'sentiment', to: 'out2' },
  ],
};
const orderFlow: FlowGraph = {
  nodes: [
    { id: 'recue', label: 'Commande reçue', shape: 'start' },
    { id: 'paiement', label: 'Paiement validé ?', shape: 'decision' },
    { id: 'relance', label: 'Relancer le client' },
    { id: 'stock', label: 'Article en stock ?', shape: 'decision' },
    { id: 'fournisseur', label: 'Commander au fournisseur', shape: 'io' },
    { id: 'preparer', label: 'Préparer le colis' },
    { id: 'expedier', label: 'Expédier', shape: 'subprocess' },
    { id: 'livre', label: 'Livré ?', shape: 'decision' },
    { id: 'tentative', label: 'Nouvelle tentative' },
    { id: 'terminee', label: 'Commande terminée', shape: 'end' },
    { id: 'annulee', label: 'Commande annulée', shape: 'end' },
  ],
  edges: [
    { from: 'recue', to: 'paiement' },
    { from: 'paiement', to: 'stock', label: 'Oui' },
    { from: 'paiement', to: 'relance', label: 'Non' },
    { from: 'relance', to: 'paiement', label: 'Relance' },
    { from: 'relance', to: 'annulee', label: '3 échecs', dashed: true },
    { from: 'stock', to: 'preparer', label: 'Oui' },
    { from: 'stock', to: 'fournisseur', label: 'Non' },
    { from: 'fournisseur', to: 'preparer' },
    { from: 'preparer', to: 'expedier' },
    { from: 'expedier', to: 'livre' },
    { from: 'livre', to: 'terminee', label: 'Oui' },
    { from: 'livre', to: 'tentative', label: 'Non' },
    { from: 'tentative', to: 'livre' },
  ],
};
const supportFlow: FlowGraph = {
  nodes: [
    { id: 'ouvert', label: 'Ticket ouvert', shape: 'start', group: 'Client', value: 1240 },
    { id: 'tri', label: 'Tri automatique', shape: 'io', group: 'Plateforme', value: 1240 },
    { id: 'n1', label: 'Support niveau 1', group: 'Niveau 1', value: 1310, description: 'Inclut 70 tickets réouverts' },
    { id: 'resolu', label: 'Résolu ?', shape: 'decision', group: 'Niveau 1' },
    { id: 'n2', label: 'Support niveau 2', group: 'Niveau 2', value: 410 },
    { id: 'bug', label: 'Bug produit ?', shape: 'decision', group: 'Niveau 2' },
    { id: 'inge', label: 'Correctif', shape: 'subprocess', group: 'Ingénierie', value: 120 },
    { id: 'reponse', label: 'Réponse au client', group: 'Niveau 2', value: 410 },
    { id: 'clos', label: 'Clôturé', shape: 'end', group: 'Client', value: 1240 },
  ],
  edges: [
    { from: 'ouvert', to: 'tri', value: 1240 },
    { from: 'tri', to: 'n1', value: 1240 },
    { from: 'n1', to: 'resolu', value: 1310 },
    { from: 'resolu', to: 'clos', label: 'Oui', value: 900 },
    { from: 'resolu', to: 'n2', label: 'Non', value: 410 },
    { from: 'n2', to: 'bug', value: 410 },
    { from: 'bug', to: 'inge', label: 'Oui', value: 120 },
    { from: 'bug', to: 'reponse', label: 'Non', value: 290 },
    { from: 'inge', to: 'reponse', value: 120 },
    { from: 'reponse', to: 'clos', value: 340 },
    { from: 'reponse', to: 'n1', label: 'Réouvert', value: 70, dashed: true },
  ],
};

const quarterly = ['T1', 'T2', 'T3', 'T4'].flatMap((quarter) => ['France', 'Allemagne', 'Espagne'].map((country) => ({ quarter, country, sales: Math.round(80 + r() * 120) })));

type Entry = { title: string; caption: string; wide?: boolean; spec?: ChartSpec; tiles?: ChartSpec[]; showLayout?: boolean };
const entries: Entry[] = [
  {
    title: 'Barres horizontales triées',
    caption: 'Catégories sur y, détectées automatiquement · transform sort · étiquettes de valeur',
    spec: {
      title: 'Chiffre d’affaires par pays',
      subtitle: 'En milliers d’euros',
      data: revenueByCountry,
      fields: { revenue: { label: 'CA', format: { suffix: ' k€' } } },
      layers: [{ mark: 'bar', encode: { x: 'revenue', y: 'country' }, transform: [{ type: 'sort', field: 'revenue', order: 'desc' }], style: { labels: true } }],
    },
  },
  {
    title: 'Barres horizontales empilées',
    caption: 'stack: true · étiquettes dans les segments quand elles tiennent',
    spec: {
      title: 'Opportunités par pays et segment',
      data: pipeline,
      fields: { deals: { label: 'Opportunités' } },
      layers: [{ mark: 'bar', encode: { x: 'deals', y: 'country', color: 'segment' }, stack: true, style: { labels: true } }],
    },
  },
  {
    title: 'Diagramme de Gantt',
    caption: 'Barres d’intervalle : x → x2 sur un axe temps',
    wide: true,
    spec: {
      title: 'Planning du projet',
      subtitle: 'Par tâche et équipe',
      data: tasks,
      layers: [{ mark: 'bar', encode: { x: 'start', x2: 'end', y: 'task', color: 'team' }, style: { radius: 4, maxWidth: 20 } }],
    },
  },
  {
    title: 'Cascade',
    caption: 'transform waterfall · y → y2 · couleur par type de pas',
    spec: {
      title: 'Du chiffre d’affaires au résultat',
      subtitle: 'En milliers d’euros',
      data: pnl,
      fields: { start: { label: 'Cumul', format: { suffix: ' k€' } } },
      scales: { color: { colors: { Hausse: '#1baf7a', Baisse: '#e34948', Total: '#2a78d6' } } },
      layers: [
        {
          mark: 'bar',
          encode: { x: 'step', y: 'start', y2: 'end', color: 'kind' },
          transform: [{ type: 'waterfall', field: 'amount', label: 'step', totals: ['Marge brute'], total: 'Résultat', kinds: { increase: 'Hausse', decrease: 'Baisse', total: 'Total' } }],
          style: { labels: true, radius: 3 },
        },
      ],
    },
  },
  {
    title: 'Histogramme',
    caption: 'transform bin groupé · barres jointives (bandPadding 0) · empilé',
    spec: {
      title: 'Durée des sessions',
      subtitle: '4 000 sessions, en secondes',
      data: durations,
      fields: { count: { label: 'Sessions' }, bin_mid: { label: 'Durée' } },
      layers: [
        { mark: 'bar', encode: { x: 'bin_mid', y: 'count', color: 'plan' }, stack: true, transform: [{ type: 'bin', field: 'duration', maxbins: 30, groupby: ['plan'] }], style: { bandPadding: 0, radius: 2 } },
      ],
    },
  },
  {
    title: 'Boîte à moustaches',
    caption: 'transform boxplot · composition rule + bar + tick',
    spec: {
      title: 'Délais de traitement par équipe',
      subtitle: 'En jours · boîte : quartiles · trait : médiane · ◆ : moyenne',
      data: delays,
      fields: { days: { format: { decimals: 1 } } },
      scales: { color: { colors: { Moustaches: '$muted', Quartiles: '$1', Médiane: '$1', Moyenne: '$1' } } },
      legend: false,
      layers: [
        { mark: 'rule', name: 'Moustaches', encode: { x: 'team', y: 'lower', y2: 'q1' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { width: 1.25 } },
        { mark: 'rule', name: 'Moustaches', encode: { x: 'team', y: 'q3', y2: 'upper' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { width: 1.25 } },
        { mark: 'tick', name: 'Moustaches', encode: { x: 'team', y: 'lower' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { width: 1.25, maxWidth: 8 } },
        { mark: 'tick', name: 'Moustaches', encode: { x: 'team', y: 'upper' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { width: 1.25, maxWidth: 8 } },
        {
          mark: 'bar', name: 'Quartiles', encode: { x: 'team', y: 'q1', y2: 'q3' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }],
          style: { radius: 3, maxWidth: 20, opacity: 0.16, stroke: '$1', strokeWidth: 1.5 },
        },
        { mark: 'tick', name: 'Médiane', encode: { x: 'team', y: 'median' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { width: 2.5, maxWidth: 20 } },
        { mark: 'point', name: 'Moyenne', encode: { x: 'team', y: 'mean' }, transform: [{ type: 'boxplot', field: 'days', groupby: ['team'] }], style: { size: 6, shape: 'diamond', strokeWidth: 1.5 } },
      ],
    },
  },
  {
    title: 'Sucettes',
    caption: 'rule depuis zéro + point, à l’horizontale',
    spec: {
      title: 'Satisfaction client par ville',
      data: cities,
      fields: { nps: { label: 'NPS' } },
      layers: [
        { mark: 'rule', name: 'NPS', encode: { x: 'nps', y: 'city' }, transform: [{ type: 'sort', field: 'nps', order: 'desc' }], style: { width: 2 } },
        { mark: 'point', name: 'NPS', encode: { x: 'nps', y: 'city' }, transform: [{ type: 'sort', field: 'nps', order: 'desc' }], style: { size: 12 } },
      ],
    },
  },
  {
    title: 'Nuage de points et régression',
    caption: 'transform regression par groupe · couleurs partagées entre couches',
    spec: {
      title: 'Ventes selon le budget publicitaire',
      data: points,
      fields: { spend: { label: 'Budget (k€)' }, sales: { label: 'Ventes (k€)' } },
      axes: { x: { title: 'Budget (k€)' } },
      layers: [
        { mark: 'point', encode: { x: 'spend', y: 'sales', color: 'channel' }, style: { size: 7, opacity: 0.75 } },
        { mark: 'line', encode: { x: 'spend', y: 'sales', color: 'channel' }, transform: [{ type: 'regression', x: 'spend', y: 'sales', groupby: ['channel'] }], style: { width: 2 } },
      ],
      interactions: { tooltip: { mode: 'nearest' } },
    },
  },
  {
    title: 'Bulles',
    caption: 'taille = population, aire proportionnelle',
    spec: {
      title: 'Magasins, satisfaction et population',
      data: cities,
      fields: { stores: { label: 'Magasins' }, nps: { label: 'NPS' }, population: { label: 'Population (M)', format: { decimals: 2 } } },
      axes: { x: { title: 'Nombre de magasins' }, y: { title: 'NPS' } },
      scales: { x: { nice: true }, y: { zero: false } },
      layers: [{ mark: 'point', encode: { x: 'stores', y: 'nps', size: 'population', color: 'city' }, style: { sizeRange: [10, 56], opacity: 0.8 } }],
      legend: false,
    },
  },
  {
    title: 'Prévision avec intervalle',
    caption: 'aire entre y et y2 + ligne de tendance',
    spec: {
      title: 'Commandes prévues',
      subtitle: 'Intervalle de confiance à 90 %',
      data: forecast,
      fields: { mean: { label: 'Prévision', format: { decimals: 0 } } },
      layers: [
        { mark: 'area', name: 'Prévision', encode: { x: 'day', y: 'lower', y2: 'upper' }, style: { opacity: 0.16, line: false } },
        { mark: 'line', name: 'Prévision', encode: { x: 'day', y: 'mean' } },
      ],
    },
  },
  {
    title: 'Carte de chaleur',
    caption: 'heatmap · deux axes de catégories · valeurs affichées si elles tiennent',
    wide: true,
    spec: {
      title: 'Trafic par jour et par heure',
      data: traffic,
      fields: { visits: { label: 'Visites' } },
      layers: [{ mark: 'heatmap', encode: { x: 'hour', y: 'day', color: 'visits' } }],
    },
  },
  {
    title: 'Camembert',
    caption: 'pie · parts en étiquettes',
    spec: {
      title: 'Visites par canal',
      data: channels,
      fields: { visits: { label: 'Visites' } },
      layers: [{ mark: 'pie', encode: { key: 'channel', value: 'visits' } }],
    },
  },
  {
    title: 'Anneau',
    caption: 'donut · total au centre',
    spec: {
      title: 'Sessions par appareil',
      data: devices,
      fields: { sessions: { label: 'Sessions (milliers)' } },
      layers: [{ mark: 'donut', encode: { key: 'device', value: 'sessions' } }],
    },
  },
  {
    title: 'Jauge',
    caption: 'gauge · min, max, objectif',
    spec: {
      title: 'Taux de service',
      subtitle: 'Objectif 90 %',
      data: [{ rate: 82 }],
      fields: { rate: { label: 'Commandes livrées à temps', format: { suffix: ' %' } } },
      layers: [{ mark: 'gauge', encode: { value: 'rate' }, style: { min: 0, max: 100, target: 90 } }],
    },
  },
  {
    title: 'Treemap',
    caption: 'treemap squarifié · groupes avec en-têtes',
    wide: true,
    spec: {
      title: 'Ventes par famille de produits',
      data: catalog,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      layers: [{ mark: 'treemap', encode: { key: 'item', value: 'sales', color: 'category' } }],
    },
  },
  {
    title: 'Entonnoir',
    caption: 'funnel · taux de conversion',
    spec: {
      title: 'Tunnel de commande',
      data: funnelData,
      fields: { users: { label: 'Utilisateurs' } },
      layers: [{ mark: 'funnel', encode: { key: 'stage', value: 'users' } }],
    },
  },
  {
    title: 'Radar',
    caption: 'radar · une série par marque',
    spec: {
      title: 'Perception face aux concurrents',
      data: benchmark,
      fields: { score: { label: 'Score' } },
      layers: [{ mark: 'radar', encode: { key: 'criterion', value: 'score', color: 'brand' } }],
    },
  },
  {
    title: 'Courbe en escalier',
    caption: 'line, curve: step',
    spec: {
      title: 'Niveau de stock',
      data: stock,
      fields: { level: { label: 'Unités' } },
      layers: [{ mark: 'line', encode: { x: 'day', y: 'level' }, style: { curve: 'step' } }],
    },
  },
  {
    title: 'Distribution en traits',
    caption: 'tick à l’horizontale · un trait par commande',
    spec: {
      title: 'Panier moyen par région',
      data: orders,
      fields: { basket: { label: 'Panier', format: euro } },
      layers: [{ mark: 'tick', encode: { x: 'basket', y: 'region', color: 'region' }, style: { opacity: 0.55, width: 1.5, length: 0.5 } }],
      legend: false,
      interactions: { tooltip: false },
    },
  },
  {
    title: 'Épaisseur et couleur par barre',
    caption: 'style.thickness: 10 · overrides : France en rouge, ventes < 120 atténuées',
    spec: {
      title: 'Ventes trimestrielles',
      subtitle: 'Barres de 10 px · règles de couleur dans la spec',
      data: quarterly,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      scales: { color: { colors: { France: '#e34948', Allemagne: '#898781', Espagne: '#b5b4ac' } } },
      layers: [
        {
          mark: 'bar',
          encode: { x: 'quarter', y: 'sales', color: 'country' },
          style: { thickness: 10, radius: 3 },
          overrides: [{ when: { field: 'sales', lt: 120 }, style: { opacity: 0.45 } }],
        },
      ],
    },
  },
  {
    title: 'Barres fines et mise en avant',
    caption: 'horizontal · thickness: 8 · overrides sur deux pays',
    spec: {
      title: 'Chiffre d’affaires par pays',
      subtitle: 'France et Italie mises en avant',
      data: revenueByCountry,
      fields: { revenue: { label: 'CA', format: { suffix: ' k€' } } },
      layers: [
        {
          mark: 'bar',
          encode: { x: 'revenue', y: 'country' },
          transform: [{ type: 'sort', field: 'revenue', order: 'desc' }],
          style: { thickness: 8, radius: 4, labels: true, color: '$axis' },
          overrides: [{ when: { field: 'country', in: ['France', 'Italie'] }, style: { color: '$1' } }],
        },
      ],
    },
  },
  {
    title: 'Sankey',
    caption: 'sankey · source → cible · flux en dégradé de couleur',
    wide: true,
    spec: {
      title: 'Parcours des visiteurs',
      subtitle: 'De la source d’acquisition à l’abonnement',
      data: journeys,
      fields: { users: { label: 'Visiteurs' } },
      layers: [{ mark: 'sankey', encode: { source: 'source', target: 'target', value: 'users' } }],
    },
  },
  {
    title: 'Sunburst',
    caption: 'sunburst · cliquez une région ou un pays pour zoomer (animé), le centre pour remonter',
    spec: {
      title: 'Ventes par région, pays et ville',
      data: geoSales,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      layers: [{ mark: 'sunburst', encode: { path: ['region', 'country', 'city'], value: 'sales' } }],
    },
  },
  {
    title: 'Calendrier',
    caption: 'calendar · une case par jour, semaines en colonnes',
    wide: true,
    spec: {
      title: 'Commandes par jour en 2026',
      data: daily,
      fields: { orders: { label: 'Commandes' } },
      layers: [{ mark: 'calendar', encode: { x: 'date', value: 'orders' } }],
    },
  },
  {
    title: 'Tuiles KPI',
    caption: 'kpi · dernière valeur, évolution vs la précédente, sparkline · upIsGood: false pour l’attrition',
    wide: true,
    tiles: [
      { title: 'Chiffre d’affaires', data: kpiRevenue, fields: { revenue: { label: 'CA', format: euro } }, layers: [{ mark: 'kpi', encode: { x: 'day', value: 'revenue' } }] },
      { title: 'Taux d’attrition', data: kpiChurn, fields: { churn: { label: 'Attrition', format: { decimals: 2, suffix: ' %' } } }, layers: [{ mark: 'kpi', encode: { x: 'day', value: 'churn' }, style: { upIsGood: false } }] },
      { title: 'NPS', data: kpiNps, fields: { nps: { label: 'NPS' } }, layers: [{ mark: 'kpi', encode: { x: 'day', value: 'nps' } }] },
    ],
  },
  {
    title: 'Barres empilées à 100 %',
    caption: 'stack: "normalize" · axe en pourcentage · parts dans les segments',
    spec: {
      title: 'Sessions par appareil et pays',
      data: shareBySegment,
      fields: { sessions: { label: 'Sessions' } },
      layers: [{ mark: 'bar', encode: { x: 'sessions', y: 'country', color: 'device' }, stack: 'normalize', style: { labels: true } }],
    },
  },
  {
    title: 'Streamgraph',
    caption: 'area · stack: "center" · courbe lissée · sans axe des valeurs',
    wide: true,
    spec: {
      title: 'Écoutes par genre',
      subtitle: '36 mois, en millions d’écoutes',
      data: streams,
      fields: { plays: { label: 'Écoutes (M)', format: { decimals: 1 } } },
      axes: { y: false },
      layers: [{ mark: 'area', encode: { x: 'month', y: 'plays', color: 'genre' }, stack: 'center', style: { curve: 'smooth', line: false, stackedOpacity: 0.9 } }],
    },
  },
  {
    title: 'Classement (bump chart)',
    caption: 'line + point · scales.y.reverse · étiquettes en bout de ligne',
    spec: {
      title: 'Classement des équipes',
      subtitle: 'Par semaine',
      data: rankings,
      fields: { rank: { label: 'Rang' } },
      scales: { y: { reverse: true, zero: false } },
      legend: false,
      layers: [
        { mark: 'line', encode: { x: 'week', y: 'rank', color: 'team' }, style: { width: 2.5, endLabels: true, curve: 'smooth' } },
        { mark: 'point', encode: { x: 'week', y: 'rank', color: 'team' }, style: { size: 9 } },
      ],
    },
  },
  {
    title: 'Graphique de pente',
    caption: 'line sur deux catégories · étiquettes en bout de ligne',
    spec: {
      title: 'Retour sur investissement par canal',
      subtitle: '2025 → 2026',
      data: slope,
      fields: { roi: { label: 'ROI', format: { decimals: 1, suffix: ' ×' } } },
      legend: false,
      layers: [
        { mark: 'line', encode: { x: 'year', y: 'roi', color: 'channel' }, style: { endLabels: true } },
        { mark: 'point', encode: { x: 'year', y: 'roi', color: 'channel' }, style: { size: 9 } },
      ],
    },
  },
  {
    title: 'Graphique à puces (bullet)',
    caption: 'composition : trois bar de fond, une bar fine (thickness), un tick pour l’objectif',
    spec: {
      title: 'Objectifs du trimestre',
      subtitle: 'En % de l’objectif annuel',
      data: bullets,
      fields: { value: { label: 'Réalisé', format: { suffix: ' %' } } },
      legend: false,
      layers: [
        { mark: 'bar', name: 'Bon', encode: { x: 'good', y: 'metric' }, style: { thickness: 22, radius: 2, color: '$grid' } },
        { mark: 'bar', name: 'Correct', encode: { x: 'ok', y: 'metric' }, style: { thickness: 22, radius: 0, color: '$axis' } },
        { mark: 'bar', name: 'Faible', encode: { x: 'poor', y: 'metric' }, style: { thickness: 22, radius: 0, color: '$muted' } },
        { mark: 'bar', name: 'Réalisé', encode: { x: 'value', y: 'metric' }, style: { thickness: 8, radius: 2, color: '$1' } },
        { mark: 'tick', name: 'Objectif', encode: { x: 'target', y: 'metric' }, style: { width: 2.5, maxWidth: 24, color: '$ink' } },
      ],
      interactions: { tooltip: { mode: 'x' } },
    },
  },
  {
    title: 'Haltères (dumbbell)',
    caption: 'rule de x à x2 + deux couches de points',
    spec: {
      title: 'Délai de livraison avant / après',
      subtitle: 'En heures',
      data: dumbbell,
      fields: { before: { label: 'Avant' }, after: { label: 'Après' } },
      scales: { color: { colors: { Avant: '$muted', Après: '$1' } }, x: { zero: false } },
      layers: [
        { mark: 'rule', name: 'Écart', encode: { x: 'before', x2: 'after', y: 'country' }, style: { width: 3, color: '$grid' } },
        { mark: 'point', name: 'Avant', encode: { x: 'before', y: 'country' }, style: { size: 11 } },
        { mark: 'point', name: 'Après', encode: { x: 'after', y: 'country' }, style: { size: 11 } },
      ],
    },
  },
  {
    title: 'Chandeliers',
    caption: 'rule (bas → haut) + bar fine (ouverture → clôture) · couleur par overrides',
    wide: true,
    spec: {
      title: 'Cours de l’action',
      subtitle: '45 séances',
      data: ohlc,
      fields: { open: { label: 'Ouverture → clôture', format: euro }, low: { label: 'Bas → haut', format: euro } },
      legend: false,
      layers: [
        {
          mark: 'rule', name: 'Bas → haut', encode: { x: 'date', y: 'low', y2: 'high' }, style: { width: 1.25, color: '#e34948' },
          overrides: [{ when: { field: 'change', gte: 0 }, style: { color: '#1baf7a' } }],
        },
        {
          mark: 'bar', name: 'Ouverture → clôture', encode: { x: 'date', y: 'open', y2: 'close' }, style: { thickness: 7, radius: 1, color: '#e34948' },
          overrides: [{ when: { field: 'change', gte: 0 }, style: { color: '#1baf7a' } }],
        },
      ],
      interactions: { zoom: { axes: 'x' } },
    },
  },
  {
    title: 'Gaufre',
    caption: 'waffle · 100 cases, une par pour-cent',
    spec: {
      title: 'Répartition du budget',
      data: budgetShare,
      fields: { amount: { label: 'Budget', format: { suffix: ' %' } } },
      layers: [{ mark: 'waffle', encode: { key: 'poste', value: 'amount' } }],
    },
  },
  {
    title: 'Rose polaire',
    caption: 'rose · cliquez une force de vent pour l’isoler (animé), à nouveau ou au centre pour tout revoir',
    spec: {
      title: 'Rose des vents',
      subtitle: 'Heures par direction et force',
      data: windRose,
      fields: { hours: { label: 'Heures' } },
      layers: [{ mark: 'rose', encode: { key: 'dir', value: 'hours', color: 'speed' } }],
    },
  },
  {
    title: 'Mise en avant dans un camembert',
    caption: 'highlight: { values: ["Email"] } · les autres parts s’effacent',
    spec: {
      title: 'Visites par canal',
      subtitle: 'L’email mis en avant',
      data: channels,
      fields: { visits: { label: 'Visites' } },
      layers: [{ mark: 'donut', encode: { key: 'channel', value: 'visits' }, highlight: { values: ['Email'] } }],
    },
  },
  {
    title: 'Mise en avant dans un treemap',
    caption: 'highlight: { field: "category", values: ["Maison"], color: "$ink" }',
    spec: {
      title: 'Ventes par famille de produits',
      subtitle: 'La famille Maison mise en avant',
      data: catalog,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      layers: [{ mark: 'treemap', encode: { key: 'item', value: 'sales', color: 'category' }, highlight: { field: 'category', values: ['Maison'] } }],
    },
  },
  {
    title: 'Mise en avant d’une série',
    caption: 'highlight sur la série : une équipe ressort, les autres passent en retrait',
    spec: {
      title: 'Classement de Lyon',
      data: rankings,
      fields: { rank: { label: 'Rang' } },
      scales: { y: { reverse: true, zero: false } },
      legend: false,
      layers: [
        { mark: 'line', encode: { x: 'week', y: 'rank', color: 'team' }, style: { width: 2.5, endLabels: true, curve: 'smooth' }, highlight: { field: 'team', values: ['Lyon'], dim: 0.18 } },
        { mark: 'point', encode: { x: 'week', y: 'rank', color: 'team' }, style: { size: 9 }, highlight: { field: 'team', values: ['Lyon'], dim: 0.18 } },
      ],
    },
  },
  {
    title: 'Mise en avant sur une carte de chaleur',
    caption: 'highlight: { field: "day", values: ["Sam", "Dim"], dim: 0.35 }',
    wide: true,
    spec: {
      title: 'Trafic du week-end',
      data: traffic,
      fields: { visits: { label: 'Visites' } },
      layers: [{ mark: 'heatmap', encode: { x: 'hour', y: 'day', color: 'visits' }, highlight: { field: 'day', values: ['Sam', 'Dim'], dim: 0.35 } }],
    },
  },
  {
    title: 'Points sur une carte du monde',
    caption: 'projection mercator · glisser pour entourer au lasso, Maj + glisser pour déplacer, molette pour zoomer',
    wide: true,
    spec: {
      title: 'Points de vente',
      subtitle: `${storesN.toLocaleString('fr-FR')} magasins · taille selon le chiffre d’affaires`,
      projection: { type: 'mercator' },
      fields: { lon: { label: 'Longitude' }, lat: { label: 'Latitude' }, revenue: { label: 'CA', format: { suffix: ' k€' } } },
      layers: [
        { mark: 'geoshape', geo: countriesGeo, encode: {} },
        { mark: 'point', data: { columns: worldStores }, encode: { x: 'lon', y: 'lat', color: 'region', size: 'revenue' }, style: { sizeRange: [3, 9], strokeWidth: 0.5, opacity: 0.85 } },
      ],
      interactions: { select: 'lasso', zoom: { axes: 'xy', max: 60 } },
    },
  },
  {
    title: 'Choroplèthe mondiale',
    caption: 'geoshape · jointure sur le nom du pays · pays sans donnée en gris',
    wide: true,
    spec: {
      title: 'Indice de satisfaction par pays',
      data: countryScores,
      projection: { type: 'mercator' },
      fields: { score: { label: 'Indice', format: { suffix: ' / 100' } } },
      layers: [{ mark: 'geoshape', geo: countriesGeo, encode: { key: 'country', color: 'score' } }],
      interactions: { zoom: { axes: 'xy', max: 60 } },
    },
  },
  {
    title: 'Bulles sur une carte',
    caption: 'point sur projection · aire proportionnelle au chiffre d’affaires · une couleur par région',
    spec: {
      title: 'Chiffre d’affaires par ville',
      projection: { type: 'mercator', bounds: [[-130, -45], [160, 65]] },
      fields: { revenue: { label: 'CA', format: { suffix: ' k€' } } },
      layers: [
        { mark: 'geoshape', geo: countriesGeo, encode: {} },
        { mark: 'point', data: cityRevenue, encode: { x: 'lon', y: 'lat', size: 'revenue', color: 'region' }, style: { sizeRange: [6, 30], opacity: 0.8 } },
      ],
      interactions: { tooltip: { mode: 'nearest' } },
    },
  },
  {
    title: 'Zoom sur l’Europe et mise en avant',
    caption: 'projection.bounds · highlight sur la choroplèthe',
    spec: {
      title: 'L’Europe en avant',
      subtitle: 'Indice de satisfaction, autres pays en retrait',
      data: countryScores,
      projection: { type: 'mercator', bounds: [[-25, 34], [45, 71]] },
      fields: { score: { label: 'Indice', format: { suffix: ' / 100' } } },
      layers: [{ mark: 'geoshape', geo: countriesGeo, encode: { key: 'country', color: 'score' }, highlight: { values: europeNames, dim: 0.3 } }],
    },
  },
  {
    title: 'Violon',
    caption: 'violin · densité par équipe, boîte des quartiles et médiane à l’intérieur · données brutes',
    spec: {
      title: 'Temps de première réponse',
      subtitle: 'En minutes · 400 tickets par équipe',
      data: responseTimes,
      fields: { minutes: { label: 'Minutes', format: { decimals: 0 } } },
      layers: [{ mark: 'violin', encode: { x: 'team', y: 'minutes' } }],
    },
  },
  {
    title: 'Petits multiples de courbes',
    caption: 'facet: { field: "country", columns: 3 } · échelles, couleurs et légende partagées',
    wide: true,
    spec: {
      title: 'Ventes mensuelles par pays',
      subtitle: 'En ligne et en magasin · même échelle dans chaque panneau',
      data: salesByCountry,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      facet: { field: 'country', columns: 3, height: 190 },
      layers: [{ mark: 'line', encode: { x: 'month', y: 'sales', color: 'channel' }, style: { width: 2 } }],
    },
  },
  {
    title: 'Petits multiples de barres',
    caption: 'facet par équipe · barres verticales · mise en avant du dernier trimestre',
    wide: true,
    spec: {
      title: 'NPS par équipe et trimestre',
      data: npsByTeam,
      fields: { nps: { label: 'NPS' } },
      facet: { field: 'team', columns: 4, height: 200 },
      layers: [{ mark: 'bar', encode: { x: 'quarter', y: 'nps' }, style: { labels: true, thickness: 18 }, highlight: { values: ['T4'], dim: 0.4 } }],
    },
  },
  {
    title: 'Pipeline de données',
    caption: 'flow · glissez une étape pour la déplacer : les liens suivent, et l’événement layout donne les positions à enregistrer',
    wide: true,
    showLayout: true,
    spec: {
      title: 'Préparation des données de vente',
      subtitle: 'Glissez les étapes pour réorganiser · survolez pour le détail',
      layers: [{ mark: 'flow', graph: dataFlow, encode: {} }],
    },
  },
  {
    title: 'Diagramme de flux',
    caption: 'flow · décisions, branches et boucles (les boucles portent une flèche)',
    wide: true,
    spec: {
      title: 'Traitement d’une commande',
      layers: [{ mark: 'flow', graph: orderFlow, encode: {} }],
    },
  },
  {
    title: 'Processus avec volumes',
    caption: 'flow · couleurs par équipe · épaisseur des liens selon le volume',
    wide: true,
    spec: {
      title: 'Parcours d’un ticket de support',
      subtitle: 'Tickets du mois',
      fields: { tickets: { label: 'Tickets' } },
      layers: [{ mark: 'flow', graph: supportFlow, encode: { value: 'tickets' } }],
    },
  },
  {
    title: 'Chemin mis en avant',
    caption: 'highlight sur les étapes du parcours nominal',
    wide: true,
    spec: {
      title: 'Le parcours sans incident',
      layers: [
        {
          mark: 'flow',
          graph: orderFlow,
          encode: {},
          highlight: { values: ['recue', 'paiement', 'stock', 'preparer', 'expedier', 'livre', 'terminee'], dim: 0.25 },
        },
      ],
    },
  },
];

// --------------------------------------------------------------- organisation

const GROUPS: [string, string[]][] = [
  ['Comparaison', ['Barres horizontales triées', 'Barres horizontales empilées', 'Barres empilées à 100 %', 'Épaisseur et couleur par barre', 'Barres fines et mise en avant', 'Sucettes', 'Haltères (dumbbell)', 'Graphique à puces (bullet)']],
  ['Évolution', ['Prévision avec intervalle', 'Courbe en escalier', 'Streamgraph', 'Classement (bump chart)', 'Graphique de pente', 'Chandeliers']],
  ['Temps et planning', ['Diagramme de Gantt', 'Calendrier']],
  ['Distribution', ['Histogramme', 'Boîte à moustaches', 'Violon', 'Distribution en traits']],
  ['Petits multiples', ['Petits multiples de courbes', 'Petits multiples de barres']],
  ['Corrélation', ['Nuage de points et régression', 'Bulles']],
  ['Parts et hiérarchies', ['Camembert', 'Anneau', 'Treemap', 'Sunburst', 'Gaufre']],
  ['Flux', ['Pipeline de données', 'Diagramme de flux', 'Processus avec volumes', 'Chemin mis en avant', 'Sankey', 'Entonnoir', 'Cascade']],
  ['Matrices et polaires', ['Carte de chaleur', 'Radar', 'Rose polaire']],
  ['Indicateurs', ['Tuiles KPI', 'Jauge']],
  ['Cartes', ['Points sur une carte du monde', 'Choroplèthe mondiale', 'Bulles sur une carte', 'Zoom sur l’Europe et mise en avant']],
  ['Mise en avant', ['Mise en avant dans un camembert', 'Mise en avant dans un treemap', 'Mise en avant d’une série', 'Mise en avant sur une carte de chaleur']],
];

// ----------------------------------------------------------- color themes

/** Each palette was checked for color-blind separation, contrast and lightness, in light and dark. */
const PALETTES: Record<string, { label: string; light: string[]; dark: string[]; ramp: string[] }> = {
  default: { label: 'Défaut', light: [], dark: [], ramp: [] },
  ocean: {
    label: 'Océan',
    light: ['#1764c4', '#e8713c', '#0e9c94', '#d4a017', '#8a5cd6', '#3b9ae0', '#d6497a', '#5f7f2a'],
    dark: ['#2872d3', '#e16b35', '#0e9c94', '#b88a06', '#8a5cd6', '#3a99df', '#d6497a', '#61812c'],
    ramp: ['#d2e9f7', '#8cc7ea', '#3b9ae0', '#1764c4', '#0b3a78'],
  },
  dusk: {
    label: 'Crépuscule',
    light: ['#d4543a', '#6a4fc9', '#e09a1a', '#c2447e', '#2f8fbf', '#9a6420', '#e07a9e', '#4a8f5c'],
    dark: ['#d4543a', '#745bd6', '#c38407', '#c2447e', '#2f8fbf', '#9d6724', '#d16d91', '#4a8f5c'],
    ramp: ['#fbe2d6', '#f2a988', '#e0704a', '#b0432a', '#5e1f0f'],
  },
  forest: {
    label: 'Forêt',
    light: ['#2f7d4f', '#c9822b', '#3f74b8', '#b8413e', '#8f9a2b', '#7a58b0', '#0f9a9d', '#a8663e'],
    dark: ['#398658', '#c78029', '#4076ba', '#be4743', '#8f9a2b', '#815fb8', '#0f9a9d', '#a8663e'],
    ramp: ['#dcefe2', '#9ccfac', '#57a473', '#2f7d4f', '#123f26'],
  },
};

let mode: 'light' | 'dark' = 'light';
let palette = 'default';
const themeFor = (): ChartSpec['theme'] => {
  const p = PALETTES[palette];
  if (!p.light.length) return mode;
  // Sequential ramps run light to dark on a light surface, and the reverse on a dark one.
  return { extends: mode, palette: { categorical: mode === 'dark' ? p.dark : p.light, sequential: mode === 'dark' ? [...p.ramp].reverse() : p.ramp } };
};

// ------------------------------------------------------------------ render

const nav = document.getElementById('groups')!;
const grid = document.getElementById('grid')!;
const charts: { chart: ChartView; spec: ChartSpec }[] = [];
const byTitle = new Map(entries.map((e) => [e.title, e]));
const placed = new Set<string>();
const sections: [string, Entry[]][] = GROUPS.map(([name, titles]) => [name, titles.map((t) => byTitle.get(t)).filter((e): e is Entry => !!e)]);
const rest = entries.filter((e) => !GROUPS.some(([, t]) => t.includes(e.title)));
if (rest.length) sections.push(['Autres', rest]);

for (const [name, list] of sections) {
  const id = name.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '-');
  const link = document.createElement('a');
  link.href = `#${id}`;
  link.textContent = `${name} · ${list.reduce((a, e) => a + (e.tiles?.length ?? 1), 0)}`;
  nav.appendChild(link);
  const section = document.createElement('section');
  section.id = id;
  const h2 = document.createElement('h2');
  h2.textContent = name;
  const inner = document.createElement('div');
  inner.className = 'grid';
  section.append(h2, inner);
  grid.appendChild(section);
  for (const e of list) {
    placed.add(e.title);
    const fig = document.createElement('figure');
    if (e.wide) fig.className = 'wide';
    const row = document.createElement('div');
    row.className = e.tiles ? 'tiles' : '';
    const cap = document.createElement('figcaption');
    cap.textContent = `${e.title} — ${e.caption}`;
    fig.append(row, cap);
    inner.appendChild(fig);
    for (const spec of e.tiles ?? [e.spec!]) {
      const box = document.createElement('div');
      box.className = e.tiles ? 'chart tile' : spec.facet ? 'chart auto' : spec.layers.some((l) => l.mark === 'flow') ? 'chart tall' : 'chart';
      row.appendChild(box);
      try {
        const chart = await createChart(box, { ...spec, theme: themeFor() });
        charts.push({ chart, spec });
        if (e.showLayout) {
          // What an app would save: the positions, written back as x / y on each node.
          const pre = document.createElement('pre');
          pre.className = 'layout';
          pre.textContent = 'Déplacez une étape : ses nouvelles positions s’affichent ici.';
          fig.insertBefore(pre, cap);
          const reset = document.createElement('button');
          reset.type = 'button';
          reset.textContent = 'Disposition automatique';
          reset.className = 'reset';
          reset.addEventListener('click', () => {
            (chart as any).resetInteractions?.();
            pre.textContent = 'Déplacez une étape : ses nouvelles positions s’affichent ici.';
          });
          fig.insertBefore(reset, pre);
          chart.on('layout', ({ positions }) => {
            const lines = Object.entries(positions).map(([id, p]) => `  "${id}": { "x": ${p.x}, "y": ${p.y} }`);
            pre.textContent = `{\n${lines.join(',\n')}\n}`;
          });
        }
      } catch (error) {
        box.textContent = String(error);
        console.error(e.title, error);
      }
    }
  }
}

const restyle = () => {
  document.documentElement.dataset.theme = mode;
  for (const c of charts) c.chart.update({ ...c.spec, theme: themeFor() });
};
const modeButton = document.getElementById('theme')!;
modeButton.addEventListener('click', () => {
  mode = mode === 'light' ? 'dark' : 'light';
  modeButton.textContent = mode === 'light' ? 'Thème sombre' : 'Thème clair';
  restyle();
});
const select = document.getElementById('palette') as HTMLSelectElement;
for (const [key, p] of Object.entries(PALETTES)) select.add(new Option(p.label, key));
select.addEventListener('change', () => {
  palette = select.value;
  restyle();
});

(window as any).gallery = charts.map((c) => c.chart);
