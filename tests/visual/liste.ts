/**
 * Writes the list of gallery examples the visual tests go through (`exemples.json`, not committed).
 * Playwright needs the test names before it opens a page, and `library.ts` only loads through Vite:
 * `npm run test:visual` runs this first (vite-node), then Playwright.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GROUPS, entries } from '../../apps/demo/src/library';
import { slug } from '../../apps/demo/src/slug';

const seen = new Map<string, string>();
const list = GROUPS.flatMap(([family, titles]) =>
  titles
    .filter((t) => entries.some((e) => e.title === t))
    .map((title) => {
      const nom = slug(title);
      const other = seen.get(nom);
      if (other) throw new Error(`Deux exemples ont la même adresse « ${nom} » : « ${other} » et « ${title} ».`);
      seen.set(nom, title);
      return { famille: family, titre: title, nom };
    }),
);
const missing = entries.filter((e) => !seen.has(slug(e.title))).map((e) => e.title);
if (missing.length) throw new Error(`Exemples absents de GROUPS (donc non testés) : ${missing.join(', ')}`);

writeFileSync(fileURLToPath(new URL('./exemples.json', import.meta.url)), JSON.stringify(list, null, 1));
console.log(`${list.length} exemples à comparer`);
