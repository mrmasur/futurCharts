import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // The demo runs against the package sources, so edits show up without a build.
  resolve: {
    alias: [{ find: /^@futurcharts\/(.+)$/, replacement: fileURLToPath(new URL('../../packages/$1/src/index.ts', import.meta.url)) }],
  },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: 'index.html', wrappers: 'wrappers.html' } },
  },
  esbuild: { target: 'es2022' },
});
