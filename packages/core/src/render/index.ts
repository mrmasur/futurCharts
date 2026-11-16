import type { Renderer, RendererFactory } from './types';
import { WebGL2Renderer } from './webgl2/renderer';

export * from './types';
export * from './layouts';
export { WebGL2Renderer };

export type RendererChoice = 'auto' | 'webgl2' | RendererFactory;

/**
 * Resolve a renderer. `auto` is where a WebGPU backend will be probed first
 * (`navigator.gpu`) once it exists, falling back to WebGL2. Callers always
 * await this, so adding that probe changes nothing for them.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  choice: RendererChoice = 'auto',
): Promise<Renderer> {
  if (typeof choice === 'function') return choice(canvas);
  return new WebGL2Renderer(canvas);
}
