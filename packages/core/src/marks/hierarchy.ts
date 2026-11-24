/**
 * Hierarchy marks: Voronoi treemap and indented tree. Layouts live in `hierarchyLayout.ts`.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale } from '../scale/scales';
import { mix, parseColor } from '../util/color';
import { share } from './charts';
import {
  buildTree, chordAt, circlePolygon, fitRows, indentedRows, pathKey, pointInPolygon, polygonCentroid, voronoiCells,
  type HNode, type IndentedRow, type Pt,
} from './hierarchyLayout';
import { pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type BuiltMark, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { fillText } from '../theme/texts';

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;

function pathOf(ctx: BuildContext, mark: string): string[] {
  const path = ctx.data.layer.encode.path;
  if (!path?.length) throw new Error(`futurCharts: mark "${mark}" needs encode.path (a list of fields).`);
  return path;
}

/** The leaves under a node (itself when it has no children). */
function leavesOf(n: HNode): HNode[] {
  return n.children.length ? n.children.flatMap(leavesOf) : [n];
}

// ------------------------------------------------------------------ voronoi

/**
 * `voronoi`: Voronoi treemap in a circle. One polygon per leaf of `path`, its area proportional
 * to `value`, leaves of a same first level gathered in one enclosing cell and sharing its color.
 */
export const voronoi: MarkDefinition = {
  standalone: true,
  // Labels are fitted to the cells in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(-1.03, 1.03), y: new LinearScale(-1.03, 1.03), aspect: 1 }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const path = pathOf(ctx, 'voronoi');
    const vf = layer.encode.value ?? layer.encode.y;
    const levels = path.map((f) => table.column(f).values as ArrayLike<unknown>);
    const values = vf ? (table.column(vf).values as Float64Array) : undefined;
    const full = buildTree(levels, values);
    const legend = full.children.map((c) => ({ key: c.name, color: ctx.categorical(c.name) }));
    const root = buildTree(levels, values, (i) => ctx.hidden.has(String(levels[0][i])));
    const iterations = Math.max(1, Math.min(400, Math.round(style.iterations)));

    const outer = voronoiCells(root.children.map((c) => c.value), circlePolygon(0, 0, 1), iterations);
    interface Cell { leaf: HNode; top: HNode; poly: Pt[]; fill: RGBA }
    const cells: Cell[] = [];
    const groups: Pt[][] = [];
    root.children.forEach((top, gi) => {
      const poly = outer.cells[gi];
      if (poly.length < 3) return;
      groups.push(poly);
      const leaves = leavesOf(top);
      const inner = voronoiCells(leaves.map((l) => l.value), poly, iterations, gi + 2);
      const base = legend.find((l) => l.key === top.name)!.color;
      // Largest leaf in the full color, the others lighter by rank.
      const rank = leaves.map((_, i) => i).sort((a, b) => leaves[b].value - leaves[a].value);
      leaves.forEach((leaf, i) => {
        if (inner.cells[i].length < 3) return;
        const t = leaves.length > 1 ? rank.indexOf(i) / (leaves.length - 1) : 0;
        cells.push({ leaf, top, poly: inner.cells[i], fill: ctx.paint(mix(base, ctx.surface, 0.34 * t), leaf.row) });
      });
    });

    const X = (x: number) => ctx.x.norm(x);
    const Y = (y: number) => ctx.y.norm(y);
    const mesh: number[] = [];
    const lines: number[] = [];
    for (const c of cells) {
      for (let i = 1; i + 1 < c.poly.length; i++) {
        pushVertex(mesh, X(c.poly[0][0]), Y(c.poly[0][1]), c.fill);
        pushVertex(mesh, X(c.poly[i][0]), Y(c.poly[i][1]), c.fill);
        pushVertex(mesh, X(c.poly[i + 1][0]), Y(c.poly[i + 1][1]), c.fill);
      }
    }
    const outline = (poly: Pt[], width: number) => {
      if (!(width > 0)) return;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        pushSegment(lines, X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), ctx.surface, width);
      }
    };
    for (const c of cells) outline(c.poly, style.gap);
    for (const g of groups) outline(g, style.groupGap);

    // Labels at the centroid: name and value on two lines when the cell is tall enough, the name alone otherwise.
    const labels: MarkLabel[] = [];
    if (style.labels) {
      const ux = (X(1) - X(0)) / ctx.pixel[0]; // px per unit
      const uy = Math.abs(Y(1) - Y(0)) / ctx.pixel[1];
      const line = 14 / uy;
      const pad = 3 / ux;
      /** Widest horizontal room shared by every given height of the cell. */
      const room = (poly: Pt[], ys: number[]): [number, number] | null => {
        let lo = -Infinity, hi = Infinity;
        for (const y of ys) {
          const c = chordAt(poly, y);
          if (!c) return null;
          lo = Math.max(lo, c[0]);
          hi = Math.min(hi, c[1]);
        }
        return hi - lo > 2 * pad ? [lo + pad, hi - pad] : null;
      };
      const font = (size: number) => `600 ${size}px ${theme.font.family}`;
      /** The name on one line, or split on two at the space that balances the lines best. */
      const splits = (text: string): string[][] => {
        const out: string[][] = [[text]];
        const words = text.split(' ');
        let best: string[] | null = null;
        let bestW = Infinity;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(' ');
          const b = words.slice(i).join(' ');
          const w = Math.max(textWidth(a, font(11)), textWidth(b, font(11)));
          if (w < bestW) (bestW = w), (best = [a, b]);
        }
        if (best) out.push(best);
        return out;
      };
      /**
       * Whole names only: on one line or two, with the value under it when there is room, a size smaller
       * when needed; a cut name says nothing ("Rout…"), so the ellipsis only drops the last letters.
       */
      const put = (poly: Pt[], text: string, value: string | undefined, fill: RGBA) => {
        const [, cy0] = polygonCentroid(poly);
        const valueW = value !== undefined ? textWidth(value, font(10)) + 2 : 0;
        const tries: { lines: string[]; withValue: boolean; size: number }[] = [];
        for (const size of [11, 10])
          for (const withValue of value !== undefined ? [true, false] : [false])
            for (const lines of splits(text)) tries.push({ lines, withValue, size });
        const place = (lines: string[], withValue: boolean, span: [number, number], ellipsis: boolean, size: number, cy: number) => {
          const step = (size + 3) / uy;
          const tx = X((span[0] + span[1]) / 2);
          const k = lines.length + (withValue ? 1 : 0);
          const box = (yc: number): [number, number, number, number] => [X(span[0] - pad), Math.min(Y(yc - step * 0.62), Y(yc + step * 0.62)), X(span[1] + pad), Math.max(Y(yc - step * 0.62), Y(yc + step * 0.62))];
          const name = { on: fill, align: 'center' as const, baseline: 'middle' as const, size, weight: 600 };
          lines.forEach((t, j) => {
            const yc = cy + step * ((k - 1) / 2 - j);
            labels.push({ ...name, text: t, tx, ty: Y(yc), box: box(yc), ellipsis });
          });
          if (withValue) {
            const yc = cy - step * ((k - 1) / 2);
            labels.push({ tx, ty: Y(yc), text: value!, on: fill, align: 'center', baseline: 'middle', size: 10, box: box(yc) });
          }
        };
        // Around the centroid first, then a little higher or lower where the cell may be wider.
        const shifts = [0, 0.5, -0.5, 1, -1, 1.5, -1.5];
        for (const { lines, withValue, size } of tries) {
          const step = (size + 3) / uy;
          const k = lines.length + (withValue ? 1 : 0);
          const half = step * (k / 2 + 0.15);
          for (const sh of shifts) {
            const cy = cy0 + sh * step;
            const span = room(poly, [cy + half, cy - half]);
            if (!span) continue;
            const w = (span[1] - span[0]) * ux;
            if (w >= Math.max(...lines.map((t) => textWidth(t, font(size)) + 3), withValue ? valueW + 1 : 0)) {
              place(lines, withValue, span, true, size, cy);
              return;
            }
          }
        }
        // Last resort: one line losing only its last letters (at least 80 % of the name shows).
        const one = room(poly, [cy0 + line * 0.6, cy0 - line * 0.6]);
        if (one && (one[1] - one[0]) * ux >= 0.8 * textWidth(text, font(11)) + 3 + textWidth('…', font(11))) place([text], false, one, true, 11, cy0);
      };
      // A small circle (a phone, a thumbnail) has no room for the leaves: it names the groups instead.
      if (2 * ux < 230 && groups.length > 1) {
        root.children.forEach((top, gi) => {
          if (outer.cells[gi].length >= 3) put(outer.cells[gi], top.name, undefined, ctx.paint(legend.find((l) => l.key === top.name)!.color, undefined));
        });
      } else {
        for (const c of cells) put(c.poly, c.leaf.name, vf ? ctx.format(c.leaf.value, vf) : undefined, c.fill);
      }
    }

    const draws: BuiltMark['draws'] = [];
    if (mesh.length) {
      const b = ctx.renderer.createBatch('mesh');
      b.update(new Float32Array(mesh), mesh.length / LAYOUTS.mesh.stride);
      draws.push({ batch: b, enter: 'fade' });
    }
    if (lines.length) {
      const b = ctx.renderer.createBatch('line');
      b.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
      draws.push({ batch: b, enter: 'fade' });
    }
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      pick(tx, ty): ShapeHit | null {
        const x = ctx.x.invert(tx);
        const y = ctx.y.invert(ty);
        const c = cells.find((q) => pointInPolygon(q.poly, x, y));
        if (!c) return null;
        const rows = [
          ...(vf ? [{ label: fieldLabel(ctx, vf), value: ctx.format(c.leaf.value, vf) }] : []),
          { label: ctx.theme.texts.shareOfTotal, value: share(c.leaf.value, root.value) },
        ];
        if (c.leaf !== c.top) rows.push({ label: fillText(ctx.theme.texts.shareOf, { name: c.top.name }), value: share(c.leaf.value, c.top.value) });
        return { title: c.leaf === c.top ? c.leaf.name : `${c.top.name} › ${c.leaf.name}`, rows };
      },
    };
  },
};

// ------------------------------------------------------------- indented tree

/**
 * `indentedTree`: a hierarchy as an outline. One line per node of `path`, indented by level, with
 * its `value` (subtotal for a node with children) and a bar for its share. Click a node to fold it.
 */
export const indentedTree: MarkDefinition = {
  standalone: true,
  // Rows, columns and text are laid out in px.
  sizeDependent: true,
  symbol: 'square',
  scales: () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) }),
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const path = pathOf(ctx, 'indentedTree');
    const vf = layer.encode.value ?? layer.encode.y;
    const levels = path.map((f) => table.column(f).values as ArrayLike<unknown>);
    const root = buildTree(levels, vf ? (table.column(vf).values as Float64Array) : undefined);
    const toggled = (ctx.state.toggled ??= {}) as Record<string, boolean>;
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const text = (n: HNode) => (vf ? ctx.format(n.value, vf) : String(n.value));
    const family = theme.font.family;

    // Columns, px: name | bar | value | share. The widths do not depend on what is folded.
    const everyNode: HNode[] = [];
    const collect = (n: HNode) => n.children.forEach((c) => (everyNode.push(c), collect(c)));
    collect(root);
    const valueW = Math.ceil(Math.max(0, ...everyNode.map((n) => textWidth(text(n), `600 12px ${family}`)))) + 2;
    const shareW = W >= 440 ? 52 : 0;
    const barW = style.bars ? Math.round(Math.max(W < 300 ? 36 : 56, Math.min(260, W * 0.3))) : 0;
    const valueX = W - shareW;
    const barX = valueX - valueW - 12 - barW;
    const nameW = (barW ? barX - 14 : valueX - valueW - 12);
    const maxTop = Math.max(0, ...root.children.map((c) => c.value)) || 1;
    const ink = parseColor(theme.text.secondary);
    const rule = parseColor(theme.grid.y.color);

    const rects = ctx.renderer.createBatch('rect');
    const mesh = ctx.renderer.createBatch('mesh');
    const labels: MarkLabel[] = [];
    let shown: IndentedRow[] = [];
    let rowH = style.rowHeight;

    const render = () => {
      const all = indentedRows(root, style.expand, toggled, style.sorted);
      // Rows shrink a little before any is cut.
      rowH = Math.max(20, Math.min(style.rowHeight, H / Math.max(1, all.length)));
      const fit = fitRows(all, Math.max(1, Math.floor((H + 0.5) / rowH)));
      shown = fit.rows;
      const r: number[] = [];
      const m: number[] = [];
      labels.length = 0;
      const ty = (y: number) => 1 - y * py;
      shown.forEach((row, i) => {
        const n = row.node;
        const cy = (i + 0.5) * rowH;
        const x0 = (n.depth - 1) * style.indent;
        const parent = n.children.length > 0;
        if (n.depth === 1 && i > 0) pushRect(r, { x0: 0, y0: ty(i * rowH + 0.5), x1: 1, y1: ty(i * rowH - 0.5), fill: rule });
        if (parent) {
          // Chevron: pointing down when open, right when folded.
          const tri: [number, number][] = row.open
            ? [[x0 + 1.5, cy - 2.5], [x0 + 10.5, cy - 2.5], [x0 + 6, cy + 3]]
            : [[x0 + 3.5, cy - 4.5], [x0 + 3.5, cy + 4.5], [x0 + 9, cy]];
          for (const [x, y] of tri) pushVertex(m, x * px, ty(y), ink);
        }
        const nameX = x0 + 16;
        if (nameW - nameX >= 18) {
          labels.push({
            tx: nameX * px, ty: ty(cy), text: n.name, align: 'left', baseline: 'middle', size: 12,
            weight: parent || n.depth === 1 ? 600 : 400, color: parent || n.depth === 1 ? theme.text.primary : theme.text.secondary, maxWidth: nameW - nameX,
          });
        }
        if (barW) {
          const h = n.depth === 1 ? 10 : 6;
          const base = ctx.categorical(row.top.name);
          const fill = ctx.paint(n.depth === 1 ? base : mix(base, ctx.surface, 0.35), n.row);
          const y0 = ty(cy + h / 2), y1 = ty(cy - h / 2);
          const rad = h / 2;
          pushRect(r, { x0: barX * px, y0, x1: (barX + barW) * px, y1, fill: mix(ctx.surface, rule, 0.6), radii: [rad, rad, rad, rad] });
          const w = Math.max(h, (n.value / maxTop) * barW);
          pushRect(r, { x0: barX * px, y0, x1: (barX + w) * px, y1, fill, radii: [rad, rad, rad, rad] });
        }
        labels.push({ tx: valueX * px, ty: ty(cy), text: text(n), align: 'right', baseline: 'middle', size: 12, weight: parent || n.depth === 1 ? 600 : 400, color: theme.text.primary });
        if (shareW) labels.push({ tx: 1, ty: ty(cy), text: share(n.value, root.value), align: 'right', baseline: 'middle', size: 11, color: theme.text.muted });
      });
      if (fit.more) {
        labels.push({
          tx: 16 * px, ty: ty((shown.length + 0.5) * rowH), text: fillText(fit.more > 1 ? ctx.theme.texts.moreRows : ctx.theme.texts.moreRow, { n: fit.more }),
          align: 'left', baseline: 'middle', size: 11, color: theme.text.muted,
        });
      }
      rects.update(new Float32Array(r), r.length / LAYOUTS.rect.stride);
      mesh.update(new Float32Array(m), m.length / LAYOUTS.mesh.stride);
    };
    render();

    const rowAt = (tx: number, t: number): IndentedRow | undefined => {
      if (tx < 0 || tx > 1) return undefined;
      const y = (1 - t) / py;
      return y < 0 ? undefined : shown[Math.floor(y / rowH)];
    };
    return {
      draws: [{ batch: rects, pixelSnap: false }, { batch: mesh, enter: 'fade' }],
      hit: emptyHit(),
      labels,
      legend: [],
      pick(tx, t): ShapeHit | null {
        const row = rowAt(tx, t);
        if (!row) return null;
        const n = row.node;
        const rows = [
          ...(vf ? [{ label: fieldLabel(ctx, vf), value: text(n) }] : []),
          { label: ctx.theme.texts.shareOfTotal, value: share(n.value, root.value) },
        ];
        if (n.depth > 1) {
          const parent = everyNode.find((p) => pathKey(p.path) === pathKey(n.path.slice(0, -1)));
          if (parent) rows.push({ label: fillText(ctx.theme.texts.shareOf, { name: parent.name }), value: share(n.value, parent.value) });
        }
        if (n.children.length) rows.push({ label: ctx.theme.texts.rows, value: String(n.children.length) });
        return { title: n.path.join(' › '), rows };
      },
      click(tx, t) {
        const row = rowAt(tx, t);
        if (!row || !row.node.children.length) return undefined;
        toggled[pathKey(row.node.path)] = !row.open;
        render();
        return row.open ? row.node.path.slice(0, -1) : row.node.path;
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const HIERARCHY_MARKS: Record<string, MarkDefinition> = { voronoi, indentedTree };
