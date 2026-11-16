import type { RGBA } from '../render/types';

const cache = new Map<string, RGBA>();
let probe: CanvasRenderingContext2D | null | undefined;

function parseHex(hex: string): RGBA | null {
  const h = hex.slice(1);
  if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/i.test(h)) return null;
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), full.length === 8 ? n(6) : 1];
}

function parseFunc(input: string): RGBA | null {
  const m = /^rgba?\(([^)]+)\)$/i.exec(input);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const ch = (s: string) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / 255);
  const al = (s: string | undefined) =>
    s === undefined ? 1 : s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
  return [ch(parts[0]), ch(parts[1]), ch(parts[2]), al(parts[3])];
}

/** Parse any CSS color into linear-free sRGB floats in [0, 1]. */
export function parseColor(input: string): RGBA {
  const key = input.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  let out: RGBA | null = null;
  if (key === 'transparent') out = [0, 0, 0, 0];
  else if (key.startsWith('#')) out = parseHex(key);
  else out = parseFunc(key);
  if (!out && typeof document !== 'undefined') {
    // Named colors, hsl(), oklch()…: let the browser normalize them.
    if (probe === undefined) probe = document.createElement('canvas').getContext('2d');
    if (probe) {
      probe.fillStyle = '#000';
      probe.fillStyle = key;
      const norm = String(probe.fillStyle);
      out = norm.startsWith('#') ? parseHex(norm) : parseFunc(norm);
    }
  }
  if (!out) out = [0, 0, 0, 1];
  cache.set(key, out);
  return out;
}

export function withAlpha(c: RGBA, alpha: number): RGBA {
  return [c[0], c[1], c[2], c[3] * alpha];
}

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

/** Sample a multi-stop ramp at t in [0, 1]. */
export function sampleRamp(stops: RGBA[], t: number): RGBA {
  if (stops.length === 1) return stops[0];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

export function toCss(c: RGBA): string {
  const b = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${b(c[0])},${b(c[1])},${b(c[2])},${+c[3].toFixed(3)})`;
}
