import type { DataInput } from '../data/table';
import type { ThemeSpec } from '../theme/theme';
import type {
  AxisSpec,
  ChartSpec,
  ColorScaleSpec,
  Encoding,
  FieldSpec,
  InteractionSpec,
  LayerSpec,
  MarkStyle,
  ScaleSpec,
} from './types';

type LayerOptions = Omit<LayerSpec, 'mark' | 'encode'>;

/**
 * Typed fluent builder. It only ever produces a `ChartSpec`: there is nothing
 * the builder can express that the JSON spec cannot.
 */
export class ChartBuilder {
  private spec: ChartSpec = { layers: [] };

  constructor(data?: DataInput) {
    if (data) this.spec.data = data;
  }

  data(data: DataInput): this {
    this.spec.data = data;
    return this;
  }
  fields(fields: Record<string, FieldSpec>): this {
    this.spec.fields = { ...this.spec.fields, ...fields };
    return this;
  }
  title(title: string, subtitle?: string): this {
    this.spec.title = title;
    if (subtitle !== undefined) this.spec.subtitle = subtitle;
    return this;
  }
  theme(theme: ThemeSpec): this {
    this.spec.theme = theme;
    return this;
  }

  layer(layer: LayerSpec): this {
    this.spec.layers.push(layer);
    return this;
  }
  line(encode: Encoding, options: LayerOptions = {}): this {
    return this.layer({ mark: 'line', encode, ...options });
  }
  bar(encode: Encoding, options: LayerOptions = {}): this {
    return this.layer({ mark: 'bar', encode, ...options });
  }
  area(encode: Encoding, options: LayerOptions = {}): this {
    return this.layer({ mark: 'area', encode, ...options });
  }
  point(encode: Encoding, options: LayerOptions = {}): this {
    return this.layer({ mark: 'point', encode, ...options });
  }
  /** Style the most recently added layer. */
  style(style: MarkStyle): this {
    const last = this.spec.layers[this.spec.layers.length - 1];
    if (!last) throw new Error('futurCharts: style() needs a layer first.');
    last.style = { ...last.style, ...style } as MarkStyle;
    return this;
  }

  scale(channel: 'x' | 'y', scale: ScaleSpec): this;
  scale(channel: 'color', scale: ColorScaleSpec): this;
  scale(channel: 'x' | 'y' | 'color', scale: ScaleSpec | ColorScaleSpec): this {
    this.spec.scales = { ...this.spec.scales, [channel]: scale };
    return this;
  }
  axis(channel: 'x' | 'y', axis: AxisSpec | false): this {
    this.spec.axes = { ...this.spec.axes, [channel]: axis };
    return this;
  }
  legend(visible: boolean): this {
    this.spec.legend = visible;
    return this;
  }
  interactions(interactions: InteractionSpec): this {
    this.spec.interactions = { ...this.spec.interactions, ...interactions };
    return this;
  }

  toSpec(): ChartSpec {
    return this.spec;
  }
}

export function chart(data?: DataInput): ChartBuilder {
  return new ChartBuilder(data);
}
