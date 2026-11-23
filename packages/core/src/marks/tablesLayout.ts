/**
 * Layout arithmetic of the table marks (`table`, `matrix`, `confusion`, `calendarMonth`):
 * no DOM, no renderer, so it is tested on its own.
 */

/** What one table column asks for. */
export interface ColumnNeed {
  /** Narrowest it reads at, px. */
  min: number;
  /** Lower stays longer on a narrow screen. */
  priority: number;
  /** Widest it grows to when there is room to spare (bars); others share what is left. */
  cap?: number;
  /** Keeps exactly `min` (a width set in the spec). */
  fixed?: boolean;
}

/**
 * Columns of a table across `width` px. Too narrow, the least important columns are
 * given up (highest `priority` first, the rightmost of equals), down to one. Spare room
 * goes to the stretchable columns up to their cap, then to every column in proportion.
 */
export function tableColumns(width: number, needs: ColumnNeed[]): { index: number; x0: number; x1: number }[] {
  let keep = needs.map((n, index) => ({ ...n, index }));
  const sum = () => keep.reduce((a, c) => a + c.min, 0);
  while (keep.length > 1 && sum() > width) {
    let worst = 0;
    for (let i = 1; i < keep.length; i++) if (keep[i].priority >= keep[worst].priority) worst = i;
    keep = keep.filter((_, i) => i !== worst);
  }
  const w = keep.map((c) => c.min);
  let left = width - sum();
  if (left < 0) {
    // A single column wider than the table: it takes it all.
    w[0] = width;
    left = 0;
  }
  const stretch = keep.map((c, i) => (c.cap !== undefined && !c.fixed ? Math.max(0, c.cap - w[i]) : 0));
  const wanted = stretch.reduce((a, v) => a + v, 0);
  if (wanted > 0 && left > 0) {
    const k = Math.min(1, left / wanted);
    stretch.forEach((s, i) => (w[i] += s * k));
    left -= wanted * k;
  }
  const free = keep.reduce((a, c, i) => a + (c.fixed ? 0 : w[i]), 0);
  if (left > 0 && free > 0) keep.forEach((c, i) => !c.fixed && (w[i] += (left * w[i]) / free));
  let x = 0;
  return keep.map((c, i) => ({ index: c.index, x0: x, x1: (x += w[i]) }));
}

/**
 * Rows of a table down `height` px: all of them when they fit at `minRow` px or more,
 * otherwise as many as fit above a "+ n rows" mention (`more` rows are left out).
 */
export function tableRows(
  height: number,
  count: number,
  o: { header: number; rowHeight: number; minRow?: number; total?: boolean; mention?: number },
): { shown: number; rowH: number; more: number } {
  const minRow = o.minRow ?? 22;
  const mention = o.mention ?? 18;
  // The total row is as tall as the others: it counts as one more row.
  const extra = o.total ? 1 : 0;
  const room = height - o.header;
  if (count === 0) return { shown: 0, rowH: o.rowHeight, more: 0 };
  if ((count + extra) * minRow <= room) return { shown: count, rowH: Math.min(o.rowHeight, room / (count + extra)), more: 0 };
  const shown = Math.max(1, Math.min(count - 1, Math.floor((room - mention) / minRow) - extra));
  return { shown, rowH: Math.max(14, Math.min(o.rowHeight, (room - mention) / (shown + extra))), more: count - shown };
}

/** `text` cut with an ellipsis to fit `room` px (the whole text when it fits, '' when nothing does). */
export function ellipsis(text: string, room: number, measure: (t: string) => number): string {
  if (measure(text) <= room) return text;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid).trimEnd() + '…') <= room) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo).trimEnd() + '…' : '';
}

/**
 * Column titles of a matrix, which cannot be turned on their side: the names when each fits
 * `room` px, else three-letter abbreviations when they stay distinct, else the row numbers
 * (the rows then show "3 Name": they are the key). `every`: one title in n when even those collide.
 */
export function headerTexts(names: string[], room: number, measure: (t: string) => number): { mode: 'name' | 'short' | 'index'; texts: string[]; every: number } {
  const fits = (texts: string[]) => texts.every((t) => measure(t) <= room);
  if (fits(names)) return { mode: 'name', texts: names, every: 1 };
  const short = names.map((n) => n.slice(0, 3).trim());
  if (new Set(short).size === names.length && fits(short)) return { mode: 'short', texts: short, every: 1 };
  const index = names.map((_, i) => String(i + 1));
  const widest = Math.max(1, ...index.map(measure));
  return { mode: 'index', texts: index, every: Math.max(1, Math.ceil(widest / Math.max(1, room))) };
}

/**
 * Order of the entities of a matrix: groups stay together, in first-seen order; inside a
 * group, as in the data, by decreasing total or by name.
 */
export function orderEntities(names: string[], groups: string[], totals: ArrayLike<number>, ordering: 'data' | 'total' | 'name'): number[] {
  const rank = new Map<string, number>();
  for (const g of groups) if (!rank.has(g)) rank.set(g, rank.size);
  return names
    .map((_, i) => i)
    .sort((a, b) => {
      const g = rank.get(groups[a])! - rank.get(groups[b])!;
      if (g) return g;
      if (ordering === 'total' && totals[b] !== totals[a]) return totals[b] - totals[a];
      if (ordering === 'name') return names[a].localeCompare(names[b]);
      return a - b;
    });
}

/**
 * Scores of a classifier from its confusion matrix (`m[actual][predicted]`): precision per
 * predicted class, recall per actual class, overall accuracy. NaN where a class has no case.
 */
export function confusionStats(m: number[][]): { precision: number[]; recall: number[]; accuracy: number; total: number; rows: number[]; columns: number[] } {
  const k = m.length;
  const rows = m.map((r) => r.reduce((a, v) => a + v, 0));
  const columns = Array.from({ length: k }, (_, c) => m.reduce((a, r) => a + r[c], 0));
  const total = rows.reduce((a, v) => a + v, 0);
  let hits = 0;
  for (let i = 0; i < k; i++) hits += m[i][i];
  return {
    precision: columns.map((s, i) => (s > 0 ? m[i][i] / s : NaN)),
    recall: rows.map((s, i) => (s > 0 ? m[i][i] / s : NaN)),
    accuracy: total > 0 ? hits / total : NaN,
    total,
    rows,
    columns,
  };
}

/** Days of a month (`month` 0 to 11) on a grid of weeks; `weekStart`: 0 Sunday, 1 Monday. */
export function monthGrid(year: number, month: number, weekStart = 1): { weeks: number; cells: { day: number; column: number; week: number }[] } {
  const first = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: days }, (_, d) => ({ day: d + 1, column: (first + d) % 7, week: Math.floor((first + d) / 7) }));
  return { weeks: Math.ceil((first + days) / 7), cells };
}
