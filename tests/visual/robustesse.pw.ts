/**
 * Robustness: every gallery example mounted with hostile data and at hostile sizes (see apps/demo/src/robustesse.ts).
 * Nothing may throw, nothing may be logged as an error. No capture: this is about crashes, not looks.
 *   npm run test:robustesse            (or: npx playwright test --project=robustesse -g "Sankey")
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const file = fileURLToPath(new URL('./exemples.json', import.meta.url));
if (!existsSync(file)) throw new Error('tests/visual/exemples.json manque : lancer `npm run test:robustesse` plutôt que playwright directement.');
const exemples: { famille: string; titre: string; nom: string }[] = JSON.parse(readFileSync(file, 'utf8'));

for (const e of exemples) {
  test(`${e.famille} › ${e.titre}`, async ({ page }) => {
    let logged: string[] = [];
    page.on('pageerror', (err) => logged.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') logged.push(msg.text());
    });
    await page.goto('/robustesse.html');
    await expect.poll(() => page.evaluate(() => typeof window.__robustesse === 'function'), { timeout: 20_000 }).toBe(true);

    // The variants are defined next to the code that applies them (apps/demo/src/robustesse.ts).
    const variantes = await page.evaluate(() => window.__variantes!);
    const failures: string[] = [];
    for (const variante of variantes) {
      logged = [];
      const thrown = await page.evaluate(([nom, v]) => window.__robustesse!(nom, v as never), [e.nom, variante]);
      // Let a frame or two run: errors in the render loop surface there.
      await page.waitForTimeout(30);
      for (const m of [...thrown, ...logged]) failures.push(`[${variante}] ${m}`);
    }
    expect(failures, 'erreurs avec des données ou des tailles hostiles').toEqual([]);
  });
}

declare global {
  interface Window {
    __robustesse?: (nom: string, variante: never) => Promise<string[]>;
    __variantes?: string[];
  }
}
