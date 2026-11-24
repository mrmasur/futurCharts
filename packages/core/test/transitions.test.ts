/**
 * Transitions of lines and areas, and animated exits: the pure parts (resampling of two
 * polylines on common positions, matching by key, what leaves), without DOM nor GPU.
 */
import { describe, expect, it } from 'vitest';
import { exitInstances, leaving, pathStates, snapshot, startTransition } from '../src/chart/morph';
import { columnsToData, leavingPath, pairAnchors, pathColumns, resamplePair, type Columns } from '../src/chart/paths';
import type { Built } from '../src/chart/types';
import type { DrawPath, MarkDefinition, MarkDraw } from '../src/marks/registry';
import { LAYOUTS } from '../src/render/layouts';
import type { Batch, PrimitiveKind } from '../src/render/types';

const RED = [1, 0, 0, 1];
/** A `line` batch: one segment per step of the polyline. */
const segments = (pts: [number, number][], color = RED, width = 2) => Float32Array.from(pts.slice(0, -1).flatMap((p, i) => [...p, ...pts[i + 1], ...color, width]));
/** A `mesh` ribbon between `top` and `bottom` (same x). */
const ribbon = (top: [number, number][], bottom: [number, number][], color = RED) => {
  const v = (p: [number, number]) => [...p, ...color];
  return Float32Array.from(top.slice(0, -1).flatMap((_, i) => [...v(top[i]), ...v(top[i + 1]), ...v(bottom[i + 1]), ...v(top[i]), ...v(bottom[i + 1]), ...v(bottom[i])]));
};
const path = (key: string, count: number, keys?: string[], start = 0): DrawPath => ({ key, start, count, anchors: keys && { keys, at: keys.map((_, i) => i) } });
const columns = (pts: [number, number][], keys?: string[]): Columns => pathColumns('line', segments(pts), path('s', pts.length - 1, keys));
/** x, y of each column. */
const xy = (v: Float32Array, stride: number) => Array.from({ length: v.length / stride }, (_, i) => [v[i * stride], v[i * stride + 1]].map((n) => Math.round(n * 1e4) / 1e4));

describe('rééchantillonnage commun de deux polylignes', () => {
  it('un tracé en colonnes puis en instances redonne les mêmes données', () => {
    const line = segments([[0, 0], [0.5, 1], [1, 0.25]]);
    const c = pathColumns('line', line, path('s', 2));
    expect(c.n).toBe(3);
    expect(Array.from(columnsToData('line', c.v, c.n))).toEqual(Array.from(line));
    const mesh = ribbon([[0, 1], [0.5, 2], [1, 1.5]], [[0, 0], [0.5, 0.25], [1, 0]]);
    const r = pathColumns('mesh', mesh, path('s', 12));
    expect(r.n).toBe(3);
    expect(Array.from(columnsToData('mesh', r.v, r.n))).toEqual(Array.from(mesh));
  });

  it('sans point commun : les deux tracés sont coupés aux positions de l’un et de l’autre', () => {
    // a has points at x = 0, 0.5, 1 ; b at x = 0, 0.25, 1 : common positions 0, 0.25, 0.5, 1.
    const { a, b, n } = resamplePair(columns([[0, 0], [0.5, 1], [1, 0]]), columns([[0, 2], [0.25, 4], [1, 4]]));
    expect(n).toBe(4);
    expect(xy(a, 7)).toEqual([[0, 0], [0.25, 0.5], [0.5, 1], [1, 0]]);
    expect(xy(b, 7)).toEqual([[0, 2], [0.25, 4], [0.5, 4], [1, 4]]);
  });

  it('chaque tracé garde sa forme : les sommets ajoutés sont sur lui', () => {
    const before = columns([[0, 0], [0.5, 1], [1, 0]]);
    const { a, n } = resamplePair(before, columns([[0, 0], [0.1, 3], [0.9, 3], [1, 0]]));
    for (const [x, y] of xy(a, 7)) expect(y).toBeCloseTo(x <= 0.5 ? 2 * x : 2 - 2 * x, 4);
    expect(n).toBe(5);
  });

  it('un point présent avant et après garde son identité, même si son abscisse change', () => {
    // Jan–Mar then Jan–Apr on a wider axis: Mar moves from x = 1 to x = 2/3, Apr is new.
    const before = columns([[0, 1], [0.5, 2], [1, 3]], ['jan', 'fév', 'mar']);
    const after = columns([[0, 1], [1 / 3, 2], [2 / 3, 3], [1, 5]], ['jan', 'fév', 'mar', 'avr']);
    expect(pairAnchors(before, after)).toEqual([[0, 0], [1, 1], [2, 2]]);
    const { a, b, n } = resamplePair(before, after);
    expect(n).toBe(4);
    // The new month grows out of the end of the old curve.
    expect(xy(a, 7)).toEqual([[0, 1], [0.5, 2], [1, 3], [1, 3]]);
    expect(xy(b, 7)).toEqual([[0, 1], [0.3333, 2], [0.6667, 3], [1, 5]]);
  });

  it('une fenêtre qui glisse : ce qui sort se replie sur le début, ce qui entre sort de la fin', () => {
    const before = columns([[0, 1], [0.5, 2], [1, 3]], ['a', 'b', 'c']);
    const after = columns([[0, 2], [0.5, 3], [1, 9]], ['b', 'c', 'd']);
    const { a, b } = resamplePair(before, after);
    expect(xy(a, 7)).toEqual([[0, 1], [0.5, 2], [1, 3], [1, 3]]);
    expect(xy(b, 7)).toEqual([[0, 2], [0, 2], [0.5, 3], [1, 9]]);
  });

  it('un axe réordonné ne garde que les points encore dans l’ordre', () => {
    const before = columns([[0, 1], [0.5, 2], [1, 3]], ['a', 'b', 'c']);
    const after = columns([[0, 1], [0.5, 2], [1, 3]], ['c', 'a', 'b']);
    expect(pairAnchors(before, after)).toEqual([[0, 1], [1, 2]]);
  });

  it('marches (x répété) : la position se mesure le long du tracé, sans sommet dégénéré', () => {
    const steps = columns([[0, 0], [1, 0], [1, 1]]);
    const { a, b, n } = resamplePair(steps, columns([[0, 0], [1, 1]]));
    expect(n).toBe(3);
    expect(xy(a, 7)).toEqual([[0, 0], [1, 0], [1, 1]]);
    for (const v of [...a, ...b]) expect(Number.isFinite(v)).toBe(true);
  });

  it('aires : le haut et la base sont rééchantillonnés ensemble, colonne par colonne', () => {
    const before = pathColumns('mesh', ribbon([[0, 1], [1, 1]], [[0, 0], [1, 0]]), path('s', 6));
    const after = pathColumns('mesh', ribbon([[0, 3], [0.5, 4], [1, 3]], [[0, 1], [0.5, 2], [1, 1]]), path('s', 12));
    const { a, b, n } = resamplePair(before, after);
    expect(n).toBe(3);
    // Column 1 of the old ribbon is cut at x = 0.5: top (0.5, 1), bottom (0.5, 0).
    expect(Array.from(a.subarray(12, 16))).toEqual([0.5, 1, 0.5, 0]);
    expect(Array.from(b.subarray(12, 16))).toEqual([0.5, 4, 0.5, 2]);
    expect(columnsToData('mesh', a, n).length).toBe(columnsToData('mesh', b, n).length);
  });
});

describe('appariement par clé', () => {
  it('une courbe se déforme depuis la série de même clé ; une nouvelle entre à part ; une disparue s’estompe', () => {
    const oldData = Float32Array.from([...segments([[0, 0], [1, 0]]), ...segments([[0, 5], [1, 5]])]);
    const old = { data: oldData, paths: [path('A', 1), path('B', 1, undefined, 1)] };
    const data = Float32Array.from([...segments([[0, 9], [1, 9]]), ...segments([[0, 1], [0.5, 2], [1, 1]])]);
    const states = pathStates('line', old, [path('C', 1), path('A', 2, undefined, 1)], data)!;
    // A resampled on three positions (two segments), then B leaving (one segment).
    expect(states.prev.length).toBe(3 * 9);
    expect(states.cur.length).toBe(states.prev.length);
    expect(Array.from(states.prev.subarray(0, 4))).toEqual([0, 0, 0.5, 0]);
    expect(Array.from(states.cur.subarray(0, 4))).toEqual([0, 1, 0.5, 2]);
    // B: same place, alpha down to zero.
    expect(Array.from(states.prev.subarray(18, 26))).toEqual([0, 5, 1, 5, 1, 0, 0, 1]);
    expect(Array.from(states.cur.subarray(18, 26))).toEqual([0, 5, 1, 5, 1, 0, 0, 0]);
    // C is new: revealed on its own.
    expect(Array.from(states.enter)).toEqual(Array.from(segments([[0, 9], [1, 9]])));
  });

  it('rien n’a changé : pas de transition', () => {
    const data = segments([[0, 0], [1, 1]]);
    expect(pathStates('line', { data, paths: [path('A', 1)] }, [path('A', 1)], Float32Array.from(data))).toBeNull();
  });

  it('un tracé mal déclaré par une marque est ignoré, sans exception', () => {
    const data = segments([[0, 0], [1, 1]]);
    expect(pathStates('line', { data, paths: [path('A', 5)] }, [path('A', 7)], data)).toBeNull();
  });
});

describe('sortants', () => {
  it('liste des instances dont la clé a disparu', () => {
    expect(leaving(['a', 'b', 'c', 'd'], ['d', 'b', 'e'])).toEqual([0, 2]);
    expect(leaving(['a'], ['a'])).toEqual([]);
  });

  it('une barre se replie sur sa base et s’estompe (verticale : y1 → y0 ; horizontale : x1 → x0)', () => {
    const stride = LAYOUTS.rect.stride;
    const bar = (axis: number) => {
      const d = new Float32Array(stride);
      d.set([0.1, 0, 0.3, 0.8, 1, 0, 0, 1]);
      d[20] = axis;
      return d;
    };
    const v = exitInstances('rect', stride, { keys: ['a'], data: bar(0) }, [0]);
    expect(Array.from(v.prev.subarray(0, 4)).map((n) => +n.toFixed(2))).toEqual([0.1, 0, 0.3, 0.8]);
    expect(Array.from(v.cur.subarray(0, 4)).map((n) => +n.toFixed(2))).toEqual([0.1, 0, 0.3, 0]);
    expect(v.cur[7]).toBe(0);
    const h = exitInstances('rect', stride, { keys: ['a'], data: bar(1) }, [0]);
    expect(Array.from(h.cur.subarray(0, 4)).map((n) => +n.toFixed(2))).toEqual([0.1, 0, 0.1, 0.8]);
  });

  it('un point rétrécit à zéro et s’estompe', () => {
    const stride = LAYOUTS.point.stride;
    const data = new Float32Array(2 * stride);
    data.set([0.2, 0.4, 12, 0, 0, 0, 1, 1], stride);
    const { prev, cur } = exitInstances('point', stride, { keys: ['a', 'b'], data }, [1]);
    expect(prev[2]).toBe(12);
    expect([cur[2], cur[7]]).toEqual([0, 0]);
  });

  it('une part se referme là où ses voisines se rejoignent dans le nouvel état', () => {
    const stride = LAYOUTS.arc.stride;
    const slices = (angles: [number, number][]) => {
      const d = new Float32Array(angles.length * stride);
      angles.forEach(([a0, a1], i) => d.set([0.5, 0.5, 0.2, 0.4, a0, a1, 0, 0, 1, 1, 1, 1], i * stride));
      return d;
    };
    const old = { keys: ['a', 'b', 'c'], data: slices([[0, 1], [1, 2], [2, 6]]) };
    const now = { keys: ['a', 'c'], data: slices([[0, 3], [3, 6]]) };
    const { cur } = exitInstances('arc', stride, old, leaving(old.keys, now.keys), now);
    expect([cur[4], cur[5], cur[11]]).toEqual([3, 3, 0]);
    // The first slice is gone: it closes where the next one now starts.
    const first = exitInstances('arc', stride, old, [0], { keys: ['b', 'c'], data: slices([[0.5, 2], [2, 6]]) });
    expect([first.cur[4], first.cur[5]]).toEqual([0.5, 0.5]);
  });

  it('une aire se replie sur sa base et s’estompe ; une courbe s’estompe sur place', () => {
    const out = leavingPath('mesh', ribbon([[0, 3], [1, 4]], [[0, 1], [1, 2]]));
    const ys = Array.from({ length: 6 }, (_, i) => out[i * 6 + 1]);
    expect(ys).toEqual([1, 2, 2, 1, 2, 1]);
    for (let i = 0; i < 6; i++) expect(out[i * 6 + 5]).toBe(0);
    const line = leavingPath('line', segments([[0, 0], [1, 1]]));
    expect(Array.from(line.subarray(0, 4))).toEqual([0, 0, 1, 1]);
    expect(line[7]).toBe(0);
  });
});

describe('transition complète, sans GPU', () => {
  /** A renderer that only records what the chart asks of it. */
  const fake = () => {
    const made: (Batch & { cur?: Float32Array; prev?: Float32Array | null; dead?: boolean })[] = [];
    return {
      made,
      createBatch(kind: PrimitiveKind) {
        const b = {
          kind,
          count: 0,
          update(data: Float32Array, count: number) {
            b.cur = data;
            b.count = count;
          },
          setPrevious(data: Float32Array | null) {
            b.prev = data;
          },
          destroy() {
            b.dead = true;
          },
        } as (typeof made)[number] & { count: number };
        made.push(b);
        return b;
      },
    };
  };
  const def = {} as MarkDefinition;
  const layer = (index: number, draws: MarkDraw[]): Built => ({ data: { index }, def, mark: { draws } } as unknown as Built);

  it('lignes : un batch de remplacement (deux états de même taille), un batch révélé pour la nouvelle série', () => {
    const r = fake();
    const oldData = segments([[0, 0], [1, 0]]);
    const old = layer(0, [{ batch: r.createBatch('line'), data: oldData, paths: [path('A', 1)] }]);
    const data = Float32Array.from([...segments([[0, 1], [0.5, 2], [1, 1]]), ...segments([[0, 7], [1, 7]])]);
    const markBatch = r.createBatch('line');
    const now = layer(0, [{ batch: markBatch, data, paths: [path('A', 2), path('N', 1, undefined, 2)] }]);
    const t = startTransition(snapshot([old]), [now], r)!;
    const stand = t.stand.get(markBatch)!;
    expect(stand.map((s) => !!s.reveal)).toEqual([false, true]);
    const blended = stand[0].batch as (typeof r.made)[number];
    expect(blended.count).toBe(2);
    expect(blended.prev!.length).toBe(blended.cur!.length);
    // The mark's own batch is left alone: it is the final state.
    expect((markBatch as (typeof r.made)[number]).prev).toBeUndefined();
    expect(t.owned.length).toBe(2);
  });

  it('barres : les survivantes glissent dans leur batch, les disparues partent dans un batch à part', () => {
    const r = fake();
    const stride = LAYOUTS.rect.stride;
    const bars = (heights: number[]) => {
      const d = new Float32Array(heights.length * stride);
      heights.forEach((h, i) => d.set([i, 0, i + 1, h, 0, 0, 1, 1], i * stride));
      return d;
    };
    const old = layer(0, [{ batch: r.createBatch('rect'), data: bars([1, 2, 3]), keys: ['a', 'b', 'c'], pixelSnap: true }]);
    const batch = r.createBatch('rect');
    const now = layer(0, [{ batch, data: bars([5, 6]), keys: ['a', 'c'] }]);
    const t = startTransition(snapshot([old]), [now], r)!;
    expect(t.batches).toEqual([batch]);
    const ghosts = t.ghosts.get(0)!;
    expect(ghosts.length).toBe(1);
    expect(ghosts[0].pixelSnap).toBe(true);
    const g = ghosts[0].batch as (typeof r.made)[number];
    expect(g.count).toBe(1);
    // `b`: from its height (2) down to its base, faded.
    expect([g.prev![3], g.cur![3], g.cur![7]]).toEqual([2, 0, 0]);
  });

  it('un calque retiré s’en va en entier, sauf si le graphique n’est plus le même', () => {
    const r = fake();
    const line = (index: number, d = def) => ({ ...layer(index, [{ batch: r.createBatch('line'), data: segments([[0, index], [1, index]]), paths: [path('A', 1)] }]), def: d });
    const before = snapshot([line(0), line(1)]);
    const t = startTransition(before, [line(0)], r)!;
    expect([...t.ghosts.keys()]).toEqual([1]);
    expect(startTransition(before, [line(0, {} as MarkDefinition)], r)).toBeNull();
  });

  it('mêmes données : aucune transition, aucun batch créé', () => {
    const r = fake();
    const make = () => layer(0, [{ batch: r.createBatch('line'), data: segments([[0, 0], [1, 1]]), paths: [path('A', 1)] }]);
    const before = snapshot([make()]);
    const count = r.made.length + 1;
    expect(startTransition(before, [make()], r)).toBeNull();
    expect(r.made.length).toBe(count);
  });
});
