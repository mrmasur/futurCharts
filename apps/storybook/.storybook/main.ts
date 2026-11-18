import type { StorybookConfig } from '@storybook/html-vite';
import { fileURLToPath } from 'node:url';

const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.ts'],
  addons: ['@storybook/addon-essentials'],
  framework: { name: '@storybook/html-vite', options: {} },
  core: { disableTelemetry: true },
  async viteFinal(config) {
    config.resolve ??= {};
    const alias = { find: /^@futurcharts\/(.+)$/, replacement: fileURLToPath(new URL('../../../packages/$1/src/index.ts', import.meta.url)) };
    config.resolve.alias = [...(Array.isArray(config.resolve.alias) ? config.resolve.alias : []), alias];
    config.esbuild = { ...(config.esbuild || {}), target: 'es2022' };
    config.build = { ...(config.build || {}), target: 'es2022' };
    config.optimizeDeps = { ...(config.optimizeDeps || {}), esbuildOptions: { target: 'es2022' } };
    return config;
  },
};
export default config;
