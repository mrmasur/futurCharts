/**
 * Turns a gallery entry into a story: the chart, plus one control per style
 * option of its main mark (read from the theme defaults, so new options show up
 * on their own). Changing a control updates the chart in place, with its
 * transition.
 */
import type { StoryObj } from '@storybook/html';
import type { ArgTypes } from '@storybook/types';
import { createChart, lightTheme, type ChartSpec, type ChartView } from '@futurcharts/core';
import { entries, type Entry } from '../demo/src/library';
import themeSource from '../../packages/core/src/theme/theme.ts?raw';

/**
 * The theme's doc comments, per mark and per option: the type of `Theme['marks']`
 * is where every style option is documented, so the controls read it from there.
 */
const docs = (() => {
  const marks: Record<string, string> = {};
  const options: Record<string, Record<string, string>> = {};
  // The type (`export interface Theme`), not a comment mentioning `marks`.
  const start = themeSource.indexOf('\n  marks: {', themeSource.indexOf('export interface Theme'));
  const end = themeSource.indexOf('\n  };', start);
  const block = themeSource.slice(start, end);
  const clean = (c: string) => c.replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();
  // A mark: `/** doc */ name: {` at four spaces of indent, its body up to the matching `};`.
  const re = /(?:\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/)?\s*?\n {4}(\w+): \{([\s\S]*?)\n? {0,4}\};?/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const [, doc, name, body] = m;
    if (doc) marks[name] = clean(doc);
    const opts: Record<string, string> = {};
    const optRe = /\/\*\*([\s\S]*?)\*\/\s*(\w+)\??:/g;
    for (let o = optRe.exec(body); o; o = optRe.exec(body)) opts[o[2]] = clean(o[1]);
    options[name] = opts;
    // Options named in the mark's own comment as `name`: … get that sentence.
    for (const s of (doc ? clean(doc) : '').split(/\.\s+|;\s+/)) {
      const named = [...s.matchAll(/`(\w+)`/g)].map((x) => x[1]);
      for (const n of named) if (!opts[n] && body.includes(`${n}:`)) opts[n] = s.trim();
    }
  }
  return { marks, options };
})();

/** Options whose values come from a fixed list (the types say so; at run time, this table does). */
const ENUMS: Record<string, string[]> = {
  curve: ['linear', 'smooth', 'step'],
  orientation: ['TB', 'BT', 'LR'],
  direction: ['LR', 'TB'],
  icon: ['circle', 'square', 'diamond', 'triangle'],
  shape: ['circle', 'square', 'diamond', 'triangle'],
  variant: ['pipeline', 'boxes'],
  scale: ['width', 'area'],
};
const COLOR = /color|fill|stroke|track|rising|falling|good|bad|missing|edge|empty/i;

const themeKey = (mark: string) => (mark === 'pie' || mark === 'donut' ? 'arc' : mark);

/** The layer the controls drive: the first that is not a base map. */
const controlled = (spec: ChartSpec) => Math.max(0, spec.layers.findIndex((l) => l.mark !== 'geoshape'));

const specsOf = (e: Entry) => e.tiles ?? [e.spec!];

function find(title: string): Entry {
  const e = entries.find((x) => x.title === title);
  if (!e) throw new Error(`Pas d’exemple « ${title} » dans la galerie.`);
  return e;
}

/** A slider over a sensible range for the option; a plain number field when there is none. */
function slider(key: string, value: number) {
  if (!Number.isFinite(value)) return { type: 'number' as const };
  // Shares, opacities, radii in units of the radius: 0 to 1.
  if (value >= 0 && value <= 1 && !Number.isInteger(value)) return { type: 'range' as const, min: 0, max: 1, step: 0.01 };
  if (/opacity|innerRadius|gap$|overlap|curvature|body|thickness|width$|jitter/i.test(key) && value <= 1) return { type: 'range' as const, min: 0, max: 1, step: 0.01 };
  if (/angle/i.test(key)) return { type: 'range' as const, min: -360, max: 360, step: 5 };
  if (/duration/i.test(key)) return { type: 'range' as const, min: 100, max: 5000, step: 50 };
  const max = Math.max(10, Math.ceil(Math.abs(value) * 4));
  return { type: 'range' as const, min: value < 0 ? -max : 0, max, step: Number.isInteger(value) ? 1 : 0.1 };
}

function argTypesFor(defaults: Record<string, unknown>, category: string, mark: string): ArgTypes {
  const out: ArgTypes = {};
  for (const [key, value] of Object.entries(defaults)) {
    const table = { category, defaultValue: { summary: JSON.stringify(value) } };
    const description = docs.options[mark]?.[key];
    if (description) out[key] = { description };
    const add = (t: ArgTypes[string]) => (out[key] = { ...out[key], ...t });
    if (typeof value === 'boolean') add({ control: 'boolean', table });
    else if (typeof value === 'number') add({ control: slider(key, value), table });
    // A short list of choices: one button each.
    else if (typeof value === 'string' && ENUMS[key]) add({ control: ENUMS[key].length <= 4 ? 'inline-radio' : 'select', options: ENUMS[key], table });
    else if (typeof value === 'string' && (COLOR.test(key) || value.startsWith('#'))) add({ control: 'color', table });
    else if (typeof value === 'string') add({ control: 'text', table });
    else add({ control: 'object', table });
  }
  return out;
}

/** The spec as JSON to read: data cut to a few rows, geometry summarized. */
export function printable(spec: ChartSpec): string {
  return JSON.stringify(
    spec,
    (key, value) => {
      if (key === 'theme') return undefined;
      if (key === 'geo') return '[GeoJSON]';
      if (key === 'data' && typeof value?.getChild === 'function') return `[table Arrow : ${value.numRows} lignes, colonnes ${value.schema.fields.map((f: { name: string }) => f.name).join(', ')}]`;
      if (key === 'data' && Array.isArray(value)) return value.length > 3 ? [...value.slice(0, 3), `… ${value.length - 3} lignes de plus`] : value;
      if (ArrayBuffer.isView(value)) return `[${(value as unknown as ArrayLike<unknown>).length} valeurs]`;
      return value;
    },
    2,
  );
}

interface Mounted {
  el: HTMLElement;
  charts: ChartView[];
  pre: HTMLElement;
}
/** One chart per display area (a docs page shows the main story twice: two areas, same story). */
const mounted = new Map<HTMLElement | string, Mounted>();

/** Charts of stories no longer on the page are destroyed (the docs page shows many at once). */
function sweep(): void {
  for (const [id, m] of mounted) {
    if (m.el.isConnected) continue;
    for (const c of m.charts) c.destroy();
    mounted.delete(id);
  }
}

const CHART_ARGS = ['hauteur', 'animation', 'état', 'labelColor_', 'labelScale_', 'labelWeight_', 'labelBackground_'];

export function entryStory(title: string): StoryObj {
  const e = find(title);
  const first = specsOf(e)[0];
  const li = controlled(first);
  const layer = first.layers[li];
  const defaults = ((lightTheme.marks as unknown as Record<string, Record<string, unknown>>)[themeKey(layer.mark)] ?? {}) as Record<string, unknown>;
  const styleArgs = Object.fromEntries(
    Object.entries({ ...defaults, ...(layer.style ?? {}) }).filter(([, v]) => v === null || ['boolean', 'number', 'string'].includes(typeof v) || Array.isArray(v)),
  );
  const key = themeKey(layer.mark);
  const category = `style · ${layer.mark}`;
  const argTypes: ArgTypes = {
    ...argTypesFor(styleArgs, category, key),
    hauteur: { control: { type: 'range', min: 160, max: 900, step: 10 }, table: { category: 'graphique' }, description: 'Hauteur du graphique, px' },
    animation: { control: 'boolean', table: { category: 'graphique' }, description: 'Animations d’entrée et de transition' },
    labelColor_: { name: 'couleur', control: 'color', table: { category: 'étiquettes (layer.labels)' }, description: 'Encre de toutes les étiquettes de la marque' },
    labelScale_: { name: 'taille', control: { type: 'range', min: 0.6, max: 2, step: 0.05 }, table: { category: 'étiquettes (layer.labels)' }, description: 'Facteur de taille' },
    labelWeight_: { name: 'graisse', control: { type: 'range', min: 300, max: 900, step: 50 }, table: { category: 'étiquettes (layer.labels)' } },
    labelBackground_: { name: 'fond', control: 'color', table: { category: 'étiquettes (layer.labels)' }, description: 'Pastille derrière chaque étiquette' },
  };
  const args: Record<string, unknown> = { ...styleArgs, hauteur: e.tiles && !e.stack ? 176 : 420, animation: true };
  if (e.states) {
    argTypes['état'] = { control: 'inline-radio', options: e.states.map((s) => s.label), table: { category: 'données' }, description: 'Change les données : transition animée' };
    args['état'] = e.states[0].label;
  }

  return {
    args,
    argTypes,
    parameters: { docs: { description: { story: [e.caption, docs.marks[key] && `**${layer.mark}** : ${docs.marks[key]}`].filter(Boolean).join('\n\n') } } },
    render(a, context) {
      sweep();
      const theme = context.globals.theme === 'dark' ? 'dark' : 'light';
      const style = Object.fromEntries(Object.entries(a).filter(([k]) => !CHART_ARGS.includes(k)));
      const labels = {
        ...(a.labelColor_ ? { color: a.labelColor_ as string } : {}),
        ...(a.labelScale_ && a.labelScale_ !== 1 ? { scale: a.labelScale_ as number } : {}),
        ...(a.labelWeight_ ? { weight: a.labelWeight_ as number } : {}),
        ...(a.labelBackground_ ? { background: a.labelBackground_ as string } : {}),
      };
      const state = e.states?.find((s) => s.label === a['état']);
      const specs = specsOf(e).map((spec, i) => ({
        ...spec,
        ...(i === 0 && state ? { data: state.data } : {}),
        layers: i === 0 ? spec.layers.map((l, k) => (k === li ? { ...l, style, labels: { ...l.labels, ...labels } } : l)) : spec.layers,
        // The spec's own theme (an example's `texts`) stays under the chosen one.
        theme: spec.theme && typeof spec.theme === 'object' ? { ...spec.theme, extends: theme } : theme,
        animation: a.animation ? spec.animation : false,
      })) as ChartSpec[];
      const id = (context as { canvasElement?: HTMLElement }).canvasElement ?? context.id;
      const height = (i: number) => `${e.stack?.[i] ?? (a.hauteur as number)}px`;
      let m = mounted.get(id);
      if (m && m.el.isConnected) {
        // Same story, new controls: update in place (with a transition).
        m.charts.forEach((c, i) => c.update(specs[i]));
        m.el.querySelectorAll<HTMLElement>('.fc-story-chart').forEach((box, i) => (box.style.height = height(i)));
        m.pre.textContent = printable(specs[0]);
        return m.el;
      }
      const el = document.createElement('div');
      el.style.cssText = `display:${e.tiles && !e.stack ? 'grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px' : 'flex;flex-direction:column;gap:6px'};font-family:system-ui,sans-serif;`;
      const pre = document.createElement('pre');
      pre.style.cssText = 'margin:12px 0 0;max-height:280px;overflow:auto;font-size:11px;background:#f6f6f3;border-radius:8px;padding:10px;grid-column:1/-1;';
      pre.textContent = printable(specs[0]);
      m = { el, charts: [], pre };
      mounted.set(id, m);
      specs.forEach((spec, i) => {
        const box = document.createElement('div');
        box.className = 'fc-story-chart';
        box.style.cssText = `height:${height(i)};min-width:0;border-radius:10px;overflow:hidden;background:${theme === 'dark' ? '#1d1d1b' : '#fff'};`;
        el.appendChild(box);
        createChart(box, spec)
          .then((c) => m!.charts.push(c))
          .catch((error) => (box.textContent = String(error)));
      });
      const details = document.createElement('details');
      details.style.gridColumn = '1/-1';
      details.innerHTML = '<summary style="cursor:pointer;font-size:12px;color:#666">Spec JSON</summary>';
      details.appendChild(pre);
      el.appendChild(details);
      return el;
    },
  };
}
