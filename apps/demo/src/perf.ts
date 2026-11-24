/**
 * Performance bench: run in a visible tab of a real browser (the GPU matters: a headless browser draws
 * WebGL in software and its timings mean nothing). Open `perf.html`, click « Lancer », read the table.
 * `window.__perf` holds the results for a script.
 *
 * Measures, in this order:
 * 1. creation of every gallery example (ms, the slowest ones listed);
 * 2. redraw throughput: N charts redrawn on every frame for a few seconds (frames per second);
 * 3. large data: creation time, then frames per second while redrawing every frame, then a data update.
 */
import { createChart, type ChartSpec, type ChartView } from '@futurcharts/core';
import { entries } from './library';

interface Result {
  scenario: string;
  detail: string;
  value: number;
  unit: string;
}

const results: Result[] = [];
declare global {
  interface Window {
    __perf?: { done: boolean; results: Result[] };
  }
}
window.__perf = { done: false, results };

const stage = document.getElementById('scene')!;
const out = document.getElementById('resultats')!;
const status = document.getElementById('etat')!;

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function record(scenario: string, detail: string, value: number, unit: string) {
  results.push({ scenario, detail, value: Math.round(value * 10) / 10, unit });
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${scenario}</td><td>${detail}</td><td class="n">${(Math.round(value * 10) / 10).toLocaleString('fr-FR')}</td><td>${unit}</td>`;
  out.appendChild(tr);
}

function box(width: number, height: number): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `width:${width}px;height:${height}px;display:inline-block;vertical-align:top;`;
  stage.appendChild(el);
  return el;
}

/** Frames per second while every chart is redrawn on every frame, over `ms`. */
async function fps(charts: ChartView[], ms: number): Promise<number> {
  const redraw = () => charts.forEach((c) => (c as unknown as { requestRender(): void }).requestRender());
  await frame();
  const start = performance.now();
  let n = 0;
  while (performance.now() - start < ms) {
    redraw();
    await frame();
    n++;
  }
  return (n * 1000) / (performance.now() - start);
}

// Seeded random numbers: the same data on every run.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function scatter(n: number) {
  const r = rng(7);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const g: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = i % 4;
    x[i] = k * 3 + (r() + r() + r() - 1.5) * 2;
    y[i] = k * 2 + (r() + r() + r() - 1.5) * 3;
    g.push(`Groupe ${k + 1}`);
  }
  return { columns: { x, y, g } };
}

function lines(series: number, points: number) {
  const r = rng(3);
  const t0 = Date.UTC(2020, 0, 1);
  const date = new Float64Array(series * points);
  const value = new Float64Array(series * points);
  const name: string[] = [];
  for (let s = 0; s < series; s++) {
    let v = 100;
    for (let i = 0; i < points; i++) {
      const k = s * points + i;
      v += (r() - 0.5) * 2;
      date[k] = t0 + i * 60_000;
      value[k] = v;
      name.push(`Série ${s + 1}`);
    }
  }
  return { columns: { date, value, name } };
}

const LARGE: { name: string; detail: string; spec: () => ChartSpec; update?: () => ChartSpec }[] = [
  {
    name: 'Nuage de points',
    detail: '100 000 points, 4 groupes',
    spec: () => ({ data: scatter(100_000), layers: [{ mark: 'point', encode: { x: 'x', y: 'y', color: 'g' }, style: { size: 3, opacity: 0.5 } }], animation: false }),
    update: () => ({ data: scatter(100_000), layers: [{ mark: 'point', encode: { x: 'x', y: 'y', color: 'g' }, style: { size: 3, opacity: 0.5 } }], animation: false }),
  },
  {
    name: 'Nuage de points',
    detail: '1 000 000 points',
    spec: () => ({ data: scatter(1_000_000), layers: [{ mark: 'point', encode: { x: 'x', y: 'y' }, style: { size: 2, opacity: 0.3 } }], animation: false }),
  },
  {
    name: 'Courbes',
    detail: '1 série de 100 000 points',
    spec: () => ({ data: lines(1, 100_000), fields: { date: { type: 'time' } }, layers: [{ mark: 'line', encode: { x: 'date', y: 'value' } }], animation: false }),
  },
  {
    name: 'Courbes',
    detail: '20 séries de 10 000 points',
    spec: () => ({ data: lines(20, 10_000), fields: { date: { type: 'time' } }, layers: [{ mark: 'line', encode: { x: 'date', y: 'value', color: 'name' } }], legend: false, animation: false }),
  },
  {
    name: 'Densité hexagonale',
    detail: '500 000 points',
    spec: () => ({ data: scatter(500_000), layers: [{ mark: 'hexbin', encode: { x: 'x', y: 'y' } }], animation: false }),
  },
  {
    name: 'Carte de chaleur',
    detail: '200 × 200 cases',
    spec: () => {
      const r = rng(11);
      const rows = [];
      for (let i = 0; i < 200; i++) for (let j = 0; j < 200; j++) rows.push({ a: `L${i}`, b: `C${j}`, v: r() });
      return { data: rows, layers: [{ mark: 'heatmap', encode: { x: 'b', y: 'a', color: 'v' }, style: { labels: false } }], animation: false };
    },
  },
  {
    name: 'Barres',
    detail: '2 000 catégories',
    spec: () => {
      const r = rng(5);
      return { data: Array.from({ length: 2000 }, (_, i) => ({ k: `K${i}`, v: r() * 100 })), layers: [{ mark: 'bar', encode: { x: 'k', y: 'v' } }], animation: false };
    },
  },
  {
    name: 'Tableau',
    detail: '500 lignes, 6 colonnes',
    spec: () => {
      const r = rng(9);
      const data = Array.from({ length: 500 }, (_, i) => ({ nom: `Client ${i + 1}`, ca: r() * 1e5, evo: r() - 0.4, marge: r() * 0.4, statut: ['OK', 'À surveiller', 'Retard'][i % 3], note: Math.round(r() * 5) }));
      return {
        data,
        layers: [
          {
            mark: 'table',
            encode: {},
            style: {
              cols: [
                { field: 'nom', type: 'text' },
                { field: 'ca', type: 'bar' },
                { field: 'evo', type: 'change' },
                { field: 'marge', type: 'heat' },
                { field: 'statut', type: 'status' },
                { field: 'note', type: 'rating' },
              ],
            },
          },
        ],
        animation: false,
      } as ChartSpec;
    },
  },
];

async function run() {
  out.replaceChildren();
  results.length = 0;
  window.__perf!.done = false;

  // 1. Every gallery example, created one after the other (each destroyed before the next).
  status.textContent = 'Création des exemples de la galerie…';
  const times: { title: string; ms: number }[] = [];
  for (const e of entries) {
    stage.replaceChildren();
    const specs = e.tiles ?? [e.spec!];
    const t0 = performance.now();
    const made: ChartView[] = [];
    for (const s of specs) made.push(await createChart(box(640, 400), { ...s, animation: false }));
    await frame();
    times.push({ title: e.title, ms: performance.now() - t0 });
    made.forEach((c) => c.destroy());
  }
  times.sort((a, b) => b.ms - a.ms);
  const total = times.reduce((a, t) => a + t.ms, 0);
  const median = times[Math.floor(times.length / 2)].ms;
  record('Galerie', `${times.length} exemples : total`, total, 'ms');
  record('Galerie', 'médiane par exemple', median, 'ms');
  for (const t of times.slice(0, 8)) record('Galerie, les plus lents', t.title, t.ms, 'ms');

  // 2. Twelve charts redrawn on every frame (the measure of 2026-11-17: 60 frames per second), then 24.
  for (const n of [12, 24]) {
    status.textContent = `${n} graphiques redessinés à chaque image…`;
    stage.replaceChildren();
    const picks = entries.filter((e) => e.spec && !e.spec.facet && !e.tiles).slice(0, n);
    const charts: ChartView[] = [];
    for (const e of picks) charts.push(await createChart(box(380, 240), { ...e.spec!, animation: false }));
    await wait(300);
    record('Redessin continu', `${n} graphiques de la galerie, 380 × 240`, await fps(charts, 3000), 'images/s');
    charts.forEach((c) => c.destroy());
  }

  // 3. Large data.
  for (const s of LARGE) {
    status.textContent = `${s.name} : ${s.detail}…`;
    stage.replaceChildren();
    await frame();
    const t0 = performance.now();
    const chart = await createChart(box(900, 520), s.spec());
    await frame();
    record(s.name, `${s.detail} : création`, performance.now() - t0, 'ms');
    record(s.name, `${s.detail} : redessin continu`, await fps([chart], 2000), 'images/s');
    if (s.update) {
      const t1 = performance.now();
      (chart as unknown as { update(spec: ChartSpec): void }).update(s.update());
      await frame();
      record(s.name, `${s.detail} : mise à jour des données`, performance.now() - t1, 'ms');
    }
    chart.destroy();
  }
  stage.replaceChildren();
  status.textContent = `Terminé : ${results.length} mesures.`;
  window.__perf!.done = true;
}

document.getElementById('lancer')!.addEventListener('click', () => void run());
if (new URLSearchParams(location.search).has('auto')) void run();
