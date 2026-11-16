import { LAYOUTS, SHAPES, type PointShape } from '../render/layouts';
import type { RGBA } from '../render/types';
import { parseColor, withAlpha } from '../util/color';
import { curvePoints, type Polyline } from './curve';
import type { SeriesData } from './prepare';
import { buildHit, hasMark, registerMark, type BuildContext, type MarkDefinition } from './registry';

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

/** Append one polyline as round-capped segments. Returns the new write offset. */
function pushSegments(out: number[], line: Polyline, color: RGBA, width: number): void {
  for (let i = 0; i < line.x.length - 1; i++) {
    const x0 = line.x[i];
    const y0 = line.y[i];
    const x1 = line.x[i + 1];
    const y1 = line.y[i + 1];
    if (!Number.isFinite(x0 + y0 + x1 + y1)) continue;
    out.push(x0, y0, x1, y1, color[0], color[1], color[2], color[3], width);
  }
}

const line: MarkDefinition = {
  symbol: 'line',
  build(ctx) {
    const { style } = ctx;
    const data: number[] = [];
    for (const s of ctx.data.series) {
      if (s.hidden || s.x.length === 0) continue;
      const p = normalized(ctx, s, s.y1);
      const color = withAlpha(ctx.color(s, 0), style.opacity ?? 1);
      if (s.x.length === 1) {
        // A single datum still has to be visible: draw a dot-sized segment.
        data.push(p.x[0], p.y[0], p.x[0], p.y[0], ...color, Math.max(style.width, 4));
        continue;
      }
      pushSegments(data, curvePoints(p.x, p.y, style.curve), color, style.width);
    }
    const batch = ctx.renderer.createBatch('line');
    batch.update(new Float32Array(data), data.length / LAYOUTS.line.stride);
    return { draws: [{ batch }], hit: buildHit(ctx) };
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
      const top = normalized(ctx, s, s.y1);
      const bottom = normalized(ctx, s, s.y0);
      const t = curvePoints(top.x, top.y, style.curve);
      const b = curvePoints(bottom.x, bottom.y, style.curve);
      const base = ctx.color(s, 0);
      const ct = withAlpha(base, opacity);
      const cb = withAlpha(base, style.gradient ? opacity * 0.04 : opacity);
      for (let i = 0; i < t.x.length - 1; i++) {
        const v = (x: number, y: number, c: RGBA) => mesh.push(x, y, c[0], c[1], c[2], c[3]);
        v(t.x[i], t.y[i], ct);
        v(t.x[i + 1], t.y[i + 1], ct);
        v(b.x[i + 1], b.y[i + 1], cb);
        v(t.x[i], t.y[i], ct);
        v(b.x[i + 1], b.y[i + 1], cb);
        v(b.x[i], b.y[i], cb);
      }
      if (style.line) pushSegments(lines, t, base, style.lineWidth);
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
  build(ctx) {
    const { style, data } = ctx;
    const visible = data.series.filter((s) => !s.hidden);
    const groups = data.stacked ? 1 : Math.max(1, visible.length);
    // Band scales give the slot width; continuous scales use the smallest x step.
    const slot = ctx.x.band > 0 ? ctx.x.band : ctx.xStep * (1 - style.bandPadding);
    const sub = slot / groups;
    const stroke = parseColor(style.stroke);
    const out: number[] = [];
    const center = new Map<SeriesData, number>();
    visible.forEach((s, vi) => {
      const offset = data.stacked ? 0 : -slot / 2 + sub * (vi + 0.5);
      center.set(s, offset);
      const lastInStack = vi === visible.length - 1;
      for (let i = 0; i < s.x.length; i++) {
        const cx = ctx.x.norm(s.x[i]) + offset;
        const up = s.y1[i] >= s.y0[i];
        const c = withAlpha(ctx.color(s, i), style.opacity ?? 1);
        // Round only the data end; in a stack, only the outermost segment.
        // The width cap is dropped for grouped bars: it would pull them apart inside the band.
        const r = !data.stacked || lastInStack ? style.radius : 0;
        const gapY = data.stacked && !lastInStack ? (up ? style.gap : -style.gap) : 0;
        out.push(
          cx - sub / 2, ctx.y.norm(s.y0[i]), cx + sub / 2, ctx.y.norm(s.y1[i]),
          c[0], c[1], c[2], c[3],
          stroke[0], stroke[1], stroke[2], stroke[3],
          up ? r : 0, up ? r : 0, up ? 0 : r, up ? 0 : r,
          style.strokeWidth, groups > 1 || ctx.x.band === 0 ? style.gap : 0, gapY, groups > 1 ? 0 : style.maxWidth,
        );
      }
    });
    const batch = ctx.renderer.createBatch('rect');
    batch.update(new Float32Array(out), out.length / LAYOUTS.rect.stride);
    const hit = buildHit(ctx, (s, _si, i) => ctx.x.norm(s.x[i]) + (center.get(s) ?? 0));
    return { draws: [{ batch, pixelSnap: true }], hit };
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
    for (const s of ctx.data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const c = ctx.color(s, i);
        out[k++] = ctx.x.norm(s.x[i]);
        out[k++] = ctx.y.norm(s.y1[i]);
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
    return { draws: [{ batch }], hit: buildHit(ctx) };
  },
};

const builtins: Record<string, MarkDefinition> = { line, area, bar, point };

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
