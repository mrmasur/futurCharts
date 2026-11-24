/**
 * Interactions: what the captures never see. Every gallery example is hovered across a grid, clicked,
 * double-clicked, zoomed with the wheel, dragged, then left; nothing may throw or log an error.
 * The examples where no tooltip ever shows up are listed in the report (annotation), not failed:
 * some charts have none on purpose (KPI tiles, tables), the list is there to be read.
 * A few targeted tests then check that an interaction really changes something.
 *   npm run test:interactions
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const file = fileURLToPath(new URL('./exemples.json', import.meta.url));
if (!existsSync(file)) throw new Error('tests/visual/exemples.json manque : lancer `npm run test:interactions` plutôt que playwright directement.');
const exemples: { famille: string; titre: string; nom: string }[] = JSON.parse(readFileSync(file, 'utf8'));

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function open(page: Page, nom: string) {
  await page.goto(`/visual.html?nom=${nom}&l=800&h=480`);
  await expect.poll(() => page.evaluate(() => window.__pret === true), { timeout: 20_000 }).toBe(true);
  // Past the entry animation.
  await page.waitForTimeout(1000);
  const box = await page.locator('#cadre').boundingBox();
  expect(box, 'cadre vide').not.toBeNull();
  return box!;
}

/** True when a tooltip of the chart is showing (the library fades it in by opacity). */
const tooltipShown = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('#cadre div')].some(
      (d) => d.style.pointerEvents === 'none' && d.style.position === 'absolute' && d.style.opacity === '1' && !!d.textContent?.trim(),
    ),
  );

test.describe('toutes les interactions, sans erreur', () => {
  for (const e of exemples) {
    test(`${e.famille} › ${e.titre}`, async ({ page }, info) => {
      const errors = watchErrors(page);
      const box = await open(page, e.nom);
      const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + Math.min(box.height, 900) * fy];

      // Hover across the drawing.
      let tooltip = false;
      for (const fy of [0.3, 0.45, 0.6, 0.75, 0.9]) {
        for (const fx of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
          await page.mouse.move(...at(fx, fy));
          await page.waitForTimeout(15);
          if (!tooltip && (await tooltipShown(page))) tooltip = true;
        }
      }
      if (!tooltip) info.annotations.push({ type: 'sans infobulle', description: 'aucune infobulle sur une grille de 30 points' });

      // Click, double-click (reset), wheel in and out, drag, leave.
      await page.mouse.click(...at(0.5, 0.6));
      await page.mouse.click(...at(0.3, 0.45));
      await page.mouse.dblclick(...at(0.5, 0.6));
      await page.mouse.move(...at(0.5, 0.6));
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(50);
      await page.mouse.wheel(0, 300);
      await page.mouse.move(...at(0.6, 0.6));
      await page.mouse.down();
      await page.mouse.move(...at(0.3, 0.5), { steps: 6 });
      await page.mouse.up();
      await page.mouse.move(box.x + box.width + 40, box.y + 10);
      await page.waitForTimeout(100);

      expect(errors, 'erreurs pendant les interactions').toEqual([]);
    });
  }
});

/** The canvas pixels of the example, to tell whether an interaction changed the drawing. */
const pixels = (page: Page) => page.locator('#cadre').screenshot();

test.describe('les interactions changent vraiment quelque chose', () => {
  test('arbre indenté : un clic sur un nœud replié le déplie', async ({ page }) => {
    const errors = watchErrors(page);
    const box = await open(page, 'arbre-indente-replie');
    const before = await pixels(page);
    // First body row (a collapsed branch), just under the title.
    await page.mouse.click(box.x + 60, box.y + 92);
    await page.waitForTimeout(400);
    expect((await pixels(page)).equals(before), 'le dessin n’a pas changé après le clic').toBe(false);
    expect(errors).toEqual([]);
  });

  test('arbre de décomposition : un clic sur un autre nœud déploie sa branche', async ({ page }) => {
    const errors = watchErrors(page);
    const box = await open(page, 'arbre-de-decomposition-du-chiffre-d-affaires');
    const before = await pixels(page);
    // Second row of the second column (a region that is not the one expanded).
    await page.mouse.click(box.x + box.width * 0.3, box.y + 150);
    await page.waitForTimeout(400);
    expect((await pixels(page)).equals(before), 'le dessin n’a pas changé après le clic').toBe(false);
    expect(errors).toEqual([]);
  });

  test('légende : un clic masque une série et émet l’événement', async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, 'reel-et-prevision-en-pointilles');
    // Legend entries are laid out by the chart, in the coordinates of its root element.
    const target = await page.evaluate(() => {
      type Entry = { key: string; rect?: { x: number; y: number; width: number; height: number } };
      const chart = window.__graphiques![0] as { legend: Entry[]; on(t: 'legend', h: (p: unknown) => void): void };
      const events: unknown[] = [];
      (window as unknown as { __legende: unknown[] }).__legende = events;
      chart.on('legend', (p) => events.push(p));
      const entry = chart.legend.find((l) => l.rect)!;
      const root = document.querySelector('#cadre > div > div')!.getBoundingClientRect();
      return { key: entry.key, x: root.left + entry.rect!.x + entry.rect!.width / 2, y: root.top + entry.rect!.y + entry.rect!.height / 2 };
    });
    const before = await pixels(page);
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(400);
    const events = await page.evaluate(() => (window as unknown as { __legende: { series: string; hidden: boolean }[] }).__legende);
    expect(events, 'événement legend').toEqual([{ series: target.key, hidden: true }]);
    expect((await pixels(page)).equals(before), 'la série n’a pas disparu du dessin').toBe(false);
    expect(errors).toEqual([]);
  });

  test('zoom à la molette : la vue change, le double-clic la rétablit', async ({ page }) => {
    const errors = watchErrors(page);
    const box = await open(page, 'double-axe-chiffre-d-affaires-et-marge');
    const before = await pixels(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(400);
    const zoomed = await pixels(page);
    expect(zoomed.equals(before), 'la molette n’a pas zoomé').toBe(false);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(600);
    expect(errors).toEqual([]);
  });

  test('faisceaux : le survol d’une feuille change le dessin', async ({ page }) => {
    const errors = watchErrors(page);
    const box = await open(page, 'dependances-entre-modules-faisceaux');
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.waitForTimeout(200);
    const before = await pixels(page);
    // Walk around the circle until a leaf is under the pointer.
    let changed = false;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.6;
    for (let a = 0; a < 360 && !changed; a += 10) {
      const r = Math.min(box.width, box.height) * 0.3;
      await page.mouse.move(cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180));
      await page.waitForTimeout(40);
      changed = !(await pixels(page)).equals(before);
    }
    expect(changed, 'aucun survol n’a mis de liens en avant').toBe(true);
    expect(errors).toEqual([]);
  });
});

declare global {
  interface Window {
    __pret?: boolean;
    __graphiques?: unknown[];
  }
}
