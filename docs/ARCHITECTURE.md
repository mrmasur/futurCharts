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
Chart.compile()                                           chart/chart.ts
  1. jetons de thème ($ink, $1…) résolus dans style / overrides / highlight / series / labels
  2. Table.from(data, types du catalogue) puis layer.transform    data/table.ts, data/transforms.ts
  3. orientation (catégories en y → barres horizontales), type d'échelle (bande, temps, linéaire)
  4. préparation par calque : séries, empilement, intervalles    marks/prepare.ts
       – marque standalone : standaloneLayer (la marque lit le calque brut)
  5. couleurs fixées par entité (jamais par rang : un filtre ne repeint pas les survivants)
  6. domaines et échelles (ou MarkDefinition.scales() pour une marque standalone)
  7. def.build(ctx) pour chaque calque → BuiltMark { draws, hit, labels, pick, click, … }
  8. instantané de l'état précédent → transition (Batch.setPrevious + morph) si mêmes marques
  ▼
requestRender() → renderNow()  (une image par requestAnimationFrame, rien hors écran)
  – mise en page (titres, légende, axes, compaction si trop petit) → Layout { plot, view, transform }
  – Frame { calls: DrawCall[] } : grille + batches de chaque marque, avec transform de vue, clip,
    progress (animation d'entrée) et morph (transition)
  – renderer.render(frame)                                 render/webgl2/renderer.ts
  – drawOverlay : axes, légende, étiquettes (MarkLabel), survol, lasso, sur un canvas 2D par-dessus
  – infobulle : un <div> DOM
```

Points clés :

- **Deux couches par graphique** : un canvas pour le GPU, un canvas 2D par-dessus pour tout le texte. Le texte
  n'est jamais dans les buffers GPU. Les positions des étiquettes sont en espace d'échelle : elles suivent le zoom.
- **Contexte partagé** : `SharedWebGL2Renderer` dessine dans un unique canvas WebGL2 caché (qui ne fait que
  grandir), puis copie l'image dans le canvas 2D du graphique (`drawImage`). Les batches vivent dans ce contexte
  commun ; le graphique les libère lui-même.
- **Espace d'échelle** : les marques écrivent des positions normalisées (0..1) ; `ViewTransform`
  (`px = t * s + o`) les place en pixels. Zoom et déplacement ne changent que ce uniform.
- **Hit-testing en CPU** : `HitData` (tableaux typés, une entrée par donnée) sert au survol, aux infobulles, au
  lasso, aux événements. Les marques « surfaces » (carte, treemap) fournissent `pick(tx, ty)`.
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

`BuiltMark` rend : `draws` (batches), `hit`, et en option `labels`, `legend`, `pick`, `click`, `link`, `view`,
`animate`, `muted`, `timeline`, `drag`.

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

1. Écrire la `MarkDefinition` dans le fichier de sa famille (`marks/charts.ts`, `shapes.ts`, `advanced.ts`…) ou un
   nouveau fichier. Partir d'un modèle proche : `tick` (`builtin.ts`) pour une marque cartésienne simple,
   `waffle` (`extra.ts`) pour une marque standalone.
2. L'ajouter à la table exportée du fichier (`ADVANCED_MARKS`…) ; elle est alors enregistrée par
   `ensureBuiltinMarks`. **Pas d'enregistrement au chargement du module.**
3. Déclarer ses options de style dans le type `Theme['marks']` (`theme/theme.ts`) avec un commentaire par option,
   et leurs valeurs par défaut dans `lightTheme.marks` (le thème sombre n'a besoin que de ce qui diffère).
4. Si elle introduit une encodage ou un champ de spec, le documenter dans `spec/types.ts`.
5. Ajouter un exemple dans `apps/demo/src/library.ts` (`entries`) et son titre dans `GROUPS`, puis
   `npm run stories`.
6. Écrire un test si la marque a une mise en page calculée (voir `test/shapes.test.ts`, `flowLayout.test.ts`).
7. Vérifier dans la galerie, en clair et en sombre, puis `fcAudit(343, 260)` et `fcAudit(375, 520)`.
8. Ajouter une ligne au tableau « Types de graphiques » du README.

Pour qu'elle profite des transitions : exposer `perDatum`, `data` et `keys` sur ses draws (rect, point, arc).

### Ajouter une primitive GPU

C'est la décision la plus engageante : elle devra exister aussi en WebGPU.

1. L'ajouter à `PrimitiveKind` (`render/types.ts`) et sa disposition à `LAYOUTS` (`render/layouts.ts`) : float32,
   1 à 4 composantes par attribut, `instanced-quad` ou `triangles`.
2. Écrire ses shaders dans `render/webgl2/shaders.ts` (compilés à la création du contexte, pas à la volée).
   Appliquer `u_progress` (entrée) et, si elle se transforme, `u_morph` (liste `MORPHED` dans `renderer.ts`).
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

- `npm test` (Vitest, environnement Node, sans DOM) : 80 tests sur la logique pure (données, transformations,
  échelles, mises en page de flux / arbres / formes, formules et modèle du tableur, adaptateurs, géo).
- Pas de test unitaire de `Chart` lui-même, ni des wrappers. L'audit mobile se fait avec `fcAudit`.

### Tests visuels (`npm run test:visual`)

Les 114 exemples de la galerie sont la suite de tests du rendu : Playwright (Chromium sans écran, WebGL logiciel)
ouvre chaque exemple seul et compare une capture à sa référence, au pixel près. 456 comparaisons, environ une minute.

| Élément | Rôle |
|---|---|
| `apps/demo/visual.html` + `src/visual.ts` | Un exemple seul, à taille fixe : `visual.html?nom=<slug>&l=800&h=480&theme=dark`. Tuiles, piles et petits multiples suivent les règles d'une carte de galerie. `window.__pret` et `window.__erreurs` renseignent le test |
| `tests/visual/liste.ts` | Écrit `exemples.json` (non commité) depuis `library.ts` : Playwright doit connaître les noms des tests avant d'ouvrir une page. Refuse deux exemples de même adresse ou un exemple absent de `GROUPS` |
| `tests/visual/galerie.pw.ts` | Un test par exemple ; échoue aussi sur une erreur de console ou de création |
| `playwright.config.ts` | Quatre variantes : `bureau` (800 × 480, clair), `sombre`, `mobile` (343 × 260, ×2), `mobile-haut` (375 × 520, ×2) ; lance la démo si elle ne tourne pas |
| `tests/visual/captures/<plateforme>/<variante>/<slug>.png` | Les références, commitées (16 Mo). Elles dépendent de la plateforme (polices, lissage) : celles de `darwin` ne valent pas sous Linux |

- **Le temps est figé** (horloge Playwright, `performance.now()` recalé sur la date) puis avancé par sauts : les
  animations d'entrée arrivent à leur état final, une course de barres ou une onde s'arrêtent toujours sur la même
  image. C'est ce qui permet la comparaison exacte (`maxDiffPixels: 0`, `threshold: 0`) ; une tolérance, même
  faible, laissait passer un rayon de barre changé d'un pixel.
- **Un écart** : `npx playwright show-report tests/visual/rapport` montre attendu / obtenu / différence. S'il est
  voulu, `npm run test:visual:update` (ou `-- -g "Sankey"` pour un seul exemple), puis relire les images modifiées
  avant de les commiter : une référence acceptée sans la regarder ne protège plus rien.
- **Cibler** : `npm run test:visual -- --project=mobile -g "Frise"`.
- **Limites** : rien ne teste les interactions (survol, zoom, lasso, glisser), ni les tableaux de bord, ni le tableur,
  ni Storybook. L'état testé est l'état final : une animation cassée en cours de route ne se voit pas. Le rendu
  WebGL est logiciel (SwiftShader) : un défaut propre à un GPU réel ne se voit pas non plus.
- Première installation sur un autre poste : `npx playwright install chromium`.
