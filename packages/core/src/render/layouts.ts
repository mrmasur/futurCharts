import type { PrimitiveKind } from './types';

/**
 * Packed vertex layouts, shared by every backend.
 * All attributes are float32, at most 4 components each, so the same table
 * maps directly to a WebGL2 VAO or a WebGPU `GPUVertexBufferLayout`.
 */
export interface AttributeLayout {
  name: string;
  size: 1 | 2 | 3 | 4;
}

export interface PrimitiveLayout {
  /** `instanced-quad`: one 4-vertex strip per instance. `triangles`: raw triangle list. */
  topology: 'instanced-quad' | 'triangles';
  /** Floats per instance (or per vertex). */
  stride: number;
  attributes: AttributeLayout[];
}

export const LAYOUTS: Record<PrimitiveKind, PrimitiveLayout> = {
  /**
   * rect:   x0, y0, x1, y1 (scale space)
   * fill:   r, g, b, a
   * stroke: r, g, b, a
   * radii:  top-left, top-right, bottom-right, bottom-left (px, screen space)
   * params: strokeWidth (px),
   *         gap (px, total, across the bar's thickness, split on both sides),
   *         stackGap (px; >0 trims the data-direction end, <0 the other end),
   *         maxWidth (px, cap on the thickness, 0 = unlimited)
   * axis:   0 = thickness along x (vertical bar), 1 = thickness along y (horizontal bar)
   */
  rect: {
    topology: 'instanced-quad',
    stride: 21,
    attributes: [
      { name: 'rect', size: 4 },
      { name: 'fill', size: 4 },
      { name: 'stroke', size: 4 },
      { name: 'radii', size: 4 },
      { name: 'params', size: 4 },
      { name: 'axis', size: 1 },
    ],
  },
  /**
   * point:  x, y (scale space), size (px diameter), shape (0 circle, 1 square, 2 diamond, 3 triangle)
   * fill, stroke: rgba
   * strokeWidth: px (drawn outside the fill)
   */
  point: {
    topology: 'instanced-quad',
    stride: 13,
    attributes: [
      { name: 'point', size: 4 },
      { name: 'fill', size: 4 },
      { name: 'stroke', size: 4 },
      { name: 'strokeWidth', size: 1 },
    ],
  },
  /**
   * seg:   x0, y0, x1, y1 (scale space) — one round-capped segment per instance
   * color: rgba
   * width: px
   */
  line: {
    topology: 'instanced-quad',
    stride: 9,
    attributes: [
      { name: 'seg', size: 4 },
      { name: 'color', size: 4 },
      { name: 'width', size: 1 },
    ],
  },
  /**
   * arc:    cx, cy (scale space), r0, r1 (scale units along x; the view keeps x and y at the same scale)
   * angles: a0, a1 (radians, clockwise from 12 o'clock), gap (px, trimmed on every side), unused
   * fill:   rgba
   * One annular sector per instance (pie, donut, sunburst, rose, gauge). Animating a
   * sector is just changing these numbers: nothing is re-tessellated.
   */
  arc: {
    topology: 'instanced-quad',
    stride: 12,
    attributes: [
      { name: 'arc', size: 4 },
      { name: 'angles', size: 4 },
      { name: 'fill', size: 4 },
    ],
  },
  /** pos: x, y (scale space) · color: rgba — triangle list, per-vertex color */
  mesh: {
    topology: 'triangles',
    stride: 6,
    attributes: [
      { name: 'pos', size: 2 },
      { name: 'color', size: 4 },
    ],
  },
};

export const SHAPES = { circle: 0, square: 1, diamond: 2, triangle: 3 } as const;
export type PointShape = keyof typeof SHAPES;
