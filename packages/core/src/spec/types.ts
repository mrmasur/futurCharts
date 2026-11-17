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
  legend?: boolean;
  interactions?: InteractionSpec;
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
  /** Field name: a string field splits into series, a numeric field maps to the sequential ramp. */
  color?: string;
  /** Field name (point marks): numeric field mapped to the size range. */
  size?: string;
}

export interface LayerSpec {
  mark: MarkType;
  /** Series name when there is no color field. Defaults to the y field label. */
  name?: string;
  /** Layer-specific data; defaults to the chart data. */
  data?: DataInput;
  /** GeoJSON to draw (shape marks): a FeatureCollection, Feature or Geometry. */
  geo?: unknown;
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
    Theme['marks']['rose']
>;

/** A condition on one field of a row. Several conditions in an array must all hold. */
export interface Predicate {
  field: string;
  equals?: string | number;
  in?: (string | number)[];
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
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
  zoom?: boolean | { axes?: 'x' | 'y' | 'xy'; max?: number };
  /**
   * Drag to select marks: freehand `lasso` (default) or `rect`. Hold Shift to
   * pan instead, Cmd/Ctrl to add to the selection; click empty space to clear.
   */
  select?: boolean | 'lasso' | 'rect';
  /** Click a legend entry to toggle its series. */
  legendToggle?: boolean;
}
