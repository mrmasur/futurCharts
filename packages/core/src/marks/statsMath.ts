/**
 * Statistics behind the distribution marks (`dotplot`, `ecdf`, `qq`, `contour`, `raincloud`):
 * pure functions on plain numbers, no table, no renderer. Tested in `test/stats.test.ts`.
 */

/** The finite values of `v`, ascending. */
export function sortedNumbers(v: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) out.push(v[i]);
  return out.sort((a, b) => a - b);
}

/** Quantile `q` of ascending values, linear interpolation between ranks (the spreadsheet / R type 7 rule). */
export function quantileSorted(s: ArrayLike<number>, q: number): number {
  const n = s.length;
  if (!n) return NaN;
  const p = (n - 1) * Math.min(1, Math.max(0, q));
  const i = Math.floor(p);
  return s[i] + (s[Math.min(n - 1, i + 1)] - s[i]) * (p - i);
}

export function mean(v: ArrayLike<number>): number {
  let a = 0;
  for (let i = 0; i < v.length; i++) a += v[i];
  return v.length ? a / v.length : NaN;
}

/** Sample standard deviation (n - 1). */
export function deviation(v: ArrayLike<number>): number {
  const n = v.length;
  if (n < 2) return 0;
  const m = mean(v);
  let a = 0;
  for (let i = 0; i < n; i++) a += (v[i] - m) ** 2;
  return Math.sqrt(a / (n - 1));
}

// ------------------------------------------------------------- normal law

export const normalPdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** Standard normal cumulative distribution (Abramowitz & Stegun 7.1.26 on erf: error below 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Inverse of the standard normal cumulative distribution (Acklam's rational approximation, error below 1.2e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------------------------------------------------------------- dot plot

export interface DotStack {
  /** Where the pile stands, in data units. */
  x: number;
  /** Indices (into the input) of the values piled here, ascending by value. */
  members: number[];
}

/**
 * Piles of a dot plot, for dots `width` wide (in data units).
 * `dotdensity` (Wilkinson): starting from the smallest value not yet piled, a pile takes every
 * value within `width` of it and stands in the middle of what it holds; a pile that would
 * overlap the previous one is pushed right, never past its own window (so a dot stays within
 * one dot width of its value). `histodot`: fixed bins from `origin`, piles at bin centers.
 */
export function dotStacks(values: ArrayLike<number>, width: number, binning: 'dotdensity' | 'histodot' = 'dotdensity', origin = 0): DotStack[] {
  const order: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) order.push(i);
  order.sort((a, b) => values[a] - values[b] || a - b);
  const out: DotStack[] = [];
  if (!(width > 0)) {
    for (const i of order) {
      const last = out[out.length - 1];
      if (last && last.x === values[i]) last.members.push(i);
      else out.push({ x: values[i], members: [i] });
    }
    return out;
  }
  if (binning === 'histodot') {
    let bin = NaN;
    for (const i of order) {
      const k = Math.floor((values[i] - origin) / width);
      if (k !== bin) out.push({ x: origin + (k + 0.5) * width, members: [] });
      bin = k;
      out[out.length - 1].members.push(i);
    }
    return out;
  }
  // A hair of tolerance: values exactly one width apart belong to the same pile whatever the rounding.
  const reach = width * (1 + 1e-9);
  let k = 0;
  while (k < order.length) {
    const start = values[order[k]];
    const members: number[] = [];
    while (k < order.length && values[order[k]] - start <= reach) members.push(order[k++]);
    const center = (start + values[members[members.length - 1]]) / 2;
    const prev = out[out.length - 1];
    out.push({ x: prev ? Math.max(center, prev.x + width) : center, members });
  }
  return out;
}

// -------------------------------------------------------------------- ECDF

export interface Ecdf {
  /** Distinct values, ascending. */
  x: number[];
  /** Share of the sample at or below each of them (ends at 1). */
  p: number[];
  n: number;
}

/** Empirical cumulative distribution: a step up of 1 / n at each observation. */
export function ecdf(values: ArrayLike<number>): Ecdf {
  const s = sortedNumbers(values);
  const n = s.length;
  const x: number[] = [];
  const p: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i + 1 < n && s[i + 1] === s[i]) continue;
    x.push(s[i]);
    p.push((i + 1) / n);
  }
  return { x, p, n };
}

/** Share of the sample at or below `v`. */
export function ecdfAt(e: Ecdf, v: number): number {
  let lo = 0;
  let hi = e.x.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (e.x[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo ? e.p[lo - 1] : 0;
}

/** Smallest observed value whose cumulative share reaches `q`: where the staircase crosses that height. */
export function ecdfQuantile(e: Ecdf, q: number): number {
  for (let i = 0; i < e.x.length; i++) if (e.p[i] >= q - 1e-12) return e.x[i];
  return e.x.length ? e.x[e.x.length - 1] : NaN;
}

// ---------------------------------------------------------------------- QQ

export interface QQPoint {
  /** Quantile of the reference (a z-score against the normal law, a value of the first sample otherwise). */
  theoretical: number;
  sample: number;
  /** Index of the observation in the input (-1 between two samples: quantiles are interpolated). */
  index: number;
}

export interface QQNormal {
  points: QQPoint[];
  /** Reference line `sample = intercept + slope * z`, through the first and third quartiles. */
  slope: number;
  intercept: number;
  n: number;
}

/**
 * Normal quantile-quantile plot: the i-th smallest value against the normal quantile of
 * (i - 0.5) / n. The reference line goes through the quartiles, so outliers do not tilt it.
 */
export function qqNormal(values: ArrayLike<number>): QQNormal {
  const order: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) order.push(i);
  order.sort((a, b) => values[a] - values[b] || a - b);
  const n = order.length;
  const points = order.map((index, i) => ({ theoretical: normalQuantile((i + 0.5) / n), sample: values[index], index }));
  const s = points.map((p) => p.sample);
  // Quartiles read at the same plotting positions as the points, so a perfectly normal sample sits on the line.
  const at = (p: number) => quantileSorted(s, (p * n - 0.5) / Math.max(1, n - 1));
  const q1 = at(0.25);
  const q3 = at(0.75);
  const z = normalQuantile(0.75);
  const slope = (q3 - q1) / (2 * z);
  return { points, slope, intercept: q1 + slope * z, n };
}

/**
 * Half-width, at z-score `z`, of the pointwise confidence band around the reference line:
 * the standard error of an order statistic, `slope / pdf(z) * sqrt(p (1 - p) / n)`, times the
 * critical value of `level` (0.95 → 1.96).
 */
export function qqBand(z: number, slope: number, n: number, level = 0.95): number {
  const p = normalCdf(z);
  const crit = normalQuantile(1 - (1 - level) / 2);
  return (crit * Math.abs(slope) * Math.sqrt((p * (1 - p)) / Math.max(1, n))) / normalPdf(z);
}

/** Quantiles of two samples against each other, at the plotting positions of the smaller one. */
export function qqTwoSample(a: ArrayLike<number>, b: ArrayLike<number>): QQPoint[] {
  const sa = sortedNumbers(a);
  const sb = sortedNumbers(b);
  const n = Math.min(sa.length, sb.length);
  const out: QQPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + 0.5) / n;
    // Same rule on both sides: the sample of n points gives back its own values.
    const at = (s: number[]) => quantileSorted(s, (p * s.length - 0.5) / Math.max(1, s.length - 1));
    out.push({ theoretical: at(sa), sample: at(sb), index: -1 });
  }
  return out;
}

// ----------------------------------------------------------------- density

/** Silverman's rule of thumb for a 1D Gaussian kernel (ascending values). */
export function silverman(s: ArrayLike<number>): number {
  const n = s.length;
  if (n < 2) return 1;
  const sd = deviation(s);
  const iqr = (quantileSorted(s, 0.75) - quantileSorted(s, 0.25)) / 1.34;
  const spread = Math.min(sd || iqr, iqr || sd) || Math.abs(s[0]) * 0.1 || 1;
  return 0.9 * spread * Math.pow(n, -0.2);
}

/** Gaussian kernel density of `values` at each of `xs` (bandwidth `h`). Integrates to 1. */
export function kde1d(values: ArrayLike<number>, xs: ArrayLike<number>, h: number): number[] {
  const n = values.length;
  const k = 1 / (Math.sqrt(2 * Math.PI) * Math.max(1, n) * h);
  const out: number[] = [];
  for (let j = 0; j < xs.length; j++) {
    let d = 0;
    for (let i = 0; i < n; i++) {
      const u = (xs[j] - values[i]) / h;
      if (u > -5 && u < 5) d += Math.exp(-0.5 * u * u);
    }
    out.push(d * k);
  }
  return out;
}

/** Scott's rule for one dimension of a 2D Gaussian kernel: `sd * n^(-1/6)`. */
export function scott(values: ArrayLike<number>): number {
  const n = values.length;
  const sd = deviation(values);
  return (sd || 1) * Math.pow(Math.max(1, n), -1 / 6);
}

export interface Box2D {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * 2D Gaussian kernel density on a regular grid of `nx` by `ny` nodes spanning `box` (node
 * (i, j) at index `j * nx + i`). Points are first shared between their four nearest nodes
 * (linear binning), then the grid is smoothed along x and along y: the cost does not depend
 * on the number of points. Values are densities (they integrate to 1 over the plane).
 */
export function density2d(xs: ArrayLike<number>, ys: ArrayLike<number>, box: Box2D, nx: number, ny: number, hx: number, hy: number): Float64Array {
  const w = new Float64Array(nx * ny);
  const dx = (box.x1 - box.x0) / (nx - 1);
  const dy = (box.y1 - box.y0) / (ny - 1);
  let n = 0;
  for (let k = 0; k < xs.length; k++) {
    const fx = (xs[k] - box.x0) / dx;
    const fy = (ys[k] - box.y0) / dy;
    if (!Number.isFinite(fx + fy)) continue;
    n++;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) continue;
    const i = Math.min(nx - 2, Math.floor(fx));
    const j = Math.min(ny - 2, Math.floor(fy));
    const u = fx - i;
    const v = fy - j;
    w[j * nx + i] += (1 - u) * (1 - v);
    w[j * nx + i + 1] += u * (1 - v);
    w[(j + 1) * nx + i] += (1 - u) * v;
    w[(j + 1) * nx + i + 1] += u * v;
  }
  if (!n) return w;
  const kernel = (h: number, step: number) => {
    const reach = Math.max(1, Math.ceil((4 * h) / step));
    const k = new Float64Array(reach + 1);
    for (let i = 0; i <= reach; i++) k[i] = Math.exp(-0.5 * ((i * step) / h) ** 2) / (Math.sqrt(2 * Math.PI) * h);
    return k;
  };
  const kx = kernel(hx, dx);
  const ky = kernel(hy, dy);
  const tmp = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = w[j * nx + i];
      if (!v) continue;
      const a = Math.max(0, i - kx.length + 1);
      const b = Math.min(nx - 1, i + kx.length - 1);
      for (let t = a; t <= b; t++) tmp[j * nx + t] += v * kx[Math.abs(t - i)];
    }
  }
  const out = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = tmp[j * nx + i];
      if (!v) continue;
      const a = Math.max(0, j - ky.length + 1);
      const b = Math.min(ny - 1, j + ky.length - 1);
      for (let t = a; t <= b; t++) out[t * nx + i] += (v * ky[Math.abs(t - j)]) / n;
    }
  }
  return out;
}

/**
 * Marching squares, filled: triangles (flat `x, y` pairs, in grid coordinates) covering the part
 * of the grid at or above `level`. Drawing the levels from the lowest up gives filled bands.
 * Saddle cells join their two high corners, as `contourSegments` does for the lines.
 */
export function contourFill(g: ArrayLike<number>, nx: number, ny: number, level: number): number[] {
  const out: number[] = [];
  const poly: number[] = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      // Corners counter-clockwise from (i, j).
      const cx = [i, i + 1, i + 1, i];
      const cy = [j, j, j + 1, j + 1];
      const v = [g[j * nx + i], g[j * nx + i + 1], g[(j + 1) * nx + i + 1], g[(j + 1) * nx + i]];
      if (Number.isNaN(v[0] + v[1] + v[2] + v[3])) continue;
      const inside = v.map((x) => x >= level);
      const count = +inside[0] + +inside[1] + +inside[2] + +inside[3];
      if (!count) continue;
      poly.length = 0;
      for (let k = 0; k < 4; k++) {
        const m = (k + 1) % 4;
        if (inside[k]) poly.push(cx[k], cy[k]);
        if (inside[k] !== inside[m]) {
          const t = (level - v[k]) / (v[m] - v[k]);
          poly.push(cx[k] + (cx[m] - cx[k]) * t, cy[k] + (cy[m] - cy[k]) * t);
        }
      }
      // Every case is convex (a square with corners cut off): a fan covers it.
      for (let k = 2; k < poly.length / 2; k++) {
        out.push(poly[0], poly[1], poly[2 * k - 2], poly[2 * k - 1], poly[2 * k], poly[2 * k + 1]);
      }
    }
  }
  return out;
}

/** Bilinear sample of a grid at fractional node coordinates. */
export function sampleGrid(g: ArrayLike<number>, nx: number, ny: number, fx: number, fy: number): number {
  if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return 0;
  const i = Math.min(nx - 2, Math.floor(fx));
  const j = Math.min(ny - 2, Math.floor(fy));
  const u = fx - i;
  const v = fy - j;
  return g[j * nx + i] * (1 - u) * (1 - v) + g[j * nx + i + 1] * u * (1 - v) + g[(j + 1) * nx + i] * (1 - u) * v + g[(j + 1) * nx + i + 1] * u * v;
}

// --------------------------------------------------------------------- box

export interface BoxStats {
  q1: number;
  median: number;
  q3: number;
  /** Whisker ends: the furthest values within 1.5 interquartile ranges of the box (Tukey). */
  low: number;
  high: number;
  n: number;
}

export function boxStats(s: ArrayLike<number>): BoxStats {
  const n = s.length;
  const q1 = quantileSorted(s, 0.25);
  const q3 = quantileSorted(s, 0.75);
  const reach = 1.5 * (q3 - q1);
  let low = q1;
  let high = q3;
  for (let i = 0; i < n; i++) {
    if (s[i] >= q1 - reach) {
      low = Math.min(low, s[i]);
      break;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    if (s[i] <= q3 + reach) {
      high = Math.max(high, s[i]);
      break;
    }
  }
  return { q1, median: quantileSorted(s, 0.5), q3, low, high, n };
}
