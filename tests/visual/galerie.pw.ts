/**
 * Visual regression tests: every gallery example, alone on `visual.html`, compared with its reference capture.
 *   npm run test:visual            compare
 *   npm run test:visual:update     accept what is drawn now as the new reference
 * Time is frozen (Playwright clock): entry animations, races and pulses always stop on the same image.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

interface Exemple {
  famille: string;
  titre: string;
  nom: string;
}

const file = fileURLToPath(new URL('./exemples.json', import.meta.url));
if (!existsSync(file)) throw new Error('tests/visual/exemples.json manque : lancer `npm run test:visual` (qui le génère) plutôt que playwright directement.');
const exemples: Exemple[] = JSON.parse(readFileSync(file, 'utf8'));

/** Frozen "now": dates read from the clock (calendar without data, TODAY()) never move. */
const NOW = new Date('2026-01-15T10:00:00');

for (const e of exemples) {
  test(`${e.famille} › ${e.titre}`, async ({ page }, info) => {
    const { largeur, hauteur, theme } = info.project.metadata as { largeur: number; hauteur: number; theme: string };
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(msg.text());
    });

    await page.clock.install({ time: NOW });
    await page.clock.pauseAt(NOW);
    // The frozen clock still lets `performance.now()` creep by a millisecond or two, enough to shift
    // a continuous animation (pulse rings) by a pixel: derive it from the date, which does not move.
    await page.addInitScript((origin) => {
      performance.now = () => Date.now() - origin;
    }, NOW.getTime());
    await page.goto(`/visual.html?nom=${e.nom}&l=${largeur}&h=${hauteur}&theme=${theme}`);
    // Chart creation waits on nothing but promises; the clock only has to tick for what follows.
    await expect.poll(() => page.evaluate(() => window.__pret === true), { timeout: 20_000 }).toBe(true);
    expect(await page.evaluate(() => window.__erreurs), 'erreurs à la création').toEqual([]);

    const cadre = page.locator('#cadre');
    const box = await cadre.boundingBox();
    expect(box, 'cadre vide').not.toBeNull();
    // A chart outside the viewport is not drawn: the frame must fit.
    expect(box!.height, 'exemple plus haut que la fenêtre de test').toBeLessThanOrEqual(page.viewportSize()!.height);

    // Let the observers (visibility, size) report in real time, then jump past every animation:
    // each jump runs one frame, so a transition lands on its end state at once.
    await page.waitForTimeout(150);
    for (let i = 0; i < 4; i++) {
      await page.clock.fastForward(2500);
      await page.waitForTimeout(30);
    }

    await expect(cadre).toHaveScreenshot(`${e.nom}.png`);
    expect(problems, 'erreurs dans la console').toEqual([]);
  });
}

declare global {
  interface Window {
    __pret?: boolean;
    __erreurs?: string[];
  }
}
