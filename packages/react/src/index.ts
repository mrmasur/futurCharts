import {
  mountChart,
  type Chart,
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
  readonly chart: Chart | undefined;
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
