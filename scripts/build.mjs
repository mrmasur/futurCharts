// Builds every package to dist/: one bundled ES module (vite) plus type declarations (tsc).
// Order matters: declarations of a package resolve @futurcharts/core through its built types.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

const packages = ['core', 'adapters', 'geo', 'element', 'react', 'vue', 'ember'];

for (const name of packages) {
  const root = resolve('packages', name);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      target: 'es2022',
      minify: false,
      sourcemap: true,
      lib: { entry: resolve(root, 'src/index.ts'), formats: ['es'], fileName: 'index' },
      rollupOptions: {
        // Dependencies, their subpaths, and Ember's own modules stay imports.
        external: (id) => deps.some((d) => id === d || id.startsWith(d + '/')) || id.startsWith('@ember/'),
      },
    },
  });
  execFileSync('npx', ['tsc', '-p', resolve(root, 'tsconfig.build.json')], { stdio: 'inherit' });
  console.log(`built @futurcharts/${name}`);
}
