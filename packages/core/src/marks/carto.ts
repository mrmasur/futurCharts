/** Thematic maps: Dorling cartogram, pies, spikes and small bars placed on a map. */
import type { Table } from '../data/table';
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale, MercatorScale } from '../scale/scales';
import type { LayerSpec } from '../spec/types';
import { mix, parseColor, withAlpha } from '../util/color';
import { batches, need, share } from './charts';
import { luminance, pushArc, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type LegendRamp, type MarkDefinition, type MarkDraw, type MarkLabel, type MarkScales, type ShapeHit } from './registry';

const TAU = Math.PI * 2;
/** Rough width in px of a label at 11 px, semi-bold (no canvas to measure with at build time). */
const labelWidth = (text: string) => text.length * 6.3;
const RAD = Math.PI / 180;
const MAX_LAT = 85;

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;

/** Legend of a color bound to a number: the sequential ramp between both ends. */
function rampLegend(ctx: BuildContext, field: string, lo: number, hi: number): LegendRamp {
  return { colors: [0, 0.25, 0.5, 0.75, 1].map((t) => ctx.ramp(t)), min: ctx.format(lo, field), max: ctx.format(hi, field), title: fieldLabel(ctx, field) };
}

function numbers(table: Table, field: string, mark: string): Float64Array {
  const c = table.column(field);
  if (c.type === 'string') throw new Error(`futurCharts: field "${field}" must be numeric (mark "${mark}").`);
  return c.values as Float64Array;
}

/** Mercator ordinate of a latitude, in the unit of the longitudes (degrees at the equator). */
export function mercatorDegrees(lat: number): number {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2)) / RAD;
}

/** Symbols sized in px shrink with the map on a small chart (a phone), down to 45 %. */
const compact = (ctx: BuildContext) => Math.max(0.45, Math.min(1, Math.sqrt(1 / (ctx.pixel[0] * ctx.pixel[1])) / 400));

/**
 * Scales of a map mark used without `spec.projection`: a Mercator view fitted to
 * the data (`x` longitudes, `y` latitudes), with some room around.
 */
function lonLatScales(mark: string): NonNullable<MarkDefinition['scales']> {
  return ({ layer, table }): MarkScales => {
    const lon = numbers(table, need(layer, 'x', mark), mark);
    const lat = numbers(table, need(layer, 'y', mark), mark);
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (let i = 0; i < table.length; i++) {
      if (!Number.isFinite(lon[i] + lat[i])) continue;
      w = Math.min(w, lon[i]);
      e = Math.max(e, lon[i]);
      s = Math.min(s, lat[i]);
      n = Math.max(n, lat[i]);
    }
    if (w > e) [w, e, s, n] = [-180, 180, -58, 84];
    const px = Math.max(2, (e - w) * 0.12);
    const py = Math.max(2, (n - s) * 0.16);
    const y = new MercatorScale(Math.max(-MAX_LAT, s - py), Math.min(MAX_LAT, n + py));
    return { x: new LinearScale(w - px, e + px), y, aspect: ((e - w + 2 * px) * RAD) / y.span };
  };
}

// ---------------------------------------------------------------- centroids

export interface GeoCentroid {
  /** Join key of the shape (`layer.geoKey` path, default its name). */
  key: string;
  name: string;
  lon: number;
  lat: number;
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * Area-weighted centroid of a ring of [lon, lat] positions (planar, in degrees). Longitudes are
 * made continuous first, so a ring crossing the antimeridian does not average out to Greenwich.
 */
export function ringCentroid(ring: ArrayLike<ArrayLike<number>>): { lon: number; lat: number; area: number } {
  const n = ring.length;
  if (n === 0) return { lon: 0, lat: 0, area: 0 };
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let lon = ring[0][0];
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) lon += wrap(ring[i][0] - ring[i - 1][0]);
    xs[i] = lon;
    ys[i] = ring[i][1];
    mx += xs[i] / n;
    my += ys[i] / n;
  }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    // Relative to the mean: keeps the cross products small and exact enough.
    const x0 = xs[j] - mx, y0 = ys[j] - my, x1 = xs[i] - mx, y1 = ys[i] - my;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) return { lon: wrap(mx), lat: my, area: 0 };
  return { lon: wrap(mx + cx / (3 * a)), lat: my + cy / (3 * a), area: Math.abs(a) / 2 };
}

/**
 * One point per shape of a GeoJSON object: the centroid of its largest polygon (mainland France
 * rather than a point in the Atlantic between France and Guiana). Areas are weighted by the
 * cosine of the latitude, so that polar islands do not win over a mainland.
 */
export function geoCentroids(geo: unknown, keyPath?: string): GeoCentroid[] {
  type Json = Record<string, any>;
  const out: GeoCentroid[] = [];
  const at = (feature: Json, path: string): unknown => path.split('.').reduce<any>((o, k) => (o === null || o === undefined ? undefined : o[k]), feature);
  const visit = (node: Json | null | undefined, feature: Json | undefined): void => {
    if (!node) return;
    if (node.type === 'FeatureCollection') for (const f of node.features ?? []) visit(f, undefined);
    else if (node.type === 'Feature') visit(node.geometry, node);
    else if (node.type === 'GeometryCollection') for (const g of node.geometries ?? []) visit(g, feature);
    else if (node.type === 'Polygon' || node.type === 'MultiPolygon') {
      const polygons: number[][][][] = node.type === 'Polygon' ? [node.coordinates] : node.coordinates;
      let best: { lon: number; lat: number } | undefined;
      let bestArea = -1;
      for (const polygon of polygons) {
        if (!polygon[0]?.length) continue;
        const c = ringCentroid(polygon[0]);
        const weight = c.area * Math.cos(Math.max(-89, Math.min(89, c.lat)) * RAD);
        if (weight > bestArea) {
          bestArea = weight;
          best = c;
        }
      }
      if (!best) return;
      const name = feature?.properties?.name ?? feature?.id ?? '';
      const key = keyPath && feature ? at(feature, keyPath) : name;
      out.push({ key: String(key ?? ''), name: String(name), lon: best.lon, lat: best.lat });
    }
  };
  visit(geo as Json, undefined);
  return out;
}

// ------------------------------------------------------------------ dorling

/**
 * Radii proportional to the square root of the values (areas proportional to the values), sized
 * so that the circles together cover `coverage` of the box around the anchors.
 */
export function dorlingRadii(xs: ArrayLike<number>, ys: ArrayLike<number>, values: ArrayLike<number>, coverage: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sum = 0;
  for (let i = 0; i < n; i++) {
    x0 = Math.min(x0, xs[i]);
    x1 = Math.max(x1, xs[i]);
    y0 = Math.min(y0, ys[i]);
    y1 = Math.max(y1, ys[i]);
    sum += Math.max(0, values[i]);
  }
  if (!(sum > 0) || n === 0) return out;
  let w = x1 - x0;
  let h = y1 - y0;
  // A single point, or points in a line: still a box to fill.
  const side = Math.max(w, h) || 1;
  w = Math.max(w, side * 0.35);
  h = Math.max(h, side * 0.35);
  const k = Math.sqrt((coverage * w * h) / (Math.PI * sum));
  for (let i = 0; i < n; i++) out[i] = k * Math.sqrt(Math.max(0, values[i]));
  return out;
}

/**
 * Dorling relaxation: every circle is pulled back to its anchor and pushed away from the circles
 * it overlaps (the larger one moves less). Deterministic: a fixed number of iterations, no random
 * start. The pull fades out, and the last passes only separate, so that the result has no overlap.
 * x and y must be in the same unit as the radii.
 */
export function dorlingLayout(anchors: { x: number; y: number; r: number }[], iterations = 140): { x: number; y: number }[] {
  const n = anchors.length;
  const x = Float64Array.from(anchors, (a) => a.x);
  const y = Float64Array.from(anchors, (a) => a.y);
  const r = Float64Array.from(anchors, (a) => a.r);
  // Sweep along x: only circles whose x ranges meet can collide.
  const order = Array.from({ length: n }, (_, i) => i);
  let maxR = 0;
  for (let i = 0; i < n; i++) maxR = Math.max(maxR, r[i]);
  /** One pass over every overlapping pair. `push` > 1 parts them a little more than needed, which ends the chain reactions. */
  const separate = (push = 1): number => {
    order.sort((a, b) => x[a] - x[b] || a - b);
    let worst = 0;
    for (let p = 0; p < n; p++) {
      const i = order[p];
      for (let q = p + 1; q < n; q++) {
        const j = order[q];
        if (x[j] - x[i] > r[i] + maxR) break;
        const min = r[i] + r[j];
        let dx = x[j] - x[i];
        let dy = y[j] - y[i];
        let d = Math.hypot(dx, dy);
        if (d >= min || min === 0) continue;
        if (d < 1e-12) {
          // Same spot: part them in a direction fixed by their ranks.
          const a = (Math.min(i, j) * 0.618034 + Math.max(i, j) * 0.381966) * TAU;
          dx = Math.cos(a) * (i < j ? 1 : -1);
          dy = Math.sin(a) * (i < j ? 1 : -1);
          d = 1;
          const over = min;
          const wi = (r[j] * r[j]) / (r[i] * r[i] + r[j] * r[j]);
          x[i] -= dx * over * wi;
          y[i] -= dy * over * wi;
          x[j] += dx * over * (1 - wi);
          y[j] += dy * over * (1 - wi);
          worst = Math.max(worst, 1);
          continue;
        }
        worst = Math.max(worst, (min - d) / min);
        const over = (min - d) * push;
        // The lighter circle gives way.
        const wi = (r[j] * r[j]) / (r[i] * r[i] + r[j] * r[j]);
        const ux = dx / d;
        const uy = dy / d;
        x[i] -= ux * over * wi;
        y[i] -= uy * over * wi;
        x[j] += ux * over * (1 - wi);
        y[j] += uy * over * (1 - wi);
      }
    }
    return worst;
  };
  const pulled = Math.max(1, Math.floor(iterations * 0.7));
  for (let it = 0; it < iterations; it++) {
    if (it < pulled) {
      const k = 0.12 * (1 - it / pulled);
      for (let i = 0; i < n; i++) {
        x[i] += (anchors[i].x - x[i]) * k;
        y[i] += (anchors[i].y - y[i]) * k;
      }
    }
    for (let s = 0; s < 3; s++) if (separate() === 0 && it >= pulled) break;
  }
  // What a crowded spot still holds after the fixed budget: separate until nothing overlaps.
  for (let s = 0; s < 400; s++) if (separate(1.08) === 0) break;
  return Array.from({ length: n }, (_, i) => ({ x: x[i], y: y[i] }));
}

interface DorlingNode {
  key: string;
  label: string;
  short: string;
  /** Anchor: longitude and latitude. */
  lon: number;
  lat: number;
  value: number;
  row: number;
}

function dorlingNodes(layer: LayerSpec, table: Table): DorlingNode[] {
  const vf = layer.encode.value ?? need(layer, 'size', 'dorling');
  const values = numbers(table, vf, 'dorling');
  const xf = layer.encode.x;
  const yf = layer.encode.y;
  const kf = layer.encode.key;
  const style = (layer.style ?? {}) as { label?: string; shortLabel?: string };
  const text = (f: string | undefined, i: number) => (f && table.has(f) ? String(table.column(f).values[i]) : '');
  const nodes: DorlingNode[] = [];
  const push = (i: number, lon: number, lat: number) => {
    if (!Number.isFinite(lon + lat) || !(values[i] > 0)) return;
    const key = kf ? text(kf, i) : `${lon},${lat}`;
    nodes.push({ key, label: text(style.label, i) || key, short: text(style.shortLabel, i), lon, lat, value: values[i], row: i });
  };
  if (xf && yf) {
    const lon = numbers(table, xf, 'dorling');
    const lat = numbers(table, yf, 'dorling');
    for (let i = 0; i < table.length; i++) push(i, lon[i], lat[i]);
    return nodes;
  }
  // No coordinates: the rows are joined to the shapes of `layer.geo` on `key`.
  if (!kf || !layer.geo) throw new Error('futurCharts: mark "dorling" needs encode.x and encode.y (longitude, latitude), or layer.geo and encode.key.');
  const centroids = new Map(geoCentroids(layer.geo, layer.geoKey).map((c) => [c.key, c]));
  for (let i = 0; i < table.length; i++) {
    const c = centroids.get(text(kf, i));
    if (c) push(i, c.lon, c.lat);
  }
  return nodes;
}

/** The x scale of a standalone Dorling cartogram carries its layout: `build` reads it back. */
class DorlingAxis extends LinearScale {
  placed: { nodes: DorlingNode[]; x: Float64Array; y: Float64Array; r: Float64Array } | undefined;
}

/**
 * `dorling`: a Dorling cartogram. One circle per row, its area proportional to `value`, as close
 * as possible to its place on the map without overlapping its neighbours. The place is
 * (`x` longitude, `y` latitude), or the centroid of the shape of `layer.geo` named by `key`.
 * `color`: a category (legend) or a number (sequential ramp). Works alone (it then frames
 * itself) or over a basemap with `spec.projection`.
 */
export const dorling: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales({ layer, table }) {
    const style = (layer.style ?? {}) as { coverage?: number; iterations?: number };
    const nodes = dorlingNodes(layer, table);
    const ax = nodes.map((d) => d.lon);
    const ay = nodes.map((d) => mercatorDegrees(d.lat));
    const r = dorlingRadii(ax, ay, nodes.map((d) => d.value), style.coverage ?? 0.36);
    const pos = dorlingLayout(nodes.map((_, i) => ({ x: ax[i], y: ay[i], r: r[i] })), style.iterations ?? 140);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pos.forEach((p, i) => {
      x0 = Math.min(x0, p.x - r[i]);
      x1 = Math.max(x1, p.x + r[i]);
      y0 = Math.min(y0, p.y - r[i]);
      y1 = Math.max(y1, p.y + r[i]);
    });
    if (!nodes.length) [x0, x1, y0, y1] = [0, 1, 0, 1];
    const m = Math.max(x1 - x0, y1 - y0) * 0.015;
    const x = new DorlingAxis(x0 - m, x1 + m);
    x.placed = { nodes, x: Float64Array.from(pos, (p) => p.x), y: Float64Array.from(pos, (p) => p.y), r };
    return { x, y: new LinearScale(y0 - m, y1 + m), aspect: (x1 - x0 + 2 * m) / (y1 - y0 + 2 * m) };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style } = ctx;
    const vf = layer.encode.value ?? need(layer, 'size', 'dorling');
    const own = ctx.x instanceof DorlingAxis ? ctx.x.placed : undefined;
    let nodes: DorlingNode[];
    /** Centers in scale space, radii in scale units along x. */
    let cx: Float64Array, cy: Float64Array, rr: Float64Array;
    /** One scale unit along y, in scale units along x. */
    let yToX: number;
    if (own) {
      nodes = own.nodes;
      const unit = ctx.x.norm(1) - ctx.x.norm(0);
      cx = own.x.map((v) => ctx.x.norm(v));
      cy = own.y.map((v) => ctx.y.norm(v));
      rr = own.r.map((v) => v * unit);
      yToX = unit / (ctx.y.norm(1) - ctx.y.norm(0));
    } else {
      // On a projection: laid out in the view, where one px is the same along x and y.
      nodes = dorlingNodes(layer, table);
      yToX = ctx.pixel[0] / ctx.pixel[1];
      const ax = nodes.map((d) => ctx.x.norm(d.lon));
      const ay = nodes.map((d) => ctx.y.norm(d.lat) * yToX);
      rr = dorlingRadii(ax, ay, nodes.map((d) => d.value), style.coverage);
      const pos = dorlingLayout(nodes.map((_, i) => ({ x: ax[i], y: ay[i], r: rr[i] })), style.iterations);
      cx = Float64Array.from(pos, (p) => p.x);
      cy = Float64Array.from(pos, (p) => p.y / yToX);
    }

    // Color: a category (legend), a number (ramp), or one color for all.
    const cf = layer.encode.color;
    const ccol = cf ? table.column(cf) : undefined;
    const numeric = !!ccol && ccol.type !== 'string';
    let lo = Infinity, hi = -Infinity;
    if (numeric) {
      for (const d of nodes) {
        const v = ccol!.values[d.row] as number;
        if (Number.isNaN(v)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    const legendKeys: string[] = [];
    const groupOf = (d: DorlingNode) => (ccol && !numeric ? String(ccol.values[d.row]) : '');
    if (ccol && !numeric) for (const d of nodes) if (!legendKeys.includes(groupOf(d))) legendKeys.push(groupOf(d));
    const single = style.color ? parseColor(style.color) : ctx.categorical(fieldLabel(ctx, vf));
    const colorOf = (d: DorlingNode): RGBA => {
      let base: RGBA;
      if (!ccol) base = single;
      else if (numeric) base = ctx.ramp(hi > lo ? ((ccol.values[d.row] as number) - lo) / (hi - lo) : 0.5);
      else base = ctx.categorical(groupOf(d));
      return withAlpha(ctx.paint(base, d.row), style.opacity);
    };

    // Largest first: where circles still touch, the small ones stay on top.
    const order = nodes.map((_, i) => i).filter((i) => !ctx.hidden.has(groupOf(nodes[i]))).sort((a, b) => rr[b] - rr[a]);
    const arcs: number[] = [];
    const labels: MarkLabel[] = [];
    const fills: RGBA[] = [];
    for (const i of order) {
      const d = nodes[i];
      const fill = colorOf(d);
      fills.push(fill);
      pushArc(arcs, cx[i], cy[i], 0, rr[i], 0, TAU, style.gap, fill);
      if (!style.labels) continue;
      const box = (w: number, h: number): [number, number, number, number] => [cx[i] - rr[i] * w, cy[i] - (rr[i] * h) / yToX, cx[i] + rr[i] * w, cy[i] + (rr[i] * h) / yToX];
      const at = { tx: cx[i], ty: cy[i], on: fill, align: 'center' as const, baseline: 'middle' as const, series: groupOf(d) || undefined };
      const code: MarkLabel | undefined = d.short ? { ...at, text: d.short, size: 9.5, weight: 600, box: box(0.92, 0.5) } : undefined;
      const name: MarkLabel = { ...at, text: d.label, size: 11, weight: 600, box: box(0.88, 0.53), fallback: code };
      if (style.values) {
        // Name over value where both lines fit, else the name alone, else its short form.
        labels.push({ ...name, dy: -6, box: box(0.8, 0.6), fallback: name });
        labels.push({ ...at, text: ctx.format(d.value, vf), size: 10, weight: 500, dy: 7, box: box(0.8, 0.6) });
      } else labels.push(name);
    }
    const batch = ctx.renderer.createBatch('arc');
    const data = new Float32Array(arcs);
    batch.update(data, arcs.length / LAYOUTS.arc.stride);
    const draw: MarkDraw = { batch, data, keys: order.map((i) => nodes[i].key) };
    const draws: MarkDraw[] = [draw];
    // Rim inside each circle, its fill pulled towards the ink: a pale or dark circle stays apart
    // from a basemap of the same tone.
    if (style.outline > 0 && order.length) {
      const ink = parseColor(ctx.theme.text.primary);
      const w = style.outline * ctx.pixel[0];
      const pull = luminance(ctx.surface) < 0.2 ? 0.55 : 0.28;
      const rims: number[] = [];
      order.forEach((i, k) => pushArc(rims, cx[i], cy[i], Math.max(0, rr[i] - w), rr[i], 0, TAU, 0, withAlpha(mix(fills[k], ink, pull), 1)));
      const rb = ctx.renderer.createBatch('arc');
      rb.update(new Float32Array(rims), rims.length / LAYOUTS.arc.stride);
      draws.push({ batch: rb });
    }

    return {
      draws,
      hit: emptyHit(),
      labels,
      legend: legendKeys.map((k) => ({ key: k, color: ctx.categorical(k) })),
      legendRamp: numeric && hi > lo ? rampLegend(ctx, cf!, lo, hi) : undefined,
      pick(tx, ty): ShapeHit | null {
        for (let k = order.length - 1; k >= 0; k--) {
          const i = order[k];
          if (Math.hypot(tx - cx[i], (ty - cy[i]) * yToX) > rr[i]) continue;
          const d = nodes[i];
          const rows = [{ label: fieldLabel(ctx, vf), value: ctx.format(d.value, vf) }];
          if (cf && cf !== vf) rows.push({ label: fieldLabel(ctx, cf), value: numeric ? ctx.format(ccol!.values[d.row] as number, cf) : groupOf(d) });
          return { title: d.label, rows };
        }
        return null;
      },
    };
  },
};

// ------------------------------------------------------------------- places

interface Place {
  key: string;
  lon: number;
  lat: number;
  row: number;
  /** One entry per value of `encode.color`, in the order of `groups`. */
  parts: { group: string; value: number; row: number }[];
  total: number;
}

/** Rows gathered by place (`key`, or the coordinates themselves) and split by `color`. */
function placesOf(ctx: BuildContext, mark: string): { places: Place[]; groups: string[]; vf: string } {
  const { layer, table } = ctx.data;
  const lon = numbers(table, need(layer, 'x', mark), mark);
  const lat = numbers(table, need(layer, 'y', mark), mark);
  const vf = layer.encode.value ?? need(layer, 'size', mark);
  const values = numbers(table, vf, mark);
  const kcol = layer.encode.key ? table.column(layer.encode.key).values : undefined;
  const gcol = layer.encode.color ? table.column(layer.encode.color).values : undefined;
  const single = fieldLabel(ctx, vf);
  const groups: string[] = [];
  const byKey = new Map<string, Place>();
  for (let i = 0; i < table.length; i++) {
    if (!Number.isFinite(lon[i] + lat[i]) || !(values[i] > 0)) continue;
    const group = gcol ? String(gcol[i]) : single;
    if (!groups.includes(group)) groups.push(group);
    const key = kcol ? String(kcol[i]) : `${lon[i]},${lat[i]}`;
    let p = byKey.get(key);
    if (!p) byKey.set(key, (p = { key, lon: lon[i], lat: lat[i], row: i, parts: [], total: 0 }));
    const part = p.parts.find((q) => q.group === group);
    if (part) part.value += values[i];
    else p.parts.push({ group, value: values[i], row: i });
  }
  const places = [...byKey.values()];
  for (const p of places) {
    p.parts = p.parts.filter((q) => !ctx.hidden.has(q.group)).sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group));
    p.total = p.parts.reduce((a, q) => a + q.value, 0);
  }
  return { places: places.filter((p) => p.total > 0), groups, vf };
}

/** Tooltip of a place: every part with its share, the one under the pointer first. */
function placeHit(ctx: BuildContext, p: Place, vf: string, focus?: string): ShapeHit {
  const parts = focus ? [...p.parts].sort((a, b) => Number(b.group === focus) - Number(a.group === focus)) : p.parts;
  const rows = parts.slice(0, 8).map((q) => ({ label: q.group, value: p.parts.length > 1 ? `${ctx.format(q.value, vf)} · ${share(q.value, p.total)}` : ctx.format(q.value, vf) }));
  if (p.parts.length > 1) rows.push({ label: 'Total', value: ctx.format(p.total, vf) });
  return { title: p.key, rows };
}

// ------------------------------------------------------------------- mapPie

/**
 * `mapPie`: one pie (or ring, `style.innerRadius`) per place at (`x` longitude, `y` latitude).
 * Rows are gathered by `key`; `color` names the slices, `value` sizes them, and the area of a
 * pie follows its total (`style.sizeRange`, diameters in px). Meant to sit over a `geoshape`
 * layer under `spec.projection`.
 */
export const mapPie: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: lonLatScales('mapPie'),
  build(ctx) {
    const { style, theme } = ctx;
    const { places, groups, vf } = placesOf(ctx, 'mapPie');
    const [px, py] = ctx.pixel;
    const k = compact(ctx);
    const [d0, d1] = style.sizeRange as [number, number];
    const max = Math.max(0, ...places.map((p) => p.total));
    const radius = (p: Place) => ((d0 + (d1 - d0) * Math.sqrt(max > 0 ? p.total / max : 0.5)) / 2) * k;
    // Largest first, so that a small pie is never hidden under a large one.
    const order = [...places].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
    const arcs: number[] = [];
    const keys: string[] = [];
    const labels: MarkLabel[] = [];
    const discs: { p: Place; cx: number; cy: number; r: number; r0: number; bounds: number[] }[] = [];
    for (const p of order) {
      const cx = ctx.x.norm(p.lon);
      const cy = ctx.y.norm(p.lat);
      const r = radius(p);
      const r0 = r * Math.max(0, Math.min(0.9, style.innerRadius));
      // A rim in the surface color detaches the pie from the map and from its neighbours.
      if (style.outline > 0) {
        pushArc(arcs, cx, cy, Math.max(0, r0 - style.outline) * px, (r + style.outline) * px, 0, TAU, 0, ctx.surface);
        keys.push(`${p.key}\u0000`);
      }
      const bounds = [0];
      let a = 0;
      for (const q of p.parts) {
        const a1 = a + (q.value / p.total) * TAU;
        const fill = withAlpha(ctx.paint(ctx.categorical(q.group), q.row), style.opacity);
        pushArc(arcs, cx, cy, r0 * px, r * px, a, a1, p.parts.length > 1 ? style.gap : 0, fill);
        keys.push(`${p.key}\u0000${q.group}`);
        bounds.push(a1);
        a = a1;
      }
      discs.push({ p, cx, cy, r, r0, bounds });
    }
    if (style.labels) {
      // A name goes under its pie, or above it when another pie is in the way, or nowhere.
      const free = (d: (typeof discs)[number], above: boolean): boolean => {
        const half = (labelWidth(d.p.key) / 2) * px * (k < 0.8 ? 1.2 : 1);
        const edge = (d.r + style.outline + 3) * py;
        const y0 = above ? d.cy + edge : d.cy - edge - 13 * py;
        const y1 = y0 + 13 * py;
        return discs.every((o) => {
          if (o === d) return true;
          // Nearest point of the text box to the other pie's center, in px.
          const nx = (Math.max(d.cx - half, Math.min(d.cx + half, o.cx)) - o.cx) / px;
          const ny = (Math.max(y0, Math.min(y1, o.cy)) - o.cy) / py;
          return Math.hypot(nx, ny) > o.r + style.outline + 1;
        });
      };
      // On a small map, only the largest pies are named.
      for (const d of k < 0.8 ? discs.slice(0, 5) : discs) {
        const above = !free(d, false);
        if (above && !free(d, true)) continue;
        const edge = (d.r + style.outline) * py;
        labels.push({ tx: d.cx, ty: above ? d.cy + edge : d.cy - edge, dy: above ? -3 : 3, text: d.p.key, color: theme.text.primary, size: 11, weight: 600, align: 'center', baseline: above ? 'bottom' : 'top' });
      }
    }
    const batch = ctx.renderer.createBatch('arc');
    const data = new Float32Array(arcs);
    batch.update(data, arcs.length / LAYOUTS.arc.stride);
    return {
      draws: [{ batch, data, keys }],
      hit: emptyHit(),
      labels,
      legend: groups.map((g) => ({ key: g, color: ctx.categorical(g) })),
      pick(tx, ty): ShapeHit | null {
        for (let i = discs.length - 1; i >= 0; i--) {
          const d = discs[i];
          const dx = (tx - d.cx) / px;
          const dy = (ty - d.cy) / py;
          const dist = Math.hypot(dx, dy);
          if (dist > d.r || dist < d.r0) continue;
          // Clockwise from 12 o'clock; scale space has y up.
          const a = (Math.atan2(dx, dy) + TAU) % TAU;
          const s = Math.max(0, d.bounds.findIndex((b) => b > a) - 1);
          return placeHit(ctx, d.p, vf, d.p.parts[Math.min(s, d.p.parts.length - 1)]?.group);
        }
        return null;
      },
    };
  },
};

// -------------------------------------------------------------------- spike

/**
 * A spike: an isosceles triangle standing on its place, `height` and `width` in px. Returns
 * base left, base right and tip in scale space (y up).
 */
export function spikeTriangle(cx: number, cy: number, height: number, width: number, pixel: [number, number]): [number, number, number, number, number, number] {
  const hw = (width / 2) * pixel[0];
  return [cx - hw, cy, cx + hw, cy, cx, cy + height * pixel[1]];
}

/**
 * `spike`: one thin triangle per row at (`x` longitude, `y` latitude), as tall as `value`
 * (linear, `style.height` px for the largest). Spikes stay readable where bubbles would pile up.
 * `color`: a category (legend) or a number (ramp); `key` names the place.
 */
export const spike: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'line',
  scales: lonLatScales('spike'),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const lon = numbers(table, need(layer, 'x', 'spike'), 'spike');
    const lat = numbers(table, need(layer, 'y', 'spike'), 'spike');
    const vf = layer.encode.value ?? need(layer, 'size', 'spike');
    const values = numbers(table, vf, 'spike');
    const kf = layer.encode.key;
    const cf = layer.encode.color;
    const ccol = cf ? table.column(cf) : undefined;
    const numeric = !!ccol && ccol.type !== 'string';
    const groupOf = (i: number) => (ccol && !numeric ? String(ccol.values[i]) : '');
    const rows: number[] = [];
    let max = 0, lo = Infinity, hi = -Infinity;
    const legendKeys: string[] = [];
    for (let i = 0; i < table.length; i++) {
      if (!Number.isFinite(lon[i] + lat[i]) || !(values[i] > 0)) continue;
      if (ccol && !numeric && !legendKeys.includes(groupOf(i))) legendKeys.push(groupOf(i));
      if (ctx.hidden.has(groupOf(i))) continue;
      rows.push(i);
      max = Math.max(max, values[i]);
      if (numeric && !Number.isNaN(ccol!.values[i] as number)) {
        lo = Math.min(lo, ccol!.values[i] as number);
        hi = Math.max(hi, ccol!.values[i] as number);
      }
    }
    // North first: a spike is drawn over the ones behind (above) it.
    rows.sort((a, b) => lat[b] - lat[a] || lon[a] - lon[b]);
    const k = compact(ctx);
    const single = style.color ? parseColor(style.color) : ctx.categorical(fieldLabel(ctx, vf));
    const mesh: number[] = [];
    const lines: number[] = [];
    const tris: { row: number; t: ReturnType<typeof spikeTriangle> }[] = [];
    for (const i of rows) {
      let base: RGBA;
      if (!ccol) base = single;
      else if (numeric) base = ctx.ramp(hi > lo ? ((ccol.values[i] as number) - lo) / (hi - lo) : 0.5);
      else base = ctx.categorical(groupOf(i));
      const c = ctx.paint(base, i);
      const t = spikeTriangle(ctx.x.norm(lon[i]), ctx.y.norm(lat[i]), (values[i] / max) * style.height * k, style.width * k, ctx.pixel);
      // Fainter at the foot than at the tip: the map shows through where spikes crowd.
      pushVertex(mesh, t[0], t[1], withAlpha(c, style.opacity * 0.6));
      pushVertex(mesh, t[2], t[3], withAlpha(c, style.opacity * 0.6));
      pushVertex(mesh, t[4], t[5], withAlpha(c, Math.min(1, style.opacity * 1.6)));
      if (style.strokeWidth > 0) {
        pushSegment(lines, t[0], t[1], t[4], t[5], c, style.strokeWidth);
        pushSegment(lines, t[4], t[5], t[2], t[3], c, style.strokeWidth);
      }
      tris.push({ row: i, t });
    }
    const labels: MarkLabel[] = [];
    if (style.labels && kf) {
      // The tallest spikes get their name at the tip; fewer on a small chart.
      const top = Math.max(0, Math.round(style.top * (k < 0.8 ? 0.5 : 1)));
      const names = table.column(kf).values;
      for (const s of [...tris].sort((a, b) => values[b.row] - values[a.row]).slice(0, top)) {
        labels.push({ tx: s.t[4], ty: s.t[5], dy: -3, text: String(names[s.row]), color: theme.text.primary, size: 11, weight: 600, align: 'center', baseline: 'bottom' });
      }
    }
    const [px, py] = ctx.pixel;
    return {
      draws: batches(ctx, [], mesh, lines, false),
      hit: emptyHit(),
      labels,
      legend: legendKeys.map((g) => ({ key: g, color: ctx.categorical(g) })),
      legendRamp: numeric && hi > lo ? rampLegend(ctx, cf!, lo, hi) : undefined,
      pick(tx, ty): ShapeHit | null {
        // Nearest spike axis under the pointer; a thin spike is still easy to point at (4 px each side).
        let best = -1;
        let bestD = Infinity;
        tris.forEach((s, j) => {
          const h = (s.t[5] - s.t[1]) / py;
          const v = (ty - s.t[1]) / py;
          if (v < -3 || v > h + 3) return;
          const half = ((s.t[2] - s.t[0]) / px / 2) * Math.max(0, 1 - v / Math.max(h, 1e-6)) + 4;
          const d = Math.abs(tx - s.t[4]) / px;
          if (d <= half && d < bestD) {
            bestD = d;
            best = j;
          }
        });
        if (best < 0) return null;
        const i = tris[best].row;
        const out = [{ label: fieldLabel(ctx, vf), value: ctx.format(values[i], vf) }];
        if (cf && cf !== vf) out.push({ label: fieldLabel(ctx, cf), value: numeric ? ctx.format(ccol!.values[i] as number, cf) : groupOf(i) });
        return { title: kf ? String(table.column(kf).values[i]) : `${ctx.format(lon[i], layer.encode.x)} · ${ctx.format(lat[i], layer.encode.y)}`, rows: out };
      },
    };
  },
};

// ------------------------------------------------------------------ mapBars

/**
 * `mapBars`: a small column chart per place at (`x` longitude, `y` latitude): one column per
 * value of `color`, all on the same scale (`style.height` px for the largest value of the map),
 * standing on a short baseline centered on the place. Rows are gathered by `key`.
 */
export const mapBars: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: lonLatScales('mapBars'),
  build(ctx) {
    const { style, theme } = ctx;
    const { places, groups, vf } = placesOf(ctx, 'mapBars');
    const [px, py] = ctx.pixel;
    const k = compact(ctx);
    const shown = groups.filter((g) => !ctx.hidden.has(g));
    const max = Math.max(0, ...places.flatMap((p) => p.parts.map((q) => q.value)));
    const bw = style.thickness * k;
    const gap = style.gap;
    const width = shown.length * bw + Math.max(0, shown.length - 1) * gap;
    const rects: number[] = [];
    const lines: number[] = [];
    const keys: string[] = [];
    const labels: MarkLabel[] = [];
    const ink = parseColor(theme.text.secondary);
    const bars: { p: Place; group: string; x0: number; x1: number; y0: number; y1: number }[] = [];
    // North first, so that the columns of a place stand in front of the places behind it.
    const order = [...places].sort((a, b) => b.lat - a.lat || a.lon - b.lon);
    const r = style.radius;
    // On a small map, only the largest places are named.
    const named = new Set([...places].sort((a, b) => b.total - a.total).slice(0, 5));
    for (const p of order) {
      const cx = ctx.x.norm(p.lon);
      const cy = ctx.y.norm(p.lat);
      const left = cx - (width / 2) * px;
      for (const q of p.parts) {
        const j = shown.indexOf(q.group);
        const x0 = left + j * (bw + gap) * px;
        const x1 = x0 + bw * px;
        const y1 = cy + Math.max(1.5, (q.value / max) * style.height * k) * py;
        const fill = withAlpha(ctx.paint(ctx.categorical(q.group), q.row), style.opacity);
        // The stroke is drawn inside the rect: grow it by the rim, so that the column keeps its width.
        const o = Math.max(0, style.outline);
        pushRect(rects, { x0: x0 - o * px, y0: cy - o * py, x1: x1 + o * px, y1: y1 + o * py, fill, stroke: ctx.surface, strokeWidth: o, radii: [r + o, r + o, 0, 0] });
        keys.push(`${p.key}\u0000${q.group}`);
        bars.push({ p, group: q.group, x0, x1, y0: cy, y1 });
      }
      pushSegment(lines, left - 2 * px, cy, left + (width + 2) * px, cy, ink, 1);
      if (style.labels && (k >= 0.8 || named.has(p))) labels.push({ tx: cx, ty: cy, dy: 4, text: p.key, color: theme.text.primary, size: 11, weight: 600, align: 'center', baseline: 'top' });
    }
    const batch = ctx.renderer.createBatch('rect');
    const data = new Float32Array(rects);
    batch.update(data, rects.length / LAYOUTS.rect.stride);
    const draws: MarkDraw[] = [{ batch, data, keys }];
    if (lines.length) {
      const b = ctx.renderer.createBatch('line');
      b.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
      draws.push({ batch: b });
    }
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend: groups.map((g) => ({ key: g, color: ctx.categorical(g) })),
      pick(tx, ty): ShapeHit | null {
        for (let i = bars.length - 1; i >= 0; i--) {
          const b = bars[i];
          if (tx < b.x0 - px || tx > b.x1 + px || ty < b.y0 - 2 * py || ty > b.y1 + 2 * py) continue;
          return placeHit(ctx, b.p, vf, b.group);
        }
        return null;
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const CARTO_MARKS: Record<string, MarkDefinition> = { dorling, mapPie, spike, mapBars };
