import { Table, type DataInput, type Row } from '../data/table';
import type { ChartSpec } from '../spec/types';
import { resolveTheme, themeColor } from '../theme/theme';
import { facetLabel } from './a11y';
import { Chart, type ChartEvents, type ChartOptions } from './chart';

/**
 * Small multiples: the same chart once per value of `spec.facet.field`.
 * Every panel shares the category order, the color of each series and, unless
 * `shared: false`, the value scales, so panels compare at a glance. One legend
 * sits above them and toggles the series in every panel.
 */
export class FacetChart {
  private root!: HTMLDivElement;
  private panels: Chart[] = [];
  private listeners: { type: keyof ChartEvents; handler: (p: any) => void }[] = [];
  private hidden = new Set<string>();
  private building: Promise<void> = Promise.resolve();
  /** Panels fitted to the container's height (no `facet.height`): grid and header to lay out again on resize. */
  private fit?: { grid: HTMLDivElement; header: HTMLDivElement; count: number; columns?: number; max: number };
  private observer?: ResizeObserver;
  /** The container has a height of its own (measured empty, before any panel): panels fit in it. */
  private fixedHeight = false;

  private constructor(private container: HTMLElement, private spec: ChartSpec, private options: ChartOptions) {}

  static async create(container: HTMLElement, spec: ChartSpec, options: ChartOptions = {}): Promise<FacetChart> {
    const f = new FacetChart(container, spec, options);
    f.fixedHeight = container.clientHeight > 0;
    f.root = document.createElement('div');
    f.root.style.cssText = 'width:100%;height:100%;overflow:auto;box-sizing:border-box;';
    container.appendChild(f.root);
    await f.build();
    if (typeof ResizeObserver !== 'undefined') {
      f.observer = new ResizeObserver(() => f.layoutFit());
      f.observer.observe(container);
    }
    return f;
  }

  getSpec(): ChartSpec {
    return this.spec;
  }

  /** Every panel. */
  get charts(): readonly Chart[] {
    return this.panels;
  }

  update(spec: ChartSpec): void {
    this.spec = spec;
    this.building = this.building.then(() => this.build());
  }

  on<K extends keyof ChartEvents>(type: K, handler: (payload: ChartEvents[K]) => void): () => void {
    const entry = { type, handler };
    this.listeners.push(entry);
    const offs = this.panels.map((p) => p.on(type, handler));
    return () => {
      offs.forEach((off) => off());
      this.listeners = this.listeners.filter((l) => l !== entry);
    };
  }

  resize(): void {
    for (const p of this.panels) p.resize();
  }

  destroy(): void {
    this.observer?.disconnect();
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.root.remove();
  }

  private async build(): Promise<void> {
    for (const p of this.panels) p.destroy();
    this.panels = [];
    this.root.replaceChildren();
    const { spec } = this;
    const theme = resolveTheme(spec.theme);
    this.root.style.background = theme.background;
    this.root.style.fontFamily = theme.font.family;
    const facet = spec.facet;
    const fields = spec.fields ?? {};
    const types = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.type]));
    if (!facet || !spec.data) {
      // One chart: it is the figure itself.
      this.root.removeAttribute('role');
      this.root.removeAttribute('aria-label');
      const box = this.cell(this.root, '100%');
      this.panels = [await Chart.create(box, { ...spec, facet: undefined }, this.options)];
      return;
    }
    const table = Table.from(spec.data, types);
    const keyCol = table.column(facet.field);
    const values: string[] = [];
    for (let i = 0; i < table.length; i++) {
      const v = String(keyCol.values[i]);
      if (!values.includes(v)) values.push(v);
    }
    // A figure of figures: each panel is a chart with its own name, table and keyboard walk.
    this.root.setAttribute('role', 'figure');
    this.root.setAttribute('aria-label', facetLabel(spec, values.length, theme.texts));

    // Shared category order and series colors, from the whole data set.
    const ref = spec.layers.find((l) => l.encode.x && l.encode.y);
    const shared: ChartSpec['scales'] = { ...spec.scales };
    if (ref) {
      for (const axis of ['x', 'y'] as const) {
        const f = ref.encode[axis]!;
        if (table.has(f) && table.column(f).type === 'string' && !shared[axis]?.categories) {
          shared[axis] = { ...shared[axis], categories: distinct(table, f) };
        }
      }
    }
    const colorField = spec.layers.find((l) => l.encode.color && table.has(l.encode.color) && table.column(l.encode.color).type === 'string')?.encode.color;
    const series = colorField ? distinct(table, colorField) : [];
    if (colorField) shared.color = { ...shared.color, domain: shared.color?.domain ?? series };

    // Header: title, subtitle and one legend for every panel.
    const header = document.createElement('div');
    header.style.cssText = `padding:${theme.padding}px ${theme.padding}px 4px;`;
    if (spec.title) header.appendChild(text(spec.title, `font-weight:${theme.title.weight};font-size:${theme.title.size}px;color:${theme.title.color};`));
    if (spec.subtitle) header.appendChild(text(spec.subtitle, `font-size:${theme.subtitle.size}px;color:${theme.subtitle.color};margin-top:2px;`)).dataset.role = 'subtitle';
    if (series.length > 1 && spec.legend !== false) header.appendChild(this.legend(series, shared.color?.colors ?? {}, theme));
    this.root.appendChild(header);

    const panelSpecOf = (v: string): ChartSpec => ({
      ...spec,
      facet: undefined,
      title: v,
      subtitle: undefined,
      // Each panel says what it shows itself: the whole chart's description is the facet root's.
      description: undefined,
      legend: false,
      data: subset(spec.data!, indicesOf(table, facet.field, v)),
      scales: shared,
      theme: typeof spec.theme === 'object' ? { ...spec.theme, title: { size: 13 } } : { extends: spec.theme ?? 'light', title: { size: 13 } },
    });

    // Too small for every panel to be readable (a phone): one panel at a time, a button per value.
    // A panel needs about 140 px: its title and axes take 60.
    if (this.fixedHeight && values.length > 1) {
      const W = this.container.clientWidth;
      const cols = Math.max(1, Math.min(values.length, Math.floor(W / 130)));
      const rows = Math.ceil(values.length / cols);
      const avail = this.container.clientHeight - header.offsetHeight - 8;
      if (avail / rows < 140) {
        // The buttons name the panel: no title over it, and no subtitle over them.
        header.querySelector('[data-role="subtitle"]')?.remove();
        return this.buildCompact(values, header, (v) => ({ ...panelSpecOf(v), title: undefined }), theme);
      }
    }

    const grid = document.createElement('div');
    // Never so many columns that a panel gets narrower than 130 px (a phone).
    const cols = Math.min(facet.columns ?? Math.min(values.length, 3), Math.max(1, Math.floor((this.container.clientWidth || 9999) / 130)));
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, minmax(0, 1fr));gap:4px;padding:0 4px 4px;`;
    this.root.appendChild(grid);
    // A container of fixed height (a dashboard card, a thumbnail): every panel fits in it, no scrollbar,
    // at most `facet.height` tall. Otherwise (height from the content), panels are `facet.height` tall and the page grows.
    this.fit = this.fixedHeight ? { grid, header, count: values.length, columns: facet.columns, max: facet.height ?? Infinity } : undefined;
    const height = this.fit ? '100%' : `${facet.height ?? 220}px`;
    if (this.fit) this.layoutFit();
    for (const v of values) {
      const rows = indicesOf(table, facet.field, v);
      const panelSpec: ChartSpec = {
        ...spec,
        facet: undefined,
        title: v,
        subtitle: undefined,
        // Each panel says what it shows itself: the whole chart's description is the facet root's.
        description: undefined,
        legend: false,
        data: subset(spec.data, rows),
        scales: shared,
        theme: typeof spec.theme === 'object' ? { ...spec.theme, title: { size: 13 } } : { extends: spec.theme ?? 'light', title: { size: 13 } },
      };
      const chart = await Chart.create(this.cell(grid, height), panelSpec, this.options);
      for (const k of this.hidden) chart.toggleSeries(k, true);
      for (const l of this.listeners) chart.on(l.type, l.handler);
      this.panels.push(chart);
    }

    // Same value scales everywhere: the union of what each panel drew.
    if (facet.shared !== false && this.panels.length > 1) {
      const union = (axis: 'x' | 'y' | 'secondary') => {
        const ds = this.panels.map((p) => p.getDomains()[axis]).filter((d): d is [number, number] => !!d);
        return ds.length === this.panels.length ? ([Math.min(...ds.map((d) => d[0])), Math.max(...ds.map((d) => d[1]))] as [number, number]) : undefined;
      };
      const x = union('x');
      const y = union('y');
      // Dual-axis panels share their second value axis too.
      const second = union('secondary');
      if (x || y || second) {
        const scales = {
          ...shared,
          x: x ? { ...shared.x, domain: x, nice: false } : shared.x,
          y: y ? { ...shared.y, domain: y, nice: false } : shared.y,
          ...(second ? { secondary: { ...shared.secondary, domain: second, nice: false } } : {}),
        };
        for (const p of this.panels) p.update({ ...p.getSpec(), scales });
      }
    }
  }

  /** One panel and a row of buttons, one per facet value. */
  private async buildCompact(values: string[], header: HTMLDivElement, specOf: (v: string) => ChartSpec, theme: ReturnType<typeof resolveTheme>): Promise<void> {
    this.fit = undefined;
    const chips = document.createElement('div');
    chips.setAttribute('role', 'tablist');
    chips.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding:8px 0 2px;scrollbar-width:none;';
    header.appendChild(chips);
    const box = document.createElement('div');
    this.root.style.display = 'flex';
    this.root.style.flexDirection = 'column';
    this.root.style.overflow = 'hidden';
    box.style.cssText = 'flex:1;min-height:0;';
    this.root.appendChild(box);
    const accent = theme.palette.categorical[0];
    let active = values[0];
    const paint = () => {
      for (const b of chips.querySelectorAll<HTMLButtonElement>('button')) {
        const on = b.textContent === active;
        b.setAttribute('aria-selected', String(on));
        b.style.background = on ? accent : 'transparent';
        b.style.color = on ? '#fff' : theme.text.secondary;
        b.style.borderColor = on ? accent : theme.grid.y.color;
      }
    };
    for (const v of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.textContent = v;
      b.style.cssText = `all:unset;cursor:pointer;flex:none;padding:3px 10px;border-radius:999px;border:1px solid;font-size:12px;`;
      b.addEventListener('click', () => {
        active = v;
        paint();
        this.panels[0]?.update(specOf(v));
      });
      chips.appendChild(b);
    }
    paint();
    const chart = await Chart.create(box, specOf(active), this.options);
    for (const k of this.hidden) chart.toggleSeries(k, true);
    for (const l of this.listeners) chart.on(l.type, l.handler);
    this.panels = [chart];
  }

  /**
   * Fit the panels in the container: the fewest columns that leave each panel
   * readable (not too flat, not too narrow), all rows sharing the height left
   * under the header.
   */
  private layoutFit(): void {
    const f = this.fit;
    if (!f) return;
    const W = this.container.clientWidth;
    const H = this.container.clientHeight - f.header.offsetHeight - 6;
    if (W <= 0 || H <= 0) return;
    const gap = 4;
    const minH = 110;
    const minW = 130;
    // An explicit `columns` is kept, as long as each panel stays readable.
    let cols = Math.min(f.columns ?? Math.min(f.count, 3), Math.max(1, Math.floor(W / minW)));
    if (!f.columns) {
      // Wider grids until the rows fit in height, as long as panels stay wide enough.
      while (cols < f.count && Math.ceil(f.count / cols) * (minH + gap) > H && W / (cols + 1) >= minW) cols++;
    }
    const rows = Math.ceil(f.count / cols);
    const h = Math.min(f.max, Math.max(48, Math.floor((H - (rows - 1) * gap) / rows)));
    f.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    f.grid.style.gridAutoRows = `${h}px`;
    this.root.style.overflow = 'hidden';
  }

  private cell(parent: HTMLElement, height: string): HTMLDivElement {
    const d = document.createElement('div');
    d.style.cssText = `height:${height};min-width:0;`;
    parent.appendChild(d);
    return d;
  }

  private legend(series: string[], colors: Record<string, string>, theme: ReturnType<typeof resolveTheme>): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = `display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:8px;font-size:${theme.legend.label.size}px;color:${theme.legend.label.color};`;
    series.forEach((s, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.style.cssText = 'all:unset;display:inline-flex;align-items:center;gap:6px;cursor:pointer;';
      const sw = document.createElement('span');
      const c = themeColor(theme, colors[s] ?? theme.palette.categorical[i % theme.palette.categorical.length]);
      sw.style.cssText = `width:${theme.legend.symbolSize}px;height:${theme.legend.symbolSize}px;border-radius:2px;background:${c};`;
      item.append(sw, s);
      const paint = () => (item.style.opacity = this.hidden.has(s) ? String(theme.legend.hiddenOpacity) : '1');
      paint();
      item.addEventListener('click', () => {
        // Never hide the last visible series.
        if (!this.hidden.has(s) && this.hidden.size >= series.length - 1) return;
        if (this.hidden.has(s)) this.hidden.delete(s);
        else this.hidden.add(s);
        for (const p of this.panels) p.toggleSeries(s, this.hidden.has(s));
        paint();
      });
      row.appendChild(item);
    });
    return row;
  }
}

function text(content: string, css: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = content;
  d.style.cssText = css;
  return d;
}

function distinct(table: Table, field: string): string[] {
  const c = table.column(field).values;
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < table.length; i++) {
    const v = String(c[i]);
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function indicesOf(table: Table, field: string, value: string): number[] {
  const c = table.column(field).values;
  const out: number[] = [];
  for (let i = 0; i < table.length; i++) if (String(c[i]) === value) out.push(i);
  return out;
}

/** The rows `idx` of the input, in the same shape (rows or columns). */
function subset(data: DataInput, idx: number[]): DataInput {
  // An Arrow table (or anything else `Table.from` reads): go through the table form.
  if (!Array.isArray(data) && !(data instanceof Table) && !('columns' in data)) data = Table.from(data);
  if (Array.isArray(data)) return idx.map((i) => data[i] as Row);
  if (data instanceof Table) {
    const columns: Record<string, unknown[]> = {};
    for (const f of data.fields) {
      const c = data.column(f);
      columns[f] = idx.map((i) => (c.type === 'time' ? new Date(c.values[i] as number) : c.values[i]));
    }
    return { columns: columns as Record<string, (number | string | Date)[]> };
  }
  const columns: Record<string, (number | string | Date | null | undefined)[]> = {};
  for (const [f, col] of Object.entries(data.columns)) columns[f] = idx.map((i) => col[i]);
  return { columns };
}

/** A chart or a set of small multiples. */
export type ChartView = Chart | FacetChart;

/** Create the right view for a spec: small multiples when `spec.facet` is set. */
export function createChart(container: HTMLElement, spec: ChartSpec, options: ChartOptions = {}): Promise<ChartView> {
  return spec.facet ? FacetChart.create(container, spec, options) : Chart.create(container, spec, options);
}
