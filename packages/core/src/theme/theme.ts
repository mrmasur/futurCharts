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
  /** Default style of the labels drawn by the marks (each layer's `labels` wins over it). */
  labels: { color?: string; scale?: number; weight?: number; background?: string };
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
    line: {
      width: number;
      curve: 'linear' | 'step' | 'smooth';
      opacity: number;
      endLabels: boolean;
      /** Dash pattern in px, e.g. `[6, 5]` (a forecast, a target). Empty: solid. */
      dash: number[];
      /** A dot on every data point. */
      markers: boolean;
      /** The value above every point: for short series, or with `highlight` on a few. */
      labels: boolean;
      /** Join across missing values instead of leaving a gap. */
      connectNulls: boolean;
      /** Color each stretch of line by its height (the sequential ramp, low to high). */
      colorByValue: boolean;
    };
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
      /** A full-length track behind each bar (`auto`: the grid color; empty: none). */
      track: string;
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
      /** Spread dots across their category slot (share of it, 0–1), so that equal values stay visible. */
      jitter: number;
      /** Rings pulsing out of the dots (only the highlighted ones when the layer has a `highlight`). */
      pulse: boolean;
    };
    rule: { width: number; opacity: number };
    /** `length`: share of the category slot; `maxWidth`: cap in px (0 = none), to match a capped bar. */
    tick: { width: number; length: number; maxWidth: number; opacity: number };
    /**
     * `circles`: a dot per cell sized by the value (punch card) instead of a filled cell.
     * `diverging`: colors from one hue (negative) through neutral (0) to another (positive), symmetric around zero (correlations).
     */
    heatmap: { radius: number; labels: boolean; gap: number; circles: boolean; diverging: boolean };
    /** Globe: `layer.geo` outlines, points (`x` lon, `y` lat) and routes (to `x2`, `y2`). Drag to turn; `spin` until then. */
    globe: { spin: boolean; size: number; graticule: boolean; ocean: string; land: string };
    /** Scatter plot matrix: every pair of `path` fields, histograms on the diagonal. `size`: dot px. */
    splom: { size: number; opacity: number; bins: number };
    /** 3D scatter (`x`, `y`, `z`): drag to turn it; `spin` turns it on its own until then. `size`: dot px. */
    scatter3d: { size: number; opacity: number; spin: boolean; perspective: number };
    /** Cells on rings: `x` around the circle, `y` from the center out. `innerRadius`: share left empty. */
    polarHeatmap: { innerRadius: number; gap: number; labels: boolean };
    /** Pie and donut. `gap`: px separator between slices; `innerRadius`: share of the radius (donut). */
    arc: {
      innerRadius: number;
      gap: number;
      labels: boolean;
      center: boolean;
      /** Where the circle starts and ends, in degrees clockwise from 12 o'clock: `-90` and `90` make a half donut. */
      startAngle: number;
      endAngle: number;
      /** Rounded corners on every slice, px. */
      cornerRadius: number;
    };
    treemap: { gap: number; radius: number; labels: boolean; header: number };
    funnel: { gap: number; radius: number; labels: boolean; connector: number };
    /** `thickness`: share of the radius. `track`: empty part of the arc (`auto` follows the grid color). */
    gauge: {
      min: number;
      max: number;
      thickness: number;
      track: string;
      target: number;
      /** Opening of the dial in degrees (180: half circle, 240: speedometer). */
      sweep: number;
      /** Colored zones along the dial, each up to a value (`[{ "to": 60, "color": "#e34948" }, …]`); the value then shows as a needle. */
      zones: { to: number; color: string }[];
      /** A needle pointing at the value. */
      needle: boolean;
      /** Graduations: this many intervals, labelled (0: none). */
      ticks: number;
      /** Round ends on the arcs. */
      rounded: boolean;
    };
    radar: { levels: number; fillOpacity: number; width: number; points: boolean };
    /** px sizes; `linkOpacity` applies to the flows. */
    sankey: { nodeWidth: number; nodePadding: number; linkOpacity: number; radius: number; labels: boolean };
    /** `innerRadius`: share of the radius left empty in the middle; `gap`: px between segments. */
    sunburst: { innerRadius: number; gap: number; labels: boolean };
    /** `empty`: color of days without data (`auto` follows the grid). */
    /** `direction`: weeks across (LR) or down (TB); by default, down when the chart is narrow (a phone). */
    calendar: { radius: number; gap: number; empty: string; direction?: 'LR' | 'TB' };
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
    /** Bar chart race: `top` bars shown, `duration` ms per frame, start on its own, start over at the end. */
    race: { top: number; duration: number; autoplay: boolean; loop: boolean };
    /** Animated scatter (one frame per `time`): ms per frame, trails behind highlighted points. */
    motion: { duration: number; autoplay: boolean; loop: boolean; opacity: number; trails: boolean };
    /** Cross table: cells shaded by magnitude, a total and a sparkline per row. */
    pivot: { heat: boolean; totals: boolean; sparkline: boolean };
    /** Stacked densities: `overlap` rows a peak reaches up, `bandwidth` of the kernel (0: automatic). */
    ridgeline: { overlap: number; opacity: number; bandwidth: number };
    /** Dots that do not overlap: `size` px; `label`: field naming each dot in the tooltip. */
    beeswarm: { size: number; opacity: number; label: string };
    /** Grid of tiles: hexagons (`hex`) or squares, `gap` px. */
    tilemap: { hex: boolean; gap: number; labels: boolean };
    /** Rows of symbols: one `icon` per `unit` of value, `gap` share of a symbol's slot. */
    pictorial: { unit: number; icon: PointShape; gap: number };
    /** Smooth color field over a grid with `contours` iso-lines (`auto` ink). */
    surface: { contours: number; contourColor: string };
    /** Horizon rows: `bands` folds, `gap` px between rows. */
    horizon: { bands: number; gap: number };
    /** Concentric bars around a center: `endAngle` degrees for the longest, `gap` share of a ring left empty. */
    /** `labelColor`: ink of the values, `auto` for the primary text color (they sit on the track, past the bar). */
    radialBar: { innerRadius: number; gap: number; endAngle: number; track: string; labels: boolean; labelColor: string };
    /** Partition in rows: `orientation` TB (icicle), BT (flame chart, root at the bottom) or LR. Click to zoom. */
    icicle: { orientation: 'TB' | 'BT' | 'LR'; gap: number; radius: number; labels: boolean };
    /** One dot per item on a half circle (seats of an assembly). `innerRadius`: share of the radius left empty. */
    parliament: { innerRadius: number; center: boolean };
    /** Overlapping circles, areas proportional to the sets and their intersections (2 or 3 sets). */
    venn: { opacity: number; labels: boolean };
    /** Words sized by `value`, font sizes in px. */
    wordcloud: { minSize: number; maxSize: number; weight: number };
    /** Events along a line, labels alternating above and below. `proportional`: space them by date. */
    /** `minImportance`: events whose `encode.size` is below it never get a card (dots only). */
    timeline: { proportional: boolean; markerSize: number; minImportance: number };
    /** Hierarchy as a tree: dots (dendrogram) or `boxes` (org chart), growing along `direction`. Sizes in px. */
    /** Arrows at x / y, pointing along `encode.angle`, as long as `encode.size` (within `sizeRange`, px). */
    vector: { width: number; head: number };
    /** Packed bubbles: `gap` px between bubbles; with `encode.color`, one cluster per group. */
    bubbles: { gap: number; labels: boolean; opacity: number };
    /** Nodes on a line, links as half circles above, as thick as their value (`maxWidth`, px). */
    arcDiagram: { maxWidth: number; opacity: number; nodeSize: number };
    /** Stages stacked in a triangle, apex at the top, heights by value. `gap` px between them. */
    pyramid: { gap: number; labels: boolean };
    /**
     * Price bars: `ohlc` draws ticks instead of bodies. `rising` / `falling`: colors (`auto` = the KPI good / bad).
     * `body`: share of the slot taken by a body; `wick`: px.
     */
    candlestick: { ohlc: boolean; rising: string; falling: string; body: number; wick: number };
    /** Routes on a map from (x, y) to (x2, y2), bent by `curvature`; width from `encode.size` (`sizeRange`, px). */
    route: { curvature: number; opacity: number; ends: boolean };
    /** `reverse`: grow right to left (LR) or bottom to top (TB). */
    tree: { direction: 'LR' | 'TB'; reverse: boolean; radial: boolean; boxes: boolean; nodeSize: number; linkWidth: number; boxWidth: number; boxHeight: number };
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
  labels: {},
  legend: {
    visible: true,
    label: { color: '#52514e', size: 12, weight: 400 },
    symbolSize: 8,
    itemGap: 16,
    hiddenOpacity: 0.35,
  },
  marks: {
    line: { width: 2, curve: 'linear', opacity: 1, endLabels: false, dash: [], markers: false, labels: false, connectNulls: false, colorByValue: false },
    bar: { radius: 4, gap: 2, maxWidth: 28, bandPadding: 0.3, opacity: 1, strokeWidth: 0, stroke: 'transparent', labels: false, thickness: 0, track: '' },
    point: { size: 8, shape: 'circle', opacity: 1, strokeWidth: 2, stroke: 'surface', sizeRange: [4, 28], jitter: 0, pulse: false },
    area: { opacity: 0.12, stackedOpacity: 0.8, gradient: false, line: true, lineWidth: 2, curve: 'linear' },
    geoshape: { fill: '#e9e8e2', missing: '#e9e8e2', stroke: '#fcfcfb', strokeWidth: 0.75 },
    rule: { width: 1.5, opacity: 1 },
    tick: { width: 2, length: 0.6, maxWidth: 0, opacity: 1 },
    heatmap: { radius: 3, labels: true, gap: 2, circles: false, diverging: false },
    polarHeatmap: { innerRadius: 0.22, gap: 1.5, labels: true },
    splom: { size: 4, opacity: 0.7, bins: 14 },
    globe: { spin: true, size: 6, graticule: true, ocean: 'auto', land: 'auto' },
    scatter3d: { size: 7, opacity: 0.85, spin: true, perspective: 4 },
    arc: { innerRadius: 0, gap: 2, labels: true, center: true, startAngle: 0, endAngle: 360, cornerRadius: 0 },
    treemap: { gap: 2, radius: 4, labels: true, header: 22 },
    funnel: { gap: 6, radius: 4, labels: true, connector: 0.14 },
    gauge: { min: 0, max: 100, thickness: 0.24, track: 'auto', target: NaN, sweep: 180, zones: [], needle: false, ticks: 0, rounded: false },
    radar: { levels: 4, fillOpacity: 0.14, width: 2, points: true },
    sankey: { nodeWidth: 12, nodePadding: 14, linkOpacity: 0.32, radius: 2, labels: true },
    sunburst: { innerRadius: 0.32, gap: 1.5, labels: true },
    calendar: { radius: 2, gap: 2, empty: 'auto' },
    kpi: { upIsGood: true, sparkline: true, good: '#006300', bad: '#d03b3b', size: 34 },
    waffle: { rows: 10, columns: 10, gap: 2, radius: 2 },
    rose: { levels: 3, gap: 2, innerRadius: 0.08, labels: true },
    violin: { width: 0.8, fillOpacity: 0.28, strokeWidth: 1.5, box: true, samples: 64, scale: 'width' },
    race: { top: 10, duration: 900, autoplay: true, loop: false },
    motion: { duration: 1000, autoplay: true, loop: false, opacity: 0.82, trails: true },
    pivot: { heat: true, totals: true, sparkline: true },
    ridgeline: { overlap: 1.8, opacity: 0.8, bandwidth: 0 },
    beeswarm: { size: 7, opacity: 0.85, label: '' },
    tilemap: { hex: true, gap: 2, labels: true },
    pictorial: { unit: 1, icon: 'circle', gap: 0.18 },
    surface: { contours: 8, contourColor: 'auto' },
    horizon: { bands: 3, gap: 2 },
    radialBar: { innerRadius: 0.3, gap: 0.28, endAngle: 270, track: 'auto', labels: true, labelColor: 'auto' },
    icicle: { orientation: 'TB', gap: 1.5, radius: 3, labels: true },
    parliament: { innerRadius: 0.38, center: true },
    venn: { opacity: 0.3, labels: true },
    wordcloud: { minSize: 11, maxSize: 46, weight: 650 },
    timeline: { proportional: false, markerSize: 12, minImportance: NaN },
    vector: { width: 1.5, head: 5 },
    bubbles: { gap: 2, labels: true, opacity: 0.9 },
    arcDiagram: { maxWidth: 14, opacity: 0.45, nodeSize: 10 },
    pyramid: { gap: 3, labels: true },
    candlestick: { ohlc: false, rising: 'auto', falling: 'auto', body: 0.7, wick: 1.25 },
    route: { curvature: 0.25, opacity: 0.6, ends: true },
    tree: { direction: 'LR', reverse: false, radial: false, boxes: false, nodeSize: 9, linkWidth: 1.5, boxWidth: 132, boxHeight: 46 },
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
