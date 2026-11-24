/**
 * Comparison charts for BI: Likert scale, tornado / butterfly, variable-width bars, before / after
 * ranking and bar-in-bar. Standalone marks laid out in px (they are rebuilt on resize) and drawn with the
 * shared primitives only. The layout arithmetic lives in `compareLayout.ts`.
 */
import { LAYOUTS } from '../render/layouts';
import type { Batch, RGBA } from '../render/types';
import { LinearScale, niceDomain } from '../scale/scales';
import { mix, parseColor, withAlpha } from '../util/color';
import { categoriesOf, need, totals } from './charts';
import {
  butterflyColumns,
  likertColors,
  likertRow,
  rankItems,
  rowBands,
  rowTable,
  staggerLabels,
  tornadoAmplitude,
  tornadoOrder,
  variwideColumns,
  type TornadoItem,
} from './compareLayout';
import { luminance, pushRect, pushSegment } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkDraw, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';

const unitScales = () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) });
const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;
const auto = (value: unknown, fallback: string): string => (typeof value === 'string' && value && value !== 'auto' ? value : fallback);
const percent0 = (v: number) => new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(v);
const signedPercent = (v: number) =>
  new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0, signDisplay: 'exceptZero' }).format(v);
const widest = (texts: string[], font: string) => Math.max(0, ...texts.map((t) => textWidth(t, font)));

function batchOf(ctx: BuildContext, kind: 'rect' | 'line', data: number[]): Batch {
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

/** The chart box in px (y down from the top), and the way back to scale space. */
function frame(ctx: BuildContext) {
  const [px, py] = ctx.pixel;
  return { W: 1 / px, H: 1 / py, X: (v: number) => v * px, Y: (v: number) => 1 - v * py };
}
type Frame = ReturnType<typeof frame>;

/**
 * A horizontal bar given in px, growing from `from` to `to` (either way) when the chart enters.
 * `round`: radius of the `to` end.
 */
function hbar(out: number[], F: Frame, from: number, to: number, top: number, bottom: number, fill: RGBA, round = 0, roundStart = 0): void {
  const right = to >= from;
  const a = right ? roundStart : round;
  const b = right ? round : roundStart;
  pushRect(out, { x0: F.X(from), y0: F.Y(bottom), x1: F.X(to), y1: F.Y(top), fill, radii: [a, b, b, a], axis: 1 });
}

/** The color of a single-measure chart: the layer's fixed color, or the measure's own slot. */
const measureColor = (ctx: BuildContext, field: string): RGBA =>
  ctx.data.layer.style?.color ? parseColor(ctx.data.layer.style.color) : ctx.categorical(fieldLabel(ctx, field));

// ------------------------------------------------------------------- likert

/**
 * `likert`: answers of a survey on an ordered scale. One row per question (`key`), one segment per
 * answer (`color`, from the most unfavourable to the most favourable: data order, or `style.answers`),
 * as long as its share of `value`. The stacks are centered on the middle of the scale.
 */
export const likert: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'likert');
    const lf = need(layer, 'color', 'likert');
    const vf = layer.encode.value ?? need(layer, 'x', 'likert');
    const cells = totals(table, kf, vf, lf);
    const seen = [...new Set(cells.map((c) => c.group))];
    const wanted = ((style.answers ?? []) as string[]).filter((a) => seen.includes(a));
    const levels = wanted.length ? [...wanted, ...seen.filter((a) => !wanted.includes(a))] : seen;
    const n = levels.length;
    const mode: 'center' | 'aside' = style.neutral === 'aside' ? 'aside' : 'center';
    const mid = n % 2 === 1 ? (n - 1) / 2 : -1;

    const ink = parseColor(theme.text.primary);
    // On a dark surface, fading towards the surface muddies the middle levels (brown, navy): they fade
    // towards a pale tint instead, so they stay bright and still read as weaker than the extremes.
    const dark = luminance(ctx.surface) < 0.2;
    const colors = likertColors(
      n,
      parseColor(auto(style.negative, theme.palette.categorical[1])),
      parseColor(auto(style.positive, theme.palette.categorical[0])),
      mix(ctx.surface, ink, dark ? 0.3 : 0.2),
      dark ? mix(ctx.surface, ink, 0.9) : ctx.surface,
    );
    // The legend follows the scale, from the most unfavourable answer to the most favourable.
    const legend = levels.map((key, i) => {
      ctx.categorical(key);
      return { key, color: colors[i] };
    });
    const hidden = levels.map((l) => ctx.hidden.has(l));

    let rows = categoriesOf(table, kf).map((key) => {
      const own = levels.map((l) => cells.find((c) => c.key === key && c.group === l));
      const values = own.map((c) => c?.value ?? 0);
      return { key, values, cellRows: own.map((c) => c?.row), ...likertRow(values, mode, hidden) };
    });
    rows = rows.filter((r) => r.total > 0);
    if (style.sorted) rows = rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.positive - a.r.positive || a.i - b.i).map((e) => e.r);

    const F = frame(ctx);
    const { W, H, X, Y } = F;
    const family = theme.font.family;
    const nameFont = `600 12px ${family}`;
    let showTotals = !!style.totals;
    let totW = showTotals ? textWidth(percent0(1), `650 12px ${family}`) + 12 : 0;
    const aside = mode === 'aside' && mid >= 0 && !hidden[mid] && rows.some((r) => r.neutral > 0);
    let asideW = aside ? 18 + totW : 0;
    const nameW = Math.min(W * 0.36, widest(rows.map((r) => r.key), nameFont) + 16);
    const negLabel = String(style.negativeLabel ?? '');
    const posLabel = String(style.positiveLabel ?? '');
    const footer = negLabel || posLabel ? 18 : 0;
    const cols = rowTable({ width: W, height: H, rows: rows.length, nameWidth: nameW, minBar: 190 + 2 * totW + asideW, below: footer, maxThickness: style.thickness as number });
    const bands = cols.bands;
    // Short bars beside the names (many questions on a phone): the totals give their room to the segments.
    if (showTotals && !cols.stacked && cols.x1 - cols.x0 - 2 * totW - asideW < 150) {
      showTotals = false;
      totW = 0;
      asideW = aside ? 18 + textWidth(percent0(1), `600 11px ${family}`) + 8 : 0;
    }

    const maxLeft = Math.max(0, ...rows.map((r) => r.left));
    const maxRight = Math.max(0, ...rows.map((r) => r.right));
    const maxNeutral = aside ? Math.max(0, ...rows.map((r) => r.neutral)) : 0;
    const unit = Math.max(1, cols.x1 - cols.x0 - 2 * totW - asideW) / (maxLeft + maxRight + maxNeutral || 1);
    const cx = cols.x0 + totW + maxLeft * unit;
    const asideX = cx + maxRight * unit + totW + 18;

    const rects: number[] = [];
    const keys: string[] = [];
    const lines: number[] = [];
    const labels: MarkLabel[] = [];
    const g = Math.max(0, style.gap as number) / 2;
    const r = style.radius as number;
    const boxes: { x0: number; x1: number; level: number }[][] = [];

    rows.forEach((d, i) => {
      const top = bands.top + i * bands.rowH + bands.barTop;
      const bottom = top + bands.thickness;
      const cy = (top + bottom) / 2;
      const drawn = d.segments.filter((s) => s.share > 0);
      const own: (typeof boxes)[number] = [];
      const segment = (x0: number, x1: number, level: number, first: boolean, last: boolean, growLeft: boolean) => {
        const a = Math.min(x1, x0 + g);
        const b = Math.max(a, x1 - g);
        const fill = ctx.paint(colors[level], d.cellRows[level]);
        const rl = first ? r : 0;
        const rr = last ? r : 0;
        pushRect(rects, { x0: X(growLeft ? b : a), y0: Y(bottom), x1: X(growLeft ? a : b), y1: Y(top), fill, radii: [rl, rr, rr, rl], axis: 1 });
        keys.push(`${d.key}\u0000${levels[level]}`);
        own.push({ x0, x1, level });
        return fill;
      };
      drawn.forEach((s, k) => {
        const x0 = cx + s.from * unit;
        const x1 = cx + s.to * unit;
        const fill = segment(x0, x1, s.level, k === 0, k === drawn.length - 1, s.to <= 0);
        if (style.labels && s.share >= 0.005) {
          labels.push({ tx: X((x0 + x1) / 2), ty: Y(cy), text: percent0(s.share), on: fill, size: 11, weight: 600, align: 'center', baseline: 'middle', box: [X(x0), Y(bottom), X(x1), Y(top)] });
        }
      });
      if (aside && d.neutral > 0) {
        const x1 = asideX + d.neutral * unit;
        const fill = segment(asideX, x1, mid, true, true, false);
        const text = percent0(d.neutral);
        labels.push({
          tx: X((asideX + x1) / 2), ty: Y(cy), text, on: fill, size: 11, weight: 600, align: 'center', baseline: 'middle', box: [X(asideX), Y(bottom), X(x1), Y(top)],
          fallback: { tx: X(x1), ty: Y(cy), text, color: theme.text.secondary, size: 11, weight: 600, align: 'left', baseline: 'middle', dx: 5 },
        });
      }
      boxes.push(own);
      if (showTotals) {
        const total = { color: theme.text.primary, size: 12, weight: 650, baseline: 'middle' as const };
        if (d.negative > 0 || !hidden.slice(0, Math.floor(n / 2)).every(Boolean)) labels.push({ ...total, tx: X(cx - d.left * unit), ty: Y(cy), text: percent0(d.negative), align: 'right', dx: -6 });
        if (d.positive > 0 || !hidden.slice(n - Math.floor(n / 2)).every(Boolean)) labels.push({ ...total, tx: X(cx + d.right * unit), ty: Y(cy), text: percent0(d.positive), align: 'left', dx: 6 });
      }
      const name = fit(d.key, cols.nameWidth - 8, nameFont);
      labels.push({ tx: X(0), ty: Y(cols.stacked ? top - 9 : cy), text: name, color: theme.text.primary, size: 12, weight: 600, align: 'left', baseline: 'middle' });
    });

    const y0 = bands.top;
    const y1 = bands.top + rows.length * bands.rowH;
    if (rows.length) {
      // The middle of the scale, visible between the rows.
      pushSegment(lines, X(cx), Y(y0 + 1), X(cx), Y(y1 - 1), parseColor(theme.axis.line.color), 1);
      const foot = { ty: Y(y1 + 4), color: theme.text.muted, size: 10.5, baseline: 'top' as const };
      if (negLabel) labels.push({ ...foot, tx: X(cx), text: `← ${negLabel}`, align: 'right', dx: -8 });
      if (posLabel) labels.push({ ...foot, tx: X(cx), text: `${posLabel} →`, align: 'left', dx: 8 });
      if (aside && footer) labels.push({ ...foot, tx: X(asideX), text: levels[mid], align: 'left' });
    }

    const draws: MarkDraw[] = [];
    if (lines.length) draws.push({ batch: batchOf(ctx, 'line', lines), enter: 'fade' });
    if (rects.length) draws.push({ batch: batchOf(ctx, 'rect', rects), pixelSnap: true, data: new Float32Array(rects), keys });

    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = tx * W;
        const y = (1 - ty) * H;
        const i = Math.floor((y - bands.top) / bands.rowH);
        const d = rows[i];
        if (!d || tx < 0 || tx > 1) return null;
        const over = boxes[i].find((b) => x >= b.x0 && x <= b.x1);
        const line = (l: number) => ({ label: levels[l], value: `${percent0(d.values[l] / d.total)} · ${ctx.format(d.values[l], vf)}` });
        const out = over ? [line(over.level)] : levels.map((_, l) => line(l));
        if (over) {
          out.push({ label: negLabel || 'Défavorable', value: percent0(d.negative) });
          out.push({ label: posLabel || 'Favorable', value: percent0(d.positive) });
        }
        return { title: d.key, rows: out };
      },
    };
  },
};

// ------------------------------------------------------------------ tornado

/**
 * `tornado`: two measures facing each other, one row per `key`, the names written between them
 * (butterfly chart). The two sides are the first two values of `color` (measure in `value`), or two
 * fields, `x` on the left and `x2` on the right. With `style.base`, both are drawn from that base
 * value on one shared axis (sensitivity analysis: outcome with the low and the high assumption).
 */
export const tornado: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'tornado');
    const sf = layer.encode.color && table.has(layer.encode.color) ? layer.encode.color : undefined;
    let items: TornadoItem[];
    let names: [string, string];
    let fields: [string, string];
    if (sf) {
      const vf = layer.encode.value ?? need(layer, 'x', 'tornado');
      const cells = totals(table, kf, vf, sf);
      const groups = [...new Set(cells.map((c) => c.group))];
      names = [groups[0] ?? '', groups[1] ?? ''];
      fields = [vf, vf];
      items = categoriesOf(table, kf).map((key) => {
        const l = cells.find((c) => c.key === key && c.group === names[0]);
        const rr = cells.find((c) => c.key === key && c.group === names[1]);
        return { key, left: l?.value ?? NaN, right: rr?.value ?? NaN, row: (l ?? rr)?.row ?? 0 };
      });
    } else {
      const lf = need(layer, 'x', 'tornado');
      const rf = need(layer, 'x2', 'tornado');
      names = [fieldLabel(ctx, lf), fieldLabel(ctx, rf)];
      fields = [lf, rf];
      const k = table.column(kf).values;
      const lv = table.column(lf).values as Float64Array;
      const rv = table.column(rf).values as Float64Array;
      items = Array.from({ length: table.length }, (_, i) => ({ key: String(k[i]), left: lv[i], right: rv[i], row: i }));
    }
    items = items.filter((d) => Number.isFinite(d.left) || Number.isFinite(d.right));
    const base = typeof style.base === 'number' ? style.base : NaN;
    const sensitivity = Number.isFinite(base);
    if (style.sorted) items = tornadoOrder(items, base);

    const colors = [ctx.categorical(names[0]), ctx.categorical(names[1])];
    const F = frame(ctx);
    const { W, H, X, Y } = F;
    const family = theme.font.family;
    const nameFont = `600 12px ${family}`;
    const valueFont = `600 11px ${family}`;
    const text = (d: TornadoItem, side: 0 | 1) => {
      const v = side ? d.right : d.left;
      return Number.isFinite(v) ? ctx.format(v, fields[side]) : '';
    };
    const showValues = !!style.labels;
    const valueW = showValues ? widest(items.flatMap((d) => [text(d, 0), text(d, 1)]), valueFont) + 8 : 0;
    const r = style.radius as number;
    const rects: number[] = [];
    const keys: string[] = [];
    const lines: number[] = [];
    const labels: MarkLabel[] = [];
    const value = { color: theme.text.primary, size: 11, weight: 600, baseline: 'middle' as const };
    const head = 22;
    let bands = rowBands({ height: H, rows: items.length, above: head, maxThickness: style.thickness as number, spacing: Math.max(16, (style.thickness as number) * 0.9) });
    const rowTop = (i: number) => bands.top + i * bands.rowH + bands.barTop;
    const legend: { key: string; color: RGBA }[] = [];

    if (!sensitivity) {
      // Butterfly: magnitudes on both sides of the names.
      const wanted = { width: W, nameWidth: widest(items.map((d) => d.key), nameFont) + 24, valueWidth: valueW };
      let C = butterflyColumns(wanted);
      if (C.stacked) {
        const above = rowBands({ height: H, rows: items.length, above: head, header: 16, maxThickness: style.thickness as number, spacing: 10 });
        // Hairlines under a line of text: short bars beside the names read better.
        if (above.thickness < 9 && !butterflyColumns({ ...wanted, minSide: 28 }).stacked) C = butterflyColumns({ ...wanted, minSide: 28 });
        else bands = above;
      }
      const mag = (v: number) => (Number.isFinite(v) ? Math.abs(v) : 0);
      const maxL = Math.max(0, ...items.map((d) => mag(d.left)));
      const maxR = Math.max(0, ...items.map((d) => mag(d.right)));
      const top = style.shared ? Math.max(maxL, maxR) : NaN;
      const lenL = (v: number) => (mag(v) / ((style.shared ? top : maxL) || 1)) * C.side;
      const lenR = (v: number) => (mag(v) / ((style.shared ? top : maxR) || 1)) * C.side;
      const middle = (C.leftEnd + C.rightStart) / 2;
      const gutter = C.rightStart - C.leftEnd;
      items.forEach((d, i) => {
        const y0 = rowTop(i);
        const y1 = y0 + bands.thickness;
        const cy = (y0 + y1) / 2;
        if (Number.isFinite(d.left)) {
          const tip = C.leftEnd - lenL(d.left);
          hbar(rects, F, C.leftEnd, tip, y0, y1, ctx.paint(colors[0], d.row), r);
          keys.push(`${d.key}\u00000`);
          if (showValues) labels.push({ ...value, tx: X(tip), ty: Y(cy), text: text(d, 0), align: 'right', dx: -5 });
        }
        if (Number.isFinite(d.right)) {
          const tip = C.rightStart + lenR(d.right);
          hbar(rects, F, C.rightStart, tip, y0, y1, ctx.paint(colors[1], d.row), r);
          keys.push(`${d.key}\u00001`);
          if (showValues) labels.push({ ...value, tx: X(tip), ty: Y(cy), text: text(d, 1), align: 'left', dx: 5 });
        }
        const name = fit(d.key, C.stacked ? W - 8 : gutter - 12, nameFont);
        labels.push({ tx: X(middle), ty: Y(C.stacked ? y0 - 8 : cy), text: name, color: theme.text.primary, size: 12, weight: 600, align: 'center', baseline: 'middle' });
      });
      // Each side is named above its bars, against the gutter.
      const title = { ty: Y(bands.top - 8), color: theme.text.secondary, size: 11, weight: 650, baseline: 'bottom' as const };
      const pad = C.stacked ? 8 : 0;
      labels.unshift(
        { ...title, tx: X(C.leftEnd - pad), text: fit(names[0], C.leftEnd - pad, `650 11px ${family}`), align: 'right' },
        { ...title, tx: X(C.rightStart + pad), text: fit(names[1], W - C.rightStart - pad, `650 11px ${family}`), align: 'left' },
      );
      const keyLabel = ctx.fields[kf]?.label;
      if (!C.stacked && keyLabel && textWidth(keyLabel, `500 11px ${family}`) < gutter - 16) {
        labels.push({ tx: X(middle), ty: Y(bands.top - 8), text: keyLabel, color: theme.text.muted, size: 11, align: 'center', baseline: 'bottom' });
      }
    } else {
      // Sensitivity: both outcomes from the base value, on one axis.
      legend.push({ key: names[0], color: colors[0] }, { key: names[1], color: colors[1] });
      const shown = [!ctx.hidden.has(names[0]), !ctx.hidden.has(names[1])];
      const nameW = Math.min(W * 0.36, widest(items.map((d) => d.key), nameFont) + 16);
      const cols = rowTable({ width: W, height: H, rows: items.length, nameWidth: nameW, minBar: 150 + 2 * valueW, above: head, maxThickness: style.thickness as number });
      bands = cols.bands;
      const all = items.flatMap((d) => [d.left, d.right]).filter((v) => Number.isFinite(v));
      const lo = Math.min(base, ...all);
      const hi = Math.max(base, ...all);
      const x0 = cols.x0 + valueW;
      const x1 = cols.x1 - valueW;
      const at = (v: number) => x0 + ((v - lo) / (hi - lo || 1)) * Math.max(1, x1 - x0);
      const bx = at(base);
      items.forEach((d, i) => {
        const y0 = rowTop(i);
        const y1 = y0 + bands.thickness;
        const cy = (y0 + y1) / 2;
        // The longer bar first: when both outcomes fall on the same side, the shorter stays visible.
        const sides = ([0, 1] as const)
          .filter((s) => shown[s] && Number.isFinite(s ? d.right : d.left))
          .sort((a, b) => Math.abs((b ? d.right : d.left) - base) - Math.abs((a ? d.right : d.left) - base));
        for (const s of sides) {
          const v = s ? d.right : d.left;
          const tip = at(v);
          hbar(rects, F, bx, tip, y0, y1, ctx.paint(colors[s], d.row), r);
          keys.push(`${d.key}\u0000${s}`);
          if (showValues) labels.push({ ...value, tx: X(tip), ty: Y(cy), text: text(d, s), align: v < base ? 'right' : 'left', dx: v < base ? -5 : 5 });
        }
        const name = fit(d.key, cols.nameWidth - 8, nameFont);
        labels.push({ tx: X(0), ty: Y(cols.stacked ? y0 - 9 : cy), text: name, color: theme.text.primary, size: 12, weight: 600, align: 'left', baseline: 'middle' });
      });
      if (items.length) {
        const yA = bands.top - 3;
        const yB = bands.top + items.length * bands.rowH + 2;
        pushSegment(lines, X(bx), Y(yA), X(bx), Y(yB), parseColor(theme.text.secondary), 1);
        labels.unshift({ tx: X(bx), ty: Y(yA - 4), text: `Base : ${ctx.format(base, fields[0])}`, color: theme.text.secondary, size: 11, weight: 600, align: 'center', baseline: 'bottom' });
      }
    }

    const draws: MarkDraw[] = [];
    if (rects.length) draws.push({ batch: batchOf(ctx, 'rect', rects), pixelSnap: true, data: new Float32Array(rects), keys });
    if (lines.length) draws.push({ batch: batchOf(ctx, 'line', lines), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend: legend.length ? legend : undefined,
      pick(tx, ty): ShapeHit | null {
        const y = (1 - ty) * H;
        const i = Math.floor((y - bands.top) / bands.rowH);
        const d = items[i];
        if (!d || tx < 0 || tx > 1 || y < bands.top) return null;
        const out = ([0, 1] as const).filter((s) => text(d, s)).map((s) => ({ label: names[s], value: text(d, s) }));
        if (sensitivity) out.push({ label: 'Amplitude', value: ctx.format(tornadoAmplitude(d, base), fields[0]) });
        return { title: d.key, rows: out };
      },
    };
  },
};

// ----------------------------------------------------------------- variwide

/**
 * `variwide`: one bar per `key`, as tall as `value` and as wide as `size` (hourly cost × hours worked:
 * the area is the total). Bars are not stacked; names go under them, on a second line when a bar is
 * too narrow for its name.
 */
export const variwide: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'variwide');
    const vf = layer.encode.value ?? need(layer, 'y', 'variwide');
    const wf = need(layer, 'size', 'variwide');
    const cf = layer.encode.color && table.has(layer.encode.color) ? layer.encode.color : undefined;
    const k = table.column(kf).values;
    const v = table.column(vf).values as Float64Array;
    const w = table.column(wf).values as Float64Array;
    const groups = cf ? table.column(cf).values : undefined;
    let items = Array.from({ length: table.length }, (_, i) => ({ key: String(k[i]), value: v[i], size: w[i], group: groups ? String(groups[i]) : '', row: i })).filter(
      (d) => Number.isFinite(d.value) && d.size > 0,
    );
    const legend = cf ? [...new Set(items.map((d) => d.group))].map((key) => ({ key, color: ctx.categorical(key) })) : undefined;
    items = items.filter((d) => !ctx.hidden.has(d.group));
    if (style.sorted) items = items.map((d, i) => ({ d, i })).sort((a, b) => b.d.value - a.d.value || a.i - b.i).map((e) => e.d);
    const single = cf ? undefined : measureColor(ctx, vf);

    const F = frame(ctx);
    const { W, H, X, Y } = F;
    const family = theme.font.family;
    const axis = theme.axis.label;
    const hi = niceDomain(0, Math.max(0, ...items.map((d) => d.value)) || 1)[1];
    const valueFormat = ctx.fields[vf]?.format;
    const ticks = new LinearScale(0, hi, valueFormat ? { ...valueFormat, decimals: undefined } : undefined).ticks(0, 1, Math.max(2, Math.min(5, Math.round(H / 60))));
    const left = widest(ticks.map((t) => t.label), `${axis.weight} ${axis.size}px ${family}`) + 8;
    const cols = variwideColumns(items.map((d) => d.size), Math.max(1, W - left), style.gap as number);

    // Names under the bars: a second (then a third) line for those that would run into their neighbour.
    const nameFont = `500 11px ${family}`;
    const names = items.map((d) => fit(d.key, Math.min(120, W / 2.5), nameFont));
    const placed = staggerLabels(
      items.map((_, i) => ({ center: left + (cols[i].x0 + cols[i].x1) / 2, width: textWidth(names[i], nameFont) })),
      { levels: H >= 300 ? 3 : 2, min: left, max: W },
    );
    const usedLevels = 1 + Math.max(0, ...placed.map((p) => p.level));
    const caption = 16;
    const lineH = 15;
    const bottom = 7 + usedLevels * lineH + caption;
    const top = style.labels ? 18 : 6;
    const baseY = H - bottom;
    const at = (value: number) => baseY - (Math.max(0, value) / hi) * Math.max(1, baseY - top);

    const rects: number[] = [];
    const lines: number[] = [];
    const leaders: number[] = [];
    const labels: MarkLabel[] = [];
    const grid = parseColor(theme.grid.y.color);
    for (const t of ticks) {
      if (t.t < -1e-6 || t.t > 1 + 1e-6) continue;
      const y = baseY - t.t * (baseY - top);
      pushSegment(lines, X(left), Y(y), X(W), Y(y), t.t < 1e-6 ? parseColor(theme.axis.line.color) : grid, 1);
      labels.push({ tx: X(left), ty: Y(y), text: t.label, color: axis.color, size: axis.size, weight: axis.weight, align: 'right', baseline: 'middle', dx: -6 });
    }
    const r = style.radius as number;
    const muted = withAlpha(parseColor(theme.text.muted), 0.7);
    const above: (MarkLabel | undefined)[] = [];
    const boxes = items.map((d, i) => {
      const x0 = left + cols[i].x0;
      const x1 = left + cols[i].x1;
      const y = at(d.value);
      const fill = ctx.paint(single ?? ctx.categorical(d.group), d.row);
      pushRect(rects, { x0: X(x0), y0: Y(baseY), x1: X(x1), y1: Y(y), fill, radii: [r, r, 0, 0] });
      const cx = (x0 + x1) / 2;
      if (style.labels) {
        // The height above the bar; the width inside it, at its foot, when there is room.
        above[i] = { tx: X(cx), ty: Y(y), text: ctx.format(d.value, vf), color: theme.text.primary, size: 11, weight: 600, align: 'center', baseline: 'bottom', dy: -4 };
        labels.push({ tx: X(cx), ty: Y(baseY), text: ctx.format(d.size, wf), on: fill, size: 10, weight: 500, align: 'center', baseline: 'bottom', dy: -5, box: [X(x0), Y(baseY), X(x1), Y(y)] });
      }
      const p = placed[i];
      if (p.level >= 0) {
        const ly = baseY + 7 + p.level * lineH;
        if (p.level > 0) {
          // The leader lands on the name, even when the name was pushed back inside the chart.
          const half = Math.max(0, textWidth(names[i], nameFont) / 2 - 3);
          pushSegment(leaders, X(cx), Y(baseY + 2), X(Math.min(p.x + half, Math.max(p.x - half, cx))), Y(ly - 2), muted, 1);
        }
        labels.push({ tx: X(p.x), ty: Y(ly), text: names[i], color: theme.text.secondary, size: 11, weight: 500, align: 'center', baseline: 'top' });
      } else {
        // No room for the name: a stub says a bar is there, the tooltip names it.
        pushSegment(leaders, X(cx), Y(baseY + 2), X(cx), Y(baseY + 5), muted, 1);
      }
      return { x0, x1, y };
    });
    // Wide bars keep their value when two labels would touch.
    const valueFont = `600 11px ${family}`;
    items
      .map((_, i) => i)
      .sort((a, b) => boxes[b].x1 - boxes[b].x0 - (boxes[a].x1 - boxes[a].x0))
      .forEach((i) => {
        const l = above[i];
        if (!l) return;
        // Kept clear of the graduations, and left out when it would lie across a taller neighbour.
        const half = textWidth(l.text, valueFont) / 2;
        const cx = Math.max((boxes[i].x0 + boxes[i].x1) / 2, left + half + 2);
        const hidden = boxes.some((b, j) => j !== i && b.x1 > cx - half - 2 && b.x0 < cx + half + 2 && b.y < boxes[i].y - 3);
        if (!hidden) labels.push({ ...l, tx: X(cx) });
      });
    if (items.length) {
      const text = fit(`↕ ${fieldLabel(ctx, vf)}   ↔ ${fieldLabel(ctx, wf)}`, W - left, `500 10.5px ${family}`);
      labels.push({ tx: X(left), ty: Y(H - 1), text, color: theme.text.muted, size: 10.5, align: 'left', baseline: 'bottom' });
    }

    const draws: MarkDraw[] = [];
    if (lines.length) draws.push({ batch: batchOf(ctx, 'line', lines), enter: 'fade' });
    if (rects.length) draws.push({ batch: batchOf(ctx, 'rect', rects), pixelSnap: true, data: new Float32Array(rects), keys: items.map((d) => d.key) });
    if (leaders.length) draws.push({ batch: batchOf(ctx, 'line', leaders), enter: 'fade' });
    const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = tx * W;
        const y = (1 - ty) * H;
        const i = boxes.findIndex((b) => x >= b.x0 && x <= b.x1 && y >= b.y - 4 && y <= baseY + 4);
        if (i < 0) return null;
        const d = items[i];
        return {
          title: d.key,
          rows: [
            { label: fieldLabel(ctx, vf), value: ctx.format(d.value, vf) },
            { label: fieldLabel(ctx, wf), value: ctx.format(d.size, wf) },
            { label: 'Hauteur × largeur', value: plain.format(d.value * d.size) },
          ],
        };
      },
    };
  },
};

// ------------------------------------------------------------------ barRank

/**
 * `barRank`: a ranking with its history. One row per `key`, sorted by `value`: rank, places gained
 * or lost since the previous period (`encode.previous`), the bar of the current value with a tick at
 * the previous one, the value and its change.
 */
export const barRank: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'barRank');
    const vf = layer.encode.value ?? need(layer, 'x', 'barRank');
    const pf = layer.encode.previous && table.has(layer.encode.previous) ? layer.encode.previous : undefined;
    const k = table.column(kf).values;
    const v = table.column(vf).values as Float64Array;
    const p = pf ? (table.column(pf).values as Float64Array) : undefined;
    let items = rankItems(Array.from({ length: table.length }, (_, i) => ({ key: String(k[i]), value: v[i], previous: p ? p[i] : NaN, row: i })));
    const F = frame(ctx);
    const { W, H, X, Y } = F;
    const footer = pf ? 18 : 0;
    // Rows squeezed under a readable height are left out: the top of the ranking stays.
    const cap = Math.max(1, Math.floor((H - footer) / 16));
    items = items.slice(0, Math.min(cap, (style.top as number) > 0 ? (style.top as number) : items.length));

    const family = theme.font.family;
    const nameFont = `600 12px ${family}`;
    const figFont = `650 12px ${family}`;
    const smallFont = `600 11px ${family}`;
    const good = auto(style.good, theme.marks.kpi.good);
    const bad = auto(style.bad, theme.marks.kpi.bad);
    const tone = (up: boolean) => (up === !!style.upIsGood ? good : bad);
    const moveText = (d: (typeof items)[number]) => (Number.isNaN(d.move) ? '–' : d.move > 0 ? `▲ ${d.move}` : d.move < 0 ? `▼ ${-d.move}` : '=');
    const changeText = (d: (typeof items)[number]) => (Number.isNaN(d.change) ? '–' : signedPercent(d.change));
    const valueText = items.map((d) => ctx.format(d.value, vf));

    const rankW = widest(items.map((d) => String(d.rank)), figFont) + 8;
    const moveW = pf ? widest(items.map(moveText), smallFont) + 12 : 0;
    const showFigures = !!style.labels;
    const valueW = showFigures ? widest(valueText, figFont) + 12 : 0;
    const changeW = showFigures && pf ? widest(items.map(changeText), smallFont) + 10 : 0;
    const nameW = Math.min(W * 0.3, widest(items.map((d) => d.key), nameFont) + 14);
    const lead = rankW + moveW;
    const after = valueW + changeW;
    const stacked = W - lead - nameW - after < 130;
    // A line of text above each bar takes room: fewer rows rather than hairlines.
    if (stacked) items = items.slice(0, Math.max(1, Math.floor((H - footer) / 27)));
    const cols = stacked ? { stacked, x0: 0, x1: W, nameWidth: W - lead - after } : { stacked, x0: lead + nameW, x1: W - after, nameWidth: nameW };
    const T = style.thickness as number;
    const bands = rowBands({ height: H, rows: items.length, below: footer, header: stacked ? 17 : 0, maxThickness: T, spacing: stacked ? 10 : Math.max(16, T * 0.9) });

    const hi = Math.max(1e-12, ...items.flatMap((d) => [d.value, Number.isFinite(d.previous) ? d.previous : 0]));
    const at = (value: number) => cols.x0 + (Math.max(0, value) / hi) * Math.max(1, cols.x1 - cols.x0);
    const ink = parseColor(theme.text.primary);
    const track = mix(ctx.surface, ink, 0.07);
    const accent = measureColor(ctx, vf);
    const tracks: number[] = [];
    const bars: number[] = [];
    const marks: number[] = [];
    const labels: MarkLabel[] = [];
    const r = style.radius as number;

    items.forEach((d, i) => {
      const y0 = bands.top + i * bands.rowH + bands.barTop;
      const y1 = y0 + bands.thickness;
      const cy = (y0 + y1) / 2;
      hbar(tracks, F, cols.x0, cols.x1, y0, y1, [track[0], track[1], track[2], 1], r, r);
      hbar(bars, F, cols.x0, at(d.value), y0, y1, ctx.paint(accent, d.row), r);
      if (Number.isFinite(d.previous)) {
        const x = at(d.previous);
        const over = Math.min(4, Math.max(1, (bands.rowH - bands.thickness) / 2 - 1));
        pushRect(marks, { x0: X(x - 1.5), y0: Y(y1 + over), x1: X(x + 1.5), y1: Y(y0 - over), fill: ink, stroke: ctx.surface, strokeWidth: 1, radii: [1, 1, 1, 1] });
      }
      const ty = Y(cols.stacked ? y0 - 9 : cy);
      const line = { ty, baseline: 'middle' as const };
      labels.push({ ...line, tx: X(0), text: String(d.rank), color: theme.text.primary, size: 12, weight: 650, align: 'left' });
      if (pf) {
        const color = Number.isNaN(d.move) || d.move === 0 ? theme.text.muted : tone(d.move > 0);
        labels.push({ ...line, tx: X(rankW), text: moveText(d), color, size: 11, weight: 600, align: 'left' });
      }
      labels.push({ ...line, tx: X(lead), text: fit(d.key, cols.nameWidth - 8, nameFont), color: theme.text.primary, size: 12, weight: 600, align: 'left' });
      if (showFigures) {
        labels.push({ ...line, tx: X(W - changeW), text: valueText[i], color: theme.text.primary, size: 12, weight: 650, align: 'right' });
        if (pf) {
          const color = Number.isNaN(d.change) || d.change === 0 ? theme.text.muted : tone(d.change > 0);
          labels.push({ ...line, tx: X(W), text: changeText(d), color, size: 11, weight: 600, align: 'right' });
        }
      }
    });
    if (pf && items.length) {
      // What the tick stands for, under the bars.
      const y = bands.top + items.length * bands.rowH + 9;
      pushRect(marks, { x0: X(cols.x0), y0: Y(y + 5), x1: X(cols.x0 + 3), y1: Y(y - 5), fill: ink, radii: [1, 1, 1, 1] });
      labels.push({ tx: X(cols.x0 + 8), ty: Y(y), text: fieldLabel(ctx, pf), color: theme.text.muted, size: 10.5, align: 'left', baseline: 'middle' });
    }

    const draws: MarkDraw[] = [];
    if (tracks.length) draws.push({ batch: batchOf(ctx, 'rect', tracks), pixelSnap: true, enter: 'fade' });
    if (bars.length) draws.push({ batch: batchOf(ctx, 'rect', bars), pixelSnap: true, data: new Float32Array(bars), keys: items.map((d) => d.key) });
    if (marks.length) draws.push({ batch: batchOf(ctx, 'rect', marks), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const y = (1 - ty) * H;
        const i = Math.floor((y - bands.top) / bands.rowH);
        const d = items[i];
        if (!d || tx < 0 || tx > 1 || y < bands.top) return null;
        const out = [{ label: fieldLabel(ctx, vf), value: valueText[i] }];
        if (pf && Number.isFinite(d.previous)) {
          out.push({ label: fieldLabel(ctx, pf), value: ctx.format(d.previous, pf) });
          out.push({ label: 'Variation', value: changeText(d) });
        }
        out.push({ label: 'Rang', value: Number.isFinite(d.previousRank) && d.previousRank !== d.rank ? `${d.rank} (était ${d.previousRank})` : String(d.rank) });
        return { title: d.key, rows: out };
      },
    };
  },
};

// ----------------------------------------------------------------- barInBar

/**
 * `barInBar`: actual against goal, one row per `key`: a wide pale bar for the goal (`encode.target`)
 * and a slim bar for `value` inside it, with the share reached at the end of the row.
 */
export const barInBar: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales: unitScales,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'barInBar');
    const vf = layer.encode.value ?? need(layer, 'x', 'barInBar');
    const tf = need(layer, 'target', 'barInBar');
    const k = table.column(kf).values;
    const v = table.column(vf).values as Float64Array;
    const t = table.column(tf).values as Float64Array;
    let items = Array.from({ length: table.length }, (_, i) => ({ key: String(k[i]), value: v[i], target: t[i], row: i })).filter((d) => Number.isFinite(d.value));
    if (style.sorted) items = items.map((d, i) => ({ d, i })).sort((a, b) => b.d.value - a.d.value || a.i - b.i).map((e) => e.d);

    const F = frame(ctx);
    const { W, H, X, Y } = F;
    const family = theme.font.family;
    const nameFont = `600 12px ${family}`;
    const figFont = `650 12px ${family}`;
    const smallFont = `600 11px ${family}`;
    const good = auto(style.good, theme.marks.kpi.good);
    const bad = auto(style.bad, theme.marks.kpi.bad);
    const reached = (d: (typeof items)[number]) => (d.target > 0 ? d.value / d.target : NaN);
    const shareText = (d: (typeof items)[number]) => (Number.isNaN(reached(d)) ? '–' : percent0(reached(d)));
    const valueText = items.map((d) => ctx.format(d.value, vf));
    const showFigures = !!style.labels;
    const valueW = showFigures ? widest(valueText, figFont) + 12 : 0;
    const shareW = showFigures ? widest(items.map(shareText), smallFont) + 10 : 0;
    const nameW = Math.min(W * 0.34, widest(items.map((d) => d.key), nameFont) + 14);
    const head = 20;
    const cols = rowTable({ width: W, height: H, rows: items.length, nameWidth: nameW, after: valueW + shareW, minBar: 130, above: head, maxThickness: style.thickness as number });
    const names = [fieldLabel(ctx, vf), fieldLabel(ctx, tf)];
    const bands = cols.bands;
    const hi = Math.max(1e-12, ...items.flatMap((d) => [d.value, Number.isFinite(d.target) ? d.target : 0]));
    const at = (value: number) => cols.x0 + (Math.max(0, value) / hi) * Math.max(1, cols.x1 - cols.x0);
    const accent = measureColor(ctx, vf);
    const pale = (c: RGBA): RGBA => {
      const m = mix(ctx.surface, c, 0.28);
      return [m[0], m[1], m[2], 1];
    };
    const outer: number[] = [];
    const inner: number[] = [];
    const legendKey: number[] = [];
    const labels: MarkLabel[] = [];
    const r = style.radius as number;
    const slim = Math.min(0.9, Math.max(0.15, style.inner as number));

    items.forEach((d, i) => {
      const y0 = bands.top + i * bands.rowH + bands.barTop;
      const y1 = y0 + bands.thickness;
      const cy = (y0 + y1) / 2;
      const color = ctx.paint(accent, d.row);
      if (Number.isFinite(d.target)) hbar(outer, F, cols.x0, at(d.target), y0, y1, pale(color), r);
      const half = Math.max(1.5, (bands.thickness * slim) / 2);
      hbar(inner, F, cols.x0, at(d.value), cy - half, cy + half, color, Math.min(r, 2));
      const line = { ty: Y(cols.stacked ? y0 - 9 : cy), baseline: 'middle' as const };
      labels.push({ ...line, tx: X(0), text: fit(d.key, cols.nameWidth - 8, nameFont), color: theme.text.primary, size: 12, weight: 600, align: 'left' });
      if (showFigures) {
        labels.push({ ...line, tx: X(W - shareW), text: valueText[i], color: theme.text.primary, size: 12, weight: 650, align: 'right' });
        const s = reached(d);
        const color2 = Number.isNaN(s) ? theme.text.muted : s >= 1 === !!style.upIsGood ? good : bad;
        labels.push({ ...line, tx: X(W), text: shareText(d), color: color2, size: 11, weight: 600, align: 'right' });
      }
    });
    if (items.length) {
      // A key above the rows: the slim bar and the wide one.
      const y = bands.top - 9;
      const font = `500 10.5px ${family}`;
      const key = { ty: Y(y), color: theme.text.muted, size: 10.5, baseline: 'middle' as const, align: 'left' as const };
      const x0 = cols.x0;
      hbar(legendKey, F, x0, x0 + 14, y - 2, y + 2, accent, 1, 1);
      labels.push({ ...key, tx: X(x0 + 19), text: names[0] });
      const x1 = x0 + 19 + textWidth(names[0], font) + 14;
      hbar(legendKey, F, x1, x1 + 14, y - 5, y + 5, pale(accent), 2, 2);
      labels.push({ ...key, tx: X(x1 + 19), text: names[1] });
    }

    const draws: MarkDraw[] = [];
    const withTarget = items.filter((d) => Number.isFinite(d.target));
    if (outer.length) draws.push({ batch: batchOf(ctx, 'rect', outer), pixelSnap: true, data: new Float32Array(outer), keys: withTarget.map((d) => d.key) });
    if (inner.length) draws.push({ batch: batchOf(ctx, 'rect', inner), pixelSnap: true, data: new Float32Array(inner), keys: items.map((d) => d.key) });
    if (legendKey.length) draws.push({ batch: batchOf(ctx, 'rect', legendKey), enter: 'fade' });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const y = (1 - ty) * H;
        const i = Math.floor((y - bands.top) / bands.rowH);
        const d = items[i];
        if (!d || tx < 0 || tx > 1 || y < bands.top) return null;
        const out = [{ label: names[0], value: valueText[i] }];
        if (Number.isFinite(d.target)) {
          out.push({ label: names[1], value: ctx.format(d.target, tf) });
          out.push({ label: 'Réalisé', value: shareText(d) });
        }
        return { title: d.key, rows: out };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const COMPARE_MARKS: Record<string, MarkDefinition> = { likert, tornado, variwide, barRank, barInBar };
