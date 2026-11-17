import {
  mountChart,
  type Chart,
  type ChartEvents,
  type ChartHandle,
  type ChartOptions,
  type ChartSpec,
} from '@futurcharts/core';
import { defineComponent, h, onBeforeUnmount, onMounted, ref, toRaw, watch, type PropType } from 'vue';

/**
 * `<FuturChart :spec="spec" @click="..." />`
 *
 * The chart updates when `spec` is replaced. Hold it in a `shallowRef` (or a
 * `computed`): a deep `ref` would wrap the data arrays in reactive proxies.
 * Events: `ready`, `hover`, `leave`, `click`, `zoom`, `legend`, `select`, `error`.
 * The component exposes `getChart()` through a template ref.
 */
export const FuturChart = defineComponent({
  name: 'FuturChart',
  props: {
    spec: { type: Object as PropType<ChartSpec>, required: true },
    /** Renderer and tooltip options; read once, on mount. */
    options: { type: Object as PropType<ChartOptions>, default: undefined },
  },
  emits: {
    ready: (_chart: Chart) => true,
    error: (_error: unknown) => true,
    hover: (_payload: ChartEvents['hover']) => true,
    leave: (_payload: ChartEvents['leave']) => true,
    click: (_payload: ChartEvents['click']) => true,
    zoom: (_payload: ChartEvents['zoom']) => true,
    legend: (_payload: ChartEvents['legend']) => true,
    select: (_payload: ChartEvents['select']) => true,
  },
  setup(props, { emit, expose }) {
    const container = ref<HTMLDivElement>();
    let handle: ChartHandle | undefined;

    onMounted(() => {
      handle = mountChart(container.value!, toRaw(props.spec), props.options && toRaw(props.options), {
        onReady: (c) => emit('ready', c),
        onError: (e) => emit('error', e),
        onHover: (p) => emit('hover', p),
        onLeave: (p) => emit('leave', p),
        onClick: (p) => emit('click', p),
        onZoom: (p) => emit('zoom', p),
        onLegend: (p) => emit('legend', p),
        onSelect: (p) => emit('select', p),
      });
    });
    watch(
      () => props.spec,
      (spec) => handle?.update(toRaw(spec)),
    );
    onBeforeUnmount(() => {
      handle?.destroy();
      handle = undefined;
    });
    expose({ getChart: (): Chart | undefined => handle?.chart });

    return () => h('div', { ref: container, style: { width: '100%', height: '100%' } });
  },
});
