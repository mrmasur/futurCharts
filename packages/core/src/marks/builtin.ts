import { LAYOUTS, SHAPES, type PointShape } from '../render/layouts';
import type { RGBA } from '../render/types';
import { parseColor, withAlpha } from '../util/color';
import { STANDALONE_MARKS } from './charts';
import { curvePoints, type Polyline } from './curve';
import { EXTRA_MARKS } from './extra';
import { MORE_MARKS } from './more';
import { race } from './race';
import { SHAPE_MARKS } from './shapes';
import { CATALOG_MARKS } from './catalog';
import { ADVANCED_MARKS } from './advanced';
import { flow } from './flow';
import { FLOW_MARKS } from './flows';
import type { SeriesData } from './prepare';
import { dashed, pushRect, pushSegment, pushVertex } from './primitives';
import { buildHit, hasMark, registerMark, type BuildContext, type BuiltMark, type MarkDefinition, type MarkLabel } from './registry';

function normalized(ctx: BuildContext, s: SeriesData, y: Float64Array): { x: Float32Array; y: Float32Array } {
  const n = s.x.length;
  const x = new Float32Array(n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = ctx.x.norm(s.x[i]);
    out[i] = ctx.y.norm(y[i]);
  }
  return { x, y: out };
}

/** Append a polyline (in category / value space) as round-capped segments, dashed if asked. */
function pushPolyline(ctx: BuildContext, out: number[], line: Polyline, color: RGBA, width: number, dash?: number[]): void {
  const pen = dash?.length ? dashed(out, dash, ctx.pixel, color, width) : undefined;
  for (let i = 0; i < line.x.length - 1; i++) {
    const [ax, ay] = ctx.pos(line.x[i], line.y[i]);
    const [bx, by] = ctx.pos(line.x[i + 1], line.y[i + 1]);
    if (pen) pen.segment(ax, ay, bx, by);
    else pushSegment(out, ax, ay, bx, by, color, width);
  }
}

/** Runs of consecutive points with no missing value between them: `[start, end)`. */
function runs(s: SeriesData): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let j = 1; j <= s.x.length; j++) {
    if (j === s.x.length || s.breaks?.[j]) {
      out.push([start, j]);
      start = j;
    }
  }
  return out;
}

const slice = (p: { x: Float32Array; y: Float32Array }, [a, b]: [number, number]) => ({ x: p.x.subarray(a, b), y: p.y.subarray(a, b) });

/** Width of one category slot in scale space: the band, or the smallest step on a continuous axis. */
export function slotWidth(ctx: BuildContext): number {
  return ctx.x.band > 0 ? ctx.x.band : ctx.xStep * (1 - (ctx.style.bandPadding ?? ctx.theme.marks.bar.bandPadding));
}

const line: MarkDefinition = {
  symbol: 'line',
  // Dashes are measured in px.
  sizeDependent: (layer) => !!layer.style?.dash?.length,
  build(ctx) {
    const { style } = ctx;
    const data: number[] = [];
    const dots: number[] = [];
    const labels: MarkLabel[] = [];
    for (const s of ctx.data.series) {
      if (s.hidden || s.x.length === 0) continue;
      const p = normalized(ctx, s, s.y1);
      // Per-series style (`layer.series`): width, dash, opacity, markers.
      const own = ctx.data.layer.series?.[s.key];
      const width = own?.width ?? style.width;
      const dash = own?.dash ?? style.dash;
      const markers = own?.markers ?? style.markers;
      const color = withAlpha(ctx.color(s, 0), own?.opacity ?? style.opacity ?? 1);
      for (const run of runs(s)) {
        if (run[1] - run[0] === 1) {
          // A lone datum (or one between two gaps) still has to be visible: draw a dot-sized segment.
          const [x, y] = ctx.pos(p.x[run[0]], p.y[run[0]]);
          pushSegment(data, x, y, x, y, color, Math.max(width, 4));
          continue;
        }
        const r = slice(p, run);
        const curve = curvePoints(r.x, r.y, style.curve);
        if (style.colorByValue && !dash?.length) {
          // Each stretch takes the ramp's color at its height (positions are already 0–1 along y).
          for (let k = 0; k < curve.x.length - 1; k++) {
            const [ax, ay] = ctx.pos(curve.x[k], curve.y[k]);
            const [bx, by] = ctx.pos(curve.x[k + 1], curve.y[k + 1]);
            const t = Math.max(0, Math.min(1, (curve.y[k] + curve.y[k + 1]) / 2));
            pushSegment(data, ax, ay, bx, by, withAlpha(ctx.ramp(0.15 + 0.85 * t), style.opacity ?? 1), width);
          }
        } else pushPolyline(ctx, data, curve, color, width, dash);
      }
      for (let i = 0; i < s.x.length; i++) {
        const [x, y] = ctx.pos(p.x[i], p.y[i]);
        // Highlighted or overridden points keep their own color.
        const c = ctx.color(s, i);
        if (markers) {
          dots.push(x, y, Math.max(6, width * 3.5), 0, c[0], c[1], c[2], c[3], ctx.surface[0], ctx.surface[1], ctx.surface[2], 1, 2);
        }
        if (style.labels) {
          labels.push({ tx: x, ty: y, text: ctx.format(s.value[i]), align: 'center', baseline: 'bottom', dy: -8, size: 11, color: ctx.theme.text.secondary, series: s.key });
        }
      }
      if (style.endLabels) {
        const last = s.x.length - 1;
        const [lx, ly] = ctx.pos(p.x[last], p.y[last]);
        labels.push({ tx: lx, ty: ly, text: s.key, align: 'left', baseline: 'middle', dx: 12, color: ctx.theme.text.secondary, avoid: true, series: s.key });
      }
    }
    const batch = ctx.renderer.createBatch('line');
    batch.update(new Float32Array(data), data.length / LAYOUTS.line.stride);
    const draws = [{ batch }];
    if (dots.length) {
      const points = ctx.renderer.createBatch('point');
      points.update(new Float32Array(dots), dots.length / LAYOUTS.point.stride);
      draws.push({ batch: points });
    }
    return { draws, hit: buildHit(ctx), labels };
  },
};

const area: MarkDefinition = {
  baseline: true,
  symbol: 'square',
  build(ctx) {
    const { style } = ctx;
    const opacity = ctx.data.stacked ? style.stackedOpacity : style.opacity;
    const mesh: number[] = [];
    const lines: number[] = [];
    for (const s of ctx.data.series) {
      if (s.hidden || s.x.length < 2) continue;
      const top0 = normalized(ctx, s, s.y1);
      const bottom0 = normalized(ctx, s, s.y0);
      for (const run of runs(s)) {
      if (run[1] - run[0] < 2) continue;
      const top = slice(top0, run);
      const bottom = slice(bottom0, run);
      const t = curvePoints(top.x, top.y, style.curve);
      const b = curvePoints(bottom.x, bottom.y, style.curve);
      const base = ctx.color(s, 0);
      const own = ctx.data.layer.series?.[s.key];
      const ct = withAlpha(base, own?.opacity ?? opacity);
      const cb = withAlpha(base, style.gradient ? (own?.opacity ?? opacity) * 0.04 : (own?.opacity ?? opacity));
      const v = (c: number, val: number, color: RGBA) => {
        const [x, y] = ctx.pos(c, val);
        pushVertex(mesh, x, y, color);
      };
      for (let i = 0; i < t.x.length - 1; i++) {
        v(t.x[i], t.y[i], ct);
        v(t.x[i + 1], t.y[i + 1], ct);
        v(b.x[i + 1], b.y[i + 1], cb);
        v(t.x[i], t.y[i], ct);
        v(b.x[i + 1], b.y[i + 1], cb);
        v(b.x[i], b.y[i], cb);
      }
      if (style.line) pushPolyline(ctx, lines, t, base, own?.width ?? style.lineWidth, own?.dash);
      }
    }
    const fill = ctx.renderer.createBatch('mesh');
    fill.update(new Float32Array(mesh), mesh.length / LAYOUTS.mesh.stride);
    const draws = [{ batch: fill }];
    if (lines.length) {
      const stroke = ctx.renderer.createBatch('line');
      stroke.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
      draws.push({ batch: stroke });
    }
    return { draws, hit: buildHit(ctx) };
  },
};

const bar: MarkDefinition = {
  baseline: true,
  banded: true,
  symbol: 'square',
  // An exact thickness on side-by-side bars is converted from px at the current size.
  sizeDependent: (layer) => !!layer.style?.thickness && !layer.stack,
  build(ctx) {
    const { style, data } = ctx;
    const H = ctx.horizontal;
    const visible = data.series.filter((s) => !s.hidden);
    // Stacks and ranges (Gantt, waterfall) share the full slot; plain series sit side by side.
    const groups = data.stacked || data.ranged ? 1 : Math.max(1, visible.length);
    const slot = slotWidth(ctx);
    let sub = slot / groups;
    // Side by side, an exact thickness keeps the group packed around the category.
    if (style.thickness > 0 && groups > 1) sub = Math.min(sub, (style.thickness + style.gap) * ctx.pixel[H ? 1 : 0]);
    const stroke = parseColor(style.stroke);
    const out: number[] = [];
    const tracks: number[] = [];
    const trackColor = style.track ? parseColor(style.track === 'auto' ? ctx.theme.grid.y.color : style.track) : undefined;
    const labels: MarkLabel[] = [];
    const center = new Map<SeriesData, number>();
    // Identity of each bar (series and category), for transitions between data states.
    const keys: string[] = [];
    // In a stack, the outer end of each side: the last series with a positive value at that
    // category, and the last with a negative one (a population pyramid has one of each).
    const outer = new Map<number, { pos: number; neg: number }>();
    if (data.stacked) {
      visible.forEach((s, vi) => {
        for (let i = 0; i < s.x.length; i++) {
          if (s.value[i] === 0) continue;
          const o = outer.get(s.x[i]) ?? { pos: -1, neg: -1 };
          if (s.value[i] > 0) o.pos = vi;
          else o.neg = vi;
          outer.set(s.x[i], o);
        }
      });
    }
    visible.forEach((s, vi) => {
      const offset = groups === 1 ? 0 : (vi - (groups - 1) / 2) * sub;
      center.set(s, offset);
      for (let i = 0; i < s.x.length; i++) {
        const c = ctx.x.norm(s.x[i]) + offset;
        const v0 = ctx.y.norm(s.y0[i]);
        const v1 = ctx.y.norm(s.y1[i]);
        const up = s.y1[i] >= s.y0[i];
        const fill = withAlpha(ctx.color(s, i), ctx.data.layer.series?.[s.key]?.opacity ?? style.opacity ?? 1);
        // Round the data end only (both ends of a range); in a stack, only the outermost segment.
        const o = outer.get(s.x[i]);
        const outermost = !o || (s.value[i] >= 0 ? o.pos === vi : o.neg === vi);
        const r = data.ranged || !data.stacked || outermost ? style.radius : 0;
        const radii: [number, number, number, number] = data.ranged
          ? [r, r, r, r]
          : H
            ? up ? [0, r, r, 0] : [r, 0, 0, r]
            : up ? [r, r, 0, 0] : [0, 0, r, r];
        const [ax, ay] = ctx.pos(c - sub / 2, v0);
        const [bx, by] = ctx.pos(c + sub / 2, v1);
        keys.push(`${s.key}\u0000${ctx.x.type === 'band' ? ctx.x.format(s.x[i]) : s.x[i]}`);
        if (trackColor && (!data.stacked || vi === 0)) {
          // The whole value axis, behind the bar (one per category in a stack).
          const [tx0, ty0] = ctx.pos(c - sub / 2, 0);
          const [tx1, ty1] = ctx.pos(c + sub / 2, 1);
          pushRect(tracks, { x0: tx0, y0: ty0, x1: tx1, y1: ty1, fill: trackColor, radii: [style.radius, style.radius, style.radius, style.radius], gap: groups > 1 || ctx.x.band === 0 ? style.gap : 0, maxWidth: groups > 1 ? 0 : style.thickness > 0 ? style.thickness : style.maxWidth, axis: H ? 1 : 0 });
        }
        pushRect(out, {
          x0: ax, y0: ay, x1: bx, y1: by,
          fill, stroke, radii,
          strokeWidth: style.strokeWidth,
          // The width cap is dropped for grouped bars: it would pull them apart inside the band.
          gap: groups > 1 || ctx.x.band === 0 ? style.gap : 0,
          stackGap: data.stacked && !outermost ? (up ? style.gap : -style.gap) : 0,
          maxWidth: groups > 1 ? 0 : style.thickness > 0 ? style.thickness : style.maxWidth,
          axis: H ? 1 : 0,
        });
        if (!style.labels) continue;
        // A range (start = y, end = y2) is labelled with its signed length: the step of a waterfall.
        const text =
          data.stacked && data.stackMode === 'normalize'
            ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(s.y1[i] - s.y0[i])
            : ctx.format(data.ranged ? s.y0[i] - s.y1[i] : s.value[i]);
        if (data.stacked) {
          // Inside the segment, only when it fits: an interior segment has no free end.
          const [mx, my] = ctx.pos(c, (v0 + v1) / 2);
          labels.push({ tx: mx, ty: my, text, on: fill, align: 'center', baseline: 'middle', box: [ax, ay, bx, by], series: s.key });
        } else {
          const end = data.ranged ? Math.max(v0, v1) : v1;
          const forward = data.ranged || up;
          const [lx, ly] = ctx.pos(c, end);
          labels.push(
            H
              ? { tx: lx, ty: ly, text, align: forward ? 'left' : 'right', baseline: 'middle', dx: forward ? 6 : -6, series: s.key }
              : { tx: lx, ty: ly, text, align: 'center', baseline: forward ? 'bottom' : 'top', dy: forward ? -5 : 5, series: s.key },
          );
        }
      }
    });
    const batch = ctx.renderer.createBatch('rect');
    const instances = new Float32Array(out);
    batch.update(instances, out.length / LAYOUTS.rect.stride);
    const hit = buildHit(ctx, (s, _si, i) => ctx.x.norm(s.x[i]) + (center.get(s) ?? 0));
    const draws: BuiltMark['draws'] = [{ batch, pixelSnap: true, perDatum: true, data: instances, keys }];
    if (tracks.length) {
      const tb = ctx.renderer.createBatch('rect');
      tb.update(new Float32Array(tracks), tracks.length / LAYOUTS.rect.stride);
      draws.unshift({ batch: tb, pixelSnap: true, enter: 'fade' });
    }
    return { draws, hit, labels };
  },
};

const point: MarkDefinition = {
  symbol: 'circle',
  build(ctx) {
    const { style } = ctx;
    const stroke = style.stroke === 'surface' ? ctx.surface : parseColor(style.stroke);
    const shape = SHAPES[style.shape as PointShape] ?? 0;
    let n = 0;
    for (const s of ctx.data.series) if (!s.hidden) n += s.x.length;
    const out = new Float32Array(n * LAYOUTS.point.stride);
    let k = 0;
    // Jitter: a stable offset per row (the same at every rebuild), across the category slot.
    const spread = style.jitter > 0 ? slotWidth(ctx) * Math.min(1, style.jitter) : 0;
    // Identity of each dot: its series and its `key` field (or its x), for transitions.
    const keyCol = ctx.data.layer.encode.key ? ctx.data.table.column(ctx.data.layer.encode.key).values : undefined;
    const keys: string[] = [];
    const offset = (row: number) => {
      if (!spread) return 0;
      const h = Math.sin(row * 12.9898 + 78.233) * 43758.5453;
      return (h - Math.floor(h) - 0.5) * spread;
    };
    for (const s of ctx.data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const c = ctx.color(s, i);
        keys.push(`${s.key}\u0000${keyCol ? keyCol[s.rows[i]] : ctx.x.type === 'band' ? ctx.x.format(s.x[i]) : s.x[i]}`);
        const [x, y] = ctx.pos(ctx.x.norm(s.x[i]) + offset(s.rows[i]), ctx.y.norm(s.y1[i]));
        out[k++] = x;
        out[k++] = y;
        out[k++] = ctx.size(s, i);
        out[k++] = shape;
        out[k++] = c[0];
        out[k++] = c[1];
        out[k++] = c[2];
        out[k++] = c[3] * (style.opacity ?? 1);
        out[k++] = stroke[0];
        out[k++] = stroke[1];
        out[k++] = stroke[2];
        out[k++] = stroke[3];
        out[k++] = style.strokeWidth;
      }
    }
    const batch = ctx.renderer.createBatch('point');
    batch.update(out, n);
    const draws: BuiltMark['draws'] = [{ batch, perDatum: true, data: out, keys }];
    // Pulse: rings growing out of the dots, fading as they go (two, half a beat apart).
    let animate: BuiltMark['animate'];
    if (style.pulse) {
      const stride = LAYOUTS.point.stride;
      const highlighted = !!ctx.data.layer.highlight;
      const sources: number[] = [];
      for (let i = 0; i < n && sources.length < 400; i++) if (!highlighted || out[i * stride + 7] > 0.9 * (style.opacity ?? 1)) sources.push(i);
      const rings = ctx.renderer.createBatch('point');
      const buf = new Float32Array(sources.length * 2 * stride);
      draws.unshift({ batch: rings, enter: 'fade' });
      animate = (now) => {
        let k = 0;
        for (const i of sources) {
          for (const phase of [0, 0.5]) {
            const p = ((now / 1600 + phase + i * 0.037) % 1 + 1) % 1;
            const o = i * stride;
            buf[k++] = out[o];
            buf[k++] = out[o + 1];
            buf[k++] = out[o + 2] * (1 + 2.2 * p);
            buf[k++] = 0;
            buf[k++] = 0;
            buf[k++] = 0;
            buf[k++] = 0;
            buf[k++] = 0;
            buf[k++] = out[o + 4];
            buf[k++] = out[o + 5];
            buf[k++] = out[o + 6];
            buf[k++] = 0.7 * (1 - p);
            buf[k++] = 2;
          }
        }
        rings.update(buf, sources.length * 2);
        return true;
      };
    }
    return { draws, animate, hit: spread ? buildHit(ctx, (s, _si, i) => ctx.x.norm(s.x[i]) + offset(s.rows[i])) : buildHit(ctx) };
  },
};

/**
 * `rule`: a segment along the value axis at each category, from `y2` to `y`
 * (or from zero without `y2`). Whiskers, error bars, lollipop stems, ranges.
 */
const rule: MarkDefinition = {
  baseline: true,
  symbol: 'line',
  build(ctx) {
    const { style } = ctx;
    const out: number[] = [];
    for (const s of ctx.data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const c = ctx.x.norm(s.x[i]);
        const [ax, ay] = ctx.pos(c, ctx.y.norm(s.y0[i]));
        const [bx, by] = ctx.pos(c, ctx.y.norm(s.y1[i]));
        pushSegment(out, ax, ay, bx, by, withAlpha(ctx.color(s, i), style.opacity ?? 1), style.width);
      }
    }
    const batch = ctx.renderer.createBatch('line');
    batch.update(new Float32Array(out), out.length / LAYOUTS.line.stride);
    return { draws: [{ batch, pixelSnap: true }], hit: buildHit(ctx) };
  },
};

/** `tick`: a short segment across the category slot at each value. Medians, targets, strip plots. */
const tick: MarkDefinition = {
  symbol: 'line',
  // A pixel cap depends on the chart size.
  sizeDependent: true,
  build(ctx) {
    const { style } = ctx;
    let half = (slotWidth(ctx) * style.length) / 2;
    if (style.maxWidth > 0) half = Math.min(half, (style.maxWidth / 2) * ctx.pixel[ctx.horizontal ? 1 : 0]);
    const out: number[] = [];
    for (const s of ctx.data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const c = ctx.x.norm(s.x[i]);
        const v = ctx.y.norm(s.y1[i]);
        const [ax, ay] = ctx.pos(c - half, v);
        const [bx, by] = ctx.pos(c + half, v);
        pushSegment(out, ax, ay, bx, by, withAlpha(ctx.color(s, i), style.opacity ?? 1), style.width);
      }
    }
    const batch = ctx.renderer.createBatch('line');
    batch.update(new Float32Array(out), out.length / LAYOUTS.line.stride);
    return { draws: [{ batch, pixelSnap: true }], hit: buildHit(ctx) };
  },
};

const builtins: Record<string, MarkDefinition> = { line, area, bar, point, rule, tick, ...STANDALONE_MARKS, ...FLOW_MARKS, ...EXTRA_MARKS, ...MORE_MARKS, ...SHAPE_MARKS, ...CATALOG_MARKS, ...ADVANCED_MARKS, flow, race };

/**
 * Register the built-in marks. Called when a chart is created rather than at
 * import time: the package is marked side-effect free, so a bundler is allowed
 * to drop an import that only exists for its side effect.
 * A mark the app registered under the same name is left alone.
 */
export function ensureBuiltinMarks(): void {
  for (const [name, definition] of Object.entries(builtins)) {
    if (!hasMark(name)) registerMark(name, definition);
  }
}
