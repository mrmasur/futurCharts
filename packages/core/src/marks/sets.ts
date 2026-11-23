/**
 * Sets, categorical flows and relations: parallel sets (`parsets`), UpSet
 * (`upset`, in setsUpset.ts) and hierarchical edge bundling (`bundle`, in
 * setsBundle.ts). Standalone marks drawn with the shared primitives.
 */
import { LinearScale } from '../scale/scales';
import type { RGBA } from '../render/types';
import { mix, parseColor, withAlpha } from '../util/color';
import { batches, share } from './charts';
import { pushRect, pushVertex } from './primitives';
import { emptyHit, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { bundle } from './setsBundle';
import { upset } from './setsUpset';

// ----------------------------------------------------------------- parsets

export interface ParsetsRow {
  /** One category per dimension. */
  cats: string[];
  /** Category that colors the row's ribbons. */
  color: string;
  value: number;
  /** Source row (the first one of the combination, after aggregation). */
  row: number;
}

export interface ParsetsCategory {
  name: string;
  value: number;
  /** Top and bottom, px (y down). */
  y0: number;
  y1: number;
  row: number;
}

export interface ParsetsColumn {
  x0: number;
  x1: number;
  cats: ParsetsCategory[];
}

/** A band between two neighbouring columns: one combination of all the dimensions. */
export interface ParsetsRibbon {
  /** Index of the source column; the target is the next one. */
  col: number;
  source: number;
  target: number;
  color: string;
  value: number;
  /** Top of the band at the source and at the target, px. */
  sy: number;
  ty: number;
  height: number;
  row: number;
}

export interface ParsetsOptions {
  nodeWidth: number;
  nodePadding: number;
  /** Category order in a column: as met in the data, or largest first. */
  sort?: 'data' | 'value';
  /** Room kept free, px. */
  top?: number;
  left?: number;
  right?: number;
}

/**
 * Parallel sets layout in pixels (y down). Every column stacks its categories
 * at the same scale; between two columns, each combination of categories is a
 * band, ordered the same way on both sides so the bands of one pair of
 * categories stay together.
 */
export function parsetsLayout(input: ParsetsRow[], width: number, height: number, opt: ParsetsOptions): { columns: ParsetsColumn[]; ribbons: ParsetsRibbon[]; total: number } {
  const n = input[0]?.cats.length ?? 0;
  // One entry per distinct combination.
  const combos = new Map<string, ParsetsRow>();
  for (const r of input) {
    if (!(r.value > 0)) continue;
    const id = `${r.cats.join('\u0000')}\u0001${r.color}`;
    const e = combos.get(id);
    if (e) e.value += r.value;
    else combos.set(id, { ...r, cats: [...r.cats] });
  }
  const rows = [...combos.values()];
  const total = rows.reduce((a, r) => a + r.value, 0);
  const colors: string[] = [];
  for (const r of rows) if (!colors.includes(r.color)) colors.push(r.color);

  const top = opt.top ?? 0;
  const left = opt.left ?? 0;
  const right = opt.right ?? 0;
  const availH = Math.max(1, height - top);
  const names: string[][] = [];
  const sums: Map<string, { value: number; row: number }>[] = [];
  for (let d = 0; d < n; d++) {
    const m = new Map<string, { value: number; row: number }>();
    for (const r of rows) {
      const e = m.get(r.cats[d]);
      if (e) e.value += r.value;
      else m.set(r.cats[d], { value: r.value, row: r.row });
    }
    const list = [...m.keys()];
    if (opt.sort === 'value') list.sort((a, b) => m.get(b)!.value - m.get(a)!.value);
    names.push(list);
    sums.push(m);
  }
  const most = Math.max(1, ...names.map((l) => l.length));
  // The padding gives way before the bars do.
  const pad = most > 1 ? Math.min(opt.nodePadding, (availH * 0.3) / (most - 1)) : 0;
  const k = total > 0 ? (availH - pad * (most - 1)) / total : 0;
  const span = Math.max(0, width - left - right - opt.nodeWidth);
  const columns: ParsetsColumn[] = names.map((list, d) => {
    const x0 = left + (n > 1 ? (span * d) / (n - 1) : span / 2);
    // A column with fewer categories spreads them a little, then sits in the middle.
    const gap = list.length > 1 ? Math.min(pad * 2.5, (availH - total * k) / (list.length - 1)) : 0;
    let y = top + (availH - total * k - gap * (list.length - 1)) / 2;
    const cats = list.map((name) => {
      const s = sums[d].get(name)!;
      const c = { name, value: s.value, y0: y, y1: y + s.value * k, row: s.row };
      y = c.y1 + gap;
      return c;
    });
    return { x0, x1: x0 + opt.nodeWidth, cats };
  });

  const ribbons: ParsetsRibbon[] = [];
  const indexOf = names.map((l) => new Map(l.map((c, i) => [c, i])));
  for (let d = 0; d + 1 < n; d++) {
    const items = rows.map((r, i) => ({ r, i, s: indexOf[d].get(r.cats[d])!, t: indexOf[d + 1].get(r.cats[d + 1])!, c: colors.indexOf(r.color) }));
    const pieces = new Map<number, ParsetsRibbon>();
    const cursorS = columns[d].cats.map((c) => c.y0);
    for (const it of [...items].sort((a, b) => a.s - b.s || a.t - b.t || a.c - b.c || a.i - b.i)) {
      const h = it.r.value * k;
      pieces.set(it.i, { col: d, source: it.s, target: it.t, color: it.r.color, value: it.r.value, sy: cursorS[it.s], ty: 0, height: h, row: it.r.row });
      cursorS[it.s] += h;
    }
    const cursorT = columns[d + 1].cats.map((c) => c.y0);
    for (const it of [...items].sort((a, b) => a.t - b.t || a.s - b.s || a.c - b.c || a.i - b.i)) {
      const p = pieces.get(it.i)!;
      p.ty = cursorT[it.t];
      cursorT[it.t] += p.height;
    }
    // In source order: neighbours of one pair follow each other.
    ribbons.push(...[...pieces.values()].sort((a, b) => a.source - b.source || a.sy - b.sy));
  }
  return { columns, ribbons, total };
}

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const sameColor = (a: RGBA, b: RGBA) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/**
 * `parsets`: parallel sets (alluvial diagram). One column per field of `path`,
 * one bar per category, ribbons between neighbouring columns colored by
 * `color` (default: the first dimension). Sized by `value`, or by the number of rows.
 */
export const parsets: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const dims = layer.encode.path;
    if (!dims || dims.length < 2) throw new Error('futurCharts: mark "parsets" needs encode.path (two categorical fields or more).');
    const vf = layer.encode.value;
    const cf = layer.encode.color ?? dims[0];
    const cols = dims.map((f) => table.column(f).values);
    const colorCol = table.column(cf).values;
    const val = vf ? (table.column(vf).values as Float64Array) : undefined;
    const all: ParsetsRow[] = [];
    for (let i = 0; i < table.length; i++) {
      const v = val ? val[i] : 1;
      if (!(v > 0)) continue;
      all.push({ cats: cols.map((c) => String(c[i])), color: String(colorCol[i]), value: v, row: i });
    }
    const colorNames: string[] = [];
    for (const r of all) if (!colorNames.includes(r.color)) colorNames.push(r.color);
    const legend = colorNames.map((k) => ({ key: k, color: ctx.categorical(k) }));
    const base = new Map(legend.map((l) => [l.key, l.color]));
    const input = all.filter((r) => !ctx.hidden.has(r.color));
    const fmt = (v: number) => (vf ? ctx.format(v, vf) : integer.format(v));
    const dimLabel = (d: number) => ctx.fields[dims[d]]?.label ?? dims[d];

    const W = 1 / ctx.pixel[0];
    const H = 1 / ctx.pixel[1];
    const family = theme.font.family;
    const n = dims.length;
    // Names of the outer columns go outside when the chart is wide enough, over the ribbons otherwise.
    const widest = (d: number) => Math.max(0, ...[...new Set(input.map((r) => r.cats[d]))].map((c) => textWidth(c, `600 12px ${family}`))) + 10;
    const mLeft = style.labels ? widest(0) : 0;
    const mRight = style.labels ? widest(n - 1) : 0;
    const wide = W >= 520;
    const leftOut = style.labels && wide && mLeft <= W * 0.2;
    // A narrow chart still gives the last names their margin, while the columns stay far enough apart for the others.
    const rightOut = style.labels && (wide ? mRight <= W * 0.2 : mRight <= W * 0.4 && (W - mRight) / (n - 1) >= 85);
    const top = style.titles ? 22 : 0;
    const { columns, ribbons, total } = parsetsLayout(input, W, H, {
      nodeWidth: style.nodeWidth,
      nodePadding: style.nodePadding,
      sort: style.categoryOrder,
      top,
      left: leftOut ? mLeft : 0,
      right: rightOut ? mRight : 0,
    });
    const tx = (x: number) => x / W;
    const ty = (y: number) => 1 - y / H;

    // Bands of one pair of categories that end up with the same color are drawn as one.
    interface Run { col: number; source: number; target: number; sy: number; ty: number; height: number; value: number; fill: RGBA; colors: Map<string, number> }
    const runs: Run[] = [];
    for (const r of ribbons) {
      const fill = withAlpha(ctx.paint(base.get(r.color)!, r.row), style.linkOpacity);
      const last = runs[runs.length - 1];
      if (last && last.col === r.col && last.source === r.source && last.target === r.target && sameColor(last.fill, fill) && Math.abs(last.sy + last.height - r.sy) < 1e-6 && Math.abs(last.ty + last.height - r.ty) < 1e-6) {
        last.height += r.height;
        last.value += r.value;
        last.colors.set(r.color, (last.colors.get(r.color) ?? 0) + r.value);
      } else runs.push({ col: r.col, source: r.source, target: r.target, sy: r.sy, ty: r.ty, height: r.height, value: r.value, fill, colors: new Map([[r.color, r.value]]) });
    }
    const STEPS = 28;
    const mesh: number[] = [];
    const shapes: { run: Run; xs: Float64Array; top: Float64Array }[] = [];
    // Faded ribbons first: the ones put forward stay on top.
    for (const run of [...runs].sort((a, b) => a.fill[3] - b.fill[3])) {
      const x0 = columns[run.col].x1;
      const x1 = columns[run.col + 1].x0;
      const xm = (x0 + x1) / 2;
      const xs = new Float64Array(STEPS + 1);
      const tops = new Float64Array(STEPS + 1);
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        const u = 1 - t;
        // Cubic Bézier with horizontal tangents at both ends.
        xs[s] = u * u * u * x0 + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * x1;
        tops[s] = run.sy + (run.ty - run.sy) * (3 * u * t * t + t * t * t);
      }
      for (let s = 0; s < STEPS; s++) {
        pushVertex(mesh, tx(xs[s]), ty(tops[s]), run.fill);
        pushVertex(mesh, tx(xs[s + 1]), ty(tops[s + 1]), run.fill);
        pushVertex(mesh, tx(xs[s + 1]), ty(tops[s + 1] + run.height), run.fill);
        pushVertex(mesh, tx(xs[s]), ty(tops[s]), run.fill);
        pushVertex(mesh, tx(xs[s + 1]), ty(tops[s + 1] + run.height), run.fill);
        pushVertex(mesh, tx(xs[s]), ty(tops[s] + run.height), run.fill);
      }
      shapes.push({ run, xs, top: tops });
    }

    const rects: number[] = [];
    const keys: string[] = [];
    const labels: MarkLabel[] = [];
    const ink = parseColor(theme.text.primary);
    const neutral = mix(ctx.surface, ink, 0.62);
    const r = style.radius;
    const colored = dims.indexOf(cf);
    // A bar stands for many rows: it fades only when all of them do, and takes a color they all share.
    const barFill = (d: number, name: string, own: RGBA): RGBA => {
      let best: RGBA | undefined;
      let same = true;
      for (const row of input) {
        if (row.cats[d] !== name) continue;
        const c = ctx.paint(own, row.row);
        if (best && !sameColor([c[0], c[1], c[2], 1], [best[0], best[1], best[2], 1])) same = false;
        if (!best || c[3] > best[3]) best = c;
      }
      if (!best) return own;
      return same ? best : [own[0], own[1], own[2], best[3]];
    };
    columns.forEach((col, d) => {
      const first = d === 0;
      const last = d === n - 1;
      if (style.titles) {
        const align = first ? (leftOut ? 'right' : 'left') : last ? (rightOut ? 'left' : 'right') : 'center';
        const x = align === 'left' ? col.x0 : align === 'right' ? col.x1 : (col.x0 + col.x1) / 2;
        labels.push({ tx: tx(x), ty: ty(0), text: dimLabel(d), color: theme.text.muted, size: 11, weight: 600, align, baseline: 'top', dy: 2 });
      }
      for (const c of col.cats) {
        const fill = barFill(d, c.name, d === colored ? base.get(c.name) ?? neutral : neutral);
        pushRect(rects, { x0: tx(col.x0), y0: ty(c.y1), x1: tx(col.x1), y1: ty(c.y0), fill, radii: [r, r, r, r] });
        keys.push(`${dims[d]}\u0000${c.name}`);
        if (!style.labels) continue;
        // Outer columns: outside when there is room. Otherwise right of the bar, left of the last one.
        const right = last ? rightOut : !(first && leftOut);
        const x = tx(right ? col.x1 : col.x0);
        const y = ty((c.y0 + c.y1) / 2);
        // Left of the last bar, a name must leave the previous column's names alone, or it is left out.
        const box: [number, number, number, number] | undefined = last && !right && d > 0 ? [tx(columns[d - 1].x1 + widest(d - 1) + 4), 0, tx(col.x0), 1] : undefined;
        const common = { tx: x, ty: y, align: right ? 'left' : 'right', dx: right ? 6 : -6, box } as const;
        const faded = fill[3] < 0.6;
        // Over the ribbons of a narrow chart, names alone: a second line would hide the next column's.
        const two = style.values && c.y1 - c.y0 >= 30 && wide;
        labels.push({ ...common, text: c.name, color: faded ? theme.text.muted : theme.text.primary, size: 12, weight: 600, baseline: two ? 'bottom' : 'middle', dy: two ? -1 : 0 });
        if (two) labels.push({ ...common, text: `${fmt(c.value)} · ${share(c.value, total)}`, color: faded ? theme.text.muted : theme.text.secondary, size: 11, baseline: 'top', dy: 2 });
      }
    });

    const valueLabel = vf ? (ctx.fields[vf]?.label ?? vf) : 'Lignes';
    const draws = batches(ctx, [], mesh, []);
    const bars = batches(ctx, rects, [], [], false);
    if (bars[0]) Object.assign(bars[0], { keys, data: new Float32Array(rects) });
    return {
      draws: [...draws, ...bars],
      hit: emptyHit(),
      labels,
      legend,
      pick(px, py): ShapeHit | null {
        const x = px * W;
        const y = (1 - py) * H;
        for (let d = 0; d < n; d++) {
          const col = columns[d];
          if (x < col.x0 - 2 || x > col.x1 + 2) continue;
          const c = col.cats.find((e) => y >= e.y0 && y <= e.y1);
          if (c) return { title: `${dimLabel(d)} : ${c.name}`, rows: [{ label: valueLabel, value: fmt(c.value) }, { label: 'Part du total', value: share(c.value, total) }] };
        }
        for (let i = shapes.length - 1; i >= 0; i--) {
          const { run, xs, top: tops } = shapes[i];
          if (x < xs[0] || x > xs[STEPS]) continue;
          let s = 0;
          while (s < STEPS - 1 && xs[s + 1] < x) s++;
          const f = (x - xs[s]) / (xs[s + 1] - xs[s] || 1);
          const t0 = tops[s] + (tops[s + 1] - tops[s]) * f;
          if (y < t0 || y > t0 + run.height) continue;
          const a = columns[run.col].cats[run.source];
          const b = columns[run.col + 1].cats[run.target];
          const rows = [{ label: valueLabel, value: fmt(run.value) }, { label: `Part de ${a.name}`, value: share(run.value, a.value) }];
          // The colored dimension, when it is not one of the two ends.
          const tint = [...run.colors.keys()];
          if (tint.length === 1 && colored !== run.col && colored !== run.col + 1) rows.unshift({ label: ctx.fields[cf]?.label ?? cf, value: tint[0] });
          return { title: `${a.name} → ${b.name}`, rows };
        }
        return null;
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const SETS_MARKS: Record<string, MarkDefinition> = { parsets, upset, bundle };
