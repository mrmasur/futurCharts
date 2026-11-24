import { Table, type DataInput } from '../data/table';
import { applyTransforms } from '../data/transforms';
import { prefersReducedMotion } from '../marks/animate';
import { ensureBuiltinMarks } from '../marks/builtin';
import { prepareLayer, standaloneLayer } from '../marks/prepare';
import { getMark, type LegendRamp, type ShapeHit, type Timeline } from '../marks/registry';
import { createRenderer } from '../render';
import { LAYOUTS } from '../render/layouts';
import type { Batch, ClipRect, DrawCall, Renderer } from '../render/types';
import { LinearScale, type Scale } from '../scale/scales';
import type { AxisSpec, ChartSpec } from '../spec/types';
import { resolveTheme, type Theme } from '../theme/theme';
import { parseColor } from '../util/color';
import { deepMerge } from '../util/merge';
import { drawAxes, gridLines } from './axes';
import { buildAnnotationLayer, buildLayer } from './build';
import { cartesianPlan, cartesianScales, categoryOrder, projectionScales } from './cartesian';
import { chartColors, resolveSpecColors } from './colors';
import { markCalls, marksClip } from './frame';
import { createPlayBar, stylePlayBar, updatePlayBar, type PlayBar } from './controls';
import { describeItems, drawHover, inPlot, pickAt, pickAtX, shapeAt, tooltipMode } from './hover';
import { drawMarkLabels } from './labels';
import { computeLayout, drawTitles } from './layout';
import { drawLegend, legendEntries, legendRampOf } from './legend';
import { snapshot, startTransition, type Snapshot } from './morph';
import { dragWindow, drawNavigator, navHandleAt, type NavDrag, type NavWindow } from './navigator';
import { applyResponsive, sameMarks } from './responsive';
import { drawLasso, lassoPolygon, selectionMasks, selectionPayload, setLayerSelection, type Lasso } from './selection';
import { broadcast, groupMargins, joinGroup, leaveGroup, reportMargins, type SyncMargins, type SyncMember } from './sync';
import { fillTooltip, tooltipPosition } from './tooltip';
import { sizeDependent, type Built, type ChartEvents, type ChartOptions, type HoverItem, type Layout, type LegendEntry, type Picked, type Point, type SelectionPayload, type TooltipContext, type Zoom } from './types';
import { clampPan, fitY, panBy, visibleX, zoomAt, zoomConfig, type ZoomConfig } from './zoom';

export type { ChartEvents, ChartOptions, HoverItem, SelectionPayload, TooltipContext } from './types';

/**
 * One chart: it keeps the state (spec, scales, built layers, zoom, hover, selection) and
 * orchestrates: `compile` turns the spec into batches, `renderNow` lays out and draws a frame,
 * the pointer handlers drive the interactions. The work itself is in the modules of this
 * folder (layout, axes, legend, labels, hover, zoom, selection…), see docs/ARCHITECTURE.md § 1.
 */
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
  /** Ramp of a continuous color, drawn on the legend row (after the entries when there are some). */
  private legendRamp?: LegendRamp;
  private rampRect?: ClipRect;
  /** Room this chart needs beside its plot, before aligning with its sync group. */
  private ownMargins?: SyncMargins;
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
  /**
   * Dual axis: the scale of the layers bound to the secondary value axis (`secondary` holds their
   * indexes). Both value scales write the same normalized space, so one view transform serves both.
   */
  private val2?: Scale;
  private secondary = new Set<number>();
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
  private navWindow: NavWindow = [0, 1];
  private navDrag?: NavDrag;
  /** Width / height the view must keep (maps). */
  private aspect?: number;
  private lasso?: Lasso;
  private shape?: ShapeHit;
  /** Per-layer state kept across rebuilds (drill-down focus…). */
  private layerState = new Map<number, Record<string, unknown>>();
  /** Entry animation: pending until the first frame, then its start time. */
  private enter: { pending: boolean; start: number; duration: number } = { pending: false, start: 0, duration: 0 };
  private frame = 0;
  /** Play button and scrubber of a time-driven mark. */
  private timeline?: Timeline;
  private controls?: PlayBar;
  private shownFrame = -1;
  /** On screen (or close to it). Off screen, frames are skipped and drawn on return. */
  private visible = typeof IntersectionObserver === 'undefined';
  private dirty = false;
  private intersection?: IntersectionObserver;
  private enterProgress = 1;
  private destroyed = false;
  /** Unsubscribes from the renderer's device restore. */
  private stopRestore?: () => void;

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
    this.stopRestore = this.renderer.onRestored?.(() => this.restore());

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
    if (!sameMarks(spec, this.spec)) this.layerState.clear();
    this.spec = spec;
    this.theme = resolveTheme(spec.theme);
    this.zoom = { kx: 1, ky: 1, tx: 0, ty: 0 };
    this.userZoomed = false;
    this.compile();
  }

  /**
   * The GPU device came back after a loss: every batch died with it. Make them again from the same spec,
   * zoom and focus kept, without a transition (nothing changed for the reader).
   */
  private restore(): void {
    if (this.destroyed) return;
    this.gridBatch = this.renderer.createBatch('line');
    this.compile();
    this.morph = undefined;
    this.requestRender();
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
    const { spec, key } = applyResponsive(this.base!, this.width, this.height);
    this.ruleKey = key;
    return spec;
  }

  /** On resize: re-apply the rules; true when the spec changed. */
  private reapplyResponsive(): boolean {
    if (!this.base?.responsive?.length) return false;
    const before = this.ruleKey;
    const spec = this.effectiveSpec();
    if (this.ruleKey === before) return false;
    if (!sameMarks(spec, this.spec)) this.layerState.clear();
    this.spec = spec;
    this.theme = resolveTheme(spec.theme);
    return true;
  }

  /** Domains of the continuous axes as drawn (small multiples share them). */
  getDomains(): { x?: [number, number]; y?: [number, number]; secondary?: [number, number] } {
    const d = (s: Scale): [number, number] | undefined => {
      const l = s as Partial<{ d0: number; d1: number }>;
      return s.type !== 'band' && typeof l.d0 === 'number' && typeof l.d1 === 'number' ? [Math.min(l.d0, l.d1), Math.max(l.d0, l.d1)] : undefined;
    };
    return this.markScales || this.geo ? {} : { x: d(this.xScale), y: d(this.yScale), secondary: this.val2 && d(this.val2) };
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
    return selectionPayload(this.built, (picked) => this.describe(picked));
  }

  clearSelection(): void {
    if (!this.built.some((b) => b.sel)) return;
    for (const b of this.built) setLayerSelection(b, null, this.renderer);
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
    if (this.syncGroup) {
      this.withdrawMargins(this.syncGroup);
      leaveGroup(this.syncGroup, this);
    }
    this.destroyed = true;
    this.stopRestore?.();
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
    const before = snapshot(this.built);
    this.disposeMarks();
    this.picked = [];
    this.shape = undefined;
    const { theme } = this;
    // Theme color tokens ($ink, $grid, $1…) resolve against the current theme.
    const spec = resolveSpecColors(this.spec, theme);
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
      this.val2 = undefined;
      this.legend = [];
      this.legendRamp = undefined;
      this.requestRender();
      return;
    }

    const geo = (this.geo = !!spec.projection);
    // The first layer with x / y encodings decides orientation, scales and default formats.
    const plan = cartesianPlan(spec, defs, tableOf, geo);
    const { refIndex, ref, horizontal, dual, onSecondary, catSpec, valAxis, val2Axis, catType, dateBand } = plan;
    this.horizontal = horizontal;
    this.secondary = new Set(spec.layers.map((_, i) => i).filter(onSecondary));
    this.val2 = undefined;

    // 1. Prepare each layer: grouping into series, stacking, ranges.
    const categories = categoryOrder(spec, defs, tableOf, horizontal, catSpec, dateBand);
    const prep = { band: catType === 'band', dates: dateBand, horizontal, categories, fields, hidden: this.hidden };
    const layers = spec.layers.map((layer, i) => ({
      data: defs[i].standalone ? standaloneLayer(layer, i, tableOf(i)) : prepareLayer(layer, i, tableOf(i), prep),
      def: defs[i],
    }));

    // 2. Color slots: fixed by entity, never by rank, so filters don't repaint survivors.
    const { known, categorical, seriesColor, ramp } = chartColors(spec, theme, layers);

    // 3. Scales: from a projection, from a standalone mark, or from the data.
    let xStep = 0;
    this.aspect = undefined;
    this.markScales = false;
    this.minViewWidth = undefined;
    this.axesShown = { x: !geo, y: !geo };
    if (geo) {
      const map = projectionScales(spec.projection!);
      this.xScale = map.x;
      this.yScale = map.y;
      this.aspect = map.aspect;
      this.cat = this.xScale;
      this.val = this.yScale;
    } else if (!ref) {
      const owner = layers.find((l) => l.def.scales);
      const ms = owner?.def.scales?.({
        layer: owner.data.layer,
        table: owner.data.table,
        fields,
        size: { width: this.width, height: this.height },
        // What `build` will get as `ctx.style`: an option set in the theme counts here too.
        style: deepMerge((theme.marks as Record<string, any>)[owner.def.themeKey ?? owner.data.layer.mark] ?? {}, owner.data.layer.style ?? {}),
        scales: spec.scales,
        theme,
      });
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
      const scales = cartesianScales({ ...plan, spec, theme, layers, tableOf, categories });
      const { cat, val } = scales;
      xStep = scales.xStep;
      if (dual) this.val2 = scales.val2;
      this.cat = cat;
      this.val = val;
      this.xScale = horizontal ? val : cat;
      this.yScale = horizontal ? cat : val;
    }

    // 4. Build GPU batches. Size-dependent marks (treemap) need the real view
    //    size, known only once the legend is in: build, lay out, rebuild if needed.
    const annotations = !geo && ref && spec.annotations?.length ? spec.annotations : undefined;
    const annotationLayer = (part: 'under' | 'over', view: { width: number; height: number }): Built =>
      buildAnnotationLayer(annotations!, part, view, {
        renderer: this.renderer,
        theme,
        x: this.xScale,
        y: this.yScale,
        val2: this.val2,
        horizontal,
        categories,
        bandCat: catType === 'band',
        dateBand,
        table: () => tableOf(refIndex),
      });
    const buildAll = (view: { width: number; height: number }): Built[] =>
      annotations ? [annotationLayer('under', view), ...buildLayers(view), annotationLayer('over', view)] : buildLayers(view);
    const buildLayers = (view: { width: number; height: number }): Built[] =>
      layers.map((layer) =>
        buildLayer(layer, {
          renderer: this.renderer,
          theme,
          fields,
          horizontal,
          cat: this.cat,
          val: this.val,
          val2: this.val2,
          secondary: this.secondary,
          valAxis,
          val2Axis,
          xStep,
          hidden: this.hidden,
          state: (i) => this.stateOf(i),
          colors: { categorical, seriesColor, ramp },
          view,
        }),
      );

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
    this.legend = legendEntries(this.built, known, seriesColor);
    this.legendRamp = legendRampOf(this.built, spec, ramp);

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

  /**
   * After a data change, every keyed instance moves from where it was (same
   * key) and new ones grow from nothing. The GPU blends the two states.
   */
  private startMorph(before: Snapshot): void {
    this.endMorph();
    const anim = this.spec.animation;
    if (!before.size || anim === false || prefersReducedMotion()) return;
    const batches = startTransition(before, this.built);
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
    if (this.syncGroup) {
      this.withdrawMargins(this.syncGroup);
      leaveGroup(this.syncGroup, this);
    }
    this.syncGroup = name;
    if (name) joinGroup(name, this);
  }

  /** Plots of a sync group share their left and right edges: only cartesian charts take part. */
  private alignsWithGroup(): boolean {
    return !!this.syncGroup && !this.geo && !this.markScales && !this.aspect;
  }

  /** Tell the group the room this chart needs beside its plot; the others lay out again when it changed. */
  private shareMargins(): void {
    const g = this.syncGroup;
    if (!g) return;
    const own = this.alignsWithGroup() ? (this.ownMargins ?? null) : null;
    if (reportMargins(g, this, own)) broadcast(g, this, (m) => m.syncLayout?.());
  }

  private withdrawMargins(group: string): void {
    if (reportMargins(group, this, null)) broadcast(group, this, (m) => m.syncLayout?.());
  }

  /** @internal Another chart of the group changed the room it needs beside its plot. */
  syncLayout(): void {
    if (this.destroyed) return;
    if (this.built.some((b) => sizeDependent(b))) {
      // Size-dependent marks were built for the old plot width.
      this.layout = undefined;
      this.compile();
      return;
    }
    this.requestRender();
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
    const [x0, x1] = visibleX(z);
    return [this.cat.invert(x0), this.cat.invert(x1)];
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
    const picked = pickAtX(this.built, x);
    if (!picked) return;
    this.setPicked(picked);
    const T = L.transform;
    const first = picked[0] && this.built[picked[0].layer].mark.hit;
    const px = T.ox + this.cat.norm(first ? first.x[picked[0].index] : x) * T.sx;
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

  private navAt(p: { x: number; y: number }): 'move' | 'w' | 'e' | 'new' | null {
    const L = this.layout;
    if (!L || !this.navigator() || !this.inPlot(p)) return null;
    return navHandleAt(p, L, this.navWindow);
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
      const toggle = () => {
        if (this.timeline?.playing) this.timeline.pause();
        else this.timeline?.play();
        this.requestRender();
      };
      this.controls = createPlayBar(this.root, toggle, (frame) => this.seek(frame));
    }
    stylePlayBar(this.controls, this.theme, this.timeline);
    this.shownFrame = -1;
  }

  private updateControls(): void {
    const tl = this.timeline;
    const c = this.controls;
    if (!tl || !c) return;
    const index = updatePlayBar(c, tl, this.shownFrame);
    if (index === null) return;
    this.shownFrame = index;
    this.emit('frame', { index, label: tl.frames[index] ?? '' });
  }


  private axis(channel: 'x' | 'y'): AxisSpec | null {
    if (!this.axesShown[channel]) return null; // maps, pies, treemaps…
    const a = this.spec.axes?.[channel];
    return a === false ? null : (a ?? {});
  }

  /** The secondary value axis of a dual-axis chart: right of the plot, or above it when horizontal. */
  private axis2(): AxisSpec | null {
    if (!this.val2) return null;
    const a = this.spec.axes?.secondary;
    return a === false ? null : (a ?? {});
  }

  /** The value scale a layer is drawn with. */
  private valOf(b: Built): Scale {
    return this.val2 && this.secondary.has(b.data.index) ? this.val2 : this.val;
  }

  /** The spec or theme shows a legend and there is something in it. */
  private legendWanted(): boolean {
    return (this.spec.legend ?? this.theme.legend.visible) && (this.legend.length >= 2 || !!this.legendRamp);
  }

  private showLegend(): boolean {
    return this.legendWanted() && this.compact < 3;
  }

  /**
   * Small screens: when the drawing would be cramped, the chart gives up, in
   * order, its subtitle, its axis titles, then its legend (`autoCompact: false` in
   * the spec keeps everything). Each level is tried until the drawing is readable.
   */
  private compact = 0;

  private computeLayout(): Layout {
    const r = computeLayout({
      ctx: this.ctx,
      theme: this.theme,
      spec: this.spec,
      zoom: this.zoom,
      width: this.width,
      height: this.height,
      legend: this.legend,
      legendRamp: this.legendRamp,
      legendWanted: this.legendWanted(),
      axes: { x: this.axis('x'), y: this.axis('y'), secondary: this.axis2() },
      horizontal: this.horizontal,
      xScale: this.xScale,
      yScale: this.yScale,
      val2: this.val2,
      timeline: !!this.timeline,
      built: this.built,
      aspect: this.aspect,
      group: this.alignsWithGroup() ? () => groupMargins(this.syncGroup!, this, this.width) : undefined,
    });
    this.compact = r.compact;
    this.ownMargins = r.ownMargins;
    if (r.legendPlaced) this.rampRect = r.rampRect;
    this.shareMargins();
    return r.layout;
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
    const calls: DrawCall[] = [];

    // Grid, in pixel space, snapped to device pixels.
    const xAxis = this.axis('x');
    const yAxis = this.axis('y');
    // The value axis carries the grid: y normally, x on a horizontal chart. Mark-owned scales (heatmap) have none.
    const gridY = this.markScales ? this.markGrid.y : this.horizontal ? theme.grid.x.visible : theme.grid.y.visible;
    const gridX = this.markScales ? this.markGrid.x : this.horizontal ? theme.grid.y.visible : theme.grid.x.visible;
    const grid = gridLines(theme, L, !!yAxis && (yAxis.grid ?? gridY), !!xAxis && (xAxis.grid ?? gridX));
    this.gridBatch.update(new Float32Array(grid), grid.length / LAYOUTS.line.stride);
    calls.push({ batch: this.gridBatch, pixelSnap: true });

    // Marks. Unzoomed, leave a little room so markers on the edge are not cut.
    const clip = marksClip(L, this.zoom.kx !== 1 || this.zoom.ky !== 1, this.geo);
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
    const dim = this.built.some((b) => b.sel) ? theme.selection.dimOpacity : 1;
    calls.push(...markCalls(this.built, L, clip, { enter: enterT, reveal, morph: morphT, morphing, dim }));
    this.renderer.render({ clearColor: parseColor(theme.background), calls });
    if (this.morph && morphT >= 1) this.endMorph();
    this.drawOverlay(L);
    if (this.navigator()) drawNavigator(this.ctx, theme, L, this.navWindow);
    this.updateControls();
    if (animating) this.requestRender();
  }

  private drawOverlay(L: Layout): void {
    const { ctx, theme } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const crisp = (v: number, w: number) => (Math.round(w * this.dpr) % 2 === 1 ? Math.floor(v * this.dpr) / this.dpr + 0.5 / this.dpr : Math.round(v * this.dpr) / this.dpr);

    drawTitles(ctx, theme, this.spec, L, this.width, this.compact);

    // Legend.
    if (this.showLegend()) {
      const muted = new Set(this.built.flatMap((b) => b.mark.muted?.() ?? []));
      drawLegend(ctx, theme, this.width, this.legend, (key) => this.hidden.has(key) || muted.has(key), this.legendRamp, this.rampRect);
    }

    drawAxes(ctx, L, {
      theme,
      axes: { x: this.axis('x'), y: this.axis('y'), secondary: this.axis2() },
      horizontal: this.horizontal,
      markScales: this.markScales,
      yBand: this.yScale.type === 'band',
      compact: this.compact,
      timeline: !!this.timeline,
      width: this.width,
      height: this.height,
      crisp,
    });

    drawMarkLabels(ctx, theme, this.built, L, this.width, { enter: this.enterProgress, morph: this.morphProgress });
    drawHover(ctx, theme, L, this.built, this.picked, {
      mode: this.tooltipMode(),
      crosshair: this.spec.interactions?.crosshair ?? true,
      horizontal: this.horizontal,
      cat: this.cat,
    });
    drawLasso(ctx, theme, this.lasso);
  }




  // ------------------------------------------------------------- interactions

  private tooltipMode(): 'x' | 'nearest' {
    return tooltipMode(this.spec, this.geo, this.cat);
  }

  private zoomConfig(): ZoomConfig | null {
    return zoomConfig(this.spec, this.minViewWidth, this.zoom);
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inPlot(p: { x: number; y: number }, margin = 0): boolean {
    return inPlot(this.layout?.plot, p, margin);
  }

  private legendAt(p: { x: number; y: number }): LegendEntry | undefined {
    if (!this.showLegend() || this.spec.interactions?.legendToggle === false) return undefined;
    return this.legend.find((e) => e.rect && p.x >= e.rect.x && p.x <= e.rect.x + e.rect.width && p.y >= e.rect.y && p.y <= e.rect.y + e.rect.height);
  }

  private pick(p: { x: number; y: number }): Picked[] {
    return pickAt(p, this.layout, this.built, { mode: this.tooltipMode(), horizontal: this.horizontal, cat: this.cat });
  }

  private describe(picked: Picked[]): HoverItem[] {
    return describeItems(picked, this.built, { spec: this.spec, horizontal: this.horizontal, cat: this.cat, val: this.val, valOf: (b) => this.valOf(b) });
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    this.pointer = p;
    if (this.navigator()) {
      const L = this.layout;
      if (this.navDrag && L) {
        const n = Math.max(0, Math.min(1, (p.x - L.transform.ox) / L.transform.sx));
        this.navWindow = dragWindow(this.navDrag, n);
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
      panBy(this.zoom, cfg, dx, dy, plot);
      this.clampZoom();
      this.setPicked([]);
      this.emit('zoom', { ...this.zoom });
      this.shareRange();
      this.requestRender();
      return;
    }
    this.hoverMarks(p);
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

  /** Tell the marks that follow the pointer (`BuiltMark.hover`) where it is; redraw when one of them changed. */
  private hoverMarks(p: Point | null): void {
    const L = this.layout;
    let changed = false;
    for (const b of this.built) {
      if (!b.mark.hover) continue;
      const at = p && L && this.inPlot(p) ? { tx: (p.x - L.transform.ox) / L.transform.sx, ty: (p.y - L.transform.oy) / L.transform.sy } : null;
      if (b.mark.hover(at)) changed = true;
    }
    if (changed) this.requestRender();
  }

  private onLeave(): void {
    this.pointer = undefined;
    this.shape = undefined;
    this.hoverMarks(null);
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
      const { additive } = this.lasso;
      const polygon = lassoPolygon(this.lasso);
      this.lasso = undefined;
      this.root.releasePointerCapture(e.pointerId);
      if (polygon) {
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
    const z = this.zoom;
    zoomAt(z, cfg, p, this.layout!.view, Math.exp(-e.deltaY * 0.0015));
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
    const masks = selectionMasks(polygon, this.built, this.layout!.transform, additive);
    this.built.forEach((b, i) => masks[i] && setLayerSelection(b, masks[i]!, this.renderer));
    this.emit('select', this.getSelection());
    this.requestRender();
  }



  /** Shape marks (countries…) under the pointer, topmost layer first. */
  private pickShape(p: Point): ShapeHit | undefined {
    const L = this.layout;
    if (!L || !this.inPlot(p)) return undefined;
    return shapeAt(this.built, (p.x - L.transform.ox) / L.transform.sx, (p.y - L.transform.oy) / L.transform.sy);
  }

  private clampZoom(): void {
    clampPan(this.zoom);
    this.fitY();
    this.notifyView();
  }

  /** Marks that lay out for the visible range (a timeline's cards) do it again. */
  private notifyView(): void {
    const [x0, x1] = visibleX(this.zoom);
    for (const b of this.built) b.mark.view?.(x0, x1);
  }

  /**
   * Zoomed along x only, the value axis follows what is visible (as a stock chart
   * does): it is only the view transform that changes, never the batches.
   * Off with `interactions.zoom.fitY: false`.
   */
  private fitY(): void {
    fitY(this.zoom, { spec: this.spec, horizontal: this.horizontal, markScales: this.markScales, geo: this.geo, built: this.built, cat: this.cat, valOf: (b) => this.valOf(b) });
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
    if (!fillTooltip(tip, context, this.spec, this.options)) {
      tip.style.opacity = '0';
      return;
    }

    // Place beside the pointer, flipping to stay inside the chart.
    const at = tooltipPosition(p, tip.offsetWidth, tip.offsetHeight, this.width, this.height);
    tip.style.transform = `translate(${at.x}px, ${at.y}px)`;
    tip.style.opacity = '1';
  }

  private emit<K extends keyof ChartEvents>(type: K, payload: ChartEvents[K]): void {
    this.listeners.get(type)?.forEach((h) => h(payload));
  }
}
