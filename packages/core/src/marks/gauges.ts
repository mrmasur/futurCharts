/**
 * Dashboard indicators: bullet graph, liquid fill gauge, activity rings and
 * segmented (LED) meter. Standalone marks laid out in px (they are rebuilt on
 * resize) and drawn with the shared primitives only.
 */
import { LAYOUTS } from '../render/layouts';
import type { Batch, RGBA } from '../render/types';
import { LinearScale, niceDomain } from '../scale/scales';
import { mix, parseColor, toCss, withAlpha } from '../util/color';
import { prefersReducedMotion } from './animate';
import { need } from './charts';
import { luminance, pushArc, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';

const TAU = Math.PI * 2;

const unitScales = () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) });
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;
const percent = (v: number) => new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(v);

function batchOf(ctx: BuildContext, kind: 'arc' | 'point' | 'rect' | 'line' | 'mesh', data: number[]): Batch {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

/** Shorten a text to `max` px, with an ellipsis. */
function fit(text: string, max: number, font: string): string {
  if (textWidth(text, font) <= max) return text;
  let s = text;
  while (s.length > 1 && textWidth(`${s}…`, font) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

interface Item {
  key: string;
  value: number;
  /** The row's goal (`encode.target`), NaN without one. */
  target: number;
  row: number;
}

/** One item per row of the table: `key`, `value` and, when encoded, its `target`. */
function readItems(ctx: BuildContext, mark: string): { items: Item[]; vf: string; tf?: string } {
  const { layer, table } = ctx.data;
  const kf = need(layer, 'key', mark);
  const vf = layer.encode.value ?? need(layer, 'y', mark);
  const tf = layer.encode.target && table.has(layer.encode.target) ? layer.encode.target : undefined;
  const keys = table.column(kf).values;
  const values = table.column(vf).values as Float64Array;
  const targets = tf ? (table.column(tf).values as Float64Array) : undefined;
  const items: Item[] = [];
  for (let i = 0; i < table.length; i++) {
    if (Number.isNaN(values[i])) continue;
    items.push({ key: String(keys[i]), value: values[i], target: targets ? targets[i] : NaN, row: i });
  }
  return { items, vf, tf };
}

export interface Zone {
  to: number;
  color: string;
}

/** Color of the zone a value falls in (zones end at `to`, the last one catches everything above). */
export function zoneColor(zones: Zone[] | undefined, value: number): string | undefined {
  const z = (zones ?? []).filter((q) => Number.isFinite(q.to)).sort((a, b) => a.to - b.to);
  if (!z.length) return undefined;
  return (z.find((q) => value <= q.to) ?? z[z.length - 1]).color;
}

/** Color of an item: its zone, the layer's fixed color, its `color` field, or the measure's color. */
function itemColor(ctx: BuildContext, d: Item, vf: string, zones?: Zone[]): RGBA {
  const { layer, table } = ctx.data;
  const zone = zoneColor(zones, d.value);
  const cf = layer.encode.color && table.has(layer.encode.color) ? layer.encode.color : undefined;
  const base = zone
    ? parseColor(zone)
    : layer.style?.color
      ? parseColor(layer.style.color)
      : cf
        ? ctx.categorical(String(table.column(cf).values[d.row]))
        : ctx.categorical(fieldLabel(ctx, vf));
  return ctx.paint(base, d.row);
}

// ------------------------------------------------------------- rows of bars

export interface RowsLayout {
  /** Name and value on a line above the bar (narrow charts) instead of beside it. */
  stacked: boolean;
  /** Extent of the bars, px from the left. */
  x0: number;
  x1: number;
  rowH: number;
  /** Top of the first row, px. */
  top: number;
  /** Bar thickness, px. */
  thickness: number;
  /** Top of the bar inside its row, px. */
  barTop: number;
  /** Height of the line above the bar (stacked), px. */
  header: number;
}

/**
 * Rows of horizontal indicators (bullet, LED meter): names on the left and values on the right when the
 * bars keep at least `minBar` px, otherwise both go on a line above each bar. `below`: px kept under
 * each bar (its ticks); `footer`: px kept under the last row.
 */
export function rowsLayout(o: {
  width: number;
  height: number;
  rows: number;
  nameWidth: number;
  valueWidth: number;
  below?: number;
  footer?: number;
  minBar?: number;
  maxThickness?: number;
}): RowsLayout {
  const below = o.below ?? 0;
  const footer = o.footer ?? 0;
  const n = Math.max(1, o.rows);
  const maxT = o.maxThickness ?? 26;
  const inlineBar = o.width - o.nameWidth - o.valueWidth;
  const build = (stacked: boolean): RowsLayout => {
    const header = stacked ? 17 : 0;
    const roomy = stacked ? 5 : 16;
    const rowH = Math.min(header + maxT + below + roomy + 10, Math.max(1, o.height - footer) / n);
    // Tight rows give up some of the space between them before thinning the bars.
    const pad = rowH - header - below - roomy < 12 ? Math.min(roomy, 8) : roomy;
    const thickness = Math.max(5, Math.min(maxT, rowH - header - below - pad));
    const block = header + thickness + below;
    return {
      stacked,
      x0: stacked ? 0 : o.nameWidth,
      x1: stacked ? o.width : o.width - o.valueWidth,
      rowH,
      top: Math.max(0, (o.height - footer - rowH * n) / 2),
      thickness,
      barTop: Math.max(header, (rowH - block) / 2 + header),
      header,
    };
  };
  if (inlineBar >= (o.minBar ?? 150)) return build(false);
  const stacked = build(true);
  // Too many rows for a line of text above each bar: shorter bars beside the names read better than hairlines.
  return stacked.thickness < 9 && inlineBar >= 90 ? build(false) : stacked;
}

// ------------------------------------------------------------------- bullet

/**
 * Value domain of a bullet row: from 0 (or the lowest mark) to the last qualitative range when everything
 * fits under it, otherwise to a round number past the largest of value, target and ranges.
 */
export function bulletDomain(value: number, target: number, ranges: number[]): [number, number] {
  const marks = [value, target, ...ranges].filter((v) => Number.isFinite(v));
  const lo = Math.min(0, ...marks);
  const peak = Math.max(0, ...marks);
  const top = ranges.length ? ranges[ranges.length - 1] : NaN;
  if (lo === 0 && Number.isFinite(top) && peak <= top && top > 0) return [0, top];
  if (peak === lo) return [lo, lo + 1];
  const [a, b] = niceDomain(lo, peak);
  return [lo < 0 ? a : 0, b];
}

/** How much ink each qualitative range takes, the first (worst) range the strongest. */
export function bandShades(n: number): number[] {
  if (n <= 1) return [0.13];
  return Array.from({ length: n }, (_, i) => 0.3 - (0.21 * i) / (n - 1));
}

/**
 * `bullet`: one row per `key` — the measure (`value`) as a bar, its `target` as a tick, over qualitative
 * ranges (`style.ranges`, or one field per threshold with `style.rangeFields`) from poor to good.
 */
export const bullet: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { table } = ctx.data;
    const { style, theme } = ctx;
    const { items, vf, tf } = readItems(ctx, 'bullet');
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (x: number) => x * px;
    const Y = (y: number) => 1 - y * py;
    const family = theme.font.family;
    const nameFont = `600 12px ${family}`;
    const valueFont = `650 12px ${family}`;

    const rangeFields = ((style.rangeFields ?? []) as string[]).filter((f) => table.has(f));
    const rows = items.map((d) => {
      const target = tf ? d.target : (style.target as number);
      const raw = rangeFields.length ? rangeFields.map((f) => table.column(f).values[d.row] as number) : ((style.ranges ?? []) as number[]);
      const ranges = raw.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      return { ...d, target, ranges, domain: bulletDomain(d.value, target, ranges), text: ctx.format(d.value, vf) };
    });
    if (style.shared && rows.length) {
      const lo = Math.min(...rows.map((r) => r.domain[0]));
      const hi = Math.max(...rows.map((r) => r.domain[1]));
      for (const r of rows) r.domain = [lo, hi];
    }

    const widest = Math.max(0, ...rows.map((r) => textWidth(r.key, nameFont))) + 16;
    const nameWidth = Math.min(W * 0.36, widest);
    const valueWidth = Math.max(0, ...rows.map((r) => textWidth(r.text, valueFont))) + 14;
    // A phone: a graduated axis under every row only clutters, and a cut name goes above its bar.
    const compact = W < 420;
    const base = { width: W, height: H, rows: rows.length, nameWidth, valueWidth, maxThickness: style.thickness as number, ...(compact && widest > nameWidth ? { minBar: Infinity } : {}) };
    // Ticks under every row when each has its own scale, once under the last row when they share one.
    let ticksPerRow = !!style.axis && !style.shared && !compact;
    const footer = style.axis && style.shared ? 18 : 0;
    let L = rowsLayout({ ...base, below: ticksPerRow ? 15 : 0, footer });
    if (ticksPerRow && L.thickness < 12) {
      ticksPerRow = false;
      L = rowsLayout({ ...base, footer });
    }
    const barW = Math.max(1, L.x1 - L.x0);
    const tickCount = Math.max(2, Math.min(6, Math.round(barW / 70)));
    // Graduations are round numbers: the decimals asked for the values would only add zeros.
    const valueFormat = ctx.fields[vf]?.format;
    const tickFormat = valueFormat ? { ...valueFormat, decimals: undefined } : undefined;

    const ink = parseColor(theme.text.primary);
    const bands: number[] = [];
    const measures: number[] = [];
    const targets: number[] = [];
    const ticks: number[] = [];
    const labels: MarkLabel[] = [];
    const r = style.radius as number;
    const muted = parseColor(theme.text.muted);

    rows.forEach((d, i) => {
      const y0 = L.top + i * L.rowH + L.barTop;
      const y1 = y0 + L.thickness;
      const cy = (y0 + y1) / 2;
      const [lo, hi] = d.domain;
      const at = (v: number) => L.x0 + clamp01((v - lo) / (hi - lo || 1)) * barW;
      const color = itemColor(ctx, d, vf);

      // Qualitative ranges, from the strongest shade (poor) to the lightest (good); a plain track without any.
      const ends = d.ranges.filter((v) => v > lo);
      if (!ends.length || ends[ends.length - 1] < hi) ends.push(hi);
      const shades = bandShades(ends.length);
      let from = lo;
      ends.forEach((to, k) => {
        const end = Math.min(to, hi);
        if (end <= from) return;
        const shade = style.tinted ? mix(ctx.surface, color, Math.min(1, shades[k] * 1.5)) : mix(ctx.surface, ink, shades[k]);
        const first = from === lo;
        const last = end >= hi;
        pushRect(bands, { x0: X(at(from)), y0: Y(y1), x1: X(at(end)), y1: Y(y0), fill: [shade[0], shade[1], shade[2], 1], radii: [first ? r : 0, last ? r : 0, last ? r : 0, first ? r : 0], axis: 1 });
        from = end;
      });

      // The measure: a slimmer bar from zero.
      const half = Math.max(1.5, L.thickness * (L.thickness < 14 ? 0.24 : 0.19));
      const zero = at(0);
      const end = at(d.value);
      pushRect(measures, { x0: X(Math.min(zero, end)), y0: Y(cy + half), x1: X(Math.max(zero, end)), y1: Y(cy - half), fill: color, radii: [0, 2, 2, 0], axis: 1 });

      // The target: a tick across most of the band.
      if (Number.isFinite(d.target)) {
        const tx = at(d.target);
        // A thin band (a phone): the tick takes its whole height.
        const th = L.thickness < 14 ? L.thickness / 2 + 1 : L.thickness * 0.38;
        pushRect(targets, { x0: X(tx - 1.5), y0: Y(cy + th), x1: X(tx + 1.5), y1: Y(cy - th), fill: ink, radii: [1, 1, 1, 1] });
      }

      const name = fit(d.key, (L.stacked ? W - valueWidth : nameWidth) - 6, nameFont);
      if (L.stacked) {
        const ly = y0 - L.header / 2 - 1;
        labels.push({ tx: X(0), ty: Y(ly), text: name, color: theme.text.primary, size: 12, weight: 600, align: 'left', baseline: 'middle' });
        labels.push({ tx: X(W), ty: Y(ly), text: d.text, color: theme.text.primary, size: 12, weight: 650, align: 'right', baseline: 'middle' });
      } else {
        labels.push({ tx: X(0), ty: Y(cy), text: name, color: theme.text.primary, size: 12, weight: 600, align: 'left', baseline: 'middle' });
        labels.push({ tx: X(W), ty: Y(cy), text: d.text, color: theme.text.primary, size: 12, weight: 650, align: 'right', baseline: 'middle' });
      }

      if (ticksPerRow || (footer && i === rows.length - 1)) {
        for (const t of new LinearScale(lo, hi, tickFormat).ticks(0, 1, tickCount)) {
          if (t.t < -1e-6 || t.t > 1 + 1e-6) continue;
          const tx = L.x0 + t.t * barW;
          pushSegment(ticks, X(tx), Y(y1 + 2), X(tx), Y(y1 + 4.5), withAlpha(muted, 0.7), 1);
          labels.push({
            tx: X(tx), ty: Y(y1 + 6), text: t.label, color: theme.text.muted, size: 10,
            align: t.t < 0.02 ? 'left' : t.t > 0.98 ? 'right' : 'center', baseline: 'top',
          });
        }
      }
    });

    const draws: MarkDraw[] = [];
    if (bands.length) draws.push({ batch: batchOf(ctx, 'rect', bands), pixelSnap: true, enter: 'fade' });
    if (measures.length) draws.push({ batch: batchOf(ctx, 'rect', measures), pixelSnap: true, data: new Float32Array(measures), keys: rows.map((d) => d.key) });
    if (targets.length) draws.push({ batch: batchOf(ctx, 'rect', targets), enter: 'fade' });
    if (ticks.length) draws.push({ batch: batchOf(ctx, 'line', ticks), enter: 'fade' });

    const rangeLabels = (style.rangeLabels ?? []) as string[];
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const y = (1 - ty) / py;
        const i = Math.floor((y - L.top) / L.rowH);
        const d = rows[i];
        if (!d || tx < 0 || tx > 1) return null;
        const out = [{ label: fieldLabel(ctx, vf), value: d.text }];
        if (Number.isFinite(d.target)) {
          out.push({ label: tf ? fieldLabel(ctx, tf) : 'Objectif', value: ctx.format(d.target, vf) });
          if (d.target !== 0) out.push({ label: 'Réalisé', value: percent(d.value / d.target) });
        }
        const band = d.ranges.findIndex((v) => d.value <= v);
        const level = rangeLabels[band < 0 ? d.ranges.length : band];
        if (d.ranges.length && level) out.push({ label: 'Niveau', value: level });
        return { title: d.key, rows: out };
      },
    };
  },
};

// ---------------------------------------------------------------------- led

/** Segments lit for a value: at least one as soon as there is something, all of them only when full. */
export function litSegments(value: number, min: number, max: number, count: number): number {
  const s = clamp01((value - min) / (max - min || 1));
  if (!(s > 0)) return 0;
  if (s >= 1) return count;
  return Math.max(1, Math.min(count - 1, Math.round(s * count)));
}

/**
 * `led`: one segmented meter per `key`, lit up to `value` between `style.min` and `style.max`
 * (or the row's `target`). With `style.zones`, each segment takes the color of its own level.
 */
export const led: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { style, theme } = ctx;
    const { items, vf, tf } = readItems(ctx, 'led');
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (x: number) => x * px;
    const Y = (y: number) => 1 - y * py;
    const family = theme.font.family;
    const nameFont = `600 12px ${family}`;
    const valueFont = `650 12px ${family}`;
    const rows = items.map((d) => ({ ...d, max: tf && Number.isFinite(d.target) ? d.target : (style.max as number), text: ctx.format(d.value, vf) }));
    const nameWidth = Math.min(W * 0.36, Math.max(0, ...rows.map((d) => textWidth(d.key, nameFont))) + 16);
    const valueWidth = Math.max(0, ...rows.map((d) => textWidth(d.text, valueFont))) + 14;
    const L = rowsLayout({ width: W, height: H, rows: rows.length, nameWidth, valueWidth, maxThickness: style.thickness as number });
    const barW = Math.max(1, L.x1 - L.x0);
    const gap = Math.max(0, style.gap as number);
    // Never thinner than 3 px a segment: fewer of them on a narrow chart.
    const count = Math.max(1, Math.min(Math.round(style.segments as number), Math.floor((barW + gap) / (3 + gap))));
    const step = (barW + gap) / count;
    const zones = style.zones as Zone[] | undefined;
    const track = style.track === 'auto' ? parseColor(theme.grid.y.color) : parseColor(style.track);
    const rects: number[] = [];
    const labels: MarkLabel[] = [];
    const rad = style.radius as number;
    rows.forEach((d, i) => {
      const y0 = L.top + i * L.rowH + L.barTop;
      const y1 = y0 + L.thickness;
      const cy = (y0 + y1) / 2;
      const min = style.min as number;
      const lit = litSegments(d.value, min, d.max, count);
      const own = itemColor(ctx, d, vf);
      for (let k = 0; k < count; k++) {
        const x0 = L.x0 + k * step;
        // A segment takes the color of the level it stands for.
        const level = min + ((k + 1) / count) * (d.max - min);
        const zone = zoneColor(zones, level);
        const fill = k < lit ? (zone ? ctx.paint(parseColor(zone), d.row) : own) : track;
        pushRect(rects, { x0: X(x0), y0: Y(y1), x1: X(x0 + step - gap), y1: Y(y0), fill, radii: [rad, rad, rad, rad], axis: 1 });
      }
      const name = fit(d.key, (L.stacked ? W - valueWidth : nameWidth) - 6, nameFont);
      const ly = L.stacked ? y0 - L.header / 2 - 1 : cy;
      labels.push({ tx: X(0), ty: Y(ly), text: name, color: theme.text.primary, size: 12, weight: 600, align: 'left', baseline: 'middle' });
      labels.push({ tx: X(W), ty: Y(ly), text: d.text, color: theme.text.primary, size: 12, weight: 650, align: 'right', baseline: 'middle' });
    });
    return {
      draws: rects.length ? [{ batch: batchOf(ctx, 'rect', rects), enter: 'fade' }] : [],
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const y = (1 - ty) / py;
        const d = rows[Math.floor((y - L.top) / L.rowH)];
        if (!d || tx < 0 || tx > 1) return null;
        const out = [{ label: fieldLabel(ctx, vf), value: d.text }];
        if (tf && Number.isFinite(d.target)) out.push({ label: fieldLabel(ctx, tf), value: ctx.format(d.target, vf) });
        out.push({ label: 'Niveau', value: percent(clamp01((d.value - style.min) / (d.max - style.min || 1))) });
        return { title: d.key, rows: out };
      },
    };
  },
};

// ------------------------------------------------------------------- liquid

/** The largest square cells for `n` items in a box, each with `labelH` px of text under it. */
export function gridCells(n: number, width: number, height: number, labelH = 0, gap = 12): { columns: number; rows: number; cellW: number; cellH: number; size: number } {
  let best = { columns: 1, rows: Math.max(1, n), cellW: width, cellH: height, size: -Infinity };
  for (let c = 1; c <= Math.max(1, n); c++) {
    const rows = Math.ceil(Math.max(1, n) / c);
    const cellW = (width - gap * (c - 1)) / c;
    const cellH = (height - gap * (rows - 1)) / rows;
    const size = Math.min(cellW, cellH - labelH);
    if (size > best.size + 1e-9) best = { columns: c, rows, cellW, cellH, size };
  }
  return best;
}

/** Half height of the container at `x` from its center: a circle of radius `r`, or a square with round corners. */
export function halfHeight(container: 'circle' | 'rounded', r: number, corner: number, x: number): number {
  const ax = Math.abs(x);
  if (ax >= r) return 0;
  if (container === 'circle') return Math.sqrt(r * r - x * x);
  const c = Math.min(corner, r);
  const edge = r - c;
  if (ax <= edge) return r;
  const d = ax - edge;
  return edge + Math.sqrt(Math.max(0, c * c - d * d));
}

/**
 * Height of the liquid's surface (share of the container, 0 at the bottom) at `x` in [-1, 1].
 * The wave flattens near empty and near full, so 0 % is empty and 100 % is full.
 */
export function liquidSurface(share: number, x: number, wave: { amplitude: number; waves: number; phase: number }): number {
  const s = clamp01(share);
  const a = wave.amplitude * Math.min(1, s * 6, (1 - s) * 6);
  return clamp01(s + a * Math.sin(x * Math.PI * wave.waves + wave.phase));
}

/** WCAG contrast ratio of two colors. */
export function contrast(a: RGBA, b: RGBA): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const DARK_INK: RGBA = [0.043, 0.043, 0.043, 1];
const LIGHT_INK: RGBA = [1, 1, 1, 1];

/**
 * Near-black or white ink over one background (the rule of every label drawn on a fill), or, across
 * several, whichever keeps the best contrast on the least favorable one.
 */
export function readableInk(backgrounds: RGBA[]): RGBA {
  if (backgrounds.length === 1) return luminance(backgrounds[0]) > 0.4 ? DARK_INK : LIGHT_INK;
  const worst = (ink: RGBA) => Math.min(...backgrounds.map((b) => contrast(ink, b)));
  return worst(LIGHT_INK) > worst(DARK_INK) ? LIGHT_INK : DARK_INK;
}

/**
 * Where the figure of a liquid gauge goes and in which ink. Centered whenever an ink reads on what it
 * crosses (the liquid, the empty part, or both); when it straddles two colors no ink reads on, it moves
 * into the larger part. `dy`: px down from the center; sizes in px, `share` in [0, 1].
 */
export function liquidFigure(o: { share: number; radius: number; size: number; amplitude: number; liquid: RGBA; empty: RGBA }): { dy: number; ink: RGBA; moved: boolean } {
  const r = o.radius;
  const level = r - 2 * r * clamp01(o.share);
  const a = o.amplitude * 2 * r;
  const half = o.size * 0.45;
  const onLiquid = level - a < half;
  const onEmpty = level + a > -half;
  if (!onEmpty) return { dy: 0, ink: readableInk([o.liquid]), moved: false };
  if (!onLiquid) return { dy: 0, ink: readableInk([o.empty]), moved: false };
  const ink = readableInk([o.liquid, o.empty]);
  if (Math.min(contrast(ink, o.liquid), contrast(ink, o.empty)) >= 3) return { dy: 0, ink, moved: false };
  return o.share >= 0.5
    ? { dy: (level + a + r) / 2, ink: readableInk([o.liquid]), moved: true }
    : { dy: (level - a - r) / 2, ink: readableInk([o.empty]), moved: true };
}

/**
 * `liquid`: one container per `key`, filled up to `value` between `style.min` and `style.max` (or the
 * row's `target`), with a gently waved surface and the figure in the middle.
 */
export const liquid: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales: unitScales,
  build(ctx) {
    const { style, theme } = ctx;
    const { items, vf, tf } = readItems(ctx, 'liquid');
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (x: number) => x * px;
    const Y = (y: number) => 1 - y * py;
    const family = theme.font.family;
    const container: 'circle' | 'rounded' = style.container === 'rounded' ? 'rounded' : 'circle';
    const n = items.length;
    const labelH = style.labels ? (tf ? 38 : 24) : 0;
    const grid = gridCells(n, W, H, labelH);
    const D = Math.max(8, Math.min(grid.size - 4, 280));
    const R = D / 2;
    const border = Math.max(0, Math.min(style.border as number, R * 0.2));
    const gap = border > 0 ? Math.max(2, Math.min(5, R * 0.06)) : 0;
    const Ri = Math.max(2, R - border - gap);
    const cornerOf = (r: number) => r * 0.36;
    const zones = style.zones as Zone[] | undefined;
    const totalW = grid.columns * grid.cellW + (grid.columns - 1) * 12;
    const totalH = grid.rows * grid.cellH + (grid.rows - 1) * 12;

    const cells = items.map((d, i) => {
      const col = i % grid.columns;
      const row = Math.floor(i / grid.columns);
      // An incomplete last row is centered.
      const inRow = row === grid.rows - 1 ? n - row * grid.columns : grid.columns;
      const shift = ((grid.columns - inRow) * (grid.cellW + 12)) / 2;
      const cx = (W - totalW) / 2 + shift + col * (grid.cellW + 12) + grid.cellW / 2;
      const top = (H - totalH) / 2 + row * (grid.cellH + 12) + (grid.cellH - D - labelH) / 2;
      const max = tf && Number.isFinite(d.target) ? d.target : (style.max as number);
      const min = style.min as number;
      const share = clamp01((d.value - min) / (max - min || 1));
      const color = itemColor(ctx, d, vf, zones);
      return { ...d, cx, cy: top + R, share, max, color, phase: i * 1.7 };
    });

    const wave = (c: (typeof cells)[number], phase: number, k = 1) => ({ amplitude: (style.amplitude as number) * k, waves: style.waves as number, phase: c.phase + phase });
    const SAMPLES = 56;
    /** Liquid of every container: a back wave (lighter, out of step) and the front one, with a smooth crest. */
    const fill = (phase: number): { mesh: number[]; crest: number[] } => {
      const mesh: number[] = [];
      const crest: number[] = [];
      for (const c of cells) {
        if (c.share <= 0) continue;
        // Slightly past the inner edge: the ring drawn over it gives a smooth outline.
        const r = Ri + 0.75;
        const layers: [RGBA, ReturnType<typeof wave>][] = [
          [withAlpha(c.color, 0.42), wave(c, phase + Math.PI * 0.85, 1.25)],
          [c.color, wave(c, phase)],
        ];
        for (const [color, w] of layers) {
          let prev: [number, number, number] | undefined;
          for (let k = 0; k <= SAMPLES; k++) {
            // Denser near the sides, where the container's edge is steep.
            const x = -r * Math.cos((Math.PI * k) / SAMPLES);
            const h = halfHeight(container, r, cornerOf(r), x);
            const bottom = c.cy + h;
            const level = c.cy + r - 2 * r * liquidSurface(c.share, x / r, w);
            const top = Math.min(bottom, Math.max(c.cy - h, level));
            const cur: [number, number, number] = [c.cx + x, top, bottom];
            if (prev) {
              pushVertex(mesh, X(prev[0]), Y(prev[1]), color);
              pushVertex(mesh, X(cur[0]), Y(cur[1]), color);
              pushVertex(mesh, X(cur[0]), Y(cur[2]), color);
              pushVertex(mesh, X(prev[0]), Y(prev[1]), color);
              pushVertex(mesh, X(cur[0]), Y(cur[2]), color);
              pushVertex(mesh, X(prev[0]), Y(prev[2]), color);
              if (prev[2] - prev[1] > 0.5 || cur[2] - cur[1] > 0.5) pushSegment(crest, X(prev[0]), Y(prev[1]), X(cur[0]), Y(cur[1]), color, 1);
            }
            prev = cur;
          }
        }
      }
      return { mesh, crest };
    };

    // Container: a light wash inside, then (over the liquid) a ring in the surface color and the border.
    const under: number[] = [];
    const over: number[] = [];
    const labels: MarkLabel[] = [];
    for (const c of cells) {
      const wash = withAlpha(c.color, style.wash as number);
      const clear: RGBA = [0, 0, 0, 0];
      if (container === 'circle') {
        pushArc(under, X(c.cx), Y(c.cy), 0, X(Ri), 0, TAU, 0, wash);
        if (border > 0) {
          pushArc(over, X(c.cx), Y(c.cy), X(Ri), X(Ri + gap + 0.5), 0, TAU, 0, ctx.surface);
          pushArc(over, X(c.cx), Y(c.cy), X(R - border), X(R), 0, TAU, 0, c.color);
        } else pushArc(over, X(c.cx), Y(c.cy), X(Ri), X(Ri + 2), 0, TAU, 0, ctx.surface);
      } else {
        const box = (r: number, fillColor: RGBA, stroke: RGBA, strokeWidth: number, out: number[]) => {
          const k = cornerOf(r);
          pushRect(out, { x0: X(c.cx - r), y0: Y(c.cy + r), x1: X(c.cx + r), y1: Y(c.cy - r), fill: fillColor, stroke, strokeWidth, radii: [k, k, k, k] });
        };
        box(Ri, wash, clear, 0, under);
        if (border > 0) {
          box(Ri + gap + 0.5, clear, ctx.surface, gap + 0.5, over);
          box(R, clear, c.color, border, over);
        } else box(Ri + 2, clear, ctx.surface, 2, over);
      }

      // The figure: an ink that reads on what it crosses (the liquid, the empty part, or both).
      const text = tf ? percent(c.share) : ctx.format(c.value, vf);
      let size = Math.min(44, Math.max(11, R * 0.44));
      const room = Ri * 1.5;
      const tw = textWidth(text, `650 ${size}px ${family}`);
      if (tw > room) size *= room / tw;
      if (size >= 9) {
        const opaque: RGBA = [c.color[0], c.color[1], c.color[2], 1];
        const figure = liquidFigure({
          share: c.share, radius: Ri, size, amplitude: style.amplitude as number,
          liquid: mix(ctx.surface, opaque, c.color[3]),
          empty: mix(ctx.surface, opaque, (style.wash as number) * c.color[3]),
        });
        labels.push({ tx: X(c.cx), ty: Y(c.cy + figure.dy), text, color: toCss(figure.ink), size: figure.moved ? size * 0.8 : size, weight: 650, align: 'center', baseline: 'middle' });
      }
      if (style.labels) {
        const maxW = grid.cellW + 8;
        labels.push({ tx: X(c.cx), ty: Y(c.cy + R + 7), text: fit(c.key, maxW, `600 12px ${family}`), color: theme.text.primary, size: 12, weight: 600, align: 'center', baseline: 'top' });
        if (tf) {
          const detail = `${ctx.format(c.value, vf)} / ${ctx.format(c.max, vf)}`;
          labels.push({ tx: X(c.cx), ty: Y(c.cy + R + 23), text: fit(detail, maxW, `10px ${family}`), color: theme.text.muted, size: 10, align: 'center', baseline: 'top' });
        }
      }
    }

    const first = fill(0);
    const mesh = batchOf(ctx, 'mesh', first.mesh);
    const crest = batchOf(ctx, 'line', first.crest);
    const kind = container === 'circle' ? 'arc' : 'rect';
    const animated = !!style.animated && !prefersReducedMotion();
    return {
      draws: [
        { batch: batchOf(ctx, kind, under), enter: 'fade' },
        { batch: mesh },
        { batch: crest, enter: 'fade' },
        { batch: batchOf(ctx, kind, over), enter: 'none' },
      ],
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const x = tx / px;
        const y = (1 - ty) / py;
        const c = cells.find((q) => Math.hypot(x - q.cx, y - q.cy) <= R + 2);
        if (!c) return null;
        const out = [{ label: fieldLabel(ctx, vf), value: ctx.format(c.value, vf) }];
        if (tf && Number.isFinite(c.target)) out.push({ label: fieldLabel(ctx, tf), value: ctx.format(c.target, vf) });
        out.push({ label: 'Remplissage', value: percent(c.share) });
        return { title: c.key, rows: out };
      },
      animate: animated
        ? (now) => {
            const next = fill((now / 1000) * (style.speed as number));
            mesh.update(new Float32Array(next.mesh), next.mesh.length / LAYOUTS.mesh.stride);
            crest.update(new Float32Array(next.crest), next.crest.length / LAYOUTS.line.stride);
            return true;
          }
        : undefined,
    };
  },
};

// ----------------------------------------------------------------- activity

/** Concentric rings from the outside in: `gap` is the share of a ring's slot left empty. */
export function activityRings(n: number, outer: number, innerShare: number, gap: number): { inner: number; outer: number }[] {
  const r0 = outer * clamp01(innerShare);
  const slot = (outer - r0) / Math.max(1, n);
  return Array.from({ length: n }, (_, i) => ({ outer: outer - i * slot, inner: outer - i * slot - slot * (1 - clamp01(gap)) }));
}

export interface ActivityLayout {
  /** Center and radius of the rings, px. */
  cx: number;
  cy: number;
  r: number;
  /** The list of indicators, when there is room for it: beside the rings on a wide chart, under them otherwise. */
  list?: { x: number; y: number; width: number; rowH: number; side: boolean };
}

/** Rings and their list in a box: side by side when the box is wide, stacked when it is not. */
export function activityLayout(width: number, height: number, n: number, list: boolean): ActivityLayout {
  const alone: ActivityLayout = { cx: width / 2, cy: height / 2, r: Math.max(4, Math.min(width, height) / 2) };
  if (!list || n === 0) return alone;
  if (width >= height * 1.35) {
    // A narrow chart gives the names more of the width.
    const narrow = width < 420;
    const between = narrow ? 14 : 24;
    const d = Math.min(height, width * (narrow ? 0.42 : 0.5));
    const listW = Math.min(250, width - d - between);
    if (listW < 96) return alone;
    const x = (width - (d + between + listW)) / 2;
    const rowH = Math.min(38, height / n);
    return { cx: x + d / 2, cy: height / 2, r: d / 2, list: { x: x + d + between, y: (height - rowH * n) / 2, width: listW, rowH, side: true } };
  }
  const rowH = 22;
  const d = Math.min(width, height - rowH * n - 12);
  if (d < 90) return alone;
  const y = (height - (d + 12 + rowH * n)) / 2;
  const listW = Math.min(width, 280);
  return { cx: width / 2, cy: y + d / 2, r: d / 2, list: { x: (width - listW) / 2, y: y + d + 12, width: listW, rowH, side: false } };
}

/**
 * `activity`: one ring per `key`, closed when `value` reaches its goal (the row's `target`, or `style.max`),
 * on a track of its own color, with round ends; past the goal the ring starts a second lap.
 */
export const activity: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'circle',
  scales: unitScales,
  build(ctx) {
    const { style, theme } = ctx;
    const { items, vf, tf } = readItems(ctx, 'activity');
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (x: number) => x * px;
    const Y = (y: number) => 1 - y * py;
    const family = theme.font.family;
    const n = items.length;
    const single = n === 1;
    const A = activityLayout(W, H, n, !!style.labels && !single);
    const R = Math.max(4, A.r - 2);
    const geo = activityRings(n, R, style.innerRadius as number, single ? 0 : (style.gap as number));
    const corner = style.rounded ? 999 : 0;
    const rings = items.map((d, i) => {
      const goal = tf && Number.isFinite(d.target) ? d.target : (style.max as number);
      const share = goal > 0 ? Math.max(0, d.value / goal) : 0;
      // The data's categorical color by default: a ring is an indicator of its own.
      const color = ctx.data.layer.style?.color || ctx.data.layer.encode.color ? itemColor(ctx, d, vf) : ctx.paint(ctx.categorical(d.key), d.row);
      return { ...d, goal, share, color, ...geo[i] };
    });

    const tracks: number[] = [];
    const arcs: number[] = [];
    const laps: number[] = [];
    const cx = X(A.cx);
    const cy = Y(A.cy);
    for (const g of rings) {
      const track = style.track === 'auto' ? withAlpha(g.color, 0.18) : parseColor(style.track);
      pushArc(tracks, cx, cy, X(g.inner), X(g.outer), 0, TAU, 0, track);
      // A closed ring has no ends to round (a rounded end would show a seam at the top).
      pushArc(arcs, cx, cy, X(g.inner), X(g.outer), 0, Math.min(1, g.share) * TAU, 0, g.color, g.share >= 1 ? 0 : corner);
      // Past the goal: a second lap of the same color over the start of the first, its end cut out of
      // it by a thin notch of the surface (a darker lap would read as the track on a dark theme).
      if (g.share > 1) {
        const end = Math.min(1, g.share - 1) * TAU;
        const notch = 3 / ((g.inner + g.outer) / 2);
        if (end + notch < TAU) pushArc(laps, cx, cy, X(g.inner), X(g.outer), Math.min(notch, end / 2), end + notch, 0, ctx.surface, corner);
        pushArc(laps, cx, cy, X(g.inner), X(g.outer), 0, end, 0, g.color, corner);
      }
    }

    const labels: MarkLabel[] = [];
    const dots: number[] = [];
    const hole = single ? rings[0].inner : (rings[n - 1]?.inner ?? 0);
    if (single && style.center) {
      // One ring: its figure in the middle, its name under it.
      const g = rings[0];
      const text = percent(g.share);
      let size = Math.min(40, Math.max(12, hole * 0.5));
      const tw = textWidth(text, `650 ${size}px ${family}`);
      if (tw > hole * 1.5) size *= (hole * 1.5) / tw;
      const named = hole > 44;
      labels.push({ tx: cx, ty: cy, text, color: theme.text.primary, size, weight: 650, align: 'center', baseline: 'middle', dy: named ? -7 : 0 });
      // As wide as the hole is at the height of that line.
      const chord = 2 * Math.sqrt(Math.max(0, hole * hole - (size / 2 + 10) ** 2)) - 10;
      if (named) labels.push({ tx: cx, ty: cy, text: fit(g.key, chord, `11px ${family}`), color: theme.text.secondary, size: 11, align: 'center', baseline: 'top', dy: size / 2 - 3 });
    }
    if (A.list) {
      const { x, y, width, rowH, side } = A.list;
      const twoLines = side && rowH >= 34;
      rings.forEach((g, i) => {
        const top = y + i * rowH;
        const line = twoLines ? top + rowH / 2 - 8 : top + rowH / 2;
        const pct = percent(g.share);
        const pctW = textWidth(pct, `650 12px ${family}`);
        dots.push(X(x + 5), Y(line), 9, 0, g.color[0], g.color[1], g.color[2], g.color[3], 0, 0, 0, 0, 0);
        const detail = `${ctx.format(g.value, vf)} / ${ctx.format(g.goal, vf)}`;
        const nameMax = width - 18 - pctW - 10;
        const name = fit(g.key, nameMax, `600 12px ${family}`);
        labels.push({ tx: X(x + 18), ty: Y(line), text: name, color: theme.text.primary, size: 12, weight: 600, align: 'left', baseline: 'middle' });
        labels.push({ tx: X(x + width), ty: Y(line), text: pct, color: theme.text.primary, size: 12, weight: 650, align: 'right', baseline: 'middle' });
        if (twoLines) labels.push({ tx: X(x + 18), ty: Y(line + 16), text: fit(detail, width - 18, `10px ${family}`), color: theme.text.muted, size: 10, align: 'left', baseline: 'middle' });
        else if (!side) {
          // One line: the detail between the name and the share, when it fits.
          const used = 18 + textWidth(name, `600 12px ${family}`) + 12;
          const dw = textWidth(detail, `10px ${family}`);
          if (used + dw + 12 + pctW <= width) labels.push({ tx: X(x + width - pctW - 12), ty: Y(line), text: detail, color: theme.text.muted, size: 10, align: 'right', baseline: 'middle' });
        }
      });
    }

    const draws: MarkDraw[] = [
      { batch: batchOf(ctx, 'arc', tracks), enter: 'fade' },
      { batch: batchOf(ctx, 'arc', arcs), data: new Float32Array(arcs), keys: rings.map((g) => g.key) },
    ];
    if (laps.length) draws.push({ batch: batchOf(ctx, 'arc', laps) });
    if (dots.length) draws.push({ batch: batchOf(ctx, 'point', dots), enter: 'fade' });

    const describe = (g: (typeof rings)[number]): ShapeHit => ({
      title: g.key,
      rows: [
        { label: fieldLabel(ctx, vf), value: ctx.format(g.value, vf) },
        { label: tf ? fieldLabel(ctx, tf) : 'Objectif', value: ctx.format(g.goal, vf) },
        { label: 'Réalisé', value: percent(g.share) },
      ],
    });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const x = tx / px;
        const y = (1 - ty) / py;
        const r = Math.hypot(x - A.cx, y - A.cy);
        const g = rings.find((q) => r >= q.inner && r <= q.outer);
        if (g) return describe(g);
        if (A.list && x >= A.list.x && x <= A.list.x + A.list.width) {
          const row = rings[Math.floor((y - A.list.y) / A.list.rowH)];
          if (row) return describe(row);
        }
        return null;
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const GAUGES_MARKS: Record<string, MarkDefinition> = { bullet, liquid, activity, led };
