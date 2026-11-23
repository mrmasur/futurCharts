/**
 * Domains of a cartesian chart, from its prepared layers: one extent along the
 * category axis, shared by every layer, and one along each value axis (the
 * primary one, and the secondary one of a dual-axis chart). Pure: no scale, no
 * DOM, so it is tested on its own.
 */
import type { LayerData } from '../marks/prepare';
import { niceDomain } from '../scale/scales';
import type { ScaleSpec } from '../spec/types';

/** What a value axis has to show. `v0 > v1` when no datum is bound to it. */
export interface ValueExtent {
  v0: number;
  v1: number;
  /** A mark bound to this axis grows from zero (bars, areas): the domain includes it. */
  baseline: boolean;
}

export interface LayerExtents {
  /** Category axis. `c0 > c1` without data. */
  c0: number;
  c1: number;
  /** Smallest gap between two x of a banded layer (bar thickness on a continuous axis); Infinity when unknown. */
  step: number;
  /** A layer has a thickness along the category axis. */
  banded: boolean;
  primary: ValueExtent;
  secondary: ValueExtent;
}

export interface ExtentLayer {
  data: Pick<LayerData, 'series' | 'stacked' | 'ranged'>;
  def: { baseline?: boolean; banded?: boolean };
}

/**
 * Extents of the layers. `secondary(i)` says whether layer `i` is bound to the
 * second value axis: its values then leave the primary extent alone.
 */
export function layerExtents(layers: ExtentLayer[], secondary: (index: number) => boolean = () => false): LayerExtents {
  const out: LayerExtents = {
    c0: Infinity,
    c1: -Infinity,
    step: Infinity,
    banded: false,
    primary: { v0: Infinity, v1: -Infinity, baseline: false },
    secondary: { v0: Infinity, v1: -Infinity, baseline: false },
  };
  layers.forEach(({ data, def }, index) => {
    const v = secondary(index) ? out.secondary : out.primary;
    // A range (y2) has its own start: it does not pull zero into the domain.
    v.baseline ||= !!def.baseline && !data.ranged;
    out.banded ||= !!def.banded;
    // Only marks drawn from a start (bars, areas, stacks, ranges) span y0: a line or a point is just y1.
    const spans = data.stacked || data.ranged || !!def.baseline;
    for (const s of data.series) {
      if (s.hidden) continue;
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i];
        if (x < out.c0) out.c0 = x;
        if (x > out.c1) out.c1 = x;
        const lo = spans ? Math.min(s.y0[i], s.y1[i]) : s.y1[i];
        const hi = spans ? Math.max(s.y0[i], s.y1[i]) : s.y1[i];
        if (lo < v.v0) v.v0 = lo;
        if (hi > v.v1) v.v1 = hi;
        if (def.banded && i > 0 && x - s.x[i - 1] > 0) out.step = Math.min(out.step, x - s.x[i - 1]);
      }
    }
  });
  return out;
}

export interface LinearDomainOptions {
  /** The axis' `scales` entry: `zero`, `nice` and an explicit `domain` win over what the data says. */
  spec: ScaleSpec;
  baseline: boolean;
  /** Value labels sit past the bar ends: leave them room. */
  outsideLabels: boolean;
  horizontal: boolean;
  /** A 100 % stack: the domain is [0, 1]. */
  normalized: boolean;
}

/** Domain of a linear value axis from the extent of its data (`reverse` is left to the caller). */
export function linearValueDomain(v0: number, v1: number, o: LinearDomainOptions): [number, number] {
  const { spec } = o;
  if (spec.zero ?? o.baseline) [v0, v1] = [Math.min(0, v0), Math.max(0, v1)];
  if (o.outsideLabels && !spec.domain) {
    const pad = (v1 - v0) * (o.horizontal ? 0.14 : 0.08);
    if (v1 > 0) v1 += pad;
    if (v0 < 0) v0 -= pad;
  }
  if ((spec.nice ?? true) && !o.normalized) [v0, v1] = niceDomain(v0, v1, 5);
  if (o.normalized && !spec.domain) [v0, v1] = [0, 1];
  return [spec.domain?.[0] ?? v0, spec.domain?.[1] ?? v1];
}
