/**
 * Layout helpers of the comparison marks (Likert scale, tornado, variable-width bars, ranking):
 * pure functions in px or in shares, without any DOM, so they can be tested alone.
 */
import type { RGBA } from '../render/types';
import { mix } from '../util/color';

// --------------------------------------------------------------------- rows

export interface RowBands {
  /** Height of one row, px. */
  rowH: number;
  /** Top of the first row, px. */
  top: number;
  /** Bar thickness, px. */
  thickness: number;
  /** Top of the bar inside its row, px (under the row's header line). */
  barTop: number;
}

/**
 * Rows of horizontal bars in a box `height` px tall: `above` / `below` px are kept for a title strip and a
 * footer, `header` px above each bar for a line of text. Rows are centered when they do not need the whole
 * height; when they are many, the space between them shrinks before the bars do.
 */
export function rowBands(o: { height: number; rows: number; above?: number; below?: number; header?: number; maxThickness: number; spacing?: number }): RowBands {
  const n = Math.max(1, o.rows);
  const above = o.above ?? 0;
  const below = o.below ?? 0;
  const header = o.header ?? 0;
  const spacing = o.spacing ?? 16;
  const room = Math.max(1, o.height - above - below);
  const rowH = Math.min(header + o.maxThickness + spacing, room / n);
  const free = Math.max(0, rowH - header);
  const pad = free >= o.maxThickness + spacing ? spacing : Math.max(2, Math.min(spacing, free * 0.3));
  const thickness = Math.max(2, Math.min(o.maxThickness, free - pad));
  return {
    rowH,
    top: above + Math.max(0, (room - rowH * n) / 2),
    thickness,
    barTop: header + Math.max(0, (free - thickness) / 2),
  };
}

export interface RowTable {
  /** Names (and figures) on a line above each bar instead of beside it. */
  stacked: boolean;
  /** Room for a name, px. */
  nameWidth: number;
  /** Extent of the bars, px from the left. */
  x0: number;
  x1: number;
  bands: RowBands;
}

/**
 * Rows of a table-like chart: `lead` px (rank…), a name, bars, then `after` px of figures. When the bars
 * would be shorter than `minBar`, names and figures go on a line above each bar; and when that leaves
 * hairlines (many rows in a small box), back beside the bars with a narrower name column.
 */
export function rowTable(o: {
  width: number;
  height: number;
  rows: number;
  nameWidth: number;
  lead?: number;
  after?: number;
  minBar?: number;
  above?: number;
  below?: number;
  maxThickness: number;
}): RowTable {
  const lead = o.lead ?? 0;
  const after = o.after ?? 0;
  const bandsOf = (header: number) =>
    rowBands({ height: o.height, rows: o.rows, above: o.above, below: o.below, header, maxThickness: o.maxThickness, spacing: header ? 10 : Math.max(16, o.maxThickness * 0.9) });
  const inline = (nameWidth: number): RowTable => ({ stacked: false, nameWidth, x0: lead + nameWidth, x1: o.width - after, bands: bandsOf(0) });
  if (o.width - lead - o.nameWidth - after >= (o.minBar ?? 130)) return inline(o.nameWidth);
  const stacked: RowTable = { stacked: true, nameWidth: Math.max(1, o.width - lead - after), x0: 0, x1: o.width, bands: bandsOf(17) };
  if (stacked.bands.thickness >= 7) return stacked;
  const narrow = Math.min(o.nameWidth, Math.max(40, o.width * 0.32));
  return o.width - lead - narrow - after >= 60 ? inline(narrow) : stacked;
}

// ------------------------------------------------------------------- likert

export interface LikertSegment {
  /** Index of the answer, from the most unfavourable. */
  level: number;
  /** Extent in shares of the respondents, 0 being the middle of the scale (negative: to the left). */
  from: number;
  to: number;
  share: number;
}

export interface LikertRow {
  /** Segments of the diverging stack, left to right (the neutral answer only when it sits in the middle). */
  segments: LikertSegment[];
  /** How far the stack reaches on each side of the middle, in shares (both positive). */
  left: number;
  right: number;
  /** Shares of the unfavourable, favourable and neutral answers. */
  negative: number;
  positive: number;
  neutral: number;
  /** Number of answers. */
  total: number;
}

/**
 * Diverging stack of one question. `values[i]` is the number of answers at level i, from the most
 * unfavourable to the most favourable; with an odd number of levels the middle one is neutral.
 * `center`: the neutral answer straddles the middle; `aside`: it is left out of the stack (drawn apart).
 * `hidden` levels keep their place in the total but take no room.
 */
export function likertRow(values: number[], mode: 'center' | 'aside' = 'center', hidden: boolean[] = []): LikertRow {
  const n = values.length;
  const v = values.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const total = v.reduce((a, x) => a + x, 0);
  const share = v.map((x, i) => (total > 0 && !hidden[i] ? x / total : 0));
  const half = Math.floor(n / 2);
  const mid = n % 2 === 1 ? half : -1;
  const neutral = mid >= 0 ? share[mid] : 0;
  const inner = mode === 'center' ? neutral / 2 : 0;
  const segments: LikertSegment[] = [];
  // `0 - inner` rather than `-inner`: an even scale starts at 0, not at -0.
  let x = 0 - inner;
  for (let i = half - 1; i >= 0; i--) {
    segments.push({ level: i, from: x - share[i], to: x, share: share[i] });
    x -= share[i];
  }
  const left = 0 - x;
  segments.reverse();
  if (mid >= 0 && mode === 'center') segments.push({ level: mid, from: 0 - inner, to: inner, share: neutral });
  x = inner;
  for (let i = n - half; i < n; i++) {
    segments.push({ level: i, from: x, to: x + share[i], share: share[i] });
    x += share[i];
  }
  const sum = (a: number, b: number) => share.slice(a, b).reduce((s, w) => s + w, 0);
  return { segments, left, right: x, negative: sum(0, half), positive: sum(n - half, n), neutral, total };
}

/**
 * One color per level of a diverging scale: the extremes take the full hue, the levels nearer the middle
 * fade towards the surface, the middle of an odd scale is `neutral`.
 */
export function likertColors(n: number, negative: RGBA, positive: RGBA, neutral: RGBA, surface: RGBA): RGBA[] {
  const half = Math.floor(n / 2);
  const tone = (j: number) => (half <= 1 ? 1 : 1 - 0.56 * (j / (half - 1)));
  const solid = (c: RGBA): RGBA => [c[0], c[1], c[2], 1];
  return Array.from({ length: n }, (_, i) => {
    if (i < half) return solid(mix(surface, negative, tone(i)));
    if (i >= n - half) return solid(mix(surface, positive, tone(n - 1 - i)));
    return solid(neutral);
  });
}

// ------------------------------------------------------------------ tornado

export interface TornadoItem {
  key: string;
  left: number;
  right: number;
  row: number;
}

/**
 * How much a row weighs: the sum of both sides (butterfly), or with a `base`, the span covered around it
 * (sensitivity analysis). Missing values count for nothing.
 */
export function tornadoAmplitude(d: { left: number; right: number }, base = NaN): number {
  const l = Number.isFinite(d.left) ? d.left : NaN;
  const r = Number.isFinite(d.right) ? d.right : NaN;
  if (Number.isFinite(base)) {
    const marks = [base, l, r].filter((v) => !Number.isNaN(v));
    return Math.max(...marks) - Math.min(...marks);
  }
  return (Number.isNaN(l) ? 0 : Math.abs(l)) + (Number.isNaN(r) ? 0 : Math.abs(r));
}

/** Rows from the widest to the narrowest (the funnel shape of a tornado); equal rows keep the data order. */
export function tornadoOrder<T extends { left: number; right: number }>(items: T[], base = NaN): T[] {
  return items
    .map((d, i) => ({ d, i, a: tornadoAmplitude(d, base) }))
    .sort((p, q) => q.a - p.a || p.i - q.i)
    .map((e) => e.d);
}

export interface ButterflyColumns {
  /** Names above the bars (narrow chart) instead of between them. */
  stacked: boolean;
  /** Length of the longest bar on each side, px. */
  side: number;
  /** Inner ends of the left and right bars, px from the left: the names sit between them. */
  leftEnd: number;
  rightStart: number;
}

/**
 * Columns of a butterfly chart: bars of equal reach on both sides of a central gutter as wide as the
 * names (`nameWidth`), value labels (`valueWidth`) past the bar ends. When the bars would be shorter
 * than `minSide`, the names move above the bars and the two sides touch.
 */
export function butterflyColumns(o: { width: number; nameWidth: number; valueWidth: number; minSide?: number }): ButterflyColumns {
  const gutter = Math.min(o.nameWidth, o.width * 0.42);
  const side = (o.width - gutter - 2 * o.valueWidth) / 2;
  if (side >= (o.minSide ?? 64)) return { stacked: false, side, leftEnd: o.valueWidth + side, rightStart: o.valueWidth + side + gutter };
  const gap = 3;
  const s = Math.max(1, (o.width - gap - 2 * o.valueWidth) / 2);
  return { stacked: true, side: s, leftEnd: o.valueWidth + s, rightStart: o.valueWidth + s + gap };
}

// ----------------------------------------------------------------- variwide

/** Columns side by side, as wide as their `widths` (any unit), over `total` px with `gap` px between them. */
export function variwideColumns(widths: number[], total: number, gap = 0): { x0: number; x1: number }[] {
  const w = widths.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = w.reduce((a, v) => a + v, 0);
  const n = w.filter((v) => v > 0).length;
  const g = n > 1 ? Math.min(gap, (total * 0.25) / (n - 1)) : 0;
  const unit = sum > 0 ? Math.max(0, total - g * Math.max(0, n - 1)) / sum : 0;
  let x = 0;
  return w.map((v) => {
    const c = { x0: x, x1: x + v * unit };
    if (v > 0) x = c.x1 + g;
    return c;
  });
}

/**
 * Labels under columns of uneven width: each goes on the first line (level) where it does not run into
 * the previous label of that line, kept between `min` and `max`. `level` is -1 when no line has room.
 */
export function staggerLabels(items: { center: number; width: number }[], o: { levels: number; min: number; max: number; gap?: number }): { level: number; x: number }[] {
  const gap = o.gap ?? 8;
  const lastRight = Array.from({ length: Math.max(1, o.levels) }, () => -Infinity);
  return items.map(({ center, width }) => {
    if (!(width > 0) || width > o.max - o.min) return { level: -1, x: center };
    const x = Math.min(o.max - width / 2, Math.max(o.min + width / 2, center));
    for (let l = 0; l < lastRight.length; l++) {
      if (x - width / 2 >= lastRight[l] + gap) {
        lastRight[l] = x + width / 2;
        return { level: l, x };
      }
    }
    return { level: -1, x };
  });
}

// ------------------------------------------------------------------ barRank

export interface RankedItem {
  key: string;
  value: number;
  /** Value of the previous period, NaN without one. */
  previous: number;
  row: number;
  /** 1 for the largest value. */
  rank: number;
  /** Rank in the previous period, NaN for a newcomer. */
  previousRank: number;
  /** Places gained (positive) or lost since the previous period; NaN for a newcomer. */
  move: number;
  /** Relative change of the value, NaN when there is nothing to compare it with. */
  change: number;
}

/** Rank items by value, and by their previous value: places moved and relative change. Sorted by rank. */
export function rankItems(items: { key: string; value: number; previous: number; row: number }[]): RankedItem[] {
  const order = (get: (i: number) => number) => {
    const idx = items.map((_, i) => i).filter((i) => Number.isFinite(get(i)));
    idx.sort((a, b) => get(b) - get(a) || a - b);
    const rank = new Map<number, number>();
    idx.forEach((i, r) => rank.set(i, r + 1));
    return rank;
  };
  const now = order((i) => items[i].value);
  const before = order((i) => items[i].previous);
  return items
    .map((d, i) => {
      const rank = now.get(i) ?? NaN;
      const previousRank = before.get(i) ?? NaN;
      return {
        ...d,
        rank,
        previousRank,
        move: previousRank - rank,
        change: Number.isFinite(d.previous) && d.previous !== 0 ? (d.value - d.previous) / Math.abs(d.previous) : NaN,
      };
    })
    .filter((d) => Number.isFinite(d.rank))
    .sort((a, b) => a.rank - b.rank);
}
