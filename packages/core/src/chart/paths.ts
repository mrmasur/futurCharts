/**
 * Transitions of lines and areas: two polylines that share neither their positions nor their
 * number of points are resampled once, on the CPU, onto one common sequence of positions.
 * The GPU then blends the two states vertex for vertex (`Batch.setPrevious` + `DrawCall.morph`).
 *
 * A path is handled as a list of "columns": a vertex of a line (position, color, width) or a
 * column of a ribbon (top, bottom and their colors). Everything here is pure and DOM-free.
 */
import type { DrawPath } from '../marks/registry';

/** A path as columns: `n` columns of `stride` floats, the first two being a position. */
export interface Columns {
  v: Float32Array;
  stride: number;
  n: number;
  /** Data points along the path: their identity and the column each one sits on. */
  anchors?: { keys: string[]; at: ArrayLike<number> };
}

/** line column: x, y, r, g, b, a, width. */
export const LINE_COLUMN = 7;
/** ribbon column: top x, y · bottom x, y · top rgba · bottom rgba. */
export const RIBBON_COLUMN = 12;
const LINE = 9;
const MESH = 6;

/** Whether a declared path fits the draw's data (a mark's mistake must not break an update). */
export function validPath(kind: string, data: Float32Array, p: DrawPath): boolean {
  const stride = kind === 'line' ? LINE : kind === 'mesh' ? MESH : 0;
  if (!stride || !(p.start >= 0) || !(p.count > 0) || (p.start + p.count) * stride > data.length) return false;
  return kind === 'line' || p.count % 6 === 0;
}

/** The columns of a path of a `line` batch (contiguous segments) or of a `mesh` batch (a ribbon). */
export function pathColumns(kind: string, data: Float32Array, p: DrawPath): Columns {
  if (kind === 'line') {
    const n = p.count + 1;
    const v = new Float32Array(n * LINE_COLUMN);
    for (let i = 0; i < n; i++) {
      // The last vertex is the end of the last segment, with that segment's color and width.
      const s = (p.start + Math.min(i, p.count - 1)) * LINE;
      const end = i === p.count ? 2 : 0;
      v[i * LINE_COLUMN] = data[s + end];
      v[i * LINE_COLUMN + 1] = data[s + end + 1];
      for (let q = 0; q < 5; q++) v[i * LINE_COLUMN + 2 + q] = data[s + 4 + q];
    }
    return { v, stride: LINE_COLUMN, n, anchors: p.anchors };
  }
  const quads = p.count / 6;
  const n = quads + 1;
  const v = new Float32Array(n * RIBBON_COLUMN);
  for (let i = 0; i < n; i++) {
    // Quad i: top i, top i+1, bottom i+1, top i, bottom i+1, bottom i.
    const base = (p.start + Math.min(i, quads - 1) * 6) * MESH;
    const top = base + (i === quads ? 1 : 0) * MESH;
    const bottom = base + (i === quads ? 2 : 5) * MESH;
    const o = i * RIBBON_COLUMN;
    v[o] = data[top];
    v[o + 1] = data[top + 1];
    v[o + 2] = data[bottom];
    v[o + 3] = data[bottom + 1];
    for (let q = 0; q < 4; q++) {
      v[o + 4 + q] = data[top + 2 + q];
      v[o + 8 + q] = data[bottom + 2 + q];
    }
  }
  return { v, stride: RIBBON_COLUMN, n, anchors: p.anchors };
}

/** Columns back to instances (`line`) or vertices (`mesh`), in the layout the marks write. */
export function columnsToData(kind: string, v: Float32Array, n: number): Float32Array {
  if (n < 2) return new Float32Array(0);
  if (kind === 'line') {
    const out = new Float32Array((n - 1) * LINE);
    for (let i = 0; i < n - 1; i++) {
      const a = i * LINE_COLUMN;
      const o = i * LINE;
      out[o] = v[a];
      out[o + 1] = v[a + 1];
      out[o + 2] = v[a + LINE_COLUMN];
      out[o + 3] = v[a + LINE_COLUMN + 1];
      for (let q = 0; q < 5; q++) out[o + 4 + q] = v[a + 2 + q];
    }
    return out;
  }
  const out = new Float32Array((n - 1) * 6 * MESH);
  let k = 0;
  const vertex = (col: number, bottom: boolean) => {
    const o = col * RIBBON_COLUMN;
    out[k++] = v[o + (bottom ? 2 : 0)];
    out[k++] = v[o + (bottom ? 3 : 1)];
    for (let q = 0; q < 4; q++) out[k++] = v[o + (bottom ? 8 : 4) + q];
  };
  for (let i = 0; i < n - 1; i++) {
    vertex(i, false);
    vertex(i + 1, false);
    vertex(i + 1, true);
    vertex(i, false);
    vertex(i + 1, true);
    vertex(i, true);
  }
  return out;
}

/**
 * Data points present in both paths, in the order of both: `[column in a, column in b]`.
 * A point keeps its identity, so the curve passes through it from start to end.
 */
export function pairAnchors(a: Columns, b: Columns): [number, number][] {
  const out: [number, number][] = [];
  if (!a.anchors || !b.anchors) return out;
  const pos = new Map<string, number>();
  b.anchors.keys.forEach((k, j) => pos.set(k, j));
  let lastA = -1;
  let lastB = -1;
  a.anchors.keys.forEach((k, i) => {
    const j = pos.get(k);
    if (j === undefined) return;
    const ca = a.anchors!.at[i];
    const cb = b.anchors!.at[j];
    // Both orders must agree (a re-sorted axis keeps only the points still in order).
    if (!(ca > lastA && cb > lastB && ca < a.n && cb < b.n)) return;
    out.push([ca, cb]);
    lastA = ca;
    lastB = cb;
  });
  return out;
}

/**
 * Position of each column of a span along it, 0 → 1: by x (or y) when it only advances, so a
 * point keeps its abscissa; by length along the path otherwise (steps, closed shapes).
 */
function spanParams(c: Columns, i0: number, i1: number): Float64Array {
  const m = i1 - i0;
  const t = new Float64Array(m + 1);
  if (m === 0) return t;
  const { v, stride } = c;
  for (const axis of [0, 1]) {
    const first = v[i0 * stride + axis];
    const range = v[i1 * stride + axis] - first;
    let monotone = range !== 0 && Number.isFinite(range);
    for (let i = i0; monotone && i < i1; i++) monotone = (v[(i + 1) * stride + axis] - v[i * stride + axis]) * range > 0;
    if (!monotone) continue;
    for (let i = 0; i <= m; i++) t[i] = (v[(i0 + i) * stride + axis] - first) / range;
    t[m] = 1;
    return t;
  }
  let total = 0;
  for (let i = 1; i <= m; i++) {
    const o = (i0 + i) * stride;
    total += Math.hypot(v[o] - v[o - stride], v[o + 1] - v[o - stride + 1]);
    t[i] = total;
  }
  const byLength = total > 0 && Number.isFinite(total);
  for (let i = 0; i <= m; i++) t[i] = byLength ? t[i] / total : i / m;
  t[m] = 1;
  return t;
}

/**
 * Two paths on one common sequence of positions: as many columns in `a` as in `b`, column i of
 * one facing column i of the other. Between two data points they share (anchors), both are cut
 * at every position either one has; a stretch only one of them has (new or gone data at an end)
 * faces the other's end point, so the curve grows out of, or folds back into, that end.
 * Without any shared point, the whole of one faces the whole of the other.
 * Each path keeps its exact shape: only vertices lying on it are added.
 */
export function resamplePair(a: Columns, b: Columns): { a: Float32Array; b: Float32Array; n: number } {
  const stride = a.stride;
  const pairs = pairAnchors(a, b);
  const cutsA = [0, ...pairs.map((p) => p[0]), a.n - 1];
  const cutsB = [0, ...pairs.map((p) => p[1]), b.n - 1];
  const outA: number[] = [];
  const outB: number[] = [];
  /** Column of `c` at parameter `t` of the span starting at column `i0`. */
  const emit = (out: number[], c: Columns, i0: number, params: Float64Array, t: number, cursor: { j: number }) => {
    const m = params.length - 1;
    while (cursor.j < m - 1 && params[cursor.j + 1] <= t) cursor.j++;
    const j = Math.min(cursor.j, Math.max(0, m - 1));
    const span = m > 0 ? params[j + 1] - params[j] : 0;
    const w = span > 0 ? Math.max(0, Math.min(1, (t - params[j]) / span)) : 0;
    const p = (i0 + j) * stride;
    const q = m > 0 ? p + stride : p;
    for (let k = 0; k < stride; k++) out.push(c.v[p + k] + (c.v[q + k] - c.v[p + k]) * w);
  };
  const EPS = 1e-6;
  for (let s = 0; s < cutsA.length - 1; s++) {
    const [a0, a1, b0, b1] = [cutsA[s], cutsA[s + 1], cutsB[s], cutsB[s + 1]];
    // Both at a single point: the next span (or the end) writes it.
    if (a1 === a0 && b1 === b0) continue;
    const ta = spanParams(a, a0, a1);
    const tb = spanParams(b, b0, b1);
    // Every position of either path, in order, without the end (it opens the next span).
    const ts: number[] = [0];
    let i = 1;
    let j = 1;
    while (i < ta.length || j < tb.length) {
      const t = j >= tb.length || (i < ta.length && ta[i] <= tb[j]) ? ta[i++] : tb[j++];
      if (t < 1 - EPS && t > ts[ts.length - 1] + EPS) ts.push(t);
    }
    const ca = { j: 0 };
    const cb = { j: 0 };
    for (const t of ts) {
      emit(outA, a, a0, ta, t, ca);
      emit(outB, b, b0, tb, t, cb);
    }
  }
  for (let k = 0; k < stride; k++) {
    outA.push(a.v[(a.n - 1) * stride + k]);
    outB.push(b.v[(b.n - 1) * stride + k]);
  }
  return { a: Float32Array.from(outA), b: Float32Array.from(outB), n: outA.length / stride };
}

/**
 * A path that leaves: the same geometry, faded to nothing; a ribbon also folds onto its base.
 * Returns the state to end on, for the data given as the state to start from.
 */
export function leavingPath(kind: string, data: Float32Array): Float32Array {
  const out = Float32Array.from(data);
  if (kind === 'line') {
    for (let i = 7; i < out.length; i += LINE) out[i] = 0;
    return out;
  }
  for (let quad = 0; quad + 6 * MESH <= out.length; quad += 6 * MESH) {
    // top i, top i+1, bottom i+1, top i, bottom i+1, bottom i: each top goes to its bottom.
    const fold = (top: number, bottom: number) => {
      out[quad + top * MESH] = out[quad + bottom * MESH];
      out[quad + top * MESH + 1] = out[quad + bottom * MESH + 1];
    };
    fold(0, 5);
    fold(3, 5);
    fold(1, 2);
    for (let q = 0; q < 6; q++) out[quad + q * MESH + 5] = 0;
  }
  return out;
}
