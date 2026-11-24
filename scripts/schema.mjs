/**
 * JSON Schema of the chart spec, generated from `packages/core/src/spec/types.ts` (the reference),
 * written to `packages/core/schema/chart-spec.schema.json`. For editors and AI that write specs: validate
 * before rendering, get clear errors instead of a chart that throws.
 *   npm run schema            regenerate (the test tests/schema checks it is up to date)
 *
 * Two parts of the types are beyond the generator and are patched here:
 * - `MarkStyle` is an intersection of every mark's options under `DeepPartial`: the generator turns some
 *   of them into objects. It is left open (any options); the TypeScript types still check them.
 * - `ResponsiveRule.spec` is `Omit<Partial<ChartSpec>, 'responsive'>`, which comes out empty: it gets
 *   the properties of `ChartSpec` back, all optional.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';

const root = fileURLToPath(new URL('..', import.meta.url));
export function buildSchema() {
  const schema = createGenerator({
    path: `${root}packages/core/src/spec/types.ts`,
    tsconfig: `${root}packages/core/tsconfig.json`,
    type: 'ChartSpec',
    skipTypeCheck: true,
    topRef: false,
  }).createSchema('ChartSpec');
  const defs = schema.definitions;
  defs.MarkStyle = {
    type: 'object',
    description: 'Options of the mark (theme.marks[mark]) and `color`. Not checked by this schema: see Theme["marks"] in the TypeScript types.',
  };
  const { responsive: _ignored, ...props } = schema.properties;
  defs.ResponsiveRule.properties.spec = { ...defs.ResponsiveRule.properties.spec, properties: props };
  // Drop the definitions nothing points to any more (the ones of the old MarkStyle).
  const used = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      const name = decodeURIComponent(node.$ref.replace('#/definitions/', ''));
      if (!used.has(name)) {
        used.add(name);
        visit(defs[name]);
      }
    }
    for (const [k, v] of Object.entries(node)) if (k !== 'definitions') visit(v);
  };
  visit(schema);
  for (const name of Object.keys(defs)) if (!used.has(name)) delete defs[name];
  schema.$id = 'https://futurcharts.dev/schema/chart-spec.schema.json';
  schema.title = 'futurCharts ChartSpec';
  return schema;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = `${root}packages/core/schema/chart-spec.schema.json`;
  writeFileSync(out, `${JSON.stringify(buildSchema(), null, 2)}\n`);
  console.log(`schéma écrit : ${out}`);
}
