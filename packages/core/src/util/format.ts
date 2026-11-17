/** Serializable number format (lives in the spec, so no functions). */
export interface FormatSpec {
  style?: 'decimal' | 'percent' | 'currency' | 'compact';
  currency?: string;
  /** Fixed number of fraction digits. */
  decimals?: number;
  prefix?: string;
  suffix?: string;
  locale?: string;
  /** Show magnitudes only (a population pyramid draws men as negatives). */
  absolute?: boolean;
}

export interface FormatHint {
  /** Largest absolute value on the axis. */
  max?: number;
  /** Tick step, used to pick the number of decimals. */
  step?: number;
  /** Axis ticks get compact notation from 10K up; tooltips stay exact. */
  axis?: boolean;
}

export function numberFormatter(spec: FormatSpec | undefined, hint: FormatHint = {}): (v: number) => string {
  const s = spec ?? {};
  const opts: Intl.NumberFormatOptions = {};
  let style = s.style;
  if (!style && hint.axis && (hint.max ?? 0) >= 10000) style = 'compact';
  if (style === 'percent') opts.style = 'percent';
  if (style === 'currency') {
    opts.style = 'currency';
    opts.currency = s.currency ?? 'EUR';
    if (hint.axis && (hint.max ?? 0) >= 10000) opts.notation = 'compact';
  }
  if (style === 'compact') opts.notation = 'compact';

  if (s.decimals !== undefined) {
    opts.minimumFractionDigits = s.decimals;
    opts.maximumFractionDigits = s.decimals;
  } else if (opts.notation === 'compact') {
    opts.maximumFractionDigits = 1;
  } else if (hint.axis && hint.step) {
    const scale = style === 'percent' ? 100 : 1;
    const d = Math.min(6, Math.max(0, -Math.floor(Math.log10(hint.step * scale) + 1e-9)));
    opts.minimumFractionDigits = style === 'currency' ? undefined : d;
    opts.maximumFractionDigits = Math.max(d, style === 'currency' ? 0 : d);
    if (style === 'currency' && d === 0) opts.maximumFractionDigits = 0;
  } else {
    opts.maximumFractionDigits = 2;
  }
  const nf = new Intl.NumberFormat(s.locale, opts);
  const pre = s.prefix ?? '';
  const suf = s.suffix ?? '';
  return (v) => (Number.isFinite(v) ? pre + nf.format(s.absolute ? Math.abs(v) : v) + suf : '–');
}
