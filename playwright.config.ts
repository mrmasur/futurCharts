import { defineConfig } from '@playwright/test';

/**
 * Visual regression tests (tests/visual): each gallery example at four sizes / themes.
 * The two phone sizes are the ones of the mobile audit (`fcAudit(343, 260)`, `fcAudit(375, 520)`).
 * Reference captures depend on the platform (fonts, antialiasing): one folder per platform.
 */
const size = (largeur: number, hauteur: number, theme: 'light' | 'dark', dpr: number) => ({
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
  use: { baseURL: 'http://localhost:5273', browserName: 'chromium' },
  projects: [
    { name: 'bureau', ...size(800, 480, 'light', 1) },
    { name: 'sombre', ...size(800, 480, 'dark', 1) },
    { name: 'mobile', ...size(343, 260, 'light', 2) },
    { name: 'mobile-haut', ...size(375, 520, 'light', 2) },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5273/visual.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
