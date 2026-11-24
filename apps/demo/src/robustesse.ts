/**
 * Robustness test page (tests/visual/robustesse.pw.ts): every gallery example, mounted again with hostile
 * data (nothing, one row, holes, negatives, huge numbers, endless labels…), at hostile sizes, and updated
 * from one to the other. The test only asks that nothing throws and nothing is logged as an error:
 * an app fed by a database gets such data sooner or later.
 *   window.__robustesse(nom, variante) → the errors caught while mounting, updating and destroying.
 */
import { createChart, type ChartSpec, type FlowGraph, type LayerSpec } from '@futurcharts/core';
import { entries } from './library';
import { slug } from './slug';

type Row = Record<string, unknown>;

/** Every way the data can go wrong, applied to each data source of a spec. */
export const DATA_VARIANTS = ['vide', 'une-ligne', 'trous', 'nan', 'negatifs', 'enormes', 'zeros', 'libelles-longs', 'doublons'] as const;
/** Sizes and life cycles that go wrong. */
export const LIFE_VARIANTS = ['minuscule', 'taille-nulle', 'redimensionne', 'vide-puis-plein', 'detruit-tot'] as const;
export const VARIANTS = [...DATA_VARIANTS, ...LIFE_VARIANTS] as const;
export type Variant = (typeof VARIANTS)[number];

declare global {
  interface Window {
    __robustesse?: (nom: string, variante: Variant) => Promise<string[]>;
    __exemples?: string[];
    __variantes?: string[];
  }
}

const LONG = ' — libellé démesuré qui ne tiendra nulle part, ni dans une barre, ni dans une légende, ni dans un axe';

/** Rows of a data source, whatever its shape (rows, columns); `undefined` when it is something else. */
function rowsOf(data: unknown): Row[] | undefined {
  if (Array.isArray(data)) return data as Row[];
  const columns = (data as { columns?: Record<string, ArrayLike<unknown>> } | undefined)?.columns;
  if (!columns) return undefined;
  const names = Object.keys(columns);
  const n = names.length ? columns[names[0]].length : 0;
  return Array.from({ length: n }, (_, i) => Object.fromEntries(names.map((k) => [k, columns[k][i]])));
}

/** A number that is a date in disguise (epoch ms) is left alone: negating it would only move the dates. */
const isMeasure = (v: unknown): v is number => typeof v === 'number' && Math.abs(v) < 1e11;

function mutateRows(rows: Row[], variant: Variant): Row[] {
  switch (variant) {
    case 'vide':
      return [];
    case 'une-ligne':
      return rows.slice(0, 1);
    case 'doublons':
      return [...rows, ...rows];
    default:
      return rows.map((row, i) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(row)) {
          if (variant === 'trous') out[k] = i % 3 === 1 ? null : v;
          else if (variant === 'nan') out[k] = isMeasure(v) && i % 4 === 2 ? Number.NaN : v;
          else if (variant === 'negatifs') out[k] = isMeasure(v) ? -v : v;
          else if (variant === 'enormes') out[k] = isMeasure(v) ? v * 1e9 : v;
          else if (variant === 'zeros') out[k] = isMeasure(v) ? 0 : v;
          else if (variant === 'libelles-longs') out[k] = typeof v === 'string' && !/^\d{4}-\d\d/.test(v) ? v + LONG : v;
          else out[k] = v;
        }
        return out;
      });
  }
}

function mutateGraph(graph: FlowGraph, variant: Variant): FlowGraph {
  switch (variant) {
    case 'vide':
      return { nodes: [], edges: [] };
    case 'une-ligne':
      return { nodes: graph.nodes.slice(0, 1), edges: [] };
    case 'trous':
      // Edges to nodes that do not exist, and a node looping on itself.
      return { nodes: graph.nodes, edges: [...graph.edges, { from: 'inconnu', to: graph.nodes[0]?.id ?? 'x' }, { from: graph.nodes[0]?.id ?? 'x', to: graph.nodes[0]?.id ?? 'x' }] };
    case 'libelles-longs':
      return { nodes: graph.nodes.map((n) => ({ ...n, label: (n.label ?? n.id) + LONG })), edges: graph.edges.map((e) => ({ ...e, label: e.label ? e.label + LONG : e.label })) };
    case 'doublons':
      return { nodes: [...graph.nodes, ...graph.nodes], edges: [...graph.edges, ...graph.edges] };
    case 'enormes':
    case 'negatifs':
    case 'zeros': {
      const f = (v: number | undefined) => (v === undefined ? v : variant === 'enormes' ? v * 1e9 : variant === 'zeros' ? 0 : -v);
      return { nodes: graph.nodes.map((n) => ({ ...n, value: f(n.value) })), edges: graph.edges.map((e) => ({ ...e, value: f(e.value) })) };
    }
    default:
      return graph;
  }
}

function mutateLayer(layer: LayerSpec, variant: Variant): LayerSpec {
  const out: LayerSpec = { ...layer };
  const rows = rowsOf(layer.data);
  if (rows) out.data = mutateRows(rows, variant) as LayerSpec['data'];
  if (layer.graph) out.graph = mutateGraph(layer.graph, variant);
  return out;
}

function mutateSpec(spec: ChartSpec, variant: Variant): ChartSpec {
  const rows = rowsOf(spec.data);
  return {
    ...spec,
    data: rows ? (mutateRows(rows, variant) as ChartSpec['data']) : spec.data,
    layers: spec.layers.map((l) => mutateLayer(l, variant)),
    // Responsive rules may bring their own layers and data: mutate them too.
    responsive: spec.responsive?.map((r) => ({ ...r, spec: { ...r.spec, layers: r.spec.layers?.map((l) => mutateLayer(l as LayerSpec, variant)) } })),
  };
}

const frames = (n: number) => new Promise<void>((resolve) => {
  const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
  step(n);
});

const cadre = document.getElementById('cadre')!;

async function run(nom: string, variant: Variant): Promise<string[]> {
  const errors: string[] = [];
  const entry = entries.find((e) => slug(e.title) === nom);
  if (!entry) return [`exemple inconnu : ${nom}`];
  const specs = entry.tiles ?? [entry.spec!];
  const data = (DATA_VARIANTS as readonly string[]).includes(variant);
  const size: [number, number] = variant === 'minuscule' ? [60, 40] : variant === 'taille-nulle' ? [0, 0] : [640, 400];
  cadre.replaceChildren();
  for (const spec of specs) {
    const box = document.createElement('div');
    box.style.cssText = `width:${size[0]}px;height:${size[1]}px;overflow:hidden;`;
    cadre.appendChild(box);
    try {
      const first = data ? mutateSpec(spec, variant) : variant === 'vide-puis-plein' ? mutateSpec(spec, 'vide') : spec;
      const chart = await createChart(box, first);
      if (variant === 'detruit-tot') {
        chart.destroy();
        continue;
      }
      await frames(3);
      if (variant === 'redimensionne') {
        for (const [w, h] of [[30, 20], [1200, 700], [0, 0], [343, 260]]) {
          box.style.width = `${w}px`;
          box.style.height = `${h}px`;
          await frames(3);
        }
      }
      if (variant === 'vide-puis-plein') {
        // Empty, then the real data, then empty again: transitions from and to nothing.
        chart.update(spec);
        await frames(3);
        chart.update(mutateSpec(spec, 'vide'));
        await frames(3);
      }
      chart.destroy();
    } catch (error) {
      errors.push(`${(error as Error)?.stack ?? String(error)}`.split('\n').slice(0, 4).join('\n'));
    }
  }
  return errors;
}

window.__robustesse = run;
window.__exemples = entries.map((e) => slug(e.title));
window.__variantes = [...VARIANTS];
