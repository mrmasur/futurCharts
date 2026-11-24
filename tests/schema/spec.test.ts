/**
 * The JSON Schema of the spec (packages/core/schema/chart-spec.schema.json): up to date with the types,
 * accepting every gallery example, and refusing the mistakes an editor or an AI would make.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { entries } from '../../apps/demo/src/library';
// @ts-expect-error plain ES module script, no types
import { buildSchema } from '../../scripts/schema.mjs';

const file = fileURLToPath(new URL('../../packages/core/schema/chart-spec.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(file, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
// `date-time` is only used for dates inside data, which are not validated here.
ajv.addFormat('date-time', true);
const validate = ajv.compile(schema);

type Any = Record<string, any>;
/** The data (rows, typed arrays, GeoJSON) is not what the schema is about: it describes the chart. */
const withoutData = (spec: Any): Any => {
  const layers = (ls?: Any[]) => ls?.map((l) => ({ ...l, data: undefined, geo: undefined }));
  return JSON.parse(JSON.stringify({ ...spec, data: undefined, layers: layers(spec.layers), responsive: spec.responsive?.map((r: Any) => ({ ...r, spec: { ...r.spec, data: undefined, layers: layers(r.spec.layers) } })) }));
};
const errorsOf = (spec: Any) => (validate(withoutData(spec)) ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`));

describe('schéma de la spec', () => {
  it('est à jour avec les types (sinon : npm run schema)', () => {
    expect(JSON.parse(JSON.stringify(buildSchema()))).toEqual(schema);
  }, 30_000);

  it('accepte chaque exemple de la galerie', () => {
    const bad = entries.flatMap((e) => (e.tiles ?? [e.spec!]).flatMap((s) => errorsOf(s).map((m) => `${e.title} : ${m}`)));
    expect(bad).toEqual([]);
  });

  it('refuse les erreurs courantes', () => {
    const ok = { layers: [{ mark: 'bar', encode: { x: 'pays', y: 'ventes' } }] };
    expect(errorsOf(ok)).toEqual([]);
    expect(errorsOf({})).not.toEqual([]); // no layers
    expect(errorsOf({ ...ok, titre: 'Ventes' })).not.toEqual([]); // unknown key (a typo of title)
    expect(errorsOf({ layers: [{ mark: 'bar', encode: { x: 3 } }] })).not.toEqual([]); // a field name must be a string
    expect(errorsOf({ layers: [{ mark: 'bar' }] })).not.toEqual([]); // no encode
    expect(errorsOf({ ...ok, scales: { y: { type: 'logarithmique' } } })).not.toEqual([]); // unknown scale type
    expect(errorsOf({ ...ok, interactions: { zoom: { axes: 'z' } } })).not.toEqual([]);
    expect(errorsOf({ ...ok, responsive: [{ maxWidth: 400, spec: { legend: 'non' } }] })).not.toEqual([]);
  });
});
