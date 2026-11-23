/**
 * Charts that share a sync group (`interactions.sync`) show the hover at the
 * same x and the same visible x range. A navigator (`interactions.navigator`)
 * drives the range of every other chart of its group.
 */

export interface SyncMember {
  /** Hover at this x (data units on the category axis), or none. */
  syncHover(x: number | null): void;
  /** Show this x range (data units), or everything. */
  syncRange(range: [number, number] | null): void;
  /** Another chart of the group needs more (or less) room beside its plot: lay out again. */
  syncLayout?(): void;
}

const groups = new Map<string, Set<SyncMember>>();

export function joinGroup(name: string, m: SyncMember): void {
  let g = groups.get(name);
  if (!g) groups.set(name, (g = new Set()));
  g.add(m);
}

export function leaveGroup(name: string, m: SyncMember): void {
  const g = groups.get(name);
  if (!g) return;
  g.delete(m);
  if (!g.size) groups.delete(name);
}

/** Tell every other member of the group. */
export function broadcast(name: string, from: SyncMember, f: (m: SyncMember) => void): void {
  for (const m of groups.get(name) ?? []) if (m !== from) f(m);
}

/** Room a chart needs left and right of its plot, px, before any alignment (`width`: the chart's own). */
export interface SyncMargins {
  left: number;
  right: number;
  width: number;
}

const margins = new Map<string, Map<SyncMember, SyncMargins>>();

/**
 * Stacked charts of a group share the edges of their plots: each one reports the room it
 * needs, and every one takes the largest. Returns true when the report changed (the others
 * must lay out again). `null` withdraws the report (chart destroyed, or not a cartesian one).
 */
export function reportMargins(name: string, m: SyncMember, own: SyncMargins | null): boolean {
  let g = margins.get(name);
  const before = g?.get(m);
  if (!own) {
    if (!before) return false;
    g!.delete(m);
    if (!g!.size) margins.delete(name);
    return true;
  }
  if (before && before.left === own.left && before.right === own.right && before.width === own.width) return false;
  if (!g) margins.set(name, (g = new Map()));
  g.set(m, own);
  return true;
}

/**
 * The room the other charts of the group ask for, among those as wide as `width`
 * (charts of different widths are not stacked: nothing to align).
 */
export function groupMargins(name: string, m: SyncMember, width: number): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const [other, r] of margins.get(name) ?? []) {
    if (other === m || Math.abs(r.width - width) > 0.5) continue;
    if (r.left > left) left = r.left;
    if (r.right > right) right = r.right;
  }
  return { left, right };
}
