import { describe, expect, it } from 'vitest';
import { dorlingLayout, dorlingRadii, geoCentroids, mercatorDegrees, ringCentroid, spikeTriangle } from '../src/marks/carto';

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const square = (x0: number, y0: number, side: number) => [[x0, y0], [x0 + side, y0], [x0 + side, y0 + side], [x0, y0 + side], [x0, y0]];

describe('centroids', () => {
  it('of a ring is its area-weighted center, whatever its winding', () => {
    const ring = square(10, 20, 4);
    expect(ringCentroid(ring)).toMatchObject({ lon: 12, lat: 22, area: 16 });
    const c = ringCentroid([...ring].reverse());
    expect(c.lon).toBeCloseTo(12);
    expect(c.lat).toBeCloseTo(22);
  });
  it('is not the mean of the vertices', () => {
    // An L: many points on one side must not drag the centroid.
    const c = ringCentroid([[0, 0], [4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [0, 4], [0, 0]]);
    expect(c.lon).toBeCloseTo(2);
    expect(c.lat).toBeCloseTo(2);
  });
  it('stays on the antimeridian for a ring that crosses it', () => {
    const c = ringCentroid([[178, 0], [-178, 0], [-178, 2], [178, 2], [178, 0]]);
    expect(Math.abs(c.lon)).toBeCloseTo(180);
    expect(c.lat).toBeCloseTo(1);
    expect(c.area).toBeCloseTo(8);
  });
  it('of a multi-part shape is the centroid of its largest part', () => {
    const geo = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'Mainland', iso: 'ML' }, geometry: { type: 'MultiPolygon', coordinates: [[square(-60, 0, 1)], [square(0, 40, 10)]] } },
        { type: 'Feature', properties: { name: 'Island' }, geometry: { type: 'Polygon', coordinates: [square(20, -10, 2)] } },
        { type: 'Feature', properties: { name: 'A line' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      ],
    };
    const cs = geoCentroids(geo);
    expect(cs.map((c) => c.key)).toEqual(['Mainland', 'Island']);
    expect(cs[0].lon).toBeCloseTo(5);
    expect(cs[0].lat).toBeCloseTo(45);
    expect(cs[1].lon).toBeCloseTo(21);
    expect(geoCentroids(geo, 'properties.iso')[0].key).toBe('ML');
  });
});

describe('dorling', () => {
  it('sizes areas in proportion to the values, covering the asked share of the box', () => {
    const xs = [0, 10, 0, 10];
    const ys = [0, 0, 5, 5];
    const r = dorlingRadii(xs, ys, [1, 4, 9, 0], 0.4);
    expect(r[1] / r[0]).toBeCloseTo(2);
    expect(r[2] / r[0]).toBeCloseTo(3);
    expect(r[3]).toBe(0);
    const area = [...r].reduce((a, v) => a + Math.PI * v * v, 0);
    expect(area).toBeCloseTo(0.4 * 10 * 5);
  });

  it('leaves a circle with no neighbour on its anchor', () => {
    const out = dorlingLayout([{ x: 0, y: 0, r: 1 }, { x: 10, y: 3, r: 2 }]);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 10, y: 3 }]);
  });

  it('separates crowded circles without any overlap, and keeps them near their anchors', () => {
    const r = rng(7);
    // Three dense clusters and a few identical positions: the worst case for a relaxation.
    const anchors = Array.from({ length: 160 }, (_, i) => {
      const c = i % 3;
      return { x: c * 4 + r() * 2, y: (c % 2) * 3 + r() * 2, r: 0 };
    });
    anchors[5] = { ...anchors[4] };
    anchors[6] = { ...anchors[4] };
    const radii = dorlingRadii(anchors.map((a) => a.x), anchors.map((a) => a.y), anchors.map(() => 0.2 + r() * r() * 6), 0.35);
    anchors.forEach((a, i) => (a.r = radii[i]));
    const out = dorlingLayout(anchors);
    let worst = 0;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const d = Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y);
        worst = Math.max(worst, (anchors[i].r + anchors[j].r - d) / (anchors[i].r + anchors[j].r));
      }
    }
    // Relative to the sum of the two radii: nothing a pixel could show.
    expect(worst).toBeLessThan(1e-8);
    // Nothing flies away: every circle stays within the size of the cloud of its anchor.
    const far = Math.max(...out.map((p, i) => Math.hypot(p.x - anchors[i].x, p.y - anchors[i].y)));
    expect(far).toBeLessThan(6);
    for (const p of out) expect(Number.isFinite(p.x + p.y)).toBe(true);
  });

  it('is deterministic', () => {
    const make = () => {
      const r = rng(3);
      return Array.from({ length: 60 }, () => ({ x: r() * 5, y: r() * 3, r: 0.1 + r() * 0.5 }));
    };
    expect(dorlingLayout(make())).toEqual(dorlingLayout(make()));
  });

  it('moves the small circle more than the large one', () => {
    const out = dorlingLayout([{ x: 0, y: 0, r: 3 }, { x: 1, y: 0, r: 1 }], 1);
    expect(Math.abs(out[0].x)).toBeLessThan(Math.abs(out[1].x - 1));
    expect(out[1].x - out[0].x).toBeCloseTo(4);
  });
});

describe('spikes', () => {
  it('stand on their place: base centered, tip straight above, sizes in px', () => {
    const t = spikeTriangle(0.5, 0.25, 80, 10, [1 / 400, 1 / 200]);
    expect(t[0]).toBeCloseTo(0.5 - 5 / 400);
    expect(t[2]).toBeCloseTo(0.5 + 5 / 400);
    expect([t[1], t[3]]).toEqual([0.25, 0.25]);
    expect(t[4]).toBe(0.5);
    expect(t[5]).toBeCloseTo(0.25 + 80 / 200);
  });
  it('have no height for a zero value', () => {
    const t = spikeTriangle(0.1, 0.9, 0, 8, [0.01, 0.01]);
    expect(t[5]).toBe(0.9);
  });
});

describe('mercator ordinates', () => {
  it('are symmetric, zero at the equator and stretched towards the poles', () => {
    expect(mercatorDegrees(0)).toBeCloseTo(0);
    expect(mercatorDegrees(-40)).toBeCloseTo(-mercatorDegrees(40));
    expect(mercatorDegrees(60)).toBeGreaterThan(60);
    expect(mercatorDegrees(1)).toBeCloseTo(1, 3);
    expect(Number.isFinite(mercatorDegrees(90))).toBe(true);
  });
});
