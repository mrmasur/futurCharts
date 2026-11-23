import { describe, expect, it } from 'vitest';
import { Table } from '../src/data/table';
import { ganttModel, packLanes, parseDepends, routeDependency, RowScale, scheduleModel } from '../src/marks/ganttLayout';

describe('RowScale', () => {
  it('stacks rows from the top, by weight', () => {
    const s = new RowScale(['a', 'b', 'c'], [1, 2, 1]);
    expect(s.top(0)).toBe(1);
    expect(s.bottom(2)).toBeCloseTo(0);
    expect(s.height(1)).toBeCloseTo(0.5);
    expect(s.norm(1)).toBeCloseTo(0.5);
    expect(s.norm(0)).toBeGreaterThan(s.norm(2));
  });
  it('finds the row at a position and labels each row at its center', () => {
    const s = new RowScale(['a', 'b'], undefined, 1, 0);
    // One weight of room above: rows share the two lower thirds.
    expect(s.top(0)).toBeCloseTo(2 / 3);
    expect(s.rowAt(0.9)).toBe(-1);
    expect(s.rowAt(0.5)).toBe(0);
    expect(s.rowAt(0.1)).toBe(1);
    expect(s.ticks(0, 1).map((t) => t.label)).toEqual(['a', 'b']);
    expect(s.ticks(0, 1)[0].t).toBeCloseTo(0.5);
  });
});

describe('packLanes', () => {
  it('keeps slots that do not overlap on one lane', () => {
    const p = packLanes([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 5, end: 6 }]);
    expect(p.lanes).toBe(1);
    expect(p.lane).toEqual([0, 0, 0]);
  });
  it('moves an overlapping slot to the first free lane', () => {
    const p = packLanes([{ start: 0, end: 4 }, { start: 1, end: 2 }, { start: 3, end: 5 }, { start: 3.5, end: 6 }]);
    expect(p.lane).toEqual([0, 1, 1, 2]);
    expect(p.lanes).toBe(3);
  });
  it('does not depend on the input order', () => {
    const p = packLanes([{ start: 3, end: 5 }, { start: 0, end: 4 }]);
    expect(p.lane).toEqual([1, 0]);
  });
});

describe('routeDependency', () => {
  it('goes out, down and in when there is room', () => {
    const r = routeDependency({ x: 10, y: 5 }, { x: 30, y: 2 }, 4, 0.5);
    expect(r).toEqual([[10, 5], [14, 5], [14, 2], [30, 2]]);
  });
  it('comes back along the row edge when the successor starts too early', () => {
    const r = routeDependency({ x: 10, y: 5 }, { x: 8, y: 2 }, 4, 0.5);
    expect(r).toEqual([[10, 5], [14, 5], [14, 4.5], [4, 4.5], [4, 2], [8, 2]]);
    // Every run is horizontal or vertical, and the last one enters the task from the left.
    for (let i = 1; i < r.length; i++) expect(r[i][0] === r[i - 1][0] || r[i][1] === r[i - 1][1]).toBe(true);
    expect(r[r.length - 1][0]).toBeGreaterThan(r[r.length - 2][0]);
  });
  it('routes upwards too', () => {
    const r = routeDependency({ x: 10, y: 2 }, { x: 11, y: 5 }, 4, 0.5);
    expect(r[2]).toEqual([14, 2.5]);
  });
});

describe('ganttModel', () => {
  const rows = [
    { id: 'a', name: 'A', phase: 'P1', start: '2026-03-02', end: '2026-03-06', done: 1, after: '' },
    { id: 'b', name: 'B', phase: 'P1', start: '2026-03-06', end: '2026-03-18', done: 50, after: 'a' },
    { id: 'm', name: 'M', phase: 'P2', start: '2026-03-20', end: '2026-03-20', done: 0, after: 'a; b' },
  ];
  const layer = { mark: 'gantt', encode: { key: 'name', id: 'id', x: 'start', x2: 'end', progress: 'done', group: 'phase', depends: 'after' } };
  it('opens each group with a summary row and reads milestones, percentages and predecessors', () => {
    const m = ganttModel(Table.from(rows), layer);
    expect(m.rows.map((r) => `${r.kind}:${r.label}`)).toEqual(['group:P1', 'task:A', 'task:B', 'group:P2', 'task:M']);
    expect(m.time).toBe(true);
    expect(m.tasks[1].progress).toBe(0.5);
    expect(m.tasks[2].milestone).toBe(true);
    expect(m.tasks[2].deps).toEqual(['a', 'b']);
    expect(m.rowOf.get('b')).toBe(2);
    // A: 4 days done, B: half of 12 days → 10 of 16.
    expect(m.rows[0].progress).toBeCloseTo(10 / 16);
    expect(m.rows[0].start).toBe(Date.parse('2026-03-02'));
    expect(m.rows[0].end).toBe(Date.parse('2026-03-18'));
  });
  it('keeps the summaries only when collapsed', () => {
    const m = ganttModel(Table.from(rows), layer, true);
    expect(m.rows.map((r) => r.label)).toEqual(['P1', 'P2']);
    expect(m.rowOf.size).toBe(0);
  });
  it('parses lists of predecessors', () => {
    expect(parseDepends(' a, b ;c|')).toEqual(['a', 'b', 'c']);
    expect(parseDepends('')).toEqual([]);
  });
});

describe('scheduleModel', () => {
  it('puts overlapping slots of a resource on sub-lanes', () => {
    const t = Table.from([
      { room: 'A', x: 0, x2: 4 },
      { room: 'B', x: 0, x2: 2 },
      { room: 'A', x: 2, x2: 6 },
      { room: 'A', x: 4, x2: 5 },
    ]);
    const m = scheduleModel(t, { mark: 'schedule', encode: { y: 'room', x: 'x', x2: 'x2' } }, 'schedule');
    expect(m.resources).toEqual(['A', 'B']);
    expect(m.lanes).toEqual([2, 1]);
    expect(m.slots.map((s) => s.lane)).toEqual([0, 0, 1, 0]);
  });
  it('ends a state where the next one of the same row starts', () => {
    const t = Table.from([
      { m: 'M1', x: 0, s: 'on' },
      { m: 'M2', x: 0, s: 'off' },
      { m: 'M1', x: 5, s: 'off' },
      { m: 'M2', x: 8, s: 'on' },
    ]);
    const m = scheduleModel(t, { mark: 'swimlane', encode: { y: 'm', x: 'x', color: 's' } }, 'swimlane', true);
    expect(m.slots.map((s) => [s.start, s.end])).toEqual([[0, 5], [0, 8], [5, 8], [8, 8]]);
    expect(m.slots[0].label).toBe('on');
    expect(m.lanes).toEqual([1, 1]);
  });
});
