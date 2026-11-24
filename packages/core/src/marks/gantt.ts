/**
 * Planning marks: `gantt` (tasks, progress, milestones, phases, dependencies),
 * `schedule` (slots per resource, overlaps on sub-lanes) and `swimlane` (states
 * of an entity through time). Standalone: time along x, one row per task or
 * resource (`RowScale`). The layout lives in `ganttLayout.ts`.
 */
import { LAYOUTS } from '../render/layouts';
import type { RGBA } from '../render/types';
import { LinearScale, TimeScale, type Scale } from '../scale/scales';
import type { LayerSpec } from '../spec/types';
import { mix, parseColor, toCss, withAlpha } from '../util/color';
import { ganttModel, RowScale, routeDependency, scheduleModel, specDate, type GanttModel, type ScheduleModel } from './ganttLayout';
import { dashed, luminance, pushRect, pushSegment, pushVertex } from './primitives';
import { emptyHit, type BuildContext, type MarkDefinition, type MarkDraw, type MarkLabel, type MarkScales, type ShapeHit } from './registry';
import { textWidth } from './shapes';
import { fillText } from '../theme/texts';

const DAY = 86400000;

type Size = { width: number; height: number } | undefined;

function batch(ctx: BuildContext, kind: 'rect' | 'line' | 'point' | 'mesh', data: number[]) {
  const b = ctx.renderer.createBatch(kind);
  b.update(new Float32Array(data), data.length / LAYOUTS[kind].stride);
  return b;
}

const fieldLabel = (ctx: BuildContext, f: string | undefined, fallback: string) => (f ? (ctx.fields[f]?.label ?? fallback) : fallback);

/** Time (or number) scale over [t0, t1] and `also` (the "today" date), with a little air on both sides. */
function spanScale(t0: number, t1: number, time: boolean, also: number, pad = 0.025, padEnd = pad): Scale {
  let a = t0;
  let b = t1;
  if (Number.isFinite(also)) {
    a = Math.min(a, also);
    b = Math.max(b, also);
  }
  const span = b - a || (time ? DAY : 1);
  return time ? new TimeScale(a - span * pad, b + span * padEnd) : new LinearScale(a - span * pad, b + span * padEnd);
}

/**
 * Room above the first row for the "today" flag, in row weights: about 22 px
 * whatever the number of rows (estimated from the chart's box).
 */
function flagRoom(flag: boolean, weight: number, size: Size): number {
  if (!flag) return 0.12;
  const plot = Math.max(80, (size?.height ?? 400) - 120);
  return Math.max(0.5, (22 * weight) / Math.max(40, plot - 22));
}

function duration(ms: number, time: boolean, ctx: BuildContext): string {
  if (!time) return ctx.format(ms);
  const texts = ctx.theme.texts;
  if (ms >= DAY) {
    const d = Math.round((ms / DAY) * 10) / 10;
    return fillText(texts.days, { n: String(d).replace('.', texts.decimalSeparator) });
  }
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  if (!h) return fillText(texts.minutes, { n: min });
  return min % 60 ? fillText(texts.hoursMinutes, { h, m: String(min % 60).padStart(2, '0') }) : fillText(texts.hours, { n: h });
}

/** Ink that reads on `fill`. */
const inkOn = (fill: RGBA) => (luminance(fill) > 0.4 ? '#0b0b0b' : '#ffffff');

/** The dashed "today" line over the rows, with its flag above the first one. */
function todayLine(ctx: BuildContext, ys: RowScale, lines: number[], labels: MarkLabel[]): void {
  const { style, theme } = ctx;
  const t = specDate(style.today);
  if (!Number.isFinite(t)) return;
  const x = ctx.x.norm(t);
  if (!(x >= 0 && x <= 1)) return;
  const color = !style.todayColor || style.todayColor === 'auto' ? parseColor(theme.marks.kpi.bad) : parseColor(style.todayColor);
  const top = ys.top(0);
  const d = dashed(lines, [4, 3], ctx.pixel, color, 1.5);
  d.segment(x, ys.bottom(ys.labels.length - 1), x, top + 3 * ctx.pixel[1]);
  if (style.todayLabel) {
    labels.push({ tx: x, ty: top, text: String(style.todayLabel), color: inkOn(color), background: toCss(color), size: 10, weight: 600, align: 'center', baseline: 'bottom', dy: -7, free: true });
  }
}

function rowSeparators(ys: RowScale, color: RGBA, out: number[]): void {
  for (let i = 0; i <= ys.labels.length; i++) pushSegment(out, 0, ys.top(i), 1, ys.top(i), color, 1);
}

// --------------------------------------------------------------------- gantt

const ganttRows = (m: GanttModel, layer: LayerSpec, size: Size) =>
  new RowScale(m.rows.map((r) => r.label), undefined, flagRoom(Number.isFinite(specDate(layer.style?.today)) && layer.style?.todayLabel !== '', m.rows.length, size), 0.12);

/**
 * `gantt`: one row per task (`key`), a bar from `x` to `x2`. `progress` fills
 * part of the bar; a task with no length (or no `x2`) is a milestone, drawn as
 * a diamond; `group` opens each phase with a summary bar; `depends` lists the
 * predecessors (their `id`, or `key`), drawn as elbow arrows; `color` tints by
 * owner or status. `style.today` draws the "today" line.
 */
export const gantt: MarkDefinition = {
  standalone: true,
  sizeDependent: true,
  symbol: 'square',
  scales({ layer, table, size }): MarkScales {
    const m = ganttModel(table, layer, !!layer.style?.collapsed);
    // A milestone that closes the plan keeps room on its right for its date.
    const closing = layer.style?.labels !== false && m.time && m.tasks.some((t) => t.milestone && t.start >= m.t1 - (m.t1 - m.t0) * 0.05);
    return { x: spanScale(m.t0, m.t1, m.time, specDate(layer.style?.today), 0.025, closing ? 0.085 : 0.025), y: ganttRows(m, layer, size), axes: { x: true, y: true }, grid: { x: true } };
  },
  build(ctx) {
    const { layer, table } = ctx.data;
    const { style, theme } = ctx;
    const m = ganttModel(table, layer, !!style.collapsed);
    const ys = ctx.y instanceof RowScale && ctx.y.labels.length === m.rows.length ? ctx.y : ganttRows(m, layer, undefined);
    const [px, py] = ctx.pixel;
    const surface = ctx.surface;
    const ink = parseColor(theme.text.primary);
    const cf = layer.encode.color;
    const single = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(fieldLabel(ctx, layer.encode.key ?? layer.encode.y, 'gantt'));
    const legend = cf ? [...new Set(m.tasks.map((t) => t.color))].map((key) => ({ key, color: ctx.categorical(key) })) : [];
    const shown = (k: number) => !cf || !ctx.hidden.has(m.tasks[k].color);
    const colorOf = (k: number) => ctx.paint(cf ? ctx.categorical(m.tasks[k].color) : single, m.tasks[k].row);
    const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

    const under: number[] = [];
    const tint: number[] = [];
    const bars: number[] = [];
    const barKeys: string[] = [];
    const done: number[] = [];
    const doneKeys: string[] = [];
    const caps: number[] = [];
    const dots: number[] = [];
    const dotKeys: string[] = [];
    const over: number[] = [];
    const labels: MarkLabel[] = [];
    if (style.rowLines) rowSeparators(ys, parseColor(theme.grid.y.color), under);

    const r = Math.max(0, style.radius);
    const mSize = (i: number) => Math.max(6, Math.min(style.milestoneSize, (ys.height(i) / py) * 0.72));
    /** Tasks that something depends on: their milestone keeps its right side free for the arrow. */
    const hasSuccessor = new Set<string>();
    for (const t of m.tasks) for (const d of t.deps) hasSuccessor.add(d);
    const groupDone = mix(ink, surface, 0.3);
    const groupTrack = mix(ink, surface, 0.68);

    m.rows.forEach((row, i) => {
      const yc = ys.norm(i);
      const rowH = ys.height(i);
      const x0 = ctx.x.norm(row.start);
      const x1 = ctx.x.norm(row.end);
      if (row.kind === 'group') {
        pushRect(tint, { x0: 0, y0: ys.bottom(i), x1: 1, y1: ys.top(i), fill: withAlpha(ink, 0.045) });
        // Summary bar: thin, with a cap hanging at both ends.
        const h = Math.min(rowH * 0.3, 8 * py);
        const yTop = yc + h * 0.9;
        const known = Number.isFinite(row.progress);
        pushRect(bars, { x0, y0: yTop - h, x1, y1: yTop, fill: known ? groupTrack : groupDone, radii: [2, 2, 2, 2], axis: 1 });
        barKeys.push(`g:${row.label}`);
        if (known && row.progress > 0) {
          pushRect(done, { x0, y0: yTop - h, x1: x0 + (x1 - x0) * row.progress, y1: yTop, fill: groupDone, radii: [2, row.progress >= 1 ? 2 : 0, row.progress >= 1 ? 2 : 0, 2], axis: 1 });
          doneKeys.push(`g:${row.label}`);
        }
        const drop = Math.min(rowH * 0.34, 9 * py);
        pushSegment(caps, x0, yTop - h / 2, x0, yTop - h - drop, groupDone, 3);
        pushSegment(caps, x1, yTop - h / 2, x1, yTop - h - drop, known && row.progress < 1 ? groupTrack : groupDone, 3);
        return;
      }
      const k = row.task;
      const t = m.tasks[k];
      if (!shown(k)) return;
      const c = colorOf(k);
      if (t.milestone) {
        const s = mSize(i);
        dots.push(x0, yc, s, 2, c[0], c[1], c[2], c[3], surface[0], surface[1], surface[2], 1, 1.5);
        dotKeys.push(t.id);
        // The date beside the diamond, when the chart is wide enough to spare the room.
        if (style.labels && m.time && 1 / px >= 300) {
          const right = !hasSuccessor.has(t.id);
          if (right || t.deps.length === 0) {
            labels.push({ tx: x0, ty: yc, text: dateFmt.format(t.start), color: theme.text.secondary, size: 10, align: right ? 'left' : 'right', dx: (right ? 1 : -1) * (s / 2 + 6) });
          }
        }
        return;
      }
      const h = Math.min(rowH * style.barHeight, style.maxBarHeight * py);
      const y0 = yc - h / 2;
      const y1 = yc + h / 2;
      const known = Number.isFinite(t.progress);
      const track = known ? ([...mix(c, surface, 0.62).slice(0, 3), c[3]] as RGBA) : c;
      pushRect(bars, { x0, y0, x1, y1, fill: track, radii: [r, r, r, r], axis: 1 });
      barKeys.push(t.id);
      if (!known) return;
      const xp = x0 + (x1 - x0) * t.progress;
      if (t.progress > 0) {
        const rr = t.progress >= 1 ? r : 0;
        pushRect(done, { x0, y0, x1: xp, y1, fill: c, radii: [r, rr, rr, r], axis: 1 });
        doneKeys.push(t.id);
      }
      if (style.labels) {
        const text = `${Math.round(t.progress * 100)} %`;
        // In the part done when it fits there, otherwise in what is left.
        labels.push({
          tx: x0, ty: yc, text, on: c, size: 10, weight: 600, align: 'left', dx: 6, box: [x0, y0 - py, xp, y1 + py],
          fallback: { tx: xp, ty: yc, text, on: track, size: 10, weight: 600, align: 'left', dx: 6, box: [xp, y0 - py, x1, y1 + py] },
        });
      }
    });

    // Dependencies: their stubs are in px, so they are routed again when the zoom changes.
    const linkColor = !style.linkColor || style.linkColor === 'auto' ? parseColor(theme.text.muted) : parseColor(style.linkColor);
    const linkBatch = ctx.renderer.createBatch('line');
    const headBatch = ctx.renderer.createBatch('mesh');
    let span = 1;
    const route = (v0: number, v1: number) => {
      span = Math.max(1e-6, v1 - v0);
      const ux = px * span;
      const lines: number[] = [];
      const heads: number[] = [];
      if (style.dependencies) {
        m.tasks.forEach((t, k) => {
          const to = m.rowOf.get(t.id);
          if (to === undefined || !shown(k)) return;
          for (const id of t.deps) {
            const from = m.rowOf.get(id);
            if (from === undefined || from === to) continue;
            const p = m.tasks[m.rows[from].task];
            if (!shown(m.rows[from].task)) continue;
            const a = { x: ctx.x.norm(p.end) + (p.milestone ? (mSize(from) / 2) * ux : 0), y: ys.norm(from) };
            const b = { x: ctx.x.norm(t.start) - (t.milestone ? (mSize(to) / 2 + 1) * ux : 0), y: ys.norm(to) };
            const pts = routeDependency(a, b, 9 * ux, ys.height(from) / 2);
            const head = 6 * ux;
            // The line stops at the base of the arrow head.
            pts[pts.length - 1] = [b.x - head, b.y];
            for (let q = 1; q < pts.length; q++) pushSegment(lines, pts[q - 1][0], pts[q - 1][1], pts[q][0], pts[q][1], linkColor, style.linkWidth);
            pushVertex(heads, b.x, b.y, linkColor);
            pushVertex(heads, b.x - head - ux, b.y + 4 * py, linkColor);
            pushVertex(heads, b.x - head - ux, b.y - 4 * py, linkColor);
          }
        });
      }
      linkBatch.update(new Float32Array(lines), lines.length / LAYOUTS.line.stride);
      headBatch.update(new Float32Array(heads), heads.length / LAYOUTS.mesh.stride);
    };
    route(0, 1);
    todayLine(ctx, ys, over, labels);

    const draws: MarkDraw[] = [];
    if (tint.length) draws.push({ batch: batch(ctx, 'rect', tint), enter: 'none' });
    if (under.length) draws.push({ batch: batch(ctx, 'line', under), enter: 'none' });
    draws.push({ batch: linkBatch, enter: 'fade' });
    const barData = new Float32Array(bars);
    if (bars.length) draws.push({ batch: batch(ctx, 'rect', bars), pixelSnap: true, keys: barKeys, data: barData });
    if (done.length) draws.push({ batch: batch(ctx, 'rect', done), pixelSnap: true, keys: doneKeys, data: new Float32Array(done) });
    if (caps.length) draws.push({ batch: batch(ctx, 'line', caps), enter: 'fade' });
    if (dots.length) draws.push({ batch: batch(ctx, 'point', dots), keys: dotKeys, data: new Float32Array(dots) });
    draws.push({ batch: headBatch, enter: 'fade' });
    if (over.length) draws.push({ batch: batch(ctx, 'line', over), enter: 'fade' });

    const e = layer.encode;
    const fmtX = (v: number) => (m.time ? ctx.x.format(v) : ctx.format(v, e.x));
    return {
      draws,
      hit: emptyHit(),
      labels,
      legend,
      view(x0, x1) {
        route(Math.max(0, x0), Math.min(1, x1));
        return true;
      },
      pick(tx, ty): ShapeHit | null {
        const i = ys.rowAt(ty);
        if (i < 0) return null;
        const row = m.rows[i];
        const tol = (row.kind === 'task' && m.tasks[row.task].milestone ? mSize(i) / 2 + 3 : 4) * px * span;
        if (tx < ctx.x.norm(row.start) - tol || tx > ctx.x.norm(row.end) + tol) return null;
        if (row.kind === 'task' && !shown(row.task)) return null;
        const rows: ShapeHit['rows'] = [];
        if (row.end > row.start) {
          rows.push({ label: fieldLabel(ctx, e.x, ctx.theme.texts.start), value: fmtX(row.start) }, { label: fieldLabel(ctx, e.x2, ctx.theme.texts.end), value: fmtX(row.end) });
          rows.push({ label: ctx.theme.texts.duration, value: duration(row.end - row.start, m.time, ctx) });
        } else rows.push({ label: ctx.theme.texts.milestone, value: fmtX(row.start) });
        if (Number.isFinite(row.progress)) rows.push({ label: fieldLabel(ctx, e.progress, ctx.theme.texts.progress), value: `${Math.round(row.progress * 100)} %` });
        if (row.kind === 'task') {
          const t = m.tasks[row.task];
          if (cf && t.color) rows.push({ label: fieldLabel(ctx, cf, cf), value: t.color });
          if (t.group) rows.push({ label: fieldLabel(ctx, e.group, ctx.theme.texts.phase), value: t.group });
          const preds = t.deps.map((id) => m.tasks.find((q) => q.id === id)?.name).filter(Boolean);
          if (preds.length) rows.push({ label: ctx.theme.texts.after, value: preds.join(', ') });
        }
        return { title: row.label, rows };
      },
    };
  },
};

// ------------------------------------------------------- schedule, swimlane

const scheduleRows = (m: ScheduleModel, layer: LayerSpec, size: Size) => {
  // A resource with overlaps is taller, without doubling: its lanes are a little thinner.
  const weights = m.lanes.map((l) => 0.4 + 0.6 * l);
  const flag = Number.isFinite(specDate(layer.style?.today)) && layer.style?.todayLabel !== '';
  return new RowScale(m.resources, weights, flagRoom(flag, weights.reduce((a, v) => a + v, 0), size), 0.08);
};

function ellipsize(text: string, font: string, max: number): string {
  if (textWidth(text, font) <= max) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t.trimEnd()}…`, font) > max) t = t.slice(0, -1);
  t = t.trimEnd();
  // Two or three letters and an ellipsis say nothing: better no text.
  return t.length >= 5 ? `${t}…` : '';
}

/** `fill`: a state timeline (spans end where the next one starts, labelled by their state). */
function slotMark(name: 'schedule' | 'swimlane', fill: boolean): MarkDefinition {
  return {
    standalone: true,
    sizeDependent: true,
    symbol: 'square',
    scales({ layer, table, size }): MarkScales {
      const m = scheduleModel(table, layer, name, fill);
      return { x: spanScale(m.t0, m.t1, m.time, specDate(layer.style?.today), fill ? 0 : 0.015), y: scheduleRows(m, layer, size), axes: { x: true, y: true }, grid: { x: !fill } };
    },
    build(ctx) {
      const { layer, table } = ctx.data;
      const { style, theme } = ctx;
      const m = scheduleModel(table, layer, name, fill);
      const ys = ctx.y instanceof RowScale && ctx.y.labels.length === m.resources.length ? ctx.y : scheduleRows(m, layer, undefined);
      const [px, py] = ctx.pixel;
      const e = layer.encode;
      const cf = e.color;
      const single = layer.style?.color ? parseColor(layer.style.color) : ctx.categorical(fieldLabel(ctx, e.y ?? e.group, name));
      const legend = cf ? [...new Set(m.slots.map((s) => s.color))].map((key) => ({ key, color: ctx.categorical(key) })) : [];
      const shown = (k: number) => !cf || !ctx.hidden.has(m.slots[k].color);
      const family = theme.font.family;
      const r = Math.max(0, style.radius);

      const under: number[] = [];
      const rects: number[] = [];
      const keys: string[] = [];
      const over: number[] = [];
      const labels: MarkLabel[] = [];
      const fixed: MarkLabel[] = [];
      if (style.rowLines) rowSeparators(ys, parseColor(theme.grid.y.color), under);

      /** Geometry of every slot, in scale space. */
      const boxes = m.slots.map((s, k) => {
        const res = s.resource;
        const laneH = ys.height(res) / m.lanes[res];
        const yc = ys.top(res) - (s.lane + 0.5) * laneH;
        const h = laneH * Math.min(1, style.barHeight);
        return { k, res, x0: ctx.x.norm(s.start), x1: ctx.x.norm(s.end), y0: yc - h / 2, y1: yc + h / 2, yc, fill: ctx.paint(cf ? ctx.categorical(s.color) : single, s.row) };
      });
      for (const b of boxes) {
        if (!shown(b.k)) continue;
        pushRect(rects, { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, fill: b.fill, radii: [r, r, r, r], stackGap: style.gap, axis: 1 });
        keys.push(`${m.resources[b.res]}\u0000${m.slots[b.k].start}\u0000${m.slots[b.k].lane}`);
      }
      const sameDay = m.time && m.t1 - m.t0 <= 1.5 * DAY;
      const hour = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
      const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
      const when = (s: { start: number; end: number }) =>
        !m.time ? '' : sameDay ? `${hour.format(s.start)} – ${hour.format(s.end)}` : `${day.format(s.start)} – ${day.format(s.end)}`;

      todayLine(ctx, ys, over, fixed);
      let span = 1;
      /** Texts are cut to what is visible of each slot: done again when the zoom changes. */
      const layout = (v0: number, v1: number) => {
        span = Math.max(1e-6, v1 - v0);
        const ux = px * span;
        labels.length = 0;
        labels.push(...fixed);
        if (!style.labels) return;
        const titleFont = `600 11px ${family}`;
        // No slot tall enough for the usual titles: smaller ones rather than none at all.
        const thin = !fill && boxes.every((b) => (b.y1 - b.y0) / py < 14);
        for (const b of boxes) {
          const s = m.slots[b.k];
          if (!shown(b.k) || !s.label) continue;
          const left = Math.max(b.x0, v0);
          const room = (Math.min(b.x1, v1) - left) / ux - style.gap - 12;
          const tall = (b.y1 - b.y0) / py;
          if (room < 22 || tall < (thin ? 9 : 14)) continue;
          if (thin) {
            // Every slot thin (a phone): a smaller title, only where the slot shows enough of it to be read.
            if (fill) continue;
            const small = ellipsize(s.label, `600 9px ${family}`, room);
            if (small.replace('…', '').length < Math.min(s.label.length, 6)) continue;
            labels.push({ tx: left, ty: b.yc, text: small, on: b.fill, size: 9, weight: 600, align: 'left', dx: 5 });
            continue;
          }
          // A state is named in full or not at all (the legend names it anyway); a booking's title is cut.
          const text = fill ? (textWidth(s.label, titleFont) <= room ? s.label : '') : ellipsize(s.label, titleFont, room);
          if (!text) continue;
          const range = !fill && tall >= 32 ? when(s) : '';
          const sub = range && textWidth(range, `10px ${family}`) <= room ? range : '';
          labels.push({ tx: left, ty: b.yc, text, on: b.fill, size: 11, weight: 600, align: 'left', dx: 6, dy: sub ? -6 : 0 });
          if (sub) labels.push({ tx: left, ty: b.yc, text: sub, on: b.fill, size: 10, weight: 400, align: 'left', dx: 6, dy: 8 });
        }
      };
      layout(0, 1);

      const draws: MarkDraw[] = [];
      if (under.length) draws.push({ batch: batch(ctx, 'line', under), enter: 'none' });
      if (rects.length) draws.push({ batch: batch(ctx, 'rect', rects), pixelSnap: true, keys, data: new Float32Array(rects) });
      if (over.length) draws.push({ batch: batch(ctx, 'line', over), enter: 'fade' });
      const fmtX = (v: number) => (m.time ? ctx.x.format(v) : ctx.format(v, e.x));
      return {
        draws,
        hit: emptyHit(),
        labels,
        legend,
        view(x0, x1) {
          layout(Math.max(0, x0), Math.min(1, x1));
          return true;
        },
        pick(tx, ty): ShapeHit | null {
          const b = boxes.find((q) => shown(q.k) && tx >= q.x0 && tx <= q.x1 && ty >= q.y0 && ty <= q.y1);
          if (!b) return null;
          const s = m.slots[b.k];
          const rows: ShapeHit['rows'] = [];
          if (s.label) rows.push({ label: fieldLabel(ctx, e.y ?? e.group, ctx.theme.texts.resource), value: m.resources[b.res] });
          if (cf && s.color && s.color !== s.label) rows.push({ label: fieldLabel(ctx, cf, cf), value: s.color });
          rows.push(
            { label: fieldLabel(ctx, e.x, ctx.theme.texts.start), value: fmtX(s.start) },
            { label: fieldLabel(ctx, e.x2, ctx.theme.texts.end), value: fmtX(s.end) },
            { label: ctx.theme.texts.duration, value: duration(s.end - s.start, m.time, ctx) },
          );
          return { title: s.label || m.resources[b.res], rows };
        },
      };
    },
  };
}

/**
 * `schedule`: one row per resource (`y`: room, person, machine), a slot from
 * `x` to `x2` named by `key`, colored by `color`. Slots of a resource that
 * overlap go on sub-lanes of its row.
 */
export const schedule = slotMark('schedule', false);

/**
 * `swimlane`: the states (`color`) of each entity (`y`) through time, as spans
 * from `x` to `x2`, or to the next change of the same entity without `x2`.
 */
export const swimlane = slotMark('swimlane', true);

/** Marks of this family, registered by `ensureBuiltinMarks` (see builtin.ts). */
export const GANTT_MARKS: Record<string, MarkDefinition> = { gantt, schedule, swimlane };
