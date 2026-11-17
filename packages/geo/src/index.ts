import {
  LAYOUTS,
  emptyHit,
  hasMark,
  numberFormatter,
  parseColor,
  registerMark,
  type BuildContext,
  type BuiltMark,
  type MarkDefinition,
  type RGBA,
  type ShapeHit,
} from '@futurcharts/core';
import earcut from 'earcut';

type Position = number[];
type Ring = Position[];
type Json = Record<string, any>;

interface Shape {
  title: string;
  key: string;
  /** Polygons of the shape; each is a list of rings, the first being the outline. */
  polygons: Ring[][];
}

/** Read a dotted path (`properties.iso_a3`) from a feature. */
function at(feature: Json, path: string): unknown {
  return path.split('.').reduce<any>((o, k) => (o === null || o === undefined ? undefined : o[k]), feature);
}

/** Flatten any GeoJSON object into shapes. Lines and points are ignored: this mark fills areas. */
export function shapesOf(geo: unknown, keyPath?: string): Shape[] {
  const out: Shape[] = [];
  const visit = (node: Json | null | undefined, feature: Json | undefined): void => {
    if (!node) return;
    switch (node.type) {
      case 'FeatureCollection':
        for (const f of node.features ?? []) visit(f, undefined);
        return;
      case 'Feature':
        visit(node.geometry, node);
        return;
      case 'GeometryCollection':
        for (const g of node.geometries ?? []) visit(g, feature);
        return;
      case 'Polygon':
      case 'MultiPolygon': {
        const polygons: Ring[][] = node.type === 'Polygon' ? [node.coordinates] : node.coordinates;
        const name = feature?.properties?.name ?? feature?.id ?? '';
        const key = keyPath && feature ? at(feature, keyPath) : name;
        out.push({ title: String(name), key: String(key ?? ''), polygons });
        return;
      }
      default:
        return;
    }
  };
  visit(geo as Json, undefined);
  return out;
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * GeoJSON longitudes jump from +180 to -180 where a shape crosses the
 * antimeridian (Russia, Fiji). Drawn as is, that jump becomes a streak across
 * the whole map. Make each ring continuous instead (longitudes may then exceed
 * 180), and return a second copy shifted by a full turn so both edges of the
 * map get their part. A ring that circles a pole (Antarctica) cannot be made
 * continuous and is left untouched.
 */
export function unwrapPolygon(polygon: Ring[]): Ring[][] {
  if (polygon.length === 0 || polygon[0].length === 0) return [polygon];
  let lo = Infinity;
  let hi = -Infinity;
  const anchor = polygon[0][0][0];
  const rings = polygon.map((ring) => {
    const out: Ring = new Array(ring.length);
    // Start each ring within half a turn of the outline's first point, so holes stay with it.
    let lon = anchor + wrap(ring[0][0] - anchor);
    for (let i = 0; i < ring.length; i++) {
      if (i > 0) lon += wrap(ring[i][0] - ring[i - 1][0]);
      out[i] = [lon, ring[i][1]];
    }
    const closes = Math.abs(out[out.length - 1][0] - out[0][0]) < 1e-6;
    const used = closes ? out : ring;
    for (const p of used) {
      if (p[0] < lo) lo = p[0];
      if (p[0] > hi) hi = p[0];
    }
    return used;
  });
  const shift = (d: number) => rings.map((ring) => ring.map((p) => [p[0] + d, p[1]]));
  if (hi > 180 && lo > -180) return [rings, shift(-360)];
  if (lo < -180 && hi < 180) return [rings, shift(360)];
  return [rings];
}

interface Picker {
  shape: Shape;
  value: number | undefined;
  /** Rings in scale space, flattened [x, y, x, y…], with their bounding box. */
  rings: Float32Array[];
  box: [number, number, number, number];
}

function inRings(rings: Float32Array[], x: number, y: number): boolean {
  // Even-odd over every ring handles holes and multi-part shapes alike.
  let inside = false;
  for (const r of rings) {
    for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) {
      if (r[a + 1] > y !== r[b + 1] > y && x < ((r[b] - r[a]) * (y - r[a + 1])) / (r[b + 1] - r[a + 1]) + r[a]) inside = !inside;
    }
  }
  return inside;
}

/**
 * `geoshape`: filled map shapes from GeoJSON.
 *
 *   { mark: 'geoshape', geo: countries }                                   // basemap
 *   { mark: 'geoshape', geo: countries, data: rows,                        // choropleth
 *     encode: { key: 'country', color: 'revenue' } }
 *
 * Rows are joined to shapes on `encode.key` = the shape's key (`layer.geoKey`,
 * default its name). Shapes without a row take the `missing` color.
 */
export const geoshape: MarkDefinition = {
  standalone: true,
  symbol: 'square',
  build(ctx: BuildContext): BuiltMark {
    const { layer, table } = ctx.data;
    const style = ctx.style;
    const shapes = shapesOf(layer.geo, layer.geoKey);

    // Choropleth join.
    const colorField = layer.encode?.color;
    const keyField = layer.encode?.key;
    const values = new Map<string, number>();
    const rowOf = new Map<string, number>();
    let lo = Infinity;
    let hi = -Infinity;
    if (colorField && keyField) {
      const keys = table.column(keyField).values;
      const vals = table.column(colorField);
      if (vals.type === 'string') throw new Error(`futurCharts: geoshape color field "${colorField}" must be numeric.`);
      for (let i = 0; i < table.length; i++) {
        const v = vals.values[i] as number;
        if (Number.isNaN(v)) continue;
        values.set(String(keys[i]), v);
        rowOf.set(String(keys[i]), i);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const choropleth = values.size > 0;
    const base = parseColor(style.color ?? style.fill);
    const missing = parseColor(style.missing);
    const stroke = parseColor(style.stroke);

    const mesh: number[] = [];
    const lines: number[] = [];
    const pickers: Picker[] = [];
    for (const shape of shapes) {
      const value = values.get(shape.key);
      const fill: RGBA = !choropleth ? base : value === undefined ? missing : ctx.paint(ctx.ramp(hi > lo ? (value - lo) / (hi - lo) : 0.5), rowOf.get(shape.key));
      const picker: Picker = { shape, value, rings: [], box: [Infinity, Infinity, -Infinity, -Infinity] };
      for (const polygon of shape.polygons.flatMap(unwrapPolygon)) {
        const flat: number[] = [];
        const holes: number[] = [];
        polygon.forEach((ring, r) => {
          if (r > 0) holes.push(flat.length / 2);
          const start = flat.length;
          // GeoJSON rings repeat their first position at the end; drop the repeat.
          const n = ring.length - 1;
          for (let i = 0; i < n; i++) {
            const x = ctx.x.norm(ring[i][0]);
            const y = ctx.y.norm(ring[i][1]);
            flat.push(x, y);
            if (x < picker.box[0]) picker.box[0] = x;
            if (y < picker.box[1]) picker.box[1] = y;
            if (x > picker.box[2]) picker.box[2] = x;
            if (y > picker.box[3]) picker.box[3] = y;
          }
          const pts = flat.slice(start);
          picker.rings.push(Float32Array.from(pts));
          if (style.strokeWidth > 0) {
            for (let a = 0, b = pts.length - 2; a < pts.length; b = a, a += 2) {
              lines.push(pts[b], pts[b + 1], pts[a], pts[a + 1], stroke[0], stroke[1], stroke[2], stroke[3], style.strokeWidth);
            }
          }
        });
        for (const i of earcut(flat, holes)) mesh.push(flat[2 * i], flat[2 * i + 1], fill[0], fill[1], fill[2], fill[3]);
      }
      pickers.push(picker);
    }

    const fillBatch = ctx.renderer.createBatch('mesh');
    fillBatch.update(new Float32Array(mesh), mesh.length / LAYOUTS.mesh.stride);
    const draws = [{ batch: fillBatch }];
    if (lines.length) {
      const strokeBatch = ctx.renderer.createBatch('line');
      strokeBatch.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
      draws.push({ batch: strokeBatch });
    }

    const label = colorField ? (ctx.fields[colorField]?.label ?? colorField) : '';
    const format = numberFormatter(colorField ? ctx.fields[colorField]?.format : undefined);
    return {
      draws,
      hit: emptyHit(),
      pick(tx, ty): ShapeHit | null {
        for (const p of pickers) {
          if (tx < p.box[0] || tx > p.box[2] || ty < p.box[1] || ty > p.box[3]) continue;
          if (!inRings(p.rings, tx, ty)) continue;
          if (!p.shape.title) return null;
          return { title: p.shape.title, rows: p.value === undefined ? [] : [{ label, value: format(p.value) }] };
        }
        return null;
      },
    };
  },
};

/** Make the `geoshape` mark available to specs. Call once, before creating charts. */
export function registerGeo(): void {
  if (!hasMark('geoshape')) registerMark('geoshape', geoshape);
}
