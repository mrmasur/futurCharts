/**
 * Product-analysis marks: cohort retention table, decomposition tree, compared funnel.
 * Their layouts and rates live in `productLayout.ts`; everything here is laid out in px
 * (`ctx.pixel`) over a 0..1 scale space, like the indented tree.
 */
import { LAYOUTS } from '../render/layouts';
import { LinearScale } from '../scale/scales';
import { mix, parseColor } from '../util/color';
import { share } from './charts';
import { buildTree, type HNode } from './hierarchyLayout';
import { pushRect, pushSegment } from './primitives';
import { cohortTable, decompositionColumns, funnelComparison, type DecompositionColumn } from './productLayout';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkLabel, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { fillText } from '../theme/texts';

const fieldLabel = (ctx: BuildContext, f: string) => ctx.fields[f]?.label ?? f;
const percent = (v: number) => (Number.isFinite(v) ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(v) : '–');
const unit = () => ({ x: new LinearScale(0, 1), y: new LinearScale(0, 1) });

function need(ctx: BuildContext, field: string | undefined, mark: string, what: string): string {
  if (!field) throw new Error(`futurCharts: mark "${mark}" needs ${what}.`);
  return field;
}

// ------------------------------------------------------------------- cohort

/**
 * `cohort`: retention table. One line per cohort (`y`), one column per period elapsed (`x`, a
 * number), each cell shaded by the share of the cohort still there (`value`: head counts, or
 * rates with `asRate`). Periods that have not come yet leave the lower right corner empty.
 */
export const cohort: MarkDefinition = {
  standalone: true,
  // Columns and text are laid out in px.
  sizeDependent: true,
  symbol: 'square',
  scales: unit,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const cf = need(ctx, layer.encode.y ?? layer.encode.key, 'cohort', 'encode.y (the cohort)');
    const pf = need(ctx, layer.encode.x, 'cohort', 'encode.x (the period elapsed, a number)');
    const vf = need(ctx, layer.encode.value, 'cohort', 'encode.value');
    const asRate: boolean = style.asRate;
    const t = cohortTable(
      table.column(cf).values as ArrayLike<unknown>,
      table.column(pf).values as Float64Array,
      table.column(vf).values as Float64Array,
      asRate,
    );
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const family = theme.font.family;
    const average = style.average && t.cohorts.length > 1;
    const averageLabel = ctx.theme.texts.average;

    // Columns, px: cohort | size | one per period.
    const nameW = Math.min(W * 0.3, Math.ceil(Math.max(...[...t.cohorts, average ? averageLabel : ''].map((n) => textWidth(n, `600 11px ${family}`)))) + 10);
    const sizeText = t.size.map((s) => (Number.isNaN(s) ? '' : ctx.format(s, vf)));
    const sizeW = style.sizes && !asRate && W >= 420 ? Math.ceil(Math.max(44, ...sizeText.map((s) => textWidth(s, `11px ${family}`)))) + 14 : 0;
    const headerH = 20;
    const averageGap = average ? 5 : 0;
    const rows = t.cohorts.length + (average ? 1 : 0);
    const cellW = Math.min(84, (W - nameW - sizeW) / Math.max(1, t.periods.length));
    const cellH = Math.max(8, Math.min(38, (H - headerH - averageGap) / Math.max(1, rows)));
    const x0 = nameW + sizeW;
    const ty = (y: number) => 1 - y * py;
    const rowTop = (r: number) => headerH + r * cellH + (r >= t.cohorts.length ? averageGap : 0);

    // Shade: from the lowest rate to the highest one past the first period (which is always 100 %).
    const all = t.rate.flat().filter((v) => !Number.isNaN(v));
    const later = t.rate.flatMap((r) => r.slice(1)).filter((v) => !Number.isNaN(v));
    const lo = Math.min(...all);
    const hi = later.length ? Math.max(...later) : Math.max(...all);
    const shade = (v: number) => ctx.ramp(0.06 + 0.88 * (hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0.5));

    const rects: number[] = [];
    const keys: string[] = [];
    const labels: MarkLabel[] = [];
    const small = cellW < 38 || cellH < 17;
    // Low cells give their gap up to the figures.
    const gap = cellH < 16 ? Math.min(style.gap, 1) : style.gap;
    const rad = Math.min(style.radius, cellH / 4);
    const cell = (r: number, p: number, rate: number, row: number | undefined, key: string) => {
      const fill = ctx.paint(shade(rate), row);
      const top = rowTop(r);
      const box: [number, number, number, number] = [(x0 + p * cellW + gap / 2) * px, ty(top + cellH - gap / 2), (x0 + (p + 1) * cellW - gap / 2) * px, ty(top + gap / 2)];
      pushRect(rects, { x0: box[0], y0: box[1], x1: box[2], y1: box[3], fill, radii: [rad, rad, rad, rad] });
      keys.push(key);
      if (!style.labels) return;
      const at = { tx: (x0 + (p + 0.5) * cellW) * px, ty: ty(top + cellH / 2), on: fill, align: 'center' as const, baseline: 'middle' as const, size: cellH < 15 ? 9 : small ? 10 : 11, box };
      // Too narrow for "42 %": the figure alone.
      labels.push({ ...at, text: percent(rate), fallback: { ...at, text: String(Math.round(rate * 100)) } });
    };
    const lineLabel = (r: number, name: string, size: string, strong: boolean) => {
      const y = ty(rowTop(r) + cellH / 2);
      if (cellH < 11) return;
      labels.push({ tx: 0, ty: y, text: name, align: 'left', baseline: 'middle', size: 11, weight: strong ? 600 : 400, color: theme.text.primary, maxWidth: nameW - 6 });
      if (sizeW && size) labels.push({ tx: (x0 - 12) * px, ty: y, text: size, align: 'right', baseline: 'middle', size: 11, color: theme.text.secondary });
    };

    // Header: the name of both leading columns, then the periods (one in two when they are too narrow).
    const head = { ty: ty(headerH / 2 - 1), baseline: 'middle' as const, size: 10, color: theme.text.muted };
    labels.push({ ...head, tx: 0, text: fieldLabel(ctx, cf), align: 'left', maxWidth: nameW - 6 });
    if (sizeW) labels.push({ ...head, tx: (x0 - 12) * px, text: ctx.theme.texts.count, align: 'right' });
    const prefix: string = style.periodPrefix;
    const widest = Math.max(...t.periods.map((p) => textWidth(`${prefix}${p}`, `10px ${family}`)));
    const every = Math.max(1, Math.ceil((widest + 4) / cellW));
    t.periods.forEach((p, i) => {
      if (i % every === 0) labels.push({ ...head, tx: (x0 + (i + 0.5) * cellW) * px, text: `${prefix}${p}`, align: 'center' });
    });

    t.cohorts.forEach((name, c) => {
      lineLabel(c, name, sizeText[c], false);
      t.periods.forEach((_, p) => {
        if (!Number.isNaN(t.rate[c][p])) cell(c, p, t.rate[c][p], t.row[c][p], `${name}\u0000${t.periods[p]}`);
      });
    });
    if (average) {
      const total = t.size.reduce((a, s) => a + (Number.isNaN(s) ? 0 : s), 0);
      lineLabel(t.cohorts.length, averageLabel, asRate ? '' : ctx.format(total, vf), true);
      t.periods.forEach((_, p) => {
        if (!Number.isNaN(t.average[p])) cell(t.cohorts.length, p, t.average[p], undefined, `\u0000${t.periods[p]}`);
      });
    }

    const data = new Float32Array(rects);
    const batch = ctx.renderer.createBatch('rect');
    batch.update(data, keys.length);
    return {
      draws: [{ batch, pixelSnap: false, enter: 'fade', data, keys }],
      hit: emptyHit(),
      labels,
      legend: [],
      pick(tx, y): ShapeHit | null {
        const p = Math.floor((tx / px - x0) / cellW);
        let r = Math.floor(((1 - y) / py - headerH) / cellH);
        if (r >= t.cohorts.length) r = Math.floor(((1 - y) / py - headerH - averageGap) / cellH);
        if (tx / px < x0 || p < 0 || p >= t.periods.length || r < 0 || r >= rows) return null;
        const period = `${prefix}${t.periods[p]}`;
        if (r === t.cohorts.length) {
          return Number.isNaN(t.average[p]) ? null : { title: `${averageLabel} · ${period}`, rows: [{ label: ctx.theme.texts.retention, value: percent(t.average[p]) }] };
        }
        if (Number.isNaN(t.rate[r][p])) return null;
        const out = [{ label: ctx.theme.texts.retention, value: percent(t.rate[r][p]) }];
        if (!asRate) {
          out.push({ label: fieldLabel(ctx, vf), value: ctx.format(t.count[r][p], vf) });
          out.push({ label: ctx.theme.texts.cohortSize, value: ctx.format(t.size[r], vf) });
        }
        return { title: `${t.cohorts[r]} · ${period}`, rows: out };
      },
    };
  },
};

// ------------------------------------------------------------ decomposition

/**
 * `decomposition`: decomposition tree. The levels of `path` in columns, each node a small bar with
 * its name and `value`, largest first; one node per level is expanded into the next column and
 * linked to its children. Click a node to expand its branch instead.
 */
export const decomposition: MarkDefinition = {
  standalone: true,
  // Columns, rows and text are laid out in px.
  sizeDependent: true,
  symbol: 'square',
  scales: unit,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const path = layer.encode.path;
    if (!path?.length) throw new Error('futurCharts: mark "decomposition" needs encode.path (a list of fields).');
    const vf = layer.encode.value ?? layer.encode.y;
    const levels = path.map((f) => table.column(f).values as ArrayLike<unknown>);
    const root = buildTree(levels, vf ? (table.column(vf).values as Float64Array) : undefined);
    // Expanded node per level: the click wins over the style, the largest node is the default.
    const chosen = (ctx.state.expanded ??= [...((style.expanded as string[] | undefined) ?? [])]) as (string | undefined)[];
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const family = theme.font.family;
    const text = (n: HNode) => (vf ? ctx.format(n.value, vf) : String(n.value));
    const ty = (y: number) => 1 - y * py;

    // Columns, px. The total opens the tree when there is room for one more column.
    const withRoot = W / (path.length + 1) >= 118;
    const nCols = path.length + (withRoot ? 1 : 0);
    const rootName: string = style.rootLabel || ctx.theme.texts.total;
    const linkW = W < 480 ? 16 : Math.min(48, W * 0.05);
    const evenW = Math.min(250, (W - linkW * (nCols - 1)) / nCols);
    const headerH = 20;
    const narrow = evenW < 140;
    // The total holds a single node: it keeps only the width it needs, the levels share the rest.
    const rootNeed = Math.ceil(textWidth(rootName, `600 11.5px ${family}`) + textWidth(text(root), `600 11px ${family}`)) + 24;
    const rootW = withRoot ? (narrow ? evenW : Math.min(evenW, Math.max(90, rootNeed))) : 0;
    const colW = withRoot && !narrow ? Math.min(250, (W - linkW * (nCols - 1) - rootW) / path.length) : evenW;
    /** Width of column `c`, px (column 0 is the total when it is shown). */
    const cw = (c: number) => (withRoot && c === 0 ? rootW : colW);
    // A narrow column needs two full lines per node (name, then bar and value).
    const baseRowH = Math.max(narrow ? 33 : 26, Math.min(style.rowHeight, (H - headerH) / 4));
    const maxRows = Math.max(2, Math.floor((H - headerH + 2) / baseRowH));
    /** Row pitch, px: stretched (up to half as much again) when the longest column leaves the frame half empty. */
    let rowH = baseRowH;
    const colX = (c: number) => (withRoot ? (c === 0 ? 0 : rootW + linkW + (c - 1) * (colW + linkW)) : c * (colW + linkW));
    const barY = (i: number) => headerH + i * rowH + (narrow ? 24 : 21);
    const accent = ctx.categorical(vf ? fieldLabel(ctx, vf) : 'value');
    const track = mix(ctx.surface, parseColor(theme.grid.y.color), 0.6);
    const linkColor = mix(ctx.surface, parseColor(theme.text.muted), 0.55);
    const everyNode: HNode[] = [];
    const collect = (n: HNode) => n.children.forEach((c) => (everyNode.push(c), collect(c)));
    collect(root);
    /** Room kept right of the bars for the values of a narrow column, px. */
    const valueSlot = Math.ceil(Math.max(0, ...everyNode.map((n) => textWidth(text(n), `600 10.5px ${family}`)))) + 8;

    const rects = ctx.renderer.createBatch('rect');
    const lines = ctx.renderer.createBatch('line');
    const labels: MarkLabel[] = [];
    let columns: DecompositionColumn[] = [];

    const render = () => {
      columns = decompositionColumns(root, chosen, maxRows);
      const longest = Math.max(1, ...columns.map((c) => c.nodes.length + (c.more ? 1 : 0)));
      rowH = Math.max(baseRowH, Math.min(baseRowH * 1.5, (H - headerH) / longest));
      const r: number[] = [];
      const l: number[] = [];
      labels.length = 0;
      const node = (c: number, i: number, name: string, value: string, part: number, open: boolean, row: number | undefined) => {
        const x = colX(c);
        const colW = cw(c);
        const top = headerH + i * rowH;
        const valueW = Math.ceil(textWidth(value, `600 11px ${family}`));
        // A narrow column keeps the first line for the name: the value goes beside the bar.
        const barW = narrow ? colW - valueSlot : colW;
        labels.push({
          tx: x * px, ty: ty(top + (narrow ? 8 : 9)), text: name, align: 'left', baseline: 'middle', size: 11.5,
          weight: open ? 600 : 400, color: open ? theme.text.primary : theme.text.secondary, maxWidth: Math.max(12, narrow ? colW : colW - valueW - 8),
        });
        labels.push({ tx: (x + colW) * px, ty: ty(narrow ? barY(i) : top + 9), text: value, align: 'right', baseline: 'middle', size: narrow ? 10.5 : 11, weight: 600, color: theme.text.primary });
        const y0 = ty(barY(i) + 3), y1 = ty(barY(i) - 3);
        pushRect(r, { x0: x * px, y0, x1: (x + barW) * px, y1, fill: track, radii: [3, 3, 3, 3] });
        const fill = ctx.paint(open ? accent : mix(accent, ctx.surface, 0.48), row);
        pushRect(r, { x0: x * px, y0, x1: (x + Math.max(6, part * barW)) * px, y1, fill, radii: [3, 3, 3, 3] });
      };
      /** Curved link from the bar of row `i` of column `c` to the bar of row `j` of the next one. */
      const link = (c: number, i: number, j: number) => {
        const xa = colX(c) + cw(c) + 3, xb = colX(c + 1) - 3;
        const ya = barY(i), yb = barY(j);
        let lx = xa, ly = ya;
        for (let k = 1; k <= 16; k++) {
          const u = k / 16;
          const x = xa + (xb - xa) * u;
          // Smoothstep: leaves and arrives flat.
          const y = ya + (yb - ya) * (u * u * (3 - 2 * u));
          pushSegment(l, lx * px, ty(ly), x * px, ty(y), linkColor, style.linkWidth);
          lx = x;
          ly = y;
        }
      };
      const head = (c: number, label: string) =>
        labels.push({ tx: colX(c) * px, ty: ty(7), text: label, align: 'left', baseline: 'middle', size: 10, color: theme.text.muted, maxWidth: cw(c) });
      const shift = withRoot ? 1 : 0;
      if (withRoot) {
        head(0, vf ? fieldLabel(ctx, vf) : rootName);
        node(0, 0, rootName, text(root), 1, true, undefined);
        columns[0]?.nodes.forEach((_, j) => link(0, 0, j));
      }
      columns.forEach((col, ci) => {
        const c = ci + shift;
        head(c, fieldLabel(ctx, path[ci]));
        const max = Math.max(...col.nodes.map((n) => n.value)) || 1;
        col.nodes.forEach((n, i) => node(c, i, n.name, text(n), n.value / max, i === col.open, n.row));
        if (col.more) {
          labels.push({
            tx: colX(c) * px, ty: ty(headerH + col.nodes.length * rowH + 9), text: fillText(col.more > 1 ? ctx.theme.texts.moreOthers : ctx.theme.texts.moreOther, { n: col.more }),
            align: 'left', baseline: 'middle', size: 11, color: theme.text.muted,
          });
        }
        if (col.open >= 0) columns[ci + 1]?.nodes.forEach((_, j) => link(c, col.open, j));
      });
      rects.update(new Float32Array(r), r.length / LAYOUTS.rect.stride);
      lines.update(new Float32Array(l), l.length / LAYOUTS.line.stride);
    };
    render();

    /** The node under a position, with the index of its column in `columns` (-1: the total). */
    const nodeAt = (tx: number, t: number): { node: HNode; level: number } | undefined => {
      const x = tx / px;
      const y = (1 - t) / py - headerH;
      if (x < 0 || y < 0) return undefined;
      let c = 0;
      while (c + 1 < nCols && x >= colX(c + 1)) c++;
      if (x - colX(c) > cw(c)) return undefined;
      const i = Math.floor(y / rowH);
      const level = c - (withRoot ? 1 : 0);
      if (level < 0) return i === 0 ? { node: root, level } : undefined;
      const node = columns[level]?.nodes[i];
      return node && { node, level };
    };
    return {
      draws: [{ batch: lines, enter: 'fade' }, { batch: rects, pixelSnap: false, enter: 'fade' }],
      hit: emptyHit(),
      labels,
      legend: [],
      pick(tx, t): ShapeHit | null {
        const at = nodeAt(tx, t);
        if (!at) return null;
        const n = at.node;
        if (at.level < 0) return { title: rootName, rows: [{ label: vf ? fieldLabel(ctx, vf) : ctx.theme.texts.rows, value: text(n) }] };
        const rows = [
          ...(vf ? [{ label: fieldLabel(ctx, vf), value: text(n) }] : []),
          { label: ctx.theme.texts.shareOfTotal, value: share(n.value, root.value) },
        ];
        const parent = columns[at.level].parent;
        if (at.level > 0) rows.push({ label: fillText(ctx.theme.texts.shareOf, { name: parent.name }), value: share(n.value, parent.value) });
        return { title: n.path.join(' › '), rows };
      },
      click(tx, t) {
        const at = nodeAt(tx, t);
        if (!at || at.level < 0 || !at.node.children.length || columns[at.level].nodes[columns[at.level].open] === at.node) return undefined;
        chosen[at.level] = at.node.name;
        // The levels below go back to their largest node.
        chosen.length = at.level + 1;
        render();
        return at.node.path;
      },
    };
  },
};

// ------------------------------------------------------------ compared funnel

/**
 * `funnelCompare`: a funnel per segment, side by side. Steps (`key`) in lines, one centered bar per
 * segment (`color`), the pass rate from a step to the next written between them. The part lost at
 * each step stays as a pale bar, and the heaviest loss of each segment is written in the alert color.
 */
export const funnelCompare: MarkDefinition = {
  standalone: true,
  // Columns and text are laid out in px.
  sizeDependent: true,
  symbol: 'square',
  scales: unit,
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const kf = need(ctx, layer.encode.key ?? layer.encode.y, 'funnelCompare', 'encode.key (the step)');
    const vf = need(ctx, layer.encode.value ?? layer.encode.x, 'funnelCompare', 'encode.value');
    const sf = layer.encode.color;
    const f = funnelComparison(
      table.column(kf).values as ArrayLike<unknown>,
      sf ? (table.column(sf).values as ArrayLike<unknown>) : undefined,
      table.column(vf).values as Float64Array,
      fieldLabel(ctx, vf),
    );
    const [px, py] = ctx.pixel;
    const W = 1 / px;
    const H = 1 / py;
    const family = theme.font.family;
    const n = f.stages.length;
    const S = Math.max(1, f.segments.length);
    const ty = (y: number) => 1 - y * py;

    // Columns, px: step names, then one column per segment.
    const nameW = Math.min(W * 0.3, Math.ceil(Math.max(0, ...f.stages.map((s) => textWidth(s, `600 12px ${family}`)))) + 12);
    const segW = (W - nameW) / S;
    const barMax = Math.max(8, segW - Math.min(20, segW * 0.14));
    // Lines, px: header, then a bar per step with the pass rate in between, then the overall rate.
    const headerH = 20;
    const overall = style.overall && n > 1;
    const overallH = overall ? 22 : 0;
    const free = H - headerH - overallH;
    let barH = Math.min(style.thickness, (free - (n - 1) * 15) / n);
    barH = Math.max(6, barH);
    const rateH = n > 1 ? Math.max(13, Math.min(34, (free - n * barH) / (n - 1))) : 0;
    const top = (i: number) => headerH + i * (barH + rateH);
    const scaleOf = (s: number) => (style.relative ? f.value[s][0] : Math.max(...f.value.flat())) || 1;
    const bad = theme.marks.kpi.bad;

    const ghosts: number[] = [];
    const bars: number[] = [];
    const keys: string[] = [];
    const labels: MarkLabel[] = [];
    const rad = Math.min(style.radius, barH / 2);
    const radii: [number, number, number, number] = [rad, rad, rad, rad];
    const colors = f.segments.map((s) => ctx.categorical(s));

    f.stages.forEach((stage, i) => {
      labels.push({
        tx: 0, ty: ty(top(i) + barH / 2), text: stage, align: 'left', baseline: 'middle', size: 12, weight: 600,
        color: theme.text.primary, maxWidth: nameW - 8,
      });
    });
    if (overall) {
      labels.push({ tx: 0, ty: ty(top(n - 1) + barH + overallH / 2 + 3), text: ctx.theme.texts.conversion, align: 'left', baseline: 'middle', size: 11, color: theme.text.muted, maxWidth: nameW - 8 });
    }
    f.segments.forEach((segment, s) => {
      const cx = nameW + (s + 0.5) * segW;
      const color = colors[s];
      const k = barMax / scaleOf(s);
      // Header: a swatch and the name of the segment.
      const title = { text: segment, size: 12, weight: 600 };
      const tw = Math.min(segW - 18, textWidth(segment, `600 12px ${family}`));
      pushRect(ghosts, { x0: (cx - tw / 2 - 8) * px, y0: ty(headerH / 2 + 3), x1: (cx - tw / 2) * px, y1: ty(headerH / 2 - 5), fill: color, radii: [2, 2, 2, 2] });
      labels.push({ ...title, tx: (cx - tw / 2 + 5) * px, ty: ty(headerH / 2 - 1), align: 'left', baseline: 'middle', color: theme.text.primary, maxWidth: tw });
      f.stages.forEach((stage, i) => {
        const v = f.value[s][i];
        const w = Math.max(2, v * k);
        const y0 = ty(top(i) + barH), y1 = ty(top(i));
        if (i > 0) {
          // What the previous step held and this one lost.
          const pw = Math.max(2, f.value[s][i - 1] * k);
          pushRect(ghosts, { x0: (cx - pw / 2) * px, y0, x1: (cx + pw / 2) * px, y1, fill: mix(color, ctx.surface, 0.84), radii });
          const worst = f.worst[s] === i && n > 2;
          labels.push({
            tx: cx * px, ty: ty(top(i) - rateH / 2), text: segW >= 150 ? fillText(ctx.theme.texts.passThrough, { percent: percent(f.pass[s][i]) }) : `↓ ${percent(f.pass[s][i])}`, align: 'center', baseline: 'middle',
            size: rateH < 15 ? 10 : 11, weight: worst ? 700 : 400, color: worst ? bad : theme.text.secondary,
          });
        }
        const fill = ctx.paint(color, f.row[s][i] < 0 ? undefined : f.row[s][i]);
        pushRect(bars, { x0: (cx - w / 2) * px, y0, x1: (cx + w / 2) * px, y1, fill, radii });
        keys.push(`${segment}\u0000${stage}`);
        if (style.labels && barH >= 13) {
          const value = ctx.format(v, vf);
          const at = { ty: ty(top(i) + barH / 2), text: value, baseline: 'middle' as const, size: barH < 16 ? 10 : 11, weight: 600 };
          // A bar too short for its figure: written beside it, over the pale part.
          if (w >= textWidth(value, `600 ${at.size}px ${family}`) + 10) labels.push({ ...at, tx: cx * px, on: fill, align: 'center' });
          else labels.push({ ...at, tx: (cx + w / 2 + 5) * px, align: 'left', color: theme.text.primary });
        }
      });
      if (overall) {
        labels.push({ tx: cx * px, ty: ty(top(n - 1) + barH + overallH / 2 + 3), text: share(f.value[s][n - 1], f.value[s][0]), align: 'center', baseline: 'middle', size: 12, weight: 700, color: theme.text.primary });
      }
    });

    const ghostBatch = ctx.renderer.createBatch('rect');
    ghostBatch.update(new Float32Array(ghosts), ghosts.length / LAYOUTS.rect.stride);
    const data = new Float32Array(bars);
    const barBatch = ctx.renderer.createBatch('rect');
    barBatch.update(data, keys.length);
    return {
      draws: [{ batch: ghostBatch, pixelSnap: false, enter: 'fade' }, { batch: barBatch, pixelSnap: false, enter: 'fade', data, keys }],
      hit: emptyHit(),
      labels,
      legend: [],
      pick(tx, t): ShapeHit | null {
        const x = tx / px - nameW;
        const y = (1 - t) / py - headerH;
        if (x < 0 || y < 0) return null;
        const s = Math.floor(x / segW);
        // A step owns its bar and the pass rate written above it.
        const i = Math.floor((y + rateH) / (barH + rateH));
        if (s >= S || i >= n) return null;
        const v = f.value[s][i];
        const rows = [{ label: fieldLabel(ctx, vf), value: ctx.format(v, vf) }];
        if (i > 0) {
          rows.push({ label: ctx.theme.texts.sincePrevious, value: percent(f.pass[s][i]) });
          rows.push({ label: ctx.theme.texts.lostAtStep, value: ctx.format(f.value[s][i - 1] - v, vf) });
          rows.push({ label: ctx.theme.texts.sinceFirst, value: percent(f.value[s][0] > 0 ? v / f.value[s][0] : NaN) });
        }
        return { title: S > 1 || sf ? `${f.stages[i]} · ${f.segments[s]}` : f.stages[i], rows };
      },
    };
  },
};

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const PRODUCT_MARKS: Record<string, MarkDefinition> = { cohort, decomposition, funnelCompare };
