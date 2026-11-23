import type { ColumnType, DataInput } from '../data/table';
import type { TransformSpec } from '../data/transforms';
import type { Theme, ThemeSpec } from '../theme/theme';
import type { FormatSpec } from '../util/format';
import type { DeepPartial } from '../util/merge';

/**
 * The chart spec. Apart from `data` (which may hold typed arrays), it is plain
 * JSON: it can be stored in a database, diffed, generated, and edited by a
 * visual builder. Anything that needs a function goes in `ChartOptions`.
 */
export interface ChartSpec {
  data?: DataInput;
  /**
   * Field catalog: type, label and format per field. This is the hook for a
   * semantic layer (dbt): generate it from the manifest and every chart gets
   * consistent labels and formats without repeating them.
   */
  fields?: Record<string, FieldSpec>;
  title?: string;
  subtitle?: string;
  theme?: ThemeSpec;
  layers: LayerSpec[];
  scales?: { x?: ScaleSpec; y?: ScaleSpec; color?: ColorScaleSpec };
  /**
   * Draw on a map instead of cartesian axes: `x` is then a longitude field and
   * `y` a latitude field, and the chart keeps the projection's aspect ratio.
   */
  projection?: ProjectionSpec;
  axes?: { x?: AxisSpec | false; y?: AxisSpec | false };
  /**
   * On a small screen, give up the subtitle, then the axis titles, then the
   * legend when the drawing would be cramped. Default true.
   */
  autoCompact?: boolean;
  /**
   * Rules by size, applied over the spec when the chart's box matches (the
   * last matching rule wins). A rule's `spec` can change anything, the marks
   * included: another chart on a phone.
   * `[{ "maxWidth": 420, "spec": { "layers": [{ "mark": "bar", ... }] } }]`
   */
  responsive?: ResponsiveRule[];
  /**
   * Reference lines, bands and notes, in data coordinates (cartesian charts).
   * `{ "y": 100, "text": "Objectif" }`, `{ "x": ["2024-03-01", "2024-04-15"], "text": "Campagne" }`,
   * `{ "x": "2024-06-01", "y": 120, "text": "Lancement" }`.
   */
  annotations?: AnnotationSpec[];
  legend?: boolean;
  interactions?: InteractionSpec;
  /**
   * Entry animation when the chart first appears: bars grow, lines draw,
   * pies sweep open. `false` to turn it off, a number for its duration (ms).
   * Skipped when the system asks for reduced motion. Default 900 ms.
   */
  animation?: boolean | number;
  /**
   * Small multiples: one panel per value of `field`, same scales, same colors,
   * one shared legend. `columns` defaults to fitting the width; `height` is per
   * panel (px, default 220).
   */
  facet?: { field: string; columns?: number; height?: number; shared?: boolean };
}

export interface FieldSpec {
  type?: ColumnType;
  label?: string;
  format?: FormatSpec;
  /** Free text from the catalog (dbt description); for editors and documentation, not drawn. */
  description?: string;
}

export type MarkType = 'line' | 'bar' | 'point' | 'area' | (string & {});

export interface ProjectionSpec {
  /** Default `mercator`. */
  type?: 'mercator' | 'equirectangular';
  /** Visible extent as [[west, south], [east, north]] in degrees. Default: the inhabited world. */
  bounds?: [[number, number], [number, number]];
}

export interface Encoding {
  /** Required by every cartesian mark; a longitude field under a projection. */
  x?: string;
  /** Required by every cartesian mark; a latitude field under a projection. */
  y?: string;
  /** End of a range along x; `x` is then its start (Gantt bars, horizontal intervals). */
  x2?: string;
  /** End of a range along y; `y` is then its start (waterfall, box plot, error bars). */
  y2?: string;
  /** Item identity: shape join key (maps), slice (pie), tile (treemap), stage (funnel), axis (radar). */
  key?: string;
  /** Measure of marks that are not positioned on x / y: pie, treemap, funnel, gauge, radar, sankey, sunburst. */
  value?: string;
  /** Flow start and end (sankey). */
  source?: string;
  target?: string;
  /** Hierarchy, from the outermost level to the innermost (sunburst). */
  path?: string[];
  /** The field that steps through time, one frame per value (bar chart race). */
  time?: string;
  /** Field name: a string field splits into series, a numeric field maps to the sequential ramp. */
  color?: string;
  /** Field name (point marks): numeric field mapped to the size range. */
  size?: string;
  /** Direction in degrees, clockwise from up (`vector`). */
  angle?: string;
  /** Depth (`scatter3d`). */
  z?: string;
  /** Opening and closing prices (`candlestick`; `y` is the high, `y2` the low). */
  open?: string;
  close?: string;
}

export interface ResponsiveRule {
  maxWidth?: number;
  minWidth?: number;
  maxHeight?: number;
  minHeight?: number;
  /** Merged over the spec: objects merged deeply, `layers` merged layer by layer (a layer can change its mark). */
  spec: Omit<Partial<ChartSpec>, 'responsive'>;
}

/** A number, a date (ISO string or epoch ms) or a category name. */
export type AnnotationValue = number | string;

/**
 * One scalar: a line across the chart at that value. A pair: a band. Both x and
 * y scalars: a note pinned to that point. `x` and `y` are screen axes.
 */
export interface AnnotationSpec {
  x?: AnnotationValue | [AnnotationValue, AnnotationValue];
  y?: AnnotationValue | [AnnotationValue, AnnotationValue];
  text?: string;
  /** Color or theme token (`$1`, `$muted`…). Lines default to `$muted`, bands to `$1`. */
  color?: string;
  /** Line width, px. */
  width?: number;
  /** Line dash in px; `[]` for a solid line. Default `[5, 4]`. */
  dash?: number[];
  /** Band opacity. Default 0.1. */
  opacity?: number;
}

export interface LayerSpec {
  mark: MarkType;
  /** Series name when there is no color field. Defaults to the y field label. */
  name?: string;
  /** Layer-specific data; defaults to the chart data. */
  data?: DataInput;
  /** GeoJSON to draw (shape marks): a FeatureCollection, Feature or Geometry. */
  geo?: unknown;
  /** Boxes and arrows (`flow` mark): a whole process, branches and loops included. */
  graph?: FlowGraph;
  /** Where a shape's join key and name live, e.g. `properties.iso_a3`. Default: `properties.name`, then `id`. */
  geoKey?: string;
  encode: Encoding;
  /**
   * Stack series on top of each other (bar, area). `normalize`: each stack
   * fills 100 %. `center`: stacks centered on zero (streamgraph).
   */
  stack?: boolean | 'normalize' | 'center';
  /** Reshape the layer's data before drawing (bin, aggregate, boxplot, waterfall, sort, regression). */
  transform?: TransformSpec[];
  /** Overrides `theme.marks[mark]` for this layer, plus `color` for a fixed color. */
  style?: MarkStyle;
  /**
   * Restyle some marks only: the first matching rule wins.
   * `{ when: { field: 'country', in: ['France', 'Italie'] }, style: { color: '#e34948' } }`
   */
  overrides?: StyleOverride[];
  /**
   * Put some values forward: they keep their color (or take `color`), the
   * others fade to `dim` opacity. Works on every mark. `field` defaults to the
   * layer's category (x, y on a horizontal chart, `key`, `color`, the first
   * level of `path`, or `source`).
   * `{ "values": ["France"], "color": "#e34948" }`
   */
  highlight?: Highlight;
  /**
   * Style of one series (or one slice, one node…) by its name: a line in another
   * color, thicker, dashed; its labels in their own ink.
   * `{ "France": { "color": "#e34948", "width": 4, "labelColor": "#e34948" } }`
   */
  series?: Record<string, SeriesStyle>;
  /** Labels of this layer, whatever the mark: ink, size (as a factor), weight, a background pill. */
  labels?: LabelStyle;
  /**
   * Clicking a datum opens the address in `field` (`target` default `_blank`).
   * The chart emits `link` first; `open: false` leaves the navigation to the app.
   */
  link?: { field: string; target?: '_blank' | '_self'; open?: boolean };
}

export interface SeriesStyle {
  color?: string;
  /** Line width, px (lines, areas). */
  width?: number;
  /** Dash pattern, px (lines). */
  dash?: number[];
  opacity?: number;
  /** Dots on the line's points. */
  markers?: boolean;
  /** Ink of this series' labels. */
  labelColor?: string;
}

export interface LabelStyle {
  /** Ink of every label (theme tokens allowed: `$ink`, `$1`…). Replaces the automatic contrast on colored fills. */
  color?: string;
  /** Size factor (1.2 = 20 % larger), so big center values stay bigger than the rest. */
  scale?: number;
  weight?: number;
  /** A rounded pill behind each label (`$surface` for the background color). */
  background?: string;
}

export type MarkStyle = { color?: string } & DeepPartial<
  Theme['marks']['line'] &
    Theme['marks']['bar'] &
    Theme['marks']['point'] &
    Theme['marks']['area'] &
    Theme['marks']['geoshape'] &
    Theme['marks']['rule'] &
    Theme['marks']['tick'] &
    Theme['marks']['heatmap'] &
    Theme['marks']['arc'] &
    Theme['marks']['treemap'] &
    Theme['marks']['funnel'] &
    Theme['marks']['gauge'] &
    Theme['marks']['radar'] &
    Theme['marks']['sankey'] &
    Theme['marks']['sunburst'] &
    Theme['marks']['calendar'] &
    Theme['marks']['kpi'] &
    Theme['marks']['waffle'] &
    Theme['marks']['rose'] &
    Theme['marks']['violin'] &
    Theme['marks']['flow'] &
    Theme['marks']['race'] &
    Theme['marks']['radialBar'] &
    Theme['marks']['icicle'] &
    Theme['marks']['parliament'] &
    Theme['marks']['venn'] &
    Theme['marks']['wordcloud'] &
    Theme['marks']['timeline'] &
    Theme['marks']['tree'] &
    Theme['marks']['vector'] &
    Theme['marks']['bubbles'] &
    Theme['marks']['arcDiagram'] &
    Theme['marks']['pyramid'] &
    Theme['marks']['candlestick'] &
    Theme['marks']['route'] &
    Theme['marks']['motion'] &
    Theme['marks']['pivot'] &
    Theme['marks']['polarHeatmap'] &
    Theme['marks']['splom'] &
    Theme['marks']['globe'] &
    Theme['marks']['scatter3d'] &
    Theme['marks']['ridgeline'] &
    Theme['marks']['beeswarm'] &
    Theme['marks']['tilemap'] &
    Theme['marks']['pictorial'] &
    Theme['marks']['surface'] &
    Theme['marks']['horizon']
>;

/** A condition on one field of a row. Several conditions in an array must all hold. */
export interface Predicate {
  field: string;
  equals?: string | number;
  in?: (string | number)[];
  notIn?: (string | number)[];
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
}

export type FlowShape = 'step' | 'start' | 'end' | 'decision' | 'io' | 'subprocess';

export interface FlowNode {
  id: string;
  /** Text in the box; defaults to the id. */
  label?: string;
  /** `step` (default), `start` / `end` (pill), `decision` (diamond), `io` (parallelogram), `subprocess`. */
  shape?: FlowShape;
  /** A figure shown under the label (count, duration…), formatted with `fields[valueField]` if given. */
  value?: number;
  /** Groups color the boxes and form the legend (team, system, lane…). */
  group?: string;
  /** Explicit color (theme tokens allowed). */
  color?: string;
  /** Extra text in the tooltip (and under the name in the pipeline look). */
  description?: string;
  /** Position by hand (px, center of the node, from the top-left of the drawing). Unset: automatic placement. */
  x?: number;
  y?: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Text on the arrow ("Oui", "Non", "Relance"). */
  label?: string;
  /** Volume on the arrow: thickens it, shown in the tooltip. */
  value?: number;
  /** Dashed arrow (optional path, asynchronous message). */
  dashed?: boolean;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface Highlight {
  field?: string;
  values: (string | number)[];
  color?: string;
  /** Opacity of the other values. Default 0.25; 1 keeps them as they are. */
  dim?: number;
}

export interface StyleOverride {
  when: Predicate | Predicate[];
  style: { color?: string; opacity?: number };
}

export interface ScaleSpec {
  type?: 'linear' | 'log' | 'time' | 'band';
  /** Explicit domain; `null` on one side keeps that side automatic. */
  domain?: [number | null, number | null];
  /** Extend the domain to round numbers. */
  nice?: boolean;
  /** Force the domain to include zero. */
  zero?: boolean;
  /** Run the axis the other way: rank 1 at the top, first category at the bottom… */
  reverse?: boolean;
  /** Category order of a band axis (others follow in data order). */
  categories?: string[];
}

export interface ColorScaleSpec {
  /** Fixed entity -> slot order, so colors stay stable across charts and filters. */
  domain?: string[];
  /** Explicit colors, by series name. */
  colors?: Record<string, string>;
}

export interface AxisSpec {
  title?: string;
  format?: FormatSpec;
  /** Approximate number of ticks. */
  tickCount?: number;
  grid?: boolean;
  line?: boolean;
  labels?: boolean;
}

export interface InteractionSpec {
  /** Hover tooltip. `x` lists every series at the hovered x; `nearest` picks one mark. */
  tooltip?: boolean | { mode?: 'x' | 'nearest' };
  crosshair?: boolean;
  /** Wheel to zoom, drag to pan, double-click to reset. */
  zoom?: boolean | {
    axes?: 'x' | 'y' | 'xy';
    max?: number;
    /** Zoomed along x, the value axis fits what is visible. Default true. */
    fitY?: boolean;
  };
  /**
   * Drag to select marks: freehand `lasso` (default) or `rect`. Hold Shift to
   * pan instead, Cmd/Ctrl to add to the selection; click empty space to clear.
   */
  select?: boolean | 'lasso' | 'rect';
  /** Click a legend entry to toggle its series. */
  legendToggle?: boolean;
  /**
   * Charts with the same group name hover at the same x and show the same x
   * range: zoom one, the others follow (synchronized charts, a navigator).
   */
  sync?: string;
  /**
   * This chart is a range navigator for its `sync` group: drag a window over it
   * (or its edges) to set what the other charts show. Click to show everything.
   */
  navigator?: boolean;
  /** Play button and scrubber for marks that play through time (`race`). Hide it for previews. */
  player?: boolean;
}
