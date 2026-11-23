/**
 * Layouts and rates of the product-analysis marks (`product.ts`), free of any rendering:
 * cohort retention table, decomposition tree columns, compared funnel.
 */
import type { HNode } from './hierarchyLayout';

// ------------------------------------------------------------------- cohort

export interface CohortTable {
  /** Cohorts, in the order of the data. */
  cohorts: string[];
  /** Periods elapsed, ascending. */
  periods: number[];
  /** `rate[c][p]`: share of cohort `c` still there at period `p`, 0 to 1. NaN when the period has not come yet. */
  rate: number[][];
  /** `count[c][p]`: head count behind the rate (NaN when the data holds rates). */
  count: number[][];
  /** Table row of each cell (-1 when empty). */
  row: number[][];
  /** Head count of each cohort at its first period (NaN when the data holds rates). */
  size: number[];
  /** Retention of all cohorts together per period: weighted by cohort size, or a plain mean for rates. */
  average: number[];
}

/**
 * One line per (cohort, period, value). `asRate`: the values are already rates (0 to 1, or 0 to 100);
 * otherwise they are head counts and the rate is taken against the first period of the cohort.
 */
export function cohortTable(cohort: ArrayLike<unknown>, period: ArrayLike<number>, value: ArrayLike<number>, asRate: boolean): CohortTable {
  const cohorts: string[] = [];
  const at = new Map<string, number>();
  const seen = new Set<number>();
  for (let i = 0; i < cohort.length; i++) {
    if (!Number.isFinite(period[i]) || !Number.isFinite(value[i])) continue;
    const name = String(cohort[i]);
    if (!at.has(name)) at.set(name, cohorts.push(name) - 1);
    seen.add(period[i]);
  }
  const periods = [...seen].sort((a, b) => a - b);
  const col = new Map(periods.map((p, i) => [p, i]));
  const grid = () => cohorts.map(() => periods.map(() => NaN));
  const raw = grid();
  const row = cohorts.map(() => periods.map(() => -1));
  for (let i = 0; i < cohort.length; i++) {
    if (!Number.isFinite(period[i]) || !Number.isFinite(value[i])) continue;
    const c = at.get(String(cohort[i]))!;
    const p = col.get(period[i])!;
    raw[c][p] = (Number.isNaN(raw[c][p]) ? 0 : raw[c][p]) + value[i];
    if (row[c][p] < 0) row[c][p] = i;
  }
  let rate = grid();
  let count = grid();
  const size = cohorts.map(() => NaN);
  if (asRate) {
    // Rates given out of 100 are brought back to 0..1.
    const percent = raw.some((r) => r.some((v) => v > 1.5));
    rate = raw.map((r) => r.map((v) => (percent ? v / 100 : v)));
  } else {
    count = raw;
    cohorts.forEach((_, c) => {
      size[c] = raw[c].find((v) => !Number.isNaN(v)) ?? NaN;
      rate[c] = raw[c].map((v) => (size[c] > 0 ? v / size[c] : NaN));
    });
  }
  const average = periods.map((_, p) => {
    let num = 0, den = 0;
    cohorts.forEach((_, c) => {
      if (Number.isNaN(rate[c][p])) return;
      num += asRate ? rate[c][p] : count[c][p];
      den += asRate ? 1 : size[c];
    });
    return den > 0 ? num / den : NaN;
  });
  return { cohorts, periods, rate, count, row, size, average };
}

// ------------------------------------------------------------ decomposition

export interface DecompositionColumn {
  /** The node whose children the column lists. */
  parent: HNode;
  /** Children shown, from the largest value down. */
  nodes: HNode[];
  /** Index in `nodes` of the one expanded into the next column (-1: none, a column of leaves). */
  open: number;
  /** Children left out for lack of room. */
  more: number;
}

/**
 * The columns of a decomposition tree: the children of the root, then at each level the children
 * of the single expanded node (`expanded[level]` by name, the largest by default). A column longer
 * than `maxRows` is cut (a row is kept for "+ n"), and the expanded node always stays in sight.
 */
export function decompositionColumns(root: HNode, expanded: (string | undefined)[], maxRows: number): DecompositionColumn[] {
  const columns: DecompositionColumn[] = [];
  let parent: HNode | undefined = root;
  for (let level = 0; parent && parent.children.length; level++) {
    const sorted = [...parent.children].sort((a, b) => b.value - a.value);
    const wanted = sorted.find((n) => n.name === expanded[level] && n.children.length);
    const chosen: HNode | undefined = wanted ?? sorted.find((n) => n.children.length);
    let nodes = sorted;
    if (sorted.length > maxRows) {
      nodes = sorted.slice(0, Math.max(1, maxRows - 1));
      if (chosen && !nodes.includes(chosen)) nodes[nodes.length - 1] = chosen;
    }
    columns.push({ parent, nodes, open: chosen ? nodes.indexOf(chosen) : -1, more: sorted.length - nodes.length });
    parent = chosen;
  }
  return columns;
}

// ------------------------------------------------------------ compared funnel

export interface FunnelComparison {
  /** Steps, in the order of the data. */
  stages: string[];
  /** Segments compared, in the order of the data. */
  segments: string[];
  /** `value[segment][stage]` (0 when missing). */
  value: number[][];
  /** First table row of each (segment, stage), -1 when missing. */
  row: number[][];
  /** `pass[segment][stage]`: share of the previous step that reaches this one (NaN for the first). */
  pass: number[][];
  /** Last step over first step, per segment. */
  overall: number[];
  /** Step with the heaviest loss (lowest pass rate) per segment, -1 when there is none. */
  worst: number[];
}

export function funnelComparison(stage: ArrayLike<unknown>, segment: ArrayLike<unknown> | undefined, value: ArrayLike<number>, only = 'Total'): FunnelComparison {
  const stages: string[] = [];
  const segments: string[] = [];
  for (let i = 0; i < stage.length; i++) {
    const s = String(stage[i]);
    const g = segment ? String(segment[i]) : only;
    if (!stages.includes(s)) stages.push(s);
    if (!segments.includes(g)) segments.push(g);
  }
  const values = segments.map(() => stages.map(() => 0));
  const row = segments.map(() => stages.map(() => -1));
  for (let i = 0; i < stage.length; i++) {
    const g = segments.indexOf(segment ? String(segment[i]) : only);
    const s = stages.indexOf(String(stage[i]));
    if (Number.isFinite(value[i])) values[g][s] += value[i];
    if (row[g][s] < 0) row[g][s] = i;
  }
  const pass = values.map((v) => v.map((x, i) => (i > 0 && v[i - 1] > 0 ? x / v[i - 1] : NaN)));
  const overall = values.map((v) => (v.length > 1 && v[0] > 0 ? v[v.length - 1] / v[0] : NaN));
  const worst = pass.map((p) => {
    let k = -1;
    p.forEach((r, i) => {
      if (!Number.isNaN(r) && (k < 0 || r < p[k])) k = i;
    });
    return k;
  });
  return { stages, segments, value: values, row, pass, overall, worst };
}
