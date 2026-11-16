import { numberFormatter, type FormatSpec } from '../util/format';

export interface Tick {
  /** Position in normalized scale space. */
  t: number;
  label: string;
}

/**
 * A scale maps a raw value to normalized space [0, 1] over its full domain.
 * Pixels are never involved: the renderer applies the view transform.
 */
export interface Scale {
  readonly type: 'linear' | 'log' | 'time' | 'band';
  /** Raw value -> normalized. Band scales take the category index and return the band center. */
  norm(v: number): number;
  invert(t: number): number;
  /** Ticks inside the visible normalized range [t0, t1]. */
  ticks(t0: number, t1: number, count: number): Tick[];
  /** Exact label for a raw value (tooltips). */
  format(v: number): string;
  /** Normalized width of one band; 0 for continuous scales. */
  readonly band: number;
}

export function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * pow;
}

export function niceDomain(d0: number, d1: number, count = 5): [number, number] {
  if (d0 === d1) {
    const pad = Math.abs(d0) || 1;
    return [d0 - pad, d1 + pad];
  }
  const step = niceStep(d1 - d0, count);
  return [Math.floor(d0 / step) * step, Math.ceil(d1 / step) * step];
}

export class LinearScale implements Scale {
  readonly type = 'linear';
  readonly band = 0;
  constructor(readonly d0: number, readonly d1: number, private fmt?: FormatSpec) {
    if (d0 === d1) this.d1 = d0 + 1;
  }
  norm(v: number): number {
    return (v - this.d0) / (this.d1 - this.d0);
  }
  invert(t: number): number {
    return this.d0 + t * (this.d1 - this.d0);
  }
  ticks(t0: number, t1: number, count: number): Tick[] {
    const a = this.invert(t0);
    const b = this.invert(t1);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const step = niceStep(hi - lo, count);
    const f = numberFormatter(this.fmt, { axis: true, max: Math.max(Math.abs(lo), Math.abs(hi)), step });
    const out: Tick[] = [];
    const start = Math.ceil(lo / step - 1e-9);
    const end = Math.floor(hi / step + 1e-9);
    for (let i = start; i <= end; i++) {
      const v = i * step + 0; // + 0 turns -0 into 0, so the label never reads "-0"
      out.push({ t: this.norm(v), label: f(v) });
    }
    return out;
  }
  format(v: number): string {
    return numberFormatter(this.fmt)(v);
  }
}

export class LogScale implements Scale {
  readonly type = 'log';
  readonly band = 0;
  private l0: number;
  private l1: number;
  constructor(d0: number, d1: number, private fmt?: FormatSpec) {
    const lo = Math.max(d0, Number.MIN_VALUE);
    this.l0 = Math.floor(Math.log10(lo) + 1e-9);
    this.l1 = Math.ceil(Math.log10(Math.max(d1, lo * 10)) - 1e-9);
    if (this.l1 === this.l0) this.l1 = this.l0 + 1;
  }
  norm(v: number): number {
    return v > 0 ? (Math.log10(v) - this.l0) / (this.l1 - this.l0) : NaN;
  }
  invert(t: number): number {
    return Math.pow(10, this.l0 + t * (this.l1 - this.l0));
  }
  ticks(t0: number, t1: number): Tick[] {
    const f = numberFormatter(this.fmt ?? { style: 'compact' });
    const out: Tick[] = [];
    for (let e = this.l0; e <= this.l1; e++) {
      const t = (e - this.l0) / (this.l1 - this.l0);
      if (t >= t0 - 1e-9 && t <= t1 + 1e-9) out.push({ t, label: f(Math.pow(10, e)) });
    }
    return out;
  }
  format(v: number): string {
    return numberFormatter(this.fmt)(v);
  }
}

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;
const FIXED = [S, 5 * S, 15 * S, 30 * S, M, 5 * M, 15 * M, 30 * M, H, 3 * H, 6 * H, 12 * H];
const CALENDAR: { unit: 'day' | 'month' | 'year'; n: number; ms: number }[] = [
  { unit: 'day', n: 1, ms: D },
  { unit: 'day', n: 2, ms: 2 * D },
  { unit: 'day', n: 7, ms: 7 * D },
  { unit: 'month', n: 1, ms: 30 * D },
  { unit: 'month', n: 3, ms: 91 * D },
  { unit: 'month', n: 6, ms: 182 * D },
  { unit: 'year', n: 1, ms: 365 * D },
];

export class TimeScale implements Scale {
  readonly type = 'time';
  readonly band = 0;
  constructor(readonly d0: number, readonly d1: number, private locale?: string) {
    if (d0 === d1) this.d1 = d0 + D;
  }
  norm(v: number): number {
    return (v - this.d0) / (this.d1 - this.d0);
  }
  invert(t: number): number {
    return this.d0 + t * (this.d1 - this.d0);
  }
  private fmt(opts: Intl.DateTimeFormatOptions): (v: number) => string {
    const f = new Intl.DateTimeFormat(this.locale, opts);
    return (v) => f.format(v);
  }
  ticks(t0: number, t1: number, count: number): Tick[] {
    const lo = this.invert(Math.min(t0, t1));
    const hi = this.invert(Math.max(t0, t1));
    // Accept an interval slightly finer than the ideal one: a few more ticks read better than too few.
    const target = ((hi - lo) / Math.max(1, count)) * 0.7;
    const out: Tick[] = [];
    const push = (v: number, label: string) => {
      if (v >= lo - 1 && v <= hi + 1) out.push({ t: this.norm(v), label });
    };

    const fixed = FIXED.find((s) => s >= target);
    if (fixed && target <= 12 * H) {
      const off = -new Date(lo).getTimezoneOffset() * M;
      const time = this.fmt(fixed < M ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
      const day = this.fmt({ day: 'numeric', month: 'short' });
      for (let v = Math.ceil((lo + off) / fixed) * fixed - off; v <= hi; v += fixed) {
        const d = new Date(v);
        const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
        push(v, midnight ? day(v) : time(v));
      }
      return out;
    }

    const cal = CALENDAR.find((c) => c.ms >= target);
    if (cal && cal.unit === 'day') {
      const day = this.fmt({ day: 'numeric', month: 'short' });
      const d = new Date(lo);
      d.setHours(0, 0, 0, 0);
      for (let guard = 0; d.getTime() <= hi && guard < 1000; guard++) {
        push(d.getTime(), day(d.getTime()));
        d.setDate(d.getDate() + cal.n);
      }
      return out;
    }
    if (cal && cal.unit === 'month') {
      const month = this.fmt({ month: 'short' });
      const monthYear = this.fmt({ month: 'short', year: 'numeric' });
      const d = new Date(lo);
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      d.setMonth(Math.floor(d.getMonth() / cal.n) * cal.n);
      let first = true;
      for (let guard = 0; d.getTime() <= hi && guard < 1000; guard++) {
        const v = d.getTime();
        if (v >= lo - 1) {
          push(v, first || d.getMonth() === 0 ? monthYear(v) : month(v));
          first = false;
        }
        d.setMonth(d.getMonth() + cal.n);
      }
      return out;
    }
    const years = Math.max(1, niceStep((hi - lo) / (365 * D), count));
    const d = new Date(lo);
    d.setHours(0, 0, 0, 0);
    d.setMonth(0, 1);
    d.setFullYear(Math.floor(d.getFullYear() / years) * years);
    for (let guard = 0; d.getTime() <= hi && guard < 1000; guard++) {
      push(d.getTime(), String(d.getFullYear()));
      d.setFullYear(d.getFullYear() + years);
    }
    return out;
  }
  format(v: number): string {
    const d = new Date(v);
    const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
    return this.fmt(
      midnight
        ? { day: 'numeric', month: 'short', year: 'numeric' }
        : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    )(v);
  }
}

export class BandScale implements Scale {
  readonly type = 'band';
  readonly band: number;
  private step: number;
  private outer: number;
  constructor(readonly categories: string[], paddingInner = 0.3, paddingOuter = 0.15) {
    const n = Math.max(1, categories.length);
    this.step = 1 / (n - paddingInner + 2 * paddingOuter);
    this.band = this.step * (1 - paddingInner);
    this.outer = paddingOuter * this.step;
  }
  norm(index: number): number {
    return this.outer + index * this.step + this.band / 2;
  }
  invert(t: number): number {
    const i = Math.round((t - this.outer - this.band / 2) / this.step);
    return Math.min(this.categories.length - 1, Math.max(0, i));
  }
  ticks(t0: number, t1: number): Tick[] {
    const out: Tick[] = [];
    this.categories.forEach((label, i) => {
      const t = this.norm(i);
      if (t >= t0 - 1e-9 && t <= t1 + 1e-9) out.push({ t, label });
    });
    return out;
  }
  format(index: number): string {
    return this.categories[index] ?? '';
  }
}
