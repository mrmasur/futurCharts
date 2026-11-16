export { Chart } from './chart/chart';
export type { ChartOptions, ChartEvents, HoverItem, TooltipContext } from './chart/chart';

export { chart, ChartBuilder } from './spec/builder';
export type * from './spec/types';

export { Table } from './data/table';
export type { DataInput, Column, ColumnType, Row } from './data/table';

export { lightTheme, darkTheme, registerTheme, resolveTheme } from './theme/theme';
export type { Theme, ThemeSpec } from './theme/theme';

export { registerMark, getMark, buildHit } from './marks/registry';
export type { MarkDefinition, BuildContext, BuiltMark, HitData } from './marks/registry';
export type { LayerData, SeriesData } from './marks/prepare';
export { curvePoints } from './marks/curve';

export { createRenderer, WebGL2Renderer, LAYOUTS, SHAPES } from './render';
export type {
  Renderer,
  RendererFactory,
  RendererChoice,
  Batch,
  DrawCall,
  Frame,
  PrimitiveKind,
  ViewTransform,
  RGBA,
} from './render';

export { LinearScale, LogScale, TimeScale, BandScale, niceDomain, niceStep } from './scale/scales';
export type { Scale, Tick } from './scale/scales';

export { parseColor } from './util/color';
export { numberFormatter } from './util/format';
export type { FormatSpec } from './util/format';
