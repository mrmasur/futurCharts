/**
 * Building the layers: the `BuildContext` a mark receives (scales, style merged over the
 * theme, colors with their overrides, sizes, formats) and the layers of annotations drawn
 * under and over the marks. Each build makes GPU batches through the abstract `Renderer`.
 */
import type { Table } from '../data/table';
import type { LayerData, SeriesData } from '../marks/prepare';
import { emptyHit, type BuildContext, type BuiltMark, type MarkDefinition } from '../marks/registry';
import { standaloneLayer } from '../marks/prepare';
import type { Renderer, RGBA } from '../render/types';
import type { Scale } from '../scale/scales';
import type { AnnotationSpec, AxisSpec, FieldSpec } from '../spec/types';
import type { Theme } from '../theme/theme';
import { parseColor, sampleRamp } from '../util/color';
import { numberFormatter } from '../util/format';
import { deepMerge } from '../util/merge';
import { buildAnnotations } from './annotations';
import type { ChartColors } from './colors';
import { compileOverrides } from './overrides';
import type { Built } from './types';

/** What building a layer reads from the chart. */
export interface LayerBuildInput {
  renderer: Renderer;
  theme: Theme;
  fields: Record<string, FieldSpec>;
  horizontal: boolean;
  cat: Scale;
  val: Scale;
  val2?: Scale;
  /** Indexes of the layers on the secondary value axis. */
  secondary: Set<number>;
  valAxis: AxisSpec | undefined;
  val2Axis: AxisSpec | undefined;
  xStep: number;
  hidden: Set<string>;
  /** Per-layer state kept across rebuilds (drill-down focus…). */
  state: (layer: number) => Record<string, unknown>;
  colors: Pick<ChartColors, 'categorical' | 'seriesColor' | 'ramp'>;
  /** Size of the view the marks will be drawn in (px). */
  view: { width: number; height: number };
}

/** Build one prepared layer with its mark. */
export function buildLayer({ data, def }: { data: LayerData; def: MarkDefinition }, a: LayerBuildInput): Built {
  const { theme, horizontal, fields, view } = a;
  const { categorical, seriesColor, ramp } = a.colors;
  const surface = parseColor(theme.background);
  const opaqueSurface: RGBA = surface[3] === 0 ? [1, 1, 1, 1] : surface;
  const pos = horizontal ? (c: number, v: number): [number, number] => [v, c] : (c: number, v: number): [number, number] => [c, v];
  const themeKey = def.themeKey ?? data.layer.mark;
  const style = deepMerge((theme.marks as Record<string, any>)[themeKey] ?? {}, data.layer.style ?? {});
  const [k0, k1] = data.colorExtent;
  const [s0, s1] = data.sizeExtent;
  const [r0, r1] = (style.sizeRange as [number, number] | undefined) ?? [4, 28];
  const enc = data.layer.encode;
  const layerValue = def.standalone ? (enc.value ?? enc.color ?? enc.y) : horizontal ? enc.x : enc.y;
  const second = a.secondary.has(data.index);
  const axisFormat = def.standalone ? undefined : (second ? a.val2Axis : a.valAxis)?.format;
  const override = compileOverrides(data.layer, data.table, !def.standalone && horizontal);
  const paint = (c: RGBA, row: number | undefined): RGBA => {
    const o = row === undefined ? undefined : override?.(row);
    if (!o) return c;
    const p = o.color ? parseColor(o.color) : c;
    return o.opacity !== undefined ? [p[0], p[1], p[2], p[3] * o.opacity] : p;
  };
  const baseColor = (s: SeriesData, i: number): RGBA =>
    s.colorValue && !data.layer.style?.color
      ? sampleRamp(ramp, k1 > k0 ? (s.colorValue[i] - k0) / (k1 - k0) : 0.5)
      : seriesColor(data, s);
  const ctx: BuildContext = {
    renderer: a.renderer,
    data,
    x: a.cat,
    y: second ? a.val2! : a.val,
    horizontal: !def.standalone && horizontal,
    pos: def.standalone ? (c, v) => [c, v] : pos,
    theme,
    style,
    surface: opaqueSurface,
    xStep: a.xStep,
    fields,
    hidden: a.hidden,
    pixel: [1 / Math.max(1, view.width), 1 / Math.max(1, view.height)],
    state: a.state(data.index),
    categorical,
    format: (v, field = layerValue) => numberFormatter(fields[field ?? '']?.format ?? axisFormat)(v),
    ramp: (t) => sampleRamp(ramp, t),
    color: (s, i) => paint(baseColor(s, i), s.rows[i]),
    paint,
    // Area-proportional sizing: the eye reads surface, not diameter.
    size: (s, i) =>
      s.sizeValue ? r0 + (r1 - r0) * Math.sqrt(s1 > s0 ? Math.max(0, (s.sizeValue[i] - s0) / (s1 - s0)) : 0.5) : (style.size ?? 8),
  };
  return { data, def, mark: def.build(ctx) };
}

/** What building the annotations reads from the chart. */
export interface AnnotationBuildInput {
  renderer: Renderer;
  theme: Theme;
  x: Scale;
  y: Scale;
  /** The secondary value scale: annotations with `axis: 'secondary'` are read on it. */
  val2?: Scale;
  horizontal: boolean;
  categories: Map<string, number>;
  bandCat: boolean;
  dateBand: boolean;
  /** The table of the reference layer (the layer stands on it, without reading it). */
  table: () => Table;
}

/** The annotations drawn under (`under`) or over (`over`) the marks, as a layer of their own. */
export function buildAnnotationLayer(annotations: AnnotationSpec[], part: 'under' | 'over', view: { width: number; height: number }, a: AnnotationBuildInput): Built {
  const { horizontal, categories, bandCat } = a;
  // Dashes are measured in px: rebuilt with the view, like other size-dependent marks.
  const def: MarkDefinition = { standalone: true, sizeDependent: true, symbol: 'square', build: () => ({ draws: [], hit: emptyHit() }) };
  const data = standaloneLayer({ mark: 'rule', encode: {} }, -1, a.table());
  const actx = {
    renderer: a.renderer,
    theme: a.theme,
    x: a.x,
    y: a.y,
    categories,
    bandX: bandCat && !horizontal,
    bandY: bandCat && horizontal,
    dates: a.dateBand ? [...categories.keys()].map(Number) : undefined,
    pixel: [1 / Math.max(1, view.width), 1 / Math.max(1, view.height)] as [number, number],
  };
  const val2 = a.val2;
  const second = val2 ? annotations.filter((an) => an.axis === 'secondary') : [];
  if (!val2 || !second.length) return { data, def, mark: buildAnnotations(annotations, actx, part) };
  // Annotations read on the secondary axis: same drawing, with that axis' scale along the values.
  const first = buildAnnotations(annotations.filter((an) => an.axis !== 'secondary'), actx, part);
  const other = buildAnnotations(second, horizontal ? { ...actx, x: val2 } : { ...actx, y: val2 }, part);
  const mark: BuiltMark = { draws: [...first.draws, ...other.draws], hit: emptyHit(), labels: [...(first.labels ?? []), ...(other.labels ?? [])] };
  return { data, def, mark };
}
