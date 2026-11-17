import type { PointShape } from '../render/layouts';
import { deepMerge, type DeepPartial } from '../util/merge';

export interface LineStyle {
  visible: boolean;
  color: string;
  width: number;
}

export interface TextStyle {
  color: string;
  size: number;
  weight: number | string;
}

/**
 * Every visual decision of a chart lives here. A spec can override any leaf
 * (`theme: { extends: 'dark', marks: { bar: { radius: 0 } } }`), and each layer
 * can override its own mark style again.
 */
export interface Theme {
  name: string;
  /** Chart surface. `transparent` lets the host page show through. */
  background: string;
  /** Outer padding around the whole chart, px. */
  padding: number;
  font: { family: string; size: number };
  text: { primary: string; secondary: string; muted: string };
  palette: {
    /** Fixed order: a series keeps its slot whatever is filtered. */
    categorical: string[];
    /** One hue, light to dark, for magnitude. */
    sequential: string[];
  };
  title: TextStyle & { gap: number };
  subtitle: TextStyle;
  axis: {
    line: LineStyle;
    tick: LineStyle & { size: number };
    label: TextStyle & { padding: number };
    title: TextStyle & { padding: number };
  };
  grid: { x: LineStyle; y: LineStyle };
  legend: {
    visible: boolean;
    label: TextStyle;
    symbolSize: number;
    itemGap: number;
    /** Opacity of a series toggled off in the legend. */
    hiddenOpacity: number;
  };
  marks: {
    /** `endLabels`: the series name at the end of each line (direct labeling). */
    line: { width: number; curve: 'linear' | 'step' | 'smooth'; opacity: number; endLabels: boolean };
    bar: {
      /** Radius of the data end, px. The baseline end stays square. */
      radius: number;
      /** Surface gap between touching bars and stacked segments, px. */
      gap: number;
      /** Cap on bar thickness, px (0 = fill the band). */
      maxWidth: number;
      /** Share of the band left empty between categories. */
      bandPadding: number;
      opacity: number;
      strokeWidth: number;
      stroke: string;
      /** Value label at the end of each bar (inside each segment when stacked). */
      labels: boolean;
      /** Exact bar thickness in px (0 = from the band). Wins over `maxWidth`; never wider than the band. */
      thickness: number;
    };
    point: {
      size: number;
      shape: PointShape;
      opacity: number;
      /** Ring width, px. */
      strokeWidth: number;
      /** `surface` uses the chart background, so overlapping dots stay readable. */
      stroke: string;
      /** Size range in px when `size` is bound to a field. */
      sizeRange: [number, number];
    };
    rule: { width: number; opacity: number };
    /** `length`: share of the category slot; `maxWidth`: cap in px (0 = none), to match a capped bar. */
    tick: { width: number; length: number; maxWidth: number; opacity: number };
    heatmap: { radius: number; labels: boolean; gap: number };
    /** Pie and donut. `gap`: px separator between slices; `innerRadius`: share of the radius (donut). */
    arc: { innerRadius: number; gap: number; labels: boolean; center: boolean };
    treemap: { gap: number; radius: number; labels: boolean; header: number };
    funnel: { gap: number; radius: number; labels: boolean; connector: number };
    /** `thickness`: share of the radius. `track`: empty part of the arc (`auto` follows the grid color). */
    gauge: { min: number; max: number; thickness: number; track: string; target: number };
    radar: { levels: number; fillOpacity: number; width: number; points: boolean };
    /** px sizes; `linkOpacity` applies to the flows. */
    sankey: { nodeWidth: number; nodePadding: number; linkOpacity: number; radius: number; labels: boolean };
    /** `innerRadius`: share of the radius left empty in the middle; `gap`: px between segments. */
    sunburst: { innerRadius: number; gap: number; labels: boolean };
    /** `empty`: color of days without data (`auto` follows the grid). */
    calendar: { radius: number; gap: number; empty: string };
    /** Stat tile: last value, change against the previous one, sparkline. */
    kpi: { upIsGood: boolean; sparkline: boolean; good: string; bad: string; size: number };
    /** 10 × 10 grid of squares: one per percent. */
    waffle: { rows: number; columns: number; gap: number; radius: number };
    /** Polar bars (Nightingale rose): `levels` grid circles, `gap` px between wedges. */
    rose: { levels: number; gap: number; innerRadius: number; labels: boolean };
    /**
     * `width`: share of the category slot at the widest density; `box`: quartile box and median inside;
     * `scale`: `width` gives every violin the full width (shapes compare), `area` keeps densities comparable across categories.
     */
    violin: { width: number; fillOpacity: number; strokeWidth: number; box: boolean; samples: number; scale: 'width' | 'area' };
    /**
     * Flow diagrams. `variant`: `pipeline` (small glyphs, thin curves, labels under) or `boxes` (boxes and
     * arrows). `direction`: LR or TB. Sizes in px at 100 %; the diagram is scaled to fit.
     * `edge`: link color (`auto` follows the muted ink). `tint`: how much of the node color fills a box.
     */
    flow: {
      variant: 'pipeline' | 'boxes';
      /** Steps can be dragged; the chart then emits `layout` with every position. */
      editable: boolean;
      direction: 'TB' | 'LR';
      rankGap: number;
      nodeGap: number;
      fontSize: number;
      edge: string;
      edgeWidth: number;
      tint: number;
      radius: number;
    };
    /** Map shapes (basemap, choropleth). */
    geoshape: {
      fill: string;
      /** Fill of a shape with no matching data in a choropleth. */
      missing: string;
      stroke: string;
      strokeWidth: number;
    };
    area: {
      opacity: number;
      stackedOpacity: number;
      /** Fade the fill to transparent towards the baseline. */
      gradient: boolean;
      line: boolean;
      lineWidth: number;
      curve: 'linear' | 'step' | 'smooth';
    };
  };
  tooltip: {
    background: string;
    color: string;
    muted: string;
    border: string;
    radius: number;
    padding: number;
    shadow: string;
    fontSize: number;
  };
  crosshair: LineStyle;
  hover: { markerSize: number; bandFill: string };
  selection: {
    /** Outline and fill of the lasso while it is drawn. */
    stroke: string;
    fill: string;
    width: number;
    /** Opacity of the marks left out of the selection. */
    dimOpacity: number;
  };
}

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const lightTheme: Theme = {
  name: 'light',
  background: '#fcfcfb',
  padding: 16,
  font: { family: SANS, size: 12 },
  text: { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781' },
  palette: {
    categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    sequential: ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
  },
  title: { color: '#0b0b0b', size: 15, weight: 600, gap: 12 },
  subtitle: { color: '#52514e', size: 12, weight: 400 },
  axis: {
    line: { visible: true, color: '#c3c2b7', width: 1 },
    tick: { visible: false, color: '#c3c2b7', width: 1, size: 4 },
    label: { color: '#898781', size: 11, weight: 400, padding: 8 },
    title: { color: '#52514e', size: 11, weight: 500, padding: 8 },
  },
  grid: {
    x: { visible: false, color: '#e1e0d9', width: 1 },
    y: { visible: true, color: '#e1e0d9', width: 1 },
  },
  legend: {
    visible: true,
    label: { color: '#52514e', size: 12, weight: 400 },
    symbolSize: 8,
    itemGap: 16,
    hiddenOpacity: 0.35,
  },
  marks: {
    line: { width: 2, curve: 'linear', opacity: 1, endLabels: false },
    bar: { radius: 4, gap: 2, maxWidth: 28, bandPadding: 0.3, opacity: 1, strokeWidth: 0, stroke: 'transparent', labels: false, thickness: 0 },
    point: { size: 8, shape: 'circle', opacity: 1, strokeWidth: 2, stroke: 'surface', sizeRange: [4, 28] },
    area: { opacity: 0.12, stackedOpacity: 0.8, gradient: false, line: true, lineWidth: 2, curve: 'linear' },
    geoshape: { fill: '#e9e8e2', missing: '#e9e8e2', stroke: '#fcfcfb', strokeWidth: 0.75 },
    rule: { width: 1.5, opacity: 1 },
    tick: { width: 2, length: 0.6, maxWidth: 0, opacity: 1 },
    heatmap: { radius: 3, labels: true, gap: 2 },
    arc: { innerRadius: 0, gap: 2, labels: true, center: true },
    treemap: { gap: 2, radius: 4, labels: true, header: 22 },
    funnel: { gap: 6, radius: 4, labels: true, connector: 0.14 },
    gauge: { min: 0, max: 100, thickness: 0.24, track: 'auto', target: NaN },
    radar: { levels: 4, fillOpacity: 0.14, width: 2, points: true },
    sankey: { nodeWidth: 12, nodePadding: 14, linkOpacity: 0.32, radius: 2, labels: true },
    sunburst: { innerRadius: 0.32, gap: 1.5, labels: true },
    calendar: { radius: 2, gap: 2, empty: 'auto' },
    kpi: { upIsGood: true, sparkline: true, good: '#006300', bad: '#d03b3b', size: 34 },
    waffle: { rows: 10, columns: 10, gap: 2, radius: 2 },
    rose: { levels: 3, gap: 2, innerRadius: 0.08, labels: true },
    violin: { width: 0.8, fillOpacity: 0.28, strokeWidth: 1.5, box: true, samples: 64, scale: 'width' },
    flow: { variant: 'pipeline', editable: true, direction: 'LR', rankGap: 56, nodeGap: 28, fontSize: 13, edge: 'auto', edgeWidth: 1.5, tint: 0.16, radius: 6 },
  },
  tooltip: {
    background: '#ffffff',
    color: '#0b0b0b',
    muted: '#52514e',
    border: 'rgba(11,11,11,0.10)',
    radius: 8,
    padding: 10,
    shadow: '0 4px 16px rgba(11,11,11,0.10)',
    fontSize: 12,
  },
  crosshair: { visible: true, color: '#898781', width: 1 },
  hover: { markerSize: 9, bandFill: 'rgba(11,11,11,0.05)' },
  selection: { stroke: '#0b0b0b', fill: 'rgba(11,11,11,0.06)', width: 1.5, dimOpacity: 0.18 },
};

export const darkTheme: Theme = deepMerge(lightTheme, {
  name: 'dark',
  background: '#1a1a19',
  text: { primary: '#f0efec', secondary: '#c3c2b7', muted: '#898781' },
  palette: {
    categorical: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
    sequential: ['#0d366b', '#1c5cab', '#3987e5', '#86b6ef', '#cde2fb'],
  },
  title: { color: '#f0efec' },
  subtitle: { color: '#c3c2b7' },
  axis: {
    line: { color: '#383835' },
    tick: { color: '#383835' },
    title: { color: '#c3c2b7' },
  },
  grid: { x: { color: '#2c2c2a' }, y: { color: '#2c2c2a' } },
  legend: { label: { color: '#c3c2b7' } },
  tooltip: {
    background: '#262624',
    color: '#f0efec',
    muted: '#c3c2b7',
    border: 'rgba(255,255,255,0.10)',
    shadow: '0 4px 16px rgba(0,0,0,0.45)',
  },
  hover: { bandFill: 'rgba(255,255,255,0.06)' },
  marks: { geoshape: { fill: '#2c2c2a', missing: '#2c2c2a', stroke: '#1a1a19' }, kpi: { good: '#0ca30c' } },
  selection: { stroke: '#f0efec', fill: 'rgba(255,255,255,0.08)' },
});

const registry = new Map<string, Theme>([
  ['light', lightTheme],
  ['dark', darkTheme],
]);

/** Make a theme available by name in specs (`theme: 'my-brand'`). */
export function registerTheme(name: string, theme: DeepPartial<Theme>, base: string = 'light'): Theme {
  const full = deepMerge(registry.get(base) ?? lightTheme, theme, { name } as DeepPartial<Theme>);
  registry.set(name, full);
  return full;
}

export type ThemeSpec = string | (DeepPartial<Theme> & { extends?: string });

/**
 * Colors that follow the theme, usable anywhere a spec takes a color:
 * `$ink`, `$ink-2`, `$muted`, `$grid`, `$axis`, `$surface`, and `$1`…`$8`
 * for the categorical slots. A spec written with them reads in light and dark.
 */
export function themeColor(theme: Theme, value: string): string {
  if (!value.startsWith('$')) return value;
  const slot = /^\$(\d)$/.exec(value);
  if (slot) return theme.palette.categorical[(Number(slot[1]) - 1) % theme.palette.categorical.length];
  const tokens: Record<string, string> = {
    $ink: theme.text.primary,
    '$ink-2': theme.text.secondary,
    $muted: theme.text.muted,
    $grid: theme.grid.y.color,
    $axis: theme.axis.line.color,
    $surface: theme.background,
  };
  return tokens[value] ?? value;
}

/** Replace theme tokens in every string of a style-like object. */
export function resolveThemeColors<T>(theme: Theme, value: T): T {
  if (typeof value === 'string') return themeColor(theme, value) as T;
  if (Array.isArray(value)) return value.map((v) => resolveThemeColors(theme, v)) as T;
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveThemeColors(theme, v)])) as T;
  }
  return value;
}

export function resolveTheme(spec: ThemeSpec | undefined): Theme {
  if (spec === undefined) return lightTheme;
  if (typeof spec === 'string') {
    const t = registry.get(spec);
    if (!t) throw new Error(`futurCharts: unknown theme "${spec}". Registered: ${[...registry.keys()].join(', ')}`);
    return t;
  }
  const { extends: base, ...overrides } = spec;
  return deepMerge(resolveTheme(base ?? 'light'), overrides as DeepPartial<Theme>);
}
