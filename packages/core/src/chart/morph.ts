/**
 * Transitions between two data states: what is on screen is kept as a snapshot
 * (instances with an identity), then each new batch receives its previous state
 * (`Batch.setPrevious`) and the GPU blends the two with `DrawCall.morph`.
 */
import { LAYOUTS } from '../render/layouts';
import type { Batch } from '../render/types';
import type { Built } from './types';

/** Keyed instances of one draw, as they were. */
export interface DrawState {
  keys: string[];
  data: Float32Array;
  kind: string;
}

/** Per layer index, per draw: the keyed instances on screen (null for a draw without identity). */
export type Snapshot = Map<number, (DrawState | null)[]>;

/** Instances with an identity, per layer and draw, as they are now. */
export function snapshot(built: Built[]): Snapshot {
  const out: Snapshot = new Map();
  for (const b of built) {
    out.set(b.data.index, b.mark.draws.map((d) => (d.keys && d.data ? { keys: d.keys, data: d.data, kind: d.batch.kind } : null)));
  }
  return out;
}

/**
 * The previous state of each new instance: the old one with the same key, or, for a
 * new instance, itself grown from nothing (a bar from its baseline, an arc from zero
 * sweep, a point from size zero). `moved` is false when nothing differs.
 */
export function previousInstances(kind: string, stride: number, keys: string[], data: Float32Array, old: DrawState): { prev: Float32Array; moved: boolean } {
  const at = new Map(old.keys.map((k, i) => [k, i]));
  const prev = new Float32Array(keys.length * stride);
  let moved = false;
  keys.forEach((k, i) => {
    const j = at.get(k);
    if (j !== undefined) {
      prev.set(old.data.subarray(j * stride, (j + 1) * stride), i * stride);
      for (let q = 0; q < stride; q++) if (prev[i * stride + q] !== data[i * stride + q]) moved = true;
      return;
    }
    // New: from nothing. A bar from its baseline, a point from size zero.
    prev.set(data.subarray(i * stride, (i + 1) * stride), i * stride);
    if (kind === 'rect') {
      const horizontal = prev[i * stride + 20] > 0.5;
      if (horizontal) prev[i * stride + 2] = prev[i * stride];
      else prev[i * stride + 3] = prev[i * stride + 1];
    } else if (kind === 'arc') prev[i * stride + 5] = prev[i * stride + 4];
    else prev[i * stride + 2] = 0;
    moved = true;
  });
  return { prev, moved };
}

/**
 * After a data change, every keyed instance moves from where it was (same
 * key) and new ones grow from nothing. Hands each batch that moves its previous
 * state and returns those batches (empty: no transition).
 */
export function startTransition(before: Snapshot, built: Built[]): Batch[] {
  const batches: Batch[] = [];
  for (const b of built) {
    const old = before.get(b.data.index);
    if (!old) continue;
    b.mark.draws.forEach((d, di) => {
      const o = old[di];
      if (!d.keys || !d.data || !o || o.kind !== d.batch.kind || !d.batch.setPrevious) return;
      const { prev, moved } = previousInstances(d.batch.kind, LAYOUTS[d.batch.kind].stride, d.keys, d.data, o);
      if (!moved) return;
      d.batch.setPrevious(prev);
      batches.push(d.batch);
    });
  }
  return batches;
}
