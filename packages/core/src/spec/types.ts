import type { ColumnType, DataInput } from '../data/table';
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

export interface Encoding {
  x: string;
  y: string;
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
  encode: Encoding;
  /** Stack series on top of each other (bar, area). */
  stack?: boolean;
  /** Overrides `theme.marks[mark]` for this layer, plus `color` for a fixed color. */
  style?: MarkStyle;
}

export type MarkStyle = { color?: string } & DeepPartial<
  Theme['marks']['line'] & Theme['marks']['bar'] & Theme['marks']['point'] & Theme['marks']['area']
>;

export interface ScaleSpec {
  type?: 'linear' | 'log' | 'time' | 'band';
  /** Explicit domain; `null` on one side keeps that side automatic. */
  domain?: [number | null, number | null];
  /** Extend the domain to round numbers. */
  nice?: boolean;
  /** Force the domain to include zero. */
  zero?: boolean;
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
  /** Click a legend entry to toggle its series. */
  legendToggle?: boolean;
}
