import {
  mountChart,
  mountSpreadsheet,
  type SheetEvents,
  type SheetHandle,
  type SheetSpec,
  type Spreadsheet,
  type WorkbookSpec,
  type ChartView,
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
 * Events: `ready`, `hover`, `leave`, `click`, `zoom`, `legend`, `select`, `drill`, `layout`, `frame`, `error`.
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
    ready: (_chart: ChartView) => true,
    error: (_error: unknown) => true,
    hover: (_payload: ChartEvents['hover']) => true,
    leave: (_payload: ChartEvents['leave']) => true,
    click: (_payload: ChartEvents['click']) => true,
    zoom: (_payload: ChartEvents['zoom']) => true,
    legend: (_payload: ChartEvents['legend']) => true,
    select: (_payload: ChartEvents['select']) => true,
    drill: (_payload: ChartEvents['drill']) => true,
    layout: (_payload: ChartEvents['layout']) => true,
    frame: (_payload: ChartEvents['frame']) => true,
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
        onDrill: (p) => emit('drill', p),
        onLayout: (p) => emit('layout', p),
        onFrame: (p) => emit('frame', p),
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
    expose({ getChart: (): ChartView | undefined => handle?.chart });

    return () => h('div', { ref: container, style: { width: '100%', height: '100%' } });
  },
});

/**
 * `<FuturSheet :spec="spec" @change="save" />`: an editable spreadsheet (a sheet
 * with `rows`, or a workbook with `sheets`). Replacing `spec` reloads it; hold it
 * in a `shallowRef`. Events: `ready`, `change`, `resize`, `select`, `format`, `error`.
 * `getSheet()` through a template ref gives `getSpec()` (the edited cells).
 */
export const FuturSheet = defineComponent({
  name: 'FuturSheet',
  props: {
    spec: { type: Object as PropType<SheetSpec | WorkbookSpec>, required: true },
  },
  emits: {
    ready: (_sheet: Spreadsheet) => true,
    error: (_error: unknown) => true,
    change: (_payload: SheetEvents['change']) => true,
    resize: (_payload: SheetEvents['resize']) => true,
    select: (_payload: SheetEvents['select']) => true,
    format: (_payload: SheetEvents['format']) => true,
  },
  setup(props, { emit, expose }) {
    const container = ref<HTMLDivElement>();
    let handle: SheetHandle | undefined;
    onMounted(() => {
      handle = mountSpreadsheet(container.value!, toRaw(props.spec), {
        onReady: (s) => emit('ready', s),
        onError: (e) => emit('error', e),
        onChange: (p) => emit('change', p),
        onResize: (p) => emit('resize', p),
        onSelect: (p) => emit('select', p),
        onFormat: (p) => emit('format', p),
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
    expose({ getSheet: (): Spreadsheet | undefined => handle?.sheet });
    return () => h('div', { ref: container, style: { width: '100%', height: '100%' } });
  },
});
