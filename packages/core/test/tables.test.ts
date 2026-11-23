import { describe, expect, it } from 'vitest';
import { confusionStats, ellipsis, headerTexts, monthGrid, orderEntities, tableColumns, tableRows } from '../src/marks/tablesLayout';

/** 7 px a character, like the fallback of `textWidth` outside a browser. */
const measure = (t: string) => t.length * 7;

describe('table columns', () => {
  const needs = [
    { min: 120, priority: 0 },
    { min: 90, priority: 1, cap: 200 },
    { min: 70, priority: 2 },
    { min: 80, priority: 3 },
  ];

  it('fills the width exactly, columns side by side in order', () => {
    const cols = tableColumns(600, needs);
    expect(cols.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    expect(cols[0].x0).toBe(0);
    expect(cols[3].x1).toBeCloseTo(600);
    for (let i = 1; i < cols.length; i++) expect(cols[i].x0).toBeCloseTo(cols[i - 1].x1);
    cols.forEach((c) => expect(c.x1 - c.x0).toBeGreaterThanOrEqual(needs[c.index].min - 1e-9));
  });

  it('lets the stretchable column grow first, up to its cap', () => {
    // 360 needed, 40 to spare: all of it goes to the bar column.
    const cols = tableColumns(400, needs);
    expect(cols[1].x1 - cols[1].x0).toBeCloseTo(130);
    expect(cols[0].x1 - cols[0].x0).toBeCloseTo(120);
    // Plenty of room: the bar stops at its cap and the rest is shared in proportion.
    const wide = tableColumns(1000, needs);
    const w = wide.map((c) => c.x1 - c.x0);
    expect(w[1] / w[0]).toBeCloseTo(200 / 120);
    expect(w[2] / w[0]).toBeCloseTo(70 / 120);
  });

  it('gives up the least important columns when too narrow', () => {
    expect(tableColumns(300, needs).map((c) => c.index)).toEqual([0, 1, 2]);
    expect(tableColumns(250, needs).map((c) => c.index)).toEqual([0, 1]);
    expect(tableColumns(150, needs).map((c) => c.index)).toEqual([0]);
  });

  it('follows the priority of the spec rather than the position', () => {
    const cols = tableColumns(300, [
      { min: 120, priority: 0 },
      { min: 90, priority: 5 },
      { min: 70, priority: 1 },
      { min: 80, priority: 2 },
    ]);
    expect(cols.map((c) => c.index)).toEqual([0, 2, 3]);
    // Equal priorities: the rightmost goes first.
    expect(tableColumns(200, [{ min: 90, priority: 1 }, { min: 90, priority: 1 }, { min: 90, priority: 1 }]).map((c) => c.index)).toEqual([0, 1]);
  });

  it('keeps one column, cut to the width, and never widens a fixed one', () => {
    const one = tableColumns(80, needs);
    expect(one).toEqual([{ index: 0, x0: 0, x1: 80 }]);
    const fixed = tableColumns(500, [{ min: 100, priority: 0 }, { min: 60, priority: 1, fixed: true }]);
    expect(fixed[1].x1 - fixed[1].x0).toBeCloseTo(60);
    expect(fixed[1].x1).toBeCloseTo(500);
  });
});

describe('table rows', () => {
  it('shows every row when they fit, no taller than asked', () => {
    expect(tableRows(400, 8, { header: 28, rowHeight: 34 })).toEqual({ shown: 8, rowH: 34, more: 0 });
    // 10 rows in 268 px: they shrink to fit.
    const tight = tableRows(296, 10, { header: 28, rowHeight: 34 });
    expect(tight.shown).toBe(10);
    expect(tight.rowH).toBeCloseTo(26.8);
    expect(tight.more).toBe(0);
  });

  it('cuts the rows that do not fit and counts them', () => {
    // 190 px: 162 under the header, 144 above the mention, 6 rows of 22 px.
    const cut = tableRows(190, 14, { header: 28, rowHeight: 34 });
    expect(cut.shown).toBe(6);
    expect(cut.more).toBe(8);
    expect(cut.rowH).toBeCloseTo(24);
    expect(28 + cut.shown * cut.rowH + 18).toBeLessThanOrEqual(190);
  });

  it('keeps room for the total row', () => {
    const all = tableRows(400, 10, { header: 28, rowHeight: 34, total: true });
    expect(all.shown).toBe(10);
    expect(28 + 11 * all.rowH).toBeLessThanOrEqual(400 + 1e-9);
    const cut = tableRows(190, 14, { header: 28, rowHeight: 34, total: true });
    expect(cut.shown).toBe(5);
    expect(cut.more).toBe(9);
    expect(28 + (cut.shown + 1) * cut.rowH + 18).toBeLessThanOrEqual(190 + 1e-9);
  });

  it('always shows a row, and never all of them next to a mention', () => {
    expect(tableRows(40, 5, { header: 28, rowHeight: 34 }).shown).toBe(1);
    expect(tableRows(40, 0, { header: 28, rowHeight: 34 })).toEqual({ shown: 0, rowH: 34, more: 0 });
    // Two rows would fit at 22 px but not with the mention: one is shown, one is counted.
    expect(tableRows(28 + 43, 2, { header: 28, rowHeight: 34 })).toMatchObject({ shown: 1, more: 1 });
  });
});

describe('text fitting', () => {
  it('cuts with an ellipsis only when needed', () => {
    expect(ellipsis('Bretagne', 100, measure)).toBe('Bretagne');
    const cut = ellipsis('Provence-Alpes-Côte d’Azur', 100, measure);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(100);
    expect(measure(cut)).toBeGreaterThan(100 - 14);
    expect(ellipsis('Bretagne', 5, measure)).toBe('');
  });

  it('names, abbreviates or numbers the columns of a matrix', () => {
    const names = ['Web', 'Mobile', 'Design', 'Données'];
    expect(headerTexts(names, 60, measure)).toEqual({ mode: 'name', texts: names, every: 1 });
    expect(headerTexts(names, 24, measure)).toEqual({ mode: 'short', texts: ['Web', 'Mob', 'Des', 'Don'], every: 1 });
    // Abbreviations that collide are no key: numbers.
    expect(headerTexts(['Marketing', 'Marchés', 'Vente'], 24, measure)).toEqual({ mode: 'index', texts: ['1', '2', '3'], every: 1 });
    const many = headerTexts(Array.from({ length: 12 }, (_, i) => `Équipe ${i}`), 6, measure);
    expect(many.mode).toBe('index');
    expect(many.every).toBe(3);
  });
});

describe('matrix order', () => {
  const names = ['a', 'b', 'c', 'd', 'e'];
  const groups = ['X', 'Y', 'X', 'Y', 'X'];
  const totals = [5, 9, 7, 2, 7];

  it('keeps groups together, in first-seen order', () => {
    expect(orderEntities(names, groups, totals, 'data')).toEqual([0, 2, 4, 1, 3]);
  });

  it('sorts inside a group by total or by name', () => {
    // Equal totals keep the order of the data.
    expect(orderEntities(names, groups, totals, 'total')).toEqual([2, 4, 0, 1, 3]);
    expect(orderEntities(['b', 'a', 'c'], ['', '', ''], [1, 2, 3], 'name')).toEqual([1, 0, 2]);
  });
});

describe('confusion matrix', () => {
  it('computes precision, recall and accuracy', () => {
    // actual rows, predicted columns.
    const s = confusionStats([
      [40, 10],
      [5, 45],
    ]);
    expect(s.total).toBe(100);
    expect(s.rows).toEqual([50, 50]);
    expect(s.columns).toEqual([45, 55]);
    expect(s.recall[0]).toBeCloseTo(0.8);
    expect(s.recall[1]).toBeCloseTo(0.9);
    expect(s.precision[0]).toBeCloseTo(40 / 45);
    expect(s.precision[1]).toBeCloseTo(45 / 55);
    expect(s.accuracy).toBeCloseTo(0.85);
  });

  it('has no score for a class without a case', () => {
    const s = confusionStats([
      [3, 0],
      [0, 0],
    ]);
    expect(s.recall[1]).toBeNaN();
    expect(s.precision[1]).toBeNaN();
    expect(s.accuracy).toBe(1);
    expect(confusionStats([]).accuracy).toBeNaN();
  });
});

describe('month grid', () => {
  it('places the days of a month on weeks starting on Monday', () => {
    // October 2026 starts on a Thursday and has 31 days: five weeks.
    const g = monthGrid(2026, 9, 1);
    expect(g.weeks).toBe(5);
    expect(g.cells).toHaveLength(31);
    expect(g.cells[0]).toEqual({ day: 1, column: 3, week: 0 });
    expect(g.cells[30]).toEqual({ day: 31, column: 5, week: 4 });
  });

  it('follows the first day of the week, up to six weeks', () => {
    expect(monthGrid(2026, 9, 0).cells[0]).toEqual({ day: 1, column: 4, week: 0 });
    // August 2026 starts on a Saturday: six weeks from Monday.
    expect(monthGrid(2026, 7, 1).weeks).toBe(6);
    // February 2027 starts on a Monday and has 28 days: four weeks.
    expect(monthGrid(2027, 1, 1).weeks).toBe(4);
  });
});
