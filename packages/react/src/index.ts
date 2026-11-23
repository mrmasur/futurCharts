import {
  mountChart,
  mountSpreadsheet,
  type SheetHandle,
  type SheetHandlers,
  type SheetSpec,
  type Spreadsheet,
  type WorkbookSpec,
  type ChartView,
  type ChartHandle,
  type ChartHandlers,
  type ChartOptions,
  type ChartSpec,
} from '@futurcharts/core';
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';

export interface FuturChartProps extends ChartHandlers {
  /**
   * The chart spec. The chart updates when the object identity changes, so
   * memoize it (`useMemo`): a new object on every render recompiles every time.
   */
  spec: ChartSpec;
  /** Renderer and tooltip options; read once, on mount. */
  options?: ChartOptions;
  className?: string;
  /** The container fills its parent by default; give the parent a height. */
  style?: CSSProperties;
}

export interface FuturChartRef {
  /** The underlying chart, once ready (`resetZoom()`, `toImage()`, `toggleSeries()`…). */
  readonly chart: ChartView | undefined;
}

export const FuturChart = forwardRef<FuturChartRef, FuturChartProps>(function FuturChart(props, ref) {
  const { spec, options, className, style, ...handlers } = props;
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<ChartHandle>();
  // Callbacks are read through a ref, so inline arrow functions never re-create the chart.
  const latest = useRef<ChartHandlers>(handlers);
  latest.current = handlers;

  useEffect(() => {
    const h = mountChart(container.current!, spec, options, {
      onReady: (c) => latest.current.onReady?.(c),
      onError: (e) => (latest.current.onError ? latest.current.onError(e) : console.error(e)),
      onHover: (p) => latest.current.onHover?.(p),
      onLeave: (p) => latest.current.onLeave?.(p),
      onClick: (p) => latest.current.onClick?.(p),
      onZoom: (p) => latest.current.onZoom?.(p),
      onLegend: (p) => latest.current.onLegend?.(p),
      onSelect: (p) => latest.current.onSelect?.(p),
      onDrill: (p) => latest.current.onDrill?.(p),
      onLayout: (p) => latest.current.onLayout?.(p),
      onFrame: (p) => latest.current.onFrame?.(p),
      onLink: (p) => latest.current.onLink?.(p),
    });
    handle.current = h;
    return () => {
      h.destroy();
      handle.current = undefined;
    };
    // Mount once: spec changes go through update() below, options are mount-time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.update(spec);
  }, [spec]);

  useImperativeHandle(
    ref,
    () => ({
      get chart() {
        return handle.current?.chart;
      },
    }),
    [],
  );

  return createElement('div', { ref: container, className, style: { width: '100%', height: '100%', ...style } });
});

export interface FuturSheetProps extends SheetHandlers {
  /** A sheet (`rows`) or a workbook (`sheets`). Replacing the object reloads it: keep it stable (`useMemo`, state). */
  spec: SheetSpec | WorkbookSpec;
  className?: string;
  /** The container fills its parent by default; give the parent a height. */
  style?: CSSProperties;
}

export interface FuturSheetRef {
  /** The sheet or workbook, once ready (`getSpec()` gives the edited cells back). */
  readonly sheet: Spreadsheet | undefined;
}

/** An editable spreadsheet: `<FuturSheet spec={spec} onChange={save} />`. */
export const FuturSheet = forwardRef<FuturSheetRef, FuturSheetProps>(function FuturSheet(props, ref) {
  const { spec, className, style, ...handlers } = props;
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<SheetHandle>();
  const latest = useRef<SheetHandlers>(handlers);
  latest.current = handlers;

  useEffect(() => {
    const h = mountSpreadsheet(container.current!, spec, {
      onReady: (s) => latest.current.onReady?.(s),
      onError: (e) => (latest.current.onError ? latest.current.onError(e) : console.error(e)),
      onChange: (p) => latest.current.onChange?.(p),
      onResize: (p) => latest.current.onResize?.(p),
      onSelect: (p) => latest.current.onSelect?.(p),
      onFormat: (p) => latest.current.onFormat?.(p),
    });
    handle.current = h;
    return () => {
      h.destroy();
      handle.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.update(spec);
  }, [spec]);

  useImperativeHandle(ref, () => ({ get sheet() { return handle.current?.sheet; } }), []);

  return createElement('div', { ref: container, className, style: { width: '100%', height: '100%', ...style } });
});
