export type Curve = 'linear' | 'step' | 'smooth';

export interface Polyline {
  x: Float32Array;
  y: Float32Array;
}

const SUBDIVISIONS = 10;

/** Monotone cubic tangents (Fritsch–Carlson): smooth, and never overshoots the data. */
function tangents(x: ArrayLike<number>, y: ArrayLike<number>): Float64Array {
  const n = x.length;
  const d = new Float64Array(n - 1);
  const m = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) {
    const h = x[i + 1] - x[i];
    d[i] = h !== 0 ? (y[i + 1] - y[i]) / h : 0;
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return m;
}

/**
 * Turn data points into the polyline to draw. The x positions of the output
 * depend only on the input x, so two curves over the same x (the top and the
 * bottom of an area) stay aligned vertex for vertex.
 */
export function curvePoints(x: ArrayLike<number>, y: ArrayLike<number>, curve: Curve): Polyline {
  const n = x.length;
  if (curve === 'step' && n > 1) {
    const ox = new Float32Array(2 * n - 1);
    const oy = new Float32Array(2 * n - 1);
    for (let i = 0; i < n; i++) {
      ox[2 * i] = x[i];
      oy[2 * i] = y[i];
      if (i < n - 1) {
        ox[2 * i + 1] = x[i + 1];
        oy[2 * i + 1] = y[i];
      }
    }
    return { x: ox, y: oy };
  }
  if (curve === 'smooth' && n > 2) {
    const m = tangents(x, y);
    const count = (n - 1) * SUBDIVISIONS + 1;
    const ox = new Float32Array(count);
    const oy = new Float32Array(count);
    let k = 0;
    for (let i = 0; i < n - 1; i++) {
      const h = x[i + 1] - x[i];
      for (let j = 0; j < SUBDIVISIONS; j++, k++) {
        const t = j / SUBDIVISIONS;
        const t2 = t * t;
        const t3 = t2 * t;
        ox[k] = x[i] + h * t;
        oy[k] =
          (2 * t3 - 3 * t2 + 1) * y[i] +
          (t3 - 2 * t2 + t) * h * m[i] +
          (-2 * t3 + 3 * t2) * y[i + 1] +
          (t3 - t2) * h * m[i + 1];
      }
    }
    ox[k] = x[n - 1];
    oy[k] = y[n - 1];
    return { x: ox, y: oy };
  }
  return { x: Float32Array.from(x as ArrayLike<number>), y: Float32Array.from(y as ArrayLike<number>) };
}
