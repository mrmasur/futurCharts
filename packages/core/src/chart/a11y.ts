/**
 * Accessibility. Everything is drawn on canvas, so a screen reader would read nothing: the chart root
 * is a `figure` whose name says what the chart shows (title, subtitle, then the spec's `description`
 * or a generated summary), with a visually hidden data table inside, and the plot is a focusable
 * zone whose arrow keys walk through the datums (`HitData`), announced through a live region.
 *
 * The summary, the table and the walking order are pure functions of the built layers
 * (tested in test/a11y.test.ts); the DOM helpers at the end are the only part that touches the page.
 */
import type { Table } from '../data/table';
import type { Scale } from '../scale/scales';
import type { ChartSpec, LayerSpec } from '../spec/types';
import { numberFormatter } from '../util/format';
import type { Built, HoverItem, Picked } from './types';

/** Rows of the hidden table; the rest is counted ("+ 120 lignes"). */
export const MAX_ROWS = 50;
/** Beyond this many datums, categories are not counted and the table lists datums instead of pivoting them. */
const COUNT_CAP = 200_000;

/** What a chart kind is called, by mark (French: the library formats in the reader's language, the texts are French). */
const NAMES: Record<string, string> = {
  bar: 'Barres',
  line: 'Lignes',
  area: 'Aires',
  point: 'Nuage de points',
  tick: 'Traits',
  rule: 'Règles',
  pie: 'Secteurs',
  donut: 'Anneau',
  treemap: 'Carte proportionnelle',
  sunburst: 'Rayons de soleil',
  icicle: 'Stalactites',
  pack: 'Cercles imbriqués',
  tree: 'Arbre',
  indentedTree: 'Arbre indenté',
  decomposition: 'Arbre de décomposition',
  sankey: 'Diagramme de Sankey',
  chord: 'Diagramme en cordes',
  bundle: 'Faisceaux de liens',
  network: 'Réseau',
  arcDiagram: 'Diagramme en arcs',
  flow: 'Diagramme de flux',
  parsets: 'Ensembles parallèles',
  heatmap: 'Carte de chaleur',
  calendar: 'Calendrier',
  calendarMonth: 'Calendrier du mois',
  geoshape: 'Carte',
  mapPie: 'Carte à secteurs',
  mapBars: 'Carte à barres',
  tilemap: 'Carte en tuiles',
  dorling: 'Cartogramme de Dorling',
  globe: 'Globe',
  route: 'Itinéraires',
  candlestick: 'Chandeliers',
  renko: 'Renko',
  kagi: 'Kagi',
  kpi: 'Indicateur',
  gauge: 'Jauge',
  bullet: 'Graphique à puces',
  liquid: 'Jauge liquide',
  led: 'Afficheur',
  activity: 'Anneaux d’activité',
  table: 'Tableau',
  sparktable: 'Tableau de tendances',
  pivot: 'Tableau croisé',
  gantt: 'Diagramme de Gantt',
  schedule: 'Planning',
  swimlane: 'Couloirs',
  timeline: 'Frise chronologique',
  race: 'Course de barres',
  motion: 'Bulles animées',
  funnel: 'Entonnoir',
  funnelCompare: 'Entonnoirs comparés',
  pyramid: 'Pyramide',
  waffle: 'Gaufre',
  pictorial: 'Pictogrammes',
  parliament: 'Hémicycle',
  radar: 'Radar',
  rose: 'Rose des vents',
  radialBar: 'Barres radiales',
  radialArea: 'Aire polaire',
  polarLine: 'Lignes polaires',
  polarScatter: 'Nuage polaire',
  polarHeatmap: 'Carte de chaleur polaire',
  spiral: 'Spirale',
  violin: 'Violons',
  raincloud: 'Nuages de pluie',
  beeswarm: 'Essaim',
  dotplot: 'Diagramme en points',
  ridgeline: 'Crêtes',
  hexbin: 'Hexagones',
  contour: 'Courbes de niveau',
  ecdf: 'Fonction de répartition',
  qq: 'Diagramme quantile-quantile',
  splom: 'Matrice de nuages',
  scatter3d: 'Nuage en 3D',
  surface: 'Surface',
  venn: 'Diagramme de Venn',
  upset: 'Intersections (UpSet)',
  matrix: 'Matrice',
  confusion: 'Matrice de confusion',
  cohort: 'Cohortes',
  wordcloud: 'Nuage de mots',
  voronoi: 'Diagramme de Voronoï',
  marimekko: 'Marimekko',
  variwide: 'Barres de largeur variable',
  bridge: 'Cascade',
  variance: 'Écarts',
  tornado: 'Tornade',
  likert: 'Échelle de Likert',
  difference: 'Écart entre deux courbes',
  fan: 'Éventail',
  horizon: 'Horizon',
  spike: 'Pointes',
  quadrant: 'Quadrants',
  parallel: 'Coordonnées parallèles',
  connected: 'Nuage connecté',
  bumpArea: 'Classement en aires',
  barRank: 'Classement',
  barInBar: 'Barres dans les barres',
  periodBars: 'Barres par période',
  bubbles: 'Bulles',
  marginal: 'Nuage et distributions',
  vector: 'Vecteurs',
  cycle: 'Cycle',
};

/** French name of a mark; unknown marks (registered by an app) read as "Graphique". */
export function markName(mark: string): string {
  return NAMES[mark] ?? 'Graphique';
}

/** "Barres", "Barres et lignes", "Barres, lignes et nuage de points". */
export function chartKind(marks: string[]): string {
  const names = [...new Set(marks.map(markName))];
  if (names.length === 0) return 'Graphique';
  const lower = (s: string) => s[0].toLowerCase() + s.slice(1);
  if (names.length === 1) return names[0];
  return `${[names[0], ...names.slice(1, -1).map(lower)].join(', ')} et ${lower(names[names.length - 1])}`;
}

/** What the module reads from a chart. */
export interface A11yInput {
  spec: ChartSpec;
  built: Built[];
  /** Category scale: formats x. */
  cat: Scale;
  horizontal: boolean;
  mode: 'x' | 'nearest';
  /** The chart's own description of datums (same labels and formats as the tooltip). */
  describe: (picked: Picked[]) => HoverItem[];
}

export interface A11yTable {
  caption: string;
  head: string[];
  rows: string[][];
  /** Rows left out. */
  more: number;
}

const label = (spec: ChartSpec, field: string | undefined) => (field ? (spec.fields?.[field]?.label ?? field) : '');
const trimEnd = (s: string) => s.trim().replace(/[\s.:;,]+$/, '');

/** The figure's name: title, subtitle, then the spec's `description` or the generated summary. */
export function chartLabel(spec: Pick<ChartSpec, 'title' | 'subtitle' | 'description'>, summary: string): string {
  return [spec.title, spec.subtitle, spec.description ?? summary]
    .filter((s): s is string => !!s && !!s.trim())
    .map(trimEnd)
    .join('. ');
}

/** Layers that carry data (annotation layers have index -1). */
const dataLayers = (built: Built[]) => built.filter((b) => b.data.index >= 0);

/** Field read as the value of a cartesian layer, and its category field. */
function fieldsOf(layer: LayerSpec, horizontal: boolean): { cat?: string; val?: string } {
  const e = layer.encode;
  return horizontal ? { cat: e.y, val: e.x } : { cat: e.x, val: e.y };
}

/** Generated summary: kind, series, categories (or points and x range), then value range with where the extremes are. */
export function chartSummary(o: A11yInput): string {
  const layers = dataLayers(o.built);
  const kind = chartKind(layers.map((b) => b.data.layer.mark));
  const withHits = layers.filter((b) => b.mark.hit.n > 0);
  if (withHits.length === 0) {
    const standalone = layers.find((b) => b.def.standalone);
    return standalone ? standaloneSummary(kind, standalone, o.spec) : `${kind}, aucune donnée affichée`;
  }
  const parts = [kind];
  const series: string[] = [];
  for (const b of withHits) for (const s of b.data.series) if (!s.hidden && s.x.length && !series.includes(s.key)) series.push(s.key);
  const multi = series.length > 1;
  if (multi) parts.push(`${series.length} séries (${listOf(series, 5)})`);

  const n = withHits.reduce((sum, b) => sum + b.mark.hit.n, 0);
  const band = o.cat.type === 'band';
  if (band) {
    const count = n <= COUNT_CAP ? distinctX(withHits).length : undefined;
    parts.push(count !== undefined ? plural(count, 'catégorie') : plural(n, 'point'));
  } else {
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of withHits) for (const x of b.mark.hit.x) if (Number.isFinite(x)) [lo, hi] = [Math.min(lo, x), Math.max(hi, x)];
    const xName = label(o.spec, fieldsOf(withHits[0].data.layer, o.horizontal).cat);
    parts.push(plural(n, 'point'));
    if (lo <= hi) parts.push(`${xName ? `${xName} ` : ''}de ${o.cat.format(lo)} à ${o.cat.format(hi)}`);
  }

  // Extremes, per measure: a dual-axis chart (euros and a percentage) never mixes them.
  const groups = new Map<string, Built[]>();
  for (const b of withHits) {
    const f = fieldsOf(b.data.layer, o.horizontal).val ?? '';
    groups.set(f, [...(groups.get(f) ?? []), b]);
  }
  for (const [field, bs] of groups) {
    const ext = extremes(o.built, bs);
    if (!ext) continue;
    const [min, max] = o.describe([ext.min, ext.max]);
    const at = (it: HoverItem) => (multi ? `${it.xLabel}, ${it.series}` : it.xLabel);
    const name = groups.size > 1 || !band ? `${label(o.spec, field)} ` : '';
    parts.push(`${name}de ${min.valueLabel} (${at(min)}) à ${max.valueLabel} (${at(max)})`);
  }
  return parts.join(', ');
}

function standaloneSummary(kind: string, b: Built, spec: ChartSpec): string {
  const graph = b.data.layer.graph;
  if (graph && Array.isArray(graph.nodes)) {
    return `${kind}, ${plural(graph.nodes.length, 'étape')}, ${plural(Array.isArray(graph.edges) ? graph.edges.length : 0, 'lien')}`;
  }
  const t = b.data.table;
  if (t.length === 0) return `${kind}, aucune donnée affichée`;
  const parts = [kind, plural(t.length, 'élément')];
  const { key, value } = standaloneFields(b.data.layer, t);
  if (value) {
    const vals = t.column(value).values as Float64Array;
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < t.length; i++) {
      if (!Number.isFinite(vals[i])) continue;
      if (lo < 0 || vals[i] < vals[lo]) lo = i;
      if (hi < 0 || vals[i] > vals[hi]) hi = i;
    }
    if (lo >= 0) {
      const fmt = numberFormatter(spec.fields?.[value]?.format);
      const at = (i: number) => (key ? ` (${cell(t, key, i, spec)})` : '');
      parts.push(`${label(spec, value)} de ${fmt(vals[lo])}${at(lo)} à ${fmt(vals[hi])}${at(hi)}`);
    }
  }
  return parts.join(', ');
}

/** For a mark without x / y: the field naming each item and the numeric field measuring it, when the table has them. */
function standaloneFields(layer: LayerSpec, t: Table): { key?: string; value?: string } {
  const e = layer.encode;
  const has = (f?: string) => !!f && t.has(f);
  const key = [e.key, e.path?.[e.path.length - 1], e.x, e.source].find((f) => has(f) && t.column(f!).type === 'string');
  const value = [e.value, e.y, e.size, e.x].find((f) => has(f) && t.column(f!).type === 'number');
  return { key, value };
}

/** The datums holding the smallest and largest value among some layers. */
function extremes(built: Built[], layers: Built[]): { min: Picked; max: Picked } | undefined {
  let min: Picked | undefined;
  let max: Picked | undefined;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of layers) {
    const layer = built.indexOf(b);
    const v = b.mark.hit.value;
    for (let i = 0; i < b.mark.hit.n; i++) {
      if (!Number.isFinite(v[i])) continue;
      if (v[i] < lo) [lo, min] = [v[i], { layer, index: i }];
      if (v[i] > hi) [hi, max] = [v[i], { layer, index: i }];
    }
  }
  return min && max ? { min, max } : undefined;
}

/** Distinct x of the layers, ascending. */
function distinctX(layers: Built[]): number[] {
  // A typed array sorts numbers natively, without a comparator: much faster on long series.
  const all = new Float64Array(layers.reduce((n, b) => n + b.mark.hit.n, 0));
  let k = 0;
  for (const b of layers) all.set(b.mark.hit.x.subarray(0, b.mark.hit.n), (k += b.mark.hit.n) - b.mark.hit.n);
  all.sort();
  const out: number[] = [];
  for (let i = 0; i < all.length; i++) if (i === 0 || all[i] !== all[i - 1]) out.push(all[i]);
  return out;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString('fr-FR')} ${word}${n > 1 ? 's' : ''}`;
}

function listOf(items: string[], max: number): string {
  return items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')}…`;
}

function cell(t: Table, field: string, i: number, spec: ChartSpec): string {
  const c = t.column(field);
  const v = c.values[i];
  if (c.type === 'string') return String(v ?? '');
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  if (c.type === 'time') return new Date(v).toLocaleDateString();
  return numberFormatter(spec.fields?.[field]?.format)(v);
}

/**
 * The data as the chart shows it. Datums along a category axis (mode `x`): one row per category,
 * one column per series. Scattered datums (mode `nearest`): one row per datum. Marks without x / y
 * (pie, treemap…): the rows of the layer's table, one column per encoded field. Null when there
 * is no table to give (a diagram drawn from `graph`, a map of shapes with no data).
 */
export function dataTable(o: A11yInput, max = MAX_ROWS): A11yTable | null {
  const layers = dataLayers(o.built);
  const withHits = layers.filter((b) => b.mark.hit.n > 0);
  const caption = o.spec.title?.trim() || 'Données du graphique';
  if (withHits.length === 0) {
    const standalone = layers.find((b) => b.def.standalone);
    return standalone ? standaloneTable(standalone, o.spec, caption, max) : null;
  }
  const n = withHits.reduce((sum, b) => sum + b.mark.hit.n, 0);
  const ref = fieldsOf(withHits[0].data.layer, o.horizontal);
  const catName = label(o.spec, ref.cat) || 'x';

  if (o.mode === 'x' && n <= COUNT_CAP) {
    const xs = distinctX(withHits);
    const kept = xs.slice(0, max);
    const rowOf = new Map(kept.map((x, i) => [x, i]));
    const columns: string[] = [];
    const picked: Picked[] = [];
    const at: [number, number][] = [];
    for (const b of withHits) {
      const layer = o.built.indexOf(b);
      const h = b.mark.hit;
      for (let i = 0; i < h.n; i++) {
        const r = rowOf.get(h.x[i]);
        if (r === undefined) continue;
        const key = b.data.series[h.series[i]]?.key ?? '';
        let c = columns.indexOf(key);
        if (c < 0) c = columns.push(key) - 1;
        picked.push({ layer, index: i });
        at.push([r, c]);
      }
    }
    const items = o.describe(picked);
    const rows = kept.map((x) => [o.cat.format(x), ...columns.map(() => '')]);
    items.forEach((it, k) => {
      const [r, c] = at[k];
      // A series drawn by several layers (a line and its points) fills its cell once.
      if (!rows[r][c + 1]) rows[r][c + 1] = it.valueLabel;
    });
    // A single series is named after its measure (no color split): its column says what the value is.
    const head = [catName, ...columns];
    return { caption, head, rows, more: xs.length - kept.length };
  }

  // One row per datum.
  const picked: Picked[] = [];
  for (const b of withHits) {
    const layer = o.built.indexOf(b);
    for (let i = 0; i < b.mark.hit.n && picked.length < max; i++) picked.push({ layer, index: i });
  }
  const items = o.describe(picked);
  const multi = new Set(withHits.flatMap((b) => b.data.series.map((s) => s.key))).size > 1;
  const valName = label(o.spec, ref.val) || 'valeur';
  const head = multi ? ['Série', catName, valName] : [catName, valName];
  const rows = items.map((it) => (multi ? [it.series, it.xLabel, it.valueLabel] : [it.xLabel, it.valueLabel]));
  return { caption, head, rows, more: n - rows.length };
}

function standaloneTable(b: Built, spec: ChartSpec, caption: string, max: number): A11yTable | null {
  const t = b.data.table;
  const e = b.data.layer.encode;
  const fields: string[] = [];
  for (const v of Object.values(e)) {
    for (const f of Array.isArray(v) ? v : [v]) if (typeof f === 'string' && t.has(f) && !fields.includes(f)) fields.push(f);
  }
  if (fields.length === 0 || t.length === 0) return null;
  const count = Math.min(max, t.length);
  const rows: string[][] = [];
  for (let i = 0; i < count; i++) rows.push(fields.map((f) => cell(t, f, i, spec)));
  return { caption, head: fields.map((f) => label(spec, f)), rows, more: t.length - count };
}

// ------------------------------------------------------------------ keyboard

/** The datums of one series, in the order of their x (left to right, top to bottom on a horizontal chart). */
export interface NavGroup {
  key: string;
  points: Picked[];
  /** x of each point, to land on the closest one when changing series. */
  x: number[];
}

/** Position of the keyboard in the groups. */
export interface NavPos {
  g: number;
  i: number;
}

/**
 * Walking order: one group per series (a series drawn by several layers, a line and its
 * points, is one group), each sorted by x, a datum repeated at the same x and value kept once.
 */
export function navGroups(built: Built[]): NavGroup[] {
  const byKey = new Map<string, { layer: number; index: number; x: number; v: number }[]>();
  built.forEach((b, layer) => {
    if (b.data.index < 0) return;
    const h = b.mark.hit;
    for (let i = 0; i < h.n; i++) {
      const key = b.data.series[h.series[i]]?.key ?? `#${layer}`;
      let list = byKey.get(key);
      if (!list) byKey.set(key, (list = []));
      list.push({ layer, index: i, x: h.x[i], v: h.value[i] });
    }
  });
  const out: NavGroup[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.x - b.x || a.layer - b.layer || a.index - b.index);
    const kept = list.filter((p, k) => k === 0 || p.x !== list[k - 1].x || p.v !== list[k - 1].v);
    out.push({ key, points: kept.map((p) => ({ layer: p.layer, index: p.index })), x: kept.map((p) => p.x) });
  }
  return out;
}

/** Keys the plot answers to while focused. */
export const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

/**
 * Where a key leads. Left / right: previous / next datum of the series; Home / End: first / last;
 * up / down: previous / next series, on its datum closest in x. The first key lands on the first datum
 * (End: the last). Undefined when there is nothing to walk.
 */
export function navMove(groups: NavGroup[], pos: NavPos | undefined, key: string): NavPos | undefined {
  const nonEmpty = groups.some((g) => g.points.length > 0);
  if (!nonEmpty) return undefined;
  if (!pos) {
    const g = groups.findIndex((gr) => gr.points.length > 0);
    return { g, i: key === 'End' ? groups[g].points.length - 1 : 0 };
  }
  const cur = groups[pos.g];
  switch (key) {
    case 'ArrowRight':
      return { g: pos.g, i: Math.min(cur.points.length - 1, pos.i + 1) };
    case 'ArrowLeft':
      return { g: pos.g, i: Math.max(0, pos.i - 1) };
    case 'Home':
      return { g: pos.g, i: 0 };
    case 'End':
      return { g: pos.g, i: cur.points.length - 1 };
    case 'ArrowUp':
    case 'ArrowDown': {
      const step = key === 'ArrowDown' ? 1 : -1;
      let g = pos.g + step;
      while (g >= 0 && g < groups.length && groups[g].points.length === 0) g += step;
      if (g < 0 || g >= groups.length) return pos;
      const x = cur.x[pos.i];
      const xs = groups[g].x;
      let best = 0;
      for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - x) < Math.abs(xs[best] - x)) best = k;
      return { g, i: best };
    }
  }
  return pos;
}

/** What the live region says of the datum reached: "Atlas : 4 276 k€, 1 sur 6" (series first when there are several). */
export function announce(item: HoverItem, position: number, total: number, multi: boolean): string {
  const what = multi ? `${item.series}, ${item.xLabel}` : item.xLabel;
  return `${what} : ${item.valueLabel}, ${position} sur ${total}`;
}

/** Name of small multiples: title, subtitle, then the spec's `description` or "Petits multiples, 4 panneaux par Région". */
export function facetLabel(spec: ChartSpec, panels: number): string {
  const by = spec.facet ? label(spec, spec.facet.field) : '';
  const count = `${panels} panneau${panels > 1 ? 'x' : ''}`;
  return chartLabel(spec, `Petits multiples, ${count}${by ? ` par ${by}` : ''}`);
}

// ----------------------------------------------------------------------- DOM

/** Present for assistive technologies, invisible on screen (never `display: none`, which hides it from them too). */
export const VISUALLY_HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';

/** The chart's accessibility elements: the focusable plot zone, the live region and the hidden table's box. */
export interface A11yDom {
  focus: HTMLDivElement;
  live: HTMLDivElement;
  table: HTMLDivElement;
}

/** Make the root a figure and add its accessibility elements. */
export function createA11yDom(root: HTMLElement): A11yDom {
  root.setAttribute('role', 'figure');
  const focus = document.createElement('div');
  // Over the plot, transparent, letting the pointer through: only its focus ring ever shows.
  focus.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;';
  focus.setAttribute('role', 'application');
  focus.setAttribute('aria-roledescription', 'zone de tracé');
  const live = document.createElement('div');
  live.style.cssText = VISUALLY_HIDDEN;
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const table = document.createElement('div');
  table.style.cssText = VISUALLY_HIDDEN;
  root.append(focus, live, table);
  return { focus, live, table };
}

/** Put the focusable zone over the plot (style written only when it moved). */
export function placeFocus(el: HTMLElement, plot: { x: number; y: number; width: number; height: number }): void {
  const css = `${Math.round(plot.x)}px ${Math.round(plot.y)}px ${Math.round(plot.width)}px ${Math.round(plot.height)}px`;
  if (el.dataset.at === css) return;
  el.dataset.at = css;
  Object.assign(el.style, { left: `${Math.round(plot.x)}px`, top: `${Math.round(plot.y)}px`, width: `${Math.round(plot.width)}px`, height: `${Math.round(plot.height)}px` });
}

/** Turn the keyboard walk on or off: a zone with nothing to walk (or `interactions.keyboard: false`) is not a tab stop. */
export function setFocusable(el: HTMLElement, on: boolean, title: string | undefined): void {
  if (on) {
    el.tabIndex = 0;
    el.setAttribute('aria-label', `${title ? `${trimEnd(title)} : ` : ''}flèches gauche et droite pour parcourir les données, haut et bas pour changer de série, Entrée pour sélectionner, Échap pour quitter`);
    el.removeAttribute('aria-hidden');
  } else {
    el.removeAttribute('tabindex');
    el.removeAttribute('aria-label');
    el.setAttribute('aria-hidden', 'true');
    if (document.activeElement === el) el.blur();
  }
}

/** Fill the hidden box with the data table (or empty it). */
export function renderTable(box: HTMLElement, t: A11yTable | null): void {
  if (!t) {
    box.replaceChildren();
    return;
  }
  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = t.caption;
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of t.head) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const r of t.rows) {
    const tr = document.createElement('tr');
    r.forEach((v, c) => {
      const td = document.createElement(c === 0 ? 'th' : 'td');
      if (c === 0) (td as HTMLTableCellElement).scope = 'row';
      td.textContent = v;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.append(caption, thead, tbody);
  box.replaceChildren(table);
  if (t.more > 0) {
    const p = document.createElement('p');
    p.textContent = `+ ${plural(t.more, 'ligne')}`;
    box.appendChild(p);
  }
}
