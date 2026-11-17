# futurCharts

Librairie de graphiques GPU pour une future app de BI (sources : Elasticsearch, ClickHouse, dbt). Voir README.md.

- `npm run dev` (démo, port 5273 ; `/wrappers.html` pour React, Vue, Web Component), `npm test`, `npm run typecheck`, `npm run build`.
- Les paquets sont `sideEffects: false` : aucun import pour effet de bord (`import './x'`), le bundler le supprime.
  Tout enregistrement se fait dans une fonction appelée explicitement (voir `ensureBuiltinMarks`).
- Pas de mot-clé `ember-addon` dans `@futurcharts/ember` : Ember CLI chargerait le paquet comme un addon v1.
- **WebGPU doit toujours rester possible.** Aucun concept WebGL hors de `packages/core/src/render/webgl2/`.
  Toute nouvelle primitive passe par `render/types.ts` et `render/layouts.ts`, et doit être traduisible en WebGPU.
- Un seul contexte WebGL2 partagé par page (`SharedWebGL2Renderer`) : ne jamais revenir à un contexte par graphique
  par défaut, la galerie (19 graphiques) dépasse la limite des navigateurs.
- La spec reste du JSON sérialisable ; ce qui exige une fonction va dans `ChartOptions`.
- **Animation** (demandée le 2026-11-16) : l'animation d'entrée est faite (`DrawCall.progress`, appliquée dans le
  vertex shader ; lignes et aplats révélés par le clip). Restent à venir : transitions entre deux états de données,
  et graphiques qui évoluent dans le temps (« bar chart race »). Ne rien concevoir qui l'empêche : chaque donnée doit
  pouvoir garder une identité stable d'un état à l'autre, et l'interpolation doit pouvoir se faire sur GPU
  (deux états de buffer + un uniform de progression), sans reconstruire les batches à chaque image.
- **Diagrammes de flux à venir** (demandés le 2026-11-17, pas encore implémentés) : boîtes reliées pour tracer un
  processus entier (début, fin, embranchements, boucles). Différent du Sankey : des nœuds positionnés par un layout
  de graphe orienté (cycles compris) et des liens routés, pas des flux proportionnels.
- Les échelles produisent des positions normalisées ; le zoom ne modifie que la transformation de vue, jamais les batches.
