/**
 * Hover: which datums are under the pointer (CPU hit-testing on `HitData`), how they
 * read in a tooltip or an event (`HoverItem`), and the hover drawing on the overlay
 * (crosshair or category band, markers on the hovered points).
 */
import type { ShapeHit } from '../marks/registry';
import type { RGBA } from '../render/types';
import type { Scale } from '../scale/scales';
import type { ChartSpec } from '../spec/types';
import type { Theme } from '../theme/theme';
import { toCss } from '../util/color';
import { numberFormatter } from '../util/format';
import type { Built, HoverItem, Layout, Picked, Point } from './types';

/** Whether `p` falls in the plot, give or take `margin` px. */
export function inPlot(plot: { x: number; y: number; width: number; height: number } | undefined, p: Point, margin = 0): boolean {
  return !!plot && p.x >= plot.x - margin && p.x <= plot.x + plot.width + margin && p.y >= plot.y - margin && p.y <= plot.y + plot.height + margin;
}

/**
 * `x`: every series at the hovered category; `nearest`: the closest mark. The spec's
 * choice, else `nearest` on maps and on charts of points over a continuous axis.
 */
export function tooltipMode(spec: ChartSpec, geo: boolean, cat: Scale): 'x' | 'nearest' {
  const t = spec.interactions?.tooltip;
  if (typeof t === 'object' && t.mode) return t.mode;
  if (geo) return 'nearest';
  return spec.layers.length > 0 && spec.layers.every((l) => l.mark === 'point') && cat.band === 0 ? 'nearest' : 'x';
}

/**
 * The datums under the pointer `p` (px). Mode `nearest`: the closest one within 30 px.
 * Mode `x`: snap to the closest x along the category axis, then every series at that x
 * (a series drawn by several layers, a line and its points, is listed once).
 */
export function pickAt(p: Point, L: Layout | undefined, built: Built[], o: { mode: 'x' | 'nearest'; horizontal: boolean; cat: Scale }): Picked[] {
  if (!L || !inPlot(L.plot, p, 8)) return [];
  const T = L.transform;
  const { plot } = L;
  const H = o.horizontal;
  const visible = (c: number) => (H ? c >= plot.y - 1 && c <= plot.y + plot.height + 1 : c >= plot.x - 1 && c <= plot.x + plot.width + 1);
  if (o.mode === 'nearest') {
    let best: Picked | undefined;
    let bestD = 30 * 30;
    built.forEach((b, layer) => {
      const h = b.mark.hit;
      for (let i = 0; i < h.n; i++) {
        const dx = T.ox + h.tx[i] * T.sx - p.x;
        const dy = T.oy + h.ty[i] * T.sy - p.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { layer, index: i };
        }
      }
    });
    return best ? [best] : [];
  }
  // Mode `x`: snap to the closest x, then list every series at that x.
  let bestX = NaN;
  let bestD = Infinity;
  for (const b of built) {
    const h = b.mark.hit;
    for (let i = 0; i < h.n; i++) {
      // Distance along the category axis only.
      const c = H ? T.oy + o.cat.norm(h.x[i]) * T.sy : T.ox + o.cat.norm(h.x[i]) * T.sx;
      const d = Math.abs(c - (H ? p.y : p.x));
      if (d < bestD && visible(c)) {
        bestD = d;
        bestX = h.x[i];
      }
    }
  }
  if (Number.isNaN(bestX)) return [];
  // A series drawn by several layers (a line and its points) is listed once.
  const out: Picked[] = [];
  const seen = new Set<string>();
  built.forEach((b, layer) => {
    const h = b.mark.hit;
    for (let i = 0; i < h.n; i++) {
      if (h.x[i] !== bestX) continue;
      const id = `${b.data.series[h.series[i]].key}\u0000${h.value[i]}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ layer, index: i });
    }
  });
  return out;
}

/**
 * Every datum at the x of this chart's data closest to `x` (category axis, data units), as
 * another chart of a sync group hovers it; null when the chart has no datum at all.
 */
export function pickAtX(built: Built[], x: number): Picked[] | null {
  // The closest x of this chart's own data.
  let best = NaN;
  let bestD = Infinity;
  for (const b of built) {
    const h = b.mark.hit;
    for (let i = 0; i < h.n; i++) {
      const d = Math.abs(h.x[i] - x);
      if (d < bestD) [best, bestD] = [h.x[i], d];
    }
  }
  if (Number.isNaN(best)) return null;
  const picked: Picked[] = [];
  built.forEach((b, layer) => {
    const h = b.mark.hit;
    for (let i = 0; i < h.n; i++) if (h.x[i] === best) picked.push({ layer, index: i });
  });
  return picked;
}

/** The shape (a country on a map) at a point of scale space, topmost layer first. */
export function shapeAt(built: Built[], tx: number, ty: number): ShapeHit | undefined {
  for (let i = built.length - 1; i >= 0; i--) {
    const hit = built[i].mark.pick?.(tx, ty);
    if (hit) return hit;
  }
  return undefined;
}

/** What describing a datum reads from the chart. */
export interface DescribeInput {
  spec: ChartSpec;
  horizontal: boolean;
  cat: Scale;
  /** The primary value scale. */
  val: Scale;
  /** The value scale a layer is drawn with (the secondary one on a dual-axis chart). */
  valOf: (b: Built) => Scale;
}

/** The picked datums as the app sees them: series, x, value, both formatted, color and row. */
export function describeItems(picked: Picked[], built: Built[], o: DescribeInput): HoverItem[] {
  const { spec, cat } = o;
  const fields = spec.fields ?? {};
  return picked.map((p) => {
    const b = built[p.layer];
    const h = b.mark.hit;
    const i = p.index;
    const raw = h.x[i];
    const enc = b.data.layer.encode;
    const vField = (o.horizontal ? enc.x : enc.y) ?? '';
    // Each value is formatted with its own field, then with the axis it is read on.
    const val = o.valOf(b);
    const axisFmt = ((val !== o.val ? spec.axes?.secondary : o.horizontal ? spec.axes?.x : spec.axes?.y) || undefined)?.format;
    const fmt = val.type === 'time' ? (v: number) => val.format(v) : numberFormatter(fields[vField]?.format ?? axisFmt);
    // A range (Gantt, waterfall) reads "start → end".
    const valueLabel = h.value2 ? `${fmt(h.value[i])} → ${fmt(h.value2[i])}` : fmt(h.value[i]);
    return {
      layer: p.layer,
      series: b.data.series[h.series[i]].key,
      x: cat.type === 'band' ? cat.format(raw) : cat.type === 'time' ? new Date(raw) : raw,
      xLabel: cat.format(raw),
      value: h.value[i],
      valueLabel,
      color: toCss([h.color[i * 4], h.color[i * 4 + 1], h.color[i * 4 + 2], 1]),
      row: b.data.table.row(h.row[i]),
    };
  });
}

/** Smallest gap between two distinct x positions among banded layers (normalized), 0.05 when there is none. */
export function xStepNorm(built: Built[], cat: Scale): number {
  let step = Infinity;
  for (const b of built) {
    if (!b.def.banded) continue;
    for (const s of b.data.series) {
      for (let i = 1; i < s.x.length; i++) {
        const d = Math.abs(cat.norm(s.x[i]) - cat.norm(s.x[i - 1]));
        if (d > 0 && d < step) step = d;
      }
    }
  }
  return Number.isFinite(step) ? step : 0.05;
}

/** Crosshair (or category band) at the hovered x in mode `x`, then a marker on each hovered point. */
export function drawHover(ctx: CanvasRenderingContext2D, theme: Theme, L: Layout, built: Built[], picked: Picked[], o: { mode: 'x' | 'nearest'; crosshair: boolean; horizontal: boolean; cat: Scale }): void {
  if (picked.length === 0) return;
  const { plot, transform: T } = L;
  const first = built[picked[0].layer].mark.hit;
  const fx = first.x[picked[0].index];
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y - 6, plot.width, plot.height + 12);
  ctx.clip();

  if (o.mode === 'x' && o.crosshair) {
    const H = o.horizontal;
    const c = H ? T.oy + o.cat.norm(fx) * T.sy : T.ox + o.cat.norm(fx) * T.sx;
    const hasBand = built.some((b) => b.def.banded);
    if (hasBand) {
      const span = o.cat.band > 0 ? o.cat.band / (1 - theme.marks.bar.bandPadding) : xStepNorm(built, o.cat);
      const w = Math.abs(span * (H ? T.sy : T.sx));
      ctx.fillStyle = theme.hover.bandFill;
      if (H) ctx.fillRect(plot.x, c - w / 2, plot.width, w);
      else ctx.fillRect(c - w / 2, plot.y, w, plot.height);
    } else if (theme.crosshair.visible) {
      const cw = theme.crosshair.width;
      ctx.fillStyle = theme.crosshair.color;
      if (H) ctx.fillRect(plot.x, Math.round(c) - cw / 2, plot.width, cw);
      else ctx.fillRect(Math.round(c) - cw / 2, plot.y, cw, plot.height);
    }
  }

  const surface = theme.background === 'transparent' ? '#fff' : theme.background;
  for (const p of picked) {
    const b = built[p.layer];
    if (b.def.banded) continue;
    const hit = b.mark.hit;
    const x = T.ox + hit.tx[p.index] * T.sx;
    const y = T.oy + hit.ty[p.index] * T.sy;
    const c: RGBA = [hit.color[p.index * 4], hit.color[p.index * 4 + 1], hit.color[p.index * 4 + 2], 1];
    ctx.beginPath();
    ctx.arc(x, y, theme.hover.markerSize / 2 + 2, 0, Math.PI * 2);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, theme.hover.markerSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = toCss(c);
    ctx.fill();
  }
  ctx.restore();
}
