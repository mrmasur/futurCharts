# Guide de reprise

Ce document s'adresse à la personne (ou au compte) qui reprend futurCharts. Il dit ce qu'est le projet, où il en
est, comment le faire tourner, et quelles règles ne pas casser. Le détail technique est dans
[ARCHITECTURE.md](ARCHITECTURE.md), les priorités et les risques dans [RECOMMANDATIONS.md](RECOMMANDATIONS.md).
Le [README](../README.md) reste la référence fonctionnelle (ce que la spec sait faire, avec des exemples).

État au 2026-11-23 : 30 commits sur `main`, tests, typecheck et build au vert. Le projet est repris par un autre
compte **sur le même Mac**, dans le même dossier (`~/Documents/futurCharts`) : rien à cloner ni à installer.
Reprise vérifiée le 2026-11-23 par le compte repreneur (80 tests, typecheck, build, galerie : tout passait tel
quel). Les 23 et 24, sur la branche **`graphiques-2026-11-23`** (fusionnée dans `main` le 2026-11-24) : tests
visuels, puis deux vagues de nouveaux graphiques écrites par des agents en parallèle (50 marques, 103 exemples,
double axe, contrat des marques complété), puis robustesse, accessibilité, textes traduisibles et performances.
Aucun dépôt distant n'est configuré (`git remote -v` est vide) : c'est la seule copie du code.

## 1. Ce qu'est futurCharts

Une librairie de graphiques pour une future application de BI (sources visées : Elasticsearch, ClickHouse, dbt).

- **Rendu GPU** (WebGL2 aujourd'hui, WebGPU prévu), un seul contexte partagé pour toute la page.
- **Spec déclarative en JSON** (`ChartSpec`) : stockable, versionnable, générable par une IA ou un éditeur visuel.
  Le builder `chart(rows).line(...).toSpec()` ne fait que produire ce JSON.
- **104 marques** (types de graphiques), des barres au globe 3D, en passant par Sankey, frise, diagrammes de flux,
  Gantt, indicateurs boursiers, cartogrammes, tableaux mis en forme.
- **Un tableur éditable** (`createSheet`, `createWorkbook`) avec formules, en DOM (seule exception au GPU).
- **Adaptateurs de données** purs (réponses ES / ClickHouse, manifeste dbt → colonnes + catalogue de champs).
- **Wrappers** React, Vue, Ember, Web Component, tous fondés sur `mountChart` / `mountSpreadsheet` du cœur.
- **Galerie** (222 exemples, 21 familles) et **Storybook** généré depuis la galerie.

Le projet est écrit en TypeScript strict, en monorepo npm workspaces, sans dépendance d'exécution dans le cœur
(seul `@futurcharts/geo` dépend de `earcut`).

## 2. Démarrer

Prérequis : Node 20 (testé en 20.20, npm 10.8). Pas de `.nvmrc` pour l'instant.

```bash
npm install
npm run dev          # démo : http://localhost:5273 (gallery.html, wrappers.html, maps.html)
npm run storybook    # http://localhost:6006
npm test             # vitest, 438 tests, ~1 s
npm run test:visual  # Playwright : 222 exemples × 4 variantes comparés à leurs captures, ~2 min
npm run test:visual:update   # accepter le rendu actuel comme nouvelle référence (relire les images)
npm run typecheck    # tsc sur chaque paquet et chaque app
npm run verif        # tout d'un coup : typecheck, tests, build, captures, robustesse, interactions (~6 min) ; avant toute fusion
npm run test:robustesse     # chaque exemple avec des données et des tailles hostiles : rien ne doit planter
npm run test:interactions   # chaque exemple survolé, cliqué, zoomé, glissé : sans erreur
npm run schema       # régénère le schéma JSON de la spec après un changement de spec/types.ts
npm run build        # dist/ de chaque paquet (vite + tsc)
npm run stories      # régénère les stories après un nouvel exemple de galerie
```

La démo et Storybook écoutent sur le réseau local (`--host`) : accessibles depuis un téléphone ou un autre poste
par l'IP du Mac. Ils tournent sur les **sources** (alias Vite vers `packages/*/src`), pas sur `dist/` : aucune
compilation à relancer pendant le développement. Les tests aussi (alias dans `vitest.config.ts`).

Pages utiles de la démo :

| Adresse | Contenu |
|---|---|
| `gallery.html#/galerie` | Toutes les vignettes, par famille, avec recherche |
| `gallery.html#/demo/<nom>` | Un exemple en grand, sa spec JSON, précédent / suivant |
| `gallery.html#/tableur` | Tableur et classeur |
| `gallery.html` (accueil) | Tableaux de bord Ventes, Opérations, Données (filtres croisés) |
| `wrappers.html` | Le même graphique via React, Vue et le Web Component |
| `maps.html` | Cartes |

Dans la console de `gallery.html`, `await fcAudit(343, 260)` monte chaque exemple à cette taille et signale ceux
dont le dessin est trop à l'étroit (audit petits écrans).

## 3. Plan du dépôt

```
packages/
  core/        le cœur : spec, données, échelles, marques, graphique, rendu, thème, tableur
  adapters/    réponses ES / ClickHouse / dbt → colonnes + catalogue de champs (fonctions pures)
  geo/         fonds de carte (GeoJSON → triangles via earcut), marque geoshape, registerGeo()
  react/ vue/ ember/ element/   wrappers fins autour de mountChart / mountSpreadsheet
apps/
  demo/        galerie, tableaux de bord, tableur (Vite)
    src/library.ts   les 114 exemples d'origine (`entries`, `GROUPS`) ; source de la galerie ET de Storybook
    src/examples/    les exemples ajoutés depuis, un fichier par famille (`FAMILIES`), joints par library.ts
    visual.html      un exemple seul à taille fixe, pour les tests visuels
  storybook/   Storybook HTML ; stories générées par scripts/generate.ts (fichiers 01-…18-, ne pas éditer)
tests/visual/        tests visuels : suite Playwright et captures de référence (voir ARCHITECTURE.md § 6)
playwright.config.ts variantes des tests visuels (bureau, sombre, mobile, mobile-haut)
scripts/build.mjs    build de chaque paquet (ordre important : core d'abord)
CLAUDE.md            règles du projet, lues automatiquement par Claude Code (à garder à jour)
```

Dans `packages/core/src` :

| Dossier | Rôle |
|---|---|
| `spec/` | Types de la spec (`types.ts`, très commenté : c'est la doc de référence des options) et builder |
| `data/` | `Table` (colonnes typées) et transformations (`bin`, `aggregate`, `boxplot`, `density`, `regression`…) |
| `scale/` | Échelles linéaire, log, temps, bandes, Mercator ; elles rendent des positions **normalisées** |
| `marks/` | Les marques : `registry.ts` (contrat), `builtin.ts` (enregistrement), puis une famille par fichier |
| `chart/` | `chart.ts` (la classe `Chart` : état, cycle de vie, compilation, rendu, pointeur, synchronisation), et ses modules : `layout.ts` (mise en page, compaction), `axes.ts`, `legend.ts`, `labels.ts` (étiquettes, anti-chevauchement), `hover.ts`, `tooltip.ts`, `zoom.ts`, `selection.ts`, `navigator.ts`, `controls.ts` (barre de lecture), `morph.ts` (transitions), `frame.ts` (appels de dessin), `cartesian.ts` (échelles), `colors.ts`, `build.ts`, `overrides.ts`, `responsive.ts`, `types.ts` (voir ARCHITECTURE.md § 1) ; `facet.ts` (petits multiples), `mount.ts` (pour les wrappers), `sync.ts`, `annotations.ts`, `domains.ts` |
| `render/` | Contrat de rendu (`types.ts`, `layouts.ts`) et moteur `webgl2/` (le seul endroit où WebGL existe) |
| `theme/` | Thèmes clair / sombre, `Theme['marks']` = options de style de chaque marque (documentées en commentaire) |
| `sheet/` | Tableur : `model.ts` (sans DOM), `formula.ts`, `sheet.ts` (vue DOM virtualisée), `workbook.ts` |
| `util/` | Couleurs, formats de nombres, fusion profonde |

## 4. Les règles à ne pas casser

Elles sont aussi dans `CLAUDE.md`. Chacune a une raison ; la plupart ont été apprises à la dure.

1. **WebGPU doit rester possible.** Aucun concept WebGL hors de `packages/core/src/render/webgl2/`. Les marques ne
   connaissent que `Renderer`, `Batch` et `LAYOUTS`. Une nouvelle primitive passe par `render/types.ts` et
   `render/layouts.ts` (float32, 4 composantes max par attribut) et doit être traduisible en WebGPU.
2. **Un seul contexte WebGL2 par page** (`SharedWebGL2Renderer`, `renderer: 'auto'`). Les navigateurs limitent les
   contextes (~16) et retirent les plus anciens : la galerie en afficherait plus. `renderer: 'webgl2'` reste
   possible pour un graphique isolé.
3. **La spec reste du JSON sérialisable.** Tout ce qui exige une fonction (infobulle personnalisée, moteur de
   rendu) va dans `ChartOptions`, pas dans la spec.
4. **Les échelles produisent des positions normalisées ; le zoom ne change que la transformation de vue**
   (`ViewTransform`), jamais les batches.
5. **Animation sur GPU** : deux états de buffer + un uniform de progression (`DrawCall.progress`,
   `DrawCall.morph`, `Batch.setPrevious`). Ne jamais reconstruire les batches à chaque image. Chaque donnée garde
   une identité stable (`MarkDraw.keys`) pour pouvoir être appariée d'un état à l'autre.
6. **Paquets `sideEffects: false`** : aucun `import './x'` pour effet de bord, le bundler le supprimerait. Tout
   enregistrement passe par une fonction appelée explicitement (`ensureBuiltinMarks`, `registerGeo`).
7. **Pas de mot-clé `ember-addon`** dans `@futurcharts/ember` : Ember CLI le chargerait comme un addon v1.
8. **Texte lisible** : du texte posé sur une couleur prend `on: fill` (encre contrastée automatique) ; sur un fond
   clair (piste, surface), l'encre du thème. Jamais de texte blanc qui déborde d'une marque sur le fond. Les
   étiquettes ne se chevauchent pas et ne sortent pas du cadre (géré par le graphique, voir `drawLabels`).
9. **Performance** : un graphique hors écran ne se dessine pas (IntersectionObserver) ; une instance ne couvre que
   sa propre surface ; shaders compilés à la création du contexte ; marques dépendant de la taille construites une
   fois par taille. **Mesurer avant d'optimiser** : le goulot a été les calculs de données et la compilation au
   premier affichage, pas le rendu (mesure du 2026-11-17 : 60 i/s pour 12 graphiques redessinés à chaque image).
10. **Chaque option de style est documentée dans le type `Theme['marks']`** (`theme/theme.ts`), avec sa valeur par
    défaut dans `lightTheme.marks` : Storybook en tire ses contrôles et leurs descriptions.
11. **Chaque nouveau type de graphique reçoit un exemple** dans `apps/demo/src/library.ts` (`entries` + une place
    dans `GROUPS`), puis `npm run stories`.
12. **Petits écrans** : vérifier tout nouveau graphique avec `fcAudit(343, 260)` et `fcAudit(375, 520)`. Le choix
    d'un graphique de remplacement sur mobile revient à la spec (`responsive`), pas à la librairie.

## 5. Façon de travailler qui a fonctionné

- **Le français partout** côté utilisateur (textes de démo, messages de commit, README) ; les commentaires de code
  et les identifiants sont en anglais. Les commits sont courts et décrivent l'effet visible (« Frise : points
  importants, zoom qui replace les cartes, lien au clic »).
- **Vérifier dans le navigateur**, pas seulement dans les tests : la plupart des défauts sont visuels (étiquettes
  qui se chevauchent, texte blanc sur fond clair, graphique écrasé sur mobile). Les tests unitaires couvrent la
  logique pure (mises en page, transformations, formules, adaptateurs).
- **Lancer `npm run test:visual` après tout changement de rendu** : il dit quels exemples ont bougé, au pixel
  près. Il ne dit pas si le nouveau dessin est bon : c'est en relisant les images changées qu'on le sait.
- **Une démo par fonctionnalité** : si ce n'est pas dans la galerie, ça n'existe pas pour l'utilisateur, et ce
  n'est pas dans Storybook non plus.
- **Pas de CI : des hooks git locaux** (`.githooks/`, activés par `npm install`). `pre-commit` refuse un commit si
  le typecheck ou les tests unitaires échouent (~30 s) ; `pre-push` lance `npm run verif`. `--no-verify` passe
  outre, à réserver à un travail en cours. Après un clone, `npm install` (ou `npm run prepare`) les active.
- **Garder `CLAUDE.md` à jour** quand une décision durable est prise : c'est la mémoire du projet pour les sessions
  Claude Code (y compris celles du nouveau compte).

## 6. Où en sont les chantiers

| Chantier | Fait | Reste |
|---|---|---|
| Rendu | WebGL2 partagé, primitives `rect`, `point`, `line`, `arc`, `mesh` | Moteur WebGPU, perte de contexte WebGL, export SVG/PDF |
| Animation | Entrée, course de barres (`race`), Gapminder (`motion`), transitions de toutes les primitives (barres, points, parts, courbes, aires) et sortie animée (2026-11-24) | Pointillés et marques spécialisées sans `MarkDraw.paths` changent d'un coup ; les axes passent directement au nouvel état |
| Flux | `flow` (pipeline et boîtes), placement en couches, déplacement à la main (pipeline), couloirs (`lanes`) et routage orthogonal (`routing: 'orthogonal'`) en style `boxes` | Édition à la souris en `boxes` (déplacer, ajouter nœuds et liens) ; croisements entre pistes orthogonales non minimisés ; couloirs sans effet en `pipeline` |
| Galerie | 217 exemples, 21 familles, page détail ; huit défauts de finition corrigés le 2026-11-24 | Relecture complète des 103 exemples ajoutés : seuls les défauts déjà repérés ont été traités (restent la matrice de flux et les polaires en 343 × 260, les noms coupés du pont de résultat, le contour du budget peu lisible dans les écarts) |
| Axes | Double axe des valeurs (`scales.secondary`), axe du temps par séance, panneaux synchronisés alignés | Graduations des deux axes non alignées automatiquement |
| Cartes | Fonds, choroplèthe, bulles, routes, globe, Dorling, camemberts, pics, barres | Les symboles `mapPie` / `spike` / `mapBars` grossissent avec le zoom (pas de taille en px dans `arc` / `mesh`) |
| Tableur | Formules, dates, fusions, mise en forme, classeur, wrappers | Lien avec le catalogue dbt ; tri qui ignore les fusions |
| Petits écrans | Compaction, `responsive`, petits multiples, calendrier, tactile | Calendrier d'une année trop serré (5-8 px) : cas pour une règle `responsive` |
| Données | Adaptateurs ES / ClickHouse / dbt / Arrow (`fromArrow`, `Table.from` sur une table Arrow), rôles de champ (`importance`, `link`) | Types Arrow imbriqués (listes, structures) ; essai sur une vraie réponse ClickHouse |
| Tests | 378 tests unitaires ; captures (868) ; robustesse (données et tailles hostiles) et interactions sur chaque exemple ; schéma JSON de la spec (2026-11-24) | Tests de `Chart` sans GPU, tableur, tableaux de bord ; options de style hors schéma |
| Distribution | `npm run build` produit `dist/` | Publication npm, CI, licence, changelog |

## 7. Passation (même Mac, autre compte)

Tout est déjà en place : le dossier, `node_modules`, `.claude/launch.json` (serveurs `demo` et `storybook` pour
l'aperçu intégré) et `CLAUDE.md`, chargé automatiquement à chaque session Claude Code ouverte dans ce dossier.
Aucune mémoire de session n'était enregistrée en dehors du dépôt : tout ce qu'il faut savoir est dans `CLAUDE.md`,
le README et ce dossier `docs/`.

1. Ouvrir une session dans `~/Documents/futurCharts` et vérifier : `npm test`, `npm run typecheck`,
   `npm run dev`, puis `gallery.html#/galerie`. Tout doit passer tel quel.
2. Lire `CLAUDE.md`, puis ce guide, puis [ARCHITECTURE.md](ARCHITECTURE.md). Parcourir `spec/types.ts` (la spec
   commentée) et un exemple de marque simple (`tick` dans `marks/builtin.ts`, `waffle` dans `marks/extra.ts`).
3. Lire [RECOMMANDATIONS.md](RECOMMANDATIONS.md) pour l'ordre des prochains travaux.
4. Si le compte repreneur est un autre **utilisateur macOS** (et pas seulement un autre compte Claude) : lui donner
   les droits sur le dossier, ou le déplacer dans un emplacement partagé (`/Users/Shared`). Les réglages de
   `~/.claude` sont propres à chaque utilisateur macOS ; ceux du projet (`.claude/` du dossier) suivent le dossier.
5. Conseillé, sans urgence : un dépôt distant privé comme sauvegarde, puisque ce Mac porte la seule copie.
6. Décider de la licence et du nom de publication npm (scope `@futurcharts` à réserver) avant toute diffusion.
