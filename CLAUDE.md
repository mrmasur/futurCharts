# futurCharts

Librairie de graphiques GPU pour une future app de BI (sources : Elasticsearch, ClickHouse, dbt). Voir README.md.

- Démo et Storybook écoutent sur le réseau local (`--host`) : accessibles depuis un autre poste par l'IP du Mac.
- `npm run dev` (démo, port 5273 ; `/wrappers.html` pour React, Vue, Web Component), `npm test`, `npm run typecheck`, `npm run build`.
- `npm run storybook` (port 6006, `apps/storybook`) : stories générées depuis les exemples de la galerie par
  `npm run stories` ; à relancer après chaque nouvel exemple. Les contrôles et leurs descriptions viennent du thème
  (valeurs de `lightTheme.marks`, commentaires du type `Theme['marks']`) : documenter chaque option dans ce type.
- Les paquets sont `sideEffects: false` : aucun import pour effet de bord (`import './x'`), le bundler le supprime.
  Tout enregistrement se fait dans une fonction appelée explicitement (voir `ensureBuiltinMarks`).
- Pas de mot-clé `ember-addon` dans `@futurcharts/ember` : Ember CLI chargerait le paquet comme un addon v1.
- **WebGPU doit toujours rester possible.** Aucun concept WebGL hors de `packages/core/src/render/webgl2/`.
  Toute nouvelle primitive passe par `render/types.ts` et `render/layouts.ts`, et doit être traduisible en WebGPU.
- Un seul contexte WebGL2 partagé par page (`SharedWebGL2Renderer`) : ne jamais revenir à un contexte par graphique
  par défaut, la galerie (19 graphiques) dépasse la limite des navigateurs.
- **Performance** (mesurée le 2026-11-17 dans un onglet affiché : 60 i/s pour 12 graphiques redessinés à chaque image) :
  un graphique hors écran ne se dessine pas (IntersectionObserver) et son animation d'entrée attend qu'il soit vu ;
  une instance ne couvre que sa propre surface (cf. le quad serré de l'arc) ; les shaders sont compilés à la création
  du contexte ; les marques dépendant de la taille sont construites une seule fois. Mesurer avant d'optimiser :
  le rendu n'était pas le goulot, c'étaient les calculs de données et la compilation au premier affichage.
- La spec reste du JSON sérialisable ; ce qui exige une fonction va dans `ChartOptions`.
- **Animation** (demandée le 2026-11-16) : l'animation d'entrée est faite (`DrawCall.progress`, appliquée dans le
  vertex shader ; lignes et aplats révélés par le clip). La course de barres (`mark: 'race'`, contrat `Timeline`) et les transitions entre deux états
  (`Batch.setPrevious` + `DrawCall.morph`, `MarkDraw.keys` ; rect, point et arc) sont faites. Restent : transition des
  lignes, aires et arcs, et sortie animée des données qui disparaissent. Ne rien concevoir qui l'empêche : chaque donnée doit
  pouvoir garder une identité stable d'un état à l'autre, et l'interpolation doit pouvoir se faire sur GPU
  (deux états de buffer + un uniform de progression), sans reconstruire les batches à chaque image.
- **Diagrammes de flux** (`mark: 'flow'`, `marks/flow.ts` + `marks/flowLayout.ts`) : placement en couches maison
  (rupture des cycles, plus long chemin, nœuds intermédiaires, barycentres). Pas encore : couloirs (swimlanes),
  routage orthogonal, édition à la souris.
- **Galerie** (demandée le 2026-11-17, modèle : la page de démos Highcharts, sans en reprendre ni la marque ni les
  textes) : `#/galerie` en vignettes vivantes par famille avec recherche, `#/demo/<nom>` en page détail. Chaque
  nouveau type de graphique y reçoit un exemple (`library.ts` : `entries` et `GROUPS`). Pistes restantes du
  catalogue : faits (axe recalé sur la plage visible, Gapminder `motion`, tableau croisé `pivot` compris).
- Les marques animées dans le temps (`race`, `motion`) exposent un `Timeline` ; le graphique ajoute la barre de lecture.
- Le texte posé sur une couleur prend `on: fill` (encre contrastée) ; posé sur un fond clair (piste, surface),
  il prend l'encre du thème. Ne jamais laisser du texte blanc déborder d'une marque sur le fond.
- Les échelles produisent des positions normalisées ; le zoom ne modifie que la transformation de vue, jamais les batches.
