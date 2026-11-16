import type { ColumnType, FieldSpec } from '@futurcharts/core';

type Json = Record<string, any>;

export interface DbtOptions {
  /** Model name (or unique id): take the field catalog from its documented columns. */
  model?: string;
  /** Semantic model name (or unique id): dimensions and measures. */
  semanticModel?: string;
  /** Also include every metric of the project, by name. Default true when `semanticModel` is set. */
  metrics?: boolean;
}

/** Map a warehouse SQL type to a chart column type. Unknown types are left undefined. */
export function sqlColumnType(dataType: string | undefined | null): ColumnType | undefined {
  if (!dataType) return undefined;
  const t = dataType.toLowerCase();
  if (/(date|time)/.test(t)) return 'time';
  if (/(int|float|double|decimal|numeric|number|real)/.test(t)) return 'number';
  if (/(char|text|string|uuid|enum|bool)/.test(t)) return 'string';
  return undefined;
}

function find(group: Json | undefined, kind: string, name: string): Json | undefined {
  if (!group) return undefined;
  if (group[name]) return group[name];
  return Object.entries(group).find(([id, node]) => (node as Json).name === name && id.startsWith(`${kind}.`))?.[1] as Json | undefined;
}

/**
 * Presentation hints are not part of dbt itself, so they are read from `meta`
 * (on the node or under `config`): `label`, and `format` as a FormatSpec.
 */
function fromMeta(node: Json): Pick<FieldSpec, 'label' | 'format'> {
  const meta: Json = { ...node.config?.meta, ...node.meta };
  const out: Pick<FieldSpec, 'label' | 'format'> = {};
  if (typeof meta.label === 'string') out.label = meta.label;
  if (meta.format && typeof meta.format === 'object') out.format = meta.format;
  return out;
}

function field(node: Json, type: ColumnType | undefined): FieldSpec {
  const out: FieldSpec = { ...fromMeta(node) };
  if (type) out.type = type;
  if (typeof node.label === 'string' && node.label) out.label = node.label;
  if (typeof node.description === 'string' && node.description) out.description = node.description;
  return out;
}

/**
 * Build `spec.fields` from a dbt `manifest.json`.
 *
 * - `model`: one entry per documented column (type from `data_type`).
 * - `semanticModel`: dimensions (time or categorical) and measures (numeric),
 *   plus the project's metrics (numeric).
 */
export function fieldsFromDbt(manifest: Json, options: DbtOptions): Record<string, FieldSpec> {
  const fields: Record<string, FieldSpec> = {};

  if (options.model) {
    const model = find(manifest.nodes, 'model', options.model);
    if (!model) throw new Error(`futurCharts: dbt model "${options.model}" not found in the manifest.`);
    for (const [name, col] of Object.entries((model.columns ?? {}) as Json)) {
      fields[col.name ?? name] = field(col, sqlColumnType(col.data_type));
    }
  }

  if (options.semanticModel) {
    const sm = find(manifest.semantic_models, 'semantic_model', options.semanticModel);
    if (!sm) throw new Error(`futurCharts: dbt semantic model "${options.semanticModel}" not found in the manifest.`);
    for (const d of (sm.dimensions ?? []) as Json[]) {
      fields[d.name] = { ...fields[d.name], ...field(d, d.type === 'time' ? 'time' : 'string') };
    }
    for (const m of (sm.measures ?? []) as Json[]) {
      fields[m.name] = { ...fields[m.name], ...field(m, 'number') };
    }
  }

  if (options.metrics ?? !!options.semanticModel) {
    for (const metric of Object.values((manifest.metrics ?? {}) as Json)) {
      fields[metric.name] = { ...fields[metric.name], ...field(metric, 'number') };
    }
  }
  return fields;
}
