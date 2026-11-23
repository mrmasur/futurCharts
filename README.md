# futurCharts

Librairie de graphiques rendue sur GPU, pilotée par une spec déclarative, pensée pour une application de BI.

```bash
npm install
npm run dev        # démo sur http://localhost:5273
npm test
npm run test:visual   # chaque exemple de la galerie comparé à sa capture de référence
npm run typecheck
npm run build      # dist/ de chaque paquet
```

**Reprise du projet** : [docs/REPRISE.md](docs/REPRISE.md) (démarrage, plan du dépôt, règles, état des chantiers),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (trajet d'une spec, contrat des marques, recettes),
[docs/RECOMMANDATIONS.md](docs/RECOMMANDATIONS.md) (priorités, risques, pièges).

## Storybook

`npm run storybook` (port 6006) : une page par famille de graphiques, une story par exemple de la galerie. L'onglet
**Controls** liste chaque option de style de la marque principale, avec sa description et sa valeur par défaut, lues
dans le type et les valeurs du thème : changer une valeur met le graphique à jour sur place. Thème clair ou sombre
dans la barre d'outils, hauteur et animation en contrôles, spec JSON exacte sous chaque graphique, et un sélecteur
d'état sur les exemples de transitions. Les stories sont générées depuis `apps/demo/src/library.ts` :
`npm run stories` après l'ajout d'un exemple.

## Tableur

```ts
import { createSheet } from '@futurcharts/core';

const sheet = await createSheet(element, {
  rows: [{ poste: 'Salons', t1: 42000, t2: 18000, total: '=SOMME(B1:C1)' }],
  columns: [
    { key: 'poste', label: 'Poste', width: 180 },
    { key: 't1', label: 'T1', format: { style: 'currency', currency: 'EUR', decimals: 0 } },
    { key: 'total', label: 'Total', type: 'number', editable: false, bar: true },
  ],
  totals: true,
  rules: [{ column: 'total', when: { gt: 50000 }, style: { color: '#1f8a4c', bold: true } }],
});
sheet.on('change', ({ row, column, value }) => save(row, column, value));
sheet.getSpec(); // cellules, largeurs, hauteurs et tri tels que l'utilisateur les a laissés
```

Une grille éditable, en JSON comme les graphiques, avec les mêmes thèmes et formats :
- **Formules** : références A1 et plages, `+ - * / ^ %`, comparaisons, `&`, fonctions en anglais ou en français
  (`SUM`/`SOMME`, `AVERAGE`/`MOYENNE`, `MIN`, `MAX`, `COUNT`/`NB`, `ROUND`/`ARRONDI`, `IF`/`SI`, `AND`/`ET`…),
  erreurs à la manière d'un tableur (`#DIV/0!`, `#REF!`, `#CYCLE!`).
- **À la main** : largeur des colonnes (double-clic : ajustée au contenu), hauteur des lignes, tri par clic sur
  l'en-tête ; tout est restitué par `getSpec()` et l'événement `resize`.
- **Au clavier** : flèches, Maj pour étendre, Entrée / F2 / saisie pour éditer, Tab, Suppr, Ctrl+Z ;
  copier-coller d'un bloc avec Excel ou Google Sheets (« 1 234,5 » et « 15 % » compris).
- **Mise en forme** : formats par colonne, cellules teintées (`heat`), barres dans les cellules (`bar`),
  règles conditionnelles, colonnes figées, ligne de totaux, zébrage, barre de formule, somme de la sélection.
- **Dates** : colonnes `type: 'date'` (valeurs `YYYY-MM-DD` dans la spec), saisies en `18/11/2026` ou `18/11`,
  affichées selon `dateFormat` ; dans les formules ce sont des numéros de jour, donc `=B1-A1` compte les jours
  (`AUJOURDHUI`, `DATE`, `ANNEE`, `MOIS`, `JOUR`…).
- **Fusion et mise en forme** : `merges: ['A1:A3']`, `cells: { B2: { bold: true, background: '#fde' } }`, ou depuis
  la barre (⊞ fusionner / défusionner, G, I, alignement, couleur de fond et de texte, effacer ; Ctrl+B, Ctrl+I).
- **Classeur** : `createWorkbook(el, { sheets: [...] })` ou `createSpreadsheet` (qui choisit selon la spec) ; onglets
  pour changer, ajouter, renommer (double-clic) ou supprimer une feuille ; formules entre feuilles (`=Budget!F1`,
  `=SOMME('Ventes 2026'!B1:B12)`).
- **Frameworks** : `<FuturSheet spec={spec} onChange={…} />` (React), `<FuturSheet :spec @change />` (Vue),
  `<futur-sheet>` (`defineFuturSheet()`), `{{futur-sheet this.spec onChange=…}}` (Ember, `FuturSheetModifier`).
- Seules les lignes visibles sont dans le DOM : 10 000 lignes défilent sans à-coup. C'est du DOM, pas du GPU :
  la saisie, la sélection de texte et le presse-papiers le demandent.

Démo : `gallery.html#/tableur` ; Storybook : page *Tableur*.

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
| `scale/` | Échelles linéaire, log, temps, bandes, Mercator. Elles produisent des positions normalisées, jamais des pixels |
| `marks/` | Les 53 marques du cœur (`geoshape` est dans `@futurcharts/geo`), contrat dans `registry.ts`, enregistrées par `ensureBuiltinMarks` ; `registerMark` pour les vôtres |
| `data/` | `Table` (colonnes typées) et transformations de la spec |
| `theme/` | Thèmes `light` / `dark`, `registerTheme`, surcharge feuille par feuille ; options de style documentées dans `Theme['marks']` |
| `spec/` | Types de la spec (référence commentée de toutes les options) et builder |
| `chart/` | Mise en page, axes, légende, survol, zoom, sélection, transitions, petits multiples, wrappers (`mount.ts`) |
| `sheet/` | Tableur : modèle sans DOM, formules, vue virtualisée, classeur |

Détail du trajet d'une spec jusqu'à l'image : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Les agrégations lourdes restent dans la base (ClickHouse, Elasticsearch). La librairie reçoit des colonnes
(tableaux typés) ou des lignes, et ne fait que les transformations de présentation (empilement, tri).
`spec.fields` porte le catalogue de champs (type, libellé, format) : c'est le point d'entrée d'une couche
sémantique dbt.

## Types de graphiques

Démo : `http://localhost:5273/gallery.html`, une application de tableau de bord.

- **Tableaux de bord** : Ventes (indicateurs, tendance, canaux, carte, catégories, tunnel, saisonnalité, avec
  filtres de période et filtres croisés : un clic sur une part, une bulle ou une barre filtre tout le reste),
  Opérations (parcours des tickets, délais, calendrier), Données (pipeline déplaçable, Sankey).
- **Galerie** (`#/galerie`) : un aperçu vivant de chaque graphique, rangé par famille, avec une recherche
  (titre, description, marque). Un clic ouvre la page du graphique (`#/demo/<nom>`) : le graphique en grand, sa
  description, ses marques et sa spec JSON à copier, avec précédent / suivant dans la famille. Les aperçus ne
  sont créés qu'à l'approche de l'écran.
- Menu ⋯ de chaque carte : voir la spec JSON, exporter en PNG, réinitialiser la vue. Palette et thème dans
  l'en-tête, retenus d'une visite à l'autre.

| Famille | Marques et options |
|---|---|
| Comparaison | `bar` vertical ou horizontal (catégories sur y : détecté automatiquement), groupé, empilé, étiquettes de valeur (`style.labels`) |
| Évolution | `line` (droite, lissée, en escalier ; `dash` en px, `markers`, `labels` sur chaque point, trous aux valeurs manquantes sauf `connectNulls`), `area` empilée ou en bande (`y` → `y2`) |
| Intervalles | `bar` avec `x2` / `y2` : Gantt, cascade ; `rule` : moustaches, barres d'erreur, sucettes ; `tick` : médianes, distributions en traits |
| Distribution | courbe en cloche ou densité (transform `density`, `method: "normal"` ou `kde` ; `step` = largeur des classes pour la superposer à un histogramme), nuage dispersé (`point` avec `style.jitter`), histogramme (transform `bin` + `bar`), boîte à moustaches (transform `boxplot` + `rule` + `bar` + `tick` + `point`), `violin` (densité, quartiles, médiane) |
| Corrélation | `point` (nuage, bulles avec `size`), droite de régression (transform `regression`) |
| Parts | `pie`, `donut` (`startAngle` / `endAngle` en degrés : `-90` et `90` pour un demi-anneau ; `encode.size` : rayon variable), `treemap` (squarifié, groupes), `parliament` (un point par siège) |
| Indicateurs | `gauge` (min, max, objectif), `funnel` (taux de conversion) |
| Matrices | `heatmap` (deux axes de catégories) |
| Profils | `radar` |
| Cartes | `geoshape` (fond de carte, choroplèthe), `point` sur `projection`, sélection au lasso |
| Flux | `sankey` (`source`, `target`, `value`) |
| Hiérarchies | `sunburst` (`path`: liste de champs, du niveau extérieur au plus fin), `treemap` |
| Calendrier | `calendar` (une case par jour, `x`: date) |
| Indicateurs (suite) | `kpi` (dernière valeur, évolution, sparkline ; `upIsGood`), `waffle` (100 cases) |
| Polaires | `rose` (rose polaire, aire proportionnelle, séries empilées), `radialBar` (un anneau par catégorie ; valeurs à l'encre sur la piste, `labelColor` pour en changer) |
| Relations (suite) | `arcDiagram` (`source`, `target`, `value` : nœuds alignés, liens en demi-cercles), `bubbles` (bulles groupées, une grappe par `color`) |
| Champs | `vector` (flèches : `x`, `y`, `angle` en degrés depuis le haut, `size` pour la longueur) |
| Parts (pyramide) | `pyramid` (étages empilés depuis la pointe, hauteur selon la valeur) |
| Animation | `motion` (nuage animé façon Gapminder : `key`, `time`, `x`, `y`, `size`, `color` ; barre de lecture, traînée sur les points de `highlight`) |
| Tableaux | `pivot` (tableau croisé : `key` en lignes, `x` en colonnes, `value` ; cellules teintées, total et tendance par ligne) |
| Distributions (suite) | `ridgeline` (densités empilées par `key`), `beeswarm` (points sans chevauchement le long de `x`, un essaim par `key`) |
| Grilles | `tilemap` (tuiles hexagonales ou carrées en colonne `x` / ligne `y`), `surface` (grille interpolée + courbes de niveau), `horizon` (séries repliées en bandes) |
| Unités | `pictorial` (une rangée de symboles par catégorie, `style.unit` par symbole) |
| Arbres (suite) | `tree` avec `style.radial` (arbre radial) |
| Jauges (suite) | `gauge` avec `zones` (seuils colorés), `needle`, `ticks`, `sweep` (ouverture en degrés), `rounded` |
| Matrices (suite) | `heatmap` avec `circles` (punch card) ou `diverging` (corrélations, transform `correlation`), `polarHeatmap` (cases en anneaux) |
| Multivarié (suite) | `splom` (matrice de nuages, `path` = champs), `scatter3d` (`x`, `y`, `z`, à tourner à la souris) |
| Globe | `globe` (projection orthographique, `geo` pour les contours, points `x`/`y`, routes en grands cercles vers `x2`/`y2`, à tourner à la souris) |
| Effets | `point` avec `pulse` (ondes), `bar` avec `track` (piste), `line` avec `colorByValue`, parts avec `cornerRadius`, `tree` avec `reverse` |
| Bourse | `candlestick` (`y` haut, `y2` bas, `open`, `close` ; `style.ohlc` pour des barres OHLC) |
| Cartes (suite) | `route` (de `x`, `y` à `x2`, `y2`, courbée ; épaisseur avec `size`) |
| Arbres | `tree` (`path` ; dendrogramme, ou organigramme avec `boxes` et `direction: "TB"`), `icicle` (partition en lignes, zoom au clic ; `orientation: "BT"` pour un flame chart) |
| Ensembles | `venn` (2 ou 3 ensembles ; `key` vaut `A`, `A&B` ou `A&B&C`, aires proportionnelles) |
| Texte et temps | `wordcloud` (taille selon `value`), `timeline` (frise : `x` date, `key` titre, `value` détail) |
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

### Une série, une part, des étiquettes à son goût

```json
{ "mark": "line", "encode": { "x": "month", "y": "revenue", "color": "country" },
  "style": { "color": "$muted", "opacity": 0.55, "endLabels": true },
  "series": { "Italie": { "color": "#e34948", "width": 4, "opacity": 1, "markers": true, "labelColor": "#e34948" } },
  "labels": { "color": "$ink", "scale": 1.15, "weight": 700, "background": "$surface" } }
```

- `series` : le style d'une série par son nom (ligne, aire, barres, parts, nœuds : la couleur vaut partout,
  légende comprise) ; `width`, `dash`, `opacity`, `markers` pour les lignes et les aires ; `labelColor` pour ses étiquettes.
- `labels` : l'encre, la taille (facteur), la graisse et un fond pour **toutes** les étiquettes du calque, quelle que
  soit la marque (valeurs des barres, parts, centre d'un anneau, noms en bout de ligne, notes…). Par défaut pour tous
  les graphiques : `theme.labels`. Les jetons de thème (`$ink`, `$1`, `$surface`) sont acceptés.
- Storybook : un groupe *étiquettes* dans les contrôles de chaque graphique.

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

## Frise chronologique et liens

```json
{ "mark": "timeline", "encode": { "x": "date", "key": "version", "value": "detail", "size": "importance" },
  "style": { "minImportance": 3 }, "link": { "field": "url", "target": "_self" } }
"interactions": { "zoom": { "axes": "x" } }
```

**Rôles de champ** : l'importance et le lien se déclarent une fois dans le catalogue des champs, et tout graphique
qui connaît le rôle s'en sert sans encodage de plus : `"fields": { "poids": { "role": "importance" }, "page": { "role": "link" } }`
(depuis dbt : `meta: { role: importance }` sur la colonne).

Chaque événement est un point à sa date ; seuls les plus importants (`encode.size` ou le champ de rôle `importance`) reçoivent une carte, là où
elle tient, sur quatre niveaux ; sous `minImportance`, jamais de carte. Zoomer (molette, pincement) replace les
cartes pour la période visible. Au survol : l'événement et ses voisins. `link` (sur toute marque qui le gère, la
frise d'abord) : un clic émet `link` (`onLink`, `@link`, `chart-link`) puis ouvre l'adresse, sauf `open: false`.

## Petits écrans

La bibliothèque s'adapte seule, et la spec dit le reste :

- **Compaction automatique** : quand la zone de dessin deviendrait trop petite (moins de 120 × 90 px), le graphique
  renonce, dans l'ordre, au sous-titre, aux titres d'axes, puis à la légende (`autoCompact: false` pour l'empêcher).
  Les noms de catégories trop longs (tâches d'un Gantt) sont coupés avec « … » au-delà d'un tiers de la largeur ;
  les graduations trop serrées sont sautées.
- **Petits multiples** : jamais de panneau de moins de 130 px de large ; si les panneaux ne tiennent pas lisiblement
  dans le cadre, un seul panneau à la fois avec un bouton par valeur.
- **Calendrier** : semaines en travers ou en hauteur, selon ce qui donne les plus grandes cases (`direction` pour imposer).
- **Tactile** : un appui montre l'infobulle (pas de survol au doigt) ; elle reste jusqu'à l'appui suivant.
- **Règles par taille** (`responsive`) : pour changer d'options, ou de graphique, selon la taille du cadre. C'est
  à la spec (donc à l'application ou à l'IA qui l'écrit) de dire quoi montrer à la place :

```json
"responsive": [{ "maxWidth": 480, "spec": { "layers": [{ "mark": "bar", "encode": { "x": "users", "y": "target" } }] } }]
```

Audit : dans la console de `gallery.html`, `await fcAudit(343, 260)` monte chaque exemple à cette taille et signale
ceux dont le dessin est trop à l'étroit.

## Annotations

```json
"annotations": [
  { "y": 1200, "text": "Objectif", "color": "$5" },
  { "x": ["2025-04-01", "2025-06-01"], "text": "Campagne" },
  { "x": "2025-10-01", "y": 1013, "text": "Nouvelle gamme" }
]
```

En coordonnées de données, sur tout graphique cartésien : une valeur donne une ligne (pointillée par défaut,
`dash: []` pour un trait plein), une paire donne une bande, `x` et `y` ensemble une note sur un point. `x` et `y`
sont les axes de l'écran (sur des barres horizontales, les valeurs sont en `x`). Une ligne d'objectif hors des
données élargit l'axe pour rester visible. Les annotations suivent le zoom.

## Graphiques synchronisés et navigateur

`"interactions": { "sync": "ventes" }` sur plusieurs graphiques : survol à la même date et même plage visible
(zoomer l'un zoome les autres). Un graphique avec `"navigator": true` dans le même groupe devient un sélecteur de
plage : on y glisse une fenêtre (bords redimensionnables), un clic remet tout. Zoomé en x, l'axe des valeurs suit
ce qui est visible (seule la transformation de vue change) ; `interactions.zoom.fitY: false` pour l'en empêcher.
Une échelle log avec un `domain` explicite le garde tel quel, avec des graduations 1-2-5 sur un court intervalle.

## Course de barres

```json
{ "mark": "race", "encode": { "key": "product", "value": "sales", "time": "month", "color": "family" },
  "style": { "top": 10, "duration": 900, "autoplay": true, "loop": false } }
```

Une image par valeur de `time`. Entre deux images, les valeurs progressent en continu, les barres glissent vers
leur nouveau rang, l'axe suit le meneur et la date avance. Une barre de lecture (lecture / pause, curseur) est
ajoutée sous le graphique. API : `chart.play()`, `chart.pause()`, `chart.seek(index)` ; l'événement `frame`
(`onFrame`, `@frame`, `chart-frame`) annonce chaque nouvelle image, pour synchroniser le reste d'un tableau de bord.
La lecture démarre quand le graphique devient visible.

## Transitions entre deux états de données

`chart.update(spec)` (ou `setData`) avec les mêmes marques : chaque barre, chaque point et chaque part se déplace de son ancien
état vers le nouveau (position, taille, couleur), les nouveaux poussent de rien, en 650 ms (`animation: 1000`
pour une autre durée, `false` pour couper). L'identité d'une barre est sa série et sa catégorie, celle d'un point
sa série et son `encode.key` (sinon son x). Les deux états sont dans deux buffers et le vertex shader les mélange
selon un uniform de progression (`Batch.setPrevious`, `DrawCall.morph`) : aucun buffer n'est reconstruit pendant
l'animation. Les filtres des tableaux de bord et le masquage d'une série par la légende en profitent.

## Reste à faire en animation

Les transitions des barres, points et parts et le nuage animé (`motion`) sont faits. Restent les transitions des
lignes et des aires, et la sortie animée des données qui disparaissent. Même mécanique : une clé d'identité par
donnée pour apparier deux états, et une interpolation faite sur GPU entre deux états de buffer, pilotée par un
uniform de progression.

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
export SVG/PDF, gestion de la perte de contexte WebGL, accessibilité (lecteur d'écran, clavier), CI. Les tirets sont découpés à la construction : un zoom les étire avec les données. Ordre conseillé :
[docs/RECOMMANDATIONS.md](docs/RECOMMANDATIONS.md).
