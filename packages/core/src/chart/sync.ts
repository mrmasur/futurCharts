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
