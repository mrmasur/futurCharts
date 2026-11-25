/**
 * Zoom and pan: the arithmetic on `Zoom` (normalized scale and offset of the view
 * along each axis). Only the view transform changes, never the batches. Pure.
 */
import type { Scale } from '../scale/scales';
import type { ChartSpec } from '../spec/types';
import type { Built, Point, Zoom } from './types';

export interface ZoomConfig {
  axes: 'x' | 'y' | 'xy';
  max: number;
}

/** `interactions.zoom` read; a diagram opened zoomed in (`minViewWidth`) can at least be panned. */
export function zoomConfig(spec: ChartSpec, minViewWidth: number | undefined, zoom: Zoom): ZoomConfig | null {
  const z = spec.interactions?.zoom;
  // A diagram opened zoomed in can at least be panned.
  if (!z) return minViewWidth ? { axes: 'xy', max: Math.max(1, zoom.kx) } : null;
  return { axes: (typeof z === 'object' && z.axes) || 'x', max: (typeof z === 'object' && z.max) || 200 };
}

/** Does this wheel event zoom the chart? With `zoom.wheel: 'modifier'`, only with Ctrl or Cmd held. */
export function wheelZooms(spec: ChartSpec, e: { ctrlKey?: boolean; metaKey?: boolean }): boolean {
  const z = spec.interactions?.zoom;
  if (typeof z === 'object' && z.wheel === 'modifier') return !!(e.ctrlKey || e.metaKey);
  return true;
}

/** Keep the view over the data: no panning past either end. */
export function clampPan(z: Zoom): void {
  z.tx = Math.min(0, Math.max(1 - z.kx, z.tx));
  z.ty = Math.min(0, Math.max(1 - z.ky, z.ty));
}

/** The visible part of the normalized x axis. */
export function visibleX(z: Zoom): [number, number] {
  return [-z.tx / z.kx, (1 - z.tx) / z.kx];
}

/** Pan by a pointer move of `dx`, `dy` px along the configured axes, inside `view`. */
export function panBy(z: Zoom, cfg: ZoomConfig, dx: number, dy: number, view: { width: number; height: number }): void {
  if (cfg.axes !== 'y') z.tx += dx / view.width;
  if (cfg.axes !== 'x') z.ty -= dy / view.height;
}

/**
 * Zoom by `factor` around the pointer `p` (px) along the configured axes, inside `view`
 * (the rectangle the unzoomed scale space maps to).
 */
export function zoomAt(z: Zoom, cfg: ZoomConfig, p: Point, view: { x: number; y: number; width: number; height: number }, factor: number): void {
  if (cfg.axes !== 'y') {
    const f = (p.x - view.x) / view.width;
    const t = (f - z.tx) / z.kx;
    z.kx = Math.min(cfg.max, Math.max(1, z.kx * factor));
    z.tx = f - t * z.kx;
  }
  if (cfg.axes !== 'x') {
    const f = (view.y + view.height - p.y) / view.height;
    const t = (f - z.ty) / z.ky;
    z.ky = Math.min(cfg.max, Math.max(1, z.ky * factor));
    z.ty = f - t * z.ky;
  }
}

/** What fitting the value axis to the visible range reads from the chart. */
export interface FitInput {
  spec: ChartSpec;
  horizontal: boolean;
  markScales: boolean;
  geo: boolean;
  built: Built[];
  cat: Scale;
  /** The value scale a layer is drawn with. */
  valOf: (b: Built) => Scale;
}

/**
 * Zoomed along x only, the value axis follows what is visible (as a stock chart
 * does): it is only the view transform that changes, never the batches.
 * Off with `interactions.zoom.fitY: false`.
 */
export function fitY(z: Zoom, a: FitInput): void {
  const cfg = a.spec.interactions?.zoom;
  const axes = typeof cfg === 'object' ? (cfg.axes ?? 'x') : 'x';
  const want = typeof cfg === 'object' ? cfg.fitY !== false : true;
  if (!want || axes !== 'x' || a.horizontal || a.markScales || a.geo) return;
  if (z.kx <= 1 + 1e-6) {
    z.ky = 1;
    z.ty = 0;
    return;
  }
  const v0 = -z.tx / z.kx;
  const v1 = (1 - z.tx) / z.kx;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of a.built) {
    if (b.def.standalone) continue;
    // Bars, areas, stacks and ranges span from y0; lines and points are just y1.
    const spans = b.data.stacked || b.data.ranged || !!b.def.baseline;
    // Both value axes share the normalized space: the window fits the layers of the two.
    const val = a.valOf(b);
    for (const s of b.data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const x = a.cat.norm(s.x[i]);
        if (x < v0 || x > v1) continue;
        const y1 = val.norm(s.y1[i]);
        const y0 = spans ? val.norm(s.y0[i]) : y1;
        lo = Math.min(lo, y0, y1);
        hi = Math.max(hi, y0, y1);
      }
    }
  }
  if (!(hi > lo)) return;
  const pad = (hi - lo) * 0.08;
  lo = Math.max(0, lo - pad);
  hi = Math.min(1, hi + pad);
  z.ky = 1 / (hi - lo);
  z.ty = -lo * z.ky;
}
