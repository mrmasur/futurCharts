/**
 * Types shared by the modules of `Chart`: the public ones (events, options, hover items)
 * and the internal state the modules pass to each other (built layers, layout, zoom).
 */
import type { Row } from '../data/table';
import type { LayerData } from '../marks/prepare';
import type { BuiltMark, MarkDefinition, MarkDraw, ShapeHit } from '../marks/registry';
import type { RendererChoice } from '../render';
import type { ClipRect, RGBA, ViewTransform } from '../render/types';
import type { Tick } from '../scale/scales';
import type { Theme } from '../theme/theme';

export interface HoverItem {
  layer: number;
  series: string;
  /** Raw x: number, Date, or category. */
  x: number | string | Date;
  xLabel: string;
  value: number;
  valueLabel: string;
  color: string;
  row: Row;
}

/** The current selection, as rows of each layer's table (what a cross-filter needs). */
export interface SelectionPayload {
  count: number;
  layers: { layer: number; rows: Int32Array }[];
  /** Describe the selected marks; capped, since a lasso can hold hundreds of thousands. */
  items(limit?: number): HoverItem[];
}

export interface TooltipContext {
  mode: 'x' | 'nearest';
  title: string;
  items: HoverItem[];
  /** Set instead of `items` when the pointer is over a shape (a country on a map). */
  shape?: ShapeHit;
  theme: Theme;
}

export interface ChartOptions {
  /** `auto` (default), `webgl2`, or your own factory (a WebGPU backend plugs in here). */
  renderer?: RendererChoice;
  /** Replace the tooltip content. Return an element, an HTML string, or null to hide. */
  tooltip?: (ctx: TooltipContext) => HTMLElement | string | null;
  devicePixelRatio?: number;
}

export interface ChartEvents {
  hover: { items: HoverItem[]; x: number; y: number };
  leave: {};
  click: { items: HoverItem[]; x: number; y: number };
  zoom: { kx: number; ky: number; tx: number; ty: number };
  legend: { series: string; hidden: boolean };
  select: SelectionPayload;
  /** A drill-down mark (sunburst, rose) changed its focus. `path` is empty when back to everything. */
  drill: { layer: number; path: string[] };
  /** A datum with a link (`layer.link`) was clicked. */
  link: { url: string; row: Row; layer: number };
  /** A time-driven chart (bar chart race) reached a new frame. */
  frame: { index: number; label: string };
  /** Boxes of a diagram were moved by hand: every position, to save as `x` / `y` in the spec. */
  layout: { layer: number; positions: Record<string, { x: number; y: number }> };
}

/** Zoom (`kx`, `ky`, 1 = everything shows) and pan (`tx`, `ty`) of the view, in normalized scale space. */
export interface Zoom {
  kx: number;
  ky: number;
  tx: number;
  ty: number;
}

export interface LegendEntry {
  key: string;
  color: RGBA;
  /** Second half of the swatch (candlesticks: falling color beside the rising one). */
  color2?: RGBA;
  symbol: MarkDefinition['symbol'];
  rect?: ClipRect;
}

/** A layer once built: its prepared data, its mark definition and what the mark produced. */
export interface Built {
  data: LayerData;
  def: MarkDefinition;
  mark: BuiltMark;
  /** Selected datums of this layer, and the batches that redraw them at full strength. */
  sel?: { mask: Uint8Array; count: number; draws: MarkDraw[] };
}

export interface Point {
  x: number;
  y: number;
}

/** A datum under the pointer: its layer and its index in that layer's `HitData`. */
export interface Picked {
  layer: number;
  index: number;
}

export interface Layout {
  /** Area the marks may draw in. */
  plot: ClipRect;
  /** Rectangle the unzoomed scale space maps to: the plot, or a letterboxed part of it when an aspect ratio is imposed. */
  view: ClipRect;
  titleY: number;
  legendY: number;
  xTicks: Tick[];
  yTicks: Tick[];
  /** Graduations of the secondary value axis (dual-axis charts), in the same normalized space as the primary ones. */
  ticks2: Tick[];
  transform: ViewTransform;
}

/** A canvas font string. */
export const font = (weight: number | string, size: number, family: string) => `${weight} ${size}px ${family}`;

/** Whether the size of the view changes what a layer builds (treemap, diagrams). */
export const sizeDependent = (b: Pick<Built, 'data' | 'def'>) =>
  typeof b.def.sizeDependent === 'function' ? b.def.sizeDependent(b.data.layer) : !!b.def.sizeDependent;
