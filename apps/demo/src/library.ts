import type { ChartSpec, FlowGraph } from '@futurcharts/core';
import { registerGeo } from '@futurcharts/geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';

registerGeo();
// Natural Earth countries (public domain), shipped as TopoJSON by world-atlas.
export const countriesGeo = feature(world as any, (world as any).objects.countries) as unknown as { features: { properties: { name: string } }[] };

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

export const delays: { team: string; days: number }[] = [];
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

export const catalog = [
  ['Ordinateurs', ['Portables', 'Fixes', 'Écrans', 'Accessoires']],
  ['Téléphonie', ['Smartphones', 'Coques', 'Chargeurs']],
  ['Maison', ['Cuisine', 'Aspirateurs', 'Éclairage', 'Climatisation', 'Domotique']],
  ['Loisirs', ['Consoles', 'Jeux', 'Casques']],
].flatMap(([category, items]) => (items as string[]).map((item) => ({ category: category as string, item, sales: Math.round(20 + r() ** 2 * 400) })));

export const funnelData = [{ stage: 'Visites', users: 84000 }, { stage: 'Produit vu', users: 41000 }, { stage: 'Ajout au panier', users: 12800 }, { stage: 'Paiement', users: 6100 }, { stage: 'Commande', users: 4700 }];

const criteria = ['Prix', 'Qualité', 'Livraison', 'Service', 'Choix', 'Site web'];
const benchmark = ['Nous', 'Concurrent A', 'Concurrent B'].flatMap((brand, b) =>
  criteria.map((criterion, c) => ({ brand, criterion, score: Math.round(45 + ((b * 17 + c * 29) % 50) + r() * 5) })),
);

const stock = Array.from({ length: 40 }, (_, i) => ({ day: new Date(t0 + i * DAY), level: 120 - (i % 10) * 11 + (i % 10 === 0 ? 0 : 0) }));

const regions = ['Nord', 'Sud', 'Est', 'Ouest'];
const orders = regions.flatMap((region, k) => Array.from({ length: 40 }, () => ({ region, basket: Math.round(30 + k * 12 + Math.abs(gauss(r)) * 40) })));

const euro = { style: 'currency', currency: 'EUR', decimals: 0 } as const;

export const journeys = [
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
export const worldCities: [string, number, number, string][] = [
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
export const responseTimes: { team: string; minutes: number }[] = [];
for (const [team, mu, sd, bimodal] of [['Support', 12, 4, false], ['Ventes', 25, 9, false], ['Technique', 40, 12, true], ['Facturation', 18, 3, false]] as const) {
  for (let i = 0; i < 400; i++) {
    const shift = bimodal && r() < 0.4 ? 35 : 0;
    responseTimes.push({ team, minutes: Math.max(1, mu + shift + gauss(r) * sd) });
  }
}

// Flow diagrams.
export const dataFlow: FlowGraph = {
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
export const orderFlow: FlowGraph = {
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
export const supportFlow: FlowGraph = {
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

// More chart types.
const marketShare = ['Europe', 'Amérique du Nord', 'Asie', 'Amérique latine', 'Afrique'].flatMap((region, i) =>
  ['Grand public', 'Professionnels', 'Public'].map((segment, j) => ({ region, segment, sales: Math.round([520, 410, 380, 120, 60][i] * [0.55, 0.32, 0.13][j] * (0.7 + r() * 0.6)) })),
);
const tradeRegions = ['Europe', 'Amérique du Nord', 'Chine', 'Japon', 'Inde', 'Moyen-Orient'];
const trade = tradeRegions.flatMap((from, i) =>
  tradeRegions.filter((to) => to !== from).map((to, j) => ({ from, to, billions: Math.round((40 + ((i * 37 + j * 53) % 160)) * (0.6 + r() * 0.8)) })),
);
const productCats = ['Ordinateurs', 'Téléphonie', 'Maison', 'Loisirs'];
const products = Array.from({ length: 160 }, (_, i) => {
  const k = i % 4;
  const price = Math.round([900, 450, 180, 90][k] * (0.5 + r()));
  return {
    category: productCats[k],
    price,
    margin: Math.round([18, 24, 35, 42][k] + gauss(r) * 5),
    rating: Math.round((3.4 + r() * 1.5) * 10) / 10,
    sales: Math.round(4000 / Math.sqrt(price) * (0.5 + r())),
    returns: Math.round(([6, 4, 3, 2][k] + gauss(r)) * 10) / 10,
  };
});
const teamGraph: FlowGraph = (() => {
  const teams = [['Produit', 6], ['Tech', 9], ['Ventes', 7], ['Support', 6]] as const;
  const people = teams.flatMap(([team, n], t) => Array.from({ length: n }, (_, k) => ({ id: `${team}-${k}`, label: `${team} ${k + 1}`, group: team, value: Math.round(2 + r() * 20), t })));
  const edges: { from: string; to: string; value: number }[] = [];
  for (const a of people) {
    for (const b of people) {
      if (a.id >= b.id) continue;
      const p = a.t === b.t ? 0.32 : (a.t === 0 || b.t === 0) ? 0.07 : 0.025;
      if (r() < p) edges.push({ from: a.id, to: b.id, value: Math.round(1 + r() * 9) });
    }
  }
  return { nodes: people.map(({ t, ...n }) => n), edges };
})();
const dense = { x: new Float64Array(150000), y: new Float64Array(150000) };
for (let i = 0; i < dense.x.length; i++) {
  const c = i % 3;
  dense.x[i] = [30, 55, 75][c] + gauss(r) * [9, 6, 11][c];
  dense.y[i] = [40, 70, 35][c] + gauss(r) * [10, 7, 8][c] + (c === 2 ? (dense.x[i] - 75) * 0.6 : 0);
}
const ageBands = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+'];
const pyramid = ageBands.flatMap((age, i) => {
  const base = 820 - Math.abs(i - 3.5) * 70 - (i > 6 ? (i - 6) * 140 : 0);
  return [
    { age, sex: 'Hommes', people: -Math.round(base * (1 - i * 0.012) * (0.95 + r() * 0.1)) },
    { age, sex: 'Femmes', people: Math.round(base * (1 + i * 0.02) * (0.95 + r() * 0.1)) },
  ];
}).reverse();

// Bar chart race: cumulative sales of product lines over three years.
const raceLines: [string, string, number, number, number][] = [
  // name, family, start month, monthly base, growth per month
  ['Atlas', 'Ordinateurs', 0, 420, 2], ['Nova', 'Téléphonie', 0, 380, 9], ['Orion', 'Ordinateurs', 0, 300, 6], ['Lyra', 'Maison', 0, 260, 4],
  ['Vega', 'Téléphonie', 4, 120, 22], ['Cassio', 'Loisirs', 0, 210, 3], ['Helios', 'Maison', 6, 150, 18], ['Pixel One', 'Téléphonie', 10, 200, 28],
  ['Terra', 'Maison', 0, 240, -2], ['Zephyr', 'Loisirs', 2, 160, 11], ['Kepler', 'Ordinateurs', 14, 260, 30], ['Mira', 'Loisirs', 0, 190, 1],
  ['Sirius', 'Ordinateurs', 8, 140, 15], ['Echo', 'Téléphonie', 18, 300, 40],
];
const raceData: { month: Date; product: string; family: string; sales: number }[] = [];
for (const [product, family, start, base, growth] of raceLines) {
  let total = 0;
  for (let m = 0; m < 36; m++) {
    if (m >= start) total += Math.max(0, base + growth * (m - start) + Math.sin(m / 3 + base) * 30 + r() * 40);
    raceData.push({ month: new Date(2024, m, 1), product, family, sales: Math.round(total) });
  }
}

// Monthly revenue, actual then forecast, with a hole in the sensor-like series.
const months = Array.from({ length: 24 }, (_, m) => new Date(2025, m, 1));
const monthly = months.map((month, m) => ({ month, revenue: Math.round(820 + m * 22 + Math.sin(m / 1.9) * 60 + r() * 40) }));
const actual = monthly.slice(0, 18);
const projected = monthly.slice(17).map((d, i) => ({ month: d.month, revenue: Math.round(actual[17].revenue + (i * 31)) }));
const sensor = Array.from({ length: 48 }, (_, h) => ({
  hour: new Date(2026, 2, 3, h),
  temperature: (h >= 14 && h <= 19) || h === 33 || (h >= 40 && h <= 41) ? null : Math.round((18 + Math.sin((h - 9) / 3.82) * 5 + gauss(r) * 0.4) * 10) / 10,
}));
const weekly = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].map((week, i) => ({ week, signups: [312, 348, 330, 401, 462, 438, 517, 495][i] }));
const seats = [
  { party: 'Écologistes', seats: 42 }, { party: 'Gauche', seats: 118 }, { party: 'Centre', seats: 171 },
  { party: 'Droite', seats: 97 }, { party: 'Régionalistes', seats: 21 }, { party: 'Indépendants', seats: 28 },
];
const density = [
  { country: 'Pays-Bas', area: 41.5, density: 520 }, { country: 'Belgique', area: 30.7, density: 383 },
  { country: 'Allemagne', area: 357.6, density: 233 }, { country: 'Italie', area: 302.1, density: 196 },
  { country: 'France', area: 551.7, density: 122 }, { country: 'Espagne', area: 506, density: 95 },
];

// A sampled CPU profile: stacks of function calls and the time spent in them.
const profile = [
  ['main', 'handleRequest', 'parseQuery', 'tokenize', 42], ['main', 'handleRequest', 'parseQuery', 'buildAst', 31],
  ['main', 'handleRequest', 'runQuery', 'scanParts', 188], ['main', 'handleRequest', 'runQuery', 'aggregate', 126],
  ['main', 'handleRequest', 'runQuery', 'sortRows', 64], ['main', 'handleRequest', 'serialize', 'toJson', 58],
  ['main', 'handleRequest', 'serialize', 'compress', 37], ['main', 'gc', 'markHeap', '', 46], ['main', 'gc', 'sweep', '', 21],
  ['main', 'eventLoop', 'timers', '', 18], ['main', 'eventLoop', 'io', 'readSocket', 29],
].map(([f0, f1, f2, f3, ms]) => ({ f0, f1, f2, f3, ms }));
const audiences = [
  { sets: 'Web', users: 5200 }, { sets: 'Mobile', users: 3900 }, { sets: 'Magasin', users: 2300 },
  { sets: 'Web&Mobile', users: 1450 }, { sets: 'Web&Magasin', users: 620 }, { sets: 'Mobile&Magasin', users: 410 }, { sets: 'Web&Mobile&Magasin', users: 190 },
];
const searchTerms = [
  ['tableau de bord', 98], ['ventes', 86], ['marge', 64], ['clients', 71], ['prévision', 52], ['stock', 47], ['retours', 33], ['panier', 41],
  ['attrition', 29], ['NPS', 38], ['région', 44], ['campagne', 36], ['conversion', 57], ['budget', 31], ['fournisseurs', 22], ['délais', 27],
  ['livraison', 35], ['tarifs', 24], ['promotions', 30], ['abonnements', 26], ['cohortes', 18], ['saisonnalité', 16], ['objectifs', 39],
  ['trésorerie', 21], ['factures', 25], ['recrutement', 14], ['satisfaction', 33], ['canal', 28], ['produits', 49], ['export', 19],
].map(([term, count]) => ({ term, count }));
const milestones = [
  ['2024-01-15', 'Cadrage', 'Ateliers métiers'], ['2024-03-04', 'Maquettes', 'Validation UX'], ['2024-05-20', 'Bêta privée', '12 clients'],
  ['2024-07-01', 'Connecteur ClickHouse', 'Requêtes en direct'], ['2024-09-16', 'Lancement', 'Offre publique'], ['2024-11-04', 'Modèles dbt', 'Couche sémantique'],
  ['2025-01-20', 'Version 2', 'Rendu WebGPU'],
].map(([date, step, detail]) => ({ date: new Date(date), step, detail }));
const org = [
  ['Direction', 'Produit', 'Design', 4], ['Direction', 'Produit', 'Recherche', 2], ['Direction', 'Ingénierie', 'Plateforme', 7],
  ['Direction', 'Ingénierie', 'Visualisation', 5], ['Direction', 'Ingénierie', 'Données', 6], ['Direction', 'Commercial', 'Ventes', 8], ['Direction', 'Commercial', 'Succès client', 4],
].map(([ceo, dept, team, people]) => ({ ceo, dept, team, people }));

const exchanges = [
  ['Direction', 'Finance', 42], ['Direction', 'Ventes', 65], ['Ventes', 'Marketing', 88], ['Ventes', 'Support', 51], ['Marketing', 'Produit', 47],
  ['Produit', 'Ingénierie', 96], ['Ingénierie', 'Support', 58], ['Ingénierie', 'Données', 71], ['Données', 'Finance', 24], ['Données', 'Marketing', 39],
  ['Finance', 'RH', 18], ['RH', 'Direction', 22], ['Support', 'Produit', 33], ['Direction', 'Ingénierie', 29],
].map(([from, to, messages]) => ({ from, to, messages }));
const loyalty = [
  { tier: 'Ambassadeurs', customers: 1800 }, { tier: 'Fidèles', customers: 5200 },
  { tier: 'Réguliers', customers: 11400 }, { tier: 'Occasionnels', customers: 26900 },
];
const wind: { lon: number; lat: number; direction: number; speed: number }[] = [];
for (let i = 0; i < 18; i++) {
  for (let j = 0; j < 11; j++) {
    const lon = -6 + i * 0.75;
    const lat = 42 + j * 0.6;
    // A low-pressure swirl over the Channel, plus a westerly flow.
    const dx = lon - 1.5, dy = lat - 48.5;
    const d = Math.hypot(dx, dy) + 0.6;
    const u = 6 - (dy / d) * 14 * Math.exp(-d / 3);
    const v = (dx / d) * 14 * Math.exp(-d / 3);
    wind.push({ lon, lat, direction: Math.round(((Math.atan2(u, v) * 180) / Math.PI + 360) % 360), speed: Math.round(Math.hypot(u, v) * 10) / 10 });
  }
}

// Daily sales over a year, for synchronized charts and the navigator.
const year = Array.from({ length: 365 }, (_, d) => {
  const day = new Date(2025, 0, 1 + d);
  const season = 1 + 0.25 * Math.sin(((d - 80) / 365) * 2 * Math.PI) + (d > 325 ? 0.5 * ((d - 325) / 40) : 0);
  const weekend = day.getDay() === 0 || day.getDay() === 6 ? 0.82 : 1;
  const orders = Math.round(420 * season * weekend * (0.9 + r() * 0.2));
  const basket = Math.round((58 + 8 * Math.sin(d / 29) + r() * 6) * 10) / 10;
  return { day, orders, basket, revenue: Math.round((orders * basket) / 100) / 10 };
});
// Long price history for the navigator.
const prices: { date: Date; price: number }[] = [];
{
  let p = 100;
  for (let d = 0; d < 1200; d++) {
    p = Math.max(20, p * (1 + gauss(r) * 0.012 + 0.0004));
    prices.push({ date: new Date(2022, 0, 1 + d), price: Math.round(p * 100) / 100 });
  }
}
const hubs: [string, number, number][] = [['Paris', 2.55, 49.01], ['Dubaï', 55.36, 25.25]];
const routes = worldCities
  .filter(([name]) => name !== 'Paris' && name !== 'Dubaï')
  .flatMap(([city, lon, lat]) =>
    hubs.filter(() => true).map(([hub, hx, hy], k) => ({ hub, city, lon: hx, lat: hy, lon2: lon, lat2: lat, flights: Math.round(8 + r() * (k ? 30 : 60)) })),
  )
  .filter((_, i) => i % 3 !== 2);

// Stores over twelve years: revenue per m², margin, staff (fictional).
const storeYears: { year: Date; store: string; region: string; perM2: number; margin: number; staff: number }[] = [];
worldCities.forEach(([store, , , region], k) => {
  let perM2 = 2200 + ((k * 977) % 2600);
  let margin = 6 + ((k * 7) % 9);
  let staff = 20 + ((k * 53) % 140);
  const drift = ((k * 37) % 11) / 10 - 0.35;
  for (let y = 2015; y <= 2026; y++) {
    perM2 *= 1 + 0.03 + drift * 0.06 + gauss(r) * 0.03 + (y === 2020 ? -0.22 : y === 2021 ? 0.14 : 0);
    margin = Math.max(-4, Math.min(24, margin + drift * 0.9 + gauss(r) * 0.6 + (y === 2020 ? -4 : y === 2021 ? 3 : 0)));
    staff = Math.max(8, staff * (1 + drift * 0.05 + gauss(r) * 0.02));
    storeYears.push({ year: new Date(y, 0, 1), store, region, perM2: Math.round(perM2), margin: Math.round(margin * 10) / 10, staff: Math.round(staff) });
  }
});
const monthlyByCountry = countries.slice(0, 8).flatMap((country, k) =>
  Array.from({ length: 12 }, (_, m) => ({
    country,
    month: new Date(2026, m, 1),
    revenue: Math.round((60 + k * 9) * (1 + 0.25 * Math.sin(((m - 2 + k) / 12) * 2 * Math.PI)) * (1 + (k % 3 === 0 ? m * 0.03 : -m * 0.01)) + r() * 8),
  })),
);

const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const dailyTemps = monthNames.flatMap((month, m) =>
  Array.from({ length: 31 }, () => ({ month, temp: Math.round((12 - 9 * Math.cos(((m + 0.3) / 12) * 2 * Math.PI) + gauss(r) * (3.2 - Math.abs(m - 6) * 0.15)) * 10) / 10 })),
);
const apiCalls = ['Catalogue', 'Panier', 'Paiement', 'Recherche'].flatMap((service, k) =>
  Array.from({ length: 70 }, (_, i) => ({ service, ms: Math.round(Math.exp(Math.log([90, 140, 260, 60][k]) + gauss(r) * 0.38)), endpoint: `/${service.toLowerCase()}/${i}` })),
);
// Europe as a hexagonal tile grid (column, row): a schematic, not a map.
const europeTiles: [string, string, number, number][] = [
  ['IS', 'Islande', 0, 0], ['NO', 'Norvège', 4, 0], ['SE', 'Suède', 5, 0], ['FI', 'Finlande', 6, 0],
  ['IE', 'Irlande', 1, 1], ['GB', 'Royaume-Uni', 2, 1], ['DK', 'Danemark', 4, 1], ['EE', 'Estonie', 6, 1],
  ['NL', 'Pays-Bas', 3, 2], ['DE', 'Allemagne', 4, 2], ['PL', 'Pologne', 5, 2], ['LV', 'Lettonie', 6, 2],
  ['BE', 'Belgique', 2, 3], ['LU', 'Luxembourg', 3, 3], ['CZ', 'Tchéquie', 4, 3], ['SK', 'Slovaquie', 5, 3], ['LT', 'Lituanie', 6, 3],
  ['FR', 'France', 2, 4], ['CH', 'Suisse', 3, 4], ['AT', 'Autriche', 4, 4], ['HU', 'Hongrie', 5, 4], ['RO', 'Roumanie', 6, 4],
  ['PT', 'Portugal', 0, 5], ['ES', 'Espagne', 1, 5], ['IT', 'Italie', 3, 5], ['SI', 'Slovénie', 4, 5], ['HR', 'Croatie', 5, 5], ['BG', 'Bulgarie', 6, 5],
  ['MT', 'Malte', 3, 6], ['GR', 'Grèce', 5, 6], ['CY', 'Chypre', 7, 6],
];
const onlineShare = europeTiles.map(([code, name, col, row]) => ({ code, name, col, row, share: Math.round(18 + r() * 30 + (row < 3 ? 10 : 0)) }));
const teams2 = [['Ingénierie', 47], ['Ventes', 31], ['Support', 22], ['Marketing', 14], ['Finance', 8], ['RH', 5]].map(([team, people]) => ({ team, people }));
const marginGrid: { price: number; discount: number; margin: number }[] = [];
for (let i = 0; i <= 40; i++) {
  for (let j = 0; j <= 30; j++) {
    const price = 20 + i * 2;
    const discount = j;
    const volume = 1000 * Math.exp(-(((price - 45) / 30) ** 2)) * (1 + discount / 25);
    marginGrid.push({ price, discount, margin: Math.round(((price * (1 - discount / 100) - 22) * volume) / 1000 * 10) / 10 });
  }
}
const servers = ['web-1', 'web-2', 'web-3', 'api-1', 'api-2', 'db-1', 'db-2', 'cache-1'];
const cpu = servers.flatMap((server, k) =>
  Array.from({ length: 7 * 24 }, (_, h) => ({
    server,
    hour: new Date(2026, 10, 10, h),
    delta: Math.round((Math.sin(((h % 24) - 8) / 3.8) * (10 + k * 2) + gauss(r) * 4 + (k === 5 && h > 100 && h < 112 ? 35 : 0)) * 10) / 10,
  })),
);

// Store indicators, correlated on purpose (for the correlation matrix and the scatter matrix).
const storeKpis = Array.from({ length: 160 }, (_, i) => {
  const size = 200 + r() * 1800;
  const staff = Math.round(size / 60 + gauss(r) * 3 + 4);
  const visits = Math.round(size * 6 + gauss(r) * 900 + 2000);
  const basket = Math.round((48 + gauss(r) * 9 - size / 400) * 10) / 10;
  const revenue = Math.round((visits * basket) / 1000);
  const satisfaction = Math.round((78 - staff / 6 + size / 300 + gauss(r) * 5) * 10) / 10;
  return { store: `M${i + 1}`, region: ['Nord', 'Sud', 'Est', 'Ouest'][i % 4], size: Math.round(size), staff, visits, basket, revenue, satisfaction };
});
const kpiLabels = { size: { label: 'Surface (m²)' }, staff: { label: 'Effectif' }, visits: { label: 'Visites' }, basket: { label: 'Panier (€)' }, revenue: { label: 'CA (k€)' }, satisfaction: { label: 'Satisfaction' } };
const weekHours = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].flatMap((day, d) =>
  Array.from({ length: 24 }, (_, h) => ({ day, hour: `${h}h`, tickets: Math.round(Math.max(0, (d < 5 ? 1 : 0.35) * (6 + 30 * Math.exp(-((h - 10) ** 2) / 10) + 22 * Math.exp(-((h - 15) ** 2) / 8)) + gauss(r) * 3)) })),
);
const yearTemps = Array.from({ length: 365 }, (_, d) => ({ day: new Date(2025, 0, 1 + d), temp: Math.round((12 - 9.5 * Math.cos(((d - 15) / 365) * 2 * Math.PI) + gauss(r) * 2.4) * 10) / 10 }));
const objectives = [['Ventes', 0.92], ['Marge', 0.71], ['Satisfaction', 0.84], ['Délais', 0.58], ['Rétention', 0.77]].map(([axis, done]) => ({ axis, done }));
const cloud3d = Array.from({ length: 360 }, (_, i) => {
  const g = i % 3;
  const [cx, cy, cz] = [[-2, 1, 0], [2, 2, 1.5], [0, -2, -1]][g];
  return { x: cx + gauss(r) * 0.9, y: cy + gauss(r) * 0.9, z: cz + gauss(r) * 0.9, segment: ['Fidèles', 'Occasionnels', 'Nouveaux'][g] };
});

// Two years of releases: many small ones, a few that matter (importance 1 to 5).
const releases = Array.from({ length: 42 }, (_, i) => {
  const major = i % 9 === 0;
  const day = new Date(2025, 0, 6 + Math.round(i * 17.3 + Math.sin(i) * 5));
  return {
    date: day,
    version: major ? `Version ${1 + i / 9}.0` : `v${1 + Math.floor(i / 9)}.${i % 9}`,
    detail: major ? ['Lancement', 'Tableur', 'Graphiques 3D', 'WebGPU', 'Collaboration'][i / 9] : ['Correctifs', 'Performance', 'Accessibilité', 'Exports', 'Connecteurs'][i % 5],
    importance: major ? 5 : i % 4 === 0 ? 3 : 1,
  };
});

// The same countries over three years, and products over four quarters: data states for transitions.
const yearsByCountry = [2024, 2025, 2026].map((year, k) => ({
  label: String(year),
  data: countries.map((country, i) => ({ country, revenue: Math.round(200 + ((i * 131 + k * 257) % 700) + k * 40) })),
}));
const channelYears = [2024, 2025, 2026].map((year, k) => ({
  label: String(year),
  data: channels.map((c, i) => ({ channel: c.channel, visits: Math.round(c.visits * (1 + ((i * 3 + k * 5) % 7) * 0.12 - (i === 0 ? k * 0.18 : 0))) })),
}));
const quarters = ['T1', 'T2', 'T3', 'T4'].map((q, k) => ({
  label: q,
  data: catalog.map((d, i) => ({
    item: d.item,
    category: d.category,
    growth: Math.round((Math.sin(i * 1.7 + k * 1.1) * 18 + (i % 5) * 3) * 10) / 10,
    margin: Math.round((14 + Math.cos(i * 0.9 + k * 0.8) * 9 + (i % 3)) * 10) / 10,
    sales: Math.round(d.sales * (0.7 + 0.15 * k + ((i * k) % 4) * 0.05)),
  })),
}));

export type Entry = {
  title: string;
  caption: string;
  wide?: boolean;
  spec?: ChartSpec;
  tiles?: ChartSpec[];
  stack?: number[];
  showLayout?: boolean;
  /** Data states to switch between on the demo page (transitions). */
  states?: { label: string; data: ChartSpec['data'] }[];
};
export const entries: Entry[] = [
  {
    title: 'Frise chronologique dense',
    caption: 'timeline · 42 versions : chaque version est un point, les plus importantes (encode.size) ont une carte là où il y a la place, survolez la ligne pour retrouver les autres',
    wide: true,
    spec: {
      title: 'Versions publiées',
      subtitle: 'Deux ans de livraisons',
      data: releases,
      fields: { date: { label: 'Date' }, detail: { label: 'Contenu' } },
      layers: [{ mark: 'timeline', encode: { x: 'date', key: 'version', value: 'detail', size: 'importance' } }],
    },
  },
  {
    title: 'Graphique adaptatif',
    caption: 'responsive · un Sankey sur grand écran, des barres sous 480 px de large (règle dans la spec) ; réduisez la fenêtre pour voir',
    wide: true,
    spec: {
      title: 'Parcours des visiteurs',
      subtitle: 'De la source d’acquisition à l’abonnement',
      data: journeys,
      fields: { users: { label: 'Visiteurs' } },
      layers: [{ mark: 'sankey', encode: { source: 'source', target: 'target', value: 'users' } }],
      responsive: [
        {
          maxWidth: 480,
          spec: {
            subtitle: 'Visiteurs par étape (vue mobile)',
            layers: [
              {
                mark: 'bar',
                encode: { x: 'users', y: 'target' },
                transform: [{ type: 'aggregate', groupby: ['target'], ops: [{ op: 'sum', field: 'users', as: 'users' }] }, { type: 'sort', field: 'users', order: 'desc' }],
                style: { labels: true },
              },
            ],
          },
        },
      ],
    },
  },
  {
    title: 'Une courbe mise en avant',
    caption: 'layer.series : une série par son nom, dans sa couleur, plus épaisse, avec ses points et ses étiquettes ; les autres en gris (style.color)',
    wide: true,
    spec: {
      title: 'Chiffre d’affaires mensuel par pays',
      subtitle: 'L’Italie dépasse l’Espagne en juillet',
      data: monthlyByCountry.filter((d) => ['France', 'Allemagne', 'Espagne', 'Italie', 'Belgique'].includes(d.country)),
      fields: { revenue: { label: 'CA', format: { suffix: ' k€', decimals: 0 } }, month: { type: 'time' } },
      legend: false,
      layers: [
        {
          mark: 'line',
          encode: { x: 'month', y: 'revenue', color: 'country' },
          style: { color: '$muted', opacity: 0.55, endLabels: true, curve: 'smooth' },
          series: { Italie: { color: '#e34948', width: 4, opacity: 1, markers: true, labelColor: '#e34948' } },
        },
      ],
    },
  },
  {
    title: 'Étiquettes personnalisées',
    caption: 'layer.labels : couleur, taille (facteur), graisse et fond des étiquettes, quelle que soit la marque ; series.labelColor par part',
    spec: {
      title: 'Visites par canal',
      data: channels,
      fields: { visits: { label: 'Visites' } },
      layers: [
        {
          mark: 'donut',
          encode: { key: 'channel', value: 'visits' },
          style: { cornerRadius: 6, gap: 4 },
          labels: { color: '#1d2433', scale: 1.15, weight: 750, background: '#ffffffd9' },
          series: { Organique: { labelColor: '#0b5cd5' } },
        },
      ],
    },
  },
  {
    title: 'Globe et routes aériennes',
    caption: 'globe · projection orthographique, routes en grands cercles ; glisser pour le tourner (il tourne seul jusque-là)',
    spec: {
      title: 'Vols depuis Paris et Dubaï',
      data: routes,
      fields: { hub: { label: 'Départ' } },
      layers: [{ mark: 'globe', geo: countriesGeo, encode: { x: 'lon2', y: 'lat2', x2: 'lon', y2: 'lat', color: 'hub', key: 'city' } }],
    },
  },
  {
    title: 'Jauge à zones',
    caption: 'gauge · style.zones (couleurs par seuil), aiguille, graduations, ouverture de 240°',
    spec: {
      title: 'Indice de satisfaction',
      data: [{ score: 72 }],
      fields: { score: { label: 'Satisfaction', format: { decimals: 0 } } },
      layers: [{ mark: 'gauge', encode: { value: 'score' }, style: { sweep: 240, ticks: 5, thickness: 0.14, zones: [{ to: 40, color: '#e34948' }, { to: 70, color: '#eda100' }, { to: 100, color: '#1baf7a' }] } }],
    },
  },
  {
    title: 'Compteur',
    caption: 'gauge · style.needle, ticks et rounded : aiguille, graduations, extrémités arrondies',
    spec: {
      title: 'Requêtes par seconde',
      data: [{ rps: 1340 }],
      fields: { rps: { label: 'Requêtes / s', format: { decimals: 0 } } },
      layers: [{ mark: 'gauge', encode: { value: 'rps' }, style: { min: 0, max: 2000, sweep: 260, ticks: 4, needle: true, rounded: true, thickness: 0.12 } }],
    },
  },
  {
    title: 'Anneau aux coins arrondis',
    caption: 'donut · style.cornerRadius et gap : des parts arrondies et espacées',
    spec: {
      title: 'Visites par canal',
      data: channels,
      fields: { visits: { label: 'Visites' } },
      layers: [{ mark: 'donut', encode: { key: 'channel', value: 'visits' }, style: { cornerRadius: 8, gap: 5, innerRadius: 0.6 } }],
    },
  },
  {
    title: 'Carte de chaleur polaire',
    caption: 'polarHeatmap · les heures autour du cercle, les jours en anneaux',
    spec: {
      title: 'Tickets de support par heure',
      data: weekHours,
      fields: { tickets: { label: 'Tickets' } },
      layers: [{ mark: 'polarHeatmap', encode: { x: 'hour', y: 'day', value: 'tickets' } }],
    },
  },
  {
    title: 'Punch card',
    caption: 'heatmap · style.circles : un cercle par case, aire selon la valeur',
    wide: true,
    spec: {
      title: 'Tickets de support par jour et par heure',
      data: weekHours,
      fields: { tickets: { label: 'Tickets' } },
      layers: [{ mark: 'heatmap', encode: { x: 'hour', y: 'day', value: 'tickets' }, style: { circles: true } }],
    },
  },
  {
    title: 'Matrice de corrélation',
    caption: 'transform correlation + heatmap · style.diverging : négatif en rouge, positif en bleu, zéro neutre',
    spec: {
      title: 'Corrélations entre indicateurs des magasins',
      subtitle: 'Coefficient de Pearson, 160 magasins',
      data: storeKpis,
      fields: { value: { label: 'Corrélation', format: { decimals: 2 } } },
      layers: [{ mark: 'heatmap', encode: { x: 'x', y: 'y', value: 'value' }, transform: [{ type: 'correlation', fields: ['size', 'staff', 'visits', 'basket', 'revenue', 'satisfaction'], labels: ['Surface', 'Effectif', 'Visites', 'Panier', 'CA', 'Satisfaction'] }], style: { diverging: true } }],
    },
  },
  {
    title: 'Matrice de nuages (SPLOM)',
    caption: 'splom · chaque paire de champs en nuage, la distribution de chacun sur la diagonale',
    wide: true,
    spec: {
      title: 'Indicateurs des magasins, deux à deux',
      data: storeKpis,
      fields: kpiLabels,
      layers: [{ mark: 'splom', encode: { path: ['size', 'visits', 'basket', 'satisfaction'], color: 'region' } }],
    },
  },
  {
    title: 'Points pulsants',
    caption: 'point · style.pulse : des ondes autour des points mis en avant (effect scatter)',
    wide: true,
    spec: {
      title: 'Sites en alerte',
      subtitle: 'Les ondes signalent Londres, New York et Tokyo',
      projection: { type: 'mercator' },
      data: worldCities.map(([city, lon, lat, region]) => ({ city, lon, lat, region })),
      layers: [
        { mark: 'geoshape', geo: countriesGeo, encode: {} },
        { mark: 'point', encode: { x: 'lon', y: 'lat', color: 'region' }, style: { size: 9, pulse: true }, highlight: { field: 'city', values: ['Londres', 'New York', 'Tokyo'], dim: 0.55 } },
      ],
    },
  },
  {
    title: 'Barres sur piste',
    caption: 'bar · style.track : une piste pleine longueur derrière chaque barre',
    spec: {
      title: 'Avancement des objectifs',
      data: objectives,
      fields: { done: { label: 'Atteint', format: { style: 'percent', decimals: 0 } } },
      scales: { x: { domain: [0, 1] } },
      layers: [{ mark: 'bar', encode: { x: 'done', y: 'axis' }, style: { track: 'auto', radius: 8, thickness: 16, labels: true } }],
    },
  },
  {
    title: 'Courbe colorée par la valeur',
    caption: 'line · style.colorByValue : la couleur suit la hauteur de la courbe',
    wide: true,
    spec: {
      title: 'Température journalière',
      subtitle: '2025, en °C',
      data: yearTemps,
      fields: { temp: { label: 'Température', format: { suffix: ' °C', decimals: 1 } }, day: { type: 'time' } },
      layers: [{ mark: 'line', encode: { x: 'day', y: 'temp' }, style: { colorByValue: true, width: 2.5, curve: 'smooth' } }],
    },
  },
  {
    title: 'Arbre de bas en haut',
    caption: 'tree · style.reverse avec direction TB : la racine en bas',
    spec: {
      title: 'Organisation',
      data: org,
      fields: { people: { label: 'Personnes' } },
      layers: [{ mark: 'tree', encode: { path: ['ceo', 'dept', 'team'], value: 'people' }, style: { direction: 'TB', reverse: true } }],
    },
  },
  {
    title: 'Nuage de points 3D',
    caption: 'scatter3d · glisser pour tourner (il tourne seul jusque-là), perspective, profondeur',
    wide: true,
    spec: {
      title: 'Segments de clients',
      subtitle: 'Fréquence, panier et ancienneté (centrés réduits)',
      data: cloud3d,
      fields: { x: { label: 'Fréquence' }, y: { label: 'Panier' }, z: { label: 'Ancienneté' } },
      layers: [{ mark: 'scatter3d', encode: { x: 'x', y: 'y', z: 'z', color: 'segment' } }],
    },
  },
  {
    title: 'Transition entre deux états (barres)',
    caption: 'mêmes barres, nouvelles données : chaque barre glisse vers sa valeur et son rang, interpolée sur le GPU',
    states: yearsByCountry,
    spec: {
      title: 'Chiffre d’affaires par pays',
      subtitle: 'Changez d’année avec les boutons ci-dessus',
      data: yearsByCountry[0].data,
      fields: { revenue: { label: 'CA', format: { suffix: ' k€', decimals: 0 } } },
      layers: [{ mark: 'bar', encode: { x: 'revenue', y: 'country' }, transform: [{ type: 'sort', field: 'revenue', order: 'desc' }], style: { labels: true } }],
    },
  },
  {
    title: 'Transition entre deux états (anneau)',
    caption: 'donut · chaque part s’étire vers sa nouvelle part, angles interpolés sur le GPU',
    states: channelYears,
    spec: {
      title: 'Visites par canal',
      subtitle: 'Changez d’année avec les boutons ci-dessus',
      data: channelYears[0].data,
      fields: { visits: { label: 'Visites' } },
      layers: [{ mark: 'donut', encode: { key: 'channel', value: 'visits' } }],
    },
  },
  {
    title: 'Transition entre deux états (nuage)',
    caption: 'point avec encode.key : chaque produit garde son identité et se déplace d’un trimestre à l’autre',
    states: quarters,
    spec: {
      title: 'Croissance et marge par produit',
      subtitle: 'Taille : ventes · changez de trimestre avec les boutons ci-dessus',
      data: quarters[0].data,
      fields: { growth: { label: 'Croissance', format: { suffix: ' %', decimals: 1 } }, margin: { label: 'Marge', format: { suffix: ' %', decimals: 1 } }, sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      scales: { x: { domain: [-25, 35] }, y: { domain: [0, 30] } },
      layers: [{ mark: 'point', encode: { x: 'growth', y: 'margin', color: 'category', size: 'sales', key: 'item' }, style: { sizeRange: [6, 26], opacity: 0.85 } }],
    },
  },
  {
    title: 'Ridgeline',
    caption: 'ridgeline · une densité par groupe, empilées et superposées, sur un même axe',
    spec: {
      title: 'Températures journalières par mois',
      subtitle: 'En °C',
      data: dailyTemps,
      fields: { temp: { label: 'Température', format: { suffix: ' °C', decimals: 1 } } },
      layers: [{ mark: 'ridgeline', encode: { key: 'month', x: 'temp' } }],
    },
  },
  {
    title: 'Essaim (beeswarm)',
    caption: 'beeswarm · un point par appel, écarté juste assez pour ne pas chevaucher les autres',
    wide: true,
    spec: {
      title: 'Temps de réponse par service',
      subtitle: 'Un point par appel, en millisecondes',
      data: apiCalls,
      fields: { ms: { label: 'Temps de réponse', format: { suffix: ' ms', decimals: 0 } } },
      layers: [{ mark: 'beeswarm', encode: { x: 'ms', key: 'service', color: 'service' }, style: { label: 'endpoint', size: 6 } }],
    },
  },
  {
    title: 'Carte en tuiles hexagonales',
    caption: 'tilemap · une tuile par pays sur une grille, couleur selon la valeur (schéma, pas une carte exacte)',
    spec: {
      title: 'Part des ventes en ligne',
      data: onlineShare,
      fields: { share: { label: 'Part en ligne', format: { suffix: ' %' } } },
      layers: [{ mark: 'tilemap', encode: { x: 'col', y: 'row', key: 'code', color: 'share' } }],
    },
  },
  {
    title: 'Graphique pictographique',
    caption: 'pictorial · une rangée de symboles par catégorie, chacun valant style.unit',
    spec: {
      title: 'Effectifs par équipe',
      data: teams2,
      fields: { people: { label: 'Personnes' } },
      layers: [{ mark: 'pictorial', encode: { key: 'team', value: 'people' }, style: { unit: 2 } }],
    },
  },
  {
    title: 'Surface et courbes de niveau',
    caption: 'surface · grille interpolée par le GPU et lignes de niveau (marching squares)',
    wide: true,
    spec: {
      title: 'Marge selon le prix et la remise',
      subtitle: 'En milliers d’euros',
      data: marginGrid,
      fields: { price: { label: 'Prix', format: { suffix: ' €' } }, discount: { label: 'Remise', format: { suffix: ' %' } }, margin: { label: 'Marge', format: { suffix: ' k€', decimals: 1 } } },
      axes: { x: { title: 'Prix (€)' }, y: { title: 'Remise (%)' } },
      layers: [{ mark: 'surface', encode: { x: 'price', y: 'discount', value: 'margin' } }],
    },
  },
  {
    title: 'Horizon',
    caption: 'horizon · chaque série repliée en 3 bandes d’intensité, l’écart négatif dans l’autre teinte',
    wide: true,
    spec: {
      title: 'Charge processeur par serveur',
      subtitle: 'Écart à la moyenne, en points, sur 7 jours',
      data: cpu,
      fields: { delta: { label: 'Écart', format: { suffix: ' pts', decimals: 1 } }, hour: { label: 'Heure' } },
      layers: [{ mark: 'horizon', encode: { key: 'server', x: 'hour', y: 'delta' } }],
    },
  },
  {
    title: 'Arbre radial',
    caption: 'tree · style.radial : la profondeur devient le rayon, les feuilles font le tour',
    spec: {
      title: 'Catalogue produits',
      data: catalog,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      layers: [{ mark: 'tree', encode: { path: ['category', 'item'], value: 'sales' }, style: { radial: true } }],
    },
  },
  {
    title: 'Nuage animé (Gapminder)',
    caption: 'motion · un point par magasin qui se déplace d’une année à l’autre, axes fixes, traînée sur les points mis en avant',
    wide: true,
    spec: {
      title: 'Magasins : rendement et marge, 2015 – 2026',
      subtitle: 'Taille : effectif · Paris et Tokyo laissent une traînée',
      data: storeYears,
      fields: {
        perM2: { label: 'CA par m²', format: { suffix: ' €', decimals: 0 } },
        margin: { label: 'Marge', format: { suffix: ' %', decimals: 1 } },
        staff: { label: 'Effectif' },
        year: { label: 'Année' },
      },
      axes: { x: { title: 'Chiffre d’affaires par m² (échelle log)' }, y: { title: 'Marge (%)' } },
      scales: { x: { type: 'log', domain: [1500, 30000] } },
      layers: [{ mark: 'motion', encode: { x: 'perM2', y: 'margin', key: 'store', time: 'year', size: 'staff', color: 'region' }, style: { sizeRange: [6, 30] }, highlight: { field: 'store', values: ['Paris', 'Tokyo'] } }],
    },
  },
  {
    title: 'Tableau croisé',
    caption: 'pivot · cellules teintées selon la valeur, total et courbe de tendance par ligne',
    wide: true,
    spec: {
      title: 'Chiffre d’affaires mensuel par pays',
      subtitle: '2026, en milliers d’euros',
      data: monthlyByCountry,
      fields: { revenue: { label: 'CA', format: { decimals: 0 } } },
      layers: [{ mark: 'pivot', encode: { key: 'country', x: 'month', value: 'revenue' } }],
    },
  },
  {
    title: 'Graphiques synchronisés',
    caption: 'interactions.sync · même survol et même zoom (molette, glisser) sur les trois graphiques',
    wide: true,
    stack: [190, 170, 170],
    tiles: [
      {
        title: 'Chiffre d’affaires (k€)', data: year, fields: { revenue: { label: 'CA', format: { suffix: ' k€' } } }, legend: false,
        layers: [{ mark: 'area', encode: { x: 'day', y: 'revenue' }, style: { gradient: true } }],
        interactions: { sync: 'annee', zoom: { axes: 'x' } },
      },
      {
        title: 'Commandes', data: year, fields: { orders: { label: 'Commandes' } }, legend: false,
        layers: [{ mark: 'bar', encode: { x: 'day', y: 'orders' }, style: { color: '$2', radius: 1 } }],
        interactions: { sync: 'annee', zoom: { axes: 'x' } },
      },
      {
        title: 'Panier moyen (€)', data: year, fields: { basket: { label: 'Panier', format: { suffix: ' €', decimals: 1 } } }, legend: false,
        layers: [{ mark: 'line', encode: { x: 'day', y: 'basket' }, style: { color: '$3', curve: 'smooth' } }],
        interactions: { sync: 'annee', zoom: { axes: 'x' } },
      },
    ],
  },
  {
    title: 'Navigateur de plage',
    caption: 'interactions.navigator · glissez une fenêtre sur le bas (ou ses bords) pour choisir la période du haut ; un clic remet tout',
    wide: true,
    stack: [300, 90],
    tiles: [
      {
        title: 'Cours de l’action', data: prices, fields: { price: { label: 'Cours', format: { suffix: ' €', decimals: 2 } } }, legend: false,
        layers: [{ mark: 'line', encode: { x: 'date', y: 'price' } }],
        scales: { y: { zero: false } },
        interactions: { sync: 'cours', zoom: { axes: 'x' } },
      },
      {
        data: prices, legend: false, axes: { y: false },
        layers: [{ mark: 'area', encode: { x: 'date', y: 'price' }, style: { opacity: 0.18, lineWidth: 1 } }],
        scales: { y: { zero: false } },
        interactions: { sync: 'cours', navigator: true, tooltip: false },
      },
    ],
  },
  {
    title: 'Chandeliers (candlestick)',
    caption: 'candlestick · y = haut, y2 = bas, encode.open et encode.close · hausse et baisse aux couleurs d’état',
    wide: true,
    spec: {
      title: 'Cours de l’action',
      subtitle: '45 séances',
      data: ohlc,
      fields: { high: { label: 'Haut → bas', format: euro } },
      legend: false,
      layers: [{ mark: 'candlestick', encode: { x: 'date', y: 'high', y2: 'low', open: 'open', close: 'close' } }],
      scales: { y: { zero: false } },
      interactions: { zoom: { axes: 'x' } },
    },
  },
  {
    title: 'Barres OHLC',
    caption: 'candlestick · style.ohlc : ouverture à gauche, clôture à droite',
    spec: {
      title: 'Cours de l’action',
      data: ohlc,
      fields: { high: { label: 'Haut → bas', format: euro } },
      legend: false,
      layers: [{ mark: 'candlestick', encode: { x: 'date', y: 'high', y2: 'low', open: 'open', close: 'close' }, style: { ohlc: true, wick: 1.5 } }],
      scales: { y: { zero: false } },
    },
  },
  {
    title: 'Routes aériennes',
    caption: 'route sous projection · de (x, y) à (x2, y2), courbées, épaisseur selon les vols',
    wide: true,
    spec: {
      title: 'Vols hebdomadaires depuis Paris et Dubaï',
      projection: { type: 'mercator' },
      data: routes,
      fields: { flights: { label: 'Vols par semaine' }, hub: { label: 'Départ' } },
      layers: [
        { mark: 'geoshape', geo: countriesGeo, encode: {} },
        { mark: 'route', encode: { x: 'lon', y: 'lat', x2: 'lon2', y2: 'lat2', color: 'hub', size: 'flights' }, style: { sizeRange: [4, 16] } },
      ],
      interactions: { zoom: { axes: 'xy', max: 20 } },
    },
  },
  {
    title: 'Courbe en cloche',
    caption: 'transform density (method normal) sur un histogramme · step aligne la courbe sur les comptes',
    spec: {
      title: 'Durée des sessions et loi normale ajustée',
      subtitle: '4 000 sessions, en secondes',
      data: durations,
      fields: { count: { label: 'Sessions' }, bin_mid: { label: 'Durée (s)' }, density: { label: 'Loi normale', format: { decimals: 0 } }, duration: { label: 'Durée (s)' } },
      layers: [
        { mark: 'bar', name: 'Sessions', encode: { x: 'bin_mid', y: 'count' }, transform: [{ type: 'bin', field: 'duration', step: 10 }], style: { bandPadding: 0.08, radius: 2, opacity: 0.55 } },
        { mark: 'line', name: 'Loi normale', encode: { x: 'duration', y: 'density' }, transform: [{ type: 'density', field: 'duration', method: 'normal', step: 10 }], style: { width: 2.5 } },
      ],
    },
  },
  {
    title: 'Nuage avec dispersion (jitter)',
    caption: 'point · style.jitter étale les points sur la largeur de la catégorie, pour voir les valeurs égales',
    spec: {
      title: 'Délais de traitement par équipe',
      subtitle: 'Un point par dossier, en jours',
      data: delays,
      fields: { days: { label: 'Délai (jours)' } },
      layers: [{ mark: 'point', encode: { x: 'team', y: 'days', color: 'team' }, style: { jitter: 0.7, size: 6, opacity: 0.7, strokeWidth: 0 } }],
    },
  },
  {
    title: 'Bulles groupées',
    caption: 'bubbles · aire selon la valeur, une grappe par famille (encode.color)',
    spec: {
      title: 'Ventes par produit et famille',
      data: catalog,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } }, category: { label: 'Famille' } },
      layers: [{ mark: 'bubbles', encode: { key: 'item', value: 'sales', color: 'category' } }],
    },
  },
  {
    title: 'Diagramme en arcs',
    caption: 'arcDiagram · nœuds alignés, chaque lien en demi-cercle aussi épais que sa valeur',
    spec: {
      title: 'Échanges entre services',
      subtitle: 'Messages par semaine',
      data: exchanges,
      fields: { messages: { label: 'Messages' } },
      layers: [{ mark: 'arcDiagram', encode: { source: 'from', target: 'to', value: 'messages' } }],
    },
  },
  {
    title: 'Pyramide',
    caption: 'pyramid · étages empilés depuis la pointe, hauteur selon la valeur',
    spec: {
      title: 'Clients par niveau de fidélité',
      data: loyalty,
      fields: { customers: { label: 'Clients' } },
      layers: [{ mark: 'pyramid', encode: { key: 'tier', value: 'customers' } }],
    },
  },
  {
    title: 'Champ de vecteurs',
    caption: 'vector · encode.angle (degrés) et encode.size (longueur), couleur selon la vitesse',
    spec: {
      title: 'Vent à 10 m',
      subtitle: 'Direction et vitesse (m/s)',
      data: wind,
      fields: { speed: { label: 'Vitesse (m/s)' }, lon: { label: 'Longitude' }, lat: { label: 'Latitude' } },
      layers: [{ mark: 'vector', encode: { x: 'lon', y: 'lat', angle: 'direction', size: 'speed', color: 'speed' }, style: { sizeRange: [6, 26] } }],
    },
  },
  {
    title: 'Barres radiales',
    caption: 'radialBar · un anneau par catégorie, la plus grande fait trois quarts de tour',
    spec: {
      title: 'Chiffre d’affaires par pays',
      subtitle: 'Six premiers pays, en milliers d’euros',
      data: [...revenueByCountry].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
      fields: { revenue: { label: 'CA', format: { suffix: ' k€', decimals: 0 } } },
      layers: [{ mark: 'radialBar', encode: { key: 'country', value: 'revenue' } }],
    },
  },
  {
    title: 'Icicle',
    caption: 'icicle · une ligne par niveau, chaque nœud aussi large que sa valeur · cliquez pour zoomer',
    spec: {
      title: 'Ventes par région, pays et ville',
      data: geoSales,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      layers: [{ mark: 'icicle', encode: { path: ['region', 'country', 'city'], value: 'sales' } }],
    },
  },
  {
    title: 'Flame chart',
    caption: 'icicle · style.orientation BT · profil d’exécution, la racine en bas · cliquez pour zoomer',
    spec: {
      title: 'Profil d’une requête',
      subtitle: 'Temps passé par fonction, en millisecondes',
      data: profile,
      fields: { ms: { label: 'Temps', format: { suffix: ' ms', decimals: 0 } } },
      layers: [{ mark: 'icicle', encode: { path: ['f0', 'f1', 'f2', 'f3'], value: 'ms' }, style: { orientation: 'BT', radius: 2 } }],
    },
  },
  {
    title: 'Hémicycle',
    caption: 'parliament · un point par siège, les groupes de gauche à droite',
    spec: {
      title: 'Composition de l’assemblée',
      data: seats,
      fields: { seats: { label: 'Sièges' } },
      layers: [{ mark: 'parliament', encode: { key: 'party', value: 'seats' } }],
    },
  },
  {
    title: 'Diagramme de Venn',
    caption: 'venn · aires proportionnelles aux ensembles et à leurs intersections (clé « A&B »)',
    spec: {
      title: 'Clients par canal d’achat',
      subtitle: 'Sur les 12 derniers mois',
      data: audiences,
      fields: { users: { label: 'Clients' } },
      layers: [{ mark: 'venn', encode: { key: 'sets', value: 'users' } }],
    },
  },
  {
    title: 'Nuage de mots',
    caption: 'wordcloud · taille et teinte selon la fréquence, les plus fréquents au centre',
    spec: {
      title: 'Recherches dans le portail BI',
      data: searchTerms,
      fields: { count: { label: 'Recherches' } },
      layers: [{ mark: 'wordcloud', encode: { key: 'term', value: 'count' } }],
    },
  },
  {
    title: 'Frise chronologique',
    caption: 'timeline · étapes alternées au-dessus et au-dessous de la ligne',
    spec: {
      title: 'Feuille de route',
      data: milestones,
      fields: { date: { label: 'Date' }, detail: { label: 'Détail' } },
      layers: [{ mark: 'timeline', encode: { x: 'date', key: 'step', value: 'detail' } }],
    },
  },
  {
    title: 'Dendrogramme',
    caption: 'tree · une hiérarchie en arbre, liens courbes, feuilles alignées',
    spec: {
      title: 'Catalogue produits',
      data: catalog,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      layers: [{ mark: 'tree', encode: { path: ['category', 'item'], value: 'sales' } }],
    },
  },
  {
    title: 'Organigramme',
    caption: 'tree · style.boxes et direction TB · effectifs cumulés par équipe',
    spec: {
      title: 'Organisation',
      data: org,
      fields: { people: { label: 'Personnes' } },
      layers: [{ mark: 'tree', encode: { path: ['ceo', 'dept', 'team'], value: 'people' }, style: { boxes: true, direction: 'TB', boxWidth: 116 } }],
    },
  },
  {
    title: 'Lignes de référence et zones',
    caption: 'annotations · ligne d’objectif, bande de campagne et note sur un point, en coordonnées de données',
    spec: {
      title: 'Chiffre d’affaires mensuel',
      subtitle: 'En milliers d’euros',
      data: monthly,
      fields: { revenue: { label: 'CA', format: { suffix: ' k€', decimals: 0 } }, month: { type: 'time' } },
      layers: [{ mark: 'line', encode: { x: 'month', y: 'revenue' }, style: { curve: 'smooth' } }],
      annotations: [
        { x: ['2025-04-01', '2025-06-01'], text: 'Campagne printemps' },
        { y: 1200, text: 'Objectif 1 200 k€', color: '$5' },
        { x: '2025-10-01', y: monthly[9].revenue, text: 'Nouvelle gamme' },
      ],
    },
  },
  {
    title: 'Réel et prévision en pointillés',
    caption: 'line · style.dash · deux calques, la prévision reprend où le réel s’arrête',
    spec: {
      title: 'Chiffre d’affaires : réel et prévision',
      subtitle: 'En milliers d’euros',
      fields: { revenue: { label: 'CA', format: { suffix: ' k€', decimals: 0 } }, month: { type: 'time' } },
      layers: [
        { mark: 'line', name: 'Réel', data: actual, encode: { x: 'month', y: 'revenue' } },
        { mark: 'line', name: 'Prévision', data: projected, encode: { x: 'month', y: 'revenue' }, style: { dash: [6, 5] } },
      ],
      annotations: [{ x: '2026-06-01', text: 'Aujourd’hui' }],
    },
  },
  {
    title: 'Valeurs manquantes',
    caption: 'line · une valeur nulle coupe la ligne (style.connectNulls pour la relier) · style.markers',
    spec: {
      title: 'Température d’une salle serveur',
      subtitle: 'Relevé horaire, capteur hors ligne par moments',
      data: sensor,
      fields: { temperature: { label: 'Température', format: { suffix: ' °C', decimals: 1 } }, hour: { type: 'time' } },
      layers: [{ mark: 'line', encode: { x: 'hour', y: 'temperature' }, style: { markers: true, width: 1.5 } }],
      annotations: [{ y: 22, text: 'Seuil d’alerte', color: '$5' }],
    },
  },
  {
    title: 'Étiquettes sur les points',
    caption: 'line · style.labels et style.markers · highlight sur la meilleure semaine',
    spec: {
      title: 'Inscriptions par semaine',
      data: weekly,
      fields: { signups: { label: 'Inscriptions' } },
      layers: [{ mark: 'line', encode: { x: 'week', y: 'signups' }, style: { labels: true, markers: true }, highlight: { field: 'week', values: ['S7'] } }],
    },
  },
  {
    title: 'Barres et objectif',
    caption: 'bar + annotations · ligne verticale sur l’axe des valeurs d’un graphique horizontal',
    spec: {
      title: 'Chiffre d’affaires par pays',
      subtitle: 'En milliers d’euros',
      data: revenueByCountry,
      fields: { revenue: { label: 'CA', format: { suffix: ' k€', decimals: 0 } } },
      layers: [{ mark: 'bar', encode: { x: 'revenue', y: 'country' }, transform: [{ type: 'sort', field: 'revenue', order: 'desc' }] }],
      annotations: [{ x: 600, text: 'Objectif', color: '$5', dash: [] }, { x: [0, 300], color: '$5', opacity: 0.06 }],
    },
  },
  {
    title: 'Demi-anneau',
    caption: 'donut · style.startAngle -90 et style.endAngle 90 · total au centre',
    spec: {
      title: 'Composition de l’assemblée',
      subtitle: '477 sièges',
      data: seats,
      fields: { seats: { label: 'Sièges' } },
      layers: [{ mark: 'donut', encode: { key: 'party', value: 'seats' }, style: { startAngle: -90, endAngle: 90, innerRadius: 0.55 } }],
    },
  },
  {
    title: 'Camembert à rayon variable',
    caption: 'pie · angle = superficie, rayon = densité (encode.size)',
    spec: {
      title: 'Superficie et densité',
      subtitle: 'Angle : superficie (milliers de km²) · rayon : habitants par km²',
      data: density,
      fields: { area: { label: 'Superficie (k km²)' }, density: { label: 'Densité (hab./km²)' } },
      layers: [{ mark: 'pie', encode: { key: 'country', value: 'area', size: 'density' } }],
    },
  },
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
  {
    title: 'Marimekko',
    caption: 'marimekko · largeur = part du total, hauteur = part dans la colonne',
    wide: true,
    spec: {
      title: 'Marché par région et segment',
      subtitle: 'En millions d’euros',
      data: marketShare,
      fields: { sales: { label: 'Ventes', format: { suffix: ' M€' } } },
      layers: [{ mark: 'marimekko', encode: { x: 'region', color: 'segment', value: 'sales' } }],
    },
  },
  {
    title: 'Cercles imbriqués',
    caption: 'pack · path: [région, pays, ville] · aire proportionnelle',
    spec: {
      title: 'Ventes par région, pays et ville',
      data: geoSales,
      fields: { sales: { label: 'Ventes', format: { suffix: ' k€' } } },
      layers: [{ mark: 'pack', encode: { path: ['region', 'country', 'city'], value: 'sales' } }],
    },
  },
  {
    title: 'Diagramme en cordes',
    caption: 'chord · échanges entre régions, ruban à la couleur de l’exportateur',
    spec: {
      title: 'Échanges commerciaux',
      subtitle: 'Milliards de dollars',
      data: trade,
      fields: { billions: { label: 'Échanges', format: { suffix: ' Md$' } } },
      layers: [{ mark: 'chord', encode: { source: 'from', target: 'to', value: 'billions' } }],
    },
  },
  {
    title: 'Réseau',
    caption: 'network · placement par forces, taille selon l’activité · glissez les nœuds',
    wide: true,
    spec: {
      title: 'Collaboration entre équipes',
      subtitle: '28 personnes · liens = projets communs',
      fields: { activite: { label: 'Activité' } },
      layers: [{ mark: 'network', graph: teamGraph, encode: { value: 'activite' } }],
    },
  },
  {
    title: 'Coordonnées parallèles',
    caption: 'parallel · path: champs à comparer · une ligne par produit',
    wide: true,
    spec: {
      title: 'Profil des produits',
      subtitle: '160 produits, par catégorie',
      data: products,
      fields: { price: { label: 'Prix (€)' }, margin: { label: 'Marge (%)' }, rating: { label: 'Note', format: { decimals: 1 } }, sales: { label: 'Ventes' }, returns: { label: 'Retours (%)', format: { decimals: 1 } } },
      layers: [{ mark: 'parallel', encode: { path: ['price', 'margin', 'rating', 'sales', 'returns'], color: 'category' } }],
    },
  },
  {
    title: 'Densité hexagonale',
    caption: 'hexbin · 150 000 points comptés par hexagone',
    spec: {
      title: 'Durée de session et pages vues',
      data: { columns: dense },
      fields: { x: { label: 'Durée (min)' }, y: { label: 'Pages vues' } },
      layers: [{ mark: 'hexbin', encode: { x: 'x', y: 'y' }, style: { radius: 8 } }],
    },
  },
  {
    title: 'Pyramide des âges',
    caption: 'barres horizontales empilées · hommes en négatif, format absolu',
    spec: {
      title: 'Population par âge et sexe',
      subtitle: 'En milliers',
      data: pyramid,
      fields: { people: { label: 'Personnes', format: { absolute: true } } },
      scales: { color: { colors: { Hommes: '$1', Femmes: '$2' } } },
      layers: [{ mark: 'bar', encode: { x: 'people', y: 'age', color: 'sex' }, stack: true, style: { thickness: 18, radius: 3 } }],
    },
  },
  {
    title: 'Course de barres',
    caption: 'race · une image par mois, rangs et valeurs interpolés · lecture, pause et curseur',
    wide: true,
    spec: {
      title: 'Ventes cumulées par produit',
      subtitle: 'Les 10 premiers, mois par mois',
      data: raceData,
      fields: { sales: { label: 'Ventes cumulées', format: { suffix: ' k€' } }, month: { label: 'Mois' } },
      layers: [{ mark: 'race', encode: { key: 'product', value: 'sales', time: 'month' } }],
    },
  },
  {
    title: 'Course par famille',
    caption: 'race · couleur par famille, 8 premiers, en boucle',
    wide: true,
    spec: {
      title: 'Ventes cumulées, couleur par famille',
      data: raceData,
      fields: { sales: { label: 'Ventes cumulées', format: { suffix: ' k€' } } },
      layers: [{ mark: 'race', encode: { key: 'product', value: 'sales', time: 'month', color: 'family' }, style: { top: 8, duration: 600, loop: true } }],
    },
  },
];

// --------------------------------------------------------------- organisation

export const GROUPS: [string, string[]][] = [
  ['Lignes et annotations', ['Lignes de référence et zones', 'Réel et prévision en pointillés', 'Valeurs manquantes', 'Étiquettes sur les points', 'Barres et objectif']],
  ['Comparaison', ['Pyramide des âges', 'Barres horizontales triées', 'Barres horizontales empilées', 'Barres empilées à 100 %', 'Épaisseur et couleur par barre', 'Barres fines et mise en avant', 'Sucettes', 'Haltères (dumbbell)', 'Graphique à puces (bullet)']],
  ['Transitions', ['Transition entre deux états (barres)', 'Transition entre deux états (anneau)', 'Transition entre deux états (nuage)']],
  ['Combinaisons', ['Graphiques synchronisés', 'Navigateur de plage', 'Tableau croisé']],
  ['Bourse', ['Chandeliers (candlestick)', 'Barres OHLC']],
  ['Évolution', ['Courbe colorée par la valeur', 'Course de barres', 'Course par famille', 'Prévision avec intervalle', 'Courbe en escalier', 'Streamgraph', 'Classement (bump chart)', 'Graphique de pente', 'Chandeliers']],
  ['Temps et planning', ['Diagramme de Gantt', 'Calendrier']],
  ['Distribution', ['Ridgeline', 'Essaim (beeswarm)', 'Courbe en cloche', 'Nuage avec dispersion (jitter)', 'Histogramme', 'Boîte à moustaches', 'Violon', 'Distribution en traits']],
  ['Petits multiples', ['Petits multiples de courbes', 'Petits multiples de barres']],
  ['Corrélation', ['Nuage de points 3D', 'Matrice de nuages (SPLOM)', 'Nuage animé (Gapminder)', 'Champ de vecteurs', 'Nuage de points et régression', 'Bulles', 'Densité hexagonale', 'Coordonnées parallèles']],
  ['Parts et hiérarchies', ['Camembert', 'Anneau', 'Anneau aux coins arrondis', 'Demi-anneau', 'Hémicycle', 'Camembert à rayon variable', 'Treemap', 'Sunburst', 'Cercles imbriqués', 'Marimekko', 'Gaufre']],
  ['Flux', ['Pipeline de données', 'Diagramme de flux', 'Processus avec volumes', 'Chemin mis en avant', 'Sankey', 'Diagramme en cordes', 'Réseau', 'Entonnoir', 'Cascade']],
  ['Matrices et polaires', ['Matrice de corrélation', 'Carte de chaleur polaire', 'Punch card', 'Surface et courbes de niveau', 'Horizon', 'Carte de chaleur', 'Radar', 'Rose polaire', 'Barres radiales']],
  ['Arbres et ensembles', ['Bulles groupées', 'Diagramme en arcs', 'Dendrogramme', 'Arbre radial', 'Arbre de bas en haut', 'Organigramme', 'Icicle', 'Flame chart', 'Diagramme de Venn']],
  ['Texte et chronologie', ['Nuage de mots', 'Frise chronologique', 'Frise chronologique dense']],
  ['Indicateurs', ['Tuiles KPI', 'Jauge', 'Jauge à zones', 'Compteur', 'Barres sur piste', 'Pyramide', 'Graphique pictographique']],
  ['Cartes', ['Globe et routes aériennes', 'Points pulsants', 'Carte en tuiles hexagonales', 'Routes aériennes', 'Points sur une carte du monde', 'Choroplèthe mondiale', 'Bulles sur une carte', 'Zoom sur l’Europe et mise en avant']],
  ['Mise en avant', ['Graphique adaptatif', 'Une courbe mise en avant', 'Étiquettes personnalisées', 'Mise en avant dans un camembert', 'Mise en avant dans un treemap', 'Mise en avant d’une série', 'Mise en avant sur une carte de chaleur']],
];

// ----------------------------------------------------------- color themes

/** Each palette was checked for color-blind separation, contrast and lightness, in light and dark. */
export const PALETTES: Record<string, { label: string; light: string[]; dark: string[]; ramp: string[] }> = {
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
