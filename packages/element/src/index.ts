import { mountChart, type Chart, type ChartHandle, type ChartOptions, type ChartSpec } from '@futurcharts/core';

/**
 * `<futur-chart>` custom element: works in any framework, or none.
 *
 *   const el = document.querySelector('futur-chart');
 *   el.spec = { ... };                                  // property: any spec, typed arrays included
 *   el.addEventListener('chart-click', (e) => e.detail.items);
 *
 * A JSON spec can also be given as the `spec` attribute. Events: `chart-ready`,
 * `chart-hover`, `chart-leave`, `chart-click`, `chart-zoom`, `chart-legend`,
 * `chart-error`. The element needs a height (it is `display: block`).
 */
export class FuturChartElement extends HTMLElement {
  static observedAttributes = ['spec'];

  /** Renderer and tooltip options; read once, when the element connects. */
  options: ChartOptions = {};
  private handle?: ChartHandle;
  private current?: ChartSpec;

  get spec(): ChartSpec | undefined {
    return this.current;
  }
  set spec(value: ChartSpec | undefined) {
    this.current = value;
    if (!value) return;
    if (this.handle) this.handle.update(value);
    else if (this.isConnected) this.mount();
  }

  /** The underlying chart, once ready. */
  get chart(): Chart | undefined {
    return this.handle?.chart;
  }

  connectedCallback(): void {
    if (!this.style.display) this.style.display = 'block';
    if (this.current) this.mount();
  }

  disconnectedCallback(): void {
    this.handle?.destroy();
    this.handle = undefined;
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name !== 'spec' || !value) return;
    try {
      this.spec = JSON.parse(value) as ChartSpec;
    } catch (error) {
      this.emit('error', error);
    }
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(`chart-${type}`, { detail, bubbles: true, composed: true }));
  }

  private mount(): void {
    this.handle = mountChart(this, this.current!, this.options, {
      onReady: (chart) => this.emit('ready', chart),
      onError: (error) => this.emit('error', error),
      onHover: (p) => this.emit('hover', p),
      onLeave: (p) => this.emit('leave', p),
      onClick: (p) => this.emit('click', p),
      onZoom: (p) => this.emit('zoom', p),
      onLegend: (p) => this.emit('legend', p),
    });
  }
}

/** Register the element. Explicit, so importing the package has no side effect. */
export function defineFuturChart(tag = 'futur-chart'): void {
  if (!customElements.get(tag)) customElements.define(tag, FuturChartElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'futur-chart': FuturChartElement;
  }
}
