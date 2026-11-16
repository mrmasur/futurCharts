# futurCharts

Librairie de graphiques rendue sur GPU, pilotée par une spec déclarative, pensée pour une application de BI.

```bash
npm install
npm run dev        # démo sur http://localhost:5273
npm test
npm run typecheck
```

## Utilisation

```ts
import { Chart, chart } from '@futurcharts/core';

const spec = chart(rows)
  .title('Chiffre d’affaires', 'Par pays')
  .line({ x: 'date', y: 'revenue', color: 'country' })
  .interactions({ zoom: { axes: 'x' } })
  .theme('dark')
  .toSpec();              // JSON pur : stockable, versionnable, éditable

const c = await Chart.create(element, spec);
c.on('click', ({ items }) => console.log(items));
```

Le builder ne produit qu'une `ChartSpec`. Tout ce qu'il exprime peut s'écrire directement en JSON.

## Architecture

| Dossier (`packages/core/src`) | Rôle |
|---|---|
| `render/` | Contrat de rendu indépendant du moteur (`types.ts`, `layouts.ts`) et moteur `webgl2/` |
| `scale/` | Échelles linéaire, log, temps, bandes. Elles produisent des positions normalisées, jamais des pixels |
| `marks/` | Marques `line`, `area`, `bar`, `point`, enregistrées via `registerMark` |
| `theme/` | Thèmes `light` / `dark`, `registerTheme`, surcharge feuille par feuille |
| `spec/` | Types de la spec et builder |
| `chart/` | Mise en page, axes, légende, survol, zoom |

Les agrégations lourdes restent dans la base (ClickHouse, Elasticsearch). La librairie reçoit des colonnes
(tableaux typés) ou des lignes, et ne fait que les transformations de présentation (empilement, tri).
`spec.fields` porte le catalogue de champs (type, libellé, format) : c'est le point d'entrée d'une couche
sémantique dbt.

## Adaptateurs de données

`@futurcharts/adapters` transforme une réponse de serveur en colonnes et en catalogue de champs. Ce sont des
fonctions pures, sans client réseau : la requête reste dans votre API.

```ts
import { fromClickHouse, fromEsAggregations, fieldsFromDbt, mergeFields } from '@futurcharts/adapters';

const res = fromClickHouse(json);                       // FORMAT JSON, JSONCompact, JSONColumnsWithMetadata
const fields = mergeFields(res.fields, fieldsFromDbt(manifest, { semanticModel: 'subscriptions' }));
chart(res.data).fields(fields).bar({ x: 'month', y: 'mrr', color: 'plan' }, { stack: true });
```

| Fonction | Entrée |
|---|---|
| `fromEsAggregations` | Agrégations Elasticsearch imbriquées : une ligne par bucket le plus profond |
| `fromEsHits` | Documents bruts (`hits.hits[]._source`) |
| `fromEsTable` | Réponses ES\|QL et SQL (`columns` + `values` / `rows`) |
| `fromClickHouse` | Réponse HTTP ClickHouse avec `meta` ; types déduits, dates et nombres en `Float64Array` |
| `fieldsFromDbt` | `manifest.json` : colonnes d'un modèle, ou dimensions, mesures et métriques d'un modèle sémantique |

Les libellés et formats se lisent dans dbt via `label`, `description` et `meta.format` (une `FormatSpec`).

## Règle : la porte WebGPU reste ouverte

- Rien au-dessus de `render/` ne référence un concept WebGL. Les marques ne connaissent que `Renderer`,
  `Batch` et les dispositions de `layouts.ts`.
- Les dispositions sont en float32, quatre composantes au plus par attribut : elles se traduisent telles
  quelles en `GPUVertexBufferLayout`.
- `Chart.create` et `createRenderer` sont asynchrones, parce que l'obtention d'un device WebGPU l'est.
- Un moteur WebGPU s'ajoute en implémentant `Renderer` dans `render/webgpu/` et en le sondant dans
  `createRenderer('auto')`. Il se branche aussi dès maintenant via `options.renderer`.

## Pas encore fait

Lecture du format Arrow, wrappers React / Vue / Ember, moteur WebGPU,
export SVG/PDF, tirets sur les lignes, barres horizontales, gestion de la perte de contexte WebGL.
