import { LAYOUTS } from '../layouts';
import {
  IDENTITY,
  type Batch,
  type Frame,
  type PrimitiveKind,
  type Renderer,
  type RendererCapabilities,
} from '../types';
import { SHADERS } from './shaders';

interface Program {
  program: WebGLProgram;
  u: Record<'u_res' | 'u_t' | 'u_dpr' | 'u_snap' | 'u_opacity' | 'u_progress', WebGLUniformLocation | null>;
}

class GLBatch implements Batch {
  count = 0;
  readonly vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;

  constructor(private gl: WebGL2RenderingContext, readonly kind: PrimitiveKind) {
    const layout = LAYOUTS[kind];
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    let offset = 0;
    layout.attributes.forEach((attr, location) => {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, attr.size, gl.FLOAT, false, layout.stride * 4, offset * 4);
      if (layout.topology === 'instanced-quad') gl.vertexAttribDivisor(location, 1);
      offset += attr.size;
    });
    gl.bindVertexArray(null);
  }

  update(data: Float32Array, count: number): void {
    const gl = this.gl;
    const stride = LAYOUTS[this.kind].stride;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * stride), gl.DYNAMIC_DRAW);
    this.count = count;
  }

  destroy(): void {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
    this.count = 0;
  }
}

/** A WebGL2 context with its compiled programs. Draws a frame into its bottom-left W×H pixels. */
class GLCore {
  readonly gl: WebGL2RenderingContext;
  private programs = new Map<PrimitiveKind, Program>();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('futurCharts: WebGL2 is not available in this browser.');
    this.gl = gl;
  }

  createBatch(kind: PrimitiveKind): Batch {
    return new GLBatch(this.gl, kind);
  }

  /** `width` / `height`: CSS pixels of the chart; `W` / `H`: its device pixels. */
  draw(frame: Frame, width: number, height: number, dpr: number, W: number, H: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    const [r, g, b, a] = frame.clearColor;
    gl.clearColor(r * a, g * a, b * a, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    for (const call of frame.calls) {
      const batch = call.batch as GLBatch;
      if (batch.count === 0) continue;
      const prog = this.program(batch.kind);
      const t = call.transform ?? IDENTITY;
      gl.useProgram(prog.program);
      gl.uniform2f(prog.u.u_res, width, height);
      gl.uniform4f(prog.u.u_t, t.sx, t.sy, t.ox, t.oy);
      gl.uniform1f(prog.u.u_dpr, dpr);
      gl.uniform1f(prog.u.u_snap, call.pixelSnap ? 1 : 0);
      gl.uniform1f(prog.u.u_opacity, call.opacity ?? 1);
      gl.uniform1f(prog.u.u_progress, call.progress ?? 1);
      if (call.clip) {
        const c = call.clip;
        gl.enable(gl.SCISSOR_TEST);
        const x = Math.round(c.x * dpr);
        const w = Math.round(c.width * dpr);
        const h = Math.round(c.height * dpr);
        const y = H - Math.round(c.y * dpr) - h;
        gl.scissor(x, y, Math.max(0, w), Math.max(0, h));
      } else {
        gl.disable(gl.SCISSOR_TEST);
      }
      gl.bindVertexArray(batch.vao);
      if (LAYOUTS[batch.kind].topology === 'instanced-quad') {
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, batch.count);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.SCISSOR_TEST);
  }

  destroy(): void {
    for (const p of this.programs.values()) this.gl.deleteProgram(p.program);
    this.programs.clear();
  }

  private program(kind: PrimitiveKind): Program {
    let p = this.programs.get(kind);
    if (p) return p;
    const gl = this.gl;
    const { vs, fs } = SHADERS[kind];
    const program = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const lost = gl.isContextLost() ? ' (the WebGL context was lost)' : '';
        throw new Error(`futurCharts: ${kind} shader failed to compile${lost}: ${gl.getShaderInfoLog(shader)}`);
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`futurCharts: ${kind} program failed to link: ${gl.getProgramInfoLog(program)}`);
    }
    p = {
      program,
      u: {
        u_res: gl.getUniformLocation(program, 'u_res'),
        u_t: gl.getUniformLocation(program, 'u_t'),
        u_dpr: gl.getUniformLocation(program, 'u_dpr'),
        u_snap: gl.getUniformLocation(program, 'u_snap'),
        u_opacity: gl.getUniformLocation(program, 'u_opacity'),
        u_progress: gl.getUniformLocation(program, 'u_progress'),
      },
    };
    this.programs.set(kind, p);
    return p;
  }
}

/** One WebGL2 context per chart, drawing straight into the chart's canvas. */
export class WebGL2Renderer implements Renderer {
  readonly backend = 'webgl2';
  readonly capabilities: RendererCapabilities = { compute: false };
  private core: GLCore;
  private width = 1;
  private height = 1;
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.core = new GLCore(canvas);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
  }

  createBatch(kind: PrimitiveKind): Batch {
    return this.core.createBatch(kind);
  }

  render(frame: Frame): void {
    this.core.draw(frame, this.width, this.height, this.dpr, this.canvas.width, this.canvas.height);
  }

  destroy(): void {
    this.core.destroy();
  }
}

let shared: GLCore | undefined;

/**
 * All charts of the page share one WebGL2 context. Browsers cap the number of
 * live contexts (around 16) and silently drop the oldest beyond it, which a
 * dashboard reaches quickly. Each chart renders into the shared canvas, then
 * copies its pixels into its own 2D canvas.
 */
export class SharedWebGL2Renderer implements Renderer {
  readonly backend = 'webgl2-shared';
  readonly capabilities: RendererCapabilities = { compute: false };
  private target: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    if (!shared || shared.gl.isContextLost()) shared = new GLCore(document.createElement('canvas'));
    this.target = canvas.getContext('2d')!;
  }

  private get core(): GLCore {
    return shared!;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
  }

  createBatch(kind: PrimitiveKind): Batch {
    return this.core.createBatch(kind);
  }

  render(frame: Frame): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const source = this.core.canvas;
    // Grow only: resizing a canvas reallocates its buffer.
    if (source.width < W || source.height < H) {
      source.width = Math.max(source.width, W);
      source.height = Math.max(source.height, H);
    }
    this.core.draw(frame, this.width, this.height, this.dpr, W, H);
    // The frame sits in the bottom-left corner of the shared canvas.
    this.target.clearRect(0, 0, W, H);
    this.target.drawImage(source, 0, source.height - H, W, H, 0, 0, W, H);
  }

  destroy(): void {
    // The shared context outlives any one chart; its batches are freed by the chart.
  }
}
