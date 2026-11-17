# futurCharts

Librairie de graphiques rendue sur GPU, pilotée par une spec déclarative, pensée pour une application de BI.

```bash
npm install
npm run dev        # démo sur http://localhost:5273
npm test
npm run typecheck
npm run build      # dist/ de chaque paquet
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

## Types de graphiques

Démo : `http://localhost:5273/gallery.html`, une application de tableau de bord.

- **Tableaux de bord** : Ventes (indicateurs, tendance, canaux, carte, catégories, tunnel, saisonnalité, avec
  filtres de période et filtres croisés : un clic sur une part, une bulle ou une barre filtre tout le reste),
  Opérations (parcours des tickets, délais, calendrier), Données (pipeline déplaçable, Sankey).
- **Bibliothèque** : tous les types de graphiques, rangés par famille.
- Menu ⋯ de chaque carte : voir la spec JSON, exporter en PNG, réinitialiser la vue. Palette et thème dans
  l'en-tête, retenus d'une visite à l'autre.

| Famille | Marques et options |
|---|---|
| Comparaison | `bar` vertical ou horizontal (catégories sur y : détecté automatiquement), groupé, empilé, étiquettes de valeur (`style.labels`) |
| Évolution | `line` (droite, lissée, en escalier), `area` empilée ou en bande (`y` → `y2`) |
| Intervalles | `bar` avec `x2` / `y2` : Gantt, cascade ; `rule` : moustaches, barres d'erreur, sucettes ; `tick` : médianes, distributions en traits |
| Distribution | histogramme (transform `bin` + `bar`), boîte à moustaches (transform `boxplot` + `rule` + `bar` + `tick` + `point`), `violin` (densité, quartiles, médiane) |
| Corrélation | `point` (nuage, bulles avec `size`), droite de régression (transform `regression`) |
| Parts | `pie`, `donut`, `treemap` (squarifié, groupes) |
| Indicateurs | `gauge` (min, max, objectif), `funnel` (taux de conversion) |
| Matrices | `heatmap` (deux axes de catégories) |
| Profils | `radar` |
| Cartes | `geoshape` (fond de carte, choroplèthe), `point` sur `projection`, sélection au lasso |
| Flux | `sankey` (`source`, `target`, `value`) |
| Hiérarchies | `sunburst` (`path`: liste de champs, du niveau extérieur au plus fin), `treemap` |
| Calendrier | `calendar` (une case par jour, `x`: date) |
| Indicateurs (suite) | `kpi` (dernière valeur, évolution, sparkline ; `upIsGood`), `waffle` (100 cases) |
| Polaires | `rose` (rose polaire, aire proportionnelle, séries empilées) |
| Parts (suite) | `marimekko` (largeur = part du total, hauteur = part dans la colonne), `pack` (cercles imbriqués) |
| Relations | `chord` (échanges entre entités), `network` (placement par forces, nœuds déplaçables) |
| Multivarié | `parallel` (coordonnées parallèles, `path` = champs à comparer), `hexbin` (densité de très nombreux points) |
| Empilements | `stack: true`, `stack: "normalize"` (100 %), `stack: "center"` (streamgraph) |
| Compositions | classement (`scales.y.reverse`), pente et étiquettes de fin de ligne (`style.endLabels`), puces (bullet), haltères, chandeliers |

### Mettre une valeur en avant

Sur n'importe quel graphique (barres, lignes, points, camembert, treemap, carte de chaleur, Sankey, sunburst,
calendrier, carte…) :

```json
{ "mark": "donut", "encode": { "key": "channel", "value": "visits" },
  "highlight": { "values": ["Email"], "color": "#e34948", "dim": 0.25 } }
```

Les valeurs citées gardent leur couleur (ou prennent `color`), les autres passent à l'opacité `dim`. `field` vaut
par défaut la catégorie du calque (`x`, `y` à l'horizontale, `key`, premier niveau de `path`, `source`).
C'est la forme la plus simple à produire pour une IA ; `overrides` reste disponible pour des règles plus fines
(seuils, plusieurs couleurs).

### Exploration animée

Un clic sur une part du `pie` ou du `donut` la fait sortir et atténue les autres (l'anneau affiche sa valeur au
centre). Un clic sur un segment du `sunburst` zoome sur cette branche, un clic au centre remonte d'un niveau. Un clic sur
une série de la `rose` l'isole, un second clic (ou le centre) ramène les autres. Les transitions durent 650 ms et
sont immédiates si le système demande moins d'animations. L'événement `drill` (`onDrill` en React, `@drill` en
Vue, `chart-drill` pour le Web Component) donne le chemin choisi, pour filtrer les autres graphiques d'un tableau
de bord. Le focus survit au redimensionnement et aux changements de données ou de thème.

Ces deux marques s'appuient sur la primitive `arc` (secteur d'anneau) : une animation n'y fait varier que quatre
nombres par segment, sans recalculer de géométrie.

### Épaisseur et couleur des barres

```json
{
  "mark": "bar",
  "encode": { "x": "country", "y": "sales" },
  "style": { "thickness": 10, "color": "#c3c2b7" },
  "overrides": [
    { "when": { "field": "country", "in": ["France", "Italie"] }, "style": { "color": "#2a78d6" } },
    { "when": { "field": "sales", "lt": 120 }, "style": { "opacity": 0.45 } }
  ]
}
```

Les couleurs d'une spec peuvent suivre le thème : `$ink`, `$ink-2`, `$muted`, `$grid`, `$axis`, `$surface`
et `$1` à `$8` pour les couleurs catégorielles. Une spec écrite ainsi reste lisible en clair comme en sombre.

`format.absolute` affiche les valeurs sans signe (pyramide des âges). `thickness` fixe l'épaisseur en px (jamais plus large que la bande) ; `bandPadding` règle l'espace entre
catégories. `overrides` s'applique à toute marque cartésienne (barres, points, traits) : la première règle qui
correspond l'emporte. Conditions : `equals`, `in`, `gt`, `gte`, `lt`, `lte` ; une liste de conditions doit être
entièrement vraie. Pour colorer une série entière, `scales.color.colors` suffit.

Les transformations (`layer.transform`) restent dans la spec JSON : `bin`, `aggregate`, `boxplot`, `waterfall`,
`sort`, `regression`. Un intervalle suit la convention `y` = début, `y2` = fin.

Tous les graphiques d'une page partagent un seul contexte WebGL2 (`renderer: 'auto'`) : les navigateurs en
limitent le nombre (environ 16) et retirent les plus anciens au-delà. `renderer: 'webgl2'` redonne un contexte
dédié à un graphique.

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

## Palettes

La galerie propose quatre palettes (Défaut, Océan, Crépuscule, Forêt), chacune en clair et en sombre. Chaque
palette a été validée : séparation pour les daltoniens entre couleurs voisines, distinction en vision normale,
bande de luminosité et contraste avec le fond. Une palette se passe dans le thème :
`theme: { extends: 'dark', palette: { categorical: [...], sequential: [...] } }`.

## Wrappers

Tous reposent sur `mountChart` (dans le cœur), qui gère la création asynchrone, les mises à jour et la
destruction. Le graphique se met à jour quand l'objet `spec` est **remplacé** : gardez-le stable entre deux rendus.

| Paquet | Usage |
|---|---|
| `@futurcharts/react` | `<FuturChart spec={spec} onClick={...} />` — mémoïser la spec avec `useMemo` ; `ref.current.chart` donne le graphique |
| `@futurcharts/vue` | `<FuturChart :spec="spec" @click="..." />` — tenir la spec dans un `shallowRef` |
| `@futurcharts/ember` | Modifier : `<div {{futurChart this.spec onClick=this.select}}></div>` |
| `@futurcharts/element` | `defineFuturChart()` puis `<futur-chart>` : propriété `spec`, événements `chart-click`, `chart-hover`… |

Le conteneur doit avoir une hauteur. En Ember classique (templates `.hbs`), réexportez le modifier dans
`app/modifiers/futur-chart.js` : `export { default } from '@futurcharts/ember';`.

`npm run build` produit `dist/` pour chaque paquet. La démo et les tests tournent sur les sources ;
`apps/demo/wrappers.html` monte le même graphique via React, Vue et le Web Component.

## Règle : la porte WebGPU reste ouverte

- Rien au-dessus de `render/` ne référence un concept WebGL. Les marques ne connaissent que `Renderer`,
  `Batch` et les dispositions de `layouts.ts`.
- Les dispositions sont en float32, quatre composantes au plus par attribut : elles se traduisent telles
  quelles en `GPUVertexBufferLayout`.
- `Chart.create` et `createRenderer` sont asynchrones, parce que l'obtention d'un device WebGPU l'est.
- Un moteur WebGPU s'ajoute en implémentant `Renderer` dans `render/webgpu/` et en le sondant dans
  `createRenderer('auto')`. Il se branche aussi dès maintenant via `options.renderer`.

## Animation d'entrée

Au premier affichage, les barres poussent en vague, les lignes se tracent, les camemberts et anneaux s'ouvrent,
les points grossissent, puis les étiquettes apparaissent (900 ms). `animation: false` la coupe, un nombre fixe sa
durée en ms ; elle est sautée si le système demande moins d'animations. Elle se calcule sur le GPU : une image
animée n'envoie aucune donnée.

## Petits multiples

```json
{ "facet": { "field": "country", "columns": 3, "height": 190 }, "layers": [ ... ] }
```

Un panneau par valeur du champ, avec le même ordre de catégories, les mêmes couleurs, les mêmes échelles
(`shared: false` pour des échelles libres) et une seule légende, qui masque une série dans tous les panneaux.
`createChart()` choisit la bonne vue ; les wrappers l'utilisent.

## Prévu : transitions et évolution dans le temps

- **Transitions** : passage fluide d'un état de données à un autre (filtre, série masquée, nouvelle période).
- **Évolution dans le temps** : une dimension de la spec joue le rôle d'images successives, pour les courses de
  barres et autres graphiques animés, avec lecture, pause et curseur temporel.

Conséquences sur l'architecture : une clé d'identité par donnée pour apparier deux états, et une interpolation
faite sur GPU entre deux états de buffer, pilotée par un uniform de progression.

## Diagrammes de flux

Des boîtes reliées pour tracer un processus de bout en bout, embranchements et boucles compris :

```json
{
  "mark": "flow",
  "graph": {
    "nodes": [
      { "id": "recue", "label": "Commande reçue", "shape": "start" },
      { "id": "paiement", "label": "Paiement validé ?", "shape": "decision" },
      { "id": "relance", "label": "Relancer le client", "group": "Service client", "value": 42 }
    ],
    "edges": [
      { "from": "recue", "to": "paiement" },
      { "from": "paiement", "to": "relance", "label": "Non" },
      { "from": "relance", "to": "paiement", "label": "Relance", "dashed": true }
    ]
  },
  "style": { "variant": "pipeline", "direction": "LR" }
}
```

- Deux styles (`style.variant`) :
  - `pipeline` (par défaut) : pictogrammes compacts et colorés, nom dessous, fines courbes grises sans flèches,
    de gauche à droite. Source = pastille, étape = barre, `decision` = deux anneaux croisés aux couleurs de ses
    entrées (jointure, choix), `io` = tuiles empilées (union), `subprocess` = double barre, `end` = tuile sombre
    (sortie). Les couleurs partent des sources et suivent le flux ; jointures et unions en ouvrent une nouvelle.
    `description` s'affiche sous le nom (la base d'origine d'une source, par exemple).
  - `boxes` : boîtes et flèches, losanges de décision, pour la documentation de processus.
- Placement automatique en couches : les boucles sont détectées et contournent les boîtes, les croisements
  sont réduits, de haut en bas (`TB`) ou de gauche à droite (`LR`).
- `value` sur une étape s'affiche sous son nom ; sur une flèche, il l'épaissit. `group` colore les boîtes et
  forme la légende. `highlight` met un chemin en avant (par identifiant ou libellé d'étape).
- Survol : détail de l'étape ou de la flèche. Clic sur une étape : événement `drill` avec son identifiant.
- Le texte suit la taille du diagramme ; trop petit pour être lu (75 % en pipeline, 85 % en boîtes), le diagramme
  s'ouvre à taille lisible et se parcourt en le glissant.
- Les boucles (et seulement elles) portent une pointe de flèche, pour montrer qu'elles remontent le flux.
- **Disposition à la main** (style pipeline) : glisser une étape la déplace (grille de 4 px), ses liens suivent.
  Au lâcher, l'événement `layout` (`onLayout`, `@layout`, `chart-layout`) donne la position de chaque étape ;
  l'app l'enregistre en `x` / `y` sur les nœuds du JSON, et la disposition revient telle quelle au prochain
  chargement. Une IA peut aussi écrire `x` / `y` directement. Les étapes sans position sont placées
  automatiquement. `chart.resetInteractions()` revient à la disposition automatique ;
  `style.editable: false` interdit le déplacement.

## Pas encore fait

Lecture du format Arrow, moteur WebGPU, publication sur npm,
export SVG/PDF, tirets sur les lignes, barres horizontales, gestion de la perte de contexte WebGL.
