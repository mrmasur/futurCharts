import type { PointShape } from '../render/layouts';
import { deepMerge, type DeepPartial } from '../util/merge';
import { frenchTexts } from './texts';

export interface LineStyle {
  visible: boolean;
  color: string;
  width: number;
}

export interface TextStyle {
  color: string;
  size: number;
  weight: number | string;
}

/** One column of the `table` mark (plain JSON, in `style.cols`). */
export interface TableColumn {
  /** Field shown in the column (not needed by `rank`). */
  field?: string;
  /** Column title; defaults to the catalog label of the field. */
  label?: string;
  /**
   * How a cell is drawn: `text`, `number` (catalog format), `bar` (a bar from zero, negative values the other way),
   * `heat` (background shaded by the value), `change` (▲▼ in the good or bad color), `status` (a dot colored by the
   * category), `rating` (filled and empty dots or stars), `rank` (position of the row after sorting).
   * Default: `text` for a string field, `number` otherwise.
   */
  type?: 'text' | 'number' | 'bar' | 'heat' | 'change' | 'status' | 'rating' | 'rank';
  align?: 'left' | 'right' | 'center';
  /** Fixed width, px (default: what the content needs). */
  width?: number;
  /** Lower stays longer on a narrow screen (default: the position of the column; the first one goes last). */
  priority?: number;
  /** `rating`: number of dots or stars (default 5). */
  max?: number;
  /** `rating`: `dots` (default) or `stars`. */
  shape?: 'dots' | 'stars';
  /** `status`: color per value: `good`, `bad`, `warn`, a theme token (`$2`, `$muted`) or a CSS color. */
  colors?: Record<string, string>;
  /** `heat`: one hue below zero, another above, instead of the sequential ramp. */
  diverging?: boolean;
  /** `change`, `bar`: a rise is bad news in this column (costs, delays): positive bars take the bad color, negative ones the good color. */
  downIsGood?: boolean;
  /** Total row: `sum`, `mean` or `none` (default: `sum` for `number`, `bar` and `heat`). */
  total?: 'sum' | 'mean' | 'none';
}

/**
 * Every visual decision of a chart lives here. A spec can override any leaf
 * (`theme: { extends: 'dark', marks: { bar: { radius: 0 } } }`), and each layer
 * can override its own mark style again.
 */
export interface Theme {
  name: string;
  /** Chart surface. `transparent` lets the host page show through. */
  background: string;
  /** Outer padding around the whole chart, px. */
  padding: number;
  font: { family: string; size: number };
  text: { primary: string; secondary: string; muted: string };
  palette: {
    /** Fixed order: a series keeps its slot whatever is filtered. */
    categorical: string[];
    /** One hue, light to dark, for magnitude. */
    sequential: string[];
  };
  title: TextStyle & { gap: number };
  subtitle: TextStyle;
  axis: {
    line: LineStyle;
    tick: LineStyle & { size: number };
    label: TextStyle & { padding: number };
    title: TextStyle & { padding: number };
  };
  grid: { x: LineStyle; y: LineStyle };
  /** Default style of the labels drawn by the marks (each layer's `labels` wins over it). */
  labels: { color?: string; scale?: number; weight?: number; background?: string };
  legend: {
    visible: boolean;
    label: TextStyle;
    symbolSize: number;
    itemGap: number;
    /** Opacity of a series toggled off in the legend. */
    hiddenOpacity: number;
  };
  marks: {
    /** `endLabels`: the series name at the end of each line (direct labeling). */
    line: {
      width: number;
      curve: 'linear' | 'step' | 'smooth';
      opacity: number;
      endLabels: boolean;
      /** Dash pattern in px, e.g. `[6, 5]` (a forecast, a target). Empty: solid. */
      dash: number[];
      /** A dot on every data point. */
      markers: boolean;
      /** The value above every point: for short series, or with `highlight` on a few. */
      labels: boolean;
      /** Join across missing values instead of leaving a gap. */
      connectNulls: boolean;
      /** Color each stretch of line by its height (the sequential ramp, low to high). */
      colorByValue: boolean;
    };
    bar: {
      /** Radius of the data end, px. The baseline end stays square. */
      radius: number;
      /** Surface gap between touching bars and stacked segments, px. */
      gap: number;
      /** Cap on bar thickness, px (0 = fill the band). */
      maxWidth: number;
      /** Share of the band left empty between categories. */
      bandPadding: number;
      opacity: number;
      strokeWidth: number;
      stroke: string;
      /** Value label at the end of each bar (inside each segment when stacked). */
      labels: boolean;
      /** Exact bar thickness in px (0 = from the band). Wins over `maxWidth`; never wider than the band. */
      thickness: number;
      /** A full-length track behind each bar (`auto`: the grid color; empty: none). */
      track: string;
    };
    point: {
      size: number;
      shape: PointShape;
      opacity: number;
      /** Ring width, px. */
      strokeWidth: number;
      /** `surface` uses the chart background, so overlapping dots stay readable. */
      stroke: string;
      /** Size range in px when `size` is bound to a field. */
      sizeRange: [number, number];
      /** Spread dots across their category slot (share of it, 0–1), so that equal values stay visible. */
      jitter: number;
      /** Rings pulsing out of the dots (only the highlighted ones when the layer has a `highlight`). */
      pulse: boolean;
    };
    rule: { width: number; opacity: number };
    /** `length`: share of the category slot; `maxWidth`: cap in px (0 = none), to match a capped bar. */
    tick: { width: number; length: number; maxWidth: number; opacity: number };
    /**
     * `circles`: a dot per cell sized by the value (punch card) instead of a filled cell.
     * `diverging`: colors from one hue (negative) through neutral (0) to another (positive), symmetric around zero (correlations).
     * `colorLegend`: the color ramp with its two ends in the legend.
     */
    heatmap: { radius: number; labels: boolean; gap: number; circles: boolean; diverging: boolean; colorLegend: boolean };
    /** Globe: `layer.geo` outlines, points (`x` lon, `y` lat) and routes (to `x2`, `y2`). Drag to turn; `spin` until then. */
    globe: { spin: boolean; size: number; graticule: boolean; ocean: string; land: string };
    /** Scatter plot matrix: every pair of `path` fields, histograms on the diagonal. `size`: dot px. */
    splom: { size: number; opacity: number; bins: number };
    /** 3D scatter (`x`, `y`, `z`): drag to turn it; `spin` turns it on its own until then. `size`: dot px. */
    scatter3d: { size: number; opacity: number; spin: boolean; perspective: number };
    /** Cells on rings: `x` around the circle, `y` from the center out. `innerRadius`: share left empty. */
    polarHeatmap: { innerRadius: number; gap: number; labels: boolean };
    /** Pie and donut. `gap`: px separator between slices; `innerRadius`: share of the radius (donut). */
    arc: {
      innerRadius: number;
      gap: number;
      labels: boolean;
      center: boolean;
      /** Where the circle starts and ends, in degrees clockwise from 12 o'clock: `-90` and `90` make a half donut. */
      startAngle: number;
      endAngle: number;
      /** Rounded corners on every slice, px. */
      cornerRadius: number;
    };
    /** `ellipsis`: a name too long for its tile is cut with "…" instead of being left out. */
    treemap: { gap: number; radius: number; labels: boolean; header: number; ellipsis: boolean };
    funnel: { gap: number; radius: number; labels: boolean; connector: number };
    /** `thickness`: share of the radius. `track`: empty part of the arc (`auto` follows the grid color). */
    gauge: {
      min: number;
      max: number;
      thickness: number;
      track: string;
      target: number;
      /** Opening of the dial in degrees (180: half circle, 240: speedometer). */
      sweep: number;
      /** Colored zones along the dial, each up to a value (`[{ "to": 60, "color": "#e34948" }, …]`); the value then shows as a needle. */
      zones: { to: number; color: string }[];
      /** A needle pointing at the value. */
      needle: boolean;
      /** Graduations: this many intervals, labelled (0: none). */
      ticks: number;
      /** Round ends on the arcs. */
      rounded: boolean;
    };
    radar: { levels: number; fillOpacity: number; width: number; points: boolean };
    /** px sizes; `linkOpacity` applies to the flows. */
    sankey: { nodeWidth: number; nodePadding: number; linkOpacity: number; radius: number; labels: boolean };
    /** `innerRadius`: share of the radius left empty in the middle; `gap`: px between segments. */
    sunburst: { innerRadius: number; gap: number; labels: boolean };
    /** `empty`: color of days without data (`auto` follows the grid). */
    /** `direction`: weeks across (LR) or down (TB); by default, down when the chart is narrow (a phone). */
    calendar: { radius: number; gap: number; empty: string; direction?: 'LR' | 'TB' };
    /** Stat tile: last value, change against the previous one, sparkline. */
    kpi: { upIsGood: boolean; sparkline: boolean; good: string; bad: string; size: number };
    /** 10 × 10 grid of squares: one per percent. */
    waffle: { rows: number; columns: number; gap: number; radius: number };
    /** Polar bars (Nightingale rose): `levels` grid circles, `gap` px between wedges. */
    rose: { levels: number; gap: number; innerRadius: number; labels: boolean };
    /**
     * `width`: share of the category slot at the widest density; `box`: quartile box and median inside;
     * `scale`: `width` gives every violin the full width (shapes compare), `area` keeps densities comparable across categories.
     */
    violin: { width: number; fillOpacity: number; strokeWidth: number; box: boolean; samples: number; scale: 'width' | 'area' };
    /**
     * Flow diagrams. `variant`: `pipeline` (small glyphs, thin curves, labels under) or `boxes` (boxes and
     * arrows). `direction`: LR or TB. Sizes in px at 100 %; the diagram is scaled to fit.
     * `edge`: link color (`auto` follows the muted ink). `tint`: how much of the node color fills a box.
     */
    /** Bar chart race: `top` bars shown, `duration` ms per frame, start on its own, start over at the end. */
    race: { top: number; duration: number; autoplay: boolean; loop: boolean };
    /** Animated scatter (one frame per `time`): ms per frame, trails behind highlighted points. */
    motion: { duration: number; autoplay: boolean; loop: boolean; opacity: number; trails: boolean };
    /** Cross table: cells shaded by magnitude, a total and a sparkline per row. */
    pivot: { heat: boolean; totals: boolean; sparkline: boolean };
    /** Stacked densities: `overlap` rows a peak reaches up, `bandwidth` of the kernel (0: automatic). */
    ridgeline: { overlap: number; opacity: number; bandwidth: number };
    /** Dots that do not overlap: `size` px; `label`: field naming each dot in the tooltip. */
    beeswarm: { size: number; opacity: number; label: string };
    /** Stacked dot plot (Wilkinson): one dot per row along `x`, piled where values fall within a dot's width. */
    dotplot: {
      /** Largest dot diameter, px: the dots shrink from there until the tallest pile fits the height. */
      size: number;
      /** Smallest dot diameter, px: below it the piles are squeezed (dots overlap) instead. */
      minSize: number;
      /** Space left between neighbouring dots, px. */
      gap: number;
      /** Opacity of the dots. */
      opacity: number;
      /** `dotdensity`: piles centered on the values they hold (Wilkinson). `histodot`: fixed, evenly spaced bins. */
      binning: 'dotdensity' | 'histodot';
    };
    /** Empirical cumulative distribution: a staircase per `color`, the share of rows at or below each `x`. */
    ecdf: {
      /** Width of the curves, px. */
      width: number;
      /** Quantile levels (0 to 1) projected on both axes: 0.5 is the median, 0.9 the 90th percentile. `[]`: none. */
      quantiles: number[];
      /** Write the name of each quantile and its value at the foot of its marker. */
      labels: boolean;
      /** A dot on every step (small samples). */
      points: boolean;
    };
    /** Quantile-quantile plot: against the normal law (`x` alone) or between two samples (`x` and `y`). */
    qq: {
      /** Dot diameter, px. */
      size: number;
      /** Opacity of the dots. */
      opacity: number;
      /** Confidence band around the reference line (normal law only). */
      band: boolean;
      /** Confidence level of the band, 0 to 1. */
      level: number;
      /** Reference line: `auto` is the secondary ink (the group's color when there are several groups). */
      referenceColor: string;
      /** Width of the reference line, px. */
      referenceWidth: number;
      /** Dash of the reference line, px; `[]` for a solid line. */
      referenceDash: number[];
    };
    /** 2D density of a cloud of points in filled iso-density bands, one set per `color`. */
    contour: {
      /** Number of density levels (bands). */
      levels: number;
      /** Kernel width, as a multiple of the automatic one (Scott's rule): above 1 smoother, below 1 more detailed. */
      smoothing: number;
      /** Opacity of the densest band. */
      opacity: number;
      /** A line along each level. */
      lines: boolean;
      /** Draw the points themselves over the bands. */
      points: boolean;
      /** Diameter of those points, px. */
      size: number;
    };
    /** Raincloud: per `key`, a half violin (density of `x`), a slim box plot and every row as a dot below. */
    raincloud: {
      /** Opacity of the density shape. */
      opacity: number;
      /** Kernel bandwidth in data units (0: automatic, Silverman's rule). */
      bandwidth: number;
      /** Box plot (quartiles, median, whiskers at 1.5 interquartile ranges) under the density. */
      box: boolean;
      /** The rows as dots under the box. */
      points: boolean;
      /** Dot diameter, px. */
      size: number;
      /** How much of the room under the box the dots spread over, 0 (one line) to 1. */
      jitter: number;
    };
    /** Quadrant matrix: points (bubbles with `size`) in four tinted, named zones split by a threshold on each axis. */
    quadrant: {
      /** Threshold along x, in data units. `null`: the median of the values. */
      xThreshold: number | null;
      /** Threshold along y, in data units. `null`: the median of the values. */
      yThreshold: number | null;
      /** Names of the zones, in reading order: top-left, top-right, bottom-left, bottom-right. An empty name is not written. */
      quadrants: string[];
      /** Opacity of the tint of each zone, 0 (none) to 1. */
      tint: number;
      /** Point diameter without `encode.size`, px. */
      size: number;
      /** Smallest and largest bubble diameter with `encode.size`, px (area follows the value). */
      sizeRange: [number, number];
      /** Opacity of the points. */
      opacity: number;
      /** Name each point (`encode.key`) where a free place is found next to it. */
      labels: boolean;
    };
    /** Connected scatter: the path of an entity in the x / y plane, in the order of `encode.time`; one path per `color`. */
    connected: {
      /** Width of the segments, px. */
      width: number;
      /** Diameter of the dot of each step, px (the two ends are a little larger). */
      size: number;
      /** An arrow head in the middle of each segment long enough to carry it. */
      arrows: boolean;
      /** Length of the arrow heads, px. */
      arrowSize: number;
      /** Name the key steps: first, last, and the extremes along x and y. */
      labels: boolean;
    };
    /** Scatter with marginal histograms: distribution of `x` above the cloud, of `y` on its right, stacked by `color`. */
    marginal: {
      /** Point diameter, px. */
      size: number;
      /** Opacity of the points. */
      opacity: number;
      /** Approximate number of classes of each histogram (edges fall on round values of the axis). */
      bins: number;
      /** Part of the width and of the height given to the histograms, 0.05 to 0.45. */
      share: number;
      /** Space between two bars of a histogram, px. */
      gap: number;
      /** Corner radius at the end of the bars, px. */
      radius: number;
      /** Opacity of the bars. */
      fillOpacity: number;
      /** Write the highest count of the top histogram beside it. */
      labels: boolean;
    };
    /** Grid of tiles: hexagons (`hex`) or squares, `gap` px. */
    tilemap: { hex: boolean; gap: number; labels: boolean };
    /** Dorling cartogram: one circle per place, area by `value`, pushed apart from its neighbours. */
    dorling: {
      /** Share of the map's area covered by the circles (0–1): higher means larger circles, moved further. */
      coverage: number;
      /** Relaxation steps (fixed, so the layout is the same on every load). */
      iterations: number;
      /** px left between two touching circles. */
      gap: number;
      /** Name inside the circles large enough to hold it. */
      labels: boolean;
      /** Field holding the name written in a circle (default: `encode.key`). */
      label: string;
      /** Field holding a short name (a country code), used where the full one does not fit. */
      shortLabel: string;
      /** The value under the name, in the circles with room for two lines. */
      values: boolean;
      /** Fill opacity. */
      opacity: number;
      /** px of rim inside each circle, its fill pulled towards the ink (0: none); keeps circles apart from a basemap. */
      outline: number;
    };
    /** Pies on a map: one per place, its area by the total of its slices. */
    mapPie: {
      /** Diameters in px of the smallest and the largest pie. */
      sizeRange: [number, number];
      /** Share of the radius left empty in the middle (0: pies, 0.5: rings). */
      innerRadius: number;
      /** px separator between slices. */
      gap: number;
      /** px rim in the surface color around each pie, to detach it from the map. */
      outline: number;
      /** Name of the place under its pie. */
      labels: boolean;
      /** Fill opacity. */
      opacity: number;
    };
    /** Spike map: one thin triangle per place, as tall as its value. */
    spike: {
      /** Height of the tallest spike, px. */
      height: number;
      /** Width of a spike at its foot, px. */
      width: number;
      /** Fill opacity (fainter at the foot than at the tip). */
      opacity: number;
      /** Outline width, px (0: none). */
      strokeWidth: number;
      /** Name of the place (`encode.key`) at the tip of the tallest spikes. */
      labels: boolean;
      /** How many spikes get their name (the tallest ones). */
      top: number;
    };
    /** Small column charts on a map: one column per `color` value at each place, all on one scale. */
    mapBars: {
      /** Height of the tallest column of the map, px. */
      height: number;
      /** Width of a column, px. */
      thickness: number;
      /** px between two columns of a place. */
      gap: number;
      /** Corner radius at the top of a column, px. */
      radius: number;
      /** px rim in the surface color around each column. */
      outline: number;
      /** Name of the place under its columns. */
      labels: boolean;
      /** Fill opacity. */
      opacity: number;
    };
    /** Rows of symbols: one `icon` per `unit` of value, `gap` share of a symbol's slot. */
    pictorial: { unit: number; icon: PointShape; gap: number };
    /** Smooth color field over a grid with `contours` iso-lines (`auto` ink). */
    surface: { contours: number; contourColor: string };
    /** Horizon rows: `bands` folds, `gap` px between rows. */
    horizon: { bands: number; gap: number };
    /** Difference chart: `y` against `y2`, the area between them colored by which one is on top. */
    difference: {
      /** Opacity of the area between the two series. */
      opacity: number;
      /** Fill where `y` is above `y2` (`auto`: the KPI good color). */
      positive: string;
      /** Fill where `y` is below `y2` (`auto`: the KPI bad color). */
      negative: string;
      /** Legend entry of the positive fill ("Au-dessus du budget"); empty: none. */
      positiveLabel: string;
      /** Legend entry of the negative fill; empty: none. */
      negativeLabel: string;
      /** Width of the `y` line, px. */
      width: number;
      /** How both lines join their points. */
      curve: 'linear' | 'step' | 'smooth';
      /** Color of the `y2` line (`auto`: the muted ink). */
      referenceColor: string;
      /** Width of the `y2` line, px. */
      referenceWidth: number;
      /** Dash of the `y2` line, px; `[]` for a solid line. */
      referenceDash: number[];
    };
    /** Fan chart: history, then nested quantile bands around the forecast median. */
    fan: {
      /** Opacity of the narrowest band; wider bands are lighter in proportion. */
      opacity: number;
      /** Width of the history line, px. */
      width: number;
      /** How lines and band edges join their points. */
      curve: 'linear' | 'step' | 'smooth';
      /** Quantile levels computed when several `y` share an `x` and there is no `encode.key` (paired from the outside in). */
      quantiles: number[];
      /** Width of the median line, px. */
      medianWidth: number;
      /** Dash of the median line, px; `[]` for a solid line. */
      medianDash: number[];
      /** Start the bands at the last actual point, from zero width. */
      anchor: boolean;
    };
    /** Cycle plot: one panel per period, values year after year and their mean. */
    cycle: {
      /** Panels when `x` is a date: one per month, quarter, weekday or hour. */
      period: 'month' | 'quarter' | 'weekday' | 'hour';
      /** Rows falling in the same panel at the same position are summed or averaged. */
      aggregate: 'sum' | 'mean';
      /** Width of the lines, px. */
      width: number;
      /** Draw each panel's mean as a horizontal line. */
      mean: boolean;
      /** Width of the mean line, px. */
      meanWidth: number;
      /** Color of the mean line (`auto`: the primary ink; with several series, each one's own color). */
      meanColor: string;
      /** A dot on the latest value of each panel. */
      points: boolean;
      /** A faint card behind each panel. */
      panels: boolean;
      /** Share of a panel's width left empty on its sides. */
      inset: number;
      /** Start the value axis at zero. */
      zero: boolean;
    };
    /** Sparkline table: one row per entity with its latest value, change, sparkline and comparison bar. */
    sparktable: {
      /** Columns after the name, in order: `value`, `change`, `spark`, `bar` (the last ones go first on a narrow screen). */
      show: ('value' | 'change' | 'spark' | 'bar')[];
      /** Sparkline drawn as a line, a filled area or small columns. */
      spark: 'line' | 'area' | 'bar';
      /** The change compares the latest value with the previous one or with the first one. */
      change: 'previous' | 'first';
      /** Row order: as in the data, or by decreasing latest value or change. */
      sortBy: 'data' | 'value' | 'change';
      /** Whether a rise is good news (it picks the color of the change). */
      upIsGood: boolean;
      /** Color of a good change (`auto`: the KPI good color). */
      good: string;
      /** Color of a bad change (`auto`: the KPI bad color). */
      bad: string;
      /** Column titles above the rows. */
      headers: boolean;
      /** Tallest a row gets, px (rows shrink to fit, down to 20 px). */
      rowHeight: number;
      /** One value scale for every sparkline (levels compare) instead of one per row (shapes compare). */
      sharedScale: boolean;
    };
    /** Formatted data table (read only): one line per data row, each cell drawn by the type of its column. */
    table: {
      /** Columns, left to right: `{ field, label?, type?, align?, width?, priority? … }` (see `TableColumn`). Empty: every field. */
      cols: TableColumn[];
      /** Field the rows are sorted by at first ('' keeps the order of the data). */
      orderBy: string;
      /** Sort from the largest down. */
      descending: boolean;
      /** Shade one row in two instead of ruling a line under each. */
      zebra: boolean;
      /** A last row with the sum (or the mean) of the numeric columns, over every row. */
      total: boolean;
      /** Name of the total row, in the first column. */
      totalLabel: string;
      /** Column titles above the rows. */
      headers: boolean;
      /** Tallest a row gets, px (rows shrink to 22 px, then the last ones give way to "+ n lignes"). */
      rowHeight: number;
      /** Whether a rise is good news (it picks the color of `change` cells; a column can say otherwise). */
      upIsGood: boolean;
      /** Color of a good change or status (`auto`: the KPI good color). */
      good: string;
      /** Color of a bad change, a bad status or a negative bar (`auto`: the KPI bad color). */
      bad: string;
      /** Color of a status to watch and of rating stars. */
      warn: string;
    };
    /** Adjacency matrix: `source` in rows, `target` in columns, cells shaded by `value`, entities gathered by `group`. */
    matrix: {
      /** Space between two cells, px. */
      gap: number;
      /** Corner radius of a cell, px. */
      radius: number;
      /** The value in each cell, when it fits. */
      labels: boolean;
      /** Row totals as bars on the right, column totals as bars underneath. */
      totals: boolean;
      /** Order inside a group: as in the data, by decreasing total (sent + received) or by name. */
      ordering: 'data' | 'total' | 'name';
    };
    /** Confusion matrix of a classifier: actual class (`y`) in rows, predicted class (`x`) in columns. */
    confusion: {
      /** Space between two cells, px. */
      gap: number;
      /** Corner radius of a cell, px. */
      radius: number;
      /** Count (and share, when the cell is tall enough) in each cell. */
      labels: boolean;
      /** Recall per class on the right, precision per class underneath, accuracy in the corner. */
      margins: boolean;
      /** What a cell's share and shade are relative to: its actual class (row), its predicted class (column) or everything. */
      normalize: 'row' | 'column' | 'total';
      /** Color of the errors, off the diagonal (`auto`: the KPI bad color). */
      bad: string;
    };
    /** One month as a grid of weeks: day number, value and shade in each day. */
    calendarMonth: {
      /** Space between two days, px. */
      gap: number;
      /** Corner radius of a day, px. */
      radius: number;
      /** The value in each day, when it fits. */
      labels: boolean;
      /** First day of the week: 0 Sunday, 1 Monday… */
      weekStart: number;
      /** Month to show, `YYYY-MM` ('' for the latest month of the data). */
      month: string;
    };
    /** Bump area: ribbons as thick as the values, sorted at each step from the largest down. */
    bumpArea: {
      /** Opacity of the ribbons. */
      opacity: number;
      /** Space between two ribbons, px. */
      gap: number;
      /** Share of a step's width where ribbons stay flat (the rest is the crossing). */
      flat: number;
      /** Entity names at the right end of the ribbons. */
      labels: boolean;
    };
    /** Concentric bars around a center: `endAngle` degrees for the longest, `gap` share of a ring left empty. */
    /** `labelColor`: ink of the values, `auto` for the primary text color (they sit on the track, past the bar). */
    radialBar: { innerRadius: number; gap: number; endAngle: number; track: string; labels: boolean; labelColor: string };
    /** A series wound into a spiral, one turn per period, first datum at the center; `value` is the color, `size` thins the ribbon. */
    spiral: {
      /** What one turn is worth for `x` dates: a `year`, a `week` or a `day` (`auto`: from the span of the data). */
      turn: 'auto' | 'year' | 'week' | 'day';
      /** Rows per turn when `x` is not a date, or to force a period (0: by date, or 12). */
      turnCount: number;
      /** Share of the radius left empty at the center. */
      innerRadius: number;
      /** Space between two turns, px. */
      gap: number;
      /** Period graduations around, turn names up 12 o'clock, value range in the hole. */
      labels: boolean;
      /** Colors from one hue (negative) through neutral to another (positive) instead of the sequential ramp. */
      diverging: boolean;
    };
    /** Curves around a round graduated grid: `x` the angle (categories or a numeric cycle), `y` the radius. */
    polarLine: {
      /** Line width, px. */
      width: number;
      /** Bend the curve between the points instead of straight chords. */
      smooth: boolean;
      /** Join the last point back to the first. */
      closed: boolean;
      /** Opacity of the fill down to the center (0: lines only). */
      fillOpacity: number;
      /** A dot on every data point. */
      points: boolean;
      /** Number of graduated rings (fewer on a small chart). */
      levels: number;
      /** Value of a full turn of a numeric angle (360, 24…); 0: deduced from the data. */
      angleMax: number;
      /** Name the angles N, NE, E… when a turn is 360. */
      compass: boolean;
      /** Angle names around the circle and ring values. */
      labels: boolean;
    };
    /** Dots at angle `x` and radius `y`; `size` and `color` as on `point`. */
    polarScatter: {
      /** Dot diameter without a `size` field, px. */
      size: number;
      /** Smallest and largest diameter with a `size` field, px. */
      sizeRange: [number, number];
      /** Dot opacity: overlapping measures stay visible. */
      opacity: number;
      /** Number of graduated rings (fewer on a small chart). */
      levels: number;
      /** Value of a full turn of a numeric angle (360, 24…); 0: deduced from the data. */
      angleMax: number;
      /** Name the angles N, NE, E… when a turn is 360. */
      compass: boolean;
      /** Angle names around the circle and ring values. */
      labels: boolean;
    };
    /** Series stacked outwards around the circle (`layer.stack`: `center` for a radial stream, `normalize` for shares). */
    radialArea: {
      /** Share of the radius left empty at the center. */
      innerRadius: number;
      /** Fill opacity of the bands. */
      opacity: number;
      /** Bend the bands between the points instead of straight chords. */
      smooth: boolean;
      /** Width of the rim drawn on each band's outer edge, px (0: none). */
      width: number;
      /** Number of graduated rings (fewer on a small chart). */
      levels: number;
      /** Value of a full turn of a numeric angle (360, 24…); 0: deduced from the data. */
      angleMax: number;
      /** Name the angles N, NE, E… when a turn is 360. */
      compass: boolean;
      /** Angle names around the circle and ring values. */
      labels: boolean;
    };
    /** Bullet graph: per row, a measure bar and a target tick over qualitative ranges. */
    bullet: {
      /** Ends of the qualitative ranges, in the measure's unit, from poor to good (`[60, 85, 100]`); the same for every row. */
      ranges: number[];
      /** Fields holding each row's own range ends, in the same order (replaces `ranges`). */
      rangeFields: string[];
      /** Names of the ranges, shown in the tooltip (`["Insuffisant", "Correct", "Bon"]`). */
      rangeLabels: string[];
      /** Target of every row when there is no `encode.target` field. */
      target: number;
      /** One scale for every row (same unit) instead of one per row. */
      shared: boolean;
      /** Ranges in shades of the measure's color instead of grey. */
      tinted: boolean;
      /** Largest thickness of a row's band, px. */
      thickness: number;
      /** Graduations under the rows. */
      axis: boolean;
      /** Corner radius of the bands, px. */
      radius: number;
    };
    /** Liquid fill gauge: a container per row, filled to its value, the figure in the middle. */
    liquid: {
      /** Value of an empty container. */
      min: number;
      /** Value of a full container, without an `encode.target` field. */
      max: number;
      /** Shape of the container: a circle or a square with round corners. */
      container: 'circle' | 'rounded';
      /** Height of the wave, as a share of the container (0: flat surface). */
      amplitude: number;
      /** Number of waves across the container. */
      waves: number;
      /** Thickness of the outline, px (0: none). */
      border: number;
      /** Opacity of the container's color in its empty part. */
      wash: number;
      /** Color by level, each up to a value (`[{ "to": 20, "color": "#e34948" }, …]`). */
      zones: { to: number; color: string }[];
      /** Name (and value / capacity) under each container. */
      labels: boolean;
      /** Keep the wave moving (off by default: a still surface). */
      animated: boolean;
      /** Speed of the moving wave, radians per second. */
      speed: number;
    };
    /** Activity rings: one closed ring per goal reached. */
    activity: {
      /** Goal of every ring without an `encode.target` field. */
      max: number;
      /** Share of the radius left empty in the middle. */
      innerRadius: number;
      /** Share of a ring's slot left empty between rings. */
      gap: number;
      /** Color of the empty part of a ring (`auto`: the ring's own color, faded). */
      track: string;
      /** Round ends on the rings. */
      rounded: boolean;
      /** List of the indicators (name, value / goal, share) beside or under the rings. */
      labels: boolean;
      /** With a single ring, its share in the middle. */
      center: boolean;
    };
    /** Segmented (LED) meter: one row of segments per item, lit up to its value. */
    led: {
      /** Number of segments (fewer when the chart is narrow). */
      segments: number;
      /** Value with no segment lit. */
      min: number;
      /** Value with every segment lit, without an `encode.target` field. */
      max: number;
      /** Space between segments, px. */
      gap: number;
      /** Corner radius of a segment, px. */
      radius: number;
      /** Largest height of a row of segments, px. */
      thickness: number;
      /** Color of the segments by level, each up to a value (`[{ "to": 60, "color": "#1baf7a" }, …]`). */
      zones: { to: number; color: string }[];
      /** Color of the unlit segments (`auto` follows the grid). */
      track: string;
    };
    /** Partition in rows: `orientation` TB (icicle), BT (flame chart, root at the bottom) or LR. Click to zoom. */
    icicle: { orientation: 'TB' | 'BT' | 'LR'; gap: number; radius: number; labels: boolean };
    /** One dot per item on a half circle (seats of an assembly). `innerRadius`: share of the radius left empty. */
    parliament: { innerRadius: number; center: boolean };
    /** Overlapping circles, areas proportional to the sets and their intersections (2 or 3 sets). */
    venn: { opacity: number; labels: boolean };
    /** Parallel sets: one column per field of `path`, ribbons between neighbouring columns. Sizes in px. */
    parsets: {
      /** Thickness of the category bars. */
      nodeWidth: number;
      /** Space between two categories of a column. */
      nodePadding: number;
      /** Opacity of the ribbons. */
      linkOpacity: number;
      /** Corner radius of the bars. */
      radius: number;
      /** Category names beside the bars. */
      labels: boolean;
      /** Value and share under the name, where the bar is tall enough. */
      values: boolean;
      /** Name of each dimension above its column. */
      titles: boolean;
      /** Category order in a column: as met in the data, or largest first. */
      categoryOrder: 'data' | 'value';
    };
    /** UpSet plot: intersections as columns of linked dots, their sizes as bars above, set sizes on the left. */
    upset: {
      /** `distinct`: a key counts the elements of exactly these sets. `inclusive`: of at least these sets (as `venn`). */
      mode: 'distinct' | 'inclusive';
      /** Order of the intersections: largest first, fewest sets first, or as in the data. */
      order: 'size' | 'degree' | 'data';
      /** Order of the sets (rows): largest first, or as in the data. */
      setOrder: 'size' | 'data';
      /** At most this many intersections (0: as many as fit). */
      maxIntersections: number;
      /** Bars of the set sizes, left of the names. */
      setBars: boolean;
      /** Values above the bars and beside the set bars. */
      labels: boolean;
    };
    /** Hierarchical edge bundling: leaves on a circle, links bent towards their common ancestors. */
    bundle: {
      /** Bundling strength: 0 draws straight links, 1 follows the hierarchy all the way. */
      tension: number;
      /** Opacity of the links. */
      opacity: number;
      /** Width of a link, px (scaled by `value` when there is one). */
      linkWidth: number;
      /** Thickness of the ring of leaves, px. */
      nodeSize: number;
      /** Empty room between two groups, in leaves. */
      groupGap: number;
      /** Leaf names around the circle. */
      labels: boolean;
      /** Names turned along the radius, every leaf named (instead of level names on both sides). */
      radialLabels: boolean;
      /** Opacity factor of the links left out by a focus (click or `highlight`). */
      dim: number;
      /** Splits a name (or a group) into its hierarchy: `core.render.batch`. Empty: no split. */
      separator: string;
    };
    /** Words sized by `value`, font sizes in px. */
    wordcloud: { minSize: number; maxSize: number; weight: number };
    /** Events along a line, labels alternating above and below. `proportional`: space them by date. */
    /** `minImportance`: events whose `encode.size` is below it never get a card (dots only). */
    timeline: { proportional: boolean; markerSize: number; minImportance: number };
    /** Gantt chart: one row per task, bars from start to end, progress, milestones, phases and dependencies. */
    gantt: {
      /** Share of a row's height taken by a bar (0–1). */
      barHeight: number;
      /** Cap on a bar's thickness, px. */
      maxBarHeight: number;
      /** Corner radius of the bars, px. */
      radius: number;
      /** Size of a milestone's diamond, px. */
      milestoneSize: number;
      /** Percentage done written in the bars, and the date next to each milestone. */
      labels: boolean;
      /** Arrows from each predecessor (`encode.depends`) to its successor. */
      dependencies: boolean;
      /** Color of the dependency arrows (`auto`: the muted ink). */
      linkColor: string;
      /** Width of the dependency arrows, px. */
      linkWidth: number;
      /** Date of the "today" line (ISO string or epoch ms); empty: no line. Always given by the spec, never the clock. */
      today: string | number;
      /** Text of the flag on the "today" line. */
      todayLabel: string;
      /** Color of the "today" line (`auto`: the theme's alert color). */
      todayColor: string;
      /** Show the phases only (one summary bar per `encode.group`), their tasks folded away: for small screens. */
      collapsed: boolean;
      /** A thin line between rows. */
      rowLines: boolean;
    };
    /** Resource planning: one row per resource (`encode.y`), its slots side by side, overlapping ones on sub-lanes. */
    schedule: {
      /** Share of a lane's height taken by a slot (0–1). */
      barHeight: number;
      /** Corner radius of the slots, px. */
      radius: number;
      /** Space kept between two slots that touch, px. */
      gap: number;
      /** The slot's name (`encode.key`) written inside it when it fits, cut with "…" otherwise. */
      labels: boolean;
      /** Date of the "now" line (ISO string or epoch ms); empty: no line. Always given by the spec, never the clock. */
      today: string | number;
      /** Text of the flag on the "now" line. */
      todayLabel: string;
      /** Color of the "now" line (`auto`: the theme's alert color). */
      todayColor: string;
      /** A thin line between resources. */
      rowLines: boolean;
    };
    /** State timeline: one row per entity (`encode.y`), its successive states (`encode.color`) as colored spans. */
    swimlane: {
      /** Share of a row's height taken by the spans (0–1). */
      barHeight: number;
      /** Corner radius of the spans, px. */
      radius: number;
      /** Space kept between two spans, px. */
      gap: number;
      /** The state's name written in each span when it fits. */
      labels: boolean;
      /** A thin line between rows. */
      rowLines: boolean;
    };
    /** Hierarchy as a tree: dots (dendrogram) or `boxes` (org chart), growing along `direction`. Sizes in px. */
    /** Arrows at x / y, pointing along `encode.angle`, as long as `encode.size` (within `sizeRange`, px). */
    vector: { width: number; head: number };
    /** Packed bubbles: `gap` px between bubbles; with `encode.color`, one cluster per group. */
    bubbles: { gap: number; labels: boolean; opacity: number };
    /** Nodes on a line, links as half circles above, as thick as their value (`maxWidth`, px). */
    arcDiagram: { maxWidth: number; opacity: number; nodeSize: number };
    /** Stages stacked in a triangle, apex at the top, heights by value. `gap` px between them. */
    pyramid: { gap: number; labels: boolean };
    /**
     * Price bars: `ohlc` draws ticks instead of bodies. `rising` / `falling`: colors (`auto` = the KPI good / bad).
     * `body`: share of the slot taken by a body; `wick`: px.
     */
    candlestick: { ohlc: boolean; rising: string; falling: string; body: number; wick: number };
    renko: {
      /** Height of a brick, in price units; 0 picks a round size from the price range. */
      brick: number;
      /** Color of rising bricks (`auto` = the KPI good color). */
      rising: string;
      /** Color of falling bricks (`auto` = the KPI bad color). */
      falling: string;
      /** px between two bricks. */
      gap: number;
      /** Corner radius of a brick, px. */
      radius: number;
    };
    kagi: {
      /** Price move against the current line that starts a new one, in price units; 0 picks a round amount from the price range. */
      reversal: number;
      /** Color of the thick (yang) stretches (`auto` = the KPI good color). */
      rising: string;
      /** Color of the thin (yin) stretches (`auto` = the KPI bad color). */
      falling: string;
      /** Width of the yang line (above the previous high), px. */
      yang: number;
      /** Width of the yin line (under the previous low), px. */
      yin: number;
    };
    /** Routes on a map from (x, y) to (x2, y2), bent by `curvature`; width from `encode.size` (`sizeRange`, px). */
    route: { curvature: number; opacity: number; ends: boolean };
    /** `reverse`: grow right to left (LR) or bottom to top (TB). */
    tree: { direction: 'LR' | 'TB'; reverse: boolean; radial: boolean; boxes: boolean; nodeSize: number; linkWidth: number; boxWidth: number; boxHeight: number };
    /** Voronoi treemap: one polygon per leaf of `path` in a circle, its area proportional to `value`, grouped by first level. */
    voronoi: {
      /** Surface-colored line between two cells, px. */
      gap: number;
      /** Surface-colored line around each group of cells (first level of `path`), px. */
      groupGap: number;
      /** Name (and value when the cell is tall enough) at the center of each cell. */
      labels: boolean;
      /** Rounds of relaxation: more rounds bring the areas closer to the values (the best round is kept). */
      iterations: number;
    };
    /** Indented tree: one line per node of `path`, with its value (subtotal) and a bar. Click a node to fold it. */
    indentedTree: {
      /** Height of a line, px (lines shrink down to 20 px before the list is cut with "+ n lignes"). */
      rowHeight: number;
      /** Indentation of each level, px. */
      indent: number;
      /** A bar per line, as long as its share (the largest first-level node fills the track). */
      bars: boolean;
      /** Nodes open at first: every one (`all`), none, or the first of each level (`first`). */
      expand: 'all' | 'none' | 'first';
      /** Siblings from the largest value down instead of the order of the data. */
      sorted: boolean;
    };
    /** Cohort retention table: a line per cohort (`y`), a column per period elapsed (`x`), cells shaded by the rate. */
    cohort: {
      /** The values are already rates (0 to 1, or 0 to 100) instead of head counts measured against the first period. */
      asRate: boolean;
      /** A last line with the retention of all cohorts together (weighted by their size). */
      average: boolean;
      /** A column with the size of each cohort, when the chart is wide enough. */
      sizes: boolean;
      /** Written before the period number in the column headers ("M" for months, "S" for weeks). */
      periodPrefix: string;
      /** The rate inside each cell. */
      labels: boolean;
      /** Space between cells, px. */
      gap: number;
      /** Corner radius of the cells, px. */
      radius: number;
    };
    /** Decomposition tree: the levels of `path` in columns, one node expanded per level. Click a node to expand it. */
    decomposition: {
      /** Name of the node expanded at each level, from the first one (missing or unknown: the largest). */
      expanded: string[];
      /** Height of a node (name, value and bar), px; never under 26. */
      rowHeight: number;
      /** Width of the links between a node and its children, px. */
      linkWidth: number;
      /** Name of the node that holds the total, shown as a first column when there is room. */
      rootLabel: string;
    };
    /** Compared funnel: steps (`key`) in lines, one centered bar per segment (`color`), pass rates in between. */
    funnelCompare: {
      /** Each segment on its own scale (its first step fills the column) instead of one scale for all. */
      relative: boolean;
      /** The value inside each bar. */
      labels: boolean;
      /** Largest height of a bar, px. */
      thickness: number;
      /** Corner radius of the bars, px. */
      radius: number;
      /** A last line with the conversion from the first step to the last one. */
      overall: boolean;
    };
    /** Likert scale: one diverging stack per question, centered on the middle of the scale. */
    likert: {
      /** The answers in order, from the most unfavourable to the most favourable (empty: the order of the data). */
      answers: string[];
      /** Where the neutral answer of an odd scale goes: astride the middle (`center`) or in its own column (`aside`). */
      neutral: 'center' | 'aside';
      /** Share of each answer inside its segment, when it fits. */
      labels: boolean;
      /** Totals of the unfavourable and favourable answers at both ends of each row. */
      totals: boolean;
      /** Largest thickness of a row, px. */
      thickness: number;
      /** Corner radius of the ends of a row, px. */
      radius: number;
      /** Space between two segments, px. */
      gap: number;
      /** Hue of the unfavourable answers (`auto`: the second color of the palette). */
      negative: string;
      /** Hue of the favourable answers (`auto`: the first color of the palette). */
      positive: string;
      /** Caption under the unfavourable side; empty: none. */
      negativeLabel: string;
      /** Caption under the favourable side; empty: none. */
      positiveLabel: string;
      /** Questions sorted by their share of favourable answers instead of the order of the data. */
      sorted: boolean;
    };
    /** Tornado / butterfly: two measures on both sides of the names, or around a base value. */
    tornado: {
      /** Base value both bars start from (sensitivity analysis: names on the left, one shared axis). Unset: butterfly. */
      base: number;
      /** Rows sorted from the widest to the narrowest. */
      sorted: boolean;
      /** Values at the ends of the bars. */
      labels: boolean;
      /** Both sides on the same scale (butterfly); otherwise each side fills its half. */
      shared: boolean;
      /** Largest thickness of a bar, px. */
      thickness: number;
      /** Corner radius of the bar ends, px. */
      radius: number;
    };
    /** Variable-width bars: height from `value`, width from `size`. */
    variwide: {
      /** Space between two bars, px. */
      gap: number;
      /** Corner radius of the top of the bars, px. */
      radius: number;
      /** Value above each bar and width at its foot. */
      labels: boolean;
      /** Bars sorted from the tallest to the shortest instead of the order of the data. */
      sorted: boolean;
    };
    /** Ranking with its history: rank, places moved, bar with a tick at the previous value, value and change. */
    barRank: {
      /** Number of rows kept from the top of the ranking (0: all that fit). */
      top: number;
      /** Whether a rise is good news (it picks the color of the moves and changes). */
      upIsGood: boolean;
      /** Color of a good change (`auto`: the KPI good color). */
      good: string;
      /** Color of a bad change (`auto`: the KPI bad color). */
      bad: string;
      /** Largest thickness of a bar, px. */
      thickness: number;
      /** Corner radius of the bar ends, px. */
      radius: number;
      /** Value and change at the end of each row. */
      labels: boolean;
    };
    /** Bar-in-bar: a slim bar (actual) inside a wide pale one (goal). */
    barInBar: {
      /** Thickness of the slim bar, as a share of the wide one. */
      inner: number;
      /** Largest thickness of the wide bar, px. */
      thickness: number;
      /** Corner radius of the bar ends, px. */
      radius: number;
      /** Value and share of the goal reached at the end of each row. */
      labels: boolean;
      /** Rows sorted by value instead of the order of the data. */
      sorted: boolean;
      /** Whether reaching the goal is good news (it picks the color of the share). */
      upIsGood: boolean;
      /** Color of a goal reached (`auto`: the KPI good color). */
      good: string;
      /** Color of a goal missed (`auto`: the KPI bad color). */
      bad: string;
    };
    /** Profit bridge: floating changes between running levels, subtotals as solid bars from zero. */
    bridge: {
      /** Keys of the steps that are totals: solid bars from zero (their value, or the running level when empty). */
      subtotals: string[];
      /** A boolean field that flags the totals, in addition to `subtotals` (empty: none). */
      totalField: string;
      /** One row per step (long account names) instead of one column. */
      horizontal: boolean;
      /** Thin lines joining each bar to the next at the running level. */
      connectors: boolean;
      /** The figure of each step, above or below its bar (beside it when horizontal). */
      labels: boolean;
      /** Largest width of a bar, px. */
      thickness: number;
      /** Corner radius of the bars, px. */
      radius: number;
      /** Whether a rise is good news (a cost bridge: false); it picks the color of the changes. */
      upIsGood: boolean;
      /** Color of a favourable change (`auto`: the KPI good color, `$up`). */
      good: string;
      /** Color of an unfavourable change (`auto`: the KPI bad color, `$down`). */
      bad: string;
    };
    /** Actual against budget per row: solid actual over the budget outline, absolute and relative variances. */
    variance: {
      /** A column of absolute variances, as bars around zero. */
      absolute: boolean;
      /** A column of relative variances, as pins around zero. */
      relative: boolean;
      /** A total row at the bottom (sums of actual and budget). */
      total: boolean;
      /** Figures beside the bars and pins. */
      labels: boolean;
      /** Largest thickness of a row's bars, px. */
      thickness: number;
      /** Corner radius of the bar ends, px. */
      radius: number;
      /** Whether actual above budget is good news (costs: false). */
      upIsGood: boolean;
      /** Color of a favourable variance (`auto`: the KPI good color, `$up`). */
      good: string;
      /** Color of an unfavourable variance (`auto`: the KPI bad color, `$down`). */
      bad: string;
    };
    /** Columns per period: previous year, budget and actual side by side, the variance above each past period. */
    periodBars: {
      /** Width of a period's group of bars, as a share of its slot. */
      width: number;
      /** Corner radius of the column tops, px. */
      radius: number;
      /** The variance to budget above each past period. */
      labels: boolean;
      /** Whether actual above budget is good news (costs: false). */
      upIsGood: boolean;
      /** Color of a favourable variance (`auto`: the KPI good color, `$up`). */
      good: string;
      /** Color of an unfavourable variance (`auto`: the KPI bad color, `$down`). */
      bad: string;
    };
    flow: {
      variant: 'pipeline' | 'boxes';
      /** Steps can be dragged; the chart then emits `layout` with every position. */
      editable: boolean;
      direction: 'TB' | 'LR';
      rankGap: number;
      nodeGap: number;
      fontSize: number;
      edge: string;
      edgeWidth: number;
      tint: number;
      radius: number;
      /** Swimlanes (boxes look): one band per node `group`, across the flow, with a named header. */
      lanes: boolean;
      /** Order of the lanes, by group name; groups left out follow in order of appearance. */
      laneOrder: string[];
      /** Links (boxes look): `curved` (default), or `orthogonal` runs with rounded corners that go round the boxes. */
      routing: 'curved' | 'orthogonal';
    };
    /** Map shapes (basemap, choropleth). */
    geoshape: {
      fill: string;
      /** Fill of a shape with no matching data in a choropleth. */
      missing: string;
      stroke: string;
      strokeWidth: number;
    };
    area: {
      opacity: number;
      stackedOpacity: number;
      /** Fade the fill to transparent towards the baseline. */
      gradient: boolean;
      line: boolean;
      lineWidth: number;
      curve: 'linear' | 'step' | 'smooth';
    };
  };
  /**
   * Texts the marks write for the reader (tooltip rows, headers, captions), French by default. Override one
   * (`theme: { texts: { median: 'Median' } }`) or all of them (`englishTexts`). `{name}` is filled at drawing
   * time; keep the same names in a translation. Dates and numbers follow the browser's language instead.
   */
  texts: {
    /** Number of rows in a group (box plot, violin, cohort header, confusion cell). */
    count: string;
    /** Number of items when no field names it (chord, calendar). */
    number: string;
    /** A node's value when the field has no label (flow). */
    value: string;
    /** An arrow's value when the field has no label (flow). */
    volume: string;
    /** Middle value of a distribution (box plot, ridgeline, fan, ECDF line). */
    median: string;
    /** Arithmetic mean (box plot, raincloud). */
    mean: string;
    /** Mean of one series (cycle plot): `{name}` the series. */
    meanOf: string;
    /** Row of the average cohort and its tooltip title (cohort). */
    average: string;
    /** Interquartile range (violin). */
    quartiles: string;
    /** Smallest to largest value (raincloud). */
    minMax: string;
    /** Lowest value of a row (sparkline table). */
    minimum: string;
    /** Highest value of a row (sparkline table). */
    maximum: string;
    /** Caption of the largest marginal bar: `{value}` the count. */
    max: string;
    /** Tooltip title of one point (contour). */
    observation: string;
    /** Number of observations (violin, contour, marginal histogram). */
    observations: string;
    /** Share of the whole (pie, donut, treemap, waffle, parliament, polar stacks…). */
    share: string;
    /** Share of the grand total (hierarchies, sets, bubbles, marimekko). */
    shareOfTotal: string;
    /** Share of a parent or a source: `{name}` the parent. */
    shareOf: string;
    /** Share of the row's total (pivot table). */
    shareOfRow: string;
    /** Share of the largest value (radial bars). */
    shareOfMax: string;
    /** Share of rows at or below a value (ECDF). */
    shareOfObservations: string;
    /** Total of a row, a stack or a group (pivot, stacked bars, maps, decomposition root). */
    total: string;
    /** Header of the sparkline column (pivot, sparkline table). */
    trend: string;
    /** Change over the period (bridge, bar race tooltip, sparkline table header). */
    change: string;
    /** Header of the bar column (sparkline table). */
    comparison: string;
    /** Running total (bridge). */
    cumulative: string;
    /** Change under a KPI: `{value}` the arrow and the percentage. */
    versusPrevious: string;
    /** Change since the first value (funnel, sparkline table). */
    sinceStart: string;
    /** Conversion from the step before (funnel, funnel comparison). */
    sincePrevious: string;
    /** Conversion from the first step (funnel comparison). */
    sinceFirst: string;
    /** Rows that do not reach the next step (funnel comparison). */
    lostAtStep: string;
    /** Header of the overall conversion row (funnel comparison). */
    conversion: string;
    /** Rate between two steps (funnel comparison): `{percent}` the rate. */
    passThrough: string;
    /** Position in a ranking (bar race, bump chart, rank bars). */
    rank: string;
    /** Rank and the one before (rank bars): `{rank}`, `{previous}`. */
    rankWas: string;
    /** Tooltip title of a QQ point: `{rank}` and `{n}` the count. */
    rankOutOf: string;
    /** The current period (bar race). */
    period: string;
    /** Difference (variance chart, difference chart). */
    gap: string;
    /** Relative difference (variance chart). */
    gapPercent: string;
    /** Difference with the budget (period bars). */
    gapToBudget: string;
    /** Difference with the series mean (cycle plot). */
    gapToMean: string;
    /** Right side of a diverging scale when it has no label (Likert). */
    favorable: string;
    /** Left side of a diverging scale when it has no label (Likert). */
    unfavorable: string;
    /** Reference line of a tornado: `{value}` the base value. */
    base: string;
    /** Spread between the two bars (tornado). */
    amplitude: string;
    /** Area of a column (variwide). */
    heightTimesWidth: string;
    /** Share of the target reached (bullet, bar in bar, activity rings). */
    achieved: string;
    /** Target when the field has no label (bullet, activity rings). */
    target: string;
    /** Qualitative band reached, or fill level (bullet, LED gauge). */
    level: string;
    /** Fill level (liquid gauge). */
    fill: string;
    /** Unit of a pictorial chart: `{value}` what one symbol stands for. */
    symbolUnit: string;
    /** A node's or a row's group (flow, chord, network, edge bundle, adjacency matrix). */
    group: string;
    /** A label and its value in a tooltip title (histogram bin, parallel sets): `{label}`, `{value}`. */
    labelValue: string;
    /** Number of rows (indented tree, decomposition, parallel sets). */
    rows: string;
    /** Tooltip title of a row without a key (parallel coordinates): `{n}` its number. */
    rowN: string;
    /** Number of points (hexbin). */
    points: string;
    /** Tooltip title of a point without a key (3D scatter): `{n}` its number. */
    pointN: string;
    /** Name of a quadrant without a label: `{n}` its number. */
    quadrantN: string;
    /** Rows left out for lack of room, one (indented tree, table): `{n}`. */
    moreRow: string;
    /** Rows left out for lack of room, several: `{n}`. */
    moreRows: string;
    /** Nodes left out of a column, one (decomposition tree): `{n}`. */
    moreOther: string;
    /** Nodes left out of a column, several: `{n}`. */
    moreOthers: string;
    /** Labels left out of a timeline: `{n}` how many. */
    hiddenLabels: string;
    /** Back button after a click on a slice (pie, donut). */
    allParts: string;
    /** Back button after a click on a series (stacked bars). */
    allSeries: string;
    /** Back button at the root (sunburst drill-down). */
    showAll: string;
    /** One link (arc diagram, timeline item with a URL). */
    link: string;
    /** Links of a node (arc diagram). */
    links: string;
    /** Value of the link row (timeline). */
    openLink: string;
    /** Flow into a node (chord). */
    incoming: string;
    /** Flow out of a node (chord, Sankey). */
    outgoing: string;
    /** Links into a node (edge bundle). */
    incomingLinks: string;
    /** Links out of a node (edge bundle). */
    outgoingLinks: string;
    /** Number of nodes of a group (network). */
    nodes: string;
    /** Number of children (tree). */
    children: string;
    /** Share of a cohort still active (cohort). */
    retention: string;
    /** Rows in the cohort at the start (cohort). */
    cohortSize: string;
    /** Position in a stack of dots (dot plot). */
    inStack: string;
    /** Theoretical value (QQ plot). */
    normalQuantile: string;
    /** Density as a share of the highest (contour). */
    density: string;
    /** Name of a prediction band (fan chart): `{n}` its width in percent. */
    interval: string;
    /** A week of a cycle plot by weekday: `{date}` its middle. */
    weekOf: string;
    /** A quarter (cycle plot): `{n}` from 1 to 4. */
    quarterN: string;
    /** An hour (cycle plot, polar day): `{n}`; also a duration in whole hours (Gantt). */
    hours: string;
    /** A duration in hours and minutes (Gantt): `{h}`, `{m}`. */
    hoursMinutes: string;
    /** A duration in minutes (Gantt): `{n}`. */
    minutes: string;
    /** A duration in days (Gantt): `{n}`, with `decimalSeparator`. */
    days: string;
    /** Decimal mark of a duration in days (Gantt). */
    decimalSeparator: string;
    /** Start of a task when the field has no label (Gantt, schedule). */
    start: string;
    /** End of a task when the field has no label (Gantt, schedule). */
    end: string;
    /** Length of a task (Gantt, schedule). */
    duration: string;
    /** Date of a milestone (Gantt). */
    milestone: string;
    /** Completion of a task when the field has no label (Gantt). */
    progress: string;
    /** Group of a task when the field has no label (Gantt). */
    phase: string;
    /** Tasks that come before (Gantt). */
    after: string;
    /** Row of a schedule when the field has no label. */
    resource: string;
    /** Size of a set when no field names it (UpSet). */
    elements: string;
    /** Number of sets in a combination (UpSet). */
    combinedSets: string;
    /** The single set of a combination (UpSet). */
    only: string;
    /** Kind of a node (flow). */
    type: string;
    /** Description of a node (flow). */
    note: string;
    /** Label of an arrow (flow). */
    condition: string;
    /** Nodes that feed a node (pipeline flow). */
    from: string;
    /** Arrows into and out of a node (flow). */
    inputsOutputs: string;
    /** Flow chart shape names: process step. */
    flowStep: string;
    /** Flow chart: start. */
    flowStart: string;
    /** Flow chart: end. */
    flowEnd: string;
    /** Flow chart: decision. */
    flowDecision: string;
    /** Flow chart: input or output. */
    flowIo: string;
    /** Flow chart: subprocess. */
    flowSubprocess: string;
    /** Pipeline shape names: source. */
    pipeSource: string;
    /** Pipeline: step. */
    pipeStep: string;
    /** Pipeline: subflow. */
    pipeSubflow: string;
    /** Pipeline: join or choice. */
    pipeJoin: string;
    /** Pipeline: union. */
    pipeUnion: string;
    /** Pipeline: output. */
    pipeOutput: string;
    /** Total sent by a row (adjacency matrix). */
    sent: string;
    /** Total received by a column (adjacency matrix). */
    received: string;
    /** Actual class when the field has no label (confusion matrix). */
    actual: string;
    /** Predicted class when the field has no label (confusion matrix). */
    predicted: string;
    /** Confusion matrix margin: share of a predicted class that is right. */
    precision: string;
    /** Confusion matrix margin: share of an actual class that is found. */
    recall: string;
    /** Share of all cases rightly classified (confusion matrix tooltip). */
    accuracy: string;
    /** The same, as the small caption of the corner cell. */
    accuracyCaption: string;
    /** Rightly classified cases (confusion matrix). */
    correct: string;
    /** Title of a diagonal cell (confusion matrix): `{name}` the class. */
    correctOf: string;
    /** Title of an off-diagonal cell (confusion matrix): `{actual}`, `{predicted}`. */
    classifiedAs: string;
    /** Share of a class (confusion matrix): `{kind}` the axis title in lower case, `{name}` the class. */
    shareOfClass: string;
    /** Number of cases (confusion matrix corner). */
    cases: string;
    /** Cases of an actual class (confusion matrix). */
    actualCases: string;
    /** Cases of a predicted class (confusion matrix). */
    predictedCases: string;
    /** Eight compass points, clockwise from north (wind rose with `compass`). */
    compass: string[];
  };
  tooltip: {
    background: string;
    color: string;
    muted: string;
    border: string;
    radius: number;
    padding: number;
    shadow: string;
    fontSize: number;
  };
  crosshair: LineStyle;
  hover: { markerSize: number; bandFill: string };
  selection: {
    /** Outline and fill of the lasso while it is drawn. */
    stroke: string;
    fill: string;
    width: number;
    /** Opacity of the marks left out of the selection. */
    dimOpacity: number;
  };
}

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const lightTheme: Theme = {
  name: 'light',
  background: '#fcfcfb',
  padding: 16,
  font: { family: SANS, size: 12 },
  text: { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781' },
  palette: {
    categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    sequential: ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
  },
  title: { color: '#0b0b0b', size: 15, weight: 600, gap: 12 },
  subtitle: { color: '#52514e', size: 12, weight: 400 },
  axis: {
    line: { visible: true, color: '#c3c2b7', width: 1 },
    tick: { visible: false, color: '#c3c2b7', width: 1, size: 4 },
    label: { color: '#898781', size: 11, weight: 400, padding: 8 },
    title: { color: '#52514e', size: 11, weight: 500, padding: 8 },
  },
  grid: {
    x: { visible: false, color: '#e1e0d9', width: 1 },
    y: { visible: true, color: '#e1e0d9', width: 1 },
  },
  labels: {},
  legend: {
    visible: true,
    label: { color: '#52514e', size: 12, weight: 400 },
    symbolSize: 8,
    itemGap: 16,
    hiddenOpacity: 0.35,
  },
  marks: {
    line: { width: 2, curve: 'linear', opacity: 1, endLabels: false, dash: [], markers: false, labels: false, connectNulls: false, colorByValue: false },
    bar: { radius: 4, gap: 2, maxWidth: 28, bandPadding: 0.3, opacity: 1, strokeWidth: 0, stroke: 'transparent', labels: false, thickness: 0, track: '' },
    point: { size: 8, shape: 'circle', opacity: 1, strokeWidth: 2, stroke: 'surface', sizeRange: [4, 28], jitter: 0, pulse: false },
    area: { opacity: 0.12, stackedOpacity: 0.8, gradient: false, line: true, lineWidth: 2, curve: 'linear' },
    geoshape: { fill: '#e9e8e2', missing: '#e9e8e2', stroke: '#fcfcfb', strokeWidth: 0.75 },
    rule: { width: 1.5, opacity: 1 },
    tick: { width: 2, length: 0.6, maxWidth: 0, opacity: 1 },
    heatmap: { radius: 3, labels: true, gap: 2, circles: false, diverging: false, colorLegend: false },
    polarHeatmap: { innerRadius: 0.22, gap: 1.5, labels: true },
    splom: { size: 4, opacity: 0.7, bins: 14 },
    globe: { spin: true, size: 6, graticule: true, ocean: 'auto', land: 'auto' },
    scatter3d: { size: 7, opacity: 0.85, spin: true, perspective: 4 },
    arc: { innerRadius: 0, gap: 2, labels: true, center: true, startAngle: 0, endAngle: 360, cornerRadius: 0 },
    treemap: { gap: 2, radius: 4, labels: true, header: 22, ellipsis: false },
    funnel: { gap: 6, radius: 4, labels: true, connector: 0.14 },
    gauge: { min: 0, max: 100, thickness: 0.24, track: 'auto', target: NaN, sweep: 180, zones: [], needle: false, ticks: 0, rounded: false },
    radar: { levels: 4, fillOpacity: 0.14, width: 2, points: true },
    sankey: { nodeWidth: 12, nodePadding: 14, linkOpacity: 0.32, radius: 2, labels: true },
    sunburst: { innerRadius: 0.32, gap: 1.5, labels: true },
    calendar: { radius: 2, gap: 2, empty: 'auto' },
    kpi: { upIsGood: true, sparkline: true, good: '#006300', bad: '#d03b3b', size: 34 },
    waffle: { rows: 10, columns: 10, gap: 2, radius: 2 },
    rose: { levels: 3, gap: 2, innerRadius: 0.08, labels: true },
    violin: { width: 0.8, fillOpacity: 0.28, strokeWidth: 1.5, box: true, samples: 64, scale: 'width' },
    race: { top: 10, duration: 900, autoplay: true, loop: false },
    motion: { duration: 1000, autoplay: true, loop: false, opacity: 0.82, trails: true },
    pivot: { heat: true, totals: true, sparkline: true },
    ridgeline: { overlap: 1.8, opacity: 0.8, bandwidth: 0 },
    beeswarm: { size: 7, opacity: 0.85, label: '' },
    dotplot: { size: 14, minSize: 3, gap: 1.5, opacity: 1, binning: 'dotdensity' },
    ecdf: { width: 2, quantiles: [0.5], labels: true, points: false },
    qq: { size: 6, opacity: 0.8, band: true, level: 0.95, referenceColor: 'auto', referenceWidth: 1.5, referenceDash: [] },
    contour: { levels: 6, smoothing: 1, opacity: 0.9, lines: true, points: true, size: 3.5 },
    raincloud: { opacity: 0.5, bandwidth: 0, box: true, points: true, size: 3.5, jitter: 1 },
    quadrant: { xThreshold: null, yThreshold: null, quadrants: [], tint: 0.07, size: 10, sizeRange: [8, 34], opacity: 0.85, labels: true },
    connected: { width: 2, size: 6, arrows: true, arrowSize: 9, labels: true },
    marginal: { size: 5, opacity: 0.7, bins: 20, share: 0.2, gap: 1, radius: 2, fillOpacity: 0.85, labels: true },
    tilemap: { hex: true, gap: 2, labels: true },
    dorling: { coverage: 0.36, iterations: 140, gap: 1.5, labels: true, label: '', shortLabel: '', values: true, opacity: 1, outline: 0 },
    mapPie: { sizeRange: [16, 46], innerRadius: 0, gap: 1, outline: 1.5, labels: true, opacity: 1 },
    spike: { height: 90, width: 9, opacity: 0.4, strokeWidth: 1.25, labels: true, top: 6 },
    mapBars: { height: 44, thickness: 7, gap: 1, radius: 1.5, outline: 1, labels: true, opacity: 1 },
    pictorial: { unit: 1, icon: 'circle', gap: 0.18 },
    surface: { contours: 8, contourColor: 'auto' },
    horizon: { bands: 3, gap: 2 },
    difference: { opacity: 0.3, positive: 'auto', negative: 'auto', positiveLabel: '', negativeLabel: '', width: 2, curve: 'linear', referenceColor: 'auto', referenceWidth: 1.5, referenceDash: [5, 4] },
    fan: { opacity: 0.42, width: 2, curve: 'linear', quantiles: [0.1, 0.25, 0.75, 0.9], medianWidth: 2, medianDash: [5, 4], anchor: true },
    cycle: { period: 'month', aggregate: 'sum', width: 2, mean: true, meanWidth: 1.5, meanColor: 'auto', points: true, panels: true, inset: 0.16, zero: false },
    sparktable: { show: ['value', 'change', 'spark', 'bar'], spark: 'line', change: 'previous', sortBy: 'data', upIsGood: true, good: 'auto', bad: 'auto', headers: true, rowHeight: 38, sharedScale: false },
    bumpArea: { opacity: 0.88, gap: 3, flat: 0.3, labels: true },
    table: { cols: [], orderBy: '', descending: false, zebra: false, total: false, totalLabel: 'Total', headers: true, rowHeight: 34, upIsGood: true, good: 'auto', bad: 'auto', warn: '#b26a00' },
    matrix: { gap: 2, radius: 3, labels: true, totals: true, ordering: 'data' },
    confusion: { gap: 3, radius: 4, labels: true, margins: true, normalize: 'row', bad: 'auto' },
    calendarMonth: { gap: 3, radius: 4, labels: true, weekStart: 1, month: '' },
    radialBar: { innerRadius: 0.3, gap: 0.28, endAngle: 270, track: 'auto', labels: true, labelColor: 'auto' },
    spiral: { turn: 'auto', turnCount: 0, innerRadius: 0.2, gap: 1.5, labels: true, diverging: false },
    polarLine: { width: 2, smooth: true, closed: true, fillOpacity: 0, points: false, levels: 4, angleMax: 0, compass: false, labels: true },
    polarScatter: { size: 7, sizeRange: [4, 20], opacity: 0.75, levels: 4, angleMax: 0, compass: false, labels: true },
    radialArea: { innerRadius: 0.16, opacity: 0.88, smooth: true, width: 1, levels: 4, angleMax: 0, compass: false, labels: true },
    bullet: { ranges: [], rangeFields: [], rangeLabels: [], target: NaN, shared: false, tinted: false, thickness: 26, axis: true, radius: 3 },
    liquid: { min: 0, max: 100, container: 'circle', amplitude: 0.035, waves: 1.4, border: 3, wash: 0.1, zones: [], labels: true, animated: false, speed: 1.6 },
    activity: { max: 100, innerRadius: 0.36, gap: 0.16, track: 'auto', rounded: true, labels: true, center: true },
    led: { segments: 24, min: 0, max: 100, gap: 2, radius: 2, thickness: 20, zones: [], track: 'auto' },
    icicle: { orientation: 'TB', gap: 1.5, radius: 3, labels: true },
    parliament: { innerRadius: 0.38, center: true },
    venn: { opacity: 0.3, labels: true },
    parsets: { nodeWidth: 12, nodePadding: 10, linkOpacity: 0.5, radius: 2, labels: true, values: true, titles: true, categoryOrder: 'data' },
    upset: { mode: 'distinct', order: 'size', setOrder: 'size', maxIntersections: 0, setBars: true, labels: true },
    bundle: { tension: 0.85, opacity: 0.6, linkWidth: 1.25, nodeSize: 6, groupGap: 1, labels: true, radialLabels: false, dim: 0.2, separator: '.' },
    wordcloud: { minSize: 11, maxSize: 46, weight: 650 },
    timeline: { proportional: false, markerSize: 12, minImportance: NaN },
    gantt: { barHeight: 0.62, maxBarHeight: 22, radius: 4, milestoneSize: 14, labels: true, dependencies: true, linkColor: 'auto', linkWidth: 1.25, today: '', todayLabel: 'Aujourd’hui', todayColor: 'auto', collapsed: false, rowLines: true },
    schedule: { barHeight: 0.8, radius: 4, gap: 2, labels: true, today: '', todayLabel: 'Maintenant', todayColor: 'auto', rowLines: true },
    swimlane: { barHeight: 0.7, radius: 2, gap: 1, labels: true, rowLines: false },
    vector: { width: 1.5, head: 5 },
    bubbles: { gap: 2, labels: true, opacity: 0.9 },
    arcDiagram: { maxWidth: 14, opacity: 0.45, nodeSize: 10 },
    pyramid: { gap: 3, labels: true },
    candlestick: { ohlc: false, rising: 'auto', falling: 'auto', body: 0.7, wick: 1.25 },
    renko: { brick: 0, rising: 'auto', falling: 'auto', gap: 1, radius: 1 },
    kagi: { reversal: 0, rising: 'auto', falling: 'auto', yang: 3.5, yin: 1.5 },
    route: { curvature: 0.25, opacity: 0.6, ends: true },
    tree: { direction: 'LR', reverse: false, radial: false, boxes: false, nodeSize: 9, linkWidth: 1.5, boxWidth: 132, boxHeight: 46 },
    voronoi: { gap: 1.5, groupGap: 4, labels: true, iterations: 120 },
    indentedTree: { rowHeight: 26, indent: 18, bars: true, expand: 'first', sorted: true },
    cohort: { asRate: false, average: true, sizes: true, periodPrefix: 'M', labels: true, gap: 2, radius: 3 },
    decomposition: { expanded: [], rowHeight: 36, linkWidth: 1.5, rootLabel: 'Total' },
    funnelCompare: { relative: false, labels: true, thickness: 30, radius: 4, overall: true },
    likert: { answers: [], neutral: 'center', labels: true, totals: true, thickness: 26, radius: 3, gap: 1, negative: 'auto', positive: 'auto', negativeLabel: 'Défavorable', positiveLabel: 'Favorable', sorted: false },
    tornado: { base: NaN, sorted: true, labels: true, shared: true, thickness: 24, radius: 3 },
    variwide: { gap: 2, radius: 3, labels: true, sorted: false },
    barRank: { top: 0, upIsGood: true, good: 'auto', bad: 'auto', thickness: 18, radius: 3, labels: true },
    barInBar: { inner: 0.42, thickness: 24, radius: 3, labels: true, sorted: false, upIsGood: true, good: 'auto', bad: 'auto' },
    bridge: { subtotals: [], totalField: '', horizontal: false, connectors: true, labels: true, thickness: 44, radius: 2, upIsGood: true, good: 'auto', bad: 'auto' },
    variance: { absolute: true, relative: true, total: false, labels: true, thickness: 20, radius: 2, upIsGood: true, good: 'auto', bad: 'auto' },
    periodBars: { width: 0.78, radius: 2, labels: true, upIsGood: true, good: 'auto', bad: 'auto' },
    flow: { variant: 'pipeline', editable: true, direction: 'LR', rankGap: 56, nodeGap: 28, fontSize: 13, edge: 'auto', edgeWidth: 1.5, tint: 0.16, radius: 6, lanes: false, laneOrder: [], routing: 'curved' },
  },
  texts: frenchTexts,
  tooltip: {
    background: '#ffffff',
    color: '#0b0b0b',
    muted: '#52514e',
    border: 'rgba(11,11,11,0.10)',
    radius: 8,
    padding: 10,
    shadow: '0 4px 16px rgba(11,11,11,0.10)',
    fontSize: 12,
  },
  crosshair: { visible: true, color: '#898781', width: 1 },
  hover: { markerSize: 9, bandFill: 'rgba(11,11,11,0.05)' },
  selection: { stroke: '#0b0b0b', fill: 'rgba(11,11,11,0.06)', width: 1.5, dimOpacity: 0.18 },
};

export const darkTheme: Theme = deepMerge(lightTheme, {
  name: 'dark',
  background: '#1a1a19',
  text: { primary: '#f0efec', secondary: '#c3c2b7', muted: '#898781' },
  palette: {
    categorical: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
    sequential: ['#0d366b', '#1c5cab', '#3987e5', '#86b6ef', '#cde2fb'],
  },
  title: { color: '#f0efec' },
  subtitle: { color: '#c3c2b7' },
  axis: {
    line: { color: '#383835' },
    tick: { color: '#383835' },
    title: { color: '#c3c2b7' },
  },
  grid: { x: { color: '#2c2c2a' }, y: { color: '#2c2c2a' } },
  legend: { label: { color: '#c3c2b7' } },
  tooltip: {
    background: '#262624',
    color: '#f0efec',
    muted: '#c3c2b7',
    border: 'rgba(255,255,255,0.10)',
    shadow: '0 4px 16px rgba(0,0,0,0.45)',
  },
  hover: { bandFill: 'rgba(255,255,255,0.06)' },
  marks: { geoshape: { fill: '#2c2c2a', missing: '#2c2c2a', stroke: '#1a1a19' }, kpi: { good: '#0ca30c' } },
  selection: { stroke: '#f0efec', fill: 'rgba(255,255,255,0.08)' },
});

const registry = new Map<string, Theme>([
  ['light', lightTheme],
  ['dark', darkTheme],
]);

/** Make a theme available by name in specs (`theme: 'my-brand'`). */
export function registerTheme(name: string, theme: DeepPartial<Theme>, base: string = 'light'): Theme {
  const full = deepMerge(registry.get(base) ?? lightTheme, theme, { name } as DeepPartial<Theme>);
  registry.set(name, full);
  return full;
}

export type ThemeSpec = string | (DeepPartial<Theme> & { extends?: string });

/**
 * Colors that follow the theme, usable anywhere a spec takes a color:
 * `$ink`, `$ink-2`, `$muted`, `$grid`, `$axis`, `$surface`, `$up` / `$down` (the
 * good / bad colors of `marks.kpi`: a rise, a fall), and `$1`…`$8` for the
 * categorical slots. A spec written with them reads in light and dark.
 */
export function themeColor(theme: Theme, value: string): string {
  if (!value.startsWith('$')) return value;
  const slot = /^\$(\d)$/.exec(value);
  if (slot) return theme.palette.categorical[(Number(slot[1]) - 1) % theme.palette.categorical.length];
  const tokens: Record<string, string> = {
    $ink: theme.text.primary,
    '$ink-2': theme.text.secondary,
    $muted: theme.text.muted,
    $grid: theme.grid.y.color,
    $axis: theme.axis.line.color,
    $surface: theme.background,
    $up: theme.marks.kpi.good,
    $down: theme.marks.kpi.bad,
  };
  return tokens[value] ?? value;
}

/** Replace theme tokens in every string of a style-like object. */
export function resolveThemeColors<T>(theme: Theme, value: T): T {
  if (typeof value === 'string') return themeColor(theme, value) as T;
  if (Array.isArray(value)) return value.map((v) => resolveThemeColors(theme, v)) as T;
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveThemeColors(theme, v)])) as T;
  }
  return value;
}

export function resolveTheme(spec: ThemeSpec | undefined): Theme {
  if (spec === undefined) return lightTheme;
  if (typeof spec === 'string') {
    const t = registry.get(spec);
    if (!t) throw new Error(`futurCharts: unknown theme "${spec}". Registered: ${[...registry.keys()].join(', ')}`);
    return t;
  }
  const { extends: base, ...overrides } = spec;
  return deepMerge(resolveTheme(base ?? 'light'), overrides as DeepPartial<Theme>);
}
