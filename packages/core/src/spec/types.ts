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
  /**
   * What a screen reader says of the chart, after the title and subtitle. By default a summary is
   * generated from the data (kind of chart, series, categories, value range and where its extremes
   * are, with the catalog's labels and formats): set this to say what the chart means instead.
   * `"Le chiffre d’affaires double entre 2020 et 2024, porté par l’export."`
   */
  description?: string;
  theme?: ThemeSpec;
  layers: LayerSpec[];
  /**
   * `secondary`: the second value axis of a dual-axis chart, used by the layers that set
   * `axis: 'secondary'` (two measures in different units: euros and a percentage, rain and
   * temperature). It has its own domain; `x` / `y` stay the screen axes of the other layers.
   * Named `secondary` rather than `y2` on purpose: `encode.y2` is already the end of a range,
   * and on a horizontal chart the second value axis runs along x (it is drawn at the top).
   */
  scales?: { x?: ScaleSpec; y?: ScaleSpec; secondary?: ScaleSpec; color?: ColorScaleSpec };
  /**
   * Draw on a map instead of cartesian axes: `x` is then a longitude field and
   * `y` a latitude field, and the chart keeps the projection's aspect ratio.
   */
  projection?: ProjectionSpec;
  /**
   * `secondary`: the axis of `scales.secondary`, drawn on the right (at the top of a horizontal
   * chart) with its own graduations, title and format. The grid stays the primary axis' one.
   */
  axes?: { x?: AxisSpec | false; y?: AxisSpec | false; secondary?: AxisSpec | false };
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
  /**
   * `false` hides the legend. By default it shows as soon as there are two entries, and the color
   * ramp of a mark that provides one. `true` also asks for the ramp (theme ramp, both ends of the
   * values) of a cartesian layer colored by a numeric field.
   */
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
  /**
   * What the field means to every chart, declared once in the catalog (or in dbt's `meta.role`):
   * `importance` ranks rows (which ones get a label first: a timeline's cards…), `link` holds the
   * address a click opens. A chart uses it when its own encoding does not say otherwise.
   */
  role?: FieldRole;
}

export type FieldRole = 'importance' | 'link';

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
  /** Flow start and end (sankey). Link ends (`bundle`; `color` is then the group of the source). */
  source?: string;
  /** Also the goal of an indicator, one per row (`bullet`, `liquid`, `activity`, `led`). */
  target?: string;
  /** Hierarchy, from the outermost level to the innermost (sunburst). The categorical dimensions, left to right (`parsets`). */
  path?: string[];
  /** The field that steps through time, one frame per value (bar chart race). */
  time?: string;
  /** Share done, 0 to 1 (or 0 to 100): the filled part of a `gantt` bar. */
  progress?: string;
  /** Phase of a task (`gantt`): each group opens with a summary bar spanning its tasks. Group of the `source` entity (`matrix`). */
  group?: string;
  /** Predecessors of a task (`gantt`): ids separated by commas, each drawn as an arrow from its end to this start. */
  depends?: string;
  /** Task identity that `depends` refers to (`gantt`), when it is not the `key` (names repeated or shortened). */
  id?: string;
  /** Field name: a string field splits into series, a numeric field maps to the sequential ramp. */
  color?: string;
  /** Field name (point marks): numeric field mapped to the size range. */
  size?: string;
  /** Direction in degrees, clockwise from up (`vector`); the angle of a polar mark, instead of `x` (`polarLine`, `polarScatter`, `radialArea`). */
  angle?: string;
  /** Depth (`scatter3d`). */
  z?: string;
  /** Opening and closing prices (`candlestick`; `y` is the high, `y2` the low). */
  open?: string;
  close?: string;
  /** Value of the previous period, one per row (`barRank`: the tick on each bar, the change and the places moved). */
  previous?: string;
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
  /** Read the value on the secondary value axis of a dual-axis chart (an 80 % line on a Pareto chart). */
  axis?: 'primary' | 'secondary';
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
   * Which value axis the layer reads: `primary` (default) or `secondary`, the second value axis
   * (`scales.secondary`, `axes.secondary`), which has its own domain and is drawn on the right.
   * Cartesian marks only; ignored when no layer is left on the primary axis.
   * `{ "mark": "line", "axis": "secondary", "encode": { "x": "month", "y": "margin" } }`
   */
  axis?: 'primary' | 'secondary';
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
    Theme['marks']['spiral'] &
    Theme['marks']['polarLine'] &
    Theme['marks']['polarScatter'] &
    Theme['marks']['radialArea'] &
    Theme['marks']['icicle'] &
    Theme['marks']['parliament'] &
    Theme['marks']['venn'] &
    Theme['marks']['parsets'] &
    Theme['marks']['upset'] &
    Theme['marks']['bundle'] &
    Theme['marks']['wordcloud'] &
    Theme['marks']['timeline'] &
    Theme['marks']['gantt'] &
    Theme['marks']['schedule'] &
    Theme['marks']['swimlane'] &
    Theme['marks']['tree'] &
    Theme['marks']['voronoi'] &
    Theme['marks']['indentedTree'] &
    Theme['marks']['cohort'] &
    Theme['marks']['decomposition'] &
    Theme['marks']['funnelCompare'] &
    Theme['marks']['vector'] &
    Theme['marks']['bubbles'] &
    Theme['marks']['arcDiagram'] &
    Theme['marks']['pyramid'] &
    Theme['marks']['candlestick'] &
    Theme['marks']['renko'] &
    Theme['marks']['kagi'] &
    Theme['marks']['route'] &
    Theme['marks']['motion'] &
    Theme['marks']['pivot'] &
    Theme['marks']['polarHeatmap'] &
    Theme['marks']['splom'] &
    Theme['marks']['globe'] &
    Theme['marks']['scatter3d'] &
    Theme['marks']['ridgeline'] &
    Theme['marks']['beeswarm'] &
    Theme['marks']['dotplot'] &
    Theme['marks']['ecdf'] &
    Theme['marks']['qq'] &
    Theme['marks']['contour'] &
    Theme['marks']['raincloud'] &
    Theme['marks']['quadrant'] &
    Theme['marks']['connected'] &
    Theme['marks']['marginal'] &
    Theme['marks']['tilemap'] &
    Theme['marks']['dorling'] &
    Theme['marks']['mapPie'] &
    Theme['marks']['spike'] &
    Theme['marks']['mapBars'] &
    Theme['marks']['pictorial'] &
    Theme['marks']['bullet'] &
    Theme['marks']['liquid'] &
    Theme['marks']['activity'] &
    Theme['marks']['led'] &
    Theme['marks']['surface'] &
    Theme['marks']['horizon'] &
    Theme['marks']['difference'] &
    Theme['marks']['fan'] &
    Theme['marks']['cycle'] &
    Theme['marks']['sparktable'] &
    Theme['marks']['bumpArea'] &
    Theme['marks']['likert'] &
    Theme['marks']['tornado'] &
    Theme['marks']['variwide'] &
    Theme['marks']['barRank'] &
    Theme['marks']['barInBar'] &
    Theme['marks']['bridge'] &
    Theme['marks']['variance'] &
    Theme['marks']['periodBars'] &
    Theme['marks']['table'] &
    Theme['marks']['matrix'] &
    Theme['marks']['confusion'] &
    Theme['marks']['calendarMonth']
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
  /** Groups color the boxes and form the legend (team, system…); with `style.lanes`, the swimlane of the node. */
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
  /**
   * `band` over a date field gives an ordinal axis of dates: one band per date present in the data,
   * in order, no room for the others (trading sessions without week-ends), with calendar
   * graduations (sessions, weeks, months… as room allows).
   */
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
  /**
   * Ink of the graduations and of the title (theme tokens allowed: `$1`, `$muted`…). On a
   * dual-axis chart, the color of a series on its axis says which one it reads on.
   */
  color?: string;
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
    /**
     * `modifier`: the wheel zooms only with Ctrl or Cmd held (a trackpad pinch counts), and scrolls
     * the page otherwise: for a page full of charts, where the wheel must keep scrolling. Dragging
     * still pans, double-click still resets. Default `always`.
     */
    wheel?: 'always' | 'modifier';
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
  /**
   * Keyboard walk through the data: the plot is a tab stop, the arrows move from datum to datum
   * (left / right) and from series to series (up / down) with the tooltip, Enter clicks, Escape leaves.
   * Default true; `false` takes the plot out of the tab order.
   */
  keyboard?: boolean;
}
