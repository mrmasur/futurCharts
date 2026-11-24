/**
 * The GPU frame of a chart: the clip of the marks and one `DrawCall` per batch, with the
 * entry animation (`progress`, reveal through the clip, fade) and the transition (`morph`).
 */
import type { Batch, ClipRect, DrawCall } from '../render/types';
import type { Built, Layout } from './types';

/**
 * Where the marks may draw. Unzoomed, a little room past the plot so markers on the edge
 * are not cut; a map stops at the edge of the projected world, wherever the zoom moved it.
 */
export function marksClip(L: Layout, zoomed: boolean, geo: boolean): ClipRect {
  const { plot, transform: T } = L;
  const m = zoomed ? 0 : 6;
  if (!geo) return { x: plot.x - m, y: plot.y - m, width: plot.width + 2 * m, height: plot.height + 2 * m };
  // A map stops at the edge of the projected world, wherever the zoom has moved it.
  const x0 = Math.max(plot.x, T.ox);
  const y0 = Math.max(plot.y, T.oy + T.sy);
  const x1 = Math.min(plot.x + plot.width, T.ox + T.sx);
  const y1 = Math.min(plot.y + plot.height, T.oy);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** Where the animations stand for this frame. */
export interface FrameProgress {
  /** Entry animation, 0..1: rects, arcs and points grow. */
  enter: number;
  /** Lines and fills revealed left to right through their clip (eased entry), 0..1. */
  reveal: number;
  /** Transition between two data states, 0..1, for the batches in `morphing`. */
  morph: number;
  morphing?: Set<Batch>;
  /** Opacity of the selectable marks while a selection is shown (1: no selection). */
  dim: number;
}

/** One draw call per batch of every layer, then the selected instances over them. */
export function markCalls(built: Built[], L: Layout, clip: ClipRect, p: FrameProgress): DrawCall[] {
  const T = L.transform;
  const calls: DrawCall[] = [];
  for (const b of built) {
    for (const d of b.mark.draws) {
      const opacity = d.perDatum ? p.dim : 1;
      const kind = d.batch.kind;
      if (d.enter) {
        // Fade (diagrams) or appear at once.
        const o = d.enter === 'fade' ? opacity * p.reveal : opacity;
        calls.push({ batch: d.batch, transform: T, clip, pixelSnap: d.pixelSnap, opacity: o, progress: 1 });
        continue;
      }
      const grows = kind === 'rect' || kind === 'arc' || kind === 'point';
      const c = !grows && p.reveal < 1 ? { ...clip, width: clip.width * p.reveal } : clip;
      calls.push({ batch: d.batch, transform: T, clip: c, pixelSnap: d.pixelSnap, opacity, progress: grows ? p.enter : 1, morph: p.morphing?.has(d.batch) ? p.morph : 1 });
    }
    for (const d of b.sel?.draws ?? []) calls.push({ batch: d.batch, transform: T, clip, pixelSnap: d.pixelSnap });
  }
  return calls;
}
