/** Small animation helpers for marks that change state on their own (drill-down, filters). */

export const DURATION = 650;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** People who ask their system for less motion get the end state at once. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Interpolates a flat array of numbers (one group of values per instance)
 * from one state to the next.
 */
export class Tween {
  current: Float64Array;
  private from: Float64Array;
  private to: Float64Array;
  private start = 0;
  private duration = 0;
  private active = false;

  constructor(initial: Float64Array) {
    this.current = Float64Array.from(initial);
    this.from = Float64Array.from(initial);
    this.to = Float64Array.from(initial);
  }

  /** Start moving from wherever we are now to `target`. */
  go(target: Float64Array, now: number, duration = DURATION): void {
    this.from = Float64Array.from(this.current);
    this.to = Float64Array.from(target);
    this.start = now;
    this.duration = prefersReducedMotion() ? 0 : duration;
    this.active = this.duration > 0;
    if (!this.active) this.current.set(this.to);
  }

  /** Advance to `now`; true while still moving. */
  step(now: number): boolean {
    if (!this.active) return false;
    const k = Math.min(1, (now - this.start) / this.duration);
    if (k >= 1) {
      this.current.set(this.to);
      this.active = false;
      return false;
    }
    const e = easeInOutCubic(k);
    for (let i = 0; i < this.current.length; i++) this.current[i] = this.from[i] + (this.to[i] - this.from[i]) * e;
    return true;
  }

  get moving(): boolean {
    return this.active;
  }
}
