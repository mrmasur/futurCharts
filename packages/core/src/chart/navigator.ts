/**
 * Navigator (`interactions.navigator`): a chart of its sync group that shows everything and
 * a window over it; the window is the range the other charts of the group show. The window
 * is in normalized x, [0, 1] when everything shows.
 */
import type { RGBA } from '../render/types';
import type { Theme } from '../theme/theme';
import { parseColor, toCss } from '../util/color';
import type { Layout, Point } from './types';

export type NavWindow = [number, number];

/** A drag of the window: moving it, or one of its edges (`w`, `e`); `x` and `start` where it began. */
export interface NavDrag {
  mode: 'move' | 'w' | 'e';
  x: number;
  start: NavWindow;
}

const withAlphaRGBA = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

/**
 * What a press at `p` (px, inside the plot) grabs: an edge (`w`, `e`, within 7 px), the
 * window itself (`move`), or nothing, which draws a new window (`new`). While everything
 * shows, a drag always draws a new window.
 */
export function navHandleAt(p: Point, L: Layout, window: NavWindow): 'move' | 'w' | 'e' | 'new' {
  const T = L.transform;
  const x0 = T.ox + window[0] * T.sx;
  const x1 = T.ox + window[1] * T.sx;
  if (Math.abs(p.x - x0) <= 7) return 'w';
  if (Math.abs(p.x - x1) <= 7) return 'e';
  // While everything shows, a drag draws a new window instead of moving the whole one.
  const full = window[0] <= 0 && window[1] >= 1;
  if (p.x > x0 && p.x < x1 && !full) return 'move';
  return 'new';
}

/** The window while dragging, the pointer at `n` (normalized x, already clamped to [0, 1]). */
export function dragWindow(d: NavDrag, n: number): NavWindow {
  const [a, b] = d.start;
  if (d.mode === 'move') {
    const shift = Math.max(-a, Math.min(1 - b, n - d.x));
    return [a + shift, b + shift];
  }
  if (d.mode === 'w') return n < b ? [n, b] : [b, n];
  return n > a ? [a, n] : [n, a];
}

/** Shade what the other charts do not show, outline the window and its handles. */
export function drawNavigator(ctx: CanvasRenderingContext2D, theme: Theme, L: Layout, window: NavWindow): void {
  const { plot, transform: T } = L;
  const x0 = T.ox + window[0] * T.sx;
  const x1 = T.ox + window[1] * T.sx;
  ctx.save();
  ctx.fillStyle = theme.background === 'transparent' ? 'rgba(255,255,255,0.6)' : toCss(withAlphaRGBA(parseColor(theme.background), 0.62));
  ctx.fillRect(plot.x, plot.y, Math.max(0, x0 - plot.x), plot.height);
  ctx.fillRect(x1, plot.y, Math.max(0, plot.x + plot.width - x1), plot.height);
  ctx.strokeStyle = theme.text.muted;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x0) + 0.5, plot.y + 0.5, Math.round(x1 - x0), plot.height - 1);
  // Handles: small rounded grips on both edges.
  for (const x of [x0, x1]) {
    ctx.fillStyle = theme.background === 'transparent' ? '#fff' : theme.background;
    ctx.strokeStyle = theme.text.muted;
    ctx.beginPath();
    ctx.roundRect(x - 4, plot.y + plot.height / 2 - 11, 8, 22, 3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 1, plot.y + plot.height / 2 - 5);
    ctx.lineTo(x - 1, plot.y + plot.height / 2 + 5);
    ctx.moveTo(x + 1, plot.y + plot.height / 2 - 5);
    ctx.lineTo(x + 1, plot.y + plot.height / 2 + 5);
    ctx.stroke();
  }
  ctx.restore();
}
