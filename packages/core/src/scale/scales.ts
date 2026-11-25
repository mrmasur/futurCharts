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

/**
 * The same scale with its labels written by `fn` (graduations and `format`). Positions, domain and
 * type are untouched: only the text changes. The value of a tick is read back from its position,
 * rounded to 12 significant digits so that 0.30000000000000004 formats as 0.3.
 */
export function withFormatter<S extends Scale>(scale: S, fn: (v: number) => string): S {
  const out = Object.create(scale) as S;
  out.ticks = (t0, t1, count) => scale.ticks(t0, t1, count).map((t) => ({ ...t, label: fn(Number(scale.invert(t.t).toPrecision(12)) + 0) }));
  out.format = fn;
  return out;
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
  /** `exact`: keep the domain as given (an explicit one); otherwise it widens to whole powers of ten. */
  constructor(d0: number, d1: number, private fmt?: FormatSpec, exact = false) {
    const lo = Math.max(d0, Number.MIN_VALUE);
    if (exact && d1 > lo) {
      this.l0 = Math.log10(lo);
      this.l1 = Math.log10(d1);
      return;
    }
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
    // Over a short span (or zoomed in), 2 and 5 times each power of ten as well.
    const span = (this.l1 - this.l0) * (t1 - t0);
    const steps = span <= 1.2 ? [1, 2, 5] : span <= 2.5 ? [1, 3] : [1];
    for (let e = Math.floor(this.l0); e <= Math.ceil(this.l1); e++) {
      for (const m of steps) {
        const t = (Math.log10(m) + e - this.l0) / (this.l1 - this.l0);
        if (t >= t0 - 1e-9 && t <= t1 + 1e-9) out.push({ t, label: f(m * Math.pow(10, e)) });
      }
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
  /** `reverse` puts the first category at the far end: at the top of a y axis. */
  constructor(readonly categories: string[], paddingInner = 0.3, paddingOuter = 0.15, private reverse = false) {
    const n = Math.max(1, categories.length);
    this.step = 1 / (n - paddingInner + 2 * paddingOuter);
    this.band = this.step * (1 - paddingInner);
    this.outer = paddingOuter * this.step;
  }
  norm(index: number): number {
    const t = this.outer + index * this.step + this.band / 2;
    return this.reverse ? 1 - t : t;
  }
  invert(t: number): number {
    const u = this.reverse ? 1 - t : t;
    const i = Math.round((u - this.outer - this.band / 2) / this.step);
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

/** Graduation steps of a session axis, finest first: every session, then calendar periods. */
const SESSION_STEPS: { unit: 'day' | 'week' | 'month' | 'year'; n: number }[] = [
  { unit: 'day', n: 1 },
  { unit: 'week', n: 1 },
  { unit: 'week', n: 2 },
  { unit: 'month', n: 1 },
  { unit: 'month', n: 3 },
  { unit: 'month', n: 6 },
  { unit: 'year', n: 1 },
  { unit: 'year', n: 2 },
  { unit: 'year', n: 5 },
  { unit: 'year', n: 10 },
];

/**
 * Graduations of an ordinal axis of dates (trading sessions: no room for the days without data).
 * `dates`: sorted epoch ms, one per position; `i0`..`i1`: the visible positions; `count`: about how
 * many graduations fit. The finest calendar step that fits is used: every session, the first
 * session of each week, of each month, quarter, half-year or year. Pure, so tested on its own.
 */
export function sessionTicks(dates: ArrayLike<number>, i0: number, i1: number, count: number, locale?: string): { index: number; label: string }[] {
  const lo = Math.max(0, Math.ceil(i0));
  const hi = Math.min(dates.length - 1, Math.floor(i1));
  if (hi < lo) return [];
  const max = Math.max(1, Math.floor(count));
  // The calendar period a date falls in, for each step (local time, weeks from Monday).
  const period = (v: number, unit: 'day' | 'week' | 'month' | 'year', n: number): number => {
    const d = new Date(v);
    if (unit === 'year') return Math.floor(d.getFullYear() / n);
    if (unit === 'month') return Math.floor((d.getFullYear() * 12 + d.getMonth()) / n);
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - d.getTimezoneOffset() * M) / D);
    // 1970-01-01 was a Thursday: + 3 puts the week boundary on Mondays.
    return unit === 'week' ? Math.floor(Math.floor((days + 3) / 7) / n) : days;
  };
  // The very first session opens a period only when it sits at its start (nothing before it says so).
  const opens = (v: number, unit: 'day' | 'week' | 'month' | 'year'): boolean => {
    const d = new Date(v);
    if (unit === 'day') return true;
    if (unit === 'week') return d.getDay() === 1;
    return d.getDate() <= 4 && (unit === 'month' || d.getMonth() === 0);
  };
  let picked: number[] = [];
  let unit: 'day' | 'week' | 'month' | 'year' = 'day';
  for (const step of SESSION_STEPS) {
    picked = [];
    unit = step.unit;
    for (let i = lo; i <= hi; i++) {
      const starts = i === 0 ? opens(dates[0], step.unit) && period(dates[0], step.unit, step.n) * step.n === period(dates[0], step.unit, 1) : period(dates[i], step.unit, step.n) !== period(dates[i - 1], step.unit, step.n);
      if (starts) picked.push(i);
    }
    if (picked.length <= max) break;
  }
  // Decades of sessions: thin what is left.
  if (picked.length > max) {
    const every = Math.ceil(picked.length / max);
    picked = picked.filter((_, k) => k % every === 0);
  }
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    const f = new Intl.DateTimeFormat(locale, o);
    return (v: number) => f.format(v);
  };
  const day = fmt({ day: 'numeric', month: 'short' });
  const month = fmt({ month: 'short' });
  const monthYear = fmt({ month: 'short', year: 'numeric' });
  return picked.map((index, k) => {
    const v = dates[index];
    const d = new Date(v);
    const label = unit === 'year' ? String(d.getFullYear()) : unit === 'month' ? (k === 0 || d.getMonth() === 0 ? monthYear(v) : month(v)) : day(v);
    return { index, label };
  });
}

/**
 * A band axis of dates: one band per date present in the data, in order, with no room for the
 * missing ones (week-ends and holidays of a price chart). Graduations are calendar ones.
 */
export class DateBandScale extends BandScale {
  constructor(readonly dates: number[], paddingInner = 0.3, paddingOuter = 0.15, reverse = false, private locale?: string) {
    super(dates.map(String), paddingInner, paddingOuter, reverse);
  }
  override ticks(t0: number, t1: number, count = 8): Tick[] {
    // Visible positions: bands whose center is in view.
    let i0 = Infinity;
    let i1 = -Infinity;
    const lo = Math.min(t0, t1) - 1e-9;
    const hi = Math.max(t0, t1) + 1e-9;
    for (let i = 0; i < this.dates.length; i++) {
      const t = this.norm(i);
      if (t < lo || t > hi) continue;
      if (i < i0) i0 = i;
      if (i > i1) i1 = i;
    }
    // Like the time scale, accept a step slightly finer than the ideal one: date labels are short,
    // and the axis leaves out a label that would touch its neighbour.
    return sessionTicks(this.dates, i0, i1, Math.ceil(count / 0.7), this.locale).map((k) => ({ t: this.norm(k.index), label: k.label }));
  }
  override format(index: number): string {
    const v = this.dates[index];
    if (v === undefined) return '';
    const d = new Date(v);
    const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
    return new Intl.DateTimeFormat(
      this.locale,
      midnight ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    ).format(v);
  }
}

const MAX_LAT = 85.0511;
const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 360));

/**
 * Latitude under the Mercator projection. Mercator is separable (x depends
 * only on longitude, y only on latitude), so a map is just two scales and the
 * whole zoom / GPU transform machinery applies unchanged.
 */
export class MercatorScale implements Scale {
  readonly type = 'linear';
  readonly band = 0;
  private m0: number;
  /** Projected height of the domain, in the same unit as longitude in radians. */
  readonly span: number;
  constructor(lat0: number, lat1: number) {
    this.m0 = mercator(lat0);
    this.span = mercator(lat1) - this.m0 || 1;
  }
  norm(lat: number): number {
    return (mercator(lat) - this.m0) / this.span;
  }
  invert(t: number): number {
    return ((2 * Math.atan(Math.exp(this.m0 + t * this.span)) - Math.PI / 2) * 180) / Math.PI;
  }
  ticks(): Tick[] {
    return [];
  }
  format(lat: number): string {
    return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}`;
  }
}
