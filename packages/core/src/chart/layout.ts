/**
 * Layout of a chart: title block, legend rows, room for the axes and their titles, the plot,
 * the letterboxed view of a chart with an imposed aspect ratio, and the view transform.
 * Compaction on small screens: when the plot would be cramped, the chart gives up, in order,
 * its subtitle, its axis titles, then its legend (`autoCompact: false` keeps everything).
 */
import type { LegendRamp } from '../marks/registry';
import type { ClipRect, ViewTransform } from '../render/types';
import type { Scale, Tick } from '../scale/scales';
import type { AxisSpec, ChartSpec } from '../spec/types';
import type { Theme } from '../theme/theme';
import { truncateText } from './labels';
import { placeLegend } from './legend';
import type { SyncMargins } from './sync';
import { font, type Built, type Layout, type LegendEntry, type Zoom } from './types';

/** What the layout reads from the chart. */
export interface LayoutInput {
  ctx: CanvasRenderingContext2D;
  theme: Theme;
  spec: ChartSpec;
  zoom: Zoom;
  width: number;
  height: number;
  legend: LegendEntry[];
  legendRamp?: LegendRamp;
  /** The spec or theme shows a legend and there is something in it (before compaction). */
  legendWanted: boolean;
  /** The axes shown (null: none), the secondary one on dual-axis charts only. */
  axes: { x: AxisSpec | null; y: AxisSpec | null; secondary: AxisSpec | null };
  horizontal: boolean;
  xScale: Scale;
  yScale: Scale;
  val2?: Scale;
  /** A play bar takes room at the bottom. */
  timeline: boolean;
  /** Built layers (line end labels need room on the right). */
  built: Built[];
  aspect?: number;
  /** The margins the other charts of a sync group ask for, when the plots align. */
  group?: () => { left: number; right: number };
}

export interface LayoutResult {
  layout: Layout;
  /** Compaction level reached: 1 without subtitle, 2 without axis titles, 3 without legend. */
  compact: number;
  /** Room the chart needs beside its plot, before aligning with its group. */
  ownMargins: SyncMargins;
  /** The legend was placed (its entries' `rect` set) at some level; `rampRect`: where its ramp went then. */
  legendPlaced: boolean;
  rampRect?: ClipRect;
}

/** Lay out at the first compaction level whose plot is readable. */
export function computeLayout(a: LayoutInput): LayoutResult {
  const auto = a.spec.autoCompact !== false;
  let r!: ReturnType<typeof layoutAt>;
  let compact = 0;
  let legendPlaced = false;
  let rampRect: ClipRect | undefined;
  for (let level = 0; level <= (auto ? 3 : 0); level++) {
    compact = level;
    r = layoutAt(a, level);
    if (r.legendPlaced) {
      legendPlaced = true;
      rampRect = r.rampRect;
    }
    if (r.layout.plot.width >= 120 && r.layout.plot.height >= 90) break;
  }
  return { layout: r.layout, compact, ownMargins: r.ownMargins, legendPlaced, rampRect };
}

function layoutAt(a: LayoutInput, compact: number): { layout: Layout; ownMargins: SyncMargins; rampRect?: ClipRect; legendPlaced: boolean } {
  const { theme, ctx, spec, zoom, width, height } = a;
  const pad = theme.padding;
  const ff = theme.font.family;
  let top = pad;
  const titleY = top;
  if (spec.title) top += theme.title.size * 1.3;
  if (spec.subtitle && compact < 1) top += theme.subtitle.size * 1.5;
  if (spec.title || (spec.subtitle && compact < 1)) top += theme.title.gap;

  // Legend: wraps to as many rows as needed.
  const legendY = top;
  let rampRect: ClipRect | undefined;
  const legendPlaced = a.legendWanted && compact < 3;
  if (legendPlaced) {
    const placed = placeLegend(ctx, theme, width, a.legend, a.legendRamp, top);
    rampRect = placed.rampRect;
    // The top graduation of the value axis is centered on the plot's edge: room for its upper half.
    top = placed.bottom + 8 + (a.axes.y ? Math.ceil(theme.axis.label.size / 2) : 0);
  }

  const { x: xAxis, y: yAxis, secondary: axis2 } = a.axes;
  const lab = theme.axis.label;
  const ttl = theme.axis.title;
  // Horizontal dual-axis chart: the second value axis runs along the top of the plot.
  if (axis2 && a.horizontal) {
    if (axis2.labels !== false) top += lab.size + lab.padding;
    if (axis2.title && compact < 2) top += ttl.size + ttl.padding;
  }
  let bottom = pad;
  if (a.timeline) bottom += 40;
  if (xAxis && xAxis.labels !== false) bottom += lab.size + lab.padding;
  if (xAxis?.title && compact < 2) bottom += ttl.size + ttl.padding;
  const plotH = Math.max(10, height - top - bottom);

  const vy0 = -zoom.ty / zoom.ky;
  const vy1 = (1 - zoom.ty) / zoom.ky;
  const yCount = yAxis?.tickCount ?? Math.min(10, Math.max(2, Math.round(plotH / 56)));
  const yTicks = a.yScale.ticks(vy0, vy1, yCount);

  let left = pad;
  if (yAxis && yAxis.labels !== false) {
    ctx.font = font(lab.weight, lab.size, ff);
    let w = 0;
    for (const t of yTicks) w = Math.max(w, ctx.measureText(t.label).width);
    // Long category names (a Gantt's tasks) never take more than a third of the width: they are cut with "…".
    left += Math.ceil(a.yScale.type === 'band' ? Math.min(w, width * 0.32) : w) + lab.padding;
  }
  if (yAxis?.title && compact < 2) left += ttl.size + ttl.padding;
  // Room on the right for direct labels at the end of lines.
  let endRoom = 0;
  for (const b of a.built) {
    if (!b.data.layer.style?.endLabels) continue;
    ctx.font = font(500, 11, ff);
    for (const s of b.data.series) if (!s.hidden) endRoom = Math.max(endRoom, ctx.measureText(s.key).width + 14);
  }
  // Dual axis: the second value axis takes its room on the right, like the first one on the left.
  let ticks2: Tick[] = [];
  let right = 0;
  if (axis2 && !a.horizontal) {
    ticks2 = a.val2!.ticks(vy0, vy1, axis2.tickCount ?? yCount);
    if (axis2.labels !== false) {
      ctx.font = font(lab.weight, lab.size, ff);
      let w = 0;
      for (const t of ticks2) w = Math.max(w, ctx.measureText(t.label).width);
      right += Math.ceil(w) + lab.padding;
    }
    if (axis2.title && compact < 2) right += ttl.size + ttl.padding;
  }
  let plotW = Math.max(10, width - left - pad - 4 - endRoom - right);
  // Stacked charts of a sync group: the widest margins of the group, so that the plots share their edges.
  const ownMargins: SyncMargins = { left, right: width - left - plotW, width };
  const g = a.group?.();
  if (g) {
    const moreLeft = Math.max(0, g.left - left);
    const moreRight = Math.max(0, g.right - ownMargins.right);
    if (moreLeft || moreRight) {
      left += moreLeft;
      plotW = Math.max(10, plotW - moreLeft - moreRight);
    }
  }
  const plot = { x: left, y: top, width: plotW, height: plotH };

  const vx0 = -zoom.tx / zoom.kx;
  const vx1 = (1 - zoom.tx) / zoom.kx;
  const xCount = xAxis?.tickCount ?? Math.min(12, Math.max(2, Math.round(plotW / 90)));
  const xTicks = a.xScale.ticks(vx0, vx1, xCount);
  if (axis2 && a.horizontal) ticks2 = a.val2!.ticks(vx0, vx1, axis2.tickCount ?? xCount);

  // With an imposed aspect ratio, letterbox the view inside the plot.
  let view: ClipRect = plot;
  if (a.aspect) {
    const w = Math.min(plotW, plotH * a.aspect);
    const h = w / a.aspect;
    view = { x: left + (plotW - w) / 2, y: top + (plotH - h) / 2, width: w, height: h };
  }
  // Axes must hug a letterboxed view (calendar), not the empty plot around it.
  const shown = a.aspect && (a.axes.x || a.axes.y);
  const plotOut = shown ? view : plot;
  const transform: ViewTransform = {
    sx: zoom.kx * view.width,
    ox: view.x + zoom.tx * view.width,
    sy: -zoom.ky * view.height,
    oy: view.y + view.height - zoom.ty * view.height,
  };
  return { layout: { plot: plotOut, view, titleY, legendY, xTicks, yTicks, ticks2, transform }, ownMargins, rampRect, legendPlaced };
}

/** Title and subtitle (not at compaction level 1 and more); too long for the chart, they end with "…". */
export function drawTitles(ctx: CanvasRenderingContext2D, theme: Theme, spec: ChartSpec, L: Layout, width: number, compact: number): void {
  const ff = theme.font.family;
  const pad = theme.padding;
  const headline = (text: string) => truncateText(text, width - theme.padding - 4, (t) => ctx.measureText(t).width);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let ty = L.titleY;
  if (spec.title) {
    ctx.font = font(theme.title.weight, theme.title.size, ff);
    ctx.fillStyle = theme.title.color;
    ctx.fillText(headline(spec.title), pad, ty);
    ty += theme.title.size * 1.3;
  }
  if (spec.subtitle && compact < 1) {
    ctx.font = font(theme.subtitle.weight, theme.subtitle.size, ff);
    ctx.fillStyle = theme.subtitle.color;
    ctx.fillText(headline(spec.subtitle), pad, ty + theme.subtitle.size * 0.2);
  }
}
