/**
 * Backend-agnostic rendering contract.
 *
 * Nothing in this file (or anything above the `render/` folder) may reference a
 * WebGL or WebGPU concept. The chart layer only knows about:
 *   - primitives (`rect`, `point`, `line`, `arc`, `mesh`) with a fixed packed layout,
 *   - batches (opaque GPU buffers holding instances of one primitive),
 *   - frames (an ordered list of draw calls with a view transform and a clip).
 *
 * This is what keeps the WebGPU door open: a WebGPU backend implements
 * `Renderer` against the same layouts (see `layouts.ts`) and nothing else moves.
 * Renderer creation is async on purpose, because acquiring a WebGPU device is.
 */

export type RGBA = [number, number, number, number];

export type PrimitiveKind = 'rect' | 'point' | 'line' | 'mesh' | 'arc';

/**
 * Affine map from normalized scale space to CSS pixels:
 *   px = t.x * sx + ox,  py = t.y * sy + oy
 * Zooming and panning only change this uniform; batches are never rebuilt.
 */
export interface ViewTransform {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/** Clip rectangle in CSS pixels, origin top-left. */
export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Batch {
  readonly kind: PrimitiveKind;
  /** Number of instances (or vertices for `mesh`). */
  readonly count: number;
  /** Replace the batch contents. `data` follows `LAYOUTS[kind]`. */
  update(data: Float32Array, count: number): void;
  /**
   * The state to move from (same layout and count as the current data), for a
   * transition between two data states; `null` drops it. Every primitive morphs: `rect`,
   * `point` and `arc` blend position, size, angles and fill; `line` blends its two ends, color
   * and width; `mesh` blends position and color, vertex for vertex. The backend blends the two
   * states itself, driven by `DrawCall.morph`: no upload per frame. Nothing here is specific to
   * a backend: the previous state is a second vertex buffer with the layout of `LAYOUTS[kind]`.
   * Call it after `update` (it holds as many instances as the batch then has).
   */
  setPrevious?(data: Float32Array | null): void;
  destroy(): void;
}

export interface DrawCall {
  batch: Batch;
  /** Defaults to identity (batch already in CSS pixels). */
  transform?: ViewTransform;
  clip?: ClipRect;
  /** Multiplies the alpha of every instance. Default 1. */
  opacity?: number;
  /** Snap geometry to device pixels (crisp hairlines, bar edges). */
  pixelSnap?: boolean;
  /**
   * Entry animation, 0 → 1 (default 1: fully drawn). Rects grow along their
   * value axis, arcs sweep open, points grow; each backend applies it in its
   * vertex stage, so an animated frame costs no buffer upload.
   */
  progress?: number;
  /** Transition from the batch's previous state, 0 → 1 (default 1: the current state). */
  morph?: number;
}

export interface Frame {
  clearColor: RGBA;
  calls: DrawCall[];
}

export interface RendererCapabilities {
  /** GPU compute available (binning, density, aggregation on the GPU). */
  compute: boolean;
}

export interface Renderer {
  readonly backend: 'webgl2' | 'webgpu' | (string & {});
  readonly capabilities: RendererCapabilities;
  readonly canvas: HTMLCanvasElement;
  resize(width: number, height: number, dpr: number): void;
  createBatch(kind: PrimitiveKind): Batch;
  render(frame: Frame): void;
  /**
   * The GPU took the device back and gave it again (a WebGL context lost then restored after a sleep or on a
   * busy phone; a WebGPU `device.lost`): every batch is gone. `listener` must create its batches again.
   * Until then the renderer draws nothing and the chart keeps its last image. Returns an unsubscribe function.
   */
  onRestored?(listener: () => void): () => void;
  destroy(): void;
}

/** Async by contract: WebGPU device acquisition is asynchronous. */
export type RendererFactory = (canvas: HTMLCanvasElement) => Promise<Renderer>;

export const IDENTITY: ViewTransform = { sx: 1, sy: 1, ox: 0, oy: 0 };
