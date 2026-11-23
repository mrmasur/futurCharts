/**
 * Layout of the planning marks (`gantt`, `schedule`, `swimlane`), without any
 * rendering: rows, sub-lanes of overlapping slots, routes of dependency arrows.
 */
import type { Table } from '../data/table';
import type { Scale, Tick } from '../scale/scales';
import type { LayerSpec } from '../spec/types';

/**
 * Rows stacked from the top, each with its own weight (a resource with two
 * overlapping bookings is twice as tall). Behaves as a band scale for the y
 * axis: one label per row, at its center.
 */
export class RowScale implements Scale {
  readonly type = 'band';
  readonly band: number;
  /** Top edge of each row, then the bottom of the last one (normalized, 1 = top). */
  private edges: number[];
  /** `padTop`: room kept above the first row, in row weights (the "today" flag). */
  constructor(readonly labels: string[], weights?: number[], padTop = 0, padBottom = 0) {
    const w = labels.map((_, i) => Math.max(1e-6, weights?.[i] ?? 1));
    const total = w.reduce((a, v) => a + v, 0) + padTop + padBottom || 1;
    let acc = padTop;
    this.edges = [1 - acc / total];
    for (const v of w) {
      acc += v;
      this.edges.push(1 - acc / total);
    }
    this.band = labels.length ? (this.edges[0] - this.edges[labels.length]) / labels.length : 1;
  }
  top(i: number): number {
    return this.edges[Math.max(0, Math.min(this.labels.length, i))];
  }
  bottom(i: number): number {
    return this.top(i + 1);
  }
  height(i: number): number {
    return this.top(i) - this.bottom(i);
  }
  norm(i: number): number {
    return (this.top(i) + this.bottom(i)) / 2;
  }
  /** The row at `t`, or -1 above the first / below the last one. */
  rowAt(t: number): number {
    if (t > this.edges[0] || t < this.edges[this.labels.length]) return -1;
    for (let i = 0; i < this.labels.length; i++) if (t >= this.edges[i + 1]) return i;
    return -1;
  }
  invert(t: number): number {
    const i = this.rowAt(t);
    return i >= 0 ? i : t > this.edges[0] ? 0 : Math.max(0, this.labels.length - 1);
  }
  ticks(t0: number, t1: number): Tick[] {
    const out: Tick[] = [];
    this.labels.forEach((label, i) => {
      const t = this.norm(i);
      if (t >= t0 - 1e-9 && t <= t1 + 1e-9) out.push({ t, label });
    });
    return out;
  }
  format(i: number): string {
    return this.labels[i] ?? '';
  }
}

/**
 * Sub-lanes for intervals that may overlap: each interval takes the first lane
 * free at its start (an interval ending exactly when another starts shares its lane).
 */
export function packLanes(items: { start: number; end: number }[]): { lane: number[]; lanes: number } {
  const order = items.map((_, i) => i).sort((a, b) => items[a].start - items[b].start || items[b].end - items[a].end || a - b);
  const free: number[] = []; // end of the last interval of each lane
  const lane = new Array<number>(items.length).fill(0);
  for (const i of order) {
    let l = free.findIndex((end) => end <= items[i].start);
    if (l < 0) l = free.length;
    free[l] = Math.max(items[i].end, items[i].start);
    lane[i] = l;
  }
  return { lane, lanes: Math.max(1, free.length) };
}

/** `"a, b;c"` → `['a', 'b', 'c']`. */
export function parseDepends(text: unknown): string[] {
  if (text === null || text === undefined) return [];
  return String(text)
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Elbow route of a dependency, from the end of a task (`from`) to the start of
 * the next (`to`), in any unit where x grows with time. `stub`: the horizontal
 * run kept at both ends (the arrow head needs it); `rowEdge`: distance from
 * `from.y` to the edge of its row, where a route that must come back runs.
 *
 * - room between the two (`to.x - from.x >= 2 * stub`): out, down, in — 4 points;
 * - otherwise (the successor starts before the predecessor ends): out, down to the
 *   row edge, back before the successor's start, down, in — 6 points.
 */
export function routeDependency(from: { x: number; y: number }, to: { x: number; y: number }, stub: number, rowEdge: number): [number, number][] {
  if (from.y === to.y) return [[from.x, from.y], [to.x, to.y]];
  if (to.x - from.x >= 2 * stub) {
    return [[from.x, from.y], [from.x + stub, from.y], [from.x + stub, to.y], [to.x, to.y]];
  }
  const mid = from.y + Math.sign(to.y - from.y) * rowEdge;
  return [[from.x, from.y], [from.x + stub, from.y], [from.x + stub, mid], [to.x - stub, mid], [to.x - stub, to.y], [to.x, to.y]];
}

/** A column as numbers; ISO date strings are parsed. */
export function timeValues(table: Table, field: string): { values: Float64Array; time: boolean } {
  const c = table.column(field);
  if (c.type !== 'string') return { values: c.values as Float64Array, time: c.type === 'time' };
  const out = new Float64Array(table.length);
  for (let i = 0; i < table.length; i++) out[i] = c.values[i] === '' ? NaN : Date.parse(c.values[i] as string);
  return { values: out, time: true };
}

/** A date from the spec (`style.today`): ISO string or epoch ms. NaN when unset. */
export function specDate(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '') return Date.parse(v);
  return NaN;
}

export interface GanttTask {
  /** Source row. */
  row: number;
  id: string;
  name: string;
  start: number;
  end: number;
  /** 0..1, NaN when unknown. */
  progress: number;
  group: string;
  /** Value of the color field ('' without one). */
  color: string;
  deps: string[];
  milestone: boolean;
}

export interface GanttRow {
  kind: 'task' | 'group';
  label: string;
  /** Index into `tasks` (task rows). */
  task: number;
  start: number;
  end: number;
  progress: number;
}

export interface GanttModel {
  tasks: GanttTask[];
  rows: GanttRow[];
  /** Task id → row index (tasks hidden by `collapsed` are absent). */
  rowOf: Map<string, number>;
  t0: number;
  t1: number;
  /** x is a date. */
  time: boolean;
  hasProgress: boolean;
}

/**
 * Rows of a Gantt chart: tasks in data order; with a group field, each group
 * (first-seen order) opens with a summary row spanning its tasks, its progress
 * the duration-weighted mean of theirs. `collapsed` keeps the summaries only.
 */
export function ganttModel(table: Table, layer: LayerSpec, collapsed = false): GanttModel {
  const e = layer.encode;
  const kf = e.key ?? e.y;
  const xf = e.x;
  if (!kf || !xf) throw new Error('futurCharts: mark "gantt" needs encode.key (task) and encode.x (start).');
  const names = table.column(kf).values;
  const ids = e.id ? table.column(e.id).values : names;
  const xs = timeValues(table, xf);
  const x2 = e.x2 ? timeValues(table, e.x2).values : undefined;
  const prog = e.progress ? (table.column(e.progress).values as Float64Array) : undefined;
  const grp = e.group ? table.column(e.group).values : undefined;
  const col = e.color ? table.column(e.color).values : undefined;
  const dep = e.depends ? table.column(e.depends).values : undefined;
  const tasks: GanttTask[] = [];
  let t0 = Infinity;
  let t1 = -Infinity;
  for (let i = 0; i < table.length; i++) {
    const start = xs.values[i];
    if (!Number.isFinite(start)) continue;
    const rawEnd = x2 ? x2[i] : NaN;
    const end = Number.isFinite(rawEnd) ? Math.max(start, rawEnd) : start;
    const p = prog ? Number(prog[i]) : NaN;
    tasks.push({
      row: i,
      id: String(ids[i]),
      name: String(names[i]),
      start,
      end,
      // A share (0..1); a value above 1 is read as a percentage.
      progress: Number.isFinite(p) ? Math.max(0, Math.min(1, p > 1 ? p / 100 : p)) : NaN,
      group: grp ? String(grp[i]) : '',
      color: col ? String(col[i]) : '',
      deps: dep ? parseDepends(dep[i]) : [],
      milestone: end === start,
    });
    t0 = Math.min(t0, start);
    t1 = Math.max(t1, end);
  }
  if (t0 > t1) [t0, t1] = [0, 1];
  const rows: GanttRow[] = [];
  const rowOf = new Map<string, number>();
  const pushTask = (k: number) => {
    const t = tasks[k];
    rowOf.set(t.id, rows.length);
    rows.push({ kind: 'task', label: t.name, task: k, start: t.start, end: t.end, progress: t.progress });
  };
  if (!grp) tasks.forEach((_, k) => pushTask(k));
  else {
    const groups = new Map<string, number[]>();
    tasks.forEach((t, k) => {
      const g = groups.get(t.group);
      if (g) g.push(k);
      else groups.set(t.group, [k]);
    });
    for (const [name, members] of groups) {
      let s = Infinity;
      let en = -Infinity;
      let done = 0;
      let span = 0;
      let known = false;
      for (const k of members) {
        const t = tasks[k];
        s = Math.min(s, t.start);
        en = Math.max(en, t.end);
        if (Number.isFinite(t.progress)) {
          known = true;
          done += t.progress * (t.end - t.start);
          span += t.end - t.start;
        }
      }
      rows.push({ kind: 'group', label: name, task: -1, start: s, end: en, progress: known && span > 0 ? done / span : NaN });
      if (!collapsed) members.forEach(pushTask);
    }
  }
  return { tasks, rows, rowOf, t0, t1, time: xs.time, hasProgress: !!prog };
}

export interface Slot {
  /** Source row. */
  row: number;
  /** Index into `resources`. */
  resource: number;
  start: number;
  end: number;
  /** Text shown in the slot. */
  label: string;
  /** Value of the color field ('' without one). */
  color: string;
  /** Sub-lane inside its resource row. */
  lane: number;
}

export interface ScheduleModel {
  /** Row labels (resources), first-seen order. */
  resources: string[];
  /** Sub-lanes per resource (1 without overlap). */
  lanes: number[];
  slots: Slot[];
  /** Slots of each resource (indices into `slots`). */
  byResource: number[][];
  t0: number;
  t1: number;
  time: boolean;
}

/**
 * Slots per resource (`encode.y`, or `group`), overlapping ones on sub-lanes.
 * `fill` (state timelines): without an end, a slot lasts until the next one of
 * its resource (the last one until the end of the data), and nothing overlaps.
 */
export function scheduleModel(table: Table, layer: LayerSpec, mark: string, fill = false): ScheduleModel {
  const e = layer.encode;
  const rf = e.y ?? e.group;
  const xf = e.x;
  if (!rf || !xf) throw new Error(`futurCharts: mark "${mark}" needs encode.y (the row) and encode.x (start).`);
  const res = table.column(rf).values;
  const xs = timeValues(table, xf);
  const x2 = e.x2 ? timeValues(table, e.x2).values : undefined;
  const col = e.color ? table.column(e.color).values : undefined;
  const lab = e.key ? table.column(e.key).values : fill ? col : undefined;
  const resources: string[] = [];
  const index = new Map<string, number>();
  const slots: Slot[] = [];
  const byResource: number[][] = [];
  let t0 = Infinity;
  let t1 = -Infinity;
  for (let i = 0; i < table.length; i++) {
    const start = xs.values[i];
    if (!Number.isFinite(start)) continue;
    const name = String(res[i]);
    let r = index.get(name);
    if (r === undefined) {
      r = resources.length;
      index.set(name, r);
      resources.push(name);
      byResource.push([]);
    }
    const end = x2 && Number.isFinite(x2[i]) ? Math.max(start, x2[i]) : NaN;
    byResource[r].push(slots.length);
    slots.push({ row: i, resource: r, start, end, label: lab ? String(lab[i]) : '', color: col ? String(col[i]) : '', lane: 0 });
    t0 = Math.min(t0, start);
    if (Number.isFinite(end)) t1 = Math.max(t1, end);
    else t1 = Math.max(t1, start);
  }
  if (t0 > t1) [t0, t1] = [0, 1];
  // Open-ended slots run to the next start of the same resource.
  for (const list of byResource) {
    const sorted = [...list].sort((a, b) => slots[a].start - slots[b].start);
    sorted.forEach((k, j) => {
      if (Number.isFinite(slots[k].end)) return;
      slots[k].end = j + 1 < sorted.length ? slots[sorted[j + 1]].start : t1;
    });
  }
  const lanes = byResource.map((list) => {
    if (fill) return 1;
    const packed = packLanes(list.map((k) => slots[k]));
    list.forEach((k, j) => (slots[k].lane = packed.lane[j]));
    return packed.lanes;
  });
  return { resources, lanes, slots, byResource, t0, t1, time: xs.time };
}
