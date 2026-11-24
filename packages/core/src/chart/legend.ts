/**
 * The legend: its entries (one per series or mark entry, in color slot order), the ramp
 * of a continuous color, their placement on rows that wrap, and their drawing on the overlay.
 */
import type { SeriesData, LayerData } from '../marks/prepare';
import type { LegendRamp } from '../marks/registry';
import type { ClipRect, RGBA } from '../render/types';
import type { ChartSpec } from '../spec/types';
import type { Theme } from '../theme/theme';
import { sampleRamp, toCss } from '../util/color';
import { numberFormatter } from '../util/format';
import { font, type Built, type LegendEntry } from './types';

/**
 * Legend entries: series and mark entries, listed in the order of `known` (every entity
 * given a color, in the order met).
 */
export function legendEntries(built: Built[], known: Iterable<string>, seriesColor: (data: LayerData, s: SeriesData) => RGBA): LegendEntry[] {
  const entries = new Map<string, LegendEntry>();
  const owner = new Map<string, number>();
  for (const { data, def, mark } of built) {
    if (data.colorMode === 'series') {
      for (const s of data.series) {
        if (entries.has(s.key)) continue;
        entries.set(s.key, { key: s.key, color: seriesColor(data, s), symbol: def.symbol });
        owner.set(s.key, data.index);
      }
    }
    for (const e of mark.legend ?? []) {
      if (!entries.has(e.key)) entries.set(e.key, { key: e.key, color: e.color, color2: e.color2, symbol: def.symbol });
      // A cartesian mark that does not draw with its series color (candlesticks) says what its swatch shows.
      else if (!def.standalone && owner.get(e.key) === data.index) entries.set(e.key, { key: e.key, color: e.color, color2: e.color2, symbol: def.symbol });
    }
  }
  return [...known].map((k) => entries.get(k)!).filter(Boolean);
}

/**
 * Continuous color: the mark's own ramp, or (when the spec asks for a legend) the theme
 * ramp over the extent of a cartesian layer.
 */
export function legendRampOf(built: Built[], spec: ChartSpec, ramp: RGBA[]): LegendRamp | undefined {
  if (spec.legend === false) return undefined;
  const fields = spec.fields ?? {};
  for (const { data, def, mark } of built) {
    if (mark.legendRamp) return mark.legendRamp;
    const field = data.layer.encode.color;
    if (spec.legend !== true || def.standalone || data.index < 0 || data.colorMode !== 'continuous' || !field || data.layer.style?.color) continue;
    const f = numberFormatter(fields[field]?.format);
    return {
      colors: Array.from({ length: 9 }, (_, i) => sampleRamp(ramp, i / 8)),
      min: f(data.colorExtent[0]),
      max: f(data.colorExtent[1]),
      title: fields[field]?.label ?? field,
    };
  }
  return undefined;
}

/**
 * Widths of the parts of the legend's ramp: `title`, `min` label, the `bar`, `max` label
 * (legend font set). `width`: the chart's.
 */
export function rampParts(ctx: CanvasRenderingContext2D, theme: Theme, width: number, r: LegendRamp): { title: number; min: number; max: number; bar: number; width: number } {
  const min = ctx.measureText(r.min).width;
  const max = ctx.measureText(r.max).width;
  const bar = width < 420 ? 64 : 96;
  const body = min + 6 + bar + 6 + max;
  // The title gives way first when the row is too short for everything.
  let title = r.title ? ctx.measureText(r.title).width + 10 : 0;
  if (title + body > width - 2 * theme.padding) title = 0;
  return { title, min, max, bar, width: title + body };
}

/**
 * Place the legend from `top`, wrapping to as many rows as needed: sets each entry's
 * `rect`, returns the ramp's rectangle and the bottom of the last row.
 */
export function placeLegend(ctx: CanvasRenderingContext2D, theme: Theme, width: number, entries: LegendEntry[], ramp: LegendRamp | undefined, top: number): { rampRect?: ClipRect; bottom: number } {
  const pad = theme.padding;
  const l = theme.legend;
  ctx.font = font(l.label.weight, l.label.size, theme.font.family);
  const rowH = l.label.size * 1.7;
  let x = pad;
  let y = top;
  // A single entry says nothing (it shows only beside a ramp, which brings the legend on its own).
  for (const e of entries.length >= 2 ? entries : []) {
    const w = l.symbolSize + 6 + ctx.measureText(e.key).width;
    if (x > pad && x + w > width - pad) {
      x = pad;
      y += rowH;
    }
    e.rect = { x, y, width: w, height: rowH };
    x += w + l.itemGap;
  }
  let rampRect: ClipRect | undefined;
  if (ramp) {
    const w = rampParts(ctx, theme, width, ramp).width;
    if (x > pad && x + w > width - pad) {
      x = pad;
      y += rowH;
    }
    rampRect = { x, y, width: w, height: rowH };
  }
  return { rampRect, bottom: y + rowH };
}

/** Draw the entries placed by `placeLegend` (faded when `dim` says so), then the ramp. */
export function drawLegend(ctx: CanvasRenderingContext2D, theme: Theme, width: number, entries: LegendEntry[], dim: (key: string) => boolean, ramp: LegendRamp | undefined, rampRect: ClipRect | undefined): void {
  const l = theme.legend;
  ctx.font = font(l.label.weight, l.label.size, theme.font.family);
  ctx.textBaseline = 'middle';
  for (const e of entries.length >= 2 ? entries : []) {
    const r = e.rect!;
    const cy = r.y + r.height / 2;
    ctx.globalAlpha = dim(e.key) ? l.hiddenOpacity : 1;
    ctx.fillStyle = toCss(e.color);
    if (e.symbol === 'line') {
      ctx.fillRect(r.x, cy - 1, l.symbolSize + 2, 2);
    } else if (e.symbol === 'square') {
      ctx.beginPath();
      ctx.roundRect(r.x, cy - l.symbolSize / 2, l.symbolSize, l.symbolSize, 2);
      ctx.fill();
      if (e.color2) {
        // Two-tone swatch: the second color on the right half.
        ctx.fillStyle = toCss(e.color2);
        ctx.beginPath();
        ctx.roundRect(r.x + l.symbolSize / 2, cy - l.symbolSize / 2, l.symbolSize / 2, l.symbolSize, [0, 2, 2, 0]);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(r.x + l.symbolSize / 2, cy, l.symbolSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = l.label.color;
    ctx.fillText(e.key, r.x + l.symbolSize + 6, cy + 0.5);
  }
  ctx.globalAlpha = 1;
  if (ramp && rampRect) drawRamp(ctx, theme, width, ramp, rampRect);
}

export function drawRamp(ctx: CanvasRenderingContext2D, theme: Theme, width: number, r: LegendRamp, rect: ClipRect): void {
  const l = theme.legend;
  ctx.font = font(l.label.weight, l.label.size, theme.font.family);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const p = rampParts(ctx, theme, width, r);
  const cy = rect.y + rect.height / 2;
  let x = rect.x;
  ctx.fillStyle = l.label.color;
  if (p.title) {
    ctx.fillText(r.title!, x, cy + 0.5);
    x += p.title;
  }
  ctx.fillText(r.min, x, cy + 0.5);
  x += p.min + 6;
  const g = ctx.createLinearGradient(x, 0, x + p.bar, 0);
  const n = r.colors.length;
  r.colors.forEach((c, i) => g.addColorStop(n > 1 ? i / (n - 1) : 0, toCss(c)));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, cy - l.symbolSize / 2, p.bar, l.symbolSize, 2);
  ctx.fill();
  // A hairline around it: the pale end of a ramp would vanish into the surface.
  ctx.strokeStyle = theme.grid.y.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = l.label.color;
  ctx.fillText(r.max, x + p.bar + 6, cy + 0.5);
}
