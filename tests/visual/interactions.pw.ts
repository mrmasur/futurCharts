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

test.describe('perte du contexte WebGL', () => {
  // The browser may take the GPU context back (sleep, a phone short of memory) and give it back later.
  // While it is lost, every chart keeps its last image; once restored, it draws again exactly as before.
  for (const nom of ['barres-horizontales-triees', 'graphiques-synchronises', 'transition-entre-deux-etats-anneau', 'sankey']) {
    test(nom, async ({ page }) => {
      const errors = watchErrors(page);
      // Keep a handle on every WebGL2 context the page creates, to lose it on purpose.
      await page.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          const context = (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
          if (type === 'webgl2' && context) ((window as unknown as { __gl: unknown[] }).__gl ??= []).push(context);
          return context;
        } as typeof original;
      });
      const box = await open(page, nom);
      await page.mouse.move(box.x + box.width + 40, box.y + 10);
      await page.waitForTimeout(300);
      const before = await pixels(page);
      // The extension must be fetched before the loss: a lost context hands out none.
      await page.evaluate(() => {
        const w = window as unknown as { __gl: WebGL2RenderingContext[]; __lose: WEBGL_lose_context[] };
        w.__lose = w.__gl.map((gl) => gl.getExtension('WEBGL_lose_context')!);
      });
      const lose = (how: 'loseContext' | 'restoreContext') =>
        page.evaluate((h) => {
          for (const ext of (window as unknown as { __lose: WEBGL_lose_context[] }).__lose) ext[h]();
        }, how);

      await lose('loseContext');
      await page.waitForTimeout(200);
      // Draw while lost: the chart must neither fail nor go blank.
      await page.evaluate(() => {
        for (const c of window.__graphiques ?? []) (c as { requestRender(): void }).requestRender();
      });
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, 400) / 2);
      await page.mouse.move(box.x + box.width + 40, box.y + 10);
      await page.waitForTimeout(300);
      expect((await pixels(page)).equals(before), 'le graphique a perdu son image pendant la perte du contexte').toBe(true);

      await lose('restoreContext');
      await page.waitForTimeout(800);
      // Force a fresh GPU frame of every chart: an image kept from before the loss would prove nothing
      // (hovering only redraws the text layer).
      await page.evaluate(() => {
        for (const c of window.__graphiques ?? []) (c as { requestRender(): void }).requestRender();
      });
      await page.waitForTimeout(400);
      expect((await pixels(page)).equals(before), 'le graphique ne se redessine pas à l’identique après le retour du contexte').toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test('une sélection au lasso survit à la perte du contexte', async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        const context = (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
        if (type === 'webgl2' && context) ((window as unknown as { __gl: unknown[] }).__gl ??= []).push(context);
        return context;
      } as typeof original;
    });
    const box = await open(page, 'points-sur-une-carte-du-monde');
    // A wide lasso over the middle of the map.
    const cx = box.x + box.width * 0.5;
    const cy = box.y + Math.min(box.height, 480) * 0.55;
    await page.mouse.move(cx - 220, cy - 110);
    await page.mouse.down();
    for (const [dx, dy] of [[220, -110], [220, 110], [-220, 110], [-220, -110]]) await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
    await page.mouse.up();
    await page.mouse.move(box.x + box.width + 40, box.y + 10);
    await page.waitForTimeout(300);
    type Selectable = { getSelection(): { count: number }; on(t: 'select', h: (p: { count: number }) => void): void; requestRender(): void };
    const count = () => page.evaluate(() => (window.__graphiques![0] as Selectable).getSelection().count);
    const selected = await count();
    expect(selected, 'le lasso n’a rien sélectionné').toBeGreaterThan(0);
    await page.evaluate(() => {
      const w = window as unknown as { __gl: WebGL2RenderingContext[]; __lose: WEBGL_lose_context[]; __select: unknown[] };
      w.__lose = w.__gl.map((gl) => gl.getExtension('WEBGL_lose_context')!);
      w.__select = [];
      (window.__graphiques![0] as Selectable).on('select', (p) => w.__select.push(p));
    });
    const before = await pixels(page);

    await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context[] }).__lose.forEach((e) => e.loseContext()));
    await page.waitForTimeout(200);
    await page.evaluate(() => (window as unknown as { __lose: WEBGL_lose_context[] }).__lose.forEach((e) => e.restoreContext()));
    await page.waitForTimeout(800);
    await page.evaluate(() => (window.__graphiques![0] as Selectable).requestRender());
    await page.waitForTimeout(400);

    expect(await count(), 'la sélection a changé avec la perte du contexte').toBe(selected);
    expect(await page.evaluate(() => (window as unknown as { __select: unknown[] }).__select), 'un événement select a été émis sans action de l’utilisateur').toEqual([]);
    expect((await pixels(page)).equals(before), 'la sélection n’est plus dessinée après le retour du contexte').toBe(true);
    expect(errors).toEqual([]);
  });
});

declare global {
  interface Window {
    __pret?: boolean;
    __graphiques?: unknown[];
  }
}
