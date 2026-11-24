/**
 * The tooltip: a DOM `<div>` over the chart. Its content (the default one, or the
 * app's `ChartOptions.tooltip`) and its place beside the pointer.
 */
import type { ChartSpec } from '../spec/types';
import { numberFormatter } from '../util/format';
import type { ChartOptions, TooltipContext } from './types';

/**
 * Style the tooltip after the theme and fill it for `context`. Returns false when there
 * is nothing to show (the app's `tooltip` returned null).
 */
export function fillTooltip(tip: HTMLDivElement, context: TooltipContext, spec: ChartSpec, options: ChartOptions): boolean {
  const { theme } = context;
  const t = theme.tooltip;
  Object.assign(tip.style, {
    background: t.background,
    color: t.color,
    border: `1px solid ${t.border}`,
    borderRadius: `${t.radius}px`,
    padding: `${t.padding}px`,
    boxShadow: t.shadow,
    font: `${t.fontSize}px ${theme.font.family}`,
  });

  const content = options.tooltip?.(context);
  if (options.tooltip) {
    if (content === null || content === undefined) return false;
    if (typeof content === 'string') tip.innerHTML = content;
    else tip.replaceChildren(content);
  } else {
    tip.replaceChildren(defaultTooltip(context, spec));
  }
  return true;
}

/** Top-left corner of a `w` × `h` tooltip beside the pointer `p`, flipped to stay inside a `width` × `height` chart. */
export function tooltipPosition(p: { x: number; y: number }, w: number, h: number, width: number, height: number): { x: number; y: number } {
  let x = p.x + 14;
  let y = p.y - h - 10;
  if (x + w > width - 4) x = p.x - w - 14;
  if (y < 4) y = Math.min(height - h - 4, p.y + 14);
  return { x: Math.max(4, x), y: Math.max(4, y) };
}

export function defaultTooltip(c: TooltipContext, spec: ChartSpec): HTMLElement {
  const t = c.theme.tooltip;
  const fields = spec.fields ?? {};
  const box = document.createElement('div');
  const head = document.createElement('div');
  head.textContent = c.title;
  head.style.cssText = `font-weight:600;margin-bottom:6px;`;
  box.appendChild(head);
  const row = (label: string, value: string, color?: string) => {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;gap:8px;line-height:1.6;';
    if (color) {
      const sw = document.createElement('span');
      sw.style.cssText = `width:8px;height:8px;border-radius:2px;background:${color};flex:none;`;
      r.appendChild(sw);
    }
    const l = document.createElement('span');
    l.textContent = label;
    l.style.cssText = `color:${t.muted};flex:1;`;
    const v = document.createElement('span');
    v.textContent = value;
    v.style.cssText = 'font-weight:600;font-variant-numeric:tabular-nums;margin-left:12px;';
    r.append(l, v);
    box.appendChild(r);
  };
  if (c.shape) {
    for (const r of c.shape.rows) row(r.label, r.value);
    if (c.shape.rows.length === 0) head.style.marginBottom = '0';
    return box;
  }
  if (c.mode === 'nearest') {
    // One mark: list its encoded fields, with the catalog labels.
    const it = c.items[0];
    const enc = spec.layers[it.layer].encode;
    const label = (f: string) => fields[f]?.label ?? f;
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.gap = '8px';
    const sw = document.createElement('span');
    sw.style.cssText = `width:8px;height:8px;border-radius:50%;background:${it.color};`;
    head.prepend(sw);
    row(label(enc.x ?? ''), it.xLabel);
    row(label(enc.y ?? ''), it.valueLabel);
    for (const f of [enc.size, enc.color]) {
      if (!f || f === enc.x || f === enc.y) continue;
      const v = it.row[f];
      if (typeof v === 'number') row(label(f), numberFormatter(fields[f]?.format)(v));
    }
  } else {
    for (const it of c.items) row(it.series, it.valueLabel, it.color);
  }
  return box;
}
