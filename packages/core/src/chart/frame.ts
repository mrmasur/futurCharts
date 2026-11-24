/**
 * The GPU frame of a chart: the clip of the marks and one `DrawCall` per batch, with the
 * entry animation (`progress`, reveal through the clip, fade) and the transition (`morph`).
 */
import type { Batch, ClipRect, DrawCall } from '../render/types';
import type { Ghost, StandIn } from './morph';
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
  /** Lines and areas in transition: the batches drawn in place of the mark's own. */
  stand?: Map<Batch, StandIn[]>;
  /** What is gone and leaves, per layer index (drawn under that layer; first when the layer is gone too). */
  ghosts?: Map<number, Ghost[]>;
  /** Opacity of the selectable marks while a selection is shown (1: no selection). */
  dim: number;
}

/** One draw call per batch of every layer, then the selected instances over them. */
export function markCalls(built: Built[], L: Layout, clip: ClipRect, p: FrameProgress): DrawCall[] {
  const T = L.transform;
  const calls: DrawCall[] = [];
  const leave = (ghosts: Ghost[] | undefined) => {
    for (const g of ghosts ?? []) calls.push({ batch: g.batch, transform: T, clip, pixelSnap: g.pixelSnap, progress: 1, morph: p.morph });
  };
  if (p.ghosts) {
    const layers = new Set(built.map((b) => b.data.index));
    for (const [layer, ghosts] of p.ghosts) if (!layers.has(layer)) leave(ghosts);
  }
  for (const b of built) {
    leave(p.ghosts?.get(b.data.index));
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
      const stand = p.stand?.get(d.batch);
      if (stand) {
        // A line or an area between two states: both states blended, and the new paths revealed like at entry.
        const shown = 1 - Math.pow(1 - p.morph, 3);
        for (const s of stand) {
          calls.push({ batch: s.batch, transform: T, clip: s.reveal ? { ...c, width: c.width * shown } : c, pixelSnap: d.pixelSnap, opacity, progress: 1, morph: s.reveal ? 1 : p.morph });
        }
        continue;
      }
      calls.push({ batch: d.batch, transform: T, clip: c, pixelSnap: d.pixelSnap, opacity, progress: grows ? p.enter : 1, morph: p.morphing?.has(d.batch) ? p.morph : 1 });
    }
    for (const d of b.sel?.draws ?? []) calls.push({ batch: d.batch, transform: T, clip, pixelSnap: d.pixelSnap });
  }
  return calls;
}
