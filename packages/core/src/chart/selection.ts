/**
 * Selection with the lasso or the rectangle (`interactions.select`): which datums fall
 * inside the drawn polygon, the batches that redraw them over the dimmed marks, the
 * payload of the `select` event, and the lasso drawn on the overlay.
 */
import type { MarkDraw } from '../marks/registry';
import { LAYOUTS } from '../render/layouts';
import type { Renderer, ViewTransform } from '../render/types';
import type { Theme } from '../theme/theme';
import type { Built, HoverItem, Picked, Point, SelectionPayload } from './types';

/** A lasso or rectangle being drawn, in px. */
export interface Lasso {
  points: Point[];
  additive: boolean;
  rect: boolean;
}

/**
 * The polygon a finished lasso or rectangle selects in, or null when the pointer did not
 * really move (fewer than 3 points, or within 6 px of the start): a plain click.
 */
export function lassoPolygon(l: Lasso): Point[] | null {
  const [a, b] = l.points;
  const polygon = l.rect ? [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] : l.points;
  let w = 0;
  let h = 0;
  for (const q of polygon) {
    w = Math.max(w, Math.abs(q.x - a.x));
    h = Math.max(h, Math.abs(q.y - a.y));
  }
  return polygon.length >= 3 && w + h > 6 ? polygon : null;
}

/** Whether a point is inside a polygon (even-odd rule), the polygon given as coordinate arrays. */
export function insidePolygon(x: number, y: number, px: ArrayLike<number>, py: ArrayLike<number>): boolean {
  const n = px.length;
  let inside = false;
  for (let a = 0, c = n - 1; a < n; c = a++) {
    if (py[a] > y !== py[c] > y && x < ((px[c] - px[a]) * (y - py[a])) / (py[c] - py[a]) + px[a]) inside = !inside;
  }
  return inside;
}

/**
 * For each layer, the mask of the selectable datums whose position falls inside a polygon
 * given in pixels (added to its current selection when `additive`); undefined for a layer
 * that has nothing selectable (its selection is left as it is).
 */
export function selectionMasks(polygon: Point[], built: Built[], T: ViewTransform, additive: boolean): (Uint8Array | undefined)[] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of polygon) {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  const px = Float64Array.from(polygon, (q) => q.x);
  const py = Float64Array.from(polygon, (q) => q.y);
  return built.map((b) => {
    const h = b.mark.hit;
    if (h.n === 0 || !b.mark.draws.some((d) => d.perDatum)) return undefined;
    const mask = additive && b.sel ? b.sel.mask : new Uint8Array(h.n);
    for (let i = 0; i < h.n; i++) {
      const x = T.ox + h.tx[i] * T.sx;
      const y = T.oy + h.ty[i] * T.sy;
      // Bounding box first: it rejects most points before the exact test.
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (insidePolygon(x, y, px, py)) mask[i] = 1;
    }
    return mask;
  });
}

/** Replace a layer's selection: its selected instances copied into their own batches, drawn over the dimmed original. */
export function setLayerSelection(b: Built, mask: Uint8Array | null, renderer: Renderer): void {
  for (const d of b.sel?.draws ?? []) d.batch.destroy();
  b.sel = undefined;
  if (!mask) return;
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  if (count === 0) return;
  // Copy the selected instances into their own batch, drawn over the dimmed original.
  const draws: MarkDraw[] = [];
  for (const d of b.mark.draws) {
    if (!d.perDatum || !d.data) continue;
    const stride = LAYOUTS[d.batch.kind].stride;
    const out = new Float32Array(count * stride);
    let k = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) out.set(d.data.subarray(i * stride, (i + 1) * stride), k++ * stride);
    }
    const batch = renderer.createBatch(d.batch.kind);
    batch.update(out, count);
    draws.push({ batch, pixelSnap: d.pixelSnap });
  }
  b.sel = { mask, count, draws };
}

/** The current selection, as rows of each layer's table. */
export function selectionPayload(built: Built[], describe: (picked: Picked[]) => HoverItem[]): SelectionPayload {
  const layers: SelectionPayload['layers'] = [];
  const picked: Picked[] = [];
  let count = 0;
  built.forEach((b, layer) => {
    if (!b.sel) return;
    const rows = new Int32Array(b.sel.count);
    let k = 0;
    for (let i = 0; i < b.sel.mask.length; i++) {
      if (!b.sel.mask[i]) continue;
      rows[k++] = b.mark.hit.row[i];
      picked.push({ layer, index: i });
    }
    count += b.sel.count;
    layers.push({ layer, rows });
  });
  return { count, layers, items: (limit = 1000) => describe(picked.slice(0, limit)) };
}

export function drawLasso(ctx: CanvasRenderingContext2D, theme: Theme, l: Lasso | undefined): void {
  if (!l || l.points.length < 2) return;
  const [a, b] = l.points;
  ctx.save();
  ctx.beginPath();
  if (l.rect) ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  else {
    ctx.moveTo(a.x, a.y);
    for (let i = 1; i < l.points.length; i++) ctx.lineTo(l.points[i].x, l.points[i].y);
    ctx.closePath();
  }
  ctx.fillStyle = theme.selection.fill;
  ctx.fill();
  ctx.lineWidth = theme.selection.width;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = theme.selection.stroke;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.restore();
}
