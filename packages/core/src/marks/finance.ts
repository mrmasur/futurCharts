/**
 * Financial reporting charts in the manner of standardized management reports: actual (`value`) as a
 * dark solid, budget (`target`) as an outline of the same ink, previous year (`previous`) as a light
 * grey solid; favourable variances in the theme's good color, unfavourable ones in its bad color.
 * Standalone marks laid out in px (rebuilt on resize), drawn with the shared primitives only.
 */
import { LAYOUTS } from '../render/layouts';
import type { Batch, RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import type { Theme } from '../theme/theme';
import { mix, parseColor } from '../util/color';
import { need } from './charts';
import { rowBands } from './compareLayout';
import { pushRect, pushSegment } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';

// ------------------------------------------------------------- pure layout

/** One step of a bridge: a floating bar from `from` to `to` (a total starts from zero). */
export interface BridgeStep {
  key: string;
  row: number;
  /** Change brought by the step (a total: its level). */
  delta: number;
  from: number;
  to: number;
  total: boolean;
}

/**
 * Lay out a bridge: each step floats from the running level to the next; a step listed in `subtotals`
 * starts again from zero, at the given value when it has one (else at the running level), which
 * becomes the running level.
 */
export function bridgeSteps(items: { key: string; value: number; row?: number }[], subtotals: Iterable<string>): BridgeStep[] {
  const totals = new Set(subtotals);
  let level = 0;
  return items.map((d, i) => {
    const row = d.row ?? i;
    if (totals.has(d.key)) {
      level = Number.isFinite(d.value) ? d.value : level;
      return { key: d.key, row, delta: level, from: 0, to: level, total: true };
    }
    const v = Number.isFinite(d.value) ? d.value : 0;
    const from = level;
    level += v;
    return { key: d.key, row, delta: v, from, to: level, total: false };
  });
}

/** `good` / `bad` for a variance, or `none` when it is zero or unknown. A rise is good when `upIsGood`. */
export type Tone = 'good' | 'bad' | 'none';
export function toneOf(variance: number, upIsGood: boolean): Tone {
  if (!Number.isFinite(variance) || variance === 0) return 'none';
  return variance > 0 === upIsGood ? 'good' : 'bad';
}

/** Absolute and relative variance of an actual against its budget. */
export function varianceOf(actual: number, budget: number): { abs: number; rel: number } {
  const abs = actual - budget;
  return { abs, rel: Number.isFinite(budget) && budget !== 0 ? abs / Math.abs(budget) : NaN };
}

/** A period of `periodBars`: past when it has an actual; its variance against the budget. */
export interface PeriodItem {
  key: string;
  row: number;
  actual: number;
  budget: number;
  previous: number;
  past: boolean;
  variance: number;
}
export function periodItems(rows: { key: string; actual: number; budget: number; previous: number }[]): PeriodItem[] {
  return rows.map((d, row) => {
    const past = Number.isFinite(d.actual);
    return { ...d, row, past, variance: past && Number.isFinite(d.budget) ? d.actual - d.budget : NaN };
  });
}

/** Show one category label in `every`: the widest label must fit its share of slots. */
export function labelStride(widest: number, slot: number): number {
  return Math.max(1, Math.ceil((widest + 6) / Math.max(1, slot)));
}

// ----------------------------------------------------------------- helpers

const unitScales = () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) });
const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;
const auto = (value: unknown, fallback: string): string => (typeof value === 'string' && value && value !== 'auto' ? value : fallback);
const widest = (texts: string[], font: string) => Math.max(0, ...texts.map((t) => textWidth(t, font)));
const signedPercent = (v: number) =>
  new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0, signDisplay: 'exceptZero' }).format(v);
const CLEAR: RGBA = [0, 0, 0, 0];

function batchOf(ctx: BuildContext, kind: 'rect' | 'line' | 'point', data: number[]): Batch {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

/** The chart box in px (y down from the top), and the way back to scale space. */
function frame(ctx: BuildContext) {
  const [px, py] = ctx.pixel;
  return { W: 1 / px, H: 1 / py, X: (v: number) => v * px, Y: (v: number) => 1 - v * py };
}
type Frame = ReturnType<typeof frame>;

/** A rect given in px (left, top, right, bottom). */
function box(out: number[], F: Frame, l: number, t: number, r: number, b: number, fill: RGBA, o: { stroke?: RGBA; width?: number; radius?: number; axis?: 0 | 1; ends?: 'top' | 'bottom' | 'left' | 'right' } = {}): void {
  const rad = o.radius ?? 0;
  const radii: [number, number, number, number] =
    o.ends === 'top' ? [rad, rad, 0, 0] : o.ends === 'bottom' ? [0, 0, rad, rad] : o.ends === 'right' ? [0, rad, rad, 0] : o.ends === 'left' ? [rad, 0, 0, rad] : [rad, rad, rad, rad];
  pushRect(out, { x0: F.X(Math.min(l, r)), y0: F.Y(Math.max(t, b)), x1: F.X(Math.max(l, r)), y1: F.Y(Math.min(t, b)), fill, stroke: o.stroke, strokeWidth: o.width, radii, axis: o.axis ?? 0 });
}

/** The colors of the notation: actual ink, previous-year grey, good / bad. */
function palette(ctx: BuildContext) {
  const { theme, style } = ctx;
  const ink = parseColor(theme.text.primary);
  const grey = mix(ctx.surface, parseColor(theme.text.muted), 0.42);
  const good = parseColor(auto(style.good, theme.marks.kpi.good));
  const bad = parseColor(auto(style.bad, theme.marks.kpi.bad));
  const upIsGood = style.upIsGood !== false;
  const toneColor = (t: Tone): RGBA => (t === 'good' ? good : t === 'bad' ? bad : parseColor(theme.text.muted));
  const toneInk = (t: Tone): string => (t === 'good' ? auto(style.good, theme.marks.kpi.good) : t === 'bad' ? auto(style.bad, theme.marks.kpi.bad) : theme.text.muted);
  return { ink, grey: [grey[0], grey[1], grey[2], 1] as RGBA, surface: [ctx.surface[0], ctx.surface[1], ctx.surface[2], 1] as RGBA, upIsGood, toneColor, toneInk };
}

/** A signed figure: `+12`, `−8`. */
function signed(ctx: BuildContext, v: number, field: string): string {
  const s = ctx.format(Math.abs(v), field);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/** Cut a name into at most two lines of `max` px; the second ends with "…" when it is still too long. */
function twoLines(text: string, max: number, font: string): string[] {
  if (textWidth(text, font) <= max) return [text];
  const words = text.split(/\s+/);
  let first = words[0];
  let i = 1;
  while (i < words.length && textWidth(`${first} ${words[i]}`, font) <= max) first += ` ${words[i++]}`;
  let rest = words.slice(i).join(' ');
  const cut = (s: string) => {
    if (textWidth(s, font) <= max) return s;
    while (s.length > 1 && textWidth(`${s}…`, font) > max) s = s.slice(0, -1);
    return `${s.trimEnd()}…`;
  };
  if (!rest) return [cut(first)];
  rest = cut(rest);
  return [cut(first), rest];
}

/** A small key: swatches and names, left to right from `x`, centered on `y` px. */
function keyRow(out: number[], labels: MarkLabel[], F: Frame, theme: Theme, x: number, y: number, entries: { name: string; fill: RGBA; stroke?: RGBA }[]): void {
  const font = `500 11px ${theme.font.family}`;
  for (const e of entries) {
    box(out, F, x, y - 5, x + 12, y + 5, e.fill, { stroke: e.stroke, width: e.stroke ? 1.25 : 0, radius: 2 });
    labels.push({ tx: F.X(x + 17), ty: F.Y(y), text: e.name, color: theme.text.secondary, size: 11, weight: 500, align: 'left', baseline: 'middle' });
    x += 17 + textWidth(e.name, font) + 14;
  }
}

// ------------------------------------------------------------------- bridge

/**
 * `bridge`: a profit bridge. One step per row (`key`), its change (`value`); steps listed in
 * `style.subtotals` (or flagged by the boolean field `style.totalField`) start again from zero as solid
 * bars. Changes float between the running levels, joined by thin connectors, each with its figure.
 */
export const bridge: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'bridge');
    const vf = layer.encode.value ?? need(layer, 'y', 'bridge');
    const k = table.column(kf).values;
    const v = table.column(vf).values as Float64Array;
    const flagged = new Set<string>((style.subtotals as string[] | undefined) ?? []);
    const tf = typeof style.totalField === 'string' && style.totalField && table.has(style.totalField) ? style.totalField : '';
    if (tf) {
      const t = table.column(tf).values;
      for (let i = 0; i < table.length; i++) if (t[i] === 1 || t[i] === 'true') flagged.add(String(k[i]));
    }
    const steps = bridgeSteps(Array.from({ length: table.length }, (_, i) => ({ key: String(k[i]), value: v[i], row: i })), flagged);
    const P = palette(ctx);
    const F = frame(ctx);
    const { W, H, X, Y } = F;
    const family = theme.font.family;
    const figFont = `600 11px ${family}`;
    const nameFont = `500 11px ${family}`;
    const texts = steps.map((s) => (s.total ? ctx.format(s.to, vf) : signed(ctx, s.delta, vf)));
    const tone = (s: BridgeStep): Tone => (s.total ? 'none' : toneOf(s.delta, P.upIsGood));
    const fill = (s: BridgeStep) => ctx.paint(s.total ? P.ink : P.toneColor(tone(s)), s.row);
    const lo = Math.min(0, ...steps.flatMap((s) => [s.from, s.to]));
    const hi = Math.max(0, ...steps.flatMap((s) => [s.from, s.to]));
    const span = Math.max(1e-12, hi - lo);
    const rects: number[] = [];
    const lines: number[] = [];
    const labels: MarkLabel[] = [];
    const muted = parseColor(theme.text.muted);
    const axis = parseColor(theme.axis.line.color);
    const r = style.radius as number;
    const n = Math.max(1, steps.length);
    const showFigures = style.labels !== false;
    const label = (s: BridgeStep, i: number): MarkLabel => ({
      tx: 0, ty: 0, text: texts[i], size: 11, weight: 600,
      color: s.total ? theme.text.primary : P.toneInk(tone(s)),
    });
    let pick: (tx: number, ty: number) => number;

    if (style.horizontal) {
      const nameW = Math.min(W * 0.4, widest(steps.map((s) => s.key), nameFont) + 12);
      const figW = showFigures ? widest(texts, figFont) + 8 : 2;
      const bands = rowBands({ height: H, rows: n, maxThickness: Math.min(26, style.thickness as number), spacing: 10 });
      const x0 = nameW + figW;
      const x1 = Math.max(x0 + 20, W - figW);
      const x = (val: number) => x0 + ((val - lo) / span) * (x1 - x0);
      steps.forEach((s, i) => {
        const top = bands.top + i * bands.rowH + bands.barTop;
        const bottom = top + bands.thickness;
        const cy = (top + bottom) / 2;
        box(rects, F, x(s.from), top, x(s.to), bottom, fill(s), { radius: Math.min(r, 2), axis: 1 });
        const next = steps[i + 1];
        if (next && style.connectors !== false) {
          const nt = bands.top + (i + 1) * bands.rowH + bands.barTop;
          pushSegment(lines, X(x(s.to)), Y(bottom), X(x(s.to)), Y(nt), muted, 1);
        }
        labels.push({ tx: X(0), ty: Y(cy), text: s.key, color: theme.text.primary, size: 11, weight: s.total ? 650 : 500, align: 'left', baseline: 'middle', maxWidth: nameW - 8 });
        if (showFigures) {
          const right = s.to >= s.from;
          labels.push({ ...label(s, i), tx: X(x(s.to) + (right ? 4 : -4)), ty: Y(cy), align: right ? 'left' : 'right', baseline: 'middle' });
        }
      });
      pushSegment(lines, X(x(0)), Y(bands.top), X(x(0)), Y(bands.top + n * bands.rowH), axis, 1);
      pick = (_tx, ty) => Math.floor(((1 - ty) * H - bands.top) / bands.rowH);
    } else {
      const slot = W / n;
      const barW = Math.max(4, Math.min(style.thickness as number, slot * 0.62));
      const nameLines = steps.map((s) => twoLines(s.key, slot - 4, nameFont));
      const lineCount = Math.max(1, ...nameLines.map((l) => l.length));
      const bottomArea = lineCount * 13 + 8;
      const fits = widest(texts, figFont) <= slot - 2;
      const plain = (s: BridgeStep) => {
        const val = s.total ? s.to : s.delta;
        const t = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0, notation: 'compact' }).format(Math.abs(val));
        return s.total ? t : val > 0 ? `+${t}` : val < 0 ? `−${t}` : t;
      };
      const anyBelow = steps.some((s) => !s.total && s.delta < 0) || lo < 0;
      const top = 18;
      const bottom = H - bottomArea - (anyBelow ? 16 : 4);
      const y = (val: number) => top + ((hi - val) / span) * Math.max(10, bottom - top);
      steps.forEach((s, i) => {
        const cx = (i + 0.5) * slot;
        const up = s.to >= s.from;
        box(rects, F, cx - barW / 2, y(Math.max(s.from, s.to)), cx + barW / 2, y(Math.min(s.from, s.to)), fill(s), { radius: Math.min(r, 3) });
        const next = steps[i + 1];
        if (next && style.connectors !== false) pushSegment(lines, X(cx + barW / 2), Y(y(s.to)), X(cx + slot - barW / 2), Y(y(s.to)), muted, 1);
        if (showFigures) {
          const text = fits ? texts[i] : plain(s);
          const atTop = s.total ? s.to >= 0 : up;
          labels.push({ ...label(s, i), text, tx: X(cx), ty: Y(atTop ? y(Math.max(s.from, s.to)) - 4 : y(Math.min(s.from, s.to)) + 4), align: 'center', baseline: atTop ? 'bottom' : 'top' });
        }
        nameLines[i].forEach((line, j) =>
          labels.push({ tx: X(cx), ty: Y(H - bottomArea + 6 + j * 13), text: line, color: s.total ? theme.text.primary : theme.text.secondary, size: 11, weight: s.total ? 650 : 500, align: 'center', baseline: 'top', free: true }),
        );
      });
      pushSegment(lines, X(0), Y(y(0)), X(W), Y(y(0)), axis, 1);
      pick = (tx) => Math.floor((tx * W) / slot);
    }

    const draws: MarkDraw[] = [];
    if (rects.length) draws.push({ batch: batchOf(ctx, 'rect', rects), pixelSnap: true, data: new Float32Array(rects), keys: steps.map((s) => s.key) });
    if (lines.length) draws.push({ batch: batchOf(ctx, 'line', lines), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const s = steps[pick(tx, ty)];
        if (!s || tx < 0 || tx > 1 || ty < 0 || ty > 1) return null;
        if (s.total) return { title: s.key, rows: [{ label: fieldLabel(ctx, vf), value: ctx.format(s.to, vf) }] };
        return { title: s.key, rows: [{ label: ctx.theme.texts.change, value: signed(ctx, s.delta, vf) }, { label: ctx.theme.texts.cumulative, value: ctx.format(s.to, vf) }] };
      },
    };
  },
};

// ----------------------------------------------------------------- variance

/**
 * `variance`: actual (`value`) against budget (`target`), one row per `key`: the actual as a solid
 * bar over the budget's outline, then the absolute variance as bars around zero and the relative
 * variance as pins, both colored by whether they are good news (`upIsGood`).
 */
export const variance: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'variance');
    const vf = layer.encode.value ?? need(layer, 'x', 'variance');
    const tf = need(layer, 'target', 'variance');
    const k = table.column(kf).values;
    const v = table.column(vf).values as Float64Array;
    const t = table.column(tf).values as Float64Array;
    const items: { key: string; actual: number; budget: number; row?: number; total?: boolean }[] = Array.from({ length: table.length }, (_, i) => ({ key: String(k[i]), actual: v[i], budget: t[i], row: i })).filter(
      (d) => Number.isFinite(d.actual) || Number.isFinite(d.budget),
    );
    if (style.total && items.length > 1) {
      const sum = (f: 'actual' | 'budget') => items.reduce((a, d) => a + (Number.isFinite(d[f]) ? d[f] : 0), 0);
      items.push({ key: ctx.theme.texts.total, actual: sum('actual'), budget: sum('budget'), total: true });
    }
    const P = palette(ctx);
    const F = frame(ctx);
    const { W, H, X, Y } = F;
    const family = theme.font.family;
    const nameFont = `600 12px ${family}`;
    const figFont = `600 11px ${family}`;
    const vars = items.map((d) => varianceOf(d.actual, d.budget));
    const tones = vars.map((d) => toneOf(d.abs, P.upIsGood));
    const absText = vars.map((d) => (Number.isFinite(d.abs) ? signed(ctx, d.abs, vf) : '–'));
    const relText = vars.map((d) => (Number.isFinite(d.rel) ? signedPercent(d.rel) : '–'));
    const valText = items.map((d) => (Number.isFinite(d.actual) ? ctx.format(d.actual, vf) : '–'));
    const showFigures = style.labels !== false;

    const narrow = W < 480;
    const nameW = Math.min(W * (narrow ? 0.32 : 0.28), widest(items.map((d) => d.key), nameFont) + 14);
    const gap = narrow ? 10 : 16;
    const wanted = [{ id: 'bars', weight: 1.25 }, ...(style.absolute !== false ? [{ id: 'abs', weight: 1 }] : []), ...(style.relative !== false ? [{ id: 'rel', weight: 0.9 }] : [])];
    const room = W - nameW;
    const totalWeight = wanted.reduce((a, c) => a + c.weight, 0);
    let cx = nameW;
    const cols: Record<string, { x0: number; x1: number }> = {};
    for (const c of wanted) {
      const w = ((room - gap * (wanted.length - 1)) * c.weight) / totalWeight;
      cols[c.id] = { x0: cx, x1: cx + w };
      cx += w + gap;
    }
    const head = 22;
    const bands = rowBands({ height: H, rows: items.length, above: head, maxThickness: style.thickness as number, spacing: narrow ? 6 : 12 });
    const rects: number[] = [];
    const real: number[] = [];
    const lines: number[] = [];
    const heads: number[] = [];
    const keyRects: number[] = [];
    const labels: MarkLabel[] = [];
    const axis = parseColor(theme.axis.line.color);
    const r = Math.min(style.radius as number, 3);
    const rowTop = (i: number) => bands.top + i * bands.rowH + bands.barTop;

    // Actual over budget.
    const B = cols.bars;
    const valW = showFigures ? widest(valText, figFont) + 6 : 0;
    // The total row shows its figures only: a bar on the same scale would crush the others.
    const hiB = Math.max(1e-12, ...items.filter((d) => !d.total).flatMap((d) => [d.actual, d.budget].filter(Number.isFinite)));
    const bx = (val: number) => B.x0 + (Math.max(0, val) / hiB) * Math.max(10, B.x1 - B.x0 - valW);
    const th = bands.thickness;
    items.forEach((d, i) => {
      const top = rowTop(i);
      const ink = ctx.paint(P.ink, d.row);
      if (!d.total && Number.isFinite(d.budget)) box(rects, F, B.x0, top + th * 0.3, bx(d.budget), top + th, P.surface, { stroke: ink, width: 1.25, radius: r, axis: 1, ends: 'right' });
      if (!d.total && Number.isFinite(d.actual)) box(real, F, B.x0, top, bx(d.actual), top + th * 0.7, ink, { radius: r, axis: 1, ends: 'right' });
      const end = d.total ? B.x0 - 5 : bx(Math.max(d.actual || 0, d.budget || 0));
      if (showFigures || d.total) labels.push({ tx: X(end + 5), ty: Y(top + th * 0.5), text: valText[i], color: theme.text.primary, size: 11, weight: d.total ? 700 : 600, align: 'left', baseline: 'middle' });
      labels.push({ tx: X(0), ty: Y(top + th / 2), text: d.key, color: theme.text.primary, size: narrow ? 11 : 12, weight: d.total ? 700 : 600, align: 'left', baseline: 'middle', maxWidth: nameW - 8 });
    });

    // A diverging column around zero: `pin` draws a stalk and a round head instead of a bar.
    const diverging = (col: { x0: number; x1: number }, values: number[], texts: string[], pin: boolean) => {
      const tw = showFigures ? widest(texts, figFont) + 6 : 2;
      const neg = Math.max(0, ...values.filter(Number.isFinite).map((x) => -x));
      const pos = Math.max(0, ...values.filter(Number.isFinite));
      const padL = neg > 0 ? tw + (pin ? 4 : 0) : 2;
      const padR = pos > 0 ? tw + (pin ? 4 : 0) : 2;
      const scale = Math.max(4, col.x1 - col.x0 - padL - padR) / Math.max(1e-12, neg + pos);
      const zero = col.x0 + padL + neg * scale;
      values.forEach((val, i) => {
        if (!Number.isFinite(val)) return;
        const top = rowTop(i);
        const cy = top + th / 2;
        const end = zero + val * scale;
        const color = ctx.paint(P.toneColor(tones[i]), items[i].row);
        if (pin) {
          pushSegment(lines, X(zero), Y(cy), X(end), Y(cy), color, 1.5);
          heads.push(X(end), Y(cy), Math.max(6, Math.min(10, th * 0.5)), 0, ...color, 0, 0, 0, 0, 0);
        } else box(rects, F, zero, cy - th * 0.35, end, cy + th * 0.35, color, { radius: r, axis: 1, ends: val >= 0 ? 'right' : 'left' });
        if (showFigures) {
          const off = pin ? Math.max(6, Math.min(10, th * 0.5)) / 2 + 4 : 4;
          labels.push({ tx: X(end + (val >= 0 ? off : -off)), ty: Y(cy), text: texts[i], color: P.toneInk(tones[i]), size: 11, weight: 600, align: val >= 0 ? 'left' : 'right', baseline: 'middle' });
        }
      });
      pushSegment(lines, X(zero), Y(bands.top), X(zero), Y(bands.top + items.length * bands.rowH), axis, 1);
      return zero;
    };
    const headY = Y(bands.top - 12);
    const header = (text: string, x: number, align: CanvasTextAlign = 'center') =>
      labels.push({ tx: X(x), ty: headY, text, color: theme.text.muted, size: 11, weight: 600, align, baseline: 'middle' });
    if (cols.abs) {
      const z = diverging(cols.abs, vars.map((d) => d.abs), absText, false);
      header(ctx.theme.texts.gap, z);
    }
    if (cols.rel) {
      const z = diverging(cols.rel, vars.map((d) => d.rel), relText, true);
      header(ctx.theme.texts.gapPercent, z);
    }
    keyRow(keyRects, labels, F, theme, B.x0, bands.top - 12, [
      { name: fieldLabel(ctx, vf), fill: P.ink },
      { name: fieldLabel(ctx, tf), fill: P.surface, stroke: P.ink },
    ]);
    if (items[items.length - 1]?.total) {
      const yLine = bands.top + (items.length - 1) * bands.rowH;
      pushSegment(lines, X(0), Y(yLine), X(W), Y(yLine), axis, 1);
    }

    const keysOf = (pred: (d: (typeof items)[number]) => boolean) => items.filter(pred).map((d) => d.key);
    const draws: MarkDraw[] = [];
    if (rects.length) draws.push({ batch: batchOf(ctx, 'rect', rects), pixelSnap: true });
    if (real.length) draws.push({ batch: batchOf(ctx, 'rect', real), pixelSnap: true, data: new Float32Array(real), keys: keysOf((d) => !d.total && Number.isFinite(d.actual)) });
    if (lines.length) draws.push({ batch: batchOf(ctx, 'line', lines) });
    if (heads.length) draws.push({ batch: batchOf(ctx, 'point', heads) });
    if (keyRects.length) draws.push({ batch: batchOf(ctx, 'rect', keyRects), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const y = (1 - ty) * H;
        const i = Math.floor((y - bands.top) / bands.rowH);
        const d = items[i];
        if (!d || tx < 0 || tx > 1 || y < bands.top) return null;
        return {
          title: d.key,
          rows: [
            { label: fieldLabel(ctx, vf), value: valText[i] },
            { label: fieldLabel(ctx, tf), value: Number.isFinite(d.budget) ? ctx.format(d.budget, tf) : '–' },
            { label: ctx.theme.texts.gap, value: absText[i] },
            { label: ctx.theme.texts.gapPercent, value: relText[i] },
          ],
        };
      },
    };
  },
};

// --------------------------------------------------------------- periodBars

/**
 * `periodBars`: one column per period (`x`): previous year (`previous`) in grey behind on the left,
 * budget (`target`) as an outline behind on the right, actual (`value`) in front. Periods without an
 * actual (the future) show the budget alone; above each past period, the variance to budget.
 */
export const periodBars: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = need(layer, 'x', 'periodBars');
    const vf = layer.encode.value ?? need(layer, 'y', 'periodBars');
    const tf = layer.encode.target;
    const pf = layer.encode.previous;
    const xs = table.column(xf).values;
    const col = (f: string | undefined) => (f && table.has(f) ? (table.column(f).values as Float64Array) : undefined);
    const a = col(vf)!;
    const b = col(tf);
    const p = col(pf);
    const items = periodItems(Array.from({ length: table.length }, (_, i) => ({ key: String(xs[i]), actual: a[i], budget: b ? b[i] : NaN, previous: p ? p[i] : NaN })));
    const P = palette(ctx);
    const F = frame(ctx);
    const { W, H, X, Y } = F;
    const family = theme.font.family;
    const figFont = `600 10.5px ${family}`;
    const nameFont = `500 11px ${family}`;
    const n = Math.max(1, items.length);
    const slot = W / n;
    const group = Math.min(slot * Math.min(0.95, Math.max(0.3, style.width as number)), 64);
    const bw = group / 1.6;
    const showFigures = style.labels !== false && !!b;
    const varText = items.map((d) => (Number.isFinite(d.variance) ? signed(ctx, d.variance, vf) : ''));
    const rotate = showFigures && widest(varText, figFont) > slot - 2;
    const figRoom = showFigures ? (rotate ? widest(varText, figFont) + 6 : 16) : 2;
    const keyH = 22;
    const nameW = widest(items.map((d) => d.key), nameFont);
    const every = labelStride(nameW, slot);
    const top = keyH + figRoom;
    const bottom = H - 20;
    const values = items.flatMap((d) => [d.actual, d.budget, d.previous]).filter(Number.isFinite);
    const hi = Math.max(1e-12, ...values);
    const lo = Math.min(0, ...values);
    const y = (val: number) => top + ((hi - val) / (hi - lo)) * Math.max(10, bottom - top);
    const back: number[] = [];
    const front: number[] = [];
    const lines: number[] = [];
    const keyRects: number[] = [];
    const labels: MarkLabel[] = [];
    const r = Math.min(style.radius as number, 3);
    const axis = parseColor(theme.axis.line.color);
    const muted = parseColor(theme.text.muted);

    items.forEach((d, i) => {
      const c = (i + 0.5) * slot;
      const ink = ctx.paint(P.ink, d.row);
      const bar = (out: number[], l: number, val: number, fill: RGBA, stroke?: RGBA) =>
        box(out, F, l, y(Math.max(0, val)), l + bw, y(Math.min(0, val)), fill, { radius: r, ends: val >= 0 ? 'top' : 'bottom', stroke, width: stroke ? 1.25 : 0 });
      if (d.past) {
        if (Number.isFinite(d.previous)) bar(back, c - 0.8 * bw, d.previous, ctx.paint(P.grey, d.row));
        if (Number.isFinite(d.budget)) bar(back, c - 0.2 * bw, d.budget, P.surface, ink);
        bar(front, c - 0.5 * bw, d.actual, ink);
      } else if (Number.isFinite(d.budget)) bar(back, c - 0.5 * bw, d.budget, P.surface, ink);
      if (showFigures && varText[i]) {
        const peak = y(Math.max(0, ...[d.actual, d.budget, d.previous].filter(Number.isFinite)));
        const color = P.toneInk(toneOf(d.variance, P.upIsGood));
        labels.push(
          rotate
            ? { tx: X(c), ty: Y(peak - 4), text: varText[i], color, size: 10.5, weight: 600, align: 'left', baseline: 'middle', rotate: -90 }
            : { tx: X(c), ty: Y(peak - 4), text: varText[i], color, size: 10.5, weight: 600, align: 'center', baseline: 'bottom' },
        );
      }
      if (i % every === 0) labels.push({ tx: X(c), ty: Y(bottom + 5), text: d.key, color: d.past ? theme.text.secondary : theme.text.muted, size: 11, weight: 500, align: 'center', baseline: 'top' });
    });
    // Where the actuals stop: a thin rule between the last past period and the first future one.
    const split = items.findIndex((d, i) => d.past && items[i + 1] && !items[i + 1].past);
    if (split >= 0) pushSegment(lines, X((split + 1) * slot), Y(keyH + 2), X((split + 1) * slot), Y(bottom), muted, 1);
    pushSegment(lines, X(0), Y(y(0)), X(W), Y(y(0)), axis, 1);
    const entries: { name: string; fill: RGBA; stroke?: RGBA }[] = [{ name: fieldLabel(ctx, vf), fill: P.ink }];
    if (tf) entries.push({ name: fieldLabel(ctx, tf), fill: P.surface, stroke: P.ink });
    if (pf) entries.push({ name: fieldLabel(ctx, pf), fill: P.grey });
    keyRow(keyRects, labels, F, theme, 0, keyH / 2, entries);

    const draws: MarkDraw[] = [];
    if (back.length) draws.push({ batch: batchOf(ctx, 'rect', back), pixelSnap: true });
    if (front.length) draws.push({ batch: batchOf(ctx, 'rect', front), pixelSnap: true, data: new Float32Array(front), keys: items.filter((d) => d.past).map((d) => d.key) });
    if (lines.length) draws.push({ batch: batchOf(ctx, 'line', lines), enter: 'fade' });
    if (keyRects.length) draws.push({ batch: batchOf(ctx, 'rect', keyRects), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const d = items[Math.floor((tx * W) / slot)];
        if (!d || tx < 0 || tx > 1 || ty < 0 || ty > 1) return null;
        const rows: ShapeHit['rows'] = [];
        if (d.past) rows.push({ label: fieldLabel(ctx, vf), value: ctx.format(d.actual, vf) });
        if (tf && Number.isFinite(d.budget)) rows.push({ label: fieldLabel(ctx, tf), value: ctx.format(d.budget, tf) });
        if (pf && Number.isFinite(d.previous)) rows.push({ label: fieldLabel(ctx, pf), value: ctx.format(d.previous, pf) });
        if (Number.isFinite(d.variance)) rows.push({ label: ctx.theme.texts.gapToBudget, value: varText[items.indexOf(d)] });
        return { title: d.key, rows };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const FINANCE_MARKS: Record<string, MarkDefinition> = { bridge, variance, periodBars };
