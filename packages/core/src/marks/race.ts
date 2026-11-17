/**
 * `race`: a bar chart race. One frame per value of `encode.time`; between two
 * frames, values grow continuously, bars slide to their new rank, the value
 * axis rescales and the date counts on. The mark owns its clock; the chart
 * draws a play button and a scrubber from its `timeline`.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale, niceStep } from '../scale/scales';
import { parseColor, withAlpha } from '../util/color';
import { need } from './charts';
import { pushRect, pushSegment } from './primitives';
import { emptyHit, type MarkDefinition, type MarkLabel, type ShapeHit, type Timeline } from './registry';

let measurer: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, font: string): number {
  if (measurer === undefined) measurer = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 7;
  measurer.font = font;
  return measurer.measureText(text).width;
}

/** Smooth start and stop, for bars changing places. */
const smooth = (t: number) => t * t * (3 - 2 * t);

export const race: MarkDefinition = {
  standalone: true,
  // Margins for names and values are measured in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(layer, 'key', 'race');
    const vf = layer.encode.value ?? need(layer, 'x', 'race');
    const tf = layer.encode.time ?? need(layer, 'y', 'race');
    const gf = layer.encode.color;
    const keys = table.column(kf).values;
    const vals = table.column(vf).values as Float64Array;
    const tcol = table.column(tf);

    // Frames: time values in order (numbers and dates sorted, text in data order).
    const frameKeys: (number | string)[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < table.length; i++) {
      const v = tcol.values[i] as number | string;
      if (!seen.has(String(v))) {
        seen.add(String(v));
        frameKeys.push(v);
      }
    }
    if (tcol.type !== 'string') (frameKeys as number[]).sort((a, b) => a - b);
    const fmtDate = (() => {
      if (tcol.type !== 'time') return (v: number | string) => String(v);
      const ds = (frameKeys as number[]).map((v) => new Date(v));
      const yearly = ds.every((d) => d.getMonth() === 0 && d.getDate() === 1);
      const monthly = ds.every((d) => d.getDate() === 1);
      const f = new Intl.DateTimeFormat(undefined, yearly ? { year: 'numeric' } : monthly ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
      return (v: number | string) => f.format(v as number);
    })();
    const frames = frameKeys.map(fmtDate);
    const frameIndex = new Map(frameKeys.map((k, i) => [String(k), i]));

    // Entities, their values per frame (a missing value repeats the last known one).
    const entities: string[] = [];
    const entityIndex = new Map<string, number>();
    const firstRow: number[] = [];
    const group: string[] = [];
    for (let i = 0; i < table.length; i++) {
      const k = String(keys[i]);
      if (!entityIndex.has(k)) {
        entityIndex.set(k, entities.length);
        entities.push(k);
        firstRow.push(i);
        group.push(gf ? String(table.column(gf).values[i]) : k);
      }
    }
    const F = frames.length;
    const E = entities.length;
    const value = new Float64Array(F * E).fill(NaN);
    for (let i = 0; i < table.length; i++) {
      const f = frameIndex.get(String(tcol.values[i]))!;
      value[f * E + entityIndex.get(String(keys[i]))!] = vals[i];
    }
    for (let e = 0; e < E; e++) {
      let last = 0;
      for (let f = 0; f < F; f++) {
        const v = value[f * E + e];
        if (Number.isNaN(v)) value[f * E + e] = last;
        else last = v;
      }
    }
    // Rank of every entity at every frame; those past the top wait just below it.
    const top = Math.max(1, Math.min(style.top, E));
    const rank = new Float64Array(F * E);
    for (let f = 0; f < F; f++) {
      const order = entities.map((_, e) => e).sort((a, b) => value[f * E + b] - value[f * E + a]);
      order.forEach((e, r) => (rank[f * E + e] = Math.min(r, top)));
    }

    const groups = [...new Set(group)];
    const legend = gf ? groups.map((g) => ({ key: g, color: ctx.categorical(g) })) : [];
    const colorOf = entities.map((e, i) => ctx.paint(gf ? legend.find((l) => l.key === group[i])!.color : ctx.categorical(e), firstRow[i]));

    // Room for names on the left, values on the right, ticks on top (in px, then scale space).
    const [px, py] = ctx.pixel;
    const nameW = Math.max(...entities.map((e) => textWidth(e, `600 12px ${theme.font.family}`))) + 14;
    const left = Math.min(0.35, nameW * px);
    const right = 1 - 76 * px;
    const topM = 1 - 22 * py;
    // A band under the bars for the date, so it never sits on a bar.
    // The date shrinks with the chart, so a small preview stays readable.
    const dateSize = Math.round(Math.max(14, Math.min(32, 0.1 / py)));
    const bottomM = (dateSize + 14) * py;
    const slot = (topM - bottomM) / top;
    const thick = Math.max(slot * 0.74, 2 * py);
    const grid = parseColor(theme.grid.y.color);
    // Values in between two frames are interpolated: show them as precisely as the data, not more.
    const integers = Array.from(vals).every((v) => Number.isNaN(v) || Number.isInteger(v));
    const fmtValue = (v: number) => ctx.format(integers ? Math.round(v) : v, vf);

    let t = Math.min(F - 1, Math.max(0, (ctx.state.t as number | undefined) ?? (style.autoplay ? 0 : F - 1)));
    let playing = (ctx.state.playing as boolean | undefined) ?? (style.autoplay && F > 1);
    let last = 0;

    const rects = ctx.renderer.createBatch('rect');
    const lines = ctx.renderer.createBatch('line');
    const labels: MarkLabel[] = [];
    let shown: { e: number; v: number; r: number; y0: number; y1: number; x1: number }[] = [];

    const render = () => {
      const k = Math.min(F - 2, Math.floor(t));
      const f = F > 1 ? t - Math.max(0, k) : 0;
      const k0 = Math.max(0, k);
      const k1 = Math.min(F - 1, k0 + 1);
      const s = smooth(f);
      shown = [];
      let max = 0;
      for (let e = 0; e < E; e++) {
        const v = value[k0 * E + e] + (value[k1 * E + e] - value[k0 * E + e]) * f;
        const r = rank[k0 * E + e] + (rank[k1 * E + e] - rank[k0 * E + e]) * s;
        if (r >= top) continue;
        shown.push({ e, v, r, y0: 0, y1: 0, x1: 0 });
        max = Math.max(max, v);
      }
      // The axis follows the leader, a little ahead of it.
      const axisMax = (max || 1) * 1.04;
      const x = (v: number) => left + ((right - left) * Math.max(0, v)) / axisMax;
      const rectData: number[] = [];
      const lineData: number[] = [];
      labels.length = 0;
      const step = niceStep(axisMax, 4);
      for (let v = 0; v <= axisMax; v += step) {
        pushSegment(lineData, x(v), bottomM, x(v), topM + 6 * py, grid, 1);
        labels.push({ tx: x(v), ty: topM, text: fmtValue(v), color: theme.text.muted, size: 10, align: 'center', baseline: 'bottom', dy: -8 });
      }
      for (const b of shown) {
        const yc = topM - slot * (b.r + 0.5);
        // Bars fade out as they drop below the top, and in as they climb into it.
        const a = Math.max(0, Math.min(1, top - b.r));
        const c = colorOf[b.e];
        const fill: RGBA = withAlpha(c, c[3] * a);
        b.y0 = yc - thick / 2;
        b.y1 = yc + thick / 2;
        b.x1 = x(b.v);
        pushRect(rectData, { x0: left, y0: b.y0, x1: b.x1, y1: b.y1, fill, radii: [0, 4, 4, 0], axis: 1 });
        const ink = withAlpha(parseColor(theme.text.primary), a);
        const css = `rgba(${Math.round(ink[0] * 255)},${Math.round(ink[1] * 255)},${Math.round(ink[2] * 255)},${ink[3]})`;
        labels.push({ tx: left, ty: yc, text: entities[b.e], color: css, size: 12, weight: 600, align: 'right', baseline: 'middle', dx: -8 });
        labels.push({ tx: b.x1, ty: yc, text: fmtValue(b.v), color: css, size: 11, align: 'left', baseline: 'middle', dx: 6 });
      }
      // The date, large, in the bottom-right corner.
      const label = frames[Math.min(F - 1, Math.round(t))];
      labels.push({ tx: right, ty: 0, text: label, color: theme.text.muted, size: dateSize, weight: 700, align: 'right', baseline: 'bottom', dy: -4 });
      rects.update(new Float32Array(rectData), rectData.length / LAYOUTS.rect.stride);
      lines.update(new Float32Array(lineData), lineData.length / LAYOUTS.line.stride);
    };
    render();

    const end = F - 1;
    const timeline: Timeline = {
      frames,
      get: () => t,
      set(v) {
        t = Math.min(end, Math.max(0, v));
        ctx.state.t = t;
        render();
      },
      play() {
        if (t >= end) t = 0;
        playing = F > 1;
        ctx.state.playing = playing;
        last = 0;
      },
      pause() {
        playing = false;
        ctx.state.playing = false;
      },
      get playing() {
        return playing;
      },
    };
    return {
      draws: [{ batch: lines }, { batch: rects, enter: 'fade' }],
      hit: emptyHit(),
      labels,
      legend,
      timeline,
      animate(now) {
        if (!playing) return false;
        if (!last) last = now;
        t += (now - last) / style.duration;
        last = now;
        if (t >= end) {
          if (style.loop) t = 0;
          else {
            t = end;
            playing = false;
          }
        }
        ctx.state.t = t;
        ctx.state.playing = playing;
        render();
        return true;
      },
      pick(tx, ty): ShapeHit | null {
        const b = shown.find((s) => ty >= s.y0 && ty <= s.y1 && tx >= left && tx <= Math.max(s.x1, left + 0.02));
        if (!b) return null;
        return {
          title: entities[b.e],
          rows: [
            { label: ctx.fields[vf]?.label ?? vf, value: fmtValue(b.v) },
            { label: 'Rang', value: String(Math.round(b.r) + 1) },
            { label: ctx.fields[tf]?.label ?? 'Période', value: frames[Math.min(F - 1, Math.round(t))] },
          ],
        };
      },
    };
  },
};
