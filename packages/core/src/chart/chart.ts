import { Table, type DataInput, type Row } from '../data/table';
import { ensureBuiltinMarks } from '../marks/builtin';
import { prepareLayer, type LayerData, type SeriesData } from '../marks/prepare';
import { getMark, type BuildContext, type BuiltMark, type MarkDefinition } from '../marks/registry';
import { createRenderer, type RendererChoice } from '../render';
import { LAYOUTS } from '../render/layouts';
import type { Batch, ClipRect, DrawCall, Renderer, RGBA, ViewTransform } from '../render/types';
import { BandScale, LinearScale, LogScale, TimeScale, niceDomain, type Scale, type Tick } from '../scale/scales';
import type { AxisSpec, ChartSpec, ScaleSpec } from '../spec/types';
import { resolveTheme, type Theme } from '../theme/theme';
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

export interface TooltipContext {
  mode: 'x' | 'nearest';
  title: string;
  items: HoverItem[];
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
}

interface Picked {
  layer: number;
  index: number;
}

interface Layout {
  plot: ClipRect;
  titleY: number;
  legendY: number;
  xTicks: Tick[];
  yTicks: Tick[];
  transform: ViewTransform;
}

const font = (weight: number | string, size: number, family: string) => `${weight} ${size}px ${family}`;

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
    root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;touch-action:pan-y;';
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

  resize(): void {
    if (this.destroyed) return;
    this.measure();
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
    for (const b of this.built) for (const d of b.mark.draws) d.batch.destroy();
    this.built = [];
  }

  private compile(): void {
    this.disposeMarks();
    this.picked = [];
    const { spec, theme } = this;
    const fields = spec.fields ?? {};
    const types = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.type]));
    const base = spec.data ? Table.from(spec.data, types) : undefined;
    const tableOf = (i: number): Table => {
      const d = spec.layers[i].data;
      if (d) return Table.from(d, types);
      if (!base) throw new Error(`futurCharts: layer ${i} has no data (set spec.data or layer.data).`);
      return base;
    };
    if (spec.layers.length === 0) {
      this.legend = [];
      this.requestRender();
      return;
    }

    // 1. Scale type of x, from the spec or from the first layer's x column.
    const firstX = tableOf(0).column(spec.layers[0].encode.x);
    const xType: NonNullable<ScaleSpec['type']> =
      spec.scales?.x?.type ?? (firstX.type === 'string' ? 'band' : firstX.type === 'time' ? 'time' : 'linear');

    // 2. Prepare each layer: grouping into series, stacking.
    const categories = new Map<string, number>();
    const prep = { band: xType === 'band', categories, fields, hidden: this.hidden };
    const layers = spec.layers.map((layer, i) => ({
      data: prepareLayer(layer, i, tableOf(i), prep),
      def: getMark(layer.mark),
    }));

    // 3. Color slots: fixed by entity, never by rank, so filters don't repaint survivors.
    const slots = new Map<string, number>();
    for (const key of spec.scales?.color?.domain ?? []) slots.set(key, slots.size);
    for (const { data } of layers) {
      if (data.colorMode !== 'series') continue;
      for (const s of data.series) if (!slots.has(s.key)) slots.set(s.key, slots.size);
    }
    const palette = theme.palette.categorical.map(parseColor);
    const ramp = theme.palette.sequential.map(parseColor);
    const explicit = spec.scales?.color?.colors ?? {};
    const seriesColor = (data: LayerData, s: SeriesData): RGBA => {
      if (data.layer.style?.color) return parseColor(data.layer.style.color);
      if (explicit[s.key]) return parseColor(explicit[s.key]);
      return palette[(slots.get(s.key) ?? 0) % palette.length];
    };

    // 4. Domains.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    let step = Infinity;
    let baseline = false;
    let banded = false;
    for (const { data, def } of layers) {
      baseline ||= !!def.baseline;
      banded ||= !!def.banded;
      for (const s of data.series) {
        if (s.hidden) continue;
        for (let i = 0; i < s.x.length; i++) {
          const x = s.x[i];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          const lo = Math.min(s.y0[i], s.y1[i]);
          const hi = Math.max(s.y0[i], s.y1[i]);
          if (lo < y0) y0 = lo;
          if (hi > y1) y1 = hi;
          if (def.banded && i > 0 && x - s.x[i - 1] > 0) step = Math.min(step, x - s.x[i - 1]);
        }
      }
    }
    if (x0 > x1) [x0, x1] = [0, 1];
    if (y0 > y1) [y0, y1] = [0, 1];
    if (!Number.isFinite(step)) step = x1 > x0 ? x1 - x0 : 1;

    const xs = spec.scales?.x ?? {};
    const onlyPoints = spec.layers.every((l) => l.mark === 'point');
    let xStep = 0;
    if (xType === 'band') {
      const pad = theme.marks.bar.bandPadding;
      this.xScale = new BandScale([...categories.keys()], pad, pad / 2);
    } else {
      if (banded) {
        x0 -= step / 2;
        x1 += step / 2;
      }
      if (xType !== 'time' && (xs.nice ?? (onlyPoints && !banded))) [x0, x1] = niceDomain(x0, x1, 8);
      if (xs.zero) [x0, x1] = [Math.min(0, x0), Math.max(0, x1)];
      x0 = xs.domain?.[0] ?? x0;
      x1 = xs.domain?.[1] ?? x1;
      const xFormat = fields[spec.layers[0].encode.x]?.format;
      this.xScale =
        xType === 'time' ? new TimeScale(x0, x1) : xType === 'log' ? new LogScale(x0, x1, xFormat) : new LinearScale(x0, x1, xFormat);
      xStep = Math.abs(this.xScale.norm(x0 + step) - this.xScale.norm(x0));
    }

    const ys = spec.scales?.y ?? {};
    const yAxis = spec.axes?.y || undefined;
    const yFormat = yAxis?.format ?? fields[spec.layers[0].encode.y]?.format;
    if (ys.type === 'log') {
      this.yScale = new LogScale(ys.domain?.[0] ?? y0, ys.domain?.[1] ?? y1, yFormat);
    } else {
      if (ys.zero ?? baseline) [y0, y1] = [Math.min(0, y0), Math.max(0, y1)];
      if (ys.nice ?? true) [y0, y1] = niceDomain(y0, y1, 5);
      this.yScale = new LinearScale(ys.domain?.[0] ?? y0, ys.domain?.[1] ?? y1, yFormat);
    }

    // 5. Build GPU batches.
    const surface = parseColor(theme.background);
    const opaqueSurface: RGBA = surface[3] === 0 ? [1, 1, 1, 1] : surface;
    this.built = layers.map(({ data, def }) => {
      const style = deepMerge((theme.marks as Record<string, any>)[data.layer.mark] ?? {}, data.layer.style ?? {});
      const [c0, c1] = data.colorExtent;
      const [s0, s1] = data.sizeExtent;
      const [r0, r1] = (style.sizeRange as [number, number] | undefined) ?? [4, 28];
      const ctx: BuildContext = {
        renderer: this.renderer,
        data,
        x: this.xScale,
        y: this.yScale,
        theme,
        style,
        surface: opaqueSurface,
        xStep,
        color: (s, i) =>
          s.colorValue && !data.layer.style?.color
            ? sampleRamp(ramp, c1 > c0 ? (s.colorValue[i] - c0) / (c1 - c0) : 0.5)
            : seriesColor(data, s),
        // Area-proportional sizing: the eye reads surface, not diameter.
        size: (s, i) =>
          s.sizeValue ? r0 + (r1 - r0) * Math.sqrt(s1 > s0 ? Math.max(0, (s.sizeValue[i] - s0) / (s1 - s0)) : 0.5) : (style.size ?? 8),
      };
      return { data, def, mark: def.build(ctx) };
    });

    // 6. Legend: one entry per series slot, in slot order.
    const entries = new Map<string, LegendEntry>();
    for (const { data, def } of layers) {
      if (data.colorMode !== 'series') continue;
      for (const s of data.series) {
        if (!entries.has(s.key)) entries.set(s.key, { key: s.key, color: seriesColor(data, s), symbol: def.symbol });
      }
    }
    this.legend = [...slots.keys()].map((k) => entries.get(k)!).filter(Boolean);
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

  private axis(channel: 'x' | 'y'): AxisSpec | null {
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
    const plotW = Math.max(10, this.width - left - pad - 4);
    const plot = { x: left, y: top, width: plotW, height: plotH };

    const vx0 = -zoom.tx / zoom.kx;
    const vx1 = (1 - zoom.tx) / zoom.kx;
    const xCount = xAxis?.tickCount ?? Math.min(12, Math.max(2, Math.round(plotW / 90)));
    const xTicks = this.xScale.ticks(vx0, vx1, xCount);

    const transform: ViewTransform = {
      sx: zoom.kx * plotW,
      ox: left + zoom.tx * plotW,
      sy: -zoom.ky * plotH,
      oy: top + plotH - zoom.ty * plotH,
    };
    return { plot, titleY, legendY, xTicks, yTicks, transform };
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
    if (yAxis && (yAxis.grid ?? theme.grid.y.visible)) {
      for (const t of L.yTicks) {
        const y = T.oy + t.t * T.sy;
        if (y >= plot.y - 0.5 && y <= plot.y + plot.height + 0.5) addLine(plot.x, y, plot.x + plot.width, y, theme.grid.y.color, theme.grid.y.width);
      }
    }
    if (xAxis && (xAxis.grid ?? theme.grid.x.visible)) {
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
    const clip = { x: plot.x - m, y: plot.y - m, width: plot.width + 2 * m, height: plot.height + 2 * m };
    for (const b of this.built) {
      for (const d of b.mark.draws) calls.push({ batch: d.batch, transform: T, clip, pixelSnap: d.pixelSnap });
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
      if (xAxis.line ?? theme.axis.line.visible) {
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
      if (yAxis.line ?? false) {
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

    this.drawHover(L);
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
      const cx = T.ox + this.xScale.norm(fx) * T.sx;
      const hasBand = this.built.some((b) => b.def.banded);
      if (hasBand) {
        const span = this.xScale.band > 0 ? this.xScale.band / (1 - theme.marks.bar.bandPadding) : this.xStepNorm();
        const w = span * T.sx;
        ctx.fillStyle = theme.hover.bandFill;
        ctx.fillRect(cx - w / 2, plot.y, w, plot.height);
      } else if (theme.crosshair.visible) {
        ctx.fillStyle = theme.crosshair.color;
        ctx.fillRect(Math.round(cx) - theme.crosshair.width / 2, plot.y, theme.crosshair.width, plot.height);
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
          const d = Math.abs(this.xScale.norm(s.x[i]) - this.xScale.norm(s.x[i - 1]));
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
    return this.spec.layers.length > 0 && this.spec.layers.every((l) => l.mark === 'point') && this.xScale.band === 0
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
    const visible = (x: number) => x >= plot.x - 1 && x <= plot.x + plot.width + 1;
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
        const px = T.ox + this.xScale.norm(h.x[i]) * T.sx;
        const d = Math.abs(px - p.x);
        if (d < bestD && visible(px)) {
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
      const yField = b.data.layer.encode.y;
      const yFmt = (this.spec.axes?.y || undefined)?.format ?? fields[yField]?.format;
      return {
        layer: p.layer,
        series: b.data.series[h.series[i]].key,
        x: this.xScale.type === 'band' ? this.xScale.format(raw) : this.xScale.type === 'time' ? new Date(raw) : raw,
        xLabel: this.xScale.format(raw),
        value: h.value[i],
        valueLabel: numberFormatter(fields[yField]?.format ?? yFmt)(h.value[i]),
        color: toCss([h.color[i * 4], h.color[i * 4 + 1], h.color[i * 4 + 2], 1]),
        row: b.data.table.row(h.row[i]),
      };
    });
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    this.pointer = p;
    if (this.drag) {
      const plot = this.layout!.plot;
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
    this.root.style.cursor = overLegend ? 'pointer' : this.zoomConfig() && this.inPlot(p) && (this.zoom.kx > 1 || this.zoom.ky > 1) ? 'grab' : 'default';
    if (this.spec.interactions?.tooltip === false) return;
    const picked = this.pick(p);
    this.setPicked(picked);
    this.showTooltip(p);
    if (picked.length) this.emit('hover', { items: this.describe(picked), x: p.x, y: p.y });
  }

  private onLeave(): void {
    this.pointer = undefined;
    this.setPicked([]);
    this.tip.style.opacity = '0';
    this.emit('leave', {});
  }

  private onDown(e: PointerEvent): void {
    const p = this.local(e);
    if (this.zoomConfig() && this.inPlot(p) && (this.zoom.kx > 1 || this.zoom.ky > 1)) {
      this.drag = { x: p.x, y: p.y, moved: 0 };
      this.root.setPointerCapture(e.pointerId);
      this.root.style.cursor = 'grabbing';
      this.tip.style.opacity = '0';
    }
  }

  private onUp(e: PointerEvent): void {
    const p = this.local(e);
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
    const plot = this.layout!.plot;
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
    if (this.picked.length === 0) {
      tip.style.opacity = '0';
      return;
    }
    const items = this.describe(this.picked);
    const mode = this.tooltipMode();
    const context: TooltipContext = { mode, title: mode === 'x' ? items[0].xLabel : items[0].series, items, theme };
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
      row(label(enc.x), it.xLabel);
      row(label(enc.y), it.valueLabel);
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
