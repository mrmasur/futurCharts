# futurCharts

Librairie de graphiques GPU pour une future app de BI (sources : Elasticsearch, ClickHouse, dbt). Voir README.md.
Projet repris par un autre compte, sur le même Mac et dans le même dossier, le 2026-11-23 : lire d'abord `docs/REPRISE.md` (règles, état), `docs/ARCHITECTURE.md`
(trajet d'une spec, recettes : ajouter une marque, une primitive) et `docs/RECOMMANDATIONS.md` (priorités).
Mettre ces documents à jour quand un chantier avance.

- Démo et Storybook écoutent sur le réseau local (`--host`) : accessibles depuis un autre poste par l'IP du Mac.
- `npm run dev` (démo, port 5273 ; `/wrappers.html` pour React, Vue, Web Component), `npm test`, `npm run typecheck`, `npm run build`.
- **Tests visuels** (faits le 2026-11-23) : `npm run test:visual` (Playwright, ~1 min) compare chaque exemple de la
  galerie à sa capture de référence, en 4 variantes (bureau clair, bureau sombre, 343 × 260, 375 × 520), au pixel près.
  À lancer après tout changement de rendu ; si l'écart est voulu, `npm run test:visual:update` puis **regarder** les
  images changées (`git status tests/visual/captures`) avant de les commiter. Un nouvel exemple y entre tout seul.
  Détail : `docs/ARCHITECTURE.md` § 6.
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
  lignes et des aires, et sortie animée des données qui disparaissent. Ne rien concevoir qui l'empêche : chaque donnée doit
  pouvoir garder une identité stable d'un état à l'autre, et l'interpolation doit pouvoir se faire sur GPU
  (deux états de buffer + un uniform de progression), sans reconstruire les batches à chaque image.
- **Diagrammes de flux** (`mark: 'flow'`, `marks/flow.ts` + `marks/flowLayout.ts`) : placement en couches maison
  (rupture des cycles, plus long chemin, nœuds intermédiaires, barycentres). Couloirs (`lanes`) et routage
  orthogonal (`routing`) faits le 2026-11-23 en style `boxes` (`marks/flowRoute.ts`). Pas encore : édition à la souris
  en `boxes`.
- **Galerie** (demandée le 2026-11-17, modèle : la page de démos Highcharts, sans en reprendre ni la marque ni les
  textes) : `#/galerie` en vignettes vivantes par famille avec recherche, `#/demo/<nom>` en page détail. Chaque
  nouveau type de graphique y reçoit un exemple (`library.ts` : `entries` et `GROUPS`). Depuis le 2026-11-23 un
  nouvel exemple va dans `apps/demo/src/examples/<famille>.ts`.
- **État au 2026-11-23** : la branche `graphiques-2026-11-23` (non fusionnée dans `main`) porte les tests visuels,
  50 marques et 103 exemples nouveaux (217 en tout), le double axe (`scales.secondary`) et un contrat des marques
  complété (`MarkLabel.rotate` / `ellipsis`, `BuiltMark.hover`, `legendRamp`). Reste à faire, dans l'ordre :
  `docs/RECOMMANDATIONS.md` § Priorité 0.
- **Sources d'inspiration** pour les nouveaux graphiques (rappelées le 2026-11-23) : Tableau, Apache ECharts et
  Highcharts, pour les types de graphiques et leur finition ; jamais leurs marques, textes, données ni code.
- **Nouvelles familles** (depuis le 2026-11-23) : une famille de marques par fichier `marks/<famille>.ts` (table
  `<FAMILLE>_MARKS` branchée dans `builtin.ts`) et ses exemples dans `apps/demo/src/examples/<famille>.ts`
  (`FAMILIES`, branché dans `examples/index.ts`), plutôt que d'allonger `library.ts`. Plusieurs agents peuvent ainsi
  travailler en parallèle sans se marcher dessus ; seuls `theme.ts`, `spec/types.ts` et le README restent partagés.
- Les marques animées dans le temps (`race`, `motion`) exposent un `Timeline` ; le graphique ajoute la barre de lecture.
- Le texte posé sur une couleur prend `on: fill` (encre contrastée) ; posé sur un fond clair (piste, surface),
  il prend l'encre du thème. Ne jamais laisser du texte blanc déborder d'une marque sur le fond.
- **Tableur** (`packages/core/src/sheet/`, demandé le 2026-11-18) : grille éditable en DOM (seule exception au rendu
  GPU : saisie, sélection et presse-papiers l'exigent), formules maison (`formula.ts`), lignes virtualisées. Les données
  vivent dans `SheetModel` (sans DOM) : un classeur garde un modèle par feuille et une seule vue. Dates, fusions, mise en
  forme, classeur et wrappers faits. Les fusions sont ignorées pendant un tri. Pas encore : lien avec le catalogue dbt.
- **Petits écrans** (demandé le 2026-11-23) : compaction automatique (sous-titre, titres d'axes, légende), règles
  `responsive` dans la spec (le choix du graphique de remplacement revient à la spec), petits multiples en un panneau à
  la fois, calendrier orienté au mieux, appui = infobulle. Vérifier avec `fcAudit(343, 260)` et `fcAudit(375, 520)` dans
  la console de la galerie : seul le calendrier d'une année reste à l'étroit (cases de 5 à 8 px), c'est un cas pour
  une règle `responsive`.
- Les échelles produisent des positions normalisées ; le zoom ne modifie que la transformation de vue, jamais les batches.
