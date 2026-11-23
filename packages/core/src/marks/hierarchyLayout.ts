/**
 * Layouts of the hierarchy marks, without DOM or GPU: weighted Voronoi treemap
 * (power diagram + Lloyd relaxation) and the rows of an indented tree.
 */

export type Pt = [number, number];

// ------------------------------------------------------------------ polygons

/** Signed area (positive counter-clockwise). */
export function polygonArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}

export function polygonCentroid(p: Pt[]): Pt {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += f;
    x += (p[j][0] + p[i][0]) * f;
    y += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(a) < 1e-14) {
    // Degenerate: mean of the vertices.
    const n = p.length || 1;
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
  }
  return [x / (3 * a), y / (3 * a)];
}

/** Keep the part of a convex polygon where `nx * x + ny * y <= c`. */
function clipHalfPlane(p: Pt[], nx: number, ny: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const da = nx * a[0] + ny * a[1] - c;
    const db = nx * b[0] + ny * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function pointInPolygon(p: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The stretch of the horizontal line at `y` inside a convex polygon, or null. */
export function chordAt(p: Pt[], y: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y === yj > y) continue;
    const x = xj + ((xi - xj) * (y - yj)) / (yi - yj);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return hi > lo ? [lo, hi] : null;
}

/** A regular polygon standing in for a circle (counter-clockwise). */
export function circlePolygon(cx: number, cy: number, r: number, sides = 72): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

// ------------------------------------------------------------ voronoi treemap

/** Small seeded generator (mulberry32): the same seed always gives the same layout. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Power diagram of weighted sites, clipped to a convex polygon (half-plane clipping: fine for tens of sites). */
function powerCells(clip: Pt[], sx: Float64Array, sy: Float64Array, w: Float64Array): Pt[][] {
  const n = sx.length;
  const cells: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    let cell = clip;
    for (let j = 0; j < n && cell.length; j++) {
      if (j === i) continue;
      // |x - si|² - wi <= |x - sj|² - wj
      const nx = 2 * (sx[j] - sx[i]);
      const ny = 2 * (sy[j] - sy[i]);
      const c = sx[j] * sx[j] + sy[j] * sy[j] - sx[i] * sx[i] - sy[i] * sy[i] + w[i] - w[j];
      cell = clipHalfPlane(cell, nx, ny, c);
    }
    cells.push(cell);
  }
  return cells;
}

export interface VoronoiResult {
  /** One convex polygon per value, in the order of the values (empty for a value <= 0). */
  cells: Pt[][];
  /** Largest relative gap between a cell's area and its target. */
  error: number;
}

/**
 * Split a convex polygon into one convex cell per value, of area proportional to it.
 * Deterministic: seeded start, fixed number of rounds of weighted Lloyd relaxation
 * (sites move to the centroid of their cell, weights grow where area is missing);
 * the best round is kept.
 */
export function voronoiCells(values: number[], clip: Pt[], iterations = 120, seed = 1): VoronoiResult {
  const ids = values.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const out: Pt[][] = values.map(() => []);
  if (polygonArea(clip) < 0) clip = [...clip].reverse();
  const area = polygonArea(clip);
  const n = ids.length;
  if (!n || !(area > 0)) return { cells: out, error: 0 };
  if (n === 1) {
    out[ids[0]] = clip;
    return { cells: out, error: 0 };
  }
  const total = ids.reduce((s, i) => s + values[i], 0);
  const target = ids.map((i) => (values[i] / total) * area);
  // Start: random points of the polygon (rejection sampling in its bounding box).
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of clip) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const rand = mulberry(seed * 7919 + n);
  const center = polygonCentroid(clip);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const w = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let px = center[0], py = center[1];
    for (let tries = 0; tries < 200; tries++) {
      const qx = x0 + rand() * (x1 - x0);
      const qy = y0 + rand() * (y1 - y0);
      if (pointInPolygon(clip, qx, qy)) {
        px = qx; py = qy;
        break;
      }
    }
    // Pulled halfway to the center: no site starts squeezed against the border.
    sx[k] = (px + center[0]) / 2 + k * 1e-7;
    sy[k] = (py + center[1]) / 2 - k * 1e-7;
  }
  const errorOf = (cells: Pt[][]) => Math.max(...cells.map((c, k) => Math.abs((c.length ? polygonArea(c) : 0) - target[k]) / target[k]));
  let cells = powerCells(clip, sx, sy, w);
  let best = cells;
  let bestError = errorOf(cells);
  for (let it = 0; it < iterations && bestError > 1e-4; it++) {
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      const a = c.length ? polygonArea(c) : 0;
      if (a > 1e-12) [sx[k], sy[k]] = polygonCentroid(c);
      // A disc of power weight w covers pi * w: grow by the missing area.
      w[k] += ((target[k] - a) / Math.PI) * 0.9;
    }
    // Keep every site inside its own cell: |wi - wj| below the squared distance.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d2 = ((sx[i] - sx[j]) ** 2 + (sy[i] - sy[j]) ** 2) * 0.92;
          const over = Math.abs(w[i] - w[j]) - d2;
          if (over <= 0) continue;
          if (w[i] > w[j]) { w[i] -= over / 2; w[j] += over / 2; } else { w[j] -= over / 2; w[i] += over / 2; }
        }
      }
    }
    cells = powerCells(clip, sx, sy, w);
    const e = errorOf(cells);
    if (e < bestError) {
      bestError = e;
      best = cells;
    }
  }
  ids.forEach((i, k) => (out[i] = best[k]));
  return { cells: out, error: bestError };
}

// ------------------------------------------------------------------ hierarchy

export interface HNode {
  name: string;
  path: string[];
  /** Own value for a leaf, sum of the leaves below otherwise. */
  value: number;
  /** First table row of the node. */
  row: number;
  depth: number;
  children: HNode[];
}

export const pathKey = (path: string[]) => path.join('\u0000');

/**
 * A tree from rows: `levels[d][i]` is the name of row `i` at depth `d` (an empty name ends the
 * branch early), `values[i]` its measure (1 per row when absent). Rows without a positive value are left out.
 */
export function buildTree(levels: ArrayLike<unknown>[], values: ArrayLike<number> | undefined, skip?: (row: number) => boolean): HNode {
  const root: HNode = { name: '', path: [], value: 0, row: -1, depth: 0, children: [] };
  const n = levels[0]?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const v = values ? values[i] : 1;
    if (!(v > 0) || skip?.(i)) continue;
    let node = root;
    node.value += v;
    for (let d = 0; d < levels.length; d++) {
      const raw = levels[d][i];
      if (raw === '' || raw === undefined || raw === null) break;
      const name = String(raw);
      let c = node.children.find((m) => m.name === name);
      if (!c) {
        c = { name, path: [...node.path, name], value: 0, row: i, depth: d + 1, children: [] };
        node.children.push(c);
      }
      c.value += v;
      node = c;
    }
  }
  return root;
}

// -------------------------------------------------------------- indented tree

export interface IndentedRow {
  node: HNode;
  /** Top-level ancestor (the branch that gives the color). */
  top: HNode;
  /** Has children and shows them. */
  open: boolean;
}

/** Whether a node shows its children before any click: every node, none, or the first of each level. */
export function openByDefault(mode: 'all' | 'none' | 'first', indexInParent: number): boolean {
  return mode === 'all' || (mode === 'first' && indexInParent === 0);
}

/**
 * The visible rows of an indented tree, top to bottom: a node, then its children when it is open.
 * `toggled` holds the nodes the reader opened or closed (by `pathKey`); the others follow `mode`.
 */
export function indentedRows(root: HNode, mode: 'all' | 'none' | 'first', toggled: Record<string, boolean> = {}, sorted = true): IndentedRow[] {
  const rows: IndentedRow[] = [];
  const walk = (n: HNode, top: HNode | undefined) => {
    const children = sorted ? [...n.children].sort((a, b) => b.value - a.value) : n.children;
    children.forEach((c, i) => {
      const open = c.children.length > 0 && (toggled[pathKey(c.path)] ?? openByDefault(mode, i));
      const t = top ?? c;
      rows.push({ node: c, top: t, open });
      if (open) walk(c, t);
    });
  };
  walk(root, undefined);
  return rows;
}

/** Rows that fit in `capacity` lines: when some do not, the last line is kept for "+ n lignes". */
export function fitRows<T>(rows: T[], capacity: number): { rows: T[]; more: number } {
  if (rows.length <= capacity) return { rows, more: 0 };
  const keep = Math.max(0, capacity - 1);
  return { rows: rows.slice(0, keep), more: rows.length - keep };
}
