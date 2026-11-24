/**
 * Axes: the grid (drawn by the GPU as lines, in pixel space) and, on the 2D overlay, the
 * axis lines, graduations and titles, the secondary value axis of a dual-axis chart included.
 */
import type { AxisSpec } from '../spec/types';
import { themeColor, type Theme } from '../theme/theme';
import { parseColor } from '../util/color';
import { ellipsize } from './labels';
import { font, type Layout } from './types';

/** Ink of an axis' graduations and title: its own `color`, or the theme's. */
export function axisInk(theme: Theme, axis: AxisSpec, fallback: string): string {
  return axis.color ? themeColor(theme, axis.color) : fallback;
}

/**
 * Grid lines across the plot at the graduations, in pixels, as `line` instances
 * (x0, y0, x1, y1, r, g, b, a, width): horizontal ones at `yTicks` when `rows`, vertical
 * ones at `xTicks` when `columns`. Graduations outside the plot (zoomed away) give none.
 */
export function gridLines(theme: Theme, L: Layout, rows: boolean, columns: boolean): number[] {
  const { plot, transform: T } = L;
  const grid: number[] = [];
  const addLine = (x0: number, y0: number, x1: number, y1: number, color: string, width: number) => {
    const c = parseColor(color);
    grid.push(x0, y0, x1, y1, c[0], c[1], c[2], c[3], width);
  };
  if (rows) {
    for (const t of L.yTicks) {
      const y = T.oy + t.t * T.sy;
      if (y >= plot.y - 0.5 && y <= plot.y + plot.height + 0.5) addLine(plot.x, y, plot.x + plot.width, y, theme.grid.y.color, theme.grid.y.width);
    }
  }
  if (columns) {
    for (const t of L.xTicks) {
      const x = T.ox + t.t * T.sx;
      if (x >= plot.x - 0.5 && x <= plot.x + plot.width + 0.5) addLine(x, plot.y, x, plot.y + plot.height, theme.grid.x.color, theme.grid.x.width);
    }
  }
  return grid;
}

/** What drawing the axes reads from the chart. */
export interface AxesInput {
  theme: Theme;
  /** The axes shown (null: none), the secondary one on dual-axis charts only. */
  axes: { x: AxisSpec | null; y: AxisSpec | null; secondary: AxisSpec | null };
  horizontal: boolean;
  /** The scales come from a standalone mark (no x axis line by default). */
  markScales: boolean;
  /** Categories on y: long names are cut with "…". */
  yBand: boolean;
  /** Compaction level (2 and more: no axis titles). */
  compact: number;
  /** A play bar under the plot: the x axis title goes above it. */
  timeline: boolean;
  width: number;
  height: number;
  /** Snap a coordinate for a line of width `w` to device pixels. */
  crisp: (v: number, w: number) => number;
}

/** Axis lines, graduation labels and titles of the x, y and secondary axes. */
export function drawAxes(ctx: CanvasRenderingContext2D, L: Layout, a: AxesInput): void {
  const { theme, width, height, crisp } = a;
  const { plot, transform: T } = L;
  const ff = theme.font.family;
  const pad = theme.padding;
  const lab = theme.axis.label;
  const ttl = theme.axis.title;
  const { x: xAxis, y: yAxis, secondary: axis2 } = a.axes;
  const bottom = plot.y + plot.height;

  // X axis.
  if (xAxis) {
    if (xAxis.line ?? (!a.horizontal && !a.markScales && theme.axis.line.visible)) {
      const w = theme.axis.line.width;
      const y = crisp(bottom, w);
      ctx.strokeStyle = theme.axis.line.color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.stroke();
    }
    if (xAxis.labels !== false) {
      ctx.font = font(lab.weight, lab.size, ff);
      ctx.fillStyle = axisInk(theme, xAxis, lab.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let lastRight = -Infinity;
      for (const t of L.xTicks) {
        // Empty labels (calendar weeks between months) take no room.
        if (!t.label) continue;
        const x = T.ox + t.t * T.sx;
        if (x < plot.x - 1 || x > plot.x + plot.width + 1) continue;
        const w = ctx.measureText(t.label).width;
        // Keep the label inside the chart, and skip it rather than overlap its neighbour.
        const cx = Math.min(width - 2 - w / 2, Math.max(2 + w / 2, x));
        if (cx - w / 2 < lastRight + 10) continue;
        if (theme.axis.tick.visible) {
          ctx.fillRect(crisp(x, 1) - 0.5, bottom, theme.axis.tick.width, theme.axis.tick.size);
        }
        ctx.fillText(t.label, cx, bottom + lab.padding);
        lastRight = cx + w / 2;
      }
    }
    if (xAxis.title && a.compact < 2) {
      ctx.font = font(ttl.weight, ttl.size, ff);
      ctx.fillStyle = axisInk(theme, xAxis, ttl.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      // Above the play bar when there is one.
      ctx.fillText(xAxis.title, plot.x + plot.width / 2, height - pad - (a.timeline ? 40 : 0));
    }
  }

  // Y axis.
  if (yAxis) {
    if (yAxis.line ?? (a.horizontal && theme.axis.line.visible)) {
      const w = theme.axis.line.width;
      const x = crisp(plot.x, w);
      ctx.strokeStyle = theme.axis.line.color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    if (yAxis.labels !== false) {
      ctx.font = font(lab.weight, lab.size, ff);
      ctx.fillStyle = axisInk(theme, yAxis, lab.color);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      // In a short plot (a small multiple), skip labels that would touch the previous one.
      let lastY = Infinity;
      for (const t of L.yTicks) {
        const y = T.oy + t.t * T.sy;
        if (y < plot.y - 1 || y > bottom + 1) continue;
        if (Math.abs(lastY - y) < lab.size + 3) continue;
        ctx.fillText(a.yBand ? ellipsize(ctx, t.label, width * 0.32) : t.label, plot.x - lab.padding, y + 0.5);
        lastY = y;
      }
    }
    if (yAxis.title && a.compact < 2) {
      ctx.save();
      ctx.font = font(ttl.weight, ttl.size, ff);
      ctx.fillStyle = axisInk(theme, yAxis, ttl.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.translate(pad, plot.y + plot.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(yAxis.title, 0, 0);
      ctx.restore();
    }
  }

  // Secondary value axis (dual-axis charts): right of the plot, or above it on a horizontal chart.
  if (axis2 && !a.horizontal) {
    const edge = plot.x + plot.width;
    if (axis2.line) {
      const w = theme.axis.line.width;
      const x = crisp(edge, w);
      ctx.strokeStyle = theme.axis.line.color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    if (axis2.labels !== false) {
      ctx.font = font(lab.weight, lab.size, ff);
      ctx.fillStyle = axisInk(theme, axis2, lab.color);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let lastY = Infinity;
      for (const t of L.ticks2) {
        const y = T.oy + t.t * T.sy;
        if (y < plot.y - 1 || y > bottom + 1) continue;
        if (Math.abs(lastY - y) < lab.size + 3) continue;
        ctx.fillText(t.label, edge + lab.padding, y + 0.5);
        lastY = y;
      }
    }
    if (axis2.title && a.compact < 2) {
      ctx.save();
      ctx.font = font(ttl.weight, ttl.size, ff);
      ctx.fillStyle = axisInk(theme, axis2, ttl.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.translate(width - pad, plot.y + plot.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(axis2.title, 0, 0);
      ctx.restore();
    }
  } else if (axis2) {
    if (axis2.line) {
      const w = theme.axis.line.width;
      const y = crisp(plot.y, w);
      ctx.strokeStyle = theme.axis.line.color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.stroke();
    }
    if (axis2.labels !== false) {
      ctx.font = font(lab.weight, lab.size, ff);
      ctx.fillStyle = axisInk(theme, axis2, lab.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      let lastRight = -Infinity;
      for (const t of L.ticks2) {
        const x = T.ox + t.t * T.sx;
        if (x < plot.x - 1 || x > plot.x + plot.width + 1) continue;
        const w = ctx.measureText(t.label).width;
        const cx = Math.min(width - 2 - w / 2, Math.max(2 + w / 2, x));
        if (cx - w / 2 < lastRight + 10) continue;
        ctx.fillText(t.label, cx, plot.y - lab.padding);
        lastRight = cx + w / 2;
      }
    }
    if (axis2.title && a.compact < 2) {
      ctx.font = font(ttl.weight, ttl.size, ff);
      ctx.fillStyle = axisInk(theme, axis2, ttl.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(axis2.title, plot.x + plot.width / 2, plot.y - lab.padding - (axis2.labels !== false ? lab.size + ttl.padding : 0));
    }
  }
}
