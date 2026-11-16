import { registerDestructor } from '@ember/destroyable';
import {
  mountChart,
  type ChartHandle,
  type ChartHandlers,
  type ChartOptions,
  type ChartSpec,
} from '@futurcharts/core';
import Modifier, { type ArgsFor } from 'ember-modifier';

export interface FuturChartSignature {
  Element: HTMLElement;
  Args: {
    Positional: [spec: ChartSpec];
    Named: ChartHandlers & {
      /** Renderer and tooltip options; read once, when the element is inserted. */
      options?: ChartOptions;
    };
  };
}

/**
 * Element modifier: renders a chart into the element it is attached to.
 *
 *   <div class="chart" {{futur-chart this.spec onClick=this.select}}></div>
 *
 * The chart updates when `this.spec` is replaced (a tracked property or a
 * getter over tracked state). The element needs a height.
 *
 * To use it by name in classic templates, re-export it from your app:
 *   // app/modifiers/futur-chart.js
 *   export { default } from '@futurcharts/ember';
 * With template imports (.gjs / .gts), import it and use it directly.
 */
export default class FuturChartModifier extends Modifier<FuturChartSignature> {
  private handle?: ChartHandle;

  constructor(owner: ConstructorParameters<typeof Modifier>[0], args: ArgsFor<FuturChartSignature>) {
    super(owner, args);
    registerDestructor(this, () => this.handle?.destroy());
  }

  modify(
    element: HTMLElement,
    [spec]: FuturChartSignature['Args']['Positional'],
    { options, ...handlers }: FuturChartSignature['Args']['Named'],
  ): void {
    if (!this.handle) {
      this.handle = mountChart(element, spec, options, handlers);
      return;
    }
    this.handle.setHandlers(handlers);
    this.handle.update(spec);
  }
}

export { FuturChartModifier };
