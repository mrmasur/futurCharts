/**
 * Scales of a chart drawn from its data: on a map, longitude and latitude; on a cartesian
 * chart, the category axis (bands, dates as sessions, time or numbers) and the value axis,
 * with its second axis on a dual-axis chart. Both value axes write the same normalized
 * space, so one view transform serves the two. Pure.
 */
import type { Table } from '../data/table';
import type { LayerData } from '../marks/prepare';
import type { MarkDefinition } from '../marks/registry';
import { BandScale, DateBandScale, LinearScale, LogScale, MercatorScale, TimeScale, niceDomain, type Scale } from '../scale/scales';
import type { AxisSpec, ChartSpec, LayerSpec, ProjectionSpec, ScaleSpec } from '../spec/types';
import type { Theme } from '../theme/theme';
import { annotationRaw } from './annotations';
import { layerExtents, linearValueDomain } from './domains';

/**
 * The categories in axis order: an explicit order first (also how small multiples share
 * one); on a band axis over dates, every date of every layer in chronological order.
 * Other categories are added by the layers as they are prepared.
 */
export function categoryOrder(spec: ChartSpec, defs: MarkDefinition[], tableOf: (i: number) => Table, horizontal: boolean, catSpec: ScaleSpec, dateBand: boolean): Map<string, number> {
  const categories = new Map<string, number>();
  // An explicit order (also how small multiples share one) comes first.
  for (const c of dateBand ? [] : (catSpec.categories ?? [])) if (!categories.has(c)) categories.set(c, categories.size);
  if (dateBand) {
    // Every date of every layer, in chronological order whatever the order of the rows.
    const dates = new Set<number>();
    spec.layers.forEach((l, i) => {
      const f = defs[i].standalone ? undefined : horizontal ? l.encode.y : l.encode.x;
      const col = f && tableOf(i).has(f) ? tableOf(i).column(f) : undefined;
      if (!col || col.type === 'string') return;
      for (const v of col.values as Float64Array) if (Number.isFinite(v)) dates.add(v);
    });
    for (const v of [...dates].sort((a, b) => a - b)) categories.set(String(v), categories.size);
  }
  return categories;
}

/**
 * How a chart's data map to its axes, decided by its first layer with x / y encodings
 * (`ref`): orientation, dual value axis, the specs of each axis and the category type.
 */
export interface CartesianPlan {
  refIndex: number;
  ref: LayerSpec | undefined;
  /** Categories on y and numbers on x: bars run left to right. */
  horizontal: boolean;
  /** Some layers are on the secondary value axis (`onSecondary`). */
  dual: boolean;
  onSecondary: (i: number) => boolean;
  /** The first layer of each value axis: its field gives the axis' default format and type. */
  valRefIndex: number;
  val2RefIndex: number;
  catSpec: ScaleSpec;
  valSpec: ScaleSpec;
  valAxis: AxisSpec | undefined;
  val2Axis: AxisSpec | undefined;
  catField: string | undefined;
  catType: NonNullable<ScaleSpec['type']>;
  /** A band axis over dates (`DateBandScale`). */
  dateBand: boolean;
}

/** Read the spec's orientation and axes from its reference layer (`geo`: a map, no cartesian axes). */
export function cartesianPlan(spec: ChartSpec, defs: MarkDefinition[], tableOf: (i: number) => Table, geo: boolean): CartesianPlan {
  // The first layer with x / y encodings decides orientation, scales and default formats.
  const refIndex = spec.layers.findIndex((_, i) => !defs[i].standalone);
  const ref = refIndex >= 0 ? spec.layers[refIndex] : undefined;
  let horizontal = false;
  if (!geo && ref?.encode.x && ref.encode.y) {
    const t = tableOf(refIndex);
    const xc = t.column(ref.encode.x);
    const yc = t.column(ref.encode.y);
    // Categories on y and numbers on x: bars run left to right.
    horizontal = spec.scales?.y?.type === 'band' || (yc.type === 'string' && xc.type !== 'string');
  }
  // Dual axis: cartesian layers asking for the secondary value axis, as long as one stays on the primary.
  const wantsSecondary = (i: number) => !geo && !defs[i].standalone && spec.layers[i].axis === 'secondary';
  const dual = spec.layers.some((_, i) => wantsSecondary(i)) && spec.layers.some((_, i) => !defs[i].standalone && !wantsSecondary(i));
  const onSecondary = (i: number) => dual && wantsSecondary(i);
  // Each value axis takes its default field (format, time type) from its own first layer.
  const valRefIndex = dual ? spec.layers.findIndex((_, i) => !defs[i].standalone && !onSecondary(i)) : refIndex;
  const val2RefIndex = dual ? spec.layers.findIndex((_, i) => onSecondary(i)) : -1;
  const catSpec = (horizontal ? spec.scales?.y : spec.scales?.x) ?? {};
  const valSpec = (horizontal ? spec.scales?.x : spec.scales?.y) ?? {};
  const valAxis = (horizontal ? spec.axes?.x : spec.axes?.y) || undefined;
  const val2Axis = spec.axes?.secondary || undefined;
  const catField = ref ? (horizontal ? ref.encode.y : ref.encode.x) : undefined;

  let catType: NonNullable<ScaleSpec['type']> = 'linear';
  // A band axis asked over dates: an ordinal axis of sessions (no room for the days without data).
  let dateBand = false;
  if (!geo && ref && catField) {
    const c = tableOf(refIndex).column(catField);
    catType = catSpec.type ?? (c.type === 'string' ? 'band' : c.type === 'time' ? 'time' : 'linear');
    dateBand = catType === 'band' && c.type === 'time';
  }
  return { refIndex, ref, horizontal, dual, onSecondary, valRefIndex, val2RefIndex, catSpec, valSpec, valAxis, val2Axis, catField, catType, dateBand };
}

/** What the cartesian scales are made from: the plan, the prepared layers and the categories met. */
export interface CartesianInput extends CartesianPlan {
  /** The spec, theme tokens resolved. */
  spec: ChartSpec;
  theme: Theme;
  layers: { data: LayerData; def: MarkDefinition }[];
  tableOf: (i: number) => Table;
  categories: Map<string, number>;
}

/**
 * Category and value scales from the extents of the layers (annotations on the value axis
 * kept in view). `xStep`: the normalized width of one step of a continuous category axis.
 */
export function cartesianScales(input: CartesianInput): { cat: Scale; val: Scale; val2?: Scale; xStep: number } {
  const { spec, theme, layers, tableOf, horizontal, dual, onSecondary, categories, catType, dateBand, catSpec, valSpec, valAxis, val2Axis, catField, valRefIndex, val2RefIndex } = input;
  const fields = spec.fields ?? {};
  let xStep = 0;
  const ext = layerExtents(layers, onSecondary);
  let { c0, c1, step } = ext;
  const { banded } = ext;
  let { v0, v1 } = ext.primary;
  let { v0: w0, v1: w1 } = ext.secondary;
  // A target line or band on the value axis must be in view, even past the data.
  const valKey = horizontal ? 'x' : 'y';
  for (const a of spec.annotations ?? []) {
    const v = a[valKey];
    if (v === undefined || (a.x !== undefined && a.y !== undefined && !Array.isArray(a.x) && !Array.isArray(a.y))) continue;
    const second = dual && a.axis === 'secondary';
    for (const u of Array.isArray(v) ? v : [v]) {
      const n = annotationRaw(u, false, categories);
      if (!Number.isFinite(n)) continue;
      if (second) {
        if (n < w0) w0 = n;
        if (n > w1) w1 = n;
        continue;
      }
      if (n < v0) v0 = n;
      if (n > v1) v1 = n;
    }
  }
  if (c0 > c1) [c0, c1] = [0, 1];
  if (v0 > v1) [v0, v1] = [0, 1];
  if (w0 > w1) [w0, w1] = [0, 1];
  if (!Number.isFinite(step)) step = c1 > c0 ? c1 - c0 : 1;

  let cat: Scale;
  if (catType === 'band') {
    const pad = theme.marks.bar.bandPadding;
    // Horizontal charts list categories top-down; `reverse` flips either way.
    cat = dateBand
      ? new DateBandScale([...categories.keys()].map(Number), pad, pad / 2, horizontal !== !!catSpec.reverse)
      : new BandScale([...categories.keys()], pad, pad / 2, horizontal !== !!catSpec.reverse);
  } else {
    if (banded) {
      c0 -= step / 2;
      c1 += step / 2;
    }
    const onlyPoints = spec.layers.every((l) => l.mark === 'point');
    // Never on a log axis: rounding 200 … 2e10 to [0, 2e10] puts log(0) in the domain and crushes every point on one edge.
    if (catType !== 'time' && catType !== 'log' && (catSpec.nice ?? (onlyPoints && !banded))) [c0, c1] = niceDomain(c0, c1, 8);
    if (catSpec.zero) [c0, c1] = [Math.min(0, c0), Math.max(0, c1)];
    c0 = catSpec.domain?.[0] ?? c0;
    c1 = catSpec.domain?.[1] ?? c1;
    const fmt = fields[catField ?? '']?.format;
    if (catSpec.reverse) [c0, c1] = [c1, c0];
    cat = catType === 'time' ? new TimeScale(c0, c1) : catType === 'log' ? new LogScale(c0, c1, fmt, !!catSpec.domain) : new LinearScale(c0, c1, fmt);
    xStep = Math.abs(cat.norm(c0 + step) - cat.norm(c0));
  }

  // One value axis: its scale from the extent of the layers bound to it.
  const valueScale = (lo: number, hi: number, vs: ScaleSpec, axis: AxisSpec | undefined, refAt: number, baseline: boolean, bound: (i: number) => boolean): Scale => {
    const refLayer = refAt >= 0 ? spec.layers[refAt] : undefined;
    const field = refLayer ? (horizontal ? refLayer.encode.x : refLayer.encode.y) : undefined;
    const col = field ? tableOf(refAt).column(field) : undefined;
    const type = vs.type ?? (col?.type === 'time' ? 'time' : 'linear');
    const own = layers.filter((_, i) => bound(i));
    const normalized = own.some(({ data }) => data.stacked && data.stackMode === 'normalize');
    // A 100 % stack reads in percent, whatever the unit of the values.
    const format = axis?.format ?? (normalized ? { style: 'percent' as const } : fields[field ?? '']?.format);
    if (type === 'time') return new TimeScale(vs.domain?.[0] ?? lo, vs.domain?.[1] ?? hi);
    if (type === 'log') return new LogScale(vs.domain?.[0] ?? lo, vs.domain?.[1] ?? hi, format, !!vs.domain);
    // Value labels outside the bar ends need room past the longest bar.
    const outsideLabels = own.some(({ data }) => data.layer.style?.labels && !data.stacked && data.layer.mark === 'bar');
    const [d0, d1] = linearValueDomain(lo, hi, { spec: vs, baseline, outsideLabels, horizontal, normalized });
    return vs.reverse ? new LinearScale(d1, d0, format) : new LinearScale(d0, d1, format);
  };
  const val = valueScale(v0, v1, valSpec, valAxis, valRefIndex, ext.primary.baseline, (i) => !onSecondary(i));
  const val2 = dual ? valueScale(w0, w1, spec.scales?.secondary ?? {}, val2Axis, val2RefIndex, ext.secondary.baseline, onSecondary) : undefined;
  return { cat, val, val2, xStep };
}

/** The map scales of a projection, and the aspect ratio (width / height) the view must keep. */
export function projectionScales(p: ProjectionSpec): { x: Scale; y: Scale; aspect: number } {
  const [[west, south], [east, north]] = p.bounds ?? [[-180, -58], [180, 84]];
  const x = new LinearScale(west, east);
  if (p.type === 'equirectangular') return { x, y: new LinearScale(south, north), aspect: (east - west) / (north - south) };
  const lat = new MercatorScale(south, north);
  return { x, y: lat, aspect: ((east - west) * Math.PI) / 180 / lat.span };
}
