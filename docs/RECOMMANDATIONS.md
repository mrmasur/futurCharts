# Recommandations pour la suite

Constat au 2026-11-23, puis les travaux conseillés, par ordre de priorité. Les règles d'architecture à respecter
sont dans [REPRISE.md](REPRISE.md) § 4.

## Constat

**Points forts**

- Le contrat de rendu est propre : tout WebGL tient dans `render/webgl2/`, les dispositions sont prêtes pour
  WebGPU. C'est l'actif le plus précieux du projet ; le protéger.
- La spec est entièrement JSON et très documentée (`spec/types.ts`, `Theme['marks']`) : idéale pour une IA ou un
  éditeur visuel.
- Largeur fonctionnelle rare : 104 marques, transitions sur GPU, petits multiples, synchronisation, tableur.
- Tests rapides, typecheck strict, build qui passe.

**Faiblesses**

- **Aucune CI, aucun dépôt distant** : rien ne vérifie automatiquement un changement, et ce Mac porte la seule
  copie du code.
- **`chart/chart.ts` fait ~2 750 lignes** : mise en page, axes, légende, survol, zoom, lasso, navigateur, timeline,
  transitions, étiquettes. C'est là que les régressions naîtront.
- **Rien ne teste `Chart` en Node** : depuis le 2026-11-24, chaque exemple est couvert par les captures, par un
  test de robustesse (données et tailles hostiles) et par un test d'interactions (survol, clic, zoom, glisser) ;
  le lasso et le tableur restent vérifiés à la main. Exemples sans infobulle détectée sur la grille du test :
  jauges, compteur, Renko fin, nuage connecté, quantile-quantile, nuage 3D, arbre de bas en haut, distribution en
  traits (à regarder : certaines n'en ont pas, d'autres sont trop clairsemées pour la grille).
- ~~Perte de contexte WebGL non gérée~~ : gérée depuis le 2026-11-24.
- **Bundle monolithique** : ~125 Ko gzip pour le cœur, même pour une simple courbe.
- Le développement a été très rapide (une quarantaine de commits en 8 jours, dont 50 marques écrites, sur deux jours, en un après-midi par des agents en parallèle) : beaucoup de fonctionnalités, peu de
  consolidation. Certaines marques (`advanced.ts`, `more.ts`, `shapes.ts`) font 800 à 1 150 lignes.

## Essai d'intégration dans une application (2026-11-25)

Premier usage hors de la galerie : une trentaine de graphiques d'une application React existante (thème clair et
sombre, palette de l'application), redessinés à côté de leur version d'origine sur des données réelles. Trois
écrans : un panneau de 19 courbes temporelles synchronisées, un tableau de bord de barres empilées et d'anneau,
une synthèse mêlant rivière, puces, carte de chaleur, bulles en échelle log et double axe. Plus la traduction
d'une description de graphique écrite par un serveur en `ChartSpec`, validée par le schéma avant le rendu.

**Ce que l'essai confirme**

- La spec JSON et son schéma tiennent leur promesse : traduire une description tierce prend une cinquantaine de
  lignes, une description fausse est refusée avec sa raison, une retouche (aire, seuil) tient en trois lignes.
- Une page de 19 graphiques synchronisés tient sur le contexte partagé, zones de tracé alignées, sans réglage.
- Légende sur une ligne, dates dans la langue du navigateur, étiquettes d'axe jamais superposées : sans rien demander.

**Défauts trouvés et corrigés dans cette branche** (un à trois par écran : la lib est encore en rodage)

| Défaut | Correction |
|---|---|
| Axe des valeurs sans unité : un `FormatSpec` JSON ne sait pas dire « octets en Go, ms en s » | `options.format.value` / `secondary` : une fonction de l'application, hors de la spec (`withFormatter`) |
| Sur une page pleine de graphiques, la molette zoomait au lieu de faire défiler | `interactions.zoom.wheel: 'modifier'` (Ctrl / Cmd, pincement compris) |
| Libellé d'une ligne verticale d'annotation perdu près du bord droit | il passe à gauche du trait dans le dernier cinquième |
| Clic sans effet sur une marque sans données (nœud de Sankey, pays, tuile) | l'événement `click` porte `shape` |
| Axe en échelle log : domaine arrondi à 0, tous les points écrasés sur un bord | pas de `nice` sur un axe log |
| `heatmap` ignorait `scales.x.categories` / `scales.y.categories` | ordre de la spec respecté, catégorie absente gardée en bande vide (`orderedCategories`) |
| Fond `transparent` en thème sombre : surface supposée blanche, plages des puces éblouissantes | surface déduite de l'encre (`opaqueSurfaceOf`) |

**Manques constatés, non traités** (par ordre de gêne pour une application)

1. **Sélection d'une plage à la souris** (glisser pour choisir une période, événement avec les deux bornes) : le
   zoom ne la remplace pas quand la plage choisie doit recharger des données. `select: 'rect'` donne des marques,
   pas un intervalle.
2. **Infobulle** : `options.tooltip` rend une chaîne HTML ; chaque application réécrit le même gabarit (puce de
   couleur, nom, valeur). Proposer un formateur de valeur et de titre (`options.format.tooltipValue`, `title`), et
   une option pour retirer les lignes à zéro d'une pile de nombreuses séries.
3. **`validateSpec`** sans dépendance (point 8) : l'application a dû apporter ajv elle-même.
4. **Format de l'axe des catégories en fonction** : `options.format` ne couvre que les axes de valeurs ; une
   application qui a ses propres libellés de période ne peut pas les imposer.
5. **Libellés longs** : les catégories trop longues sont coupées par « … ». Prévoir le retour à la ligne sur
   deux lignes (barres horizontales, lignes de carte de chaleur) comme alternative à l'ellipse.
6. **Sankey** : sous 8 px de haut un nœud perd son nom, et deux petits nœuds voisins se touchent. Un mode
   « hauteur minimale par nœud » rendrait lisible une liste longue, au prix de la proportion exacte.
7. **Puces (`bullet`)** : pas de domaine explicite (il a fallu le déduire des plages), un seul format pour toutes
   les lignes : trois unités ont demandé trois graphiques.
8. **Export SVG / PDF** (point 16) : bloquant pour les rapports générés côté serveur.
9. Aucun test ne construit les échelles cartésiennes : le défaut de l'axe log n'était visible qu'à l'écran. Un
   banc `cartesianScales` (ou le `Renderer` factice du point 7) l'aurait attrapé.

**Vérifié dans cette branche** : typecheck, 442 tests unitaires, 888 captures (aucune référence modifiée),
robustesse et interactions par le hook de push. Non vérifié : un vrai pavé tactile pour la molette, un autre
navigateur que Chromium, les performances sur l'application.

## Priorité 0 — refermer la journée du 2026-11-23

La branche `graphiques-2026-11-23` (tests visuels, 103 exemples nouveaux, robustesse, accessibilité) a été
fusionnée dans `main` le 2026-11-24, à la demande de l'utilisateur, sans tour de la galerie à la main.

- **Parcourir la galerie à la main** : survol, clics, zoom et animations des 103 nouveaux exemples ne sont
  vérifiés que par les tests automatiques (`test:interactions`), aucune des nouvelles marques n'a été essayée à
  la main.
- **Passe de finition** : huit défauts corrigés le 2026-11-24 (Likert, Dorling Europe et anneaux d'activité en
  sombre ; noms du Voronoï ; vide de l'arbre de décomposition ; densité 2D au bord ; puces et planning des salles
  en mobile). Pas de relecture complète des 103 exemples ajoutés. Défauts encore vus : matrice de flux et
  polaires pauvres en 343 × 260 ; petits pics réduits à des chevrons ; noms de comptes coupés dans le pont de
  résultat ; contour du budget collé au réel dans « Écarts au budget par direction ».
- **Reste de la vague 3** : transitions des lignes et des aires et sortie animée (point 11), barres d'incertitude
  sur un nuage. (Voronoï, arbre indenté, quadrants, nuage connecté, distributions marginales, couloirs et routage
  orthogonal des flux, cohortes, arbre de décomposition et entonnoir comparé ont été faits ensuite, le même jour.)
- **Jamais essayé à la main** : les clics (repli de l'arbre indenté, déploiement de l'arbre de décomposition) et
  les infobulles des marques ajoutées ; seule leur logique est testée.
- **Manques du contrat encore ouverts**, signalés par les agents : une marque à un seul champ ne peut pas être
  cartésienne (elle perd survol et lasso standard) ; `HitData.series` empêche d'exposer des points de survol nommés
  librement (`difference`, `fan`) ; pas de titre d'axe par défaut ni de marge en px dans `MarkScales` ; pas de
  format par ligne dans `ctx.format` ; pas de symbole à taille en px ancré en espace d'échelle ; `MarkStyle` en
  intersection (deux options de même nom et de types différents se cassent) ; chaque famille réécrit sa mise en
  page en px (colonnes nom / barres / chiffres) : une aide commune manque.
- ~~**Libellés en dur en français** dans les marques~~ : fait le 2026-11-24. Les textes écrits par les marques
  (en-têtes, légendes, infobulles, compteurs « + n lignes », caps de la rose des vents) sont dans `theme.texts`
  (`theme/texts.ts`, jeu `englishTexts`, gabarits `{n}` remplis par `fillText`), un test (`textes.test.ts`) interdit
  de les réécrire en dur dans `marks/`. Restent hors de `texts` : les dates et nombres (Intl, langue du navigateur),
  les libellés déjà réglables par les options (`todayLabel` du Gantt, `rootLabel`…), les notations Q1 / Q3 / pN,
  l'espace avant « % » des pourcentages calculés à la main, et les textes de `chart/` (légende, barre de lecture,
  accessibilité), hors du périmètre de ce chantier.

## Priorité 1 — sécuriser (avant toute nouvelle fonctionnalité)

1. **Sauvegarde** : un dépôt distant privé (ou au minimum une sauvegarde Time Machine du dossier). Il sert aussi de
   support à la CI.
2. **CI minimale** — remplacée le 2026-11-24 par des hooks git locaux (`.githooks/`) et `npm run verif`, faute de
   CI. Une vraie CI reste utile le jour où quelqu'un d'autre contribue : `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. Ajouter un
   `.nvmrc` (Node 20) et `"engines"` dans le `package.json` racine.
3. ~~Gestion de la perte de contexte~~ : **faite le 2026-11-24** (`Renderer.onRestored`, voir ARCHITECTURE.md § 1).
4. ~~Tests visuels de non-régression~~ : **fait le 2026-11-23** (`npm run test:visual`, voir
   [ARCHITECTURE.md](ARCHITECTURE.md) § 6). Reste à les brancher sur la CI (point 2) : les références actuelles
   sont celles de macOS, il faudra en générer pour la plateforme de la CI (Linux), dans un conteneur Playwright.
5. **Licence** : dépôt public sur GitHub (`mrmasur/futurCharts`) depuis le 2026-11-25, **tous droits réservés**
   (`LICENSE`, `"license": "UNLICENSED"`). Une licence MIT a été publiée quelques minutes le 2026-11-25, puis remplacée et effacée de
   l'historique par un push forcé (une copie faite entre-temps resterait sous MIT). À décider avant toute diffusion réelle : licence définitive.

## Priorité 2 — consolider

6. ~~Découper `chart.ts`~~ : **fait le 2026-11-24** (1 262 lignes, modules dans `chart/`, ARCHITECTURE.md § 1). Texte d'origine :
   découper sans changer de comportement, une fois les tests visuels en place : `layout.ts`
   (mise en page, compaction), `axes.ts`, `legend.ts`, `labels.ts` (placement anti-chevauchement), `interaction.ts`
   (survol, zoom, lasso, glisser), `navigator.ts`, `timeline.ts`, `morph.ts`. Le contrat `Chart` public ne bouge pas.
7. **Tests unitaires de `Chart` sans GPU** : un `Renderer` factice (il suffit d'implémenter l'interface et
   d'enregistrer les `Frame`) passé par `options.renderer`, avec jsdom ou happy-dom. Permet de tester mise en page,
   légende, événements et transitions en Node.
8. ~~Validation de la spec~~ : **fait le 2026-11-24** (`@futurcharts/core/schema.json`, `npm run schema`). Reste :
   valider aussi les options de style par marque, et offrir une fonction `validateSpec` qui n'impose pas ajv. Indispensable si une IA ou un éditeur écrit des specs, et utile pour des messages d'erreur clairs.
9. **Lint et format** (ESLint + Prettier, ou Biome). La règle WebGPU, l'absence d'import pour effet de bord et la
   cohérence des types d'options entre marques sont déjà vérifiées par `packages/core/test/regles.test.ts`
   (2026-11-24) ; reste le formatage.
10. **Performances** : mesurées le 2026-11-24 (ARCHITECTURE.md § 7), sans goulot à corriger. Refaire la mesure
    (`perf.html`) après tout changement du rendu ou de `compile()`, et à chaque nouvelle marque lourde.
11. **Bundle à la carte** : exposer chaque famille de marques (`registerAdvancedMarks()`…) pour qu'une application
    n'embarque que ce qu'elle utilise, en gardant `ensureBuiltinMarks()` pour le cas « tout ». Mesurer avant et
    après.

## Priorité 3 — terminer les chantiers ouverts

Dans l'ordre de valeur pour une application de BI :

12. **Transitions des lignes et aires**, puis **sortie animée** des données qui disparaissent (aujourd'hui elles
    disparaissent d'un coup). Même mécanique : deux buffers + `morph`, identité par `keys`. Pour les lignes,
    rééchantillonner les deux états sur les mêmes x avant l'interpolation.
13. **Lien tableur ↔ catalogue dbt** : colonnes typées et formatées depuis `fieldsFromDbt`.
14. ~~Format Arrow~~ : **fait le 2026-11-24**. `Table.from` lit une table Arrow reconnue à sa forme
    (`ArrowTableLike`, sans dépendance ; Float64 sans null sans copie), `fromArrow` dans `@futurcharts/adapters`
    décode aussi les octets IPC (`apache-arrow` en dépendance optionnelle, décodeur passé en paramètre) ; exemple
    « Données Arrow » dans la galerie, README « Apache Arrow ». Une table Arrow se passe telle quelle dans `data`
    (type `DataInput`), petits multiples compris. Reste : types imbriqués (listes, structures) et un essai sur une
    vraie réponse ClickHouse. Texte d'origine : colonnes Arrow → tableaux typés sans copie, ClickHouse et beaucoup d'outils le
    produisent.
15. ~~Accessibilité~~ : **faite le 2026-11-24** (nom et résumé, tableau caché, clavier ; README « Accessibilité »).
    Reste : essai avec un vrai lecteur d'écran (VoiceOver, NVDA), parcours clavier des marques sans points (cartes,
    treemap, Sankey). Texte d'origine : rien n'est lisible par un lecteur d'écran (tout est dessiné sur canvas).
    Ajouter un résumé `aria-label`, un tableau de données caché, et la navigation au clavier entre les points.
16. **Export SVG / PDF** (PNG existe via `toImage()`).
17. **Diagrammes de flux** : couloirs et routage orthogonal faits le 2026-11-23 ; reste l'édition à la souris.
18. **Calendrier d'une année en petit** : ajouter une règle `responsive` à son exemple (cases de 5 à 8 px).

## Priorité 4 — WebGPU et diffusion

19. **Moteur WebGPU** dans `render/webgpu/`, sondé en premier par `createRenderer('auto')` (`navigator.gpu`), repli
    sur WebGL2. Les dispositions de `layouts.ts` se traduisent telles quelles en `GPUVertexBufferLayout`. Ouvre le
    calcul GPU (`capabilities.compute`) : binning, densité, hexbin sur des millions de points. Ne le faire que
    quand un besoin de volume le justifie : WebGL2 tient aujourd'hui 60 i/s sur 12 graphiques.
20. **Publication npm** : réserver le scope `@futurcharts`, versions sémantiques, changelog (changesets), minifier
    le build publié.
21. **Site de documentation** : la galerie et Storybook sont déjà presque un site ; les publier (build statique
    de `apps/demo` et `apps/storybook`).

## Pièges connus

- **Instabilité vue une fois** (2026-11-24) : « Pyramide des âges » en `mobile-haut` a différé de 19 % des pixels
  lors d'une passe complète, puis a passé 80 fois sur 80 en répétition. Si cela revient, regarder l'image obtenue
  dans `tests/visual/resultats/` : une animation d'entrée inachevée est le suspect le plus probable.

- Un wrapper ne met à jour le graphique que si l'objet `spec` est **remplacé** : `useMemo` en React,
  `shallowRef` en Vue. Une spec reconstruite à chaque rendu recompile le graphique à chaque rendu.
- Le conteneur d'un graphique doit avoir une hauteur, sinon il fait 0 px.
- Les tirets (`dash`) sont découpés à la construction : un zoom les étire avec les données.
- `renderer: 'webgl2'` crée un contexte dédié : au-delà d'une quinzaine sur une page, le navigateur retire les plus
  anciens.
- Ajouter un exemple sans relancer `npm run stories` le laisse absent de Storybook.
- Un nouvel exemple n'a pas de capture de référence : le premier `npm run test:visual` l'écrit et échoue pour
  le signaler ; relire les quatre images, puis les commiter.
- Mettre à jour Playwright change la version de Chromium, donc peut déplacer des pixels partout : le faire dans
  un commit à part, avec les captures régénérées.
- Un exemple dont les données dépendent de la date du jour ou du hasard rendrait sa capture instable : les
  jeux de données de `library.ts` sont tous déterministes, à garder ainsi.
- Les fichiers `apps/storybook/stories/NN-*.stories.ts` sont générés et écrasés : n'écrire à la main que des
  stories non numérotées (comme `Tableur.stories.ts`).
- Ember classique (`.hbs`) : réexporter le modifier dans `app/modifiers/futur-chart.js`.

## Travailler avec Claude Code sur ce projet

- `CLAUDE.md` est chargé automatiquement à chaque session : y consigner toute décision durable (comme les dates
  des demandes, « demandé le 2026-11-17 »), et le garder court. Le détail va dans `docs/`.
- `.claude/launch.json` déclare les serveurs `demo` (5273) et `storybook` (6006) pour l'aperçu intégré.
- Demander une vérification dans le navigateur après chaque changement visuel, et `fcAudit` après chaque nouveau
  graphique.
