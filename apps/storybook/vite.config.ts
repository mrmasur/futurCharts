import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Stories run against the package sources, like the demo.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@futurcharts\/(.+)$/, replacement: fileURLToPath(new URL('../../packages/$1/src/index.ts', import.meta.url)) }],
  },
  esbuild: { target: 'es2022' },
});
