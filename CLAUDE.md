# futurCharts

Librairie de graphiques GPU pour une future app de BI (sources : Elasticsearch, ClickHouse, dbt). Voir README.md.

- `npm run dev` (démo, port 5273), `npm test`, `npm run typecheck`.
- **WebGPU doit toujours rester possible.** Aucun concept WebGL hors de `packages/core/src/render/webgl2/`.
  Toute nouvelle primitive passe par `render/types.ts` et `render/layouts.ts`, et doit être traduisible en WebGPU.
- La spec reste du JSON sérialisable ; ce qui exige une fonction va dans `ChartOptions`.
- Les échelles produisent des positions normalisées ; le zoom ne modifie que la transformation de vue, jamais les batches.
