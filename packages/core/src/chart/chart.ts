import { Table, type DataInput, type Row } from '../data/table';
import { ensureBuiltinMarks } from '../marks/builtin';
import { applyTransforms } from '../data/transforms';
import { luminance } from '../marks/primitives';
import { prepareLayer, standaloneLayer, type LayerData, type SeriesData } from '../marks/prepare';
import { getMark, type BuildContext, type BuiltMark, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit } from '../marks/registry';
import { createRenderer, type RendererChoice } from '../render';
import { LAYOUTS } from '../render/layouts';
import type { Batch, ClipRect, DrawCall, Renderer, RGBA, ViewTransform } from '../render/types';
import { BandScale, LinearScale, LogScale, MercatorScale, TimeScale, niceDomain, type Scale, type Tick } from '../scale/scales';
import type { AxisSpec, ChartSpec, LayerSpec, ProjectionSpec, ScaleSpec, StyleOverride } from '../spec/types';
import { resolveTheme, resolveThemeColors, type Theme } from '../theme/theme';
import { parseColor, sampleRamp, toCss } from '../util/color';
import { numberFormatter } from '../util/format';
import { deepMerge } from '../util/merge';

export interface HoverItem {
  layer: number;
  series: string;
  /** Raw x: number, Date, or category. */
  x: number | string | Date;
  xLabel: string;
  value: number;
  valueLabel: string;
  color: string;
  row: Row;
}

/** The current selection, as rows of each layer's table (what a cross-filter needs). */
export interface SelectionPayload {
  count: number;
  layers: { layer: number; rows: Int32Array }[];
  /** Describe the selected marks; capped, since a lasso can hold hundreds of thousands. */
  items(limit?: number): HoverItem[];
}

export interface TooltipContext {
  mode: 'x' | 'nearest';
  title: string;
  items: HoverItem[];
  /** Set instead of `items` when the pointer is over a shape (a country on a map). */
  shape?: ShapeHit;
  theme: Theme;
}

export interface ChartOptions {
  /** `auto` (default), `webgl2`, or your own factory (a WebGPU backend plugs in here). */
  renderer?: RendererChoice;
  /** Replace the tooltip content. Return an element, an HTML string, or null to hide. */
  tooltip?: (ctx: TooltipContext) => HTMLElement | string | null;
  devicePixelRatio?: number;
}

export interface ChartEvents {
  hover: { items: HoverItem[]; x: number; y: number };
  leave: {};
  click: { items: HoverItem[]; x: number; y: number };
  zoom: { kx: number; ky: number; tx: number; ty: number };
  legend: { series: string; hidden: boolean };
  select: SelectionPayload;
}

interface Zoom {
  kx: number;
  ky: number;
  tx: number;
  ty: number;
}

interface LegendEntry {
  key: string;
  color: RGBA;
  symbol: MarkDefinition['symbol'];
  rect?: ClipRect;
}

interface Built {
  data: LayerData;
  def: MarkDefinition;
  mark: BuiltMark;
  /** Selected datums of this layer, and the batches that redraw them at full strength. */
  sel?: { mask: Uint8Array; count: number; draws: MarkDraw[] };
}

interface Point {
  x: number;
  y: number;
}

interface Picked {
  layer: number;
  index: number;
}

interface Layout {
  /** Area the marks may draw in. */
  plot: ClipRect;
  /** Rectangle the unzoomed scale space maps to: the plot, or a letterboxed part of it when an aspect ratio is imposed. */
  view: ClipRect;
  titleY: number;
  legendY: number;
  xTicks: Tick[];
  yTicks: Tick[];
  transform: ViewTransform;
}

const font = (weight: number | string, size: number, family: string) => `${weight} ${size}px ${family}`;

const sizeDependent = (b: Built) =>
  typeof b.def.sizeDependent === 'function' ? b.def.sizeDependent(b.data.layer) : !!b.def.sizeDependent;

/** Compile `layer.overrides` into a per-row style lookup. */
function compileOverrides(layer: LayerSpec, table: Table): ((row: number) => StyleOverride['style'] | undefined) | undefined {
  if (!layer.overrides?.length) return undefined;
  const rules = layer.overrides.map((o) => {
    const conds = (Array.isArray(o.when) ? o.when : [o.when]).map((p) => {
      const values = table.column(p.field).values;
      const set = p.in ? new Set(p.in.map(String)) : undefined;
      return (row: number) => {
        const v = values[row];
        if (p.equals !== undefined && String(v) !== String(p.equals)) return false;
        if (set && !set.has(String(v))) return false;
        const n = typeof v === 'number' ? v : Number(v);
        if (p.gt !== undefined && !(n > p.gt)) return false;
        if (p.gte !== undefined && !(n >= p.gte)) return false;
        if (p.lt !== undefined && !(n < p.lt)) return false;
        if (p.lte !== undefined && !(n <= p.lte)) return false;
        return true;
      };
    });
    return { test: (row: number) => conds.every((c) => c(row)), style: o.style };
  });
  return (row) => rules.find((r) => r.test(row))?.style;
}

export class Chart {
  private root!: HTMLDivElement;
  private overlay!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private tip!: HTMLDivElement;
  private renderer!: Renderer;
  private observer?: ResizeObserver;
  private listeners = new Map<string, Set<(payload: any) => void>>();
  private abort = new AbortController();

  private spec: ChartSpec = { layers: [] };
  private theme: Theme = resolveTheme(undefined);
  private width = 0;
  private height = 0;
  private dpr = 1;

  private built: Built[] = [];
  private gridBatch?: Batch;
  private xScale: Scale = new LinearScale(0, 1);
  private yScale: Scale = new LinearScale(0, 1);
  private legend: LegendEntry[] = [];
  private hidden = new Set<string>();
  private zoom: Zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
  private layout?: Layout;
  private picked: Picked[] = [];
  private pointer?: { x: number; y: number };
  private drag?: { x: number; y: number; moved: number };
  private geo = false;
  /** Category scale and value scale (x and y, swapped when horizontal). */
  private cat: Scale = this.xScale;
  private val: Scale = this.yScale;
  private horizontal = false;
  /** The scales come from a standalone mark (no grid by default). */
  private markScales = false;
  private axesShown = { x: true, y: true };
  /** Width / height the view must keep (maps). */
  private aspect?: number;
  private lasso?: { points: Point[]; additive: boolean; rect: boolean };
  private shape?: ShapeHit;
  private frame = 0;
  private destroyed = false;

  private constructor(private container: HTMLElement, private options: ChartOptions) {}

  /** Async because acquiring a GPU device can be (WebGPU). */
  static async create(container: HTMLElement, spec: ChartSpec, options: ChartOptions = {}): Promise<Chart> {
    ensureBuiltinMarks();
    const chart = new Chart(container, options);
    await chart.init();
    chart.update(spec);
    return chart;
  }

  private async init(): Promise<void> {
    const root = (this.root = document.createElement('div'));
    root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;touch-action:pan-y;outline:none;';
    root.tabIndex = -1;
    const gl = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    for (const c of [gl, this.overlay]) {
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
      root.appendChild(c);
    }
    this.tip = document.createElement('div');
    this.tip.style.cssText =
      'position:absolute;left:0;top:0;pointer-events:none;opacity:0;transition:opacity .12s;white-space:nowrap;z-index:1;';
    root.appendChild(this.tip);
    this.container.appendChild(root);
    this.ctx = this.overlay.getContext('2d')!;
    this.renderer = await createRenderer(gl, this.options.renderer);
    this.gridBatch = this.renderer.createBatch('line');

    const signal = this.abort.signal;
    root.addEventListener('pointermove', (e) => this.onMove(e), { signal });
    root.addEventListener('pointerleave', () => this.onLeave(), { signal });
    root.addEventListener('pointerdown', (e) => this.onDown(e), { signal });
    root.addEventListener('pointerup', (e) => this.onUp(e), { signal });
    root.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    root.addEventListener('dblclick', () => this.resetZoom(), { signal });
    // Escape clears the selection (the chart root is focusable for that).
    root.addEventListener('keydown', (e) => e.key === 'Escape' && this.clearSelection(), { signal });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);
    this.measure();
  }

  // ---------------------------------------------------------------- public API

  /** Replace the spec and recompile. */
  update(spec: ChartSpec): void {
    this.spec = spec;
    this.theme = resolveTheme(spec.theme);
    this.zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
    this.compile();
  }

  /** Swap the data, keep everything else (zoom included). */
  setData(data: DataInput): void {
    this.spec = { ...this.spec, data };
    this.compile();
  }

  getSpec(): ChartSpec {
    return this.spec;
  }

  on<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  resetZoom(): void {
    if (!this.zoomConfig()) return;
    this.zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
    this.emit('zoom', { ...this.zoom });
    this.requestRender();
  }

  /** Show or hide a series (same as clicking its legend entry). */
  toggleSeries(key: string, hidden = !this.hidden.has(key)): void {
    if (hidden) this.hidden.add(key);
    else this.hidden.delete(key);
    this.emit('legend', { series: key, hidden });
    this.compile();
  }

  /** The marks currently selected with the lasso or rectangle. */
  getSelection(): SelectionPayload {
    const layers: SelectionPayload['layers'] = [];
    const picked: Picked[] = [];
    let count = 0;
    this.built.forEach((b, layer) => {
      if (!b.sel) return;
      const rows = new Int32Array(b.sel.count);
      let k = 0;
      for (let i = 0; i < b.sel.mask.length; i++) {
        if (!b.sel.mask[i]) continue;
        rows[k++] = b.mark.hit.row[i];
        picked.push({ layer, index: i });
      }
      count += b.sel.count;
      layers.push({ layer, rows });
    });
    return { count, layers, items: (limit = 1000) => this.describe(picked.slice(0, limit)) };
  }

  clearSelection(): void {
    if (!this.built.some((b) => b.sel)) return;
    for (const b of this.built) this.setLayerSelection(b, null);
    this.emit('select', this.getSelection());
    this.requestRender();
  }

  resize(): void {
    if (this.destroyed) return;
    this.measure();
    if (this.built.some((b) => sizeDependent(b))) {
      this.layout = undefined;
      this.compile();
    }
    this.renderNow();
  }

  /** PNG data URL of the chart as currently displayed. */
  toImage(): string {
    this.renderNow();
    const out = document.createElement('canvas');
    out.width = this.overlay.width;
    out.height = this.overlay.height;
    const c = out.getContext('2d')!;
    c.drawImage(this.renderer.canvas, 0, 0);
    c.drawImage(this.overlay, 0, 0);
    return out.toDataURL('image/png');
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.observer?.disconnect();
    this.disposeMarks();
    this.gridBatch?.destroy();
    this.renderer.destroy();
    this.root.remove();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ compile

  private disposeMarks(): void {
    for (const b of this.built) {
      for (const d of b.mark.draws) d.batch.destroy();
      for (const d of b.sel?.draws ?? []) d.batch.destroy();
    }
    this.built = [];
  }

  private compile(): void {
    this.disposeMarks();
    this.picked = [];
    this.shape = undefined;
    const { theme } = this;
    // Theme color tokens ($ink, $grid, $1…) resolve against the current theme.
    const spec: ChartSpec = {
      ...this.spec,
      layers: this.spec.layers.map((l) => ({ ...l, style: resolveThemeColors(theme, l.style), overrides: resolveThemeColors(theme, l.overrides) })),
      scales: this.spec.scales && { ...this.spec.scales, color: resolveThemeColors(theme, this.spec.scales.color) },
    };
    const fields = spec.fields ?? {};
    const types = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.type]));
    const base = spec.data ? Table.from(spec.data, types) : undefined;
    const defs = spec.layers.map((l) => getMark(l.mark));
    const tables = new Map<number, Table>();
    const tableOf = (i: number): Table => {
      let t = tables.get(i);
      if (t) return t;
      const layer = spec.layers[i];
      const raw = layer.data ? Table.from(layer.data, types) : (base ?? (defs[i].standalone && layer.geo ? Table.from([]) : undefined));
      if (!raw) throw new Error(`futurCharts: layer ${i} has no data (set spec.data or layer.data).`);
      t = applyTransforms(raw, layer.transform);
      tables.set(i, t);
      return t;
    };
    if (spec.layers.length === 0) {
      this.legend = [];
      this.requestRender();
      return;
    }

    const geo = (this.geo = !!spec.projection);
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
    this.horizontal = horizontal;
    const catSpec = (horizontal ? spec.scales?.y : spec.scales?.x) ?? {};
    const valSpec = (horizontal ? spec.scales?.x : spec.scales?.y) ?? {};
    const valAxis = (horizontal ? spec.axes?.x : spec.axes?.y) || undefined;
    const catField = ref ? (horizontal ? ref.encode.y : ref.encode.x) : undefined;
    const valField = ref ? (horizontal ? ref.encode.x : ref.encode.y) : undefined;

    let catType: NonNullable<ScaleSpec['type']> = 'linear';
    if (!geo && ref && catField) {
      const c = tableOf(refIndex).column(catField);
      catType = catSpec.type ?? (c.type === 'string' ? 'band' : c.type === 'time' ? 'time' : 'linear');
    }

    // 1. Prepare each layer: grouping into series, stacking, ranges.
    const categories = new Map<string, number>();
    const prep = { band: catType === 'band', horizontal, categories, fields, hidden: this.hidden };
    const layers = spec.layers.map((layer, i) => ({
      data: defs[i].standalone ? standaloneLayer(layer, i, tableOf(i)) : prepareLayer(layer, i, tableOf(i), prep),
      def: defs[i],
    }));

    // 2. Color slots: fixed by entity, never by rank, so filters don't repaint survivors.
    const slots = new Map<string, number>();
    for (const key of spec.scales?.color?.domain ?? []) slots.set(key, slots.size);
    for (const { data } of layers) {
      if (data.colorMode !== 'series') continue;
      for (const s of data.series) if (!slots.has(s.key)) slots.set(s.key, slots.size);
    }
    const palette = theme.palette.categorical.map(parseColor);
    const ramp = theme.palette.sequential.map(parseColor);
    const explicit = spec.scales?.color?.colors ?? {};
    const categorical = (key: string): RGBA => {
      if (explicit[key]) return parseColor(explicit[key]);
      if (!slots.has(key)) slots.set(key, slots.size);
      return palette[slots.get(key)! % palette.length];
    };
    const seriesColor = (data: LayerData, s: SeriesData): RGBA =>
      data.layer.style?.color ? parseColor(data.layer.style.color) : categorical(s.key);

    // 3. Scales: from a projection, from a standalone mark, or from the data.
    let xStep = 0;
    this.aspect = undefined;
    this.markScales = false;
    this.axesShown = { x: !geo, y: !geo };
    if (geo) {
      this.aspect = this.projectionScales(spec.projection!);
      this.cat = this.xScale;
      this.val = this.yScale;
    } else if (!ref) {
      const owner = layers.find((l) => l.def.scales);
      const ms = owner?.def.scales?.({ layer: owner.data.layer, table: owner.data.table, fields });
      this.xScale = ms?.x ?? new LinearScale(0, 1);
      this.yScale = ms?.y ?? new LinearScale(0, 1);
      this.aspect = ms?.aspect;
      this.axesShown = { x: !!ms?.axes?.x, y: !!ms?.axes?.y };
      this.markScales = true;
      this.cat = this.xScale;
      this.val = this.yScale;
    } else {
      let c0 = Infinity, c1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      let step = Infinity;
      let baseline = false;
      let banded = false;
      for (const { data, def } of layers) {
        // A range (y2) has its own start: it does not pull zero into the domain.
        baseline ||= !!def.baseline && !data.ranged;
        banded ||= !!def.banded;
        // Only marks drawn from a start (bars, areas, stacks, ranges) span y0: a line or a point is just y1.
        const spans = data.stacked || data.ranged || !!def.baseline;
        for (const s of data.series) {
          if (s.hidden) continue;
          for (let i = 0; i < s.x.length; i++) {
            const x = s.x[i];
            if (x < c0) c0 = x;
            if (x > c1) c1 = x;
            const lo = spans ? Math.min(s.y0[i], s.y1[i]) : s.y1[i];
            const hi = spans ? Math.max(s.y0[i], s.y1[i]) : s.y1[i];
            if (lo < v0) v0 = lo;
            if (hi > v1) v1 = hi;
            if (def.banded && i > 0 && x - s.x[i - 1] > 0) step = Math.min(step, x - s.x[i - 1]);
          }
        }
      }
      if (c0 > c1) [c0, c1] = [0, 1];
      if (v0 > v1) [v0, v1] = [0, 1];
      if (!Number.isFinite(step)) step = c1 > c0 ? c1 - c0 : 1;

      let cat: Scale;
      if (catType === 'band') {
        const pad = theme.marks.bar.bandPadding;
        // Horizontal charts list categories top-down; `reverse` flips either way.
        cat = new BandScale([...categories.keys()], pad, pad / 2, horizontal !== !!catSpec.reverse);
      } else {
        if (banded) {
          c0 -= step / 2;
          c1 += step / 2;
        }
        const onlyPoints = spec.layers.every((l) => l.mark === 'point');
        if (catType !== 'time' && (catSpec.nice ?? (onlyPoints && !banded))) [c0, c1] = niceDomain(c0, c1, 8);
        if (catSpec.zero) [c0, c1] = [Math.min(0, c0), Math.max(0, c1)];
        c0 = catSpec.domain?.[0] ?? c0;
        c1 = catSpec.domain?.[1] ?? c1;
        const fmt = fields[catField ?? '']?.format;
        if (catSpec.reverse) [c0, c1] = [c1, c0];
        cat = catType === 'time' ? new TimeScale(c0, c1) : catType === 'log' ? new LogScale(c0, c1, fmt) : new LinearScale(c0, c1, fmt);
        xStep = Math.abs(cat.norm(c0 + step) - cat.norm(c0));
      }

      const valCol = valField ? tableOf(refIndex).column(valField) : undefined;
      const valType = valSpec.type ?? (valCol?.type === 'time' ? 'time' : 'linear');
      const normalized = layers.some(({ data }) => data.stacked && data.stackMode === 'normalize');
      // A 100 % stack reads in percent, whatever the unit of the values.
      const valFormat = valAxis?.format ?? (normalized ? { style: 'percent' as const } : fields[valField ?? '']?.format);
      let val: Scale;
      if (valType === 'time') {
        val = new TimeScale(valSpec.domain?.[0] ?? v0, valSpec.domain?.[1] ?? v1);
      } else if (valType === 'log') {
        val = new LogScale(valSpec.domain?.[0] ?? v0, valSpec.domain?.[1] ?? v1, valFormat);
      } else {
        if (valSpec.zero ?? baseline) [v0, v1] = [Math.min(0, v0), Math.max(0, v1)];
        // Value labels outside the bar ends need room past the longest bar.
        const outsideLabels = layers.some(({ data }) => data.layer.style?.labels && !data.stacked && data.layer.mark === 'bar');
        if (outsideLabels && !valSpec.domain) {
          const pad = (v1 - v0) * (horizontal ? 0.14 : 0.08);
          if (v1 > 0) v1 += pad;
          if (v0 < 0) v0 -= pad;
        }
        if ((valSpec.nice ?? true) && !normalized) [v0, v1] = niceDomain(v0, v1, 5);
        if (normalized && !valSpec.domain) [v0, v1] = [0, 1];
        const d0 = valSpec.domain?.[0] ?? v0;
        const d1 = valSpec.domain?.[1] ?? v1;
        val = valSpec.reverse ? new LinearScale(d1, d0, valFormat) : new LinearScale(d0, d1, valFormat);
      }
      this.cat = cat;
      this.val = val;
      this.xScale = horizontal ? val : cat;
      this.yScale = horizontal ? cat : val;
    }

    // 4. Build GPU batches. Size-dependent marks (treemap) need the real view
    //    size, known only once the legend is in: build, lay out, rebuild if needed.
    const surface = parseColor(theme.background);
    const opaqueSurface: RGBA = surface[3] === 0 ? [1, 1, 1, 1] : surface;
    const pos = horizontal ? (c: number, v: number): [number, number] => [v, c] : (c: number, v: number): [number, number] => [c, v];
    const buildAll = (view: { width: number; height: number }): Built[] =>
      layers.map(({ data, def }) => {
        const themeKey = def.themeKey ?? data.layer.mark;
        const style = deepMerge((theme.marks as Record<string, any>)[themeKey] ?? {}, data.layer.style ?? {});
        const [k0, k1] = data.colorExtent;
        const [s0, s1] = data.sizeExtent;
        const [r0, r1] = (style.sizeRange as [number, number] | undefined) ?? [4, 28];
        const enc = data.layer.encode;
        const layerValue = def.standalone ? (enc.value ?? enc.color ?? enc.y) : horizontal ? enc.x : enc.y;
        const axisFormat = def.standalone ? undefined : valAxis?.format;
        const override = compileOverrides(data.layer, data.table);
        const baseColor = (s: SeriesData, i: number): RGBA =>
          s.colorValue && !data.layer.style?.color
            ? sampleRamp(ramp, k1 > k0 ? (s.colorValue[i] - k0) / (k1 - k0) : 0.5)
            : seriesColor(data, s);
        const ctx: BuildContext = {
          renderer: this.renderer,
          data,
          x: this.cat,
          y: this.val,
          horizontal: !def.standalone && horizontal,
          pos: def.standalone ? (c, v) => [c, v] : pos,
          theme,
          style,
          surface: opaqueSurface,
          xStep,
          fields,
          hidden: this.hidden,
          pixel: [1 / Math.max(1, view.width), 1 / Math.max(1, view.height)],
          categorical,
          format: (v, field = layerValue) => numberFormatter(fields[field ?? '']?.format ?? axisFormat)(v),
          ramp: (t) => sampleRamp(ramp, t),
          color: (s, i) => {
            const o = override?.(s.rows[i]);
            if (!o) return baseColor(s, i);
            const c = o.color ? parseColor(o.color) : baseColor(s, i);
            return o.opacity !== undefined ? [c[0], c[1], c[2], c[3] * o.opacity] : c;
          },
          // Area-proportional sizing: the eye reads surface, not diameter.
          size: (s, i) =>
            s.sizeValue ? r0 + (r1 - r0) * Math.sqrt(s1 > s0 ? Math.max(0, (s.sizeValue[i] - s0) / (s1 - s0)) : 0.5) : (style.size ?? 8),
        };
        return { data, def, mark: def.build(ctx) };
      });

    const guess = this.layout?.view ?? { width: Math.max(1, this.width - 80), height: Math.max(1, this.height - 120) };
    this.built = buildAll(guess);

    // 5. Legend: series and mark entries, in slot order.
    const entries = new Map<string, LegendEntry>();
    for (const { data, def, mark } of this.built) {
      if (data.colorMode === 'series') {
        for (const s of data.series) {
          if (!entries.has(s.key)) entries.set(s.key, { key: s.key, color: seriesColor(data, s), symbol: def.symbol });
        }
      }
      for (const e of mark.legend ?? []) if (!entries.has(e.key)) entries.set(e.key, { key: e.key, color: e.color, symbol: def.symbol });
    }
    this.legend = [...slots.keys()].map((k) => entries.get(k)!).filter(Boolean);

    if (this.built.some((b) => sizeDependent(b))) {
      const view = (this.layout = this.computeLayout()).view;
      if (Math.abs(view.width - guess.width) > 0.5 || Math.abs(view.height - guess.height) > 0.5) {
        this.disposeMarks();
        this.built = buildAll(view);
      }
    }
    this.requestRender();
  }

  // ------------------------------------------------------------------- layout

  private measure(): void {
    this.dpr = this.options.devicePixelRatio ?? window.devicePixelRatio ?? 1;
    this.width = this.container.clientWidth || 600;
    this.height = this.container.clientHeight || 320;
    this.renderer.resize(this.width, this.height, this.dpr);
    this.overlay.width = Math.round(this.width * this.dpr);
    this.overlay.height = Math.round(this.height * this.dpr);
  }

  /** Install the map scales and return the aspect ratio (width / height) to keep. */
  private projectionScales(p: ProjectionSpec): number {
    const [[west, south], [east, north]] = p.bounds ?? [[-180, -58], [180, 84]];
    this.xScale = new LinearScale(west, east);
    if (p.type === 'equirectangular') {
      this.yScale = new LinearScale(south, north);
      return (east - west) / (north - south);
    }
    const lat = new MercatorScale(south, north);
    this.yScale = lat;
    return ((east - west) * Math.PI) / 180 / lat.span;
  }

  private axis(channel: 'x' | 'y'): AxisSpec | null {
    if (!this.axesShown[channel]) return null; // maps, pies, treemaps…
    const a = this.spec.axes?.[channel];
    return a === false ? null : (a ?? {});
  }

  private showLegend(): boolean {
    return (this.spec.legend ?? this.theme.legend.visible) && this.legend.length >= 2;
  }

  private computeLayout(): Layout {
    const { theme, ctx, spec, zoom } = this;
    const pad = theme.padding;
    const ff = theme.font.family;
    let top = pad;
    const titleY = top;
    if (spec.title) top += theme.title.size * 1.3;
    if (spec.subtitle) top += theme.subtitle.size * 1.5;
    if (spec.title || spec.subtitle) top += theme.title.gap;

    // Legend: wraps to as many rows as needed.
    const legendY = top;
    if (this.showLegend()) {
      const l = theme.legend;
      ctx.font = font(l.label.weight, l.label.size, ff);
      const rowH = l.label.size * 1.7;
      let x = pad;
      let y = top;
      for (const e of this.legend) {
        const w = l.symbolSize + 6 + ctx.measureText(e.key).width;
        if (x > pad && x + w > this.width - pad) {
          x = pad;
          y += rowH;
        }
        e.rect = { x, y, width: w, height: rowH };
        x += w + l.itemGap;
      }
      top = y + rowH + 8;
    }

    const xAxis = this.axis('x');
    const yAxis = this.axis('y');
    const lab = theme.axis.label;
    const ttl = theme.axis.title;
    let bottom = pad;
    if (xAxis && xAxis.labels !== false) bottom += lab.size + lab.padding;
    if (xAxis?.title) bottom += ttl.size + ttl.padding;
    const plotH = Math.max(10, this.height - top - bottom);

    const vy0 = -zoom.ty / zoom.ky;
    const vy1 = (1 - zoom.ty) / zoom.ky;
    const yCount = yAxis?.tickCount ?? Math.min(10, Math.max(2, Math.round(plotH / 56)));
    const yTicks = this.yScale.ticks(vy0, vy1, yCount);

    let left = pad;
    if (yAxis && yAxis.labels !== false) {
      ctx.font = font(lab.weight, lab.size, ff);
      let w = 0;
      for (const t of yTicks) w = Math.max(w, ctx.measureText(t.label).width);
      left += Math.ceil(w) + lab.padding;
    }
    if (yAxis?.title) left += ttl.size + ttl.padding;
    // Room on the right for direct labels at the end of lines.
    let endRoom = 0;
    for (const b of this.built) {
      if (!b.data.layer.style?.endLabels) continue;
      ctx.font = font(500, 11, ff);
      for (const s of b.data.series) if (!s.hidden) endRoom = Math.max(endRoom, ctx.measureText(s.key).width + 14);
    }
    const plotW = Math.max(10, this.width - left - pad - 4 - endRoom);
    const plot = { x: left, y: top, width: plotW, height: plotH };

    const vx0 = -zoom.tx / zoom.kx;
    const vx1 = (1 - zoom.tx) / zoom.kx;
    const xCount = xAxis?.tickCount ?? Math.min(12, Math.max(2, Math.round(plotW / 90)));
    const xTicks = this.xScale.ticks(vx0, vx1, xCount);

    // With an imposed aspect ratio, letterbox the view inside the plot.
    let view: ClipRect = plot;
    if (this.aspect) {
      const w = Math.min(plotW, plotH * this.aspect);
      const h = w / this.aspect;
      view = { x: left + (plotW - w) / 2, y: top + (plotH - h) / 2, width: w, height: h };
    }
    // Axes must hug a letterboxed view (calendar), not the empty plot around it.
    const shown = this.aspect && (this.axis('x') || this.axis('y'));
    const plotOut = shown ? view : plot;
    const transform: ViewTransform = {
      sx: zoom.kx * view.width,
      ox: view.x + zoom.tx * view.width,
      sy: -zoom.ky * view.height,
      oy: view.y + view.height - zoom.ty * view.height,
    };
    return { plot: plotOut, view, titleY, legendY, xTicks, yTicks, transform };
  }

  // ------------------------------------------------------------------- render

  private requestRender(): void {
    if (this.frame || this.destroyed) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.destroyed || !this.gridBatch) return;
    const { theme } = this;
    const L = (this.layout = this.computeLayout());
    const { plot, transform: T } = L;
    const calls: DrawCall[] = [];

    // Grid, in pixel space, snapped to device pixels.
    const grid: number[] = [];
    const xAxis = this.axis('x');
    const yAxis = this.axis('y');
    const addLine = (x0: number, y0: number, x1: number, y1: number, color: string, width: number) => {
      const c = parseColor(color);
      grid.push(x0, y0, x1, y1, c[0], c[1], c[2], c[3], width);
    };
    // The value axis carries the grid: y normally, x on a horizontal chart. Mark-owned scales (heatmap) have none.
    const gridY = this.markScales ? false : this.horizontal ? theme.grid.x.visible : theme.grid.y.visible;
    const gridX = this.markScales ? false : this.horizontal ? theme.grid.y.visible : theme.grid.x.visible;
    if (yAxis && (yAxis.grid ?? gridY)) {
      for (const t of L.yTicks) {
        const y = T.oy + t.t * T.sy;
        if (y >= plot.y - 0.5 && y <= plot.y + plot.height + 0.5) addLine(plot.x, y, plot.x + plot.width, y, theme.grid.y.color, theme.grid.y.width);
      }
    }
    if (xAxis && (xAxis.grid ?? gridX)) {
      for (const t of L.xTicks) {
        const x = T.ox + t.t * T.sx;
        if (x >= plot.x - 0.5 && x <= plot.x + plot.width + 0.5) addLine(x, plot.y, x, plot.y + plot.height, theme.grid.x.color, theme.grid.x.width);
      }
    }
    this.gridBatch.update(new Float32Array(grid), grid.length / LAYOUTS.line.stride);
    calls.push({ batch: this.gridBatch, pixelSnap: true });

    // Marks. Unzoomed, leave a little room so markers on the edge are not cut.
    const zoomed = this.zoom.kx !== 1 || this.zoom.ky !== 1;
    const m = zoomed ? 0 : 6;
    let clip = { x: plot.x - m, y: plot.y - m, width: plot.width + 2 * m, height: plot.height + 2 * m };
    if (this.geo) {
      // A map stops at the edge of the projected world, wherever the zoom has moved it.
      const x0 = Math.max(plot.x, T.ox);
      const y0 = Math.max(plot.y, T.oy + T.sy);
      const x1 = Math.min(plot.x + plot.width, T.ox + T.sx);
      const y1 = Math.min(plot.y + plot.height, T.oy);
      clip = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
    }
    // With a selection, selectable marks are dimmed and the selected ones redrawn on top.
    const selecting = this.built.some((b) => b.sel);
    for (const b of this.built) {
      for (const d of b.mark.draws) {
        const opacity = selecting && d.perDatum ? theme.selection.dimOpacity : 1;
        calls.push({ batch: d.batch, transform: T, clip, pixelSnap: d.pixelSnap, opacity });
      }
      for (const d of b.sel?.draws ?? []) calls.push({ batch: d.batch, transform: T, clip, pixelSnap: d.pixelSnap });
    }
    this.renderer.render({ clearColor: parseColor(theme.background), calls });
    this.drawOverlay(L);
  }

  private drawOverlay(L: Layout): void {
    const { ctx, theme, spec } = this;
    const { plot, transform: T } = L;
    const ff = theme.font.family;
    const pad = theme.padding;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const crisp = (v: number, w: number) => (Math.round(w * this.dpr) % 2 === 1 ? Math.floor(v * this.dpr) / this.dpr + 0.5 / this.dpr : Math.round(v * this.dpr) / this.dpr);

    // Title block.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let ty = L.titleY;
    if (spec.title) {
      ctx.font = font(theme.title.weight, theme.title.size, ff);
      ctx.fillStyle = theme.title.color;
      ctx.fillText(spec.title, pad, ty);
      ty += theme.title.size * 1.3;
    }
    if (spec.subtitle) {
      ctx.font = font(theme.subtitle.weight, theme.subtitle.size, ff);
      ctx.fillStyle = theme.subtitle.color;
      ctx.fillText(spec.subtitle, pad, ty + theme.subtitle.size * 0.2);
    }

    // Legend.
    if (this.showLegend()) {
      const l = theme.legend;
      ctx.font = font(l.label.weight, l.label.size, ff);
      ctx.textBaseline = 'middle';
      for (const e of this.legend) {
        const r = e.rect!;
        const cy = r.y + r.height / 2;
        ctx.globalAlpha = this.hidden.has(e.key) ? l.hiddenOpacity : 1;
        ctx.fillStyle = toCss(e.color);
        if (e.symbol === 'line') {
          ctx.fillRect(r.x, cy - 1, l.symbolSize + 2, 2);
        } else if (e.symbol === 'square') {
          ctx.beginPath();
          ctx.roundRect(r.x, cy - l.symbolSize / 2, l.symbolSize, l.symbolSize, 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(r.x + l.symbolSize / 2, cy, l.symbolSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = l.label.color;
        ctx.fillText(e.key, r.x + l.symbolSize + 6, cy + 0.5);
      }
      ctx.globalAlpha = 1;
    }

    const lab = theme.axis.label;
    const ttl = theme.axis.title;
    const xAxis = this.axis('x');
    const yAxis = this.axis('y');
    const bottom = plot.y + plot.height;

    // X axis.
    if (xAxis) {
      if (xAxis.line ?? (!this.horizontal && !this.markScales && theme.axis.line.visible)) {
        const w = theme.axis.line.width;
        const y = crisp(bottom, w);
        ctx.strokeStyle = theme.axis.line.color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.width, y);
        ctx.stroke();
      }
      if (xAxis.labels !== false) {
        ctx.font = font(lab.weight, lab.size, ff);
        ctx.fillStyle = lab.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        let lastRight = -Infinity;
        for (const t of L.xTicks) {
          // Empty labels (calendar weeks between months) take no room.
          if (!t.label) continue;
          const x = T.ox + t.t * T.sx;
          if (x < plot.x - 1 || x > plot.x + plot.width + 1) continue;
          const w = ctx.measureText(t.label).width;
          // Keep the label inside the chart, and skip it rather than overlap its neighbour.
          const cx = Math.min(this.width - 2 - w / 2, Math.max(2 + w / 2, x));
          if (cx - w / 2 < lastRight + 10) continue;
          if (theme.axis.tick.visible) {
            ctx.fillRect(crisp(x, 1) - 0.5, bottom, theme.axis.tick.width, theme.axis.tick.size);
          }
          ctx.fillText(t.label, cx, bottom + lab.padding);
          lastRight = cx + w / 2;
        }
      }
      if (xAxis.title) {
        ctx.font = font(ttl.weight, ttl.size, ff);
        ctx.fillStyle = ttl.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(xAxis.title, plot.x + plot.width / 2, this.height - pad);
      }
    }

    // Y axis.
    if (yAxis) {
      if (yAxis.line ?? (this.horizontal && theme.axis.line.visible)) {
        const w = theme.axis.line.width;
        const x = crisp(plot.x, w);
        ctx.strokeStyle = theme.axis.line.color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
      if (yAxis.labels !== false) {
        ctx.font = font(lab.weight, lab.size, ff);
        ctx.fillStyle = lab.color;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const t of L.yTicks) {
          const y = T.oy + t.t * T.sy;
          if (y < plot.y - 1 || y > bottom + 1) continue;
          ctx.fillText(t.label, plot.x - lab.padding, y + 0.5);
        }
      }
      if (yAxis.title) {
        ctx.save();
        ctx.font = font(ttl.weight, ttl.size, ff);
        ctx.fillStyle = ttl.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.translate(pad, plot.y + plot.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yAxis.title, 0, 0);
        ctx.restore();
      }
    }

    this.drawLabels(L);
    this.drawHover(L);
    this.drawLasso();
  }

  /** Labels the marks asked for. A label with a box is drawn only if it fits inside it. */
  private drawLabels(L: Layout): void {
    const { ctx, theme } = this;
    const T = L.transform;
    ctx.save();
    const avoid: { l: MarkLabel; ax: number; ay: number; y: number }[] = [];
    for (const b of this.built) {
      for (const l of b.mark.labels ?? []) {
        if (!l.avoid) {
          this.drawLabel(l, L);
          continue;
        }
        const ax = T.ox + l.tx * T.sx;
        const ay = T.oy + l.ty * T.sy;
        avoid.push({ l, ax, ay, y: ay + (l.dy ?? 0) });
      }
    }
    // Labels that must not overlap (line ends): spread them apart vertically,
    // and tie a moved label to its anchor with a leader line.
    if (avoid.length) {
      const columns = new Map<number, typeof avoid>();
      for (const a of avoid) {
        const key = Math.round(a.ax / 4);
        let c = columns.get(key);
        if (!c) columns.set(key, (c = []));
        c.push(a);
      }
      for (const c of columns.values()) {
        c.sort((p, q) => p.y - q.y);
        for (let i = 1; i < c.length; i++) {
          const min = c[i - 1].y + (c[i - 1].l.size ?? 11) + 3;
          if (c[i].y < min) c[i].y = min;
        }
        const bottom = L.plot.y + L.plot.height + 6;
        for (let i = c.length - 1; i >= 0; i--) {
          const over = c[i].y - (i === c.length - 1 ? bottom : c[i + 1].y - (c[i].l.size ?? 11) - 3);
          if (over > 0) c[i].y -= over;
        }
        for (const a of c) {
          const dx = a.l.dx ?? 0;
          if (Math.abs(a.y - a.ay) > 2) {
            ctx.strokeStyle = theme.text.muted;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.ax + 4, a.ay);
            ctx.lineTo(a.ax + dx - 3, a.y);
            ctx.stroke();
          }
          this.drawLabel({ ...a.l, avoid: false, dy: a.y - a.ay }, L);
        }
      }
    }
    ctx.restore();
  }

  private drawLabel(l: MarkLabel, L: Layout): void {
    const { ctx, theme } = this;
    const { plot, transform: T } = L;
    const ax = T.ox + l.tx * T.sx;
    const ay = T.oy + l.ty * T.sy;
    // Anchored outside the visible plot (zoomed away): skip.
    if (ax < plot.x - 1 || ax > plot.x + plot.width + 1 || ay < plot.y - 1 || ay > plot.y + plot.height + 1) return;
    const x = ax + (l.dx ?? 0);
    const y = ay + (l.dy ?? 0);
    const size = l.size ?? 11;
    ctx.font = font(l.weight ?? 500, size, theme.font.family);
    const align = l.align ?? 'center';
    const baseline = l.baseline ?? 'middle';
    const w = ctx.measureText(l.text).width;
    if (l.box) {
      const bx0 = Math.min(T.ox + l.box[0] * T.sx, T.ox + l.box[2] * T.sx);
      const bx1 = Math.max(T.ox + l.box[0] * T.sx, T.ox + l.box[2] * T.sx);
      const by0 = Math.min(T.oy + l.box[1] * T.sy, T.oy + l.box[3] * T.sy);
      const by1 = Math.max(T.oy + l.box[1] * T.sy, T.oy + l.box[3] * T.sy);
      const left = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
      const top = baseline === 'middle' ? y - size / 2 : baseline === 'top' || baseline === 'hanging' ? y : y - size;
      // Measure first: a label that does not fit is never clipped, it moves out or disappears.
      if (left < bx0 + 4 || left + w > bx1 - 4 || top < by0 + 2 || top + size > by1 - 2) {
        if (l.fallback) this.drawLabel(l.fallback, L);
        return;
      }
    }
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillStyle = l.color ?? (l.on ? (luminance(l.on) > 0.4 ? '#0b0b0b' : '#ffffff') : theme.text.secondary);
    ctx.fillText(l.text, x, y);
  }

  private drawHover(L: Layout): void {
    if (this.picked.length === 0) return;
    const { ctx, theme } = this;
    const { plot, transform: T } = L;
    const first = this.built[this.picked[0].layer].mark.hit;
    const fx = first.x[this.picked[0].index];
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y - 6, plot.width, plot.height + 12);
    ctx.clip();

    if (this.tooltipMode() === 'x' && (this.spec.interactions?.crosshair ?? true)) {
      const H = this.horizontal;
      const c = H ? T.oy + this.cat.norm(fx) * T.sy : T.ox + this.cat.norm(fx) * T.sx;
      const hasBand = this.built.some((b) => b.def.banded);
      if (hasBand) {
        const span = this.cat.band > 0 ? this.cat.band / (1 - theme.marks.bar.bandPadding) : this.xStepNorm();
        const w = Math.abs(span * (H ? T.sy : T.sx));
        ctx.fillStyle = theme.hover.bandFill;
        if (H) ctx.fillRect(plot.x, c - w / 2, plot.width, w);
        else ctx.fillRect(c - w / 2, plot.y, w, plot.height);
      } else if (theme.crosshair.visible) {
        const cw = theme.crosshair.width;
        ctx.fillStyle = theme.crosshair.color;
        if (H) ctx.fillRect(plot.x, Math.round(c) - cw / 2, plot.width, cw);
        else ctx.fillRect(Math.round(c) - cw / 2, plot.y, cw, plot.height);
      }
    }

    const surface = theme.background === 'transparent' ? '#fff' : theme.background;
    for (const p of this.picked) {
      const b = this.built[p.layer];
      if (b.def.banded) continue;
      const hit = b.mark.hit;
      const x = T.ox + hit.tx[p.index] * T.sx;
      const y = T.oy + hit.ty[p.index] * T.sy;
      const c: RGBA = [hit.color[p.index * 4], hit.color[p.index * 4 + 1], hit.color[p.index * 4 + 2], 1];
      ctx.beginPath();
      ctx.arc(x, y, theme.hover.markerSize / 2 + 2, 0, Math.PI * 2);
      ctx.fillStyle = surface;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, theme.hover.markerSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = toCss(c);
      ctx.fill();
    }
    ctx.restore();
  }

  private xStepNorm(): number {
    // Smallest gap between two distinct x positions among banded layers.
    let step = Infinity;
    for (const b of this.built) {
      if (!b.def.banded) continue;
      for (const s of b.data.series) {
        for (let i = 1; i < s.x.length; i++) {
          const d = Math.abs(this.cat.norm(s.x[i]) - this.cat.norm(s.x[i - 1]));
          if (d > 0 && d < step) step = d;
        }
      }
    }
    return Number.isFinite(step) ? step : 0.05;
  }

  // ------------------------------------------------------------- interactions

  private tooltipMode(): 'x' | 'nearest' {
    const t = this.spec.interactions?.tooltip;
    if (typeof t === 'object' && t.mode) return t.mode;
    if (this.geo) return 'nearest';
    return this.spec.layers.length > 0 && this.spec.layers.every((l) => l.mark === 'point') && this.cat.band === 0
      ? 'nearest'
      : 'x';
  }

  private zoomConfig(): { axes: 'x' | 'y' | 'xy'; max: number } | null {
    const z = this.spec.interactions?.zoom;
    if (!z) return null;
    return { axes: (typeof z === 'object' && z.axes) || 'x', max: (typeof z === 'object' && z.max) || 200 };
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inPlot(p: { x: number; y: number }, margin = 0): boolean {
    const plot = this.layout?.plot;
    return !!plot && p.x >= plot.x - margin && p.x <= plot.x + plot.width + margin && p.y >= plot.y - margin && p.y <= plot.y + plot.height + margin;
  }

  private legendAt(p: { x: number; y: number }): LegendEntry | undefined {
    if (!this.showLegend() || this.spec.interactions?.legendToggle === false) return undefined;
    return this.legend.find((e) => e.rect && p.x >= e.rect.x && p.x <= e.rect.x + e.rect.width && p.y >= e.rect.y && p.y <= e.rect.y + e.rect.height);
  }

  private pick(p: { x: number; y: number }): Picked[] {
    const L = this.layout;
    if (!L || !this.inPlot(p, 8)) return [];
    const T = L.transform;
    const { plot } = L;
    const H = this.horizontal;
    const visible = (c: number) => (H ? c >= plot.y - 1 && c <= plot.y + plot.height + 1 : c >= plot.x - 1 && c <= plot.x + plot.width + 1);
    if (this.tooltipMode() === 'nearest') {
      let best: Picked | undefined;
      let bestD = 30 * 30;
      this.built.forEach((b, layer) => {
        const h = b.mark.hit;
        for (let i = 0; i < h.n; i++) {
          const dx = T.ox + h.tx[i] * T.sx - p.x;
          const dy = T.oy + h.ty[i] * T.sy - p.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { layer, index: i };
          }
        }
      });
      return best ? [best] : [];
    }
    // Mode `x`: snap to the closest x, then list every series at that x.
    let bestX = NaN;
    let bestD = Infinity;
    for (const b of this.built) {
      const h = b.mark.hit;
      for (let i = 0; i < h.n; i++) {
        // Distance along the category axis only.
        const c = H ? T.oy + this.cat.norm(h.x[i]) * T.sy : T.ox + this.cat.norm(h.x[i]) * T.sx;
        const d = Math.abs(c - (H ? p.y : p.x));
        if (d < bestD && visible(c)) {
          bestD = d;
          bestX = h.x[i];
        }
      }
    }
    if (Number.isNaN(bestX)) return [];
    // A series drawn by several layers (a line and its points) is listed once.
    const out: Picked[] = [];
    const seen = new Set<string>();
    this.built.forEach((b, layer) => {
      const h = b.mark.hit;
      for (let i = 0; i < h.n; i++) {
        if (h.x[i] !== bestX) continue;
        const id = `${b.data.series[h.series[i]].key}\u0000${h.value[i]}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ layer, index: i });
      }
    });
    return out;
  }

  private describe(picked: Picked[]): HoverItem[] {
    const fields = this.spec.fields ?? {};
    return picked.map((p) => {
      const b = this.built[p.layer];
      const h = b.mark.hit;
      const i = p.index;
      const raw = h.x[i];
      const enc = b.data.layer.encode;
      const vField = (this.horizontal ? enc.x : enc.y) ?? '';
      const axisFmt = ((this.horizontal ? this.spec.axes?.x : this.spec.axes?.y) || undefined)?.format;
      const fmt = this.val.type === 'time' ? (v: number) => this.val.format(v) : numberFormatter(fields[vField]?.format ?? axisFmt);
      // A range (Gantt, waterfall) reads "start → end".
      const valueLabel = h.value2 ? `${fmt(h.value[i])} → ${fmt(h.value2[i])}` : fmt(h.value[i]);
      return {
        layer: p.layer,
        series: b.data.series[h.series[i]].key,
        x: this.cat.type === 'band' ? this.cat.format(raw) : this.cat.type === 'time' ? new Date(raw) : raw,
        xLabel: this.cat.format(raw),
        value: h.value[i],
        valueLabel,
        color: toCss([h.color[i * 4], h.color[i * 4 + 1], h.color[i * 4 + 2], 1]),
        row: b.data.table.row(h.row[i]),
      };
    });
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    this.pointer = p;
    if (this.lasso) {
      const pts = this.lasso.points;
      const last = pts[pts.length - 1];
      if (this.lasso.rect) pts[1] = p;
      else if (Math.hypot(p.x - last.x, p.y - last.y) > 2) pts.push(p);
      this.requestRender();
      return;
    }
    if (this.drag) {
      const plot = this.layout!.view;
      const cfg = this.zoomConfig()!;
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.drag.x = p.x;
      this.drag.y = p.y;
      if (cfg.axes !== 'y') this.zoom.tx += dx / plot.width;
      if (cfg.axes !== 'x') this.zoom.ty -= dy / plot.height;
      this.clampZoom();
      this.setPicked([]);
      this.emit('zoom', { ...this.zoom });
      this.requestRender();
      return;
    }
    const overLegend = this.legendAt(p);
    const zoomed = this.zoom.kx > 1 || this.zoom.ky > 1;
    this.root.style.cursor = overLegend
      ? 'pointer'
      : this.selectConfig() && this.inPlot(p)
        ? e.shiftKey && zoomed ? 'grab' : 'crosshair'
        : this.zoomConfig() && this.inPlot(p) && zoomed ? 'grab' : 'default';
    if (this.spec.interactions?.tooltip === false) return;
    const picked = this.pick(p);
    this.shape = picked.length ? undefined : this.pickShape(p);
    this.setPicked(picked);
    this.showTooltip(p);
    if (picked.length) this.emit('hover', { items: this.describe(picked), x: p.x, y: p.y });
  }

  private onLeave(): void {
    this.pointer = undefined;
    this.shape = undefined;
    this.setPicked([]);
    this.tip.style.opacity = '0';
    this.emit('leave', {});
  }

  private onDown(e: PointerEvent): void {
    const p = this.local(e);
    const select = this.selectConfig();
    // With selection on, a drag draws the selection; Shift-drag keeps panning.
    if (select && e.button === 0 && !e.shiftKey && this.inPlot(p) && !this.legendAt(p)) {
      this.lasso = { points: select === 'rect' ? [p, p] : [p], additive: e.metaKey || e.ctrlKey, rect: select === 'rect' };
      this.root.setPointerCapture(e.pointerId);
      this.root.focus({ preventScroll: true });
      this.tip.style.opacity = '0';
      this.setPicked([]);
      return;
    }
    if (this.zoomConfig() && this.inPlot(p) && (this.zoom.kx > 1 || this.zoom.ky > 1)) {
      this.drag = { x: p.x, y: p.y, moved: 0 };
      this.root.setPointerCapture(e.pointerId);
      this.root.style.cursor = 'grabbing';
      this.tip.style.opacity = '0';
    }
  }

  private onUp(e: PointerEvent): void {
    const p = this.local(e);
    if (this.lasso) {
      const { points, additive, rect } = this.lasso;
      this.lasso = undefined;
      this.root.releasePointerCapture(e.pointerId);
      const [a, b] = points;
      const polygon = rect ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] : points;
      let w = 0;
      let h = 0;
      for (const q of polygon) {
        w = Math.max(w, Math.abs(q.x - a.x));
        h = Math.max(h, Math.abs(q.y - a.y));
      }
      if (polygon.length >= 3 && w + h > 6) {
        this.selectWithin(polygon, additive);
        return;
      }
      // No real drag: a plain click, which clears the selection and is then handled as a click.
      if (!additive) this.clearSelection();
      this.requestRender();
    }
    const moved = this.drag?.moved ?? 0;
    if (this.drag) {
      this.drag = undefined;
      this.root.releasePointerCapture(e.pointerId);
      this.root.style.cursor = 'grab';
    }
    if (moved > 3) return;
    const entry = this.legendAt(p);
    if (entry) {
      // Never hide the last visible series: an empty chart explains nothing.
      const visibleCount = this.legend.filter((l) => !this.hidden.has(l.key)).length;
      if (this.hidden.has(entry.key) || visibleCount > 1) this.toggleSeries(entry.key);
      return;
    }
    const picked = this.pick(p);
    if (picked.length) this.emit('click', { items: this.describe(picked), x: p.x, y: p.y });
  }

  private onWheel(e: WheelEvent): void {
    const cfg = this.zoomConfig();
    const p = this.local(e);
    if (!cfg || !this.inPlot(p)) return;
    e.preventDefault();
    const plot = this.layout!.view;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const z = this.zoom;
    if (cfg.axes !== 'y') {
      const f = (p.x - plot.x) / plot.width;
      const t = (f - z.tx) / z.kx;
      z.kx = Math.min(cfg.max, Math.max(1, z.kx * factor));
      z.tx = f - t * z.kx;
    }
    if (cfg.axes !== 'x') {
      const f = (plot.y + plot.height - p.y) / plot.height;
      const t = (f - z.ty) / z.ky;
      z.ky = Math.min(cfg.max, Math.max(1, z.ky * factor));
      z.ty = f - t * z.ky;
    }
    this.clampZoom();
    this.setPicked([]);
    this.tip.style.opacity = '0';
    this.emit('zoom', { ...z });
    this.requestRender();
  }

  // ---------------------------------------------------------------- selection

  private selectConfig(): 'lasso' | 'rect' | null {
    const s = this.spec.interactions?.select;
    return s ? (s === 'rect' ? 'rect' : 'lasso') : null;
  }

  /** Select every selectable datum whose position falls inside a polygon given in pixels. */
  private selectWithin(polygon: Point[], additive: boolean): void {
    const T = this.layout!.transform;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of polygon) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
    const n = polygon.length;
    const px = Float64Array.from(polygon, (q) => q.x);
    const py = Float64Array.from(polygon, (q) => q.y);
    for (const b of this.built) {
      const h = b.mark.hit;
      if (h.n === 0 || !b.mark.draws.some((d) => d.perDatum)) continue;
      const mask = additive && b.sel ? b.sel.mask : new Uint8Array(h.n);
      for (let i = 0; i < h.n; i++) {
        const x = T.ox + h.tx[i] * T.sx;
        const y = T.oy + h.ty[i] * T.sy;
        // Bounding box first: it rejects most points before the exact test.
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        let inside = false;
        for (let a = 0, c = n - 1; a < n; c = a++) {
          if (py[a] > y !== py[c] > y && x < ((px[c] - px[a]) * (y - py[a])) / (py[c] - py[a]) + px[a]) inside = !inside;
        }
        if (inside) mask[i] = 1;
      }
      this.setLayerSelection(b, mask);
    }
    this.emit('select', this.getSelection());
    this.requestRender();
  }

  private setLayerSelection(b: Built, mask: Uint8Array | null): void {
    for (const d of b.sel?.draws ?? []) d.batch.destroy();
    b.sel = undefined;
    if (!mask) return;
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i];
    if (count === 0) return;
    // Copy the selected instances into their own batch, drawn over the dimmed original.
    const draws: MarkDraw[] = [];
    for (const d of b.mark.draws) {
      if (!d.perDatum || !d.data) continue;
      const stride = LAYOUTS[d.batch.kind].stride;
      const out = new Float32Array(count * stride);
      let k = 0;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i]) out.set(d.data.subarray(i * stride, (i + 1) * stride), k++ * stride);
      }
      const batch = this.renderer.createBatch(d.batch.kind);
      batch.update(out, count);
      draws.push({ batch, pixelSnap: d.pixelSnap });
    }
    b.sel = { mask, count, draws };
  }

  private drawLasso(): void {
    const l = this.lasso;
    if (!l || l.points.length < 2) return;
    const { ctx, theme } = this;
    const [a, b] = l.points;
    ctx.save();
    ctx.beginPath();
    if (l.rect) ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    else {
      ctx.moveTo(a.x, a.y);
      for (let i = 1; i < l.points.length; i++) ctx.lineTo(l.points[i].x, l.points[i].y);
      ctx.closePath();
    }
    ctx.fillStyle = theme.selection.fill;
    ctx.fill();
    ctx.lineWidth = theme.selection.width;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = theme.selection.stroke;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.restore();
  }

  /** Shape marks (countries…) under the pointer, topmost layer first. */
  private pickShape(p: Point): ShapeHit | undefined {
    const L = this.layout;
    if (!L || !this.inPlot(p)) return undefined;
    const tx = (p.x - L.transform.ox) / L.transform.sx;
    const ty = (p.y - L.transform.oy) / L.transform.sy;
    for (let i = this.built.length - 1; i >= 0; i--) {
      const hit = this.built[i].mark.pick?.(tx, ty);
      if (hit) return hit;
    }
    return undefined;
  }

  private clampZoom(): void {
    const z = this.zoom;
    z.tx = Math.min(0, Math.max(1 - z.kx, z.tx));
    z.ty = Math.min(0, Math.max(1 - z.ky, z.ty));
  }

  private setPicked(picked: Picked[]): void {
    const same = picked.length === this.picked.length && picked.every((p, i) => p.layer === this.picked[i].layer && p.index === this.picked[i].index);
    if (same) return;
    this.picked = picked;
    this.requestRender();
  }

  private showTooltip(p: { x: number; y: number }): void {
    const { tip, theme } = this;
    if (this.picked.length === 0 && !this.shape) {
      tip.style.opacity = '0';
      return;
    }
    const items = this.describe(this.picked);
    const mode = this.tooltipMode();
    const context: TooltipContext = items.length
      ? { mode, title: mode === 'x' ? items[0].xLabel : items[0].series, items, theme }
      : { mode: 'nearest', title: this.shape!.title, items, shape: this.shape, theme };
    const t = theme.tooltip;
    Object.assign(tip.style, {
      background: t.background,
      color: t.color,
      border: `1px solid ${t.border}`,
      borderRadius: `${t.radius}px`,
      padding: `${t.padding}px`,
      boxShadow: t.shadow,
      font: `${t.fontSize}px ${theme.font.family}`,
    });

    const custom = this.options.tooltip?.(context);
    if (this.options.tooltip) {
      if (custom === null || custom === undefined) {
        tip.style.opacity = '0';
        return;
      }
      if (typeof custom === 'string') tip.innerHTML = custom;
      else tip.replaceChildren(custom);
    } else {
      tip.replaceChildren(this.defaultTooltip(context));
    }

    // Place beside the pointer, flipping to stay inside the chart.
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = p.x + 14;
    let y = p.y - h - 10;
    if (x + w > this.width - 4) x = p.x - w - 14;
    if (y < 4) y = Math.min(this.height - h - 4, p.y + 14);
    tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
    tip.style.opacity = '1';
  }

  private defaultTooltip(c: TooltipContext): HTMLElement {
    const t = c.theme.tooltip;
    const fields = this.spec.fields ?? {};
    const box = document.createElement('div');
    const head = document.createElement('div');
    head.textContent = c.title;
    head.style.cssText = `font-weight:600;margin-bottom:6px;`;
    box.appendChild(head);
    const row = (label: string, value: string, color?: string) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;gap:8px;line-height:1.6;';
      if (color) {
        const sw = document.createElement('span');
        sw.style.cssText = `width:8px;height:8px;border-radius:2px;background:${color};flex:none;`;
        r.appendChild(sw);
      }
      const l = document.createElement('span');
      l.textContent = label;
      l.style.cssText = `color:${t.muted};flex:1;`;
      const v = document.createElement('span');
      v.textContent = value;
      v.style.cssText = 'font-weight:600;font-variant-numeric:tabular-nums;margin-left:12px;';
      r.append(l, v);
      box.appendChild(r);
    };
    if (c.shape) {
      for (const r of c.shape.rows) row(r.label, r.value);
      if (c.shape.rows.length === 0) head.style.marginBottom = '0';
      return box;
    }
    if (c.mode === 'nearest') {
      // One mark: list its encoded fields, with the catalog labels.
      const it = c.items[0];
      const enc = this.spec.layers[it.layer].encode;
      const label = (f: string) => fields[f]?.label ?? f;
      head.style.display = 'flex';
      head.style.alignItems = 'center';
      head.style.gap = '8px';
      const sw = document.createElement('span');
      sw.style.cssText = `width:8px;height:8px;border-radius:50%;background:${it.color};`;
      head.prepend(sw);
      row(label(enc.x ?? ''), it.xLabel);
      row(label(enc.y ?? ''), it.valueLabel);
      for (const f of [enc.size, enc.color]) {
        if (!f || f === enc.x || f === enc.y) continue;
        const v = it.row[f];
        if (typeof v === 'number') row(label(f), numberFormatter(fields[f]?.format)(v));
      }
    } else {
      for (const it of c.items) row(it.series, it.valueLabel, it.color);
    }
    return box;
  }

  private emit<K extends keyof ChartEvents>(type: K, payload: ChartEvents[K]): void {
    this.listeners.get(type)?.forEach((h) => h(payload));
  }
}
