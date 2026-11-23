# Recommandations pour la suite

Constat au 2026-11-23, puis les travaux conseillés, par ordre de priorité. Les règles d'architecture à respecter
sont dans [REPRISE.md](REPRISE.md) § 4.

## Constat

**Points forts**

- Le contrat de rendu est propre : tout WebGL tient dans `render/webgl2/`, les dispositions sont prêtes pour
  WebGPU. C'est l'actif le plus précieux du projet ; le protéger.
- La spec est entièrement JSON et très documentée (`spec/types.ts`, `Theme['marks']`) : idéale pour une IA ou un
  éditeur visuel.
- Largeur fonctionnelle rare : 93 marques, transitions sur GPU, petits multiples, synchronisation, tableur.
- Tests rapides, typecheck strict, build qui passe.

**Faiblesses**

- **Aucune CI, aucun dépôt distant** : rien ne vérifie automatiquement un changement, et ce Mac porte la seule
  copie du code.
- **`chart/chart.ts` fait ~2 750 lignes** : mise en page, axes, légende, survol, zoom, lasso, navigateur, timeline,
  transitions, étiquettes. C'est là que les régressions naîtront.
- **Rien ne teste `Chart` ni les interactions** : le rendu final de chaque exemple est couvert par les tests
  visuels (depuis le 2026-11-23), mais survol, zoom, lasso et glisser restent vérifiés à la main.
- **Perte de contexte WebGL non gérée** : sur mobile ou après une mise en veille, un contexte perdu laisse tous
  les graphiques de la page vides (un seul contexte partagé : une perte touche tout).
- **Bundle monolithique** : ~125 Ko gzip pour le cœur, même pour une simple courbe.
- Le développement a été très rapide (une quarantaine de commits en 8 jours, dont 39 marques écrites en un après-midi par des agents en parallèle) : beaucoup de fonctionnalités, peu de
  consolidation. Certaines marques (`advanced.ts`, `more.ts`, `shapes.ts`) font 800 à 1 150 lignes.

## Priorité 0 — refermer la journée du 2026-11-23

La branche `graphiques-2026-11-23` porte les tests visuels et 87 exemples nouveaux ; elle n'est pas fusionnée.

- **Décider de la fusion dans `main`** après avoir parcouru la galerie (les captures ne voient pas le survol, le
  zoom ni les animations : aucune des nouvelles marques n'a été essayée à la main).
- **Passe de finition** (lancée puis interrompue, rien n'a été fait) : relire les 87 nouveaux exemples dans les
  quatre variantes. Défauts déjà vus : Likert terne, cercles du Dorling Europe peu visibles et piste des anneaux
  d'activité trop vive en sombre ; matrice de flux, puces, polaires et planning des salles pauvres en 343 × 260 ;
  bande basse de la densité 2D coupée au bord ; petits pics réduits à des chevrons.
- **Vague 3 non faite** : couloirs et routage orthogonal des flux, transitions des lignes et des aires et sortie
  animée (point 11), hiérarchies (treemap de Voronoï, arbre indenté, arbre de décomposition), corrélation
  (matrice à quadrants, nuage connecté, barres d'incertitude, distributions marginales).
- **Manques du contrat encore ouverts**, signalés par les agents : une marque à un seul champ ne peut pas être
  cartésienne (elle perd survol et lasso standard) ; `HitData.series` empêche d'exposer des points de survol nommés
  librement (`difference`, `fan`) ; pas de titre d'axe par défaut ni de marge en px dans `MarkScales` ; pas de
  format par ligne dans `ctx.format` ; pas de symbole à taille en px ancré en espace d'échelle ; `MarkStyle` en
  intersection (deux options de même nom et de types différents se cassent) ; chaque famille réécrit sa mise en
  page en px (colonnes nom / barres / chiffres) : une aide commune manque.
- **Libellés en dur en français** dans plusieurs marques (« Médiane », « Écart », caps de la rose des vents…) :
  à sortir dans le thème ou les options le jour où une autre langue est visée.

## Priorité 1 — sécuriser (avant toute nouvelle fonctionnalité)

1. **Sauvegarde** : un dépôt distant privé (ou au minimum une sauvegarde Time Machine du dossier). Il sert aussi de
   support à la CI.
2. **CI minimale** sur chaque push : `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. Ajouter un
   `.nvmrc` (Node 20) et `"engines"` dans le `package.json` racine.
3. **Gestion de la perte de contexte** dans `SharedWebGL2Renderer` : écouter `webglcontextlost` /
   `webglcontextrestored`, recréer `GLCore`, recompiler les shaders, puis demander à chaque graphique de
   reconstruire ses batches (`compile()`). Tester avec l'extension `WEBGL_lose_context`.
4. ~~Tests visuels de non-régression~~ : **fait le 2026-11-23** (`npm run test:visual`, voir
   [ARCHITECTURE.md](ARCHITECTURE.md) § 6). Reste à les brancher sur la CI (point 2) : les références actuelles
   sont celles de macOS, il faudra en générer pour la plateforme de la CI (Linux), dans un conteneur Playwright.
5. **Licence** (MIT ou autre, à décider), `LICENSE`, champ `license` dans chaque `package.json`.

## Priorité 2 — consolider

6. **Découper `chart.ts`** sans changer de comportement, une fois les tests visuels en place : `layout.ts`
   (mise en page, compaction), `axes.ts`, `legend.ts`, `labels.ts` (placement anti-chevauchement), `interaction.ts`
   (survol, zoom, lasso, glisser), `navigator.ts`, `timeline.ts`, `morph.ts`. Le contrat `Chart` public ne bouge pas.
7. **Tests unitaires de `Chart` sans GPU** : un `Renderer` factice (il suffit d'implémenter l'interface et
   d'enregistrer les `Frame`) passé par `options.renderer`, avec jsdom ou happy-dom. Permet de tester mise en page,
   légende, événements et transitions en Node.
8. **Validation de la spec** : générer un JSON Schema depuis `spec/types.ts` (ts-json-schema-generator) et
   l'exposer. Indispensable si une IA ou un éditeur écrit des specs, et utile pour des messages d'erreur clairs.
9. **Lint et format** (ESLint + Prettier, ou Biome) avec une règle qui interdit d'importer `webgl2/` hors de
   `render/` (`no-restricted-imports`) : la règle WebGPU devient vérifiée par la machine.
10. **Bundle à la carte** : exposer chaque famille de marques (`registerAdvancedMarks()`…) pour qu'une application
    n'embarque que ce qu'elle utilise, en gardant `ensureBuiltinMarks()` pour le cas « tout ». Mesurer avant et
    après.

## Priorité 3 — terminer les chantiers ouverts

Dans l'ordre de valeur pour une application de BI :

11. **Transitions des lignes et aires**, puis **sortie animée** des données qui disparaissent (aujourd'hui elles
    disparaissent d'un coup). Même mécanique : deux buffers + `morph`, identité par `keys`. Pour les lignes,
    rééchantillonner les deux états sur les mêmes x avant l'interpolation.
12. **Lien tableur ↔ catalogue dbt** : colonnes typées et formatées depuis `fieldsFromDbt`.
13. **Format Arrow** dans `Table.from` (colonnes Arrow → tableaux typés sans copie) : ClickHouse et beaucoup
    d'outils le produisent.
14. **Accessibilité** : rien n'est lisible par un lecteur d'écran aujourd'hui (tout est dessiné sur canvas).
    Ajouter un résumé `aria-label`, un tableau de données caché, et la navigation au clavier entre les points.
15. **Export SVG / PDF** (PNG existe via `toImage()`).
16. **Diagrammes de flux** : couloirs (swimlanes), routage orthogonal, édition à la souris.
17. **Calendrier d'une année en petit** : ajouter une règle `responsive` à son exemple (cases de 5 à 8 px).

## Priorité 4 — WebGPU et diffusion

18. **Moteur WebGPU** dans `render/webgpu/`, sondé en premier par `createRenderer('auto')` (`navigator.gpu`), repli
    sur WebGL2. Les dispositions de `layouts.ts` se traduisent telles quelles en `GPUVertexBufferLayout`. Ouvre le
    calcul GPU (`capabilities.compute`) : binning, densité, hexbin sur des millions de points. Ne le faire que
    quand un besoin de volume le justifie : WebGL2 tient aujourd'hui 60 i/s sur 12 graphiques.
19. **Publication npm** : réserver le scope `@futurcharts`, versions sémantiques, changelog (changesets), minifier
    le build publié.
20. **Site de documentation** : la galerie et Storybook sont déjà presque un site ; les publier (build statique
    de `apps/demo` et `apps/storybook`).

## Pièges connus

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
