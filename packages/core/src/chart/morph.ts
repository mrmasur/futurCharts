/**
 * Transitions between two data states: what is on screen is kept as a snapshot
 * (instances with an identity, paths of lines and areas), then
 * - each new batch of bars, dots or slices receives its previous state (`Batch.setPrevious`),
 * - each line or area is redrawn, for the time of the transition, by a stand-in batch holding
 *   both states resampled on common positions (`paths.ts`),
 * - what is gone is drawn by a batch of its own that shrinks and fades.
 * The GPU blends the two states with `DrawCall.morph`: no buffer is rebuilt during the transition.
 */
import { LAYOUTS } from '../render/layouts';
import type { Batch, PrimitiveKind, Renderer } from '../render/types';
import type { DrawPath, MarkDefinition } from '../marks/registry';
import { columnsToData, leavingPath, pathColumns, resamplePair, validPath } from './paths';
import type { Built } from './types';

/** One draw as it was: its keyed instances or its paths. */
export interface DrawState {
  keys?: string[];
  paths?: DrawPath[];
  data: Float32Array;
  kind: string;
  pixelSnap?: boolean;
}

/** Per layer index: its mark and, per draw, what has an identity (null for a draw without). */
export type Snapshot = Map<number, (DrawState | null)[]> & { defs?: Map<number, MarkDefinition> };

/** Instances and paths with an identity, per layer and draw, as they are now. */
export function snapshot(built: Built[]): Snapshot {
  const out: Snapshot = new Map();
  out.defs = new Map();
  for (const b of built) {
    out.defs.set(b.data.index, b.def);
    out.set(
      b.data.index,
      b.mark.draws.map((d) => {
        if (!d.data) return null;
        const kind = d.batch.kind;
        // A mark that has not written its instances yet (or miscounted) has nothing to move from.
        if (d.keys && d.data.length >= d.keys.length * LAYOUTS[kind].stride) return { keys: d.keys, data: d.data, kind, pixelSnap: d.pixelSnap };
        if (d.paths?.length && (kind === 'line' || kind === 'mesh')) return { paths: d.paths, data: d.data, kind, pixelSnap: d.pixelSnap };
        return null;
      }),
    );
  }
  return out;
}

/**
 * The previous state of each new instance: the old one with the same key, or, for a
 * new instance, itself grown from nothing (a bar from its baseline, an arc from zero
 * sweep, a point from size zero). `moved` is false when nothing differs.
 */
export function previousInstances(kind: string, stride: number, keys: string[], data: Float32Array, old: { keys: string[]; data: Float32Array }): { prev: Float32Array; moved: boolean } {
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

/** Indices of the old instances whose key is gone. */
export function leaving(oldKeys: string[], keys: string[]): number[] {
  const kept = new Set(keys);
  const out: number[] = [];
  oldKeys.forEach((k, i) => {
    if (!kept.has(k)) out.push(i);
  });
  return out;
}

/**
 * The two states of the instances that leave: as they were, and what they end on. A bar shrinks to
 * its baseline, a dot to size zero, a slice closes where its neighbours meet in the new state
 * (`now`: the surviving instances); all fade to nothing.
 */
export function exitInstances(kind: string, stride: number, old: { keys: string[]; data: Float32Array }, gone: number[], now?: { keys: string[]; data: Float32Array }): { prev: Float32Array; cur: Float32Array } {
  const prev = new Float32Array(gone.length * stride);
  const at = new Map<string, number>();
  now?.keys.forEach((k, i) => at.set(k, i));
  gone.forEach((j, i) => prev.set(old.data.subarray(j * stride, (j + 1) * stride), i * stride));
  const cur = Float32Array.from(prev);
  gone.forEach((j, i) => {
    const o = i * stride;
    if (kind === 'rect') {
      if (cur[o + 20] > 0.5) cur[o + 2] = cur[o];
      else cur[o + 3] = cur[o + 1];
      cur[o + 7] = 0;
    } else if (kind === 'arc') {
      // Where the slice before it now ends, else where the slice after it now starts.
      let angle = cur[o + 4];
      let found = false;
      for (let q = j - 1; q >= 0 && !found; q--) {
        const n = at.get(old.keys[q]);
        if (n !== undefined) [angle, found] = [now!.data[n * stride + 5], true];
      }
      for (let q = j + 1; q < old.keys.length && !found; q++) {
        const n = at.get(old.keys[q]);
        if (n !== undefined) [angle, found] = [now!.data[n * stride + 4], true];
      }
      if (!Number.isFinite(angle)) angle = cur[o + 4];
      cur[o + 4] = angle;
      cur[o + 5] = angle;
      cur[o + 11] = 0;
    } else {
      cur[o + 2] = 0;
      cur[o + 7] = 0;
    }
  });
  return { prev, cur };
}

/** A batch the transition draws in place of a mark's own batch. */
export interface StandIn {
  batch: Batch;
  /** New paths: revealed through the clip, like at entry, instead of blended. */
  reveal?: boolean;
}

/** A batch of what is gone, drawn under its layer. */
export interface Ghost {
  batch: Batch;
  pixelSnap?: boolean;
}

/** Everything a running transition holds. */
export interface Transition {
  /** Batches of the marks that received a previous state (dropped at the end). */
  batches: Batch[];
  /** Lines and areas: what is drawn in place of the mark's batch while the transition runs. */
  stand: Map<Batch, StandIn[]>;
  /** What is gone, per layer index. */
  ghosts: Map<number, Ghost[]>;
  /** Batches made for the transition, destroyed with it. */
  owned: Batch[];
}

/** Past this many instances or vertices in a draw, lines and areas change at once. */
const MAX_PATH_DATA = 400_000;

function concat(parts: Float32Array[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

const same = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * The two states of a draw made of paths (`line`: instances, `mesh`: vertices), resampled on
 * common positions: `prev` and `cur` have the same length and blend one to one. `enter` holds
 * the paths that are new. Null when nothing differs.
 */
export function pathStates(kind: string, old: { paths: DrawPath[]; data: Float32Array }, paths: DrawPath[], data: Float32Array): { prev: Float32Array; cur: Float32Array; enter: Float32Array } | null {
  const stride = LAYOUTS[kind as PrimitiveKind].stride;
  const before = new Map<string, DrawPath>();
  for (const q of old.paths) if (validPath(kind, old.data, q)) before.set(q.key, q);
  const prev: Float32Array[] = [];
  const cur: Float32Array[] = [];
  const enter: Float32Array[] = [];
  const covered = new Uint8Array(Math.floor(data.length / stride));
  const seen = new Set<string>();
  let moved = false;
  for (const p of paths) {
    if (!validPath(kind, data, p) || seen.has(p.key)) continue;
    covered.fill(1, p.start, p.start + p.count);
    const now = data.subarray(p.start * stride, (p.start + p.count) * stride);
    const q = before.get(p.key);
    if (!q) {
      enter.push(now);
      continue;
    }
    seen.add(p.key);
    const was = old.data.subarray(q.start * stride, (q.start + q.count) * stride);
    if (same(was, now)) {
      prev.push(was);
      cur.push(now);
      continue;
    }
    const r = resamplePair(pathColumns(kind, old.data, q), pathColumns(kind, data, p));
    prev.push(columnsToData(kind, r.a, r.n));
    cur.push(columnsToData(kind, r.b, r.n));
    moved = true;
  }
  for (const [key, q] of before) {
    if (seen.has(key)) continue;
    const was = old.data.subarray(q.start * stride, (q.start + q.count) * stride);
    prev.push(was);
    cur.push(leavingPath(kind, was));
    moved = true;
  }
  if (!moved && !enter.length) return null;
  // What belongs to no path (a lone datum between two gaps) stays as it is.
  for (let i = 0; i < covered.length; i++) {
    if (covered[i]) continue;
    let j = i;
    while (j < covered.length && !covered[j]) j++;
    const part = data.subarray(i * stride, j * stride);
    prev.push(part);
    cur.push(part);
    i = j;
  }
  return { prev: concat(prev), cur: concat(cur), enter: concat(enter) };
}

/** Every path of a draw that is gone, as the two states of its exit. */
function allLeaving(kind: string, old: { paths: DrawPath[]; data: Float32Array }): { prev: Float32Array; cur: Float32Array } {
  const stride = LAYOUTS[kind as PrimitiveKind].stride;
  const parts = old.paths.filter((q) => validPath(kind, old.data, q)).map((q) => old.data.subarray(q.start * stride, (q.start + q.count) * stride));
  const prev = concat(parts);
  return { prev, cur: leavingPath(kind, prev) };
}

/**
 * After a data change: every keyed instance moves from where it was (same key), new ones grow
 * from nothing, lines and areas are reshaped, and what is gone shrinks and fades. Hands each
 * batch its previous state, makes the batches the transition needs (never one per frame) and
 * returns them; null when nothing moves.
 */
export function startTransition(before: Snapshot, built: Built[], renderer: Pick<Renderer, 'createBatch'>): Transition | null {
  const t: Transition = { batches: [], stand: new Map(), ghosts: new Map(), owned: [] };
  /** A batch of the transition, with its two states. Undefined when the backend cannot blend. */
  const make = (kind: string, prev: Float32Array, cur: Float32Array): Batch | undefined => {
    const count = cur.length / LAYOUTS[kind as PrimitiveKind].stride;
    if (!count) return undefined;
    const batch = renderer.createBatch(kind as PrimitiveKind);
    if (!batch.setPrevious) {
      batch.destroy();
      return undefined;
    }
    batch.update(cur, count);
    batch.setPrevious(prev);
    t.owned.push(batch);
    return batch;
  };
  const ghost = (layer: number, kind: string, states: { prev: Float32Array; cur: Float32Array }, pixelSnap?: boolean) => {
    const batch = make(kind, states.prev, states.cur);
    if (batch) t.ghosts.set(layer, [...(t.ghosts.get(layer) ?? []), { batch, pixelSnap }]);
  };
  // Leftovers of the old state only leave when the chart is still the same one: same marks, layer for layer.
  const sameChart = built.every((b) => before.defs?.get(b.data.index) === b.def);
  const done = new Set<DrawState>();
  for (const b of built) {
    const old = before.get(b.data.index);
    if (!old) continue;
    b.mark.draws.forEach((d, di) => {
      const o = old[di];
      const kind = d.batch.kind;
      if (!d.data || !o || o.kind !== kind) return;
      const stride = LAYOUTS[kind].stride;
      if (d.keys && o.keys && d.batch.setPrevious && d.data.length >= d.keys.length * stride) {
        done.add(o);
        const keyed = { keys: o.keys, data: o.data };
        const { prev, moved } = previousInstances(kind, stride, d.keys, d.data, keyed);
        if (moved) {
          d.batch.setPrevious(prev);
          t.batches.push(d.batch);
        }
        const gone = leaving(o.keys, d.keys);
        if (gone.length) ghost(b.data.index, kind, exitInstances(kind, stride, keyed, gone, { keys: d.keys, data: d.data }), o.pixelSnap);
      } else if (d.paths && o.paths && (kind === 'line' || kind === 'mesh')) {
        done.add(o);
        if ((o.data.length + d.data.length) / stride > MAX_PATH_DATA) return;
        const states = pathStates(kind, { paths: o.paths, data: o.data }, d.paths, d.data);
        if (!states) return;
        const stand: StandIn[] = [];
        const blended = make(kind, states.prev, states.cur);
        if (blended) stand.push({ batch: blended });
        if (states.enter.length) {
          const entering = make(kind, states.enter, states.enter);
          if (entering) stand.push({ batch: entering, reveal: true });
        }
        // A backend that cannot blend keeps the mark's own batch: the change is then immediate.
        if (stand.length) t.stand.set(d.batch, stand);
      }
    });
  }
  if (sameChart) {
    for (const [layer, draws] of before) {
      for (const o of draws) {
        if (!o || done.has(o)) continue;
        const stride = LAYOUTS[o.kind as PrimitiveKind].stride;
        if (o.keys) ghost(layer, o.kind, exitInstances(o.kind, stride, { keys: o.keys, data: o.data }, o.keys.map((_, i) => i)), o.pixelSnap);
        else if (o.paths && o.data.length / stride <= MAX_PATH_DATA) ghost(layer, o.kind, allLeaving(o.kind, { paths: o.paths, data: o.data }), o.pixelSnap);
      }
    }
  }
  return t.batches.length || t.owned.length ? t : null;
}

/** The transition is over (or abandoned): previous states dropped, its own batches destroyed. */
export function endTransition(t: Transition): void {
  for (const b of t.batches) b.setPrevious?.(null);
  for (const b of t.owned) b.destroy();
}
