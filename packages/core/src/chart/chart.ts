import { Table, type DataInput, type Row } from '../data/table';
import { ensureBuiltinMarks } from '../marks/builtin';
import { applyTransforms } from '../data/transforms';
import { prefersReducedMotion } from '../marks/animate';
import { luminance } from '../marks/primitives';
import { annotationRaw, buildAnnotations } from './annotations';
import { broadcast, joinGroup, leaveGroup, type SyncMember } from './sync';
import { prepareLayer, standaloneLayer, type LayerData, type SeriesData } from '../marks/prepare';
import { emptyHit, getMark, type BuildContext, type BuiltMark, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit, type Timeline } from '../marks/registry';
import { createRenderer, type RendererChoice } from '../render';
import { LAYOUTS } from '../render/layouts';
import type { Batch, ClipRect, DrawCall, Renderer, RGBA, ViewTransform } from '../render/types';
import { BandScale, LinearScale, LogScale, MercatorScale, TimeScale, niceDomain, type Scale, type Tick } from '../scale/scales';
import type { AxisSpec, ChartSpec, LayerSpec, ProjectionSpec, ScaleSpec, StyleOverride } from '../spec/types';
import { resolveTheme, resolveThemeColors, themeColor, type Theme } from '../theme/theme';
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
  /** A drill-down mark (sunburst, rose) changed its focus. `path` is empty when back to everything. */
  drill: { layer: number; path: string[] };
  /** A datum with a link (`layer.link`) was clicked. */
  link: { url: string; row: Row; layer: number };
  /** A time-driven chart (bar chart race) reached a new frame. */
  frame: { index: number; label: string };
  /** Boxes of a diagram were moved by hand: every position, to save as `x` / `y` in the spec. */
  layout: { layer: number; positions: Record<string, { x: number; y: number }> };
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

/**
 * A responsive rule over a spec: nested objects merged, layers merged one by one
 * (a layer may change its mark), anything else replaced.
 */
function mergeSpec(base: ChartSpec, over: Partial<ChartSpec>): ChartSpec {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === 'layers' && Array.isArray(v)) {
      const layers = [...base.layers];
      (v as Partial<LayerSpec>[]).forEach((l, i) => {
        const b = layers[i];
        layers[i] = b ? ({ ...b, ...l, encode: { ...b.encode, ...l.encode }, style: l.style ? { ...b.style, ...l.style } : b.style } as LayerSpec) : (l as LayerSpec);
      });
      out.layers = layers;
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && out[k] && typeof out[k] === 'object' && k !== 'data') {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else out[k] = v;
  }
  return out as unknown as ChartSpec;
}

/** Cut a text to a width, with "…". */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

const withAlphaRGBA = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];

const sizeDependent = (b: Built) =>
  typeof b.def.sizeDependent === 'function' ? b.def.sizeDependent(b.data.layer) : !!b.def.sizeDependent;

/** The field a `highlight` targets when it names none. */
function highlightField(layer: LayerSpec, horizontal: boolean): string | undefined {
  const e = layer.encode;
  return e.key ?? e.path?.[0] ?? e.source ?? (horizontal ? e.y : e.x) ?? e.color;
}

/** Compile `layer.highlight` and `layer.overrides` into a per-row style lookup. */
function compileOverrides(layer: LayerSpec, table: Table, horizontal: boolean): ((row: number) => StyleOverride['style'] | undefined) | undefined {
  const rulesIn: StyleOverride[] = [];
  const h = layer.highlight;
  const field = h ? (h.field ?? highlightField(layer, horizontal)) : undefined;
  if (h && field && table.has(field)) {
    rulesIn.push({ when: { field, in: h.values }, style: h.color ? { color: h.color } : {} });
    if ((h.dim ?? 0.25) < 1) rulesIn.push({ when: { field, notIn: h.values }, style: { opacity: h.dim ?? 0.25 } });
  }
  rulesIn.push(...(layer.overrides ?? []));
  if (!rulesIn.length) return undefined;
  const rules = rulesIn.map((o) => {
    const conds = (Array.isArray(o.when) ? o.when : [o.when]).map((p) => {
      const values = table.column(p.field).values;
      const set = p.in ? new Set(p.in.map(String)) : undefined;
      return (row: number) => {
        const v = values[row];
        if (p.equals !== undefined && String(v) !== String(p.equals)) return false;
        if (set && !set.has(String(v))) return false;
        if (p.notIn && p.notIn.map(String).includes(String(v))) return false;
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

export class Chart implements SyncMember {
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
  /** A mark-level drag in progress (a diagram box). */
  private markDrag?: { layer: number; moved: number; x: number; y: number };
  private geo = false;
  /** Category scale and value scale (x and y, swapped when horizontal). */
  private cat: Scale = this.xScale;
  private val: Scale = this.yScale;
  private horizontal = false;
  /** The scales come from a standalone mark (no grid by default). */
  private markScales = false;
  private axesShown = { x: true, y: true };
  private markGrid = { x: false, y: false };
  /** Readability floor of a diagram (px); see `MarkScales.minWidth`. */
  private minViewWidth?: number;
  /** The user moved or zoomed the view: leave it alone. */
  private userZoomed = false;
  /** Sync group joined (`interactions.sync`). */
  private syncGroup?: string;
  /** Navigator: the window shown by the other charts of the group, in normalized x. */
  private navWindow: [number, number] = [0, 1];
  private navDrag?: { mode: 'move' | 'w' | 'e'; x: number; start: [number, number] };
  /** Width / height the view must keep (maps). */
  private aspect?: number;
  private lasso?: { points: Point[]; additive: boolean; rect: boolean };
  private shape?: ShapeHit;
  /** Per-layer state kept across rebuilds (drill-down focus…). */
  private layerState = new Map<number, Record<string, unknown>>();
  /** Entry animation: pending until the first frame, then its start time. */
  private enter: { pending: boolean; start: number; duration: number } = { pending: false, start: 0, duration: 0 };
  private frame = 0;
  /** Play button and scrubber of a time-driven mark. */
  private timeline?: Timeline;
  private controls?: { root: HTMLDivElement; button: HTMLButtonElement; range: HTMLInputElement; label: HTMLSpanElement };
  private shownFrame = -1;
  /** On screen (or close to it). Off screen, frames are skipped and drawn on return. */
  private visible = typeof IntersectionObserver === 'undefined';
  private dirty = false;
  private intersection?: IntersectionObserver;
  private enterProgress = 1;
  private destroyed = false;

  private constructor(private container: HTMLElement, private options: ChartOptions) {}

  /** Async because acquiring a GPU device can be (WebGPU). */
  static async create(container: HTMLElement, spec: ChartSpec, options: ChartOptions = {}): Promise<Chart> {
    ensureBuiltinMarks();
    const chart = new Chart(container, options);
    await chart.init();
    chart.update(spec);
    const a = spec.animation ?? true;
    const duration = typeof a === 'number' ? a : a ? 900 : 0;
    chart.enter = { pending: duration > 0 && !prefersReducedMotion(), start: 0, duration };
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
    // A finger lifting off is not the pointer leaving: the tooltip of a tap stays until the next tap.
    root.addEventListener('pointerleave', (e) => e.pointerType !== 'touch' && this.onLeave(), { signal });
    root.addEventListener('pointerdown', (e) => this.onDown(e), { signal });
    root.addEventListener('pointerup', (e) => this.onUp(e), { signal });
    root.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    root.addEventListener('dblclick', () => this.resetZoom(), { signal });
    // Escape clears the selection (the chart root is focusable for that).
    root.addEventListener('keydown', (e) => e.key === 'Escape' && this.clearSelection(), { signal });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersection = new IntersectionObserver(
        (entries) => {
          this.visible = entries[entries.length - 1].isIntersecting;
          if (this.visible && this.dirty) {
            this.dirty = false;
            this.requestRender();
          }
        },
        { rootMargin: '120px' },
      );
      this.intersection.observe(root);
    }
    this.measure();
  }

  // ---------------------------------------------------------------- public API

  /** Replace the spec and recompile. */
  update(input: ChartSpec): void {
    this.base = input;
    this.ruleKey = '\u0000';
    const spec = this.effectiveSpec();
    // Keep drill-down states when the layers are the same marks (theme or data change).
    const same = spec.layers.length === this.spec.layers.length && spec.layers.every((l, i) => l.mark === this.spec.layers[i].mark);
    if (!same) this.layerState.clear();
    this.spec = spec;
    this.theme = resolveTheme(spec.theme);
    this.zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
    this.userZoomed = false;
    this.compile();
  }

  /** Swap the data, keep everything else (zoom included). */
  setData(data: DataInput): void {
    this.spec = { ...this.spec, data };
    this.compile();
  }

  /** The spec as given (before the responsive rules). */
  getSpec(): ChartSpec {
    return this.base ?? this.spec;
  }

  // ------------------------------------------------------------ responsive

  private base?: ChartSpec;
  /** Which rules matched last time: a resize that changes it rebuilds the chart. */
  private ruleKey = '';

  /** The spec with the responsive rules matching the current size applied. */
  private effectiveSpec(): ChartSpec {
    const base = this.base!;
    const rules = base.responsive ?? [];
    const w = this.width, h = this.height;
    const hits = rules.filter((r) => (r.maxWidth === undefined || w <= r.maxWidth) && (r.minWidth === undefined || w >= r.minWidth) && (r.maxHeight === undefined || h <= r.maxHeight) && (r.minHeight === undefined || h >= r.minHeight));
    this.ruleKey = hits.map((r) => rules.indexOf(r)).join(',');
    let out: ChartSpec = base;
    for (const r of hits) out = mergeSpec(out, r.spec);
    return out;
  }

  /** On resize: re-apply the rules; true when the spec changed. */
  private reapplyResponsive(): boolean {
    if (!this.base?.responsive?.length) return false;
    const before = this.ruleKey;
    const spec = this.effectiveSpec();
    if (this.ruleKey === before) return false;
    const same = spec.layers.length === this.spec.layers.length && spec.layers.every((l, i) => l.mark === this.spec.layers[i].mark);
    if (!same) this.layerState.clear();
    this.spec = spec;
    this.theme = resolveTheme(spec.theme);
    return true;
  }

  /** Domains of the continuous axes as drawn (small multiples share them). */
  getDomains(): { x?: [number, number]; y?: [number, number] } {
    const d = (s: Scale): [number, number] | undefined => {
      const l = s as Partial<{ d0: number; d1: number }>;
      return s.type !== 'band' && typeof l.d0 === 'number' && typeof l.d1 === 'number' ? [Math.min(l.d0, l.d1), Math.max(l.d0, l.d1)] : undefined;
    };
    return this.markScales || this.geo ? {} : { x: d(this.xScale), y: d(this.yScale) };
  }

  on<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Play a time-driven chart (bar chart race) from where it is, or from the start once finished. */
  play(): void {
    this.timeline?.play();
    this.requestRender();
  }

  pause(): void {
    this.timeline?.pause();
    this.requestRender();
  }

  /** Jump to a frame (fractional values land between two frames). */
  seek(frame: number): void {
    if (!this.timeline) return;
    this.timeline.pause();
    this.timeline.set(frame);
    this.requestRender();
  }

  /**
   * Forget everything the user did inside the marks: drill-down focus, boxes
   * moved by hand, zoom. Positions written in the spec stay.
   */
  resetInteractions(): void {
    this.layerState.clear();
    this.zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
    this.userZoomed = false;
    this.compile();
  }

  resetZoom(): void {
    if (!this.zoomConfig()) return;
    this.userZoomed = false;
    this.zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
    this.navWindow = [0, 1];
    this.notifyView();
    this.emit('zoom', { ...this.zoom });
    this.shareRange();
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
    if (this.reapplyResponsive()) {
      this.layout = undefined;
      this.compile();
    } else if (this.built.some((b) => sizeDependent(b))) {
      this.layout = undefined;
      this.compile();
    }
    if (this.visible) this.renderNow();
    else this.dirty = true;
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
    if (this.syncGroup) leaveGroup(this.syncGroup, this);
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.observer?.disconnect();
    this.intersection?.disconnect();
    this.disposeMarks();
    this.gridBatch?.destroy();
    this.renderer.destroy();
    this.root.remove();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ compile

  private disposeMarks(): void {
    // Their batches go: a running transition has nothing left to blend.
    this.morph = undefined;
    for (const b of this.built) {
      for (const d of b.mark.draws) d.batch.destroy();
      for (const d of b.sel?.draws ?? []) d.batch.destroy();
    }
    this.built = [];
  }

  private compile(): void {
    // What is on screen now: the state a transition starts from.
    const before = this.snapshot();
    this.disposeMarks();
    this.picked = [];
    this.shape = undefined;
    const { theme } = this;
    // Theme color tokens ($ink, $grid, $1…) resolve against the current theme.
    const spec: ChartSpec = {
      ...this.spec,
      layers: this.spec.layers.map((l) => ({
        ...l,
        style: resolveThemeColors(theme, l.style),
        overrides: resolveThemeColors(theme, l.overrides),
        highlight: resolveThemeColors(theme, l.highlight),
        series: resolveThemeColors(theme, l.series),
        labels: resolveThemeColors(theme, l.labels),
      })),
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
      const raw = layer.data ? Table.from(layer.data, types) : (base ?? (defs[i].standalone && (layer.geo || layer.graph) ? Table.from([]) : undefined));
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
    // An explicit order (also how small multiples share one) comes first.
    for (const c of catSpec.categories ?? []) if (!categories.has(c)) categories.set(c, categories.size);
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
    const explicit: Record<string, string> = { ...(spec.scales?.color?.colors ?? {}) };
    const categorical = (key: string): RGBA => {
      if (explicit[key]) return parseColor(explicit[key]);
      if (!slots.has(key)) slots.set(key, slots.size);
      return palette[slots.get(key)! % palette.length];
    };
    // A color set by name (`layer.series`) wins over the layer's color and the palette.
    for (const l of spec.layers) for (const [k, v] of Object.entries(l.series ?? {})) if (v.color && !explicit[k]) explicit[k] = v.color;
    const seriesColor = (data: LayerData, s: SeriesData): RGBA => {
      const own = data.layer.series?.[s.key]?.color;
      if (own) return parseColor(own);
      return data.layer.style?.color ? parseColor(data.layer.style.color) : categorical(s.key);
    };

    // 3. Scales: from a projection, from a standalone mark, or from the data.
    let xStep = 0;
    this.aspect = undefined;
    this.markScales = false;
    this.minViewWidth = undefined;
    this.axesShown = { x: !geo, y: !geo };
    if (geo) {
      this.aspect = this.projectionScales(spec.projection!);
      this.cat = this.xScale;
      this.val = this.yScale;
    } else if (!ref) {
      const owner = layers.find((l) => l.def.scales);
      const ms = owner?.def.scales?.({ layer: owner.data.layer, table: owner.data.table, fields, size: { width: this.width, height: this.height } });
      this.xScale = ms?.x ?? new LinearScale(0, 1);
      this.yScale = ms?.y ?? new LinearScale(0, 1);
      this.aspect = ms?.aspect;
      this.axesShown = { x: !!ms?.axes?.x, y: !!ms?.axes?.y };
      this.markGrid = { x: !!ms?.grid?.x, y: !!ms?.grid?.y };
      this.minViewWidth = ms?.minWidth;
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
      // A target line or band on the value axis must be in view, even past the data.
      const valKey = horizontal ? 'x' : 'y';
      for (const a of spec.annotations ?? []) {
        const v = a[valKey];
        if (v === undefined || (a.x !== undefined && a.y !== undefined && !Array.isArray(a.x) && !Array.isArray(a.y))) continue;
        for (const u of Array.isArray(v) ? v : [v]) {
          const n = annotationRaw(u, false, categories);
          if (!Number.isFinite(n)) continue;
          if (n < v0) v0 = n;
          if (n > v1) v1 = n;
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
        cat = catType === 'time' ? new TimeScale(c0, c1) : catType === 'log' ? new LogScale(c0, c1, fmt, !!catSpec.domain) : new LinearScale(c0, c1, fmt);
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
        val = new LogScale(valSpec.domain?.[0] ?? v0, valSpec.domain?.[1] ?? v1, valFormat, !!valSpec.domain);
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
    const annotations = !geo && ref && spec.annotations?.length ? spec.annotations : undefined;
    const bandCat = catType === 'band';
    const annotationLayer = (part: 'under' | 'over', view: { width: number; height: number }): Built => {
      // Dashes are measured in px: rebuilt with the view, like other size-dependent marks.
      const def: MarkDefinition = { standalone: true, sizeDependent: true, symbol: 'square', build: () => ({ draws: [], hit: emptyHit() }) };
      const data = standaloneLayer({ mark: 'rule', encode: {} }, -1, tableOf(refIndex));
      const mark = buildAnnotations(annotations!, {
        renderer: this.renderer,
        theme,
        x: this.xScale,
        y: this.yScale,
        categories,
        bandX: bandCat && !horizontal,
        bandY: bandCat && horizontal,
        pixel: [1 / Math.max(1, view.width), 1 / Math.max(1, view.height)],
      }, part);
      return { data, def, mark };
    };
    const buildAll = (view: { width: number; height: number }): Built[] =>
      annotations ? [annotationLayer('under', view), ...buildLayers(view), annotationLayer('over', view)] : buildLayers(view);
    const buildLayers = (view: { width: number; height: number }): Built[] =>
      layers.map(({ data, def }) => {
        const themeKey = def.themeKey ?? data.layer.mark;
        const style = deepMerge((theme.marks as Record<string, any>)[themeKey] ?? {}, data.layer.style ?? {});
        const [k0, k1] = data.colorExtent;
        const [s0, s1] = data.sizeExtent;
        const [r0, r1] = (style.sizeRange as [number, number] | undefined) ?? [4, 28];
        const enc = data.layer.encode;
        const layerValue = def.standalone ? (enc.value ?? enc.color ?? enc.y) : horizontal ? enc.x : enc.y;
        const axisFormat = def.standalone ? undefined : valAxis?.format;
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
          state: this.stateOf(data.index),
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
      });

    // Size-dependent marks (treemap, hexbin) build against the view they will get. The
    // layout only needs the scales (set above) and the legend (kept from the last build),
    // so it is usually exact here and the second build below is skipped.
    const guess =
      this.layout?.view ??
      (this.built.length === 0 && layers.some((l) => sizeDependent({ data: l.data, def: l.def } as Built))
        ? this.computeLayout().view
        : { width: Math.max(1, this.width - 80), height: Math.max(1, this.height - 120) });
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

    this.syncTimeline();
    if (this.built.some((b) => sizeDependent(b))) {
      const view = (this.layout = this.computeLayout()).view;
      if (Math.abs(view.width - guess.width) > 0.5 || Math.abs(view.height - guess.height) > 0.5) {
        this.disposeMarks();
        this.built = buildAll(view);
        // The play bar must drive the marks on screen, not the ones just discarded.
        this.syncTimeline();
      }
    }
    this.joinSync();
    this.startMorph(before);
    this.requestRender();
  }

  // -------------------------------------------------------------- transitions

  private morph?: { start: number; duration: number; batches: Batch[] };
  private morphProgress = 1;

  /** Instances with an identity, per layer and draw, as they are now. */
  private snapshot(): Map<number, ({ keys: string[]; data: Float32Array; kind: string } | null)[]> {
    const out = new Map<number, ({ keys: string[]; data: Float32Array; kind: string } | null)[]>();
    for (const b of this.built) {
      out.set(b.data.index, b.mark.draws.map((d) => (d.keys && d.data ? { keys: d.keys, data: d.data, kind: d.batch.kind } : null)));
    }
    return out;
  }

  /**
   * After a data change, every keyed instance moves from where it was (same
   * key) and new ones grow from nothing. The GPU blends the two states.
   */
  private startMorph(before: ReturnType<Chart['snapshot']>): void {
    this.endMorph();
    const anim = this.spec.animation;
    if (!before.size || anim === false || prefersReducedMotion()) return;
    const batches: Batch[] = [];
    for (const b of this.built) {
      const old = before.get(b.data.index);
      if (!old) continue;
      b.mark.draws.forEach((d, di) => {
        const o = old[di];
        if (!d.keys || !d.data || !o || o.kind !== d.batch.kind || !d.batch.setPrevious) return;
        const stride = LAYOUTS[d.batch.kind].stride;
        const at = new Map(o.keys.map((k, i) => [k, i]));
        const prev = new Float32Array(d.keys.length * stride);
        let moved = false;
        d.keys.forEach((k, i) => {
          const j = at.get(k);
          if (j !== undefined) {
            prev.set(o.data.subarray(j * stride, (j + 1) * stride), i * stride);
            for (let q = 0; q < stride; q++) if (prev[i * stride + q] !== d.data![i * stride + q]) moved = true;
            return;
          }
          // New: from nothing. A bar from its baseline, a point from size zero.
          prev.set(d.data!.subarray(i * stride, (i + 1) * stride), i * stride);
          if (d.batch.kind === 'rect') {
            const horizontal = prev[i * stride + 20] > 0.5;
            if (horizontal) prev[i * stride + 2] = prev[i * stride];
            else prev[i * stride + 3] = prev[i * stride + 1];
          } else if (d.batch.kind === 'arc') prev[i * stride + 5] = prev[i * stride + 4];
          else prev[i * stride + 2] = 0;
          moved = true;
        });
        if (!moved) return;
        d.batch.setPrevious(prev);
        batches.push(d.batch);
      });
    }
    if (batches.length) this.morph = { start: NaN, duration: typeof anim === 'number' ? anim : 650, batches };
  }

  private endMorph(): void {
    for (const b of this.morph?.batches ?? []) b.setPrevious?.(null);
    this.morph = undefined;
  }

  // --------------------------------------------------------------------- sync

  private joinSync(): void {
    const name = this.spec.interactions?.sync || (this.spec.interactions?.navigator ? 'default' : undefined);
    if (name === this.syncGroup) return;
    if (this.syncGroup) leaveGroup(this.syncGroup, this);
    this.syncGroup = name;
    if (name) joinGroup(name, this);
  }

  private navigator(): boolean {
    return !!this.spec.interactions?.navigator && !this.horizontal && !this.markScales;
  }

  /** Visible x range in data units, or null when everything shows. */
  private visibleRange(): [number, number] | null {
    if (this.navigator()) {
      const [a, b] = this.navWindow;
      return a <= 0 && b >= 1 ? null : [this.cat.invert(a), this.cat.invert(b)];
    }
    const z = this.zoom;
    if (z.kx <= 1 + 1e-6) return null;
    return [this.cat.invert(-z.tx / z.kx), this.cat.invert((1 - z.tx) / z.kx)];
  }

  private shareRange(): void {
    if (!this.syncGroup || this.horizontal) return;
    const r = this.visibleRange();
    broadcast(this.syncGroup, this, (m) => m.syncRange(r));
  }

  private shareHover(): void {
    if (!this.syncGroup) return;
    const p = this.picked[0];
    const x = p && this.tooltipMode() === 'x' ? this.built[p.layer].mark.hit.x[p.index] : null;
    broadcast(this.syncGroup, this, (m) => m.syncHover(x));
  }

  /** @internal Another chart of the group hovers at `x`. */
  syncHover(x: number | null): void {
    const L = this.layout;
    if (x === null || !L || this.navigator()) {
      this.setPicked([]);
      this.tip.style.opacity = '0';
      return;
    }
    // The closest x of this chart's own data.
    let best = NaN;
    let bestD = Infinity;
    for (const b of this.built) {
      const h = b.mark.hit;
      for (let i = 0; i < h.n; i++) {
        const d = Math.abs(h.x[i] - x);
        if (d < bestD) [best, bestD] = [h.x[i], d];
      }
    }
    if (Number.isNaN(best)) return;
    const picked: Picked[] = [];
    this.built.forEach((b, layer) => {
      const h = b.mark.hit;
      for (let i = 0; i < h.n; i++) if (h.x[i] === best) picked.push({ layer, index: i });
    });
    this.setPicked(picked);
    const T = L.transform;
    const first = picked[0] && this.built[picked[0].layer].mark.hit;
    const px = T.ox + this.cat.norm(best) * T.sx;
    if (px < L.plot.x - 1 || px > L.plot.x + L.plot.width + 1) {
      this.setPicked([]);
      this.tip.style.opacity = '0';
      return;
    }
    const py = first ? T.oy + first.ty[picked[0].index] * T.sy : L.plot.y + L.plot.height / 2;
    this.showTooltip({ x: px, y: py });
  }

  /** @internal Another chart of the group shows the x range `r` (data units). */
  syncRange(r: [number, number] | null): void {
    if (this.horizontal || !this.layout) return;
    const a = r ? this.cat.norm(r[0]) : 0;
    const b = r ? this.cat.norm(r[1]) : 1;
    if (this.navigator()) {
      this.navWindow = [Math.max(0, Math.min(a, b)), Math.min(1, Math.max(a, b))];
    } else {
      const z = this.zoom;
      z.kx = r && b - a > 1e-9 ? 1 / (b - a) : 1;
      z.tx = -a * z.kx;
      this.clampZoom();
      this.userZoomed = z.kx > 1;
      this.setPicked([]);
      this.tip.style.opacity = '0';
      this.emit('zoom', { ...z });
    }
    this.requestRender();
  }

  /** Shade what the other charts do not show, outline the window and its handles. */
  private drawNavigator(L: Layout): void {
    if (!this.navigator()) return;
    const { ctx, theme } = this;
    const { plot, transform: T } = L;
    const x0 = T.ox + this.navWindow[0] * T.sx;
    const x1 = T.ox + this.navWindow[1] * T.sx;
    ctx.save();
    ctx.fillStyle = theme.background === 'transparent' ? 'rgba(255,255,255,0.6)' : toCss(withAlphaRGBA(parseColor(theme.background), 0.62));
    ctx.fillRect(plot.x, plot.y, Math.max(0, x0 - plot.x), plot.height);
    ctx.fillRect(x1, plot.y, Math.max(0, plot.x + plot.width - x1), plot.height);
    ctx.strokeStyle = theme.text.muted;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x0) + 0.5, plot.y + 0.5, Math.round(x1 - x0), plot.height - 1);
    // Handles: small rounded grips on both edges.
    for (const x of [x0, x1]) {
      ctx.fillStyle = theme.background === 'transparent' ? '#fff' : theme.background;
      ctx.strokeStyle = theme.text.muted;
      ctx.beginPath();
      ctx.roundRect(x - 4, plot.y + plot.height / 2 - 11, 8, 22, 3);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 1, plot.y + plot.height / 2 - 5);
      ctx.lineTo(x - 1, plot.y + plot.height / 2 + 5);
      ctx.moveTo(x + 1, plot.y + plot.height / 2 - 5);
      ctx.lineTo(x + 1, plot.y + plot.height / 2 + 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  private navAt(p: { x: number; y: number }): 'move' | 'w' | 'e' | 'new' | null {
    const L = this.layout;
    if (!L || !this.navigator() || !this.inPlot(p)) return null;
    const T = L.transform;
    const x0 = T.ox + this.navWindow[0] * T.sx;
    const x1 = T.ox + this.navWindow[1] * T.sx;
    if (Math.abs(p.x - x0) <= 7) return 'w';
    if (Math.abs(p.x - x1) <= 7) return 'e';
    // While everything shows, a drag draws a new window instead of moving the whole one.
    const full = this.navWindow[0] <= 0 && this.navWindow[1] >= 1;
    if (p.x > x0 && p.x < x1 && !full) return 'move';
    return 'new';
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

  private stateOf(layer: number): Record<string, unknown> {
    let s = this.layerState.get(layer);
    if (!s) this.layerState.set(layer, (s = {}));
    return s;
  }

  /** Create, update or remove the play bar, depending on whether a mark plays through time. */
  private syncTimeline(): void {
    this.timeline = this.built.map((b) => b.mark.timeline).find((t): t is Timeline => !!t);
    if (this.spec.interactions?.player === false) this.timeline = undefined;
    if (!this.timeline) {
      this.controls?.root.remove();
      this.controls = undefined;
      return;
    }
    if (!this.controls) {
      const root = document.createElement('div');
      root.style.cssText = 'position:absolute;left:12px;right:12px;bottom:10px;height:30px;display:flex;align-items:center;gap:10px;z-index:1;';
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = 'width:30px;height:30px;border-radius:50%;border:0;cursor:pointer;display:grid;place-items:center;font-size:12px;padding:0;';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.step = 'any';
      range.style.cssText = 'flex:1;min-width:0;';
      range.setAttribute('aria-label', 'Position dans le temps');
      const label = document.createElement('span');
      label.style.cssText = 'min-width:72px;text-align:right;font-variant-numeric:tabular-nums;';
      root.append(button, range, label);
      // The controls are not part of the plot: keep their pointer events away from zoom, lasso and drags.
      for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick']) root.addEventListener(type, (e) => e.stopPropagation());
      button.addEventListener('click', () => {
        if (this.timeline?.playing) this.timeline.pause();
        else this.timeline?.play();
        this.requestRender();
      });
      range.addEventListener('input', () => this.seek(Number(range.value)));
      this.root.appendChild(root);
      this.controls = { root, button, range, label };
    }
    const { button, range, label } = this.controls;
    const t = this.theme;
    button.style.background = t.palette.categorical[0];
    button.style.color = '#fff';
    range.style.accentColor = t.palette.categorical[0];
    label.style.color = t.text.secondary;
    label.style.font = `600 12px ${t.font.family}`;
    range.max = String(Math.max(0, this.timeline.frames.length - 1));
    this.shownFrame = -1;
  }

  private updateControls(): void {
    const tl = this.timeline;
    const c = this.controls;
    if (!tl || !c) return;
    const t = tl.get();
    if (document.activeElement !== c.range) c.range.value = String(t);
    c.button.textContent = tl.playing ? '❚❚' : '▶';
    c.button.setAttribute('aria-label', tl.playing ? 'Pause' : 'Lecture');
    const index = Math.min(tl.frames.length - 1, Math.round(t));
    if (index !== this.shownFrame) {
      this.shownFrame = index;
      c.label.textContent = tl.frames[index] ?? '';
      this.emit('frame', { index, label: tl.frames[index] ?? '' });
    }
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
    return (this.spec.legend ?? this.theme.legend.visible) && this.legend.length >= 2 && this.compact < 3;
  }

  /**
   * Small screens: when the drawing would be cramped, the chart gives up, in
   * order, its subtitle, its axis titles, then its legend (`autoCompact: false` in
   * the spec keeps everything). Each level is tried until the drawing is readable.
   */
  private compact = 0;

  private computeLayout(): Layout {
    const auto = this.spec.autoCompact !== false;
    let L!: Layout;
    for (let level = 0; level <= (auto ? 3 : 0); level++) {
      this.compact = level;
      L = this.layoutAt();
      if (L.plot.width >= 120 && L.plot.height >= 90) break;
    }
    return L;
  }

  private layoutAt(): Layout {
    const { theme, ctx, spec, zoom } = this;
    const pad = theme.padding;
    const ff = theme.font.family;
    let top = pad;
    const titleY = top;
    if (spec.title) top += theme.title.size * 1.3;
    if (spec.subtitle && this.compact < 1) top += theme.subtitle.size * 1.5;
    if (spec.title || (spec.subtitle && this.compact < 1)) top += theme.title.gap;

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
      // The top graduation of the value axis is centered on the plot's edge: room for its upper half.
      top = y + rowH + 8 + (this.axis('y') ? Math.ceil(theme.axis.label.size / 2) : 0);
    }

    const xAxis = this.axis('x');
    const yAxis = this.axis('y');
    const lab = theme.axis.label;
    const ttl = theme.axis.title;
    let bottom = pad;
    if (this.timeline) bottom += 40;
    if (xAxis && xAxis.labels !== false) bottom += lab.size + lab.padding;
    if (xAxis?.title && this.compact < 2) bottom += ttl.size + ttl.padding;
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
      // Long category names (a Gantt's tasks) never take more than a third of the width: they are cut with "…".
      left += Math.ceil(this.yScale.type === 'band' ? Math.min(w, this.width * 0.32) : w) + lab.padding;
    }
    if (yAxis?.title && this.compact < 2) left += ttl.size + ttl.padding;
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
    if (!this.visible) {
      // Drawn when it scrolls into view (and its entry animation starts then).
      this.dirty = true;
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.destroyed || !this.gridBatch) return;
    const { theme } = this;
    let L = (this.layout = this.computeLayout());
    // A diagram too big to read once fitted opens at its readable size, anchored top-left.
    if (this.minViewWidth && !this.userZoomed) {
      const k = Math.max(1, this.minViewWidth / L.view.width);
      if (Math.abs(k - this.zoom.kx) > 1e-3) {
        this.zoom = { kx: k, ky: k, tx: 0, ty: 1 - k };
        L = this.layout = this.computeLayout();
      }
    }
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
    const gridY = this.markScales ? this.markGrid.y : this.horizontal ? theme.grid.x.visible : theme.grid.y.visible;
    const gridX = this.markScales ? this.markGrid.x : this.horizontal ? theme.grid.y.visible : theme.grid.x.visible;
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
    // Marks that animate themselves (drill-down) advance before drawing.
    const now = performance.now();
    let animating = false;
    // Entry animation: starts with the first frame actually drawn.
    if (this.enter.pending) {
      this.enter.pending = false;
      this.enter.start = now;
    }
    const enterT = this.enter.duration > 0 ? Math.min(1, (now - this.enter.start) / this.enter.duration) : 1;
    if (enterT < 1) animating = true;
    this.enterProgress = enterT;
    // Lines and fills are revealed left to right through their clip.
    const reveal = enterT < 1 ? 1 - Math.pow(1 - enterT, 3) : 1;
    // Transition between two data states: starts with its first frame.
    let morphT = 1;
    if (this.morph) {
      if (Number.isNaN(this.morph.start)) this.morph.start = now;
      morphT = Math.min(1, (now - this.morph.start) / this.morph.duration);
      if (morphT < 1) animating = true;
    }
    const morphing = morphT < 1 ? new Set(this.morph!.batches) : undefined;
    this.morphProgress = morphT;
    for (const b of this.built) if (b.mark.animate?.(now)) animating = true;

    // With a selection, selectable marks are dimmed and the selected ones redrawn on top.
    const selecting = this.built.some((b) => b.sel);
    for (const b of this.built) {
      for (const d of b.mark.draws) {
        const opacity = selecting && d.perDatum ? theme.selection.dimOpacity : 1;
        const kind = d.batch.kind;
        if (d.enter) {
          // Fade (diagrams) or appear at once.
          const o = d.enter === 'fade' ? opacity * reveal : opacity;
          calls.push({ batch: d.batch, transform: T, clip, pixelSnap: d.pixelSnap, opacity: o, progress: 1 });
          continue;
        }
        const grows = kind === 'rect' || kind === 'arc' || kind === 'point';
        const c = !grows && reveal < 1 ? { ...clip, width: clip.width * reveal } : clip;
        calls.push({ batch: d.batch, transform: T, clip: c, pixelSnap: d.pixelSnap, opacity, progress: grows ? enterT : 1, morph: morphing?.has(d.batch) ? morphT : 1 });
      }
      for (const d of b.sel?.draws ?? []) calls.push({ batch: d.batch, transform: T, clip, pixelSnap: d.pixelSnap });
    }
    this.renderer.render({ clearColor: parseColor(theme.background), calls });
    if (this.morph && morphT >= 1) this.endMorph();
    this.drawOverlay(L);
    this.drawNavigator(L);
    this.updateControls();
    if (animating) this.requestRender();
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
    if (spec.subtitle && this.compact < 1) {
      ctx.font = font(theme.subtitle.weight, theme.subtitle.size, ff);
      ctx.fillStyle = theme.subtitle.color;
      ctx.fillText(spec.subtitle, pad, ty + theme.subtitle.size * 0.2);
    }

    // Legend.
    if (this.showLegend()) {
      const l = theme.legend;
      ctx.font = font(l.label.weight, l.label.size, ff);
      ctx.textBaseline = 'middle';
      const muted = new Set(this.built.flatMap((b) => b.mark.muted?.() ?? []));
      for (const e of this.legend) {
        const r = e.rect!;
        const cy = r.y + r.height / 2;
        ctx.globalAlpha = this.hidden.has(e.key) || muted.has(e.key) ? l.hiddenOpacity : 1;
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
      if (xAxis.title && this.compact < 2) {
        ctx.font = font(ttl.weight, ttl.size, ff);
        ctx.fillStyle = ttl.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        // Above the play bar when there is one.
        ctx.fillText(xAxis.title, plot.x + plot.width / 2, this.height - pad - (this.timeline ? 40 : 0));
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
        // In a short plot (a small multiple), skip labels that would touch the previous one.
        let lastY = Infinity;
        for (const t of L.yTicks) {
          const y = T.oy + t.t * T.sy;
          if (y < plot.y - 1 || y > bottom + 1) continue;
          if (Math.abs(lastY - y) < lab.size + 3) continue;
          ctx.fillText(this.yScale.type === 'band' ? ellipsize(ctx, t.label, this.width * 0.32) : t.label, plot.x - lab.padding, y + 0.5);
          lastY = y;
        }
      }
      if (yAxis.title && this.compact < 2) {
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
    // Labels fade in at the end of the entry animation, and come back after a transition
    // (they are placed for the new state: drawn while bars move, they would point at nothing).
    if (this.enterProgress < 0.75 || this.morphProgress < 1) return;
    this.placed = [];
    ctx.save();
    ctx.globalAlpha = Math.min(1, (this.enterProgress - 0.75) / 0.25);
    const avoid: { l: MarkLabel; ax: number; ay: number; y: number }[] = [];
    for (const b of this.built) {
      const style = this.labelStyler(b.data.layer);
      for (const l0 of b.mark.labels ?? []) {
        const l = style(l0);
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

  /** Theme labels, then the layer's `labels`, then the series' `labelColor`, applied to a mark's label. */
  private labelStyler(layer: LayerSpec): (l: MarkLabel) => MarkLabel {
    const t = this.theme.labels ?? {};
    const own = layer.labels ?? {};
    const color = own.color ?? (t.color ? themeColor(this.theme, t.color) : undefined);
    const scale = own.scale ?? t.scale ?? 1;
    const weight = own.weight ?? t.weight;
    const background = own.background ?? (t.background ? themeColor(this.theme, t.background) : undefined);
    const series = layer.series;
    if (!color && scale === 1 && weight === undefined && !background && !series) return (l) => l;
    return (l) => {
      const ink = (l.series && series?.[l.series]?.labelColor) || color;
      const out: MarkLabel = { ...l };
      if (ink) {
        out.color = ink;
        out.on = undefined;
      }
      if (scale !== 1) out.size = (l.size ?? 11) * scale;
      if (weight !== undefined) out.weight = weight;
      if (background) out.background = background;
      return out;
    };
  }

  /** Boxes of the labels drawn this frame: a label overlapping one of them is left out. */
  private placed: { x0: number; y0: number; x1: number; y1: number }[] = [];

  private drawLabel(l: MarkLabel, L: Layout): void {
    const { ctx, theme } = this;
    const { plot, transform: T } = L;
    const ax = T.ox + l.tx * T.sx;
    const ay = T.oy + l.ty * T.sy;
    // Anchored outside the visible plot (zoomed away): skip.
    if (ax < plot.x - 1 || ax > plot.x + plot.width + 1 || ay < plot.y - 1 || ay > plot.y + plot.height + 1) return;
    // Diagram labels scale with the view (and the zoom).
    const k = l.fontScale ? Math.abs(T.sx) * l.fontScale : 1;
    const x = ax + (l.dx ?? 0) * k;
    const y = ay + (l.dy ?? 0) * k;
    const size = (l.size ?? 11) * k;
    if (size < 5) return;
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
    // Kept inside the chart: a label running a little off an edge slides back in; one far off
    // (it would land on the drawing it labels) is left out.
    let x1 = x;
    {
      const left = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
      const over = !l.box ? Math.max(0, 2 - left, left + w - (this.width - 2)) : 0;
      if (over > w / 3 && !l.free) return;
      if (!l.box && left < 2) x1 += 2 - left;
      else if (!l.box && left + w > this.width - 2) x1 -= left + w - (this.width - 2);
    }
    // Never on top of another label: the first placed wins (marks list the important ones first),
    // the others are left out, their value is still in the tooltip. Background text (`free`) is exempt.
    if (!l.free) {
      const left = align === 'center' ? x1 - w / 2 : align === 'right' || align === 'end' ? x1 - w : x1;
      const top = baseline === 'middle' ? y - size / 2 : baseline === 'top' || baseline === 'hanging' ? y : y - size;
      const pad = l.background ? 5 * k : 1.5;
      const r = { x0: left - pad, y0: top - (l.background ? 2.5 * k : 1), x1: left + w + pad, y1: top + size + (l.background ? 2.5 * k : 1) };
      if (this.placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) return;
      this.placed.push(r);
    }
    if (l.background) {
      const left = align === 'center' ? x1 - w / 2 : align === 'right' || align === 'end' ? x1 - w : x1;
      const top = baseline === 'middle' ? y - size / 2 : baseline === 'top' || baseline === 'hanging' ? y : y - size;
      const px = 5 * k;
      const py = 2.5 * k;
      ctx.fillStyle = l.background;
      ctx.beginPath();
      ctx.roundRect(left - px, top - py, w + 2 * px, size + 2 * py, (size + 2 * py) / 2);
      ctx.fill();
    }
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    let ink = theme.text.secondary;
    if (l.on) {
      // A faded fill (highlight, focus) shows the surface through: judge the color actually seen.
      const bg = parseColor(theme.background === 'transparent' ? '#ffffff' : theme.background);
      const a = l.on[3];
      const seen: RGBA = [l.on[0] * a + bg[0] * (1 - a), l.on[1] * a + bg[1] * (1 - a), l.on[2] * a + bg[2] * (1 - a), 1];
      ink = luminance(seen) > 0.4 ? '#0b0b0b' : '#ffffff';
    }
    ctx.fillStyle = l.color ?? ink;
    ctx.fillText(l.text, x1, y);
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
    // A diagram opened zoomed in can at least be panned.
    if (!z) return this.minViewWidth ? { axes: 'xy', max: Math.max(1, this.zoom.kx) } : null;
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
    if (this.navigator()) {
      const L = this.layout;
      if (this.navDrag && L) {
        const n = Math.max(0, Math.min(1, (p.x - L.transform.ox) / L.transform.sx));
        const d = this.navDrag;
        const [a, b] = d.start;
        if (d.mode === 'move') {
          const shift = Math.max(-a, Math.min(1 - b, n - d.x));
          this.navWindow = [a + shift, b + shift];
        } else if (d.mode === 'w') {
          this.navWindow = n < b ? [n, b] : [b, n];
        } else {
          this.navWindow = n > a ? [a, n] : [n, a];
        }
        this.shareRange();
        this.requestRender();
        return;
      }
      const at = this.navAt(p);
      this.root.style.cursor = at === 'w' || at === 'e' ? 'ew-resize' : at === 'move' ? 'grab' : at === 'new' ? 'crosshair' : 'default';
      return;
    }
    if (this.markDrag) {
      const L = this.layout!;
      this.markDrag.moved += Math.abs(p.x - this.markDrag.x) + Math.abs(p.y - this.markDrag.y);
      this.markDrag.x = p.x;
      this.markDrag.y = p.y;
      this.built[this.markDrag.layer].mark.drag?.move((p.x - L.transform.ox) / L.transform.sx, (p.y - L.transform.oy) / L.transform.sy);
      this.requestRender();
      return;
    }
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
      this.shareRange();
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
    if (this.shape && this.built.some((b) => b.mark.drag)) this.root.style.cursor = 'grab';
    else if (this.shape && this.built.some((b) => b.mark.click)) this.root.style.cursor = 'pointer';
    if (this.layout && this.built.some((b) => b.mark.link)) {
      const T = this.layout.transform;
      if (this.built.some((b) => b.mark.link?.((p.x - T.ox) / T.sx, (p.y - T.oy) / T.sy))) this.root.style.cursor = 'pointer';
    }
    this.setPicked(picked);
    this.showTooltip(p);
    this.shareHover();
    if (picked.length) this.emit('hover', { items: this.describe(picked), x: p.x, y: p.y });
  }

  private onLeave(): void {
    this.pointer = undefined;
    this.shape = undefined;
    this.setPicked([]);
    this.tip.style.opacity = '0';
    if (this.syncGroup) broadcast(this.syncGroup, this, (m) => m.syncHover(null));
    this.emit('leave', {});
  }

  private onDown(e: PointerEvent): void {
    const p = this.local(e);
    // Touch has no hover: a tap shows what a mouse would show by passing over.
    if (e.pointerType === 'touch' && !this.navigator()) this.onMove(e);
    const nav = e.button === 0 ? this.navAt(p) : null;
    if (nav) {
      const L = this.layout!;
      const n = (p.x - L.transform.ox) / L.transform.sx;
      // A press outside the window starts a new one there.
      if (nav === 'new') this.navWindow = [n, n];
      this.navDrag = { mode: nav === 'new' ? 'e' : nav, x: n, start: [...this.navWindow] as [number, number] };
      this.root.setPointerCapture(e.pointerId);
      this.tip.style.opacity = '0';
      return;
    }
    // Marks that can be moved by hand (diagram boxes) take the press first.
    const L0 = this.layout;
    if (L0 && e.button === 0 && this.inPlot(p)) {
      const tx = (p.x - L0.transform.ox) / L0.transform.sx;
      const ty = (p.y - L0.transform.oy) / L0.transform.sy;
      for (let i = this.built.length - 1; i >= 0; i--) {
        if (!this.built[i].mark.drag?.start(tx, ty)) continue;
        this.markDrag = { layer: i, moved: 0, x: p.x, y: p.y };
        this.root.setPointerCapture(e.pointerId);
        this.root.style.cursor = 'grabbing';
        this.tip.style.opacity = '0';
        return;
      }
    }
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
      this.userZoomed = true;
      this.drag = { x: p.x, y: p.y, moved: 0 };
      this.root.setPointerCapture(e.pointerId);
      this.root.style.cursor = 'grabbing';
      this.tip.style.opacity = '0';
    }
  }

  private onUp(e: PointerEvent): void {
    const p = this.local(e);
    if (this.navDrag) {
      this.navDrag = undefined;
      this.root.releasePointerCapture(e.pointerId);
      // A click without dragging shows everything again.
      const [a, b] = this.navWindow;
      if (b - a < 0.005) this.navWindow = [0, 1];
      this.shareRange();
      this.requestRender();
      return;
    }
    if (this.markDrag) {
      const { layer, moved } = this.markDrag;
      this.markDrag = undefined;
      this.root.releasePointerCapture(e.pointerId);
      this.root.style.cursor = 'grab';
      const positions = this.built[layer].mark.drag!.end();
      // A real move reports the new layout; a press without moving is a click.
      if (moved > 3) {
        this.emit('layout', { layer, positions });
        return;
      }
    }
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
    // Drill-down marks handle their own clicks, topmost layer first.
    const L = this.layout;
    if (L && this.inPlot(p)) {
      const tx = (p.x - L.transform.ox) / L.transform.sx;
      const ty = (p.y - L.transform.oy) / L.transform.sy;
      // A datum with a link: tell the app, then open it (unless the spec leaves that to the app).
      for (let i = this.built.length - 1; i >= 0; i--) {
        const hit = this.built[i].mark.link?.(tx, ty);
        if (!hit) continue;
        // The layer's `link`, or the defaults when the link comes from a field's `link` role.
        const spec = this.built[i].data.layer.link ?? { field: '', target: '_blank' as const };
        this.emit('link', { url: hit.url, row: this.built[i].data.table.row(hit.row), layer: i });
        if (spec.open !== false && /^(https?:|mailto:|\/|#)/i.test(hit.url)) window.open(hit.url, spec.target ?? '_blank', 'noopener');
        return;
      }
      for (let i = this.built.length - 1; i >= 0; i--) {
        const path = this.built[i].mark.click?.(tx, ty);
        if (path === undefined) continue;
        this.shape = undefined;
        this.tip.style.opacity = '0';
        this.emit('drill', { layer: i, path });
        this.requestRender();
        return;
      }
    }
    const picked = this.pick(p);
    if (picked.length) this.emit('click', { items: this.describe(picked), x: p.x, y: p.y });
  }

  private onWheel(e: WheelEvent): void {
    const cfg = this.zoomConfig();
    const p = this.local(e);
    // Without zoom in the spec, the wheel scrolls the page.
    if (!cfg || !this.inPlot(p) || !this.spec.interactions?.zoom) return;
    e.preventDefault();
    this.userZoomed = true;
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
    this.shareRange();
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
    this.fitY();
    this.notifyView();
  }

  /** Marks that lay out for the visible range (a timeline's cards) do it again. */
  private notifyView(): void {
    const z = this.zoom;
    const x0 = -z.tx / z.kx;
    const x1 = (1 - z.tx) / z.kx;
    for (const b of this.built) b.mark.view?.(x0, x1);
  }

  /**
   * Zoomed along x only, the value axis follows what is visible (as a stock chart
   * does): it is only the view transform that changes, never the batches.
   * Off with `interactions.zoom.fitY: false`.
   */
  private fitY(): void {
    const z = this.zoom;
    const cfg = this.spec.interactions?.zoom;
    const axes = typeof cfg === 'object' ? (cfg.axes ?? 'x') : 'x';
    const want = typeof cfg === 'object' ? cfg.fitY !== false : true;
    if (!want || axes !== 'x' || this.horizontal || this.markScales || this.geo) return;
    if (z.kx <= 1 + 1e-6) {
      z.ky = 1;
      z.ty = 0;
      return;
    }
    const v0 = -z.tx / z.kx;
    const v1 = (1 - z.tx) / z.kx;
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of this.built) {
      if (b.def.standalone) continue;
      // Bars, areas, stacks and ranges span from y0; lines and points are just y1.
      const spans = b.data.stacked || b.data.ranged || !!b.def.baseline;
      for (const s of b.data.series) {
        if (s.hidden) continue;
        for (let i = 0; i < s.x.length; i++) {
          const x = this.cat.norm(s.x[i]);
          if (x < v0 || x > v1) continue;
          const y1 = this.val.norm(s.y1[i]);
          const y0 = spans ? this.val.norm(s.y0[i]) : y1;
          lo = Math.min(lo, y0, y1);
          hi = Math.max(hi, y0, y1);
        }
      }
    }
    if (!(hi > lo)) return;
    const pad = (hi - lo) * 0.08;
    lo = Math.max(0, lo - pad);
    hi = Math.min(1, hi + pad);
    z.ky = 1 / (hi - lo);
    z.ty = -lo * z.ky;
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
