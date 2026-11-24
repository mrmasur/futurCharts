# Architecture et recettes

Comment une spec devient une image, puis comment étendre la librairie sans casser ses règles
(voir [REPRISE.md](REPRISE.md) § 4).

## 1. Le trajet d'une spec

```
ChartSpec (JSON)
  │  createChart(el, spec)          chart/facet.ts : FacetChart si spec.facet, sinon Chart
  ▼
Chart.create  ── ensureBuiltinMarks()                     marks/builtin.ts
  │           ── createRenderer(canvas, options.renderer) render/index.ts
  ▼
Chart.update(spec) ── effectiveSpec()   applique les règles `responsive` à la taille du cadre
  ▼
Chart.compile()                                           chart/chart.ts (orchestre)
  1. jetons de thème ($ink, $1…) résolus dans style / overrides / highlight / series / labels   chart/colors.ts
  2. Table.from(data, types du catalogue) puis layer.transform    data/table.ts, data/transforms.ts
  3. orientation (catégories en y → barres horizontales), double axe, type d'échelle   chart/cartesian.ts
  4. préparation par calque : séries, empilement, intervalles    marks/prepare.ts
       – marque standalone : standaloneLayer (la marque lit le calque brut)
  5. couleurs fixées par entité (jamais par rang : un filtre ne repeint pas les survivants)   chart/colors.ts
  6. domaines et échelles (ou MarkDefinition.scales() pour une marque standalone)   chart/cartesian.ts, domains.ts
  7. def.build(ctx) pour chaque calque → BuiltMark { draws, hit, labels, pick, click, … }   chart/build.ts
     (contexte de la marque, surcharges `highlight` / `overrides` : chart/overrides.ts ; annotations)
  8. légende : entrées et rampe                               chart/legend.ts
  9. instantané de l'état précédent → transition (Batch.setPrevious + morph) si mêmes marques   chart/morph.ts
     (lignes et aires rééchantillonnées sur des positions communes : chart/paths.ts ; sortants dans des batches à part)
  ▼
requestRender() → renderNow()  (une image par requestAnimationFrame, rien hors écran)
  – mise en page (titres, légende, axes, compaction si trop petit) → Layout { plot, view, transform }   chart/layout.ts
  – Frame { calls: DrawCall[] } : grille + batches de chaque marque, avec transform de vue, clip,
    progress (animation d'entrée) et morph (transition)   chart/frame.ts, grille : chart/axes.ts
  – renderer.render(frame)                                 render/webgl2/renderer.ts
  – drawOverlay, sur un canvas 2D par-dessus : titres (layout.ts), légende (legend.ts), axes (axes.ts),
    étiquettes et anti-chevauchement (labels.ts), survol (hover.ts), lasso (selection.ts), navigateur (navigator.ts)
  – infobulle : un <div> DOM                                chart/tooltip.ts ; barre de lecture : chart/controls.ts
```

**Les modules de `chart/`.** `Chart` (`chart.ts`) garde l'état et l'orchestration : cycle de vie, `compile`,
`renderNow`, gestionnaires du pointeur, synchronisation, perte de contexte. Le reste est fait de fonctions presque
pures qui reçoivent ce qu'elles lisent (souvent un objet `…Input`) et sont testables sans DOM
(`test/chart-modules.test.ts`) :

| Module | Rôle |
|---|---|
| `types.ts` | Types publics (`ChartOptions`, `ChartEvents`, `HoverItem`…, réexportés par `chart.ts`) et internes (`Built`, `Layout`, `Zoom`) |
| `responsive.ts` | Règles `responsive` : lesquelles s'appliquent à une taille, fusion d'une règle dans la spec |
| `colors.ts` | Jetons de thème résolus dans la spec ; couleurs fixées par entité (palette, couleurs explicites) |
| `cartesian.ts` | Orientation, double axe, ordre des catégories, échelles de catégories et de valeurs, échelles d'une carte |
| `build.ts` | `BuildContext` d'une marque (style, couleurs, surcharges, tailles, formats) ; calques d'annotations |
| `overrides.ts` | `highlight` et `overrides` compilés en une fonction ligne → style |
| `legend.ts` | Entrées et rampe de la légende, placement sur des lignes qui se replient, dessin |
| `layout.ts` | Mise en page et compaction (sous-titre, titres d'axes, légende), marges alignées d'un groupe, titres |
| `axes.ts` | Lignes de grille (GPU) ; axes x, y et secondaire sur le canvas 2D |
| `labels.ts` | Ajustement du texte (« … », texte tourné) ; dessin des `MarkLabel` sans chevauchement |
| `frame.ts` | Clip des marques et `DrawCall` de chaque batch (entrée animée, transition, sélection) |
| `morph.ts` | Transitions : instantané de ce qui a une identité (`keys`, `paths`), état précédent de chaque batch, batches de remplacement des lignes et des aires, batches des sortants (`startTransition` → `Transition`, `endTransition`) |
| `paths.ts` | Rééchantillonnage de deux polylignes (ou de deux rubans) sur une même suite de positions, points communs appariés par clé ; état final d'un tracé qui sort |
| `hover.ts` | Hit-testing (modes `x` et `nearest`, formes), `HoverItem`, dessin du survol |
| `tooltip.ts` | Contenu et position de l'infobulle |
| `zoom.ts` | Arithmétique du zoom et du déplacement, axe des valeurs recalé sur la plage visible (`fitY`) |
| `selection.ts` | Lasso et rectangle : masques de sélection, batches des éléments choisis, dessin |
| `navigator.ts` | Fenêtre du navigateur : prise, glisser, dessin |
| `controls.ts` | Barre de lecture d'une marque animée dans le temps (`Timeline`) |
| `domains.ts`, `annotations.ts`, `sync.ts` | Étendues des calques, annotations, groupes synchronisés |
| `a11y.ts` | Accessibilité : résumé du graphique (`aria-label` de la figure), tableau de données caché, ordre du parcours au clavier, annonces ; plus les quelques aides DOM (zone focalisable, région `aria-live`) |

**Accessibilité** (2026-11-24, `a11y.ts`, testé dans `test/a11y.test.ts` et `tests/visual/interactions.pw.ts`). La
racine est un `role="figure"` (et non `img`, dont les enfants seraient ignorés par les lecteurs d'écran : il faut
que le tableau caché reste lisible). Après chaque `compile`, `Chart.refreshA11y` recalcule l'`aria-label` (titre,
sous-titre, `spec.description` ou résumé), le tableau (50 lignes au plus) et l'état de la zone clavier ; le résumé
et le tableau passent par `describeItems`, donc mêmes libellés et formats que l'infobulle. La zone clavier est un
`<div role="application">` transparent, sans pointeur, posé sur `layout.plot` à chaque image (`placeFocus`) : seul son
contour au focus se voit. L'ordre du parcours (`navGroups` : une série par groupe, triée par x, une ligne et ses points
fusionnés) n'est calculé qu'à la première touche. Une marque sans `HitData` (seulement `pick`) n'est pas un arrêt de
tabulation. Les textes sont en français, écrits dans `a11y.ts` (à brancher sur les textes du thème le jour où ils
existent pour d'autres langues).

Ce qui reste dans `Chart`, et pourquoi : les gestionnaires `onMove` / `onDown` / `onUp` / `onWheel` (ils
enchaînent navigateur, glisser de marque, lasso, déplacement, légende, liens et exploration, et changent presque tout
l'état), la synchronisation (elle appelle les autres graphiques du groupe), et `restore` avec le batch de la grille (perte
du contexte : tout batch créé hors de `compile()` doit être recréé dans `restore`).

Points clés :

- **Deux couches par graphique** : un canvas pour le GPU, un canvas 2D par-dessus pour tout le texte. Le texte
  n'est jamais dans les buffers GPU. Les positions des étiquettes sont en espace d'échelle : elles suivent le zoom.
- **Perte du contexte** (2026-11-24) : le navigateur peut reprendre le contexte WebGL (veille, téléphone à court de
  mémoire) et le rendre plus tard. Pendant la perte, rien n'est dessiné et chaque graphique garde sa dernière image ;
  au retour, les shaders sont recompilés et le contrat `Renderer.onRestored` prévient chaque graphique, qui recrée
  ses batches (`Chart.restore`, même spec, même zoom, même sélection au lasso, sans transition ni événement). Un batch d'un contexte perdu est ignoré
  (`GLBatch.alive`). Un moteur WebGPU branchera son `device.lost` sur le même `onRestored`. Testé dans
  `tests/visual/interactions.pw.ts` (extension `WEBGL_lose_context`).
- **Contexte partagé** : `SharedWebGL2Renderer` dessine dans un unique canvas WebGL2 caché (qui ne fait que
  grandir), puis copie l'image dans le canvas 2D du graphique (`drawImage`). Les batches vivent dans ce contexte
  commun ; le graphique les libère lui-même.
- **Espace d'échelle** : les marques écrivent des positions normalisées (0..1) ; `ViewTransform`
  (`px = t * s + o`) les place en pixels. Zoom et déplacement ne changent que ce uniform.
- **Hit-testing en CPU** : `HitData` (tableaux typés, une entrée par donnée) sert au survol, aux infobulles, au
  lasso, aux événements. Les marques « surfaces » (carte, treemap) fournissent `pick(tx, ty)`.
- **Double axe des valeurs** (`scales.secondary`, `axes.secondary`, `axis: 'secondary'` sur un calque) : les
  calques du second axe ont leur propre domaine mais écrivent dans le même espace normalisé, donc une seule
  transformation de vue sert les deux axes et le zoom ne touche toujours aucun batch. Calcul des domaines dans
  `chart/domains.ts`.
- **Axe du temps par séance** : `scales.x.type: 'band'` sur un champ de dates (`DateBandScale`) : pas de trous
  les week-ends, graduations de dates lisibles.
- **Graphiques synchronisés** (`interactions.sync`) : ils partagent survol et plage visible, et alignent les bords
  de leurs zones de tracé (`chart/sync.ts`).
- **Marques dépendant de la taille** (`sizeDependent`) : reconstruites au redimensionnement seulement
  (treemap, frise, diagrammes). Les autres ne sont jamais reconstruites par un resize.

## 2. Le contrat d'une marque

Tout est dans `marks/registry.ts`. Résumé :

```ts
interface MarkDefinition {
  standalone?: boolean;      // n'utilise pas x / y du graphique (camembert, treemap…) → fournit scales()
  baseline?: boolean;        // pousse depuis 0 (le domaine y inclut 0)
  banded?: boolean;          // a une épaisseur en x (domaine élargi d'une demi-bande)
  themeKey?: string;         // entrée de theme.marks si différente du nom (pie et donut → arc)
  sizeDependent?: boolean | ((layer) => boolean);
  symbol?: 'line' | 'circle' | 'square';   // légende et survol
  scales?(input): MarkScales;              // standalone : échelles, aspect, axes, grille, minWidth
  build(ctx: BuildContext): BuiltMark;
}
```

`BuildContext` donne tout le nécessaire : `renderer`, `data` (séries préparées), échelles `x` / `y`, `pos(c, v)`
(qui gère l'orientation), `style` (thème + calque fusionnés), `color(series, i)`, `size`, `ramp`, `categorical`,
`paint` (applique `overrides` / `highlight`), `format`, `pixel` (taille d'un px en espace d'échelle), `state`
(survit aux reconstructions : focus d'un sunburst…).

`BuiltMark` rend : `draws` (batches), `hit`, et en option `labels`, `legend`, `legendRamp`, `pick`, `click`,
`hover`, `link`, `view`, `animate`, `muted`, `timeline`, `drag`.

Ajouts du 2026-11-23 (commentés dans `registry.ts`) :

- `MarkLabel.maxWidth` / `ellipsis` : un texte trop long est coupé par « … » au lieu de disparaître ;
  `MarkLabel.rotate` (degrés) pour des étiquettes radiales ou des en-têtes de colonnes inclinés.
- `BuiltMark.hover(at)` : la marque met en avant ce qui est sous le pointeur ; renvoyer vrai redessine.
- `BuiltMark.legendRamp` : légende de dégradé (min, max) pour une couleur continue.
- `scales(input)` d'une marque standalone reçoit aussi `style` (fusionné avec le thème), `scales` et `theme`.
- Jetons de couleur `$up` / `$down` (hausse / baisse), en plus de `$ink`, `$1`…
- Mesure de texte : `textWidth` (`marks/shapes.ts`), `fitText` / `truncateText` (`chart/labels.ts`).

Les primitives disponibles et leurs dispositions mémoire sont dans `render/layouts.ts` :

| Primitive | Usage | Champs (float32) |
|---|---|---|
| `rect` | barres, cases, boîtes | rect x0 y0 x1 y1, fill, stroke, rayons ×4, params (trait, écart, écart d'empilement, largeur max), axe |
| `point` | nuages, marqueurs | x y taille forme, fill, stroke, épaisseur du trait |
| `line` | segments à bouts ronds (lignes, traits, liens) | x0 y0 x1 y1, couleur, largeur |
| `arc` | secteurs d'anneau (parts, jauges, sunburst) | cx cy r0 r1, a0 a1 écart coin, fill |
| `mesh` | triangles libres (aires, cartes, rubans Sankey) | x y, couleur par sommet |

Aides d'écriture : `pushRect`, `pushSegment`, `pushVertex` (`marks/primitives.ts`), `curvePoints`
(`marks/curve.ts`), `buildHit` / `emptyHit`.

## 3. Recettes

### Ajouter une marque

1. Écrire la `MarkDefinition` dans le fichier de sa famille. Depuis le 2026-11-23, une famille = un fichier
   `marks/<famille>.ts` qui exporte une table `<FAMILLE>_MARKS` (les calculs purs dans un fichier voisin, testé),
   plutôt que d'allonger `charts.ts`, `shapes.ts` ou `advanced.ts`. Partir d'un modèle proche : `tick` (`builtin.ts`) pour une marque cartésienne simple,
   `waffle` (`extra.ts`) pour une marque standalone.
2. L'ajouter à la table exportée du fichier (`ADVANCED_MARKS`…) ; elle est alors enregistrée par
   `ensureBuiltinMarks`. **Pas d'enregistrement au chargement du module.**
3. Déclarer ses options de style dans le type `Theme['marks']` (`theme/theme.ts`) avec un commentaire par option,
   et leurs valeurs par défaut dans `lightTheme.marks` (le thème sombre n'a besoin que de ce qui diffère).
4. Si elle introduit une encodage ou un champ de spec, le documenter dans `spec/types.ts`.
5. Ajouter un exemple dans `apps/demo/src/examples/<famille>.ts` (`FAMILIES` : une famille de galerie existante
   ou nouvelle, et ses `entries`), branché une fois dans `examples/index.ts` ; `library.ts` les ajoute à `entries`
   et `GROUPS`. Puis `npm run stories`. (Les 114 exemples d'origine restent dans `library.ts`.)
6. Écrire un test si la marque a une mise en page calculée (voir `test/shapes.test.ts`, `flowLayout.test.ts`).
7. `npm run test:visual -- -g "Titre de l'exemple"` écrit ses quatre captures (bureau, sombre, deux tailles de
   téléphone) : les **regarder**, corriger, régénérer avec `--update-snapshots`. Puis la galerie pour les
   interactions (survol, zoom), que les captures ne voient pas.
8. Piège : `MarkStyle` (`spec/types.ts`) est l'intersection des styles de toutes les marques. Une option de même
   nom avec un autre type dans une autre marque devient `never` : garder le même type ou changer de nom.
9. Ajouter une ligne au tableau « Types de graphiques » du README.

Pour qu'elle profite des transitions : exposer `data` et `keys` sur ses draws d'instances (rect, point, arc ; une clé
par instance), ou `data` et `paths` sur ses draws de lignes et d'aires (`DrawPath` dans `marks/registry.ts` : une clé
par courbe, le rang de son premier segment ou sommet, leur nombre, et si possible `anchors`, la clé et le sommet de
chaque donnée). Une ligne doit alors être faite de segments contigus, une aire d'un ruban de six sommets par pas
(haut i, haut i+1, bas i+1, haut i, bas i+1, bas i), comme `line` et `area` dans `builtin.ts`.

**Transitions** (terminées le 2026-11-24). À chaque `compile`, `snapshot` garde les données CPU de ce qui a une
identité ; `startTransition` compare ensuite l'ancien et le nouvel état, calque par calque et draw par draw :

- *instances* (`keys`) : le batch de la marque reçoit son état précédent (`setPrevious`) ; une clé nouvelle part de
  rien ; une clé disparue va dans un batch à part (`Transition.ghosts`, dessiné sous le calque) dont l'état final est
  replié et transparent ;
- *tracés* (`paths`) : les deux polylignes n'ont ni les mêmes x ni le même nombre de points. `resamplePair` les coupe
  une fois, sur CPU, aux positions de l'une et de l'autre : entre deux données présentes des deux côtés (appariées par
  clé, donc une donnée garde son identité même si son abscisse change), chaque tracé reçoit les sommets de l'autre,
  posés sur lui (sa forme ne change pas) ; un bout que seul un état possède fait face au point d'extrémité de l'autre
  (la courbe pousse de son bout, ou s'y replie). Les deux états, de même taille, vont dans un batch de remplacement
  (`Transition.stand`) dessiné à la place de celui de la marque pendant la transition ; à la fin, le batch de la marque,
  jamais touché, redevient le seul dessiné : l'image finale est exactement celle d'un rendu direct. Une série nouvelle
  va dans un second batch, révélé par le clip comme à l'entrée ; une série disparue s'estompe (une aire se replie
  aussi sur sa base) ;
- un calque retiré part en entier, si les calques restants ont gardé leurs marques (sinon c'est un autre graphique).

Aucun buffer n'est envoyé pendant la transition : le vertex shader mélange les deux états selon `u_morph`. Les batches
de transition sont les seuls créés hors des marques ; `Chart.endMorph` les détruit (fin de la transition, `compile`
suivant, `destroy`) et `Chart.restore` l'appelle après une perte du contexte (la transition est abandonnée, l'état
final est dessiné). Au-delà de 400 000 instances ou sommets dans un draw, lignes et aires changent d'un coup.
Limites : l'ancien état est dessiné dans le nouvel espace d'échelle (les axes changent d'un coup, les marques
glissent) ; les pointillés et les marques qui ne déclarent pas `paths` changent d'un coup. Tests :
`test/transitions.test.ts`.

### Ajouter une primitive GPU

C'est la décision la plus engageante : elle devra exister aussi en WebGPU.

1. L'ajouter à `PrimitiveKind` (`render/types.ts`) et sa disposition à `LAYOUTS` (`render/layouts.ts`) : float32,
   1 à 4 composantes par attribut, `instanced-quad` ou `triangles`.
2. Écrire ses shaders dans `render/webgl2/shaders.ts` (compilés à la création du contexte, pas à la volée).
   Appliquer `u_progress` (entrée) et `u_morph` (transition : liste `MORPHED` dans `renderer.ts`, les attributs
   mélangés sont relus dans un second buffer de même disposition, aux emplacements suivants ; en WebGPU, un second
   `GPUVertexBufferLayout` de même pas). Les cinq primitives se transforment.
3. S'assurer que rien d'autre que `webgl2/` ne dépend d'un détail WebGL.
4. Préférer une primitive paramétrique (comme `arc` : quatre nombres par secteur, rien à retesseller) à de la
   géométrie précalculée : les animations deviennent gratuites.

### Ajouter une option de style à une marque existante

Type dans `Theme['marks'][marque]` avec commentaire → valeur par défaut dans `lightTheme.marks` → lecture via
`ctx.style.<option>` dans `build`. Storybook la montre automatiquement (curseur pour un nombre, boutons pour un
choix court).

### Ajouter un adaptateur de données

Dans `packages/adapters/src` : une fonction pure `réponse → { data: colonnes, fields: catalogue }`, sans client
réseau (la requête reste dans l'API de l'application). Tests dans `packages/adapters/test`. Utiliser
`Float64Array` pour les nombres et les dates (epoch ms).

### Ajouter un thème ou une palette

`registerTheme(nom, spec)` ou `theme: { extends: 'dark', palette: { categorical, sequential } }`. Les palettes de
la démo (`PALETTES` dans `library.ts`) ont été validées : séparation pour les daltoniens entre voisines,
distinction en vision normale, bande de luminosité, contraste avec le fond. Valider toute nouvelle palette de même.

### Ajouter un wrapper de framework

S'appuyer sur `mountChart` / `mountSpreadsheet` (`chart/mount.ts`, `sheet/mount.ts`) : ils gèrent la création
asynchrone, les mises à jour (la spec est comparée par identité : elle doit être **remplacée**, pas mutée) et la
destruction. Le wrapper ne fait que relier le cycle de vie et les événements. Ajouter le paquet à
`scripts/build.mjs` et au script `typecheck` de la racine.

## 4. Le tableur

- `SheetModel` (`sheet/model.ts`) : données, formules, styles, fusions ; **aucun DOM**, testable seul.
- `formula.ts` : analyseur et évaluateur maison ; fonctions en anglais et en français ; erreurs façon tableur ;
  dates en numéros de série (`toSerial` / `fromSerial`).
- `Sheet` (`sheet/sheet.ts`) : la vue DOM, lignes virtualisées (seules les lignes visibles existent), saisie,
  sélection, presse-papiers (compatible Excel / Google Sheets, nombres au format français compris).
- `Workbook` : un modèle par feuille, **une seule vue** ; références entre feuilles (`=Budget!F1`).
- Limite connue : un tri ignore les fusions.

## 5. Build et paquets

- `scripts/build.mjs` construit, dans l'ordre, `core, adapters, geo, element, react, vue, ember` : un module ES
  par paquet (Vite, non minifié, avec sourcemap) puis les déclarations (`tsc -p tsconfig.build.json`). Les
  dépendances et `@ember/*` restent externes.
- Taille de `@futurcharts/core` : ~500 Ko non minifié, ~125 Ko gzip (mesuré le 2026-11-23). Toutes les marques
  sont incluses, car `ensureBuiltinMarks` les référence toutes.
- Version `0.0.1` partout ; rien n'est publié.

## 6. Tests

- `npm test` (Vitest, environnement Node, sans DOM) : 438 tests sur la logique pure (données, transformations,
  échelles, mises en page de flux / arbres / formes, formules et modèle du tableur, adaptateurs, géo).
- Pas de test unitaire de `Chart` lui-même, ni des wrappers ; ses modules purs (marges, zoom, navigateur,
  sélection, transitions, règles `responsive`, surcharges…) sont testés dans `test/chart-modules.test.ts`. L'audit mobile se fait avec `fcAudit`.

### Tests visuels (`npm run test:visual`)

Les 222 exemples de la galerie sont la suite de tests du rendu : Playwright (Chromium sans écran, WebGL logiciel)
ouvre chaque exemple seul et compare une capture à sa référence, au pixel près. 888 comparaisons, environ deux minutes.

| Élément | Rôle |
|---|---|
| `apps/demo/visual.html` + `src/visual.ts` | Un exemple seul, à taille fixe : `visual.html?nom=<slug>&l=800&h=480&theme=dark`. Tuiles, piles et petits multiples suivent les règles d'une carte de galerie. `window.__pret` et `window.__erreurs` renseignent le test |
| `tests/visual/liste.ts` | Écrit `exemples.json` (non commité) depuis `library.ts` : Playwright doit connaître les noms des tests avant d'ouvrir une page. Refuse deux exemples de même adresse ou un exemple absent de `GROUPS` |
| `tests/visual/galerie.pw.ts` | Un test par exemple ; échoue aussi sur une erreur de console ou de création |
| `playwright.config.ts` | Quatre variantes : `bureau` (800 × 480, clair), `sombre`, `mobile` (343 × 260, ×2), `mobile-haut` (375 × 520, ×2) ; navigateur en `fr-FR`, fuseau de Paris (la librairie formate nombres et dates dans la langue du navigateur) ; serveur dédié sur le port 5274, sans rechargement à chaud (`npm run dev:test -w @futurcharts/demo`), lancé s'il ne tourne pas |
| `tests/visual/captures/<plateforme>/<variante>/<slug>.png` | Les références, commitées (une trentaine de Mo). Elles dépendent de la plateforme (polices, lissage) : celles de `darwin` ne valent pas sous Linux |

- **Le temps est figé** (horloge Playwright, `performance.now()` recalé sur la date) puis avancé par sauts : les
  animations d'entrée arrivent à leur état final, une course de barres ou une onde s'arrêtent toujours sur la même
  image. C'est ce qui permet la comparaison exacte (`maxDiffPixels: 0`, `threshold: 0`) ; une tolérance, même
  faible, laissait passer un rayon de barre changé d'un pixel.
- **Un écart** : `npx playwright show-report tests/visual/rapport` montre attendu / obtenu / différence. S'il est
  voulu, `npm run test:visual:update` (ou `-- -g "Sankey"` pour un seul exemple), puis relire les images modifiées
  avant de les commiter : une référence acceptée sans la regarder ne protège plus rien.
- **Cibler** : `npm run test:visual -- --project=mobile -g "Frise"`.
- **Limites** : ni les tableaux de bord, ni le tableur, ni Storybook ne sont capturés (les interactions ont leur
  propre suite, ci-dessous). L'état testé est l'état final : une animation cassée en cours de route ne se voit pas. Le rendu
  WebGL est logiciel (SwiftShader) : un défaut propre à un GPU réel ne se voit pas non plus.
- Première installation sur un autre poste : `npx playwright install chromium`.

### Robustesse (`npm run test:robustesse`, ~1,5 min)

Chaque exemple est remonté avec des données hostiles et à des tailles hostiles (`apps/demo/robustesse.html` +
`src/robustesse.ts`, test `tests/visual/robustesse.pw.ts`) : données vides, une seule ligne, trous (`null`), `NaN`,
valeurs négatives, énormes (× 10⁹) ou nulles, libellés démesurés, lignes en double ; cadre de 60 × 40 et de 0 × 0,
redimensionnements brutaux, passage de vide à plein et retour, destruction immédiate. Pour un diagramme de flux :
graphe vide, liens vers des nœuds absents, boucle sur soi. Rien ne doit lever d'exception ni écrire d'erreur. Pas de
capture : il s'agit de pannes, pas d'apparence. Garde-fous ajoutés le 2026-11-24 à la suite de ce test (dans
`test/robustesse.test.ts`) : une table vide répond pour tout champ demandé (une requête qui ne renvoie rien n'est
pas une erreur) ; une colonne sans valeur est numérique ; dates manquantes affichées « — » ; nombre de classes, de
briques Renko, de sièges d'hémicycle, de pictogrammes et de tirets plafonné.

### Interactions (`npm run test:interactions`, ~2 min)

`tests/visual/interactions.pw.ts` : chaque exemple est survolé sur une grille de 30 points, cliqué, double-cliqué,
zoomé à la molette, glissé, puis quitté, sans erreur. Les exemples où aucune infobulle n'apparaît sont signalés en
annotation dans le rapport (pas en échec : certains n'en ont pas par nature). Cinq tests vérifient qu'une
interaction change vraiment le dessin : repli de l'arbre indenté, déploiement de l'arbre de décomposition, clic de
légende (événement `legend` et série masquée), zoom à la molette, survol des faisceaux. Quatre tests d'accessibilité
(`test.describe('accessibilité')`) : nom de la figure et `description`, tableau caché, parcours au clavier (Tab,
flèches, région `aria-live`, Entrée → `click`, Échap), `interactions.keyboard: false`. `visual.html` expose les
graphiques créés dans `window.__graphiques` pour ces tests.

### Schéma de la spec (`npm run schema`)

`packages/core/schema/chart-spec.schema.json` (exporté : `@futurcharts/core/schema.json`) est généré depuis
`spec/types.ts` par `scripts/schema.mjs` (ts-json-schema-generator). Il sert aux éditeurs et aux IA qui écrivent des
specs : valider avant de dessiner (avec ajv, par exemple). `tests/schema/spec.test.ts` vérifie qu'il est à jour,
qu'il accepte chaque exemple de la galerie et qu'il refuse les erreurs courantes (clé inconnue, champ non textuel,
type d'échelle inconnu). Limites : les options de style des marques (`layer.style`) ne sont pas vérifiées par le
schéma (le générateur ne sait pas lire l'intersection `MarkStyle`), ni les données. Après un changement de
`spec/types.ts` : `npm run schema`, sinon le test échoue.

## 7. Performances

Banc de mesure : `apps/demo/perf.html` (`src/perf.ts`), à ouvrir dans un onglet **visible** d'un vrai navigateur
(`npm run dev`, puis `http://localhost:5273/perf.html`, bouton « Lancer », environ une minute ; `?auto` le lance seul,
`window.__perf` garde les résultats). Un navigateur sans écran dessine WebGL en logiciel : ses chiffres ne valent
rien, c'est pourquoi ce banc n'est pas dans `npm run verif`.

Mesure du 2026-11-24 (MacBook, GPU Apple M5 via ANGLE / Metal, écran Retina, onglet du navigateur intégré à
60 images/s), deux passages :

| Scénario | Résultat |
|---|---|
| Création des 218 exemples de la galerie, un par un | ~4,8 s en tout, médiane 17 ms (une image) ; les plus lents 100 à 220 ms, liste différente à chaque passage (bruit) |
| 12 puis 24 graphiques de la galerie redessinés à chaque image | 60 images/s dans les deux cas |
| Nuage de 100 000 points (4 groupes) | création 85-95 ms, 60 images/s, mise à jour des données 75-100 ms |
| Nuage de 1 000 000 de points | création ~580 ms, **7 à 10 images/s** (18 sans liseré, 23 à 1 px sans liseré) |
| Courbe de 100 000 points ; 20 courbes de 10 000 points | création 130-185 ms ; 56-58 et 60 images/s |
| Densité hexagonale de 500 000 points | création ~150 ms, 60 images/s |
| Carte de chaleur de 200 × 200 cases ; 2 000 barres ; tableau de 500 lignes | création 17 à 32 ms, 60 images/s |

Lecture :

- **Le rendu n'est pas le goulot jusqu'à quelques centaines de milliers de marques.** Le JavaScript d'une image
  coûte ~0,5 ms même avec un million de points : la limite est alors le débit du GPU (une instance par point,
  avec mélange des couleurs), pas le code.
- **Un million de points reste fluide en mouvement à condition de** retirer le liseré des points
  (`strokeWidth: 0`, ×2 environ) ou de passer à la densité hexagonale (`hexbin`), qui tient 60 images/s sur
  500 000 points. Par défaut un point porte un liseré de 2 px, si bien qu'un point de taille 2 couvre ~6 px.
- Pas d'optimisation faite : rien de mesuré ne le justifiait. Pistes si un jour un besoin de volume l'exige :
  agrégation GPU (WebGPU, `capabilities.compute`), ou bascule automatique vers la densité au-delà d'un seuil.

