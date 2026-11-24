import { defineConfig } from '@playwright/test';

/**
 * Visual regression tests (tests/visual): each gallery example at four sizes / themes.
 * The two phone sizes are the ones of the mobile audit (`fcAudit(343, 260)`, `fcAudit(375, 520)`).
 * Reference captures depend on the platform (fonts, antialiasing): one folder per platform.
 */
const size = (largeur: number, hauteur: number, theme: 'light' | 'dark', dpr: number) => ({
  testMatch: 'galerie.pw.ts',
  metadata: { largeur, hauteur, theme },
  // Tall on purpose: a chart outside the viewport is not drawn, and small multiples grow downwards.
  use: { viewport: { width: Math.max(largeur, 320), height: 2600 }, deviceScaleFactor: dpr },
});

export default defineConfig({
  testDir: 'tests/visual',
  testMatch: '**/*.pw.ts',
  outputDir: 'tests/visual/resultats',
  snapshotPathTemplate: 'tests/visual/captures/{platform}/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { outputFolder: 'tests/visual/rapport', open: 'never' }]],
  timeout: 45_000,
  expect: {
    // Same machine, same browser build, frozen clock: the drawing is reproducible, so stay strict.
    toHaveScreenshot: { maxDiffPixels: 0, threshold: 0, animations: 'disabled', caret: 'hide' },
  },
  // The library formats numbers and dates in the browser's language: test what a French user sees,
  // and pin the time zone so that the captures do not depend on the machine's.
  use: { baseURL: 'http://localhost:5274', browserName: 'chromium', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  projects: [
    { name: 'bureau', ...size(800, 480, 'light', 1) },
    { name: 'sombre', ...size(800, 480, 'dark', 1) },
    { name: 'mobile', ...size(343, 260, 'light', 2) },
    { name: 'mobile-haut', ...size(375, 520, 'light', 2) },
    // Hostile data and sizes: crashes only, no capture (tests/visual/robustesse.pw.ts).
    // Every example hovered, clicked, zoomed and dragged (tests/visual/interactions.pw.ts).
    { name: 'interactions', testMatch: 'interactions.pw.ts', timeout: 60_000, use: { viewport: { width: 1000, height: 1400 } } },
    // Fourteen mounts per example, some with huge data: give each test more time than a capture.
    { name: 'robustesse', testMatch: 'robustesse.pw.ts', timeout: 120_000, use: { viewport: { width: 1300, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev:test -w @futurcharts/demo',
    url: 'http://localhost:5274/visual.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
