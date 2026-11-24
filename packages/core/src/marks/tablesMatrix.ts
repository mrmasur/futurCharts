/**
 * `matrix` (adjacency / flow matrix), `confusion` (confusion matrix of a classifier) and
 * `calendarMonth` (one month as a grid of weeks). Laid out in px, text as labels.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import { mix, parseColor, withAlpha } from '../util/color';
import { need, share } from './charts';
import { pushRect } from './primitives';
import { emptyHit, type BuildContext, type BuiltMark, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { confusionStats, ellipsis, headerTexts, monthGrid, orderEntities } from './tablesLayout';
import { fillText } from '../theme/texts';

export function batchOf(ctx: BuildContext, kind: 'rect' | 'line' | 'point', data: number[]) {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

/** A rect batch whose instances keep their identity (they move to their new place when the data changes). */
function keyed(ctx: BuildContext, rects: number[], keys: string[]): BuiltMark['draws'][number] {
  const data = new Float32Array(rects);
  const b = ctx.renderer.createBatch('rect');
  b.update(data, keys.length);
  return { batch: b, data, keys, enter: 'fade' };
}

const fieldLabel = (ctx: BuildContext, f: string | undefined, fallback: string) => (f ? (ctx.fields[f]?.label ?? f) : fallback);
const percent = (v: number, digits = 0) => (Number.isNaN(v) ? '–' : new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: digits }).format(v));

// ------------------------------------------------------------------- matrix

/**
 * `matrix`: every entity is a row (as `source`) and a column (as `target`); a cell is shaded by
 * the summed `value` (or the number of rows). `group` keeps the entities of a group together,
 * apart from the next one, under a colored strip and the name of the group. Column titles that
 * do not fit lean at 45°, or are abbreviated or numbered on a small chart.
 */
export const matrix: MarkDefinition = {
  standalone: true,
  // Laid out in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const sf = need(layer, 'source', 'matrix');
    const tf = need(layer, 'target', 'matrix');
    const vf = layer.encode.value;
    const gf = layer.encode.group;
    const src = table.column(sf).values;
    const dst = table.column(tf).values;
    const vals = vf ? (table.column(vf).values as Float64Array) : undefined;
    const grp = gf ? table.column(gf).values : undefined;

    const names: string[] = [];
    const index = new Map<string, number>();
    const groupOf: (string | undefined)[] = [];
    const add = (name: string) => {
      let i = index.get(name);
      if (i === undefined) {
        index.set(name, (i = names.length));
        names.push(name);
        groupOf.push(undefined);
      }
      return i;
    };
    // Sources first, so that the groups come in the order of the data.
    for (let i = 0; i < table.length; i++) {
      const a = add(String(src[i]));
      if (grp && groupOf[a] === undefined) groupOf[a] = String(grp[i]);
    }
    for (let i = 0; i < table.length; i++) add(String(dst[i]));
    const n = names.length;
    const cell = new Float64Array(n * n);
    const first = new Int32Array(n * n).fill(-1);
    const sent = new Float64Array(n);
    const received = new Float64Array(n);
    for (let i = 0; i < table.length; i++) {
      const v = vals ? vals[i] : 1;
      if (Number.isNaN(v)) continue;
      const a = index.get(String(src[i]))!;
      const b = index.get(String(dst[i]))!;
      cell[a * n + b] += v;
      if (first[a * n + b] < 0) first[a * n + b] = i;
      sent[a] += v;
      received[b] += v;
    }
    const groups = groupOf.map((g) => g ?? '');
    const order = orderEntities(names, groups, names.map((_, i) => sent[i] + received[i]), style.ordering);
    // Runs of the same group along the order.
    const runs: { name: string; from: number; to: number }[] = [];
    order.forEach((e, k) => {
      const last = runs[runs.length - 1];
      if (last && last.name === groups[e]) last.to = k + 1;
      else runs.push({ name: groups[e], from: k, to: k + 1 });
    });
    const runOf = order.map((_, k) => runs.findIndex((r) => k >= r.from && k < r.to));
    let maxV = 0;
    for (const v of cell) maxV = Math.max(maxV, v);
    const maxT = Math.max(1e-12, ...sent, ...received);

    // Layout in px, then scale space (y down from the top).
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (v: number) => v * px;
    const Y = (v: number) => 1 - v * py;
    const family = theme.font.family;
    const compact = W < 420;
    const nameSize = compact ? 10 : 11;
    const nameFont = `500 ${nameSize}px ${family}`;
    const measure = (t: string) => textWidth(t, nameFont);
    const grouped = !!gf && runs.some((r) => r.name);
    const strip = grouped ? 7 : 0;
    const groupGap = runs.length > 1 ? 6 : 0;
    const gaps = (runs.length - 1) * groupGap;
    const groupH = grouped ? 16 : 0;
    let headH = 16;
    let top = groupH + strip + headH;
    // Totals in the margins only while the cells stay readable next to them.
    const totals = !!style.totals && (H - top - (compact ? 18 : 30) - gaps) / Math.max(1, n) >= 12;
    const totalW = totals ? (compact ? 30 : 78) : 0;
    const totalH = totals ? (compact ? 18 : 30) : 0;
    let nameW = Math.min(W * 0.3, Math.max(0, ...names.map(measure))) + 8;
    let cw = 0;
    let ch = 0;
    const size = () => {
      cw = Math.max(1, (W - nameW - strip - totalW - gaps) / Math.max(1, n));
      ch = Math.max(1, (H - top - totalH - gaps) / Math.max(1, n));
      cw = Math.min(cw, 96);
      ch = Math.min(ch, 56, cw);
      cw = Math.min(cw, ch * 2.4);
    };
    size();
    const ordered = order.map((e) => names[e]);
    const head = headerTexts(ordered, cw - 2, measure);
    // Names too long for their column lean at 45° when there is height for it; on a small
    // chart they are abbreviated or numbered instead.
    let leanW = Math.min(96, Math.max(0, ...ordered.map(measure)));
    const lean = head.mode !== 'name' && !compact && cw >= nameSize + 4 && leanW * Math.SQRT1_2 + 10 <= H * 0.22;
    if (lean) {
      headH = leanW * Math.SQRT1_2 + 10;
      top = groupH + strip + headH;
      size();
    }
    const numW = !lean && head.mode === 'index' ? measure(String(n)) + 8 : 0;
    if (numW) {
      nameW += numW;
      size();
      head.every = Math.max(1, Math.ceil((measure(String(n)) + 3) / cw));
    }
    const ox = Math.max(0, (W - (nameW + strip + n * cw + gaps + totalW)) / 2);
    const gx = ox + nameW + strip;
    const xs = order.map((_, k) => gx + k * cw + runOf[k] * groupGap);
    const ys = order.map((_, k) => top + k * ch + runOf[k] * groupGap);
    const right = n ? xs[n - 1] + cw : gx;
    const bottom = n ? ys[n - 1] + ch : top;
    // The last leaning title must not run off the chart.
    if (lean) leanW = Math.max(12, Math.min(leanW, (W - (right - cw / 2) - 4) / Math.SQRT1_2));

    const cells: number[] = [];
    const keys: string[] = [];
    const extras: number[] = [];
    const labels: MarkLabel[] = [];
    const muted = parseColor(theme.text.muted);
    const empty = withAlpha(muted, 0.07);
    const accent = parseColor(layer.style?.color ?? theme.palette.categorical[0]);
    const gap = Math.min(style.gap, Math.max(0, Math.min(cw, ch) - 2));
    const radius = Math.min(style.radius, Math.min(cw, ch) / 3);
    const radii: [number, number, number, number] = [radius, radius, radius, radius];

    // Group names and strips, above the columns and left of the rows (the names are there: no legend).
    if (grouped) {
      for (const r of runs) {
        if (!r.name) continue;
        const color = ctx.categorical(r.name);
        const [x0, x1] = [xs[r.from], xs[r.to - 1] + cw];
        const [y0, y1] = [ys[r.from], ys[r.to - 1] + ch];
        pushRect(extras, { x0: X(x0 + 1), y0: Y(groupH + 3), x1: X(x1 - 1), y1: Y(groupH), fill: color, radii: [1.5, 1.5, 1.5, 1.5] });
        pushRect(extras, { x0: X(gx - 6), y0: Y(y1 - 1), x1: X(gx - 3), y1: Y(y0 + 1), fill: color, radii: [1.5, 1.5, 1.5, 1.5] });
        const text = ellipsis(r.name, x1 - x0 - 2, (t) => textWidth(t, `600 11px ${family}`));
        if (text) labels.push({ tx: X((x0 + x1) / 2), ty: Y(groupH / 2), text, color: theme.text.primary, size: 11, weight: 600, align: 'center', baseline: 'middle' });
      }
    }
    // Column titles, then row names (the number of a row is the key of its column when titles are numbers).
    // A label needs its own height and a little air, or the chart would drop it against its neighbor.
    const rowEvery = Math.max(1, Math.ceil((nameSize + 3.5) / ch));
    order.forEach((e, k) => {
      if (lean) {
        labels.push({ tx: X(xs[k] + cw / 2), ty: Y(top - 4), text: names[e], color: theme.text.primary, size: nameSize, weight: 500, align: 'left', baseline: 'middle', rotate: -45, maxWidth: leanW });
      } else if (k % head.every === 0) {
        labels.push({ tx: X(xs[k] + cw / 2), ty: Y(top - headH / 2), text: head.texts[k], color: head.mode === 'name' ? theme.text.primary : theme.text.muted, size: nameSize, weight: 500, align: 'center', baseline: 'middle' });
      }
      if (k % rowEvery) return;
      const ym = ys[k] + ch / 2;
      const text = ellipsis(names[e], nameW - numW - 8, measure);
      if (numW) labels.push({ tx: X(gx - strip - 4), ty: Y(ym), text: String(k + 1), color: theme.text.muted, size: nameSize, weight: 500, align: 'right', baseline: 'middle' });
      if (text) labels.push({ tx: X(gx - strip - 4 - numW), ty: Y(ym), text, color: theme.text.primary, size: nameSize, weight: 500, align: 'right', baseline: 'middle' });
    });
    // Cells.
    order.forEach((a, r) => {
      order.forEach((b, c) => {
        const v = cell[a * n + b];
        const row = first[a * n + b];
        const fill = v > 0 ? ctx.paint(ctx.ramp(0.1 + 0.85 * (maxV > 0 ? v / maxV : 0)), row < 0 ? undefined : row) : empty;
        const box: [number, number, number, number] = [X(xs[c]), Y(ys[r] + ch), X(xs[c] + cw), Y(ys[r])];
        pushRect(cells, { x0: X(xs[c] + gap / 2), y0: Y(ys[r] + ch - gap / 2), x1: X(xs[c] + cw - gap / 2), y1: Y(ys[r] + gap / 2), fill, radii });
        keys.push(`${names[a]}→${names[b]}`);
        if (style.labels && v > 0) labels.push({ tx: X(xs[c] + cw / 2), ty: Y(ys[r] + ch / 2), text: ctx.format(v, vf), on: fill, size: cw < 34 ? 9 : 10, weight: 500, align: 'center', baseline: 'middle', box });
      });
    });
    // Totals in the margins: sent on the right, received underneath.
    if (totals && n) {
      const bar = withAlpha(accent, 0.85);
      const reach = compact ? totalW - 10 : totalW - 8 - 38;
      const th = Math.max(2, Math.min(10, ch - 4));
      const tw = Math.max(2, Math.min(10, cw - 4));
      order.forEach((e, k) => {
        const ym = ys[k] + ch / 2;
        const len = (sent[e] / maxT) * reach;
        if (sent[e] > 0) pushRect(extras, { x0: X(right + 8), y0: Y(ym + th / 2), x1: X(right + 8 + Math.max(1.5, len)), y1: Y(ym - th / 2), fill: bar, radii: [0, 2, 2, 0] });
        if (!compact && k % rowEvery === 0) labels.push({ tx: X(right + 12 + len), ty: Y(ym), text: ctx.format(sent[e], vf), color: theme.text.muted, size: 10, weight: 500, align: 'left', baseline: 'middle' });
        const xm = xs[k] + cw / 2;
        const tall = (received[e] / maxT) * (totalH - 8);
        if (received[e] > 0) pushRect(extras, { x0: X(xm - tw / 2), y0: Y(bottom + 6 + Math.max(1.5, tall)), x1: X(xm + tw / 2), y1: Y(bottom + 6), fill: bar, radii: [0, 0, 2, 2] });
      });
      if (!compact) {
        labels.push({ tx: X(right + 8), ty: Y(bottom + 6 + (totalH - 8) / 2), text: ctx.theme.texts.sent, color: theme.text.muted, size: 10, weight: 600, align: 'left', baseline: 'middle' });
        labels.push({ tx: X(gx - strip - 4), ty: Y(bottom + 6 + (totalH - 8) / 2), text: ctx.theme.texts.received, color: theme.text.muted, size: 10, weight: 600, align: 'right', baseline: 'middle' });
      }
    }

    const draws: BuiltMark['draws'] = [];
    if (cells.length) draws.push(keyed(ctx, cells, keys));
    if (extras.length) draws.push({ batch: batchOf(ctx, 'rect', extras) });
    const valueLabel = fieldLabel(ctx, vf, ctx.theme.texts.number);
    const at = (starts: number[], step: number, v: number) => starts.findIndex((s) => v >= s && v < s + step);
    const entity = (e: number): ShapeHit => ({
      title: names[e],
      rows: [
        ...(groups[e] ? [{ label: fieldLabel(ctx, gf, ctx.theme.texts.group), value: groups[e] }] : []),
        { label: ctx.theme.texts.sent, value: ctx.format(sent[e], vf) },
        { label: ctx.theme.texts.received, value: ctx.format(received[e], vf) },
      ],
    });
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const x = tx / px;
        const y = (1 - ty) / py;
        const c = at(xs, cw, x);
        const r = at(ys, ch, y);
        if (r >= 0 && c >= 0) {
          const [a, b] = [order[r], order[c]];
          const v = cell[a * n + b];
          return {
            title: `${names[a]} → ${names[b]}`,
            rows: [
              { label: valueLabel, value: ctx.format(v, vf) },
              { label: fillText(ctx.theme.texts.shareOf, { name: names[a] }), value: share(v, sent[a]) },
            ],
          };
        }
        if (r >= 0 && x >= ox && x <= right + totalW) return entity(order[r]);
        if (c >= 0 && y >= 0 && y <= bottom + totalH) return entity(order[c]);
        return null;
      },
    };
  },
};

// ---------------------------------------------------------------- confusion

/**
 * `confusion`: actual classes (`y`) in rows, predicted classes (`x`) in columns, the count of
 * cases in each cell (`value`, or one per row). The diagonal (well classified) takes the accent
 * color, the errors the bad color, both shaded by their share. Recall per class on the right,
 * precision underneath, accuracy in the corner.
 */
export const confusion: MarkDefinition = {
  standalone: true,
  // Laid out in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const af = need(layer, 'y', 'confusion');
    const pf = need(layer, 'x', 'confusion');
    const vf = layer.encode.value;
    const actual = table.column(af).values;
    const predicted = table.column(pf).values;
    const vals = vf ? (table.column(vf).values as Float64Array) : undefined;
    const names: string[] = [];
    const index = new Map<string, number>();
    for (const col of [actual, predicted]) {
      for (let i = 0; i < table.length; i++) {
        const k = String(col[i]);
        if (!index.has(k)) {
          index.set(k, names.length);
          names.push(k);
        }
      }
    }
    const K = names.length;
    const m = names.map(() => new Array<number>(K).fill(0));
    const first = names.map(() => new Array<number>(K).fill(-1));
    for (let i = 0; i < table.length; i++) {
      const v = vals ? vals[i] : 1;
      if (Number.isNaN(v)) continue;
      const a = index.get(String(actual[i]))!;
      const p = index.get(String(predicted[i]))!;
      m[a][p] += v;
      if (first[a][p] < 0) first[a][p] = i;
    }
    const stats = confusionStats(m);
    const base = (a: number, p: number) => (style.normalize === 'column' ? stats.columns[p] : style.normalize === 'total' ? stats.total : stats.rows[a]);
    const part = (a: number, p: number) => (base(a, p) > 0 ? m[a][p] / base(a, p) : 0);

    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (v: number) => v * px;
    const Y = (v: number) => 1 - v * py;
    const family = theme.font.family;
    const compact = W < 420;
    const nameFont = `600 11px ${family}`;
    const measure = (t: string) => textWidth(t, nameFont);
    const margins = !!style.margins;
    const marginW = margins ? (compact ? 48 : 68) : 0;
    const marginH = margins ? (compact ? 24 : 40) : 0;
    const marginGap = margins ? 6 : 0;
    const titleH = 16;
    const headH = 18;
    const top = titleH + headH;
    let nameW = Math.min(W * 0.28, Math.max(measure(ctx.theme.texts.precision), ...names.map(measure))) + 10;
    let cw = 0;
    let ch = 0;
    const size = () => {
      cw = Math.max(1, Math.min(190, (W - nameW - marginW - marginGap) / Math.max(1, K)));
      ch = Math.max(1, Math.min(110, (H - top - marginH - marginGap) / Math.max(1, K)));
      cw = Math.min(cw, ch * 2.8);
    };
    size();
    const head = headerTexts(names, cw - 6, measure);
    const numW = head.mode === 'index' ? measure(String(K)) + 8 : 0;
    if (numW) {
      nameW += numW;
      size();
      head.every = Math.max(1, Math.ceil((measure(String(K)) + 3) / cw));
    }
    const ox = Math.max(0, (W - (nameW + K * cw + marginGap + marginW)) / 2);
    const gx = ox + nameW;
    const right = gx + K * cw;
    const bottom = top + K * ch;

    const cells: number[] = [];
    const keys: string[] = [];
    const extras: number[] = [];
    const labels: MarkLabel[] = [];
    const muted = parseColor(theme.text.muted);
    const accent = parseColor(layer.style?.color ?? theme.palette.categorical[0]);
    const bad = parseColor(!style.bad || style.bad === 'auto' ? theme.marks.kpi.bad : style.bad);
    const quiet = mix(ctx.surface, muted, 0.08);
    const gap = Math.min(style.gap, Math.max(0, Math.min(cw, ch) - 2));
    const radius = Math.min(style.radius, Math.min(cw, ch) / 3);
    const radii: [number, number, number, number] = [radius, radius, radius, radius];
    const ink = theme.text.primary;

    labels.push({ tx: X(gx + (K * cw) / 2), ty: Y(titleH / 2), text: fieldLabel(ctx, pf, ctx.theme.texts.predicted), color: theme.text.muted, size: 11, weight: 600, align: 'center', baseline: 'middle' });
    const actualLabel = ellipsis(fieldLabel(ctx, af, ctx.theme.texts.actual), nameW - 8, measure);
    if (actualLabel) labels.push({ tx: X(gx - 8), ty: Y(titleH + headH / 2), text: actualLabel, color: theme.text.muted, size: 11, weight: 600, align: 'right', baseline: 'middle' });
    names.forEach((name, k) => {
      if (k % head.every === 0) labels.push({ tx: X(gx + (k + 0.5) * cw), ty: Y(titleH + headH / 2), text: head.texts[k], color: ink, size: 11, weight: 600, align: 'center', baseline: 'middle' });
      const ym = top + (k + 0.5) * ch;
      const text = ellipsis(name, nameW - numW - 10, measure);
      if (numW) labels.push({ tx: X(gx - 8), ty: Y(ym), text: String(k + 1), color: theme.text.muted, size: 11, weight: 600, align: 'right', baseline: 'middle' });
      if (text) labels.push({ tx: X(gx - 8 - numW), ty: Y(ym), text, color: ink, size: 11, weight: 600, align: 'right', baseline: 'middle' });
    });
    const two = ch >= 38 && cw >= 40;
    for (let a = 0; a < K; a++) {
      for (let p = 0; p < K; p++) {
        const v = m[a][p];
        const t = part(a, p);
        const hue = a === p ? mix(ctx.surface, accent, 0.16 + 0.84 * t) : v > 0 ? mix(ctx.surface, bad, 0.1 + 0.8 * Math.min(1, t * 1.6)) : quiet;
        const fill = ctx.paint(hue, first[a][p] < 0 ? undefined : first[a][p]);
        const [x0, y0] = [gx + p * cw, top + a * ch];
        const box: [number, number, number, number] = [X(x0), Y(y0 + ch), X(x0 + cw), Y(y0)];
        // The diagonal is the answer one looks for: outlined as well as colored.
        pushRect(cells, { x0: X(x0 + gap / 2), y0: Y(y0 + ch - gap / 2), x1: X(x0 + cw - gap / 2), y1: Y(y0 + gap / 2), fill, radii, ...(a === p ? { stroke: accent, strokeWidth: 1.5 } : {}) });
        keys.push(`${names[a]}→${names[p]}`);
        if (!style.labels) continue;
        const count = ctx.format(v, vf);
        const big = compact || ch < 30 ? 11 : 13;
        labels.push({ tx: X(x0 + cw / 2), ty: Y(y0 + ch / 2), dy: two ? -7 : 0, text: count, on: fill, size: big, weight: a === p ? 700 : 500, align: 'center', baseline: 'middle', box });
        if (two && v > 0) labels.push({ tx: X(x0 + cw / 2), ty: Y(y0 + ch / 2), dy: 9, text: percent(t, t < 0.1 ? 1 : 0), on: fill, size: 10, weight: 500, align: 'center', baseline: 'middle', box });
      }
    }
    if (margins && K) {
      const mx = right + marginGap;
      const my = bottom + marginGap;
      const pill = (x0: number, y0: number, w: number, h: number, fill: RGBA, stroke?: RGBA) =>
        pushRect(extras, { x0: X(x0 + gap / 2), y0: Y(y0 + h - gap / 2), x1: X(x0 + w - gap / 2), y1: Y(y0 + gap / 2), fill, radii, ...(stroke ? { stroke, strokeWidth: 1.5 } : {}) });
      labels.push({ tx: X(mx + marginW / 2), ty: Y(titleH + headH / 2), text: ctx.theme.texts.recall, color: theme.text.muted, size: 11, weight: 600, align: 'center', baseline: 'middle' });
      labels.push({ tx: X(gx - 8), ty: Y(my + marginH / 2), text: ctx.theme.texts.precision, color: theme.text.muted, size: 11, weight: 600, align: 'right', baseline: 'middle' });
      for (let k = 0; k < K; k++) {
        pill(mx, top + k * ch, marginW, ch, quiet);
        labels.push({ tx: X(mx + marginW / 2), ty: Y(top + (k + 0.5) * ch), text: percent(stats.recall[k]), color: ink, size: ch < 16 ? 9 : compact ? 11 : 12, weight: 600, align: 'center', baseline: 'middle' });
        pill(gx + k * cw, my, cw, marginH, quiet);
        labels.push({ tx: X(gx + (k + 0.5) * cw), ty: Y(my + marginH / 2), text: percent(stats.precision[k]), color: ink, size: cw < 38 ? 10 : compact ? 11 : 12, weight: 600, align: 'center', baseline: 'middle' });
      }
      // Accuracy, where the two margins meet.
      const corner = mix(ctx.surface, accent, 0.16);
      pill(mx, my, marginW, marginH, corner, accent);
      const caption = marginH >= 36;
      labels.push({ tx: X(mx + marginW / 2), ty: Y(my + marginH / 2), dy: caption ? -6 : 0, text: percent(stats.accuracy, stats.accuracy < 0.995 ? 1 : 0), on: corner, size: compact ? 11 : 13, weight: 700, align: 'center', baseline: 'middle' });
      if (caption) labels.push({ tx: X(mx + marginW / 2), ty: Y(my + marginH / 2), dy: 9, text: ctx.theme.texts.accuracyCaption, on: corner, size: 9, weight: 500, align: 'center', baseline: 'middle' });
    }

    const draws: BuiltMark['draws'] = [];
    if (cells.length) draws.push(keyed(ctx, cells, keys));
    if (extras.length) draws.push({ batch: batchOf(ctx, 'rect', extras), enter: 'fade' });
    const actualName = fieldLabel(ctx, af, ctx.theme.texts.actual);
    const predictedName = fieldLabel(ctx, pf, ctx.theme.texts.predicted);
    const scores = (k: number) => [
      { label: ctx.theme.texts.precision, value: percent(stats.precision[k], 1) },
      { label: ctx.theme.texts.recall, value: percent(stats.recall[k], 1) },
    ];
    return {
      draws,
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const x = tx / px;
        const y = (1 - ty) / py;
        const p = Math.floor((x - gx) / cw);
        const a = Math.floor((y - top) / ch);
        const inRows = a >= 0 && a < K;
        const inCols = p >= 0 && p < K;
        if (inRows && inCols) {
          return {
            title: a === p ? fillText(ctx.theme.texts.correctOf, { name: names[a] }) : fillText(ctx.theme.texts.classifiedAs, { actual: names[a], predicted: names[p] }),
            rows: [
              { label: fieldLabel(ctx, vf, ctx.theme.texts.count), value: ctx.format(m[a][p], vf) },
              { label: fillText(ctx.theme.texts.shareOfClass, { kind: actualName.toLowerCase(), name: names[a] }), value: share(m[a][p], stats.rows[a]) },
              { label: fillText(ctx.theme.texts.shareOfClass, { kind: predictedName.toLowerCase(), name: names[p] }), value: share(m[a][p], stats.columns[p]) },
            ],
          };
        }
        if (margins && x >= right && y >= bottom && x <= right + marginGap + marginW && y <= bottom + marginGap + marginH) {
          return { title: ctx.theme.texts.accuracy, rows: [{ label: ctx.theme.texts.correct, value: percent(stats.accuracy, 1) }, { label: ctx.theme.texts.cases, value: ctx.format(stats.total, vf) }] };
        }
        if (inRows && x >= ox && x <= right + marginGap + marginW) return { title: names[a], rows: [...scores(a), { label: ctx.theme.texts.actualCases, value: ctx.format(stats.rows[a], vf) }] };
        if (inCols && y >= 0 && y <= bottom + marginGap + marginH) return { title: names[p], rows: [...scores(p), { label: ctx.theme.texts.predictedCases, value: ctx.format(stats.columns[p], vf) }] };
        return null;
      },
    };
  },
};

// ------------------------------------------------------------ calendarMonth

/**
 * `calendarMonth`: one month as a grid of weeks. Each day shows its number and the sum of
 * `value` for the rows dated (`x`) that day, on a background shaded by that value.
 */
export const calendarMonth: MarkDefinition = {
  standalone: true,
  // Laid out in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = need(layer, 'x', 'calendarMonth');
    const vf = layer.encode.value ?? layer.encode.y;
    const when = table.column(xf).values as Float64Array;
    const vals = vf ? (table.column(vf).values as Float64Array) : undefined;
    // The month asked for, or the latest one in the data.
    let year = 0;
    let month = 0;
    const asked = /^(\d{4})-(\d{1,2})$/.exec(String(style.month ?? ''));
    if (asked) [year, month] = [Number(asked[1]), Number(asked[2]) - 1];
    else {
      let latest = -Infinity;
      for (const t of when) if (!Number.isNaN(t)) latest = Math.max(latest, t);
      const d = new Date(Number.isFinite(latest) ? latest : 0);
      [year, month] = [d.getFullYear(), d.getMonth()];
    }
    const g = monthGrid(year, month, ((Math.round(style.weekStart) % 7) + 7) % 7);
    const sum = new Float64Array(g.cells.length).fill(NaN);
    const first = new Int32Array(g.cells.length).fill(-1);
    for (let i = 0; i < table.length; i++) {
      const v = vals ? vals[i] : 1;
      if (Number.isNaN(when[i]) || Number.isNaN(v)) continue;
      const d = new Date(when[i]);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const k = d.getDate() - 1;
      sum[k] = (Number.isNaN(sum[k]) ? 0 : sum[k]) + v;
      if (first[k] < 0) first[k] = i;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of sum) if (!Number.isNaN(v)) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];

    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const X = (v: number) => v * px;
    const Y = (v: number) => 1 - v * py;
    const headH = 20;
    const ch = Math.max(1, Math.min(76, (H - headH) / g.weeks));
    const cw = Math.max(1, Math.min(W / 7, ch * 2.2));
    const ox = (W - 7 * cw) / 2;
    const roomy = cw >= 40 && ch >= 30;
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: cw < 34 ? 'narrow' : 'short' });
    const rects: number[] = [];
    const keys: string[] = [];
    const labels: MarkLabel[] = [];
    const muted = parseColor(theme.text.muted);
    const empty = mix(ctx.surface, muted, 0.08);
    const gap = Math.min(style.gap, Math.max(0, Math.min(cw, ch) - 2));
    const radius = Math.min(style.radius, Math.min(cw, ch) / 3);
    for (let c = 0; c < 7; c++) {
      // 2024-01-07 is a Sunday.
      const text = weekday.format(new Date(2024, 0, 7 + ((Math.round(style.weekStart) % 7) + 7) % 7 + c));
      labels.push({ tx: X(ox + (c + 0.5) * cw), ty: Y(headH / 2), text, color: theme.text.muted, size: 11, weight: 600, align: 'center', baseline: 'middle' });
    }
    g.cells.forEach((d, k) => {
      const v = sum[k];
      const [x0, y0] = [ox + d.column * cw, headH + d.week * ch];
      const fill = Number.isNaN(v) ? empty : ctx.paint(ctx.ramp(0.08 + 0.85 * (hi > lo ? (v - lo) / (hi - lo) : 0.5)), first[k]);
      const box: [number, number, number, number] = [X(x0), Y(y0 + ch), X(x0 + cw), Y(y0)];
      pushRect(rects, { x0: X(x0 + gap / 2), y0: Y(y0 + ch - gap / 2), x1: X(x0 + cw - gap / 2), y1: Y(y0 + gap / 2), fill, radii: [radius, radius, radius, radius] });
      keys.push(String(d.day));
      if (roomy) {
        labels.push({ tx: X(x0), ty: Y(y0), dx: gap / 2 + 6, dy: gap / 2 + 5, text: String(d.day), on: fill, size: 10, weight: 600, align: 'left', baseline: 'top', box });
        if (style.labels && !Number.isNaN(v)) labels.push({ tx: X(x0 + cw), ty: Y(y0 + ch), dx: -gap / 2 - 6, dy: -gap / 2 - 5, text: ctx.format(v, vf), on: fill, size: ch >= 44 ? 13 : 11, weight: 600, align: 'right', baseline: 'bottom', box });
      } else {
        labels.push({ tx: X(x0 + cw / 2), ty: Y(y0 + ch / 2), text: String(d.day), on: fill, size: 10, weight: 600, align: 'center', baseline: 'middle', box });
      }
    });
    const full = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return {
      draws: rects.length ? [keyed(ctx, rects, keys)] : [],
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        const c = Math.floor((tx / px - ox) / cw);
        const w = Math.floor(((1 - ty) / py - headH) / ch);
        const k = g.cells.findIndex((d) => d.column === c && d.week === w);
        if (k < 0) return null;
        return { title: full.format(new Date(year, month, k + 1)), rows: [{ label: fieldLabel(ctx, vf, ctx.theme.texts.number), value: Number.isNaN(sum[k]) ? '–' : ctx.format(sum[k], vf) }] };
      },
    };
  },
};
