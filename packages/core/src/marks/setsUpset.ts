/** UpSet plot: the readable alternative to a Venn diagram beyond three sets. */
import { LAYOUTS } from '../render/layouts';
import { LinearScale } from '../scale/scales';
import { mix, parseColor } from '../util/color';
import { batches, share } from './charts';
import { pushRect, pushSegment } from './primitives';
import { emptyHit, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';

export interface UpsetSet {
  name: string;
  /** Elements in the set, whatever else they belong to. */
  size: number;
}

export interface UpsetCombo {
  /** Set names joined by `&`, in the order of `sets`. */
  key: string;
  /** Indices into `sets`, ascending. */
  members: number[];
  /** Elements that belong to exactly these sets. */
  value: number;
  row: number;
}

export interface UpsetOptions {
  /** `distinct`: a key counts the elements of exactly these sets. `inclusive`: of at least these sets (as `venn`). */
  mode?: 'distinct' | 'inclusive';
  /** Order of the intersections. */
  sort?: 'size' | 'degree' | 'data';
  /** Order of the sets (rows). */
  sortSets?: 'size' | 'data';
}

/** Names in a key such as `A&B`, `A ∩ B` or `A,B` (the syntax of `venn`). */
export const setNames = (key: string): string[] => [...new Set(key.split(/\s*[&∩,]\s*/).filter(Boolean))];

/**
 * Sets and exclusive intersections from keys such as `A&B`: one row per
 * element (`values` undefined: rows are counted) or one row per intersection.
 */
export function upsetData(keys: ArrayLike<unknown>, values: ArrayLike<number> | undefined, opt: UpsetOptions = {}): { sets: UpsetSet[]; combos: UpsetCombo[]; total: number } {
  const order: string[] = [];
  const given = new Map<string, { names: string[]; value: number; row: number }>();
  for (let i = 0; i < keys.length; i++) {
    const v = values ? values[i] : 1;
    const names = setNames(String(keys[i] ?? ''));
    if (!names.length || !(v >= 0)) continue;
    for (const n of names) if (!order.includes(n)) order.push(n);
    const id = [...names].sort().join('\u0000');
    const e = given.get(id);
    if (e) e.value += v;
    else given.set(id, { names, value: v, row: i });
  }
  let list = [...given.values()];
  const inclusiveSize = new Map<string, number>();
  if (opt.mode === 'inclusive') {
    // Inclusion–exclusion: what belongs to these sets and to no other.
    for (const g of list) if (g.names.length === 1) inclusiveSize.set(g.names[0], g.value);
    list = list.map((s) => {
      let v = 0;
      for (const t of list) {
        if (t.names.length < s.names.length || !s.names.every((n) => t.names.includes(n))) continue;
        v += (t.names.length - s.names.length) % 2 ? -t.value : t.value;
      }
      return { ...s, value: Math.max(0, v) };
    });
  }
  const sizeOf = (n: string) => inclusiveSize.get(n) ?? list.reduce((a, g) => a + (g.names.includes(n) ? g.value : 0), 0);
  const sets = order.map((name) => ({ name, size: sizeOf(name) }));
  if ((opt.sortSets ?? 'size') === 'size') sets.sort((a, b) => b.size - a.size);
  const at = new Map(sets.map((s, i) => [s.name, i]));
  const combos: UpsetCombo[] = list
    .filter((g) => g.value > 0)
    .map((g) => {
      const members = g.names.map((n) => at.get(n)!).sort((a, b) => a - b);
      return { key: members.map((m) => sets[m].name).join('&'), members, value: g.value, row: g.row };
    });
  const sort = opt.sort ?? 'size';
  if (sort === 'size') combos.sort((a, b) => b.value - a.value);
  else if (sort === 'degree') combos.sort((a, b) => a.members.length - b.members.length || b.value - a.value);
  return { sets, combos, total: combos.reduce((a, c) => a + c.value, 0) };
}

export interface UpsetGeometry {
  /** Columns that fit (the largest intersections first). */
  shown: number;
  colWidth: number;
  rowHeight: number;
  /** Left of the set bars, of the set names and of the matrix; right of the matrix. */
  barsLeft: number;
  namesLeft: number;
  matrixLeft: number;
  matrixRight: number;
  matrixTop: number;
  /** Intersection bars: from `barTop` down to `barBottom`. */
  barTop: number;
  barBottom: number;
  dot: number;
}

/** Where the three parts of an UpSet plot go, in px (y down). */
export function upsetLayout(sets: number, combos: number, width: number, height: number, nameWidth: number, setBars: number, max = 0): UpsetGeometry {
  const names = Math.min(nameWidth, width * 0.3);
  const bars = Math.max(0, Math.min(setBars, width - names - 60));
  const avail = Math.max(1, width - names - bars);
  let shown = Math.min(combos, Math.max(1, Math.floor(avail / 13)));
  if (max > 0) shown = Math.min(shown, max);
  const colWidth = Math.min(46, avail / Math.max(1, shown));
  const barsLeft = Math.max(0, (width - (bars + names + colWidth * shown)) / 2);
  const rowHeight = Math.max(13, Math.min(24, (height * 0.42) / Math.max(1, sets)));
  const matrixTop = Math.max(height * 0.3, height - rowHeight * sets - 2);
  const matrixLeft = barsLeft + bars + names;
  return {
    shown,
    colWidth,
    rowHeight: (height - 2 - matrixTop) / Math.max(1, sets),
    barsLeft,
    namesLeft: barsLeft + bars,
    matrixLeft,
    matrixRight: matrixLeft + colWidth * shown,
    matrixTop,
    barTop: 16,
    barBottom: matrixTop - 8,
    dot: Math.max(4, Math.min(13, Math.min(rowHeight, colWidth) * 0.6)),
  };
}

/** Shorten a text to `max` px with an ellipsis. */
function fit(text: string, max: number, font: string): string {
  if (textWidth(text, font) <= max) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}…`, font) > max) t = t.slice(0, -1);
  return `${t}…`;
}

const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/**
 * `upset`: `key` names the sets of a row (`A&B`), `value` its size (rows are
 * counted without it). A matrix of linked dots tells which sets each
 * intersection combines, bars above give its size, bars on the left the size of each set.
 */
export const upset: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = layer.encode.key;
    if (!kf) throw new Error('futurCharts: mark "upset" needs an encode.key field (sets joined by "&").');
    const vf = layer.encode.value ?? layer.encode.y;
    const { sets, combos: allCombos, total } = upsetData(table.column(kf).values, vf ? (table.column(vf).values as Float64Array) : undefined, { mode: style.mode, sort: style.order, sortSets: style.setOrder });
    const fmt = (v: number) => (vf ? ctx.format(v, vf) : integer.format(v));
    const W = 1 / ctx.pixel[0];
    const H = 1 / ctx.pixel[1];
    const family = theme.font.family;
    // Tight rows take a smaller text rather than one name out of two.
    const nameSize = Math.max(9, Math.min(12, upsetLayout(sets.length, 1, W, H, 0, 0).rowHeight - 3.5));
    const nameFont = `500 ${nameSize}px ${family}`;
    const nameWidth = Math.max(0, ...sets.map((s) => textWidth(s.name, nameFont))) + 18;
    // Set bars need room for their values; a narrow chart keeps short bars, a tiny one none.
    const wantBars = !style.setBars ? 0 : W >= 520 ? Math.min(150, W * 0.2) : W >= 300 ? 44 : 0;
    const g = upsetLayout(sets.length, allCombos.length, W, H, nameWidth, wantBars, style.maxIntersections);
    const combos = allCombos.slice(0, g.shown);
    const tx = (x: number) => x / W;
    const ty = (y: number) => 1 - y / H;
    const ink = parseColor(theme.text.primary);
    const main = parseColor(layer.style?.color ?? theme.palette.categorical[0]);
    const off = mix(ctx.surface, ink, 0.13);
    const setFill = mix(ctx.surface, ink, 0.5);
    const rowY = (i: number) => g.matrixTop + (i + 0.5) * g.rowHeight;
    const colX = (j: number) => g.matrixLeft + (j + 0.5) * g.colWidth;

    const stripes: number[] = [];
    const rects: number[] = [];
    const keys: string[] = [];
    const lines: number[] = [];
    const dots: number[] = [];
    const pale: number[] = [];
    const labels: MarkLabel[] = [];

    sets.forEach((_, i) => {
      if (i % 2) return;
      pushRect(stripes, { x0: tx(g.namesLeft), y0: ty(g.matrixTop + (i + 1) * g.rowHeight), x1: tx(g.matrixRight), y1: ty(g.matrixTop + i * g.rowHeight), fill: mix(ctx.surface, ink, 0.045), radii: [4, 4, 4, 4] });
    });

    // Intersection sizes, above the matrix.
    const vmax = Math.max(1e-9, ...combos.map((c) => c.value));
    const bw = Math.min(28, g.colWidth * 0.64);
    const valueSize = g.colWidth < 24 ? 10 : 11;
    combos.forEach((c, j) => {
      const fill = ctx.paint(main, c.row);
      const top = g.barBottom - (g.barBottom - g.barTop) * (c.value / vmax);
      pushRect(rects, { x0: tx(colX(j) - bw / 2), y0: ty(g.barBottom), x1: tx(colX(j) + bw / 2), y1: ty(top), fill, radii: [3, 3, 0, 0] });
      keys.push(c.key);
      if (style.labels) labels.push({ tx: tx(colX(j)), ty: ty(top), text: fmt(c.value), color: fill[3] < 0.6 ? theme.text.muted : theme.text.secondary, size: valueSize, weight: 600, align: 'center', baseline: 'bottom', dy: -3 });
      // The matrix column: every set as a pale dot, the members as linked ink dots.
      const on = ctx.paint(ink, c.row);
      const first = c.members[0];
      const last = c.members[c.members.length - 1];
      if (last > first) pushSegment(lines, tx(colX(j)), ty(rowY(first)), tx(colX(j)), ty(rowY(last)), on, Math.max(1.5, g.dot * 0.28));
      sets.forEach((_, i) => {
        const member = c.members.includes(i);
        const col = member ? on : off;
        (member ? dots : pale).push(tx(colX(j)), ty(rowY(i)), g.dot, 0, col[0], col[1], col[2], col[3], 0, 0, 0, 0, 0);
      });
    });

    // Set sizes, growing to the left of the names.
    const barsWidth = g.namesLeft - g.barsLeft;
    const smax = Math.max(1e-9, ...sets.map((s) => s.size));
    const sizeRoom = barsWidth >= 80 ? Math.max(...sets.map((s) => textWidth(fmt(s.size), `500 10px ${family}`))) + 10 : 0;
    const nameMax = g.matrixLeft - g.namesLeft - 14;
    sets.forEach((s, i) => {
      const y = rowY(i);
      labels.push({ tx: tx(g.matrixLeft), ty: ty(y), text: fit(s.name, nameMax, nameFont), color: theme.text.primary, size: nameSize, align: 'right', baseline: 'middle', dx: -8 });
      if (barsWidth < 20) return;
      const end = g.namesLeft - 6;
      const len = Math.max(2, (barsWidth - sizeRoom - 8) * (s.size / smax));
      const h = Math.min(16, g.rowHeight * 0.56);
      pushRect(rects, { x0: tx(end - len), y0: ty(y + h / 2), x1: tx(end), y1: ty(y - h / 2), fill: setFill, radii: [3, 3, 3, 3], axis: 1 });
      keys.push(`\u0000${s.name}`);
      if (sizeRoom && style.labels) labels.push({ tx: tx(end - len), ty: ty(y), text: fmt(s.size), color: theme.text.muted, size: 10, align: 'right', baseline: 'middle', dx: -5 });
    });

    const stripeDraws = batches(ctx, stripes, [], [], false).map((d) => ({ ...d, enter: 'fade' as const }));
    const barDraws = batches(ctx, rects, [], [], false);
    if (barDraws[0]) Object.assign(barDraws[0], { keys, data: new Float32Array(rects) });
    const points = (data: number[]) => {
      const b = ctx.renderer.createBatch('point');
      b.update(new Float32Array(data), data.length / LAYOUTS.point.stride);
      return { batch: b, enter: 'fade' as const };
    };
    const valueLabel = vf ? (ctx.fields[vf]?.label ?? vf) : ctx.theme.texts.elements;
    return {
      // Links over the pale dots they cross, members on top.
      draws: [...stripeDraws, ...barDraws, points(pale), ...batches(ctx, [], [], lines), points(dots)],
      hit: emptyHit(),
      labels,
      pick(px, py): ShapeHit | null {
        const x = px * W;
        const y = (1 - py) * H;
        const i = Math.floor((y - g.matrixTop) / g.rowHeight);
        if (x >= g.barsLeft && x < g.matrixLeft - 4) {
          const s = sets[i];
          if (!s) return null;
          return { title: s.name, rows: [{ label: valueLabel, value: fmt(s.size) }, { label: ctx.theme.texts.shareOfTotal, value: share(s.size, total) }] };
        }
        const j = Math.floor((x - g.matrixLeft) / g.colWidth);
        const c = combos[j];
        if (!c || y < g.barTop - 14) return null;
        const names = c.members.map((m) => sets[m].name);
        return {
          title: names.join(' ∩ '),
          rows: [
            { label: valueLabel, value: fmt(c.value) },
            { label: ctx.theme.texts.shareOfTotal, value: share(c.value, total) },
            { label: names.length > 1 ? ctx.theme.texts.combinedSets : ctx.theme.texts.only, value: names.length > 1 ? String(names.length) : names[0] },
          ],
        };
      },
    };
  },
};
