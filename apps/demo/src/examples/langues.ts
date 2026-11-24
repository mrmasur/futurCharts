import { englishTexts } from '@futurcharts/core';
import type { Family } from './index';

// The texts the marks write themselves (headers, captions, tooltip rows) come from `theme.texts`:
// `theme: { texts: englishTexts }` turns them to English, one key at a time can be overridden too.
const english = { texts: englishTexts };

// --- Retention of six monthly cohorts.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const SIGNUPS = [1240, 1410, 1180, 1560, 1690, 1490];
const CURVE = [1, 0.58, 0.46, 0.4, 0.36, 0.34];
const retention = MONTHS.flatMap((month, c) =>
  CURVE.slice(0, MONTHS.length - c).map((base, p) => ({
    cohort: `${month} 2026`,
    month: p,
    active: Math.round(SIGNUPS[c] * (p === 0 ? 1 : base + (((c * 5 + p * 3) % 7) - 3) * 0.008)),
  })),
);

// --- API response times: a skewed distribution, 300 requests.
const latency = Array.from({ length: 300 }, (_, i) => {
  const u = ((i * 37) % 300) / 300 + 0.5 / 300;
  return { ms: Math.round(40 + 160 * Math.pow(u, 1.8) + ((i * 13) % 11)) };
});

// --- Sign-up funnel for two channels.
const STEPS = ['Visit', 'Sign-up', 'Activation', 'Purchase'];
const CHANNELS: [string, number[]][] = [
  ['Organic', [32400, 9800, 6100, 2300]],
  ['Paid', [41800, 7600, 3500, 1050]],
];
const funnel = CHANNELS.flatMap(([channel, counts]) => STEPS.map((step, i) => ({ step, channel, people: counts[i] })));

export const FAMILIES: Family[] = [
  {
    family: 'Analyse produit',
    entries: [
      {
        title: 'Graphiques en anglais',
        caption: 'theme.texts · les textes écrits par les marques (en-têtes, légendes, infobulles) passent en anglais avec theme: { texts: englishTexts } ; une seule clé se surcharge aussi : { texts: { median: \'Median\' } }',
        wide: true,
        stack: [280, 240, 240],
        tiles: [
          {
            title: 'Retention by cohort',
            theme: english,
            fields: { cohort: { label: 'Cohort' }, month: { label: 'Months since sign-up' }, active: { label: 'Active users' } },
            data: retention,
            layers: [{ mark: 'cohort', encode: { y: 'cohort', x: 'month', value: 'active' } }],
          },
          {
            title: 'API response time',
            theme: english,
            data: latency,
            fields: { ms: { label: 'Response time', format: { suffix: ' ms' } } },
            axes: { x: { title: 'Response time' }, y: { title: 'Share of requests' } },
            layers: [{ mark: 'ecdf', encode: { x: 'ms' }, style: { quantiles: [0.5, 0.9] } }],
          },
          {
            title: 'Sign-up funnel by channel',
            theme: english,
            data: funnel,
            fields: { step: { label: 'Step' }, channel: { label: 'Channel' }, people: { label: 'People' } },
            layers: [{ mark: 'funnelCompare', encode: { key: 'step', color: 'channel', value: 'people' } }],
          },
        ],
      },
    ],
  },
];
