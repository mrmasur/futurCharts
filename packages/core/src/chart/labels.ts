/**
 * Text fitting for the overlay: cutting a text with "…" and the bounding box of
 * a rotated text. Pure (the caller supplies how to measure), so it is tested on its own.
 */

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
