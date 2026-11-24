/**
 * Visual test page: one gallery example alone, at a fixed size, with nothing around it.
 *   visual.html?nom=<slug>&l=800&h=480&theme=dark
 * The Playwright suite (tests/visual) opens it for every entry of `library.ts` and compares a capture.
 * `window.__pret` turns true once every chart of the example is created; `window.__erreurs` lists what failed.
 */
import { createChart, type ChartSpec } from '@futurcharts/core';
import { entries } from './library';
import { slug } from './slug';

declare global {
  interface Window {
    __pret?: boolean;
    __erreurs?: string[];
    /** The charts created, for the interaction tests (tests/visual/interactions.pw.ts). */
    __graphiques?: unknown[];
  }
}

const params = new URLSearchParams(location.search);
const width = Number(params.get('l')) || 800;
const height = Number(params.get('h')) || 480;
const dark = params.get('theme') === 'dark';

const cadre = document.getElementById('cadre')!;
const errors: string[] = [];
window.__erreurs = errors;
document.body.style.background = dark ? '#1a1a19' : '#fcfcfb';

async function mount(): Promise<void> {
  const entry = entries.find((e) => slug(e.title) === params.get('nom'));
  if (!entry) {
    errors.push(`exemple inconnu : ${params.get('nom')}`);
    return;
  }
  const specs = entry.tiles ?? [entry.spec!];
  cadre.style.width = `${width}px`;
  if (entry.stack) cadre.className = 'pile';
  else if (entry.tiles) cadre.className = 'tuiles';
  for (const [i, spec] of specs.entries()) {
    const box = document.createElement('div');
    // Same rules as a gallery card: stacked charts have their own heights, tiles a fixed one,
    // small multiples take the height they need, everything else fills the frame.
    if (entry.stack) box.style.height = `${entry.stack[i] ?? 160}px`;
    else if (entry.tiles) box.style.height = '156px';
    else if (!spec.facet) box.style.height = `${height}px`;
    cadre.appendChild(box);
    const themed: ChartSpec = dark ? { ...spec, theme: 'dark' } : spec;
    try {
      (window.__graphiques ??= []).push(await createChart(box, themed));
    } catch (error) {
      errors.push(String(error));
    }
  }
}

mount().finally(() => {
  window.__pret = true;
});
