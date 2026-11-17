import type { Table } from '../data/table';
import type { Batch, Renderer, RGBA } from '../render/types';
import type { Scale } from '../scale/scales';
import type { FieldSpec, LayerSpec } from '../spec/types';
import type { Theme } from '../theme/theme';
import type { LayerData, SeriesData } from './prepare';

/** Everything a mark needs to turn prepared data into GPU batches. */
export interface BuildContext {
  renderer: Renderer;
  data: LayerData;
  /**
   * Category scale (the x axis, or the y axis of a horizontal chart). Raw
   * `series.x` values go through it.
   */
  x: Scale;
  /** Value scale (the y axis, or the x axis of a horizontal chart). `y0` / `y1` go through it. */
  y: Scale;
  /** Bars run left to right, categories down the y axis. */
  horizontal: boolean;
  /** Scale space position of (category, value), both already normalized. Swaps them when horizontal. */
  pos(c: number, v: number): [number, number];
  theme: Theme;
  /** `theme.marks[mark]` merged with the layer's `style`. */
  style: Record<string, any>;
  /** Chart surface color (gaps and rings are drawn with it). */
  surface: RGBA;
  /** Color of datum `i` of a series (handles series and continuous color). */
  color(series: SeriesData, i: number): RGBA;
  /** Point diameter in px for datum `i`. */
  size(series: SeriesData, i: number): number;
  /** Normalized width of one x step on a continuous scale (bar thickness). */
  xStep: number;
  /** Sample the theme's sequential ramp at t in [0, 1]. */
  ramp(t: number): RGBA;
  /** The spec's field catalog (labels, formats). */
  fields: Record<string, FieldSpec>;
  /** Fixed categorical color of an entity: same entity, same color, across layers and filters. */
  categorical(key: string): RGBA;
  /** Entities toggled off in the legend. */
  hidden: Set<string>;
  /** Format a value of `field` (default: the layer's value field) with its catalog format. */
  format(value: number, field?: string): string;
  /** Size of one CSS pixel in scale space at the current size, unzoomed. */
  pixel: [number, number];
  /** State that survives rebuilds of this layer (resize, data refresh): drill-down focus, filters. */
  state: Record<string, unknown>;
}

/**
 * Text drawn over the marks. Positions are in scale space, so labels follow
 * zoom and resize. A label with a `box` is only drawn when it fits inside.
 */
export interface MarkLabel {
  tx: number;
  ty: number;
  text: string;
  /** Fill under the text: ink is then white or near-black, whichever reads. Otherwise secondary ink. */
  on?: RGBA;
  /** Explicit ink color. */
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Pixel offsets. */
  dx?: number;
  dy?: number;
  size?: number;
  weight?: number | string;
  /** [x0, y0, x1, y1] in scale space. */
  box?: [number, number, number, number];
  /** Drawn instead when this label does not fit its box (e.g. outside a bar that is too short). */
  fallback?: MarkLabel;
  /** Spread apart from other `avoid` labels at the same x, with a leader line when moved (line ends). */
  avoid?: boolean;
}

/** What a standalone mark tells the chart about its own coordinate system. */
export interface MarkScales {
  x: Scale;
  y: Scale;
  /** Width / height to keep (pie, gauge, radar). */
  aspect?: number;
  /** Which axes to draw. Default none. */
  axes?: { x?: boolean; y?: boolean };
}

/** Per-datum lookup used for hover, tooltips and events. Positions are in scale space. */
export interface HitData {
  n: number;
  tx: Float32Array;
  ty: Float32Array;
  x: Float64Array;
  value: Float64Array;
  row: Int32Array;
  /** Index into `LayerData.series`. */
  series: Int32Array;
  /** rgba per datum. */
  color: Float32Array;
  /** Start of each range (ranged layers only). */
  value2?: Float64Array;
}

export interface MarkDraw {
  batch: Batch;
  pixelSnap?: boolean;
  /**
   * Instance i of this batch is datum i of the mark's hit data. Set it (with
   * `data`) and the mark becomes selectable: the chart dims the batch and
   * redraws the selected instances from `data`.
   */
  perDatum?: boolean;
  data?: Float32Array;
}

/** What a shape mark reports under the pointer (tooltip content). */
export interface ShapeHit {
  title: string;
  rows: { label: string; value: string }[];
}

export interface BuiltMark {
  draws: MarkDraw[];
  hit: HitData;
  labels?: MarkLabel[];
  /** Legend entries of a standalone mark (pie slices, treemap groups). */
  legend?: { key: string; color: RGBA }[];
  /** Hit-test a position in scale space, for marks that are areas rather than data points. */
  pick?(tx: number, ty: number): ShapeHit | null;
  /**
   * A click at a position in scale space. Return the new focus path (`[]` for
   * everything) when the mark handled it, `undefined` otherwise.
   */
  click?(tx: number, ty: number): string[] | undefined;
  /** Advance the mark's own animation to `now`; true while it is still moving. */
  animate?(now: number): boolean;
  /** Legend entries to show dimmed because the mark's own focus leaves them out. */
  muted?(): string[];
}

export interface MarkDefinition {
  /** The mark grows from a zero baseline (the y domain must include 0). */
  baseline?: boolean;
  /** The mark has a thickness along x (the x domain is padded by half a step). */
  banded?: boolean;
  /**
   * The mark does not use the x / y encodings (shapes, later pies and treemaps):
   * the chart skips series preparation and hands it the raw layer.
   */
  standalone?: boolean;
  /** Theme entry to style the mark from, when it differs from the mark name (`pie` and `donut` use `arc`). */
  themeKey?: string;
  /** Standalone marks: the scales (and axes) the chart should use. */
  scales?(input: { layer: LayerSpec; table: Table; fields: Record<string, FieldSpec> }): MarkScales;
  /** The layout depends on the chart size (treemap): rebuild on resize. A function decides per layer. */
  sizeDependent?: boolean | ((layer: LayerSpec) => boolean);
  /** Legend and hover symbol. */
  symbol?: 'line' | 'circle' | 'square';
  build(ctx: BuildContext): BuiltMark;
}

const registry = new Map<string, MarkDefinition>();

/** Add a mark type. The spec can then use it by name: `{ mark: 'my-mark', ... }`. */
export function registerMark(name: string, definition: MarkDefinition): void {
  registry.set(name, definition);
}

export function hasMark(name: string): boolean {
  return registry.has(name);
}

export function getMark(name: string): MarkDefinition {
  const m = registry.get(name);
  if (!m) throw new Error(`futurCharts: unknown mark "${name}". Registered: ${[...registry.keys()].join(', ')}`);
  return m;
}

export function emptyHit(): HitData {
  return { n: 0, tx: new Float32Array(0), ty: new Float32Array(0), x: new Float64Array(0), value: new Float64Array(0), row: new Int32Array(0), series: new Int32Array(0), color: new Float32Array(0) };
}

/** Default hit data: one entry per datum at (category, y1). `catOf` overrides the category position (grouped bars). */
export function buildHit(
  ctx: BuildContext,
  catOf?: (series: SeriesData, seriesIndex: number, i: number) => number,
): HitData {
  let n = 0;
  for (const s of ctx.data.series) if (!s.hidden) n += s.x.length;
  const hit: HitData = {
    n,
    tx: new Float32Array(n),
    ty: new Float32Array(n),
    x: new Float64Array(n),
    value: new Float64Array(n),
    row: new Int32Array(n),
    series: new Int32Array(n),
    color: new Float32Array(n * 4),
    value2: ctx.data.ranged ? new Float64Array(n) : undefined,
  };
  let k = 0;
  ctx.data.series.forEach((s, si) => {
    if (s.hidden) return;
    for (let i = 0; i < s.x.length; i++, k++) {
      const [tx, ty] = ctx.pos(catOf ? catOf(s, si, i) : ctx.x.norm(s.x[i]), ctx.y.norm(s.y1[i]));
      hit.tx[k] = tx;
      hit.ty[k] = ty;
      hit.x[k] = s.x[i];
      hit.value[k] = s.value[i];
      if (hit.value2) hit.value2[k] = s.y0[i];
      hit.row[k] = s.rows[i];
      hit.series[k] = si;
      hit.color.set(ctx.color(s, i), k * 4);
    }
  });
  return hit;
}
