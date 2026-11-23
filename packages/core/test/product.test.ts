import { describe, expect, it } from 'vitest';
import { buildTree } from '../src/marks/hierarchyLayout';
import { cohortTable, decompositionColumns, funnelComparison } from '../src/marks/productLayout';

describe('cohort table', () => {
  // Three cohorts; the last ones have fewer periods behind them.
  const rows: [string, number, number][] = [
    ['janv.', 0, 200], ['janv.', 1, 100], ['janv.', 2, 50],
    ['févr.', 0, 100], ['févr.', 1, 80],
    ['mars', 0, 300],
  ];
  const t = cohortTable(rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), false);

  it('takes rates against the first period of each cohort', () => {
    expect(t.cohorts).toEqual(['janv.', 'févr.', 'mars']);
    expect(t.periods).toEqual([0, 1, 2]);
    expect(t.size).toEqual([200, 100, 300]);
    expect(t.rate[0]).toEqual([1, 0.5, 0.25]);
    expect(t.rate[1][1]).toBeCloseTo(0.8);
  });

  it('leaves the periods that have not come yet empty', () => {
    expect(t.rate[1][2]).toBeNaN();
    expect(t.rate[2][1]).toBeNaN();
    expect(t.row[2]).toEqual([5, -1, -1]);
  });

  it('weights the average by cohort size, over the cohorts that reached the period', () => {
    expect(t.average[0]).toBe(1);
    expect(t.average[1]).toBeCloseTo(180 / 300);
    expect(t.average[2]).toBeCloseTo(0.25);
  });

  it('reads rates as they are, out of 1 or out of 100', () => {
    const r = cohortTable(['a', 'a', 'b'], [0, 1, 0], [100, 40, 100], true);
    expect(r.rate[0]).toEqual([1, 0.4]);
    expect(r.size[0]).toBeNaN();
    expect(r.average[0]).toBe(1);
    expect(cohortTable(['a', 'a'], [0, 1], [1, 0.4], true).rate[0]).toEqual([1, 0.4]);
  });

  it('orders the periods whatever the order of the lines', () => {
    const r = cohortTable(['a', 'a', 'a'], [2, 0, 1], [10, 40, 20], false);
    expect(r.periods).toEqual([0, 1, 2]);
    expect(r.rate[0]).toEqual([1, 0.5, 0.25]);
  });
});

describe('decomposition tree', () => {
  const rows: [string, string, number][] = [
    ['Nord', 'A', 10], ['Nord', 'B', 30], ['Sud', 'A', 50], ['Sud', 'B', 5], ['Sud', 'C', 20], ['Est', 'A', 8], ['Ouest', 'A', 2],
  ];
  const root = buildTree([rows.map((r) => r[0]), rows.map((r) => r[1])], rows.map((r) => r[2]));

  it('expands the largest node of each level by default, children sorted by value', () => {
    const cols = decompositionColumns(root, [], 10);
    expect(cols).toHaveLength(2);
    expect(cols[0].nodes.map((n) => n.name)).toEqual(['Sud', 'Nord', 'Est', 'Ouest']);
    expect(cols[0].open).toBe(0);
    expect(cols[1].parent.name).toBe('Sud');
    expect(cols[1].nodes.map((n) => n.name)).toEqual(['A', 'C', 'B']);
    // A column of leaves expands nothing.
    expect(cols[1].open).toBe(-1);
  });

  it('expands the node asked for, and falls back on the largest for an unknown name', () => {
    const cols = decompositionColumns(root, ['Nord'], 10);
    expect(cols[0].open).toBe(1);
    expect(cols[1].nodes.map((n) => n.name)).toEqual(['B', 'A']);
    expect(decompositionColumns(root, ['Lune'], 10)[1].parent.name).toBe('Sud');
  });

  it('cuts a long column, counts what is left out and keeps the expanded node in sight', () => {
    const cols = decompositionColumns(root, [], 3);
    expect(cols[0].nodes.map((n) => n.name)).toEqual(['Sud', 'Nord']);
    expect(cols[0].more).toBe(2);
    const far = decompositionColumns(root, ['Ouest'], 3);
    expect(far[0].nodes.map((n) => n.name)).toEqual(['Sud', 'Ouest']);
    expect(far[0].open).toBe(1);
    expect(far[1].parent.name).toBe('Ouest');
  });
});

describe('compared funnel', () => {
  const stages = ['Visite', 'Inscription', 'Achat'];
  const data = [
    ...stages.map((s, i) => ({ s, g: 'Web', v: [1000, 400, 100][i] })),
    ...stages.map((s, i) => ({ s, g: 'Mobile', v: [500, 100, 80][i] })),
  ];
  const f = funnelComparison(data.map((d) => d.s), data.map((d) => d.g), data.map((d) => d.v));

  it('keeps steps and segments in the order of the data', () => {
    expect(f.stages).toEqual(stages);
    expect(f.segments).toEqual(['Web', 'Mobile']);
    expect(f.value).toEqual([[1000, 400, 100], [500, 100, 80]]);
  });

  it('computes the pass rate of each step and the overall conversion', () => {
    expect(f.pass[0][0]).toBeNaN();
    expect(f.pass[0].slice(1)).toEqual([0.4, 0.25]);
    expect(f.pass[1].slice(1)).toEqual([0.2, 0.8]);
    expect(f.overall).toEqual([0.1, 0.16]);
  });

  it('points at the heaviest loss of each segment', () => {
    expect(f.worst).toEqual([2, 1]);
  });

  it('sums duplicate lines and works without a segment', () => {
    const one = funnelComparison(['a', 'a', 'b'], undefined, [30, 70, 25], 'Personnes');
    expect(one.segments).toEqual(['Personnes']);
    expect(one.value).toEqual([[100, 25]]);
    expect(one.pass[0][1]).toBe(0.25);
    expect(one.worst).toEqual([1]);
  });
});
