import { describe, expect, it } from 'vitest';
import { forceLayout, packCircles } from '../src/marks/more';
import { numberFormatter } from '../src/util/format';

describe('circle packing', () => {
  it('places circles without overlap, inside the enclosing radius', () => {
    const rs = [10, 8, 8, 6, 5, 5, 4, 3, 3, 2, 2, 1];
    const p = packCircles(rs);
    for (let i = 0; i < rs.length; i++) {
      expect(Math.hypot(p.x[i], p.y[i]) + rs[i]).toBeLessThanOrEqual(p.r + 1e-6);
      for (let j = i + 1; j < rs.length; j++) {
        expect(Math.hypot(p.x[i] - p.x[j], p.y[i] - p.y[j])).toBeGreaterThanOrEqual(rs[i] + rs[j] - 1e-6);
      }
    }
    // Reasonably tight: the circles cover a good share of the enclosing disc.
    const covered = rs.reduce((a, r) => a + r * r, 0) / (p.r * p.r);
    expect(covered).toBeGreaterThan(0.45);
  });
});

describe('force layout', () => {
  it('keeps every node inside the box, linked nodes closer than unlinked ones', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
    const edges = [
      ...[1, 2, 3, 4, 5].map((i) => ({ from: 'n0', to: `n${i}` })),
      ...[7, 8, 9, 10, 11].map((i) => ({ from: 'n6', to: `n${i}` })),
    ];
    const l = forceLayout(nodes, edges, 600, 400);
    for (const p of l.pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(600);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(400);
    }
    const d = (a: string, b: string) => Math.hypot(l.pos.get(a)!.x - l.pos.get(b)!.x, l.pos.get(a)!.y - l.pos.get(b)!.y);
    expect(d('n0', 'n1')).toBeLessThan(d('n1', 'n7'));
  });
});

describe('absolute format', () => {
  it('shows magnitudes only', () => {
    expect(numberFormatter({ absolute: true, locale: 'en' })(-1200)).toBe('1,200');
  });
});
