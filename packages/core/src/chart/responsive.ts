/**
 * Responsive rules (`spec.responsive`): which ones match a size, and how a rule's
 * partial spec merges over the base one. Pure.
 */
import type { ChartSpec, LayerSpec } from '../spec/types';
import { deepMerge } from '../util/merge';

/**
 * A responsive rule over a spec: nested objects merged, layers merged one by one
 * (a layer may change its mark), anything else replaced.
 */
export function mergeSpec(base: ChartSpec, over: Partial<ChartSpec>): ChartSpec {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === 'layers' && Array.isArray(v)) {
      const layers = [...base.layers];
      (v as Partial<LayerSpec>[]).forEach((l, i) => {
        const b = layers[i];
        layers[i] = b ? ({ ...b, ...l, encode: { ...b.encode, ...l.encode }, style: l.style ? { ...b.style, ...l.style } : b.style } as LayerSpec) : (l as LayerSpec);
      });
      out.layers = layers;
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && out[k] && typeof out[k] === 'object' && k !== 'data') {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else out[k] = v;
  }
  return out as unknown as ChartSpec;
}

/**
 * The spec with the rules matching a `w` × `h` frame applied, in order, and a key naming
 * those rules (a resize that changes the key must rebuild the chart).
 */
export function applyResponsive(base: ChartSpec, w: number, h: number): { spec: ChartSpec; key: string } {
  const rules = base.responsive ?? [];
  const hits = rules.filter((r) => (r.maxWidth === undefined || w <= r.maxWidth) && (r.minWidth === undefined || w >= r.minWidth) && (r.maxHeight === undefined || h <= r.maxHeight) && (r.minHeight === undefined || h >= r.minHeight));
  const key = hits.map((r) => rules.indexOf(r)).join(',');
  let out: ChartSpec = base;
  for (const r of hits) out = mergeSpec(out, r.spec);
  return { spec: out, key };
}

/** Whether two specs have the same marks, layer for layer (per-layer state such as a drill-down focus then survives). */
export function sameMarks(a: ChartSpec, b: ChartSpec): boolean {
  return a.layers.length === b.layers.length && a.layers.every((l, i) => l.mark === b.layers[i].mark);
}
