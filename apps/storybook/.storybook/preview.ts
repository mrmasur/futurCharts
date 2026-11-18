import type { Preview } from '@storybook/html';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: { expanded: true, sort: 'alpha' },
    backgrounds: { disable: true },
  },
  globalTypes: {
    theme: {
      description: 'Thème des graphiques',
      toolbar: { title: 'Thème', icon: 'mirror', items: [{ value: 'light', title: 'Clair' }, { value: 'dark', title: 'Sombre' }], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light' },
};
export default preview;
