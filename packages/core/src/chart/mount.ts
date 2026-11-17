import type { ChartSpec } from '../spec/types';
import { Chart, type ChartEvents, type ChartOptions } from './chart';

/** `onHover`, `onClick`, `onZoom`, `onLegend`, `onLeave`, plus lifecycle callbacks. */
export type ChartHandlers = {
  [K in keyof ChartEvents as `on${Capitalize<K>}`]?: (payload: ChartEvents[K]) => void;
} & {
  onReady?: (chart: Chart) => void;
  onError?: (error: unknown) => void;
};

export interface ChartHandle {
  /** The chart, once created. */
  readonly chart: Chart | undefined;
  readonly ready: Promise<Chart>;
  update(spec: ChartSpec): void;
  /** Swap the callbacks without touching the chart. */
  setHandlers(handlers: ChartHandlers): void;
  destroy(): void;
}

const EVENTS: (keyof ChartEvents)[] = ['hover', 'leave', 'click', 'zoom', 'legend', 'select'];

/**
 * Lifecycle glue shared by every framework wrapper. Chart creation is async,
 * so this covers the two races wrappers would otherwise each get wrong: a spec
 * that changes before the chart exists, and a host unmounted before it exists.
 */
export function mountChart(
  container: HTMLElement,
  spec: ChartSpec,
  options: ChartOptions = {},
  handlers: ChartHandlers = {},
): ChartHandle {
  let chart: Chart | undefined;
  let latest = spec;
  let current = handlers;
  let destroyed = false;

  const ready = Chart.create(container, spec, options).then((c) => {
    if (destroyed) {
      c.destroy();
      return c;
    }
    chart = c;
    if (latest !== spec) c.update(latest);
    for (const type of EVENTS) {
      const name = `on${type[0].toUpperCase()}${type.slice(1)}` as keyof ChartHandlers;
      c.on(type, (payload) => (current[name] as ((p: unknown) => void) | undefined)?.(payload));
    }
    current.onReady?.(c);
    return c;
  });
  ready.catch((error) => {
    if (current.onError) current.onError(error);
    else console.error(error);
  });

  return {
    get chart() {
      return chart;
    },
    ready,
    update(next) {
      if (next === latest) return;
      latest = next;
      chart?.update(next);
    },
    setHandlers(next) {
      current = next;
    },
    destroy() {
      destroyed = true;
      chart?.destroy();
      chart = undefined;
    },
  };
}
