/**
 * Labels on the overlay. First text fitting: cutting a text with "…" and the bounding box of
 * a rotated text, pure (the caller supplies how to measure), so it is tested on its own.
 * Then the drawing of the marks' labels (`MarkLabel`): styling, spreading the labels that
 * must not overlap (line ends), fitting a label in its box, and leaving out a label that
 * would cover another one.
 */
import { luminance } from '../marks/primitives';
import type { MarkLabel } from '../marks/registry';
import type { RGBA } from '../render/types';
import type { LayerSpec } from '../spec/types';
import { themeColor, type Theme } from '../theme/theme';
import { parseColor } from '../util/color';
import { font, type Built, type Layout } from './types';

export const ELLIPSIS = '…';

/**
 * The longest version of `text` that `fits`: the whole text, else a prefix ended
 * by "…", else `null` when not even one character and the ellipsis fit.
 * `fits` must be monotonic (a shorter text fits whenever a longer one does).
 */
export function fitText(text: string, fits: (candidate: string) => boolean): string | null {
  if (fits(text)) return text;
  const chars = [...text];
  const cut = (n: number) => `${chars.slice(0, n).join('').trimEnd()}${ELLIPSIS}`;
  if (chars.length < 2 || !fits(cut(1))) return null;
  // Binary search on the number of characters kept.
  let lo = 1;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(cut(mid))) lo = mid;
    else hi = mid - 1;
  }
  return cut(lo);
}

/**
 * Cut a text to `max` px with "…". Always returns something to draw: at worst the
 * first character and the ellipsis (a title is never dropped).
 */
export function truncateText(text: string, max: number, measure: (t: string) => number): string {
  return fitText(text, (t) => measure(t) <= max) ?? (text.length > 1 ? `${[...text][0]}${ELLIPSIS}` : text);
}

/** Cut a text to a width, with "…", one character at a time (axis category names). */
export function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Axis-aligned bounding box of a text rectangle rotated around its anchor.
 * `left` / `top`: the rectangle's corner relative to the anchor (they carry the
 * alignment); `deg`: clockwise on screen (y down), as the canvas rotates. The
 * result is relative to the anchor too.
 */
export function rotatedBounds(left: number, top: number, width: number, height: number, deg: number): Bounds {
  if (!deg) return { x0: left, y0: top, x1: left + width, y1: top + height };
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of [[left, top], [left + width, top], [left, top + height], [left + width, top + height]]) {
    const x = px * cos - py * sin;
    const y = px * sin + py * cos;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Corners of a text rectangle rotated around its anchor (same arguments as `rotatedBounds`), in order around it. */
export function rotatedCorners(left: number, top: number, width: number, height: number, deg: number): [number, number][] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const at = (px: number, py: number): [number, number] => [px * cos - py * sin, px * sin + py * cos];
  return [at(left, top), at(left + width, top), at(left + width, top + height), at(left, top + height)];
}

/**
 * Whether two convex polygons overlap (separating axis test). Turned labels are compared by
 * their real outline: bounding boxes alone would make neighbours around a circle collide.
 */
export function polygonsOverlap(a: [number, number][], b: [number, number][]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      // Normal of the edge: the polygons are apart when their projections on it do not meet.
      const nx = y1 - y0;
      const ny = x0 - x1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, y] of a) {
        const d = x * nx + y * ny;
        if (d < a0) a0 = d;
        if (d > a1) a1 = d;
      }
      for (const [x, y] of b) {
        const d = x * nx + y * ny;
        if (d < b0) b0 = d;
        if (d > b1) b1 = d;
      }
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

// ------------------------------------------------------------ drawing on the overlay

/** Box of a label drawn this frame: a label overlapping one of them is left out. */
type Placed = { x0: number; y0: number; x1: number; y1: number; quad?: [number, number][] };

/** Labels the marks asked for. A label with a box is drawn only if it fits inside it. */
export function drawMarkLabels(ctx: CanvasRenderingContext2D, theme: Theme, built: Built[], L: Layout, width: number, progress: { enter: number; morph: number }): void {
  const T = L.transform;
  // Labels fade in at the end of the entry animation, and come back after a transition
  // (they are placed for the new state: drawn while bars move, they would point at nothing).
  if (progress.enter < 0.75 || progress.morph < 1) return;
  const placed: Placed[] = [];
  ctx.save();
  ctx.globalAlpha = Math.min(1, (progress.enter - 0.75) / 0.25);
  const avoid: { l: MarkLabel; ax: number; ay: number; y: number }[] = [];
  for (const b of built) {
    const style = labelStyler(theme, b.data.layer);
    for (const l0 of b.mark.labels ?? []) {
      const l = style(l0);
      if (!l.avoid) {
        drawLabel(ctx, theme, l, L, width, placed);
        continue;
      }
      const ax = T.ox + l.tx * T.sx;
      const ay = T.oy + l.ty * T.sy;
      avoid.push({ l, ax, ay, y: ay + (l.dy ?? 0) });
    }
  }
  // Labels that must not overlap (line ends): spread them apart vertically,
  // and tie a moved label to its anchor with a leader line.
  if (avoid.length) {
    const columns = new Map<number, typeof avoid>();
    for (const a of avoid) {
      const key = Math.round(a.ax / 4);
      let c = columns.get(key);
      if (!c) columns.set(key, (c = []));
      c.push(a);
    }
    for (const c of columns.values()) {
      c.sort((p, q) => p.y - q.y);
      for (let i = 1; i < c.length; i++) {
        const min = c[i - 1].y + (c[i - 1].l.size ?? 11) + 3;
        if (c[i].y < min) c[i].y = min;
      }
      const bottom = L.plot.y + L.plot.height + 6;
      for (let i = c.length - 1; i >= 0; i--) {
        const over = c[i].y - (i === c.length - 1 ? bottom : c[i + 1].y - (c[i].l.size ?? 11) - 3);
        if (over > 0) c[i].y -= over;
      }
      for (const a of c) {
        const dx = a.l.dx ?? 0;
        if (Math.abs(a.y - a.ay) > 2) {
          ctx.strokeStyle = theme.text.muted;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.ax + 4, a.ay);
          ctx.lineTo(a.ax + dx - 3, a.y);
          ctx.stroke();
        }
        drawLabel(ctx, theme, { ...a.l, avoid: false, dy: a.y - a.ay }, L, width, placed);
      }
    }
  }
  ctx.restore();
}

/** Theme labels, then the layer's `labels`, then the series' `labelColor`, applied to a mark's label. */
export function labelStyler(theme: Theme, layer: LayerSpec): (l: MarkLabel) => MarkLabel {
  const t = theme.labels ?? {};
  const own = layer.labels ?? {};
  const color = own.color ?? (t.color ? themeColor(theme, t.color) : undefined);
  const scale = own.scale ?? t.scale ?? 1;
  const weight = own.weight ?? t.weight;
  const background = own.background ?? (t.background ? themeColor(theme, t.background) : undefined);
  const series = layer.series;
  if (!color && scale === 1 && weight === undefined && !background && !series) return (l) => l;
  return (l) => {
    const ink = (l.series && series?.[l.series]?.labelColor) || color;
    const out: MarkLabel = { ...l };
    if (ink) {
      out.color = ink;
      out.on = undefined;
    }
    if (scale !== 1) out.size = (l.size ?? 11) * scale;
    if (weight !== undefined) out.weight = weight;
    if (background) out.background = background;
    return out;
  };
}

function drawLabel(ctx: CanvasRenderingContext2D, theme: Theme, l: MarkLabel, L: Layout, width: number, placed: Placed[]): void {
  const { plot, transform: T } = L;
  const ax = T.ox + l.tx * T.sx;
  const ay = T.oy + l.ty * T.sy;
  // Anchored outside the visible plot (zoomed away): skip.
  if (ax < plot.x - 1 || ax > plot.x + plot.width + 1 || ay < plot.y - 1 || ay > plot.y + plot.height + 1) return;
  // Diagram labels scale with the view (and the zoom).
  const k = l.fontScale ? Math.abs(T.sx) * l.fontScale : 1;
  const x = ax + (l.dx ?? 0) * k;
  const y = ay + (l.dy ?? 0) * k;
  const size = (l.size ?? 11) * k;
  if (size < 5) return;
  ctx.font = font(l.weight ?? 500, size, theme.font.family);
  const align = l.align ?? 'center';
  const baseline = l.baseline ?? 'middle';
  const measure = (t: string) => ctx.measureText(t).width;
  let text = l.maxWidth !== undefined ? truncateText(l.text, l.maxWidth * k, measure) : l.text;
  let w = measure(text);
  const rot = l.rotate ?? 0;
  // Top-left corner of the text for an anchor, as its alignment puts it (before any rotation).
  const corner = (cx: number, cy: number, tw: number): [number, number] => [
    align === 'center' ? cx - tw / 2 : align === 'right' || align === 'end' ? cx - tw : cx,
    baseline === 'middle' ? cy - size / 2 : baseline === 'top' || baseline === 'hanging' ? cy : cy - size,
  ];
  // What the text covers on screen: its rectangle, or the bounding box of the turned rectangle.
  const bounds = (cx: number, tw: number) => {
    const [left, top] = corner(cx, y, tw);
    if (!rot) return { x0: left, y0: top, x1: left + tw, y1: top + size };
    const b = rotatedBounds(left - cx, top - y, tw, size, rot);
    return { x0: cx + b.x0, y0: y + b.y0, x1: cx + b.x1, y1: y + b.y1 };
  };
  if (l.box) {
    const bx0 = Math.min(T.ox + l.box[0] * T.sx, T.ox + l.box[2] * T.sx);
    const bx1 = Math.max(T.ox + l.box[0] * T.sx, T.ox + l.box[2] * T.sx);
    const by0 = Math.min(T.oy + l.box[1] * T.sy, T.oy + l.box[3] * T.sy);
    const by1 = Math.max(T.oy + l.box[1] * T.sy, T.oy + l.box[3] * T.sy);
    const inside = (tw: number) => {
      const b = bounds(x, tw);
      return !(b.x0 < bx0 + 4 || b.x1 > bx1 - 4 || b.y0 < by0 + 2 || b.y1 > by1 - 2);
    };
    // Measure first: a label that does not fit is never clipped. It is cut with "…" when it
    // asks for it (`ellipsis`), else it moves out (`fallback`) or disappears.
    if (!inside(w)) {
      const cut = l.ellipsis ? fitText(text, (t) => inside(measure(t))) : null;
      if (cut === null) {
        if (l.fallback) drawLabel(ctx, theme, l.fallback, L, width, placed);
        return;
      }
      text = cut;
      w = measure(text);
    }
  }
  // Kept inside the chart: a label running a little off an edge slides back in; one far off
  // (it would land on the drawing it labels) is left out.
  let x1 = x;
  {
    const b = bounds(x, w);
    const over = !l.box ? Math.max(0, 2 - b.x0, b.x1 - (width - 2)) : 0;
    if (over > (rot ? b.x1 - b.x0 : w) / 3 && !l.free) return;
    if (!l.box && b.x0 < 2) x1 += 2 - b.x0;
    else if (!l.box && b.x1 > width - 2) x1 -= b.x1 - (width - 2);
  }
  // Never on top of another label: the first placed wins (marks list the important ones first),
  // the others are left out, their value is still in the tooltip. Background text (`free`) is exempt.
  if (!l.free) {
    const b = bounds(x1, w);
    const pad = l.background ? 5 * k : 1.5;
    const padY = l.background ? 2.5 * k : 1;
    const r: Placed = { x0: b.x0 - pad, y0: b.y0 - padY, x1: b.x1 + pad, y1: b.y1 + padY };
    if (rot) {
      // The outline of the turned text (with the same margins), for an exact test against its neighbours.
      const [left, top] = corner(x1, y, w);
      r.quad = rotatedCorners(left - x1 - pad, top - y - padY, w + 2 * pad, size + 2 * padY, rot).map(([qx, qy]) => [x1 + qx, y + qy]);
    }
    const quadOf = (p: Placed): [number, number][] => p.quad ?? [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]];
    // Bounding boxes first; two boxes that meet are a collision unless a turned outline says otherwise.
    if (placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0 && (!(r.quad || p.quad) || polygonsOverlap(quadOf(r), quadOf(p))))) return;
    placed.push(r);
  }
  let ink = theme.text.secondary;
  if (l.on) {
    // A faded fill (highlight, focus) shows the surface through: judge the color actually seen.
    const bg = parseColor(theme.background === 'transparent' ? '#ffffff' : theme.background);
    const a = l.on[3];
    const seen: RGBA = [l.on[0] * a + bg[0] * (1 - a), l.on[1] * a + bg[1] * (1 - a), l.on[2] * a + bg[2] * (1 - a), 1];
    ink = luminance(seen) > 0.4 ? '#0b0b0b' : '#ffffff';
  }
  // Pill and text around an anchor: the label's own, or the origin of the turned frame.
  const paint = (cx: number, cy: number) => {
    if (l.background) {
      const [left, top] = corner(cx, cy, w);
      const px = 5 * k;
      const py = 2.5 * k;
      ctx.fillStyle = l.background;
      ctx.beginPath();
      ctx.roundRect(left - px, top - py, w + 2 * px, size + 2 * py, (size + 2 * py) / 2);
      ctx.fill();
    }
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillStyle = l.color ?? ink;
    ctx.fillText(text, cx, cy);
  };
  if (!rot) {
    paint(x1, y);
    return;
  }
  ctx.save();
  ctx.translate(x1, y);
  ctx.rotate((rot * Math.PI) / 180);
  paint(0, 0);
  ctx.restore();
}
