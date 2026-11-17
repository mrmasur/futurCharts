import { Table, type DataInput, type Row } from '../data/table';
import type { ChartSpec } from '../spec/types';
import { resolveTheme, themeColor } from '../theme/theme';
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

  private constructor(private container: HTMLElement, private spec: ChartSpec, private options: ChartOptions) {}

  static async create(container: HTMLElement, spec: ChartSpec, options: ChartOptions = {}): Promise<FacetChart> {
    const f = new FacetChart(container, spec, options);
    f.root = document.createElement('div');
    f.root.style.cssText = 'width:100%;height:100%;overflow:auto;box-sizing:border-box;';
    container.appendChild(f.root);
    await f.build();
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
    if (spec.subtitle) header.appendChild(text(spec.subtitle, `font-size:${theme.subtitle.size}px;color:${theme.subtitle.color};margin-top:2px;`));
    if (series.length > 1 && spec.legend !== false) header.appendChild(this.legend(series, shared.color?.colors ?? {}, theme));
    this.root.appendChild(header);

    const grid = document.createElement('div');
    const cols = facet.columns ?? Math.min(values.length, 3);
    grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols}, minmax(0, 1fr));gap:4px;padding:0 4px 4px;`;
    this.root.appendChild(grid);
    const height = `${facet.height ?? 220}px`;
    for (const v of values) {
      const rows = indicesOf(table, facet.field, v);
      const panelSpec: ChartSpec = {
        ...spec,
        facet: undefined,
        title: v,
        subtitle: undefined,
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
      const union = (axis: 'x' | 'y') => {
        const ds = this.panels.map((p) => p.getDomains()[axis]).filter((d): d is [number, number] => !!d);
        return ds.length === this.panels.length ? ([Math.min(...ds.map((d) => d[0])), Math.max(...ds.map((d) => d[1]))] as [number, number]) : undefined;
      };
      const x = union('x');
      const y = union('y');
      if (x || y) {
        const scales = {
          ...shared,
          x: x ? { ...shared.x, domain: x, nice: false } : shared.x,
          y: y ? { ...shared.y, domain: y, nice: false } : shared.y,
        };
        for (const p of this.panels) p.update({ ...p.getSpec(), scales });
      }
    }
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
