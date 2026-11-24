/**
 * Colors of a chart: theme tokens resolved in the spec, then colors fixed by entity, never
 * by rank, so a filter does not repaint the survivors. An entity with an explicit color
 * (`scales.color.colors`, `layer.series`) takes no palette slot; every entity given a
 * color is listed (legend order).
 */
import type { LayerData, SeriesData } from '../marks/prepare';
import type { RGBA } from '../render/types';
import type { ChartSpec } from '../spec/types';
import { resolveThemeColors, type Theme } from '../theme/theme';
import { parseColor } from '../util/color';

export interface ChartColors {
  /** Every entity given a color, in the order met: the legend's order. Filled as colors are asked for. */
  known: Set<string>;
  /** The categorical color of an entity (its slot in the palette, or its explicit color). */
  categorical: (key: string) => RGBA;
  /** The color of a series: its own (`layer.series`), the layer's, else categorical. */
  seriesColor: (data: LayerData, s: SeriesData) => RGBA;
  /** The theme's sequential ramp. */
  ramp: RGBA[];
}

/** The spec with its theme color tokens (`$ink`, `$grid`, `$1`…) resolved against `theme`. */
export function resolveSpecColors(spec: ChartSpec, theme: Theme): ChartSpec {
  return {
    ...spec,
    layers: spec.layers.map((l) => ({
      ...l,
      style: resolveThemeColors(theme, l.style),
      overrides: resolveThemeColors(theme, l.overrides),
      highlight: resolveThemeColors(theme, l.highlight),
      series: resolveThemeColors(theme, l.series),
      labels: resolveThemeColors(theme, l.labels),
    })),
    scales: spec.scales && { ...spec.scales, color: resolveThemeColors(theme, spec.scales.color) },
  };
}

/** Color slots for a spec (theme tokens resolved) and its prepared layers. */
export function chartColors(spec: ChartSpec, theme: Theme, layers: { data: LayerData }[]): ChartColors {
  const slots = new Map<string, number>();
  // Legend order: every entity given a color, in the order met. An entity with an explicit color
  // (`scales.color.colors`) takes no palette slot (the others keep theirs) but is listed all the same.
  const known = new Set<string>();
  for (const key of spec.scales?.color?.domain ?? []) {
    slots.set(key, slots.size);
    known.add(key);
  }
  for (const { data } of layers) {
    if (data.colorMode !== 'series') continue;
    for (const s of data.series) {
      if (!slots.has(s.key)) slots.set(s.key, slots.size);
      known.add(s.key);
    }
  }
  const palette = theme.palette.categorical.map(parseColor);
  const ramp = theme.palette.sequential.map(parseColor);
  const explicit: Record<string, string> = { ...(spec.scales?.color?.colors ?? {}) };
  const categorical = (key: string): RGBA => {
    known.add(key);
    if (explicit[key]) return parseColor(explicit[key]);
    if (!slots.has(key)) slots.set(key, slots.size);
    return palette[slots.get(key)! % palette.length];
  };
  // A color set by name (`layer.series`) wins over the layer's color and the palette.
  for (const l of spec.layers) for (const [k, v] of Object.entries(l.series ?? {})) if (v.color && !explicit[k]) explicit[k] = v.color;
  const seriesColor = (data: LayerData, s: SeriesData): RGBA => {
    const own = data.layer.series?.[s.key]?.color;
    if (own) return parseColor(own);
    return data.layer.style?.color ? parseColor(data.layer.style.color) : categorical(s.key);
  };
  return { known, categorical, seriesColor, ramp };
}
