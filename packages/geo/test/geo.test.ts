import { describe, expect, it } from 'vitest';
import { shapesOf, unwrapPolygon } from '../src';

describe('geo', () => {
  it('reads shapes from features, with names and custom keys', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: '250', properties: { name: 'France', iso: 'FRA' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { type: 'Feature', properties: { name: 'Line' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      ],
    };
    expect(shapesOf(fc).map((s) => [s.title, s.key])).toEqual([['France', 'France']]);
    expect(shapesOf(fc, 'properties.iso')[0].key).toBe('FRA');
    expect(shapesOf(fc, 'id')[0].key).toBe('250');
  });

  it('leaves ordinary polygons alone', () => {
    const polygon = [[[0, 0], [10, 0], [10, 10], [0, 0]]];
    expect(unwrapPolygon(polygon)).toEqual([polygon]);
  });

  it('makes antimeridian-crossing rings continuous and duplicates them on the other edge', () => {
    // A square straddling 180°: 170 -> -170 is a 20° step east, not a 340° step west.
    const parts = unwrapPolygon([[[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]]]);
    expect(parts).toHaveLength(2);
    expect(parts[0][0].map((p) => p[0])).toEqual([170, 190, 190, 170, 170]);
    expect(parts[1][0].map((p) => p[0])).toEqual([-190, -170, -170, -190, -190]);
  });

  it('does not unwrap a ring that circles a pole', () => {
    const ring = [[-180, -70], [-90, -70], [0, -70], [90, -70], [180, -70], [180, -90], [-180, -90], [-180, -70]];
    const parts = unwrapPolygon([ring]);
    expect(parts).toHaveLength(1);
    expect(parts[0][0]).toEqual(ring);
  });
});
