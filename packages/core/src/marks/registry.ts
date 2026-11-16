import type { Batch, Renderer, RGBA } from '../render/types';
import type { Scale } from '../scale/scales';
import type { Theme } from '../theme/theme';
import type { LayerData, SeriesData } from './prepare';

/** Everything a mark needs to turn prepared data into GPU batches. */
export interface BuildContext {
  renderer: Renderer;
  data: LayerData;
  x: Scale;
  y: Scale;
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
}

export interface MarkDraw {
  batch: Batch;
  pixelSnap?: boolean;
}

export interface BuiltMark {
  draws: MarkDraw[];
  hit: HitData;
}

export interface MarkDefinition {
  /** The mark grows from a zero baseline (the y domain must include 0). */
  baseline?: boolean;
  /** The mark has a thickness along x (the x domain is padded by half a step). */
  banded?: boolean;
  /** Legend and hover symbol. */
  symbol?: 'line' | 'circle' | 'square';
  build(ctx: BuildContext): BuiltMark;
}

const registry = new Map<string, MarkDefinition>();

/** Add a mark type. The spec can then use it by name: `{ mark: 'my-mark', ... }`. */
export function registerMark(name: string, definition: MarkDefinition): void {
  registry.set(name, definition);
}

export function getMark(name: string): MarkDefinition {
  const m = registry.get(name);
  if (!m) throw new Error(`futurCharts: unknown mark "${name}". Registered: ${[...registry.keys()].join(', ')}`);
  return m;
}

/** Default hit data: one entry per datum at (x, y1). `tx` can be overridden (bars). */
export function buildHit(
  ctx: BuildContext,
  txOf?: (series: SeriesData, seriesIndex: number, i: number) => number,
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
  };
  let k = 0;
  ctx.data.series.forEach((s, si) => {
    if (s.hidden) return;
    for (let i = 0; i < s.x.length; i++, k++) {
      hit.tx[k] = txOf ? txOf(s, si, i) : ctx.x.norm(s.x[i]);
      hit.ty[k] = ctx.y.norm(s.y1[i]);
      hit.x[k] = s.x[i];
      hit.value[k] = s.value[i];
      hit.row[k] = s.rows[i];
      hit.series[k] = si;
      hit.color.set(ctx.color(s, i), k * 4);
    }
  });
  return hit;
}
