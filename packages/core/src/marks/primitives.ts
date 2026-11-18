import type { RGBA } from '../render/types';

/** Helpers that write instances in the packed layouts of `render/layouts.ts`. */

export interface RectInstance {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fill: RGBA;
  stroke?: RGBA;
  /** Corner radii in px: top-left, top-right, bottom-right, bottom-left (screen space). */
  radii?: [number, number, number, number];
  strokeWidth?: number;
  /** px, across the thickness, split on both sides. */
  gap?: number;
  /** px; >0 trims the data-direction end, <0 the other end. */
  stackGap?: number;
  /** px cap on the thickness. */
  maxWidth?: number;
  /** 0: thickness along x (vertical bar), 1: along y (horizontal bar). */
  axis?: 0 | 1;
}

const NONE: RGBA = [0, 0, 0, 0];

export function pushRect(out: number[], r: RectInstance): void {
  const s = r.stroke ?? NONE;
  const rad = r.radii ?? [0, 0, 0, 0];
  out.push(
    r.x0, r.y0, r.x1, r.y1,
    r.fill[0], r.fill[1], r.fill[2], r.fill[3],
    s[0], s[1], s[2], s[3],
    rad[0], rad[1], rad[2], rad[3],
    r.strokeWidth ?? 0, r.gap ?? 0, r.stackGap ?? 0, r.maxWidth ?? 0,
    r.axis ?? 0,
  );
}

export function pushSegment(out: number[], x0: number, y0: number, x1: number, y1: number, color: RGBA, width: number): void {
  if (!Number.isFinite(x0 + y0 + x1 + y1)) return;
  out.push(x0, y0, x1, y1, color[0], color[1], color[2], color[3], width);
}

/**
 * Cut a path into dashes measured in px at build time (`[on, off, ...]`); the
 * pattern carries on from one segment to the next, so a curve stays evenly dashed.
 * Zooming stretches the dashes with the data, which keeps the batch untouched.
 */
export function dashed(out: number[], dash: number[], pixel: [number, number], color: RGBA, width: number) {
  const total = dash.reduce((a, d) => a + Math.max(0, d), 0);
  let phase = 0;
  return {
    reset() {
      phase = 0;
    },
    segment(x0: number, y0: number, x1: number, y1: number) {
      if (!(total > 0)) return pushSegment(out, x0, y0, x1, y1, color, width);
      const L = Math.hypot((x1 - x0) / pixel[0], (y1 - y0) / pixel[1]);
      if (!Number.isFinite(L)) return;
      let pos = 0;
      while (pos < L - 1e-6) {
        // Where we are in the pattern.
        let p = phase % total;
        let k = 0;
        while (p >= dash[k]) p -= dash[k++];
        const step = Math.min(dash[k] - p, L - pos);
        if (k % 2 === 0) {
          const a = pos / L;
          const b = (pos + step) / L;
          pushSegment(out, x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, color, width);
        }
        pos += step;
        phase += step;
      }
    },
  };
}

/** One annular sector: center and radii in scale space (radii along x), angles clockwise from 12 o'clock. */
export function pushArc(
  out: number[],
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  gap: number,
  fill: RGBA,
  /** Rounded corners, px (capped by the ring's thickness and the arc's length). */
  corner = 0,
): void {
  out.push(cx, cy, r0, r1, a0, a1, gap, corner, fill[0], fill[1], fill[2], fill[3]);
}

export function pushVertex(out: number[], x: number, y: number, c: RGBA): void {
  out.push(x, y, c[0], c[1], c[2], c[3]);
}

/** Relative luminance (sRGB), to pick readable ink over a fill. */
export function luminance(c: RGBA): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}
