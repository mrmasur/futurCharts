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
   * params: strokeWidth (px), gapX (px, total, split on both sides),
   *         gapY (px; >0 trims the top edge, <0 trims the bottom edge),
   *         maxWidth (px, 0 = unlimited)
   */
  rect: {
    topology: 'instanced-quad',
    stride: 20,
    attributes: [
      { name: 'rect', size: 4 },
      { name: 'fill', size: 4 },
      { name: 'stroke', size: 4 },
      { name: 'radii', size: 4 },
      { name: 'params', size: 4 },
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
