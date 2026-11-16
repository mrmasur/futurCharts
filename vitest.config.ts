import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against the sources, not the built dist.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@futurcharts\/(.+)$/, replacement: fileURLToPath(new URL('./packages/$1/src/index.ts', import.meta.url)) }],
  },
});
