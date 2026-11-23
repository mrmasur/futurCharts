/** `bumpArea`: a ranking through time drawn as ribbons, as thick as the values. */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import { withAlpha } from '../util/color';
import { categoriesOf, need } from './charts';
import { pushVertex } from './primitives';
import { emptyHit, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';

export interface BumpLayout {
  /** Bottom and top of each ribbon, `[step][entity]`, in 0–1 (y up); NaN where the entity has no value. */
  y0: number[][];
  y1: number[][];
  /** Rank at each step, from 1 (the largest). */
  rank: number[][];
}

/**
 * Stack the entities of each step from the largest (top) down, with `gap` (a
 * share of the height) between them, on one value scale for every step: the
 * tallest step fills the height, the others are centered.
 */
export function bumpLayout(values: number[][], gap: number): BumpLayout {
  const present = (v: number) => Number.isFinite(v) && v > 0;
  const totals = values.map((step) => step.reduce((a, v) => a + (present(v) ? v : 0), 0));
  const counts = values.map((step) => step.filter(present).length);
  // The unit that lets the fullest step fit, gaps included.
  let unit = Infinity;
  values.forEach((_, s) => {
    if (totals[s] > 0) unit = Math.min(unit, Math.max(0, 1 - gap * (counts[s] - 1)) / totals[s]);
  });
  if (!Number.isFinite(unit)) unit = 0;
  const y0: number[][] = [];
  const y1: number[][] = [];
  const rank: number[][] = [];
  values.forEach((step, s) => {
    const order = step.map((v, e) => e).filter((e) => present(step[e])).sort((a, b) => step[b] - step[a] || a - b);
    const height = totals[s] * unit + gap * Math.max(0, order.length - 1);
    let top = 0.5 + height / 2;
    const lo = step.map(() => NaN);
    const hi = step.map(() => NaN);
    const rk = step.map(() => NaN);
    order.forEach((e, i) => {
      hi[e] = top;
      lo[e] = top - step[e] * unit;
      rk[e] = i + 1;
      top = lo[e] - gap;
    });
    y0.push(lo);
    y1.push(hi);
    rank.push(rk);
  });
  return { y0, y1, rank };
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const SAMPLES = 16;

/**
 * `bumpArea`: one ribbon per `key`, as thick as its `y` at each `x`, the ribbons of
 * a step sorted from the largest down: ranks and volumes in one picture.
 */
export const bumpArea: MarkDefinition = {
  standalone: true,
  // Label margins and gaps are in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const xf = need(layer, 'x', 'bumpArea');
    const kf = layer.encode.key ?? need(layer, 'color', 'bumpArea');
    const vf = layer.encode.y ?? need(layer, 'value', 'bumpArea');
    const xcol = table.column(xf);
    const steps = categoriesOf(table, xf);
    const names = categoriesOf(table, kf);
    const stepIndex = new Map(steps.map((s, i) => [s, i]));
    const nameIndex = new Map(names.map((s, i) => [s, i]));
    const S = steps.length;
    const values = steps.map(() => names.map(() => NaN));
    const firstRow = names.map(() => -1);
    const vals = table.column(vf).values as Float64Array;
    const keys = table.column(kf).values;
    for (let i = 0; i < table.length; i++) {
      if (Number.isNaN(vals[i])) continue;
      const s = stepIndex.get(String(xcol.values[i]))!;
      const e = nameIndex.get(String(keys[i]))!;
      values[s][e] = (Number.isNaN(values[s][e]) ? 0 : values[s][e]) + vals[i];
      if (firstRow[e] < 0) firstRow[e] = i;
    }
    const stepLabel = (() => {
      if (xcol.type !== 'time') return (s: string) => s;
      const ds = steps.map((s) => new Date(Number(s)));
      const years = new Set(ds.map((d) => d.getUTCFullYear())).size === S;
      const f = new Intl.DateTimeFormat(undefined, years ? { year: 'numeric', timeZone: 'UTC' } : { month: 'short', year: '2-digit', timeZone: 'UTC' });
      return (s: string) => f.format(Number(s));
    })();

    // Layout in px: names on the right, step labels along the bottom.
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const family = theme.font.family;
    const nameW = style.labels ? Math.min(W * 0.3, Math.max(0, ...names.map((n) => textWidth(n, `600 11px ${family}`))) + 12) : 0;
    const axisH = 20;
    const span = Math.max(1, W - nameW - 4);
    // Each step keeps a flat stretch (where its value reads), the ribbons cross in between;
    // the first and the last stretch touch the edges.
    const share = Math.max(0.05, Math.min(0.9, style.flat));
    const stepW = span / Math.max(1, S - 1 + share);
    const flat = (stepW * share) / 2;
    const cx = (s: number) => (2 + flat + stepW * s) * px;
    const fx = flat * px;
    const yTop = 4;
    const yBottom = H - axisH - 4;
    const Y = (v: number) => (1 - (yBottom - v * (yBottom - yTop)) * py);
    const L = bumpLayout(values, Math.min(0.08, (style.gap / Math.max(1, yBottom - yTop))));
    const colors: RGBA[] = names.map((n, e) => ctx.paint(withAlpha(ctx.categorical(n), style.opacity), firstRow[e]));
    const mesh: number[] = [];
    const labels: MarkLabel[] = [];
    // Values are written on the flat stretches: on all of them or on none (a few survivors would mislead).
    const widestValue = Math.max(0, ...values.flat().filter((v) => !Number.isNaN(v)).map((v) => textWidth(ctx.format(v, vf), `600 10px ${family}`)));
    const valuesFit = widestValue + 8 <= 2 * flat + 12;
    const quad = (xa: number, a0: number, a1: number, xb: number, b0: number, b1: number, c: RGBA) => {
      pushVertex(mesh, xa, Y(a0), c);
      pushVertex(mesh, xa, Y(a1), c);
      pushVertex(mesh, xb, Y(b1), c);
      pushVertex(mesh, xa, Y(a0), c);
      pushVertex(mesh, xb, Y(b1), c);
      pushVertex(mesh, xb, Y(b0), c);
    };
    names.forEach((name, e) => {
      if (ctx.hidden.has(name)) return;
      const c = colors[e];
      for (let s = 0; s < S; s++) {
        const lo = L.y0[s][e];
        const hi = L.y1[s][e];
        if (Number.isNaN(lo)) continue;
        quad(cx(s) - fx, lo, hi, cx(s) + fx, lo, hi, c);
        if (valuesFit) labels.push({
          tx: cx(s), ty: Y((lo + hi) / 2), text: ctx.format(values[s][e], vf), on: c, size: 10, weight: 600, align: 'center', baseline: 'middle',
          box: [cx(s) - fx - 6 * px, Y(lo), cx(s) + fx + 6 * px, Y(hi)],
        });
        const nlo = L.y0[s + 1]?.[e];
        if (nlo === undefined || Number.isNaN(nlo)) continue;
        const nhi = L.y1[s + 1][e];
        const xa = cx(s) + fx;
        const xb = cx(s + 1) - fx;
        for (let k = 0; k < SAMPLES; k++) {
          const t0 = smooth(k / SAMPLES);
          const t1 = smooth((k + 1) / SAMPLES);
          quad(xa + ((xb - xa) * k) / SAMPLES, lo + (nlo - lo) * t0, hi + (nhi - hi) * t0, xa + ((xb - xa) * (k + 1)) / SAMPLES, lo + (nlo - lo) * t1, hi + (nhi - hi) * t1, c);
        }
      }
      const lo = L.y0[S - 1]?.[e];
      if (style.labels && lo !== undefined && !Number.isNaN(lo)) {
        labels.push({ tx: cx(S - 1) + fx, ty: Y((lo + L.y1[S - 1][e]) / 2), text: name, color: theme.text.primary, size: 11, weight: 600, align: 'left', baseline: 'middle', dx: 7 });
      }
    });
    // Step labels: every one when they fit, otherwise one in n (the last one always).
    const widest = Math.max(0, ...steps.map((s) => textWidth(stepLabel(s), `11px ${family}`))) + 10;
    const every = Math.max(1, Math.ceil(widest / stepW));
    steps.forEach((s, i) => {
      if ((S - 1 - i) % every !== 0) return;
      labels.push({ tx: cx(i), ty: 1 - (H - axisH / 2) * py, text: stepLabel(s), color: theme.text.muted, size: 11, align: 'center', baseline: 'middle' });
    });
    const batch = ctx.renderer.createBatch('mesh');
    batch.update(new Float32Array(mesh), mesh.length / LAYOUTS.mesh.stride);
    return {
      draws: [{ batch }],
      hit: emptyHit(),
      labels,
      pick(tx, ty): ShapeHit | null {
        // The step whose flat stretch or outgoing crossing holds the pointer.
        let s = Math.max(0, Math.min(S - 1, Math.floor((tx / px - 2 + flat) / stepW)));
        if (tx < cx(s) - fx && s > 0) s--;
        const u = tx <= cx(s) + fx || s === S - 1 ? 0 : smooth(Math.min(1, (tx - cx(s) - fx) / Math.max(1e-9, cx(s + 1) - fx - cx(s) - fx)));
        const near = u > 0.5 ? s + 1 : s;
        for (let e = 0; e < names.length; e++) {
          if (ctx.hidden.has(names[e])) continue;
          const lo = L.y0[s][e];
          const nlo = u > 0 ? L.y0[s + 1][e] : lo;
          if (Number.isNaN(lo) || Number.isNaN(nlo)) continue;
          const hi = L.y1[s][e];
          const nhi = u > 0 ? L.y1[s + 1][e] : hi;
          const a = Y(lo + (nlo - lo) * u);
          const b = Y(hi + (nhi - hi) * u);
          if (ty < Math.min(a, b) || ty > Math.max(a, b)) continue;
          return {
            title: `${names[e]} · ${stepLabel(steps[near])}`,
            rows: [
              { label: ctx.fields[vf]?.label ?? vf, value: ctx.format(values[near][e], vf) },
              { label: 'Rang', value: `${L.rank[near][e]} / ${L.rank[near].filter((r) => !Number.isNaN(r)).length}` },
            ],
          };
        }
        return null;
      },
    };
  },
};
