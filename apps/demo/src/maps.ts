import { Chart, type ChartSpec } from '@futurcharts/core';
import { registerGeo } from '@futurcharts/geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';

registerGeo();

// Natural Earth countries (public domain), shipped as TopoJSON by world-atlas.
const countries = feature(world as any, (world as any).objects.countries) as unknown as {
  features: { id?: string; properties: { name: string } }[];
};

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

// A forest of points: stores scattered around large cities.
const cities: [string, number, number, string][] = [
  ['Paris', 2.35, 48.86, 'Europe'], ['Londres', -0.13, 51.51, 'Europe'], ['Berlin', 13.4, 52.52, 'Europe'], ['Madrid', -3.7, 40.42, 'Europe'],
  ['Rome', 12.5, 41.9, 'Europe'], ['Varsovie', 21.01, 52.23, 'Europe'], ['Stockholm', 18.07, 59.33, 'Europe'], ['Istanbul', 28.98, 41.01, 'Europe'],
  ['New York', -74.0, 40.71, 'Amérique du Nord'], ['Los Angeles', -118.24, 34.05, 'Amérique du Nord'], ['Chicago', -87.63, 41.88, 'Amérique du Nord'],
  ['Toronto', -79.38, 43.65, 'Amérique du Nord'], ['Mexico', -99.13, 19.43, 'Amérique du Nord'], ['Houston', -95.37, 29.76, 'Amérique du Nord'],
  ['São Paulo', -46.63, -23.55, 'Amérique du Sud'], ['Buenos Aires', -58.38, -34.6, 'Amérique du Sud'], ['Bogota', -74.07, 4.71, 'Amérique du Sud'],
  ['Lima', -77.04, -12.05, 'Amérique du Sud'], ['Santiago', -70.67, -33.45, 'Amérique du Sud'],
  ['Lagos', 3.38, 6.52, 'Afrique'], ['Le Caire', 31.24, 30.04, 'Afrique'], ['Johannesburg', 28.05, -26.2, 'Afrique'], ['Nairobi', 36.82, -1.29, 'Afrique'],
  ['Casablanca', -7.59, 33.57, 'Afrique'], ['Kinshasa', 15.27, -4.44, 'Afrique'],
  ['Tokyo', 139.69, 35.69, 'Asie'], ['Shanghai', 121.47, 31.23, 'Asie'], ['Pékin', 116.41, 39.9, 'Asie'], ['Delhi', 77.21, 28.61, 'Asie'],
  ['Mumbai', 72.88, 19.08, 'Asie'], ['Singapour', 103.82, 1.35, 'Asie'], ['Séoul', 126.98, 37.57, 'Asie'], ['Jakarta', 106.85, -6.21, 'Asie'],
  ['Bangkok', 100.5, 13.76, 'Asie'], ['Dubaï', 55.27, 25.2, 'Asie'],
  ['Sydney', 151.21, -33.87, 'Océanie'], ['Melbourne', 144.96, -37.81, 'Océanie'], ['Auckland', 174.76, -36.85, 'Océanie'],
];
const PER_CITY = 130;
const N = cities.length * PER_CITY;
const stores = { lon: new Float64Array(N), lat: new Float64Array(N), revenue: new Float64Array(N), region: new Array<string>(N), city: new Array<string>(N) };
{
  const r = rng(2026);
  let i = 0;
  for (const [city, lon, lat, region] of cities) {
    for (let k = 0; k < PER_CITY; k++, i++) {
      stores.lat[i] = lat + gauss(r) * 1.3;
      stores.lon[i] = lon + (gauss(r) * 1.3) / Math.cos((lat * Math.PI) / 180);
      stores.revenue[i] = Math.round(40 + Math.abs(gauss(r)) * 260);
      stores.region[i] = region;
      stores.city[i] = city;
    }
  }
}

const palette = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
const regions = ['Europe', 'Amérique du Nord', 'Amérique du Sud', 'Afrique', 'Asie', 'Océanie'];

const pointsSpec = (select: 'lasso' | 'rect'): ChartSpec => ({
  title: 'Points de vente dans le monde',
  subtitle: `${N.toLocaleString('fr-FR')} points · taille proportionnelle au chiffre d’affaires`,
  projection: { type: 'mercator' },
  fields: { lon: { label: 'Longitude' }, lat: { label: 'Latitude' }, revenue: { label: 'CA', format: { suffix: ' k€' } } },
  scales: { color: { domain: regions } },
  layers: [
    { mark: 'geoshape', geo: countries, encode: {} },
    {
      mark: 'point',
      data: { columns: stores },
      encode: { x: 'lon', y: 'lat', color: 'region', size: 'revenue' },
      style: { sizeRange: [3, 9], strokeWidth: 0.5, opacity: 0.85 },
    },
  ],
  interactions: { select, zoom: { axes: 'xy', max: 60 } },
});

const points = await Chart.create(document.getElementById('points')!, pointsSpec('lasso'));

// The selection comes back as row indices: aggregate straight from the columns.
const summary = document.getElementById('summary')!;
const breakdown = document.getElementById('breakdown')!;
const euro = new Intl.NumberFormat('fr-FR');
points.on('select', (selection) => {
  breakdown.replaceChildren();
  if (selection.count === 0) {
    summary.className = 'muted';
    summary.textContent = 'Aucune sélection. Dessinez une forme autour des points.';
    return;
  }
  let total = 0;
  const byRegion = new Map<string, number>();
  for (const { rows } of selection.layers) {
    for (const row of rows) {
      total += stores.revenue[row];
      byRegion.set(stores.region[row], (byRegion.get(stores.region[row]) ?? 0) + 1);
    }
  }
  summary.className = '';
  summary.innerHTML = `<strong>${euro.format(selection.count)}</strong> points sélectionnés · CA total <strong>${euro.format(total)} k€</strong>`;
  for (const [region, count] of byRegion) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const dot = document.createElement('i');
    dot.style.background = palette[regions.indexOf(region)];
    chip.append(dot, `${region} ${euro.format(count)}`);
    breakdown.append(chip, ' ');
  }
});

const lassoBtn = document.getElementById('tool-lasso')!;
const rectBtn = document.getElementById('tool-rect')!;
const setTool = (tool: 'lasso' | 'rect') => {
  lassoBtn.setAttribute('aria-pressed', String(tool === 'lasso'));
  rectBtn.setAttribute('aria-pressed', String(tool === 'rect'));
  points.update(pointsSpec(tool));
};
lassoBtn.addEventListener('click', () => setTool('lasso'));
rectBtn.addEventListener('click', () => setTool('rect'));
document.getElementById('clear')!.addEventListener('click', () => points.clearSelection());

// Choropleth: one value per country, joined on the country name.
const r = rng(77);
const index = countries.features.map((f) => ({ country: f.properties.name, score: Math.round(20 + r() * 75) }));
// Leave a few countries without data, to show the "missing" color.
const withGaps = index.filter((_, i) => i % 11 !== 0);

const choropleth = await Chart.create(document.getElementById('choropleth')!, {
  title: 'Indice de satisfaction par pays',
  subtitle: 'Choroplèthe · jointure sur le nom du pays · survol pour la valeur',
  projection: { type: 'mercator' },
  fields: { score: { label: 'Indice', format: { suffix: ' / 100' } } },
  theme: { marks: { geoshape: { missing: '#eceae4' } } },
  layers: [{ mark: 'geoshape', geo: countries, data: withGaps, encode: { key: 'country', color: 'score' } }],
  interactions: { zoom: { axes: 'xy', max: 60 } },
});

(window as any).maps = { points, choropleth, stores };
