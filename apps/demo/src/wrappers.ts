import { chart, type ChartEvents, type ChartSpec } from '@futurcharts/core';
import { defineFuturChart } from '@futurcharts/element';
import { FuturChart as ReactChart } from '@futurcharts/react';
import { FuturChart as VueChart } from '@futurcharts/vue';
import { createElement as e, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, h, ref, shallowRef } from 'vue';

const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** A different, deterministic dataset per version. */
function makeSpec(title: string, version: number): ChartSpec {
  const rows = days.map((day, i) => ({ day, orders: 40 + ((i * 37 + version * 53) % 90) }));
  return chart(rows)
    .title(title, `Jeu de données n° ${version + 1}`)
    .fields({ orders: { label: 'Commandes' } })
    .bar({ x: 'day', y: 'orders' })
    .toSpec();
}
const describe = (p: ChartEvents['click']) => `${p.items[0].xLabel} : ${p.items[0].valueLabel}`;

// React — no JSX here so the demo needs no extra build plugin; in an app you would write <FuturChart spec={spec} />.
function ReactDemo() {
  const [version, setVersion] = useState(0);
  const [picked, setPicked] = useState('—');
  const spec = useMemo(() => makeSpec('React', version), [version]);
  return e('div', null,
    e('div', { className: 'bar' },
      e('strong', null, 'React'),
      e('output', { id: 'react-out' }, picked),
      e('button', { id: 'react-btn', type: 'button', onClick: () => setVersion((v) => v + 1) }, 'Nouvelles données')),
    e('div', { className: 'chart' }, e(ReactChart, { spec, onClick: (p) => setPicked(describe(p)) })));
}
createRoot(document.getElementById('react')!).render(e(ReactDemo));

// Vue — render function instead of a template, for the same reason.
createApp({
  setup() {
    const version = ref(0);
    const picked = ref('—');
    const spec = shallowRef(makeSpec('Vue', 0));
    const next = () => (spec.value = makeSpec('Vue', ++version.value));
    return () => h('div', [
      h('div', { class: 'bar' }, [
        h('strong', 'Vue'),
        h('output', { id: 'vue-out' }, picked.value),
        h('button', { id: 'vue-btn', type: 'button', onClick: next }, 'Nouvelles données'),
      ]),
      h('div', { class: 'chart' }, h(VueChart, { spec: spec.value, onClick: (p: ChartEvents['click']) => (picked.value = describe(p)) })),
    ]);
  },
}).mount('#vue');

// Web Component — plain DOM.
defineFuturChart();
const wc = document.querySelector('futur-chart')!;
let wcVersion = 0;
wc.spec = makeSpec('Web Component', 0);
wc.addEventListener('chart-click', (ev) => {
  document.getElementById('wc-out')!.textContent = describe((ev as CustomEvent<ChartEvents['click']>).detail);
});
document.getElementById('wc-btn')!.addEventListener('click', () => (wc.spec = makeSpec('Web Component', ++wcVersion)));
