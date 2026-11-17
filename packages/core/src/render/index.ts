import type { Renderer, RendererFactory } from './types';
import { SharedWebGL2Renderer, WebGL2Renderer } from './webgl2/renderer';

export * from './types';
export * from './layouts';
export { SharedWebGL2Renderer, WebGL2Renderer };

/**
 * `auto` (default): one WebGL2 context shared by every chart of the page.
 * `webgl2`: a dedicated context for this chart (fastest for a single, very large chart).
 */
export type RendererChoice = 'auto' | 'webgl2' | RendererFactory;

/**
 * Resolve a renderer. `auto` is also where a WebGPU backend will be probed first
 * (`navigator.gpu`) once it exists, falling back to WebGL2. Callers always
 * await this, so adding that probe changes nothing for them.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  choice: RendererChoice = 'auto',
): Promise<Renderer> {
  if (typeof choice === 'function') return choice(canvas);
  if (choice === 'webgl2') return new WebGL2Renderer(canvas);
  return new SharedWebGL2Renderer(canvas);
}
