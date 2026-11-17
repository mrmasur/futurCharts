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
): void {
  out.push(cx, cy, r0, r1, a0, a1, gap, 0, fill[0], fill[1], fill[2], fill[3]);
}

export function pushVertex(out: number[], x: number, y: number, c: RGBA): void {
  out.push(x, y, c[0], c[1], c[2], c[3]);
}

/** Relative luminance (sRGB), to pick readable ink over a fill. */
export function luminance(c: RGBA): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}
