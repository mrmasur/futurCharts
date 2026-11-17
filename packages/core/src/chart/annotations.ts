/**
 * Annotations: reference lines, bands and notes drawn over a cartesian chart,
 * in data coordinates. What they are follows from what is given:
 * - `{ y: 100 }`: a line across at y = 100 (a target, a threshold);
 * - `{ x: ['2024-03-01', '2024-04-15'] }`: a band (a campaign, an incident);
 * - `{ x: '2024-06', y: 120, text: 'Lancement' }`: a note pinned to a point.
 * They live in scale space like the data, so they zoom and pan with it.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA, Renderer } from '../render/types';
import type { Scale } from '../scale/scales';
import type { AnnotationSpec, AnnotationValue } from '../spec/types';
import type { Theme } from '../theme/theme';
import { themeColor } from '../theme/theme';
import { parseColor, withAlpha } from '../util/color';
import { dashed, pushRect } from '../marks/primitives';
import { emptyHit, type BuiltMark, type MarkLabel } from '../marks/registry';

export interface AnnotationContext {
  renderer: Renderer;
  theme: Theme;
  /** Screen axes. */
  x: Scale;
  y: Scale;
  /** Category -> index, for a band axis. */
  categories: Map<string, number>;
  bandX: boolean;
  bandY: boolean;
  pixel: [number, number];
}

/** Far enough past the plot that a line still spans it after zooming out. */
const FAR = 20;

/** A data value on one axis, as the scale reads it: a number, a date (epoch ms) or a category index. */
export function annotationRaw(v: AnnotationValue, band: boolean, categories: Map<string, number>): number {
  if (typeof v === 'number') return v;
  if (band) return categories.get(String(v)) ?? NaN;
  const n = Number(v);
  if (v.trim() !== '' && Number.isFinite(n)) return n;
  return Date.parse(v);
}

/** `under`: the bands, drawn before the data; `over`: lines and notes, drawn after. */
export function buildAnnotations(list: AnnotationSpec[], ctx: AnnotationContext, part: 'under' | 'over'): BuiltMark {
  const { theme, pixel } = ctx;
  const lines: number[] = [];
  const rects: number[] = [];
  const dots: number[] = [];
  const labels: MarkLabel[] = [];
  const nx = (v: AnnotationValue) => ctx.x.norm(annotationRaw(v, ctx.bandX, ctx.categories));
  const ny = (v: AnnotationValue) => ctx.y.norm(annotationRaw(v, ctx.bandY, ctx.categories));
  const color = (c: string | undefined, fallback: string): RGBA => parseColor(themeColor(theme, c ?? fallback));
  const ink = (c: string | undefined) => (c ? themeColor(theme, c) : theme.text.secondary);
  const surface = theme.background;

  for (const a of list) {
    const xs = a.x === undefined ? undefined : Array.isArray(a.x) ? a.x.map(nx) : nx(a.x);
    const ys = a.y === undefined ? undefined : Array.isArray(a.y) ? a.y.map(ny) : ny(a.y);
    const isPair = (v: unknown): v is number[] => Array.isArray(v);
    const band = isPair(xs) || isPair(ys);
    if (band !== (part === 'under')) continue;
    if (band) {
      // A band (or a box when both are ranges).
      const [x0, x1] = isPair(xs) ? xs : [-FAR, FAR];
      const [y0, y1] = isPair(ys) ? ys : [-FAR, FAR];
      if (![x0, x1, y0, y1].every(Number.isFinite)) continue;
      const fill = withAlpha(color(a.color, '$1'), a.opacity ?? 0.1);
      pushRect(rects, { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), fill });
      if (a.text) {
        // Top-left corner of the band, inside the plot.
        const tx = isPair(xs) ? Math.min(x0, x1) : 0;
        const ty = isPair(ys) ? Math.max(y0, y1) : 1;
        labels.push({ tx, ty, text: a.text, color: ink(a.color), size: 11, weight: 600, align: 'left', baseline: 'top', dx: 6, dy: 6 });
      }
      continue;
    }
    if (typeof xs === 'number' && typeof ys === 'number') {
      // A note pinned to a point.
      if (!Number.isFinite(xs + ys)) continue;
      const c = color(a.color, '$ink');
      const s = parseColor(surface);
      dots.push(xs, ys, 9, 0, c[0], c[1], c[2], c[3], s[0], s[1], s[2], 1, 2);
      if (a.text) {
        // Above the point, leaning inwards near the right edge.
        const right = xs > 0.8;
        labels.push({
          tx: xs, ty: ys, text: a.text, color: theme.text.primary, size: 11, weight: 600,
          align: right ? 'right' : 'left', baseline: 'bottom', dx: right ? 8 : -8, dy: -12, background: surface,
        });
      }
      continue;
    }
    // A reference line.
    const c = color(a.color, '$muted');
    const pen = dashed(lines, a.dash ?? [5, 4], pixel, c, a.width ?? 1.5);
    if (typeof ys === 'number' && Number.isFinite(ys)) {
      pen.segment(-FAR, ys, FAR, ys);
      if (a.text) labels.push({ tx: 1, ty: ys, text: a.text, color: ink(a.color), size: 11, weight: 600, align: 'right', baseline: 'bottom', dy: -4, background: surface });
    } else if (typeof xs === 'number' && Number.isFinite(xs)) {
      pen.segment(xs, -FAR, xs, FAR);
      if (a.text) labels.push({ tx: xs, ty: 1, text: a.text, color: ink(a.color), size: 11, weight: 600, align: 'left', baseline: 'top', dx: 6, dy: 4, background: surface });
    }
  }

  const draws = [];
  const r = ctx.renderer;
  if (rects.length) {
    const b = r.createBatch('rect');
    b.update(new Float32Array(rects), rects.length / LAYOUTS.rect.stride);
    draws.push({ batch: b });
  }
  if (lines.length) {
    const b = r.createBatch('line');
    b.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
    draws.push({ batch: b });
  }
  if (dots.length) {
    const b = r.createBatch('point');
    b.update(new Float32Array(dots), dots.length / LAYOUTS.point.stride);
    draws.push({ batch: b });
  }
  return { draws, hit: emptyHit(), labels };
}
