/**
 * `layer.highlight` and `layer.overrides` compiled into a per-row style lookup. Pure.
 */
import type { Table } from '../data/table';
import type { LayerSpec, StyleOverride } from '../spec/types';

/** The field a `highlight` targets when it names none. */
export function highlightField(layer: LayerSpec, horizontal: boolean): string | undefined {
  const e = layer.encode;
  return e.key ?? e.path?.[0] ?? e.source ?? (horizontal ? e.y : e.x) ?? e.color;
}

/** Compile `layer.highlight` and `layer.overrides` into a per-row style lookup. */
export function compileOverrides(layer: LayerSpec, table: Table, horizontal: boolean): ((row: number) => StyleOverride['style'] | undefined) | undefined {
  const rulesIn: StyleOverride[] = [];
  const h = layer.highlight;
  const field = h ? (h.field ?? highlightField(layer, horizontal)) : undefined;
  if (h && field && table.has(field)) {
    rulesIn.push({ when: { field, in: h.values }, style: h.color ? { color: h.color } : {} });
    if ((h.dim ?? 0.25) < 1) rulesIn.push({ when: { field, notIn: h.values }, style: { opacity: h.dim ?? 0.25 } });
  }
  rulesIn.push(...(layer.overrides ?? []));
  if (!rulesIn.length) return undefined;
  const rules = rulesIn.map((o) => {
    const conds = (Array.isArray(o.when) ? o.when : [o.when]).map((p) => {
      const values = table.column(p.field).values;
      const set = p.in ? new Set(p.in.map(String)) : undefined;
      return (row: number) => {
        const v = values[row];
        if (p.equals !== undefined && String(v) !== String(p.equals)) return false;
        if (set && !set.has(String(v))) return false;
        if (p.notIn && p.notIn.map(String).includes(String(v))) return false;
        const n = typeof v === 'number' ? v : Number(v);
        if (p.gt !== undefined && !(n > p.gt)) return false;
        if (p.gte !== undefined && !(n >= p.gte)) return false;
        if (p.lt !== undefined && !(n < p.lt)) return false;
        if (p.lte !== undefined && !(n <= p.lte)) return false;
        return true;
      };
    });
    return { test: (row: number) => conds.every((c) => c(row)), style: o.style };
  });
  return (row) => rules.find((r) => r.test(row))?.style;
}
